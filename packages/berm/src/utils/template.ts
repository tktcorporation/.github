import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import { downloadTemplate } from "giget";
import { dirname, join } from "pathe";
import { match } from "ts-pattern";
import { getModuleById } from "../modules/index";
import type {
  DevEnvConfig,
  FileOperationResult,
  OverwriteStrategy,
  TemplateModule,
} from "../modules/schemas";
import { loadMergedGitignore, separateByGitignore } from "./gitignore";
import { getEffectivePatterns, resolvePatterns } from "./patterns";
import { log, logFileResult, pc } from "./ui";

export const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

// 後方互換性のためのエイリアス
export type CopyResult = FileOperationResult;

/**
 * DevEnvConfig の source フィールドから giget 用のテンプレートソース文字列を構築する。
 *
 * 背景: giget は "gh:owner/repo" または "gh:owner/repo#ref" 形式を期待する。
 * .devenv.json の source: { owner, repo, ref? } をこの形式に変換する。
 */
export function buildTemplateSource(source: { owner: string; repo: string; ref?: string }): string {
  const base = `gh:${source.owner}/${source.repo}`;
  return source.ref ? `${base}#${source.ref}` : base;
}

/**
 * テンプレートをダウンロードして一時ディレクトリのパスを返す。
 *
 * @param targetDir - テンプレートを展開するベースディレクトリ
 * @param source - giget 形式のテンプレートソース (例: "gh:owner/repo")。
 *                 未指定時はデフォルトの TEMPLATE_SOURCE を使用。
 */
export async function downloadTemplateToTemp(
  targetDir: string,
  source?: string,
): Promise<{ templateDir: string; cleanup: () => void }> {
  const tempDir = join(targetDir, ".devenv-temp");

  const { dir: templateDir } = await downloadTemplate(source ?? TEMPLATE_SOURCE, {
    dir: tempDir,
    force: true,
  });

  const cleanup = () => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return { templateDir, cleanup };
}

export interface DownloadOptions {
  targetDir: string;
  modules: string[];
  overwriteStrategy: OverwriteStrategy;
  config?: DevEnvConfig;
  moduleList?: TemplateModule[]; // 外部からロードしたモジュールリスト
  templateDir?: string; // 事前にダウンロードしたテンプレートディレクトリ
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
export async function fetchTemplates(options: DownloadOptions): Promise<FileOperationResult[]> {
  const {
    targetDir,
    modules,
    overwriteStrategy,
    config,
    moduleList,
    templateDir: preDownloadedDir,
  } = options;
  const allResults: FileOperationResult[] = [];

  // 事前ダウンロード済みか、新規ダウンロードか
  const shouldDownload = !preDownloadedDir;
  const tempDir = join(targetDir, ".devenv-temp");

  let templateDir: string;

  try {
    if (shouldDownload) {
      const result = await downloadTemplate(TEMPLATE_SOURCE, {
        dir: tempDir,
        force: true,
      });
      templateDir = result.dir;
    } else {
      templateDir = preDownloadedDir;
    }

    // ローカルとテンプレート両方の .gitignore をマージして読み込み
    const gitignore = await loadMergedGitignore([targetDir, templateDir]);

    // 選択されたモジュールのファイルをパターンベースでコピー
    for (const moduleId of modules) {
      // moduleList が指定されていればそちらから、なければデフォルトから取得
      const moduleDef = moduleList
        ? moduleList.find((m) => m.id === moduleId)
        : getModuleById(moduleId);
      if (!moduleDef) continue;

      // 有効なパターンを取得
      const patterns = getEffectivePatterns(moduleId, moduleDef.patterns, config);

      // パターンにマッチするファイル一覧を取得し、gitignore で分離
      const resolvedFiles = resolvePatterns(templateDir, patterns);
      const { tracked, ignored } = separateByGitignore(resolvedFiles, gitignore);

      if (tracked.length === 0 && ignored.length === 0) {
        log.warn(`No files matched for module "${pc.cyan(moduleId)}"`);
        continue;
      }

      // tracked ファイルは通常通りコピー
      for (const relativePath of tracked) {
        const srcPath = join(templateDir, relativePath);
        const destPath = join(targetDir, relativePath);

        const result = await copyFile(srcPath, destPath, overwriteStrategy, relativePath);
        logResult(result);
        allResults.push(result);
      }

      // ignored ファイルは特別処理:
      // - ローカルに存在しない場合 → コピー
      // - ローカルに存在する場合 → スキップ（上書き防止）
      for (const relativePath of ignored) {
        const srcPath = join(templateDir, relativePath);
        const destPath = join(targetDir, relativePath);
        const destExists = existsSync(destPath);

        if (destExists) {
          // ローカルに既存 → スキップして警告
          const result: FileOperationResult = {
            action: "skipped_ignored",
            path: relativePath,
          };
          logResult(result);
          allResults.push(result);
        } else {
          // ローカルにない → 通常通りコピー
          const result = await copyFile(srcPath, destPath, overwriteStrategy, relativePath);
          logResult(result);
          allResults.push(result);
        }
      }
    }
  } finally {
    // 新規ダウンロードした場合のみ一時ディレクトリを削除
    if (shouldDownload && existsSync(tempDir)) {
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
  logFileResult(result);
}
