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
  promptSelectHunksForMerge,
  type MergeResult,
} from "../prompts/push";
import { detectDiff, formatDiff, getPushableFiles } from "../utils/diff";
import { createPullRequest, getGitHubToken } from "../utils/github";
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
    merge: {
      type: "boolean",
      alias: "M",
      description: "Merge mode: select individual chunks instead of whole files",
      default: false,
    },
  },
  async run({ args }) {
    showHeader("create-devenv push");

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

    const totalSteps = args.dryRun ? 2 : 4;
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

      // Step 3: ファイル選択
      step({ current: currentStep++, total: totalSteps }, "Selecting files...");
      log.newline();

      // マージモードかどうかでファイル選択方法を分岐
      let files: { path: string; content: string }[];

      if (args.merge && !args.force) {
        // マージモード: hunk単位で選択
        const mergeResults = await promptSelectHunksForMerge(pushableFiles);
        if (mergeResults.length === 0 && !updatedModulesContent) {
          log.info("No chunks selected. Cancelled.");
          return;
        }

        // マージ結果のサマリーを表示
        if (mergeResults.length > 0) {
          log.newline();
          log.info(pc.bold("Selected changes:"));
          for (const result of mergeResults) {
            const icon = result.type === "added" ? pc.green("✚") : pc.yellow("⬡");
            const stats =
              result.type === "modified"
                ? pc.dim(`(${result.selectedCount}/${result.totalCount} chunks)`)
                : "";
            log.dim(`  ${icon} ${result.path} ${stats}`);
          }
          log.newline();
        }

        files = mergeResults.map((r) => ({
          path: r.path,
          content: r.content,
        }));
      } else if (args.interactive && !args.force) {
        // 通常モード: ファイル単位で選択
        pushableFiles = await promptSelectFilesWithDiff(pushableFiles);
        if (pushableFiles.length === 0 && !updatedModulesContent) {
          log.info("No files selected. Cancelled.");
          return;
        }
        files = pushableFiles.map((f) => ({
          path: f.path,
          content: f.localContent || "",
        }));
      } else if (!args.force) {
        // --no-interactive 時は従来の確認プロンプト
        const confirmed = await promptPushConfirm(diff);
        if (!confirmed) {
          log.info("Cancelled");
          return;
        }
        files = pushableFiles.map((f) => ({
          path: f.path,
          content: f.localContent || "",
        }));
      } else {
        // --force: 確認なしで全ファイル
        files = pushableFiles.map((f) => ({
          path: f.path,
          content: f.localContent || "",
        }));
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
