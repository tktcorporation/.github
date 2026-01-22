---
"@tktco/create-devenv": minor
---

feat(create-devenv): add ai-docs command for LLM-friendly documentation

- Add `ai-docs` subcommand that outputs comprehensive documentation for AI coding agents
- Create unified documentation source (src/docs/ai-guide.ts) for both CLI and README
- Add "For AI Agents" section to README with non-interactive workflow instructions
- Integrate ai-docs command into CLI help output

