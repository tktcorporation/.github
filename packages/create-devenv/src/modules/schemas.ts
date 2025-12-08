import { z } from "zod";

export const moduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
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
  overwriteStrategy: z.enum(["overwrite", "skip", "prompt"]),
});

export type Answers = z.infer<typeof answersSchema>;
