import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { externalReviewFile, reviewTargetSha, writeEntries } from './review-count.ts';
import type { Entry } from './review-policy.ts';

const script = join(import.meta.dir, 'require-pr-feedback-review.ts');
const preBash = join(import.meta.dir, 'pre-bash-guard.ts');

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

async function checkPush(
  cwd: string,
  bin: string,
  comments: unknown[] = [],
  prError = false,
): Promise<{ code: number; error: string }> {
  const child = Bun.spawn(['bun', script], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_COMMENTS: JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: comments,
        } } } },
      }),
      FAKE_PR_ERROR: prError ? '1' : '',
    },
    stdin: new Blob([JSON.stringify({ cwd })]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, error };
}

describe('外部指摘後の push ガード', () => {
  test('git -C で別 worktree を push するときは、その作業ツリーの PR を検査する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr-feedback-target-'));
    try {
      const caller = join(root, 'caller');
      const target = join(root, 'target');
      const bin = join(root, 'bin');
      await Promise.all([mkdir(caller), mkdir(target), mkdir(bin)]);
      git(target, 'init', '-q');
      await writeFile(
        join(bin, 'gh'),
        '#!/bin/sh\nif [ "$1" = "pr" ]; then if [ "$PWD" != "$FAKE_TARGET" ]; then echo "no pull requests found for branch" >&2; exit 1; fi; printf \'{"number":42,"headRefOid":"test-head"}\\n\'; exit 0; fi\nif [ "$1" = "repo" ]; then printf "owner/repo\\n"; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "user" ]; then printf "testuser\\n"; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "graphql" ]; then printf \'{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"isResolved":false,"comments":{"nodes":[{"databaseId":1,"author":{"login":"reviewer"},"pullRequestReview":{"commit":{"oid":"test-head"}}}]}}]}}}}}\\n\'; exit 0; fi\nexit 1\n',
        { mode: 0o755 },
      );
      const child = Bun.spawn(['bun', preBash], {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: join(import.meta.dir, '../..'),
          FAKE_TARGET: target,
        },
        stdin: new Blob([JSON.stringify({ cwd: caller, tool_input: { command: `git -C ${target} push` } })]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(error).toContain('外部レビュー指摘');
      expect(code).toBe(2);
      const other = Bun.spawn(['bun', preBash], {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: join(import.meta.dir, '../..'),
          FAKE_TARGET: target,
        },
        stdin: new Blob([JSON.stringify({ cwd: caller, tool_input: { command: `git -C ${target} push origin other:other` } })]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [otherCode, otherError] = await Promise.all([
        other.exited,
        new Response(other.stderr).text(),
      ]);
      expect(otherCode).toBe(2);
      expect(otherError).toContain('別ブランチ');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
        '#!/bin/sh\nif [ "$1" = "pr" ]; then if [ "$FAKE_PR_ERROR" = "1" ]; then echo "network error" >&2; exit 1; fi; printf \'{"number":42,"headRefOid":"test-head"}\\n\'; exit 0; fi\nif [ "$1" = "repo" ]; then printf "owner/repo\\n"; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "user" ]; then printf "testuser\\n"; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "graphql" ]; then printf "%s\\n" "$FAKE_COMMENTS"; exit 0; fi\nexit 1\n',
        { mode: 0o755 },
      );
      const sha = await reviewTargetSha({ cwd });
      const historyPath = await externalReviewFile({ cwd });
      const comment = (id: number, head: string, isResolved = false, login = 'reviewer') => ({
        isResolved,
        comments: { nodes: [{
          databaseId: id,
          author: { login },
          pullRequestReview: { commit: { oid: head } },
        }] },
      });
      const firstComment = [{
        ...comment(1, sha),
        comments: { nodes: [
          comment(1, sha).comments.nodes[0],
          comment(99, sha, false, 'testuser').comments.nodes[0],
        ] },
      }];
      expect((await checkPush(cwd, bin, [], true)).code).toBe(2);
      expect((await checkPush(cwd, bin, firstComment)).code).toBe(2);
      expect(await Bun.file(historyPath).exists()).toBe(true);
      await mkdir(dirname(historyPath), { recursive: true });
      const history = {
        pr: 42,
        heads: [sha],
        seenComments: ['thread:1'],
        consultation: { kind: 'none' as const },
        roundsAtLastFeedback: 0,
        reviewedThrough: 0,
      };
      await Bun.write(historyPath, JSON.stringify(history));
      expect((await checkPush(cwd, bin)).code).toBe(2);

      const entries: Entry[] = [
        { kind: 'round', round: { count: 1, sha, reviewer: 'other', accepted: false } },
        { kind: 'round', round: { count: 0, sha, reviewer: 'codex', accepted: false } },
      ];
      await writeEntries(entries, { cwd });
      expect((await checkPush(cwd, bin)).code).toBe(0);

      expect((await checkPush(cwd, bin, [comment(2, sha)])).code).toBe(0);
      const newComment = [comment(3, 'next-head')];
      expect((await checkPush(cwd, bin, newComment)).code).toBe(2);
      await writeEntries([...entries, entries[1]], { cwd });
      expect((await checkPush(cwd, bin, newComment)).code).toBe(0);

      // 自分の返信は指摘に数えず、解決済みでも未観測の外部指摘は検知する。
      expect((await checkPush(cwd, bin, [comment(4, 'another-head', false, 'testuser')])).code).toBe(0);
      expect((await checkPush(cwd, bin, [comment(5, 'another-head', true)])).code).toBe(2);

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
          consultation: {
            kind: 'answered',
            through: 3,
            note: 'ユーザーの判断により再レビュー後の push を認める',
            roundsAtConsultation: 3,
          },
        }),
      );
      expect((await checkPush(cwd, bin)).code).toBe(2);
      await writeEntries([...entries, entries[1], entries[1]], { cwd });
      expect((await checkPush(cwd, bin)).code).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
