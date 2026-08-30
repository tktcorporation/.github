#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const home = process.env.HOME;
if (!home) throw new Error('HOME is required');
const dir = join(home, '.config/herdr');
const config = join(dir, 'config.toml');
const backup = `${config}.before-workspace-config`;
const workspace = resolve(dirname(import.meta.dir));
const codex = process.env.CODEX_HOME ?? join(home, '.codex');
await $`mkdir -p ${dir} ${codex}`;
if (existsSync(config) && !lstatSync(config).isSymbolicLink()) {
  if (existsSync(backup)) throw new Error(`Refusing to overwrite Herdr config backup: ${backup}`);
  await $`mv ${config} ${backup}`;
}
await $`ln -sfn ${join(workspace, '.herdr/config.toml')} ${config}`;
await $`mise exec github:herdrdev/herdr -- herdr integration install codex`;
