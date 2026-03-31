# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

GitHub organization レベルのリポジトリ（tktcorporation/.github）です。
組織共通の設定ファイルや GitHub Actions ワークフロー、`@tktco/ziku` CLI ラッパーを管理しています。

**注意**: ziku 本体パッケージは [tktcorporation/ziku](https://github.com/tktcorporation/ziku) に移管済みです。

## 開発ワークフロー

### 変更を加える際のルール

- **`packages/ziku-cli/` を変更した場合は changeset ファイルを作成してください**
  - changeset はリリースノートとバージョン管理に使用されます
  - patch / minor / major を適切に選択してください

### コマンド

```bash
# 依存関係のインストール
pnpm install

# changeset の追加
pnpm changeset add
```
