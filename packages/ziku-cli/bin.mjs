#!/usr/bin/env node

/**
 * @tktco/ziku — tktcorporation/.github テンプレート専用ラッパー。
 *
 * `npx @tktco/ziku` で --from tktcorporation/.github が自動適用される。
 * 汎用の `npx ziku` と違い、テンプレートソースの指定が不要。
 */

// --from が未指定の場合のみデフォルトを注入する
if (!process.argv.includes("--from")) {
  process.argv.push("--from", "tktcorporation/.github");
}

await import("ziku/dist/index.mjs");
