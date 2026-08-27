#!/usr/bin/env bash
# Shared Claude Code / Codex PostToolUse hook for successful PR creation.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
grep -qE 'gh\s+pr\s+create' <<<"$cmd" || exit 0

# Claude Code invokes this hook only after a successful command. Codex also invokes
# PostToolUse after failures, so honor an exit code when its response includes one.
status="$(printf '%s' "$input" | jq -r '.tool_response.exit_code // .tool_response.exitCode // empty' 2>/dev/null || true)"
[[ -z "$status" || "$status" == "0" ]] || exit 0

bash "$CLAUDE_PROJECT_DIR/.claude/hooks/reset-pr-review-count.sh"

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: "PR を作成した。続けて必ず次の3つを実行し、指摘があれば直すこと: (1) pr-first-reader-check スキルで、PRタイトル・本文・コミットメッセージ・差分のコメント/識別子に、初見のレビュアーへ通じない語（issue/PR 限定の呼び名・PR外参照・未定義略語・暗黙の前提）が無いか検査。 (2) evergreen-comment チェック（.claude/rules/evergreen-documentation.md）で、差分のコメントが現在のWHYだけか（履歴・WHAT重複・コードに無いものへの言及が無いか）検査。 (3) technical-writing-style スキルで、PR本文がLLM口調（予告と総括・空虚な形容等）・論証の厳密さ・段落構成・冗長排除の観点で書けているか検査。"
  }
}'
