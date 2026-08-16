#!/usr/bin/env bash
# codebase-overview.sh の検証。madge / aider を実際に起動せずに確かめられることだけを見る。
#
# 外部ツールの実行を検証に含めないのは、npx / uvx がネットワークとパッケージ
# レジストリの応答に依存し、失敗が「スクリプトの不具合」なのか「取得できなかった」
# なのかを区別できないため。外部ツールへ渡す前に決まる部分（引数の受け取り・対象範囲の
# 判定・取得条件の組み立て・設定の加工）と、返ってきた JSON の解釈（あらかじめ用意した
# 入力を関数へ直接流す）の両方を対象にする。
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="$script_dir/codebase-overview.sh"

# 本体はリポジトリルートを起点にパスを解釈する。どこから起動されても同じ結果に
# なるよう、照合の前に揃えておく。
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
cd "$repo_root"

pass=0
fail=0

# 期待値と実際値を突き合わせ、差分が出た側だけを表示する。
check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '✗ %s\n  期待: %s\n  実際: %s\n' "$name" "$expected" "$actual"
  fi
}

# 本体は source されたとき main を走らせないので、関数を直接呼べる。
# shellcheck source=./codebase-overview.sh
source "$target"

# 本体が main で用意する一時ディレクトリを、ここでは代わりに置く。
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- 対象範囲の判定 ---

check 'worker のファイルは worker scope に解決する' \
  'worker/src|worker/tsconfig.json|ts' \
  "$(scope_for 'worker/src/commands/event-add.ts' 2>&1)"

check 'web のファイルは tsx を含む web scope に解決する' \
  'web/src|web/tsconfig.json|ts,tsx' \
  "$(scope_for 'web/src/app/api.ts' 2>&1)"

check 'scripts のファイルは tsconfig 無しの scope に解決する' \
  'scripts||ts' \
  "$(scope_for 'scripts/docs-lifecycle.ts' 2>&1)"

check 'scope 外のファイルは解決に失敗する' \
  '1' \
  "$(scope_for 'README.md' >/dev/null 2>&1; echo $?)"

check 'scope 前方一致は境界で切る' \
  '1' \
  "$(scope_for 'worker/src-generated/foo.ts' >/dev/null 2>&1; echo $?)"

# エージェントの作業規約では絶対パスを使う。畳まずに scope 判定へ渡すと対象内でも外と出る。
check '絶対パスを畳めば scope に解決できる' \
  'worker/src|worker/tsconfig.json|ts' \
  "$(scope_for "$(normalize_input_path "$repo_root/worker/src/index.ts")" 2>&1)"

# 引数はリポジトリルートへ移る前に畳む。cwd 相対のまま持ち越すと、呼び出した場所に
# よって別のファイルを指すか、存在しないと判定される。
check 'cwd 相対のパスを絶対パスへ直す' \
  "$repo_root/worker/src/index.ts" \
  "$(cd worker && to_absolute src/index.ts)"

# SCOPES のルートが無いまま進むと、その scope からしか参照されていないファイルが
# 全ワークスペースで孤立に見え、削除候補として正常終了で報告される。
check '実在する scope のルートは受け入れる' \
  '0' \
  "$(require_scope_root 'worker/src' 2>/dev/null; echo $?)"

check '実在しない scope のルートは失敗として扱う' \
  '1' \
  "$(require_scope_root 'worker/no-such-root' 2>/dev/null; echo $?)"

# --- 解析対象のツリーの決定 ---

# CLAUDE_PROJECT_DIR が cwd の属するチェックアウトと食い違うまま前者を解析すると、別のツリーの
# 結果を手元の話として読むことになる。worktree は SCOPES の 3 ルートをすべて持つため、
# require_scope_root も通り、警告も非ゼロ終了も出ないまま結果が返る。
other_tree="$TMP_DIR/other-tree"
mkdir -p "$other_tree"

check 'cwd と一致する CLAUDE_PROJECT_DIR はそのまま使う' \
  "$repo_root" \
  "$(export CLAUDE_PROJECT_DIR="$repo_root" && resolve_repo_root 2>&1)"

# 実体へ揃えずに文字列で比べると、同じツリーを指しているだけの綴りの差が食い違いになる。
check '末尾スラッシュの差は食い違いとしない' \
  "$repo_root/" \
  "$(export CLAUDE_PROJECT_DIR="$repo_root/" && resolve_repo_root 2>&1)"

