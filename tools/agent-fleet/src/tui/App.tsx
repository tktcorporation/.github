import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceError } from '../collect/types';
import { loadAcks, saveAcks, withAck, type AckStore } from '../model/ack';
import { groupRows, type Groups } from '../model/group';
import type { FleetRow, Snapshot } from '../model/row';
import { Detail, DETAIL_MAX_LINES } from './Detail';
import { GroupHeader, RowLine } from './RowList';
import { StatusBar } from './StatusBar';
import { computeViewport } from './viewport';

export type AppProps = {
  collector: { collect(): Promise<Snapshot> };
  ackPath: string;
  intervalMs: number;
  now?: () => number;
  onOpen?: (row: FleetRow) => Promise<string | null>;
  initialSnapshot?: Snapshot;
};

const matchesFilter = (r: FleetRow, q: string) =>
  q === '' || [r.name, r.originalPrompt ?? '', r.location.display].some((s) => s.toLowerCase().includes(q.toLowerCase()));

// loadAcks は分類済みの SourceResult を返す。ack ファイルが読めなくても
// 一覧表示そのものは続けたいので、未確認扱い（空の AckStore）で起動しつつ
// 理由は StatusBar に出す。
function initialAckState(ackPath: string): { acks: AckStore; ackError: SourceError | null } {
  const r = loadAcks(ackPath);
  return r.ok ? { acks: r.value, ackError: null } : { acks: {}, ackError: r.error };
}

// 一覧・詳細を1画面ぶんに収めるための行数見積り（区切り線1行 + 詳細ペイン + StatusBar1行）。
// 詳細ペインの上限は Detail.tsx の DETAIL_MAX_LINES を単一の情報源として使う
// （ここで別の定数を持つと、詳細側の上限を変えたときに見積りだけずれて listHeight が壊れる）。
const DETAIL_RESERVE = DETAIL_MAX_LINES + 2;

type ListItem = { type: 'header'; key: string; title: string; count: number; hint?: string } | { type: 'row'; row: FleetRow };

function buildItems(groups: Groups, showOther: boolean): ListItem[] {
  const items: ListItem[] = [];
  const push = (key: string, title: string, rows: FleetRow[], collapsed: boolean, hint?: string) => {
    if (rows.length === 0) return;
    items.push({ type: 'header', key, title, count: rows.length, hint });
    if (!collapsed) for (const r of rows) items.push({ type: 'row', row: r });
  };
  push('h-pending', '要対応', groups.pending, false);
  push('h-working', '作業中', groups.working, false);
  push('h-idle', '待機', groups.idle, false);
  push('h-other', 'その他', groups.other, !showOther, showOther ? 'c で畳む' : 'c で展開');
  return items;
}

