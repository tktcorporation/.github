/**
 * UI Utilities - モダンな CLI 出力ヘルパー
 *
 * create-t3-app, create-next-app, degit などを参考にした
 * 一貫性のある美しい出力を提供
 */

import { createSpinner } from "nanospinner";
import pc from "picocolors";

// ────────────────────────────────────────────────────────────────
// ブランドカラー & シンボル
// ────────────────────────────────────────────────────────────────

const S = {
  success: pc.green("✓"),
  error: pc.red("✗"),
  warning: pc.yellow("⚠"),
  info: pc.blue("●"),
  step: pc.cyan("◆"),
  arrow: pc.dim("→"),
  bar: pc.dim("│"),
  corner: pc.dim("└"),
  tee: pc.dim("├"),
} as const;

// ────────────────────────────────────────────────────────────────
// ロゴ & ヘッダー
// ────────────────────────────────────────────────────────────────

/**
 * グラデーションロゴを表示
 */
export function showLogo(): void {
  const gradient = [pc.cyan, pc.blue, pc.magenta];
  const lines = [
    "╔═══════════════════════════════════════╗",
    "║                                       ║",
    "║     create-devenv                     ║",
    "║     Dev Environment Template Manager  ║",
    "║                                       ║",
    "╚═══════════════════════════════════════╝",
  ];

  console.log();
  for (let i = 0; i < lines.length; i++) {
    const colorFn = gradient[Math.floor((i / lines.length) * gradient.length)];
    console.log(colorFn(lines[i]));
  }
  console.log();
}

/**
 * シンプルなヘッダーを表示
 */
export function showHeader(title: string, version?: string): void {
  console.log();
  const versionStr = version ? pc.dim(` v${version}`) : "";
  console.log(`${pc.bold(pc.cyan(title))}${versionStr}`);
  console.log(pc.dim("─".repeat(40)));
}

// ────────────────────────────────────────────────────────────────
// スピナー
// ────────────────────────────────────────────────────────────────

export interface Spinner {
  start: () => void;
  stop: () => void;
  success: (text?: string) => void;
  error: (text?: string) => void;
}

/**
 * スピナー付きのタスクを実行
 */
export function spinner(text: string): Spinner {
  const s = createSpinner(text, { color: "cyan" });
  return {
    start: () => s.start(),
    stop: () => s.stop(),
    success: (msg?: string) => s.success({ text: msg || text }),
    error: (msg?: string) => s.error({ text: msg || text }),
  };
}

/**
 * スピナー付きで非同期タスクを実行
 */
