#!/usr/bin/env bash
set -euo pipefail

#
# パッケージリネーム & publish スクリプト
#
# 使い方:
#   ./scripts/rename-and-publish.sh <新しい名前> [--otp <code>]
#
# 例:
#   ./scripts/rename-and-publish.sh tugu --otp 123456
#
# やること:
#   1. 全ファイルの現パッケージ名を新しい名前に一括置換
#   2. ディレクトリをリネーム
#   3. pnpm install で lockfile 更新
#   4. ビルド & テスト
#   5. npm publish (OTP指定時)
#

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- 引数パース ---
NEW_NAME="${1:-}"
OTP=""
DRY_RUN=false

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --otp) OTP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$NEW_NAME" ]]; then
  echo "Usage: $0 <new-name> [--otp <code>] [--dry-run]"
  exit 1
fi

# --- 現在のパッケージ名を検出 ---
CURRENT_NAME=$(node -e "console.log(require('./packages/$(ls packages | head -1)/package.json').name)" 2>/dev/null)
# packages ディレクトリからメインパッケージを特定（-cli でない方）
MAIN_PKG=$(ls packages | grep -v '\-cli$' | head -1)
CLI_PKG=$(ls packages | grep '\-cli$' | head -1 || true)
CURRENT_NAME=$(node -e "console.log(require('./packages/${MAIN_PKG}/package.json').name)")

echo "📦 Renaming: ${CURRENT_NAME} → ${NEW_NAME}"
echo "   Main package dir: packages/${MAIN_PKG} → packages/${NEW_NAME}"
[[ -n "$CLI_PKG" ]] && echo "   CLI package dir:  packages/${CLI_PKG} → packages/${NEW_NAME}-cli"
echo ""

# --- Step 1: ファイル内容の一括置換 ---
echo "🔄 Step 1: Replacing '${CURRENT_NAME}' → '${NEW_NAME}' in files..."

FILES=$(grep -rl "\b${CURRENT_NAME}\b" \
  --include='*.ts' --include='*.js' --include='*.mjs' \
  --include='*.json' --include='*.yml' --include='*.yaml' \
  --include='*.md' --include='*.toml' . \
  | grep -v node_modules \
  | grep -v pnpm-lock \
  | grep -v CHANGELOG \
  | grep -v '/dist/' \
  | grep -v '.claude/settings' \
  | sort)

SCOPED_CURRENT="@tktco/${CURRENT_NAME}"
SCOPED_NEW="@tktco/${NEW_NAME}"

for f in $FILES; do
  sed -i \
    -e "s|${SCOPED_CURRENT}|${SCOPED_NEW}|g" \
    -e "s|${CURRENT_NAME}-cli|${NEW_NAME}-cli|g" \
    -e "s|\b${CURRENT_NAME}\b|${NEW_NAME}|g" \
    "$f"
done
echo "   Replaced in $(echo "$FILES" | wc -l) files"

# --- Step 2: ディレクトリリネーム ---
echo "📁 Step 2: Renaming directories..."

if [[ -d "packages/${MAIN_PKG}" && "${MAIN_PKG}" != "${NEW_NAME}" ]]; then
  mv "packages/${MAIN_PKG}" "packages/${NEW_NAME}"
  echo "   packages/${MAIN_PKG} → packages/${NEW_NAME}"
fi

if [[ -n "$CLI_PKG" && -d "packages/${CLI_PKG}" && "${CLI_PKG}" != "${NEW_NAME}-cli" ]]; then
  mv "packages/${CLI_PKG}" "packages/${NEW_NAME}-cli"
  echo "   packages/${CLI_PKG} → packages/${NEW_NAME}-cli"
fi

# --- Step 3: pnpm install ---
echo "📥 Step 3: Running pnpm install..."
pnpm install --reporter=silent 2>&1

# --- Step 4: Build & Test ---
echo "🔨 Step 4: Building..."
pnpm --filter "${NEW_NAME}" run build 2>&1 | tail -2

echo "🧪 Step 5: Running tests..."
TEST_OUTPUT=$(pnpm --filter "${NEW_NAME}" run test:run 2>&1)
TEST_RESULT=$(echo "$TEST_OUTPUT" | grep "Tests" | tail -1)
echo "   ${TEST_RESULT}"

# --- Step 5: Publish ---
if [[ "$DRY_RUN" == "true" ]]; then
  echo "🏷️  Step 6: Dry run publish..."
  cd "packages/${NEW_NAME}"
  npm publish --access public --provenance=false --dry-run 2>&1 | grep -E "notice name:|notice version:|E403|too similar"
  cd "$REPO_ROOT"
elif [[ -n "$OTP" ]]; then
  echo "🚀 Step 6: Publishing to npm..."
  cd "packages/${NEW_NAME}"
  PUBLISH_OUTPUT=$(npm publish --access public --provenance=false --otp="$OTP" 2>&1)
  if echo "$PUBLISH_OUTPUT" | grep -q "too similar"; then
    SIMILAR=$(echo "$PUBLISH_OUTPUT" | grep -oP 'too similar to existing packages \K[^;]+')
    echo "   ❌ REJECTED: too similar to ${SIMILAR}"
    cd "$REPO_ROOT"
    exit 2
  elif echo "$PUBLISH_OUTPUT" | grep -q "E403"; then
    echo "   ❌ Publish failed (403)"
    echo "$PUBLISH_OUTPUT" | grep "E403\|403" | head -2
    cd "$REPO_ROOT"
    exit 1
  else
    echo "   ✅ Published ${NEW_NAME}@$(node -e "console.log(require('./package.json').version)")"
  fi
  cd "$REPO_ROOT"
else
  echo "⏭️  Step 6: Skipping publish (no --otp provided)"
  echo "   Run with --otp <code> to publish"
fi

echo ""
echo "✅ Done! Package is now '${NEW_NAME}'"
