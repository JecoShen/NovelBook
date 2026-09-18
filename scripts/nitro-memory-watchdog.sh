#!/usr/bin/env bash
# scripts/nitro-memory-watchdog.sh
# ─────────────────────────────────────────────────────────────────────
# nitro 子进程内存看门：product-start 启动路径下，PM2 托管的是 ~56MB 的
# wrapper（product-start.mjs），真正的 nitro 子进程（.output/server/index.mjs）
# 是 wrapper 的孙子进程，对 PM2 max_memory_restart 不可见——那条 1536M 保险丝
# 实际已失效（2026-09-18 段D 上线后确认）。本脚本补回这条保险丝：
# 定位 wrapper（pm2 jlist 权威来源，避开 pgrep -f 命中 bash -c 壳的陷阱）→
# 找其子进程 → 读 /proc/<pid>/status VmRSS → 超阈值则 pm2 restart。
#
# 设计取舍：
# - restart 走 PM2（非 kill 子进程）：让 seed + check-migrations 按设计路径
#   重跑，进程树保持 wrapper→nitro 形态，与 max_memory_restart 语义一致。
# - 冷却窗（默认 900s）防泄漏进程被反复重启刷重启计数；窗内只记录不动作，
#   兜底由 earlyoom + adj-500 cron 承担。
# - 静默即健康：只在超阈值/动作/错误时写日志（cron 已把 stdout 重定向进日志）。
#
# 用法：
#   bash scripts/nitro-memory-watchdog.sh              # 检查并在超阈值时 restart
#   bash scripts/nitro-memory-watchdog.sh --dry-run    # 只报告，不 restart
#
# env 覆盖：
#   NBOOK_WATCHDOG_RSS_MAX_KB   阈值 KiB（默认 1572864 = 1536MiB，对齐原
#                               max_memory_restart 1536M 的意图）
#   NBOOK_WATCHDOG_COOLDOWN_SEC 冷却窗秒数（默认 900）
#   NBOOK_WATCHDOG_APP          PM2 应用名（默认 book-neoshen）
#
# cron（root crontab，每 2 分钟）：
#   */2 * * * * flock -xn /tmp/nbook-nitro-watchdog.lock -c 'bash /www/wwwroot/book.neoshen.dpdns.org/scripts/nitro-memory-watchdog.sh' >> /www/wwwroot/book.neoshen.dpdns.org/logs/nitro-memory-watchdog.log 2>&1
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# cron 默认 PATH 不含 nodejs 目录，pm2 不在上面（2026-09-18 实测）
export PATH="/www/server/nodejs/v24.15.0/bin:$PATH"

APP="${NBOOK_WATCHDOG_APP:-book-neoshen}"
RSS_MAX_KB="${NBOOK_WATCHDOG_RSS_MAX_KB:-1572864}"
COOLDOWN_SEC="${NBOOK_WATCHDOG_COOLDOWN_SEC:-900}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${REPO_ROOT}/logs/.nitro-watchdog-last-restart"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

log() { echo "[nitro-watchdog] $(date '+%F %T') $*"; }

# 1. wrapper PID（pm2 jlist 是权威来源；PM2 daemon 不可达时安静退出，下轮再试）
WRAPPER_PID=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
try:
    for a in json.load(sys.stdin):
        if a.get('name') == '${APP}' and a.get('pm2_env',{}).get('status') == 'online':
            print(a.get('pid') or '')
            break
except Exception:
    pass
")
if [[ -z "$WRAPPER_PID" ]]; then
    log "WARN: ${APP} 不在 online 状态（PM2 不可达或应用未运行），本轮跳过"
    exit 0
fi
if [[ ! -d "/proc/${WRAPPER_PID}" ]]; then
    log "WARN: PM2 记录 pid=${WRAPPER_PID} 但 /proc 不存在（启动竞态），本轮跳过"
    exit 0
fi

# 2. nitro 子进程（product-start spawn；冷启动早期可能还没 spawn，跳过即可）
mapfile -t CHILD_PIDS < <(ps -o pid= --ppid "$WRAPPER_PID" 2>/dev/null | tr -d ' ' | grep -v '^$' || true)
if [[ ${#CHILD_PIDS[@]} -eq 0 ]]; then
    # 启动早期正常：product-start 先做 seed/迁移检查再 spawn nitro
    exit 0
fi

# 3. RSS 检查（取所有子进程最大值；正常只有 1 个 nitro）
MAX_RSS=0
MAX_PID=""
for pid in "${CHILD_PIDS[@]}"; do
    rss=$(awk '/^VmRSS:/{print $2}' "/proc/${pid}/status" 2>/dev/null || echo 0)
    [[ -z "$rss" ]] && rss=0
    if (( rss > MAX_RSS )); then MAX_RSS=$rss; MAX_PID=$pid; fi
done

if (( MAX_RSS <= RSS_MAX_KB )); then
    # 静默即健康；dry-run 时打印观测值便于验证检测链
    if [[ $DRY_RUN -eq 1 ]]; then
        log "OK: wrapper=${WRAPPER_PID} nitro=${MAX_PID} RSS $(( MAX_RSS / 1024 ))MiB <= $(( RSS_MAX_KB / 1024 ))MiB"
    fi
    exit 0
fi

# 4. 超阈值 → 冷却窗判定
NOW=$(date +%s)
LAST=0
[[ -f "$STATE_FILE" ]] && LAST=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
if (( NOW - LAST < COOLDOWN_SEC )); then
    log "BREACH(cooldown): nitro pid=${MAX_PID} RSS $(( MAX_RSS / 1024 ))MiB > $(( RSS_MAX_KB / 1024 ))MiB，距上次重启 $(( NOW - LAST ))s < ${COOLDOWN_SEC}s，仅记录（兜底：earlyoom）"
    exit 0
fi

if [[ $DRY_RUN -eq 1 ]]; then
    log "BREACH(dry-run): nitro pid=${MAX_PID} RSS $(( MAX_RSS / 1024 ))MiB > $(( RSS_MAX_KB / 1024 ))MiB，本应执行: pm2 restart ${APP}"
    exit 0
fi

log "BREACH: nitro pid=${MAX_PID} RSS $(( MAX_RSS / 1024 ))MiB > $(( RSS_MAX_KB / 1024 ))MiB → pm2 restart ${APP}"
echo "$NOW" > "$STATE_FILE"
pm2 restart "$APP" >> /dev/null 2>&1 || { log "ERROR: pm2 restart ${APP} 失败（exit $?）"; exit 1; }
log "RESTARTED: ${APP}（新进程将按 product-start 设计路径重跑 seed+迁移检查）"
