#!/usr/bin/env bash
set -euo pipefail

#
# npm パッケージ名の利用可否をローカルで検証するスクリプト
#
# anti-typosquatting パッケージを使って npm サーバー側の
# similar name check を再現する。
#
# 使い方:
#   ./scripts/check-npm-name-local.sh <name1> [name2] ...
#
# 例:
#   ./scripts/check-npm-name-local.sh tugu tane kumu musu
#

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <name> [<name2> ...]"
  echo "Example: $0 tugu tane kumu"
  exit 1
fi

for name in "$@"; do
  echo -n "$name: "

  # Step 1: npm registry に既に存在するかチェック
  npm_output=$(npm view "$name" version 2>&1 || true)
  if ! echo "$npm_output" | grep -q "E404"; then
    version=$(echo "$npm_output" | head -1)
    echo "❌ TAKEN (v${version})"
    continue
  fi

  # Step 2: anti-typosquatting で similar name check
  # このツールは対話プロンプトを出すので、出力からtypo数を取得する
  result=$(npx -y anti-typosquatting "$name" 2>&1 </dev/null || true)

  if echo "$result" | grep -q "Found 0 possible typos\|No possible typos"; then
    echo "✅ AVAILABLE (no similar packages)"
  elif echo "$result" | grep -q "Found .* possible typos"; then
    typo_count=$(echo "$result" | grep -oP 'Found \K\d+')
    # 類似パッケージ名を抽出（インタラクティブ出力から）
    similars=$(echo "$result" | grep -oP '(?<=   )[a-z][\w.-]*' | grep -v "^${name}$" | grep -v "None" | head -5 | tr '\n' ', ' | sed 's/,$//')
    echo "❌ SIMILAR (${typo_count} conflicts: ${similars})"
  else
    echo "❓ UNKNOWN"
  fi
done
