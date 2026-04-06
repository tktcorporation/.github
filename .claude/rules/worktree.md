# Worktree ルール

## ベースブランチ（CRITICAL）

**Worktree は必ず `main`（または `master`）から切ること。**

```bash
# worktree 作成前に main を最新にする
git fetch origin master
```

HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。

## 手順

1. `EnterWorktree` で worktree を作成する前に、対象リポジトリの main ブランチ最新から切る
2. worktree 内で `npm i` 等の依存インストールを実行してからビルド・テストする
3. PR 作成時は `origin/master` との差分が自分のコミットだけであることを確認する
