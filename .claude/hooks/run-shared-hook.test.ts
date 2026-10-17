/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const adapter = join(import.meta.dir, '../../.codex/run-shared-hook.ts');

/** 常に exit 1 で落ちる pre-bash-guard.ts を Codex アダプター経由で動かす。 */
async function runCrashingGuard(command: string): Promise<{ code: number; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'run-shared-hook-'));
  try {
    const guard = join(dir, 'pre-bash-guard.ts');
    await writeFile(guard, 'process.exit(1);\n');
    const child = Bun.spawn(['bun', adapter, guard], {
      cwd: dir,
      stdin: new Blob([
        JSON.stringify({
          cwd: dir,
          hook_event_name: 'PreToolUse',
          tool_name: 'exec_command',
          tool_input: { cmd: command },
        }),
      ]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 1 件ごとにアダプターと hook の 2 プロセスを起動する。Bun の版や実行環境によっては
// 起動が遅く、既定の 5 秒に収まらないため、起動は並列にし、上限も明示する。
const SPAWN_TEST_TIMEOUT_MS = 30_000;

describe('Codex アダプターで pre-bash-guard.ts 自体が落ちたとき', () => {
  test(
    'シェル記法を含まない読み取り専用のコマンドは警告を出して続行する',
    async () => {
      const commands = ['ls -la', 'cat .claude/hooks/package.json', 'grep -rn TODO .claude'];
      for (const result of await Promise.all(commands.map(runCrashingGuard))) {
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('shared hook failed');
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    'それ以外のコマンドは、引用符や展開で書き換えても拒否する',
    async () => {
      const commands = [
        'git push origin HEAD',
        'git -C repo push',
        'gh pr create --fill',
        'g""it push',
        'sh -c "git push"',
        'ls; git push',
        'ls\ngit push',
        'git branch -D main',
        'pnpm test',
        'rg --pre ./x.sh pattern file',
        'git diff --output=README.md HEAD~1 HEAD',
        'git log --ext-diff',
        'git status',
        'GIT_EXTERNAL_DIFF=./x git diff',
        '   ',
      ];
      const results = await Promise.all(commands.map(runCrashingGuard));
      expect(results.map((result) => result.code)).toEqual(commands.map(() => 2));
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
