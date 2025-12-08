#!/usr/bin/env node
import { runMain } from "citty";
import { initCommand } from "./commands/init";

// init コマンドをデフォルトとして直接実行
// npx @tkt/create-devenv [dir] --yes などで使用可能
runMain(initCommand);
