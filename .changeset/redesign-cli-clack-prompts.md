---
"@tktco/berm": minor
---

Redesign CLI with @clack/prompts and unified error handling

- Replace @inquirer/prompts + nanospinner with @clack/prompts for consistent UI
- Introduce BermError for structured error handling with optional hints
- Add unified UI layer (renderer, prompts, diff-view modules)
- Remove old prompt and UI utility files
