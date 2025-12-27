import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import consola from "consola";
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
import { detectAndUpdateReadme } from "../utils/readme";
import { TEMPLATE_SOURCE } from "../utils/template";
import { detectUntrackedFiles } from "../utils/untracked";

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
  },
  async run({ args }) {
    const targetDir = resolve(args.dir);
    const configPath = join(targetDir, ".devenv.json");

    // .devenv.json の存在確認
    if (!existsSync(configPath)) {
      consola.error(".devenv.json が見つかりません。先に init コマンドを実行してください。");
      process.exit(1);
    }

    // 設定読み込み
    const configContent = await readFile(configPath, "utf-8");
    const configData = JSON.parse(configContent);
    const parseResult = configSchema.safeParse(configData);

    if (!parseResult.success) {
      consola.error(".devenv.json の形式が不正です:", parseResult.error.message);
      process.exit(1);
    }

    const config: DevEnvConfig = parseResult.data;

    if (config.modules.length === 0) {
      consola.warn("インストール済みのモジュールがありません。");
      return;
    }

    consola.start("テンプレートをダウンロード中...");

    // テンプレートを一時ディレクトリにダウンロード
    const tempDir = join(targetDir, ".devenv-temp");

    try {
      const { dir: templateDir } = await downloadTemplate(TEMPLATE_SOURCE, {
        dir: tempDir,
        force: true,
      });

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
          const selectedFiles = await promptAddUntrackedFiles(untrackedByFolder);

          if (selectedFiles.length > 0) {
            // modules.jsonc にパターンを追加（メモリ上）
            let currentContent = modulesRawContent;
            for (const { moduleId, files } of selectedFiles) {
              currentContent = addPatternToModulesFile(currentContent, moduleId, files);
            }
            updatedModulesContent = currentContent;

            // 更新されたモジュールリストを再パースして反映
            // これにより、新しく追加したパターンが差分検出で使用される
            const parsedUpdated = parse(updatedModulesContent) as {
              modules: TemplateModule[];
            };
            moduleList = parsedUpdated.modules;

            const totalAdded = selectedFiles.reduce((sum, s) => sum + s.files.length, 0);
            consola.info(
              `${totalAdded} 件のパターンを modules.jsonc に追加します（PR に含まれます）`,
            );
          }
        }
      }

      consola.start("差分を検出中...");

      // 差分検出
      const diff = await detectDiff({
        targetDir,
        templateDir,
        moduleIds: config.modules,
        config,
        moduleList,
      });

      // push 対象ファイルを取得
      let pushableFiles = getPushableFiles(diff);

      if (pushableFiles.length === 0 && !updatedModulesContent) {
        consola.info("push するファイルがありません。");
        console.log();
        console.log(formatDiff(diff, false));
        return;
      }

      // ドライランモード
      if (args.dryRun) {
        consola.info("[ドライラン] 以下のファイルが PR として送信されます:");
        console.log();
        console.log(formatDiff(diff, true));
        if (updatedModulesContent) {
          console.log(`  [+] ${MODULES_FILE_PATH} (パターン追加)`);
        }
        console.log();
        consola.info("[ドライラン] 実際の PR は作成されませんでした。");
        return;
      }

      // ファイル選択（デフォルト動作）
      if (args.interactive && !args.force) {
        pushableFiles = await promptSelectFilesWithDiff(pushableFiles);
        if (pushableFiles.length === 0 && !updatedModulesContent) {
          consola.info("ファイルが選択されませんでした。キャンセルします。");
          return;
        }
      } else if (!args.force) {
        // --no-interactive 時は従来の確認プロンプト
        const confirmed = await promptPushConfirm(diff);
        if (!confirmed) {
          consola.info("キャンセルしました。");
          return;
        }
      }

      // GitHub トークン取得
      let token = getGitHubToken();
      if (!token) {
        token = await promptGitHubToken();
      }

      // PR タイトル取得
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

      consola.start("PR を作成中...");

      // PR 作成
      const result = await createPullRequest(token, {
        owner: config.source.owner,
        repo: config.source.repo,
        files,
        title,
        body,
        baseBranch: config.source.ref || "main",
      });

      console.log();
      consola.success(`PR を作成しました!`);
      console.log();
      console.log(`  URL: ${result.url}`);
      console.log(`  Branch: ${result.branch}`);
      console.log();
    } finally {
      // 一時ディレクトリを削除
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});
