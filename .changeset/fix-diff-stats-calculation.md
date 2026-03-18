---
"ziku": patch
---

fix: 差分行数の計算を unified diff ベースに修正

push サマリーの行数表示が実際の変更量と大きくズレる問題を修正。
"modified" ファイルで行数の差（local - template）を表示していたのを、
unified diff の実際の変更行数に修正。
また "added"/"deleted" で末尾改行による off-by-one エラーも修正。
