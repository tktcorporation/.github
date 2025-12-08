import type { TemplateModule } from "./schemas";

export const modules: TemplateModule[] = [
  {
    id: "devcontainer",
    name: "DevContainer 設定",
    description: "VS Code DevContainer、mise、Docker-in-Docker",
    setupDescription:
      "VS Code で DevContainer を開くと自動でセットアップされます",
    // ホワイトリスト形式: テンプレートとして配布するファイルのみを明示
    patterns: [
      ".devcontainer/devcontainer.json",
      ".devcontainer/.gitignore",
      ".devcontainer/setup-*.sh",
      ".devcontainer/test-*.sh",
      // 除外: devcontainer.env（秘密情報）
    ],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    description: "issue-link、labeler ワークフロー",
    setupDescription: "PR 作成時に自動でラベル付け、Issue リンクが行われます",
    patterns: [
      ".github/workflows/issue-link.yml",
      ".github/workflows/label.yml",
      ".github/labeler.yml",
      // 除外: ci.yml, release.yml（リポジトリ固有のCI/CD設定）
    ],
  },
  {
    id: "mcp",
    name: "MCP サーバー設定",
    description: "Context7、Playwright、Chrome DevTools",
    setupDescription: "Claude Code で MCP サーバーが自動的に利用可能になります",
    patterns: [".mcp.json"],
  },
  {
    id: "mise",
    name: "mise 設定",
    description: "Node.js、uv、Claude Code などのツール管理",
    setupDescription:
      "mise trust && mise install でツールがインストールされます",
    patterns: [".mise.toml"],
  },
  {
    id: "claude",
    name: "Claude IDE 設定",
    description: "Claude Code のプロジェクト共通設定",
    setupDescription: "Claude Code のプロジェクト設定が適用されます",
    patterns: [
      ".claude/settings.json",
      // 除外: settings.local.json（個人設定）
    ],
  },
];

export function getModuleById(id: string): TemplateModule | undefined {
  return modules.find((m) => m.id === id);
}

/**
 * 全モジュールのパターンを取得
 */
export function getAllPatterns(): string[] {
  return modules.flatMap((m) => m.patterns);
}

/**
 * 指定モジュールIDのパターンを取得
 */
export function getPatternsByModuleIds(moduleIds: string[]): string[] {
  return modules
    .filter((m) => moduleIds.includes(m.id))
    .flatMap((m) => m.patterns);
}
