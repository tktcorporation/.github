#!/usr/bin/env bun
/** 3 回目以降の外部指摘について、ユーザーの回答を得た事実を記録する。 */
import { $ } from 'bun';
import { readInput, workingTree } from './hook-utils.ts';
import { EXTERNAL_REVIEW_LIMIT, acknowledgeFeedback, parseExternalReviewHistory } from './pr-feedback-policy.ts';
import { externalReviewFile, readRounds } from './review-count.ts';
import { MIN_NOTE_LENGTH, normalizeNote } from './review-policy.ts';

const [decision, ...words] = process.argv.slice(2);
const note = normalizeNote(words.join(' '));
if (decision !== 'asked' || note.length < MIN_NOTE_LENGTH) {
  console.error(`使い方: bun .claude/hooks/record-pr-feedback.ts asked "<ユーザーに示した診断と得た判断（${MIN_NOTE_LENGTH}文字以上）>"`);
  process.exit(1);
}
const input = await readInput();
const tree = await workingTree(input);
const pr = await $`gh pr view --json number -q .number`.cwd(tree).quiet().nothrow();
if (pr.exitCode !== 0) {
  console.error('現在のブランチに開いている PR が見つかりません。');
  process.exit(1);
}
const number = Number(pr.text().trim());
const path = await externalReviewFile(input);
const file = Bun.file(path);
const parsed = parseExternalReviewHistory((await file.exists()) ? await file.text() : '', number);
if (parsed.kind === 'invalid') {
  console.error('外部レビュー履歴が壊れています。記録を確認してください。');
  process.exit(1);
}
const history = parsed.history;
if (history.heads.length < EXTERNAL_REVIEW_LIMIT) {
  console.error('外部レビューが相談を要する回数に達していません。');
  process.exit(1);
}
await Bun.write(path, JSON.stringify(acknowledgeFeedback(history, note, (await readRounds(input)).length)));
console.log(`PR #${number} の外部レビュー ${history.heads.length} 回についてユーザー判断を記録しました。`);
