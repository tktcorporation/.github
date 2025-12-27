import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import { downloadTemplate } from "giget";
import { join, resolve } from "pathe";
import type { DevEnvConfig } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import { detectDiff, formatDiff, hasDiff } from "../utils/diff";
import { box, diffHeader, log, showHeader, showNextSteps, step, withSpinner } from "../utils/ui";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

export const diffCommand = defineCommand({
  meta: {
    name: "diff",
    description: "Show differences between local and template",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      default: ".",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Show detailed diff",
      default: false,
    },
  },
  async run({ args }) {
    showHeader("create-devenv diff");

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

    const totalSteps = 2;

    // Step 1: テンプレートをダウンロード
    step({ current: 1, total: totalSteps }, "Fetching template...");

    // テンプレートを一時ディレクトリにダウンロード
    const tempDir = join(targetDir, ".devenv-temp");

    try {
      const { dir: templateDir } = await withSpinner("Downloading template from GitHub...", () =>
        downloadTemplate(TEMPLATE_SOURCE, {
          dir: tempDir,
          force: true,
        }),
      );

      // Step 2: 差分を検出
      step({ current: 2, total: totalSteps }, "Detecting changes...");

      const diff = await withSpinner("Analyzing differences...", () =>
        detectDiff({
          targetDir,
          templateDir,
          moduleIds: config.modules,
          config,
        }),
      );

      // 結果表示
      log.newline();

      if (hasDiff(diff)) {
        diffHeader("Changes detected:");
        console.log(formatDiff(diff, args.verbose));
        log.newline();

        showNextSteps([
          {
            command: "npx @tktco/create-devenv push",
            description: "Push your local changes to the template repository",
          },
          {
            command: "npx @tktco/create-devenv diff --verbose",
            description: "Show detailed diff output",
          },
        ]);
      } else {
        box("No changes", "success");
        log.info("Your local files are in sync with the template");
        log.newline();
      }
    } finally {
      // 一時ディレクトリを削除
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});
