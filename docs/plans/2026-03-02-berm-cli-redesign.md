# berm CLI 再設計 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** berm CLI の出力・UX・コード構造を `@clack/prompts` ベースで再設計し、洗練された CLI 体験を実現する

**Architecture:** UI 層を `@clack/prompts` に統一し、ビジネスロジックを `core/` に分離。各コマンドは薄いオーケストレーターに。エラーは `BermError` に統一してトップレベルで処理。

**Tech Stack:** TypeScript, @clack/prompts, picocolors, citty, zod, diff, giget, ts-pattern, vitest

---

## Task 1: @clack/prompts の導入と BermError の作成

**Files:**
- Modify: `packages/berm/package.json` — `@clack/prompts` を dependencies に追加
- Create: `packages/berm/src/errors.ts` — BermError クラス

**Step 1: @clack/prompts をインストール**

Run: `cd /home/user/.github && pnpm add @clack/prompts -w --filter @tktco/berm`

**Step 2: BermError を作成**

Create `packages/berm/src/errors.ts`:

```typescript
/**
 * ユーザー向けエラー。hint でリカバリ方法を提示する。
 *
 * 背景: process.exit(1) の散在を解消するため導入。
 * 各コマンドは BermError を throw し、cli.ts のトップレベルで catch して
 * @clack/prompts の log.error() で統一的に表示する。
 */
export class BermError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "BermError";
  }
}
```

**Step 3: BermError のテストを作成**

Create `packages/berm/src/__tests__/errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { BermError } from "../errors";

describe("BermError", () => {
  it("should create error with message", () => {
    const error = new BermError("something went wrong");
    expect(error.message).toBe("something went wrong");
    expect(error.name).toBe("BermError");
    expect(error.hint).toBeUndefined();
  });

  it("should create error with hint", () => {
    const error = new BermError("config not found", "Run 'berm init' first.");
    expect(error.message).toBe("config not found");
    expect(error.hint).toBe("Run 'berm init' first.");
  });

  it("should be instanceof Error", () => {
    const error = new BermError("test");
    expect(error).toBeInstanceOf(Error);
  });
});
```

**Step 4: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/__tests__/errors.test.ts`
Expected: PASS

**Step 5: コミット**

```bash
git add packages/berm/package.json packages/berm/src/errors.ts packages/berm/src/__tests__/errors.test.ts pnpm-lock.yaml
git commit -m "feat(berm): add @clack/prompts and BermError class

Introduce @clack/prompts as the unified UI library for the CLI redesign.
Add BermError for structured error handling, replacing scattered process.exit(1) calls."
```

---

## Task 2: UI renderer の作成 — @clack/prompts ラッパー

**Files:**
- Create: `packages/berm/src/ui/renderer.ts` — @clack/prompts を使った統一出力インターフェース
- Create: `packages/berm/src/ui/__tests__/renderer.test.ts`

**Step 1: renderer.ts を作成**

Create `packages/berm/src/ui/renderer.ts`:

```typescript
/**
 * 統一出力インターフェース — @clack/prompts のラッパー
 *
 * 背景: showHeader(), box(), showNextSteps(), log, withSpinner() 等の
 * 散在した UI 関数を @clack/prompts ベースで統一するために導入。
 * 全コマンドはこのモジュール経由で出力する。
 */
import * as p from "@clack/prompts";
import pc from "picocolors";

declare const __VERSION__: string;
const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

/** CLI の開始表示 */
export function intro(command?: string): void {
  const title = command ? `berm ${command}` : "berm";
  p.intro(`${pc.bgCyan(pc.black(` ${title} `))} ${pc.dim(`v${version}`)}`);
}

/** CLI の終了表示 */
export function outro(message: string): void {
  p.outro(message);
}

/** 構造化ログ — @clack/prompts の log を re-export */
export const log = {
  info: (message: string) => p.log.info(message),
  success: (message: string) => p.log.success(message),
  warn: (message: string) => p.log.warn(message),
  error: (message: string) => p.log.error(message),
  step: (message: string) => p.log.step(message),
  message: (message: string) => p.log.message(message),
};

