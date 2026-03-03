import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  log: {
    warn: vi.fn(),
    message: vi.fn(),
  },
}));

import * as p from "@clack/prompts";
import type { FileDiff } from "../../modules/schemas";
import {
  confirmAction,
  generatePrBody,
  generatePrTitle,
  inputGitHubToken,
  inputPrBody,
  inputPrTitle,
  selectModules,
  selectOverwriteStrategy,
  selectPushFiles,
} from "../prompts";

const testModules = [
  {
    id: "devcontainer",
    name: "Dev Container",
    description: "Dev Container config",
    patterns: [],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    description: "CI/CD",
    patterns: [],
  },
];

describe("prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectModules", () => {
    it("should return selected module IDs", async () => {
      vi.mocked(p.multiselect).mockResolvedValue(["devcontainer"]);
      const result = await selectModules(testModules);
      expect(result).toEqual(["devcontainer"]);
    });

    it("should pass all modules as initial values", async () => {
      vi.mocked(p.multiselect).mockResolvedValue(["devcontainer", "github-actions"]);
      await selectModules(testModules);
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValues: ["devcontainer", "github-actions"],
        }),
      );
    });
  });

  describe("selectOverwriteStrategy", () => {
    it("should return selected strategy", async () => {
      vi.mocked(p.select).mockResolvedValue("overwrite");
      const result = await selectOverwriteStrategy();
      expect(result).toBe("overwrite");
    });

    it("should default to overwrite for new projects", async () => {
      vi.mocked(p.select).mockResolvedValue("overwrite");
      await selectOverwriteStrategy();
      expect(p.select).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: "overwrite",
        }),
      );
    });

    it("should default to skip for re-init projects", async () => {
      vi.mocked(p.select).mockResolvedValue("skip");
      await selectOverwriteStrategy({ isReinit: true });
      expect(p.select).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: "skip",
          message: expect.stringContaining("re-init"),
        }),
      );
    });
  });

  describe("selectPushFiles", () => {
    it("should filter files by selection", async () => {
      const files = [
        { path: "a.ts", type: "added" as const },
        { path: "b.ts", type: "modified" as const },
      ];
      vi.mocked(p.multiselect).mockResolvedValue(["a.ts"]);
      const result = await selectPushFiles(files);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("a.ts");
    });

    it("should return empty array when nothing selected", async () => {
      const files = [{ path: "a.ts", type: "added" as const }];
      vi.mocked(p.multiselect).mockResolvedValue([]);
      const result = await selectPushFiles(files);
      expect(result).toHaveLength(0);
    });
  });

  describe("inputPrTitle", () => {
    it("should return entered title", async () => {
      vi.mocked(p.text).mockResolvedValue("feat: add config");
      const result = await inputPrTitle();
      expect(result).toBe("feat: add config");
    });

    it("should use default title as defaultValue", async () => {
      vi.mocked(p.text).mockResolvedValue("default title");
      await inputPrTitle("default title");
      expect(p.text).toHaveBeenCalledWith(
        expect.objectContaining({ defaultValue: "default title" }),
      );
    });

    it("should use placeholder when no default title provided", async () => {
      vi.mocked(p.text).mockResolvedValue("custom title");
      await inputPrTitle();
      expect(p.text).toHaveBeenCalledWith(
        expect.objectContaining({
          placeholder: "feat: update template config",
          defaultValue: undefined,
        }),
      );
    });
  });

  describe("generatePrTitle", () => {
    it("should generate feat prefix for added-only files", () => {
      const files: FileDiff[] = [{ path: ".devcontainer/devcontainer.json", type: "added" }];
      expect(generatePrTitle(files)).toBe("feat: add .devcontainer config");
    });

    it("should generate chore prefix for modified files", () => {
      const files: FileDiff[] = [{ path: ".github/workflows/ci.yml", type: "modified" }];
      expect(generatePrTitle(files)).toBe("chore: update .github config");
    });

    it("should generate chore prefix for mixed changes", () => {
      const files: FileDiff[] = [
        { path: ".devcontainer/devcontainer.json", type: "added" },
        { path: ".github/workflows/ci.yml", type: "modified" },
      ];
      expect(generatePrTitle(files)).toBe("chore: update .devcontainer, .github config");
    });

    it("should use generic title for many modules", () => {
      const files: FileDiff[] = [
        { path: ".devcontainer/a.json", type: "added" },
        { path: ".github/b.yml", type: "added" },
        { path: ".claude/c.md", type: "added" },
        { path: ".mcp/d.json", type: "added" },
      ];
      expect(generatePrTitle(files)).toBe("feat: update template configuration");
    });

    it("should handle root-level files", () => {
      const files: FileDiff[] = [{ path: ".mcp.json", type: "modified" }];
      expect(generatePrTitle(files)).toBe("chore: update .mcp.json config");
    });
  });

  describe("inputPrBody", () => {
    it("should return undefined for empty input", async () => {
      vi.mocked(p.text).mockResolvedValue("");
      const result = await inputPrBody();
      expect(result).toBeUndefined();
    });

    it("should return body text", async () => {
      vi.mocked(p.text).mockResolvedValue("description");
      const result = await inputPrBody();
      expect(result).toBe("description");
    });

    it("should pass defaultBody as defaultValue", async () => {
      vi.mocked(p.text).mockResolvedValue("auto body");
      await inputPrBody("auto body");
      expect(p.text).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: "auto body" }));
    });
  });

  describe("generatePrBody", () => {
    it("should list added files", () => {
      const files: FileDiff[] = [{ path: ".devcontainer/devcontainer.json", type: "added" }];
      const body = generatePrBody(files);
      expect(body).toContain("**Added:**");
      expect(body).toContain("`.devcontainer/devcontainer.json`");
    });

    it("should list modified files", () => {
      const files: FileDiff[] = [{ path: ".github/workflows/ci.yml", type: "modified" }];
      const body = generatePrBody(files);
      expect(body).toContain("**Modified:**");
      expect(body).toContain("`.github/workflows/ci.yml`");
    });

    it("should list both added and modified", () => {
      const files: FileDiff[] = [
        { path: "a.json", type: "added" },
        { path: "b.yml", type: "modified" },
      ];
      const body = generatePrBody(files);
      expect(body).toContain("**Added:**");
      expect(body).toContain("**Modified:**");
    });

    it("should include berm attribution", () => {
      const files: FileDiff[] = [{ path: "a.json", type: "added" }];
      const body = generatePrBody(files);
      expect(body).toContain("@tktco/berm");
    });
  });

  describe("inputGitHubToken", () => {
    it("should return entered token", async () => {
      vi.mocked(p.password).mockResolvedValue("ghp_test123");
      const result = await inputGitHubToken();
      expect(result).toBe("ghp_test123");
    });

    it("should show warning about missing token", async () => {
      vi.mocked(p.password).mockResolvedValue("ghp_test123");
      await inputGitHubToken();
      expect(p.log.warn).toHaveBeenCalled();
    });
  });

  describe("confirmAction", () => {
    it("should return true when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      const result = await confirmAction("Proceed?");
      expect(result).toBe(true);
    });

    it("should return false when denied", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      const result = await confirmAction("Proceed?");
      expect(result).toBe(false);
    });

    it("should default to false without options", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      await confirmAction("Proceed?");
      expect(p.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: false }));
    });

    it("should use custom initialValue when provided", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      await confirmAction("Proceed?", { initialValue: true });
      expect(p.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: true }));
    });
  });
});
