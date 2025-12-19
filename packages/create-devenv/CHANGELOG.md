# @tktco/create-devenv

## 0.4.0

### Minor Changes

- [#23](https://github.com/tktcorporation/.github/pull/23) [`ec36c47`](https://github.com/tktcorporation/.github/commit/ec36c474aac4e01b30ad018507f5fe7f9a305da2) Thanks [@tktcorporation](https://github.com/tktcorporation)! - push コマンドにホワイトリスト外ファイル検知機能を追加し、モジュール定義を外部化

  ### ホワイトリスト外ファイル検知

  - push 時にホワイトリスト（patterns）に含まれていないファイルを検出
  - モジュールごとにグループ化して選択 UI を表示
  - 選択したファイルを modules.jsonc に自動追加（PR に含まれる）
  - gitignore されているファイルは自動で除外

  ### モジュール定義の外部化

  - モジュール定義をコードから `.devenv/modules.jsonc` に外部化
  - テンプレートリポジトリの modules.jsonc から動的に読み込み
  - `customPatterns` を廃止し modules.jsonc に統合

  ### ディレクトリベースのモジュール設計

  - モジュール ID をディレクトリパスベースに変更（例: `.devcontainer`, `.github`, `.`）
  - ファイルパスから即座にモジュール ID を導出可能に
  - モジュール間のファイル重複を構造的に防止

## 0.3.0

### Minor Changes

- [#14](https://github.com/tktcorporation/.github/pull/14) [`c026ed5`](https://github.com/tktcorporation/.github/commit/c026ed55da57df6599f7c57cdbb5d29c05e3273d) Thanks [@tktcorporation](https://github.com/tktcorporation)! - .gitignore に記載されたファイルを自動的に除外する機能を追加

  - init, diff, push の全コマンドで .gitignore にマッチするファイルを除外
  - ローカルディレクトリとテンプレートリポジトリ両方の .gitignore をチェック
  - クレデンシャル等の機密情報の誤流出を防止

- [#16](https://github.com/tktcorporation/.github/pull/16) [`3d89baa`](https://github.com/tktcorporation/.github/commit/3d89baa1c236998be4cfb72b68b9b4a6480a7b4e) Thanks [@tktcorporation](https://github.com/tktcorporation)! - push コマンドに unified diff を見ながらファイルを選択できる機能を追加

  - デフォルトで差分を表示しながらチェックボックスでファイル選択が可能に
  - `--no-interactive` オプションで従来の確認プロンプトに切り替え可能
  - `--force` オプションは引き続き確認なしで全ファイルを push

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
