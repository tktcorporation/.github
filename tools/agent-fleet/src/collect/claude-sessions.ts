import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { str, time } from './claude-jobs';
import { readJson } from './fs';
import { fail, ok, type SourceResult } from './types';

export type ClaudeSession = {
  pid: number;
  sessionId: string;
  kind: 'interactive' | 'bg' | 'unknown';
  name: string | null;
  status: 'busy' | 'idle' | 'unknown';
  cwd: string;
  jobId: string | null;
  startedAt: number | null;
  updatedAt: number | null;
};

export function parseClaudeSession(raw: unknown): ClaudeSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = str(r.sessionId);
  const cwd = str(r.cwd);
  // pid 0 は process.kill(0, 0) が呼び出し元のプロセスグループ全体を探すため常に
  // 生存扱いになってしまう。負数・非整数もプロセス ID としてありえないので弾く。
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0 || !sessionId || !cwd) return null;
  const kind = r.kind === 'interactive' || r.kind === 'bg' ? r.kind : 'unknown';
  const status = r.status === 'busy' || r.status === 'idle' ? r.status : 'unknown';
  return {
    pid: r.pid,
    sessionId,
    kind,
    name: str(r.name),
    status,
    cwd,
    jobId: str(r.jobId),
    startedAt: time(r.startedAt),
    updatedAt: time(r.updatedAt),
  };
}

// sessions/<pid>.json はプロセス終了後も残るファイルなので、pid の生存で絞り込む。
// EPERM は「別ユーザー所有などで signal は送れないが存在はする」ケースなので生存扱いにする。
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const defaultSessionsDir = () => join(homedir(), '.claude', 'sessions');

export async function collectClaudeSessions(
  dir = defaultSessionsDir(),
  alive: (pid: number) => boolean = isProcessAlive,
): Promise<SourceResult<ClaudeSession[]>> {
  if (!existsSync(dir)) return fail('not_found', dir);
  let names: string[];
  try {
    // dir は existsSync 通過後も、通常ファイルだったり削除されている可能性がある
    // （TOCTOU）。readdirSync の例外はここで分類し、呼び出し元へは投げない。
    names = readdirSync(dir);
  } catch (e) {
    return fail('not_found', `${dir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const out: ClaudeSession[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const r = readJson(join(dir, name));
    // 1 セッションの json が欠損・破損していても、他の正常なセッション一覧を
    // 止めてはいけないため、そのセッションだけを飛ばして続行する。
    if (!r.ok) continue;
    const s = parseClaudeSession(r.value);
    if (!s || s.kind !== 'interactive' || !alive(s.pid)) continue;
    out.push(s);
  }
  return ok(out);
}
