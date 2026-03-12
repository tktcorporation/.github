import { applyPatch, createPatch, structuredPatch } from "diff";
import { applyEdits, modify, parse as jsoncParse } from "jsonc-parser";

/** 3-way マージの結果 */
export interface MergeResult {
  /** マージ後のファイル内容 */
  content: string;
  /** コンフリクトマーカーが含まれるか */
  hasConflicts: boolean;
  /**
   * 構造マージで検出されたコンフリクトのパス情報。
   * JSON/JSONC マージ時に、ローカル値を採用したコンフリクトキーの一覧。
   * ユーザーがどのキーを手動確認すべきかを示す。
   * テキストマージでは空配列。
   */
  conflictDetails: ConflictDetail[];
}

/**
 * 構造マージで発生した個別コンフリクトの詳細。
 *
 * 背景: JSON/JSONC の key-level マージでは、ファイルを壊さずに
 * ローカル値を優先しつつ、どのキーにテンプレート側の変更があったかを
 * ユーザーに伝えるために使用する。
 */
export interface ConflictDetail {
  /** コンフリクトが発生した JSON パス (例: ["mcpServers", "new-server"]) */
  path: (string | number)[];
  /** ローカル側の値（採用された値） */
  localValue: unknown;
  /** テンプレート側の値（採用されなかった値） */
  templateValue: unknown;
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
 * ファイルパスに応じた最適な 3-way マージを実行する。
 *
 * 背景: ファイルの種類によって最適なマージ戦略が異なる。
 * JSON/JSONC はキーレベルの構造マージが可能で、コンフリクトマーカーで
 * ファイル構造を壊さずにマージできる。テキストファイルは fuzz factor や
 * hunk 単位のマーカーで精度を上げる。
 *
 * @param filePath ファイルパス（拡張子でマージ戦略を選択）
 */
export function threeWayMerge(
  base: string,
  local: string,
  template: string,
  filePath?: string,
): MergeResult {
  // ローカルとテンプレートが同一なら即座に返す
  if (local === template) {
    return { content: local, hasConflicts: false, conflictDetails: [] };
  }

  // ファイル拡張子で構造マージを試みる
  if (filePath && isJsonFile(filePath)) {
    const jsonResult = mergeJsonContent(base, local, template);
    if (jsonResult !== null) {
      return jsonResult;
    }
    // JSON パースに失敗した場合はテキストマージにフォールバック
  }

  return textThreeWayMerge(base, local, template);
}

// ---- JSON/JSONC 構造マージ ----

/**
 * JSON/JSONC ファイルをキーレベルで 3-way マージする。
 *
 * 背景: JSON ファイルにコンフリクトマーカーを挿入するとパーサーが壊れるため、
 * キーレベルで変更を検出し、非コンフリクト部分を自動マージする。
 * コンフリクトがあるキーはローカル値を採用し、conflictDetails で報告する。
 * jsonc-parser の modify/applyEdits を使い、ローカルのフォーマットとコメントを保持する。
 *
 * @returns マージ結果。JSON パースに失敗した場合は null（テキストマージにフォールバック）。
 */
export function mergeJsonContent(
  base: string,
  local: string,
  template: string,
): MergeResult | null {
  let baseObj: unknown;
  let localObj: unknown;
  let templateObj: unknown;

  try {
    baseObj = jsoncParse(base);
    localObj = jsoncParse(local);
    templateObj = jsoncParse(template);
  } catch {
    return null;
  }

  // パースできたが値が null/undefined の場合はフォールバック
  if (baseObj == null || localObj == null || templateObj == null) {
    return null;
  }

  // base→template の変更を検出
  const templateDiffs = getJsonDiffs(baseObj, templateObj);
  // base→local の変更を検出
  const localDiffs = getJsonDiffs(baseObj, localObj);

  // テンプレート変更のうち、ローカルとコンフリクトしないものを適用
  let result = local;
  const conflictDetails: ConflictDetail[] = [];

  for (const diff of templateDiffs) {
    // ローカルも同じパスまたは祖先/子孫を変更しているかチェック
    const conflictsWithLocal = localDiffs.some((ld) => pathsOverlap(ld.path, diff.path));

    if (conflictsWithLocal) {
      // ローカル値を取得
      const localVal = getValueAtPath(localObj, diff.path);
      const templateVal = diff.type === "remove" ? undefined : diff.value;

      if (deepEqual(localVal, templateVal)) {
        // 同じ値に変更 → コンフリクトなし
        continue;
      }

      // 真のコンフリクト: ローカル値を保持し、コンフリクト情報を記録
      conflictDetails.push({
        path: diff.path,
        localValue: localVal,
        templateValue: templateVal,
      });
      continue;
    }

    // テンプレートのみの変更 → ローカルに適用
    if (diff.type === "remove") {
      const edits = modify(result, diff.path as (string | number)[], undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      result = applyEdits(result, edits);
    } else {
      const edits = modify(result, diff.path as (string | number)[], diff.value, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      result = applyEdits(result, edits);
    }
  }

  return {
    content: result,
    hasConflicts: conflictDetails.length > 0,
    conflictDetails,
  };
}

interface JsonDiff {
  path: (string | number)[];
  type: "add" | "remove" | "replace";
  value?: unknown;
}

/**
 * 2つの JSON 値の差分をパス単位で検出する。
 * オブジェクトはキーレベルで再帰比較し、配列はアトミックに扱う。
 */
function getJsonDiffs(base: unknown, target: unknown, path: (string | number)[] = []): JsonDiff[] {
  if (deepEqual(base, target)) return [];

  // 型が異なる、またはプリミティブ/配列 → 置換
  if (
    typeof base !== typeof target ||
    base === null ||
    target === null ||
    typeof base !== "object" ||
    typeof target !== "object" ||
    Array.isArray(base) !== Array.isArray(target)
  ) {
    return [{ path, type: "replace", value: target }];
  }

  // 配列はアトミックに扱う（要素単位の対応付けが困難なため）
  if (Array.isArray(base)) {
    return [{ path, type: "replace", value: target }];
  }

  const diffs: JsonDiff[] = [];
  const baseObj = base as Record<string, unknown>;
  const targetObj = target as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(baseObj), ...Object.keys(targetObj)]);

  for (const key of allKeys) {
    const childPath = [...path, key];
    if (!(key in baseObj)) {
      diffs.push({ path: childPath, type: "add", value: targetObj[key] });
    } else if (!(key in targetObj)) {
      diffs.push({ path: childPath, type: "remove" });
    } else {
      diffs.push(...getJsonDiffs(baseObj[key], targetObj[key], childPath));
    }
  }

  return diffs;
}

/**
 * 2つのパスが重複（祖先/子孫/同一）するかを判定する。
 * 例: ["a", "b"] と ["a", "b", "c"] → true（祖先と子孫）
 *      ["a", "b"] と ["a", "x"] → false
 */
function pathsOverlap(pathA: (string | number)[], pathB: (string | number)[]): boolean {
  const minLen = Math.min(pathA.length, pathB.length);
  for (let i = 0; i < minLen; i++) {
    if (pathA[i] !== pathB[i]) return false;
  }
  return true;
}

/** ネストされたオブジェクトからパスを辿って値を取得する */
function getValueAtPath(obj: unknown, path: (string | number)[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** 2つの値を深い比較で等しいか判定する */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}

function isJsonFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".jsonc");
}

