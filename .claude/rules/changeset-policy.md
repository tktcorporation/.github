# Changeset 運用ポリシー

このリポジトリの changeset は **release pipeline 全体の起点**。空 frontmatter と bump 付きでは挙動が決定的に変わるため、選択を間違えると「変更が merge されてもユーザーに届かない」事故が起きる。

## 仕組み (なぜ厳格に分ける必要があるか)

`changeset version` は `.changeset/config.json` の `fixed` で束ねた 3 つの JS package (`@discord-tts-bot/shared` / `discord-tts-web-ui` / `discord-tts-bot-worker`) を **常に同一版** に bump する。bump はそのまま下流に連鎖する:

```
.changeset/*.md (bump あり)
  → packages/shared/package.json::version 更新
  → sync-cargo-version.mjs が Cargo.toml::[package].version を上書き
  → create-release-tag.mjs が v<version> タグを push
  → release.yml: Rust binary をビルドして GitHub Release 公開
  → register-commands.yml: 新 binary で Discord に slash command を再登録
  → deploy-machines.yml: Fly Machine をデプロイ
```

**空 frontmatter の changeset は `changeset version` が何も bump しない**。タグも release も発火せず、Rust binary も Fly Machine も古いまま。CHANGELOG にも残らない。

## どちらを選ぶか

| 変更の性質 | 採用 | 例 |
|---|---|---|
| **runtime artifact (Rust binary / JS worker / Web UI) の挙動が変わる** | **bump 必須** | slash command 文言変更 / コマンド追加 / 課金ロジック修正 / UI 文言変更 / TTS engine 挙動変更 |
| **runtime artifact に一切影響しない** (CI 設定 / dev tooling / docs / test infra / .claude/) | **空 frontmatter** | workflow yml 修正 / changeset config 変更 / `.claude/rules/` 編集 / vitest setup 追加 |

判断に迷ったら **bump 付きに倒す**。空 frontmatter にしたい誘惑は、release が止まる事故より体感的に小さい。

### Rust-only 変更でも bump が必要

Rust 側だけ変えた PR でも、binary の挙動が変わるなら fixed package を bump する。`sync-cargo-version.mjs` の連鎖を発火させて Discord に新 binary を register し直すために、JS package の version bump が必要。

「Rust だから JS package を bump するのは不自然」という感覚で空 frontmatter にすると、Rust binary が release されず変更がユーザーに届かない。

## bump level の選び方

`fixed` 3 package すべてに同じ level を指定する (どれか 1 つでも書けば連動 bump するが、列挙する方が release PR の diff が読みやすい)。

| level | 該当例 |
|---|---|
| `patch` | バグ修正 / 文言調整 / 既存機能の polish / i18n の翻訳追加 |
| `minor` | 新コマンド追加 / 新 env / 新 page / バックワード互換の新機能 |
| `major` | 互換破壊 (現状の運用では稀。新 major を切る前にチームで合意) |

過去の bump 例は `CHANGELOG.md` を参照する (例: `/language` 追加 = minor、i18n fallback 修正 = patch)。

## frontmatter の書き方

### bump あり (推奨デフォルト)

```markdown
---
"@discord-tts-bot/shared": patch
"discord-tts-web-ui": patch
"discord-tts-bot-worker": patch
---

feat(bot): slash command に ja name_localizations を追加

- 変更内容を箇条書きで WHY 中心に
- WHAT は diff が語るので最小限
```

### 空 frontmatter (CI / docs / dev tooling のみ)

```markdown
---
---

ci(workflows): release.yml の cache scope を再分割

- 内容 (release pipeline には影響しない理由を含める)
```

空にする場合は本文に「runtime artifact に影響しない」根拠を含めると、後追いレビューで判断がブレない。

## ファイル名

`.changeset/<topic-kebab-case>.md`。changesets CLI が生成するランダム名 (例: `nice-rabbits-jump.md`) でもよいが、grep しやすい topic 名のほうが後追いしやすい。

## レビュー時のセルフチェック

PR を出す直前に:

1. この PR は runtime artifact (Rust / Workers) の挙動を変えるか?
2. yes → `.changeset/*.md` の frontmatter に 3 package と bump level が並んでいるか?
3. no → 空 frontmatter で OK か (CI / dev tooling / docs / test infra のみか)?

`ci-workflow.md` のチェックリストにも反映済み。