check '別のツリーを指す CLAUDE_PROJECT_DIR は失敗として扱う' \
  '1' \
  "$(export CLAUDE_PROJECT_DIR="$other_tree" && resolve_repo_root >/dev/null 2>&1; echo $?)"

# どちらを指しているかが分からないと、指定を直すべきか cwd を移るべきかを判断できない。
check '食い違いは両方のパスを添えて報告する' \
  'contains-both' \
  "$(output="$(export CLAUDE_PROJECT_DIR="$other_tree" && resolve_repo_root 2>&1 >/dev/null || true)"
  if [[ "$output" == *"$other_tree"* && "$output" == *"$repo_root"* ]]; then echo 'contains-both'; fi)"

check 'CLAUDE_PROJECT_DIR が無ければ git の答えを使う' \
  "$repo_root" \
  "$(unset CLAUDE_PROJECT_DIR && resolve_repo_root 2>&1)"

# git が答えられないときは CLAUDE_PROJECT_DIR が単独の根拠になる。
check 'git 管理外では CLAUDE_PROJECT_DIR を根拠にする' \
  "$repo_root" \
  "$(cd "$other_tree" && export CLAUDE_PROJECT_DIR="$repo_root" && resolve_repo_root 2>&1)"

# どちらも無いまま進むと、`cd ""` が成功扱いの no-op になって移動しないまま解析が始まる。
check 'git 管理外で指定も無ければ失敗として扱う' \
  '1' \
  "$(cd "$other_tree" && unset CLAUDE_PROJECT_DIR && resolve_repo_root >/dev/null 2>&1; echo $?)"

# --- 循環を取る範囲 ---

# 全体俯瞰と影響範囲では必要な除外が違う。1 本にまとめると、テストが絡む循環が
# 影響範囲の側で消える（依存の向きは両方に出ているのに「循環なし」と出る）。
check '全体俯瞰の循環はテストを除いて取る' \
  "$IN_TESTS" \
  "$(circular_exclude_for overview)"

check '影響範囲の循環はテストを含めて取る' \
  '' \
  "$(circular_exclude_for focus)"

check '未定義の用途は失敗として扱う' \
  '1' \
  "$(circular_exclude_for 'unknown' 2>/dev/null; echo $?)"

# --- 解析結果の判定 ---

# madge は解析対象を 1 つも解決できなかったときエラーではなく `{}` を返す。
check '空のグラフは取得できなかったものとして扱う' \
  '0' \
  "$(graph_is_empty '{}'; echo $?)"

check '中身のあるグラフは空とみなさない' \
  '1' \
  "$(graph_is_empty '{"a.ts":[]}'; echo $?)"

# 循環の要素はリポジトリルート相対に揃えてある。行を文字列として照合すると
# `index.ts` が `worker/src/router/index.ts` にも一致し、無関係な循環を対象のものとして数える。
check '循環の照合は部分一致を拾わない' \
  '' \
  "$(printf '[["worker/src/router/index.ts","worker/src/errors/index.ts"]]' |
    select_circular 'index.ts')"

check '循環の照合はリポジトリルート相対の完全一致で見る' \
  'worker/src/router/index.ts > worker/src/errors/index.ts' \
  "$(printf '[["worker/src/router/index.ts","worker/src/errors/index.ts"]]' |
    select_circular 'worker/src/router/index.ts')"

# scope ごとに取ると、1 つの循環が scope 違いで別の開始点・別の並び順として現れる。
# 畳まないと同じ循環が並ぶ数だけ重複する。
check '開始点と並び順だけが違う循環は 1 つに畳む' \
  '1' \
  "$(printf '[["worker/src/a.ts","web/src/b.ts"],["web/src/b.ts","worker/src/a.ts"]]' |
    dedupe_circular | jq -r 'length')"

check '要素の異なる循環は別のものとして残す' \
  '2' \
  "$(printf '[["worker/src/a.ts","web/src/b.ts"],["worker/src/a.ts","web/src/c.ts"]]' |
    dedupe_circular | jq -r 'length')"

