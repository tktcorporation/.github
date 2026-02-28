import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateModule } from "../../modules/schemas";

// @inquirer/prompts をモック
vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
}));

// モック後にインポート
const { promptInit } = await import("../init");
const { checkbox, select } = await import("@inquirer/prompts");
const mockCheckbox = vi.mocked(checkbox);
const mockSelect = vi.mocked(select);

const testModules: TemplateModule[] = [
  {
    id: "root",
    name: "Root Config",
    description: "Root configuration files",
    patterns: [".mcp.json", ".mise.toml"],
  },
  {
    id: "devcontainer",
    name: "Dev Container",
    description: "Docker dev environment",
    patterns: [".devcontainer/**"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub Actions and configs",
    patterns: [".github/**"],
  },
];

describe("promptInit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("モジュール選択と上書き戦略を返す", async () => {
    mockCheckbox.mockResolvedValueOnce(["root", "devcontainer"]);
    mockSelect.mockResolvedValueOnce("prompt");

    const result = await promptInit(testModules);

    expect(result).toEqual({
      modules: ["root", "devcontainer"],
      overwriteStrategy: "prompt",
    });
  });

  it("全モジュールを選択可能", async () => {
    mockCheckbox.mockResolvedValueOnce(["root", "devcontainer", "github"]);
    mockSelect.mockResolvedValueOnce("overwrite");

    const result = await promptInit(testModules);

    expect(result).toEqual({
      modules: ["root", "devcontainer", "github"],
      overwriteStrategy: "overwrite",
    });
  });

  it("モジュールを1つも選択しない場合はエラー", async () => {
    mockCheckbox.mockResolvedValueOnce([]);
    mockSelect.mockResolvedValueOnce("skip");

    await expect(promptInit(testModules)).rejects.toThrow(
      "少なくとも1つのモジュールを選択してください",
    );
  });

  it("overwrite 戦略を選択", async () => {
    mockCheckbox.mockResolvedValueOnce(["root"]);
    mockSelect.mockResolvedValueOnce("overwrite");

    const result = await promptInit(testModules);

    expect(result.overwriteStrategy).toBe("overwrite");
  });

  it("skip 戦略を選択", async () => {
    mockCheckbox.mockResolvedValueOnce(["root"]);
    mockSelect.mockResolvedValueOnce("skip");

    const result = await promptInit(testModules);

    expect(result.overwriteStrategy).toBe("skip");
  });

  it("checkbox にモジュール一覧が渡される", async () => {
    mockCheckbox.mockResolvedValueOnce(["root"]);
    mockSelect.mockResolvedValueOnce("prompt");

    await promptInit(testModules);

    expect(mockCheckbox).toHaveBeenCalledWith({
      message: "適用するテンプレートを選択してください",
      choices: [
        {
          name: "Root Config - Root configuration files",
          value: "root",
          checked: true,
        },
        {
          name: "Dev Container - Docker dev environment",
          value: "devcontainer",
          checked: true,
        },
        {
          name: "GitHub - GitHub Actions and configs",
          value: "github",
          checked: true,
        },
      ],
    });
  });

  it("select に上書き戦略の選択肢が渡される", async () => {
    mockCheckbox.mockResolvedValueOnce(["root"]);
    mockSelect.mockResolvedValueOnce("prompt");

    await promptInit(testModules);

    expect(mockSelect).toHaveBeenCalledWith({
      message: "既存ファイルが見つかった場合の処理方法",
      choices: [
        { name: "確認しながら進める", value: "prompt" },
        { name: "すべて上書き", value: "overwrite" },
        { name: "スキップ (既存ファイルを保持)", value: "skip" },
      ],
      default: "prompt",
    });
  });

  it("無効な上書き戦略の場合はエラー", async () => {
    mockCheckbox.mockResolvedValueOnce(["root"]);
    mockSelect.mockResolvedValueOnce("invalid_strategy");

    await expect(promptInit(testModules)).rejects.toThrow();
  });
});
