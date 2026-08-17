#!/usr/bin/env bash
# セルフレビュー完了を記録するスクリプト。
# codex review 実行後に呼び出し、.claude/.pr-review-count をインクリメントする。
#
# 使い方:
#   bash .claude/hooks/record-pr-review.sh
#
# Claude が自動的に呼び出す（require-pr-self-review.sh の指示に従って）

set -euo pipefail

# require-pr-self-review.sh と同じ解決ロジック。CLAUDE_PROJECT_DIR は hook
# 実行時にのみ設定され、このスクリプトを worktree 内から手動で呼ぶときは
# 未設定になるため、"." フォールバックだと require-pr-self-review.sh が見る
# ファイルと分裂する（worktree.md 参照）。
resolve_project_dir() {
  if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
    printf '%s' "$CLAUDE_PROJECT_DIR"
    return
  fi
  local common_dir
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || { printf '.'; return; }
  (cd "$common_dir/.." && pwd)
}

REVIEW_COUNT_FILE="$(resolve_project_dir)/.claude/.pr-review-count"

count=0
if [[ -f "$REVIEW_COUNT_FILE" ]]; then
  count=$(cat "$REVIEW_COUNT_FILE" 2>/dev/null || echo 0)
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
fi

new_count=$((count + 1))
echo "$new_count" > "$REVIEW_COUNT_FILE"

echo "セルフレビュー ${new_count} 回目を記録しました。"