# ワークスペースをまたぐ循環は、相手側の要素が ../ を含む綴りで出る。畳んでおかないと
# 同じ循環が scope ごとに別物として残る。
check '循環の要素をリポジトリルート相対へ畳む' \
  '[["worker/src/a.ts","web/src/b.ts"]]' \
  "$(printf '[["a.ts","../../web/src/b.ts"]]' | normalize_circular 'worker/src')"

# --- 外部ツールの解決 ---

# メジャーを外すと解決されるバージョンが将来動き、リポジトリの TypeScript と
# 組み合わせたときの挙動が変わりうる。
check 'madge はメジャーを固定して解決する' \
  'madge@8' \
  "$MADGE_PACKAGE"

# --- tsconfig の加工 ---

# エイリアス import を解決させるための baseUrl 補完。paths を保ったまま、
# コピーの置き場所に依存しない絶対パスが入ることを見る。
# SCOPES が指す実在の tsconfig を読むと、その内容（paths のエイリアス設定）が
# リポジトリごとに違うため、SCOPES を書き換えた別のリポジトリではこのテストの
# 期待値が成り立たなくなる。この関数が見ているのは baseUrl の補い方であって
# 特定の paths 設定ではないので、TMP_DIR に置いた最小の fixture で検証する。
printf '{\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"] }\n  }\n}\n' \
  >"$TMP_DIR/sample-tsconfig.json"
check 'tsconfig の paths を保ったまま絶対パスの baseUrl を補う' \
  "$TMP_DIR|./src/*" \
  "$(jq -r '"\(.compilerOptions.baseUrl)|\(.compilerOptions.paths["@/*"][0])"' \
    "$(prepare_tsconfig "$TMP_DIR/sample-tsconfig.json")")"

# tsconfig はコメントを許すが jq は受け付けない。黙って空の設定を渡すと、madge は
# それをエラーにせずエイリアスの解決だけが消えるので、失敗として扱う必要がある。
printf '{\n  // 設定の説明\n  "compilerOptions": {}\n}\n' >"$TMP_DIR/commented.json"
check 'コメント付き tsconfig は失敗として扱う' \
  '1' \
  "$(prepare_tsconfig "$TMP_DIR/commented.json" >/dev/null 2>&1; echo $?)"

# 加工済みのコピーは一時ディレクトリに置くため、madge は継承元へ辿り着けない。継承した
# paths が黙って消えるので、加工が防ごうとしている症状そのものになる。
printf '{\n  "extends": "./base.json",\n  "compilerOptions": {}\n}\n' >"$TMP_DIR/extends.json"
check 'extends を持つ tsconfig は失敗として扱う' \
  '1' \
  "$(prepare_tsconfig "$TMP_DIR/extends.json" >/dev/null 2>&1; echo $?)"

# --- 依存グラフの読み出し ---

# 出力は読み手が上位から順に読むことを前提にしている。並び・件数・綴りのどれが崩れても
# 「どこが厚いか」を読み違える。scope の外を指すキーは、それが属する scope の周回で並ぶ。
check '依存の集中は件数の多い順にルート相対で並べ、scope の外は件名に出さない' \
  '3 worker/src/index.ts
1 worker/src/services/event-add-draft.ts' \
  "$(printf '{"index.ts":["a.ts","b.ts","c.ts"],"services/event-add-draft.ts":["a.ts"],"b.ts":[],"../../scripts/x.ts":["a.ts","b.ts"]}' |
    format_fan_out 5 'worker/src')"

check '依存の集中は上位 n 件で切る' \
  '3 worker/src/index.ts' \
  "$(printf '{"index.ts":["a.ts","b.ts","c.ts"],"services/event-add-draft.ts":["a.ts"]}' |
    format_fan_out 1 'worker/src')"

# 孤立の判定は「自 scope のファイル」から「全 scope の参照先」を引く。左辺に scope の外の
# キーが混じると、他の scope のファイルがこの scope の孤立として並ぶ。
check '自 scope のファイルだけをルート相対で列挙する' \
  'worker/src/index.ts
worker/src/types/branded.ts' \
  "$(printf '{"index.ts":[],"../../scripts/x.ts":[],"types/branded.ts":[]}' |
    list_own_files 'worker/src')"

# 右辺の参照先が重複したまま並んでも孤立の判定は狂わないが、同じファイルが綴り違いで
# 別物として残ると、参照されているファイルが孤立に出る。
check 'グラフの参照先を重複なくルート相対で列挙する' \
  'worker/src/services/event-add-draft.ts
