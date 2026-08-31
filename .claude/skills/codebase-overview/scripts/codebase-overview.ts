#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
export const scopes = [
  { root: 'worker/src', tsconfig: 'worker/tsconfig.json', extensions: 'ts' },
  { root: 'web/src', tsconfig: 'web/tsconfig.json', extensions: 'ts,tsx' },
  { root: 'scripts', tsconfig: '', extensions: 'ts' },
] as const;
/**
 * repo map（共有語彙）だけを取る対象の拡張子。依存グラフは madge の制約で TS/TSX に限るが、
 * repo map は tree-sitter ベースで言語を選ばないため、ここへ足せば対象を広げられる。
 * SKILL.md がこの名前で参照するので、改名するときは合わせて直す。
 */
export const REPO_MAP_EXTENSIONS = new Set(['rs', 'py']);
type Graph = Record<string, string[]>;
export function scopeFor(path: string) {
  return scopes.find(({ root }) => path === root || path.startsWith(`${root}/`));
}
export function normalize(base: string, path: string) {
  return resolve(base, path).replace(`${process.cwd()}/`, '');
}
export function fanOut(graph: Graph, root: string, count = 15) {
  return Object.entries(graph)
    .filter(([key, deps]) => !key.startsWith('..') && deps.length)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, count)
    .map(([key, deps]) => `${deps.length} ${root}/${key}`);
}
export function ownFiles(graph: Graph, root: string) {
  return Object.keys(graph)
    .filter((key) => !key.startsWith('..'))
    .map((key) => `${root}/${key}`);
}
export function references(graph: Graph, root: string) {
  return [
    ...new Set(
      Object.values(graph)
        .flat()
        .map((path) => normalize(root, path)),
    ),
  ].sort();
}

let temporaryDirectory: string | undefined;
const preparedTsconfigs = new Map<string, string>();

/**
 * madge へ渡す tsconfig を用意する。
 *
 * paths のエイリアスは baseUrl を起点に解決されるので、baseUrl を持たない tsconfig を
 * そのまま渡すとエイリアス経由の import が解決されず、依存グラフから黙って欠ける。
 * 欠けたグラフは依存元・循環・孤立ファイルの判定をすべて誤らせるため、tsconfig の
 * 置き場所を baseUrl として補ったコピーを一時ディレクトリに作って渡す。
 */
function prepareTsconfig(tsconfigPath: string): string {
  const cached = preparedTsconfigs.get(tsconfigPath);
  if (cached !== undefined) return cached;

  let source: { extends?: unknown; compilerOptions?: Record<string, unknown> };
  try {
    source = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
  } catch (error) {
    // 空のコピーを渡しても madge はエラーにせず受け入れ、エイリアスの解決だけが消える。
    // この関数が防ごうとしている症状そのものなので、読めない時点で止める。
    throw new Error(`${tsconfigPath} を読めなかった（コメント付き JSON は解釈できない）。`, {
      cause: error,
    });
  }
  // madge は extends を tsconfig 自身の置き場所から解決する。一時ディレクトリへ置いた
  // コピーからは継承元へ辿り着けず、継承していた paths が黙って消える。
  if (source.extends !== undefined) {
    throw new Error(`${tsconfigPath} は extends を使っている（継承した設定は解決できない）。`);
  }

  temporaryDirectory ??= mkdtempSync(join(tmpdir(), 'codebase-overview-'));
  const output = join(temporaryDirectory, `${basename(dirname(tsconfigPath))}-tsconfig.json`);
  writeFileSync(
    output,
    JSON.stringify({
      ...source,
      compilerOptions: { ...source.compilerOptions, baseUrl: resolve(dirname(tsconfigPath)) },
    }),
  );
  preparedTsconfigs.set(tsconfigPath, output);
  return output;
}

