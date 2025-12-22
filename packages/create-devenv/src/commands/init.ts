import { existsSync, mkdirSync } from "node:fs";
import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "pathe";
import {
  defaultModules,
  getModuleById,
  loadModulesFile,
  modulesFileExists,
} from "../modules/index";
import type {
  Answers,
  FileOperationResult,
  OverwriteStrategy,
  TemplateModule,
} from "../modules/schemas";
import { promptInit } from "../prompts/init";
import {
  downloadTemplateToTemp,
  fetchTemplates,
  logResult,
  writeFileWithStrategy,
} from "../utils/template";

// ビルド時に置換される定数
declare const __VERSION__: string;
const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

export const initCommand = defineCommand({
  meta: {
    name: "create-devenv",
    version,
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
    // バージョン情報を最初に表示
    consola.info(`@tktco/create-devenv v${version}`);

    // "init" という引数は無視して現在のディレクトリを使用
    const dir = args.dir === "init" ? "." : args.dir;
    const targetDir = resolve(dir);

    consola.box("Create DevEnv");
    consola.info(`ターゲット: ${targetDir}`);

    // ディレクトリ作成
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // テンプレートをダウンロード
    const { templateDir, cleanup } = await downloadTemplateToTemp(targetDir);

    try {
      // modules.jsonc からモジュールを読み込み（なければデフォルト使用）
      let moduleList: TemplateModule[];
      if (modulesFileExists(templateDir)) {
        const { modules: loadedModules } = await loadModulesFile(templateDir);
        moduleList = loadedModules;
      } else {
        moduleList = defaultModules;
      }

      // プロンプトまたは自動選択
      let answers: Answers;
      if (args.yes) {
        answers = {
          modules: moduleList.map((m) => m.id),
          overwriteStrategy: "overwrite",
        };
        consola.info("すべてのモジュールを自動選択しました");
      } else {
        answers = await promptInit(moduleList);
      }

      if (answers.modules.length === 0) {
        consola.warn("テンプレートが選択されませんでした");
        return;
      }

      const effectiveStrategy: OverwriteStrategy = args.force
        ? "overwrite"
        : answers.overwriteStrategy;

      // テンプレート取得・適用（結果を収集）
      const templateResults = await fetchTemplates({
        targetDir,
        modules: answers.modules,
        overwriteStrategy: effectiveStrategy,
        moduleList,
        templateDir,
      });

      const allResults: FileOperationResult[] = [...templateResults];

      // devcontainer.env.example を戦略に従って作成
      if (answers.modules.includes("devcontainer")) {
        const envResult = await createEnvExample(targetDir, effectiveStrategy);
        logResult(envResult);
        allResults.push(envResult);
      }

      // 設定ファイル生成（常に更新）
      const configResult = await createDevEnvConfig(targetDir, answers.modules);
      logResult(configResult);
      allResults.push(configResult);

      consola.box("セットアップ完了!");

      // モジュール別の説明を表示
      displayModuleDescriptions(answers.modules, allResults, moduleList);
    } finally {
      cleanup();
    }
  },
});

const ENV_EXAMPLE_CONTENT = `# 環境変数サンプル
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

async function createEnvExample(
  targetDir: string,
  strategy: OverwriteStrategy,
): Promise<FileOperationResult> {
  return writeFileWithStrategy({
    destPath: resolve(targetDir, ".devcontainer/devcontainer.env.example"),
    content: ENV_EXAMPLE_CONTENT,
    strategy,
    relativePath: ".devcontainer/devcontainer.env.example",
  });
}

/**
 * 設定ファイル生成（常に更新 - 特別枠）
 */
async function createDevEnvConfig(
  targetDir: string,
  selectedModules: string[],
): Promise<FileOperationResult> {
  const config = {
    version: "0.1.0",
    installedAt: new Date().toISOString(),
    modules: selectedModules,
    source: {
      owner: "tktcorporation",
      repo: ".github",
    },
  };

  // .devenv.json は常に上書き（設定管理ファイルなので）
  return writeFileWithStrategy({
    destPath: resolve(targetDir, ".devenv.json"),
    content: JSON.stringify(config, null, 2),
    strategy: "overwrite",
    relativePath: ".devenv.json",
  });
}

/**
 * モジュール別の説明を表示
 */
function displayModuleDescriptions(
  selectedModules: string[],
  fileResults: FileOperationResult[],
  moduleList: TemplateModule[],
): void {
  const hasChanges = fileResults.some(
    (r) => r.action === "copied" || r.action === "created" || r.action === "overwritten",
  );

  if (!hasChanges) {
    consola.info("変更はありませんでした");
    return;
  }

  consola.info("追加されたモジュール:");
  for (const moduleId of selectedModules) {
    const mod = getModuleById(moduleId, moduleList);
    if (mod?.setupDescription) {
      consola.info(`  ${mod.name}: ${mod.setupDescription}`);
    }
  }
}
