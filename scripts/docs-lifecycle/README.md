# docs-lifecycle

ドキュメントの鮮度、リンク切れ、削除済みドキュメントへの参照を検査する。
実装・依存宣言・lockfile・テストをこのディレクトリにまとめ、同期先リポジトリの
JavaScript パッケージ構成に依存せず実行できるようにしている。

```bash
# 検査
bun scripts/docs-lifecycle/run.ts

# 違反していないドキュメントも表示
bun scripts/docs-lifecycle/run.ts --list

# テスト
bun scripts/docs-lifecycle/run.ts test
```

`run.ts` は本体やテストの起動前に `bun install --frozen-lockfile` を実行する。初回実行時は
npm registry への接続が必要だが、依存はこのディレクトリの `node_modules` だけに置かれ、
リポジトリルートのパッケージ構成には追加されない。Bun のグローバルキャッシュがあれば、
2 回目以降の同期にネットワークは要らない。

依存を更新するときはこのディレクトリで `bun install --lockfile-only` を実行し、
`package.json` と `bun.lock` を同じ変更に含める。
