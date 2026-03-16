import { applyPatch, createPatch, structuredPatch } from "diff";
import { applyEdits, modify, parse as jsoncParse } from "jsonc-parser";
import * as TOML from "smol-toml";
import * as YAML from "yaml";
import { z } from "zod/v4";

// ---- Branded types: base/local/template の取り違えをコンパイル時に検出 ----

/**
 * 3-way マージにおけるベース（共通祖先）のファイル内容。
 *
 * 背景: threeWayMerge の引数は全て string だが、base/local/template を
 * 入れ違えるとサイレントに誤った結果を返す（#148 で発生）。
 * Zod brand で型レベルで区別し、取り違えをコンパイルエラーにする。
 */
const BaseContent = z.string().brand("BaseContent");
export type BaseContent = z.infer<typeof BaseContent>;

/** ローカル側（ユーザー）のファイル内容。コンフリクト時に優先される側。 */
const LocalContent = z.string().brand("LocalContent");
export type LocalContent = z.infer<typeof LocalContent>;

/** テンプレート側のファイル内容。ローカルに適用される変更の源。 */
const TemplateContent = z.string().brand("TemplateContent");
export type TemplateContent = z.infer<typeof TemplateContent>;

/** string を BaseContent にブランドする */
export function asBaseContent(s: string): BaseContent {
  return BaseContent.parse(s);
}

/** string を LocalContent にブランドする */
export function asLocalContent(s: string): LocalContent {
  return LocalContent.parse(s);
}

/** string を TemplateContent にブランドする */
export function asTemplateContent(s: string): TemplateContent {
  return TemplateContent.parse(s);
}

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
 * 3-way マージの入力パラメータ。
 *
 * 背景: base/local/template の3つの文字列は全て string 型で、位置引数だと
 * 入れ違いがコンパイルエラーにならない。named parameters + branded types で
 * 意図を明示し、取り違えをコンパイルエラーにする。
 */
export interface ThreeWayMergeParams {
  /** 共通祖先（ベース）の内容 */
  base: BaseContent;
  /** ローカル側の内容（コンフリクト時に優先される。フォーマット・コメントの起点） */
  local: LocalContent;
  /** テンプレート側の内容（ローカルに適用される変更の源） */
  template: TemplateContent;
  /** ファイルパス（拡張子で JSON/テキストのマージ戦略を選択） */
  filePath?: string;
}

/**
 * ファイルパスに応じた最適な 3-way マージを実行する。
 *
 * 背景: ファイルの種類によって最適なマージ戦略が異なる。
 * JSON/JSONC はキーレベルの構造マージが可能で、コンフリクトマーカーで
 * ファイル構造を壊さずにマージできる。テキストファイルは fuzz factor や
 * hunk 単位のマーカーで精度を上げる。
 *
 * result の内容は local をベースにし、template 側の変更を適用したもの。
 * コンフリクト時は local 側の値が保持される。
 */
