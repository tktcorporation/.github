# @tktco/create-devenv

開発環境テンプレートをインタラクティブにセットアップする CLI ツール。

## 機能

- DevContainer 設定（VS Code 拡張、mise、Docker-in-Docker）
- GitHub Actions（issue-link、labeler ワークフロー）
- MCP サーバー設定（Context7、Playwright、Chrome DevTools）
- mise 設定（Node.js、uv、Claude Code など）
- Claude IDE 設定

## インストール

GitHub Packages からのインストールには認証が必要です。

### 1. .npmrc を設定

```bash
# ~/.npmrc に追加
echo "@tktco:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc
```

`YOUR_GITHUB_PAT` は `read:packages` スコープを持つ GitHub Personal Access Token に置き換えてください。

### 2. 実行

```bash
npx @tktco/create-devenv init
```

または、プロジェクトディレクトリを指定：

```bash
npx @tktco/create-devenv init ./my-project
```

## GitHub Actions での使用

```yaml
- uses: actions/setup-node@v4
  with:
    registry-url: "https://npm.pkg.github.com"
    scope: "@tktco"

- run: npx @tktco/create-devenv init
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## CLI オプション

```
Usage: create-devenv init [dir] [options]

開発環境テンプレートを適用

Arguments:
  dir           プロジェクトディレクトリ (default: ".")

Options:
  --force       既存ファイルを強制上書き
  -h, --help    ヘルプを表示
```

## 生成されるファイル

選択したモジュールに応じて以下のファイルが生成されます：

- `.devcontainer/` - DevContainer 設定
- `.github/` - GitHub Actions ワークフロー
- `.mcp.json` - MCP サーバー設定
- `.mise.toml` - mise ツール設定
- `.claude/` - Claude IDE 設定
- `.devenv.json` - このツールの設定（適用したモジュール情報）

## 開発

```bash
cd packages/create-devenv

# 依存関係のインストール
npm install

# 開発モード（stub）
npm run dev

# ビルド
npm run build
```

## ライセンス

MIT
