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

// giget をモック
vi.mock("giget", () => ({
  downloadTemplate: vi.fn(),
}));

// utils/template をモック
vi.mock("../../utils/template", () => ({
  buildTemplateSource: vi.fn((source: { owner: string; repo: string; ref?: string }) => {
    const base = `gh:${source.owner}/${source.repo}`;
    return source.ref ? `${base}#${source.ref}` : base;
  }),
}));

// utils/diff をモック
vi.mock("../../utils/diff", () => ({
  detectDiff: vi.fn(),
  getPushableFiles: vi.fn(() => []),
}));

// utils/github をモック
vi.mock("../../utils/github", () => ({
  getGitHubToken: vi.fn(),
  createPullRequest: vi.fn(),
}));

// utils/readme をモック
vi.mock("../../utils/readme", () => ({
  detectAndUpdateReadme: vi.fn(() => null),
}));

// utils/untracked をモック
vi.mock("../../utils/untracked", () => ({
  detectUntrackedFiles: vi.fn(() => []),
}));

// utils/hash をモック
vi.mock("../../utils/hash", () => ({
  hashFiles: vi.fn(() => ({})),
}));

// utils/merge をモック
vi.mock("../../utils/merge", () => ({
  classifyFiles: vi.fn(() => ({
    autoUpdate: [],
    localOnly: [],
    conflicts: [],
    newFiles: [],
    deletedFiles: [],
    unchanged: [],
  })),
}));

// utils/patterns をモック
vi.mock("../../utils/patterns", () => ({
  getEffectivePatterns: vi.fn((_moduleId: string, patterns: string[]) => patterns),
}));

// ui/prompts をモック
vi.mock("../../ui/prompts", () => ({
  confirmAction: vi.fn(),
  generatePrTitle: vi.fn(() => "feat: add file.txt config"),
  generatePrBody: vi.fn(() => "## Changes\n\n**Added:**\n- `file.txt`"),
  inputGitHubToken: vi.fn(),
  inputPrTitle: vi.fn(),
  inputPrBody: vi.fn(),
  selectPushFiles: vi.fn(),
}));

// modules をモック
vi.mock("../../modules", () => ({
  defaultModules: [],
  modulesFileExists: vi.fn(() => false),
  loadModulesFile: vi.fn(),
  addPatternToModulesFile: vi.fn(),
  getModuleById: vi.fn((id: string) => ({
    id,
    name: id,
    description: `${id} module`,
    patterns: [`.${id}/**`],
  })),
}));

// ui/renderer をモック
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
  logDiffSummary: vi.fn(),
  pc: {
    cyan: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
  },
  withSpinner: vi.fn(async (_text: string, fn: () => Promise<unknown>) => fn()),
}));

// モック後にインポート
const { pushCommand } = await import("../push");
const { downloadTemplate } = await import("giget");
const { detectDiff, getPushableFiles } = await import("../../utils/diff");
const { getGitHubToken, createPullRequest } = await import("../../utils/github");
const { confirmAction, inputGitHubToken, inputPrTitle, inputPrBody, selectPushFiles } =
  await import("../../ui/prompts");
const { log } = await import("../../ui/renderer");
const { hashFiles } = await import("../../utils/hash");
const { classifyFiles } = await import("../../utils/merge");

const mockDownloadTemplate = vi.mocked(downloadTemplate);
const mockDetectDiff = vi.mocked(detectDiff);
const mockGetPushableFiles = vi.mocked(getPushableFiles);
const mockGetGitHubToken = vi.mocked(getGitHubToken);
const mockCreatePullRequest = vi.mocked(createPullRequest);
const mockConfirmAction = vi.mocked(confirmAction);
const mockInputGitHubToken = vi.mocked(inputGitHubToken);
const mockInputPrTitle = vi.mocked(inputPrTitle);
const mockInputPrBody = vi.mocked(inputPrBody);
const mockSelectPushFiles = vi.mocked(selectPushFiles);
const mockLog = vi.mocked(log);
const mockHashFiles = vi.mocked(hashFiles);
const mockClassifyFiles = vi.mocked(classifyFiles);

const validConfig = {
  version: "0.1.0",
  installedAt: "2024-01-01T00:00:00.000Z",
  modules: ["root", "github"],
  source: {
    owner: "tktcorporation",
    repo: ".github",
  },
};

const emptyDiff = {
  files: [],
  summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
};

