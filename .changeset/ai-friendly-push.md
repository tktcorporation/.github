---
"@tktco/create-devenv": minor
---

Add AI-agent friendly manifest-based push workflow

- `--prepare` option: Generates a YAML manifest file (`.devenv-push-manifest.yaml`) for reviewing and editing file selections
- `--execute` option: Creates a PR based on the manifest file without interactive prompts

This enables AI agents (like Claude Code) to handle the push workflow by reading/editing the manifest file, rather than requiring interactive CLI input.
