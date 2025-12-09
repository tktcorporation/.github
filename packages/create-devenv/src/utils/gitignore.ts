import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ignore, { type Ignore } from "ignore";
import { join } from "pathe";

/**
 * 複数ディレクトリの .gitignore をマージして読み込み
 * ローカルとテンプレートの両方の .gitignore を考慮することで、
 * クレデンシャル等の機密情報の誤流出を防止する
 */
export async function loadMergedGitignore(dirs: string[]): Promise<Ignore> {
  const ig = ignore();
  for (const dir of dirs) {
    const gitignorePath = join(dir, ".gitignore");
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, "utf-8");
      ig.add(content);
    }
  }
  return ig;
}

/**
 * gitignore ルールでファイルをフィルタリング
 * gitignore に該当しないファイルのみを返す
 */
export function filterByGitignore(files: string[], ig: Ignore): string[] {
  return ig.filter(files);
}
