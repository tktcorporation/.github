import { describe, expect, test } from 'bun:test';
import {
  ASKED,
  CHECKPOINT_INTERVAL,
  LONG_REVIEW_ROUNDS,
  checkpointState,
  formatEntries,
  judgeCheckpoint,
  judgeRound,
  parseEntries,
} from './review-policy.ts';
import type { Entry, Round } from './review-policy.ts';

const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const note = '指摘は文書の整合性 2 種類に分類でき、共通の構造的原因は無いと判断した。';
const roundOf = (count: number, overrides: Partial<Round> = {}): Round => ({
  count,
  sha,
  reviewer: 'codex',
  accepted: false,
  ...overrides,
});
const round = (count: number, accepted = false): Entry => ({
  kind: 'round',
  round: roundOf(count, { accepted }),
});
const rounds = (...counts: number[]): Entry[] => counts.map((count) => round(count));
const checkpoint: Entry = { kind: 'checkpoint', decision: ASKED, sha, note: '診断メモ' };

describe('checkpointState', () => {
  test(`${CHECKPOINT_INTERVAL} ラウンドに満たなければ振り返りは要らない`, () => {
    expect(checkpointState(rounds(5, 8)).status).toBe('clear');
  });

  test('件数が最良値を更新していなければ停滞と判定し、確認を必須にする', () => {
    expect(checkpointState(rounds(5, 8, 6))).toMatchObject({
      status: 'due',
      ask: { kind: 'stalled' },
    });
    expect(checkpointState(rounds(3, 2, 2))).toMatchObject({ ask: { kind: 'stalled' } });
  });

  test('件数が下がり続けていれば、確認は必須にならない', () => {
    expect(checkpointState(rounds(8, 6, 4))).toMatchObject({ status: 'due', ask: null });
  });

  test('最後のラウンドが 0 件か accepted なら停滞ではない', () => {
    expect(checkpointState(rounds(3, 1, 0))).toMatchObject({ ask: null });
    expect(checkpointState([round(2), round(2), round(2, true)])).toMatchObject({ ask: null });
  });

  test('振り返りの記録以降のラウンドだけを窓として数える', () => {
    const state = checkpointState([...rounds(5, 8, 6), checkpoint, round(4)]);
    expect(state).toEqual({ status: 'clear', counts: [4], totalRounds: 4 });
  });

  test(`ラウンドが ${LONG_REVIEW_ROUNDS} に達したら、件数が下がっていても確認を必須にする`, () => {
    const state = checkpointState([...rounds(9, 7, 5), checkpoint, ...rounds(4, 3, 1)]);
    expect(state).toMatchObject({
      status: 'due',
      ask: { kind: 'long', totalRounds: LONG_REVIEW_ROUNDS },
    });
  });

  test(`ラウンドが ${LONG_REVIEW_ROUNDS} に満たない間は、下がっている限り確認を求めない`, () => {
    expect(checkpointState(rounds(9, 7, 5))).toMatchObject({ ask: null });
  });
});

describe('judgeRound', () => {
  test('振り返りが済むまで、収束しないラウンドは記録できない', () => {
    const verdict = judgeRound(rounds(8, 6, 4), roundOf(3));
    expect(verdict.kind).toBe('blocked');
  });

  test('振り返りが必要でも、収束するラウンドは止めない', () => {
    const verdict = judgeRound(rounds(3, 3, 3), roundOf(0, { sha: head }));
    expect(verdict).toMatchObject({ kind: 'record', converged: true });
  });

  test('accepted のラウンドも、収束するので止めない', () => {
    const verdict = judgeRound(rounds(2, 2, 2), roundOf(2, { sha: head, accepted: true }));
    expect(verdict).toMatchObject({ kind: 'record', converged: true });
  });

  test('振り返りを記録した後は、同じラウンドを記録できる', () => {
    const entries = rounds(8, 6, 4);
    const accepted = judgeCheckpoint(entries, 'continue', note, head);
    if (accepted.kind !== 'accept') throw new Error('振り返りが受理されなかった');
    expect(judgeRound(accepted.entries, roundOf(3)).kind).toBe('record');
  });
});

describe('judgeCheckpoint', () => {
  test('振り返りの時期でなければ拒否する', () => {
    expect(judgeCheckpoint(rounds(5, 8), 'continue', note, head)).toMatchObject({
      kind: 'reject',
      rejection: { kind: 'not_due' },
    });
  });

  test(`確認が必須のときは ${ASKED} 以外を拒否する`, () => {
    expect(judgeCheckpoint(rounds(5, 8, 6), 'continue', note, head)).toMatchObject({
      rejection: { kind: 'must_ask', reason: { kind: 'stalled' } },
    });
    expect(judgeCheckpoint(rounds(5, 8, 6), ASKED, note, head).kind).toBe('accept');
  });

  test('診断メモは 30 文字から受理し、29 文字は拒否する', () => {
    expect(judgeCheckpoint(rounds(8, 6, 4), 'continue', 'あ'.repeat(29), head)).toMatchObject({
      rejection: { kind: 'note_too_short' },
    });
    expect(judgeCheckpoint(rounds(8, 6, 4), 'continue', 'あ'.repeat(30), head).kind).toBe(
      'accept',
    );
  });

  test('受理した振り返りは、畳んだメモと HEAD の SHA を持つ', () => {
    const verdict = judgeCheckpoint(rounds(8, 6, 4), 'replan', `分類:\n${note}`, head);
    expect(verdict).toMatchObject({ kind: 'accept' });
    if (verdict.kind === 'accept') {
      expect(verdict.entries.at(-1)).toEqual({
        kind: 'checkpoint',
        decision: 'replan',
        sha: head,
        note: `分類: ${note}`,
      });
    }
  });
});

describe('記録形式', () => {
  test('書き出した記録を読み戻すと同じ内容になる', () => {
    const entries: Entry[] = [
      round(5),
      { kind: 'round', round: roundOf(2, { reviewer: 'other', accepted: true }) },
      { kind: 'checkpoint', decision: 'replan', sha, note },
    ];
    expect(parseEntries(formatEntries(entries))).toEqual(entries);
  });

  test('メモの無い旧形式の振り返り行も読める', () => {
    expect(parseEntries(`checkpoint asked ${sha}\n`)).toEqual([
      { kind: 'checkpoint', decision: 'asked', sha, note: '' },
    ]);
  });

  test('未知の決定を持つ行は読み飛ばす', () => {
    expect(parseEntries(`checkpoint skip ${sha} ${note}\n`)).toEqual([]);
  });
});
