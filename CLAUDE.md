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
  - `npx oxfmt --check .` でフォーマットチェック（失敗したら `npx oxfmt --write .` で修正）
  - `pnpm build` でビルド確認
  - `pnpm test` でテスト通過確認

### コマンド

```bash
# 依存関係のインストール
pnpm install

# ビルド
pnpm build

# フォーマットチェック（CI と同じ）
npx oxfmt --check .

# フォーマット修正
npx oxfmt --write .

# テスト
pnpm test

# changeset の追加
pnpm changeset add
```
