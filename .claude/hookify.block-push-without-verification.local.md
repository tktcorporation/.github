---
name: block-push-without-verification
enabled: true
event: bash
pattern: (jj\s+git\s+push|git\s+push)
action: warn
---

**プッシュをブロックしました。**

`.claude/rules/ci-workflow.md` を読み、「プッシュ前の必須手順」を **すべて** 完了してからプッシュしてください。
