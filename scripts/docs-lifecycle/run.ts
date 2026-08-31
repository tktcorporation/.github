#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('.', import.meta.url));
const [mode, ...rest] = process.argv.slice(2);

// Bun の runtime auto-install は package.json がある複数ファイル構成で解決条件が
// 実行元に左右される。毎回 frozen install を確認すれば、同期先の構成に依存せず、
// lockfile と node_modules の不一致も本体を動かす前に修復できる。
const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
  cwd: packageDir,
  stdin: 'inherit',
  // cli.ts の --json は stdout 全体を機械可読に保つ必要がある。install の通常ログは
  // 捨て、失敗時だけ診断情報を stderr へ転送する。
  stdout: 'pipe',
  stderr: 'pipe',
});
if (install.exitCode !== 0) {
  process.stderr.write(install.stdout);
  process.stderr.write(install.stderr);
  process.exit(install.exitCode);
}

const command =
  mode === 'test'
    ? ['bun', 'test', ...rest]
    : ['bun', 'run', 'cli.ts', ...(mode === undefined ? [] : [mode]), ...rest];

const child = Bun.spawn(command, {
  cwd: packageDir,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
