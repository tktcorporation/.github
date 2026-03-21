---
"ziku": patch
---

fix: 構造マージが検出した conflict を fuzz がサイレントに auto-merge する問題を修正

JSON/TOML/YAML の構造マージがキーレベルで conflict を検出した場合、
テキストマージの fuzz factor をスキップするようにした。

これにより、配列の異なる要素追加や同じキーの異なる値変更など
構造レベルの conflict が検出された場合、必ずコンフリクトマーカーが
生成されるようになる。
