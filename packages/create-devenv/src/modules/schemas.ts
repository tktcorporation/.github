import { z } from "zod";

// ────────────────────────────────────────────────────────────────
// Branded Types - より厳密な型定義
// ────────────────────────────────────────────────────────────────

/** 非負整数（行数カウント用） */
export const nonNegativeIntSchema = z.number().int().nonnegative().brand<"NonNegativeInt">();
export type NonNegativeInt = z.infer<typeof nonNegativeIntSchema>;

/** ファイルパス */
export const filePathSchema = z.string().min(1).brand<"FilePath">();
export type FilePath = z.infer<typeof filePathSchema>;

// ────────────────────────────────────────────────────────────────
// Core Schemas
// ────────────────────────────────────────────────────────────────

// 上書き戦略
export const overwriteStrategySchema = z.enum(["overwrite", "skip", "prompt"]);
export type OverwriteStrategy = z.infer<typeof overwriteStrategySchema>;

// ファイル操作のアクション種別
export const fileActionSchema = z.enum([
  "copied", // テンプレートからコピー（新規）
  "created", // 生成されたコンテンツで作成（新規）
  "overwritten", // 上書き
  "skipped", // スキップ
  "skipped_ignored", // gitignore対象ファイルがローカルに既存のためスキップ
]);
export type FileAction = z.infer<typeof fileActionSchema>;

// ファイル操作結果
export const fileOperationResultSchema = z.object({
  action: fileActionSchema,
  path: z.string(),
});
export type FileOperationResult = z.infer<typeof fileOperationResultSchema>;

// テンプレートモジュール（新: patterns 形式）
export const moduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  setupDescription: z.string().optional(), // セットアップ後の説明
  patterns: z.array(z.string()), // glob パターン配列（ホワイトリスト形式）
});

export type TemplateModule = z.infer<typeof moduleSchema>;

// DevEnvConfig
export const configSchema = z.object({
  version: z.string(),
  installedAt: z.string().datetime({ offset: true }),
  modules: z.array(z.string()),
  source: z.object({
    owner: z.string(),
    repo: z.string(),
    ref: z.string().optional(),
  }),
  excludePatterns: z.array(z.string()).optional(), // グローバル除外パターン
});

export type DevEnvConfig = z.infer<typeof configSchema>;

export const answersSchema = z.object({
  modules: z.array(z.string()).min(1, "少なくとも1つのモジュールを選択してください"),
  overwriteStrategy: overwriteStrategySchema,
});

export type Answers = z.infer<typeof answersSchema>;

// 差分タイプ
export const diffTypeSchema = z.enum([
  "added", // ローカルで新規追加（テンプレートにはない）
  "modified", // 変更あり
  "deleted", // ローカルで削除（テンプレートにはある）
  "unchanged", // 変更なし
]);
export type DiffType = z.infer<typeof diffTypeSchema>;

// ファイル差分
export const fileDiffSchema = z.object({
  path: z.string(),
  type: diffTypeSchema,
  localContent: z.string().optional(),
  templateContent: z.string().optional(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

// 差分結果
export const diffResultSchema = z.object({
  files: z.array(fileDiffSchema),
  summary: z.object({
    added: z.number(),
    modified: z.number(),
    deleted: z.number(),
    unchanged: z.number(),
  }),
});
export type DiffResult = z.infer<typeof diffResultSchema>;

// PR 結果
export const prResultSchema = z.object({
  url: z.string(),
  number: z.number(),
  branch: z.string(),
});
export type PrResult = z.infer<typeof prResultSchema>;

// ────────────────────────────────────────────────────────────────
// Push Manifest Schemas (for AI-agent friendly workflow)
// ────────────────────────────────────────────────────────────────

/** マニフェスト内のファイルエントリ */
export const manifestFileSchema = z.object({
  path: z.string(),
  type: diffTypeSchema,
  selected: z.boolean(),
  /** 差分の行数（AIエージェント向けの参考情報） */
  lines_added: z.number().optional(),
  lines_removed: z.number().optional(),
});
export type ManifestFile = z.infer<typeof manifestFileSchema>;

/** マニフェスト内の未追跡ファイルエントリ */
export const manifestUntrackedFileSchema = z.object({
  path: z.string(),
  module_id: z.string(),
  selected: z.boolean(),
});
export type ManifestUntrackedFile = z.infer<typeof manifestUntrackedFileSchema>;

/** GitHub設定 */
export const manifestGitHubSchema = z.object({
  token: z.string().optional(), // 環境変数から取得可能
});

/** PR設定 */
export const manifestPrSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
});

/** サマリー（読み取り専用） */
export const manifestSummarySchema = z.object({
  added: z.number(),
  modified: z.number(),
  deleted: z.number(),
});

/** Push マニフェスト全体 */
export const pushManifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().datetime({ offset: true }),
  github: manifestGitHubSchema,
  pr: manifestPrSchema,
  files: z.array(manifestFileSchema),
  untracked_files: z.array(manifestUntrackedFileSchema).optional(),
  summary: manifestSummarySchema,
});
export type PushManifest = z.infer<typeof pushManifestSchema>;
