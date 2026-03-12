#!/usr/bin/env node

/**
 * `npx berm` で呼び出せるようにするための薄いラッパー。
 * 実体は @tktco/berm の CLI エントリポイントをそのまま実行する。
 *
 * @tktco/berm が不要になればこのパッケージも削除可能。
 */
await import("@tktco/berm/dist/index.mjs");