// ---- テキスト 3-way マージ (改良版) ----

/**
 * テキストファイルの 3-way マージ。fuzz factor によるパッチ適用と
 * hunk 単位のコンフリクトマーカーで、従来のファイル全体マーカーを改善。
 *
 * 背景: TOML 等の構造ファイルにファイル全体のコンフリクトマーカーを入れると
 * パーサーが壊れる。hunk 単位にすることで影響範囲を最小化する。
 *
 * 戦略:
 * 1. 標準パッチ適用（fuzz=0）
 * 2. fuzz factor を上げてリトライ（fuzz=2）
 * 3. 失敗時: hunk 単位で適用を試み、失敗した hunk のみにマーカーを付与
 */
function textThreeWayMerge(base: string, local: string, template: string): MergeResult {
  // ステップ 1: 標準パッチ適用
  const patch = createPatch("file", base, template);
  const result = applyPatch(local, patch);
  if (typeof result === "string") {
    return { content: result, hasConflicts: false, conflictDetails: [] };
  }

  // ステップ 2: fuzz factor を上げてリトライ
  const resultFuzzy = applyPatch(local, patch, { fuzzFactor: 2 });
  if (typeof resultFuzzy === "string") {
    return { content: resultFuzzy, hasConflicts: false, conflictDetails: [] };
  }

  // ステップ 3: hunk 単位でコンフリクトマーカーを付与
  return mergeWithPerHunkMarkers(base, local, template);
}

