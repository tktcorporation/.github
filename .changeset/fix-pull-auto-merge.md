---
"ziku": patch
---

fix: pull のオートマージが base ダウンロード時にテンプレートを上書きしてマージが空振りするバグを修正

downloadTemplateToTemp が常に同じ一時ディレクトリ (.devenv-temp) を使用していたため、
base バージョンのダウンロード時に先にダウンロードしたテンプレートを上書きしていた。
これにより base === template となり、パッチが空になってローカルファイルが変更されずに
「Auto-merged」と表示される問題が発生していた。

label 引数を追加し、base ダウンロード時に別ディレクトリ (.devenv-temp-base) を使用するよう修正。
合わせて merge.ts を merge/ ディレクトリに分割してリファクタリング。
