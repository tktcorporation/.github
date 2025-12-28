/**
 * Hunk utilities - chunk単位でのdiff操作を提供
 *
 * git add -p のような選択的マージ機能を実現するための
 * hunkパース・適用ユーティリティ
 */

import { applyPatch, parsePatch, type Hunk, type ParsedDiff } from "diff";
import type { FileDiff } from "../modules/schemas";

// ────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────

/** 単一のhunkとそのメタデータ */
export interface HunkInfo {
  /** hunkのインデックス（0始まり） */
  index: number;
  /** diffパッケージのHunkオブジェクト */
  hunk: Hunk;
  /** 変更の追加行数 */
  additions: number;
  /** 変更の削除行数 */
  deletions: number;
  /** hunkの表示用テキスト（ヘッダー + 行） */
  displayText: string;
  /** hunkヘッダー (@@ -x,y +a,b @@) */
  header: string;
}

/** ファイルごとのhunk情報 */
export interface FileHunks {
  /** ファイルパス */
  path: string;
  /** ファイルのdiffタイプ */
  type: FileDiff["type"];
  /** このファイルのhunk一覧 */
  hunks: HunkInfo[];
  /** テンプレートの元コンテンツ */
  templateContent: string | undefined;
  /** ローカルのコンテンツ */
  localContent: string | undefined;
}

/** hunk選択結果 */
export interface HunkSelection {
  /** ファイルパス */
  path: string;
  /** 選択されたhunkのインデックス */
  selectedHunkIndices: number[];
  /** マージ後のコンテンツ */
  mergedContent: string;
}

// ────────────────────────────────────────────────────────────────
// Hunkパース
// ────────────────────────────────────────────────────────────────

/**
 * FileDiffからhunk情報を抽出
 */
export function parseFileHunks(fileDiff: FileDiff): FileHunks {
  const { path, type, localContent, templateContent } = fileDiff;

  // added/deletedの場合はhunk分割しない（ファイル全体が1つのhunk）
  if (type === "added" || type === "deleted" || type === "unchanged") {
    return {
      path,
      type,
      hunks: [],
      templateContent,
      localContent,
    };
  }

  // modifiedの場合のみhunk分割
  const patch = createUnifiedPatch(path, templateContent || "", localContent || "");
  const parsed = parsePatch(patch);

  if (parsed.length === 0 || !parsed[0].hunks) {
    return {
      path,
      type,
      hunks: [],
      templateContent,
      localContent,
    };
  }

  const hunks = parsed[0].hunks.map((hunk, index) => {
    const { additions, deletions } = countHunkChanges(hunk);
    const header = formatHunkHeader(hunk);
    const displayText = formatHunkDisplay(hunk);

    return {
      index,
      hunk,
      additions,
      deletions,
      displayText,
      header,
    };
  });

  return {
    path,
    type,
    hunks,
    templateContent,
    localContent,
  };
}

/**
 * 複数のFileDiffからFileHunksのリストを生成
 */
export function parseAllFileHunks(files: FileDiff[]): FileHunks[] {
  return files.map(parseFileHunks);
}

// ────────────────────────────────────────────────────────────────
// Hunk適用
// ────────────────────────────────────────────────────────────────

/**
 * 選択されたhunkのみをテンプレートに適用してマージ結果を生成
 */
export function applySelectedHunks(
  fileHunks: FileHunks,
  selectedIndices: number[],
): string {
  const { path, type, hunks, templateContent, localContent } = fileHunks;

  // addedファイルは選択されていればローカルコンテンツをそのまま返す
  if (type === "added") {
    return localContent || "";
  }

  // deletedやunchangedは対象外
  if (type === "deleted" || type === "unchanged") {
    return templateContent || "";
  }

  // hunkがない場合はローカルコンテンツを返す
  if (hunks.length === 0) {
    return localContent || "";
  }

  // 全てのhunkが選択されている場合はローカルコンテンツをそのまま返す
  if (selectedIndices.length === hunks.length) {
    return localContent || "";
  }

  // hunkが1つも選択されていない場合はテンプレートコンテンツを返す
  if (selectedIndices.length === 0) {
    return templateContent || "";
  }

  // 選択されたhunkのみを含むパッチを作成して適用
  const selectedHunks = hunks
    .filter((h) => selectedIndices.includes(h.index))
    .map((h) => h.hunk);

  const partialPatch = createPartialPatch(path, selectedHunks);
  const result = applyPatch(templateContent || "", partialPatch);

  // applyPatchが失敗した場合（false を返す）はローカルコンテンツにフォールバック
  if (result === false) {
    return localContent || "";
  }

  return result;
}

/**
 * FileHunksと選択されたインデックスからHunkSelectionを生成
 */
export function createHunkSelection(
  fileHunks: FileHunks,
  selectedIndices: number[],
): HunkSelection {
  return {
    path: fileHunks.path,
    selectedHunkIndices: selectedIndices,
    mergedContent: applySelectedHunks(fileHunks, selectedIndices),
  };
}

// ────────────────────────────────────────────────────────────────
// ヘルパー関数
// ────────────────────────────────────────────────────────────────

/**
 * unified diff形式のパッチ文字列を生成
 */
function createUnifiedPatch(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  // diffパッケージのcreatePatchを使用するとヘッダーが付くので、
  // parsePatchで読み込めるフォーマットで生成
  const { createPatch } = require("diff") as typeof import("diff");
  return createPatch(filePath, oldContent, newContent, "template", "local");
}

/**
 * 選択されたhunkのみを含むパッチ文字列を生成
 */
function createPartialPatch(filePath: string, hunks: Hunk[]): string {
  const lines: string[] = [];

  // パッチヘッダー
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  // 各hunkを追加
  for (const hunk of hunks) {
    lines.push(formatHunkHeader(hunk));
    for (const line of hunk.lines) {
      lines.push(line);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Hunkから追加・削除行数をカウント
 */
function countHunkChanges(hunk: Hunk): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of hunk.lines) {
    if (line.startsWith("+") && !line.startsWith("++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * Hunkヘッダーをフォーマット
 */
function formatHunkHeader(hunk: Hunk): string {
  const oldStart = hunk.oldStart;
  const oldLines = hunk.oldLines;
  const newStart = hunk.newStart;
  const newLines = hunk.newLines;

  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

/**
 * Hunkを表示用テキストにフォーマット
 */
function formatHunkDisplay(hunk: Hunk): string {
  const lines: string[] = [];
  lines.push(formatHunkHeader(hunk));

  for (const line of hunk.lines) {
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Hunkが実質的な変更を含むかチェック
 * (空白のみの変更など、無視すべき変更を除外する場合に使用)
 */
export function hasSubstantialChanges(hunk: Hunk): boolean {
  const { additions, deletions } = countHunkChanges(hunk);
  return additions > 0 || deletions > 0;
}

/**
 * FileDiffがhunk分割可能かどうかをチェック
 */
export function canSplitIntoHunks(fileDiff: FileDiff): boolean {
  return fileDiff.type === "modified";
}

/**
 * FileHunksからhunkの総数を取得
 */
export function getTotalHunkCount(fileHunksList: FileHunks[]): number {
  return fileHunksList.reduce((sum, fh) => sum + fh.hunks.length, 0);
}
