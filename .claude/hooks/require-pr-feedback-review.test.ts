import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { externalReviewFile, reviewTargetSha, writeEntries } from './review-count.ts';
import type { Entry } from './review-policy.ts';

const script = join(import.meta.dir, 'require-pr-feedback-review.ts');

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

async function checkPush(
  cwd: string,
  bin: string,
  comments = '[[]]',
): Promise<{ code: number; error: string }> {
  const child = Bun.spawn(['bun', script], {
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_COMMENTS: comments },
    stdin: new Blob([JSON.stringify({ cwd })]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, error };
}

describe('外部指摘後の push ガード', () => {
  test('指摘後のレビュー収束と、3 回目のユーザー判断を要求する', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pr-feedback-'));
    try {
      git(cwd, 'init', '-q');
      git(cwd, 'config', 'user.name', 'Test');
      git(cwd, 'config', 'user.email', 'test@example.com');
      await writeFile(join(cwd, 'README'), 'test');
      git(cwd, 'add', 'README');
      git(cwd, 'commit', '-qm', 'test');
      const bin = join(cwd, 'bin');
      await mkdir(bin);
      const gh = join(bin, 'gh');
      await writeFile(
        gh,
        '#!/bin/sh\nif [ "$1" = "pr" ]; then printf "42\\n"; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "user" ]; then printf "testuser\\n"; exit 0; fi\nif [ "$1" = "api" ]; then printf "%s\\n" "$FAKE_COMMENTS"; exit 0; fi\nexit 1\n',
        { mode: 0o755 },
      );
      const sha = await reviewTargetSha({ cwd });
      const historyPath = await externalReviewFile({ cwd });
      const firstComment = JSON.stringify([[{
        id: 1,
        commit_id: sha,
        created_at: '2026-09-22T00:00:00Z',
        user: { login: 'reviewer' },
      }]]);
      expect((await checkPush(cwd, bin, firstComment)).code).toBe(2);
      expect(await Bun.file(historyPath).exists()).toBe(true);
      await mkdir(dirname(historyPath), { recursive: true });
      const history = {
        pr: 42,
        heads: [sha],
        seenComments: ['thread:1'],
        consultation: { kind: 'none' as const },
        roundsAtLastFeedback: 0,
      };
      await Bun.write(historyPath, JSON.stringify(history));
      expect((await checkPush(cwd, bin)).code).toBe(2);

      const entries: Entry[] = [
        { kind: 'round', round: { count: 1, sha, reviewer: 'other', accepted: false } },
        { kind: 'round', round: { count: 0, sha, reviewer: 'codex', accepted: false } },
      ];
      await writeEntries(entries, { cwd });
      expect((await checkPush(cwd, bin)).code).toBe(0);

      const newComment = JSON.stringify([[{
        id: 2,
        commit_id: sha,
        created_at: '2026-09-23T00:00:00Z',
        user: { login: 'reviewer' },
      }]]);
      expect((await checkPush(cwd, bin, newComment)).code).toBe(2);
      await writeEntries([...entries, entries[1]], { cwd });
      expect((await checkPush(cwd, bin, newComment)).code).toBe(0);

      await Bun.write(
        historyPath,
        JSON.stringify({ ...history, heads: ['a', 'b', sha], seenComments: ['one', 'two', 'thread:1'] }),
      );
      const blocked = await checkPush(cwd, bin);
      expect(blocked.code).toBe(2);
      expect(blocked.error).toContain('ユーザーに相談');
      await Bun.write(
        historyPath,
        JSON.stringify({
          ...history,
          heads: ['a', 'b', sha],
          seenComments: ['one', 'two', 'thread:1'],
          consultation: { kind: 'answered', through: 3, note: 'ユーザーの判断により再レビュー後の push を認める' },
        }),
      );
      expect((await checkPush(cwd, bin)).code).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
