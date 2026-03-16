#!/bin/bash
# Hook: セッション開始時に jj がインストールされていることを確認する
# SessionStart hook

set -euo pipefail

# 1. PATH に jj があればOK
if command -v jj &>/dev/null; then
  exit 0
fi

# 1.5. $HOME/bin/jj が既にダウンロード済みなら PATH に追加して終了
# SessionStart hook は毎回新しいシェルで実行されるため、前回のインストールで
# PATH に追加した設定が引き継がれない。ここで既存バイナリを検出して再ダウンロードを防ぐ。
if [ -x "${HOME}/bin/jj" ]; then
  echo "jj $(${HOME}/bin/jj version 2>/dev/null || echo '(version unknown)') を ${HOME}/bin で検出しました"
  exit 0
fi

# 1.9. インストール失敗のクールダウン機構
# 前回のインストール試行が失敗していた場合、一定期間（24時間）はスキップする。
# ネットワーク不通・非対応プラットフォーム等で毎セッション失敗し続けるのを防ぐ。
SKIP_MARKER="${HOME}/.jj-install-skip"
COOLDOWN_SECONDS=86400  # 24時間

if [ -f "$SKIP_MARKER" ]; then
  marker_age=$(( $(date +%s) - $(date -r "$SKIP_MARKER" +%s 2>/dev/null || stat -c %Y "$SKIP_MARKER" 2>/dev/null || echo 0) ))
  if [ "$marker_age" -lt "$COOLDOWN_SECONDS" ]; then
    echo "jj のインストールは前回失敗しました（$(( marker_age / 60 ))分前）。24時間後に再試行します。"
    echo "今すぐ再試行するには: rm $SKIP_MARKER"
    exit 0
  else
    # クールダウン期間を過ぎたのでマーカーを削除して再試行
    rm -f "$SKIP_MARKER"
  fi
fi

# インストール失敗時にマーカーファイルを作成するヘルパー関数
mark_install_failed() {
  local reason="${1:-unknown}"
  echo "$reason" > "$SKIP_MARKER"
}

# 2. mise 経由でインストールを試みる
if command -v mise &>/dev/null; then
  echo "jj が見つかりません。mise 経由でインストールします..."
  if mise install jj 2>/dev/null; then
    eval "$(mise activate bash 2>/dev/null)" || true
    if command -v jj &>/dev/null; then
      echo "jj $(jj --version) をインストールしました"
      exit 0
    fi
  fi
fi

# 3. GitHub リリースからダウンロード
echo "mise でのインストールに失敗しました。GitHub から直接ダウンロードします..."

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "${OS}-${ARCH}" in
  linux-x86_64)  TARGET="x86_64-unknown-linux-musl" ;;
  linux-aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
  darwin-arm64)  TARGET="aarch64-apple-darwin" ;;
  *)
    echo "警告: サポートされていないプラットフォーム (${OS}-${ARCH})"
    echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
    mark_install_failed "unsupported-platform: ${OS}-${ARCH}"
    exit 0
    ;;
esac

# GitHub API → リダイレクト先 URL → python3 の順でバージョン取得を試みる
LATEST_TAG=$(
  curl -fsSL "https://api.github.com/repos/jj-vcs/jj/releases/latest" 2>/dev/null \
    | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
) || true

# API がレート制限等で失敗した場合、リダイレクト先 URL からタグを取得
if [ -z "$LATEST_TAG" ]; then
  LATEST_TAG=$(
    curl -fsSIo /dev/null -w '%{redirect_url}' "https://github.com/jj-vcs/jj/releases/latest" 2>/dev/null \
      | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+'
  ) || true
fi

if [ -z "$LATEST_TAG" ]; then
  echo "警告: 最新バージョンの取得に失敗しました"
  echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
  mark_install_failed "version-fetch-failed"
  exit 0
fi

DOWNLOAD_URL="https://github.com/jj-vcs/jj/releases/download/${LATEST_TAG}/jj-${LATEST_TAG}-${TARGET}.tar.gz"
INSTALL_DIR="${HOME}/bin"

mkdir -p "$INSTALL_DIR"

# アーカイブ内のパスが ./jj のため、--strip-components=1 で展開し jj だけ残す
TMPDIR=$(mktemp -d)
if curl -fsSL "$DOWNLOAD_URL" | tar xz -C "$TMPDIR" --strip-components=1 2>/dev/null && [ -f "$TMPDIR/jj" ]; then
  mv "$TMPDIR/jj" "${INSTALL_DIR}/jj"
  chmod +x "${INSTALL_DIR}/jj"
  rm -rf "$TMPDIR"
  export PATH="${INSTALL_DIR}:${PATH}"
  echo "jj ${LATEST_TAG} を ${INSTALL_DIR} にインストールしました"
else
  rm -rf "$TMPDIR"
  echo "警告: jj のダウンロードに失敗しました"
  echo "手動でインストールしてください: https://jj-vcs.github.io/jj/latest/install-and-setup/"
  mark_install_failed "download-failed: ${DOWNLOAD_URL}"
fi

exit 0
