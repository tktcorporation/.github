import { Box, Text } from 'ink';
import React from 'react';
import type { FleetRow } from '../model/row';
import { formatAge, padDisplay, shortModel, statusColor, statusGlyph, truncate } from './format';

type RowLineProps = { row: FleetRow; selected: boolean; now: number; width: number };

// 1行に並べる各セグメントの表示幅。summary 列の残り幅は「行全体の幅 − これらの合計」
// で決まるため、age（右寄せ4桁分）を含め漏れなく数える。ここに含めないぶんだけ
// summary が伸び、行末で age がはみ出す（実機で "3s" が "3" に見えるなど）。
const SELECT_PREFIX_WIDTH = 3; // ' ▶ ' / '   '
const GLYPH_WIDTH = 1;
const AGENT_WIDTH = 6;
const KIND_WIDTH = 3; // 'bg ' / 'int'
const MODEL_WIDTH = 7;
const NAME_WIDTH = 22;
const AGE_WIDTH = 4; // formatAge().padStart(4)
const SEPARATOR_COUNT = 6; // glyph/agent/kind/model/name/summary の後ろに置く半角スペース
const FIXED_WIDTH =
  SELECT_PREFIX_WIDTH + GLYPH_WIDTH + AGENT_WIDTH + KIND_WIDTH + MODEL_WIDTH + NAME_WIDTH + AGE_WIDTH + SEPARATOR_COUNT;
const MIN_SUMMARY_WIDTH = 10;

export function RowLine({ row, selected, now, width }: RowLineProps) {
  const summaryWidth = Math.max(MIN_SUMMARY_WIDTH, width - FIXED_WIDTH);
  const summary = row.pending?.text ?? row.activity ?? (row.status === 'idle' ? '(idle)' : '');
  const notePrefix = row.statusNote ? `[${row.statusNote}] ` : '';
  const summaryPrefix = notePrefix + (row.status === 'done' ? '完了: ' : row.status === 'blocked' ? '要判断: ' : '');
  return (
    <Box>
      <Text inverse={selected}>
        {selected ? ' ▶ ' : '   '}
        <Text color={statusColor(row.status)}>{statusGlyph(row.status)}</Text>
        {' '}{row.agent.padEnd(AGENT_WIDTH)} {row.kind === 'background' ? 'bg ' : 'int'} {padDisplay(shortModel(row.model), MODEL_WIDTH)} {padDisplay(truncate(row.name, NAME_WIDTH), NAME_WIDTH)} {padDisplay(truncate(summaryPrefix + summary, summaryWidth), summaryWidth)} {formatAge(row.updatedAt, now).padStart(AGE_WIDTH)}
      </Text>
    </Box>
  );
}

export function GroupHeader({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <Text bold>
      {' '}{title} ({count}){hint ? `  ${hint}` : ''}
    </Text>
  );
}
