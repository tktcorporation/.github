#!/bin/bash
# Codespaces では runArgs --env-file が無視されるため、
# .env.devcontainer の内容をシェルプロファイルに追加して
# ターミナルセッションで環境変数を利用可能にする。
#
# ローカル devcontainer では runArgs で既にロード済みだが、
# 二重設定しても害はない（同じ値が上書きされるだけ）。
#
# 動作条件:
#   - .env.devcontainer が存在し、中身がある場合のみ実行
#   - コメント行・空行はスキップ
#   - 既に設定済みの環境変数は上書きしない（remoteEnv / runArgs 優先）

set -euo pipefail

WORKSPACE_DIR="${CONTAINER_WORKSPACE_FOLDER:-/workspaces/$(basename "$PWD")}"
ENV_FILE="${WORKSPACE_DIR}/.devcontainer/.env.devcontainer"
PROFILE_SNIPPET="$HOME/.env.devcontainer.profile"

if [ ! -s "$ENV_FILE" ]; then
  echo "load-env-to-profile: .env.devcontainer is empty or missing, skipping."
  exit 0
fi

# .env ファイルから export 文を生成（既存の変数は上書きしない）
{
  echo "# Auto-generated from .env.devcontainer — do not edit"
  while IFS= read -r line || [ -n "$line" ]; do
    # コメント行・空行をスキップ
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # KEY=VALUE 形式のみ処理
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      key="${BASH_REMATCH[1]}"
      # 既に設定済みなら上書きしない（remoteEnv / Codespaces secrets 優先）
      echo "export ${key}=\"\${${key}:-${line#*=}}\""
    fi
  done < "$ENV_FILE"
} > "$PROFILE_SNIPPET"

# bashrc / zshrc に source 行を追加（重複防止）
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] && ! grep -qF "$PROFILE_SNIPPET" "$rc"; then
    echo "[ -f \"$PROFILE_SNIPPET\" ] && source \"$PROFILE_SNIPPET\"" >> "$rc"
  fi
done

echo "load-env-to-profile: loaded env vars from .env.devcontainer into shell profile."
