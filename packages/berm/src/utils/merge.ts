import { createPatch, applyPatch } from "diff";

/** 3-way マージの結果 */
export interface MergeResult {
  /** マージ後のファイル内容 */
  content: string;
  /** コンフリクトマーカーが含まれるか */
  hasConflicts: boolean;
}

/**
 * ファイル分類結果。
 * pull/push 時に base/local/template のハッシュを比較し、
 * 各ファイルの処理方法を決定するために使用する。
 */
export interface FileClassification {
  /** テンプレートのみ更新 → 自動上書き */
  autoUpdate: string[];
  /** ローカルのみ変更 → スキップ（ローカル保持） */
  localOnly: string[];
  /** 両方変更 → 3-way マージが必要 */
  conflicts: string[];
  /** テンプレートに新規追加 → そのまま追加 */
  newFiles: string[];
  /** テンプレートで削除 → ユーザーに確認 */
  deletedFiles: string[];
  /** 変更なし → スキップ */
  unchanged: string[];
}

export interface ClassifyOptions {
  baseHashes: Record<string, string>;
  localHashes: Record<string, string>;
  templateHashes: Record<string, string>;
}

/**
 * base/local/template のハッシュを比較し、各ファイルを分類する。
 *
 * 背景: pull/push 時にファイルごとの処理方法（自動上書き・マージ・スキップ等）を
 * 決定するために使用する。3つのハッシュマップの差分パターンで分類を行う。
 */
export function classifyFiles(opts: ClassifyOptions): FileClassification {
  const { baseHashes, localHashes, templateHashes } = opts;

  const result: FileClassification = {
    autoUpdate: [],
    localOnly: [],
    conflicts: [],
    newFiles: [],
    deletedFiles: [],
    unchanged: [],
  };

  const allFiles = new Set([
    ...Object.keys(baseHashes),
    ...Object.keys(localHashes),
    ...Object.keys(templateHashes),
  ]);

  for (const file of allFiles) {
    const base = baseHashes[file];
    const local = localHashes[file];
    const template = templateHashes[file];

    if (base === undefined && template !== undefined && local === undefined) {
      // base にもローカルにもない → テンプレートに新規追加
      result.newFiles.push(file);
    } else if (base !== undefined && template === undefined) {
      // base にはあるがテンプレートで削除された
      result.deletedFiles.push(file);
    } else if (base === undefined && template === undefined && local !== undefined) {
      // ローカルのみに存在（base にもテンプレートにもない）
      result.localOnly.push(file);
    } else if (base === undefined && template !== undefined && local !== undefined) {
      // base にないが両方に存在 → ハッシュ比較
      if (local === template) {
        result.unchanged.push(file);
      } else {
        result.conflicts.push(file);
      }
    } else {
      // base, local, template すべてに存在
      const localChanged = local !== base;
      const templateChanged = template !== base;

      if (!localChanged && !templateChanged) {
        result.unchanged.push(file);
      } else if (!localChanged && templateChanged) {
        result.autoUpdate.push(file);
      } else if (localChanged && !templateChanged) {
        result.localOnly.push(file);
      } else {
        // 両方変更
        if (local === template) {
          // 同じ内容に変更された場合は unchanged 扱い
          result.unchanged.push(file);
        } else {
          result.conflicts.push(file);
        }
      }
    }
  }

  return result;
}

/**
 * base/local/template の3つの内容から 3-way マージを実行する。
 *
 * 背景: テンプレート更新時にローカルの変更を保持しつつテンプレートの変更を
 * 取り込むために使用する。diff パッケージの createPatch/applyPatch を利用し、
 * base→template のパッチをローカルに適用する方式。
 *
 * パッチ適用に失敗した場合はコンフリクトマーカー付きの内容を返す。
 */
export function threeWayMerge(base: string, local: string, template: string): MergeResult {
  // ローカルとテンプレートが同一なら即座に返す
  if (local === template) {
    return { content: local, hasConflicts: false };
  }

  // base→template のパッチを生成し、ローカルに適用
  const patch = createPatch("file", base, template);
  const result = applyPatch(local, patch);

  if (typeof result === "string") {
    return { content: result, hasConflicts: false };
  }

  // パッチ適用失敗 → コンフリクトマーカーを生成
  const content = `<<<<<<< LOCAL\n${local}\n=======\n${template}\n>>>>>>> TEMPLATE`;
  return { content, hasConflicts: true };
}

/**
 * ファイル内容にコンフリクトマーカーが含まれるかを検出する。
 *
 * 背景: マージ後のファイルにユーザーが手動解決すべきコンフリクトが
 * 残っているかを判定するために使用する。
 */
export function hasConflictMarkers(content: string): { found: boolean; lines: number[] } {
  const lines: number[] = [];
  const contentLines = content.split("\n");

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    if (line.startsWith("<<<<<<<") || line.startsWith("=======") || line.startsWith(">>>>>>>")) {
      // 行番号は 1-based
      lines.push(i + 1);
    }
  }

  return { found: lines.length > 0, lines };
}
