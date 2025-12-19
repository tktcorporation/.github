import { readFile, writeFile } from "node:fs/promises";
import { join } from "pathe";
import type { DevEnvConfig } from "../modules/schemas";
import { configSchema } from "../modules/schemas";

/**
 * .devenv.json を読み込み
 */
export async function loadConfig(targetDir: string): Promise<DevEnvConfig> {
  const configPath = join(targetDir, ".devenv.json");
  const content = await readFile(configPath, "utf-8");
  const data = JSON.parse(content);
  return configSchema.parse(data);
}

/**
 * .devenv.json を保存
 */
export async function saveConfig(
  targetDir: string,
  config: DevEnvConfig,
): Promise<void> {
  const configPath = join(targetDir, ".devenv.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * customPatterns にパターンを追加
 */
export function addToCustomPatterns(
  config: DevEnvConfig,
  moduleId: string,
  patterns: string[],
): DevEnvConfig {
  const customPatterns = { ...(config.customPatterns || {}) };
  const existing = customPatterns[moduleId] || [];

  // 重複を除いて追加
  const newPatterns = patterns.filter((p) => !existing.includes(p));
  if (newPatterns.length > 0) {
    customPatterns[moduleId] = [...existing, ...newPatterns];
  }

  return {
    ...config,
    customPatterns,
  };
}

/**
 * 複数モジュールのカスタムパターンを一括追加
 */
export function addMultipleToCustomPatterns(
  config: DevEnvConfig,
  additions: { moduleId: string; patterns: string[] }[],
): DevEnvConfig {
  let updatedConfig = config;
  for (const { moduleId, patterns } of additions) {
    updatedConfig = addToCustomPatterns(updatedConfig, moduleId, patterns);
  }
  return updatedConfig;
}
