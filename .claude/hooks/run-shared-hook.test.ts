/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const adapter = join(import.meta.dir, '../../.codex/run-shared-hook.ts');

/** 常に exit 1 で落ちる hook（ファイル名だけ本物と同じ）を Codex アダプター経由で動かす。 */
async function runCrashingHook(
  hookName: string,
  payload: Record<string, unknown>,
): Promise<{ code: number; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'run-shared-hook-'));
  try {
    const hook = join(dir, hookName);
    await writeFile(hook, 'process.exit(1);\n');
    const child = Bun.spawn(['bun', adapter, hook], {
      cwd: dir,
      stdin: new Blob([JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', ...payload })]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 1 件ごとにアダプターと hook の 2 プロセスを起動する。Bun の版や実行環境によっては起動が遅く、
// 既定の 5 秒に収まらないため、起動は並列にし、上限も明示する。
const SPAWN_TEST_TIMEOUT_MS = 30_000;

describe('Codex アダプターで hook 自体が落ちたとき', () => {
  test(
    '全コマンドで動く pre-bash-guard.ts は、警告を出して元の実行を続ける',
    async () => {
      // 解析用の依存を入れられない環境では毎回落ちるため、拒否に倒すと全コマンドが止まり続ける。
      const commands = ['ls -la', 'git status', 'pnpm install'];
      const results = await Promise.all(
        commands.map((cmd) =>
          runCrashingHook('pre-bash-guard.ts', {
            tool_name: 'exec_command',
            tool_input: { cmd },
          }),
        ),
      );
      for (const result of results) {
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('shared hook failed');
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'MCP 経由の PR 作成ゲートは、落ちたときも作成を通さない',
    async () => {
      const result = await runCrashingHook('require-pr-self-review-mcp.ts', {
        tool_name: 'mcp__github__create_pull_request',
        tool_input: { owner: 'owner', repo: 'repo', head: 'feature', base: 'main' },
      });
      expect(result.code).toBe(2);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
