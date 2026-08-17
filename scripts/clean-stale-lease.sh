#!/usr/bin/env bash
# scripts/clean-stale-lease.sh
# ─────────────────────────────────────────────────────────────────────
# 清理 stale Agent Session Store lease + Application State lease
# 历史教训：2026-08-17 旧进程 OOM 死透但 lease 没释放（heartbeat 停了
# 4 分 35 秒），新进程持续 ELOCKED → 全站 500。
# 2026-08-17 调阈值 5min → 30s：与 proper-lockfile 30s 心跳一致，覆盖
# 35s 残留 .lock（旧阈值 5min 覆盖不到的关键 case）。
# 已知 limitation: < 30s 残留 .lock（如 7s 端到端 case）依然 cover 不到
# — 与 proper-lockfile 30s 心跳行为一致。
#
# 用法：
#   bash scripts/clean-stale-lease.sh              # 列出 stale (dry-run, 默认 30s 阈值)
#   bash scripts/clean-stale-lease.sh --force      # 实际删除
#   bash scripts/clean-stale-lease.sh --force --archive
#                                                  # 删除前 cp 到 .agent/plan/lease-archive-2026-MM-DD/
#   bash scripts/clean-stale-lease.sh --stale-seconds 60
#                                                  # 自定义阈值（亚分钟精度）
#   bash scripts/clean-stale-lease.sh --stale-minutes 5
#                                                  # 兼容旧参数（向下取整到分钟）
#
# 此脚本配合 ecosystem.config.cjs 的 deploy.pre-setup 使用。
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

WORKSPACE="${WORKSPACE:-/www/wwwroot/book.neoshen.dpdns.org/workspace}"
MIGRATIONS="${MIGRATIONS:-${WORKSPACE}/.nbook/agent/migrations}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/www/wwwroot/book.neoshen.dpdns.org/.agent/plan}"
# 默认 30s（2026-08-17 由 5min 调低；与 proper-lockfile 30s 心跳一致）
STALE_SECONDS=30
FORCE=0
DO_ARCHIVE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=1; shift ;;
        --archive) DO_ARCHIVE=1; shift ;;
        --stale-seconds) STALE_SECONDS="$2"; shift 2 ;;
        --stale-minutes) STALE_SECONDS=$(( $2 * 60 )); shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

# 阈值显示（自动选单位）
if (( STALE_SECONDS < 60 )); then
    STALE_DISPLAY="${STALE_SECONDS}s"
else
    STALE_DISPLAY="$(( STALE_SECONDS / 60 ))m$(( STALE_SECONDS % 60 ))s"
fi
echo "[clean-stale-lease] 工作目录: $WORKSPACE"
echo "[clean-stale-lease] stale 阈值: mtime > ${STALE_DISPLAY} (${STALE_SECONDS}s)"
echo

# 1. 列出 stale 候选
# 用 find -newermt 处理亚分钟粒度（mmin 只支持整分钟）
THRESHOLD_TIME=$(date -d "@$(( $(date +%s) - STALE_SECONDS ))" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null)
if [[ -z "$THRESHOLD_TIME" ]]; then
    echo "[clean-stale-lease] ❌ 无法计算阈值时间戳（date -d 失败）" >&2
    exit 3
fi
mapfile -t STALE_FILES < <(find "$MIGRATIONS" -maxdepth 1 -name "*.lease" ! -newermt "$THRESHOLD_TIME" 2>/dev/null)
mapfile -t STALE_LOCKS < <(find "$MIGRATIONS" -maxdepth 1 -name "*.lease.lock" ! -newermt "$THRESHOLD_TIME" 2>/dev/null)

if [[ ${#STALE_FILES[@]} -eq 0 && ${#STALE_LOCKS[@]} -eq 0 ]]; then
    echo "[clean-stale-lease] ✅ 没有 stale lease (全部 mtime 在 ${STALE_DISPLAY} 内)"
    exit 0
fi

echo "[clean-stale-lease] 找到 ${#STALE_FILES[@]} 个 stale lease + ${#STALE_LOCKS[@]} 个 stale lock:"
for f in "${STALE_FILES[@]}"; do
    echo "  FILE: $f"
    echo "    owner: $(jq -r '.pid // "?"' "$f" 2>/dev/null || echo '?')"
    echo "    acquiredAt: $(jq -r '.acquiredAt // "?"' "$f" 2>/dev/null || echo '?')"
    echo "    mtime: $(stat -c %y "$f" 2>/dev/null || echo '?')"
done
for d in "${STALE_LOCKS[@]}"; do
    echo "  LOCK: $d"
    echo "    mtime: $(stat -c %y "$d" 2>/dev/null || echo '?')"
done
echo

# 2. dry-run 检查
if [[ $FORCE -eq 0 ]]; then
    echo "[clean-stale-lease] ⚠️  dry-run 模式，未删除。"
    echo "  实际删除: bash scripts/clean-stale-lease.sh --force"
    echo "  删除前归档: bash scripts/clean-stale-lease.sh --force --archive"
    exit 0
fi

# 3. 可选归档
if [[ $DO_ARCHIVE -eq 1 ]]; then
    TODAY=$(date -u +%Y-%m-%d)
    ARCHIVE_DIR="${ARCHIVE_ROOT}/lease-archive-${TODAY}-stale"
    mkdir -p "$ARCHIVE_DIR"
    for f in "${STALE_FILES[@]}"; do
        cp "$f" "${ARCHIVE_DIR}/$(basename "$f").bak.$(stat -c %Y "$f")"
        echo "[clean-stale-lease] 📦 归档: $f → ${ARCHIVE_DIR}/"
    done
fi

# 4. 实际删除
for f in "${STALE_FILES[@]}"; do
    rm -f "$f"
    echo "[clean-stale-lease] ❌ 删除 FILE: $f"
done
for d in "${STALE_LOCKS[@]}"; do
    rm -rf "$d"  # 目录! -rf
    echo "[clean-stale-lease] ❌ 删除 LOCK: $d"
done

echo
echo "[clean-stale-lease] ✅ 清理完成。下一步:"
echo "  pm2 delete book-neoshen && pm2 start ecosystem.config.cjs"
