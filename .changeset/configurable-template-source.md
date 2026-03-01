---
"@tktco/berm": minor
---

feat: add --from flag to init command for configurable template source

`berm init --from owner/repo` でテンプレートソースを指定可能に。
未指定時は git remote origin からオーナーを自動検出し `{owner}/.github` を使用。
検出できない場合はデフォルトの `tktcorporation/.github` にフォールバック。
