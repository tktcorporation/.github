# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

pnpm workspaces を使用したモノレポ構成のプロジェクトです。

## 開発ワークフロー

### 変更を加える際のルール

- **機能追加・バグ修正時は必ず `pnpm changeset add` を実行してください**
  - changeset はリリースノートとバージョン管理に使用されます
  - patch / minor / major を適切に選択してください

### コマンド

```bash
# 依存関係のインストール
pnpm install

# ビルド
pnpm build

# changeset の追加
pnpm changeset add
```
