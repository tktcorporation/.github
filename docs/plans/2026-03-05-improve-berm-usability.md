# berm usability 改善 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** berm CLI の 4 つの使い勝手の問題を修正する（diff --verbose 未実装、pull 削除ファイル放置、track --list バグ、push --force 名前不一致）

**Architecture:** 各 Fix はファイル単位で独立しており、相互依存なし。TDD で進める（テスト追加 → 実装 → 通過確認 → コミット）。

**Tech Stack:** TypeScript, vitest, memfs（テスト用仮想FS）, @clack/prompts, citty

---

## Task 1: Fix 1 — `diff --verbose` の実装

**Files:**

- Modify: `packages/berm/src/commands/diff.ts`
- Modify: `packages/berm/src/commands/__tests__/diff.test.ts`

### Step 1: テストを追加（失敗させる）

`packages/berm/src/commands/__tests__/diff.test.ts` の `describe("run", ...)` 内に追加:

```typescript
it("--verbose のとき renderFileDiff を各変更ファイルに対して呼ぶ", async () => {
  vol.fromJSON({
    "/test/.devenv.json": JSON.stringify(validConfig),
  });

  const diffWithChanges = {
    files: [{ path: "new-file.txt", type: "added" as const, localContent: "content" }],
    summary: { added: 1, modified: 0, deleted: 0, unchanged: 0 },
  };

  mockDetectDiff.mockResolvedValueOnce(diffWithChanges);
  mockHasDiff.mockReturnValueOnce(true);

  await (diffCommand.run as any)({
    args: { dir: "/test", verbose: true },
    rawArgs: [],
    cmd: diffCommand,
  });

  const { renderFileDiff } = await import("../../ui/diff-view");
  expect(vi.mocked(renderFileDiff)).toHaveBeenCalledWith(diffWithChanges.files[0]);
});

it("--verbose なしのとき renderFileDiff を呼ばない", async () => {
  vol.fromJSON({
    "/test/.devenv.json": JSON.stringify(validConfig),
  });

  const diffWithChanges = {
    files: [{ path: "new-file.txt", type: "added" as const, localContent: "content" }],
    summary: { added: 1, modified: 0, deleted: 0, unchanged: 0 },
  };

  mockDetectDiff.mockResolvedValueOnce(diffWithChanges);
  mockHasDiff.mockReturnValueOnce(true);

  await (diffCommand.run as any)({
    args: { dir: "/test", verbose: false },
    rawArgs: [],
    cmd: diffCommand,
  });

  const { renderFileDiff } = await import("../../ui/diff-view");
  expect(vi.mocked(renderFileDiff)).not.toHaveBeenCalled();
});
```

また、ファイルの先頭の `vi.mock` セクションに `diff-view` モックを追加（既存の renderer モックの後に）:

```typescript
vi.mock("../../ui/diff-view", () => ({
  renderFileDiff: vi.fn(),
}));
```

### Step 2: テストが失敗することを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/diff.test.ts`
Expected: FAIL（`renderFileDiff` が呼ばれない）

### Step 3: diff.ts を修正

`packages/berm/src/commands/diff.ts` の先頭インポートに追加:

```typescript
import { renderFileDiff } from "../ui/diff-view";
```

`logDiffSummary(diff.files)` の直後（`if (untrackedCount > 0)` の前）に追加:

```typescript
// --verbose: 各ファイルの unified diff を表示
if (args.verbose) {
  for (const file of diff.files.filter((f) => f.type !== "unchanged")) {
    renderFileDiff(file);
  }
}
```

### Step 4: テストが通ることを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/diff.test.ts`
Expected: PASS

### Step 5: コミット

```bash
git add packages/berm/src/commands/diff.ts packages/berm/src/commands/__tests__/diff.test.ts
git commit -m "feat(berm): implement diff --verbose flag

--verbose 時に各変更ファイルの unified diff を renderFileDiff で表示する。
フラグは定義済みだったが run() 内で参照されていなかった。"
```

---

## Task 2: Fix 2 — `pull` 削除ファイルの実際の削除

**Files:**

- Modify: `packages/berm/src/commands/pull.ts`
- Modify: `packages/berm/src/commands/__tests__/pull.test.ts`

### Step 1: テストを追加（失敗させる）

`packages/berm/src/commands/__tests__/pull.test.ts` に以下を追加。

まず、ファイル先頭の `vi.mock` セクションに `ui/prompts` モックを追加:

```typescript
vi.mock("../../ui/prompts", () => ({
  selectDeletedFiles: vi.fn(),
}));
```

モック後のインポートに追加:

```typescript
const { selectDeletedFiles } = await import("../../ui/prompts");
const mockSelectDeletedFiles = vi.mocked(selectDeletedFiles);
```

`describe("run", ...)` 内に追加:

