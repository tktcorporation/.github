import { Box, Text } from 'ink';
import React from 'react';
import type { FleetRow } from '../model/row';
import { wrapLines } from './format';

const LABEL_WIDTH = 12;
// 詳細ペインの行数は App 側の listHeight 計算が固定の見積り（DETAIL_RESERVE）に
// 使うため、内容がどれだけ長くても超えないよう総行数の上限を1箇所に固定する。
// 予算は項目間で共有せず、項目ごとに固定の上限を割り当てる。共有予算だと
// 前の項目（元の指示など）が長いだけで後続の項目（場所・移動など）が
// まるごと描画されなくなるため、フィールドごとの上限の合計を DETAIL_MAX_LINES に保つ。
export const DETAIL_MAX_LINES = 12;
const FIELD_MAX_LINES = {
  元の指示: 3,
  最新の指示: 1,
  いま: 2,
  要判断: 2,
  モデル: 1,
  場所: 1,
  成果物: 1,
  移動: 1,
} as const;

export function Detail({ row, width }: { row: FleetRow | null; width: number }) {
  if (!row) return <Text dimColor> 行を選ぶと詳細が出る</Text>;
  const location = `${row.location.display}${row.location.branch ? `  branch ${row.location.branch}` : ''}${row.location.paneId ? `  pane ${row.location.paneId}` : ''}`;
  // 成果物は改行区切りだと wrapLines の空白正規化で潰れるため、区切りは読点にする。
  const artifacts = row.artifacts.map((a) => `${a.kind.toUpperCase()} #${a.id} ${a.href}`).join(', ') || null;
  const attachHint = row.attach.type === 'hint' ? row.attach.text : null;
  const statusLine = row.statusNote ? `${row.status}（${row.statusNote}）` : null;

  const fields: { label: keyof typeof FIELD_MAX_LINES; value: string | null }[] = [
    { label: '元の指示', value: row.originalPrompt },
    { label: '最新の指示', value: row.latestPrompt },
    { label: 'いま', value: row.activity },
    { label: 'モデル', value: row.model },
    { label: '要判断', value: row.pending ? `[${row.pending.kind}] ${row.pending.text ?? ''}` : null },
    { label: '場所', value: location },
    { label: '成果物', value: artifacts },
    { label: '移動', value: attachHint },
  ];

  const valueWidth = Math.max(10, width - LABEL_WIDTH - 2);
  const rendered: { label: string; lines: string[] }[] = [];
  if (statusLine) rendered.push({ label: '状態', lines: [statusLine] });
  for (const field of fields) {
    if (!field.value) continue;
    const lines = wrapLines(field.value, valueWidth, FIELD_MAX_LINES[field.label]);
    if (lines.length === 0) continue;
    rendered.push({ label: field.label, lines });
  }

  return (
    <Box flexDirection="column">
      {rendered.map(({ label, lines }) => (
        <Box key={label}>
          <Box width={LABEL_WIDTH}>
            <Text dimColor>{label}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {lines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
