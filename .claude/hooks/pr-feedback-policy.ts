import { judgeConvergence } from './review-policy.ts';
import type { Round } from './review-policy.ts';

/** PR の外部レビュー往復。ユーザー判断は回数と診断メモを一緒に持つ。 */
export type Consultation =
  | { kind: 'none' }
  | { kind: 'answered'; through: number; note: string; roundsAtConsultation: number };

export interface ExternalReviewHistory {
  pr: number;
  heads: string[];
  seenComments: string[];
  consultation: Consultation;
  roundsAtLastFeedback: number;
  reviewedCommentCount: number;
}

export const EXTERNAL_REVIEW_LIMIT = 3;

export const newExternalReviewHistory = (pr: number): ExternalReviewHistory => ({
  pr,
  heads: [],
  seenComments: [],
  consultation: { kind: 'none' },
  roundsAtLastFeedback: 0,
  reviewedCommentCount: 0,
});

export interface FeedbackObservation {
  head: string;
  commentIds: string[];
  roundsAtFeedback: number;
}

/** 新しいコメントだけを履歴へ反映する。再通知ではレビューの基準線を進めない。 */
export function observeFeedback(
  history: ExternalReviewHistory,
  observation: FeedbackObservation,
): ExternalReviewHistory {
  const unseen = [...new Set(observation.commentIds)].filter(
    (id) => !history.seenComments.includes(id),
  );
  if (unseen.length === 0) return history;
  const newHead = !history.heads.includes(observation.head);
  return {
    ...history,
    heads: newHead ? [...history.heads, observation.head] : history.heads,
    seenComments: [...history.seenComments, ...unseen],
    roundsAtLastFeedback: observation.roundsAtFeedback,
  };
}

export const needsUserDecision = (history: ExternalReviewHistory): boolean =>
  history.heads.length >= EXTERNAL_REVIEW_LIMIT &&
  (history.consultation.kind === 'none' || history.consultation.through < history.heads.length);

/** 最新の外部指摘に対するローカルレビューが収束したことを記録する。 */
export const markFeedbackReviewed = (history: ExternalReviewHistory): ExternalReviewHistory => ({
  ...history,
  reviewedCommentCount: history.seenComments.length,
});

export const acknowledgeFeedback = (
  history: ExternalReviewHistory,
  note: string,
  roundCount: number,
): ExternalReviewHistory => ({
  ...history,
  consultation: {
    kind: 'answered',
    through: history.heads.length,
    note,
    roundsAtConsultation: roundCount,
  },
});

export type PushVerdict = 'allow' | 'consult_user' | 'review_locally';

export function judgeExternalPush(
  history: ExternalReviewHistory,
  rounds: Round[],
  currentSha: string,
): PushVerdict {
  if (needsUserDecision(history)) return 'consult_user';
  if (history.reviewedCommentCount >= history.seenComments.length) return 'allow';
  if (
    rounds.length <= history.roundsAtLastFeedback ||
    (history.consultation.kind === 'answered' &&
      rounds.length <= history.consultation.roundsAtConsultation) ||
    judgeConvergence(rounds, currentSha).kind !== 'converged'
  ) {
    return 'review_locally';
  }
  return 'allow';
}
