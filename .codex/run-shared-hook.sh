#!/usr/bin/env bash
# Codex adapter: expose the project root expected by shared Claude/Codex hooks.
set -euo pipefail

hook_path="${1:?shared hook path is required}"
project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
export CLAUDE_PROJECT_DIR="$project_dir"

exec bash "$project_dir/$hook_path"
