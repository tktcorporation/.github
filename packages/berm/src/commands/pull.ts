import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { dirname, join, resolve } from "pathe";
import { BermError } from "../errors";
import {
  defaultModules,
  getPatternsByModuleIds,
  loadModulesFile,
  modulesFileExists,
} from "../modules";
import type { TemplateModule } from "../modules/schemas";
import { intro, log, outro, pc, withSpinner } from "../ui/renderer";
import { loadConfig, saveConfig } from "../utils/config";
import { hashFiles } from "../utils/hash";
import { classifyFiles, threeWayMerge } from "../utils/merge";
import { downloadTemplateToTemp } from "../utils/template";
import { getEffectivePatterns } from "../utils/patterns";

/**
 * テンプレートの最新更新をローカルに反映するコマンド。
 *
 * 背景: init 後にテンプレートが更新された場合、ローカルの変更を保持しつつ
 * テンプレートの変更を取り込むために使用する。base/local/template の
 * 3-way マージにより、コンフリクトを最小限に抑える。
 *
 * 呼び出し元: CLI から `berm pull` で実行
 */
export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Pull latest template updates",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      default: ".",
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Skip confirmations",
      default: false,
    },
  },
  async run({ args }) {
    intro("pull");

    const targetDir = resolve(args.dir);

    // Step 1: 設定読み込み
    let config;
    try {
      config = await loadConfig(targetDir);
    } catch {
      throw new BermError("Not initialized", "Run `berm init` first");
    }

    if (config.modules.length === 0) {
      log.warn("No modules installed");
      return;
    }

    // Step 2: テンプレートをダウンロード
    log.step("Fetching template...");

    const { templateDir, cleanup } = await withSpinner("Downloading template from GitHub...", () =>
      downloadTemplateToTemp(targetDir, `gh:${config.source.owner}/${config.source.repo}`),
    );

    try {
      // modules.jsonc を読み込み
      let moduleList: TemplateModule[];
      if (modulesFileExists(templateDir)) {
        const loaded = await loadModulesFile(templateDir);
        moduleList = loaded.modules;
      } else {
        moduleList = defaultModules;
      }

      // Step 3: ハッシュ計算
      log.step("Analyzing changes...");

      // インストール済みモジュールの有効パターンを取得
      const patterns = getInstalledModulePatterns(config.modules, moduleList, config);

      const [templateHashes, localHashes] = await Promise.all([
        hashFiles(templateDir, patterns),
        hashFiles(targetDir, patterns),
      ]);
      const baseHashes = config.baseHashes ?? {};

      // Step 4: ファイル分類
      const classification = classifyFiles({ baseHashes, localHashes, templateHashes });

      // Step 5: サマリー表示
      const totalChanges =
        classification.autoUpdate.length +
        classification.newFiles.length +
        classification.conflicts.length +
        classification.deletedFiles.length;

      if (totalChanges === 0) {
        log.success("Already up to date");
        outro("No changes needed");
        return;
      }

      logPullSummary(classification);

      // Step 6: 自動更新ファイルを適用
      for (const file of classification.autoUpdate) {
        const content = await readFile(join(templateDir, file), "utf-8");
        const destPath = join(targetDir, file);
        const destDir = dirname(destPath);
        if (!existsSync(destDir)) {
          await mkdir(destDir, { recursive: true });
        }
        await writeFile(destPath, content, "utf-8");
      }
      if (classification.autoUpdate.length > 0) {
        log.success(`Updated ${classification.autoUpdate.length} file(s)`);
      }

      // Step 7: 新規ファイルを追加
      for (const file of classification.newFiles) {
        const content = await readFile(join(templateDir, file), "utf-8");
        const destPath = join(targetDir, file);
        const destDir = dirname(destPath);
        if (!existsSync(destDir)) {
          await mkdir(destDir, { recursive: true });
        }
        await writeFile(destPath, content, "utf-8");
      }
      if (classification.newFiles.length > 0) {
        log.success(`Added ${classification.newFiles.length} new file(s)`);
      }

      // Step 8: コンフリクト解決
      let hasUnresolvedConflicts = false;
      if (classification.conflicts.length > 0) {
        for (const file of classification.conflicts) {
          const localContent = await readFile(join(targetDir, file), "utf-8");
          const templateContent = await readFile(join(templateDir, file), "utf-8");

          const baseContent = baseHashes[file]
            ? await readBaseContent(file, baseHashes, targetDir, config)
            : undefined;

          if (baseContent !== undefined) {
            // 3-way マージ
            const result = threeWayMerge(baseContent, localContent, templateContent);
            await writeFile(join(targetDir, file), result.content, "utf-8");
            if (result.hasConflicts) {
              hasUnresolvedConflicts = true;
              log.warn(`Conflict in ${pc.cyan(file)} — manual resolution needed`);
            }
          } else {
            // base がない場合は 2-way コンフリクトマーカー
            const content = `<<<<<<< LOCAL\n${localContent}\n=======\n${templateContent}\n>>>>>>> TEMPLATE`;
            await writeFile(join(targetDir, file), content, "utf-8");
            hasUnresolvedConflicts = true;
            log.warn(`Conflict in ${pc.cyan(file)} — manual resolution needed`);
          }
        }

        if (hasUnresolvedConflicts) {
          log.warn("Some files have conflicts. Please resolve them manually.");
        }
      }

      // Step 9: 削除されたファイルの警告
      if (classification.deletedFiles.length > 0 && !args.force) {
        log.warn(`${classification.deletedFiles.length} file(s) were deleted in template:`);
        for (const file of classification.deletedFiles) {
          log.message(`  ${pc.dim("-")} ${file}`);
        }
      }

      // Step 10: 設定を更新（baseHashes を新しいテンプレートのハッシュに更新）
      const updatedConfig = {
        ...config,
        baseHashes: templateHashes,
      };
      await saveConfig(targetDir, updatedConfig);

      outro("Pull complete");
    } finally {
      cleanup();
    }
  },
});