describe("pushCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();

    // デフォルトのモック設定
    mockDownloadTemplate.mockResolvedValue({
      dir: "/tmp/template",
      source: "gh:tktcorporation/.github",
    });
    mockDetectDiff.mockResolvedValue(emptyDiff);
    mockGetPushableFiles.mockReturnValue([]);
  });

  describe("meta", () => {
    it("コマンドメタデータが正しい", () => {
      expect((pushCommand.meta as { name: string }).name).toBe("push");
      expect((pushCommand.meta as { description: string }).description).toBe(
        "Push local changes to the template repository as a PR",
      );
    });
  });

  describe("args", () => {
    it("dir 引数のデフォルト値は '.'", () => {
      const args = pushCommand.args as { dir: { default: string } };
      expect(args.dir.default).toBe(".");
    });

    it("dryRun 引数のデフォルト値は false", () => {
      const args = pushCommand.args as { dryRun: { default: boolean } };
      expect(args.dryRun.default).toBe(false);
    });

    it("force 引数のデフォルト値は false", () => {
      const args = pushCommand.args as { force: { default: boolean } };
      expect(args.force.default).toBe(false);
    });

    it("interactive 引数のデフォルト値は true", () => {
      const args = pushCommand.args as { interactive: { default: boolean } };
      expect(args.interactive.default).toBe(true);
    });
  });

  describe("run", () => {
    it(".devenv.json が存在しない場合はエラー", async () => {
      vol.fromJSON({
        "/test": null,
      });

      await expect(
        (pushCommand.run as any)({
          args: { dir: "/test", dryRun: false, force: false, interactive: true },
          rawArgs: [],
          cmd: pushCommand,
        }),
      ).rejects.toThrow(".devenv.json not found.");
    });

    it("無効な .devenv.json 形式の場合はエラー", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify({ invalid: "format" }),
      });

      await expect(
        (pushCommand.run as any)({
          args: { dir: "/test", dryRun: false, force: false, interactive: true },
          rawArgs: [],
          cmd: pushCommand,
        }),
      ).rejects.toThrow("Invalid .devenv.json format");
    });

    it("modules が空の場合は警告", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify({
          ...validConfig,
          modules: [],
        }),
      });

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.warn).toHaveBeenCalledWith("No modules installed");
    });

    it("push 対象ファイルがない場合は情報メッセージ", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockGetPushableFiles.mockReturnValue([]);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.info).toHaveBeenCalledWith("No changes to push");
    });

    it("--dry-run オプションで PR を作成しない", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockGetPushableFiles.mockReturnValue([
        {
          path: "file.txt",
          type: "added" as const,
          localContent: "content",
        },
      ]);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: true, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.info).toHaveBeenCalledWith("Dry run mode");
      expect(mockLog.info).toHaveBeenCalledWith("No PR was created (dry run)");
      expect(mockCreatePullRequest).not.toHaveBeenCalled();
    });

    it("インタラクティブモードでファイル選択をキャンセル", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockGetPushableFiles.mockReturnValue([
        {
          path: "file.txt",
          type: "added" as const,
          localContent: "content",
        },
      ]);

      mockSelectPushFiles.mockResolvedValueOnce([]);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.info).toHaveBeenCalledWith("No files selected. Cancelled.");
      expect(mockCreatePullRequest).not.toHaveBeenCalled();
    });

    it("--no-interactive モードで確認をキャンセル", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockGetPushableFiles.mockReturnValue([
        {
          path: "file.txt",
          type: "added" as const,
          localContent: "content",
        },
      ]);

      mockConfirmAction.mockResolvedValueOnce(false);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: false },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.info).toHaveBeenCalledWith("Cancelled");
      expect(mockCreatePullRequest).not.toHaveBeenCalled();
    });

    it("PR 作成成功", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      const pushableFile = {
        path: "file.txt",
        type: "added" as const,
        localContent: "content",
      };

      mockGetPushableFiles.mockReturnValue([pushableFile]);
      mockSelectPushFiles.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue("ghp_token");
      mockInputPrTitle.mockResolvedValueOnce("feat: add new file");
      mockInputPrBody.mockResolvedValueOnce("PR description");
      mockCreatePullRequest.mockResolvedValueOnce({
        url: "https://github.com/owner/repo/pull/1",
        branch: "update-template-123",
        number: 1,
      });

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockLog.success).toHaveBeenCalledWith("Pull request created!");
      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        "ghp_token",
        expect.objectContaining({
          owner: "tktcorporation",
          repo: ".github",
          title: "feat: add new file",
          body: "PR description",
        }),
      );
    });

    it("GitHub トークンがない場合はプロンプト", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      const pushableFile = {
        path: "file.txt",
        type: "added" as const,
        localContent: "content",
      };

      mockGetPushableFiles.mockReturnValue([pushableFile]);
      mockSelectPushFiles.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue(undefined);
      mockInputGitHubToken.mockResolvedValueOnce("ghp_prompted_token");
      mockInputPrTitle.mockResolvedValueOnce("feat: add");
      mockInputPrBody.mockResolvedValueOnce(undefined);
      mockCreatePullRequest.mockResolvedValueOnce({
        url: "https://github.com/owner/repo/pull/1",
        branch: "update-template-123",
        number: 1,
      });

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      expect(mockInputGitHubToken).toHaveBeenCalled();
      expect(mockCreatePullRequest).toHaveBeenCalledWith("ghp_prompted_token", expect.anything());
    });

    it("--message オプションで PR タイトルを指定", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      const pushableFile = {
        path: "file.txt",
        type: "added" as const,
        localContent: "content",
      };

      mockGetPushableFiles.mockReturnValue([pushableFile]);
      mockSelectPushFiles.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue("ghp_token");
      mockInputPrBody.mockResolvedValueOnce(undefined);
      mockCreatePullRequest.mockResolvedValueOnce({
        url: "https://github.com/owner/repo/pull/1",
        branch: "update-template-123",
        number: 1,
      });

      await (pushCommand.run as any)({
        args: {
          dir: "/test",
          dryRun: false,
          force: false,
          interactive: true,
          message: "Custom PR title",
        },
        rawArgs: [],
        cmd: pushCommand,
      });

      // inputPrTitle は呼ばれない
      expect(mockInputPrTitle).not.toHaveBeenCalled();
      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        "ghp_token",
        expect.objectContaining({
          title: "Custom PR title",
        }),
      );
    });

    it("--force オプションで確認をスキップ", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      const pushableFile = {
        path: "file.txt",
        type: "added" as const,
        localContent: "content",
      };

      mockGetPushableFiles.mockReturnValue([pushableFile]);
      mockGetGitHubToken.mockReturnValue("ghp_token");
      mockInputPrTitle.mockResolvedValueOnce("feat: add");
      mockInputPrBody.mockResolvedValueOnce(undefined);
      mockCreatePullRequest.mockResolvedValueOnce({
        url: "https://github.com/owner/repo/pull/1",
        branch: "update-template-123",
        number: 1,
      });

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: true, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      // ファイル選択プロンプトはスキップ
      expect(mockSelectPushFiles).not.toHaveBeenCalled();
      expect(mockConfirmAction).not.toHaveBeenCalled();
      expect(mockCreatePullRequest).toHaveBeenCalled();
    });

    it("baseHashes が存在しコンフリクトがある場合はエラーで pull を促す", async () => {
      const configWithBaseHashes = {
        ...validConfig,
        baseHashes: {
          "file.txt": "abc123",
        },
      };

      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(configWithBaseHashes),
      });

      // classifyFiles がコンフリクトを返す
      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: [],
        localOnly: [],
        conflicts: ["file.txt"],
        newFiles: [],
        deletedFiles: [],
        unchanged: [],
      });

      await expect(
        (pushCommand.run as any)({
          args: { dir: "/test", dryRun: false, force: false, interactive: true },
          rawArgs: [],
          cmd: pushCommand,
        }),
      ).rejects.toThrow("Template has upstream changes");

      expect(mockLog.warn).toHaveBeenCalledWith(
        "Template has also changed 1 file(s) since last pull/init.",
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        "Run `berm pull` first to resolve template changes.",
      );
      expect(mockCreatePullRequest).not.toHaveBeenCalled();
    });

    it("baseHashes がない場合はコンフリクト検出をスキップ", async () => {
      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(validConfig),
      });

      mockGetPushableFiles.mockReturnValue([]);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      // hashFiles と classifyFiles は呼ばれない
      expect(mockHashFiles).not.toHaveBeenCalled();
      expect(mockClassifyFiles).not.toHaveBeenCalled();
    });

    it("baseHashes が存在しコンフリクトがない場合は正常に続行", async () => {
      const configWithBaseHashes = {
        ...validConfig,
        baseHashes: {
          "file.txt": "abc123",
        },
      };

      vol.fromJSON({
        "/test/.devenv.json": JSON.stringify(configWithBaseHashes),
      });

      // コンフリクトなし
      mockClassifyFiles.mockReturnValueOnce({
        autoUpdate: ["file.txt"],
        localOnly: [],
        conflicts: [],
        newFiles: [],
        deletedFiles: [],
        unchanged: [],
      });

      mockGetPushableFiles.mockReturnValue([]);

      await (pushCommand.run as any)({
        args: { dir: "/test", dryRun: false, force: false, interactive: true },
        rawArgs: [],
        cmd: pushCommand,
      });

      // コンフリクト検出は実行されたが、エラーにはならない
      expect(mockHashFiles).toHaveBeenCalled();
      expect(mockClassifyFiles).toHaveBeenCalled();
      // "No changes to push" に到達
      expect(mockLog.info).toHaveBeenCalledWith("No changes to push");
    });
  });
});
