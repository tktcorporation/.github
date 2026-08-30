#!/usr/bin/env bun
import { Glob } from 'bun';
import { join } from 'node:path';

const text = await Bun.stdin.text();
let input: { tool_input?: { command?: string } };
try {
  input = JSON.parse(text);
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
const block = (message: string): never => {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
};

if (/lsof.*-ti.*\|.*(?:xargs.*kill|kill)|kill.*(?:\$\(lsof|lsof)|fuser.*-k/.test(command))
  block(
    'lsof+kill / fuser+kill はdevcontainerを巻き込むため、pkill -fで対象名を指定してください。',
  );
if (
  /git\s+(?:checkout\s+--\s+\.|restore\s+\.|reset\s+--hard|clean\s+-[a-z]*f)|jj\s+restore\s+--(?:from|to|changes-in)/.test(
    command,
  )
)
  block('全ファイル対象のrevert/resetは禁止です。特定ファイルか専用worktreeを指定してください。');
if (
  /git\s+worktree\s+add/.test(command) &&
  !/git\s+worktree\s+add\s+\.claude\/worktrees\//.test(command)
)
  block('worktreeは.claude/worktrees/配下に作成してください。');

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
async function run(path: string): Promise<void> {
  const child = Bun.spawn(['bun', join(root, path)], {
    cwd: root,
    env: process.env,
    stdin: new Blob([text]),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const status = await child.exited;
  if (status !== 0) process.exit(status);
}
if (/gh\s+pr\s+create/.test(command)) await run('.claude/hooks/require-pr-self-review.ts');
for await (const path of new Glob('.claude/hooks/project/*.ts').scan({ cwd: root }))
  await run(path);
