---
"@tktco/berm": minor
---

Improve push UX and add 3-way merge for conflict resolution

- PR title and body are now auto-generated from changed files (no prompt by default)
- Use `--edit` to interactively edit title/body, or `-m` to set title directly
- File selection is skipped by default (all files included). Use `--select` to pick files
- Summary is displayed before PR creation with a single confirmation prompt
- init/pull now store `baseRef` (commit SHA) in `.devenv.json` for 3-way merge
- push/pull conflicts are resolved via 3-way merge using `baseRef` to re-download the base template
- Auto-merge succeeds silently; unresolvable conflicts prompt the user for confirmation
