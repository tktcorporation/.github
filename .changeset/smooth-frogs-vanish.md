---
"@tktco/create-devenv": patch
---

fix(devcontainer): use Docker-compliant volume name for pnpm-store

devcontainer起動時のvolume名エラーを修正。`.github` というリポジトリ名により、`${localWorkspaceFolderBasename}-pnpm-store` が `.github-pnpm-store` に展開され、Dockerの命名規則に違反していた問題を解決。`devcontainer-` プレフィックスを追加することで命名規則に準拠。
