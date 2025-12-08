import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import consola from "consola";
import { downloadTemplate } from "giget";
import { join, resolve } from "pathe";
import type { DevEnvConfig } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import {
  promptGitHubToken,
  promptPrBody,
  promptPrTitle,
  promptPushConfirm,
} from "../prompts/push";
import { detectDiff, formatDiff, getPushableFiles } from "../utils/diff";
import { createPullRequest, getGitHubToken } from "../utils/github";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

export const pushCommand = defineCommand({
  meta: {
    name: "push",
    description: "ローカル変更をテンプレートリポジトリに PR として送信",
  },
  args: {
    dir: {
      type: "positional",
      description: "プロジェクトディレクトリ",
      default: ".",
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "実際の PR を作成せず、プレビューのみ表示",
      default: false,
    },
    message: {
      type: "string",
      alias: "m",
      description: "PR のタイトル",
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "確認プロンプトをスキップ",
      default: false,
    },
  },
  async run({ args }) {
    const targetDir = resolve(args.dir);
    const configPath = join(targetDir, ".devenv.json");

    // .devenv.json の存在確認
    if (!existsSync(configPath)) {
      consola.error(
        ".devenv.json が見つかりません。先に init コマンドを実行してください。",
      );
      process.exit(1);
    }

    // 設定読み込み
    const configContent = await readFile(configPath, "utf-8");
    const configData = JSON.parse(configContent);
    const parseResult = configSchema.safeParse(configData);

    if (!parseResult.success) {
      consola.error(
        ".devenv.json の形式が不正です:",
        parseResult.error.message,
      );
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

      consola.start("差分を検出中...");

      // 差分検出
      const diff = await detectDiff({
        targetDir,
        templateDir,
        moduleIds: config.modules,
        config,
      });

      // push 対象ファイルを取得
      const pushableFiles = getPushableFiles(diff);

      if (pushableFiles.length === 0) {
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
        console.log();
        consola.info("[ドライラン] 実際の PR は作成されませんでした。");
        return;
      }

      // 確認プロンプト
      if (!args.force) {
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

      // ファイル内容を準備
      const files = pushableFiles.map((f) => ({
        path: f.path,
        content: f.localContent || "",
      }));

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
