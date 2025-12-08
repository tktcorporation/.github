---
"@tktco/create-devenv": patch
---

fix: overwriteStrategy オプションが正しく機能するように修正

- "prompt" 戦略: ファイルごとにユーザーに上書き確認を表示
- "skip" 戦略: 既存ファイルをスキップして新規ファイルのみコピー
- "overwrite" 戦略: 既存ファイルを全て上書き

また、Vitest によるテスト環境を追加
