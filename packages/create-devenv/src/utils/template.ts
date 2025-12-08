import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { downloadTemplate } from "giget";
import { join } from "pathe";
import { match } from "ts-pattern";
import { getModuleById } from "../modules/index";
import type {
  FileOperationResult,
  OverwriteStrategy,
} from "../modules/schemas";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

// 後方互換性のためのエイリアス
export type CopyResult = FileOperationResult;

export interface DownloadOptions {
  targetDir: string;
  modules: string[];
  excludeFiles?: string[];
  overwriteStrategy: OverwriteStrategy;
}

export interface WriteFileOptions {
  destPath: string;
  content: string;
  strategy: OverwriteStrategy;
  relativePath: string;
}

/**
 * 上書き戦略に従ってファイルを書き込む
 */
export async function writeFileWithStrategy(
  options: WriteFileOptions,
): Promise<FileOperationResult> {
  const { destPath, content, strategy, relativePath } = options;
  const destExists = existsSync(destPath);

  // ファイルが存在しない場合は常に作成
  if (!destExists) {
    const destDir = join(destPath, "..");
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    writeFileSync(destPath, content);
    return { action: "created", path: relativePath };
  }

  // 既存ファイルの処理 - ts-pattern で網羅的にマッチ
  return match(strategy)
    .with("overwrite", () => {
      writeFileSync(destPath, content);
      return { action: "overwritten" as const, path: relativePath };
    })
    .with("skip", () => {
      return { action: "skipped" as const, path: relativePath };
    })
    .with("prompt", async () => {
      const shouldOverwrite = await confirm({
        message: `${relativePath} は既に存在します。上書きしますか?`,
        default: false,
      });
      if (shouldOverwrite) {
        writeFileSync(destPath, content);
        return { action: "overwritten" as const, path: relativePath };
      }
      return { action: "skipped" as const, path: relativePath };
    })
    .exhaustive();
}

export async function fetchTemplates(
  options: DownloadOptions,
): Promise<FileOperationResult[]> {
  const { targetDir, modules, excludeFiles = [], overwriteStrategy } = options;
  const allResults: FileOperationResult[] = [];

  // 一時ディレクトリにテンプレートをダウンロード
  const tempDir = join(targetDir, ".devenv-temp");

  try {
    consola.start("テンプレートを取得中...");

    const { dir } = await downloadTemplate(TEMPLATE_SOURCE, {
      dir: tempDir,
      force: true,
    });

    consola.success("テンプレートを取得しました");

    // 選択されたモジュールのファイルのみコピー
    for (const moduleId of modules) {
      const moduleDef = getModuleById(moduleId);
      if (!moduleDef) continue;

      for (const pattern of moduleDef.files) {
        const srcPath = join(dir, pattern);
        const destPath = join(targetDir, pattern);

        if (!existsSync(srcPath)) {
          consola.warn(`ファイルが見つかりません: ${pattern}`);
          continue;
        }

        // 除外ファイルをスキップ
        const shouldExclude = [
          ...excludeFiles,
          ...(moduleDef.excludeFiles || []),
        ].some((ex) => srcPath.includes(ex) || pattern.includes(ex));

        if (shouldExclude) {
          consola.info(`スキップ: ${pattern}`);
          continue;
        }

        // ディレクトリの場合は再帰コピー
        if (statSync(srcPath).isDirectory()) {
          const results = await copyDirectory(
            srcPath,
            destPath,
            excludeFiles.concat(moduleDef.excludeFiles || []),
            overwriteStrategy,
            pattern,
          );
          logResults(results, pattern);
          allResults.push(...results);
        } else {
          const result = await copyFile(
            srcPath,
            destPath,
            overwriteStrategy,
            pattern,
          );
          logResult(result);
          allResults.push(result);
        }
      }
    }
  } finally {
    // 一時ディレクトリを削除
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return allResults;
}

export async function copyFile(
  srcPath: string,
  destPath: string,
  strategy: OverwriteStrategy,
  relativePath: string,
): Promise<CopyResult> {
  const destExists = existsSync(destPath);

  if (!destExists) {
    // 新規ファイル: 常にコピー
    const destDir = join(destPath, "..");
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(srcPath, destPath);
    return { action: "copied", path: relativePath };
  }

  // 既存ファイルの処理
  switch (strategy) {
    case "overwrite":
      copyFileSync(srcPath, destPath);
      return { action: "overwritten", path: relativePath };

    case "skip":
      return { action: "skipped", path: relativePath };

    case "prompt": {
      const shouldOverwrite = await confirm({
        message: `${relativePath} は既に存在します。上書きしますか?`,
        default: false,
      });

      if (shouldOverwrite) {
        copyFileSync(srcPath, destPath);
        return { action: "overwritten", path: relativePath };
      }
      return { action: "skipped", path: relativePath };
    }
  }
}

export async function copyDirectory(
  src: string,
  dest: string,
  excludes: string[],
  strategy: OverwriteStrategy,
  basePath = "",
): Promise<CopyResult[]> {
  const results: CopyResult[] = [];

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    // 除外チェック
    if (excludes.some((ex) => srcPath.includes(ex) || entry.name === ex)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subResults = await copyDirectory(
        srcPath,
        destPath,
        excludes,
        strategy,
        relativePath,
      );
      results.push(...subResults);
    } else {
      const result = await copyFile(srcPath, destPath, strategy, relativePath);
      results.push(result);
    }
  }

  return results;
}

export function logResult(result: FileOperationResult): void {
  match(result.action)
    .with("copied", () => consola.success(`コピー: ${result.path}`))
    .with("created", () => consola.success(`作成: ${result.path}`))
    .with("overwritten", () => consola.success(`上書き: ${result.path}`))
    .with("skipped", () => consola.info(`スキップ: ${result.path}`))
    .exhaustive();
}

function logResults(results: FileOperationResult[], prefix: string): void {
  const copied = results.filter((r) => r.action === "copied").length;
  const created = results.filter((r) => r.action === "created").length;
  const overwritten = results.filter((r) => r.action === "overwritten").length;
  const skipped = results.filter((r) => r.action === "skipped").length;

  if (copied > 0) consola.success(`コピー: ${prefix}/ (${copied} files)`);
  if (created > 0) consola.success(`作成: ${prefix}/ (${created} files)`);
  if (overwritten > 0)
    consola.success(`上書き: ${prefix}/ (${overwritten} files)`);
  if (skipped > 0) consola.info(`スキップ: ${prefix}/ (${skipped} files)`);
}
