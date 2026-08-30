#!/usr/bin/env bun
import { $ } from 'bun';
async function value(key: string) {
  const r = await $`git config --global ${key}`.quiet().nothrow();
  return r.exitCode === 0 ? r.text().trim() : '';
}
const github = process.env.GITHUB_USER ?? '';
const name = process.env.GIT_USER_NAME || (await value('user.name')) || github;
const email =
  process.env.GIT_USER_EMAIL ||
  (await value('user.email')) ||
  (github ? `${github}@users.noreply.github.com` : '');
if (name && email) {
  await $`git config --global user.name ${name}`;
  await $`git config --global user.email ${email}`;
  console.log(`Git user configured: ${name} <${email}>`);
} else
  console.warn(
    'Warning: git user not configured. Set GIT_USER_NAME and GIT_USER_EMAIL in .devcontainer/.env.devcontainer',
  );
