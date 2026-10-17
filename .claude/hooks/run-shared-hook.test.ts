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

describe('Codex アダプターで pre-bash-guard.ts 自体が落ちたとき', () => {
  test('シェル記法を含まない読み取り専用のコマンドは警告を出して続行する', async () => {
    for (const command of ['ls -la', 'git status', 'cat .claude/hooks/package.json']) {
      const result = await runCrashingGuard(command);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('shared hook failed');
    }
  });

  test('それ以外のコマンドは、引用符や展開で書き換えても拒否する', async () => {
    for (const command of [
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
      '   ',
    ]) {
      expect((await runCrashingGuard(command)).code).toBe(2);
    }
  });
});
