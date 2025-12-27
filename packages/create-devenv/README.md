# @tktco/create-devenv

A bi-directional dev environment template that evolves as you use it.

## Why

Templates go stale the moment you create them.

Each project improves upon the original—better configs, new workflows, refined settings—but those improvements never flow back. The template stays frozen while the real world moves on.

This tool solves that with **bi-directional sync**:

- **`init`** — Pull the latest template into your project
- **`push`** — Push your improvements back to the template
- **`diff`** — See what's changed between your project and the template

Your template stays alive, fed by every project that uses it.

<!-- USAGE:START -->

## Usage

```bash
# Apply template to current directory
npx @tktco/create-devenv

# Apply to a specific directory
npx @tktco/create-devenv ./my-project

# Push your improvements back
npx @tktco/create-devenv push -m "Add new workflow"

# Check what's different
npx @tktco/create-devenv diff
```

<!-- USAGE:END -->

<!-- FEATURES:START -->

## Modules

Pick what you need:

- **Root** - MCP, mise, and other root-level config files
- **DevContainer** - VS Code DevContainer with Docker-in-Docker
- **GitHub** - GitHub Actions and labeler workflows
- **Claude** - Claude Code project settings

<!-- FEATURES:END -->

<!-- COMMANDS:START -->

## Commands

### `init`

Apply dev environment template to your project

```
Apply dev environment template to your project (create-devenv vdev)

USAGE `create-devenv [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Target directory

OPTIONS

    `--force`    Overwrite existing files
  `-y, --yes`    Select all modules (non-interactive mode)
```

### `push`

Push local changes to the template repository as a PR

```
Push local changes to the template repository as a PR (push)

USAGE `push [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Project directory

OPTIONS

              `-n, --dryRun`    Preview only, don't create PR
             `-m, --message`    PR title
               `-f, --force`    Skip confirmation prompts
  `--no-i, --no-interactive`    Select files while reviewing diffs (enabled by default)
```

### `diff`

Show differences between local and template

```
Show differences between local and template (diff)

USAGE `diff [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Project directory

OPTIONS

  `-v, --verbose`    Show detailed diff
```

<!-- COMMANDS:END -->

<!-- FILES:START -->

## What You Get

Files generated based on selected modules:

### Root

MCP, mise, and other root-level config files

- `.mcp.json`
- `.mise.toml`

### `.devcontainer/`

VS Code DevContainer with Docker-in-Docker

- `.devcontainer/devcontainer.json`
- `.devcontainer/.gitignore`
- `.devcontainer/setup-*.sh`
- `.devcontainer/test-*.sh`
- `.devcontainer/.env.devcontainer.example`
- `.devcontainer/run-chrome-devtools-mcp.sh`

### `.github/`

GitHub Actions and labeler workflows

- `.github/workflows/issue-link.yml`
- `.github/workflows/label.yml`
- `.github/labeler.yml`

### `.claude/`

Claude Code project settings

- `.claude/settings.json`

### Config

- `.devenv.json` - Tracks which modules are applied

<!-- FILES:END -->

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
