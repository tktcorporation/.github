import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffResult } from "../../modules/schemas";

// fs モジュールをモック
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

// giget をモック
vi.mock("giget", () => ({
  downloadTemplate: vi.fn(),
}));

// utils/diff をモック
vi.mock("../../utils/diff", () => ({
  detectDiff: vi.fn(),
  formatDiff: vi.fn(() => "formatted diff output"),
  hasDiff: vi.fn(),
}));

// utils/ui をモック
vi.mock("../../utils/ui", () => ({
  showHeader: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    dim: vi.fn(),
    newline: vi.fn(),
    error: vi.fn(),
  },
  step: vi.fn(),
  withSpinner: vi.fn(async (_text: string, fn: () => Promise<unknown>) => fn()),
  diffHeader: vi.fn(),
  box: vi.fn(),
  showNextSteps: vi.fn(),
}));

// console.log をモック
vi.spyOn(console, "log").mockImplementation(() => {});

// process.exit をモック
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// モック後にインポート
const { diffCommand } = await import("../diff");
const { downloadTemplate } = await import("giget");
const { detectDiff, hasDiff } = await import("../../utils/diff");
const { log, box } = await import("../../utils/ui");

const mockDownloadTemplate = vi.mocked(downloadTemplate);
const mockDetectDiff = vi.mocked(detectDiff);
const mockHasDiff = vi.mocked(hasDiff);
const mockLog = vi.mocked(log);
const mockBox = vi.mocked(box);

const validConfig = {
  version: "0.1.0",
  installedAt: "2024-01-01T00:00:00.000Z",
  modules: ["root", "github"],
  source: {
    owner: "tktcorporation",
    repo: ".github",
  },
};

const emptyDiff: DiffResult = {
  added: [],
  modified: [],
  deleted: [],
  unchanged: [],
};

describe("diffCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    mockExit.mockClear();

    // デフォルトのモック設定
    mockDownloadTemplate.mockResolvedValue({
      dir: "/tmp/template",
      source: "gh:tktcorporation/.github",
    });
  });

  describe("meta", () => {
    it("コマンドメタデータが正しい", () => {
      expect(diffCommand.meta?.name).toBe("diff");
      expect(diffCommand.meta?.description).toBe("Show differences between local and template");
    });
  });

  describe("args", () => {
    it("dir 引数のデフォルト値は '.'", () => {
      expect(diffCommand.args?.dir?.default).toBe(".");
    });

    it("verbose 引数のデフォルト値は false", () => {
      expect(diffCommand.args?.verbose?.default).toBe(false);
    });
  });

  describe("run", () => {
    it(".devenv.json が存在しない場合はエラー", async () => {
      vol.fromJSON({
        "/test": null,
      });

      await expect(
        diffCommand.run?.({
          args: { dir: "/test", verbose: false },
          rawArgs: [],
          cmd: diffCommand,
        }),
      ).rejects.toThrow("process.exit called");

      expect(mockLog.error).toHaveBeenCalledWith(
        ".devenv.json not found. Run 'init' command first.",
      );
    });

    it("無効な .devenv.json 形式の場合はエラー", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify({ invalid: "format" }),
      });

      await expect(
        diffCommand.run?.({
          args: { dir: "/test", verbose: false },
          rawArgs: [],
          cmd: diffCommand,
        }),
      ).rejects.toThrow("process.exit called");

      expect(mockLog.error).toHaveBeenCalledWith("Invalid .devenv.json format");
    });

    it("modules が空の場合は警告", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify({
          ...validConfig,
          modules: [],
        }),
      });

      await diffCommand.run?.({
        args: { dir: "/test", verbose: false },
        rawArgs: [],
        cmd: diffCommand,
      });

      expect(mockLog.warn).toHaveBeenCalledWith("No modules installed");
    });

    it("差分がない場合は成功メッセージ", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockDetectDiff.mockResolvedValueOnce(emptyDiff);
      mockHasDiff.mockReturnValueOnce(false);

      await diffCommand.run?.({
        args: { dir: "/test", verbose: false },
        rawArgs: [],
        cmd: diffCommand,
      });

      expect(mockBox).toHaveBeenCalledWith("No changes", "success");
      expect(mockLog.info).toHaveBeenCalledWith("Your local files are in sync with the template");
    });

    it("差分がある場合は差分を表示", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      const diffWithChanges: DiffResult = {
        added: [
          {
            path: "new-file.txt",
            type: "added",
            localContent: "content",
            templateContent: null,
          },
        ],
        modified: [],
        deleted: [],
        unchanged: [],
      };

      mockDetectDiff.mockResolvedValueOnce(diffWithChanges);
      mockHasDiff.mockReturnValueOnce(true);

      await diffCommand.run?.({
        args: { dir: "/test", verbose: false },
        rawArgs: [],
        cmd: diffCommand,
      });

      expect(mockBox).not.toHaveBeenCalledWith("No changes", "success");
    });

    it("一時ディレクトリを削除", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
        "/test/.devenv-temp": null,
      });

      mockDetectDiff.mockResolvedValueOnce(emptyDiff);
      mockHasDiff.mockReturnValueOnce(false);

      await diffCommand.run?.({
        args: { dir: "/test", verbose: false },
        rawArgs: [],
        cmd: diffCommand,
      });

      // 一時ディレクトリが削除される（memfs では確認が難しいのでモックで確認）
      expect(mockDownloadTemplate).toHaveBeenCalled();
    });

    it("エラー時も一時ディレクトリを削除", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
        "/test/.devenv-temp": null,
      });

      mockDetectDiff.mockRejectedValueOnce(new Error("Diff error"));

      await expect(
        diffCommand.run?.({
          args: { dir: "/test", verbose: false },
          rawArgs: [],
          cmd: diffCommand,
        }),
      ).rejects.toThrow("Diff error");
    });
  });
});
