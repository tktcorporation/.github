#!/usr/bin/env bun
/**
 * Stop: 現在のブランチの PR に未解決のレビュースレッドが残っていたら、完了を止めて対応させる。
 *
 * PR 作成後の自動レビュー（bot）や人のコメントは数分〜数十分遅れて届く。届いた後に
 * エージェントが「完了」と報告して止まると、対応はユーザーが次に気づいて指示するまで残る。
 * ターンの終わりごとに未解決スレッドを見て、まだ知らせていないものがあれば 1 度だけ止める。
 * 同じスレッドで何度も止めない（知らせたスレッドの id をセッション状態に記録する）。
 *
 * gh が使えない・PR が無い・API に失敗した場合は何もしない。
 *
 * ボットコメントの到着は分単位で遅れるため、直近のチェックから間もない Stop では gh を
 * 呼ばずスキップする（THROTTLE_MS 未満）。これが無いと、PR に紐づく間は連続する Stop の
 * 度に `gh pr view`/`repo view`/`api user`/`api graphql` の4呼び出しが毎回走り、無関係な
 * セッションを含めてレート制限とレイテンシを消費する。
 */
import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  needsUserDecision,
  observeFeedback,
  parseExternalReviewHistory,
} from './pr-feedback-policy.ts';
import { readInput, sessionStateDir, workingTree } from './hook-utils.ts';
import { externalReviewFile, readRounds } from './review-count.ts';

const THROTTLE_MS = 45_000;

/**
 * `$.ShellOutput.json()` は Promise を返す `Response.json()` 等と違って同期関数で、不正な JSON
 * だと同期的に throw する。`await output.json().catch(...)` と書くと、throw した時点で
 * `.catch` を呼ぶ前にエラーが伝播し（成功時も戻り値はただのオブジェクトで `.catch` を持たない
 * ため常に例外になる）意図した既定値へ倒れない。try/catch で明示的に包む。
 */
function safeShellJson<T>(output: $.ShellOutput, fallback: T): T {
  try {
    const parsed: T = output.json();
    return parsed;
  } catch {
    return fallback;
  }
}

const input = await readInput();
if (input?.stop_hook_active) process.exit(0);
const tree = await workingTree(input);

const directory = await sessionStateDir();
const throttlePath = directory
  ? join(directory, `${input?.session_id ?? 'unknown'}.pr-check-throttle`)
  : null;
if (throttlePath) {
  const last = Number.parseInt(
    await Bun.file(throttlePath)
      .text()
      .catch(() => '0'),
    10,
  );
  const now = performance.timeOrigin + performance.now();
  if (Number.isFinite(last) && now - last < THROTTLE_MS) process.exit(0);
  await mkdir(dirname(throttlePath), { recursive: true }).catch(() => undefined);
  await Bun.write(throttlePath, String(now)).catch(() => undefined);
}

const pr = await $`gh pr view --json number,url,headRefOid`.cwd(tree).quiet().nothrow();
if (pr.exitCode !== 0) process.exit(0);
const view = safeShellJson<{ number?: number; url?: string; headRefOid?: string }>(pr, {});
const { number, url, headRefOid } = view;
if (!number || !headRefOid) process.exit(0);

const repo = await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.cwd(tree).quiet().nothrow();
const me = await $`gh api user --jq .login`.quiet().nothrow();
if (repo.exitCode !== 0 || me.exitCode !== 0) process.exit(0);
const [owner, name] = repo.text().trim().split('/');
const login = me.text().trim();