```typescript
it("削除ファイルがある場合に selectDeletedFiles を呼ぶ", async () => {
  vol.fromJSON({ "/test": null });

  mockClassifyFiles.mockReturnValueOnce({
    autoUpdate: [],
    localOnly: [],
    conflicts: [],
    newFiles: [],
    deletedFiles: ["old-file.txt"],
    unchanged: [],
  });
  mockSelectDeletedFiles.mockResolvedValueOnce([]);

  await (pullCommand.run as any)({
    args: { dir: "/test", force: false },
    rawArgs: [],
    cmd: pullCommand,
  });

  expect(mockSelectDeletedFiles).toHaveBeenCalledWith(["old-file.txt"]);
});

it("--force のとき selectDeletedFiles を呼ばずに全削除する", async () => {
  vol.fromJSON({
    "/test/old-file.txt": "old content",
  });

  mockClassifyFiles.mockReturnValueOnce({
    autoUpdate: [],
    localOnly: [],
    conflicts: [],
    newFiles: [],
    deletedFiles: ["old-file.txt"],
    unchanged: [],
  });

  await (pullCommand.run as any)({
    args: { dir: "/test", force: true },
    rawArgs: [],
    cmd: pullCommand,
  });

  expect(mockSelectDeletedFiles).not.toHaveBeenCalled();
  expect(vol.existsSync("/test/old-file.txt")).toBe(false);
});

it("selectDeletedFiles で選択したファイルのみ削除する", async () => {
  vol.fromJSON({
    "/test/a.txt": "aaa",
    "/test/b.txt": "bbb",
  });

  mockClassifyFiles.mockReturnValueOnce({
    autoUpdate: [],
    localOnly: [],
    conflicts: [],
    newFiles: [],
    deletedFiles: ["a.txt", "b.txt"],
    unchanged: [],
  });
  mockSelectDeletedFiles.mockResolvedValueOnce(["a.txt"]);

  await (pullCommand.run as any)({
    args: { dir: "/test", force: false },
    rawArgs: [],
    cmd: pullCommand,
  });

  expect(vol.existsSync("/test/a.txt")).toBe(false);
  expect(vol.existsSync("/test/b.txt")).toBe(true);
});
```

### Step 2: テストが失敗することを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/pull.test.ts`
Expected: FAIL

### Step 3: pull.ts を修正

`packages/berm/src/commands/pull.ts` のインポートに追加:

```typescript
import { rm } from "node:fs/promises"; // 既存の mkdir, readFile, writeFile と同じ行に追加
import { selectDeletedFiles } from "../ui/prompts";
```

Step 9（`// Step 9: 削除されたファイルの警告`）のブロックを以下に置き換える:

```typescript
// Step 9: 削除されたファイルを処理
if (classification.deletedFiles.length > 0) {
  let filesToDelete: string[];

  if (args.force) {
    // --force: 確認なしで全削除
    filesToDelete = classification.deletedFiles;
    log.info(`Deleting ${filesToDelete.length} file(s) removed from template...`);
  } else {
    // 通常: ユーザーに選択させる
    filesToDelete = await selectDeletedFiles(classification.deletedFiles);
  }

  for (const file of filesToDelete) {
    try {
      await rm(join(targetDir, file), { force: true });
      log.success(`Deleted: ${file}`);
    } catch {
      log.warn(`Could not delete: ${file}`);
    }
  }
}
```

### Step 4: テストが通ることを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/pull.test.ts`
Expected: PASS

### Step 5: コミット

```bash
git add packages/berm/src/commands/pull.ts packages/berm/src/commands/__tests__/pull.test.ts
git commit -m "feat(berm): implement pull delete file selection

--force 時は自動全削除、通常時は selectDeletedFiles() でユーザーに選択させる。
prompts.ts に実装済みだった selectDeletedFiles が未使用だったため利用。"
```

---

## Task 3: Fix 3 — `track --list` の `required: true` バグ修正

**Files:**

- Modify: `packages/berm/src/commands/track.ts`
- Modify: `packages/berm/src/commands/__tests__/track.test.ts`

### Step 1: テストを追加（失敗させる）

`packages/berm/src/commands/__tests__/track.test.ts` で、既存の `describe("track command - core logic", ...)` に加えて、`trackCommand` 自体の動作テストを追加する。

ファイルの先頭モックセクションを以下に置き換え（旧 `utils/ui` モックを `ui/renderer` モックに更新）:

```typescript
vi.mock("../../ui/renderer", () => ({
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
  pc: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
  },
}));
```

ファイル末尾に以下を追加:

