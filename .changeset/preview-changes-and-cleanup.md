---
"@tktco/berm": minor
---

push: 確認前に差分プレビューを表示 & Ctrl+C 時の一時ディレクトリクリーンアップ

- Push summary の後、"Create PR?" の前にファイルごとの unified diff を表示するようにした。変更内容を確認してから判断できる。
- Ctrl+C (process.exit) で終了した場合に .devenv-temp が残る問題を修正。process.on('exit') で同期クリーンアップを登録。
