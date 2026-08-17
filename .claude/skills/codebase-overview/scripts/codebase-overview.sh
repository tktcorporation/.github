#!/usr/bin/env bash
# 設計・レビューに入る前にコードベースの構造を俯瞰する CLI。
#
# 引数なしで全体像（循環依存・依存の集中・孤立ファイル・共有語彙）を、
# ファイルを渡すとその周辺（依存先・依存元・近傍の語彙）を出す。
#
# 依存グラフと語彙の両方を出すのは、片方だけでは構造を読み違えるため。依存グラフの
# 上位に来るのは入口（多くを呼び出すオーケストレータ）で、語彙の上位に来るのは葉
# （多くから参照される型・定数）になる。前者だけ見ると共有語彙を、後者だけ見ると
# 処理の起点を取り落とす。
#
# 依存グラフは madge、共有語彙は aider の repo map から作る。どちらも隔離環境で
# その都度解決し、リポジトリの依存には加えない。
#
# madge を devDependency にできないのは、madge が typescript を peer 依存として要求し、
# pnpm がそれをリポジトリの TypeScript 7 に解決するため。madge 8 は TypeScript 7 の
# API 変更に追随しておらず、tsconfig を読む時点で `ts.sys.readFile` が undefined になって
# 落ちる。npx は隔離環境で madge に適合する TypeScript を別途解決するので影響を受けない。
# aider は Python なので npm の依存にはできず、uvx に任せる。
#
# 変更したら同じディレクトリの self-test.sh を実行する。
set -uo pipefail

# メジャーを固定する。指定しないと解決されるバージョンが将来動きうる。
readonly MADGE_PACKAGE='madge@8'

# 依存グラフを取る単位。madge は tsconfig を 1 つしか受け取らないので、
# tsconfig が分かれているワークスペースごとに分けて実行する。
# 形式: <ルート>|<tsconfig（無ければ空）>|<拡張子>
SCOPES=(
  "worker/src|worker/tsconfig.json|ts"
  "web/src|web/tsconfig.json|ts,tsx"
  "scripts||ts"
)

# テストはどこからも import されないため、除外しないと孤立ファイルの一覧がテストで
# 埋まって使えなくなる。影響範囲を見るときは逆にテストも直す対象になるので、
# 全体俯瞰でだけ除き、ファイルを指定したときは残す。
readonly IN_TESTS='(^|/)__tests__/'

# repo map に割く予算。広く浅く見る全体俯瞰の方を厚くする。
readonly MAP_TOKENS_OVERVIEW="${CODEBASE_OVERVIEW_MAP_TOKENS:-1500}"
readonly MAP_TOKENS_FOCUS="${CODEBASE_OVERVIEW_MAP_TOKENS:-1000}"

# 全体俯瞰で並べる件数。全件出すと読み手が上位を見失う。
readonly TOP_N=15

# madge が返すパスは scope 相対で、scope をまたぐ依存は `../..` を含む。同じファイルが
# 綴りの違いで別物に見えないよう、リポジトリルート相対へ畳んでから突き合わせる。
# realpath を 1 行ずつ呼ぶと参照の数だけプロセスが起動するので、jq の中で処理する。
readonly JQ_NORMALIZE='
def normalize($base):
  ($base + "/" + .)
  | split("/")
  | reduce .[] as $part ([];
      if $part == ".." then .[0:-1]
      elif $part == "." or $part == "" then .
      else . + [$part] end)
  | join("/");
'

usage() {
  cat <<'USAGE'
コードベースの構造を俯瞰する。

  codebase-overview.sh                 全体像（循環依存・依存の集中・孤立・共有語彙）
  codebase-overview.sh <file>...       指定ファイルの周辺（依存先・依存元・近傍の語彙）

環境変数:
  CODEBASE_OVERVIEW_MAP_TOKENS  repo map に割くトークン数（既定: 全体 1500 / 個別 1000）
  CODEBASE_OVERVIEW_NO_MAP      非空なら repo map を省き、依存グラフだけを出す

対象ディレクトリ:
USAGE
  local scope
  for scope in "${SCOPES[@]}"; do
    printf '  %s\n' "${scope%%|*}"
  done
}

