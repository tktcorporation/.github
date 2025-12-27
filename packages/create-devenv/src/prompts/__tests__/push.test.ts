import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffResult, FileDiff } from "../../modules/schemas";
import type { UntrackedFilesByFolder } from "../../utils/untracked";

// console.log をモック
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "clear").mockImplementation(() => {});

// @inquirer/prompts をモック
vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
  Separator: class Separator {
    separator = true;
    constructor(public line?: string) {}
  },
}));

// diff-viewer をモック
vi.mock("../../utils/diff-viewer", () => ({
  getFileLabel: vi.fn((file: FileDiff) => `${file.type}: ${file.path}`),
  showDiffSummaryBox: vi.fn(),
  showFileDiffBox: vi.fn(),
}));

// diff をモック
vi.mock("../../utils/diff", () => ({
  formatDiff: vi.fn(() => "mocked diff output"),
}));

// モック後にインポート
const {
  promptPushConfirm,
  promptPrTitle,
  promptPrBody,
  promptGitHubToken,
  promptSelectFilesWithDiff,
  promptAddUntrackedFiles,
} = await import("../push");
const { checkbox, confirm, input, password } = await import("@inquirer/prompts");
const mockCheckbox = vi.mocked(checkbox);
const mockConfirm = vi.mocked(confirm);
const mockInput = vi.mocked(input);
const mockPassword = vi.mocked(password);

describe("promptPushConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("true を返す場合", async () => {
    mockConfirm.mockResolvedValueOnce(true);

    const diff: DiffResult = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await promptPushConfirm(diff);

    expect(result).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "これらの変更をテンプレートリポジトリに PR として送信しますか？",
      default: false,
    });
  });

  it("false を返す場合", async () => {
    mockConfirm.mockResolvedValueOnce(false);

    const diff: DiffResult = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await promptPushConfirm(diff);

    expect(result).toBe(false);
  });
});

describe("promptPrTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("入力されたタイトルを返す", async () => {
    mockInput.mockResolvedValueOnce("feat: add new feature");

    const result = await promptPrTitle();

    expect(result).toBe("feat: add new feature");
  });

  it("デフォルトタイトルを使用", async () => {
    mockInput.mockResolvedValueOnce("custom default");

    await promptPrTitle("custom default");

    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        default: "custom default",
      }),
    );
  });

  it("デフォルトタイトルが指定されない場合", async () => {
    mockInput.mockResolvedValueOnce("some title");

    await promptPrTitle();

    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        default: "feat: テンプレート設定を更新",
      }),
    );
  });

  it("バリデーション: 空のタイトルは拒否", async () => {
    mockInput.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const emptyResult = validate("");
      const whitespaceResult = validate("   ");
      expect(emptyResult).toBe("タイトルは必須です");
      expect(whitespaceResult).toBe("タイトルは必須です");
      return "valid title";
    });

    await promptPrTitle();
  });

  it("バリデーション: 有効なタイトルは許可", async () => {
    mockInput.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const result = validate("Valid Title");
      expect(result).toBe(true);
      return "Valid Title";
    });

    await promptPrTitle();
  });
});

describe("promptPrBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("説明を追加しない場合は undefined を返す", async () => {
    mockConfirm.mockResolvedValueOnce(false);

    const result = await promptPrBody();

    expect(result).toBeUndefined();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("説明を追加する場合は入力内容を返す", async () => {
    mockConfirm.mockResolvedValueOnce(true);
    mockInput.mockResolvedValueOnce("This is the PR description");

    const result = await promptPrBody();

    expect(result).toBe("This is the PR description");
    expect(mockInput).toHaveBeenCalledWith({
      message: "PR の説明を入力してください",
    });
  });
});

describe("promptGitHubToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("入力されたトークンを返す", async () => {
    mockPassword.mockResolvedValueOnce("ghp_xxxxxxxxxxxx");

    const result = await promptGitHubToken();

    expect(result).toBe("ghp_xxxxxxxxxxxx");
  });

  it("バリデーション: 空のトークンは拒否", async () => {
    mockPassword.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const emptyResult = validate("");
      const whitespaceResult = validate("   ");
      expect(emptyResult).toBe("トークンは必須です");
      expect(whitespaceResult).toBe("トークンは必須です");
      return "ghp_valid";
    });

    await promptGitHubToken();
  });

  it("バリデーション: ghp_ プレフィックスは許可", async () => {
    mockPassword.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const result = validate("ghp_abcdefghij");
      expect(result).toBe(true);
      return "ghp_abcdefghij";
    });

    await promptGitHubToken();
  });

  it("バリデーション: gho_ プレフィックスは許可", async () => {
    mockPassword.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const result = validate("gho_abcdefghij");
      expect(result).toBe(true);
      return "gho_abcdefghij";
    });

    await promptGitHubToken();
  });

  it("バリデーション: github_pat_ プレフィックスは許可", async () => {
    mockPassword.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const result = validate("github_pat_abcdefghij");
      expect(result).toBe(true);
      return "github_pat_abcdefghij";
    });

    await promptGitHubToken();
  });

  it("バリデーション: 無効な形式は拒否", async () => {
    mockPassword.mockImplementationOnce(async (options) => {
      const validate = options.validate as (value: string) => boolean | string;
      const result = validate("invalid_token");
      expect(result).toBe("有効な GitHub トークン形式ではありません");
      return "ghp_valid";
    });

    await promptGitHubToken();
  });
});

