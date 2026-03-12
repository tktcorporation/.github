#!/usr/bin/env node

/**
 * 後方互換のためのラッパー。`npx @tktco/berm` でも動作するようにする。
 * 本体は `berm` パッケージに移行済み。`npx berm` を推奨。
 *
 * berm パッケージへの完全移行後、このパッケージは削除可能。
 */
await import("berm/dist/index.mjs");
