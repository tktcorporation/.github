#!/usr/bin/env bash
set -euo pipefail

#
# npm パッケージ名の利用可否を検証するスクリプト
#
# 使い方:
#   ./scripts/check-npm-name.sh <name> [<name2> ...]
#
# 例:
#   ./scripts/check-npm-name.sh tugu tane kumu musu
#
# チェック内容:
#   1. npm registry に既に存在するか
#   2. npm publish の similar name check を通るか（実際にPUTして403を見る）
#
# ⚠️ 注意:
#   - similar name check は実際の npm publish (無効OTP) で検証するため、
#     npm にログイン済みである必要があります
#   - 大量に実行すると OTP レートリミット (E429) に当たる場合があります
#

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <name> [<name2> ...]"
  echo "Example: $0 tugu tane kumu"
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

for name in "$@"; do
  echo -n "$name: "

  # Step 1: 存在チェック
  if ! npm view "$name" version 2>&1 | grep -q "E404"; then
    version=$(npm view "$name" version 2>/dev/null || echo "?")
    echo "❌ TAKEN (v${version})"
    continue
  fi

  # Step 2: similar name check（無効OTPで publish を試みる）
  cat > package.json << EOF
{
  "name": "$name",
  "version": "0.0.1",
  "description": "npm name availability check"
}
EOF

  result=$(npm publish --access public --provenance=false --otp=000000 2>&1)

  if echo "$result" | grep -q "too similar"; then
    similar=$(echo "$result" | grep -oP 'too similar to existing packages \K[^;]+' || echo "unknown")
    echo "❌ SIMILAR ($similar)"
  elif echo "$result" | grep -q "EOTP\|one-time"; then
    echo "✅ AVAILABLE"
  elif echo "$result" | grep -q "E429"; then
    echo "⏳ RATE LIMITED (retry later)"
  elif echo "$result" | grep -q "ENEEDAUTH\|not logged"; then
    echo "⚠️  NOT LOGGED IN (run 'npm login' first)"
    exit 1
  elif echo "$result" | grep -q "E403"; then
    echo "❌ FORBIDDEN (unknown reason)"
  else
    echo "❓ UNKNOWN ($(echo "$result" | grep 'npm error' | head -1))"
  fi
done
