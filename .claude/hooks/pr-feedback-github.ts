import { $ } from 'bun';
import type { FeedbackObservation } from './pr-feedback-policy.ts';

/** GitHub の返答をドメインの外部指摘へ変換する境界。 */
export type GitHubFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'found'; pr: number; observations: Omit<FeedbackObservation, 'roundsAtFeedback'>[] };

interface ReviewThread {
  isResolved: boolean;
  comments: {
    nodes: {
      databaseId: number;
      author: { login: string } | null;
      pullRequestReview: { commit: { oid: string } | null } | null;
    }[];
  };
}

interface ReviewThreadsPage {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
          nodes?: ReviewThread[];
        };
      };
    };
  };
}

const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100,after:$after){ pageInfo{hasNextPage endCursor}
      nodes{isResolved comments(last:1){nodes{databaseId author{login} pullRequestReview{commit{oid}}}}}
    }
  } }
}`;

export async function fetchGitHubFeedback(tree: string): Promise<GitHubFeedback> {
  const pr = await $`gh pr view --json number,headRefOid`.cwd(tree).quiet().nothrow();
  if (pr.exitCode !== 0) {
    return pr.stderr.toString().includes('no pull requests found for branch')
      ? { kind: 'no_pr' }
      : { kind: 'unavailable', reason: '現在の PR を確認できませんでした' };
  }
  let view: { number?: number; headRefOid?: string };
  try {
    view = pr.json();
  } catch {
    return { kind: 'unavailable', reason: 'PR の JSON を解析できませんでした' };
  }
  const { number, headRefOid } = view;
  if (!Number.isInteger(number) || !number || !headRefOid) {
    return { kind: 'unavailable', reason: 'PR 番号または HEAD を読み取れませんでした' };
  }
  const repo = await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.cwd(tree).quiet().nothrow();
  const me = await $`gh api user --jq .login`.cwd(tree).quiet().nothrow();
  if (repo.exitCode !== 0 || me.exitCode !== 0) {
    return { kind: 'unavailable', reason: 'リポジトリまたは GitHub のログイン名を取得できませんでした' };
  }
  const [owner, name] = repo.text().trim().split('/');
  if (!owner || !name) return { kind: 'unavailable', reason: 'リポジトリ名が不正です' };
  const login = me.text().trim().toLowerCase();
  const observations: Omit<FeedbackObservation, 'roundsAtFeedback'>[] = [];
  let after: string | null = null;
  for (;;) {
    const args = [
      'api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`,
      '-F', `number=${number}`,
    ];
    if (after) args.push('-f', `after=${after}`);
    const response = await $`gh ${args}`.cwd(tree).quiet().nothrow();
    if (response.exitCode !== 0) {
      return { kind: 'unavailable', reason: 'PR のレビュースレッドを取得できませんでした' };
    }
    let payload: ReviewThreadsPage;
    try {
      payload = response.json();
    } catch {
      return { kind: 'unavailable', reason: 'レビュースレッドの JSON を解析できませんでした' };
    }
    const page = payload.data?.repository?.pullRequest?.reviewThreads;
    if (!page?.pageInfo || !Array.isArray(page.nodes)) {
      return { kind: 'unavailable', reason: 'レビュースレッドの形式が想定と異なります' };
    }
    for (const thread of page.nodes) {
      const last = thread.comments?.nodes?.[0];
      if (thread.isResolved || !last || last.author?.login.toLowerCase() === login) continue;
      if (!Number.isInteger(last.databaseId)) {
        return { kind: 'unavailable', reason: 'レビューコメントの ID を読み取れませんでした' };
      }
      observations.push({
        head: last.pullRequestReview?.commit?.oid ?? headRefOid,
        commentIds: [String(last.databaseId)],
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor ?? null;
    if (!after) return { kind: 'unavailable', reason: 'レビュースレッドの続きが不明です' };
  }
  return { kind: 'found', pr: number, observations };
}
