#!/usr/bin/env bun
import { $ } from 'bun';
import { join, resolve } from 'node:path';
export async function projectDirectory(): Promise<string> {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  // --show-toplevel resolves to the active worktree. --git-common-dir instead
  // points every linked worktree at the primary checkout's shared .git directory.
  const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  return result.exitCode === 0 ? resolve(result.text().trim()) : process.cwd();
}
export async function reviewCountFile(): Promise<string> {
  return join(await projectDirectory(), '.claude/.pr-review-count');
}
export async function readReviewCount(): Promise<number> {
  const file = Bun.file(await reviewCountFile());
  if (!(await file.exists())) return 0;
  const value = (await file.text()).trim();
  return /^\d+$/.test(value) ? Number(value) : 0;
}
