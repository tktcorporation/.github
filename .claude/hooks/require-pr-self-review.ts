#!/usr/bin/env bun
import { readReviewCount } from './review-count.ts';
const required = 2;
const count = await readReviewCount();
if (count < required) {
  const remaining = required - count;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `PR作成をブロックしました。セルフレビューがあと${remaining}回必要です（現在 ${count}/${required} 回完了）。codex review --uncommitted を確認・修正後、bun .claude/hooks/record-pr-review.ts で記録し、必要回数まで繰り返してください。`,
      },
    }),
  );
}
