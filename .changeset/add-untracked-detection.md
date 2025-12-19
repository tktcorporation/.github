---
"@tktco/create-devenv": minor
---

push コマンドにホワイトリスト外ファイル検知機能を追加し、モジュール定義を外部化

### ホワイトリスト外ファイル検知
- push 時にホワイトリスト（patterns）に含まれていないファイルを検出
- モジュールごとにグループ化して選択UI を表示
- 選択したファイルを modules.jsonc に自動追加（PR に含まれる）
- gitignore されているファイルは自動で除外

### モジュール定義の外部化
- モジュール定義をコードから `.devenv/modules.jsonc` に外部化
- テンプレートリポジトリの modules.jsonc から動的に読み込み
- `customPatterns` を廃止し modules.jsonc に統合

### ディレクトリベースのモジュール設計
- モジュール ID をディレクトリパスベースに変更（例: `.devcontainer`, `.github`, `.`）
- ファイルパスから即座にモジュール ID を導出可能に
- モジュール間のファイル重複を構造的に防止
