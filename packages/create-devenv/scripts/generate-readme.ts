#!/usr/bin/env npx tsx
/**
 * Auto-generate README.md sections from source code
 *
 * Usage:
 *   pnpm run docs
 *   pnpm run docs:check  # Check only (for CI)
 *
 * Generated sections:
 *   - Usage (from command definitions)
 *   - Modules (from modules.jsonc)
 *   - Commands (from citty renderUsage)
 *   - What You Get (from modules.jsonc)
 */

// Prevent environment-dependent renderUsage output differences
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";
process.env.COLUMNS = "80";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { renderUsage } from "citty";
import { parse } from "jsonc-parser";
import { diffCommand } from "../src/commands/diff";
import { initCommand } from "../src/commands/init";
import { pushCommand } from "../src/commands/push";

const README_PATH = resolve(import.meta.dirname, "../README.md");
const MODULES_PATH = resolve(import.meta.dirname, "../../../.devenv/modules.jsonc");

// Marker definitions
const MARKERS = {
  usage: {
    start: "<!-- USAGE:START -->",
    end: "<!-- USAGE:END -->",
  },
  features: {
    start: "<!-- FEATURES:START -->",
    end: "<!-- FEATURES:END -->",
  },
  commands: {
    start: "<!-- COMMANDS:START -->",
    end: "<!-- COMMANDS:END -->",
  },
  files: {
    start: "<!-- FILES:START -->",
    end: "<!-- FILES:END -->",
  },
} as const;

interface TemplateModule {
  id: string;
  name: string;
  description: string;
  setupDescription?: string;
  patterns: string[];
}

interface ModulesFile {
  modules: TemplateModule[];
}

// Command definitions with their metadata extracted from source
const commands = [
  { name: "init", command: initCommand },
  { name: "push", command: pushCommand },
  { name: "diff", command: diffCommand },
] as const;

/**
 * Load modules.jsonc
 */
async function loadModules(): Promise<TemplateModule[]> {
  const content = await readFile(MODULES_PATH, "utf-8");
  const parsed = parse(content) as ModulesFile;
  return parsed.modules;
}

/**
 * Generate Usage section
 */
function generateUsageSection(): string {
  const lines: string[] = [];
  lines.push("## Usage\n");
  lines.push("```bash");
  lines.push("# Apply template to current directory");
  lines.push("npx @tktco/create-devenv");
  lines.push("");
  lines.push("# Apply to a specific directory");
  lines.push("npx @tktco/create-devenv ./my-project");
  lines.push("");
  lines.push("# Push your improvements back");
  lines.push('npx @tktco/create-devenv push -m "Add new workflow"');
  lines.push("");
  lines.push("# Check what's different");
  lines.push("npx @tktco/create-devenv diff");
  lines.push("```\n");
  return lines.join("\n");
}

/**
 * Generate Modules section
 */
function generateFeaturesSection(modules: TemplateModule[]): string {
  const lines: string[] = [];
  lines.push("## Modules\n");
  lines.push("Pick what you need:\n");

  for (const mod of modules) {
    lines.push(`- **${mod.name}** - ${mod.description}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate Commands section
 */
async function generateCommandsSection(): Promise<string> {
  const sections: string[] = [];

  sections.push("## Commands\n");

  for (const { name, command } of commands) {
    // Extract description from command meta (single source of truth)
    const description =
      (command as { meta?: { description?: string } }).meta?.description || "";

    sections.push(`### \`${name}\`\n`);
    sections.push(`${description}\n`);
    sections.push("```");

    const usage = await renderUsage(command);
    // Remove ANSI escape codes and trailing whitespace (for CI consistency)
    const cleanedUsage = stripVTControlCharacters(usage)
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    sections.push(cleanedUsage);

    sections.push("```\n");
  }

  return sections.join("\n");
}

/**
 * Generate What You Get section
 */
function generateFilesSection(modules: TemplateModule[]): string {
  const lines: string[] = [];
  lines.push("## What You Get\n");
  lines.push("Files generated based on selected modules:\n");

  for (const mod of modules) {
    // Get directory name from module ID
    const dirName = mod.id === "." ? "Root" : `\`${mod.id}/\``;
    lines.push(`### ${dirName}\n`);
    lines.push(`${mod.description}\n`);

    for (const pattern of mod.patterns) {
      // Display glob patterns descriptively
      const displayPattern = pattern.includes("*") ? `\`${pattern}\`` : `\`${pattern}\``;
      lines.push(`- ${displayPattern}`);
    }
    lines.push("");
  }

  // Add config file description
  lines.push("### Config\n");
  lines.push("- `.devenv.json` - Tracks which modules are applied\n");

  return lines.join("\n");
}

/**
 * Update README section between markers
 */
function updateSection(
  content: string,
  startMarker: string,
  endMarker: string,
  newSection: string,
): string {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    // Marker not found - skip this section
    return content;
  }

  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);

  return `${before}\n\n${newSection}\n${after}`;
}

/**
 * Main
 */
async function main(): Promise<void> {
  const isCheck = process.argv.includes("--check");

  console.log("📝 Generating README documentation...\n");

  // Load modules.jsonc
  const modules = await loadModules();
  console.log(`  📦 Loaded ${modules.length} modules`);

  // Generate sections
  const usageSection = generateUsageSection();
  const featuresSection = generateFeaturesSection(modules);
  const commandsSection = await generateCommandsSection();
  const filesSection = generateFilesSection(modules);

  // Update README
  let readme = await readFile(README_PATH, "utf-8");
  const originalReadme = readme;

  readme = updateSection(readme, MARKERS.usage.start, MARKERS.usage.end, usageSection);
  readme = updateSection(readme, MARKERS.features.start, MARKERS.features.end, featuresSection);
  readme = updateSection(readme, MARKERS.commands.start, MARKERS.commands.end, commandsSection);
  readme = updateSection(readme, MARKERS.files.start, MARKERS.files.end, filesSection);

  const updated = readme !== originalReadme;

  if (isCheck) {
    if (updated) {
      console.error("\n❌ README.md is out of date.");
      console.error("   Run `pnpm run docs` to update.\n");
      process.exit(1);
    }
    console.log("\n✅ README.md is up to date.\n");
    return;
  }

  if (updated) {
    await writeFile(README_PATH, readme);
    console.log("\n✅ README.md updated.\n");
  } else {
    console.log("\n✅ README.md is already up to date.\n");
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
