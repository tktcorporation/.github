export type Viewport<T> = { offset: number; visible: T[]; hiddenAbove: number; hiddenBelow: number };

// 端末の行数は有限なので、選択中の項目を含む範囲だけを描画する。
// previousOffset は「前回どこを表示していたか」を表し、選択がその窓の外に
// 出たときだけ動かす（キー操作のたびに選択行を中央へ寄せると一覧全体が動いて読みにくい）。
// ↑/↓ の案内行ぶんとして常に 2 行を差し引いておく。片方しか出ない場合は 1 行分
// 余裕ができるだけで、offset ごとに出し分けを再計算するより単純で安全（listHeight を超えない）。
export function computeViewport<T>(items: T[], selectedIndex: number, listHeight: number, previousOffset: number): Viewport<T> {
  if (items.length === 0 || listHeight <= 0) return { offset: 0, visible: [], hiddenAbove: 0, hiddenBelow: 0 };
  if (items.length <= listHeight) return { offset: 0, visible: items, hiddenAbove: 0, hiddenBelow: 0 };

  const capacity = Math.max(1, listHeight - 2);
  let offset = previousOffset;
  if (selectedIndex >= 0) {
    if (selectedIndex < offset) offset = selectedIndex;
    else if (selectedIndex >= offset + capacity) offset = selectedIndex - capacity + 1;
  }
  offset = Math.min(Math.max(offset, 0), Math.max(0, items.length - capacity));
  const end = Math.min(items.length, offset + capacity);
  return { offset, visible: items.slice(offset, end), hiddenAbove: offset, hiddenBelow: items.length - end };
}
