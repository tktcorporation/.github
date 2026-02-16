import { existsSync, mkdirSync } from "node:fs";
import { defineCommand } from "citty";
import { join, resolve } from "pathe";
import {
  defaultModules,
  getModuleById,
  getModulesFilePath,
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
  copyFile,
  downloadTemplateToTemp,
  fetchTemplates,
  writeFileWithStrategy,
} from "../utils/template";
import {
  box,
  calculateSummary,
  log,
  logFileResult,
  pc,
  showHeader,
  showNextSteps,
  showSummary,
  step,
  withSpinner,
} from "../utils/ui";

// ビルド時に置換される定数
declare const __VERSION__: string;
const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

export const initCommand = defineCommand({
  meta: {
    name: "create-devenv",
    version,
    description: "Apply dev environment template to your project",
  },
  args: {
    dir: {
      type: "positional",
      description: "Target directory",
      default: ".",
    },
    force: {
      type: "boolean",
      description: "Overwrite existing files",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Select all modules (non-interactive mode)",
      default: false,
    },
  },
  async run({ args }) {
    // ヘッダー表示
    showHeader("create-devenv", version);

    // "init" という引数は無視して現在のディレクトリを使用
    const dir = args.dir === "init" ? "." : args.dir;
    const targetDir = resolve(dir);

    log.info(`Target: ${pc.cyan(targetDir)}`);
    log.newline();

    // ディレクトリ作成
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      log.dim(`Created directory: ${targetDir}`);
    }

    const totalSteps = 3;

    // Step 1: テンプレートをダウンロード
    step({ current: 1, total: totalSteps }, "Fetching template...");

    const { templateDir, cleanup } = await withSpinner("Downloading template from GitHub...", () =>
      downloadTemplateToTemp(targetDir),
    );

    try {
      // modules.jsonc からモジュールを読み込み
      let moduleList: TemplateModule[];
      if (modulesFileExists(templateDir)) {
        const { modules: loadedModules } = await loadModulesFile(templateDir);
        moduleList = loadedModules;
      } else {
        moduleList = defaultModules;
      }

      // Step 2: モジュール選択
      step({ current: 2, total: totalSteps }, "Selecting modules...");
      log.newline();

      let answers: Answers;
      if (args.yes) {
        answers = {
          modules: moduleList.map((m) => m.id),
          overwriteStrategy: "overwrite",
        };
        log.info(`Auto-selected ${pc.cyan(moduleList.length.toString())} modules`);
      } else {
        answers = await promptInit(moduleList);
      }

      if (answers.modules.length === 0) {
        log.warn("No modules selected");
        return;
      }

      log.newline();

      // Step 3: ファイルをコピー
      step({ current: 3, total: totalSteps }, "Applying templates...");
      log.newline();

      const effectiveStrategy: OverwriteStrategy = args.force
        ? "overwrite"
        : answers.overwriteStrategy;

      // テンプレート取得・適用（サイレントモード - 後でまとめて表示）
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
        allResults.push(envResult);
      }

      // modules.jsonc をテンプレートからコピー（track コマンドが必要とする）
      const modulesJsoncResult = await copyModulesJsonc(templateDir, targetDir, effectiveStrategy);
      allResults.push(modulesJsoncResult);

      // 設定ファイル生成（常に更新）
      const configResult = await createDevEnvConfig(targetDir, answers.modules);
      allResults.push(configResult);

      // ファイル操作結果を表示
      for (const result of allResults) {
        logFileResult(result);
      }

      // サマリー表示
      const summary = calculateSummary(allResults);
      showSummary(summary);

      // 変更がない場合
      if (summary.added === 0 && summary.updated === 0) {
        log.info("No changes were made");
        return;
      }

      // 成功メッセージ
      box("Setup complete!", "success");

      // モジュール別の説明を表示
      displayModuleDescriptions(answers.modules, allResults, moduleList);

      // 次のステップ
      showNextSteps([
        {
          command: "git add . && git commit -m 'chore: add devenv config'",
          description: "Commit the changes",
        },
        {
          command: "npx @tktco/create-devenv diff",
          description: "Check for updates from upstream",
        },
      ]);
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
 * テンプレートから modules.jsonc をコピー
 */
async function copyModulesJsonc(
  templateDir: string,
  targetDir: string,
  strategy: OverwriteStrategy,
): Promise<FileOperationResult> {
  const modulesRelPath = ".devenv/modules.jsonc";
  const srcPath = join(templateDir, modulesRelPath);
  const destPath = getModulesFilePath(targetDir);

  if (!existsSync(srcPath)) {
    return { action: "skipped", path: modulesRelPath };
  }

  return copyFile(srcPath, destPath, strategy, modulesRelPath);
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
    return;
  }

  log.info(pc.bold("Installed modules:"));
  log.newline();

  for (const moduleId of selectedModules) {
    const mod = getModuleById(moduleId, moduleList);
    if (mod) {
      const description = mod.setupDescription || mod.description;
      console.log(`  ${pc.cyan("◆")} ${pc.bold(mod.name)}`);
      if (description) {
        console.log(`    ${pc.dim(description)}`);
      }
    }
  }
}
