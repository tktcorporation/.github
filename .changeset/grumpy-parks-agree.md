---
"@tktco/create-devenv": patch
---

ツールチェーンを oxc エコシステムに移行

- Biome → oxlint + oxfmt に移行
- tsc --noEmit → oxlint --type-check に移行
- unbuild → tsdown に移行