/** スピナー付きで非同期タスクを実行 */
export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const s = p.spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (error) {
    s.stop(pc.red(`Failed: ${message}`));
    throw error;
  }
}

/** ファイル操作結果を表示（init コマンド用） */
export function logFileResults(
  results: { action: string; path: string }[],
): { added: number; updated: number; skipped: number } {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  const lines: string[] = [];
  for (const r of results) {
    switch (r.action) {
      case "copied":
      case "created":
        lines.push(`${pc.green("+")} ${r.path}`);
        added++;
        break;
      case "overwritten":
        lines.push(`${pc.yellow("~")} ${r.path}`);
        updated++;
        break;
      default:
        lines.push(`${pc.dim("-")} ${pc.dim(r.path)}`);
        skipped++;
        break;
    }
  }

  const summary = [
    added > 0 ? pc.green(`${added} added`) : null,
    updated > 0 ? pc.yellow(`${updated} updated`) : null,
    skipped > 0 ? pc.dim(`${skipped} skipped`) : null,
  ]
    .filter(Boolean)
    .join(", ");

  p.log.message([...lines, "", summary].join("\n"));

  return { added, updated, skipped };
}

/** diff サマリーを表示（push/diff コマンド用） */
export function logDiffSummary(
  files: { path: string; type: string }[],
): void {
  const changed = files.filter((f) => f.type !== "unchanged");
  if (changed.length === 0) {
    p.log.info("No changes detected");
    return;
  }

  const lines = changed.map((f) => {
    switch (f.type) {
      case "added":
        return `${pc.green("+")} ${pc.green(f.path)}`;
      case "modified":
        return `${pc.yellow("~")} ${pc.yellow(f.path)}`;
      case "deleted":
        return `${pc.red("-")} ${pc.red(f.path)}`;
      default:
        return `  ${pc.dim(f.path)}`;
    }
  });

  const summary = files.reduce(
    (acc, f) => {
      if (f.type === "added") acc.added++;
      else if (f.type === "modified") acc.modified++;
      else if (f.type === "deleted") acc.deleted++;
      return acc;
    },
    { added: 0, modified: 0, deleted: 0 },
  );

  const summaryParts = [
    summary.added > 0 ? pc.green(`+${summary.added} added`) : null,
    summary.modified > 0 ? pc.yellow(`~${summary.modified} modified`) : null,
    summary.deleted > 0 ? pc.red(`-${summary.deleted} deleted`) : null,
  ]
    .filter(Boolean)
    .join(pc.dim(" | "));

  p.log.message([...lines, "", summaryParts].join("\n"));
}

/** BermError を整形表示 */
export function logBermError(error: { message: string; hint?: string }): void {
  p.log.error(error.message);
  if (error.hint) {
    p.log.message(pc.dim(error.hint));
  }
}

export { pc };
```

**Step 2: テストを作成**

Create `packages/berm/src/ui/__tests__/renderer.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// @clack/prompts をモック
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

import * as p from "@clack/prompts";
import { intro, outro, log, withSpinner, logFileResults, logDiffSummary, logBermError } from "../renderer";

