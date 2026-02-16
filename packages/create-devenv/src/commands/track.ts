import { defineCommand } from "citty";
import { resolve } from "pathe";
import {
  addPatternToModulesFileWithCreate,
  loadModulesFile,
  modulesFileExists,
  saveModulesFile,
} from "../modules";
import { getModuleIdFromPath } from "../utils/untracked";
import { box, log, pc, showHeader } from "../utils/ui";

/**
 * パターン文字列からモジュール ID を推定
 * 例: ".cloud/rules/*.md" → ".cloud"
 *     ".mcp.json" → "."
 *     ".github/workflows/ci.yml" → ".github"
 */
function inferModuleId(pattern: string): string {
  // glob のメタ文字を除いた先頭パスからモジュール ID を推定
  const cleanPath = pattern.replace(/\*.*$/, "").replace(/\{.*$/, "");
  return getModuleIdFromPath(cleanPath || pattern);
}

export const trackCommand = defineCommand({
  meta: {
    name: "track",
    description: "Add file patterns to the tracking whitelist in modules.jsonc",
  },
  args: {
    patterns: {
      type: "positional",
      description: "File paths or glob patterns to track (e.g., .cloud/rules/*.md)",
      required: true,
    },
    dir: {
      type: "string",
      alias: "d",
      description: "Project directory (default: current directory)",
      default: ".",
    },
    module: {
      type: "string",
      alias: "m",
      description: "Module ID to add patterns to (auto-detected from path if omitted)",
    },
    name: {
      type: "string",
      description: "Module name (used when creating a new module)",
    },
    description: {
      type: "string",
      description: "Module description (used when creating a new module)",
    },
    list: {
      type: "boolean",
      alias: "l",
      description: "List all currently tracked modules and patterns",
      default: false,
    },
  },
  async run({ args }) {
    showHeader("create-devenv track");

    const targetDir = resolve(args.dir);

    // modules.jsonc の存在確認
    if (!modulesFileExists(targetDir)) {
      log.error(".devenv/modules.jsonc not found.");
      log.dim("Run 'create-devenv init' first to set up the project.");
      process.exit(1);
    }

    // --list モード: 現在の追跡パターンを表示
    if (args.list) {
      const { modules } = await loadModulesFile(targetDir);
      log.newline();
      log.info(pc.bold("Tracked modules and patterns:"));
      log.newline();
      for (const mod of modules) {
        console.log(`  ${pc.cyan(mod.id)} ${pc.dim(`(${mod.name})`)}`);
        if (mod.description) {
          console.log(`    ${pc.dim(mod.description)}`);
        }
        for (const pattern of mod.patterns) {
          console.log(`    ${pc.dim("→")} ${pattern}`);
        }
        log.newline();
      }
      return;
    }

    // パターン引数のパース（citty は positional を単一の文字列として渡す）
    // process.argv から track 以降の positional 引数を収集
    const rawArgs = process.argv.slice(2);
    const trackIdx = rawArgs.indexOf("track");
    const argsAfterTrack = trackIdx !== -1 ? rawArgs.slice(trackIdx + 1) : rawArgs;

    // フラグ以外の引数をパターンとして収集
    const patterns: string[] = [];
    let i = 0;
    while (i < argsAfterTrack.length) {
      const arg = argsAfterTrack[i];
      if (arg === "--list" || arg === "-l" || arg === "--help" || arg === "-h") {
        i++;
        continue;
      }
      // 値付きフラグをスキップ
      if (
        arg === "--dir" ||
        arg === "-d" ||
        arg === "--module" ||
        arg === "-m" ||
        arg === "--name" ||
        arg === "--description"
      ) {
        i += 2; // フラグ + 値
        continue;
      }
      // フラグ以外の引数はパターン
      if (!arg.startsWith("-")) {
        patterns.push(arg);
      }
      i++;
    }

    if (patterns.length === 0) {
      log.error("No patterns specified.");
      log.dim("Usage: create-devenv track <patterns...> [--module <id>]");
      log.dim("Example: create-devenv track '.cloud/rules/*.md' '.cloud/config.json'");
      process.exit(1);
    }

    // モジュール ID の決定
    const moduleId = args.module || inferModuleId(patterns[0]);

    // modules.jsonc を読み込み
    const { rawContent } = await loadModulesFile(targetDir);

    // パターンを追加（モジュールがなければ作成）
    const updatedContent = addPatternToModulesFileWithCreate(rawContent, moduleId, patterns, {
      name: args.name,
      description: args.description,
    });

    if (updatedContent === rawContent) {
      log.newline();
      log.info("All patterns are already tracked. No changes needed.");
      return;
    }

    // 保存
    await saveModulesFile(targetDir, updatedContent);

    // 結果表示
    log.newline();
    box("Patterns added!", "success");
    log.newline();

    console.log(`  ${pc.bold("Module:")} ${pc.cyan(moduleId)}`);
    console.log(`  ${pc.bold("Added:")}`);
    for (const pattern of patterns) {
      console.log(`    ${pc.green("+")} ${pattern}`);
    }
    log.newline();
    log.dim(`Updated .devenv/modules.jsonc`);
    log.newline();
  },
});
