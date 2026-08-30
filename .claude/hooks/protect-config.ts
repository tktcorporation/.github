#!/usr/bin/env bun
import 'bun';
const input: null | { tool_input?: { file_path?: string; path?: string } } = await Bun.stdin
  .json()
  .catch(() => null);
const file = input?.tool_input?.file_path ?? input?.tool_input?.path;
if (!file) process.exit(0);

const basename = file.split(/[\\/]/).at(-1) ?? file;
const protectedFiles = new Set([
  '.oxlintrc.json',
  'sgconfig.yml',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.ts',
  'eslint.config.mjs',
  'biome.json',
  'biome.jsonc',
  '.prettierrc',
  '.prettierrc.json',
  'knip.json',
  'knip.ts',
]);
const project = process.env.CLAUDE_PROJECT_DIR;
const relative = project && file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file;
const astGrepRule = /^(?:rules|\.ast-grep\/rules)\/[^/]+\.yml$/.test(relative);

if (protectedFiles.has(basename) || astGrepRule) {
  const kind = astGrepRule
    ? `ast-grep ルールファイル (${basename})`
    : `${basename} はリンター設定ファイル`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `BLOCKED: ${kind}です。設定ではなくコードを修正してください。変更が必要なら理由を説明してユーザーに確認してください。`,
      },
    }),
  );
}
