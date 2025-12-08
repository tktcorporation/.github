import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import consola from "consola";
import { downloadTemplate } from "giget";
import { join, resolve } from "pathe";
import type { DevEnvConfig } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import { detectDiff, formatDiff, hasDiff } from "../utils/diff";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

export const diffCommand = defineCommand({
  meta: {
    name: "diff",
    description: "ローカルとテンプレートの差分を表示",
  },
  args: {
    dir: {
      type: "positional",
      description: "プロジェクトディレクトリ",
      default: ".",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "詳細な差分を表示",
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

      // 結果表示
      console.log();
      console.log(formatDiff(diff, args.verbose));
      console.log();

      if (hasDiff(diff)) {
        consola.info(
          'ローカルの変更をテンプレートに反映するには "push" コマンドを使用してください。',
        );
      }
    } finally {
      // 一時ディレクトリを削除
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});