```typescript
// trackCommand の統合テスト
const { trackCommand } = await import("../track");

describe("trackCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  it("--list のみで patterns なしでも動作する（required: false）", async () => {
    vol.fromJSON({
      "/project/.devenv/modules.jsonc": JSON.stringify({
        modules: [{ id: ".", name: "Root", description: "Root", patterns: [".mcp.json"] }],
      }),
    });

    // エラーなく完了することを確認
    await expect(
      (trackCommand.run as any)({
        args: {
          dir: "/project",
          list: true,
          module: undefined,
          name: undefined,
          description: undefined,
        },
        rawArgs: ["--list"],
        cmd: trackCommand,
      }),
    ).resolves.not.toThrow();
  });

  it("patterns も --list もない場合は BermError", async () => {
    vol.fromJSON({
      "/project/.devenv/modules.jsonc": JSON.stringify({
        modules: [],
      }),
    });

    // process.argv をモック（パターンなし）
    const origArgv = process.argv;
    process.argv = ["node", "berm", "track"];

    try {
      await expect(
        (trackCommand.run as any)({
          args: {
            dir: "/project",
            list: false,
            module: undefined,
            name: undefined,
            description: undefined,
          },
          rawArgs: [],
          cmd: trackCommand,
        }),
      ).rejects.toThrow();
    } finally {
      process.argv = origArgv;
    }
  });
});
```

### Step 2: テストが失敗することを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/track.test.ts`
Expected: 旧テストが `utils/ui` モックエラーで失敗するか、`--list` テストが citty の required チェックで失敗する

### Step 3: track.ts を修正

`packages/berm/src/commands/track.ts` の `patterns` 定義を変更:

```typescript
patterns: {
  type: "positional",
  description: "File paths or glob patterns to track (e.g., .cloud/rules/*.md)",
  required: false,  // --list 時はパターン不要。パターンなし+--listなしはrun()内でBermError
},
```

### Step 4: テストが通ることを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/track.test.ts`
Expected: PASS

### Step 5: コミット

```bash
git add packages/berm/src/commands/track.ts packages/berm/src/commands/__tests__/track.test.ts
git commit -m "fix(berm): track --list で required: true によるバグを修正

patterns の required を false に変更。--list 時はパターン不要なため。
パターンなし + --list なしの場合は run() 内の BermError がカバーする。"
```

---

## Task 4: Fix 4 — `push --force` → `--yes` へのリネーム

**Files:**

- Modify: `packages/berm/src/commands/push.ts`
- Modify: `packages/berm/src/commands/__tests__/push.test.ts`

### Step 1: テストを追加（失敗させる）

`packages/berm/src/commands/__tests__/push.test.ts` の既存テストを確認し、`--yes` フラグのテストを追加する。
モック後のインポートセクションに以下を追加（まだ追加されていない場合）:

```typescript
const { pushCommand } = await import("../push");
```

`describe("pushCommand", ...)` 内に追加:

```typescript
it("args に yes フラグが定義されている", () => {
  const args = pushCommand.args as Record<string, { type: string; default?: unknown }>;
  expect(args.yes).toBeDefined();
  expect(args.yes.default).toBe(false);
});

it("args に force フラグが定義されていない（yes に移行済み）", () => {
  const args = pushCommand.args as Record<string, unknown>;
  expect(args.force).toBeUndefined();
});
```

### Step 2: テストが失敗することを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/push.test.ts`
Expected: FAIL（`args.yes` が undefined、`args.force` が存在する）

### Step 3: push.ts を修正

`packages/berm/src/commands/push.ts` の `force` フラグ定義（420行付近）を以下に変更:

```typescript
yes: {
  type: "boolean",
  alias: ["y", "f"],  // -f は後方互換のため残す
  description: "Skip confirmation prompts",
  default: false,
},
```

ファイル内の `args.force` 参照（4箇所: 656, 673, 727, 868行付近）を全て `args.yes` に変更:

- `if (!args.force)` → `if (!args.yes)`
- `!args.force &&` → `!args.yes &&`

### Step 4: テストが通ることを確認

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run -- src/commands/__tests__/push.test.ts`
Expected: PASS

### Step 5: コミット

```bash
git add packages/berm/src/commands/push.ts packages/berm/src/commands/__tests__/push.test.ts
git commit -m "fix(berm): push --force を --yes にリネーム

init --force（上書き）と push --force（確認スキップ）でセマンティクスが異なったため修正。
--yes (-y) に変更。-f は後方互換のため alias として残す。"
```

---

## Task 5: 全テスト・ビルド・changeset

**Files:** なし（検証のみ）

### Step 1: フォーマットチェック & 修正

Run: `cd /home/user/.github && npx oxfmt --check .`
If fails: `npx oxfmt --write .` → その後 `git add -A && git commit -m "style: format"`

### Step 2: 全テスト

Run: `cd /home/user/.github && pnpm --filter @tktco/berm test:run`
Expected: ALL PASS

### Step 3: ビルド確認

Run: `cd /home/user/.github && pnpm build`
Expected: SUCCESS

### Step 4: changeset 追加

Run: `cd /home/user/.github && pnpm changeset add`

選択:

- Package: `@tktco/berm`
- Bump: `patch`
- Summary:
  ```
  Fix diff --verbose (now shows unified diff), pull deleted file selection prompt, track --list without patterns, and rename push --force to --yes (-f kept as alias)
  ```

### Step 5: 最終コミット & プッシュ

```bash
git add -A
git commit -m "chore(berm): add changeset for usability fixes"
git push -u origin claude/improve-berm-usability-L7vVL
```
