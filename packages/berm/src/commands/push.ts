import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import { downloadTemplate } from "giget";
import { parse } from "jsonc-parser";
import { join, resolve } from "pathe";
import { BermError } from "../errors";
import {
  addPatternToModulesFileWithCreate,
  defaultModules,
  loadModulesFile,
  modulesFileExists,
} from "../modules";
import type { DevEnvConfig, TemplateModule } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import {
  confirmAction,
  inputGitHubToken,
  inputPrBody,
  inputPrTitle,
  selectPushFiles,
} from "../ui/prompts";
import { intro, log, logDiffSummary, outro, pc, withSpinner } from "../ui/renderer";
import { detectDiff, getPushableFiles } from "../utils/diff";
import { createPullRequest, getGitHubToken } from "../utils/github";
import {
  deleteManifest,
  generateManifest,
  getSelectedFilePaths,
  getSelectedUntrackedFiles,
  loadManifest,
  MANIFEST_FILENAME,
  saveManifest,
} from "../utils/manifest";
import { detectAndUpdateReadme } from "../utils/readme";
import { buildTemplateSource } from "../utils/template";
import { detectUntrackedFiles } from "../utils/untracked";

const MODULES_FILE_PATH = ".devenv/modules.jsonc";
const README_PATH = "README.md";

interface LocalModuleAdditions {
  mergedModuleList: TemplateModule[];
  newModuleIds: string[];
  updatedModulesContent: string | undefined;
}

/**
 * ローカルの modules.jsonc とテンプレートの modules.jsonc を比較し、
 * ローカルにのみ存在するモジュール（track コマンドで追加されたもの等）を検出してマージする。
 * テンプレートの raw content をベースに新モジュールを追加した内容を返す。
 */
async function detectLocalModuleAdditions(
  targetDir: string,
  templateModules: TemplateModule[],
  templateRawContent: string,
): Promise<LocalModuleAdditions> {
  if (!modulesFileExists(targetDir)) {
    return {
      mergedModuleList: templateModules,
      newModuleIds: [],
      updatedModulesContent: undefined,
    };
  }

  const local = await loadModulesFile(targetDir);
  const templateModuleIds = new Set(templateModules.map((m) => m.id));

  // ローカルにのみ存在するモジュールを検出
  const newModules = local.modules.filter((m) => !templateModuleIds.has(m.id));

  if (newModules.length === 0) {
    // 新モジュールはないが、既存モジュールにローカルでパターンが追加されていないかチェック
    let updatedContent = templateRawContent;
    let hasPatternAdditions = false;
    for (const localMod of local.modules) {
      const templateMod = templateModules.find((m) => m.id === localMod.id);
      if (!templateMod) continue;
      const newPatterns = localMod.patterns.filter((p) => !templateMod.patterns.includes(p));
      if (newPatterns.length > 0) {
        updatedContent = addPatternToModulesFileWithCreate(
          updatedContent,
          localMod.id,
          newPatterns,
        );
        hasPatternAdditions = true;
      }
    }

    if (hasPatternAdditions) {
      const merged = parse(updatedContent) as { modules: TemplateModule[] };
      return {
        mergedModuleList: merged.modules,
        newModuleIds: [],
        updatedModulesContent: updatedContent,
      };
    }

    return {
      mergedModuleList: templateModules,
      newModuleIds: [],
      updatedModulesContent: undefined,
    };
  }

  // テンプレートの raw content に新モジュールを追加
  let updatedContent = templateRawContent;
  for (const mod of newModules) {
    updatedContent = addPatternToModulesFileWithCreate(updatedContent, mod.id, mod.patterns, {
      name: mod.name,
      description: mod.description,
    });
  }

  // 既存モジュールへのパターン追加もチェック
  for (const localMod of local.modules) {
    const templateMod = templateModules.find((m) => m.id === localMod.id);
    if (!templateMod) continue; // 新モジュールは上で処理済み
    const newPatterns = localMod.patterns.filter((p) => !templateMod.patterns.includes(p));
    if (newPatterns.length > 0) {
      updatedContent = addPatternToModulesFileWithCreate(updatedContent, localMod.id, newPatterns);
    }
  }

  const merged = parse(updatedContent) as { modules: TemplateModule[] };
  return {
    mergedModuleList: merged.modules,
    newModuleIds: newModules.map((m) => m.id),
    updatedModulesContent: updatedContent,
  };
}

