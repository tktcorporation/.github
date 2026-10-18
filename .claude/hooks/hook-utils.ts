import { $ } from 'bun';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  tool_use_id?: string;
  cwd?: string;
  tool_input?: {
    file_path?: string;
    path?: string;
    command?: string;
    run_in_background?: boolean;
    /** MCP ツールなど、ツールごとに異なる引数。 */
    [key: string]: unknown;
  };
  tool_response?: {
    exit_code?: number;
    exitCode?: number;
    duration_ms?: number;
    interrupted?: boolean;
    is_error?: boolean;
    isError?: boolean;
  };
  stop_hook_active?: boolean;
}
/** JSON 由来の値をプロパティ参照できる形に絞る（配列と null は含めない）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * hook が状態ファイル（レビュー回数など）や設定を読み書きする基準ディレクトリ。
 * Claude Code は CLAUDE_PROJECT_DIR に主チェックアウトを入れて hook を起動する
 * （worktree に入っても変わらない）。未設定のときは --git-common-dir から同じ
 * 場所を導く。--show-toplevel だと linked worktree ごとに別の場所になり、
 * 記録側と判定側で見るファイルが食い違う。
 *
 * 編集中のファイルや検証対象のツリーを扱う hook は、こちらではなく
 * workingTree() を使う。
 */
export async function projectDirectory(): Promise<string> {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const result = await $`git rev-parse --path-format=absolute --git-common-dir`.quiet().nothrow();
  return result.exitCode === 0 ? dirname(resolve(result.text().trim())) : process.cwd();
}
/**
 * hook が lint や検証をかける作業ツリーのトップレベル。Claude Code は hook 入力の
 * cwd にセッションの現在地を入れる（worktree に入ればその中、cd していれば
 * サブディレクトリ）。そこを起点に git のトップレベルを解く。cwd が無いときは
 * プロセスの現在地から解く。
 */
export async function workingTree(input?: HookInput | null): Promise<string> {
  const start = input?.cwd ?? process.cwd();
  const result = await $`git -C ${start} rev-parse --show-toplevel`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : start;
}
/**
 * レビュー記録と push のゲートが対象にするチェックアウト。`cwd` はそのチェックアウトのトップレベル
 * （サブモジュールなら サブモジュールのトップレベル、linked worktree なら worktree のディレクトリ）。
 * review-count.ts の各関数へそのまま渡せる。
 */
export interface ReviewTarget {
  cwd: string;
}

/**
 * hook が対象にするチェックアウトを決める。レビュー記録の読み書きと push のゲートは、
 * ここで決めた対象に対して行う。hook は常にルートプロジェクトの `.claude/hooks/` から起動される
 * が、作業はルート・その linked worktree・サブモジュール（入れ子を含む）・サブモジュールの
 * linked worktree のどこでも行われうるので、起動場所ではなく作業場所から対象を解く。
 *
 * 1. 起点のディレクトリ: hook 入力の `cwd`。入力が無い（端末や CLI として実行された）ときは
 *    プロセスの現在地。CLI のスクリプトは、実行したディレクトリのチェックアウトを対象にする。
 *    Bash ツールの hook では、コマンド文字列から対象を解かない。`cd` やサブシェルを解いた
 *    実行ディレクトリは呼び出し側（pre-bash-guard.ts が command-parse.ts の解析結果から）で決め、
 *    `cwd` にそのディレクトリを入れ、`tool_input.command` を外した入力を渡す。
 * 2. 決まったディレクトリから `git rev-parse --show-toplevel` でトップレベルを解く。git の
 *    外なら、そのディレクトリをそのまま使う。
 *
 * 記録ファイルは対象の git 共通ディレクトリの下に置かれる（review-count.ts）。サブモジュールなら
 * `<superproject>/.git/modules/<name>`、linked worktree なら主チェックアウトと同じ場所で、
 * ブランチ名で分かれる。PR 作成ゲートはこの対象を使わず、PR の head の SHA で証跡を引く
 * （pr-review-gate.ts）。
 */
export async function resolveTarget(input?: HookInput | null): Promise<ReviewTarget> {
  return { cwd: await workingTree({ cwd: input?.cwd ?? process.cwd() }) };
}

/**
 * origin リモートの URL から切り出した host・owner/repo。取れないとき、または origin に URL が
 * 複数あるときは null。host は、ローカルの
 * パスや file:// のようにホストを持たない URL では null。
 *
 * `url.<base>.insteadOf` で書き換える前の、設定に書かれた URL を読む。書き換えは転送先の都合で、
 * PR を作る GitHub 上のリポジトリを表すのは書き換える前の URL のため。
 */
