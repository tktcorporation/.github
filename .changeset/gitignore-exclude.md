---
"@tktco/create-devenv": minor
---

.gitignore に記載されたファイルを自動的に除外する機能を追加

- init, diff, push の全コマンドで .gitignore にマッチするファイルを除外
- ローカルディレクトリとテンプレートリポジトリ両方の .gitignore をチェック
- クレデンシャル等の機密情報の誤流出を防止
