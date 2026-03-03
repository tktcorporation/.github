import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BermError } from "../../errors";

// fs モジュールをモック
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

vi.mock("../../utils/template", () => ({
  downloadTemplateToTemp: vi.fn(),
  buildTemplateSource: vi.fn(
    (source: { owner: string; repo: string }) => `gh:${source.owner}/${source.repo}`,
  ),
}));

vi.mock("../../utils/config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock("../../utils/hash", () => ({
  hashFiles: vi.fn(),
}));

vi.mock("../../utils/merge", () => ({
  classifyFiles: vi.fn(),
  threeWayMerge: vi.fn(),
}));

vi.mock("../../utils/patterns", () => ({
  getEffectivePatterns: vi.fn((_id: string, patterns: string[]) => patterns),
}));

vi.mock("../../ui/renderer", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  pc: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
  },
  withSpinner: vi.fn(async (_text: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../modules/index", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../modules/index")>();
  return {
    ...original,
    modulesFileExists: vi.fn(() => false),
    loadModulesFile: vi.fn(),
  };
});

// モック後にインポート
const { pullCommand } = await import("../pull");
const { downloadTemplateToTemp } = await import("../../utils/template");
const { loadConfig, saveConfig } = await import("../../utils/config");
const { hashFiles } = await import("../../utils/hash");
const { classifyFiles, threeWayMerge } = await import("../../utils/merge");
const { log } = await import("../../ui/renderer");

const mockDownloadTemplateToTemp = vi.mocked(downloadTemplateToTemp);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockHashFiles = vi.mocked(hashFiles);
const mockClassifyFiles = vi.mocked(classifyFiles);
const mockThreeWayMerge = vi.mocked(threeWayMerge);
const mockLog = vi.mocked(log);

const baseConfig = {
  version: "0.1.0",
  installedAt: "2024-01-01T00:00:00.000Z",
  modules: ["."],
  source: { owner: "tktcorporation", repo: ".github" },
  baseHashes: { ".mcp.json": "abc123" },
};

