# PR ワークフロールール

## PR 作成後の CI ウォッチ

PR を作成した後は、必ず CI が完了するまでウォッチする。

```bash
gh pr checks <PR番号> --watch
```

- CI が全て pass したらユーザーに報告する
- fail したチェックがあれば、ログを確認して修正を試みる
  ```bash
  gh run view <run-id> --log-failed
  ```
- 修正後は再度 push して CI を再ウォッチする
