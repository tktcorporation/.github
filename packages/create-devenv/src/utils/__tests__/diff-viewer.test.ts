import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../modules/schemas";
import {
  addStatsToFiles,
  calculateDiffStats,
  calculateTotalStats,
  formatStats,
  formatStatsWithLabel,
  getFileLabel,
  groupFilesByType,
  showDiffSummaryBox,
  showFileDiffBox,
} from "../diff-viewer";

// console.log をモック
const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

describe("calculateDiffStats", () => {
  it("unchanged ファイルは追加・削除 0", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "unchanged",
      localContent: "content",
      templateContent: "content",
    };

    const stats = calculateDiffStats(file);

    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  it("deleted ファイルは削除行数をカウント", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "deleted",
      templateContent: "line1\nline2\nline3",
    };

    const stats = calculateDiffStats(file);

    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(3);
  });

  it("added ファイルは追加行数をカウント", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "added",
      localContent: "line1\nline2",
    };

    const stats = calculateDiffStats(file);

    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(0);
  });

  it("modified ファイルは追加・削除行数をカウント", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "modified",
      localContent: "new line 1\nline 2",
      templateContent: "old line 1\nline 2",
    };

    const stats = calculateDiffStats(file);

    // 1行が変更された = 1追加 + 1削除
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(1);
  });

  it("空の localContent の added ファイル", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "added",
      localContent: "",
    };

    const stats = calculateDiffStats(file);

    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  it("undefined の templateContent の deleted ファイル", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "deleted",
      templateContent: undefined,
    };

    const stats = calculateDiffStats(file);

    expect(stats.deletions).toBe(0);
  });
});

describe("addStatsToFiles", () => {
  it("各ファイルに統計情報を追加する", () => {
    const files: FileDiff[] = [
      { path: "a.txt", type: "added", localContent: "line1\nline2" },
      { path: "b.txt", type: "deleted", templateContent: "line1" },
    ];

    const result = addStatsToFiles(files);

    expect(result).toHaveLength(2);
    expect(result[0].stats.additions).toBe(2);
    expect(result[1].stats.deletions).toBe(1);
  });

  it("空の配列を処理できる", () => {
    const result = addStatsToFiles([]);

    expect(result).toEqual([]);
  });
});

describe("groupFilesByType", () => {
  it("ファイルをタイプ別にグループ化する", () => {
    const files = addStatsToFiles([
      { path: "a.txt", type: "added", localContent: "content" },
      { path: "b.txt", type: "modified", localContent: "new", templateContent: "old" },
      { path: "c.txt", type: "deleted", templateContent: "content" },
      { path: "d.txt", type: "added", localContent: "content" },
    ]);

    const result = groupFilesByType(files);

    expect(result.added).toHaveLength(2);
    expect(result.modified).toHaveLength(1);
    expect(result.deleted).toHaveLength(1);
  });

  it("unchanged はグループ化されない", () => {
    const files = addStatsToFiles([
      { path: "a.txt", type: "unchanged", localContent: "content", templateContent: "content" },
    ]);

    const result = groupFilesByType(files);

    expect(result.added).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });
});

describe("calculateTotalStats", () => {
  it("全ファイルの統計を合計する", () => {
    const files = addStatsToFiles([
      { path: "a.txt", type: "added", localContent: "line1\nline2" },
      { path: "b.txt", type: "deleted", templateContent: "line1\nline2\nline3" },
    ]);

    const result = calculateTotalStats(files);

    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(3);
  });

  it("空の配列は 0 を返す", () => {
    const result = calculateTotalStats([]);

    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });
});

describe("formatStats", () => {
  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it("追加のみの場合は +N 形式", () => {
    const result = formatStats({ additions: 10, deletions: 0 });

    // ANSI カラーコードを含むため、数値のみチェック
    expect(result).toContain("+10");
  });

  it("削除のみの場合は -N 形式", () => {
    const result = formatStats({ additions: 0, deletions: 5 });

    expect(result).toContain("-5");
  });

  it("追加と削除がある場合は +N -M 形式", () => {
    const result = formatStats({ additions: 10, deletions: 5 });

    expect(result).toContain("+10");
    expect(result).toContain("-5");
  });

  it("変更なしの場合は (no changes) を返す", () => {
    const result = formatStats({ additions: 0, deletions: 0 });

    expect(result).toContain("no changes");
  });
});