export function threeWayMerge({
  base,
  local,
  template,
  filePath,
}: ThreeWayMergeParams): MergeResult {
  // ローカルとテンプレートが同一なら即座に返す
  // branded types は実行時には同じ string なので、String() で brand を外して比較する
  if (String(local) === String(template)) {
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

  if (filePath && isTomlFile(filePath)) {
    const tomlResult = mergeTomlContent(base, local, template);
    if (tomlResult !== null) {
      return tomlResult;
    }
    // TOML パースに失敗した場合はテキストマージにフォールバック
  }

  if (filePath && isYamlFile(filePath)) {
    const yamlResult = mergeYamlContent(base, local, template);
    if (yamlResult !== null) {
      return yamlResult;
    }
    // YAML パースに失敗した場合はテキストマージにフォールバック
  }

  return textThreeWayMerge(base, local, template, filePath);
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

// ---- TOML 構造マージ ----

/**
 * TOML ファイルをキーレベルで 3-way マージする。
 *
 * 背景: TOML ファイルにコンフリクトマーカーを挿入するとパーサーが壊れるため、
 * JSON マージと同様にキーレベルで変更を検出し、非コンフリクト部分を自動マージする。
 * コンフリクトがあるキーはローカル値を採用し、conflictDetails で報告する。
 *
 * 制約: smol-toml の stringify はコメントを保持しないため、マージ結果では
 * ローカルのコメントが失われる。ただし、壊れた TOML を出力するよりも
 * 正しい TOML を出力することを優先する。
 *
 * @returns マージ結果。TOML パースに失敗した場合は null（テキストマージにフォールバック）。
 */
export function mergeTomlContent(
  base: string,
  local: string,
  template: string,
): MergeResult | null {
  let baseObj: Record<string, unknown>;
  let localObj: Record<string, unknown>;
  let templateObj: Record<string, unknown>;

  try {
    baseObj = TOML.parse(base) as Record<string, unknown>;
    localObj = TOML.parse(local) as Record<string, unknown>;
    templateObj = TOML.parse(template) as Record<string, unknown>;
  } catch {
    return null;
  }

  // base→template の変更を検出
  const templateDiffs = getJsonDiffs(baseObj, templateObj);
  // base→local の変更を検出
  const localDiffs = getJsonDiffs(baseObj, localObj);

  // テンプレート変更のうち、ローカルとコンフリクトしないものを適用
  const mergedObj = structuredClone(localObj);
  const conflictDetails: ConflictDetail[] = [];

  for (const diff of templateDiffs) {
    const conflictsWithLocal = localDiffs.some((ld) => pathsOverlap(ld.path, diff.path));

    if (conflictsWithLocal) {
      const localVal = getValueAtPath(localObj, diff.path);
      const templateVal = diff.type === "remove" ? undefined : diff.value;

      if (deepEqual(localVal, templateVal)) {
        continue;
      }

      // コンフリクト: ローカル値を保持
      conflictDetails.push({
        path: diff.path,
        localValue: localVal,
        templateValue: templateVal,
      });
      continue;
    }

    // テンプレートのみの変更 → マージオブジェクトに適用
    if (diff.type === "remove") {
      deleteAtPath(mergedObj, diff.path);
    } else {
      setAtPath(mergedObj, diff.path, diff.value);
    }
  }

  return {
    content: TOML.stringify(mergedObj),
    hasConflicts: conflictDetails.length > 0,
    conflictDetails,
  };
}

// ---- YAML 構造マージ ----

/**
 * YAML ファイルをキーレベルで 3-way マージする。
 *
 * 背景: YAML ファイルもインデントベースの構造を持ち、テキストマージで
 * 壊れることがある。JSON/TOML と同様にキーレベルでマージする。
 *
 * @returns マージ結果。YAML パースに失敗した場合は null（テキストマージにフォールバック）。
 */
export function mergeYamlContent(
  base: string,
  local: string,
  template: string,
): MergeResult | null {
  let baseObj: unknown;
  let localObj: unknown;
  let templateObj: unknown;

  try {
    baseObj = YAML.parse(base);
    localObj = YAML.parse(local);
    templateObj = YAML.parse(template);
  } catch {
    return null;
  }

  if (baseObj == null || localObj == null || templateObj == null) {
    return null;
  }

  // オブジェクト以外（スカラーや配列がトップレベル）はテキストマージにフォールバック
  if (
    typeof baseObj !== "object" ||
    typeof localObj !== "object" ||
    typeof templateObj !== "object"
  ) {
    return null;
  }

  const templateDiffs = getJsonDiffs(baseObj, templateObj);
  const localDiffs = getJsonDiffs(baseObj, localObj);

  const mergedObj = structuredClone(localObj) as Record<string, unknown>;
  const conflictDetails: ConflictDetail[] = [];

  for (const diff of templateDiffs) {
    const conflictsWithLocal = localDiffs.some((ld) => pathsOverlap(ld.path, diff.path));

    if (conflictsWithLocal) {
      const localVal = getValueAtPath(localObj, diff.path);
      const templateVal = diff.type === "remove" ? undefined : diff.value;

      if (deepEqual(localVal, templateVal)) {
        continue;
      }

      conflictDetails.push({
        path: diff.path,
        localValue: localVal,
        templateValue: templateVal,
      });
      continue;
    }

    if (diff.type === "remove") {
      deleteAtPath(mergedObj, diff.path);
    } else {
      setAtPath(mergedObj, diff.path, diff.value);
    }
  }

  return {
    content: YAML.stringify(mergedObj),
    hasConflicts: conflictDetails.length > 0,
    conflictDetails,
  };
}

// ---- オブジェクト操作ヘルパー ----

/**
 * ネストされたオブジェクトのパスに値を設定する。
 * 中間オブジェクトが存在しない場合は自動的に作成する。
 */
function setAtPath(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let current: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current == null || typeof current !== "object") return;
    const record = current as Record<string | number, unknown>;
    if (!(key in record) || record[key] == null || typeof record[key] !== "object") {
      record[key] = {};
    }
    current = record[key];
  }
  if (current != null && typeof current === "object") {
    (current as Record<string | number, unknown>)[path[path.length - 1]] = value;
  }
}

