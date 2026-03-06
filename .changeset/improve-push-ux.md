---
"@tktco/berm": patch
---

Improve `berm push` UX to feel more like `git push`

- Show git-style "To owner/repo → branch" header with file stats (`+N -M`) in push summary
- Highlight commit hash (baseRef) in conflict warnings so users know exactly which version conflicts with
- Post-push success output now shows branch name and PR number in git-push format
- `--select` mode shows line-count hints (`+N -M`) alongside each file in the multiselect
- Unresolved conflict messages now include a clear hint to run `berm pull`
