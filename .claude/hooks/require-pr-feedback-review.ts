#!/usr/bin/env bun
/** 外部レビュー指摘を受けた PR の修正を、ローカルのレビューループが収束する前に push させない。 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readInput, workingTree } from './hook-utils.ts';
import { fetchGitHubFeedback } from './pr-feedback-github.ts';
import { parseExternalReviewHistory } from './pr-feedback-history.ts';
import {
  judgeExternalPush,
  markFeedbackReviewed,
  observeFeedbackBatch,
} from './pr-feedback-policy.ts';
import { externalReviewFile, readRounds, reviewTargetSha } from './review-count.ts';

function block(message: string): never {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

const input = await readInput();
const historyPath = await externalReviewFile(input);
const file = Bun.file(historyPath);
const tree = await workingTree(input);
const feedback = await fetchGitHubFeedback(tree);
if (feedback.kind === 'no_pr') process.exit(0);
if (feedback.kind === 'unavailable') block(feedback.reason);
const parsed = parseExternalReviewHistory((await file.exists()) ? await file.text() : '', feedback.pr);
if (parsed.kind === 'invalid') block('外部レビュー履歴が壊れています。記録を確認してください。');
const rounds = await readRounds(input);
const history = observeFeedbackBatch(parsed.history, feedback.observations, rounds.length);
if (history !== parsed.history) {
  await mkdir(dirname(historyPath), { recursive: true });
  await Bun.write(historyPath, JSON.stringify(history));
}
if (history.heads.length === 0) process.exit(0);
const sha = await reviewTargetSha(input);
switch (judgeExternalPush(history, rounds, sha)) {
  case 'consult_user':
    block(
      `この PR では異なる HEAD への外部レビュー指摘が ${history.heads.length} 回続いています。修正と push を止め、各回の指摘とローカルレビューで見逃した理由を根本原因ごとに整理し、なぜレビューが続くのか診断してください。設計・要件・レビュー手順を変える具体案を効果と影響で比較し、推奨案を添えてユーザーに採る方針を尋ねてください。レビューを続けるかだけの質問では足りません。答えを得た後に bun .claude/hooks/record-pr-feedback.ts asked "<診断とユーザーが選んだ方針>" で記録してください。`,
    );
  case 'review_locally':
    block(
      '外部レビュー指摘が届いた後のセルフレビューが現在の HEAD で収束していません。.claude/skills/pr-review-loop/SKILL.md の手順で差分全体をレビューし、bun .claude/hooks/record-pr-review.ts で記録してから push してください。',
    );
  case 'allow':
    break;
}
if (history.reviewedCommentCount < history.seenComments.length) {
  await Bun.write(historyPath, JSON.stringify(markFeedbackReviewed(history)));
}
