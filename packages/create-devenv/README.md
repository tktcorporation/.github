# @tktco/create-devenv

開発環境テンプレートをインタラクティブにセットアップする CLI ツール。

<!-- FEATURES:START -->

## 機能

- **ルート設定** - MCP、mise などのルート設定ファイル
- **DevContainer** - VS Code DevContainer、Docker-in-Docker
- **GitHub** - GitHub Actions、labeler ワークフロー
- **Claude** - Claude Code のプロジェクト共通設定

<!-- FEATURES:END -->

## インストール

```bash
npx @tktco/create-devenv
```

または、プロジェクトディレクトリを指定：

```bash
npx @tktco/create-devenv ./my-project
```

<!-- COMMANDS:START -->

## コマンド

### `init`

開発環境テンプレートを適用

```
開発環境テンプレートを適用 (create-devenv vdev)

USAGE `create-devenv [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    プロジェクトディレクトリ

OPTIONS

    `--force`    既存ファイルを強制上書き
  `-y, --yes`    すべてのモジュールを自動選択（非インタラクティブモード）
```

### `push`

ローカル変更をテンプレートリポジトリに PR として送信

```
ローカル変更をテンプレートリポジトリに PR として送信 (push)

USAGE `push [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    プロジェクトディレクトリ

OPTIONS

              `-n, --dryRun`    実際の PR を作成せず、プレビューのみ表示
             `-m, --message`    PR のタイトル
               `-f, --force`    確認プロンプトをスキップ
  `--no-i, --no-interactive`    差分を確認しながらファイルを選択（デフォルト有効）
```

### `diff`

ローカルとテンプレートの差分を表示

```
ローカルとテンプレートの差分を表示 (diff)

USAGE `diff [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    プロジェクトディレクトリ

OPTIONS

  `-v, --verbose`    詳細な差分を表示
```

<!-- COMMANDS:END -->

<!-- FILES:START -->

## 生成されるファイル

選択したモジュールに応じて以下のファイルが生成されます：

### ルート

MCP、mise などのルート設定ファイル

- `.mcp.json`
- `.mise.toml`

### `.devcontainer/`

VS Code DevContainer、Docker-in-Docker

- `.devcontainer/devcontainer.json`
- `.devcontainer/.gitignore`
- `.devcontainer/setup-*.sh` (パターン)
- `.devcontainer/test-*.sh` (パターン)
- `.devcontainer/.env.devcontainer.example`
- `.devcontainer/run-chrome-devtools-mcp.sh`

### `.github/`

GitHub Actions、labeler ワークフロー

- `.github/workflows/issue-link.yml`
- `.github/workflows/label.yml`
- `.github/labeler.yml`

### `.claude/`

Claude Code のプロジェクト共通設定

- `.claude/settings.json`

### 設定ファイル

- `.devenv.json` - このツールの設定（適用したモジュール情報）

<!-- FILES:END -->

## 開発・コントリビュート

[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## ライセンス

MIT
