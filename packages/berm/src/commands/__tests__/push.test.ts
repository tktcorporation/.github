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
  formatDiff: vi.fn(() => "formatted diff output"),
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

// prompts/push をモック
vi.mock("../../prompts/push", () => ({
  promptPushConfirm: vi.fn(),
  promptGitHubToken: vi.fn(),
  promptPrTitle: vi.fn(),
  promptPrBody: vi.fn(),
  promptSelectFilesWithDiff: vi.fn(),
  promptAddUntrackedFiles: vi.fn(() => []),
}));

// modules をモック
vi.mock("../../modules", () => ({
  defaultModules: [],
  modulesFileExists: vi.fn(() => false),
  loadModulesFile: vi.fn(),
  addPatternToModulesFile: vi.fn(),
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
    success: vi.fn(),
  },
  pc: {
    cyan: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
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
const { pushCommand } = await import("../push");
const { downloadTemplate } = await import("giget");
const { detectDiff, getPushableFiles } = await import("../../utils/diff");
const { getGitHubToken, createPullRequest } = await import("../../utils/github");
const {
  promptPushConfirm,
  promptGitHubToken,
  promptPrTitle,
  promptPrBody,
  promptSelectFilesWithDiff,
} = await import("../../prompts/push");
const { log, box } = await import("../../utils/ui");

const mockDownloadTemplate = vi.mocked(downloadTemplate);
const mockDetectDiff = vi.mocked(detectDiff);
const mockGetPushableFiles = vi.mocked(getPushableFiles);
const mockGetGitHubToken = vi.mocked(getGitHubToken);
const mockCreatePullRequest = vi.mocked(createPullRequest);
const mockPromptPushConfirm = vi.mocked(promptPushConfirm);
const mockPromptGitHubToken = vi.mocked(promptGitHubToken);
const mockPromptPrTitle = vi.mocked(promptPrTitle);
const mockPromptPrBody = vi.mocked(promptPrBody);
const mockPromptSelectFilesWithDiff = vi.mocked(promptSelectFilesWithDiff);
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

const emptyDiff = {
  files: [],
  summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
};

describe("pushCommand", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    mockExit.mockClear();

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
        (pushCommand.run as any)({
          args: { dir: "/test", dryRun: false, force: false, interactive: true },
          rawArgs: [],
          cmd: pushCommand,
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

      expect(mockBox).toHaveBeenCalledWith("Dry run mode", "info");
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

      mockPromptSelectFilesWithDiff.mockResolvedValueOnce([]);

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

      mockPromptPushConfirm.mockResolvedValueOnce(false);

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
      mockPromptSelectFilesWithDiff.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue("ghp_token");
      mockPromptPrTitle.mockResolvedValueOnce("feat: add new file");
      mockPromptPrBody.mockResolvedValueOnce("PR description");
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

      expect(mockBox).toHaveBeenCalledWith("Pull request created!", "success");
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
      mockPromptSelectFilesWithDiff.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue(undefined);
      mockPromptGitHubToken.mockResolvedValueOnce("ghp_prompted_token");
      mockPromptPrTitle.mockResolvedValueOnce("feat: add");
      mockPromptPrBody.mockResolvedValueOnce(undefined);
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

      expect(mockPromptGitHubToken).toHaveBeenCalled();
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
      mockPromptSelectFilesWithDiff.mockResolvedValueOnce([pushableFile]);
      mockGetGitHubToken.mockReturnValue("ghp_token");
      mockPromptPrBody.mockResolvedValueOnce(undefined);
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

      // promptPrTitle は呼ばれない
      expect(mockPromptPrTitle).not.toHaveBeenCalled();
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
      mockPromptPrTitle.mockResolvedValueOnce("feat: add");
      mockPromptPrBody.mockResolvedValueOnce(undefined);
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
      expect(mockPromptSelectFilesWithDiff).not.toHaveBeenCalled();
      expect(mockPromptPushConfirm).not.toHaveBeenCalled();
      expect(mockCreatePullRequest).toHaveBeenCalled();
    });
  });
});
