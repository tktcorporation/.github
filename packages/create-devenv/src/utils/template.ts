import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { downloadTemplate } from "giget";
import { dirname, join } from "pathe";
import { match } from "ts-pattern";
import { getModuleById } from "../modules/index";
import type {
  DevEnvConfig,
  FileOperationResult,
  OverwriteStrategy,
} from "../modules/schemas";
import { filterByGitignore, loadMergedGitignore } from "./gitignore";
import { getEffectivePatterns, resolvePatterns } from "./patterns";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

// 後方互換性のためのエイリアス
export type CopyResult = FileOperationResult;

export interface DownloadOptions {
  targetDir: string;
  modules: string[];
  overwriteStrategy: OverwriteStrategy;
  config?: DevEnvConfig;
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
    const destDir = dirname(destPath);
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

/**
 * テンプレートを取得してパターンベースでコピー
 */
export async function fetchTemplates(
  options: DownloadOptions,
): Promise<FileOperationResult[]> {
  const { targetDir, modules, overwriteStrategy, config } = options;
  const allResults: FileOperationResult[] = [];

  // 一時ディレクトリにテンプレートをダウンロード
  const tempDir = join(targetDir, ".devenv-temp");

  try {
    consola.start("テンプレートを取得中...");

    const { dir: templateDir } = await downloadTemplate(TEMPLATE_SOURCE, {
      dir: tempDir,
      force: true,
    });

    consola.success("テンプレートを取得しました");

    // ローカルとテンプレート両方の .gitignore をマージして読み込み
    // クレデンシャル等の機密情報の誤流出を防止
    const gitignore = await loadMergedGitignore([targetDir, templateDir]);

    // 選択されたモジュールのファイルをパターンベースでコピー
    for (const moduleId of modules) {
      const moduleDef = getModuleById(moduleId);
      if (!moduleDef) continue;

      // 有効なパターンを取得（カスタムパターン考慮）
      const patterns = getEffectivePatterns(
        moduleId,
        moduleDef.patterns,
        config,
      );

      // パターンにマッチするファイル一覧を取得し、gitignore でフィルタリング
      const resolvedFiles = resolvePatterns(templateDir, patterns);
      const files = filterByGitignore(resolvedFiles, gitignore);

      if (files.length === 0) {
        consola.warn(
          `モジュール "${moduleId}" にマッチするファイルがありません`,
        );
        continue;
      }

      // 各ファイルをコピー
      for (const relativePath of files) {
        const srcPath = join(templateDir, relativePath);
        const destPath = join(targetDir, relativePath);

        const result = await copyFile(
          srcPath,
          destPath,
          overwriteStrategy,
          relativePath,
        );
        logResult(result);
        allResults.push(result);
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

/**
 * 単一ファイルをコピー
 */
export async function copyFile(
  srcPath: string,
  destPath: string,
  strategy: OverwriteStrategy,
  relativePath: string,
): Promise<CopyResult> {
  const destExists = existsSync(destPath);

  if (!destExists) {
    // 新規ファイル: 常にコピー
    const destDir = dirname(destPath);
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

export function logResult(result: FileOperationResult): void {
  match(result.action)
    .with("copied", () => consola.success(`コピー: ${result.path}`))
    .with("created", () => consola.success(`作成: ${result.path}`))
    .with("overwritten", () => consola.success(`上書き: ${result.path}`))
    .with("skipped", () => consola.info(`スキップ: ${result.path}`))
    .exhaustive();
}
