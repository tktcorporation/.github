import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// fs モジュールをモック
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

// 外部依存をモック
vi.mock("../../utils/template", () => ({
  downloadTemplateToTemp: vi.fn(),
  fetchTemplates: vi.fn(),
  writeFileWithStrategy: vi.fn(),
  copyFile: vi.fn(),
}));

vi.mock("../../prompts/init", () => ({
  promptInit: vi.fn(),
}));

vi.mock("../../utils/ui", () => ({
  showHeader: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    dim: vi.fn(),
    newline: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  pc: {
    cyan: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
  },
  step: vi.fn(),
  withSpinner: vi.fn(async (_text: string, fn: () => Promise<unknown>) => fn()),
  logFileResult: vi.fn(),
  calculateSummary: vi.fn(() => ({ added: 1, updated: 0, skipped: 0 })),
  showSummary: vi.fn(),
  box: vi.fn(),
  showNextSteps: vi.fn(),
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
const { initCommand } = await import("../init");
const { downloadTemplateToTemp, fetchTemplates, writeFileWithStrategy, copyFile } =
  await import("../../utils/template");
const { promptInit } = await import("../../prompts/init");
const { log } = await import("../../utils/ui");

const mockDownloadTemplateToTemp = vi.mocked(downloadTemplateToTemp);
const mockFetchTemplates = vi.mocked(fetchTemplates);
const mockWriteFileWithStrategy = vi.mocked(writeFileWithStrategy);
const mockCopyFile = vi.mocked(copyFile);
const mockPromptInit = vi.mocked(promptInit);
const mockLog = vi.mocked(log);

describe("initCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();

    // デフォルトのモック設定
    mockDownloadTemplateToTemp.mockResolvedValue({
      templateDir: "/tmp/template",
      cleanup: vi.fn(),
    });
    mockFetchTemplates.mockResolvedValue([]);
    mockWriteFileWithStrategy.mockResolvedValue({
      action: "created",
      path: ".devenv.json",
    });
    mockCopyFile.mockResolvedValue({
      action: "skipped",
      path: ".devenv/modules.jsonc",
    });
  });

  describe("meta", () => {
    it("コマンドメタデータが正しい", () => {
      expect((initCommand.meta as { name: string }).name).toBe("create-devenv");
      expect((initCommand.meta as { description: string }).description).toBe(
        "Apply dev environment template to your project",
      );
    });
  });

  describe("args", () => {
    it("dir 引数のデフォルト値は '.'", () => {
      const args = initCommand.args as { dir: { default: string } };
      expect(args.dir.default).toBe(".");
    });

    it("force 引数のデフォルト値は false", () => {
      const args = initCommand.args as { force: { default: boolean } };
      expect(args.force.default).toBe(false);
    });

    it("yes 引数のデフォルト値は false", () => {
      const args = initCommand.args as { yes: { default: boolean } };
      expect(args.yes.default).toBe(false);
    });
  });

  describe("run", () => {
    it("モジュールが選択されない場合は警告を表示", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: [],
        overwriteStrategy: "prompt",
      });

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockLog.warn).toHaveBeenCalledWith("No modules selected");
    });

    it("--yes オプションで全モジュールを自動選択", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockFetchTemplates.mockResolvedValue([{ action: "copied", path: ".mcp.json" }]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: true },
        rawArgs: [],
        cmd: initCommand,
      });

      // promptInit は呼ばれない
      expect(mockPromptInit).not.toHaveBeenCalled();
      // fetchTemplates は呼ばれる
      expect(mockFetchTemplates).toHaveBeenCalled();
    });

    it("ターゲットディレクトリが存在しない場合は作成", async () => {
      vol.fromJSON({});

      mockPromptInit.mockResolvedValueOnce({
        modules: ["root"],
        overwriteStrategy: "prompt",
      });

      mockFetchTemplates.mockResolvedValue([{ action: "copied", path: ".mcp.json" }]);

      await (initCommand.run as any)({
        args: { dir: "/new-dir", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(vol.existsSync("/new-dir")).toBe(true);
    });

    it("devcontainer モジュール選択時に env.example を作成", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: ["devcontainer"],
        overwriteStrategy: "prompt",
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      // writeFileWithStrategy が devcontainer.env.example に対して呼ばれる
      expect(mockWriteFileWithStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          relativePath: ".devcontainer/devcontainer.env.example",
        }),
      );
    });

    it("--force オプションで overwrite 戦略を使用", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: ["root"],
        overwriteStrategy: "prompt", // prompt を選択しても
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: true, yes: false }, // --force
        rawArgs: [],
        cmd: initCommand,
      });

      // fetchTemplates は overwrite 戦略で呼ばれる
      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          overwriteStrategy: "overwrite",
        }),
      );
    });

    it("cleanup が必ず呼ばれる", async () => {
      vol.fromJSON({
        "/test": null,
      });

      const mockCleanup = vi.fn();
      mockDownloadTemplateToTemp.mockResolvedValue({
        templateDir: "/tmp/template",
        cleanup: mockCleanup,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: ["root"],
        overwriteStrategy: "prompt",
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockCleanup).toHaveBeenCalled();
    });

    it("modules.jsonc をテンプレートからコピーする", async () => {
      vol.fromJSON({
        "/test": null,
        "/tmp/template/.devenv/modules.jsonc": '{"modules":[]}',
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: ["root"],
        overwriteStrategy: "prompt",
      });

      mockFetchTemplates.mockResolvedValue([]);
      mockCopyFile.mockResolvedValue({
        action: "copied",
        path: ".devenv/modules.jsonc",
      });

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      // copyFile が modules.jsonc に対して呼ばれる
      expect(mockCopyFile).toHaveBeenCalledWith(
        "/tmp/template/.devenv/modules.jsonc",
        expect.stringContaining(".devenv/modules.jsonc"),
        "prompt",
        ".devenv/modules.jsonc",
      );
    });

    it("エラー時も cleanup が呼ばれる", async () => {
      vol.fromJSON({
        "/test": null,
      });

      const mockCleanup = vi.fn();
      mockDownloadTemplateToTemp.mockResolvedValue({
        templateDir: "/tmp/template",
        cleanup: mockCleanup,
      });

      mockPromptInit.mockRejectedValueOnce(new Error("User cancelled"));

      await expect(
        (initCommand.run as any)({
          args: { dir: "/test", force: false, yes: false },
          rawArgs: [],
          cmd: initCommand,
        }),
      ).rejects.toThrow("User cancelled");

      expect(mockCleanup).toHaveBeenCalled();
    });

    it("--modules オプションで指定モジュールのみ選択", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockFetchTemplates.mockResolvedValue([{ action: "copied", path: ".mcp.json" }]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false, modules: "." },
        rawArgs: [],
        cmd: initCommand,
      });

      // promptInit は呼ばれない（非インタラクティブ）
      expect(mockPromptInit).not.toHaveBeenCalled();
      // fetchTemplates は指定モジュールで呼ばれる
      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          modules: ["."],
        }),
      );
    });

    it("--modules で複数モジュールをカンマ区切りで指定", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false, modules: ".,.github" },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockPromptInit).not.toHaveBeenCalled();
      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          modules: [".", ".github"],
        }),
      );
    });

    it("--modules で無効なモジュール ID を指定するとエラー", async () => {
      vol.fromJSON({
        "/test": null,
      });

      await (initCommand.run as any)({
        args: { dir: "/test", force: false, yes: false, modules: "invalid-module" },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Unknown module(s)"));
      expect(mockFetchTemplates).not.toHaveBeenCalled();
    });

    it("--overwrite-strategy で skip 戦略を指定", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: {
          dir: "/test",
          force: false,
          yes: true,
          "overwrite-strategy": "skip",
        },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          overwriteStrategy: "skip",
        }),
      );
    });

    it("--modules と --overwrite-strategy の組み合わせ", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: {
          dir: "/test",
          force: false,
          yes: false,
          modules: ".",
          "overwrite-strategy": "skip",
        },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockPromptInit).not.toHaveBeenCalled();
      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          modules: ["."],
          overwriteStrategy: "skip",
        }),
      );
    });

    it("--overwrite-strategy に無効な値を指定するとエラー", async () => {
      vol.fromJSON({
        "/test": null,
      });

      await (initCommand.run as any)({
        args: {
          dir: "/test",
          force: false,
          yes: true,
          "overwrite-strategy": "invalid",
        },
        rawArgs: [],
        cmd: initCommand,
      });

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid overwrite strategy"),
      );
      expect(mockFetchTemplates).not.toHaveBeenCalled();
    });

    it("--overwrite-strategy のみ指定時はモジュール選択はインタラクティブ", async () => {
      vol.fromJSON({
        "/test": null,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: ["."],
        overwriteStrategy: "prompt",
      });

      mockFetchTemplates.mockResolvedValue([]);

      await (initCommand.run as any)({
        args: {
          dir: "/test",
          force: false,
          yes: false,
          "overwrite-strategy": "skip",
        },
        rawArgs: [],
        cmd: initCommand,
      });

      // モジュール選択はインタラクティブ
      expect(mockPromptInit).toHaveBeenCalled();
      // 戦略は --overwrite-strategy で上書き
      expect(mockFetchTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          overwriteStrategy: "skip",
        }),
      );
    });

    it("'init' 引数は無視して現在のディレクトリを使用", async () => {
      vol.fromJSON({
        ".": null,
      });

      mockPromptInit.mockResolvedValueOnce({
        modules: [],
        overwriteStrategy: "prompt",
      });

      await (initCommand.run as any)({
        args: { dir: "init", force: false, yes: false },
        rawArgs: [],
        cmd: initCommand,
      });

      // "init" は "." として扱われる
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining(process.cwd()));
    });
  });
});
