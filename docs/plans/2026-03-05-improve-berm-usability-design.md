# berm usability 改善 設計ドキュメント

**作成日:** 2026-03-05

## 概要

berm CLI の 4 つの使い勝手の問題を修正する。いずれも既存の実装と定義が噛み合っていないケース、またはフラグ名の一貫性問題。

---

## Fix 1: `diff --verbose` の実装

### 問題

`diff.ts` に `--verbose` (`-v`) フラグが定義されているが、`run()` 内で `args.verbose` を参照するコードがゼロ。フラグを渡しても動作が変わらない。

### 修正

`hasDiff(diff)` が true のとき、`--verbose` が指定されていれば各ファイルに対して `renderFileDiff()` を呼び出す。`renderFileDiff()` は `src/ui/diff-view.ts` に実装済みのため、インポートを追加するだけ。

```
--verbose なし: ファイル名 + 変更種別 + サマリー（既存通り）
--verbose あり: 上記 + 各ファイルのunified diff（word diff付き）
```

### 変更ファイル

- `packages/berm/src/commands/diff.ts` — `renderFileDiff` インポート追加、`args.verbose` 分岐追加

---

## Fix 2: `pull` の削除ファイル選択

### 問題

`classification.deletedFiles` があっても `log.warn` するだけで、実際には何も削除しない。ユーザーが手動で削除する必要がある。`prompts.ts` に `selectDeletedFiles()` が実装済みだが未使用。

`--force` があっても自動削除しない（警告を出さなくなるだけ）という動作も直感に反する。

### 修正

- `--force` 時 → 全削除を自動実行
- 通常時 → `selectDeletedFiles()` で削除するファイルを選択させてから削除

削除は `rm` を使い、エラー時は `log.warn` でスキップ。

### 変更ファイル

- `packages/berm/src/commands/pull.ts` — Step 9 の削除処理を実装

---

## Fix 3: `track --list` の `required: true` 問題

### 問題

`patterns` positional 引数が `required: true` になっているため、citty のバリデーションが `run()` より先に走る実装の場合 `berm track --list` がエラーになりうる。現在は `process.argv` を手動パースして回避しているが、壊れやすい。

### 修正

- `patterns` を `required: false` に変更
- パターンなし且つ `--list` なしの場合のエラーは `run()` 内部の既存チェック（`patterns.length === 0` で `BermError`）がカバーするので動作は変わらない

### 変更ファイル

- `packages/berm/src/commands/track.ts` — `required: true` → `required: false`

---

## Fix 4: `push --force` → `--yes` へのリネーム

### 問題

- `push --force`: 確認プロンプトをスキップする意味で使われている
- `init --force`: 既存ファイルを上書きする意味で使われている

同じフラグ名で異なるセマンティクス。`push` においては `--yes` (`-y`) の方が意図が明確。

### 修正

- `push` の `--force` を `--yes` (alias: `-y`) に変更
- 後方互換のため `--force` も alias として追加（警告なし）

### 変更ファイル

- `packages/berm/src/commands/push.ts` — フラグ定義変更、`args.force` → `args.yes` への参照変更

---

## テスト方針

各修正に対応するテストを更新・追加する：

| 修正 | テストファイル | 内容 |
|------|-------------|------|
| Fix 1 | `diff.test.ts` | `--verbose` 時に `renderFileDiff` が呼ばれることを確認 |
| Fix 2 | `pull.test.ts` | `--force` 時の自動削除、通常時の `selectDeletedFiles` 呼び出し確認 |
| Fix 3 | `track.test.ts` | `--list` 単独での動作確認（パターンなし） |
| Fix 4 | `push.test.ts` | `--yes` フラグが `--force` と同等に動作することを確認 |

## changeset

- Package: `@tktco/berm`
- Bump: `patch`
- Summary: "Fix diff --verbose, pull delete files, track --list, push --yes flag"