# パスが属する scope 定義を返す。見つからなければ 1 で返す。
scope_for() {
  local path="$1" scope root
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    # `worker/src` が `worker/src-generated` に一致しないよう、境界まで見て判定する。
    if [[ "$path" == "$root" || "$path" == "$root/"* ]]; then
      printf '%s\n' "$scope"
      return 0
    fi
  done
  return 1
}

# scope のルートが実在することを確かめる。SCOPES はこのリポジトリの構成を書いたものなので、
# 無いのは設定の誤り。黙って飛ばすと、その scope からしか参照されていないファイルが
# 全ワークスペースで孤立に見え、削除候補として正常終了で報告される。
require_scope_root() {
  if [[ -d "$1" ]]; then
    return 0
  fi
  printf '%s が無い（SCOPES の設定を確認する必要がある）。\n' "$1" >&2
  return 1
}

# 引数で受け取ったパスを絶対パスへ直す。リポジトリルートへ cd する前に済ませる必要がある。
# cwd 相対のまま持ち越すと、cd 後に別のファイル（`scripts/` と `worker/scripts/` のような
# 同名の組）を指すか、存在しないと判定される。
#
# `--` を置くのは、`-` で始まる引数を realpath が自分のオプションとして読まないようにするため。
# 読まれると realpath 自身のエラーで終わり、綴りの誤りを指摘するこのスクリプトの
# メッセージが出ない。
to_absolute() {
  realpath -m --no-symlinks -- "$1"
}

# 絶対パスをリポジトリルート相対へ直す。エージェントの作業規約では絶対パスを使うため、
# そのまま scope 判定に掛けると対象内のファイルでも scope 外と判定される。
normalize_input_path() {
  realpath -m --relative-to=. --no-symlinks -- "$1"
}

# 依存グラフが実質空か判定する。madge は解析対象を 1 つも解決できなかったとき、
# エラーではなく `{}` を返す。空文字列だけを見ていると、設定を誤った scope が
# 「循環なし・孤立なし」という正常な結果に化ける。その scope の参照が抜けることで、
# 他のワークスペースに誤った孤立まで生む。
graph_is_empty() {
  local graph="$1" count
  if [[ -z "$graph" ]]; then
    return 0
  fi
  count="$(printf '%s' "$graph" | jq -r 'length' 2>/dev/null)" || return 0
  [[ "$count" == '0' ]]
}

# 対象を含む循環だけを 1 行 1 循環で出す。行を文字列として grep すると、`index.ts` が
# `router/index.ts` にも一致して無関係な循環を対象のものとして数えてしまうため、
# 要素の完全一致で選ぶ。対象も要素もリポジトリルート相対で揃っている前提。
select_circular() {
  jq -r --arg f "$1" '.[] | select(index($f)) | join(" > ")'
}

# scope 相対で出てきた循環の各要素を、リポジトリルート相対へ畳む。
normalize_circular() {
  jq -c --arg root "$1" "$JQ_NORMALIZE"'map(map(normalize($root)))'
}

# 同じ循環をまとめる。scope ごとに取ると、1 つの循環が scope 違いで別の開始点・
# 別の並び順として現れる。要素をソートした集合をキーにすれば、綴りが揃っている限り
# 同一と判定できる。
dedupe_circular() {
  jq -c 'unique_by(sort)'
}