export async function originRepository(
  tree: string,
): Promise<{ host: string | null; owner: string; repo: string } | null> {
  const remote = await $`git -C ${tree} config --get-all remote.origin.url`.quiet().nothrow();
  if (remote.exitCode !== 0) return null;
  // URL が複数あると、git は取得に最初の URL を使い、`config --get` は最後の URL を返す。
  // どれが PR の対象かを決められないので、1 つだけのときに限って読む。
  const urls = remote
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (urls.length !== 1) return null;
  return parseRemoteUrl(urls[0] ?? '');
}

/**
 * リモートの URL を host・owner/repo に分ける。owner/repo を切り出せなければ null。host は、
 * ローカルのパスや file:// のようにホストを持たない URL では null。scheme（ssh・https・scp 形式）と
 * ユーザー名は結果に含めないので、同じリポジトリを指す URL は書き方が違っても同じ値になる。
 */
export function parseRemoteUrl(
  raw: string,
): { host: string | null; owner: string; repo: string } | null {
  // 末尾のスラッシュ（`.../repo/` 等）を落としてから owner/repo を切り出す。
  const url = raw.trim().replace(/\/+$/u, '');
  const match = url.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?$/u);
  if (!match?.[1] || !match[2]) return null;
  return { host: urlHost(url), owner: match[1], repo: match[2] };
}

/** `scheme://[user@]host[:port]/…` と scp 形式 `[user@]host:path` のホスト（小文字）。 */
function urlHost(url: string): string | null {
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]*)/iu);
  if (scheme)
    return url.toLowerCase().startsWith('file:') ? null : (scheme[1] ?? '').toLowerCase() || null;
  const scp = url.match(/^(?:[^@/]+@)?([^/:]+):/u);
  return scp?.[1] ? scp[1].toLowerCase() : null;
}

/**
 * hook スクリプトを実行するコマンド。スクリプトの絶対パスを使うので、サブモジュールや worktree
 * など、どのディレクトリから実行しても同じスクリプトが動き、実行したディレクトリのチェックアウトが
 * 対象になる。エージェントへの案内文に使う。
 */
export function hookCommand(script: string): string {
  const path = join(import.meta.dir, script);
  return /^[\w./-]+$/u.test(path) ? `bun ${path}` : `bun '${path.replaceAll("'", "'\\''")}'`;
}

/**
 * `start` を含むチェックアウトから親のスーパープロジェクトを辿りきった、いちばん外側の
 * チェックアウト。サブモジュールの入れ子（`super/a/b`）のどこから始めても同じ場所になる。
 * サブモジュールの linked worktree は git がスーパープロジェクトを返さないので、そのサブモジュールの
 * 主チェックアウト（git 共通ディレクトリの core.worktree）へ移ってから辿る。git の外なら null。
 */
export async function outermostCheckout(start: string): Promise<string | null> {
  const top = await $`git -C ${start} rev-parse --show-toplevel`.quiet().nothrow();
  if (top.exitCode !== 0 || !top.text().trim()) return null;
  let current = top.text().trim();
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = await superprojectOf(current);
    if (parent !== null) {
      current = parent;
      continue;
    }
    const main = await submoduleMainCheckout(current);
    if (main === null || main === current || (await superprojectOf(main)) === null) break;
    current = main;
  }
  return current;
}

async function superprojectOf(tree: string): Promise<string | null> {
  const result = await $`git -C ${tree} rev-parse --show-superproject-working-tree`
    .quiet()
    .nothrow();
  return result.exitCode === 0 && result.text().trim() ? result.text().trim() : null;
}

/** サブモジュールの git 共通ディレクトリに書かれた主チェックアウト（core.worktree）。 */
async function submoduleMainCheckout(tree: string): Promise<string | null> {
  const common = await gitCommonDir(tree);
  if (common === null) return null;
  const result = await $`git config --file ${join(common, 'config')} --get core.worktree`
    .quiet()
    .nothrow();
  return result.exitCode === 0 && result.text().trim()
    ? resolve(common, result.text().trim())
    : null;
}

