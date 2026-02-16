---
"@tktco/create-devenv": patch
---

init コマンドでテンプレートの .devenv/modules.jsonc をターゲットプロジェクトにコピーするように修正。これにより init → track のワークフローが正しく動作するようになります。
