import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyResult } from "../template";

// fs モジュールをモック
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// @inquirer/prompts をモック
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

// consola をモック（ログ出力を抑制）
vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    start: vi.fn(),
    box: vi.fn(),
  },
}));

// モック後にインポート
const { copyFile, copyDirectory } = await import("../template");
const { confirm } = await import("@inquirer/prompts");
const mockConfirm = vi.mocked(confirm);

describe("copyFile", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  describe("新規ファイル", () => {
    it("常にコピーする", async () => {
      vol.fromJSON({
        "/src/file.txt": "source content",
      });

      const result = await copyFile(
        "/src/file.txt",
        "/dest/file.txt",
        "skip",
        "file.txt",
      );

      expect(result).toEqual<CopyResult>({
        action: "copied",
        path: "file.txt",
      });
      expect(vol.readFileSync("/dest/file.txt", "utf8")).toBe("source content");
    });

    it("親ディレクトリが存在しない場合は作成する", async () => {
      vol.fromJSON({
        "/src/file.txt": "source content",
      });

      await copyFile(
        "/src/file.txt",
        "/dest/nested/dir/file.txt",
        "skip",
        "nested/dir/file.txt",
      );

      expect(vol.existsSync("/dest/nested/dir")).toBe(true);
      expect(vol.readFileSync("/dest/nested/dir/file.txt", "utf8")).toBe(
        "source content",
      );
    });
  });

  describe("既存ファイル - overwrite 戦略", () => {
    it("上書きする", async () => {
      vol.fromJSON({
        "/src/file.txt": "new content",
        "/dest/file.txt": "old content",
      });

      const result = await copyFile(
        "/src/file.txt",
        "/dest/file.txt",
        "overwrite",
        "file.txt",
      );

      expect(result).toEqual<CopyResult>({
        action: "overwritten",
        path: "file.txt",
      });
      expect(vol.readFileSync("/dest/file.txt", "utf8")).toBe("new content");
    });
  });

  describe("既存ファイル - skip 戦略", () => {
    it("スキップする（コピーしない）", async () => {
      vol.fromJSON({
        "/src/file.txt": "new content",
        "/dest/file.txt": "old content",
      });

      const result = await copyFile(
        "/src/file.txt",
        "/dest/file.txt",
        "skip",
        "file.txt",
      );

      expect(result).toEqual<CopyResult>({
        action: "skipped",
        path: "file.txt",
      });
      // 元のファイルが保持されている
      expect(vol.readFileSync("/dest/file.txt", "utf8")).toBe("old content");
    });
  });

  describe("既存ファイル - prompt 戦略", () => {
    it("ユーザーが Yes の場合は上書きする", async () => {
      vol.fromJSON({
        "/src/file.txt": "new content",
        "/dest/file.txt": "old content",
      });

      mockConfirm.mockResolvedValueOnce(true);

      const result = await copyFile(
        "/src/file.txt",
        "/dest/file.txt",
        "prompt",
        "file.txt",
      );

      expect(result).toEqual<CopyResult>({
        action: "overwritten",
        path: "file.txt",
      });
      expect(vol.readFileSync("/dest/file.txt", "utf8")).toBe("new content");
      expect(mockConfirm).toHaveBeenCalledWith({
        message: "file.txt は既に存在します。上書きしますか?",
        default: false,
      });
    });

    it("ユーザーが No の場合はスキップする", async () => {
      vol.fromJSON({
        "/src/file.txt": "new content",
        "/dest/file.txt": "old content",
      });

      mockConfirm.mockResolvedValueOnce(false);

      const result = await copyFile(
        "/src/file.txt",
        "/dest/file.txt",
        "prompt",
        "file.txt",
      );

      expect(result).toEqual<CopyResult>({
        action: "skipped",
        path: "file.txt",
      });
      expect(vol.readFileSync("/dest/file.txt", "utf8")).toBe("old content");
    });
  });
});

describe("copyDirectory", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  it("ディレクトリ構造を再帰的にコピーする", async () => {
    vol.fromJSON({
      "/src/dir/file1.txt": "content1",
      "/src/dir/subdir/file2.txt": "content2",
    });

    const results = await copyDirectory("/src/dir", "/dest/dir", [], "skip");

    expect(results).toHaveLength(2);
    expect(vol.readFileSync("/dest/dir/file1.txt", "utf8")).toBe("content1");
    expect(vol.readFileSync("/dest/dir/subdir/file2.txt", "utf8")).toBe(
      "content2",
    );
  });

  it("除外パターンに一致するファイルをスキップする", async () => {
    vol.fromJSON({
      "/src/dir/file1.txt": "content1",
      "/src/dir/excluded.txt": "excluded",
      "/src/dir/subdir/file2.txt": "content2",
    });

    const results = await copyDirectory(
      "/src/dir",
      "/dest/dir",
      ["excluded.txt"],
      "skip",
    );

    expect(results).toHaveLength(2);
    expect(vol.existsSync("/dest/dir/file1.txt")).toBe(true);
    expect(vol.existsSync("/dest/dir/excluded.txt")).toBe(false);
    expect(vol.existsSync("/dest/dir/subdir/file2.txt")).toBe(true);
  });

  it("各戦略を子ファイルに適用する", async () => {
    vol.fromJSON({
      "/src/dir/new.txt": "new content",
      "/src/dir/existing.txt": "updated content",
      "/dest/dir/existing.txt": "old content",
    });

    const results = await copyDirectory(
      "/src/dir",
      "/dest/dir",
      [],
      "overwrite",
    );

    expect(results).toContainEqual<CopyResult>({
      action: "copied",
      path: "new.txt",
    });
    expect(results).toContainEqual<CopyResult>({
      action: "overwritten",
      path: "existing.txt",
    });
    expect(vol.readFileSync("/dest/dir/existing.txt", "utf8")).toBe(
      "updated content",
    );
  });

  it("basePath を正しく伝播する", async () => {
    vol.fromJSON({
      "/src/dir/subdir/file.txt": "content",
    });

    const results = await copyDirectory(
      "/src/dir",
      "/dest/dir",
      [],
      "skip",
      "mydir",
    );

    expect(results[0].path).toBe("mydir/subdir/file.txt");
  });
});
