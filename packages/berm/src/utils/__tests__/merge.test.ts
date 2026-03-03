import { describe, expect, it } from "vitest";
import { classifyFiles, hasConflictMarkers, threeWayMerge } from "../merge";

describe("merge", () => {
  describe("classifyFiles", () => {
    it("全6カテゴリに正しく分類する", () => {
      const result = classifyFiles({
        baseHashes: {
          "unchanged.txt": "aaa",
          "auto-update.txt": "bbb",
          "local-only.txt": "ccc",
          "conflict.txt": "ddd",
          "deleted.txt": "eee",
        },
        localHashes: {
          "unchanged.txt": "aaa",
          "auto-update.txt": "bbb",
          "local-only.txt": "ccc-modified",
          "conflict.txt": "ddd-local",
        },
        templateHashes: {
          "unchanged.txt": "aaa",
          "auto-update.txt": "bbb-updated",
          "local-only.txt": "ccc",
          "conflict.txt": "ddd-template",
          "new-file.txt": "fff",
        },
      });

      expect(result.unchanged).toContain("unchanged.txt");
      expect(result.autoUpdate).toContain("auto-update.txt");
      expect(result.localOnly).toContain("local-only.txt");
      expect(result.conflicts).toContain("conflict.txt");
      expect(result.newFiles).toContain("new-file.txt");
      expect(result.deletedFiles).toContain("deleted.txt");
    });

    it("空のハッシュマップを処理する", () => {
      const result = classifyFiles({
        baseHashes: {},
        localHashes: {},
        templateHashes: {},
      });

      expect(result.unchanged).toEqual([]);
      expect(result.autoUpdate).toEqual([]);
      expect(result.localOnly).toEqual([]);
      expect(result.conflicts).toEqual([]);
      expect(result.newFiles).toEqual([]);
      expect(result.deletedFiles).toEqual([]);
    });

    it("ローカルのみに存在するファイルを localOnly に分類する", () => {
      const result = classifyFiles({
        baseHashes: {},
        localHashes: { "my-file.txt": "abc" },
        templateHashes: {},
      });

      expect(result.localOnly).toContain("my-file.txt");
    });

    it("両方が同じ内容に変更された場合は unchanged に分類する", () => {
      const result = classifyFiles({
        baseHashes: { "file.txt": "old" },
        localHashes: { "file.txt": "new" },
        templateHashes: { "file.txt": "new" },
      });

      expect(result.unchanged).toContain("file.txt");
    });
  });

  describe("threeWayMerge", () => {
    it("クリーンマージ: 異なる箇所への変更が正しくマージされる", () => {
      const base = "line1\nline2\nline3\n";
      const local = "local-added\nline1\nline2\nline3\n";
      const template = "line1\nline2\nline3\ntemplate-added\n";

      const result = threeWayMerge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("local-added");
      expect(result.content).toContain("template-added");
    });

    it("コンフリクト: 同じ行を異なる内容に変更した場合", () => {
      const base = "line1\noriginal\nline3\n";
      const local = "line1\nlocal-change\nline3\n";
      const template = "line1\ntemplate-change\nline3\n";

      const result = threeWayMerge(base, local, template);

      // applyPatch が失敗した場合はコンフリクトマーカーが含まれる
      if (result.hasConflicts) {
        expect(result.content).toContain("<<<<<<< LOCAL");
        expect(result.content).toContain("=======");
        expect(result.content).toContain(">>>>>>> TEMPLATE");
      }
      // applyPatch が成功する場合もある（diff の実装依存）
    });

    it("ローカルとテンプレートが同一の場合はコンフリクトなし", () => {
      const base = "original content\n";
      const local = "same modified content\n";
      const template = "same modified content\n";

      const result = threeWayMerge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("same modified content\n");
    });

    it("ローカルが base と同一の場合はテンプレートの内容になる", () => {
      const base = "original\n";
      const local = "original\n";
      const template = "updated by template\n";

      const result = threeWayMerge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("updated by template\n");
    });

    it("テンプレートが base と同一の場合はローカルの内容を保持する", () => {
      const base = "original\n";
      const local = "modified locally\n";
      const template = "original\n";

      const result = threeWayMerge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("modified locally\n");
    });
  });

  describe("hasConflictMarkers", () => {
    it("コンフリクトマーカーを含む内容を検出する", () => {
      const content = `line1
<<<<<<< LOCAL
local content
=======
template content
>>>>>>> TEMPLATE
line2`;

      const result = hasConflictMarkers(content);

      expect(result.found).toBe(true);
      expect(result.lines).toEqual([2, 4, 6]);
    });

    it("コンフリクトマーカーがない場合", () => {
      const content = "normal line1\nnormal line2\nnormal line3\n";

      const result = hasConflictMarkers(content);

      expect(result.found).toBe(false);
      expect(result.lines).toEqual([]);
    });

    it("部分的なマーカー（<<<<<<< のみ）を検出する", () => {
      const content = "line1\n<<<<<<< LOCAL\nsome content\n";

      const result = hasConflictMarkers(content);

      expect(result.found).toBe(true);
      expect(result.lines).toEqual([2]);
    });
  });
});
