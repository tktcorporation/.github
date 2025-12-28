---
"@tktco/create-devenv": minor
---

feat(push): add merge mode for chunk-level selection

Added `--merge` (`-M`) flag to the push command that enables chunk-level (hunk) selection instead of whole-file selection.

**Features:**
- Select individual diff chunks to include in the PR
- View each chunk in detail before selecting
- Modified files can be partially merged (only selected chunks applied to template)
- Added files are still selected at file level

**Usage:**
```bash
npx @tktco/create-devenv push --merge
# or
npx @tktco/create-devenv push -M
```

This allows more granular control over what changes are pushed back to the template repository.
