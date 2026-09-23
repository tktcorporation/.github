import { $ } from 'bun';
import type { FeedbackObservation } from './pr-feedback-policy.ts';

/** GitHub の返答をドメインの外部指摘へ変換する境界。 */
export type GitHubFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'found'; pr: number; observations: Omit<FeedbackObservation, 'roundsAtFeedback'>[] };

interface ReviewComment {
  id: number;
  commit_id: string;
  created_at: string;
  user: { login: string } | null;
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value &&
    typeof value.id === 'number' &&
    'commit_id' in value &&
    typeof value.commit_id === 'string' &&
    'created_at' in value &&
    typeof value.created_at === 'string' &&
    'user' in value &&
    (value.user === null ||
      (typeof value.user === 'object' &&
        value.user !== null &&
        'login' in value.user &&
        typeof value.user.login === 'string'))
  );
}

export async function fetchGitHubFeedback(tree: string): Promise<GitHubFeedback> {
  const pr = await $`gh pr view --json number -q .number`.cwd(tree).quiet().nothrow();
  if (pr.exitCode !== 0) return { kind: 'no_pr' };
  const number = Number(pr.text().trim());
  if (!Number.isInteger(number) || number <= 0) {
    return { kind: 'unavailable', reason: 'PR 番号を読み取れませんでした' };
  }
  const me = await $`gh api user --jq .login`.cwd(tree).quiet().nothrow();
  if (me.exitCode !== 0) {
    return { kind: 'unavailable', reason: 'GitHub のログイン名を取得できませんでした' };
  }
  const endpoint = `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`;
  const response = await $`gh api ${endpoint} --paginate --slurp`.cwd(tree).quiet().nothrow();
  if (response.exitCode !== 0) {
    return { kind: 'unavailable', reason: 'PR のレビューコメントを取得できませんでした' };
  }
  let pages: unknown;
  try {
    pages = response.json();
  } catch {
    return { kind: 'unavailable', reason: 'レビューコメントの JSON を解析できませんでした' };
  }
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    return { kind: 'unavailable', reason: 'レビューコメントの形式が想定と異なります' };
  }
  const comments: unknown[] = pages.flat();
  if (!comments.every(isReviewComment)) {
    return { kind: 'unavailable', reason: 'レビューコメントの項目が不足しています' };
  }
  const login = me.text().trim().toLowerCase();
  const observations = comments
    .filter((comment) => comment.user?.login.toLowerCase() !== login)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((comment) => ({
      head: comment.commit_id,
      commentIds: [String(comment.id)],
    }));
  return { kind: 'found', pr: number, observations };
}
