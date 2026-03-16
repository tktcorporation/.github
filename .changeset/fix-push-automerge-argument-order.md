---
"ziku": patch
---

fix: push の 3-way マージで local/template 引数が逆転していたバグを修正

`ziku push` の automerge 時に `threeWayMerge` の `local` と `template` 引数が
逆に渡されていたため、ユーザーの JSONC コメントやフォーマットが失われ、
コンフリクト時にテンプレート側の値が優先される問題を修正。

上流修正として `threeWayMerge` を named parameters + Zod branded types に変更し、
同じ種類の取り違えをコンパイル時に検出できるようにした。

また、`check` スクリプトに `typecheck`（oxlint --type-check）を追加し、
ローカルの全チェック実行で型チェックも漏れなく実行されるようにした。