/**
 * インストール済みモジュールの有効パターンを全て取得する。
 *
 * 背景: pull 時にハッシュ計算対象のファイルを特定するため、
 * 各モジュールの patterns に excludePatterns を適用した結果を集約する。
 */
function getInstalledModulePatterns(
  moduleIds: string[],
  moduleList: TemplateModule[],
  config: { excludePatterns?: string[] },
): string[] {
  const patterns: string[] = [];
  for (const moduleId of moduleIds) {
    const mod = moduleList.find((m) => m.id === moduleId);
    if (!mod) continue;
    patterns.push(...getEffectivePatterns(moduleId, mod.patterns, config as any));
  }
  return patterns;
}

/**
 * base の内容を取得する。
 *
 * 背景: 3-way マージには base（前回 pull/init 時点の内容）が必要。
 * baseRef がある場合はそのリビジョンのテンプレートをダウンロードして取得するが、
 * 現状は base のファイル内容自体を保持していないため、
 * ローカルファイルと baseHash の比較で base として使えるかを判定する。
 * ローカルが base から変更されていない場合はローカルの内容を base として使用する。
 */
async function readBaseContent(
  _file: string,
  _baseHashes: Record<string, string>,
  _targetDir: string,
  _config: { baseRef?: string },
): Promise<string | undefined> {
  // base のファイル内容は保持していないため undefined を返す。
  // 将来的に baseRef を使ったテンプレートダウンロードで取得可能。
  return undefined;
}

/**
 * pull のサマリーを表示する。
 *
 * 背景: ユーザーが pull の影響範囲を把握できるよう、
 * 分類結果を色分けして一覧表示する。diff.ts の表示スタイルに合わせる。
 */
function logPullSummary(classification: {
  autoUpdate: string[];
  newFiles: string[];
  conflicts: string[];
  deletedFiles: string[];
  localOnly: string[];
  unchanged: string[];
}): void {
  const lines: string[] = [];

  for (const file of classification.autoUpdate) {
    lines.push(`${pc.cyan("↓")} ${pc.cyan(file)}`);
  }
  for (const file of classification.newFiles) {
    lines.push(`${pc.green("+")} ${pc.green(file)}`);
  }
  for (const file of classification.conflicts) {
    lines.push(`${pc.yellow("!")} ${pc.yellow(file)}`);
  }
  for (const file of classification.deletedFiles) {
    lines.push(`${pc.red("-")} ${pc.red(file)}`);
  }

  const summaryParts = [
    classification.autoUpdate.length > 0
      ? pc.cyan(`↓${classification.autoUpdate.length} updated`)
      : null,
    classification.newFiles.length > 0 ? pc.green(`+${classification.newFiles.length} new`) : null,
    classification.conflicts.length > 0
      ? pc.yellow(`!${classification.conflicts.length} conflicts`)
      : null,
    classification.deletedFiles.length > 0
      ? pc.red(`-${classification.deletedFiles.length} deleted`)
      : null,
  ]
    .filter(Boolean)
    .join(pc.dim(" | "));

  log.message([...lines, "", summaryParts].join("\n"));
}