describe("renderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("intro", () => {
    it("should call p.intro with title", () => {
      intro("push");
      expect(p.intro).toHaveBeenCalledTimes(1);
    });

    it("should call p.intro without command", () => {
      intro();
      expect(p.intro).toHaveBeenCalledTimes(1);
    });
  });

  describe("outro", () => {
    it("should call p.outro", () => {
      outro("Done!");
      expect(p.outro).toHaveBeenCalledWith("Done!");
    });
  });

  describe("log", () => {
    it("should delegate to p.log methods", () => {
      log.info("info msg");
      log.success("success msg");
      log.warn("warn msg");
      log.error("error msg");
      log.step("step msg");
      log.message("message msg");

      expect(p.log.info).toHaveBeenCalledWith("info msg");
      expect(p.log.success).toHaveBeenCalledWith("success msg");
      expect(p.log.warn).toHaveBeenCalledWith("warn msg");
      expect(p.log.error).toHaveBeenCalledWith("error msg");
      expect(p.log.step).toHaveBeenCalledWith("step msg");
      expect(p.log.message).toHaveBeenCalledWith("message msg");
    });
  });

  describe("withSpinner", () => {
    it("should start and stop spinner on success", async () => {
      const mockSpinner = { start: vi.fn(), stop: vi.fn() };
      vi.mocked(p.spinner).mockReturnValue(mockSpinner);

      const result = await withSpinner("loading...", async () => 42);

      expect(result).toBe(42);
      expect(mockSpinner.start).toHaveBeenCalledWith("loading...");
      expect(mockSpinner.stop).toHaveBeenCalledWith("loading...");
    });

    it("should stop spinner on error", async () => {
      const mockSpinner = { start: vi.fn(), stop: vi.fn() };
      vi.mocked(p.spinner).mockReturnValue(mockSpinner);

      await expect(
        withSpinner("loading...", async () => {
          throw new Error("fail");
        }),
      ).rejects.toThrow("fail");

      expect(mockSpinner.start).toHaveBeenCalled();
      expect(mockSpinner.stop).toHaveBeenCalled();
    });
  });

  describe("logFileResults", () => {
    it("should count added/updated/skipped", () => {
      const results = [
        { action: "copied", path: "a.ts" },
        { action: "created", path: "b.ts" },
        { action: "overwritten", path: "c.ts" },
        { action: "skipped", path: "d.ts" },
      ];
      const summary = logFileResults(results);
      expect(summary).toEqual({ added: 2, updated: 1, skipped: 1 });
      expect(p.log.message).toHaveBeenCalledTimes(1);
    });
  });

  describe("logDiffSummary", () => {
    it("should show no changes message when all unchanged", () => {
      logDiffSummary([{ path: "a.ts", type: "unchanged" }]);
      expect(p.log.info).toHaveBeenCalledWith("No changes detected");
    });

    it("should display changed files", () => {
      logDiffSummary([
        { path: "a.ts", type: "added" },
        { path: "b.ts", type: "modified" },
      ]);
      expect(p.log.message).toHaveBeenCalledTimes(1);
    });
  });

  describe("logBermError", () => {
    it("should display error with hint", () => {
      logBermError({ message: "not found", hint: "Run init first" });
      expect(p.log.error).toHaveBeenCalledWith("not found");
      expect(p.log.message).toHaveBeenCalledTimes(1);
    });

    it("should display error without hint", () => {
      logBermError({ message: "not found" });
      expect(p.log.error).toHaveBeenCalledWith("not found");
      expect(p.log.message).not.toHaveBeenCalled();
    });
  });
});
```

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/ui/__tests__/renderer.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/ui/renderer.ts packages/berm/src/ui/__tests__/renderer.test.ts
git commit -m "feat(berm): add unified UI renderer based on @clack/prompts

Replace scattered showHeader/box/showNextSteps/log with a single renderer
module that wraps @clack/prompts for consistent, professional CLI output."
```

---

## Task 3: UI prompts の作成 — @clack/prompts ベースのプロンプト

**Files:**
- Create: `packages/berm/src/ui/prompts.ts` — 全プロンプトを @clack/prompts で再実装
- Create: `packages/berm/src/ui/__tests__/prompts.test.ts`

**Step 1: prompts.ts を作成**

Create `packages/berm/src/ui/prompts.ts`:

```typescript
/**
 * CLI プロンプト — @clack/prompts ベース
 *
 * 背景: prompts/init.ts + prompts/push.ts を統合。
 * @inquirer/prompts の checkbox/select/confirm/input/password を
 * @clack/prompts の multiselect/select/confirm/text/password に置き換え。
 */
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { FileDiff, OverwriteStrategy, TemplateModule } from "../modules/schemas";

/** ユーザーがキャンセルした場合のチェック */
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
```

