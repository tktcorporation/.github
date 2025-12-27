/**
 * Diff Viewer - モダンな diff 表示コンポーネント
 *
 * gitui, lazygit などを参考にした見やすい diff 表示を提供
 */

import pc from "picocolors";
import type { FileDiff } from "../modules/schemas";
import { generateUnifiedDiff } from "./diff";

// ────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface FileWithStats extends FileDiff {
  stats: DiffStats;
}

interface GroupedFiles {
  added: FileWithStats[];
  modified: FileWithStats[];
  deleted: FileWithStats[];
}

// ────────────────────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────────────────────

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  tee: "├",
  cross: "┼",
  horizontalDown: "┬",
  horizontalUp: "┴",
} as const;

const ICONS = {
  added: "✚",
  modified: "⬡",
  deleted: "✖",
  file: "◦",
  tree: {
    branch: "├─",
    last: "└─",
    vertical: "│ ",
  },
} as const;

const DEFAULT_BOX_WIDTH = 60;

// ────────────────────────────────────────────────────────────────
// 統計計算
// ────────────────────────────────────────────────────────────────

/**
 * unified diff から追加・削除行数を計算
 */
export function calculateDiffStats(fileDiff: FileDiff): DiffStats {
  if (fileDiff.type === "unchanged") {
    return { additions: 0, deletions: 0 };
  }

  if (fileDiff.type === "deleted") {
    const lines = (fileDiff.templateContent || "").split("\n").length;
    return { additions: 0, deletions: lines };
  }

  if (fileDiff.type === "added") {
    const lines = (fileDiff.localContent || "").split("\n").length;
    return { additions: lines, deletions: 0 };
  }

  // modified: unified diff をパースして計算
  const diff = generateUnifiedDiff(fileDiff);
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * ファイルリストに統計情報を付与
 */
export function addStatsToFiles(files: FileDiff[]): FileWithStats[] {
  return files.map((file) => ({
    ...file,
    stats: calculateDiffStats(file),
  }));
}

/**
 * ファイルをタイプ別にグループ化
 */
export function groupFilesByType(files: FileWithStats[]): GroupedFiles {
  return {
    added: files.filter((f) => f.type === "added"),
    modified: files.filter((f) => f.type === "modified"),
    deleted: files.filter((f) => f.type === "deleted"),
  };
}

/**
 * 合計統計を計算
 */
export function calculateTotalStats(files: FileWithStats[]): DiffStats {
  return files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.stats.additions,
      deletions: acc.deletions + file.stats.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

// ────────────────────────────────────────────────────────────────
// フォーマット用ヘルパー
// ────────────────────────────────────────────────────────────────

/**
 * 統計をフォーマット (+10 -5 形式)
 */
export function formatStats(stats: DiffStats): string {
  const parts: string[] = [];
  if (stats.additions > 0) {
    parts.push(pc.green(`+${stats.additions}`));
  }
  if (stats.deletions > 0) {
    parts.push(pc.red(`-${stats.deletions}`));
  }
  if (parts.length === 0) {
    return pc.dim("(no changes)");
  }
  return parts.join(" ");
}

/**
 * 統計をライン表記でフォーマット (+10 -5 lines)
 */
export function formatStatsWithLabel(stats: DiffStats): string {
  const parts: string[] = [];
  if (stats.additions > 0) {
    parts.push(pc.green(`+${stats.additions}`));
  }
  if (stats.deletions > 0) {
    parts.push(pc.red(`-${stats.deletions}`));
  }
  if (parts.length === 0) {
    return "";
  }
  return `${parts.join(" ")} lines`;
}

/**
 * ボックスの横線を生成
 */
function horizontalLine(width: number, left: string, right: string): string {
  return pc.dim(left + BOX.horizontal.repeat(width - 2) + right);
}

/**
 * テキストをボックス幅に合わせてパディング
 */
function padLine(text: string, width: number): string {
  // ANSI コードを除去した実際の文字幅を計算
  const plainText = text.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - 4 - plainText.length);
  return `${pc.dim(BOX.vertical)}  ${text}${" ".repeat(padding)}${pc.dim(BOX.vertical)}`;
}

// ────────────────────────────────────────────────────────────────
// サマリーボックス表示
// ────────────────────────────────────────────────────────────────

/**
 * diff サマリーをボックスで表示
 */
export function showDiffSummaryBox(files: FileDiff[]): void {
  const filesWithStats = addStatsToFiles(files);
  const grouped = groupFilesByType(filesWithStats);
  const totalStats = calculateTotalStats(filesWithStats);
  const changedFiles = filesWithStats.filter((f) => f.type !== "unchanged");

  const width = DEFAULT_BOX_WIDTH;

  console.log();
  console.log(horizontalLine(width, BOX.topLeft, BOX.topRight));
  console.log(padLine(pc.bold("📦 Changes to push"), width));
  console.log(horizontalLine(width, BOX.tee, BOX.tee));
  console.log(padLine("", width));

  // Added files
  if (grouped.added.length > 0) {
    const addedStats = calculateTotalStats(grouped.added);
    const header = `${pc.green(ICONS.added)} ${pc.green("added")} (${grouped.added.length} ${grouped.added.length === 1 ? "file" : "files"})`;
    const statsStr = formatStatsWithLabel(addedStats);
    console.log(padLine(`${header}${statsStr ? "  " + pc.dim(statsStr) : ""}`, width));

    for (let i = 0; i < grouped.added.length; i++) {
      const file = grouped.added[i];
      const isLast = i === grouped.added.length - 1;
      const prefix = isLast ? ICONS.tree.last : ICONS.tree.branch;
      const stats = formatStats(file.stats);
      console.log(padLine(`  ${pc.dim(prefix)} ${file.path}  ${stats}`, width));
    }
    console.log(padLine("", width));
  }

  // Modified files
  if (grouped.modified.length > 0) {
    const modifiedStats = calculateTotalStats(grouped.modified);
    const header = `${pc.yellow(ICONS.modified)} ${pc.yellow("modified")} (${grouped.modified.length} ${grouped.modified.length === 1 ? "file" : "files"})`;
    const statsStr = formatStatsWithLabel(modifiedStats);
    console.log(padLine(`${header}${statsStr ? "  " + pc.dim(statsStr) : ""}`, width));

    for (let i = 0; i < grouped.modified.length; i++) {
      const file = grouped.modified[i];
      const isLast = i === grouped.modified.length - 1;
      const prefix = isLast ? ICONS.tree.last : ICONS.tree.branch;
      const stats = formatStats(file.stats);
      console.log(padLine(`  ${pc.dim(prefix)} ${file.path}  ${stats}`, width));
    }
    console.log(padLine("", width));
  }

  // Deleted files
  if (grouped.deleted.length > 0) {
    const deletedStats = calculateTotalStats(grouped.deleted);
    const header = `${pc.red(ICONS.deleted)} ${pc.red("deleted")} (${grouped.deleted.length} ${grouped.deleted.length === 1 ? "file" : "files"})`;
    const statsStr = formatStatsWithLabel(deletedStats);
    console.log(padLine(`${header}${statsStr ? "  " + pc.dim(statsStr) : ""}`, width));

    for (let i = 0; i < grouped.deleted.length; i++) {
      const file = grouped.deleted[i];
      const isLast = i === grouped.deleted.length - 1;
      const prefix = isLast ? ICONS.tree.last : ICONS.tree.branch;
      const stats = formatStats(file.stats);
      console.log(padLine(`  ${pc.dim(prefix)} ${file.path}  ${stats}`, width));
    }
    console.log(padLine("", width));
  }

  // Total
  console.log(horizontalLine(width, BOX.tee, BOX.tee));
  const totalLine = `Total: ${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"}  (${formatStatsWithLabel(totalStats)})`;
  console.log(padLine(totalLine, width));
  console.log(horizontalLine(width, BOX.bottomLeft, BOX.bottomRight));
  console.log();
}

// ────────────────────────────────────────────────────────────────
// 単一ファイル diff ボックス表示
// ────────────────────────────────────────────────────────────────

export interface DiffViewOptions {
  showLineNumbers?: boolean;
  contextLines?: number;
  maxLines?: number;
}

/**
 * 単一ファイルの diff をボックス表示
 */
export function showFileDiffBox(
  file: FileDiff,
  index: number,
  total: number,
  options: DiffViewOptions = {},
): void {
  const { showLineNumbers = true, maxLines } = options;
  const stats = calculateDiffStats(file);
  const width = DEFAULT_BOX_WIDTH;

  // ヘッダー
  console.log();
  console.log(horizontalLine(width, BOX.topLeft, BOX.topRight));

  // ファイル名とタイプ
  const typeIcon = file.type === "added" ? pc.green(ICONS.added) : pc.yellow(ICONS.modified);
  const typeLabel = file.type === "added" ? pc.green("added") : pc.yellow("modified");
  const position = pc.dim(`[${index + 1}/${total}]`);

  console.log(padLine(`${position} ${typeIcon} ${pc.bold(file.path)}`, width));
  console.log(padLine(`${typeLabel}  ${formatStatsWithLabel(stats)}`, width));
  console.log(horizontalLine(width, BOX.tee, BOX.tee));

  // Diff 内容
  const diffContent = generateUnifiedDiff(file);
  const lines = diffContent.split("\n");

  // ヘッダー行（---/+++）をスキップして内容のみ表示
  const contentLines = lines.filter(
    (line) =>
      !line.startsWith("Index:") &&
      !line.startsWith("===") &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  );

  let displayLines = contentLines;
  let truncated = false;

  if (maxLines && contentLines.length > maxLines) {
    displayLines = contentLines.slice(0, maxLines);
    truncated = true;
  }

  let lineNum = 0;
  for (const line of displayLines) {
    let coloredLine: string;
    let linePrefix = "";

    if (line.startsWith("@@")) {
      coloredLine = pc.cyan(line);
      linePrefix = "";
    } else if (line.startsWith("+")) {
      coloredLine = pc.green(line);
      lineNum++;
      linePrefix = showLineNumbers ? pc.dim(`${String(lineNum).padStart(4)} `) : "";
    } else if (line.startsWith("-")) {
      coloredLine = pc.red(line);
      linePrefix = showLineNumbers ? pc.dim("     ") : "";
    } else {
      coloredLine = line;
      lineNum++;
      linePrefix = showLineNumbers ? pc.dim(`${String(lineNum).padStart(4)} `) : "";
    }

    // 行が長すぎる場合は切り詰め
    const plainLine = line.replace(/\x1b\[[0-9;]*m/g, "");
    const maxContentWidth = width - 8 - (showLineNumbers ? 5 : 0);

    if (plainLine.length > maxContentWidth) {
      const truncatedContent = line.slice(0, maxContentWidth - 3) + "...";
      coloredLine = line.startsWith("+")
        ? pc.green(truncatedContent)
        : line.startsWith("-")
          ? pc.red(truncatedContent)
          : truncatedContent;
    }

    console.log(padLine(`${linePrefix}${coloredLine}`, width));
  }

  if (truncated) {
    const remaining = contentLines.length - displayLines.length;
    console.log(padLine(pc.dim(`... ${remaining} more lines`), width));
  }

  // フッター
  console.log(horizontalLine(width, BOX.tee, BOX.tee));
  console.log(padLine(pc.dim("[Enter] Back  [n] Next  [p] Prev  [q] Quit"), width));
  console.log(horizontalLine(width, BOX.bottomLeft, BOX.bottomRight));
  console.log();
}

/**
 * ファイル選択用のラベル生成
 */
export function getFileLabel(file: FileDiff): string {
  const stats = calculateDiffStats(file);
  const icon = file.type === "added" ? pc.green(ICONS.added) : pc.yellow(ICONS.modified);
  return `${icon} ${file.path} (${formatStats(stats)})`;
}
