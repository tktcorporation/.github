import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { consola } from "consola";
import { downloadTemplate } from "giget";
import { join } from "pathe";
import { getModuleById } from "../modules/index";

const TEMPLATE_SOURCE = "gh:tktcorporation/.github";

export interface DownloadOptions {
  targetDir: string;
  modules: string[];
  excludeFiles?: string[];
  force?: boolean;
}

export async function fetchTemplates(options: DownloadOptions): Promise<void> {
  const { targetDir, modules, excludeFiles = [], force = false } = options;

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
          copyDirectory(
            srcPath,
            destPath,
            excludeFiles.concat(moduleDef.excludeFiles || []),
            force,
          );
          consola.success(`コピー: ${pattern}/`);
        } else {
          const destDir = join(destPath, "..");
          if (!existsSync(destDir)) {
            mkdirSync(destDir, { recursive: true });
          }
          cpSync(srcPath, destPath, { force });
          consola.success(`コピー: ${pattern}`);
        }
      }
    }
  } finally {
    // 一時ディレクトリを削除
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function copyDirectory(
  src: string,
  dest: string,
  excludes: string[],
  force: boolean,
): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // 除外チェック
    if (excludes.some((ex) => srcPath.includes(ex) || entry.name === ex)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, excludes, force);
    } else {
      cpSync(srcPath, destPath, { force });
    }
  }
}
