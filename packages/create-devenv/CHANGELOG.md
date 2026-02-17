# @tktco/create-devenv

## 0.11.1

### Patch Changes

- [#81](https://github.com/tktcorporation/.github/pull/81) [`b0957ca`](https://github.com/tktcorporation/.github/commit/b0957cac35cff736df8f1d8a8e74b724d8bc7c67) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: Claude モジュールの patterns に hooks と rules を追加

- [#81](https://github.com/tktcorporation/.github/pull/81) [`53a5b6f`](https://github.com/tktcorporation/.github/commit/53a5b6fad6c7e66d4016a5914cd947b4c9e10aa4) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: push --execute で未追跡ファイルの内容が PR に含まれないバグを修正

## 0.11.0

### Minor Changes

- [#79](https://github.com/tktcorporation/.github/pull/79) [`2bb2905`](https://github.com/tktcorporation/.github/commit/2bb2905ad1e8d937d2a453675ceade606722550f) Thanks [@tktcorporation](https://github.com/tktcorporation)! - init コマンドに --modules (-m) と --overwrite-strategy (-s) オプションを追加し、AI エージェントが非インタラクティブにモジュール選択と上書き戦略を指定可能に

### Patch Changes

- [#76](https://github.com/tktcorporation/.github/pull/76) [`4dff0e4`](https://github.com/tktcorporation/.github/commit/4dff0e4ec9d453d847329a1bed31221a2cf6d625) Thanks [@tktcorporation](https://github.com/tktcorporation)! - diff/push コマンドで未トラックファイル検出時に track コマンドの存在を案内し、AI ガイドに track コマンドの重要性を追記

- [#78](https://github.com/tktcorporation/.github/pull/78) [`f722b36`](https://github.com/tktcorporation/.github/commit/f722b36e22860c74aca5275bfce611a9e5c5d251) Thanks [@tktcorporation](https://github.com/tktcorporation)! - init コマンドでテンプレートの .devenv/modules.jsonc をターゲットプロジェクトにコピーするように修正。これにより init → track のワークフローが正しく動作するようになります。

## 0.10.0

### Minor Changes

- [#74](https://github.com/tktcorporation/.github/pull/74) [`64b3475`](https://github.com/tktcorporation/.github/commit/64b3475c39362cadc4a332fa3eeb91c7f5d8c12f) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat: add `track` command for non-interactive file tracking management

  AI エージェントが非インタラクティブにファイルパターンを `.devenv/modules.jsonc` のホワイトリストに追加できる `track` コマンドを追加。

  - `npx @tktco/create-devenv track ".cloud/rules/*.md"` でパターン追加（モジュール自動検出）
  - `--module` オプションで明示的にモジュール指定可能
  - 存在しないモジュールは自動作成（`--name`, `--description` でカスタマイズ可能）
  - `--list` で現在の追跡モジュール・パターン一覧を表示
  - AI agent guide にドキュメントを追加

### Patch Changes

- [#72](https://github.com/tktcorporation/.github/pull/72) [`c8beabc`](https://github.com/tktcorporation/.github/commit/c8beabcff2048bb932d0f5de34cf0ca552cc8d9d) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix(devcontainer): use Docker-compliant volume name for pnpm-store

  devcontainer 起動時の volume 名エラーを修正。`.github` というリポジトリ名により、`${localWorkspaceFolderBasename}-pnpm-store` が `.github-pnpm-store` に展開され、Docker の命名規則に違反していた問題を解決。`devcontainer-` プレフィックスを追加することで命名規則に準拠。

## 0.9.1

### Patch Changes

- [#69](https://github.com/tktcorporation/.github/pull/69) [`6ea205a`](https://github.com/tktcorporation/.github/commit/6ea205a2632b73cd20ba798e7ce7cea08e92fcb9) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Show AI agent hint in default command output

  When running `create-devenv` without arguments, the output now includes a hint for AI agents pointing them to the `ai-docs` command for non-interactive usage documentation.

## 0.9.0

### Minor Changes

- [#65](https://github.com/tktcorporation/.github/pull/65) [`03464f3`](https://github.com/tktcorporation/.github/commit/03464f39cf516de0e0018c58a5ab37246fa94764) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat(create-devenv): add ai-docs command for LLM-friendly documentation
  - Add `ai-docs` subcommand that outputs comprehensive documentation for AI coding agents
  - Create unified documentation source (src/docs/ai-guide.ts) for both CLI and README
  - Add "For AI Agents" section to README with non-interactive workflow instructions
  - Integrate ai-docs command into CLI help output

## 0.8.0

### Minor Changes

- [#61](https://github.com/tktcorporation/.github/pull/61) [`41ea99b`](https://github.com/tktcorporation/.github/commit/41ea99b9c0ed8f9fbe88c976735577cece92636c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Add AI-agent friendly manifest-based push workflow

  - `--prepare` option: Generates a YAML manifest file (`.devenv-push-manifest.yaml`) for reviewing and editing file selections
  - `--execute` option: Creates a PR based on the manifest file without interactive prompts

  This enables AI agents (like Claude Code) to handle the push workflow by reading/editing the manifest file, rather than requiring interactive CLI input.

## 0.7.1

### Patch Changes

- [#51](https://github.com/tktcorporation/.github/pull/51) [`71d6e04`](https://github.com/tktcorporation/.github/commit/71d6e04edd297f79e56d1a6df40262da2e22d2a4) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat(init): gitignore 対象ファイルの同期時の挙動を改善

  - init 時に gitignore 対象のファイルがローカルに既存在する場合、上書きせずスキップして警告を表示
  - gitignore 対象のファイルがローカルに存在しない場合は、通常通りコピー
  - push 時は gitignore 対象ファイルを追跡対象から除外（既存の動作を維持）

  これにより、ローカルで編集した gitignore 対象ファイル（環境設定など）がテンプレート同期時に上書きされることを防止します。

- [#50](https://github.com/tktcorporation/.github/pull/50) [`f70e506`](https://github.com/tktcorporation/.github/commit/f70e50601bcedb3a19054463b11b6e77d83df3c8) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix(create-devenv): fix stdin conflict between @inquirer/prompts and interactive diff viewer
  - Clear existing keypress listeners before setting up interactive viewer to prevent conflicts with @inquirer/prompts
  - Call stdin.resume() to ensure stdin is in correct state after @inquirer/prompts usage
  - Properly restore stdin state in cleanup for subsequent prompts

## 0.7.0

### Minor Changes

- [#45](https://github.com/tktcorporation/.github/pull/45) [`4557ba0`](https://github.com/tktcorporation/.github/commit/4557ba09b019d2f8f0dbaad3f274d6c4e56c9731) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat(create-devenv): improve diff display with summary box and interactive viewer

  - Add new diff-viewer.ts with modern box-styled summary display
  - Show file changes grouped by type (added/modified/deleted) with line stats
  - Add interactive diff viewer with n/p navigation between files
  - Improve file selection UI with stats display

- [#45](https://github.com/tktcorporation/.github/pull/45) [`09b8e2e`](https://github.com/tktcorporation/.github/commit/09b8e2ebc31d44e1a771ef034fc8c5ed7a1e8edc) Thanks [@tktcorporation](https://github.com/tktcorporation)! - feat(create-devenv): add word-level diff and syntax highlighting
  - Word-level diff: highlight changed words with background colors
  - Syntax highlighting: automatic language detection based on file extension
  - Supports 30+ languages including TypeScript, JavaScript, JSON, YAML, etc.

### Patch Changes

- [#47](https://github.com/tktcorporation/.github/pull/47) [`052075d`](https://github.com/tktcorporation/.github/commit/052075dd830d4ccc8eae4b949a73db164e903df7) Thanks [@tktcorporation](https://github.com/tktcorporation)! - テストを大幅に拡充

  - config.ts: 設定ファイルの読み書きテスト
  - patterns.ts: パターンマッチングとマージのテスト
  - modules/schemas.ts: Zod スキーマバリデーションテスト
  - modules/loader.ts: modules.jsonc ローダーテスト
  - modules/index.ts: モジュールヘルパー関数テスト
  - untracked.ts: 未追跡ファイル検出テスト
  - readme.ts: README 生成テスト
  - diff-viewer.ts: 差分表示テスト
  - github.ts: GitHub API 連携テスト

  テスト数: 40 → 209 (+169 テスト)

## 0.6.0

### Minor Changes

- [#43](https://github.com/tktcorporation/.github/pull/43) [`6685140`](https://github.com/tktcorporation/.github/commit/66851404ab3aa2bb325dcf642460648213f56d2c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - Improve CLI output with modern, user-friendly design
  - Add step-by-step progress indicators (e.g., [1/3], [2/3])
  - Add spinners for async operations (template download, diff detection)
  - Improve file operation results display with colored icons
  - Add summary section showing added/updated/skipped counts
  - Add "Next steps" guidance after successful operations
  - Add colored diff output with visual summary
  - Use consistent styling across all commands (init, push, diff)
  - Replace consola with picocolors + nanospinner for better UX

## 0.5.1

### Patch Changes

- [#34](https://github.com/tktcorporation/.github/pull/34) [`d142d5a`](https://github.com/tktcorporation/.github/commit/d142d5ad3b091ad33c1532c701c3b52609739bed) Thanks [@tktcorporation](https://github.com/tktcorporation)! - ツールチェーンを oxc エコシステムに移行
  - Biome → oxlint + oxfmt に移行
  - tsc --noEmit → oxlint --type-check に移行
  - unbuild → tsdown に移行

## 0.5.0

### Minor Changes

- [#32](https://github.com/tktcorporation/.github/pull/32) [`69db290`](https://github.com/tktcorporation/.github/commit/69db290f4757f65910f41f4557847c3e3d94540c) Thanks [@tktcorporation](https://github.com/tktcorporation)! - README 自動生成機能を追加
  - `pnpm run docs` で README のセクション（機能一覧・コマンド・生成ファイル）を自動生成
  - push コマンド実行時に README を自動更新して PR に含める
  - デフォルトコマンドをインタラクティブ選択に変更
  - 開発者向けドキュメントを CONTRIBUTING.md に移動

## 0.4.1

### Patch Changes

- [#26](https://github.com/tktcorporation/.github/pull/26) [`c490325`](https://github.com/tktcorporation/.github/commit/c4903250a0a7f8f84dae429ac5d7536b02af019f) Thanks [@tktcorporation](https://github.com/tktcorporation)! - ホワイトリスト追加フローを改善
  - ファイル選択 UI を罫線付きツリー形式に変更し、ディレクトリ構造を視覚化
  - ホワイトリスト追加後に moduleList を再パースし、新規ファイルが即座に PUSH 対象に含まれるように修正

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