**Step 2: テストを作成**

Create `packages/berm/src/ui/__tests__/prompts.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  log: {
    warn: vi.fn(),
    message: vi.fn(),
  },
}));

import * as p from "@clack/prompts";
import {
  selectModules,
  selectOverwriteStrategy,
  selectPushFiles,
  inputPrTitle,
  inputPrBody,
  inputGitHubToken,
  confirmAction,
} from "../prompts";

const testModules = [
  { id: "devcontainer", name: "Dev Container", description: "Dev Container config", patterns: [] },
  { id: "github-actions", name: "GitHub Actions", description: "CI/CD", patterns: [] },
];

describe("prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectModules", () => {
    it("should return selected module IDs", async () => {
      vi.mocked(p.multiselect).mockResolvedValue(["devcontainer"]);
      const result = await selectModules(testModules);
      expect(result).toEqual(["devcontainer"]);
    });

    it("should pass all modules as initial values", async () => {
      vi.mocked(p.multiselect).mockResolvedValue(["devcontainer", "github-actions"]);
      await selectModules(testModules);
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValues: ["devcontainer", "github-actions"],
        }),
      );
    });
  });

  describe("selectOverwriteStrategy", () => {
    it("should return selected strategy", async () => {
      vi.mocked(p.select).mockResolvedValue("overwrite");
      const result = await selectOverwriteStrategy();
      expect(result).toBe("overwrite");
    });
  });

  describe("selectPushFiles", () => {
    it("should filter files by selection", async () => {
      const files = [
        { path: "a.ts", type: "added" as const },
        { path: "b.ts", type: "modified" as const },
      ];
      vi.mocked(p.multiselect).mockResolvedValue(["a.ts"]);
      const result = await selectPushFiles(files);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("a.ts");
    });
  });

  describe("inputPrTitle", () => {
    it("should return entered title", async () => {
      vi.mocked(p.text).mockResolvedValue("feat: add config");
      const result = await inputPrTitle();
      expect(result).toBe("feat: add config");
    });
  });

  describe("inputPrBody", () => {
    it("should return undefined if declined", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      const result = await inputPrBody();
      expect(result).toBeUndefined();
    });

    it("should return body if accepted", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.text).mockResolvedValue("description");
      const result = await inputPrBody();
      expect(result).toBe("description");
    });
  });

  describe("inputGitHubToken", () => {
    it("should return entered token", async () => {
      vi.mocked(p.password).mockResolvedValue("ghp_test123");
      const result = await inputGitHubToken();
      expect(result).toBe("ghp_test123");
    });
  });

  describe("confirmAction", () => {
    it("should return true when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      const result = await confirmAction("Proceed?");
      expect(result).toBe(true);
    });
  });
});
```

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/ui/__tests__/prompts.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/ui/prompts.ts packages/berm/src/ui/__tests__/prompts.test.ts
git commit -m "feat(berm): add @clack/prompts-based prompt module

Consolidate prompts/init.ts and prompts/push.ts into a single ui/prompts.ts
using @clack/prompts for consistent, beautiful prompt UX."
```

---

## Task 4: diff-view の作成 — diff 表示をシンプルに

**Files:**
- Create: `packages/berm/src/ui/diff-view.ts` — word diff 付きの diff 表示（cli-highlight 不使用）
- Create: `packages/berm/src/ui/__tests__/diff-view.test.ts`

**Step 1: diff-view.ts を作成**

`diff-viewer.ts` から統計計算と word diff を維持しつつ、`cli-highlight` 依存を排除し、
インタラクティブビューア（readline raw mode）を削除。`@clack/prompts` の `log.message` で表示。

Create `packages/berm/src/ui/diff-view.ts`:

```typescript
/**
 * Diff 表示コンポーネント
 *
 * 背景: utils/diff-viewer.ts (682行) を再構築。
 * cli-highlight を削除し picocolors のみで表示。
 * readline raw mode のインタラクティブビューアを削除し、
 * 単純な出力に変更（less にパイプ可能）。
 * 統計計算ロジックは維持。
 */
