import { checkbox, select } from "@inquirer/prompts";
import { modules } from "../modules/index";
import { type Answers, answersSchema } from "../modules/schemas";

export async function promptInit(): Promise<Answers> {
  const selectedModules = await checkbox({
    message: "適用するテンプレートを選択してください",
    choices: modules.map((m) => ({
      name: `${m.name} - ${m.description}`,
      value: m.id,
      checked: true,
    })),
  });

  const overwriteStrategy = await select({
    message: "既存ファイルが見つかった場合の処理方法",
    choices: [
      { name: "確認しながら進める", value: "prompt" as const },
      { name: "すべて上書き", value: "overwrite" as const },
      { name: "スキップ (既存ファイルを保持)", value: "skip" as const },
    ],
    default: "prompt" as const,
  });

  // Zod でバリデーション
  const result = answersSchema.safeParse({
    modules: selectedModules,
    overwriteStrategy,
  });

  if (!result.success) {
    throw new Error(result.error.errors.map((e) => e.message).join("\n"));
  }

  return result.data;
}
