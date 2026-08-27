#!/usr/bin/env bash
# Codex adapter: normalize Codex hook input for hooks shared with Claude Code.
set -euo pipefail

hook_path="${1:?shared hook path is required}"
project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
export CLAUDE_PROJECT_DIR="$project_dir"

input="$(cat)"

# Codex passes apply_patch's free-form patch as tool_input. Shared hooks expect
# Claude Code's {tool_input: {file_path: ...}} shape, so adapt every affected path
# at this boundary instead of teaching each shared hook about Codex syntax.
if [[ "$(jq -r '.tool_input | type' <<<"$input" 2>/dev/null || true)" != "string" ]]; then
  exec bash "$project_dir/$hook_path" <<<"$input"
fi

mapfile -t files < <(
  jq -r '.tool_input' <<<"$input" |
    sed -nE \
      -e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
      -e 's/^\*\*\* Move to: (.*)$/\1/p' |
    awk '!seen[$0]++'
)

[[ "${#files[@]}" -gt 0 ]] || exec bash "$project_dir/$hook_path" <<<"$input"

outputs=()
for file in "${files[@]}"; do
  normalized="$(jq -c --arg file "$file" '.tool_input = {file_path: $file}' <<<"$input")"
  output="$(bash "$project_dir/$hook_path" <<<"$normalized")"
  [[ -z "$output" ]] || outputs+=("$output")
done

[[ "${#outputs[@]}" -gt 0 ]] || exit 0

# Most hooks emit nothing. If several edited files produce hook context, merge it
# into one valid hook response rather than printing multiple JSON documents.
printf '%s\n' "${outputs[@]}" | jq -s '
  if length == 1 then .[0]
    else . as $all
      | $all[0]
      | .hookSpecificOutput.additionalContext = (
          [$all[].hookSpecificOutput.additionalContext // empty] | join("\n")
        )
    end
'
