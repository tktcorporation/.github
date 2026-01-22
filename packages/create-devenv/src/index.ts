#!/usr/bin/env node
import { select } from "@inquirer/prompts";
import { defineCommand, runMain } from "citty";
import { version } from "../package.json";
import { aiDocsCommand } from "./commands/ai-docs";
import { diffCommand } from "./commands/diff";
import { initCommand } from "./commands/init";
import { pushCommand } from "./commands/push";
import { log, pc, showHeader } from "./utils/ui";

const main = defineCommand({
  meta: {
    name: "create-devenv",
    version,
    description: "Dev environment template manager",
  },
  subCommands: {
    init: initCommand,
    push: pushCommand,
    diff: diffCommand,
    "ai-docs": aiDocsCommand,
  },
});

type CommandType = typeof initCommand | typeof pushCommand | typeof diffCommand;

const commandMap: Record<"init" | "push" | "diff", CommandType> = {
  init: initCommand,
  push: pushCommand,
  diff: diffCommand,
};

/**
 * コマンド選択プロンプト
 */
async function promptCommand(): Promise<void> {
  showHeader("create-devenv", version);

  log.info("Select a command to run:");
  log.newline();

  const command = await select({
    message: "Command",
    choices: [
      {
        name: `${pc.cyan("init")}   ${pc.dim("→")} Apply template to your project`,
        value: "init" as const,
      },
      {
        name: `${pc.cyan("push")}   ${pc.dim("→")} Push local changes as a PR`,
        value: "push" as const,
      },
      {
        name: `${pc.cyan("diff")}   ${pc.dim("→")} Show differences from template`,
        value: "diff" as const,
      },
    ],
  });

  const selectedCommand = commandMap[command];
  void runMain(selectedCommand as typeof diffCommand);
}

// サブコマンドなしで実行された場合の処理
const args = process.argv.slice(2);
const hasSubCommand =
  args.length > 0 &&
  ["init", "push", "diff", "ai-docs", "--help", "-h", "--version", "-v"].includes(args[0]);

if (!hasSubCommand && args.length > 0 && !args[0].startsWith("-")) {
  // npx @tktco/create-devenv . のような形式は init コマンドとして実行
  void runMain(initCommand);
} else if (!hasSubCommand && args.length === 0) {
  // 引数なしの場合はコマンド選択プロンプトを表示
  void promptCommand();
} else {
  void runMain(main);
}
