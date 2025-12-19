import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ignore, { type Ignore } from "ignore";
import { join } from "pathe";
import { globSync } from "tinyglobby";
import { getModuleById } from "../modules";
import type { DevEnvConfig } from "../modules/schemas";
import { getEffectivePatterns, resolvePatterns } from "./patterns";

export interface UntrackedFile {
  path: string;
  folder: string;
  moduleId: string; // customPatterns に追加する際に必要
}

export interface UntrackedFilesByFolder {
  folder: string;
  files: UntrackedFile[];
}

/**
 * パターンからベースディレクトリを抽出
 * 例: ".devcontainer/devcontainer.json" → ".devcontainer"
 */
export function extractBaseDirectories(patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const parts = pattern.split("/");
    // ディレクトリを持つパターンのみ（. で始まる隠しディレクトリ）
    if (parts.length > 1 && parts[0].startsWith(".")) {
      dirs.add(parts[0]);
    }
  }
  return Array.from(dirs);
}

/**
 * ファイルパスからフォルダを取得
 * 例: ".devcontainer/file.json" → ".devcontainer"
 * 例: ".gitignore" → "root"
 */
export function getFolderFromPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length > 1) {
    return parts[0];
  }
  return "root";
}

/**
 * ディレクトリ内の全ファイルを取得
 */
export function getAllFilesInDirs(baseDir: string, dirs: string[]): string[] {
  if (dirs.length === 0) return [];

  const patterns = dirs.map((d) => `${d}/**/*`);
  return globSync(patterns, {
    cwd: baseDir,
    dot: true,
    onlyFiles: true,
  }).sort();
}

/**
 * ルート直下の隠しファイルを取得
 */
export function getRootDotFiles(baseDir: string): string[] {
  return globSync([".*"], {
    cwd: baseDir,
    dot: true,
    onlyFiles: true,
  }).sort();
}

/**
 * 複数ディレクトリの .gitignore をマージして読み込み
 * サブディレクトリの .gitignore も含める
 */
export async function loadAllGitignores(
  baseDir: string,
  dirs: string[],
): Promise<Ignore> {
  const ig = ignore();

  // ルートの .gitignore
  const rootGitignore = join(baseDir, ".gitignore");
  if (existsSync(rootGitignore)) {
    const content = await readFile(rootGitignore, "utf-8");
    ig.add(content);
  }

  // 各ディレクトリの .gitignore
  for (const dir of dirs) {
    const gitignorePath = join(baseDir, dir, ".gitignore");
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, "utf-8");
      // ディレクトリ相対のパスを絶対パスに変換するため、各パターンにプレフィックスを追加
      const prefixedContent = content
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          // コメント行や空行はそのまま
          if (!trimmed || trimmed.startsWith("#")) return line;
          // 否定パターンの場合
          if (trimmed.startsWith("!")) {
            return `!${dir}/${trimmed.slice(1)}`;
          }
          return `${dir}/${trimmed}`;
        })
        .join("\n");
      ig.add(prefixedContent);
    }
  }

  return ig;
}

/**
 * ホワイトリスト外のファイルをフォルダごとに検出
 */
export async function detectUntrackedFiles(options: {
  targetDir: string;
  moduleIds: string[];
  config?: DevEnvConfig;
}): Promise<UntrackedFilesByFolder[]> {
  const { targetDir, moduleIds, config } = options;

  // 全モジュールのベースディレクトリを収集
  const allBaseDirs = new Set<string>();
  // ファイルパスからモジュールIDを逆引きするためのマップ
  // キー: フォルダ名, 値: そのフォルダを管理するモジュールID
  const folderToModuleId = new Map<string, string>();
  // 全モジュールのホワイトリスト済みファイル
  const allTrackedFiles = new Set<string>();

  for (const moduleId of moduleIds) {
    const mod = getModuleById(moduleId);
    if (!mod) continue;

    const baseDirs = extractBaseDirectories(mod.patterns);
    for (const dir of baseDirs) {
      allBaseDirs.add(dir);
      // 最初にマッチしたモジュールに紐づける
      if (!folderToModuleId.has(dir)) {
        folderToModuleId.set(dir, moduleId);
      }
    }

    // ルート直下のパターンを持つモジュールの場合
    const hasRootPatterns = mod.patterns.some(
      (p) => !p.includes("/") && p.startsWith("."),
    );
    if (hasRootPatterns && !folderToModuleId.has("root")) {
      folderToModuleId.set("root", moduleId);
    }

    // ホワイトリスト済みファイルを収集
    const effectivePatterns = getEffectivePatterns(
      moduleId,
      mod.patterns,
      config,
    );
    const trackedFiles = resolvePatterns(targetDir, effectivePatterns);
    for (const file of trackedFiles) {
      allTrackedFiles.add(file);
    }
  }

  // gitignore を読み込み
  const gitignore = await loadAllGitignores(targetDir, Array.from(allBaseDirs));

  // ディレクトリ内の全ファイルを取得
  const allDirFiles = getAllFilesInDirs(targetDir, Array.from(allBaseDirs));
  const filteredDirFiles = gitignore.filter(allDirFiles);

  // ルート直下のファイルを取得
  const rootFiles = getRootDotFiles(targetDir);
  const filteredRootFiles = gitignore.filter(rootFiles);

  // 全ファイルをマージ（重複なし）
  const allFiles = new Set([...filteredDirFiles, ...filteredRootFiles]);

  // フォルダごとにグループ化
  const filesByFolder = new Map<string, UntrackedFile[]>();

  for (const filePath of allFiles) {
    // ホワイトリストに含まれていればスキップ
    if (allTrackedFiles.has(filePath)) continue;

    const folder = getFolderFromPath(filePath);
    const moduleId = folderToModuleId.get(folder);

    // モジュールに紐づかないフォルダはスキップ
    if (!moduleId) continue;

    const file: UntrackedFile = {
      path: filePath,
      folder,
      moduleId,
    };

    const existing = filesByFolder.get(folder) || [];
    existing.push(file);
    filesByFolder.set(folder, existing);
  }

  // 結果を配列に変換（フォルダ名でソート）
  const result: UntrackedFilesByFolder[] = [];
  const sortedFolders = Array.from(filesByFolder.keys()).sort((a, b) => {
    // root は最後に
    if (a === "root") return 1;
    if (b === "root") return -1;
    return a.localeCompare(b);
  });

  for (const folder of sortedFolders) {
    const files = filesByFolder.get(folder) || [];
    if (files.length > 0) {
      result.push({
        folder,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      });
    }
  }

  return result;
}

/**
 * 全フォルダの未追跡ファイル数を取得
 */
export function getTotalUntrackedCount(
  untrackedByFolder: UntrackedFilesByFolder[],
): number {
  return untrackedByFolder.reduce((sum, f) => sum + f.files.length, 0);
}