# madge は tsconfig の paths を baseUrl 経由でしか解決しない。baseUrl を持たない
# tsconfig（TypeScript 5 では paths 単独でも有効）だと、エイリアス（`@/...` 等）で
# 書かれた import が依存グラフから丸ごと落ち、孤立ファイルが実際よりずっと多く見える。
# tsconfig 本体は変更せず、baseUrl を補ったコピーを madge へ渡して埋める。
#
# baseUrl を絶対パスにするのは、paths の値が baseUrl 起点で解決されるため。
# 相対のままだとコピーの置き場所によって指す先が変わる。
prepare_tsconfig() {
  local tsconfig="$1" out
  out="$(mktemp "$TMP_DIR/tsconfig-XXXXXX.json")"

  # madge は extends を tsconfig 自身の置き場所を起点に解決する。加工したコピーは
  # 一時ディレクトリに置くため継承元へ辿り着けず、継承していた paths が黙って消える。
  # コピーを元のディレクトリへ置けば解決できるが、作業ツリーに一時ファイルが混じるので
  # 採らない。継承には対応していないものとして、ここで止める。
  if jq -e 'has("extends")' "$tsconfig" >/dev/null 2>&1; then
    printf '%s は extends を使っている（継承した設定の解決には対応していない）。\n' "$tsconfig" >&2
    return 1
  fi

  # tsconfig はコメントを許すが jq は受け付けない。失敗を見逃すと空のコピーが渡り、
  # madge はそれをエラーにせず受け入れるため、エイリアスの解決だけが黙って消える。
  # この関数が防ごうとしている症状そのものなので、ここで止める。
  if ! jq --arg base "$(cd "$(dirname "$tsconfig")" && pwd)" \
    '.compilerOptions.baseUrl = $base' "$tsconfig" >"$out" 2>/dev/null; then
    printf '%s を読めなかった（コメント付き JSON は解釈できない）。\n' "$tsconfig" >&2
    return 1
  fi
  if [[ ! -s "$out" ]]; then
    printf '%s から空の設定ができた。\n' "$tsconfig" >&2
    return 1
  fi

  printf '%s\n' "$out"
}

# scope 定義に対して madge を実行する。追加の引数はそのまま madge へ渡す。
run_madge() {
  local scope="$1"
  shift
  local root="${scope%%|*}"
  local rest="${scope#*|}"
  local tsconfig="${rest%%|*}"
  local extensions="${rest#*|}"

  local args=(--extensions "$extensions")
  if [[ -n "$tsconfig" ]]; then
    local prepared
    prepared="$(prepare_tsconfig "$tsconfig")" || return 1
    args+=(--ts-config "$prepared")
  fi

  # madge は検出結果を終了コードで表す（--circular は循環が 1 つでもあると非ゼロ）。
  # つまり非ゼロは異常ではないので、終了コードではなく出力の有無で判断する。
  # 起動そのものができないケースは require_madge が先に弾いている。
  #
  # stderr へは解決できない import の警告が出る。グラフは得られるので捨てる。
  npx --yes "$MADGE_PACKAGE" "${args[@]}" "$@" "$root" 2>/dev/null || true
}

# madge を起動できることを先に確かめる。以降は終了コードを結果として読むため、
# ここで確認しておかないと「実行できなかった」と「見つからなかった」が区別できない。
require_madge() {
  if npx --yes "$MADGE_PACKAGE" --version >/dev/null 2>&1; then
    return 0
  fi
  printf 'madge を実行できない。ネットワークか npm キャッシュを確認する必要がある。\n' >&2
  return 1
}

# 依存グラフ JSON から「依存先の多い順」を上位 n 件だけ出す。
# 件名は自 scope のファイルに絞る。scope の外のファイルは、それが属する scope で並ぶ。
#
# パスはリポジトリルート相対で出す。他のセクションと綴りが揃い、ここからコピーした
# パスをそのままこのスクリプトの引数に渡せる。
#
# 件数の切り詰めを head ではなく jq 側で行うのは、head が入力を途中で閉じると
# 上流の jq が SIGPIPE で落ち、pipefail がそれを失敗として拾うため。
format_fan_out() {
  jq -r --argjson n "$1" --arg root "$2" 'to_entries
    | map(select(.key | startswith("..") | not))
    | map(select((.value | length) > 0))
    | sort_by(-(.value | length))
    | .[0:$n] | .[]
    | "\(.value | length) \($root)/\(.key)"'
}

