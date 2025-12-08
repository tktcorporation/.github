import type { TemplateModule } from "./schemas";

export const modules: TemplateModule[] = [
  {
    id: "devcontainer",
    name: "DevContainer 設定",
    description: "VS Code DevContainer、mise、Docker-in-Docker",
    setupDescription:
      "VS Code で DevContainer を開くと自動でセットアップされます",
    files: [".devcontainer"],
    excludeFiles: [".devcontainer/devcontainer.env"],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    description: "issue-link、labeler ワークフロー",
    setupDescription: "PR 作成時に自動でラベル付け、Issue リンクが行われます",
    files: [".github"],
  },
  {
    id: "mcp",
    name: "MCP サーバー設定",
    description: "Context7、Playwright、Chrome DevTools",
    setupDescription: "Claude Code で MCP サーバーが自動的に利用可能になります",
    files: [".mcp.json"],
  },
  {
    id: "mise",
    name: "mise 設定",
    description: "Node.js、uv、Claude Code などのツール管理",
    setupDescription:
      "mise trust && mise install でツールがインストールされます",
    files: [".mise.toml"],
  },
  {
    id: "claude",
    name: "Claude IDE 設定",
    description: "Claude Code のローカル設定",
    setupDescription: "Claude Code のプロジェクト設定が適用されます",
    files: [".claude"],
  },
];

export function getModuleById(id: string): TemplateModule | undefined {
  return modules.find((m) => m.id === id);
}
