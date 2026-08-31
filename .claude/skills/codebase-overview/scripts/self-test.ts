#!/usr/bin/env bun
import { $ } from 'bun';
import { fanOut, normalize, ownFiles, references, scopeFor, scopes } from './codebase-overview.ts';
let passed = 0,
  failed = 0;
function check(name: string, expected: unknown, actual: unknown) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) passed++;
  else {
    failed++;
    console.error(
      `✗ ${name}\n  期待: ${JSON.stringify(expected)}\n  実際: ${JSON.stringify(actual)}`,
    );
  }
}
check('worker scope', scopes[0], scopeFor('worker/src/index.ts'));
check('web scope', scopes[1], scopeFor('web/src/app/api.ts'));
check('scope boundary', undefined, scopeFor('worker/src-generated/a.ts'));
check(
  'fan out',
  ['3 worker/src/index.ts', '1 worker/src/a.ts'],
  fanOut({ 'a.ts': ['x'], 'index.ts': ['a', 'b', 'c'], '../../x.ts': ['a'] }, 'worker/src'),
);
check(
  'fan out limit',
  ['3 worker/src/index.ts'],
  fanOut({ 'a.ts': ['x'], 'index.ts': ['a', 'b', 'c'] }, 'worker/src', 1),
);
check(
  'own files',
  ['worker/src/index.ts'],
  ownFiles({ 'index.ts': [], '../../x.ts': [] }, 'worker/src'),
);
check(
  'references dedupe',
  ['worker/src/a.ts'],
  references({ 'x.ts': ['a.ts'], 'y.ts': ['a.ts'] }, 'worker/src'),
);
check('normalize parent', 'worker/src/a.ts', normalize('web/src', '../../worker/src/a.ts'));
const script = new URL('./codebase-overview.ts', import.meta.url).pathname;
check('help', 0, (await $`bun ${script} --help`.quiet().nothrow()).exitCode);
const missing = await $`bun ${script} no/such/file.ts`.quiet().nothrow();
check('missing file', 1, missing.exitCode);
check('missing path', true, missing.stderr.toString().includes('no/such/file.ts'));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
