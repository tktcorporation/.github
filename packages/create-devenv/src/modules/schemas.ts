import { z } from "zod";

// 上書き戦略
export const overwriteStrategySchema = z.enum(["overwrite", "skip", "prompt"]);
export type OverwriteStrategy = z.infer<typeof overwriteStrategySchema>;

// ファイル操作のアクション種別
export const fileActionSchema = z.enum([
  "copied", // テンプレートからコピー（新規）
  "created", // 生成されたコンテンツで作成（新規）
  "overwritten", // 上書き
  "skipped", // スキップ
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
