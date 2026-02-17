import { checkbox, confirm, input, password, Separator } from "@inquirer/prompts";
import type { DiffResult, FileDiff } from "../modules/schemas";
import { formatDiff } from "../utils/diff";
import { getFileLabel, showDiffSummaryBox } from "../utils/diff-viewer";
import type { UntrackedFile, UntrackedFilesByFolder } from "../utils/untracked";

export interface SelectedUntrackedFiles {
  moduleId: string;
  files: string[];
}

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
 * サマリー表示後、直接ファイル選択チェックボックスを表示
 */
export async function promptSelectFilesWithDiff(pushableFiles: FileDiff[]): Promise<FileDiff[]> {
  if (pushableFiles.length === 0) {
    return [];
  }

  // サマリーボックスを表示
  showDiffSummaryBox(pushableFiles);

  // チェックボックスでファイル選択（デフォルト全選択）
  const choices = pushableFiles.map((file) => ({
    name: getFileLabel(file),
    value: file,
    checked: true,
  }));

  return checkbox<FileDiff>({
    message: "PR に含めるファイルを選択してください",
    choices,
  });
}

/**
 * ホワイトリスト外ファイルの追加確認プロンプト
 * ホワイトリスト形式: 全ファイルをデフォルト選択状態で表示し、不要なものを外す
 */
export async function promptAddUntrackedFiles(
  untrackedByFolder: UntrackedFilesByFolder[],
): Promise<SelectedUntrackedFiles[]> {
  if (untrackedByFolder.length === 0) {
    return [];
  }

  // サマリー表示
  console.log();
  console.log("=== ホワイトリスト外のファイルが見つかりました ===");
  console.log();
  for (const { folder, files } of untrackedByFolder) {
    console.log(`  ${folder}: ${files.length}件`);
  }
  console.log();

  // 全ファイルをフォルダ別ツリー形式で表示（デフォルト全選択）
  const allFileChoices: ({ name: string; value: UntrackedFile; checked: boolean } | Separator)[] =
    [];

  for (const { folder, files } of untrackedByFolder) {
    // フォルダヘッダーを追加
    allFileChoices.push(new Separator(`\n  ── ${folder} ──`));

    // フォルダ内のファイルをソート
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

    // ツリー形式で表示
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const isLast = i === sortedFiles.length - 1;
      const prefix = isLast ? "└─" : "├─";

      // フォルダ部分を除いたファイル名を取得
      const relativePath = file.path.startsWith(`${folder}/`)
        ? file.path.slice(folder.length + 1)
        : file.path;

      allFileChoices.push({
        name: `${prefix} ${relativePath}`,
        value: file,
        checked: true,
      });
    }
  }

  const selectedFiles = await checkbox<UntrackedFile>({
    message: "push 対象に追加するファイルを選択してください",
    choices: allFileChoices,
  });

  if (selectedFiles.length === 0) {
    return [];
  }

  // moduleId ごとにグループ化
  const byModuleId = new Map<string, string[]>();
  for (const file of selectedFiles) {
    const existing = byModuleId.get(file.moduleId) || [];
    existing.push(file.path);
    byModuleId.set(file.moduleId, existing);
  }

  const result: SelectedUntrackedFiles[] = [];
  for (const [moduleId, files] of byModuleId) {
    result.push({ moduleId, files });
  }

  return result;
}
