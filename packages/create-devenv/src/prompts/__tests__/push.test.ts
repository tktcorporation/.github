import type * as readline from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../modules/schemas";
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

// readline をモック
vi.mock("node:readline", () => ({
  emitKeypressEvents: vi.fn(),
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
const { showFileDiffBox } = await import("../../utils/diff-viewer");
const readlineMock = await import("node:readline");
const mockCheckbox = vi.mocked(checkbox);
const mockConfirm = vi.mocked(confirm);
const mockInput = vi.mocked(input);
const mockPassword = vi.mocked(password);
const mockShowFileDiffBox = vi.mocked(showFileDiffBox);
const mockEmitKeypressEvents = vi.mocked(readlineMock.emitKeypressEvents);

describe("promptPushConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("true を返す場合", async () => {
    mockConfirm.mockResolvedValueOnce(true);

    const diff = {
      files: [],
      summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
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

    const diff = {
      files: [],
      summary: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
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
        files: [{ path: ".github/new-file.yml", folder: ".github", moduleId: ".github" }],
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
        files: [{ path: ".github/new-file.yml", folder: ".github", moduleId: ".github" }],
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
          { path: ".github/file1.yml", folder: ".github", moduleId: ".github" },
          { path: ".github/file2.yml", folder: ".github", moduleId: ".github" },
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
        files: [{ path: ".github/file1.yml", folder: ".github", moduleId: ".github" }],
      },
      {
        folder: ".devcontainer",
        files: [
          { path: ".devcontainer/file.json", folder: ".devcontainer", moduleId: ".devcontainer" },
        ],
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

describe("interactiveDiffViewer (via promptSelectFilesWithDiff)", () => {
  // stdin をモックするためのヘルパー
  type KeypressHandler = (str: string, key: readline.Key) => void;
  let keypressHandlers: KeypressHandler[] = [];
  let originalStdin: typeof process.stdin;
  let mockStdin: {
    isTTY: boolean;
    removeAllListeners: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    keypressHandlers = [];

    // stdin のモックを作成
    mockStdin = {
      isTTY: true,
      removeAllListeners: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
      setRawMode: vi.fn().mockReturnThis(),
      resume: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, handler: KeypressHandler) => {
        if (event === "keypress") {
          keypressHandlers.push(handler);
        }
        return mockStdin;
      }),
    };

    // process.stdin を差し替え
    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // process.stdin を復元
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  // キー入力をシミュレート
  const simulateKeypress = (key: Partial<readline.Key>) => {
    for (const handler of keypressHandlers) {
      handler("", key as readline.Key);
    }
  };

  it("TTY でない場合は全ファイルを順次表示して終了", async () => {
    mockStdin.isTTY = false;

    const files: FileDiff[] = [
      { path: "file1.txt", type: "added", localContent: "content1" },
      { path: "file2.txt", type: "modified", localContent: "new", templateContent: "old" },
    ];

    mockConfirm.mockResolvedValueOnce(true); // 詳細確認する
    mockCheckbox.mockResolvedValueOnce(files);

    await promptSelectFilesWithDiff(files);

    // 全ファイルが showFileDiffBox で表示される
    expect(mockShowFileDiffBox).toHaveBeenCalledTimes(2);
    expect(mockShowFileDiffBox).toHaveBeenNthCalledWith(1, files[0], 0, 2, {
      showLineNumbers: true,
    });
    expect(mockShowFileDiffBox).toHaveBeenNthCalledWith(2, files[1], 1, 2, {
      showLineNumbers: true,
    });

    // readline.emitKeypressEvents は呼ばれない
    expect(mockEmitKeypressEvents).not.toHaveBeenCalled();
  });

  it("TTY の場合は stdin のリスナーをリセットしてセットアップ", async () => {
    const files: FileDiff[] = [{ path: "file1.txt", type: "added", localContent: "content1" }];

    mockConfirm.mockResolvedValueOnce(true); // 詳細確認する
    mockCheckbox.mockResolvedValueOnce(files);

    // 非同期で q キーを押してビューワーを終了
    setTimeout(() => {
      simulateKeypress({ name: "q" });
    }, 10);

    await promptSelectFilesWithDiff(files);

    // 既存の keypress リスナーが削除される
    expect(mockStdin.removeAllListeners).toHaveBeenCalledWith("keypress");

    // readline.emitKeypressEvents が呼ばれる
    expect(mockEmitKeypressEvents).toHaveBeenCalledWith(mockStdin);

    // stdin がセットアップされる
    expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
    expect(mockStdin.resume).toHaveBeenCalled();
    expect(mockStdin.on).toHaveBeenCalledWith("keypress", expect.any(Function));
  });

  it("n キーで次のファイルに移動", async () => {
    const files: FileDiff[] = [
      { path: "file1.txt", type: "added", localContent: "content1" },
      { path: "file2.txt", type: "modified", localContent: "new", templateContent: "old" },
    ];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      // 最初のファイルが表示された後、n を押して次へ
      simulateKeypress({ name: "n" });
      // その後 q で終了
      setTimeout(() => {
        simulateKeypress({ name: "q" });
      }, 10);
    }, 10);

    await promptSelectFilesWithDiff(files);

    // 最初のファイル + n で次のファイル = 2回表示
    expect(mockShowFileDiffBox).toHaveBeenCalledWith(
      files[0],
      0,
      2,
      expect.objectContaining({ showLineNumbers: true }),
    );
    expect(mockShowFileDiffBox).toHaveBeenCalledWith(
      files[1],
      1,
      2,
      expect.objectContaining({ showLineNumbers: true }),
    );
  });

  it("p キーで前のファイルに移動", async () => {
    const files: FileDiff[] = [
      { path: "file1.txt", type: "added", localContent: "content1" },
      { path: "file2.txt", type: "modified", localContent: "new", templateContent: "old" },
    ];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      simulateKeypress({ name: "n" }); // 次へ
      setTimeout(() => {
        simulateKeypress({ name: "p" }); // 前へ
        setTimeout(() => {
          simulateKeypress({ name: "q" }); // 終了
        }, 10);
      }, 10);
    }, 10);

    await promptSelectFilesWithDiff(files);

    // file1 → file2 → file1 の順で表示される
    const calls = mockShowFileDiffBox.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("Enter キーで終了", async () => {
    const files: FileDiff[] = [{ path: "file1.txt", type: "added", localContent: "content1" }];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      simulateKeypress({ name: "return" });
    }, 10);

    await promptSelectFilesWithDiff(files);

    // cleanup が呼ばれる（setRawMode(false) と resume）
    expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("最初のファイルで p を押しても移動しない", async () => {
    const files: FileDiff[] = [
      { path: "file1.txt", type: "added", localContent: "content1" },
      { path: "file2.txt", type: "modified", localContent: "new", templateContent: "old" },
    ];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      simulateKeypress({ name: "p" }); // 最初なので移動しない
      setTimeout(() => {
        simulateKeypress({ name: "q" });
      }, 10);
    }, 10);

    await promptSelectFilesWithDiff(files);

    // file1 が1回だけ表示される（p を押しても移動しない）
    const file1Calls = mockShowFileDiffBox.mock.calls.filter(
      (call) => call[0].path === "file1.txt",
    );
    expect(file1Calls.length).toBe(1);
  });

  it("最後のファイルで n を押しても移動しない", async () => {
    const files: FileDiff[] = [{ path: "file1.txt", type: "added", localContent: "content1" }];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      simulateKeypress({ name: "n" }); // 最後なので移動しない
      setTimeout(() => {
        simulateKeypress({ name: "q" });
      }, 10);
    }, 10);

    await promptSelectFilesWithDiff(files);

    // file1 が1回だけ表示される
    expect(mockShowFileDiffBox).toHaveBeenCalledTimes(1);
  });

  it("cleanup 後は次の @inquirer/prompts が使えるよう stdin が復元される", async () => {
    const files: FileDiff[] = [{ path: "file1.txt", type: "added", localContent: "content1" }];

    mockConfirm.mockResolvedValueOnce(true);
    mockCheckbox.mockResolvedValueOnce(files);

    setTimeout(() => {
      simulateKeypress({ name: "q" });
    }, 10);

    await promptSelectFilesWithDiff(files);

    // cleanup で stdin.resume() が呼ばれる
    // setRawMode(true) → setRawMode(false) の順で呼ばれる
    const setRawModeCalls = mockStdin.setRawMode.mock.calls;
    expect(setRawModeCalls).toContainEqual([true]);
    expect(setRawModeCalls).toContainEqual([false]);
  });
});