export function App({ collector, ackPath, intervalMs, now = () => Date.now(), onOpen, initialSnapshot }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot ?? null);
  const [{ acks, ackError }, setAckState] = useState(() => initialAckState(ackPath));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // collect() は herdr / claude / codex を横断して呼ぶため、timer の間隔より長くかかることがある。
  // 前回の収集が終わる前に次を投げると、遅れて届いた古い結果が新しい結果を上書きしうるので、
  // 直列化する（in-flight 中の自動更新は捨て、手動更新だけ「完了後にもう一度」を予約する）。
  // それでも保険として、収集ごとに連番を振り、適用済みより古い結果は捨てる。
  const collectingRef = useRef(false);
  const pendingManualRef = useRef(false);
  const seqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const runCollect = useCallback(async () => {
    const seq = ++seqRef.current;
    const s = await collector.collect();
    if (seq < appliedSeqRef.current) return; // 自分より新しいリクエストが既に適用済み
    appliedSeqRef.current = seq;
    setSnapshot(s);
  }, [collector]);

  const refresh = useCallback(
    async (manual = false) => {
      if (collectingRef.current) {
        if (manual) pendingManualRef.current = true;
        return;
      }
      collectingRef.current = true;
      try {
        await runCollect();
        while (pendingManualRef.current) {
          pendingManualRef.current = false;
          await runCollect();
        }
      } finally {
        collectingRef.current = false;
      }
    },
    [runCollect],
  );

  useEffect(() => {
    if (!initialSnapshot) void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs, initialSnapshot]);

  const current = now();
  const groups = useMemo(() => {
    const q = filter ?? '';
    const rows = (snapshot?.rows ?? []).filter((r) => matchesFilter(r, q));
    return groupRows(rows, acks, current);
  }, [snapshot, acks, filter, current, tick]);

  const visible = useMemo(
    () => [...groups.pending, ...groups.working, ...groups.idle, ...(showOther ? groups.other : [])],
    [groups, showOther],
  );
  const selectedIndex = Math.max(0, visible.findIndex((r) => r.key === selectedKey));
  const selected = visible[selectedIndex] ?? null;
  useEffect(() => {
    if (selected && selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  // useInput のコールバックはレンダーごとに登録し直されるが、キー入力が連続で
  // 同期的に届くと React の再レンダーが間に合わず、複数回とも同じ selectedIndex を
  // 見てしまう（例: ↓ を25回連打しても1個しか進まない）。ref に最新値を都度書き込み、
  // ハンドラ自身がそれを進めることで、再レンダーを待たずに連続入力を正しく積み上げる。
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const items = useMemo(() => buildItems(groups, showOther), [groups, showOther]);
  const selectedItemIndex = selected ? items.findIndex((it) => it.type === 'row' && it.row.key === selected.key) : -1;

  const width = stdout?.columns ?? 100;
  const terminalRows = stdout?.rows ?? 40;
  const listHeight = Math.max(5, terminalRows - DETAIL_RESERVE);

  // 選択がスクロール窓の外に出たときだけ窓を動かす。offset は前回描画時点の値に依存するため
  // 副作用として更新する（レンダー中に直接 ref を書き換えると純粋性が崩れる）。
  useEffect(() => {
    setScrollOffset((prev) => computeViewport(items, selectedItemIndex, listHeight, prev).offset);
  }, [items, selectedItemIndex, listHeight]);

  const viewport = computeViewport(items, selectedItemIndex, listHeight, scrollOffset);

  useInput((input, key) => {
    if (filter !== null && !key.upArrow && !key.downArrow && !key.return) {
      if (key.escape) setFilter(null);
      else if (key.backspace || key.delete) setFilter(filter.slice(0, -1));
      else if (input) setFilter(filter + input);
      return;
    }
    if (key.upArrow) {
      const next = Math.max(0, selectedIndexRef.current - 1);
      selectedIndexRef.current = next;
      setSelectedKey(visible[next]?.key ?? null);
    } else if (key.downArrow) {
      const next = Math.min(visible.length - 1, selectedIndexRef.current + 1);
      selectedIndexRef.current = next;
      setSelectedKey(visible[next]?.key ?? null);
    } else if (key.return && selected && onOpen) void onOpen(selected).then((m) => setMessage(m));
    else if (input === 'a' && selected?.doneMarker) {
      const next = withAck(acks, selected);
      setAckState({ acks: next, ackError: null });
      const r = saveAcks(ackPath, next);
      if (!r.ok) setMessage(`確認済みを保存できない: ${r.error.detail}`);
    } else if (input === 'c') setShowOther((v) => !v);
    else if (input === '/') setFilter('');
    else if (input === 'r') void refresh(true).then(() => setTick((t) => t + 1));
    else if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" width={width}>
      {viewport.hiddenAbove > 0 && <Text dimColor>{'  '}↑ {viewport.hiddenAbove} more</Text>}
      {viewport.visible.map((it) =>
        it.type === 'header' ? (
          <GroupHeader key={it.key} title={it.title} count={it.count} hint={it.hint} />
        ) : (
          <RowLine key={it.row.key} row={it.row} selected={it.row.key === selected?.key} now={current} width={width} />
        ),
      )}
      {viewport.hiddenBelow > 0 && <Text dimColor>{'  '}↓ {viewport.hiddenBelow} more</Text>}
      <Text dimColor>{'─'.repeat(Math.max(10, width - 1))}</Text>
      <Detail row={selected} width={width} />
      <StatusBar snapshot={snapshot} now={current} message={message} filter={filter} ackError={ackError} width={width} />
    </Box>
  );
}
