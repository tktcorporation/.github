---
"@tktco/create-devenv": minor
---

feat: add `track` command for non-interactive file tracking management

AIエージェントが非インタラクティブにファイルパターンを `.devenv/modules.jsonc` のホワイトリストに追加できる `track` コマンドを追加。

- `npx @tktco/create-devenv track ".cloud/rules/*.md"` でパターン追加（モジュール自動検出）
- `--module` オプションで明示的にモジュール指定可能
- 存在しないモジュールは自動作成（`--name`, `--description` でカスタマイズ可能）
- `--list` で現在の追跡モジュール・パターン一覧を表示
- AI agent guide にドキュメントを追加
