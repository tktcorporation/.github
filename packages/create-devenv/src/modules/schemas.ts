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

// テンプレートモジュール
export const moduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  setupDescription: z.string().optional(), // セットアップ後の説明
  files: z.array(z.string()),
  excludeFiles: z.array(z.string()).optional(),
});

export type TemplateModule = z.infer<typeof moduleSchema>;

export const configSchema = z.object({
  version: z.string(),
  installedAt: z.string().datetime(),
  modules: z.array(z.string()),
  source: z.object({
    owner: z.string(),
    repo: z.string(),
    ref: z.string().optional(),
  }),
});

export type DevEnvConfig = z.infer<typeof configSchema>;

export const answersSchema = z.object({
  modules: z
    .array(z.string())
    .min(1, "少なくとも1つのモジュールを選択してください"),
  overwriteStrategy: overwriteStrategySchema,
});

export type Answers = z.infer<typeof answersSchema>;
