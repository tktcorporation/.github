/// <reference types="bun" />
/**
 * @ast-grep/napi・@ast-grep/lang-bash は command-parse.ts の Bash 解析に要るが、
 * ziku の同期が運べるのは .claude/hooks/*.ts のような直下ファイルだけで、
 * package.json や lockfile、依存本体は届かない。同期先リポジトリの root package.json に
 * 依存させると管理が分散するため、このディレクトリ単独で自己完結させる。
 * package.json と bun.lock はこのファイル自身に埋め込み、初回実行時にだけ書き出して
 * `bun install --frozen-lockfile` する（以降は node_modules の有無だけ見て即座に返る）。
 * lockfile も埋め込むのは、@ast-grep/napi の推移的依存（プラットフォーム別バイナリの
 * optionalDependencies 等）まで含めて固定し、同期先やインストール時期によって解決結果が
 * 揺れないようにするため。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const AST_GREP_NAPI_VERSION = '0.51.3';
const AST_GREP_LANG_BASH_VERSION = '0.0.8';

const PACKAGE_JSON =
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
  ) + '\n';

// 上のバージョン定数を変えたときは、このディレクトリで
// `rm -rf node_modules package.json bun.lock && bun install` を実行し、
// 生成された bun.lock の中身をこの定数へそのまま貼り直すこと。
const BUN_LOCK = `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "@workspace-template/hooks-runtime",
      "dependencies": {
        "@ast-grep/lang-bash": "0.0.8",
        "@ast-grep/napi": "0.51.3",
      },
    },
  },
  "packages": {
    "@ast-grep/lang-bash": ["@ast-grep/lang-bash@0.0.8", "", { "dependencies": { "@ast-grep/setup-lang": "0.0.6" }, "peerDependencies": { "tree-sitter-cli": "0.25.8" }, "optionalPeers": ["tree-sitter-cli"], "hasInstallScript": true }, "sha512-qFykSsOdBv35I1rtt2PstJ4luzV9J1YCiFZBgySI8UPOh+TFnmpdlq9CrryNOj0Q7f6zZhc1OIau+/mUSs6HAg=="],

    "@ast-grep/napi": ["@ast-grep/napi@0.51.3", "", { "optionalDependencies": { "@ast-grep/napi-darwin-arm64": "0.51.3", "@ast-grep/napi-darwin-x64": "0.51.3", "@ast-grep/napi-linux-arm64-gnu": "0.51.3", "@ast-grep/napi-linux-arm64-musl": "0.51.3", "@ast-grep/napi-linux-x64-gnu": "0.51.3", "@ast-grep/napi-linux-x64-musl": "0.51.3", "@ast-grep/napi-win32-arm64-msvc": "0.51.3", "@ast-grep/napi-win32-ia32-msvc": "0.51.3", "@ast-grep/napi-win32-x64-msvc": "0.51.3" } }, "sha512-C+AWyTwnOGXnZ1UnRbnLgsdcmKLTUSi2qATC8dUYQ43E0x4QGLevfpw9bwrmSUM31K3PK5bB/nII0AHj772pZA=="],

    "@ast-grep/napi-darwin-arm64": ["@ast-grep/napi-darwin-arm64@0.51.3", "", { "os": "darwin", "cpu": "arm64" }, "sha512-jEetXhk5jdz4tdPVq5zGTxAe46o9ygl7fkuayjkUKBe7DF1EGK51tfI1zKVWqWs1IDzfRSZ+6TKx9KLwp+NfFw=="],

    "@ast-grep/napi-darwin-x64": ["@ast-grep/napi-darwin-x64@0.51.3", "", { "os": "darwin", "cpu": "x64" }, "sha512-8D94ytfbbc89Cer2EMRAgeM0bmYF7wuY9VtEwA+Yrfhphgb8d5dM0BqcTjUplBO84BNg2Oc0GAS7SG6FQQq2ew=="],

    "@ast-grep/napi-linux-arm64-gnu": ["@ast-grep/napi-linux-arm64-gnu@0.51.3", "", { "os": "linux", "cpu": "arm64", "libc": "glibc" }, "sha512-o/qmmOtlA+MB+6BqXLLmJBPPlrdxfTJlEv5wra0JKiK6sQhvrS9FzRCzt4TC1JMvXY0DAqFw4G2pmxRP+KAg0A=="],

    "@ast-grep/napi-linux-arm64-musl": ["@ast-grep/napi-linux-arm64-musl@0.51.3", "", { "os": "linux", "cpu": "arm64", "libc": "musl" }, "sha512-l6MNH2iDhxz7nqwxfHn3DzWaOES9q+c23vD/wDwyjkoDGfgxwzCzj+cLgU/FQ+Ku7bMZd2UKQ9FacLRTSmSIxg=="],

    "@ast-grep/napi-linux-x64-gnu": ["@ast-grep/napi-linux-x64-gnu@0.51.3", "", { "os": "linux", "cpu": "x64", "libc": "glibc" }, "sha512-zSsre2fZNzrUEBCrBpLd9lhCYN/UkHzxF4wGfD/chS1om/8cBxSngDsgknRxMQ/xIgPLW/e9qN45txKONTh15w=="],

    "@ast-grep/napi-linux-x64-musl": ["@ast-grep/napi-linux-x64-musl@0.51.3", "", { "os": "linux", "cpu": "x64", "libc": "musl" }, "sha512-F8nqtnR8GrjjyrllvY/mf9yAdeRljenP/KDfSwyoHC5akmad8e/lh5P3OjTrLZS1RZioHBM3q00qkxQ0rga9LA=="],

    "@ast-grep/napi-win32-arm64-msvc": ["@ast-grep/napi-win32-arm64-msvc@0.51.3", "", { "os": "win32", "cpu": "arm64" }, "sha512-9cr1yZ/TKYyP9a1/q54Tqfjc5gG4yokLpwWeHxdUGbJTbnenu4hawd813RAMvfLO7SAvJPrFK1pGKdH93DWsjA=="],

    "@ast-grep/napi-win32-ia32-msvc": ["@ast-grep/napi-win32-ia32-msvc@0.51.3", "", { "os": "win32", "cpu": "ia32" }, "sha512-snWcPI07u72Cn2Y/fq86X7DevjqgUtMxBsFS3ytR81S7DT8YNR17oeQTxJx0QzrKNNpTMbbmISycniuivg7HkA=="],

    "@ast-grep/napi-win32-x64-msvc": ["@ast-grep/napi-win32-x64-msvc@0.51.3", "", { "os": "win32", "cpu": "x64" }, "sha512-pG1F5IqCcijEBCb6+U6ADbkydCgHN4+JCFMHwDE4XCOTY0yRqdGHwWiPkELm+fL+tqPPRkAd/kWaqvrT9IIJuQ=="],

    "@ast-grep/setup-lang": ["@ast-grep/setup-lang@0.0.6", "", {}, "sha512-aSYZNF5nGQMxnwiA3Lcc8zi0AtpGlug47ADgqCgP/2n7p922FbnW7vo1rbW4kKjW72B/3mDdN7uvYidv8JnPnw=="],
  }
}
`;

/** 依存を入れた直後に起動し直した子プロセスであることを示す環境変数。 */
const RESPAWNED = 'CLAUDE_HOOK_DEPS_RESPAWNED';