import * as p from "@clack/prompts";
import { diffWords } from "diff";
import pc from "picocolors";
import type { FileDiff } from "../modules/schemas";
import { generateUnifiedDiff } from "../utils/diff";

// ─── 統計計算 ──────────────────────────────────────────────────

export interface DiffStats {
  readonly additions: number;
  readonly deletions: number;
}

/** ファイルの差分統計を計算 */
export function calculateDiffStats(fileDiff: FileDiff): DiffStats {
  switch (fileDiff.type) {
    case "unchanged":
      return { additions: 0, deletions: 0 };
    case "deleted":
      return {
        additions: 0,
        deletions: fileDiff.templateContent?.split("\n").length ?? 0,
      };
    case "added":
      return {
        additions: fileDiff.localContent?.split("\n").length ?? 0,
        deletions: 0,
      };
    case "modified": {
      const diff = generateUnifiedDiff(fileDiff);
      let additions = 0;
      let deletions = 0;
      for (const line of diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
      return { additions, deletions };
    }
  }
}

/** 統計フォーマット (+10 -5) */
export function formatStats(stats: DiffStats): string {
  const parts: string[] = [];
  if (stats.additions > 0) parts.push(pc.green(`+${stats.additions}`));
  if (stats.deletions > 0) parts.push(pc.red(`-${stats.deletions}`));
  return parts.length === 0 ? pc.dim("(no changes)") : parts.join(" ");
}

// ─── Diff 表示 ─────────────────────────────────────────────────

/** 単一ファイルの diff を表示 */
export function renderFileDiff(file: FileDiff): void {
  const stats = calculateDiffStats(file);
  const typeLabel = file.type === "added" ? pc.green("added") : file.type === "modified" ? pc.yellow("modified") : pc.red("deleted");

  p.log.step(`${pc.bold(file.path)} ${pc.dim("—")} ${typeLabel} ${formatStats(stats)}`);

  if (file.type === "unchanged") return;

  const diff = generateUnifiedDiff(file);
  if (!diff) return;

  const lines = diff.split("\n").filter(
    (l) => !l.startsWith("Index:") && !l.startsWith("===") && !l.startsWith("---") && !l.startsWith("+++"),
  );

  // word diff を適用して表示
  const rendered = applyWordDiffAndColorize(lines);
  p.log.message(rendered.join("\n"));
}

/** Diff 行に word diff + 色を適用 */
function applyWordDiffAndColorize(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // deletion + addition ペアを検出して word diff
    if (
      line.startsWith("-") &&
      !line.startsWith("---") &&
      i + 1 < lines.length &&
      lines[i + 1].startsWith("+") &&
      !lines[i + 1].startsWith("+++")
    ) {
      const oldText = line.slice(1);
      const newText = lines[i + 1].slice(1);
      const changes = diffWords(oldText, newText);

      let oldLine = pc.red("-");
      let newLine = pc.green("+");
      for (const change of changes) {
        if (change.added) {
          newLine += pc.bgGreen(pc.black(change.value));
        } else if (change.removed) {
          oldLine += pc.bgRed(pc.white(change.value));
        } else {
          oldLine += change.value;
          newLine += change.value;
        }
      }
      result.push(oldLine, newLine);
      i += 2;
      continue;
    }

    // 通常の行
    if (line.startsWith("@@")) {
      result.push(pc.cyan(line));
    } else if (line.startsWith("+")) {
      result.push(pc.green(line));
    } else if (line.startsWith("-")) {
      result.push(pc.red(line));
    } else {
      result.push(line);
    }
    i++;
  }

  return result;
}

