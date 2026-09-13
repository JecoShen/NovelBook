#!/bin/sh
set -eu

if [ "$#" -ne 6 ]; then
    echo "usage: verify-posix-product.sh <platform> <source.zip> <product.tar.gz> <version> <port> <browser>" >&2
    exit 1
fi

PLATFORM="$1"
SOURCE_ARCHIVE="$2"
PRODUCT_ARCHIVE="$3"
VERSION="${4#v}"
PORT="$5"
BROWSER="$6"

if [ "$BROWSER" = "playwright" ]; then
    BROWSER="$(node --input-type=module -e 'import {chromium} from "playwright-core"; process.stdout.write(chromium.executablePath())')"
fi
if [ ! -x "$BROWSER" ]; then
    echo "Product browser smoke缺少可执行浏览器：$BROWSER" >&2
    exit 1
fi

case "$PLATFORM" in
    linux-x64-glibc)
        LIBSQL="@libsql/linux-x64-gnu/"
        SQLITE_VEC="sqlite-vec-linux-x64/"
        SHARP_NATIVE="@img/sharp-linux-x64/"
        SHARP_LIBVIPS="@img/sharp-libvips-linux-x64/"
        ;;
    linux-aarch64-glibc)
        LIBSQL="@libsql/linux-arm64-gnu/"
        SQLITE_VEC="sqlite-vec-linux-arm64/"
        SHARP_NATIVE="@img/sharp-linux-arm64/"
        SHARP_LIBVIPS="@img/sharp-libvips-linux-arm64/"
        ;;
    darwin-x64)
        LIBSQL="@libsql/darwin-x64/"
        SQLITE_VEC="sqlite-vec-darwin-x64/"
        SHARP_NATIVE="@img/sharp-darwin-x64/"
        SHARP_LIBVIPS="@img/sharp-libvips-darwin-x64/"
        ;;
    darwin-aarch64)
        LIBSQL="@libsql/darwin-arm64/"
        SQLITE_VEC="sqlite-vec-darwin-arm64/"
        SHARP_NATIVE="@img/sharp-darwin-arm64/"
        SHARP_LIBVIPS="@img/sharp-libvips-darwin-arm64/"
        ;;
    *) echo "unsupported Product platform: $PLATFORM" >&2; exit 1 ;;
esac

entries="$(tar -tzf "$PRODUCT_ARCHIVE")"
printf '%s\n' "$entries" | grep -E '^(\./)?\.output/server/index\.mjs$' >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/$LIBSQL" >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/$SQLITE_VEC" >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/sharp/" >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/@img/colour/" >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/$SHARP_NATIVE" >/dev/null
printf '%s\n' "$entries" | grep -F ".output/server/node_modules/$SHARP_LIBVIPS" >/dev/null

SMOKE_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/neuro-book-$PLATFORM-smoke"
APPLICATION_ROOT="$SMOKE_ROOT/application"
STATE_ROOT="$SMOKE_ROOT/state"
rm -rf "$SMOKE_ROOT"
mkdir -p "$APPLICATION_ROOT" "$STATE_ROOT/workspace" "$STATE_ROOT/logs"
unzip -q "$SOURCE_ARCHIVE" -d "$APPLICATION_ROOT"
tar -xpzf "$PRODUCT_ARCHIVE" -C "$APPLICATION_ROOT"
if [ -e "$APPLICATION_ROOT/node_modules" ]; then
    echo "Product smoke root unexpectedly contains node_modules." >&2
    exit 1
fi
if [ ! -x "$APPLICATION_ROOT/.output/server/assets/workspace/.nbook/agent/bin/workspace" ]; then
    echo "Product缺少可执行的稳定Workspace CLI。" >&2
    exit 1
fi
bun --no-install --no-env-file scripts/release/verify-extracted-product.ts --product-root "$APPLICATION_ROOT"

cat > "$STATE_ROOT/config.yaml" <<EOF
server:
  host: 127.0.0.1
  port: $PORT
database:
  kind: sqlite
  url: file:$STATE_ROOT/workspace/.nbook/neuro-book.sqlite
auth:
  enabled: false
EOF
cat > "$STATE_ROOT/.env" <<EOF
HOST=127.0.0.1
PORT=$PORT
NUXT_PORT=$PORT
DATABASE_KIND=sqlite
DATABASE_URL=file:$STATE_ROOT/workspace/.nbook/neuro-book.sqlite
EOF

export NODE_ENV=production
export HOST=127.0.0.1
export PORT
export NUXT_PORT="$PORT"
export DATABASE_KIND=sqlite
export DATABASE_URL="file:$STATE_ROOT/workspace/.nbook/neuro-book.sqlite"
export NEURO_BOOK_APPLICATION_ROOT="$APPLICATION_ROOT"
export NEURO_BOOK_STATE_ROOT="$STATE_ROOT"

(cd "$APPLICATION_ROOT" && bun --no-install --no-env-file .output/server/commands/product-command.mjs check all)
(cd "$APPLICATION_ROOT" && bun --no-install --no-env-file .output/server/commands/product-command.mjs command migrate-application-state --apply)
test -f "$STATE_ROOT/workspace/.nbook/neuro-book.sqlite"
(cd "$APPLICATION_ROOT" && exec bun --no-install --no-env-file .output/server/commands/product-command.mjs command start) >"$SMOKE_ROOT/product.log" 2>&1 &
PRODUCT_PID=$!
cleanup() {
    kill "$PRODUCT_PID" 2>/dev/null || true
    wait "$PRODUCT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=false
attempt=0
while [ "$attempt" -lt 120 ]; do
    if curl --fail --silent "http://127.0.0.1:$PORT/api/app/version" >/dev/null; then
        ready=true
        break
    fi
    if ! kill -0 "$PRODUCT_PID" 2>/dev/null; then
        cat "$SMOKE_ROOT/product.log"
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
done
if [ "$ready" != true ]; then
    cat "$SMOKE_ROOT/product.log"
    exit 1
fi

# Agent API 冒烟：覆盖 profile 编译状态与会话创建链路。2026-09-13 事故证明
# 「进程存活 + 版本探活 + 浏览器 smoke」抓不到 Agent 路径故障（运行态模式误判
# 导致 /api/agent/* 全 500，leader.default 编译产物 stale）。invocation 需要真实
# 模型凭据，不在发布门禁内；session 创建本身已触发 profile 加载与 staleness 判定。
agent_session="$SMOKE_ROOT/agent-session.json"
if ! curl --fail --silent -X POST "http://127.0.0.1:$PORT/api/agent/sessions" \
    -H "content-type: application/json" \
    -d '{"profileKey":"leader.default"}' >"$agent_session"; then
    echo "Product Agent API smoke失败：POST /api/agent/sessions 非 2xx" >&2
    cat "$SMOKE_ROOT/product.log" >&2
    exit 1
fi
if ! grep -q '"sessionId"' "$agent_session"; then
    echo "Product Agent API smoke失败：创建会话响应缺少 sessionId" >&2
    cat "$agent_session" >&2
    exit 1
fi
if ! curl --fail --silent "http://127.0.0.1:$PORT/api/agent/sessions" >/dev/null; then
    echo "Product Agent API smoke失败：GET /api/agent/sessions 非 2xx" >&2
    cat "$SMOKE_ROOT/product.log" >&2
    exit 1
fi

node --import tsx scripts/deploy/product-browser-smoke.ts \
    --url "http://127.0.0.1:$PORT" \
    --expected-version "$VERSION" \
    --browser-executable "$BROWSER" \
    --screenshot "$SMOKE_ROOT/browser-failure.png"