# グラフが参照している全ファイルを、リポジトリルート相対で列挙する。
list_referenced() {
  jq -r --arg root "$1" "$JQ_NORMALIZE"'
    [.[] | .[]] | unique | .[] | normalize($root)'
}

# グラフに現れる自 scope のファイルを、リポジトリルート相対で列挙する。
list_own_files() {
  jq -r --arg root "$1" '
    keys[] | select(startswith("..") | not) | $root + "/" + .'
}

# 循環はファイル配列の配列で持っている。読むために 1 行 1 循環へ均す。
format_circular() {
  jq -r '.[] | join(" > ")'
}

# aider の repo map を出す。aider が無ければ理由を述べて何も出さない。
print_repo_map() {
  local tokens="$1"
  shift

  if [[ -n "${CODEBASE_OVERVIEW_NO_MAP:-}" ]]; then
    return 0
  fi

  # ファイルを渡すと aider はそれを対話中のファイルとして扱い、repo map から外す。
  # 出てくるのは指定したファイル自身を含まない近傍のマップなので、見出しと説明を分ける。
  if [[ $# -eq 0 ]]; then
    printf '\n## 共有語彙（repo map）\n\n'
    printf '多くの箇所から参照されている型・定数。依存グラフの上位とは別の面を見ている。\n\n'
  else
    printf '\n## 近傍の語彙（repo map）\n\n'
    printf '指定したファイルの周辺にある型・定数。指定したファイル自身の定義は含まれない。\n\n'
  fi

  if ! command -v uvx >/dev/null 2>&1; then
    printf 'uvx が無いため省略した。`curl -LsSf https://astral.sh/uv/install.sh | sh` で入る。\n'
    return 0
  fi

  local args=(--show-repo-map --map-tokens "$tokens" --no-show-model-warnings --yes-always)
  local file
  for file in "$@"; do
    args+=(--file "$file")
  done

  # aider はモデル指定が無いと起動しない。--show-repo-map は tree-sitter と
  # トークナイザだけを使い API を呼ばないため、ここでのモデル名はトークン数の
  # 数え方を決めるだけで、API キーは要らない。
  #
  # 失敗しても終了コードは 0 のままにする。repo map が無くても依存グラフ側の結論は
  # 変わらないため。依存グラフの取得失敗を fatal にしているのは、そちらが欠けると
  # 「循環なし・孤立なし」という誤った結論になるからで、非対称なのはその違いによる。
  # ただし理由が分からないと直せないので、aider の stderr は出力へ添える。
  local output errors
  errors="$(mktemp "$TMP_DIR/aider-stderr-XXXXXX")"
  if ! output="$(uvx --from aider-chat aider --model gpt-4o "${args[@]}" 2>"$errors")"; then
    printf 'aider の実行に失敗したため省略した。`uvx --from aider-chat aider --show-repo-map` で直接確認できる。\n'
    printf '\n```\n%s\n```\n' "$(cat "$errors")"
    return 0
  fi

  # 前置き（LLM への指示文）を落とし、ファイル要約の本体だけを残す。
  #
  # 見出し行の条件を「空白を含まないパス + `:`」に絞っているため、空白を含むパスは
  # 見出しとして拾わず、そのファイル以降の要約が落ちる。条件を緩めると前置きの文へ
  # 誤爆して出力全体が壊れるので、追跡パスに空白が無い前提を採る
  # （`git ls-files | grep ' '` が 0 件）。空白入りのパスを追跡し始めたら見直す。
  local body
  body="$(printf '%s\n' "$output" | sed -n '/^[^ │⋮]*:$/,$p')"
  printf '%s\n' "${body:-語彙を抽出できなかった。}"
}

# scope ごとの結果を見出し付きで並べる。全 scope が空なら「なし。」を出す。
print_by_scope() {
  local title="$1" note="$2"
  shift 2
  local -n results=$1

  printf '\n## %s\n' "$title"
  if [[ -n "$note" ]]; then
    printf '\n%s\n' "$note"
  fi

  local root found=0
  for root in "${!results[@]}"; do
    if [[ -n "${results[$root]}" ]]; then
      found=1
    fi
  done

  if [[ "$found" -eq 0 ]]; then
    printf '\nなし。\n'
    return 0
  fi

  # 連想配列の反復順は不定なので、SCOPES の並びに揃えて出す。
  local scope
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    if [[ -n "${results[$root]:-}" ]]; then
      printf '\n### %s\n\n%s\n' "$root" "${results[$root]}"
    fi
  done
}

overview() {
  local scope root graph
  local -A graphs fan_out orphans
  local referenced=''

  load_circular overview

  # グラフは scope の外への依存も含めて取る。孤立の判定には他の scope からの参照も
  # 要るため、全 scope 分が揃うまで判定できない。先に集め切ってから突き合わせる。
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    require_scope_root "$root" || return 1

    graph="$(run_madge "$scope" --exclude "$IN_TESTS" --json)"
    # 空は「依存が無かった」ではなく「解析できなかった」。ここで止めないと、
    # 失敗が「循環なし・孤立なし」という正常な結果に化けて読み手を誤らせる。
    if graph_is_empty "$graph"; then
      printf '%s の依存グラフを取得できなかった。\n' "$root" >&2
      return 1
    fi
    graphs["$root"]="$graph"
    fan_out["$root"]="$(printf '%s' "$graph" | format_fan_out "$TOP_N" "$root")"
    referenced+="$(printf '%s' "$graph" | list_referenced "$root")"$'\n'
  done

  # 参照は scope をまたぐ。worker のファイルが scripts からだけ使われている場合、
  # worker のグラフだけを見ると孤立に見えてしまう。全 scope の参照を突き合わせる。
  #
  # 空行を落とすのに grep を使わないのは、参照が 1 つも無いときに grep が「一致なし」の
  # 1 で終わり、pipefail が拾って理由の分からない失敗になるため。sed は該当行が
  # 無くても 0 で返る。
  local referenced_sorted own_files
  referenced_sorted="$(printf '%s' "$referenced" | sed '/^$/d' | sort -u)"
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    # プロセス置換の終了コードは呼び出し元へ伝わらず comm は 0 で返るため、グラフの
    # 読み出しはいったん変数へ受ける。代入なら失敗が pipefail に捕まり、
    # 「孤立なし」という正常な結果に化けない。
    own_files="$(printf '%s' "${graphs[$root]}" | list_own_files "$root" | sort -u)"
    orphans["$root"]="$(comm -23 \
      <(printf '%s\n' "$own_files") \
      <(printf '%s\n' "$referenced_sorted"))"
  done

  printf '# コードベース俯瞰\n'

  # 循環はリポジトリルート相対で畳んだ 1 つの一覧にする。scope ごとの見出しを付けると、
  # ワークスペースをまたぐ循環をどちらの見出しに置くかが決まらない。
  printf '\n## 循環依存\n\n'
  local circular
  circular="$(printf '%s' "$CIRCULAR_JSON" | format_circular)"
  printf '%s\n' "${circular:-なし。}"

  print_by_scope "依存の集中（依存先が多い順・上位 $TOP_N）" \
    '変更のたびに広い前提を巻き込む位置。ここが厚いほど影響が読みにくい。' fan_out
  print_by_scope 'どこからも参照されていないファイル' \
    'テストを除いた依存グラフでの孤立。エントリポイントか、テストからしか使われていないか、対象ディレクトリの外から読まれるもの（ビルドの入口・ambient 型定義）か、消し忘れ。' \
    orphans
  print_repo_map "$MAP_TOKENS_OVERVIEW"
}

# 影響範囲を見る用途では scope の外も落とさない（scope をまたぐ依存も直す対象になる）。
# コマンド置換の中で代入してもサブシェル止まりで消えるため、キャッシュは呼び出し元で埋める。
declare -A FOCUS_GRAPHS

# 全 scope のグラフを 1 回ずつ取る。逆依存は scope をまたぐので、対象がどの scope に
# あっても全 scope 分が要る。
load_focus_graphs() {
  local scope root
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    require_scope_root "$root" || return 1
    FOCUS_GRAPHS["$root"]="$(run_madge "$scope" --json)"
    if graph_is_empty "${FOCUS_GRAPHS[$root]}"; then
      printf '%s の依存グラフを取得できなかった。\n' "$root" >&2
      return 1
    fi
  done
}

# 全 scope の循環を、リポジトリルート相対で畳んだ 1 つの配列として持つ。コマンド置換の
# 中で代入してもサブシェル止まりで消えるため、キャッシュは呼び出し元で埋める。
# ファイルを複数指定したときは、各ファイルの select_circular がこの 1 つを引く。
CIRCULAR_JSON=''

# 循環の取得で madge へ渡す除外パターンを用途ごとに返す。除外しない用途では空になる。
# 依存グラフ側と同じ使い分けで、全体俯瞰はテストを除き（除かないと孤立ファイルの
# 一覧がテストで埋まる）、影響範囲はテストを含む（テストも直す対象になる）。
circular_exclude_for() {
  case "$1" in
    overview) printf '%s' "$IN_TESTS" ;;
    focus) ;;
    *)
      printf '循環の取得方法が未定義: %s\n' "$1" >&2
      return 1
      ;;
  esac
}

