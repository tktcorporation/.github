#!/usr/bin/env bun
import { join } from 'node:path';
const text = await Bun.stdin.text();
let input: {
  tool_input?: { command?: string };
  tool_response?: { exit_code?: number; exitCode?: number };
};
try {
  input = JSON.parse(text);
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
const status = input?.tool_response?.exit_code ?? input?.tool_response?.exitCode;
if (!/gh\s+pr\s+create/.test(command) || (status !== undefined && Number(status) !== 0))
  process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const child = Bun.spawn(['bun', join(root, '.claude/hooks/reset-pr-review-count.ts')], {
  cwd: root,
  env: process.env,
  stdout: 'inherit',
  stderr: 'inherit',
});
if ((await child.exited) !== 0) process.exit(1);
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'PR作成後レビューを実施すること: 初見読者向けの語彙、evergreen comment、technical-writing-styleを確認し、指摘があれば修正する。',
    },
  }),
);
