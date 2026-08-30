#!/usr/bin/env bun
import { readReviewCount, reviewCountFile } from './review-count.ts';
const count = (await readReviewCount()) + 1;
await Bun.write(await reviewCountFile(), `${count}\n`);
console.log(`セルフレビュー ${count} 回目を記録しました。`);