# 循環を全 scope 分取ってキャッシュへ入れる。用途（overview / focus）で除外パターンが
# 変わるので、どちらで取ったかを引数で受ける。overview と focus は main で排他に走るため、
# 1 回の実行で取るのは片方だけになる。
#
# scope 単位の結果をそのまま並べると、ワークスペースをまたぐ循環をどちらの周回でも
# 検出できない。相手側のノードを scope の外として落とすと環が切れるため。落とさずに
# 取って畳み、集合として重複を除くことで、またぐ循環は 1 度だけ現れる。
load_circular() {
  local mode="$1" exclude
  exclude="$(circular_exclude_for "$mode")" || return 1

  local exclude_args=()
  if [[ -n "$exclude" ]]; then
    exclude_args=(--exclude "$exclude")
  fi

  local scope root json all='[]'
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    require_scope_root "$root" || return 1

    json="$(run_madge "$scope" "${exclude_args[@]}" --circular --json)"
    # 循環が無いときの madge の答えは `[]` で、空文字列は取得できなかったことを表す。
    # 区別せずに流すと、失敗が「循環なし」に化ける。
    if [[ -z "$json" ]]; then
      printf '%s の循環依存を取得できなかった。\n' "$root" >&2
      return 1
    fi
    all="$(jq -c --argjson add "$(printf '%s' "$json" | normalize_circular "$root")" \
      '. + $add' <<<"$all")"
  done

  CIRCULAR_JSON="$(printf '%s' "$all" | dedupe_circular)"
}

