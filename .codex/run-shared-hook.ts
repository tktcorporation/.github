#!/usr/bin/env bun
import { basename, isAbsolute, join, resolve } from 'node:path';
import { projectDirectory, workingTree } from '../.claude/hooks/hook-utils.ts';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');
// These PreToolUse hooks enforce review before PR creation. Their failure must
// never be translated into permission to continue by a hook-enabled host.
const isPrGate = ['pre-bash-guard.ts', 'require-pr-self-review-mcp.ts'].includes(
  basename(hookPath),
);
function refuse(detail: string): never {
  process.stderr.write(`shared hook blocked: ${hookPath}: ${detail}\n`);
  process.exit(2);
}
// Claude Code が hook に渡すものと同じ形にする: CLAUDE_PROJECT_DIR は状態ファイル用の
// 主チェックアウト、入力の cwd は lint / 検証の対象になる作業ツリー（worktree）。
process.env.CLAUDE_PROJECT_DIR = await projectDirectory();
const tree = await workingTree();
const inputText = await Bun.stdin.text();
interface HookPayload {
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: string | { file_path?: string; cmd?: string; command?: string; workdir?: string };
  hookSpecificOutput?: { additionalContext?: string };
  [key: string]: unknown;
}
let input: HookPayload;
try {
  const parsed: HookPayload = JSON.parse(inputText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hook input must be an object');
  }
  input = parsed;
} catch {
  if (isPrGate) refuse('invalid hook input JSON');
  process.exit(0);
}
if (input.tool_name === 'exec_command') {
  const shell = input.tool_input;
  if (!shell || typeof shell !== 'object' || typeof shell.cmd !== 'string') {
    refuse('exec_command requires tool_input.cmd');
  }
  if (shell.command !== undefined && shell.command !== shell.cmd) {
    refuse('conflicting tool_input.cmd and command');
  }
  if (shell.workdir !== undefined && typeof shell.workdir !== 'string') {
    refuse('invalid tool_input.workdir');
  }
  // Host cwd identifies the session; workdir identifies the actual command.
  // Resolve relative paths against the host process, like exec_command does.
  input.cwd = shell.workdir === undefined ? (input.cwd ?? tree) : resolve(shell.workdir);
  input.tool_input = { ...shell, command: shell.cmd };
}
input.cwd ??= tree;

// pre-bash-guard.ts は全コマンドで動くが、レビューを強制するのは push と PR 作成だけ。
// 解析用の依存を初回に入れられないオフライン環境などで hook 自体が落ちたとき、それ以外の
// コマンドまで止めないよう、拒否に倒すのは push / PR 作成になり得るコマンドに限る。
// 判定は取りこぼしを避けるため広めに取る（該当しうる文字列を含めば拒否側）。
const shellCommand =
  typeof input.tool_input === 'object' && typeof input.tool_input?.command === 'string'
    ? input.tool_input.command
    : undefined;
const failsClosed =
  isPrGate &&
  (basename(hookPath) !== 'pre-bash-guard.ts' ||
    shellCommand === undefined ||
    /\bgit\b[\s\S]*\bpush\b|\bgh\b[\s\S]*\bpr\b/.test(shellCommand));

/** Codex に返す、意図しない hook 失敗の診断。exit 2 以外は実行を止める指示ではない。 */
function unexpectedFailure(status: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 4_000);
  if (failsClosed) refuse(`exit ${status}: ${detail}`);
  const lines = [
    `⚠️ shared hook failed: \`${hookPath}\` (exit ${status})。`,
    'この失敗は明示的なブロックではないため、元のツール実行は継続した。hook の修正が必要か確認すること。',
  ];
  if (detail) lines.push(`stderr:\n${detail}`);
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'PreToolUse',
      additionalContext: lines.join('\n'),
    },
  });
}

const runHook = async (payload: unknown): Promise<string> => {
  // スクリプト本体は tree（Codex が開いているワークスペース）から解決する。Codex は
  // ワークスペース自体を worktree 直下に開くことがあり、その worktree だけに存在する
  // hook 定義（他 worktree /main checkout にまだ無いコミット）を、CLAUDE_PROJECT_DIR
  // （常に主チェックアウトを指す）から解決すると見つけられない。
  const executable = isAbsolute(hookPath) ? hookPath : join(tree, hookPath);
  const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
  let output: string;
  let stderr: string;
  let status: number;
  try {
    const processHandle = Bun.spawn(command, {
      cwd: tree,
      env: process.env,
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    [output, stderr, status] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
  } catch (error) {
    return unexpectedFailure(
      1,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  // exit 2 は pre-bash-guard のような明示的な拒否。ここで 0 にすると安全上の block を
  // すり抜ける。0 / 2 以外は未処理例外・外部コマンド失敗・シグナル終了などの異常終了で、
  // Codex が hook 名も stderr も表示せず「Hook failed」だけを繰り返すので、診断を注入して
  // fail-open にする。
  if (status !== 0 && status !== 2) return unexpectedFailure(status, stderr);
  if (status === 2) {
    if (stderr) process.stderr.write(stderr);
    process.exit(status);
  }
  return output.trim();
};

/** Hook の stdout は Codex hook protocol の JSON だけを許す。 */
function protocolOutput(output: string): string {
  if (!output) return '';
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const hookSpecificOutput =
        'hookSpecificOutput' in parsed ? parsed.hookSpecificOutput : undefined;
      const decision = 'decision' in parsed ? parsed.decision : undefined;
      const reason = 'reason' in parsed ? parsed.reason : undefined;
      if (
        (hookSpecificOutput !== null && typeof hookSpecificOutput === 'object') ||
        (decision === 'block' && typeof reason === 'string')
      )
        return output;
    }
  } catch {
    // JSON として読めない場合も、下の共通診断にする。
  }
  return unexpectedFailure(1, `hook returned invalid hook protocol JSON:\n${output}`);
}

if (typeof input.tool_input !== 'string') {
  const output = protocolOutput(await runHook(input));
  if (output) console.log(output);
  process.exit(0);
}

const files = [
  ...input.tool_input.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.*)$|^\*\*\* Move to: (.*)$/gm,
  ),
]
  .map((match) => match[1] ?? match[2])
  .filter((file, index, all) => all.indexOf(file) === index);
if (files.length === 0) files.push('');

const outputs: HookPayload[] = [];
for (const file of files) {
  const payload = file ? { ...input, tool_input: { file_path: file } } : input;
  const output = protocolOutput(await runHook(payload));
  if (!output) continue;
  outputs.push(JSON.parse(output));
}
if (outputs.length === 1) console.log(JSON.stringify(outputs[0]));
if (outputs.length > 1) {
  const merged = outputs[0];
  const hookOutput = merged.hookSpecificOutput ?? {};
  merged.hookSpecificOutput = hookOutput;
  hookOutput.additionalContext = outputs
    .map((item) => item.hookSpecificOutput?.additionalContext)
    .filter(Boolean)
    .join('\n');
  console.log(JSON.stringify(merged));
}
