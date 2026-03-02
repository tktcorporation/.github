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
import {
  confirmAction,
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

    it("should use default title as placeholder", async () => {
      vi.mocked(p.text).mockResolvedValue("custom title");
      await inputPrTitle("default title");
      expect(p.text).toHaveBeenCalledWith(
        expect.objectContaining({ placeholder: "default title" }),
      );
    });
  });

  describe("inputPrBody", () => {
    it("should return undefined if declined", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      const result = await inputPrBody();
      expect(result).toBeUndefined();
    });

    it("should return body if accepted", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.text).mockResolvedValue("description");
      const result = await inputPrBody();
      expect(result).toBe("description");
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
  });
});
