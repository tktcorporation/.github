import { gitTarget, wordValue, type SimpleCommand } from './command-parse.ts';
import { currentBranch } from './hook-utils.ts';

export type PushTarget =
  | { kind: 'not_push' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'ready'; directory: string };

const PUSH_FLAGS = new Set([
  '-u', '--set-upstream', '-f', '--force', '-n', '--dry-run', '-q', '--quiet', '-v', '--verbose',
  '--porcelain', '--atomic', '--signed', '--no-signed', '--force-with-lease', '--no-verify',
]);

function currentBranchRefspec(refspec: string, branch: string): boolean {
  const currentRefs = new Set(['HEAD', branch, `refs/heads/${branch}`]);
  const [source, destination = source] = refspec.split(':');
  return currentRefs.has(source ?? '') && currentRefs.has(destination ?? '');
}

/** Git の暗黙の refspec が現在のブランチ以外を含まないか調べる。 */
function implicitPushIsCurrentBranch(directory: string): boolean {
  const pushDefault = Bun.spawnSync(
    ['git', '-C', directory, 'config', '--get', 'push.default'],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const mode = new TextDecoder().decode(pushDefault.stdout).trim();
  const remotePush = Bun.spawnSync(
    ['git', '-C', directory, 'config', '--get-regexp', '^remote\\..*\\.push$'],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  return (
    (pushDefault.exitCode === 0 || pushDefault.exitCode === 1) &&
    (!mode || mode === 'simple' || mode === 'current') &&
    remotePush.exitCode === 1
  );
}

/** Bash の直接 git push が、この作業ツリーの PR レビュー履歴で検査できるか判定する。 */
export async function reviewedPushTarget(command: SimpleCommand): Promise<PushTarget> {
  if (!command.direct || command.name !== 'git') return { kind: 'not_push' };
  const target = gitTarget(command);
  if (wordValue(target.subcommand) !== 'push') return { kind: 'not_push' };
  if (target.directory.kind === 'unknown') {
    return {
      kind: 'blocked',
      reason: 'git push の作業ツリーを特定できません。対象ディレクトリを明示して再実行してください。',
    };
  }
  const args = target.args.map(wordValue);
  if (args.some((arg) => arg === undefined || (arg.startsWith('-') && !PUSH_FLAGS.has(arg)))) {
    return {
      kind: 'blocked',
      reason: 'git push の対象ブランチを特定できません。対象ブランチの worktree から通常の git push で実行してください。',
    };
  }
  const positional = args.filter((arg): arg is string => Boolean(arg && !arg.startsWith('-')));
  const branch = await currentBranch(target.directory.path);
  if (positional.slice(1).some((refspec) => !currentBranchRefspec(refspec, branch))) {
    return {
      kind: 'blocked',
      reason: '別ブランチへの git push はこの作業ツリーの PR レビュー履歴で検査できません。対象ブランチの worktree から push してください。',
    };
  }
  if (positional.length <= 1 && !implicitPushIsCurrentBranch(target.directory.path)) {
    return {
      kind: 'blocked',
      reason: 'git push の暗黙の設定が別ブランチも対象にする可能性があります。現在のブランチを refspec で明示して push してください。',
    };
  }
  return { kind: 'ready', directory: target.directory.path };
}
