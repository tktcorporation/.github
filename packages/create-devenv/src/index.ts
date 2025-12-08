#!/usr/bin/env node
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

// サブコマンドなしで実行された場合は init を実行（後方互換性）
const args = process.argv.slice(2);
const hasSubCommand =
  args.length > 0 &&
  ["init", "push", "diff", "--help", "-h", "--version", "-v"].includes(args[0]);

if (!hasSubCommand && args.length > 0 && !args[0].startsWith("-")) {
  // npx @tktco/create-devenv . のような形式は init コマンドとして実行
  runMain(initCommand);
} else if (!hasSubCommand && args.length === 0) {
  // 引数なしの場合はヘルプを表示
  runMain(main);
} else {
  runMain(main);
}
