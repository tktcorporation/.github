# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

pnpm workspaces を使用したモノレポ構成のプロジェクトです。

## 開発ワークフロー

### 変更を加える際のルール

- **機能追加・バグ修正時は必ず `pnpm changeset add` を実行してください**
  - changeset はリリースノートとバージョン管理に使用されます
  - patch / minor / major を適切に選択してください

### PR を作成する前に

- **CI チェックをローカルで通してからプッシュ・PR作成してください**
  - `pnpm --filter berm run check` で CI 相当の全チェックを一括実行
  - フォーマット・lint・ビルド・テスト・README整合性チェックを含みます
  - フォーマットが失敗したら `npx oxfmt --write .` で修正
  - README が古い場合は `pnpm --filter berm run docs` で再生成
- **コマンド定義（args）を変更した場合は `pnpm --filter berm run docs` を実行**
  - push/init/diff 等のコマンド引数を変更すると README の Commands セクションが古くなる
  - `docs:check` が CI で落ちるので、プッシュ前に再生成すること

### コマンド

```bash
# 依存関係のインストール
pnpm install

# CI 相当の全チェック一括実行（プッシュ前に必ず実行）
pnpm --filter berm run check

# 個別コマンド
pnpm --filter berm run build          # ビルド
pnpm --filter berm run test:run       # テスト
pnpm --filter berm run format:check   # フォーマットチェック
pnpm --filter berm run docs:check     # README 整合性チェック

# 修正用
npx oxfmt --write .                          # フォーマット修正
pnpm --filter berm run docs           # README 再生成

# changeset の追加
pnpm changeset add
```
