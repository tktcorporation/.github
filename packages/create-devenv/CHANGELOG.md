# @tktco/create-devenv

## 0.2.0

### Minor Changes

- [#12](https://github.com/tktcorporation/.github/pull/12) [`798d3fb`](https://github.com/tktcorporation/.github/commit/798d3fb332bdffbc4feac24d9ed89a1b510d7fcf) Thanks [@tktcorporation](https://github.com/tktcorporation)! - 双方向同期機能とホワイトリスト形式を追加

  ### 新機能

  - `push` コマンド: ローカル変更を GitHub PR として自動送信
  - `diff` コマンド: ローカルとテンプレートの差分をプレビュー

  ### 破壊的変更

  - モジュール定義を `files` + `excludeFiles` 形式から `patterns` (glob) 形式に移行
  - テンプレート対象ファイルをホワイトリスト形式で明示的に指定するように変更

  ### 使用例

  ```bash
  # 差分を確認
  npx @tktco/create-devenv diff

  # ローカル変更を PR として送信
  npx @tktco/create-devenv push --message "feat: DevContainer設定を更新"

  # ドライラン
  npx @tktco/create-devenv push --dry-run
  ```

- [#10](https://github.com/tktcorporation/.github/pull/10) [`d932401`](https://github.com/tktcorporation/.github/commit/d93240170c298d5469e4c7646c383ac8e6aed90c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - CLI 出力を改善

  - すべてのファイル操作に上書き戦略を適用
  - .devenv.json は常に更新（設定管理ファイルとして特別扱い）
  - セットアップ後にモジュール別説明を表示
  - 全スキップ時は「変更はありませんでした」と表示
  - ts-pattern で網羅的なパターンマッチング
  - Zod スキーマで型安全性を向上

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
