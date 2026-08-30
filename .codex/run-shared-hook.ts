#!/usr/bin/env bun
import { $ } from 'bun';
import { isAbsolute, join } from 'node:path';

const hookPath = process.argv[2];
if (!hookPath) throw new Error('shared hook path is required');
const rootResult = await $`git rev-parse --show-toplevel`.quiet().nothrow();
const projectDirectory = rootResult.exitCode === 0 ? rootResult.text().trim() : process.cwd();
process.env.CLAUDE_PROJECT_DIR = projectDirectory;
const inputText = await Bun.stdin.text();
interface HookPayload {
  tool_input?: string | { file_path?: string };
  hookSpecificOutput?: { additionalContext?: string };
  [key: string]: unknown;
}
let input: HookPayload;
try {
  input = JSON.parse(inputText);
} catch {
  process.exit(0);
}

const runHook = async (payload: unknown): Promise<string> => {
  const executable = isAbsolute(hookPath) ? hookPath : join(projectDirectory, hookPath);
  const command = hookPath.endsWith('.ts') ? ['bun', executable] : [executable];
  const processHandle = Bun.spawn(command, {
    cwd: projectDirectory,
    env: process.env,
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const output = await new Response(processHandle.stdout).text();
  const status = await processHandle.exited;
  if (status !== 0) process.exit(status);
  return output.trim();
};

if (typeof input.tool_input !== 'string') {
  const output = await runHook(input);
  if (output) console.log(output);
  process.exit(0);
}

const files = [
  ...input.tool_input.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.*)$|^\*\*\* Move to: (.*)$/gm,
  ),
]
  .map((match) => match[1] ?? match[2])
  .filter((file, index, all) => all.indexOf(file) === index);
if (files.length === 0) files.push('');

const outputs: HookPayload[] = [];
for (const file of files) {
  const payload = file ? { ...input, tool_input: { file_path: file } } : input;
  const output = await runHook(payload);
  if (output) outputs.push(JSON.parse(output));
}
if (outputs.length === 1) console.log(JSON.stringify(outputs[0]));
if (outputs.length > 1) {
  const merged = outputs[0];
  const hookOutput = merged.hookSpecificOutput ?? {};
  merged.hookSpecificOutput = hookOutput;
  hookOutput.additionalContext = outputs
    .map((item) => item.hookSpecificOutput?.additionalContext)
    .filter(Boolean)
    .join('\n');
  console.log(JSON.stringify(merged));
}