describe("promptSelectFilesWithDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("空の配列の場合は空の配列を返す", async () => {
    const result = await promptSelectFilesWithDiff([]);

    expect(result).toEqual([]);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCheckbox).not.toHaveBeenCalled();
  });

  it("詳細確認しない場合はファイル選択のみ", async () => {
    const files: FileDiff[] = [
      {
        path: "file1.txt",
        type: "added",
        localContent: "content1",
        templateContent: null,
      },
      {
        path: "file2.txt",
        type: "modified",
        localContent: "new content",
        templateContent: "old content",
      },
    ];

    mockConfirm.mockResolvedValueOnce(false); // 詳細確認しない
    mockCheckbox.mockResolvedValueOnce(files);

    const result = await promptSelectFilesWithDiff(files);

    expect(result).toEqual(files);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "詳細な diff を確認しますか？",
      default: false,
    });
  });

  it("ファイルを選択しない場合は空の配列", async () => {
    const files: FileDiff[] = [
      {
        path: "file1.txt",
        type: "added",
        localContent: "content1",
        templateContent: null,
      },
    ];

    mockConfirm.mockResolvedValueOnce(false);
    mockCheckbox.mockResolvedValueOnce([]);

    const result = await promptSelectFilesWithDiff(files);

    expect(result).toEqual([]);
  });

  it("一部のファイルのみ選択", async () => {
    const files: FileDiff[] = [
      {
        path: "file1.txt",
        type: "added",
        localContent: "content1",
        templateContent: null,
      },
      {
        path: "file2.txt",
        type: "modified",
        localContent: "new",
        templateContent: "old",
      },
    ];

    mockConfirm.mockResolvedValueOnce(false);
    mockCheckbox.mockResolvedValueOnce([files[0]]);

    const result = await promptSelectFilesWithDiff(files);

    expect(result).toEqual([files[0]]);
  });
});

describe("promptAddUntrackedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("空の配列の場合は空の配列を返す", async () => {
    const result = await promptAddUntrackedFiles([]);

    expect(result).toEqual([]);
    expect(mockCheckbox).not.toHaveBeenCalled();
  });

  it("フォルダを選択しない場合は空の配列", async () => {
    const untrackedByFolder: UntrackedFilesByFolder[] = [
      {
        folder: ".github",
        files: [{ path: ".github/new-file.yml", moduleId: ".github" }],
      },
    ];

    mockCheckbox.mockResolvedValueOnce([]); // フォルダ未選択

    const result = await promptAddUntrackedFiles(untrackedByFolder);

    expect(result).toEqual([]);
  });

  it("ファイルを選択しない場合は空の配列", async () => {
    const untrackedByFolder: UntrackedFilesByFolder[] = [
      {
        folder: ".github",
        files: [{ path: ".github/new-file.yml", moduleId: ".github" }],
      },
    ];

    mockCheckbox
      .mockResolvedValueOnce([".github"]) // フォルダ選択
      .mockResolvedValueOnce([]); // ファイル未選択

    const result = await promptAddUntrackedFiles(untrackedByFolder);

    expect(result).toEqual([]);
  });

  it("ファイルを選択した場合は moduleId ごとにグループ化", async () => {
    const untrackedByFolder: UntrackedFilesByFolder[] = [
      {
        folder: ".github",
        files: [
          { path: ".github/file1.yml", moduleId: ".github" },
          { path: ".github/file2.yml", moduleId: ".github" },
        ],
      },
    ];

    const selectedFiles = untrackedByFolder[0].files;

    mockCheckbox.mockResolvedValueOnce([".github"]).mockResolvedValueOnce(selectedFiles);

    const result = await promptAddUntrackedFiles(untrackedByFolder);

    expect(result).toEqual([
      {
        moduleId: ".github",
        files: [".github/file1.yml", ".github/file2.yml"],
      },
    ]);
  });

  it("複数フォルダからファイルを選択", async () => {
    const untrackedByFolder: UntrackedFilesByFolder[] = [
      {
        folder: ".github",
        files: [{ path: ".github/file1.yml", moduleId: ".github" }],
      },
      {
        folder: ".devcontainer",
        files: [{ path: ".devcontainer/file.json", moduleId: ".devcontainer" }],
      },
    ];

    const allFiles = [untrackedByFolder[0].files[0], untrackedByFolder[1].files[0]];

    mockCheckbox
      .mockResolvedValueOnce([".github", ".devcontainer"])
      .mockResolvedValueOnce(allFiles);

    const result = await promptAddUntrackedFiles(untrackedByFolder);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      moduleId: ".github",
      files: [".github/file1.yml"],
    });
    expect(result).toContainEqual({
      moduleId: ".devcontainer",
      files: [".devcontainer/file.json"],
    });
  });
});
