/// <reference types="bun" />
/**
 * @ast-grep/napi・@ast-grep/lang-bash は command-parse.ts の Bash 解析に要るが、
 * ziku の同期が運べるのは .claude/hooks/*.ts のような直下ファイルだけで、
 * package.json や lockfile、依存本体は届かない。同期先リポジトリの root package.json に
 * 依存させると管理が分散するため、このディレクトリ単独で自己完結させる。
 * 初回実行時にだけ package.json を書き出して bun install し、以降は node_modules の
 * 有無だけを見て即座に返る。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const AST_GREP_NAPI_VERSION = '0.45.3';
const AST_GREP_LANG_BASH_VERSION = '0.0.8';

export async function ensureBashParserDeps(hooksDir: string): Promise<void> {
  if (existsSync(join(hooksDir, 'node_modules', '@ast-grep', 'napi'))) return;
  await Bun.write(
    join(hooksDir, 'package.json'),
    JSON.stringify(
      {
        name: '@workspace-template/hooks-runtime',
        private: true,
        dependencies: {
          '@ast-grep/napi': AST_GREP_NAPI_VERSION,
          '@ast-grep/lang-bash': AST_GREP_LANG_BASH_VERSION,
        },
      },
      null,
      2,
    ) + '\n',
  );
  const install = Bun.spawnSync(['bun', 'install'], {
    cwd: hooksDir,
    stdout: 'ignore',
    stderr: 'inherit',
  });
  if (install.exitCode !== 0)
    throw new Error(
      '.claude/hooks の @ast-grep 初回インストールに失敗しました（ネットワーク接続を確認してください）',
    );
}
