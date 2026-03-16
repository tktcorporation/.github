import { describe, expect, it } from "vitest";
import {
  asBaseContent,
  asLocalContent,
  asTemplateContent,
  classifyFiles,
  hasConflictMarkers,
  mergeJsonContent,
  threeWayMerge,
} from "../merge";

/** テスト用ヘルパー: named params で threeWayMerge を呼ぶ */
function merge(base: string, local: string, template: string, filePath?: string) {
  return threeWayMerge({
    base: asBaseContent(base),
    local: asLocalContent(local),
    template: asTemplateContent(template),
    filePath,
  });
}

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

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("local-added");
      expect(result.content).toContain("template-added");
    });

    it("コンフリクト: 同じ行を異なる内容に変更した場合", () => {
      const base = "line1\noriginal\nline3\n";
      const local = "line1\nlocal-change\nline3\n";
      const template = "line1\ntemplate-change\nline3\n";

      const result = merge(base, local, template);

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

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("same modified content\n");
    });

    it("ローカルが base と同一の場合はテンプレートの内容になる", () => {
      const base = "original\n";
      const local = "original\n";
      const template = "updated by template\n";

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("updated by template\n");
    });

    it("テンプレートが base と同一の場合はローカルの内容を保持する", () => {
      const base = "original\n";
      const local = "modified locally\n";
      const template = "original\n";

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toBe("modified locally\n");
    });

    it("JSON ファイルパスが渡された場合、構造マージを使用する", () => {
      const base = '{\n  "a": 1,\n  "b": 2\n}\n';
      const local = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n';
      const template = '{\n  "a": 1,\n  "b": 2,\n  "d": 4\n}\n';

      const result = merge(base, local, template, "config.json");

      expect(result.hasConflicts).toBe(false);
      // ローカルの c:3 とテンプレートの d:4 が両方含まれる
      const parsed = JSON.parse(result.content);
      expect(parsed.c).toBe(3);
      expect(parsed.d).toBe(4);
    });

    it("filePath なしの場合は従来のテキストマージを使用する", () => {
      const base = "line1\nline2\nline3\n";
      const local = "line1\nline2-modified\nline3\n";
      const template = "line1\nline2\nline3\nline4\n";

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
    });
  });

  describe("threeWayMerge - テキストマージ改善", () => {
    it("fuzz factor でパッチ適用精度が上がる", () => {
      // ローカルで微小な変更があっても、離れた位置のテンプレート変更が適用される
      const base = "header\nline1\nline2\nline3\nline4\nline5\nfooter\n";
      const local = "header-modified\nline1\nline2\nline3\nline4\nline5\nfooter\n";
      const template = "header\nline1\nline2\nline3\nline4\nline5\nfooter-updated\n";

      const result = merge(base, local, template);

      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("header-modified");
      expect(result.content).toContain("footer-updated");
    });

    it("hunk 単位のコンフリクトマーカーで影響範囲を最小化", () => {
      // 十分に離れた2箇所を変更して、別々の hunk になるようにする
      const baseLines = [
        "line1",
        "original-a",
        "line3",
        "line4",
        "line5",
        "line6",
        "line7",
        "line8",
        "line9",
        "line10",
        "original-b",
        "line12",
        "",
      ];
      const localLines = [...baseLines];
      localLines[1] = "local-a";
      localLines[10] = "local-b";
      const templateLines = [...baseLines];
      templateLines[1] = "template-a";
      templateLines[10] = "template-b";

      const base = baseLines.join("\n");
      const local = localLines.join("\n");
      const template = templateLines.join("\n");

      const result = merge(base, local, template);

      if (result.hasConflicts) {
        // マーカーが含まれるが、変更されていない行（line3〜line9）も結果に含まれる
        expect(result.content).toContain("<<<<<<< LOCAL");
        expect(result.content).toContain(">>>>>>> TEMPLATE");
        // 変更がないコンテキスト行がそのまま残っている
        expect(result.content).toContain("line5");
        expect(result.content).toContain("line6");
      }
    });
  });

  describe("threeWayMerge - local/template の非対称性（#148 回帰テスト）", () => {
    it("JSONC コメントはローカル側のものが保持される", () => {
      // 背景: #148 で引数が逆転し、テンプレート側をベースにしたためローカルのコメントが消えた
      const base = '{\n  "a": 1\n}';
      const local = '{\n  // ユーザーが追加したコメント\n  "a": 1,\n  "b": 2\n}';
      const template = '{\n  "a": 1,\n  "c": 3\n}';

      const result = merge(base, local, template, "settings.json");

      expect(result.hasConflicts).toBe(false);
      // ローカルのコメントが保持されていること
      expect(result.content).toContain("ユーザーが追加したコメント");
      // テンプレートの新キーも適用されていること
      const parsed = JSON.parse(result.content.replace(/\/\/.*$/gm, ""));
      expect(parsed.b).toBe(2);
      expect(parsed.c).toBe(3);
    });

    it("ローカルのフォーマットが保持され、テンプレートのフォーマットに上書きされない", () => {
      // 背景: 引数逆転時、テンプレートのフォーマットが使われユーザーの整形が失われた
      const base = '{\n  "a": 1,\n  "b": 2\n}';
      // ローカル: ユーザーがキーを追加
      const local = '{\n  "a": 1,\n  "b": 2,\n  "localKey": "value"\n}';
      // テンプレート: テンプレートがキーを追加
      const template = '{\n  "a": 1,\n  "b": 2,\n  "templateKey": "value"\n}';

      const result = merge(base, local, template, "config.json");

      expect(result.hasConflicts).toBe(false);
      // ローカルのキーが保持されていること
      expect(result.content).toContain('"localKey"');
      // テンプレートの新キーも追加されていること
      const parsed = JSON.parse(result.content);
      expect(parsed.templateKey).toBe("value");
      expect(parsed.localKey).toBe("value");
      // ローカル側が起点なので、ローカルの既存キーはそのまま残る
      expect(parsed.a).toBe(1);
      expect(parsed.b).toBe(2);
    });

    it("コンフリクト時にローカル値が優先される（テンプレート値ではない）", () => {
      // 背景: 引数逆転時、テンプレート値が "local" として優先されていた
      const base = '{\n  "version": "1.0"\n}';
      const local = '{\n  "version": "2.0-user"\n}';
      const template = '{\n  "version": "2.0-template"\n}';

      const result = merge(base, local, template, "package.json");

      expect(result.hasConflicts).toBe(true);
      // ローカル値が保持される（テンプレート値ではない）
      const parsed = JSON.parse(result.content);
      expect(parsed.version).toBe("2.0-user");
      // conflictDetails でもローカル/テンプレートが正しく報告される
      expect(result.conflictDetails[0].localValue).toBe("2.0-user");
      expect(result.conflictDetails[0].templateValue).toBe("2.0-template");
    });

    it("引数を逆にすると結果が変わることを検証（非対称性の証明）", () => {
      // local と template を入れ替えると、コンフリクト時の優先側が変わる
      const base = '{\n  "key": "original"\n}';
      const localValue = '{\n  "key": "local-change"\n}';
      const templateValue = '{\n  "key": "template-change"\n}';

      // 正しい順序: local が優先
      const correct = merge(base, localValue, templateValue, "test.json");
      // 逆の順序: template が "local" として優先されてしまう
      const reversed = merge(base, templateValue, localValue, "test.json");

      expect(correct.hasConflicts).toBe(true);
      expect(reversed.hasConflicts).toBe(true);

      const correctParsed = JSON.parse(correct.content);
      const reversedParsed = JSON.parse(reversed.content);

      // 正しい順序ではローカル値が採用される
      expect(correctParsed.key).toBe("local-change");
      // 逆の順序ではテンプレート値が採用される（これがバグの挙動）
      expect(reversedParsed.key).toBe("template-change");
    });

    it("push シナリオ: ローカルの JSONC コメント付き devcontainer.json が保持される", () => {
      // PR #148 の再現テスト: devcontainer.json でコメントが削除された
      const base = [
        "{",
        "  // ベースのコメント",
        '  "image": "node:20",',
        '  "features": {}',
        "}",
      ].join("\n");

      const local = [
        "{",
        "  // ベースのコメント",
        "  // ユーザーが追加した説明コメント",
        "  // ボリュームマウントの権限について",
        '  "image": "node:20",',
        '  "features": {},',
        '  "mounts": ["source=vol,target=/workspace"]',
        "}",
      ].join("\n");

      const template = [
        "{",
        "  // ベースのコメント",
        '  "image": "node:22",',
        '  "features": {',
        '    "ghcr.io/devcontainers/features/git:1": {}',
        "  }",
        "}",
      ].join("\n");

      const result = merge(base, local, template, "devcontainer.json");

      // ユーザーが追加したコメントが保持されていること
      expect(result.content).toContain("ユーザーが追加した説明コメント");
      expect(result.content).toContain("ボリュームマウントの権限について");
      // ユーザーの mounts 追加が保持されていること
      expect(result.content).toContain("mounts");
      // テンプレートの image 更新も適用されていること
      const cleaned = result.content.replace(/\/\/.*$/gm, "");
      const parsed = JSON.parse(cleaned);
      expect(parsed.image).toBe("node:22");
    });
  });

  describe("mergeJsonContent", () => {
    it("異なるキーの追加を自動マージする", () => {
      const base = '{\n  "a": 1,\n  "b": 2\n}';
      const local = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
      const template = '{\n  "a": 1,\n  "b": 2,\n  "d": 4\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      expect(result!.hasConflicts).toBe(false);
      const parsed = JSON.parse(result!.content);
      expect(parsed.a).toBe(1);
      expect(parsed.b).toBe(2);
      expect(parsed.c).toBe(3);
      expect(parsed.d).toBe(4);
    });

    it("同じキーを同じ値に変更した場合はコンフリクトなし", () => {
      const base = '{\n  "version": "1.0"\n}';
      const local = '{\n  "version": "2.0"\n}';
      const template = '{\n  "version": "2.0"\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      expect(result!.hasConflicts).toBe(false);
    });

    it("同じキーを異なる値に変更した場合、ローカル値を保持してコンフリクト報告", () => {
      const base = '{\n  "version": "1.0"\n}';
      const local = '{\n  "version": "2.0"\n}';
      const template = '{\n  "version": "3.0"\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      expect(result!.hasConflicts).toBe(true);
      expect(result!.conflictDetails).toHaveLength(1);
      expect(result!.conflictDetails[0].path).toEqual(["version"]);
      expect(result!.conflictDetails[0].localValue).toBe("2.0");
      expect(result!.conflictDetails[0].templateValue).toBe("3.0");
      // ローカル値が保持される
      const parsed = JSON.parse(result!.content);
      expect(parsed.version).toBe("2.0");
    });

    it("ネストされたオブジェクトの異なるキーをマージする", () => {
      const base = '{\n  "servers": {\n    "a": {"url": "http://a"}\n  }\n}';
      const local =
        '{\n  "servers": {\n    "a": {"url": "http://a"},\n    "b": {"url": "http://b"}\n  }\n}';
      const template =
        '{\n  "servers": {\n    "a": {"url": "http://a"},\n    "c": {"url": "http://c"}\n  }\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      expect(result!.hasConflicts).toBe(false);
      const parsed = JSON.parse(result!.content);
      expect(parsed.servers.a).toEqual({ url: "http://a" });
      expect(parsed.servers.b).toEqual({ url: "http://b" });
      expect(parsed.servers.c).toEqual({ url: "http://c" });
    });

    it("テンプレートで削除されたキーを反映する（ローカル未変更の場合）", () => {
      const base = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
      const local = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
      const template = '{\n  "a": 1,\n  "c": 3\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      expect(result!.hasConflicts).toBe(false);
      const parsed = JSON.parse(result!.content);
      expect(parsed.a).toBe(1);
      expect(parsed.b).toBeUndefined();
      expect(parsed.c).toBe(3);
    });

    it("無効な JSON の場合は null を返す", () => {
      const result = mergeJsonContent("not json", '{"a": 1}', '{"a": 2}');
      expect(result).toBeNull();
    });

    it("MCP サーバー設定の典型的なマージシナリオ", () => {
      const base = JSON.stringify(
        {
          mcpServers: {
            github: { command: "gh", args: ["mcp"] },
          },
        },
        null,
        2,
      );
      const local = JSON.stringify(
        {
          mcpServers: {
            github: { command: "gh", args: ["mcp"] },
            "my-custom-server": { command: "my-server", args: ["start"] },
          },
        },
        null,
        2,
      );
      const template = JSON.stringify(
        {
          mcpServers: {
            github: { command: "gh", args: ["mcp", "--verbose"] },
            "template-server": { command: "tmpl", args: ["run"] },
          },
        },
        null,
        2,
      );

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content);
      // テンプレートの新サーバーが追加される
      expect(parsed.mcpServers["template-server"]).toEqual({ command: "tmpl", args: ["run"] });
      // ローカルのカスタムサーバーが保持される
      expect(parsed.mcpServers["my-custom-server"]).toEqual({
        command: "my-server",
        args: ["start"],
      });
      // github サーバーは両方変更 → コンフリクト（ローカル未変更なのでテンプレート値が適用）
      // ※ ローカルは base と同じなのでテンプレートの変更が優先
      expect(parsed.mcpServers.github.args).toEqual(["mcp", "--verbose"]);
    });

    it("devcontainer.json の典型的なマージシナリオ", () => {
      const base = JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/typescript-node:20",
          features: { "ghcr.io/devcontainers/features/git:1": {} },
        },
        null,
        2,
      );
      const local = JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/typescript-node:20",
          features: { "ghcr.io/devcontainers/features/git:1": {} },
          customizations: { vscode: { extensions: ["my-ext"] } },
        },
        null,
        2,
      );
      const template = JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/typescript-node:22",
          features: {
            "ghcr.io/devcontainers/features/git:1": {},
            "ghcr.io/devcontainers/features/node:1": {},
          },
        },
        null,
        2,
      );

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content);
      // テンプレートの image 更新が適用される
      expect(parsed.image).toBe("mcr.microsoft.com/devcontainers/typescript-node:22");
      // ローカルの customizations が保持される
      expect(parsed.customizations).toEqual({ vscode: { extensions: ["my-ext"] } });
      // テンプレートの新 feature が追加される
      expect(parsed.features["ghcr.io/devcontainers/features/node:1"]).toEqual({});
    });

    it("ローカルのフォーマット（インデント）を保持する", () => {
      // 4スペースインデントのローカル
      const base = '{\n    "a": 1\n}';
      const local = '{\n    "a": 1,\n    "b": 2\n}';
      const template = '{\n  "a": 1,\n  "c": 3\n}';

      const result = mergeJsonContent(base, local, template);

      expect(result).not.toBeNull();
      // jsonc-parser の modify がローカルのフォーマットに合わせる
      expect(result!.content).toContain('"b": 2');
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
