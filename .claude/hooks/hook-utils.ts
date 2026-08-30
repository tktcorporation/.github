import { $ } from 'bun';
export interface HookInput {
  tool_input?: { file_path?: string; path?: string; command?: string };
  tool_response?: { exit_code?: number; exitCode?: number };
}
export async function readInput(): Promise<HookInput | null> {
  try {
    return await Bun.stdin.json();
  } catch {
    return null;
  }
}
export async function hasMiseTask(name: string): Promise<boolean> {
  const found = await $`mise tasks ls --no-header`.quiet().nothrow();
  return (
    found.exitCode === 0 &&
    found
      .text()
      .split('\n')
      .some((line) => line.trim().split(/\s+/)[0] === name)
  );
}
/** SIGTERM を送ってから SIGKILL へ進むまでの猶予。 */
const SIGKILL_GRACE_MS = 5_000;
/** シグナルを送っても子孫がパイプを握り続ける場合に、読み取りを打ち切るまでの猶予。 */
const READ_CUTOFF_MS = 10_000;

export async function runMiseTask(name: string, args: string[], timeoutMs: number) {
  const child = Bun.spawn(['mise', 'run', '--quiet', name, '--', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  // 制限時間を実効にする。シグナルだけでは足りない: SIGTERM を無視するタスクがあり、
  // 直接の子を SIGKILL しても stdout/stderr を握った子孫は残るため、パイプの読み取りが
  // 終わらない。プロセスを確実に終わらせられなくても hook 自体は返す必要があるので、
  // シグナルの送出と読み取りの打ち切りを両方仕掛ける。
  let timedOut = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cutoff = new Promise<void>((resolve) => {
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill();
        timers.push(setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS));
        timers.push(setTimeout(resolve, READ_CUTOFF_MS));
      }, timeoutMs),
    );
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Promise.race([new Response(child.stdout).text(), cutoff.then(() => '')]),
    Promise.race([new Response(child.stderr).text(), cutoff.then(() => '')]),
    Promise.race([child.exited, cutoff.then(() => -1)]),
  ]);
  for (const timer of timers) clearTimeout(timer);
  return {
    exitCode,
    output: `${stdout}${stderr}`
      .replace(new RegExp(`^\\[${name}\\] ERROR task failed$`, 'gm'), '')
      .trim(),
    timedOut: timedOut || child.signalCode !== null,
  };
}
