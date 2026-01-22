/**
 * AI Agent Guide
 *
 * This file serves as the single source of truth for AI-facing documentation.
 * It is used both for:
 *   - `create-devenv ai-docs` command output
 *   - README.md "For AI Agents" section generation
 */

import { version } from "../../package.json";
import { MANIFEST_FILENAME } from "../utils/manifest";

export interface DocSection {
  title: string;
  content: string;
}

/**
 * Generate the complete AI agent guide as markdown
 */
export function generateAiGuide(): string {
  const sections = getDocSections();
  return sections.map((s) => `## ${s.title}\n\n${s.content}`).join("\n\n");
}

/**
 * Generate the AI agent guide with header for CLI output
 */
export function generateAiGuideWithHeader(): string {
  const header = `# create-devenv v${version} - AI Agent Guide

This guide explains how AI coding agents (Claude Code, Cursor, etc.) can use this tool effectively.
`;

  return header + "\n" + generateAiGuide();
}

/**
 * Get individual documentation sections
 * Used by both CLI output and README generation
 */
export function getDocSections(): DocSection[] {
  return [
    {
      title: "Quick Reference",
      content: `\`\`\`bash
# Non-interactive push workflow for AI agents
npx @tktco/create-devenv push --prepare    # Generate manifest
# Edit ${MANIFEST_FILENAME}              # Select files
npx @tktco/create-devenv push --execute    # Create PR

# Other commands
npx @tktco/create-devenv init [dir]        # Apply template (interactive)
npx @tktco/create-devenv diff              # Show differences
\`\`\``,
    },
    {
      title: "Push Workflow for AI Agents",
      content: `When contributing template improvements, use the two-phase workflow:

### Phase 1: Prepare

\`\`\`bash
npx @tktco/create-devenv push --prepare
\`\`\`

This generates \`${MANIFEST_FILENAME}\` containing:
- List of changed files with \`selected: true/false\`
- PR title and body fields
- Summary of changes

### Phase 2: Edit Manifest

Edit the generated \`${MANIFEST_FILENAME}\`:

\`\`\`yaml
pr:
  title: "feat: add new workflow for CI"
  body: |
    ## Summary
    Added new CI workflow for automated testing.

    ## Changes
    - Added .github/workflows/ci.yml

files:
  - path: .github/workflows/ci.yml
    type: added
    selected: true    # Include this file
  - path: .github/labeler.yml
    type: modified
    selected: false   # Exclude this file
\`\`\`

### Phase 3: Execute

\`\`\`bash
# Set GitHub token (required)
export GITHUB_TOKEN="your-token"

# Create the PR
npx @tktco/create-devenv push --execute
\`\`\``,
    },
    {
      title: "Manifest File Reference",
      content: `The manifest file (\`${MANIFEST_FILENAME}\`) structure:

| Field | Description |
|-------|-------------|
| \`version\` | Manifest format version (always \`1\`) |
| \`generated_at\` | ISO 8601 timestamp |
| \`github.token\` | GitHub token (prefer env var) |
| \`pr.title\` | PR title (editable) |
| \`pr.body\` | PR description (editable) |
| \`files[].path\` | File path |
| \`files[].type\` | \`added\` / \`modified\` / \`deleted\` |
| \`files[].selected\` | Include in PR (\`true\`/\`false\`) |
| \`untracked_files[]\` | Files outside whitelist (default: \`selected: false\`) |
| \`summary\` | Change statistics |`,
    },
    {
      title: "Environment Variables",
      content: `| Variable | Description |
|----------|-------------|
| \`GITHUB_TOKEN\` | GitHub personal access token (required for push) |
| \`GH_TOKEN\` | Alternative to GITHUB_TOKEN |

The token needs \`repo\` scope for creating PRs.`,
    },
    {
      title: "Best Practices for AI Agents",
      content: `1. **Always use \`--prepare\` then \`--execute\`** for non-interactive operation
2. **Review the diff first** with \`npx @tktco/create-devenv diff\`
3. **Set meaningful PR titles** that follow conventional commits (e.g., \`feat:\`, \`fix:\`, \`docs:\`)
4. **Deselect unrelated changes** by setting \`selected: false\`
5. **Use environment variables** for tokens instead of hardcoding in manifest`,
    },
  ];
}

/**
 * Generate README section for AI agents
 * Returns content suitable for embedding in README.md
 */
export function generateReadmeSection(): string {
  const lines: string[] = [];
  lines.push("## For AI Agents\n");
  lines.push("AI coding agents can use the non-interactive workflow:\n");
  lines.push("```bash");
  lines.push("# 1. Generate manifest file");
  lines.push("npx @tktco/create-devenv push --prepare");
  lines.push("");
  lines.push(`# 2. Edit ${MANIFEST_FILENAME} to select files and set PR details`);
  lines.push("");
  lines.push("# 3. Create PR from manifest");
  lines.push("npx @tktco/create-devenv push --execute");
  lines.push("```\n");
  lines.push("For detailed documentation, run:\n");
  lines.push("```bash");
  lines.push("npx @tktco/create-devenv ai-docs");
  lines.push("```\n");
  return lines.join("\n");
}
