# @tktco/create-devenv

開発環境テンプレートをインタラクティブにセットアップする CLI ツール。

## 機能

- DevContainer 設定（VS Code 拡張、mise、Docker-in-Docker）
- GitHub Actions（issue-link、labeler ワークフロー）
- MCP サーバー設定（Context7、Playwright、Chrome DevTools）
- mise 設定（Node.js、uv、Claude Code など）
- Claude IDE 設定

## インストール

```bash
npx @tktco/create-devenv
```

または、プロジェクトディレクトリを指定：

```bash
npx @tktco/create-devenv ./my-project
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

## リリース

[Changesets](https://github.com/changesets/changesets) を使用した自動リリースフローです。

### 手順

```bash
cd packages/create-devenv

# 1. changeset 作成（対話式で patch/minor/major を選択）
npm run changeset

# 2. コミット & プッシュ
git add . && git commit -m "chore: add changeset" && git push
```

これで CI が自動的に：
1. バージョン更新 & CHANGELOG 生成 → コミット
2. npm publish（OIDC Trusted Publishing）

を実行します。

### バージョニング

- `patch`: バグ修正（0.1.0 → 0.1.1）
- `minor`: 機能追加（0.1.0 → 0.2.0）
- `major`: 破壊的変更（0.1.0 → 1.0.0）

## ライセンス

MIT
