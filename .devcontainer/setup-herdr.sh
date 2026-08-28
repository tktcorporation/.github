#!/usr/bin/env bash

set -euo pipefail

readonly HERDR_CONFIG_DIR="${HOME}/.config/herdr"
readonly HERDR_CONFIG_FILE="${HERDR_CONFIG_DIR}/config.toml"
readonly HERDR_CONFIG_BACKUP="${HERDR_CONFIG_DIR}/config.toml.before-workspace-config"
readonly WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly WORKSPACE_CONFIG_FILE="${WORKSPACE_ROOT}/.herdr/config.toml"
readonly CODEX_CONFIG_DIR="${CODEX_HOME:-${HOME}/.codex}"

mkdir -p "${HERDR_CONFIG_DIR}" "${CODEX_CONFIG_DIR}"

if [[ -e "${HERDR_CONFIG_FILE}" && ! -L "${HERDR_CONFIG_FILE}" ]]; then
  if [[ -e "${HERDR_CONFIG_BACKUP}" ]]; then
    echo "Refusing to overwrite Herdr config backup: ${HERDR_CONFIG_BACKUP}" >&2
    exit 1
  fi

  mv "${HERDR_CONFIG_FILE}" "${HERDR_CONFIG_BACKUP}"
fi

ln -sfn "${WORKSPACE_CONFIG_FILE}" "${HERDR_CONFIG_FILE}"

mise exec "github:herdrdev/herdr" -- herdr integration install codex
