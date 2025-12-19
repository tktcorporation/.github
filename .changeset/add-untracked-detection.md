---
"@tktco/create-devenv": minor
---

push コマンドにホワイトリスト外ファイル検知機能を追加

- push 時にホワイトリスト（patterns）に含まれていないファイルを検出
- モジュールごとにグループ化して選択UI を表示
- 選択したファイルを `.devenv.json` の `customPatterns` に自動追加
- gitignore されているファイルは自動で除外
