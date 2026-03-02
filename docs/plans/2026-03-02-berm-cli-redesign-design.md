# berm CLI 再設計

## 背景

berm は開発環境テンプレートの管理 CLI。テンプレートリポジトリからファイルを取得し、ローカルの変更を PR として逆流させる。
現在の CLI は動作するが、出力が洗練されておらず、コードの構造もつぎはぎ。ゼロから再設計する。

## 現状の問題

### 出力

- `showLogo()` の `╔═══╗` ボックスが過剰。モダン CLI はミニマル
- `showHeader()`, `box()`, `showNextSteps()`, `showSummary()`, `diffHeader()` など似た関数が乱立
- `📦`, `🤖` の絵文字使用が不統一
- `console.log` が各コマンドに散在し、統一された出力レイヤーがない

### UX

- 引数なし実行 → select プロンプト → コマンド実行が冗長
- `push` が `--prepare` / `--execute` / `--interactive` / `--dry-run` / `--force` で分岐だらけ
- readline の raw mode を直接操作する diff ビューアが `@inquirer/prompts` と競合リスク
- プロンプト文言が日本語と英語で混在

### コード構造

- `push.ts` が 774 行。コマンド定義にビジネスロジックが内包
- `diff-viewer.ts` が 682 行。統計計算・word diff・syntax highlight・UI が混在
- `ui.ts` が全部入りユーティリティ
- `citty` + `@inquirer/prompts` + `nanospinner` + `picocolors` + `cli-highlight` + `consola` の 6 ライブラリ混在

## 設計

### UI ライブラリ: `@clack/prompts` に統一

`@inquirer/prompts` + `nanospinner` + 自作 `ui.ts` を `@clack/prompts` 1 本に置き換える。

理由:

- intro / outro / log.info / log.success / log.warn / log.error / spinner が組み込み
- `│` のステップバーで視覚的階層が自然に出る
- `create-t3-app`, `svelte create` 等のモダン CLI で採用実績あり
- `picocolors` を内部で使用しており既存コードと互換

### 出力イメージ

```
┌  berm v0.13.0
│
◇  Template: tktcorporation/.github
│
◆  Select modules to install
│  ◻ devcontainer  - Dev Container configuration
│  ◻ github-actions - CI/CD workflows
│  ◻ editor-config  - Editor settings
│
◇  Selected 3 modules
│
◆  How to handle existing files?
│  ● Ask for each file
│  ○ Overwrite all
│  ○ Skip all
│
◇  Applying templates...
│
│  + .github/workflows/ci.yml
│  + .devcontainer/devcontainer.json
│  ~ .editorconfig
│  3 added, 1 updated
│
└  Done! Run `git add . && git commit` to save changes.
```

### アーキテクチャ

```
src/
├── cli.ts                    # エントリポイント（ルーティングのみ）
├── errors.ts                 # BermError 定義
├── commands/
│   ├── init.ts              # init（薄いオーケストレーター）
│   ├── push.ts              # push（薄いオーケストレーター）
│   ├── diff.ts              # diff
│   └── track.ts             # track
├── core/                     # ビジネスロジック（UI 非依存）
│   ├── template.ts          # テンプレート DL・パターン解決
│   ├── diff.ts              # 差分検出（純粋関数）
│   ├── modules.ts           # モジュール管理（既存 modules/ を統合）
│   ├── manifest.ts          # マニフェスト管理
│   ├── github.ts            # GitHub API
│   └── config.ts            # .devenv.json 読み書き
├── ui/                       # 表示層
│   ├── renderer.ts          # @clack/prompts ラッパー（intro, log, spinner）
│   ├── prompts.ts           # 全プロンプト
│   └── diff-view.ts         # diff 表示（word diff + syntax highlight）
└── types.ts                  # 共通型
```

**変更の要点:**

- `utils/` を廃止し `core/`（ロジック）と `ui/`（表示）に分離
- `modules/` ディレクトリを `core/modules.ts` に統合
- `prompts/init.ts` + `prompts/push.ts` → `ui/prompts.ts` に統合
- 各コマンドは 100 行以下のオーケストレーターに

### エラーハンドリング

```typescript
/** ユーザー向けエラー。hint でリカバリ方法を伝える */
class BermError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "BermError";
  }
}
```

- 各コマンドは `BermError` を throw
- `cli.ts` のトップレベルで catch → `log.error()` + hint 表示
- `process.exit(1)` は `cli.ts` の 1 箇所のみ

### コマンド体系の簡素化

**init**: 変更なし（フラグ構成はそのまま）

**push**: フラグを整理

- `--prepare` → `--manifest` に改名（意図が明確）
- `--execute` → `--from-manifest <path>` に改名
- `--interactive` (デフォルト true) → 削除。常にインタラクティブ
- `--force` → `--yes` に改名（gh, npm 等の慣習に合わせる）
- `--dry-run` → そのまま

**diff**: 変更なし

**track**: 変更なし

**引数なし実行**: select プロンプトを廃止。`--help` を表示するのみ

### 依存ライブラリ

| ライブラリ          | 操作 | 理由                                         |
| ------------------- | ---- | -------------------------------------------- |
| `@inquirer/prompts` | 削除 | `@clack/prompts` に置き換え                  |
| `nanospinner`       | 削除 | `@clack/prompts` の spinner に統合           |
| `consola`           | 削除 | 未使用                                       |
| `cli-highlight`     | 削除 | diff 表示をシンプルにする。picocolors で十分 |
| `@clack/prompts`    | 追加 | 統一 UI                                      |
| `picocolors`        | 継続 | @clack/prompts と互換                        |
| `citty`             | 継続 | コマンド定義                                 |
| その他              | 継続 | diff, giget, zod, ts-pattern 等              |

### diff ビューア

現在の readline raw mode によるインタラクティブビューアは削除。代わりに:

- `berm diff` → ターミナルに直接出力（`less` にパイプ可能）
- `berm push` → サマリー表示 + 「詳細を見ますか？」→ 各ファイルの diff を順次表示
- word diff と syntax highlight は維持するが、`cli-highlight` を削除し picocolors ベースの軽量実装に

### 言語

CLI 出力は英語に統一。プロンプト文言も英語。
