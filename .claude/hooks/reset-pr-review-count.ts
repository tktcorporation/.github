#!/usr/bin/env bun
import { $ } from 'bun';
import { reviewCountFile } from './review-count.ts';
await $`rm -f ${await reviewCountFile()}`;
