/**
 * Diff Viewer - モダンな diff 表示コンポーネント
 *
 * gitui, lazygit などを参考にした見やすい diff 表示を提供
 * ts-pattern によるパターンマッチングで堅牢な条件分岐を実現
 *
 * Features:
 * - Word-level diff: 行内の変更箇所をハイライト
 * - Syntax highlighting: ファイル拡張子に応じたシンタックスハイライト
 */

import { highlight, supportsLanguage } from "cli-highlight";
import { diffWords } from "diff";
import { extname } from "pathe";
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
// Word-level diff
// ────────────────────────────────────────────────────────────────

/** Word diff の結果 */
interface WordDiffResult {
  oldLine: string;
  newLine: string;
}

/**
 * 2つの行の word-level diff を計算
 * 変更された単語を背景色でハイライト
 */
function computeWordDiff(oldText: string, newText: string): WordDiffResult {
  const changes = diffWords(oldText, newText);

  let oldLine = "";
  let newLine = "";

  for (const change of changes) {
    if (change.added) {
      // 追加された部分: 緑背景
      newLine += pc.bgGreen(pc.black(change.value));
    } else if (change.removed) {
      // 削除された部分: 赤背景
      oldLine += pc.bgRed(pc.white(change.value));
    } else {
      // 変更なし
      oldLine += change.value;
      newLine += change.value;
    }
  }

  return { oldLine, newLine };
}

/**
 * 隣接する deletion/addition ペアを検出して word diff を適用
 */
interface ProcessedLine {
  content: string;
  lineType: DiffLineType;
  isWordDiff: boolean;
}

function applyWordDiffToLines(lines: string[]): ProcessedLine[] {
  const result: ProcessedLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const lineType = classifyDiffLine(line);

    // deletion の後に addition が続くパターンを検出
    if (lineType === "deletion" && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextType = classifyDiffLine(nextLine);

      if (nextType === "addition") {
        // word diff を適用
        const oldContent = line.slice(1); // - を除去
        const newContent = nextLine.slice(1); // + を除去
        const { oldLine, newLine } = computeWordDiff(oldContent, newContent);

        result.push({
          content: `-${oldLine}`,
          lineType: "deletion",
          isWordDiff: true,
        });
        result.push({
          content: `+${newLine}`,
          lineType: "addition",
          isWordDiff: true,
        });
        i += 2;
        continue;
      }
    }

    result.push({
      content: line,
      lineType,
      isWordDiff: false,
    });
    i++;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────
// Syntax Highlighting
// ────────────────────────────────────────────────────────────────

/** 拡張子から言語を推測 */
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".xml": "xml",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".vue": "vue",
  ".svelte": "xml",
  ".toml": "toml",
  ".ini": "ini",
  ".dockerfile": "dockerfile",
};

/**
 * ファイルパスから言語を推測
 */
function detectLanguage(filePath: string): string | undefined {
  // 特殊なファイル名
  const basename = filePath.split("/").pop() || "";
  if (basename === "Dockerfile") return "dockerfile";
  if (basename === ".gitignore") return "bash";
  if (basename === "Makefile") return "makefile";

  const ext = extname(filePath).toLowerCase();
  const lang = EXT_TO_LANG[ext];

  if (lang && supportsLanguage(lang)) {
    return lang;
  }
  return undefined;
}

/**
 * コードにシンタックスハイライトを適用
 */
function applySyntaxHighlight(code: string, lang: string | undefined): string {
  if (!lang) return code;

  try {
    return highlight(code, { language: lang, ignoreIllegals: true });
  } catch {
    return code;
  }
}

// ────────────────────────────────────────────────────────────────
// 単一ファイル diff ボックス表示
// ────────────────────────────────────────────────────────────────

export interface DiffViewOptions {
  showLineNumbers?: boolean;
  contextLines?: number;
  maxLines?: number;
  wordDiff?: boolean;
  syntaxHighlight?: boolean;
}

/** レンダリングオプション */
interface RenderLineOptions {
  showLineNumbers: boolean;
  width: number;
  lang?: string;
  isWordDiff?: boolean;
}

/**
 * Diff 行をフォーマットしてレンダリング
 */
