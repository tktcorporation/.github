import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import { downloadTemplate } from "giget";
import { parse } from "jsonc-parser";
import { join, resolve } from "pathe";
import {
  addPatternToModulesFile,
  defaultModules,
  loadModulesFile,
  modulesFileExists,
} from "../modules";
import type { DevEnvConfig, TemplateModule } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import {
  promptAddUntrackedFiles,
  promptGitHubToken,
  promptPrBody,
  promptPrTitle,
  promptPushConfirm,
  promptSelectFilesWithDiff,
} from "../prompts/push";
import { detectDiff, formatDiff, getPushableFiles } from "../utils/diff";
import { createPullRequest, getGitHubToken } from "../utils/github";
import {
  generateManifest,
  getSelectedFilePaths,
  getSelectedUntrackedFiles,
  loadManifest,
  MANIFEST_FILENAME,
  saveManifest,
} from "../utils/manifest";
import { detectAndUpdateReadme } from "../utils/readme";
import { TEMPLATE_SOURCE } from "../utils/template";
import { detectUntrackedFiles } from "../utils/untracked";
import {
  box,
  diffHeader,
  log,
  pc,
  showHeader,
  showNextSteps,
  step,
  withSpinner,
} from "../utils/ui";

const MODULES_FILE_PATH = ".devenv/modules.jsonc";
const README_PATH = "README.md";

/**
 * --execute モード: マニフェストファイルを使ってPRを作成
 */
