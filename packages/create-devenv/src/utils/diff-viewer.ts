/**
 * Diff Viewer - モダンな diff 表示コンポーネント
 *
 * gitui, lazygit などを参考にした見やすい diff 表示を提供
 * ts-pattern によるパターンマッチングで堅牢な条件分岐を実現
 */

import pc from "picocolors";
import { match, P } from "ts-pattern";
import type { DiffType, FileDiff } from "../modules/schemas";
import { generateUnifiedDiff } from "./diff";

// ────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────

export interface DiffStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface FileWithStats extends FileDiff {
  readonly stats: DiffStats;
}

interface GroupedFiles {
  readonly added: FileWithStats[];
  readonly modified: FileWithStats[];
  readonly deleted: FileWithStats[];
}

/** Diff 行のタイプ */
type DiffLineType = "hunk" | "addition" | "deletion" | "context";

/** スタイル設定 */
interface TypeStyle {
  readonly icon: string;
  readonly color: (s: string) => string;
  readonly label: string;
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
} as const;

const TREE = {
  branch: "├─",
  last: "└─",
} as const;

const DEFAULT_BOX_WIDTH = 60;

// ANSI エスケープコードを除去する正規表現
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

// ────────────────────────────────────────────────────────────────
// パターンマッチング用ヘルパー
// ────────────────────────────────────────────────────────────────

/**
 * DiffType に対応するスタイルを取得
 */
const getTypeStyle = (type: DiffType): TypeStyle =>
  match(type)
    .with("added", () => ({
      icon: "✚",
      color: pc.green,
      label: "added",
    }))
    .with("modified", () => ({
      icon: "⬡",
      color: pc.yellow,
      label: "modified",
    }))
    .with("deleted", () => ({
      icon: "✖",
      color: pc.red,
      label: "deleted",
    }))
    .with("unchanged", () => ({
      icon: " ",
      color: pc.dim,
      label: "unchanged",
    }))
    .exhaustive();

/**
 * Diff 行のタイプを判定
 */
const classifyDiffLine = (line: string): DiffLineType =>
  match(line)
    .when(
      (l) => l.startsWith("@@"),
      () => "hunk" as const,
    )
    .when(
      (l) => l.startsWith("+") && !l.startsWith("+++"),
      () => "addition" as const,
    )
    .when(
      (l) => l.startsWith("-") && !l.startsWith("---"),
      () => "deletion" as const,
    )
    .otherwise(() => "context" as const);

/**
 * Diff 行に色を適用
 */
const colorizeDiffLine = (line: string, lineType: DiffLineType): string =>
  match(lineType)
    .with("hunk", () => pc.cyan(line))
    .with("addition", () => pc.green(line))
    .with("deletion", () => pc.red(line))
    .with("context", () => line)
    .exhaustive();

// ────────────────────────────────────────────────────────────────
// 統計計算
// ────────────────────────────────────────────────────────────────

/**
 * ファイルの行数を安全に計算
 */
const countLines = (content: string | undefined): number =>
  content ? content.split("\n").length : 0;

/**
 * unified diff から追加・削除行数を計算
 */
export function calculateDiffStats(fileDiff: FileDiff): DiffStats {
  return match(fileDiff)
    .with({ type: "unchanged" }, () => ({ additions: 0, deletions: 0 }))
    .with({ type: "deleted" }, (f) => ({
      additions: 0,
      deletions: countLines(f.templateContent),
    }))
    .with({ type: "added" }, (f) => ({
      additions: countLines(f.localContent),
      deletions: 0,
    }))
    .with({ type: "modified" }, (f) => {
      const diff = generateUnifiedDiff(f);
      let additions = 0;
      let deletions = 0;

      for (const line of diff.split("\n")) {
        match(classifyDiffLine(line))
          .with("addition", () => additions++)
          .with("deletion", () => deletions++)
          .otherwise(() => {});
      }

      return { additions, deletions };
    })
    .exhaustive();
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

  match(stats)
    .with({ additions: P.when((n) => n > 0) }, (s) => {
      parts.push(pc.green(`+${s.additions}`));
    })
    .otherwise(() => {});

  match(stats)
    .with({ deletions: P.when((n) => n > 0) }, (s) => {
      parts.push(pc.red(`-${s.deletions}`));
    })
    .otherwise(() => {});

  return parts.length === 0 ? pc.dim("(no changes)") : parts.join(" ");
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

  return parts.length === 0 ? "" : `${parts.join(" ")} lines`;
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
  const plainText = text.replace(ANSI_REGEX, "");
  const padding = Math.max(0, width - 4 - plainText.length);
  return `${pc.dim(BOX.vertical)}  ${text}${" ".repeat(padding)}${pc.dim(BOX.vertical)}`;
}

