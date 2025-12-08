import type { TemplateModule } from "./schemas";

export const modules: TemplateModule[] = [
  {
    id: "devcontainer",
    name: "DevContainer 設定",
    description: "VS Code DevContainer、mise、Docker-in-Docker",
    files: [".devcontainer"],
    excludeFiles: [".devcontainer/devcontainer.env"],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    description: "issue-link、labeler ワークフロー",
    files: [".github"],
  },
  {
    id: "mcp",
    name: "MCP サーバー設定",
    description: "Context7、Playwright、Chrome DevTools",
    files: [".mcp.json"],
  },
  {
    id: "mise",
    name: "mise 設定",
    description: "Node.js、uv、Claude Code などのツール管理",
    files: [".mise.toml"],
  },
  {
    id: "claude",
    name: "Claude IDE 設定",
    description: "Claude Code のローカル設定",
    files: [".claude"],
  },
];

export function getModuleById(id: string): TemplateModule | undefined {
  return modules.find((m) => m.id === id);
}