process.on('exit', () => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

function graphFor(
  scope: (typeof scopes)[number],
  circular: true,
  excludeTests?: boolean,
): Promise<string[][]>;
function graphFor(
  scope: (typeof scopes)[number],
  circular?: false,
  excludeTests?: boolean,
): Promise<Graph>;
async function graphFor(
  scope: (typeof scopes)[number],
  circular = false,
  excludeTests = false,
): Promise<Graph | string[][]> {
  if (!existsSync(scope.root)) throw new Error(`${scope.root} が存在しない。`);
  const args = ['npx', '--yes', 'madge@8', '--extensions', scope.extensions];
  if (scope.tsconfig) args.push('--ts-config', prepareTsconfig(scope.tsconfig));
  if (excludeTests) args.push('--exclude', '(^|/)__tests__/');
  args.push(circular ? '--circular' : '--json', '--json', scope.root);
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(child.stdout).text();
  await child.exited;
  if (!output.trim()) throw new Error(`${scope.root} の依存グラフを取得できなかった。`);
  const parsed: Graph | string[][] = JSON.parse(output);
  // madge は解析対象が 1 件も無くても `{}` を返して成功する。空のまま通すと、依存元・循環・
  // 孤立ファイルがすべて「該当なし」として正常に見え、scope 丸ごとの取りこぼしに気づけない。
  if (!circular && Object.keys(parsed).length === 0) {
    throw new Error(`${scope.root} の依存グラフが空だった（対象の拡張子・tsconfig を確認）。`);
  }
  return parsed;
}
function normalizeCycles(cycles: string[][], root: string) {
  return cycles.map((cycle) => cycle.map((path) => normalize(root, path)));
}
function uniqueCycles(cycles: string[][]) {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = [...cycle].sort().join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function repoMap(files: string[]) {
  if (process.env.CODEBASE_OVERVIEW_NO_MAP) return;
  console.log(files.length ? '\n## 近傍の語彙（repo map）\n' : '\n## 共有語彙（repo map）\n');
  if ((await $`which uvx`.quiet().nothrow()).exitCode !== 0) {
    console.log('uvx が無いため省略した。');
    return;
  }
  const args = [
    'uvx',
    '--from',
    'aider-chat',
    'aider',
    '--model',
    'gpt-4o',
    '--show-repo-map',
    '--map-tokens',
    files.length ? '1000' : '1500',
    '--no-show-model-warnings',
    '--yes-always',
  ];
  for (const file of files) args.push('--file', file);
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  const out = await new Response(child.stdout).text();
  const status = await child.exited;
  console.log(
    status === 0
      ? out.slice(Math.max(0, out.search(/^[^ │⋮]*:$/m))).trim()
      : 'aider の実行に失敗したため省略した。',
  );
}
async function main() {
  const args = process.argv.slice(2);
  if (['-h', '--help'].includes(args[0])) {
    console.log('bun codebase-overview.ts [<file>...]');
    return;
  }
  const git = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  const root = git.exitCode === 0 ? git.text().trim() : process.env.CLAUDE_PROJECT_DIR;
  if (!root) throw new Error('リポジトリルートを特定できない。');
  if (process.env.CLAUDE_PROJECT_DIR && resolve(process.env.CLAUDE_PROJECT_DIR) !== resolve(root))
    throw new Error('CLAUDE_PROJECT_DIR と cwd のチェックアウトが違う。');
  const requested = args.map((arg) => resolve(arg));
  process.chdir(root);
  const files = requested.map((path) => relative(root, path));
  for (const [index, file] of files.entries()) {
    if (!existsSync(requested[index])) throw new Error(`ファイルが無い: ${file}`);
    const ext = file.split('.').at(-1) ?? '';
    if (!scopeFor(file) && !REPO_MAP_EXTENSIONS.has(ext)) throw new Error(`対象外のパス: ${file}`);
  }
  const graphTargets = files.filter(scopeFor);
  const mapOnly = files.filter((file) => !scopeFor(file));
  if (files.length === 0) {
    const graphs = new Map<string, Graph>();
    let cycles: string[][] = [];
    for (const scope of scopes) {
      const graph = await graphFor(scope, false, true);
      graphs.set(scope.root, graph);
      cycles.push(...normalizeCycles(await graphFor(scope, true, true), scope.root));
    }
    const referenced = new Set([...graphs].flatMap(([root, graph]) => references(graph, root)));
    console.log('# コードベース俯瞰\n\n## 循環依存\n');
    console.log(
      uniqueCycles(cycles)
        .map((c) => c.join(' > '))
        .join('\n') || 'なし。',
    );
    console.log('\n## 依存の集中（依存先が多い順・上位15）');
    for (const [name, graph] of graphs) {
      console.log(`\n### ${name}\n\n${fanOut(graph, name).join('\n') || 'なし。'}`);
    }
    console.log('\n## どこからも参照されていないファイル');
    for (const [name, graph] of graphs) {
      console.log(
        `\n### ${name}\n\n${
          ownFiles(graph, name)
            .filter((f) => !referenced.has(f))
            .join('\n') || 'なし。'
        }`,
      );
    }
  } else {
    console.log('# 変更対象の周辺');
    const graphs = new Map<string, Graph>();
    let cycles: string[][] = [];
    if (graphTargets.length) {
      for (const scope of scopes) {
        graphs.set(scope.root, await graphFor(scope));
        cycles.push(...normalizeCycles(await graphFor(scope, true), scope.root));
      }
    }
    for (const file of graphTargets) {
      const scope = scopeFor(file)!;
      const graph = graphs.get(scope.root)!;
      const rel = relative(scope.root, file);
      const deps = (graph[rel] ?? []).map((p) => normalize(scope.root, p)).sort();
      const dependents = [...graphs]
        .flatMap(([base, g]) =>
          Object.entries(g)
            .filter(([, ds]) => ds.map((p) => normalize(base, p)).includes(file))
            .map(([p]) => `${base}/${p}`),
        )
        .sort();
      console.log(
        `\n## ${file}\n\n### 依存している先\n\n${deps.join('\n') || 'なし。'}\n\n### 依存されている元（変更するとここに波及する）\n\n${dependents.join('\n') || 'なし。'}\n\n### 巻き込んでいる循環\n\n${
          uniqueCycles(cycles)
            .filter((c) => c.includes(file))
            .map((c) => c.join(' > '))
            .join('\n') || 'なし。'
        }`,
      );
    }
    for (const file of mapOnly)
      console.log(`\n## ${file}\n\n依存グラフの対象外（repo map のみ対象）。`);
  }
  await repoMap(files);
}
if (import.meta.main)
  await main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
