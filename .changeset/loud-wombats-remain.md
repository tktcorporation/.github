---
"@tktco/create-devenv": patch
---

fix(create-devenv): fix stdin conflict between @inquirer/prompts and interactive diff viewer

- Clear existing keypress listeners before setting up interactive viewer to prevent conflicts with @inquirer/prompts
- Call stdin.resume() to ensure stdin is in correct state after @inquirer/prompts usage
- Properly restore stdin state in cleanup for subsequent prompts
