#!/usr/bin/env npx tsx
/**
 * README.md のセクションを自動生成するスクリプト
 *
 * 使い方:
 *   pnpm run docs
 *   pnpm run docs:check  # 差分チェックのみ（CI用）
 *
 * 自動生成されるセクション:
 *   - 機能 (modules.jsonc から)
 *   - コマンド (citty の renderUsage から)
 *   - 生成されるファイル (modules.jsonc から)
 */

// 環境によるrenderUsage出力の差異を防ぐ
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";
process.env.COLUMNS = "80";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderUsage } from "citty";
import { parse } from "jsonc-parser";
import { stripVTControlCharacters } from "node:util";
import { diffCommand } from "../src/commands/diff";
import { initCommand } from "../src/commands/init";
import { pushCommand } from "../src/commands/push";

const README_PATH = resolve(import.meta.dirname, "../README.md");
const MODULES_PATH = resolve(
  import.meta.dirname,
  "../../../.devenv/modules.jsonc",
);

// マーカー定義
const MARKERS = {
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

interface CommandInfo {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command: any;
  description: string;
}

const commands: CommandInfo[] = [
  {
    name: "init",
    command: initCommand,
    description: "開発環境テンプレートを適用",
  },
  {
    name: "push",
    command: pushCommand,
    description: "ローカル変更をテンプレートリポジトリに PR として送信",
  },
  {
    name: "diff",
    command: diffCommand,
    description: "ローカルとテンプレートの差分を表示",
  },
];

/**
 * modules.jsonc を読み込み
 */
async function loadModules(): Promise<TemplateModule[]> {
  const content = await readFile(MODULES_PATH, "utf-8");
  const parsed = parse(content) as ModulesFile;
  return parsed.modules;
}

/**
 * 機能セクションを生成
 */
function generateFeaturesSection(modules: TemplateModule[]): string {
  const lines: string[] = [];
  lines.push("## 機能\n");

  for (const mod of modules) {
    lines.push(`- **${mod.name}** - ${mod.description}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * コマンドセクションを生成
 */
async function generateCommandsSection(): Promise<string> {
  const sections: string[] = [];

  sections.push("## コマンド\n");

  for (const { name, command, description } of commands) {
    sections.push(`### \`${name}\`\n`);
    sections.push(`${description}\n`);
    sections.push("```");

    const usage = await renderUsage(command);
    // ANSIエスケープコードを除去（CI環境との一貫性を保つ）
    sections.push(stripVTControlCharacters(usage.trim()));

    sections.push("```\n");
  }

  return sections.join("\n");
}

/**
 * 生成されるファイルセクションを生成
 */
function generateFilesSection(modules: TemplateModule[]): string {
  const lines: string[] = [];
  lines.push("## 生成されるファイル\n");
  lines.push("選択したモジュールに応じて以下のファイルが生成されます：\n");

  for (const mod of modules) {
    // モジュールIDからディレクトリ名を取得
    const dirName = mod.id === "." ? "ルート" : `\`${mod.id}/\``;
    lines.push(`### ${dirName}\n`);
    lines.push(`${mod.description}\n`);

    for (const pattern of mod.patterns) {
      // glob パターンを説明的に表示
      const displayPattern = pattern.includes("*")
        ? `\`${pattern}\` (パターン)`
        : `\`${pattern}\``;
      lines.push(`- ${displayPattern}`);
    }
    lines.push("");
  }

  // 設定ファイルの説明を追加
  lines.push("### 設定ファイル\n");
  lines.push("- `.devenv.json` - このツールの設定（適用したモジュール情報）\n");

  return lines.join("\n");
}

/**
 * README のマーカー間を更新
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
    throw new Error(
      `README.md にマーカーが見つかりません。\n` +
        `以下のマーカーを追加してください:\n` +
        `${startMarker}\n${endMarker}`,
    );
  }

  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);

  return `${before}\n\n${newSection}\n${after}`;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const isCheck = process.argv.includes("--check");

  console.log("📝 README ドキュメントを生成中...\n");

  // modules.jsonc を読み込み
  const modules = await loadModules();
  console.log(`  📦 ${modules.length} 個のモジュールを読み込みました`);

  // 各セクションを生成
  const featuresSection = generateFeaturesSection(modules);
  const commandsSection = await generateCommandsSection();
  const filesSection = generateFilesSection(modules);

  // README を更新
  let readme = await readFile(README_PATH, "utf-8");
  const originalReadme = readme;

  readme = updateSection(
    readme,
    MARKERS.features.start,
    MARKERS.features.end,
    featuresSection,
  );
  readme = updateSection(
    readme,
    MARKERS.commands.start,
    MARKERS.commands.end,
    commandsSection,
  );
  readme = updateSection(
    readme,
    MARKERS.files.start,
    MARKERS.files.end,
    filesSection,
  );

  const updated = readme !== originalReadme;

  if (isCheck) {
    if (updated) {
      console.error("\n❌ README.md が最新ではありません。");
      console.error("   `pnpm run docs` を実行して更新してください。\n");
      process.exit(1);
    }
    console.log("\n✅ README.md は最新です。\n");
    return;
  }

  if (updated) {
    await writeFile(README_PATH, readme);
    console.log("\n✅ README.md を更新しました。\n");
  } else {
    console.log("\n✅ README.md は既に最新です。\n");
  }
}

main().catch((error) => {
  console.error("エラー:", error.message);
  process.exit(1);
});
