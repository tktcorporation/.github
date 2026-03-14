---
"ziku": patch
---

fix: push のファイル選定を classifyFiles 駆動に統一し、テンプレート変更のリバートを構造的に防止

- push のデータフローを pull と統一: classifyFiles の結果を一次情報として pushable files を決定
- localOnly + conflicts のみを push 対象とし、autoUpdate/newFiles/deletedFiles を構造的に除外
- detectDiff はコンテンツ提供と表示目的のみに限定
- baseHashes がない場合でも空 {} で classifyFiles を実行し、全差異を conflicts として扱う