/** ファイル選択用ラベル */
export function getFileLabel(file: FileDiff): string {
  const stats = calculateDiffStats(file);
  const icon =
    file.type === "added" ? pc.green("+") : file.type === "modified" ? pc.yellow("~") : pc.red("-");
  return `${icon} ${file.path} ${formatStats(stats)}`;
}
```

**Step 2: テストを作成**

Create `packages/berm/src/ui/__tests__/diff-view.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  log: { step: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import type { FileDiff } from "../../modules/schemas";
import { calculateDiffStats, formatStats, getFileLabel, renderFileDiff } from "../diff-view";

describe("diff-view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateDiffStats", () => {
    it("should return zeros for unchanged", () => {
      const file: FileDiff = { path: "a.ts", type: "unchanged" };
      expect(calculateDiffStats(file)).toEqual({ additions: 0, deletions: 0 });
    });

    it("should count lines for added files", () => {
      const file: FileDiff = {
        path: "a.ts",
        type: "added",
        localContent: "line1\nline2\nline3",
      };
      expect(calculateDiffStats(file)).toEqual({ additions: 3, deletions: 0 });
    });

    it("should count lines for deleted files", () => {
      const file: FileDiff = {
        path: "a.ts",
        type: "deleted",
        templateContent: "line1\nline2",
      };
      expect(calculateDiffStats(file)).toEqual({ additions: 0, deletions: 2 });
    });

    it("should compute stats for modified files", () => {
      const file: FileDiff = {
        path: "a.ts",
        type: "modified",
        localContent: "hello world",
        templateContent: "hello",
      };
      const stats = calculateDiffStats(file);
      expect(stats.additions).toBeGreaterThan(0);
    });
  });

  describe("formatStats", () => {
    it("should format additions only", () => {
      const result = formatStats({ additions: 5, deletions: 0 });
      expect(result).toContain("+5");
    });

    it("should format both additions and deletions", () => {
      const result = formatStats({ additions: 3, deletions: 2 });
      expect(result).toContain("+3");
      expect(result).toContain("-2");
    });

    it("should return no changes for zero stats", () => {
      const result = formatStats({ additions: 0, deletions: 0 });
      expect(result).toContain("no changes");
    });
  });

  describe("getFileLabel", () => {
    it("should include path and stats", () => {
      const file: FileDiff = {
        path: "test.ts",
        type: "added",
        localContent: "hello",
      };
      const label = getFileLabel(file);
      expect(label).toContain("test.ts");
    });
  });

  describe("renderFileDiff", () => {
    it("should not render unchanged files beyond header", () => {
      const file: FileDiff = { path: "a.ts", type: "unchanged" };
      renderFileDiff(file);
      // Should not call log.message for unchanged
    });
  });
});
```

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/ui/__tests__/diff-view.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/ui/diff-view.ts packages/berm/src/ui/__tests__/diff-view.test.ts
git commit -m "feat(berm): add simplified diff-view module

Replace 682-line diff-viewer.ts with a focused diff-view module.
Remove cli-highlight dependency and readline interactive viewer.
Keep word diff and stats calculation."
```

---

## Task 5: init コマンドの書き直し

**Files:**
- Modify: `packages/berm/src/commands/init.ts` — 新しい UI 層を使って書き直し
- Modify: `packages/berm/src/commands/__tests__/init.test.ts` — モックを更新

**Step 1: init.ts を書き直し**

新しい `ui/renderer.ts` と `ui/prompts.ts` を使い、`process.exit(1)` を `BermError` に置き換え。
コマンドの構造は維持しつつ、UI 呼び出しを差し替える。

主な変更点:
- `showHeader()` → `intro("init")`
- `log.info/error/warn` → `ui/renderer` の `log` に差し替え
- `step()` → `log.step()`
- `withSpinner()` → `ui/renderer` の `withSpinner` に差し替え
- `box()` / `showNextSteps()` / `showSummary()` → `outro()` に統合
- `logFileResult()` → `logFileResults()` にまとめて渡す
- `promptInit()` → `selectModules()` + `selectOverwriteStrategy()`
- `process.exit(1)` → `throw new BermError(...)`