/**
 * ネストされたオブジェクトのパスにあるキーを削除する。
 */
function deleteAtPath(obj: Record<string, unknown>, path: (string | number)[]): void {
  let current: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[key];
  }
  if (current != null && typeof current === "object") {
    delete (current as Record<string | number, unknown>)[path[path.length - 1]];
  }
}

function isJsonFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".jsonc");
}

function isTomlFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".toml");
}

function isYamlFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".yml") || lower.endsWith(".yaml");
}

/**
 * 構造ファイル（TOML/YAML）のマージ結果をパースして妥当性を検証する。
 *
 * 背景: テキストベースの diff/patch は行レベルでマージするため、
 * fuzz factor でパッチが「成功」しても、TOML のセクション重複や
 * YAML のインデント崩れ等、構造的に壊れた出力を生むことがある。
 * git の merge がこのような破損を出さないのに対し、patch ベースの
 * マージはこの検証が必要。パース失敗時はコンフリクトマーカーに
 * フォールバックすることで、壊れたファイルの生成を防ぐ。
 */
function validateStructuredContent(content: string, filePath: string): boolean {
  if (isTomlFile(filePath)) {
    try {
      TOML.parse(content);
      return true;
    } catch {
      return false;
    }
  }
  if (isYamlFile(filePath)) {
    try {
      YAML.parse(content);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

// ---- テキスト 3-way マージ (改良版) ----

/**
 * テキストファイルの 3-way マージ。fuzz factor によるパッチ適用と
 * hunk 単位のコンフリクトマーカーで、従来のファイル全体マーカーを改善。
 *
 * 背景: TOML 等の構造ファイルにファイル全体のコンフリクトマーカーを入れると
 * パーサーが壊れる。hunk 単位にすることで影響範囲を最小化する。
 *
 * filePath が渡された場合、パッチ適用後に構造ファイルの妥当性を検証する。
 * fuzz factor でパッチが「成功」しても、TOML のセクション重複等で
 * 壊れたファイルが生成されることがあるため、パース検証で検出して
 * コンフリクトマーカーにフォールバックする。
 *
 * 戦略:
 * 1. 標準パッチ適用（fuzz=0）+ 構造検証
 * 2. fuzz factor を上げてリトライ（fuzz=2）+ 構造検証
 * 3. 失敗時: hunk 単位で適用を試み、失敗した hunk のみにマーカーを付与
 */
function textThreeWayMerge(
  base: string,
  local: string,
  template: string,
  filePath?: string,
): MergeResult {
  // ステップ 1: 標準パッチ適用
  const patch = createPatch("file", base, template);
  const result = applyPatch(local, patch);
  if (typeof result === "string") {
    // 構造ファイルの場合、パッチ適用結果を検証
    if (filePath && !validateStructuredContent(result, filePath)) {
      return mergeWithPerHunkMarkers(base, local, template);
    }
    return { content: result, hasConflicts: false, conflictDetails: [] };
  }

  // ステップ 2: fuzz factor を上げてリトライ
  const resultFuzzy = applyPatch(local, patch, { fuzzFactor: 2 });
  if (typeof resultFuzzy === "string") {
    // 構造ファイルの場合、パッチ適用結果を検証
    if (filePath && !validateStructuredContent(resultFuzzy, filePath)) {
      return mergeWithPerHunkMarkers(base, local, template);
    }
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

// Note: named parameters 化により、引数の入れ違いがコンパイルエラーになる

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
