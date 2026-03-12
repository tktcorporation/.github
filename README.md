# .github

Shared dev environment templates and the CLI tool [**ziku**](./packages/ziku) that keeps them in sync.

## What's inside

| Path | Description |
|------|-------------|
| [`packages/ziku`](./packages/ziku) | CLI tool for bi-directional template sync |
| [`.devenv/`](./.devenv) | Template source files (DevContainer, GitHub Actions, Claude, etc.) |

## Quick start

```bash
# Apply templates to your project
npx ziku

# Push improvements back
npx ziku push
```

See [packages/ziku/README.md](./packages/ziku/README.md) for full documentation.
