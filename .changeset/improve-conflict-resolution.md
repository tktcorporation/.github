---
"@tktco/berm": minor
---

pull コンフリクト解決を大幅改善

- JSON/JSONC ファイルの構造マージ: キーレベルで deep merge し、ファイルを壊すコンフリクトマーカーの代わりに有効な JSON を出力。コンフリクトがあるキーはローカル値を保持しつつ、どのキーを確認すべきかを明示
- テキストマージの精度向上: fuzz factor によるパッチ適用リトライと、ファイル全体ではなく hunk 単位のコンフリクトマーカーで影響範囲を最小化
- .mcp.json, .claude/settings.json, .devcontainer/devcontainer.json 等の構造ファイルが pull 時に壊れなくなる