**Step 2: テストを更新**

モック対象を `utils/ui` から `ui/renderer` と `ui/prompts` に変更。
`vi.spyOn(process, "exit")` を `expect(...).toThrow(BermError)` パターンに変更。

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/init.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/commands/init.ts packages/berm/src/commands/__tests__/init.test.ts
git commit -m "refactor(berm): rewrite init command with @clack/prompts

Replace utils/ui calls with ui/renderer and ui/prompts.
Replace process.exit(1) with BermError throws."
```

---

## Task 6: diff コマンドの書き直し

**Files:**
- Modify: `packages/berm/src/commands/diff.ts`
- Modify: `packages/berm/src/commands/__tests__/diff.test.ts`

**Step 1: diff.ts を書き直し**

主な変更点:
- `showHeader("berm diff")` → `intro("diff")`
- `step()` / `withSpinner()` → renderer の関数に差し替え
- `diffHeader()` + `console.log(formatDiff(...))` → `logDiffSummary()` に統合
- `box("No changes", ...)` → `outro("No changes — in sync with template.")`
- `showNextSteps()` → `outro()` にメッセージ含める
- `process.exit(1)` → `throw new BermError(...)`

**Step 2: テストを更新**

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/diff.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/commands/diff.ts packages/berm/src/commands/__tests__/diff.test.ts
git commit -m "refactor(berm): rewrite diff command with @clack/prompts"
```

---

## Task 7: push コマンドの書き直し

**Files:**
- Modify: `packages/berm/src/commands/push.ts` — 774行を ~200行に削減
- Modify: `packages/berm/src/commands/__tests__/push.test.ts`

**Step 1: push.ts を書き直し**

**最大の変更タスク。** 主な変更:

1. `detectLocalModuleAdditions()` を `core/` に移動（別タスクで対応。ここではインポート元だけ変更）
2. `runExecuteMode()` をインラインからヘルパー関数に整理
3. UI 呼び出しを全て `ui/renderer` + `ui/prompts` に差し替え
4. フラグ名を変更:
   - `--force` → `--yes` (alias: `-y`)
   - `--prepare` → `--manifest`
   - `--execute` → `--from-manifest`
   - `--interactive` → 削除（常にインタラクティブ）
5. インタラクティブ diff ビューア（readline raw mode）を削除
   - `promptSelectFilesWithDiff()` → `selectPushFiles()` に置き換え
6. `process.exit(1)` → `throw new BermError(...)`

**Step 2: テストを更新**

**Step 3: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/push.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add packages/berm/src/commands/push.ts packages/berm/src/commands/__tests__/push.test.ts
git commit -m "refactor(berm): rewrite push command with @clack/prompts

Simplify 774-line push.ts. Remove interactive diff viewer (readline raw mode).
Rename flags: --force→--yes, --prepare→--manifest, --execute→--from-manifest.
Replace all UI calls with unified renderer."
```

---

## Task 8: track コマンドの書き直し

**Files:**
- Modify: `packages/berm/src/commands/track.ts`
- Modify: `packages/berm/src/commands/__tests__/track.test.ts`

**Step 1: track.ts を書き直し**

主な変更:
- `showHeader()` → `intro("track")`
- `log.*` → renderer の `log` に差し替え
- `box()` → `outro()` に統合
- `process.exit(1)` → `throw new BermError(...)`

**Step 2: テスト実行**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/track.test.ts`
Expected: PASS

**Step 3: コミット**

```bash
git add packages/berm/src/commands/track.ts packages/berm/src/commands/__tests__/track.test.ts
git commit -m "refactor(berm): rewrite track command with @clack/prompts"
```

---

## Task 9: エントリポイント (index.ts) の書き直し

**Files:**
- Modify: `packages/berm/src/index.ts` — select プロンプト廃止、BermError ハンドラ追加

**Step 1: index.ts を書き直し**