export async function withSpinner<T>(text: string, task: () => Promise<T>): Promise<T> {
  const s = spinner(text);
  s.start();
  try {
    const result = await task();
    s.success();
    return result;
  } catch (error) {
    s.error();
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────
// ステップ表示
// ────────────────────────────────────────────────────────────────

export interface StepContext {
  current: number;
  total: number;
}

/**
 * ステップを表示 (例: [1/3] テンプレートを取得中...)
 */
export function step(ctx: StepContext, message: string): void {
  const prefix = pc.dim(`[${ctx.current}/${ctx.total}]`);
  console.log(`${prefix} ${S.step} ${message}`);
}

/**
 * サブステップを表示 (インデント付き)
 */
export function substep(message: string, isLast = false): void {
  const prefix = isLast ? S.corner : S.tee;
  console.log(`     ${prefix} ${message}`);
}

// ────────────────────────────────────────────────────────────────
// メッセージ出力
// ────────────────────────────────────────────────────────────────

export const log = {
  /**
   * 成功メッセージ
   */
  success: (message: string): void => {
    console.log(`${S.success} ${message}`);
  },

  /**
   * エラーメッセージ
   */
  error: (message: string): void => {
    console.log(`${S.error} ${pc.red(message)}`);
  },

  /**
   * 警告メッセージ
   */
  warn: (message: string): void => {
    console.log(`${S.warning} ${pc.yellow(message)}`);
  },

  /**
   * 情報メッセージ
   */
  info: (message: string): void => {
    console.log(`${S.info} ${message}`);
  },

  /**
   * 薄い色のメッセージ
   */
  dim: (message: string): void => {
    console.log(pc.dim(`  ${message}`));
  },

  /**
   * 空行
   */
  newline: (): void => {
    console.log();
  },
};

// ────────────────────────────────────────────────────────────────
// ファイル操作結果
// ────────────────────────────────────────────────────────────────

export interface FileResult {
  action: "copied" | "created" | "overwritten" | "skipped" | "skipped_ignored";
  path: string;
}

const actionIcons: Record<FileResult["action"], string> = {
  copied: pc.green("+"),
  created: pc.green("+"),
  overwritten: pc.yellow("~"),
  skipped: pc.dim("-"),
  skipped_ignored: pc.yellow("⚠"),
};

const actionLabels: Record<FileResult["action"], string> = {
  copied: pc.green("added"),
  created: pc.green("added"),
  overwritten: pc.yellow("updated"),
  skipped: pc.dim("skipped"),
  skipped_ignored: pc.yellow("skipped (gitignore)"),
};

/**
 * ファイル操作結果を1行で表示
 */
export function logFileResult(result: FileResult): void {
  const icon = actionIcons[result.action];
  const label = actionLabels[result.action];
  const isSkipped = result.action === "skipped" || result.action === "skipped_ignored";
  const path = isSkipped ? pc.dim(result.path) : result.path;
  console.log(`  ${icon} ${path} ${pc.dim(`(${label})`)}`);
}

// ────────────────────────────────────────────────────────────────
// サマリー表示
// ────────────────────────────────────────────────────────────────

export interface Summary {
  added: number;
  updated: number;
  skipped: number;
  skippedIgnored: number;
}

/**
 * 操作結果からサマリーを計算
 */
export function calculateSummary(results: FileResult[]): Summary {
  return results.reduce(
    (acc, r) => {
      if (r.action === "copied" || r.action === "created") {
        acc.added++;
      } else if (r.action === "overwritten") {
        acc.updated++;
      } else if (r.action === "skipped_ignored") {
        acc.skippedIgnored++;
      } else {
        acc.skipped++;
      }
      return acc;
    },
    { added: 0, updated: 0, skipped: 0, skippedIgnored: 0 },
  );
}

/**
 * 完了サマリーを表示
 */
export function showSummary(summary: Summary): void {
  const parts: string[] = [];

  if (summary.added > 0) {
    parts.push(pc.green(`${summary.added} added`));
  }
  if (summary.updated > 0) {
    parts.push(pc.yellow(`${summary.updated} updated`));
  }
  if (summary.skipped > 0) {
    parts.push(pc.dim(`${summary.skipped} skipped`));
  }
  if (summary.skippedIgnored > 0) {
    parts.push(pc.yellow(`${summary.skippedIgnored} skipped (gitignore)`));
  }

  if (parts.length > 0) {
    console.log();
    console.log(pc.dim("─".repeat(40)));
    console.log(`${S.success} ${pc.bold("Done!")} ${parts.join(", ")}`);
  }
}

// ────────────────────────────────────────────────────────────────
// 次のステップ
// ────────────────────────────────────────────────────────────────

export interface NextStep {
  command?: string;
  description: string;
}

/**
 * 次のステップを表示
 */
export function showNextSteps(steps: NextStep[]): void {
  if (steps.length === 0) return;

  console.log();
  console.log(pc.bold("Next steps:"));
  console.log();

  for (const step of steps) {
    if (step.command) {
      console.log(`  ${S.arrow} ${pc.cyan(step.command)}`);
      console.log(`    ${pc.dim(step.description)}`);
    } else {
      console.log(`  ${S.arrow} ${step.description}`);
    }
  }
  console.log();
}

// ────────────────────────────────────────────────────────────────
// ボックス表示
// ────────────────────────────────────────────────────────────────

/**
 * ボックスで囲んだメッセージを表示
 */
export function box(message: string, type: "success" | "info" | "warning" = "info"): void {
  const colors = {
    success: pc.green,
    info: pc.cyan,
    warning: pc.yellow,
  };
  const color = colors[type];

  const width = message.length + 4;
  const top = color("╭" + "─".repeat(width - 2) + "╮");
  const bottom = color("╰" + "─".repeat(width - 2) + "╯");
  const middle = color("│") + " " + message + " " + color("│");

  console.log();
  console.log(top);
  console.log(middle);
  console.log(bottom);
  console.log();
}

// ────────────────────────────────────────────────────────────────
// diff 表示
// ────────────────────────────────────────────────────────────────

/**
 * diff ヘッダーを表示
 */
export function diffHeader(title: string): void {
  console.log();
  console.log(pc.bold(title));
  console.log(pc.dim("─".repeat(50)));
}

/**
 * diff ファイルを表示
 */
export function diffFile(path: string, type: "added" | "modified" | "deleted"): void {
  const icons = {
    added: pc.green("+ "),
    modified: pc.yellow("~ "),
    deleted: pc.red("- "),
  };
  const colors = {
    added: pc.green,
    modified: pc.yellow,
    deleted: pc.red,
  };
  console.log(`${icons[type]}${colors[type](path)}`);
}

// ────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────

/**
 * 相対パスを短く表示
 */
export function formatPath(path: string): string {
  return path.startsWith("./") ? path : `./${path}`;
}

/**
 * picocolors をエクスポート
 */
export { pc };
