# @tktco/create-devenv

## 0.1.3

### Patch Changes

- [#6](https://github.com/tktcorporation/.github/pull/6) [`91d9a86`](https://github.com/tktcorporation/.github/commit/91d9a86b9097af297c848eaf06ca58736dd552a5) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat: ビルド時にバージョン情報を埋め込み、実行時に表示するように改善

## 0.1.2

### Patch Changes

- [#4](https://github.com/tktcorporation/.github/pull/4) [`ae7c5e7`](https://github.com/tktcorporation/.github/commit/ae7c5e712b1a16963cd0cd920a92dd589f5e9f84) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: overwriteStrategy オプションが正しく機能するように修正

  - "prompt" 戦略: ファイルごとにユーザーに上書き確認を表示
  - "skip" 戦略: 既存ファイルをスキップして新規ファイルのみコピー
  - "overwrite" 戦略: 既存ファイルを全て上書き

  また、Vitest によるテスト環境を追加

## 0.1.1

### Patch Changes

- [`c3dcb7a`](https://github.com/tktcorporation/.github/commit/c3dcb7a158a4eedc331fef98433537ed9969c20d) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: ignore "init" argument as directory name

  When running `npx create-devenv init`, the "init" was interpreted as the target directory.
  Now "init" is ignored and files are extracted to the current directory.
