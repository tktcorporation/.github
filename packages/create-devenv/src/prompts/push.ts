import * as readline from "node:readline";
import { checkbox, confirm, input, password, Separator } from "@inquirer/prompts";
import type { DiffResult, FileDiff } from "../modules/schemas";
import { formatDiff } from "../utils/diff";
import {
  addStatsToFiles,
  formatStats,
  showDiffSummaryBox,
  showFileDiffBox,
} from "../utils/diff-viewer";
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
 * インタラクティブ diff ビューア
 * n/p キーでファイル間をナビゲート、Enter または q で終了
 */
async function interactiveDiffViewer(files: FileDiff[]): Promise<void> {
  if (files.length === 0) return;

  let currentIndex = 0;

  const showCurrentDiff = (): void => {
    // 画面クリア（スクロールバッファは保持）
    console.clear();
    showFileDiffBox(files[currentIndex], currentIndex, files.length, {
      showLineNumbers: true,
      maxLines: 30,
    });
  };

  return new Promise((resolve) => {
    // raw モードでキー入力を受け付け
    if (!process.stdin.isTTY) {
      // TTY でない場合は全ファイルを順次表示
      for (let i = 0; i < files.length; i++) {
        showFileDiffBox(files[i], i, files.length, { showLineNumbers: true });
      }
      resolve();
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    showCurrentDiff();

    const handleKeypress = (_str: string, key: readline.Key): void => {
      if (key.name === "n" || key.name === "right" || key.name === "down" || key.name === "j") {
        // 次のファイル
        if (currentIndex < files.length - 1) {
          currentIndex++;
          showCurrentDiff();
        }
      } else if (key.name === "p" || key.name === "left" || key.name === "up" || key.name === "k") {
        // 前のファイル
        if (currentIndex > 0) {
          currentIndex--;
          showCurrentDiff();
        }
      } else if (key.name === "return" || key.name === "q" || key.name === "escape") {
        // 終了
        cleanup();
        console.clear();
        resolve();
      } else if (key.ctrl && key.name === "c") {
        // Ctrl+C で終了
        cleanup();
        process.exit(0);
      }
    };

    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("keypress", handleKeypress);
    };

    process.stdin.on("keypress", handleKeypress);
  });
}

/**
 * diff を表示しながらファイルを選択するプロンプト
 * Option 2: サマリー → オプションで詳細確認 → ファイル選択
 */
export async function promptSelectFilesWithDiff(pushableFiles: FileDiff[]): Promise<FileDiff[]> {
  if (pushableFiles.length === 0) {
    return [];
  }

  // Step 1: サマリーボックスを表示
  showDiffSummaryBox(pushableFiles);

  // Step 2: 詳細確認するか確認
  const viewDetails = await confirm({
    message: "詳細な diff を確認しますか？",
    default: false,
  });

  if (viewDetails) {
    // Step 3: インタラクティブ diff ビューア
    await interactiveDiffViewer(pushableFiles);
    // 再度サマリーを表示
    showDiffSummaryBox(pushableFiles);
  }

  // Step 4: チェックボックスでファイル選択
  const filesWithStats = addStatsToFiles(pushableFiles);
  const choices = filesWithStats.map((file) => ({
    name: `${file.type === "added" ? "✚" : "⬡"} ${file.path} (${formatStats(file.stats)})`,
    value: file as FileDiff,
    checked: true,
  }));

  return checkbox<FileDiff>({
    message: "PR に含めるファイルを選択してください",
    choices,
  });
}

/**
 * ホワイトリスト外ファイルの追加確認プロンプト
 * 2ステップUI: フォルダ選択 → ファイル選択
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

  // Step 1: 詳細を確認するフォルダを選択
  const folderChoices = untrackedByFolder.map(({ folder, files }) => ({
    name: `${folder} (${files.length}件)`,
    value: folder,
    checked: true, // デフォルトで全選択
  }));

  const selectedFolders = await checkbox<string>({
    message: "詳細を確認するフォルダを選択してください",
    choices: folderChoices,
  });

  if (selectedFolders.length === 0) {
    return [];
  }

  // 選択されたフォルダのファイルのみを抽出
  const selectedFolderData = untrackedByFolder.filter((f) => selectedFolders.includes(f.folder));

  // Step 2: ファイルを選択（罫線付きツリー形式で表示）
  const allFileChoices: ({ name: string; value: UntrackedFile } | Separator)[] = [];

  for (const { folder, files } of selectedFolderData) {
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
