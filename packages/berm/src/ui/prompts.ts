/**
 * CLI プロンプト — @clack/prompts ベース
 *
 * 背景: prompts/init.ts + prompts/push.ts を統合。
 * @inquirer/prompts の checkbox/select/confirm/input/password を
 * @clack/prompts の multiselect/select/confirm/text/password に置き換え。
 *
 * 全プロンプトは Ctrl+C でキャンセル可能。handleCancel() で統一処理。
 */
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { FileDiff, OverwriteStrategy, TemplateModule } from "../modules/schemas";

/** ユーザーが Ctrl+C でキャンセルした場合の統一処理 */
function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}

// ─── init ─────────────────────────────────────────────────────

/** モジュール選択 */
export async function selectModules(moduleList: TemplateModule[]): Promise<string[]> {
  const selected = await p.multiselect({
    message: "Select modules to install",
    options: moduleList.map((m) => ({
      value: m.id,
      label: m.name,
      hint: m.description,
    })),
    initialValues: moduleList.map((m) => m.id),
    required: true,
  });
  handleCancel(selected);
  return selected as string[];
}

/** 上書き戦略の選択 */
export async function selectOverwriteStrategy(): Promise<OverwriteStrategy> {
  const strategy = await p.select({
    message: "How to handle existing files?",
    options: [
      { value: "prompt" as const, label: "Ask for each file" },
      { value: "overwrite" as const, label: "Overwrite all" },
      { value: "skip" as const, label: "Skip (keep existing)" },
    ],
  });
  handleCancel(strategy);
  return strategy as OverwriteStrategy;
}

// ─── push ─────────────────────────────────────────────────────

/** push 対象ファイルの選択 */
export async function selectPushFiles(files: FileDiff[]): Promise<FileDiff[]> {
  const typeIcon = (type: string) => {
    switch (type) {
      case "added":
        return pc.green("+");
      case "modified":
        return pc.yellow("~");
      case "deleted":
        return pc.red("-");
      default:
        return " ";
    }
  };

  const selected = await p.multiselect({
    message: "Select files to include in PR",
    options: files.map((f) => ({
      value: f.path,
      label: `${typeIcon(f.type)} ${f.path}`,
    })),
    initialValues: files.map((f) => f.path),
    required: false,
  });
  handleCancel(selected);
  const selectedPaths = new Set(selected as string[]);
  return files.filter((f) => selectedPaths.has(f.path));
}

/** PR タイトル入力 */
export async function inputPrTitle(defaultTitle?: string): Promise<string> {
  const title = await p.text({
    message: "PR title",
    placeholder: defaultTitle || "feat: update template config",
    validate: (value) => {
      if (!value.trim()) return "Title is required";
    },
  });
  handleCancel(title);
  return title as string;
}

/** PR 本文入力（任意） */
export async function inputPrBody(): Promise<string | undefined> {
  const addBody = await p.confirm({
    message: "Add a PR description?",
    initialValue: false,
  });
  handleCancel(addBody);

  if (!addBody) return undefined;

  const body = await p.text({
    message: "PR description",
  });
  handleCancel(body);
  return body as string;
}

/** GitHub トークン入力 */
export async function inputGitHubToken(): Promise<string> {
  p.log.warn("GitHub token not found.");
  p.log.message(
    [
      "Set one of these environment variables:",
      `  ${pc.cyan("GITHUB_TOKEN")} or ${pc.cyan("GH_TOKEN")}`,
      "",
      "Or enter it below:",
    ].join("\n"),
  );

  const token = await p.password({
    message: "GitHub Personal Access Token",
    validate: (value) => {
      if (!value.trim()) return "Token is required";
      if (
        !value.startsWith("ghp_") &&
        !value.startsWith("gho_") &&
        !value.startsWith("github_pat_")
      ) {
        return "Invalid GitHub token format";
      }
    },
  });
  handleCancel(token);
  return token as string;
}

/** 確認プロンプト */
export async function confirmAction(message: string): Promise<boolean> {
  const confirmed = await p.confirm({
    message,
    initialValue: false,
  });
  handleCancel(confirmed);
  return confirmed as boolean;
}
