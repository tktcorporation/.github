import { checkbox, confirm, input, password } from "@inquirer/prompts";
import type { DiffResult, FileDiff } from "../modules/schemas";
import {
  colorizeUnifiedDiff,
  formatDiff,
  generateUnifiedDiff,
} from "../utils/diff";

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

/**
 * diff を表示しながらファイルを選択するプロンプト
 */
export async function promptSelectFilesWithDiff(
  pushableFiles: FileDiff[],
): Promise<FileDiff[]> {
  if (pushableFiles.length === 0) {
    return [];
  }

  // 各ファイルの unified diff を表示
  console.log("\n=== 変更内容（unified diff）===\n");
  for (const file of pushableFiles) {
    const icon = file.type === "added" ? "[+]" : "[~]";
    console.log(`--- ${icon} ${file.path} ---`);
    console.log(colorizeUnifiedDiff(generateUnifiedDiff(file)));
    console.log();
  }

  // チェックボックスでファイル選択
  const choices = pushableFiles.map((file) => ({
    name: `[${file.type === "added" ? "+" : "~"}] ${file.path}`,
    value: file,
    checked: true,
  }));

  return checkbox<FileDiff>({
    message: "PR に含めるファイルを選択してください",
    choices,
  });
}
