---
"@tktco/create-devenv": patch
---

feat(init): gitignore対象ファイルの同期時の挙動を改善

- init時にgitignore対象のファイルがローカルに既存在する場合、上書きせずスキップして警告を表示
- gitignore対象のファイルがローカルに存在しない場合は、通常通りコピー
- push時はgitignore対象ファイルを追跡対象から除外（既存の動作を維持）

これにより、ローカルで編集したgitignore対象ファイル（環境設定など）がテンプレート同期時に上書きされることを防止します。
