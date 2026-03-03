---
"@tktco/berm": minor
---

Improve push command UX: auto-generate PR title/body by default, skip file selection prompt, and warn instead of error on upstream conflicts

- PR title and body are now auto-generated from changed files (no prompt by default)
- Use `--edit` to interactively edit title/body, or `-m` to set title directly
- File selection is skipped by default (all files included). Use `--select` to pick files
- Upstream conflicts now show a warning with confirmation instead of blocking with an error
- Summary is displayed before PR creation with a single confirmation prompt
