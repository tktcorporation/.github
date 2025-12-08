import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "pathe";
import { modules } from "../modules/index";
import type { Answers } from "../modules/schemas";
import { promptInit } from "../prompts/init";
import { fetchTemplates } from "../utils/template";

export const initCommand = defineCommand({
  meta: {
    name: "create-devenv",
    version: "0.1.0",
    description: "開発環境テンプレートを適用",
  },
  args: {
    dir: {
      type: "positional",
      description: "プロジェクトディレクトリ",
      default: ".",
    },
    force: {
      type: "boolean",
      description: "既存ファイルを強制上書き",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "すべてのモジュールを自動選択（非インタラクティブモード）",
      default: false,
    },
  },
  async run({ args }) {
    // "init" という引数は無視して現在のディレクトリを使用
    const dir = args.dir === "init" ? "." : args.dir;
    const targetDir = resolve(dir);

    consola.box("Create DevEnv");
    consola.info(`ターゲット: ${targetDir}`);

    // ディレクトリ作成
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // プロンプトまたは自動選択
    let answers: Answers;
    if (args.yes) {
      answers = {
        modules: modules.map((m) => m.id),
        overwriteStrategy: "overwrite",
      };
      consola.info("すべてのモジュールを自動選択しました");
    } else {
      answers = await promptInit();
    }

    if (answers.modules.length === 0) {
      consola.warn("テンプレートが選択されませんでした");
      return;
    }

    // テンプレート取得・適用
    await fetchTemplates({
      targetDir,
      modules: answers.modules,
      overwriteStrategy: args.force ? "overwrite" : answers.overwriteStrategy,
    });

    // devcontainer.env.example を作成
    if (answers.modules.includes("devcontainer")) {
      createEnvExample(targetDir);
    }

    // 設定ファイル生成
    createDevEnvConfig(targetDir, answers.modules);

    consola.box("セットアップ完了!");
    consola.info("次のステップ:");
    consola.info("  1. .devcontainer/devcontainer.env を作成");
    consola.info("  2. code . で VS Code を開く");
    consola.info("  3. DevContainer で再オープン");
  },
});

function createEnvExample(targetDir: string): void {
  const content = `# 環境変数サンプル
# このファイルを devcontainer.env にコピーして値を設定してください

# GitHub Personal Access Token
GH_TOKEN=

# AWS Credentials (optional)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=ap-northeast-1

# WakaTime API Key (optional)
WAKATIME_API_KEY=
`;

  const devcontainerDir = resolve(targetDir, ".devcontainer");
  if (!existsSync(devcontainerDir)) {
    mkdirSync(devcontainerDir, { recursive: true });
  }

  const examplePath = resolve(
    targetDir,
    ".devcontainer/devcontainer.env.example",
  );
  writeFileSync(examplePath, content);
  consola.success("作成: .devcontainer/devcontainer.env.example");
}

function createDevEnvConfig(targetDir: string, modules: string[]): void {
  const config = {
    version: "0.1.0",
    installedAt: new Date().toISOString(),
    modules,
    source: {
      owner: "tktcorporation",
      repo: ".github",
    },
  };

  const configPath = resolve(targetDir, ".devenv.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  consola.success("作成: .devenv.json");
}
