import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { defineCommand } from "citty";
import { downloadTemplate } from "giget";
import { join, resolve } from "pathe";
import { defaultModules, loadModulesFile, modulesFileExists } from "../modules";
import type { DevEnvConfig, TemplateModule } from "../modules/schemas";
import { configSchema } from "../modules/schemas";
import { detectDiff, formatDiff, hasDiff } from "../utils/diff";
import { buildTemplateSource } from "../utils/template";
import { detectUntrackedFiles, getTotalUntrackedCount } from "../utils/untracked";
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
    showHeader("berm diff");

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
      if (modulesFileExists(templateDir)) {
        const loaded = await loadModulesFile(templateDir);
        moduleList = loaded.modules;
      } else {
        moduleList = defaultModules;
      }

      // Step 2: 差分を検出
      step({ current: 2, total: totalSteps }, "Detecting changes...");

      const diff = await withSpinner("Analyzing differences...", () =>
        detectDiff({
          targetDir,
          templateDir,
          moduleIds: config.modules,
          config,
          moduleList,
        }),
      );

      // 未トラックファイルを検出
      const untrackedByFolder = await detectUntrackedFiles({
        targetDir,
        moduleIds: config.modules,
        config,
        moduleList,
      });
      const untrackedCount = getTotalUntrackedCount(untrackedByFolder);

      // 結果表示
      log.newline();

      if (hasDiff(diff)) {
        diffHeader("Changes detected:");
        console.log(formatDiff(diff, args.verbose));

        // 未トラックファイルがあればヒントを表示
        if (untrackedCount > 0) {
          log.newline();
          log.warn(`${untrackedCount} untracked file(s) found outside the sync whitelist:`);
          for (const group of untrackedByFolder) {
            for (const file of group.files) {
              console.log(`  ${pc.dim("•")} ${file.path}`);
            }
          }
          log.newline();
          log.info(
            `To include these files in sync, add them to tracking with the ${pc.cyan("track")} command:`,
          );
          log.dim(`  npx @tktco/berm track "<pattern>"`);
          log.dim(
            `  Example: npx @tktco/berm track "${untrackedByFolder[0]?.files[0]?.path || ".cloud/rules/*.md"}"`,
          );
        }

        log.newline();

        const nextSteps = [
          {
            command: "npx @tktco/berm push",
            description: "Push your local changes to the template repository",
          },
          {
            command: "npx @tktco/berm diff --verbose",
            description: "Show detailed diff output",
          },
        ];
        if (untrackedCount > 0) {
          nextSteps.push({
            command: "npx @tktco/berm track <pattern>",
            description: "Add untracked files to the sync whitelist so they can be pushed",
          });
        }

        showNextSteps(nextSteps);
      } else if (untrackedCount > 0) {
        box("No tracked changes", "success");
        log.info("Your tracked files are in sync with the template.");
        log.newline();
        log.warn(`However, ${untrackedCount} untracked file(s) exist outside the sync whitelist:`);
        for (const group of untrackedByFolder) {
          for (const file of group.files) {
            console.log(`  ${pc.dim("•")} ${file.path}`);
          }
        }
        log.newline();
        log.info(
          `Use ${pc.cyan("npx @tktco/berm track <pattern>")} to add them, then ${pc.cyan("push")} to sync.`,
        );
        log.newline();
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