async function runExecuteMode(
  targetDir: string,
  config: DevEnvConfig,
  messageOverride?: string,
): Promise<void> {
  const totalSteps = 4;
  let currentStep = 1;

  // Step 1: マニフェスト読み込み
  step({ current: currentStep++, total: totalSteps }, "Loading manifest...");

  let manifest;
  try {
    manifest = await loadManifest(targetDir);
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
  }

  const selectedFilePaths = getSelectedFilePaths(manifest);
  const selectedUntracked = getSelectedUntrackedFiles(manifest);

  if (selectedFilePaths.length === 0 && selectedUntracked.size === 0) {
    log.newline();
    log.info("No files selected in manifest. Nothing to push.");
    log.dim(`Edit ${MANIFEST_FILENAME} and set 'selected: true' for files you want to include.`);
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
  step({ current: currentStep++, total: totalSteps }, "Fetching template...");

  const tempDir = join(targetDir, ".devenv-temp");

  try {
    const { dir: templateDir } = await withSpinner("Downloading template from GitHub...", () =>
      downloadTemplate(TEMPLATE_SOURCE, {
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

    // Step 3: ファイル内容を取得
    step({ current: currentStep++, total: totalSteps }, "Preparing files...");

    // 差分を検出してファイル内容を取得
    const diff = await withSpinner("Analyzing differences...", () =>
      detectDiff({
        targetDir,
        templateDir,
        moduleIds: config.modules,
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
      log.newline();
      log.warn("Manifest is out of sync with current changes:");
      if (missingFiles.length > 0) {
        log.dim(`  Missing files (in manifest but no longer changed): ${missingFiles.join(", ")}`);
      }
      if (newFiles.length > 0) {
        log.dim(`  New files (changed but not in manifest): ${newFiles.join(", ")}`);
      }
      log.dim("  Consider running 'create-devenv push --prepare' to regenerate the manifest.");
      log.newline();
    }

    // 選択されたファイルの内容を取得（存在するもののみ）
    const pushableFiles = getPushableFiles(diff);
    const selectedFiles = pushableFiles.filter((f) => selectedFilePaths.includes(f.path));

    const files: { path: string; content: string }[] = selectedFiles.map((f) => ({
      path: f.path,
      content: f.localContent || "",
    }));

    // 選択された未追跡ファイルの処理
    let updatedModulesContent: string | undefined;
    if (selectedUntracked.size > 0 && modulesRawContent) {
      let currentContent = modulesRawContent;
      for (const [moduleId, filePaths] of selectedUntracked) {
        currentContent = addPatternToModulesFile(currentContent, moduleId, filePaths);
      }
      updatedModulesContent = currentContent;
      files.push({
        path: MODULES_FILE_PATH,
        content: updatedModulesContent,
      });
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
      log.newline();
      log.info("No files to push after processing.");
      return;
    }

    // GitHub トークン取得
    let token = manifest.github.token || getGitHubToken();
    if (!token) {
      log.newline();
      log.error("GitHub token not found.");
      log.dim("Set GITHUB_TOKEN/GH_TOKEN environment variable, or add token to manifest.");
      process.exit(1);
    }

    // PR タイトル・本文
    const title = messageOverride || manifest.pr.title;
    const body = manifest.pr.body;

    // Step 4: PR を作成
    step({ current: currentStep++, total: totalSteps }, "Creating pull request...");

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
    box("Pull request created!", "success");

    console.log(`  ${pc.bold("URL:")}    ${pc.cyan(result.url)}`);
    console.log(`  ${pc.bold("Branch:")} ${result.branch}`);
    console.log(`  ${pc.bold("Files:")}  ${files.length} files included`);
    log.newline();

    showNextSteps([
      {
        description: `Review and merge the PR at ${result.url}`,
      },
      {
        description: `Delete ${MANIFEST_FILENAME} after PR is merged`,
      },
    ]);
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
    showHeader("create-devenv push");

    // --prepare と --execute の相互排他チェック
    if (args.prepare && args.execute) {
      log.error("Cannot use --prepare and --execute together.");
      log.dim("Use --prepare to generate a manifest, then --execute to create the PR.");
      process.exit(1);
    }

    // --prepare と --dry-run の組み合わせは警告（prepareはそもそもPRを作らない）
    if (args.prepare && args.dryRun) {
      log.warn("--dry-run is ignored with --prepare (--prepare doesn't create a PR).");
    }

    // --execute と --interactive の組み合わせは警告（executeは非インタラクティブ）
    if (args.execute && args.interactive) {
      log.dim("Note: --execute mode is non-interactive. File selection is based on the manifest.");
    }

    const targetDir = resolve(args.dir);
    const configPath = join(targetDir, ".devenv.json");

    // .devenv.json の存在確認
    if (!existsSync(configPath)) {
      log.error(".devenv.json not found. Run 'init' command first.");
      process.exit(1);
    }

    // 設定読み込み
    const configContent = await readFile(configPath, "utf-8");
    const configData = JSON.parse(configContent);
    const parseResult = configSchema.safeParse(configData);

    if (!parseResult.success) {
      log.error("Invalid .devenv.json format");
      log.dim(parseResult.error.message);
      process.exit(1);
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

    const totalSteps = args.dryRun ? 2 : args.prepare ? 2 : 4;
    let currentStep = 1;

    // Step 1: テンプレートをダウンロード
    step({ current: currentStep++, total: totalSteps }, "Fetching template...");

    // テンプレートを一時ディレクトリにダウンロード
    const tempDir = join(targetDir, ".devenv-temp");

    try {
      const { dir: templateDir } = await withSpinner("Downloading template from GitHub...", () =>
        downloadTemplate(TEMPLATE_SOURCE, {
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

      // ホワイトリスト外ファイルの検出と追加確認
      let updatedModulesContent: string | undefined;

      if (!args.force && modulesRawContent) {
        const untrackedByFolder = await detectUntrackedFiles({
          targetDir,
          moduleIds: config.modules,
          config,
          moduleList,
        });

        if (untrackedByFolder.length > 0) {
          log.newline();
          log.info(pc.bold("Untracked files detected:"));
          log.newline();

          const selectedFiles = await promptAddUntrackedFiles(untrackedByFolder);

          if (selectedFiles.length > 0) {
            // modules.jsonc にパターンを追加（メモリ上）
            let currentContent = modulesRawContent;
            for (const { moduleId, files } of selectedFiles) {
              currentContent = addPatternToModulesFile(currentContent, moduleId, files);
            }
            updatedModulesContent = currentContent;

            // 更新されたモジュールリストを再パースして反映
            const parsedUpdated = parse(updatedModulesContent) as {
              modules: TemplateModule[];
            };
            moduleList = parsedUpdated.modules;

            const totalAdded = selectedFiles.reduce((sum, s) => sum + s.files.length, 0);
            log.success(`${totalAdded} patterns will be added to modules.jsonc`);
          }
        }
      }

      // Step 2: 差分を検出
      step({ current: currentStep++, total: totalSteps }, "Detecting changes...");

      const diff = await withSpinner("Analyzing differences...", () =>
        detectDiff({
          targetDir,
          templateDir,
          moduleIds: config.modules,
          config,
          moduleList,
        }),
      );

      // push 対象ファイルを取得
      let pushableFiles = getPushableFiles(diff);

      if (pushableFiles.length === 0 && !updatedModulesContent) {
        log.newline();
        log.info("No changes to push");
        diffHeader("Current status:");
        console.log(formatDiff(diff, false));
        return;
      }

      // ドライランモード
      if (args.dryRun) {
        log.newline();
        box("Dry run mode", "info");

        diffHeader("Files that would be included in PR:");
        console.log(formatDiff(diff, true));

        if (updatedModulesContent) {
          console.log(`  ${pc.green("+")} ${MODULES_FILE_PATH} ${pc.dim("(pattern additions)")}`);
        }

        log.newline();
        log.info("No PR was created (dry run)");
        return;
      }

      // --prepare モード: マニフェストファイルを生成
      if (args.prepare) {
        const untrackedByFolder =
          !args.force && modulesRawContent
            ? await detectUntrackedFiles({
                targetDir,
                moduleIds: config.modules,
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
        });

        const manifestPath = await saveManifest(targetDir, manifest);

        log.newline();
        box("Manifest file generated!", "success");
        log.newline();

        console.log(`  ${pc.bold("File:")} ${pc.cyan(manifestPath)}`);
        console.log(`  ${pc.bold("Files:")} ${pushableFiles.length} files ready to push`);
        if (untrackedByFolder.length > 0) {
          const untrackedCount = untrackedByFolder.reduce((sum, f) => sum + f.files.length, 0);
          console.log(
            `  ${pc.bold("Untracked:")} ${untrackedCount} files detected (not selected by default)`,
          );
        }
        log.newline();

        showNextSteps([
          {
            description: `Edit ${MANIFEST_FILENAME} to select files and configure PR`,
          },
          {
            description: `Run 'create-devenv push --execute' to create the PR`,
          },
        ]);

        return;
      }

      // Step 3: ファイル選択
      step({ current: currentStep++, total: totalSteps }, "Selecting files...");
      log.newline();

      if (args.interactive && !args.force) {
        pushableFiles = await promptSelectFilesWithDiff(pushableFiles);
        if (pushableFiles.length === 0 && !updatedModulesContent) {
          log.info("No files selected. Cancelled.");
          return;
        }
      } else if (!args.force) {
        // --no-interactive 時は従来の確認プロンプト
        const confirmed = await promptPushConfirm(diff);
        if (!confirmed) {
          log.info("Cancelled");
          return;
        }
      }

      // GitHub トークン取得
      let token = getGitHubToken();
      if (!token) {
        log.newline();
        token = await promptGitHubToken();
      }

      // PR タイトル取得
      log.newline();
      const title = args.message || (await promptPrTitle());

      // PR 本文取得
      const body = await promptPrBody();

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
      step({ current: currentStep++, total: totalSteps }, "Creating pull request...");

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
      box("Pull request created!", "success");

      console.log(`  ${pc.bold("URL:")}    ${pc.cyan(result.url)}`);
      console.log(`  ${pc.bold("Branch:")} ${result.branch}`);
      log.newline();

      showNextSteps([
        {
          description: `Review and merge the PR at ${result.url}`,
        },
      ]);
    } finally {
      // 一時ディレクトリを削除
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});