describe("pullCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();

    mockDownloadTemplateToTemp.mockResolvedValue({
      templateDir: "/tmp/template",
      cleanup: vi.fn(),
    });
    mockLoadConfig.mockResolvedValue(baseConfig);
    mockHashFiles.mockResolvedValue({});
    mockSaveConfig.mockResolvedValue(undefined);
  });

  describe("meta", () => {
    it("コマンドメタデータが正しい", () => {
      expect((pullCommand.meta as { name: string }).name).toBe("pull");
      expect((pullCommand.meta as { description: string }).description).toBe(
        "Pull latest template updates",
      );
    });
  });

  describe("run", () => {
    it("初期化されていない場合はエラー", async () => {
      mockLoadConfig.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(
        (pullCommand.run as any)({
          args: { dir: "/test", force: false },
          rawArgs: [],
          cmd: pullCommand,
        }),
      ).rejects.toThrow(BermError);
    });

    it("変更がない場合は 'Already up to date' を表示", async () => {
      vol.fromJSON({ "/test": null });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [],
        unchanged: [".mcp.json"],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      expect(mockLog.success).toHaveBeenCalledWith("Already up to date");
    });

    it("自動更新ファイルをコピー", async () => {
      vol.fromJSON({
        "/test/.mcp.json": '{"old": true}',
        "/tmp/template/.mcp.json": '{"new": true}',
      });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [".mcp.json"],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      // ファイルが更新されていることを確認
      const content = vol.readFileSync("/test/.mcp.json", "utf-8");
      expect(content).toBe('{"new": true}');
      expect(mockLog.success).toHaveBeenCalledWith("Updated 1 file(s)");
    });

    it("新規ファイルを追加", async () => {
      vol.fromJSON({
        "/test": null,
        "/tmp/template/.new-file": "new content",
      });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [".new-file"],
        deletedFiles: [],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      const content = vol.readFileSync("/test/.new-file", "utf-8");
      expect(content).toBe("new content");
      expect(mockLog.success).toHaveBeenCalledWith("Added 1 new file(s)");
    });

    it("コンフリクトファイルにマーカーを挿入（base なし）", async () => {
      vol.fromJSON({
        "/test/.mcp.json": "local content",
        "/tmp/template/.mcp.json": "template content",
      });

      // baseHashes にエントリがないケース（readBaseContent が undefined を返す）
      mockLoadConfig.mockResolvedValueOnce({
        ...baseConfig,
        baseHashes: {},
      });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [".mcp.json"],
        newFiles: [],
        deletedFiles: [],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      const content = vol.readFileSync("/test/.mcp.json", "utf-8");
      expect(content).toContain("<<<<<<< LOCAL");
      expect(content).toContain("local content");
      expect(content).toContain("=======");
      expect(content).toContain("template content");
      expect(content).toContain(">>>>>>> TEMPLATE");
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("manual resolution needed"),
      );
    });

    it("削除されたファイルの警告を表示", async () => {
      vol.fromJSON({ "/test": null });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [".old-file"],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("1 file(s) were deleted in template"),
      );
    });

    it("--force で削除警告をスキップ", async () => {
      vol.fromJSON({ "/test": null });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [".old-file"],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: true },
        rawArgs: [],
        cmd: pullCommand,
      });

      // 削除警告は出ない
      expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining("deleted in template"));
    });

    it("設定の baseHashes が更新される", async () => {
      vol.fromJSON({ "/test": null });

      const newTemplateHashes = { ".mcp.json": "newhash123" };
      // hashFiles は2回呼ばれる（template, local）
      mockHashFiles.mockResolvedValueOnce(newTemplateHashes);
      mockHashFiles.mockResolvedValueOnce({});

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [".mcp.json"],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [],
        unchanged: [],
      });

      // autoUpdate 用のテンプレートファイルを用意
      vol.fromJSON({
        "/test": null,
        "/tmp/template/.mcp.json": "updated",
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          baseHashes: newTemplateHashes,
        }),
      );
    });

    it("cleanup が必ず呼ばれる", async () => {
      vol.fromJSON({ "/test": null });

      const mockCleanup = vi.fn();
      mockDownloadTemplateToTemp.mockResolvedValue({
        templateDir: "/tmp/template",
        cleanup: mockCleanup,
      });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [],
        unchanged: [".mcp.json"],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      expect(mockCleanup).toHaveBeenCalled();
    });

    it("エラー時も cleanup が呼ばれる", async () => {
      const mockCleanup = vi.fn();
      mockDownloadTemplateToTemp.mockResolvedValue({
        templateDir: "/tmp/template",
        cleanup: mockCleanup,
      });

      // hashFiles でエラーを起こす
      mockHashFiles.mockRejectedValueOnce(new Error("Hash error"));

      await expect(
        (pullCommand.run as any)({
          args: { dir: "/test", force: false },
          rawArgs: [],
          cmd: pullCommand,
        }),
      ).rejects.toThrow("Hash error");

      expect(mockCleanup).toHaveBeenCalled();
    });

    it("新規ファイル追加時にディレクトリを自動作成", async () => {
      vol.fromJSON({
        "/test": null,
        "/tmp/template/.devcontainer/config.json": '{"key": "value"}',
      });

      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: [],
        newFiles: [".devcontainer/config.json"],
        deletedFiles: [],
        unchanged: [],
      });

      await (pullCommand.run as any)({
        args: { dir: "/test", force: false },
        rawArgs: [],
        cmd: pullCommand,
      });

      expect(vol.existsSync("/test/.devcontainer")).toBe(true);
      const content = vol.readFileSync("/test/.devcontainer/config.json", "utf-8");
      expect(content).toBe('{"key": "value"}');
    });
  });
});
