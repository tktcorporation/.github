# berm CLI 再設計プラン

## 現状の問題分析

### 1. 出力が素人っぽい

- `showHeader()` のロゴ表示が装飾過多（╔═══╗ボックスなど）→ モダンCLIはもっとミニマル
- `console.log` が散在。統一された出力レイヤーがない
- 絵文字の使い方が不統一（📦、🤖 がハードコードされたり、Unicodeシンボルだったり）
- `showNextSteps()` や `box()` など、異なるフォーマット関数が多すぎて一貫性がない
- AI hint の表示が `─` の区切り線で囲まれていて素人感がある

### 2. UX が使いにくい / フローが硬い

- サブコマンドなしで実行 → `select` プロンプト → サブコマンド実行、というフローが回りくどい
- `push` コマンドが巨大すぎ（774行）で、`--prepare`/`--execute`/`--interactive`/`--dry-run` の分岐が複雑
- `push` のインタラクティブ diff ビューアが readline の raw mode を直接操作していて、`@inquirer/prompts` と競合リスク
- プロンプトが日本語/英語混在（prompts/init.ts は日本語、prompts/push.ts も日本語、でもCLI出力は英語）
- エラー時に `process.exit(1)` をハードコールしていて、テスタビリティが低い

### 3. コードの設計がつぎはぎ

- `ui.ts` が万能ユーティリティ化（log, spinner, step, box, diff表示, ファイル結果表示が全て同居）
- `diff-viewer.ts` が500行超の巨大ファイルで、統計計算・フォーマット・word diff・syntax highlight・インタラクティブビューアが混在
- `push.ts` が command 定義ファイルなのにビジネスロジック（detectLocalModuleAdditions、runExecuteMode）が内包
- 状態（config, moduleList, diff結果, 選択ファイル等）が関数引数としてバケツリレーされている
- `citty` と `@inquirer/prompts` と `nanospinner` と `picocolors` の4つのUI系ライブラリが混在

---

## 再設計方針

### コンセプト: `@clack/prompts` ベースの統一的 CLI UX

参考ツール: **`create-t3-app`**, **`giget`**, **`changesets`**, **`@clack/prompts` のデモ**

`@clack/prompts` は `@inquirer/prompts` の代替で、以下の利点がある:

- 一貫した美しい出力デザイン（ステップバー、スピナー、グループプロンプト）
- log.info / log.success / log.warn / log.error が組み込み
- intro / outro による自然な開始・終了
- グループ化された出力で視覚的階層が明確

### アーキテクチャ

```
src/
├── cli.ts                    # エントリポイント（コマンドルーティングのみ）
├── commands/
│   ├── init.ts              # init コマンド（薄いオーケストレーター）
│   ├── push.ts              # push コマンド（薄いオーケストレーター）
│   ├── diff.ts              # diff コマンド（薄いオーケストレーター）
│   └── track.ts             # track コマンド
├── core/                     # ビジネスロジック層（UI非依存）
│   ├── template.ts          # テンプレートDL・パターン解決
│   ├── diff.ts              # 差分検出（純粋関数）
│   ├── modules.ts           # モジュール管理
│   ├── manifest.ts          # マニフェスト管理
│   ├── github.ts            # GitHub API操作
│   └── config.ts            # 設定読み書き
├── ui/                       # 表示層（@clack/prompts ベース）
│   ├── renderer.ts          # 統一出力インターフェース
│   ├── prompts.ts           # 全プロンプト定義
│   ├── diff-view.ts         # diff 表示コンポーネント
│   └── theme.ts             # カラー・シンボル定義
└── types.ts                  # 共通型定義
```

### 重要な設計変更

#### 1. 出力の統一: `@clack/prompts` へ移行

**Before** (現在):

```
berm v0.12.0
────────────────────────────────────
● Target: /path/to/project

[1/3] ◆ Fetching template...
✓ Downloading template from GitHub...
[2/3] ◆ Selecting modules...

[3/3] ◆ Applying templates...
  + .github/workflows/ci.yml (added)
  ~ .editorconfig (updated)
  - .prettierrc (skipped)

────────────────────────────────────
✓ Done! 3 added, 1 updated, 1 skipped

╭──────────────────╮
│ Setup complete!   │
╰──────────────────╯

Next steps:
  → git add . && git commit
    Commit the changes
```