interface Thread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: {
    nodes: {
      databaseId: number;
      author: { login: string } | null;
      body: string;
      pullRequestReview: { commit: { oid: string } | null } | null;
    }[];
  };
  firstComment: { nodes: { author: { login: string } | null; body: string }[] };
}
interface Payload {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Thread[];
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    };
  };
}
const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ id isResolved path line
        comments(last:1){ nodes{ databaseId author{ login } body pullRequestReview{ commit{ oid } } } }
        firstComment: comments(first:1){ nodes{ author{ login } body } }
      }
    }
  } }
}`;
// 100件を超える PR ではスレッドが複数ページに分かれる。1ページだけ見て「対応待ちが無い」と
// 判定すると、後続ページに未解決スレッドが残っていても見逃す
const threads: Thread[] = [];
let after: string | null = null;
for (;;) {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ];
  if (after) args.push('-f', `after=${after}`);
  const result = await $`gh ${args}`.cwd(tree).quiet().nothrow();
  if (result.exitCode !== 0) process.exit(0);
  const payload = safeShellJson<Payload | null>(result, null);
  const page = payload?.data?.repository?.pullRequest?.reviewThreads;
  threads.push(...(page?.nodes ?? []));
  if (!page?.pageInfo?.hasNextPage) break;
  after = page.pageInfo.endCursor ?? null;
  if (!after) break;
}
// 未解決で、最後の発言が自分ではないスレッドだけが対応待ち
const waiting = threads.filter(
  (thread) => !thread.isResolved && thread.comments.nodes[0]?.author?.login !== login,
);
if (waiting.length === 0) process.exit(0);

const naggedPath = directory
  ? join(directory, `${input?.session_id ?? 'unknown'}.pr-nagged`)
  : null;
const nagged = new Set(
  naggedPath && (await Bun.file(naggedPath).exists())
    ? (
        await Bun.file(naggedPath)
          .text()
          .catch(() => '')
      )
        .split('\n')
        .filter(Boolean)
    : [],
);
// 知らせた状態は「スレッド id + 最後のコメント id」で覚える。同じスレッドでも新しい返信が
// 付けば再び知らせる
const stateOf = (thread: Thread) => `${thread.id}:${thread.comments.nodes[0]?.databaseId ?? ''}`;
const commentIdOf = (thread: Thread) => String(thread.comments.nodes[0]?.databaseId ?? stateOf(thread));
const fresh = waiting.filter((thread) => !nagged.has(stateOf(thread)));
if (fresh.length === 0) process.exit(0);

// セッションごとの通知履歴とは別に、PR の外部レビュー往復をブランチ単位で持つ。
// 同じ HEAD に複数コメントが届いても 1 回と数え、PR 番号が変われば初期化する。
const historyPath = await externalReviewFile(input);
const saved = await Bun.file(historyPath).text().catch(() => '');
const parsed = parseExternalReviewHistory(saved, number);
if (parsed.kind === 'invalid') {
  console.log(JSON.stringify({ decision: 'block', reason: `PR #${number} の外部レビュー履歴が壊れています。記録を確認してください。` }));
  process.exit(0);
}
let history = parsed.history;
const roundCount = (await readRounds(input)).length;
for (const thread of fresh) {
  const reviewedHead = thread.comments.nodes[0]?.pullRequestReview?.commit?.oid ?? headRefOid;
  history = observeFeedback(history, {
    head: reviewedHead,
    commentIds: [commentIdOf(thread)],
    roundsAtFeedback: roundCount,
  });
}
await mkdir(dirname(historyPath), { recursive: true });
await Bun.write(historyPath, JSON.stringify(history));
if (naggedPath) {
  await mkdir(dirname(naggedPath), { recursive: true }).catch(() => undefined);
  await Bun.write(naggedPath, `${[...nagged, ...fresh.map(stateOf)].join('\n')}\n`).catch(
    () => undefined,
  );
}

const summary = fresh
  .map((thread) => {
    const first = thread.firstComment.nodes[0];
    const head = (first?.body ?? '').replace(/\s+/g, ' ').slice(0, 120);
    return `- ${thread.path}:${thread.line ?? '-'} (${first?.author?.login ?? '?'}): ${head}`;
  })
  .join('\n');
const guidance =
  needsUserDecision(history)
    ? `この PR では異なる HEAD への外部指摘が ${history.heads.length} 回続いています。修正と push を止め、各回の指摘とローカルレビューで見逃した理由を原因ごとにまとめ、なぜレビューが続くのか診断してください。設計・要件・レビュー手順を変える具体案を効果と影響で比較し、推奨案を添えてユーザーに採る方針を尋ねてください。レビューを続けるかだけを聞かないでください。答えを得た後、bun .claude/hooks/record-pr-feedback.ts asked "<診断とユーザーが選んだ方針>" で記録するまで次の push は通りません。`
    : `この PR では外部指摘が ${history.heads.length} 回目です。個別の指摘だけを直して push せず、.claude/skills/pr-review-loop/SKILL.md の手順で差分全体を再レビューし、収束させてから push してください。`;
console.log(
  JSON.stringify({
    decision: 'block',
    reason: `🛑 Stop hook: PR #${number}（${url}）に未対応のレビュースレッドが ${fresh.length} 件あります。${guidance} コメントごとに「修正 / 直さない理由 / 回答」を判断し、対応したスレッドを resolve してください。\n${summary}`,
  }),
);
