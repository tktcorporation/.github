#!/usr/bin/env bash
# PostToolUse フック: gh pr create が exit 0 で完了した後にセルフレビューカウンターを
# リセットする。PostToolUse は成功時にのみ発火する（非ゼロ終了・許可拒否では発火しない）
# ため、実際に PR を作成できたときだけリセットされる。
#
# 呼び出し元の settings.json 側で gh pr create にマッチした場合のみこのスクリプトを
# 起動するため、ここでは再判定せずリセットのみ行う。

set -euo pipefail

# require-pr-self-review.sh / record-pr-review.sh と同じ解決ロジック。
# ここが揃っていないと、worktree 側に残ったカウンタファイルが削除されず、
# 次回 PR 作成時のセルフレビュー回数として誤って引き継がれる（worktree.md 参照）。
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
rm -f "$REVIEW_COUNT_FILE"
exit 0