worker/src/types/branded.ts' \
  "$(printf '{"index.ts":["types/branded.ts","services/event-add-draft.ts"],"a.ts":["types/branded.ts"]}' |
    list_referenced 'worker/src')"

# scope をまたぐ依存は ../ を含む綴りで出てくる。畳まないと、参照されている側が
# その scope の周回で孤立として並ぶ。
check 'scope の外を指す参照をルート相対へ畳む' \
  'worker/src/services/event-add-draft.ts' \
  "$(printf '{"app/page.tsx":["../../worker/src/services/event-add-draft.ts"]}' |
    list_referenced 'web/src')"

# 依存元は全 scope から集める。1 つの scope の読み出しが失敗したときに残りだけで
# 答えを返すと、波及先が欠けたものを完全な一覧として読ませることになる。
FOCUS_GRAPHS=(
  ['worker/src']='{"commands/event-add.ts":["services/event-add-draft.ts"],"services/event-add-draft.ts":[]}'
  ['web/src']='{"app/api.ts":["../../worker/src/services/event-add-draft.ts"]}'
  ['scripts']='{"x.ts":[]}'
)
check '依存元を全 scope から集める' \
  'web/src/app/api.ts
worker/src/commands/event-add.ts' \
  "$(collect_dependents 'worker/src/services/event-add-draft.ts')"

FOCUS_GRAPHS['web/src']='{ 壊れた JSON'
check '途中の scope が読めなければ依存元を返さない' \
  '1' \
  "$(collect_dependents 'worker/src/services/event-add-draft.ts' >/dev/null 2>&1; echo $?)"
unset 'FOCUS_GRAPHS[worker/src]' 'FOCUS_GRAPHS[web/src]' 'FOCUS_GRAPHS[scripts]'

# 循環はファイル配列の配列で持っている。読むために 1 行 1 循環へ均す。
check '循環を 1 行 1 循環へ均す' \
  'worker/src/a.ts > worker/src/b.ts
web/src/c.ts > web/src/d.ts' \
  "$(printf '[["worker/src/a.ts","worker/src/b.ts"],["web/src/c.ts","web/src/d.ts"]]' |
    format_circular)"

# --- CLI としての振る舞い ---

check '--help は使い方を出して正常終了する' \
  '0' \
  "$(bash "$target" --help >/dev/null 2>&1; echo $?)"

check '存在しないファイルを渡すと失敗する' \
  '1' \
  "$(bash "$target" no/such/file.ts >/dev/null 2>&1; echo $?)"

# pipefail 下でパイプへ繋ぐと本体の異常終了がパイプライン全体の結果になるため、
# 出力を変数へ受けてから照合する。
check '存在しないファイルはパスを添えて報告する' \
  'contains-path' \
  "$(output="$(bash "$target" no/such/file.ts 2>&1 || true)"
  case "$output" in *'no/such/file.ts'*) echo 'contains-path' ;; esac)"

check 'scope 外の実在ファイルは対象外として失敗する' \
  '1' \
  "$(bash "$target" README.md >/dev/null 2>&1; echo $?)"

# `-` で始まる引数を realpath が自分のオプションとして読むと、realpath のエラーで終わり、
# 綴りの誤りを指摘するこのスクリプトのメッセージが出ない。
check '- で始まる引数はスクリプト自身のエラーとして報告する' \
  'own-message' \
  "$(output="$(bash "$target" --json 2>&1 || true)"
  case "$output" in *'ファイルが無い'*) echo 'own-message' ;; esac)"

# 引数の検証が外部ツールより先に走ることを、npx を潰した PATH で確かめる。順序が
# 逆だと、綴りの誤りを指摘するだけの実行までネットワークの状態に左右される。
mkdir -p "$TMP_DIR/bin"
printf '#!/bin/sh\nexit 1\n' >"$TMP_DIR/bin/npx"
chmod +x "$TMP_DIR/bin/npx"
check '外部ツールが使えなくても引数の誤りは報告する' \
  'contains-path' \
  "$(output="$(PATH="$TMP_DIR/bin:$PATH" bash "$target" no/such/file.ts 2>&1 || true)"
  case "$output" in *'no/such/file.ts'*) echo 'contains-path' ;; esac)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
