#!/usr/bin/env bash
# Claude Code statusline script (project scope)
# 公式JSON fields + セッション要約を表示
# set -e を使わない: ステータスラインは部分的失敗でも表示を続けるべき

input=$(cat)

# --- 公式JSONフィールド ---
model=$(echo "$input" | jq -r '.model.display_name // "?"' | sed 's/Claude //')
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | xargs printf '%.0f')
transcript=$(echo "$input" | jq -r '.transcript_path // ""')
lines_add=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_del=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

# コンテキストバー (ASCII)
bar_w=10
filled=$((pct * bar_w / 100))
empty=$((bar_w - filled))
bar=$(printf '%*s' "$filled" '' | tr ' ' '#')$(printf '%*s' "$empty" '' | tr ' ' '-')

# --- セッション要約: transcript の最初のユーザーメッセージから抽出 ---
topic=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  # 最初のユーザーメッセージのテキスト部分を取得、30文字に切り詰め
  raw=$(grep -m1 '"type":"user"' "$transcript" 2>/dev/null \
    | jq -r '
        .message.content
        | if type == "string" then .
          elif type == "array" then
            [.[] | select(.type == "text") | .text] | join(" ")
          else ""
          end
      ' 2>/dev/null || echo "")
  # メタデータタグ(command-message, command-name, system-reminder)は中身ごと除去
  # command-args は中身だけ残す（ユーザーの実際の入力）
  topic=$(echo "$raw" \
    | sed 's/<command-message>[^<]*<\/command-message>//g' \
    | sed 's/<command-name>[^<]*<\/command-name>//g' \
    | sed 's/<system-reminder>[^<]*<\/system-reminder>//g' \
    | sed 's/<[^>]*>//g' \
    | tr '\n' ' ' | sed 's/  */ /g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//' \
    | head -c 200)
fi

# --- 組み立て ---
# 1行目: model [bar] pct% | +add/-del
# 2行目: Topic: セッションの最初のユーザーメッセージ
line1="$model [$bar] ${pct}%"

if [ "$lines_add" -gt 0 ] || [ "$lines_del" -gt 0 ]; then
  line1="$line1 | +${lines_add}/-${lines_del}"
fi

if [ -n "$topic" ]; then
  echo "Topic: $topic"
fi

echo "$line1"