/**
 * 単数/複数形を返す
 */
const pluralize = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

// ────────────────────────────────────────────────────────────────
// ファイルグループ表示
// ────────────────────────────────────────────────────────────────

/**
 * ファイルグループをレンダリング
 */
function renderFileGroup(files: FileWithStats[], type: DiffType, width: number): void {
  if (files.length === 0) return;

  const style = getTypeStyle(type);
  const groupStats = calculateTotalStats(files);
  const fileWord = pluralize(files.length, "file", "files");
  const statsStr = formatStatsWithLabel(groupStats);

  const header = `${style.color(style.icon)} ${style.color(style.label)} (${files.length} ${fileWord})`;
  console.log(padLine(`${header}${statsStr ? "  " + pc.dim(statsStr) : ""}`, width));

  files.forEach((file, i) => {
    const isLast = i === files.length - 1;
    const prefix = isLast ? TREE.last : TREE.branch;
    const stats = formatStats(file.stats);
    console.log(padLine(`  ${pc.dim(prefix)} ${file.path}  ${stats}`, width));
  });

  console.log(padLine("", width));
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

  // 各タイプをレンダリング
  renderFileGroup(grouped.added, "added", width);
  renderFileGroup(grouped.modified, "modified", width);
  renderFileGroup(grouped.deleted, "deleted", width);

  // Total
  console.log(horizontalLine(width, BOX.tee, BOX.tee));
  const fileWord = pluralize(changedFiles.length, "file", "files");
  const totalLine = `Total: ${changedFiles.length} ${fileWord}  (${formatStatsWithLabel(totalStats)})`;
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
 * Diff 行をフォーマットしてレンダリング
 */
function renderDiffLine(
  line: string,
  lineType: DiffLineType,
  lineNum: number,
  showLineNumbers: boolean,
  width: number,
): { output: string; newLineNum: number } {
  const coloredLine = colorizeDiffLine(line, lineType);

  // 行番号プレフィックスを決定
  const { prefix, nextLineNum } = match(lineType)
    .with("hunk", () => ({
      prefix: "",
      nextLineNum: lineNum,
    }))
    .with("addition", () => ({
      prefix: showLineNumbers ? pc.dim(`${String(lineNum + 1).padStart(4)} `) : "",
      nextLineNum: lineNum + 1,
    }))
    .with("deletion", () => ({
      prefix: showLineNumbers ? pc.dim("     ") : "",
      nextLineNum: lineNum,
    }))
    .with("context", () => ({
      prefix: showLineNumbers ? pc.dim(`${String(lineNum + 1).padStart(4)} `) : "",
      nextLineNum: lineNum + 1,
    }))
    .exhaustive();

  // 行が長すぎる場合は切り詰め
  const plainLine = line.replace(ANSI_REGEX, "");
  const maxContentWidth = width - 8 - (showLineNumbers ? 5 : 0);

  const finalLine =
    plainLine.length > maxContentWidth
      ? colorizeDiffLine(line.slice(0, maxContentWidth - 3) + "...", lineType)
      : coloredLine;

  return {
    output: padLine(`${prefix}${finalLine}`, width),
    newLineNum: nextLineNum,
  };
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
  const style = getTypeStyle(file.type);
  const width = DEFAULT_BOX_WIDTH;

  // ヘッダー
  console.log();
  console.log(horizontalLine(width, BOX.topLeft, BOX.topRight));

  const position = pc.dim(`[${index + 1}/${total}]`);
  console.log(padLine(`${position} ${style.color(style.icon)} ${pc.bold(file.path)}`, width));
  console.log(padLine(`${style.color(style.label)}  ${formatStatsWithLabel(stats)}`, width));
  console.log(horizontalLine(width, BOX.tee, BOX.tee));

  // Diff 内容
  const diffContent = generateUnifiedDiff(file);
  const lines = diffContent.split("\n");

  // ヘッダー行をフィルタ
  const isHeaderLine = (line: string): boolean =>
    line.startsWith("Index:") ||
    line.startsWith("===") ||
    line.startsWith("---") ||
    line.startsWith("+++");

  const contentLines = lines.filter((line) => !isHeaderLine(line));

  const displayLines =
    maxLines && contentLines.length > maxLines ? contentLines.slice(0, maxLines) : contentLines;

  const truncated = maxLines && contentLines.length > maxLines;

  let lineNum = 0;
  for (const line of displayLines) {
    const lineType = classifyDiffLine(line);
    const { output, newLineNum } = renderDiffLine(line, lineType, lineNum, showLineNumbers, width);
    console.log(output);
    lineNum = newLineNum;
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
  const style = getTypeStyle(file.type);
  return `${style.color(style.icon)} ${file.path} (${formatStats(stats)})`;
}
