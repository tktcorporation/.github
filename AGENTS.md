# CLAUDE.md

AccordXワークスペース。モノレポは `repos/anti-cancel-monorepo/` にあります。

## ナビゲーション

```bash
cd repos/anti-cancel-monorepo  # メイン開発はここで行う
```

## 技術スタック概要

- **フロントエンド**: Next.js + TypeScript + React + Apollo Client
- **バックエンド**: Golang (backend/) - Ent ORM + gqlgen + PostgreSQL
- **ビルド**: Turborepo + pnpm 8.9.0

## 重要な規約

- **新規開発は anti-cancel-monorepo で行う**
- Resolverから直接DB操作禁止（usecaseのみ呼び出す）
- 認証必須エンドポイントには認証ディレクティブを使用（アプリごとの詳細は `.claude/rules/project/golang-backend.md`）
- エラーハンドリングは標準 `errors` パッケージのみ（pkg/errors禁止）

## クイックリファレンス

| タスク | コマンド |
|--------|---------|
| 依存関係インストール | `pnpm install` |
| 開発サーバー起動 | `pnpm dev` |
| Go User API起動 | `cd backend && make start-user` |
| テスト（Go） | `DB_NAME=anti_cancel_test make test` |
| コード生成 | `make generate` |

## 詳細ドキュメント

- **ローカル環境セットアップ**: `.claude/docs/local-setup.md`
- **BigQuery アクセス**: `.claude/docs/bigquery.md`
- プロジェクト固有ルール: `.claude/rules/project/` を参照
- ワークスペース構造: `.claude/docs/workspace-overview.md`
- 各リポジトリの詳細: `.claude/docs/` 配下

## PR作成
- PR作成時にはassigneeにtktcorporationを設定すること（`gh pr create --assignee tktcorporation`）
