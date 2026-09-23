import { judgeConvergence } from './review-policy.ts';
import type { Round } from './review-policy.ts';

/** PR の外部レビュー往復。ユーザー判断は回数と診断メモを一緒に持つ。 */
export type Consultation =
  | { kind: 'none' }
  | { kind: 'answered'; through: number; note: string };

export interface ExternalReviewHistory {
  pr: number;
  heads: string[];
  seenComments: string[];
  consultation: Consultation;
  roundsAtLastFeedback: number;
}

export const EXTERNAL_REVIEW_LIMIT = 3;

export const newExternalReviewHistory = (pr: number): ExternalReviewHistory => ({
  pr,
  heads: [],
  seenComments: [],
  consultation: { kind: 'none' },
  roundsAtLastFeedback: 0,
});

export type ParsedHistory =
  | { kind: 'ready'; history: ExternalReviewHistory }
  | { kind: 'invalid' };

/** ディスクの JSON を境界で解釈する。PR が変われば新しい履歴、破損なら明示的な失敗。 */
export function parseExternalReviewHistory(text: string, pr: number): ParsedHistory {
  if (text.trim() === '') return { kind: 'ready', history: newExternalReviewHistory(pr) };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof value !== 'object' || value === null || !('pr' in value)) {
    return { kind: 'invalid' };
  }
  if (value.pr !== pr) return { kind: 'ready', history: newExternalReviewHistory(pr) };
  if (
    !('heads' in value) ||
    !Array.isArray(value.heads) ||
    !value.heads.every((head) => typeof head === 'string') ||
    new Set(value.heads).size !== value.heads.length ||
    !('seenComments' in value) ||
    !Array.isArray(value.seenComments) ||
    !value.seenComments.every((comment) => typeof comment === 'string') ||
    new Set(value.seenComments).size !== value.seenComments.length ||
    value.heads.length > value.seenComments.length ||
    !('roundsAtLastFeedback' in value) ||
    typeof value.roundsAtLastFeedback !== 'number' ||
    !Number.isInteger(value.roundsAtLastFeedback) ||
    value.roundsAtLastFeedback < 0 ||
    (value.heads.length === 0 && value.seenComments.length !== 0) ||
    (value.heads.length > 0 && value.seenComments.length === 0) ||
    !('consultation' in value) ||
    typeof value.consultation !== 'object' ||
    value.consultation === null ||
    !('kind' in value.consultation)
  ) {
    return { kind: 'invalid' };
  }
  const consultation = value.consultation;
  if (consultation.kind === 'answered') {
    if (
      !('through' in consultation) ||
      typeof consultation.through !== 'number' ||
      !Number.isInteger(consultation.through) ||
      consultation.through < EXTERNAL_REVIEW_LIMIT ||
      consultation.through > value.heads.length ||
      !('note' in consultation) ||
      typeof consultation.note !== 'string' ||
      consultation.note.trim() === ''
    ) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'ready',
      history: {
        pr,
        heads: value.heads,
        seenComments: value.seenComments,
        consultation: { kind: 'answered', through: consultation.through, note: consultation.note },
        roundsAtLastFeedback: value.roundsAtLastFeedback,
      },
    };
  }
  if (consultation.kind !== 'none') return { kind: 'invalid' };
  return {
    kind: 'ready',
    history: {
      pr,
      heads: value.heads,
      seenComments: value.seenComments,
      consultation: { kind: 'none' },
      roundsAtLastFeedback: value.roundsAtLastFeedback,
    },
  };
}

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
  return {
    ...history,
    heads: history.heads.includes(observation.head)
      ? history.heads
      : [...history.heads, observation.head],
    seenComments: [...history.seenComments, ...unseen],
    roundsAtLastFeedback: observation.roundsAtFeedback,
  };
}

export const needsUserDecision = (history: ExternalReviewHistory): boolean =>
  history.heads.length >= EXTERNAL_REVIEW_LIMIT &&
  (history.consultation.kind === 'none' || history.consultation.through < history.heads.length);

export const acknowledgeFeedback = (
  history: ExternalReviewHistory,
  note: string,
): ExternalReviewHistory => ({
  ...history,
  consultation: { kind: 'answered', through: history.heads.length, note },
});

export type PushVerdict = 'allow' | 'consult_user' | 'review_locally';

export function judgeExternalPush(
  history: ExternalReviewHistory,
  rounds: Round[],
  currentSha: string,
): PushVerdict {
  if (needsUserDecision(history)) return 'consult_user';
  if (
    rounds.length <= history.roundsAtLastFeedback ||
    judgeConvergence(rounds, currentSha).kind !== 'converged'
  ) {
    return 'review_locally';
  }
  return 'allow';
}