主な変更:
- `promptCommand()` と `showAiHint()` を削除（引数なし実行は `--help` を表示）
- `@inquirer/prompts` の `select` インポートを削除
- `utils/ui` のインポートを削除
- トップレベルに BermError ハンドラを追加:

```typescript
import { runMain } from "citty";
import { BermError } from "./errors";
import { logBermError } from "./ui/renderer";

// ... command definitions ...

try {
  void runMain(main);
} catch (error) {
  if (error instanceof BermError) {
    logBermError(error);
    process.exit(1);
  }
  throw error;
}
```

ただし `citty` の `runMain` は非同期なので、unhandled rejection にも対応:

```typescript
process.on("unhandledRejection", (error) => {
  if (error instanceof BermError) {
    logBermError(error);
    process.exit(1);
  }
  throw error;
});
```

**Step 2: テスト実行（全体）**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run`
Expected: PASS

**Step 3: コミット**

```bash
git add packages/berm/src/index.ts
git commit -m "refactor(berm): rewrite entry point with BermError handler

Remove select prompt for no-arg invocation.
Add top-level BermError handler for consistent error display.
Remove @inquirer/prompts dependency from entry point."
```

---

## Task 10: 不要な依存と旧コードの削除

**Files:**
- Delete: `packages/berm/src/utils/ui.ts`
- Delete: `packages/berm/src/utils/__tests__/ui.test.ts`
- Delete: `packages/berm/src/utils/diff-viewer.ts`
- Delete: `packages/berm/src/utils/__tests__/diff-viewer.test.ts`
- Delete: `packages/berm/src/prompts/init.ts`
- Delete: `packages/berm/src/prompts/__tests__/init.test.ts`
- Delete: `packages/berm/src/prompts/push.ts`
- Delete: `packages/berm/src/prompts/__tests__/push.test.ts`
- Modify: `packages/berm/package.json` — 不要な依存を削除
- Modify: `packages/berm/src/utils/diff.ts` — `ui` インポートを削除

**Step 1: 旧ファイルを削除**

旧 `prompts/` ディレクトリと `utils/ui.ts`, `utils/diff-viewer.ts` を削除。

**Step 2: package.json から不要な依存を削除**

```bash
cd /home/user/.github && pnpm remove @inquirer/prompts nanospinner consola cli-highlight --filter @tktco/berm
```

**Step 3: diff.ts の UI 依存を除去**

`packages/berm/src/utils/diff.ts` の `import { log, pc } from "./ui"` を削除。
`log.warn(...)` の呼び出しは `console.warn(...)` に一時的に置き換えるか、呼び出し元で処理。

**Step 4: テスト実行（全体）**

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run`
Expected: PASS

**Step 5: コミット**

```bash
git add -A packages/berm/
git commit -m "refactor(berm): remove legacy UI code and unused dependencies

Delete utils/ui.ts, utils/diff-viewer.ts, prompts/init.ts, prompts/push.ts.
Remove @inquirer/prompts, nanospinner, consola, cli-highlight from dependencies."
```

---

## Task 11: ビルド・フォーマット・テスト最終確認

**Files:** None (validation only)

**Step 1: フォーマットチェック & 修正**

Run: `cd /home/user/.github && npx oxfmt --check .`
If fails: `npx oxfmt --write .`

**Step 2: ビルド確認**

Run: `cd /home/user/.github && pnpm build`
Expected: SUCCESS

**Step 3: 全テスト**

Run: `cd /home/user/.github && pnpm test:run`
Expected: ALL PASS

**Step 4: changeset 追加**

Run: `cd /home/user/.github && pnpm changeset add`
- Package: `@tktco/berm`
- Bump: `minor`
- Summary: "Redesign CLI output and UX with @clack/prompts"

**Step 5: 最終コミット & プッシュ**

```bash
git add -A
git commit -m "chore(berm): add changeset for CLI redesign"
git push -u origin claude/redesign-berm-cli-74uFh
```