export async function ensureBashParserDeps(hooksDir: string): Promise<void> {
  if (existsSync(join(hooksDir, 'node_modules', '@ast-grep', 'napi'))) return;
  await Bun.write(join(hooksDir, 'package.json'), PACKAGE_JSON);
  await Bun.write(join(hooksDir, 'bun.lock'), BUN_LOCK);
  const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: hooksDir,
    stdout: 'ignore',
    stderr: 'inherit',
  });
  if (install.exitCode !== 0)
    throw new Error(
      '.claude/hooks の @ast-grep 初回インストールに失敗しました（ネットワーク接続を確認してください）',
    );
  // 同じプロセスでは、モジュール解決が「node_modules が無い」状態を覚えたままで、入れたばかりの依存を
  // 読めない。hook が失敗すると多くのホストはコマンドを止めずに通すため、初回の 1 回だけ防御が外れる。
  // 同じ引数で起動し直し、その結果を自分の結果として返す。import は stdin を読む前に走るので、
  // 入力はまだ消費されておらず子プロセスへそのまま渡る。
  // bun test の中では argv がテストファイルを指し、起動し直すとテストランナーの外で実行される。
  // `bun --eval` などで起動したときは起動し直すスクリプトが無い。どちらも起動し直さない
  // （テストでは、その前に依存を入れておく）。
  if (process.env.NODE_ENV === 'test' || !process.argv[1]) return;
  // 起動し直した子でも依存が見つからないなら、インストールが成功を返しても依存が入らない環境なので、
  // 起動し直しを繰り返さずに失敗させる。
  if (process.env[RESPAWNED] === '1')
    throw new Error('.claude/hooks の @ast-grep をインストールしましたが、読み込める状態になりません');
  const rerun = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, [RESPAWNED]: '1' },
  });
  process.exit(rerun.exitCode ?? 1);
}
