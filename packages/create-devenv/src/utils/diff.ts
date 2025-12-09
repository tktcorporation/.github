import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import consola from "consola";
import { join } from "pathe";
import { getModuleById } from "../modules";
import type {
  DevEnvConfig,
  DiffResult,
  DiffType,
  FileDiff,
} from "../modules/schemas";
import { filterByGitignore, loadMergedGitignore } from "./gitignore";
import { getEffectivePatterns, resolvePatterns } from "./patterns";

export interface DiffOptions {
  targetDir: string;
  templateDir: string;
  moduleIds: string[];
  config?: DevEnvConfig;
}

/**
 * ローカルとテンプレート間の差分を検出
 */
export async function detectDiff(options: DiffOptions): Promise<DiffResult> {
  const { targetDir, templateDir, moduleIds, config } = options;

  const files: FileDiff[] = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let unchanged = 0;

  // ローカルとテンプレート両方の .gitignore をマージして読み込み
  // クレデンシャル等の機密情報の誤流出を防止
  const gitignore = await loadMergedGitignore([targetDir, templateDir]);

  for (const moduleId of moduleIds) {
    const mod = getModuleById(moduleId);
    if (!mod) {
      consola.warn(`モジュール "${moduleId}" が見つかりません`);
      continue;
    }

    // 有効なパターンを取得（カスタムパターン考慮）
    const patterns = getEffectivePatterns(moduleId, mod.patterns, config);

    // テンプレート側のファイル一覧を取得し、gitignore でフィルタリング
    const templateFiles = filterByGitignore(
      resolvePatterns(templateDir, patterns),
      gitignore,
    );
    // ローカル側のファイル一覧を取得し、gitignore でフィルタリング
    const localFiles = filterByGitignore(
      resolvePatterns(targetDir, patterns),
      gitignore,
    );

    const allFiles = new Set([...templateFiles, ...localFiles]);

    for (const filePath of allFiles) {
      const localPath = join(targetDir, filePath);
      const templatePath = join(templateDir, filePath);

      const localExists = existsSync(localPath);
      const templateExists = existsSync(templatePath);

      let type: DiffType;
      let localContent: string | undefined;
      let templateContent: string | undefined;

      if (localExists) {
        localContent = await readFile(localPath, "utf-8");
      }
      if (templateExists) {
        templateContent = await readFile(templatePath, "utf-8");
      }

      if (localExists && templateExists) {
        // 両方に存在 → 内容比較
        if (localContent === templateContent) {
          type = "unchanged";
          unchanged++;
        } else {
          type = "modified";
          modified++;
        }
      } else if (localExists && !templateExists) {
        // ローカルのみ → 追加（テンプレートにはない）
        type = "added";
        added++;
      } else {
        // テンプレートのみ → 削除（ローカルにはない）
        type = "deleted";
        deleted++;
      }

      files.push({
        path: filePath,
        type,
        localContent,
        templateContent,
      });
    }
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    summary: { added, modified, deleted, unchanged },
  };
}

/**
 * 差分をフォーマットして表示用文字列を生成
 */
export function formatDiff(diff: DiffResult, verbose = false): string {
  const lines: string[] = [];

  // サマリー
  lines.push("=== 差分サマリー ===");
  lines.push(`  追加: ${diff.summary.added} ファイル`);
  lines.push(`  変更: ${diff.summary.modified} ファイル`);
  lines.push(`  削除: ${diff.summary.deleted} ファイル`);
  lines.push(`  同一: ${diff.summary.unchanged} ファイル`);
  lines.push("");

  // 詳細
  const changedFiles = diff.files.filter((f) => f.type !== "unchanged");
  if (changedFiles.length > 0) {
    lines.push("=== 変更ファイル ===");
    for (const file of changedFiles) {
      const icon = getStatusIcon(file.type);
      lines.push(`  ${icon} ${file.path}`);

      if (verbose && file.type === "modified") {
        lines.push("    (内容が異なります)");
      }
    }
  } else {
    lines.push("変更はありません");
  }

  return lines.join("\n");
}

function getStatusIcon(type: DiffType): string {
  switch (type) {
    case "added":
      return "+";
    case "modified":
      return "~";
    case "deleted":
      return "-";
    case "unchanged":
      return " ";
  }
}

/**
 * push 対象のファイルのみをフィルタリング
 * (ローカルで追加・変更されたファイル)
 */
export function getPushableFiles(diff: DiffResult): FileDiff[] {
  return diff.files.filter((f) => f.type === "added" || f.type === "modified");
}

/**
 * 差分があるかどうかを判定
 */
export function hasDiff(diff: DiffResult): boolean {
  return (
    diff.summary.added > 0 ||
    diff.summary.modified > 0 ||
    diff.summary.deleted > 0
  );
}
