---
"@tktco/create-devenv": patch
---

テストを大幅に拡充

- config.ts: 設定ファイルの読み書きテスト
- patterns.ts: パターンマッチングとマージのテスト
- modules/schemas.ts: Zod スキーマバリデーションテスト
- modules/loader.ts: modules.jsonc ローダーテスト
- modules/index.ts: モジュールヘルパー関数テスト
- untracked.ts: 未追跡ファイル検出テスト
- readme.ts: README 生成テスト
- diff-viewer.ts: 差分表示テスト
- github.ts: GitHub API 連携テスト

テスト数: 40 → 209 (+169 テスト)