# 対象を参照しているファイルを全 scope から集める。web と scripts は worker のコードを
# 直接 import するため、対象と同じ scope だけを見ると波及先を取り落とす。
collect_dependents() {
  local file="$1" scope root rel hits found=''
  for scope in "${SCOPES[@]}"; do
    root="${scope%%|*}"
    # その scope から対象を指す綴り。scope の外にあれば ../ を含む形になる。
    rel="$(realpath -m --relative-to="$root" --no-symlinks -- "$file")"
    # scope の外にある依存元は、それが属する scope の周回で拾う。ここで出すと重複する。
    #
    # 各 scope の結果を変数へ溜めてから並べ替える。ループ全体を並べ替えへ繋ぐと、
    # パイプラインの終了コードには最後の scope の結果しか乗らず、途中の scope が
    # 失敗しても依存元が欠けたまま成功として返る。
    if ! hits="$(printf '%s' "${FOCUS_GRAPHS[$root]}" | jq -r --arg f "$rel" --arg root "$root" '
      to_entries[]
      | select(.value | index($f))
      | select(.key | startswith("..") | not)
      | "\($root)/\(.key)"')"; then
      return 1
    fi
    found+="$hits"$'\n'
  done
  # 該当ゼロ件の scope が空行を残す。grep は一致なしで 1 を返し pipefail が拾うため sed で落とす。
  printf '%s' "$found" | sed '/^$/d' | sort -u
}

