import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { selectDeletedFiles } from "../ui/prompts";
import { intro, log, outro, pc, withSpinner } from "../ui/renderer";
import { loadConfig, saveConfig } from "../utils/config";
import { resolveLatestCommitSha } from "../utils/github";
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
        // baseRef が存在する場合、ベースバージョンを再ダウンロードして 3-way マージ
        let baseTemplateDir: string | undefined;
        let baseCleanup: (() => void) | undefined;

        if (config.baseRef) {
          try {
            log.info(`Downloading base version (${config.baseRef.slice(0, 7)}...) for merge...`);
            const baseSource = `gh:${config.source.owner}/${config.source.repo}#${config.baseRef}`;
            const baseResult = await downloadTemplateToTemp(targetDir, baseSource);
            baseTemplateDir = baseResult.templateDir;
            baseCleanup = baseResult.cleanup;
          } catch {
            log.warn("Could not download base version. Falling back to 2-way conflict markers.");
          }
        }

        try {
          for (const file of classification.conflicts) {
            const localContent = await readFile(join(targetDir, file), "utf-8");
            const templateContent = await readFile(join(templateDir, file), "utf-8");

            // baseRef のテンプレートからベース内容を読む
            let baseContent: string | undefined;
            if (baseTemplateDir && existsSync(join(baseTemplateDir, file))) {
              baseContent = await readFile(join(baseTemplateDir, file), "utf-8");
            }

            if (baseContent !== undefined) {
              // 3-way マージ（ファイルパスを渡して構造マージを有効化）
              const result = threeWayMerge(baseContent, localContent, templateContent, file);
              await writeFile(join(targetDir, file), result.content, "utf-8");
              if (result.hasConflicts) {
                hasUnresolvedConflicts = true;
                if (result.conflictDetails.length > 0) {
                  // 構造マージ: ファイルは壊れていないがキーレベルのコンフリクトあり
                  log.warn(`Conflict in ${pc.cyan(file)} — review these keys:`);
                  for (const detail of result.conflictDetails) {
                    const pathStr = detail.path.join(".");
                    log.message(`  ${pc.dim("•")} ${pc.yellow(pathStr)} — kept local value`);
                  }
                } else {
                  log.warn(`Conflict in ${pc.cyan(file)} — manual resolution needed`);
                }
              }
            } else {
              // base がない場合も構造マージを試みる（JSON/JSONC の場合）
              // base がないので空オブジェクトを仮の base として使用
              const result = threeWayMerge("", localContent, templateContent, file);
              await writeFile(join(targetDir, file), result.content, "utf-8");
              if (result.hasConflicts) {
                hasUnresolvedConflicts = true;
                if (result.conflictDetails.length > 0) {
                  log.warn(`Conflict in ${pc.cyan(file)} — review these keys:`);
                  for (const detail of result.conflictDetails) {
                    const pathStr = detail.path.join(".");
                    log.message(`  ${pc.dim("•")} ${pc.yellow(pathStr)} — kept local value`);
                  }
                } else {
                  log.warn(`Conflict in ${pc.cyan(file)} — manual resolution needed`);
                }
              }
            }
          }

          if (hasUnresolvedConflicts) {
            log.warn("Some files have conflicts. Please resolve them manually.");
          }
        } finally {
          baseCleanup?.();
        }
      }

      // Step 9: 削除されたファイルを処理
      if (classification.deletedFiles.length > 0) {
        let filesToDelete: string[];

        if (args.force) {
          // --force: 確認なしで全削除
          filesToDelete = classification.deletedFiles;
          log.info(`Deleting ${filesToDelete.length} file(s) removed from template...`);
        } else {
          // 通常: ユーザーに選択させる
          filesToDelete = await selectDeletedFiles(classification.deletedFiles);
        }

        for (const file of filesToDelete) {
          try {
            await rm(join(targetDir, file), { force: true });
            log.success(`Deleted: ${file}`);
          } catch {
            log.warn(`Could not delete: ${file}`);
          }
        }
      }

      // Step 10: 設定を更新（baseRef + baseHashes）
      const latestRef = await resolveLatestCommitSha(config.source.owner, config.source.repo);

      const updatedConfig = {
        ...config,
        baseHashes: templateHashes,
        ...(latestRef ? { baseRef: latestRef } : {}),
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
