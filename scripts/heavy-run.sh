#!/usr/bin/env bash
# heavy-run — 内存受限宿主机上运行重资源命令（产品构建 / 分层 typecheck / 全量测试）的统一包装。
#
# 1. oom_score_adj 抬到 0：agent 宿主进程以 -1000 运行且被后代继承，不抬会让重命令对
#    earlyoom 隐形，内存紧张时 earlyoom 转而杀死生产进程（2026-09-10 实测两次）。
# 2. flock 串行化：8 GiB 级宿主机上两个重负载并发必然贴线触发 earlyoom。
#
# 锁在系统 Temp，进程退出（含被杀）自动释放；命令退出码原样透传。
set -euo pipefail

if [[ $# -eq 0 ]]; then
    echo "用法: heavy-run.sh <command> [args...]" >&2
    exit 64
fi

lock="${TMPDIR:-/tmp}/neuro-book-heavy.lock"
exec 9>"$lock"
if ! flock -n 9; then
    echo "[heavy-run] 另一重命令持有锁，等待中: $lock" >&2
    flock 9
fi

if [[ -w /proc/self/oom_score_adj ]]; then
    echo 0 > /proc/self/oom_score_adj
else
    echo "[heavy-run] 警告: /proc/self/oom_score_adj 不可写，跳过保护" >&2
fi

exec "$@"
