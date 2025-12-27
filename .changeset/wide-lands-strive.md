---
"@tktco/create-devenv": minor
---

Improve CLI output with modern, user-friendly design

- Add step-by-step progress indicators (e.g., [1/3], [2/3])
- Add spinners for async operations (template download, diff detection)
- Improve file operation results display with colored icons
- Add summary section showing added/updated/skipped counts
- Add "Next steps" guidance after successful operations
- Add colored diff output with visual summary
- Use consistent styling across all commands (init, push, diff)
- Replace consola with picocolors + nanospinner for better UX