function renderDiffLine(
  line: string,
  lineType: DiffLineType,
  lineNum: number,
  options: RenderLineOptions,
): { output: string; newLineNum: number } {
  const { showLineNumbers, width, lang, isWordDiff } = options;

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

  // 行の内容を取得（word diff 済みの場合はそのまま使用）
  let displayLine: string;

  if (isWordDiff) {
    // word diff が適用済みの場合、プレフィックス (+/-) の色だけ適用
    const linePrefix = line[0];
    const content = line.slice(1);
    displayLine = match(lineType)
      .with("addition", () => pc.green(linePrefix) + content)
      .with("deletion", () => pc.red(linePrefix) + content)
      .otherwise(() => line);
  } else if (lang && lineType !== "hunk") {
    // シンタックスハイライトを適用
    const linePrefix = line[0];
    const content = line.slice(1);
    const highlighted = applySyntaxHighlight(content, lang);

    displayLine = match(lineType)
      .with("addition", () => pc.green(linePrefix) + highlighted)
      .with("deletion", () => pc.red(linePrefix) + highlighted)
      .with("context", () => linePrefix + highlighted)
      .otherwise(() => line);
  } else {
    // 通常の色付け
    displayLine = colorizeDiffLine(line, lineType);
  }

  // 行が長すぎる場合は切り詰め
  const plainLine = line.replace(ANSI_REGEX, "");
  const maxContentWidth = width - 8 - (showLineNumbers ? 5 : 0);

  if (plainLine.length > maxContentWidth) {
    // 切り詰めが必要な場合は単純な色付けにフォールバック
    displayLine = colorizeDiffLine(line.slice(0, maxContentWidth - 3) + "...", lineType);
  }

  return {
    output: padLine(`${prefix}${displayLine}`, width),
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
  const { showLineNumbers = true, maxLines, wordDiff = true, syntaxHighlight = true } = options;

  const stats = calculateDiffStats(file);
  const style = getTypeStyle(file.type);
  const width = DEFAULT_BOX_WIDTH;

  // 言語を検出
  const lang = syntaxHighlight ? detectLanguage(file.path) : undefined;

  // ヘッダー
  console.log();
  console.log(horizontalLine(width, BOX.topLeft, BOX.topRight));

  const position = pc.dim(`[${index + 1}/${total}]`);
  const langBadge = lang ? pc.dim(` [${lang}]`) : "";
  console.log(
    padLine(`${position} ${style.color(style.icon)} ${pc.bold(file.path)}${langBadge}`, width),
  );
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

  // maxLines で切り詰め（word diff 適用前）
  const limitedLines =
    maxLines && contentLines.length > maxLines ? contentLines.slice(0, maxLines) : contentLines;

  const truncated = maxLines && contentLines.length > maxLines;

  // Word diff を適用
  const processedLines = wordDiff
    ? applyWordDiffToLines(limitedLines)
    : limitedLines.map((line) => ({
        content: line,
        lineType: classifyDiffLine(line),
        isWordDiff: false,
      }));

  let lineNum = 0;
  for (const processed of processedLines) {
    const { output, newLineNum } = renderDiffLine(processed.content, processed.lineType, lineNum, {
      showLineNumbers,
      width,
      lang: processed.isWordDiff ? undefined : lang, // word diff 時はシンタックスハイライトをスキップ
      isWordDiff: processed.isWordDiff,
    });
    console.log(output);
    lineNum = newLineNum;
  }

  if (truncated) {
    const remaining = contentLines.length - limitedLines.length;
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

// ────────────────────────────────────────────────────────────────
// Hunk 表示コンポーネント
// ────────────────────────────────────────────────────────────────

import type { HunkInfo, FileHunks } from "./hunk";

/**
 * 単一のhunkを表示用にフォーマット
 */
export function formatHunkForDisplay(
  hunk: HunkInfo,
  filePath: string,
  totalHunks: number,
): string {
  const lines: string[] = [];
  const width = DEFAULT_BOX_WIDTH;

  // ヘッダー
  lines.push(horizontalLine(width, BOX.topLeft, BOX.topRight));
  const position = pc.dim(`[${hunk.index + 1}/${totalHunks}]`);
  const stats = `${pc.green(`+${hunk.additions}`)} ${pc.red(`-${hunk.deletions}`)}`;
  lines.push(padLine(`${position} ${pc.bold(filePath)}  ${stats}`, width));
  lines.push(padLine(pc.cyan(hunk.header), width));
  lines.push(horizontalLine(width, BOX.tee, BOX.tee));

  // hunkの内容（ヘッダー行を除く）
  const contentLines = hunk.displayText.split("\n").slice(1); // ヘッダーをスキップ
  for (const line of contentLines) {
    const lineType = classifyDiffLine(line);
    const colorized = colorizeDiffLine(line, lineType);
    lines.push(padLine(colorized, width));
  }

  lines.push(horizontalLine(width, BOX.bottomLeft, BOX.bottomRight));

  return lines.join("\n");
}

/**
 * Hunk選択用のラベル生成
 */
export function getHunkLabel(hunk: HunkInfo, filePath: string): string {
  const stats = `${pc.green(`+${hunk.additions}`)} ${pc.red(`-${hunk.deletions}`)}`;
  const preview = getHunkPreview(hunk, 50);
  return `${pc.dim(`[${hunk.index + 1}]`)} ${pc.cyan(hunk.header)} ${stats} ${pc.dim(preview)}`;
}

/**
 * Hunkのプレビューテキストを取得（最初の変更行）
 */
function getHunkPreview(hunk: HunkInfo, maxLength: number): string {
  const lines = hunk.displayText.split("\n");

  // 最初の追加または削除行を探す
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.slice(1).trim();
      if (content.length > maxLength) {
        return `"${content.slice(0, maxLength - 3)}..."`;
      }
      return content ? `"${content}"` : "";
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const content = line.slice(1).trim();
      if (content.length > maxLength) {
        return `"${content.slice(0, maxLength - 3)}..."`;
      }
      return content ? `"${content}"` : "";
    }
  }

  return "";
}

/**
 * ファイルのhunk一覧をサマリー表示
 */
export function showFileHunksSummary(fileHunks: FileHunks): void {
  const width = DEFAULT_BOX_WIDTH;

  console.log();
  console.log(horizontalLine(width, BOX.topLeft, BOX.topRight));

  const style = getTypeStyle(fileHunks.type);
  console.log(padLine(`${style.color(style.icon)} ${pc.bold(fileHunks.path)}`, width));
  console.log(padLine(`${fileHunks.hunks.length} chunks available for selection`, width));
  console.log(horizontalLine(width, BOX.tee, BOX.tee));

  for (const hunk of fileHunks.hunks) {
    const stats = `${pc.green(`+${hunk.additions}`)} ${pc.red(`-${hunk.deletions}`)}`;
    const prefix = hunk.index === fileHunks.hunks.length - 1 ? TREE.last : TREE.branch;
    console.log(padLine(`  ${pc.dim(prefix)} ${pc.cyan(hunk.header)} ${stats}`, width));
  }

  console.log(horizontalLine(width, BOX.bottomLeft, BOX.bottomRight));
  console.log();
}
