#!/usr/bin/env bun
/** 3 回目以降の外部指摘について、ユーザーの回答を得た事実を記録する。 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchGitHubFeedback } from './pr-feedback-github.ts';
import { parseExternalReviewHistory } from './pr-feedback-history.ts';
import { readInput, workingTree } from './hook-utils.ts';
import { EXTERNAL_REVIEW_LIMIT, acknowledgeFeedback, observeFeedbackBatch } from './pr-feedback-policy.ts';
import { externalReviewFile, readRounds } from './review-count.ts';
import { MIN_NOTE_LENGTH, normalizeNote } from './review-policy.ts';

const [decision, ...words] = process.argv.slice(2);
const note = normalizeNote(words.join(' '));
if (decision !== 'asked' || note.length < MIN_NOTE_LENGTH) {
  console.error(`使い方: bun .claude/hooks/record-pr-feedback.ts asked "<レビューが続く原因とユーザーが選んだ方針（${MIN_NOTE_LENGTH}文字以上）>"`);
  process.exit(1);
}
const input = await readInput();
const tree = await workingTree(input);
const feedback = await fetchGitHubFeedback(tree);
if (feedback.kind !== 'found') {
  console.error(feedback.kind === 'no_pr' ? '現在のブランチに開いている PR が見つかりません。' : feedback.reason);
  process.exit(1);
}
const path = await externalReviewFile(input);
const file = Bun.file(path);
const parsed = parseExternalReviewHistory((await file.exists()) ? await file.text() : '', feedback.pr);
if (parsed.kind === 'invalid') {
  console.error('外部レビュー履歴が壊れています。記録を確認してください。');
  process.exit(1);
}
const rounds = await readRounds(input);
const history = observeFeedbackBatch(parsed.history, feedback.observations, rounds.length);
if (history !== parsed.history) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(history));
}
if (history.heads.length < EXTERNAL_REVIEW_LIMIT) {
  console.error('外部レビューが相談を要する回数に達していません。');
  process.exit(1);
}
await Bun.write(path, JSON.stringify(acknowledgeFeedback(history, note, rounds.length)));
console.log(`PR #${feedback.pr} の外部レビュー ${history.heads.length} 回についてユーザー判断を記録しました。`);
