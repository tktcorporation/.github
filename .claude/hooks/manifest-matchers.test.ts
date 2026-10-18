/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const manifest: unknown = await Bun.file(join(import.meta.dir, 'manifest.json')).json();

/** PR 作成ゲートと作成後のリセットについて、ホストごとの matcher を取り出す。 */
function matchersFor(id: string): Record<string, string> {
  const hooks = Reflect.get(Object(manifest), 'hooks');
  const hook = Array.isArray(hooks)
    ? hooks.find((h) => Reflect.get(Object(h), 'id') === id)
    : undefined;
  const result: Record<string, string> = {};
  for (const host of ['claude', 'cursor', 'codex']) {
    const matcher = Reflect.get(Object(Reflect.get(Object(hook), host)), 'matcher');
    if (typeof matcher === 'string') result[host] = matcher;
  }
  return result;
}

// ホストごとに MCP ツールの名前の付け方が違う。Cursor は `MCP:<ツール名>` で渡す。
const prCreateNames = {
  claude: ['mcp__github__create_pull_request'],
  codex: ['mcp__github__create_pull_request', 'mcp__codex_apps__github_create_pull_request'],
  cursor: ['MCP:create_pull_request', 'MCP:github_create_pull_request'],
};
const otherNames = ['mcp__github__create_issue', 'MCP:create_issue', 'Bash', 'Shell'];

describe('PR 作成の MCP 呼び出しに掛ける matcher', () => {
  for (const id of ['require-pr-self-review-mcp', 'post-mcp-pr']) {
    test(`${id} は各ホストの PR 作成ツール名にだけ一致する`, () => {
      const matchers = matchersFor(id);
      for (const [host, names] of Object.entries(prCreateNames)) {
        const matcher = matchers[host];
        expect(matcher).toBeString();
        const pattern = new RegExp(matcher ?? '');
        for (const name of names) expect(pattern.test(name)).toBe(true);
        for (const name of otherNames) expect(pattern.test(name)).toBe(false);
      }
    });
  }
});
