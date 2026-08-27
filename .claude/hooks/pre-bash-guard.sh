#!/usr/bin/env bash
# Shared Claude Code / Codex PreToolUse hook for shell safety and PR gates.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

if grep -qE 'lsof.*-ti.*\|.*xargs.*kill|lsof.*-ti.*\|.*kill|kill.*\$\(lsof|kill.*lsof|fuser.*-k' <<<"$cmd"; then
  echo 'BLOCKED: lsof+kill / fuser+kill はポートフォワーディングプロセスを巻き込んで devcontainer を殺す。代わりに pkill -f で特定プロセス名を指定して kill すること。' >&2
  exit 2
fi

if grep -qE 'git\s+checkout\s+--\s+\.|git\s+restore\s+\.|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|jj\s+restore\s+--(from|to|changes-in)' <<<"$cmd"; then
  echo 'BLOCKED: 全ファイル対象の revert/reset は他プロセスの変更を巻き込む。特定ファイルを指定するか、ワークスペース (jj workspace add / git worktree add) を作成して作業すること。' >&2
  exit 2
fi

if grep -qE 'git\s+worktree\s+add' <<<"$cmd" && ! grep -qE 'git\s+worktree\s+add\s+\.claude/worktrees/' <<<"$cmd"; then
  echo 'BLOCKED: worktree は .claude/worktrees/ 配下に作成すること。例: git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/<default-branch>（default branch は origin/HEAD から導出。worktree.md 参照）。' >&2
  exit 2
fi

if grep -qE 'gh\s+pr\s+create' <<<"$cmd"; then
  printf '%s' "$input" | bash "$CLAUDE_PROJECT_DIR/.claude/hooks/require-pr-self-review.sh"
fi

for hook in "$CLAUDE_PROJECT_DIR"/.claude/hooks/project/*.sh; do
  [[ -x "$hook" ]] || continue
  printf '%s' "$input" | "$hook" || exit $?
done
