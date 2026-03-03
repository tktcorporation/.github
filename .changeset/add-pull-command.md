---
"@tktco/berm": minor
---

feat(berm): add `berm pull` command with 3-way merge engine

テンプレートの最新変更をローカルに取り込む `berm pull` コマンドを追加。
3-way マージエンジンにより、ローカルの変更を保持しつつテンプレート更新を適用する。
コンフリクト時はマーカーを挿入し、ユーザーが手動解決できる。

- 新規: `berm pull` コマンド
- 新規: 3-way マージエンジン (`utils/merge.ts`)
- 新規: ファイルハッシュユーティリティ (`utils/hash.ts`)
- 改善: `berm init` が baseHashes を `.devenv.json` に記録
- 改善: `berm push` がテンプレート側の変更を検出し pull を促す
- 改善: DevEnvConfig スキーマに `baseRef` / `baseHashes` を追加
