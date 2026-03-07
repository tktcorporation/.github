# Jujutsu (jj) VCS ルール

このプロジェクトでは Git の代わりに jj (Jujutsu) を使用する。

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
jj git push --select # リモートにプッシュ（プッシュ対象を選択）
```

## Push ルール

- **`jj git push` は必ず `--select` オプションを付けること**
  - 意図しないブックマークのプッシュを防ぐため、プッシュ対象を明示的に選択する
  - 例: `jj git push --select <bookmark-name>`
  - interactive でも AI 操作でも同様
  - PreToolUse フック (`prefer-jj.sh`) で `--select` なしの push はブロックされる

### interactive ユーザー向けの設定

`~/.config/jj/config.toml` に以下を追加すると、`jj push` で `--select` 付きの push が実行できる:

```toml
[aliases]
push = ["git", "push", "--select"]
```

## Git との共存

- jj は Git リポジトリと colocated モードで動作している
- `.jj/` ディレクトリは `.gitignore` に含めないこと（jj が管理する）
- `jj git push` で GitHub にプッシュできる