# 1 ファイルについて、依存先と依存元を出す。
focus_file() {
  local file="$1" scope
  scope="$(scope_for "$file")" || return 1

  local root="${scope%%|*}"
  local rel="${file#"$root"/}"

  printf '\n## %s\n' "$file"

  # scope_for は SCOPES の値しか返さず、load_focus_graphs が SCOPES 全件について
  # 取得に失敗したら止まるので、ここでは必ず中身のあるグラフが引ける。
  local graph="${FOCUS_GRAPHS[$root]}"

  if ! printf '%s' "$graph" | jq -e --arg f "$rel" 'has($f)' >/dev/null; then
    printf '\n依存グラフに現れない（%s の解決対象外）。\n' "$root"
    return 1
  fi

  # 以下の 3 つは取得の失敗を明示的に見る。この関数は `focus_file ... || failed=1` の形で
  # 呼ばれ、`||` リストの内側では set -e が働かないため、代入が失敗しても素通りする。
  # 素通りすると空文字列が `${var:-なし。}` に落ち、失敗が「なし。」という正常な結果に化ける。
  # jq は該当が 0 件でも 0 で返るので、明示的に見れば「なし」と失敗を区別できる。
  printf '\n### 依存している先\n\n'
  local dependencies
  if ! dependencies="$(printf '%s' "$graph" | jq -r --arg f "$rel" --arg root "$root" \
    "$JQ_NORMALIZE"'.[$f][] | normalize($root)' | sort)"; then
    printf '%s の依存先を読み出せなかった。\n' "$file" >&2
    return 1
  fi
  printf '%s\n' "${dependencies:-なし。}"

  printf '\n### 依存されている元（変更するとここに波及する）\n\n'
  local dependents
  if ! dependents="$(collect_dependents "$file")"; then
    printf '%s の依存元を集められなかった。\n' "$file" >&2
    return 1
  fi
  printf '%s\n' "${dependents:-なし。}"

  printf '\n### 巻き込んでいる循環\n\n'
  # 全 scope 分から選ぶ。対象の scope だけを見ると、ワークスペースをまたぐ循環を落とす。
  local circular
  if ! circular="$(printf '%s' "$CIRCULAR_JSON" | select_circular "$file")"; then
    printf '%s を含む循環を読み出せなかった。\n' "$file" >&2
    return 1
  fi
  printf '%s\n' "${circular:-なし。}"
}