/** 主チェックアウトの .git。linked worktree からでも同じ場所を指す。 */
export async function gitCommonDir(start: string = process.cwd()): Promise<string | null> {
  const result = await $`git -C ${start} rev-parse --path-format=absolute --git-common-dir`
    .quiet()
    .nothrow();
  return result.exitCode === 0 ? resolve(result.text().trim()) : null;
}
/** 現在のブランチ名。detached HEAD ではコミットの短い ID。 */
export async function currentBranch(start: string = process.cwd()): Promise<string> {
  const name = await $`git -C ${start} rev-parse --abbrev-ref HEAD`.quiet().nothrow();
  const branch = name.text().replace(/\r?\n$/, '');
  if (name.exitCode === 0 && branch !== 'HEAD') return branch;
  return await headSha(start);
}
/** 現在の HEAD のフル SHA。作業ツリーの変更（staged/unstaged）は含まない。 */
export async function headSha(start: string = process.cwd()): Promise<string> {
  const result = await $`git -C ${start} rev-parse HEAD`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : 'unknown';
}
/**
 * origin の default branch の先端（`refs/remotes/origin/HEAD` が指すコミット）の SHA。
 * ルールがレビュー範囲 `<default>...HEAD` の基点に使うのと同じ解き方をする。origin/HEAD が
 * 未設定・指す先が無いなど解決できなければ null。
 */
export async function defaultBranchTip(start: string): Promise<string | null> {
  const ref = await $`git -C ${start} symbolic-ref --quiet --short refs/remotes/origin/HEAD`
    .quiet()
    .nothrow();
  if (ref.exitCode !== 0 || !ref.text().trim()) return null;
  const sha = await $`git -C ${start} rev-parse --verify --quiet ${`${ref.text().trim()}^{commit}`}`
    .quiet()
    .nothrow();
  return sha.exitCode === 0 && sha.text().trim() ? sha.text().trim() : null;
}

/**
 * 与えた SHA のうち、レビュー範囲 `<default>...HEAD` に入るもの、つまり現在の HEAD から辿れて
 * origin の default branch の先端からは辿れないコミットの集合。
 *
 * - default branch の先端から辿れるコミットは、マージ（merge commit・fast-forward・squash
 *   以外の取り込み）で既に default branch に入った作業か、作業の起点より前の履歴なので数えない。
 *   同じ名前で作り直したブランチが、前の作業の記録を引き継がないようにするため。
 * - HEAD が default branch の先端と同じ（新しいコミットの無いブランチ）なら範囲は空で、
 *   どの SHA も入らない。先端そのものへの記録も、空の差分へのレビューなので数えない。
 * - リポジトリが知らない SHA（gc 済みのコミットなど）は入らない。
 * - default branch の先端を解決できないときは、HEAD から辿れるかだけで絞る。
 * - HEAD を解決できない（git が使えない、コミットが無い）ときは判定できないので null を返し、
 *   呼び出し側は絞り込まずに扱う。
 */
export async function shasInReviewRange(
  start: string,
  shas: Iterable<string>,
): Promise<Set<string> | null> {
  const head = await $`git -C ${start} rev-parse --verify --quiet HEAD`.quiet().nothrow();
  if (head.exitCode !== 0) return null;
  const base = await defaultBranchTip(start);
  const isAncestor = async (sha: string, of: string): Promise<boolean> =>
    (await $`git -C ${start} merge-base --is-ancestor ${sha} ${of}`.quiet().nothrow()).exitCode ===
    0;
  const unique = [...new Set(shas)];
  const results = await Promise.all(
    unique.map(async (sha) => {
      if (!(await isAncestor(sha, 'HEAD'))) return null;
      if (base !== null && (await isAncestor(sha, base))) return null;
      return sha;
    }),
  );
  return new Set(results.filter((sha): sha is string => sha !== null));
}

/** `command` 内で、`word` が単語境界付きで最初に現れる位置を `from` 以降から探す。無ければ -1。 */
function indexOfWord(command: string, word: string, from: number): number {
  let index = command.indexOf(word, from);
  while (index !== -1) {
    const before = command[index - 1];
    const after = command[index + word.length];
    const boundaryBefore = before === undefined || !/\w/.test(before);
    const boundaryAfter = after === undefined || !/\w/.test(after);
    if (boundaryBefore && boundaryAfter) return index;
    index = command.indexOf(word, index + 1);
  }
  return -1;
}
/** 値を次の語に取る、`gh` と `pr` の間・`pr` とサブコマンドの間に置けるオプション。 */
const GH_REPO_FLAGS = new Set(['-R', '--repo']);

