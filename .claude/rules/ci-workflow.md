# CI / PR ワークフロー

## プッシュ前の必須手順

1. `.github/workflows/` の全ワークフローを読み、`push`/`pull_request` トリガーの `run:` コマンドをリストアップ
2. ローカル実行可能なコマンドを全て実行（lint, test, knip, build 等）
3. **全 pass を確認してからプッシュ**

**スキップ可**: CI固有シークレット必要なコマンド、GitHub API操作、E2Eテスト（明示指示時以外）、Docker環境依存

## PR 作成後の CI 監視

1. `gh pr checks <PR番号> --watch` で全チェック pass まで監視
2. fail → `gh run view <run-id> --log-failed` でログ確認 → 修正 → 再push → 再監視
3. **全チェック pass まで「完了」と報告しない**

## Changeset

詳細ポリシーは [`changeset-policy.md`](./changeset-policy.md)。要点:

- runtime artifact (Rust binary / Workers / Web UI) の挙動が変わる PR では **bump 付き**の changeset を必ず作る (`fixed` 3 package を同 level で列挙)
- CI / docs / dev tooling だけの変更は空 frontmatter
- Rust-only 変更でも binary 挙動が変わるなら JS package を bump する。`sync-cargo-version.mjs` の連鎖が止まると Rust binary が release されない

## 禁止事項

- CI チェックを通さずにプッシュ
- lint エラーを disable コメントで安易に抑制
- テスト失敗を無視してプッシュ
- 「たぶん大丈夫」でプッシュ（実行して確認すること）
