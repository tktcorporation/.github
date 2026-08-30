#!/usr/bin/env bun
import { hasMiseTask, runMiseTask } from './hook-utils.ts';
process.chdir(process.env.CLAUDE_PROJECT_DIR ?? '.');
if (!(await hasMiseTask('claude-verify'))) process.exit(0);
const result = await runMiseTask('claude-verify', [], 300_000);
if (result.exitCode === 0) process.exit(0);
const message = result.timedOut
  ? 'claude-verify がタイムアウトしました（300秒超過）。'
  : result.output;
if (message)
  console.log(
    JSON.stringify({
      decision: 'block',
      reason: `🛑 Stop hook: 以下の問題が未解決です。修正してから完了してください:\n\n${message}`,
    }),
  );
