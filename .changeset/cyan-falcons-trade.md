---
"@tktco/create-devenv": minor
---

双方向同期機能とホワイトリスト形式を追加

### 新機能
- `push` コマンド: ローカル変更を GitHub PR として自動送信
- `diff` コマンド: ローカルとテンプレートの差分をプレビュー

### 破壊的変更
- モジュール定義を `files` + `excludeFiles` 形式から `patterns` (glob) 形式に移行
- テンプレート対象ファイルをホワイトリスト形式で明示的に指定するように変更

### 使用例
```bash
# 差分を確認
npx @tktco/create-devenv diff

# ローカル変更を PR として送信
npx @tktco/create-devenv push --message "feat: DevContainer設定を更新"

# ドライラン
npx @tktco/create-devenv push --dry-run
```
