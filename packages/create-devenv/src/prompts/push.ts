import { confirm, input, password } from "@inquirer/prompts";
import type { DiffResult } from "../modules/schemas";
import { formatDiff } from "../utils/diff";

/**
 * push 実行前の確認プロンプト
 */
export async function promptPushConfirm(diff: DiffResult): Promise<boolean> {
  console.log();
  console.log(formatDiff(diff, false));
  console.log();

  return confirm({
    message: "これらの変更をテンプレートリポジトリに PR として送信しますか？",
    default: false,
  });
}

/**
 * PR タイトルの入力プロンプト
 */
export async function promptPrTitle(defaultTitle?: string): Promise<string> {
  return input({
    message: "PR のタイトルを入力してください",
    default: defaultTitle || "feat: テンプレート設定を更新",
    validate: (value) => {
      if (!value.trim()) {
        return "タイトルは必須です";
      }
      return true;
    },
  });
}

/**
 * PR 本文の入力プロンプト（オプション）
 */
export async function promptPrBody(): Promise<string | undefined> {
  const addBody = await confirm({
    message: "PR の説明を追加しますか？",
    default: false,
  });

  if (!addBody) {
    return undefined;
  }

  return input({
    message: "PR の説明を入力してください",
  });
}

/**
 * GitHub トークンの入力プロンプト
 */
export async function promptGitHubToken(): Promise<string> {
  console.log();
  console.log("GitHub トークンが必要です。");
  console.log("以下のいずれかの方法で設定できます:");
  console.log("  1. 環境変数 GITHUB_TOKEN または GH_TOKEN を設定");
  console.log("  2. 以下のプロンプトで直接入力");
  console.log();

  return password({
    message: "GitHub Personal Access Token を入力してください",
    validate: (value) => {
      if (!value.trim()) {
        return "トークンは必須です";
      }
      if (
        !value.startsWith("ghp_") &&
        !value.startsWith("gho_") &&
        !value.startsWith("github_pat_")
      ) {
        return "有効な GitHub トークン形式ではありません";
      }
      return true;
    },
  });
}
