import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileResult, Summary } from "../ui";
import {
  box,
  calculateSummary,
  diffFile,
  diffHeader,
  formatPath,
  log,
  logFileResult,
  showHeader,
  showNextSteps,
  showSummary,
  step,
  substep,
} from "../ui";

// console.log をモック
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

describe("ui utilities", () => {
  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  describe("calculateSummary", () => {
    it("空の結果配列の場合はすべて0", () => {
      const results: FileResult[] = [];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 0,
        updated: 0,
        skipped: 0,
      });
    });

    it("copied アクションは added としてカウント", () => {
      const results: FileResult[] = [
        { action: "copied", path: "file1.txt" },
        { action: "copied", path: "file2.txt" },
      ];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 2,
        updated: 0,
        skipped: 0,
      });
    });

    it("created アクションは added としてカウント", () => {
      const results: FileResult[] = [
        { action: "created", path: "file1.txt" },
        { action: "created", path: "file2.txt" },
      ];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 2,
        updated: 0,
        skipped: 0,
      });
    });

    it("overwritten アクションは updated としてカウント", () => {
      const results: FileResult[] = [
        { action: "overwritten", path: "file1.txt" },
        { action: "overwritten", path: "file2.txt" },
      ];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 0,
        updated: 2,
        skipped: 0,
      });
    });

    it("skipped アクションは skipped としてカウント", () => {
      const results: FileResult[] = [
        { action: "skipped", path: "file1.txt" },
        { action: "skipped", path: "file2.txt" },
      ];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 0,
        updated: 0,
        skipped: 2,
      });
    });

    it("混合アクションを正しくカウント", () => {
      const results: FileResult[] = [
        { action: "copied", path: "new1.txt" },
        { action: "created", path: "new2.txt" },
        { action: "overwritten", path: "updated.txt" },
        { action: "skipped", path: "skip1.txt" },
        { action: "skipped", path: "skip2.txt" },
      ];
      const summary = calculateSummary(results);

      expect(summary).toEqual<Summary>({
        added: 2,
        updated: 1,
        skipped: 2,
      });
    });
  });

  describe("formatPath", () => {
    it("先頭に ./ がない場合は追加する", () => {
      expect(formatPath("file.txt")).toBe("./file.txt");
      expect(formatPath("dir/file.txt")).toBe("./dir/file.txt");
    });

    it("先頭に ./ がある場合はそのまま", () => {
      expect(formatPath("./file.txt")).toBe("./file.txt");
      expect(formatPath("./dir/file.txt")).toBe("./dir/file.txt");
    });
  });

  describe("log", () => {
    it("success はメッセージを出力", () => {
      log.success("Success message");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Success message");
    });

    it("error はメッセージを出力", () => {
      log.error("Error message");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Error message");
    });

    it("warn はメッセージを出力", () => {
      log.warn("Warning message");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Warning message");
    });

    it("info はメッセージを出力", () => {
      log.info("Info message");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Info message");
    });

    it("dim はメッセージを出力", () => {
      log.dim("Dim message");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Dim message");
    });

    it("newline は空行を出力", () => {
      log.newline();
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog).toHaveBeenCalledWith();
    });
  });

  describe("showHeader", () => {
    it("タイトルのみの場合", () => {
      showHeader("Test Title");
      expect(mockConsoleLog).toHaveBeenCalledTimes(3); // 空行、タイトル、区切り線
      expect(mockConsoleLog.mock.calls[1][0]).toContain("Test Title");
    });

    it("タイトルとバージョンの場合", () => {
      showHeader("Test Title", "1.0.0");
      expect(mockConsoleLog).toHaveBeenCalledTimes(3);
      expect(mockConsoleLog.mock.calls[1][0]).toContain("Test Title");
      expect(mockConsoleLog.mock.calls[1][0]).toContain("1.0.0");
    });
  });

  describe("step", () => {
    it("ステップ番号とメッセージを表示", () => {
      step({ current: 1, total: 3 }, "Fetching template...");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("[1/3]");
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Fetching template...");
    });
  });

  describe("substep", () => {
    it("サブステップを表示", () => {
      substep("Sub task");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Sub task");
    });

    it("最後のサブステップは別のプレフィックス", () => {
      substep("Last sub task", true);
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("Last sub task");
    });
  });

  describe("logFileResult", () => {
    it("copied アクションを表示", () => {
      logFileResult({ action: "copied", path: "file.txt" });
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("file.txt");
      expect(mockConsoleLog.mock.calls[0][0]).toContain("added");
    });

    it("created アクションを表示", () => {
      logFileResult({ action: "created", path: "file.txt" });
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("file.txt");
      expect(mockConsoleLog.mock.calls[0][0]).toContain("added");
    });

    it("overwritten アクションを表示", () => {
      logFileResult({ action: "overwritten", path: "file.txt" });
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("file.txt");
      expect(mockConsoleLog.mock.calls[0][0]).toContain("updated");
    });

    it("skipped アクションを表示", () => {
      logFileResult({ action: "skipped", path: "file.txt" });
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("file.txt");
      expect(mockConsoleLog.mock.calls[0][0]).toContain("skipped");
    });
  });

  describe("showSummary", () => {
    it("added のみの場合", () => {
      showSummary({ added: 3, updated: 0, skipped: 0 });
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("3 added");
      expect(output).toContain("Done!");
    });

    it("updated のみの場合", () => {
      showSummary({ added: 0, updated: 2, skipped: 0 });
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("2 updated");
    });

    it("skipped のみの場合", () => {
      showSummary({ added: 0, updated: 0, skipped: 5 });
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("5 skipped");
    });

    it("すべて0の場合は何も表示しない", () => {
      showSummary({ added: 0, updated: 0, skipped: 0 });
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it("混合の場合", () => {
      showSummary({ added: 1, updated: 2, skipped: 3 });
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("1 added");
      expect(output).toContain("2 updated");
      expect(output).toContain("3 skipped");
    });
  });

  describe("showNextSteps", () => {
    it("空の配列の場合は何も表示しない", () => {
      showNextSteps([]);
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it("コマンドありのステップを表示", () => {
      showNextSteps([{ command: "npm run test", description: "Run tests" }]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("npm run test");
      expect(output).toContain("Run tests");
    });

    it("コマンドなしのステップを表示", () => {
      showNextSteps([{ description: "Just a description" }]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Just a description");
    });

    it("複数のステップを表示", () => {
      showNextSteps([
        { command: "cmd1", description: "desc1" },
        { command: "cmd2", description: "desc2" },
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("cmd1");
      expect(output).toContain("cmd2");
    });
  });

  describe("box", () => {
    it("success タイプのボックスを表示", () => {
      box("Success!", "success");
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Success!");
    });

    it("info タイプのボックスを表示", () => {
      box("Info message", "info");
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Info message");
    });

    it("warning タイプのボックスを表示", () => {
      box("Warning!", "warning");
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Warning!");
    });

    it("デフォルトは info タイプ", () => {
      box("Default type");
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Default type");
    });
  });

  describe("diffHeader", () => {
    it("ヘッダーを表示", () => {
      diffHeader("Changes:");
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((c) => c[0]).join(" ");
      expect(output).toContain("Changes:");
    });
  });

  describe("diffFile", () => {
    it("added タイプを表示", () => {
      diffFile("new-file.txt", "added");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("new-file.txt");
    });

    it("modified タイプを表示", () => {
      diffFile("changed-file.txt", "modified");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("changed-file.txt");
    });

    it("deleted タイプを表示", () => {
      diffFile("removed-file.txt", "deleted");
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog.mock.calls[0][0]).toContain("removed-file.txt");
    });
  });
});
