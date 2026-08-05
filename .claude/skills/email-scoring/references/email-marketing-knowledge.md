# メールマーケティング知識ベース

本ファイルは email-scoring スキルの分析精度を高めるための背景知識。
業界のベストプラクティスと Gmail の分類シグナルに関する統合的な知見を収録する。

> **出典**: 業界リサーチ（GlockApps, Moosend, Mailjet 等）、
> [jacquescorbytuech/email-marketing-skill](https://github.com/jacquescorbytuech/email-marketing-skill)、
> [CosmoBlk/email-marketing-bible](https://github.com/CosmoBlk/email-marketing-bible)、
> Google 公式送信者ガイドライン、Intercom 公式ヘルプを統合・検証したもの。

---

## 1. Gmail タブ分類の仕組み

### 分類の基本原理

Gmail は機械学習ベースで受信メールを Primary / Social / Promotions / Updates / Forums に分類する。
アルゴリズムは非公開だが、業界の逆算的実験から以下のシグナルが特定されている。

### シグナル重み（推定）

| 優先度 | シグナル | 説明 |
|--------|---------|------|
| **最高** | 受信者のエンゲージメント履歴 | 過去の開封・クリック・返信・移動操作。**静的解析では評価不可** |
| **最高** | コンテンツの語彙・トーン | プロモーション的な語彙の密度、マーケティングトーン |
| **高** | 送信パターン | 同一送信者から短時間に大量送信されたか（BroadcastMailer 等） |
| **高** | ヘッダー情報 | List-Unsubscribe, Precedence, X-Mailer 等のバルク送信シグナル |
| **高** | 件名の特徴 | 絵文字、煽り表現、金銭語彙 |
| **中** | HTML 構造 | 画像/テキスト比率、テンプレート構造、CTA ボタン数 |
| **中** | リンク構造 | トラッキング URL の比率、リンク総数 |
| **低** | 送信インフラ | ESP の種類、IP レピュテーション |

### 2025年9月の変更

Gmail は Promotions タブ内のソート順を時系列 → **関連性順（Relevance ranking）** に変更した。
これにより Promotions タブに入ること自体のデメリットは相対的に低下し、
「Promotions タブ内でどれだけ上位に表示されるか」が新たな重要指標になった。

### Promotions タブは「悪」ではない

email-marketing-skill の重要な指摘:
> マーケティングメールが Promotions に分類されること自体は Gmail の意図した動作。
> Promotions タブの受信者は**購買意欲が高い状態**でメールを閲覧している。
> Primary への回避を試みるよりも、Promotions タブ内での表示品質（Gmail Annotations 等）に注力すべき。

ただし、**トランザクショナルメール**（パスワードリセット、注文確認等）や
**製品の個人通知**（あなたのスコアが更新されました等）が Promotions に入る場合は問題。
「メールの意図に対して適切なタブか？」が判断基準。

---

## 2. Deliverability の基本

### 認証プロトコル

| プロトコル | 役割 | 必須度 |
|-----------|------|--------|
| **SPF** | 送信元 IP の正当性を検証 | 必須 |
| **DKIM** | メール内容の改ざん検知（2048bit 鍵推奨） | 必須 |
| **DMARC** | SPF/DKIM の結果に基づくポリシー適用 | 必須（段階的に p=none → quarantine → reject） |
| **BIMI** | ブランドロゴの表示（DMARC p=quarantine 以上が前提） | 推奨 |

### Google 公式送信者ガイドライン（2024年2月〜）

5,000通/日以上の Bulk Sender に対する要件:
- SPF + DKIM + DMARC（p=none 以上）の全認証必須
- `List-Unsubscribe` + `List-Unsubscribe-Post`（RFC 8058 ワンクリック解除）必須
- スパム苦情率 0.3% 未満を維持
- TLS 接続による送信

### Intercom 固有の考慮事項

- Intercom は Mailgun を送信インフラとして使用
- `X-Intercom-Mailer` ヘッダーで送信種別を識別可能:
  - `BroadcastMailer` — 一斉配信（マーケティング用途）
  - `ConversationMailer` — 1対1のメッセージ
- Intercom 公式が「Intercom から送るメールは Promotions に入りやすい」と認めている
- 全リンクに `<workspace>.intercom-clicks.com` 形式のクリックトラッキングドメイン（テナントごとに固有のサブドメイン）が自動付与される

---

## 3. コピーライティングのベストプラクティス

### 件名

| 原則 | 説明 |
|------|------|
| **送信者名 > 件名** | 開封の最大要因は「誰から来たか」。件名は二番目 |
| **明確さ > 巧みさ** | 中身が分かる件名が最も強い。クリックベイトは短期的 |
| **パーソナライズ** | 名前だけでなく、行動・状態に基づく個別化が効果的 |
| **長さ** | 30-50文字が目安。モバイルでは40文字程度で切れる |
| **絵文字** | 1つ程度なら効果的な場合もあるが、複数使用は逆効果 |

### 避けるべきパターン
- Re: / Fwd: の偽装（信頼を損なう + 一部フィルタで検出される）
- ALL CAPS（英語圏）/ 過度な「！」「？」の連続
- 件名と本文の不一致（クリックベイト）

### CTA（Call to Action）

| 原則 | 説明 |
|------|------|
| **主要 CTA は1つ** | 選択肢が多いほどクリック率は下がる（Hick の法則） |
| **アクション動詞で始める** | 「〇〇をみてみる」「〇〇を始める」> 「詳細はこちら」 |
| **ファーストビューに配置** | スクロール不要な位置に主要 CTA を置く |
| **視覚的に目立つ** | 十分なコントラスト、適切なサイズ（最低44x44pxのタップターゲット） |

---

## 4. メール構造のベストプラクティス

### 画像とテキストのバランス

- **画像だけのメール**は Promotions/Spam リスクが最も高い
- 推奨比率: テキスト 60% / 画像 40%（厳密な基準はないが目安として）
- すべての画像に `alt` テキストを設定する（画像ブロック時の代替表示 + アクセシビリティ）
- トラッキングピクセル（1x1画像）は一般的だが、Gmail の分類シグナルになり得る

### モバイル最適化

- メール開封の **60%以上** がモバイルデバイス
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` 必須
- フォントサイズ最低14px（本文）、22px以上（見出し）
- CTA ボタンは最低44x44pxのタップターゲット
- シングルカラムレイアウト推奨

### multipart/alternative

- `text/plain` パートを含める（プレーンテキスト版）
- HTML only のメールはスパムフィルタで不利になる場合がある

---

## 5. コンプライアンス要件

### 日本（特定電子メール法）

- 送信者の氏名・名称
- 送信者の連絡先（メールアドレスまたは URL）
- 配信停止の方法（リンクまたは連絡先）
- オプトイン同意の記録保存

### CAN-SPAM（米国・国際的なデファクト標準）

- 送信者の物理住所
- 明確な配信停止方法（10営業日以内に処理）
- 商用メールであることの明示
- 件名が内容を正確に反映

### GDPR（EU）

- 明示的な同意（事前チェック済みのチェックボックスは不可）
- データ処理の法的根拠
- 配信停止 + データ削除の権利

### RFC 8058（List-Unsubscribe-Post）

Google が Bulk Sender に要求するワンクリック配信停止の技術仕様。
`List-Unsubscribe` ヘッダーに加えて `List-Unsubscribe-Post: List-Unsubscribe=One-Click` を含める。

---

## 6. 指標の基本

### 主要指標

| 指標 | 定義 | 備考 |
|------|------|------|
| **開封率** | 開封数 / 配信数 | Apple MPP 以降は精度低下。参考値として |
| **クリック率 (CTR)** | クリック数 / 配信数 | |
| **CTOR** | クリック数 / 開封数 | コンテンツ品質の指標として開封率より有用 |
| **配信停止率** | 配信停止数 / 配信数 | 0.5% 超は要注意 |
| **スパム苦情率** | 苦情数 / 配信数 | Google 要件: 0.3% 未満 |

### 業界ベンチマーク（目安）

| 指標 | 良好 | 平均 | 要注意 |
|------|------|------|--------|
| 開封率 | 25%+ | 15-25% | <15% |
| CTR | 3%+ | 1-3% | <1% |
| CTOR | 15%+ | 8-15% | <8% |
| 配信停止率 | <0.2% | 0.2-0.5% | >0.5% |

---

## 7. 参考リソース

### 公式
- [Google Email Sender Guidelines](https://support.google.com/a/answer/81126)
- [Intercom: Deliverability and the Gmail Promotions Tab](https://www.intercom.com/help/en/articles/3532886)
- [RFC 8058: One-Click Unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058)

### 業界リサーチ
- [GlockApps: Gmail's Promotions Tab: How It Works](https://glockapps.com/blog/gmails-promotions-tab-how-it-works-and-how-to-avoid-emails-going-there/)
- [Moosend: Gmail Promotions Tab Guide](https://moosend.com/blog/gmail-promotions-tab/)
- [Mailjet: Gmail Promotions Tab Complete Guide](https://www.mailjet.com/blog/deliverability/gmail-promotions-tab/)

### Claude Code スキル（参考にした既存スキル）
- [jacquescorbytuech/email-marketing-skill](https://github.com/jacquescorbytuech/email-marketing-skill) — MIT License。Deliverability/Copywriting 知見が正確
- [CosmoBlk/email-marketing-bible](https://github.com/CosmoBlk/email-marketing-bible) — MIT License。Benchmark/Automation 知見を参考（プロダクト宣伝部分は除外）