describe("formatStatsWithLabel", () => {
  it("追加と削除がある場合は +N -M lines 形式", () => {
    const result = formatStatsWithLabel({ additions: 10, deletions: 5 });

    expect(result).toContain("+10");
    expect(result).toContain("-5");
    expect(result).toContain("lines");
  });

  it("変更なしの場合は空文字列を返す", () => {
    const result = formatStatsWithLabel({ additions: 0, deletions: 0 });

    expect(result).toBe("");
  });
});

describe("getFileLabel", () => {
  it("ファイルのラベルを生成する", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "added",
      localContent: "line1\nline2",
    };

    const label = getFileLabel(file);

    expect(label).toContain("file.txt");
    expect(label).toContain("+2");
  });

  it("modified ファイルのラベル", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "modified",
      localContent: "new line",
      templateContent: "old line",
    };

    const label = getFileLabel(file);

    expect(label).toContain("file.txt");
  });
});

describe("showDiffSummaryBox", () => {
  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it("コンソールに出力する", () => {
    const files: FileDiff[] = [
      { path: "a.txt", type: "added", localContent: "content" },
    ];

    showDiffSummaryBox(files);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("空のファイルリストでも動作する", () => {
    showDiffSummaryBox([]);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("複数タイプのファイルを表示する", () => {
    const files: FileDiff[] = [
      { path: "a.txt", type: "added", localContent: "content" },
      { path: "b.txt", type: "modified", localContent: "new", templateContent: "old" },
      { path: "c.txt", type: "deleted", templateContent: "content" },
    ];

    showDiffSummaryBox(files);

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("a.txt");
    expect(output).toContain("b.txt");
    expect(output).toContain("c.txt");
  });
});

describe("showFileDiffBox", () => {
  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it("ファイルの diff ボックスを表示する", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "modified",
      localContent: "new line",
      templateContent: "old line",
    };

    showFileDiffBox(file, 0, 1);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("file.txt");
    expect(output).toContain("[1/1]");
  });

  it("added ファイルの diff を表示する", () => {
    const file: FileDiff = {
      path: "new-file.txt",
      type: "added",
      localContent: "new content",
    };

    showFileDiffBox(file, 0, 1);

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("new-file.txt");
    expect(output).toContain("added");
  });

  it("deleted ファイルの diff を表示する", () => {
    const file: FileDiff = {
      path: "deleted-file.txt",
      type: "deleted",
      templateContent: "old content",
    };

    showFileDiffBox(file, 0, 1);

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("deleted-file.txt");
    expect(output).toContain("deleted");
  });

  it("maxLines オプションで行数を制限する", () => {
    const file: FileDiff = {
      path: "large-file.txt",
      type: "modified",
      localContent: "line1\nline2\nline3\nline4\nline5",
      templateContent: "old1\nold2\nold3\nold4\nold5",
    };

    showFileDiffBox(file, 0, 1, { maxLines: 3 });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("more lines");
  });

  it("syntaxHighlight オプションが動作する", () => {
    const file: FileDiff = {
      path: "file.ts",
      type: "modified",
      localContent: "const x = 1;",
      templateContent: "const x = 2;",
    };

    // エラーなく実行される
    showFileDiffBox(file, 0, 1, { syntaxHighlight: true });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("wordDiff オプションが動作する", () => {
    const file: FileDiff = {
      path: "file.txt",
      type: "modified",
      localContent: "hello world",
      templateContent: "hello there",
    };

    // エラーなく実行される
    showFileDiffBox(file, 0, 1, { wordDiff: true });

    expect(consoleSpy).toHaveBeenCalled();
  });
});