**After** (再設計後):

```
◇  berm v0.12.0

◆  Where should we apply the template?
│  /path/to/project
│
◇  Template: tktcorporation/.github

◆  Select modules to install
│  ◻ devcontainer  - Dev Container configuration
│  ◻ github-actions - CI/CD workflows
│  ◻ editor-config  - Editor settings

◇  Selected 3 modules

◆  How to handle existing files?
│  ● Ask for each file
│  ○ Overwrite all
│  ○ Skip all

◇  Applying templates...

│  + .github/workflows/ci.yml
│  + .devcontainer/devcontainer.json
│  ~ .editorconfig
│  3 added, 1 updated

└  Done! Run `git add . && git commit` to save changes.
```

#### 2. コマンド体系の簡素化

現在の `push` コマンドの `--prepare`/`--execute` フラグを削除し、`push` の自然なフローに統合:

- `berm push` → インタラクティブに差分確認 → ファイル選択 → PR作成
- `berm push --dry-run` → 差分プレビューのみ
- `berm push --yes` → 確認スキップ（CI向け）

`--prepare`/`--execute` のAIエージェント向けワークフローは `berm push --manifest` で YAML を出力、`berm push --from-manifest <file>` で実行に統合。

#### 3. エラーハンドリングの統一

`process.exit(1)` を排除し、カスタムエラークラス + トップレベルの try-catch に統一:

```typescript
class BermError extends Error {
  constructor(message: string, public hint?: string) { ... }
}

// 各コマンド関数は BermError を throw
// cli.ts のトップレベルで catch して統一的にフォーマット
```

#### 4. 依存ライブラリ整理

**削除:**

- `@inquirer/prompts` → `@clack/prompts` に置き換え
- `nanospinner` → `@clack/prompts` の spinner に統合
- `consola` → 未使用（依存に残っているだけ）
- `cli-highlight` → diff表示をシンプルにし、必要最小限に

**継続:**

- `picocolors` → `@clack/prompts` が内部で使っていて互換性あり
- `citty` → コマンド定義に引き続き使用
- `ts-pattern` → パターンマッチング
- `zod` → バリデーション
- `diff` → diff生成
- `giget` → テンプレートDL

**追加:**

- `@clack/prompts` → 統一UI

---

## 実装ステップ

### Step 1: UI層の再構築

- `@clack/prompts` を追加
- `src/ui/theme.ts` を作成（カラー・シンボル定義）
- `src/ui/renderer.ts` を作成（intro/outro, log, spinner のラッパー）
- `src/ui/prompts.ts` を作成（全プロンプトを clack に移行）

### Step 2: コア層の分離

- `push.ts` 内のビジネスロジック（`detectLocalModuleAdditions`, `runExecuteMode`）を `core/` に移動
- `diff-viewer.ts` を `ui/diff-view.ts` にリファクタ（表示のみ担当、統計計算は `core/diff.ts`）
- `utils/manifest.ts` → `core/manifest.ts` に移動

### Step 3: コマンドの書き直し

- 各コマンドを薄いオーケストレーターに変更
- `init` コマンドの clack 化
- `push` コマンドの簡素化・clack 化
- `diff` コマンドの clack 化
- `track` コマンドの clack 化

### Step 4: エラーハンドリング統一

- `BermError` クラス作成
- `process.exit(1)` を全て排除
- トップレベルエラーハンドラ実装

### Step 5: テスト更新

- 既存テストの更新（新しいUI層をモック）
- 出力のスナップショットテスト追加

### Step 6: 不要な依存の削除

- `@inquirer/prompts` 削除
- `nanospinner` 削除
- `consola` 削除

### Step 7: ビルド確認・CI通過

- `pnpm build` 確認
- `pnpm test` 通過
- `npx oxfmt --check .` 通過