# 解析対象のツリーを決める。リポジトリルートへ移る前、cwd が呼び出し元のままの状態で呼ぶ。
#
# CLAUDE_PROJECT_DIR と git の答えが食い違ったまま前者を採ると、cwd が属するチェックアウトとは
# 別のツリーの解析結果を、手元の話として読むことになる。`.claude/worktrees/` で作業しながら
# CLAUDE_PROJECT_DIR が元のチェックアウトを指している状況がこれに当たり、worktree は SCOPES の
# 3 ルートをすべて持つので require_scope_root も通り、警告も非ゼロ終了も出ない。どちらを解析すべきか
# は決められないので、両方の綴りを示して止める。
#
# git が答えられないときだけ CLAUDE_PROJECT_DIR を単独の根拠にする。どちらも無いまま進むと、
# `cd ""` は引数無しの cd と違って成功扱いの no-op になるため、移動しないまま解析が始まる。
# git 管理外で実行したときは「SCOPES の設定が誤っている」という別の理由で報告され、
# SCOPES の 3 ルートを偶然持つディレクトリでは意図しないツリーを黙って解析する。
resolve_repo_root() {
  local from_env="${CLAUDE_PROJECT_DIR:-}" from_git
  from_git="$(git rev-parse --show-toplevel 2>/dev/null)" || from_git=''

  if [[ -z "$from_env" ]]; then
    if [[ -z "$from_git" ]]; then
      printf 'リポジトリルートを特定できない（git の管理下ではない）。CLAUDE_PROJECT_DIR で指定する必要がある。\n' >&2
      return 1
    fi
    printf '%s\n' "$from_git"
    return 0
  fi

  if [[ -n "$from_git" ]]; then
    # シンボリックリンク越しの綴りや末尾スラッシュの差を食い違いと読まないよう、実体へ
    # 揃えてから比べる。解決できないパスはそのまま比べ、存在しない指定は cd の失敗として出す。
    local canonical_env canonical_git
    canonical_env="$(realpath -- "$from_env" 2>/dev/null)" || canonical_env="$from_env"
    canonical_git="$(realpath -- "$from_git" 2>/dev/null)" || canonical_git="$from_git"
    if [[ "$canonical_env" != "$canonical_git" ]]; then
      printf 'CLAUDE_PROJECT_DIR と cwd が属するチェックアウトが違う。どちらを解析するか決められない。\n' >&2
      printf '  CLAUDE_PROJECT_DIR: %s\n' "$from_env" >&2
      printf '  cwd のチェックアウト: %s\n' "$from_git" >&2
      return 1
    fi
  fi

  printf '%s\n' "$from_env"
}

# madge へ渡す加工済み tsconfig の置き場所。main が作り、終了時に消す。
TMP_DIR=""

main() {
  set -e

  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return 0
  fi

  # 引数はリポジトリルートへ移る前に絶対パスへ直す。cwd 相対のまま持ち越すと、
  # 呼び出した場所によって別のファイルを指すか、存在しないと判定される。
  local requested=() arg
  for arg in "$@"; do
    requested+=("$(to_absolute "$arg")")
  done

  # 宣言と代入を分けるのは、`local x="$(cmd)"` だと local 自身の終了コードが返り、
  # コマンドの失敗を拾えないため。
  local repo_root
  repo_root="$(resolve_repo_root)" || return 1
  if ! cd "$repo_root"; then
    printf 'リポジトリルートへ移動できない: %s\n' "$repo_root" >&2
    return 1
  fi

  if ! command -v npx >/dev/null 2>&1; then
    printf 'npx が見つからない。Node.js を入れる必要がある。\n' >&2
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    printf 'jq が見つからない。依存グラフを読むのに要る。\n' >&2
    return 1
  fi

  # 引数の検証は外部ツールより先に済ませる。順序が逆だと、綴りの誤りを指摘するだけの
  # 実行までネットワークの状態に左右される。
  local targets=() file
  for arg in "${requested[@]}"; do
    if [[ ! -f "$arg" ]]; then
      printf 'ファイルが無い: %s\n' "$arg" >&2
      return 1
    fi
    file="$(normalize_input_path "$arg")"
    if ! scope_for "$file" >/dev/null; then
      printf '対象外のパス: %s（対象は %s）\n' "$file" "${SCOPES[*]%%|*}" >&2
      return 1
    fi
    targets+=("$file")
  done

  require_madge

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  if [[ ${#targets[@]} -eq 0 ]]; then
    overview
    return 0
  fi

  load_focus_graphs
  load_circular focus

  printf '# 変更対象の周辺\n'
  local failed=0
  for file in "${targets[@]}"; do
    focus_file "$file" || failed=1
  done

  print_repo_map "$MAP_TOKENS_FOCUS" "${targets[@]}"

  return "$failed"
}

# self-test.sh が scope_for を直接呼べるよう、source されたときは main を走らせない。
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