/**
 * `gh` に続く語の並び（`gh` 自身は含まない）が `pr create`・`pr new` を呼びうるか。`create`/`new` は
 * `pr` の直後のサブコマンドの位置にあるときだけ数える。`gh pr checkout 5 && git switch -c new-x` の
 * ように、別のサブコマンドの後ろに現れた語は PR 作成として扱わない。
 *
 * `gh` と `pr` の間・`pr` とサブコマンドの間では、`-` で始まる語をオプションとして読み飛ばし、
 * `-R`・`--repo` だけは次の語を値として読み飛ばす。受け付ける形が許すのは `-R <値>`・`--repo <値>`・
 * `--repo=<値>` だけだが、gh は `gh -Racme/x pr create` や `gh pr -d create` も PR 作成として実行する
 * ので、検出はそれより広く取り、受け付けない形として止める（pr-create-command.ts）。
 */
export function ghArgsCreatePr(words: readonly (string | undefined)[]): boolean {
  let index = 0;
  const skipOptions = () => {
    for (let word = words[index]; word?.startsWith('-'); word = words[index])
      index += GH_REPO_FLAGS.has(word) ? 2 : 1;
  };
  skipOptions();
  if (words[index] !== 'pr') return false;
  index += 1;
  skipOptions();
  const subcommand = words[index];
  return subcommand === 'create' || subcommand === 'new';
}

/** 語の区切りとして扱うシェルの記号。 */
const TOKEN_TERMINATORS = new Set([';', '|', '&', '(', ')', '<', '>']);

/**
 * `from` から次の語を読む。空白と行継続（`\` + 改行）を飛ばし、空白かシェルの記号までを 1 語とする。
 * 引用符（`"`・`'`・`` ` ``）は語から取り除く。`bash -c "gh pr create"` の `create"` も `create` になる。
 */
function readToken(command: string, from: number): { token: string; end: number } | null {
  let index = from;
  for (;;) {
    const char = command[index];
    if (char === undefined) return null;
    if (/\s/u.test(char)) index += 1;
    else if (char === '\\' && command[index + 1] === '\n') index += 2;
    else break;
  }
  const start = index;
  let token = '';
  for (;;) {
    const char = command[index];
    if (char === undefined || /\s/u.test(char) || TOKEN_TERMINATORS.has(char)) break;
    if (char === '\\' && command[index + 1] === '\n') break;
    if (char !== '"' && char !== "'" && char !== '`') token += char;
    index += 1;
  }
  // 記号から始まる位置では記号を 1 文字だけ読み、空の語として返す（gh の並びを途切れさせる）。
  return { token, end: index === start ? index + 1 : index };
}

/**
 * 1 つの `gh` から読む語の数の上限。`gh` と `pr` の間・`pr` とサブコマンドの間に、それぞれ数個の
 * オプションを置いた並びまでを拾う。
 */
const MAX_GH_WORDS = 16;

/**
 * コマンド文字列のどこかに、`gh [オプション] pr [オプション] create|new`（`gh pr new` は
 * `gh pr create` の別名）の並びがあるかを判定する。語の境界で区切った `gh` の出現ごとに、続く語を
 * ghArgsCreatePr で確かめる。シェルの行継続（`\` + 改行）は空白として読む。
 *
 * 構文解析の結果ではなく文字列そのものを見るので、引用符の中（`bash -c "gh pr create"`・コミット
 * メッセージ）や heredoc の本文に書かれた並びも拾う。これはゲートを掛けるかの判定にしか使わず、
 * 拾ったコマンドは決まった形でなければ止める（pr-create-command.ts）。止めすぎは書き直しで済むが、
 * 見逃しは未レビューの PR になる。
 *
 * 1 つの `gh` から読む語は上限（MAX_GH_WORDS）までなので、各文字を読み直す回数は定数で抑えられ、
 * 長い heredoc のような入力でも入力長に比例する時間で終わる。
 */
export function isPrCreateCommand(command: string): boolean {
  let ghIndex = indexOfWord(command, 'gh', 0);
  while (ghIndex !== -1) {
    const words: string[] = [];
    let position = ghIndex;
    while (words.length < MAX_GH_WORDS) {
      const next = readToken(command, position);
      if (next === null) break;
      words.push(next.token);
      position = next.end;
    }
    if (words[0] === 'gh' && ghArgsCreatePr(words.slice(1))) return true;
    ghIndex = indexOfWord(command, 'gh', ghIndex + 2);
  }
  return false;
}
export async function readInput(): Promise<HookInput | null> {
  // 端末から手で実行したときは stdin が閉じないので読まずに済ませる。
  if (process.stdin.isTTY) return null;
  try {
    return await Bun.stdin.json();
  } catch {
    return null;
  }
}
/**
 * セッションを跨いで持ち越す状態の置き場。git 共通ディレクトリの親に置くので、worktree に入っても
 * 同じ場所を指す。git 管理外（.claude/.gitignore の .session/）。git リポジトリでなければ null。
 */
