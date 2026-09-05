import { describe, expect, test } from 'bun:test';
import { workspaceRootFrom } from '../src/cli';

describe('workspaceRootFrom', () => {
  test('%20 でエンコードされた空白を含む file URL を実パスへ戻す', () => {
    expect(workspaceRootFrom('file:///workspaces/my%20workspace/tools/agent-fleet/src/cli.tsx')).toBe(
      '/workspaces/my workspace',
    );
  });
});
