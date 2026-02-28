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
    bold: (s: string) => s,
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
  },
  box: vi.fn(),
}));

// console.log をモック
vi.spyOn(console, "log").mockImplementation(() => {});

// process.exit をモック
vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// モック後にインポート
const { loadModulesFile, saveModulesFile, modulesFileExists } = await import("../../modules");
const { addPatternToModulesFileWithCreate } = await import("../../modules/loader");

describe("track command - core logic", () => {
  beforeEach(() => {
    vol.reset();
  });

  describe("addPatternToModulesFileWithCreate", () => {
    it("既存モジュールにパターンを追加できる", () => {
      const rawContent = JSON.stringify(
        {
          modules: [
            {
              id: ".cloud",
              name: "Cloud",
              description: "Cloud files",
              patterns: [".cloud/config.json"],
            },
          ],
        },
        null,
        2,
      );

      const result = addPatternToModulesFileWithCreate(rawContent, ".cloud", [".cloud/rules/*.md"]);

      const parsed = JSON.parse(result);
      expect(parsed.modules[0].patterns).toContain(".cloud/config.json");
      expect(parsed.modules[0].patterns).toContain(".cloud/rules/*.md");
    });

    it("新しいモジュールを作成してパターンを追加できる", () => {
      const rawContent = JSON.stringify(
        {
          modules: [
            {
              id: ".",
              name: "Root",
              description: "Root files",
              patterns: [".mcp.json"],
            },
          ],
        },
        null,
        2,
      );

      const result = addPatternToModulesFileWithCreate(rawContent, ".cloud", [
        ".cloud/rules/*.md",
        ".cloud/config.json",
      ]);

      const parsed = JSON.parse(result);
      expect(parsed.modules).toHaveLength(2);
      expect(parsed.modules[1].id).toBe(".cloud");
      expect(parsed.modules[1].name).toBe("Cloud");
      expect(parsed.modules[1].patterns).toEqual([".cloud/rules/*.md", ".cloud/config.json"]);
    });
  });

  describe("modules.jsonc の読み書き", () => {
    it("パターン追加後にファイルを正しく保存できる", async () => {
      const initialContent = JSON.stringify(
        {
          modules: [
            {
              id: ".",
              name: "Root",
              description: "Root files",
              patterns: [".mcp.json"],
            },
          ],
        },
        null,
        2,
      );

      vol.fromJSON({
        "/project/.devenv/modules.jsonc": initialContent,
      });

      const { rawContent } = await loadModulesFile("/project");
      const updated = addPatternToModulesFileWithCreate(rawContent, ".cloud", [
        ".cloud/rules/*.md",
      ]);
      await saveModulesFile("/project", updated);

      const saved = vol.readFileSync("/project/.devenv/modules.jsonc", "utf8") as string;
      const parsed = JSON.parse(saved);
      expect(parsed.modules).toHaveLength(2);
      expect(parsed.modules[1].id).toBe(".cloud");
    });

    it("modules.jsonc が存在しない場合を検知できる", () => {
      vol.fromJSON({});
      expect(modulesFileExists("/project")).toBe(false);
    });
  });
});