export async function sessionStateDir(): Promise<string | null> {
  const common = await $`git rev-parse --git-common-dir`.quiet().nothrow();
  if (common.exitCode !== 0) return null;
  const root = dirname(resolve(process.cwd(), common.text().trim()));
  return join(root, '.claude/.session');
}
/**
 * このセッションのエージェントが Write / Edit ツールで書いたファイルの記録。
 * 1 行 `絶対パス<TAB>ハッシュ`（編集前の候補は `pending`、他人の変更を含むと分かったものは `foreign`）。
 * 追記のみで、同じパスは後の行が優先する。
 * track-edits.ts が書き、pre-bash-guard.ts が「自分の変更か」の判定に使う。
 */
export async function editedFilesPath(sessionId: string | undefined): Promise<string | null> {
  const directory = await sessionStateDir();
  if (!directory) return null;
  return join(directory, `${sessionId ?? 'unknown'}.edited`);
}
/**
 * 絶対パス → 最後に自分が書いた内容のハッシュ（または 'pending' / 'foreign' / 'deleted'）。
 * 追記専用ログを毎回全行読み直すため、1 セッションで編集するファイル数に比例したコストがかかる。
 * 通常のセッションが数百ファイルを超えて編集することは無いため許容している。
 */
export async function readEditedFiles(sessionId: string | undefined): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const path = await editedFilesPath(sessionId);
  if (!path) return result;
  const file = Bun.file(path);
  if (!(await file.exists())) return result;
  const text = await file.text().catch(() => '');
  for (const line of text.split('\n')) {
    const [file, hash] = line.split('\t');
    if (file) result.set(file, hash ?? 'pending');
  }
  return result;
}
/** ファイル内容の SHA-256。読めなければ null。 */
export async function hashFile(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const bytes = await file.arrayBuffer().catch(() => null);
  if (!bytes) return null;
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}
/**
 * 「自分が最後に書いたときのまま」を判定するための指紋。内容のハッシュだけだと、
 * ユーザーが実行ビットだけを変えた（`chmod +x` 等）場合に見分けられず、内容は自分のものの
 * ままなので所有を持ち続けてしまう。実行ビットの有無を添えて、モードだけの変更でも
 * 所有を手放すようにする。
 */
export async function ownershipFingerprint(path: string): Promise<string | null> {
  const hash = await hashFile(path);
  if (hash === null) return null;
  let executable = false;
  try {
    executable = (statSync(path).mode & 0o111) !== 0;
  } catch {
    // 直前の hashFile 成功と後続の stat の間で消えた。存在しない扱いにする
    return null;
  }
  return `${hash}:${executable ? 'x' : '-'}`;
}
export async function hasMiseTask(name: string): Promise<boolean> {
  const found = await $`mise tasks ls --no-header`.quiet().nothrow();
  return (
    found.exitCode === 0 &&
    found
      .text()
      .split('\n')
      .some((line) => line.trim().split(/\s+/)[0] === name)
  );
}
/** SIGTERM を送ってから SIGKILL へ進むまでの猶予。 */
const SIGKILL_GRACE_MS = 5_000;
/** シグナルを送っても子孫がパイプを握り続ける場合に、読み取りを打ち切るまでの猶予。 */
const READ_CUTOFF_MS = 10_000;

export async function runMiseTask(name: string, args: string[], timeoutMs: number) {
  const child = Bun.spawn(['mise', 'run', '--quiet', name, '--', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  // 制限時間を実効にする。シグナルだけでは足りない: SIGTERM を無視するタスクがあり、
  // 直接の子を SIGKILL しても stdout/stderr を握った子孫は残るため、パイプの読み取りが
  // 終わらない。プロセスを確実に終わらせられなくても hook 自体は返す必要があるので、
  // シグナルの送出と読み取りの打ち切りを両方仕掛ける。
  let timedOut = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cutoff = new Promise<void>((resolve) => {
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill();
        timers.push(setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS));
        timers.push(setTimeout(resolve, READ_CUTOFF_MS));
      }, timeoutMs),
    );
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Promise.race([new Response(child.stdout).text(), cutoff.then(() => '')]),
    Promise.race([new Response(child.stderr).text(), cutoff.then(() => '')]),
    Promise.race([child.exited, cutoff.then(() => -1)]),
  ]);
  for (const timer of timers) clearTimeout(timer);
  return {
    exitCode,
    output: `${stdout}${stderr}`
      .replace(new RegExp(`^\\[${name}\\] ERROR task failed$`, 'gm'), '')
      .trim(),
    timedOut: timedOut || child.signalCode !== null,
  };
}
