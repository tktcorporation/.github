# Worktree / 並列作業ルール

複数の Claude / 人間プロセスが同一リポジトリで並列作業する状況での競合防止と、worktree の運用手順。

## 最重要: 他プロセスの変更を絶対に消さない

他の Claude プロセスや人間が行った変更を、自分の判断で削除・リバート・上書きしてはならない。自分が書いていない差分は別プロセスの作業。

## セッション開始時のチェック

1. `git status` で未コミットの変更を確認
2. 自分のタスクと無関係な変更が存在 → worktree を切って作業開始
3. 判断がつかない → worktree を切る（安全側に倒す）

## 作成場所（CRITICAL — hook で強制）

**Worktree は必ず、作業対象の git リポジトリの `.claude/worktrees/` 配下に作成すること。**

### 推奨: `EnterWorktree` ツールを使う

```
EnterWorktree(name: "タスク名")
```

- `.claude/worktrees/<タスク名>` に自動作成される
- セッション終了時に keep/remove を聞いてくれるので掃除忘れを防げる
- **ただし HEAD ベースで切るため、事前に `git fetch origin master` して origin/master 上にいることを確認する**

### 手動で作る場合

```bash
# プロジェクトルートで作業する場合
git fetch origin master
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/master

# サブモジュール内で作業する場合
cd <サブモジュールのパス>
git fetch origin master
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/master
```

```bash
# 間違い（hook でブロックされる）
git worktree add .worktrees/<タスク名> ...
git worktree add /tmp/<タスク名> ...
```

## ベースブランチ（CRITICAL）

**Worktree は必ず origin の default branch（`main` / `master`）から切ること。**

```bash
git fetch origin master
```

HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。

`EnterWorktree` は HEAD ベースで切るため、実行前に必ず以下を確認すること:

1. `git fetch origin master` でリモートを最新にする
2. 現在の HEAD が origin/master と同じであること（サブモジュールの場合は `cd` してから）

## サブモジュールでの `.gitignore`

サブモジュール内で worktree を作る場合、そのリポジトリの `.gitignore` に `.claude/worktrees/` が含まれていることを確認する。なければ追加してから worktree を作成すること。

## 競合検知時の対応

自分が触っていないファイルに変更が入っている / lint・test 結果が説明できない形で変わった場合:

1. 自分の変更を `git stash push <ファイル>` で退避
2. worktree を作成
3. 退避した変更を適用して作業再開
4. ユーザーに報告

## 後始末

PR マージ後 or 不要になったら速やかに削除する:

```bash
git worktree remove .claude/worktrees/<タスク名>
```

`EnterWorktree` で作った場合は `ExitWorktree` で削除できる。

## 禁止事項

- 他プロセスの変更の削除・リバート・「修正」「整理」
- `git checkout -- .` / `git restore .` / `git reset --hard` / `git clean -f` での全変更巻き戻し
- 競合を無視した上書き