/**
 * --execute モード: マニフェストファイルを使ってPRを作成
 */
async function runExecuteMode(
  targetDir: string,
  config: DevEnvConfig,
  messageOverride?: string,
): Promise<void> {
  // Step 1: マニフェスト読み込み
  log.step("Loading manifest...");

  let manifest;
  try {
    manifest = await loadManifest(targetDir);
  } catch (error) {
    throw new BermError((error as Error).message);
  }

  const selectedFilePaths = getSelectedFilePaths(manifest);
  const selectedUntracked = getSelectedUntrackedFiles(manifest);

  if (selectedFilePaths.length === 0 && selectedUntracked.size === 0) {
    log.info("No files selected in manifest. Nothing to push.");
    log.message(
      pc.dim(`Edit ${MANIFEST_FILENAME} and set 'selected: true' for files you want to include.`),
    );
    return;
  }

  log.success(`${selectedFilePaths.length} files selected from manifest`);
  if (selectedUntracked.size > 0) {
    const untrackedCount = Array.from(selectedUntracked.values()).reduce(
      (sum, files) => sum + files.length,
      0,
    );
    log.success(`${untrackedCount} untracked files will be added to patterns`);
  }

  // Step 2: テンプレートダウンロード（差分取得用）
  log.step("Fetching template...");

  const templateSource = buildTemplateSource(config.source);
  const tempDir = join(targetDir, ".devenv-temp");

  try {
    const { dir: templateDir } = await withSpinner("Downloading template from GitHub...", () =>
      downloadTemplate(templateSource, {
        dir: tempDir,
        force: true,
      }),
    );

    // modules.jsonc を読み込み
    let moduleList: TemplateModule[];
    let modulesRawContent: string | undefined;

    if (modulesFileExists(templateDir)) {
      const loaded = await loadModulesFile(templateDir);
      moduleList = loaded.modules;
      modulesRawContent = loaded.rawContent;
    } else {
      moduleList = defaultModules;
    }

    // ローカルのモジュール追加を検出してマージ
    const effectiveModuleIds = [...config.modules];
    let updatedModulesContent: string | undefined;

    if (modulesRawContent) {
      const localAdditions = await detectLocalModuleAdditions(
        targetDir,
        moduleList,
        modulesRawContent,
      );
      moduleList = localAdditions.mergedModuleList;
      updatedModulesContent = localAdditions.updatedModulesContent;
      for (const id of localAdditions.newModuleIds) {
        if (!effectiveModuleIds.includes(id)) {
          effectiveModuleIds.push(id);
        }
      }
    }

    // 選択された未追跡ファイルのパターンを moduleList に反映
    // （interactive モードと同様に detectDiff の前に実行する）
    if (selectedUntracked.size > 0 && modulesRawContent) {
      let currentContent = updatedModulesContent || modulesRawContent;
      for (const [moduleId, filePaths] of selectedUntracked) {
        currentContent = addPatternToModulesFileWithCreate(currentContent, moduleId, filePaths);
      }
      updatedModulesContent = currentContent;

      // 更新されたモジュールリストを再パースして反映
      const parsedUpdated = parse(updatedModulesContent) as {
        modules: TemplateModule[];
      };
      moduleList = parsedUpdated.modules;
    }

    // Step 3: ファイル内容を取得
    log.step("Preparing files...");

    // 差分を検出（更新済み moduleList を使用するため、未追跡ファイルも pushable に含まれる）
    const diff = await withSpinner("Analyzing differences...", () =>
      detectDiff({
        targetDir,
        templateDir,
        moduleIds: effectiveModuleIds,
        config,
        moduleList,
      }),
    );

    // マニフェストと現在の差分の整合性チェック
    const currentPushableFiles = getPushableFiles(diff);
    const currentFilePaths = new Set(currentPushableFiles.map((f) => f.path));
    const manifestFilePaths = new Set(manifest.files.map((f) => f.path));

    // マニフェストにあるが現在存在しないファイル
    const missingFiles = selectedFilePaths.filter((p) => !currentFilePaths.has(p));
    // 現在存在するがマニフェストにないファイル（新規追加）
    const newFiles = currentPushableFiles
      .filter((f) => !manifestFilePaths.has(f.path))
      .map((f) => f.path);

    if (missingFiles.length > 0 || newFiles.length > 0) {
      log.warn("Manifest is out of sync with current changes:");
      if (missingFiles.length > 0) {
        log.message(
          pc.dim(`  Missing files (in manifest but no longer changed): ${missingFiles.join(", ")}`),
        );
      }
      if (newFiles.length > 0) {
        log.message(pc.dim(`  New files (changed but not in manifest): ${newFiles.join(", ")}`));
      }
      log.message(pc.dim("  Consider running 'berm push --prepare' to regenerate the manifest."));
    }

    // 選択されたファイルの内容を取得
    // マニフェストの files と untracked files の両方をフィルタ対象にする
    const pushableFiles = getPushableFiles(diff);
    const allSelectedPaths = [
      ...selectedFilePaths,
      ...Array.from(selectedUntracked.values()).flat(),
    ];
    const selectedFiles = pushableFiles.filter((f) => allSelectedPaths.includes(f.path));

    const files: { path: string; content: string }[] = selectedFiles.map((f) => ({
      path: f.path,
      content: f.localContent || "",
    }));

    // modules.jsonc の変更があれば追加
    if (updatedModulesContent) {
      const modulesInManifest = selectedFilePaths.includes(MODULES_FILE_PATH);
      if (modulesInManifest || selectedUntracked.size > 0) {
        const existingIdx = files.findIndex((f) => f.path === MODULES_FILE_PATH);
        if (existingIdx !== -1) {
          files[existingIdx].content = updatedModulesContent;
        } else {
          files.push({
            path: MODULES_FILE_PATH,
            content: updatedModulesContent,
          });
        }
      }
    }

    // README 更新チェック
    const readmeResult = await detectAndUpdateReadme(targetDir, templateDir);
    if (readmeResult?.updated) {
      files.push({
        path: README_PATH,
        content: readmeResult.content,
      });
    }

    if (files.length === 0) {
      log.info("No files to push after processing.");
      return;
    }

    // GitHub トークン取得
    let token = manifest.github.token || getGitHubToken();
    if (!token) {
      throw new BermError(
        "GitHub token not found.",
        "Set GITHUB_TOKEN or GH_TOKEN environment variable, or add token to manifest.",
      );
    }

    // PR タイトル・本文
    const title = messageOverride || manifest.pr.title;
    const body = manifest.pr.body;

    // Step 4: PR を作成
    log.step("Creating pull request...");

    const result = await withSpinner("Creating PR on GitHub...", () =>
      createPullRequest(token, {
        owner: config.source.owner,
        repo: config.source.repo,
        files,
        title,
        body,
        baseBranch: config.source.ref || "main",
      }),
    );

    // マニフェストファイルを自動削除（PR作成に成功したので不要）
    await deleteManifest(targetDir);

    // 成功メッセージ
    log.success("Pull request created!");
    log.message(
      [
        `URL:    ${pc.cyan(result.url)}`,
        `Branch: ${result.branch}`,
        `Files:  ${files.length} files included`,
      ].join("\n"),
    );
    log.message(pc.dim(`Cleaned up ${MANIFEST_FILENAME}`));
    outro(`Review and merge the PR at ${result.url}`);
  } finally {
    // 一時ディレクトリを削除
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export const pushCommand = defineCommand({
  meta: {
    name: "push",
    description: "Push local changes to the template repository as a PR",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      default: ".",
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview only, don't create PR",
      default: false,
    },
    message: {
      type: "string",
      alias: "m",
      description: "PR title",
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Skip confirmation prompts",
      default: false,
    },
    interactive: {
      type: "boolean",
      alias: "i",
      description: "Select files while reviewing diffs (enabled by default)",
      default: true,
    },
    prepare: {
      type: "boolean",
      alias: "p",
      description: "Generate a manifest file for AI-agent friendly workflow (no PR created)",
      default: false,
    },
    execute: {
      type: "boolean",
      alias: "e",
      description: "Execute push using the manifest file generated by --prepare",
      default: false,
    },
  },
  async run({ args }) {
    intro("push");

    // --prepare と --execute の相互排他チェック
    if (args.prepare && args.execute) {
      throw new BermError(
        "Cannot use --prepare and --execute together.",
        "Use --prepare to generate a manifest, then --execute to create the PR.",
      );
    }

    // --prepare と --dry-run の組み合わせは警告（prepareはそもそもPRを作らない）
    if (args.prepare && args.dryRun) {
      log.warn("--dry-run is ignored with --prepare (--prepare doesn't create a PR).");
    }

    // --execute と --interactive の組み合わせは警告（executeは非インタラクティブ）
    if (args.execute && args.interactive) {
      log.message(
        pc.dim("Note: --execute mode is non-interactive. File selection is based on the manifest."),
      );
    }

    const targetDir = resolve(args.dir);
    const configPath = join(targetDir, ".devenv.json");

    // .devenv.json の存在確認
    if (!existsSync(configPath)) {
      throw new BermError(".devenv.json not found.", "Run 'berm init' first.");
    }

    // 設定読み込み
    const configContent = await readFile(configPath, "utf-8");
    const configData = JSON.parse(configContent);
    const parseResult = configSchema.safeParse(configData);

    if (!parseResult.success) {
      throw new BermError("Invalid .devenv.json format", parseResult.error.message);
    }

    const config: DevEnvConfig = parseResult.data;

    if (config.modules.length === 0) {
      log.warn("No modules installed");
      return;
    }

    // --execute モード: マニフェストファイルを使ってPRを作成
    if (args.execute) {
      await runExecuteMode(targetDir, config, args.message);
      return;
    }

    // Step 1: テンプレートをダウンロード
    log.step("Fetching template...");

    // テンプレートを一時ディレクトリにダウンロード
    const templateSource = buildTemplateSource(config.source);
    const tempDir = join(targetDir, ".devenv-temp");

    try {
      const { dir: templateDir } = await withSpinner("Downloading template from GitHub...", () =>
        downloadTemplate(templateSource, {
          dir: tempDir,
          force: true,
        }),
      );

      // modules.jsonc を読み込み
      let moduleList: TemplateModule[];
      let modulesRawContent: string | undefined;

      if (modulesFileExists(templateDir)) {
        const loaded = await loadModulesFile(templateDir);
        moduleList = loaded.modules;
        modulesRawContent = loaded.rawContent;
      } else {
        moduleList = defaultModules;
      }

      // ローカルのモジュール追加を検出してマージ
      const effectiveModuleIds = [...config.modules];
      let updatedModulesContent: string | undefined;

      if (modulesRawContent) {
        const localAdditions = await detectLocalModuleAdditions(
          targetDir,
          moduleList,
          modulesRawContent,
        );
        moduleList = localAdditions.mergedModuleList;
        updatedModulesContent = localAdditions.updatedModulesContent;
        for (const id of localAdditions.newModuleIds) {
          if (!effectiveModuleIds.includes(id)) {
            effectiveModuleIds.push(id);
          }
        }
        if (localAdditions.newModuleIds.length > 0) {
          log.info(
            `Detected ${localAdditions.newModuleIds.length} new module(s) from local: ${localAdditions.newModuleIds.join(", ")}`,
          );
        }
      }

      // ホワイトリスト外ファイルの検出と情報表示
      if (!args.force && !args.prepare && modulesRawContent) {
        const untrackedByFolder = await detectUntrackedFiles({
          targetDir,
          moduleIds: effectiveModuleIds,
          config,
          moduleList,
        });

        if (untrackedByFolder.length > 0) {
          const untrackedCount = untrackedByFolder.reduce((sum, f) => sum + f.files.length, 0);
          log.info(`${untrackedCount} untracked file(s) detected (not included in push)`);
        }
      }

      // Step 2: 差分を検出
      log.step("Detecting changes...");

      const diff = await withSpinner("Analyzing differences...", () =>
        detectDiff({
          targetDir,
          templateDir,
          moduleIds: effectiveModuleIds,
          config,
          moduleList,
        }),
      );

      // push 対象ファイルを取得
      let pushableFiles = getPushableFiles(diff);

      if (pushableFiles.length === 0 && !updatedModulesContent) {
        log.info("No changes to push");
        log.step("Current status:");
        logDiffSummary(diff.files);
        return;
      }

      // ドライランモード
      if (args.dryRun) {
        log.info("Dry run mode");
        log.step("Files that would be included in PR:");
        logDiffSummary(diff.files);

        if (updatedModulesContent) {
          log.message(`${pc.green("+")} ${MODULES_FILE_PATH} ${pc.dim("(pattern additions)")}`);
        }

        log.info("No PR was created (dry run)");
        return;
      }

      // --prepare モード: マニフェストファイルを生成
      if (args.prepare) {
        const untrackedByFolder =
          !args.force && modulesRawContent
            ? await detectUntrackedFiles({
                targetDir,
                moduleIds: effectiveModuleIds,
                config,
                moduleList,
              })
            : [];

        const manifest = generateManifest({
          targetDir,
          diff,
          pushableFiles,
          untrackedByFolder,
          defaultTitle: args.message,
          modulesFileChange: updatedModulesContent ? MODULES_FILE_PATH : undefined,
        });

        const manifestPath = await saveManifest(targetDir, manifest);

        log.success("Manifest file generated!");
        log.message(
          [
            `File:   ${pc.cyan(manifestPath)}`,
            `Files:  ${pushableFiles.length} files ready to push`,
            ...(updatedModulesContent
              ? ["Modules: modules.jsonc will be updated (new modules/patterns detected)"]
              : []),
            ...(untrackedByFolder.length > 0
              ? (() => {
                  const untrackedCount = untrackedByFolder.reduce(
                    (sum, f) => sum + f.files.length,
                    0,
                  );
                  return [`Untracked: ${untrackedCount} files detected (not selected by default)`];
                })()
              : []),
          ].join("\n"),
        );

        if (untrackedByFolder.length > 0) {
          log.info(
            `${pc.bold("Hint:")} To sync untracked files to the template, first add them to tracking:`,
          );
          log.message(
            pc.dim(
              [
                `  npx @tktco/berm track "<pattern>"  # Add file patterns to the sync whitelist`,
                `  npx @tktco/berm track --list        # List currently tracked patterns`,
                `  Then re-run 'push --prepare' to include them in the manifest.`,
              ].join("\n"),
            ),
          );
        }

        outro(`Edit ${MANIFEST_FILENAME}, then run 'berm push --execute' to create the PR`);
        return;
      }

      // Step 3: ファイル選択
      log.step("Selecting files...");

      if (args.interactive && !args.force) {
        pushableFiles = await selectPushFiles(pushableFiles);
        if (pushableFiles.length === 0 && !updatedModulesContent) {
          log.info("No files selected. Cancelled.");
          return;
        }
      } else if (!args.force) {
        // --no-interactive 時は従来の確認プロンプト
        const confirmed = await confirmAction("Create PR with these changes?");
        if (!confirmed) {
          log.info("Cancelled");
          return;
        }
      }

      // GitHub トークン取得
      let token = getGitHubToken();
      if (!token) {
        token = await inputGitHubToken();
      }

      // PR タイトル取得
      const title = args.message || (await inputPrTitle());

      // PR 本文取得
      const body = await inputPrBody();

      // README を更新（対象の場合のみ）
      const readmeResult = await detectAndUpdateReadme(targetDir, templateDir);

      // ファイル内容を準備
      const files = pushableFiles.map((f) => ({
        path: f.path,
        content: f.localContent || "",
      }));

      // modules.jsonc の変更があれば追加
      if (updatedModulesContent) {
        files.push({
          path: MODULES_FILE_PATH,
          content: updatedModulesContent,
        });
      }

      // README の変更があれば追加
      if (readmeResult?.updated) {
        files.push({
          path: README_PATH,
          content: readmeResult.content,
        });
      }

      // Step 4: PR を作成
      log.step("Creating pull request...");

      const result = await withSpinner("Creating PR on GitHub...", () =>
        createPullRequest(token, {
          owner: config.source.owner,
          repo: config.source.repo,
          files,
          title,
          body,
          baseBranch: config.source.ref || "main",
        }),
      );

      // 成功メッセージ
      log.success("Pull request created!");
      log.message(
        [
          `URL:    ${pc.cyan(result.url)}`,
          `Branch: ${result.branch}`,
          `Files:  ${files.length} files included`,
        ].join("\n"),
      );
      outro(`Review and merge the PR at ${result.url}`);
    } finally {
      // 一時ディレクトリを削除
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});
