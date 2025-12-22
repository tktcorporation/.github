#!/usr/bin/env node
import { select } from "@inquirer/prompts";
import { defineCommand, runMain } from "citty";
import { version } from "../package.json";
import { diffCommand } from "./commands/diff";
import { initCommand } from "./commands/init";
import { pushCommand } from "./commands/push";

const main = defineCommand({
  meta: {
    name: "create-devenv",
    version,
    description: "開発環境テンプレート管理ツール",
  },
  subCommands: {
    init: initCommand,
    push: pushCommand,
    diff: diffCommand,
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
  const command = await select({
    message: "実行するコマンドを選択してください",
    choices: [
      {
        name: "init - 開発環境テンプレートを適用",
        value: "init" as const,
        description: "テンプレートをダウンロードしてプロジェクトに適用",
      },
      {
        name: "push - ローカル変更を PR として送信",
        value: "push" as const,
        description: "ローカルの変更をテンプレートリポジトリに PR として送信",
      },
      {
        name: "diff - ローカルとテンプレートの差分を表示",
        value: "diff" as const,
        description: "現在のファイルとテンプレートの差分を確認",
      },
    ],
  });

  const selectedCommand = commandMap[command];
  void runMain(selectedCommand as typeof diffCommand);
}

// サブコマンドなしで実行された場合の処理
const args = process.argv.slice(2);
const hasSubCommand =
  args.length > 0 && ["init", "push", "diff", "--help", "-h", "--version", "-v"].includes(args[0]);

if (!hasSubCommand && args.length > 0 && !args[0].startsWith("-")) {
  // npx @tktco/create-devenv . のような形式は init コマンドとして実行
  void runMain(initCommand);
} else if (!hasSubCommand && args.length === 0) {
  // 引数なしの場合はコマンド選択プロンプトを表示
  void promptCommand();
} else {
  void runMain(main);
}