/**
 * hunk 単位でパッチを適用し、失敗した hunk のみにコンフリクトマーカーを付与する。
 *
 * 背景: ファイル全体をマーカーで囲むとファイルが完全に壊れる。
 * hunk 単位にすることで、成功した部分は正常なまま保持され、
 * コンフリクト箇所だけがマーカー付きになる。
 */
function mergeWithPerHunkMarkers(base: string, local: string, template: string): MergeResult {
  const patchObj = structuredPatch("file", "file", base, template);
  const localLines = local.split("\n");

  // 各 hunk を個別にローカルに適用試行
  // 成功した hunk は適用、失敗した hunk はマーカー付きで挿入
  const resultLines: string[] = [];
  let localIdx = 0;
  let hasConflicts = false;

  for (const hunk of patchObj.hunks) {
    // hunk の開始行（0-indexed）
    const hunkLocalStart = hunk.oldStart - 1;

    // hunk の前の未処理行を出力
    while (localIdx < hunkLocalStart && localIdx < localLines.length) {
      resultLines.push(localLines[localIdx]);
      localIdx++;
    }

    // この hunk を単独パッチとして適用を試みる
    const hunkApplied = tryApplyHunk(localLines, hunk);

    if (hunkApplied !== null) {
      // hunk 適用成功
      resultLines.push(...hunkApplied);
      localIdx = hunkLocalStart + hunk.oldLines;
    } else {
      // hunk 適用失敗 → この hunk 部分だけにコンフリクトマーカー
      hasConflicts = true;

      const localSection: string[] = [];
      for (let i = 0; i < hunk.oldLines && hunkLocalStart + i < localLines.length; i++) {
        localSection.push(localLines[hunkLocalStart + i]);
      }

      const templateSection: string[] = [];
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          templateSection.push(line.slice(1));
        } else if (line.startsWith(" ")) {
          templateSection.push(line.slice(1));
        }
        // '-' 行はローカル側（localSection に含まれる）
      }

      resultLines.push("<<<<<<< LOCAL");
      resultLines.push(...localSection);
      resultLines.push("=======");
      resultLines.push(...templateSection);
      resultLines.push(">>>>>>> TEMPLATE");

      localIdx = hunkLocalStart + hunk.oldLines;
    }
  }

  // 残りの行を出力
  while (localIdx < localLines.length) {
    resultLines.push(localLines[localIdx]);
    localIdx++;
  }

  return {
    content: resultLines.join("\n"),
    hasConflicts,
    conflictDetails: [],
  };
}

/**
 * 単一の hunk をローカル行に適用する。
 * コンテキスト行が一致し、削除行が存在する場合に適用成功として新しい行を返す。
 * 一致しない場合は null を返す。
 */
function tryApplyHunk(
  localLines: string[],
  hunk: { oldStart: number; oldLines: number; lines: string[] },
): string[] | null {
  const startIdx = hunk.oldStart - 1;

  // hunk の old 側の行を構築して照合
  const expectedOldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of hunk.lines) {
    const op = line[0];
    const content = line.slice(1);

    if (op === " ") {
      expectedOldLines.push(content);
      newLines.push(content);
    } else if (op === "-") {
      expectedOldLines.push(content);
    } else if (op === "+") {
      newLines.push(content);
    }
  }

  // ローカル行と hunk の old 側が一致するかチェック
  if (startIdx + expectedOldLines.length > localLines.length) {
    return null;
  }

  for (let i = 0; i < expectedOldLines.length; i++) {
    if (localLines[startIdx + i] !== expectedOldLines[i]) {
      return null;
    }
  }

  return newLines;
}

/**
 * base/local/template の3つの内容から 3-way マージを実行する。
 * (後方互換性のためのラッパー)
 *
 * @deprecated filePath を渡す新しい threeWayMerge を使用してください
 */
// Note: 後方互換性は threeWayMerge(base, local, template) の呼び出しで自動的に保たれる
// filePath を省略すると従来通りテキストマージが使われる

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
