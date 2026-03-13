# Jujutsu (jj) VCS ルール

このプロジェクトでは Git の代わりに jj (Jujutsu) を使用する。

---

## 基本ルール

- `git add` は使わない（jj は変更を自動追跡する）
- `git commit` は使わない（代わりに `jj commit` を使う）
- `git status` の代わりに `jj status` を使う
- `git log` の代わりに `jj log` を使う
- `git diff` の代わりに `jj diff` を使う

## よく使うコマンド

```bash
jj status           # 現在の変更状態を確認
jj log              # コミット履歴を表示
jj diff             # 変更差分を表示
jj commit -m "msg"  # 変更をコミット
jj describe -m "msg" # 現在の変更にメッセージを設定
jj new              # 新しい空のチェンジを作成
jj bookmark create <name>  # ブックマーク（≒ブランチ）を作成
jj git push         # リモートにプッシュ
```

## Git との共存

- jj は Git リポジトリと colocated モードで動作している
- `.jj/` ディレクトリは `.gitignore` に含めないこと（jj が管理する）
- `jj git push` で GitHub にプッシュできる

---

## 並列作業ルール（CRITICAL）

**複数の AI エージェントが同じリポジトリで同時に作業する場合がある。**
ワーキングコピーは 1 つしかないため、同じディレクトリで複数エージェントが作業すると互いの変更を上書き・revert してしまう。

### 作業開始前の確認（必須）

作業を始める前に、他のエージェントが作業中でないか確認する。

```bash
# 1. ワーキングコピーに未コミットの変更がないか確認
jj status

# 2. 他の workspace が存在するか確認
jj workspace list
```

**`jj status` で自分が行っていない変更が見つかった場合**:

- 他のエージェントが作業中の可能性が高い
- その変更を revert・restore してはならない
- 必ず `jj workspace add` で別 workspace を作成して作業する

### workspace の使い方

他の作業が進行中、または並列作業が発生する可能性がある場合は workspace を分離する。

```bash
# 別 workspace を作成（main の先頭から分岐）
# パスは「リポジトリの親ディレクトリ/リポジトリ名-ws-作業名」
jj workspace add ../$(basename "$PWD")-ws-<作業名> -r main

# 作成した workspace に移動して作業
cd ../$(basename "$(jj workspace root)")-ws-<作業名>

# 作業完了後、bookmark を作成してプッシュ
jj commit -m "feat: ..."
jj bookmark create feat/xxx -r @-
jj git push --bookmark feat/xxx --allow-new

# 作業完了後に workspace を削除（元のリポジトリから実行）
cd "$(jj workspace root)"
jj workspace forget <workspace名>
rm -rf ../<リポジトリ名>-ws-<作業名>
```

### 判断フロー

```
作業開始
  ↓
jj status で未知の変更がある？
  → Yes: workspace を分離して作業
  → No: ↓
jj workspace list で他の workspace がある？
  → Yes: 他エージェントが並列作業中。workspace を分離して作業
  → No: ↓
そのまま作業してよい（ただし他エージェントが途中参入する可能性を意識する）
```

### 禁止事項

| 操作                                                     | 理由                        |
| -------------------------------------------------------- | --------------------------- |
| 他エージェントの変更を `jj restore` で巻き戻す           | 他者の作業が消失する        |
| 身に覚えのない変更を無断でコミット・squash する          | 他者の作業途中の変更を壊す  |
| 他エージェントの workspace を `jj workspace forget` する | 作業中の workspace が壊れる |

### workspace 命名規則

```
../<リポジトリ名>-ws-<作業名>
```

例: `../my-project-ws-fix-photo-sort`, `../my-project-ws-add-settings`

---

## 関連ドキュメント

- `docs/jujutsu-workflow.md` - 詳細なワークフローガイド
- `CLAUDE.md` - ブックマーク命名規則、PR 作成手順
