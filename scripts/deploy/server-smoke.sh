#!/usr/bin/env bash
set -euo pipefail

root="${NEURO_BOOK_ROOT:-$(pwd)}"
pm2_name="${NEURO_BOOK_PM2_NAME:-book-neoshen}"
port="${PORT:-3001}"
local_url="${NEURO_BOOK_LOCAL_URL:-http://127.0.0.1:${port}}"
public_url="${NEURO_BOOK_PUBLIC_URL:-https://book.neoshen.dpdns.org}"
expected_version="${NEURO_BOOK_EXPECTED_VERSION:-}"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "缺少命令：$1" >&2
        exit 1
    fi
}

json_field() {
    node -e "const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(String(input${1} ?? ''))"
}

version_label() {
    curl --fail --silent --show-error "$1/api/app/version" | json_field ".versionLabel"
}

check_version() {
    local label
    label="$(version_label "$1" ".versionLabel")"
    if [[ -z "$label" ]]; then
        echo "版本接口没有返回 versionLabel：$1/api/app/version" >&2
        exit 1
    fi
    if [[ -n "$expected_version" && "$label" != "$expected_version" && "$label" != "v${expected_version}" ]]; then
        echo "版本不匹配：$1 期望 $expected_version，实际 $label" >&2
        exit 1
    fi
    echo "version ok: $1 -> $label"
}

require_command curl
require_command node
require_command pm2

if [[ -z "$expected_version" && -f "$root/package.json" ]]; then
    expected_version="v$(node -e "process.stdout.write(require(process.argv[1]).version)" "$root/package.json")"
fi

pm2_json="$(pm2 jlist)"
pm2_status="$(printf '%s' "$pm2_json" | node -e "const apps=JSON.parse(require('node:fs').readFileSync(0, 'utf8')); const app=apps.find((item)=>item.name===process.argv[1]); if (!app) process.exit(2); process.stdout.write(app.pm2_env.status)" "$pm2_name")" || {
    echo "PM2 未找到进程：$pm2_name" >&2
    exit 1
}
if [[ "$pm2_status" != "online" ]]; then
    echo "PM2 进程不是 online：$pm2_name -> $pm2_status" >&2
    exit 1
fi
echo "pm2 ok: $pm2_name online"

if command -v ss >/dev/null 2>&1; then
    if ! ss -ltn "sport = :${port}" | grep -q ":${port}"; then
        echo "端口未监听：${port}" >&2
        exit 1
    fi
    echo "port ok: ${port}"
fi

check_version "$local_url"
check_version "$public_url"

root_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$public_url/")"
case "$root_status" in
    200|302|401) echo "public root ok: HTTP $root_status" ;;
    *) echo "公网根路径状态异常：HTTP $root_status" >&2; exit 1 ;;
esac

if command -v nginx >/dev/null 2>&1; then
    nginx -t
fi

echo "server smoke passed"
