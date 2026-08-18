#!/bin/bash
# PostToolUse hook: 监控 worktree 状态
# 触发条件: git worktree add / git push origin main / git merge 后
# 行为: 检查所有非 main worktree, 报告 stale (ahead=0, behind>0) 或数量超阈值
# 来源: AGENTS.md worktree 关闭规则

set -eu

# 从 stdin 读 tool input (JSON)
INPUT=$(cat)

# 解析 command 字段
COMMAND=$(printf '%s' "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//;s/"$//' || echo "")

# 只关心 git worktree add / push origin main
case "$COMMAND" in
  *"git worktree add"*) ;;
  *"git push origin main"*) ;;
  *"git push origin HEAD:main"*) ;;
  *) exit 0 ;;
esac

# 定位 git 根
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -z "$ROOT" ] && exit 0

cd "$ROOT" || exit 0

# 读 main 最新 commit
MAIN_HEAD=$(git rev-parse origin/main 2>/dev/null) || MAIN_HEAD=$(git rev-parse main 2>/dev/null) || exit 0
[ -z "$MAIN_HEAD" ] && exit 0

# 遍历 worktree
TOTAL=0
STALE=0
STALE_LIST=""
DETAIL=""

while IFS= read -r line; do
  if [[ "$line" =~ ^worktree\ (.+) ]]; then
    wt="${BASH_REMATCH[1]}"
    TOTAL=$((TOTAL + 1))
    # 跳过主工作区
    [ "$wt" = "$ROOT" ] && continue
    branch=$(git -C "$wt" branch --show-current 2>/dev/null) || continue
    [ -z "$branch" ] || [ "$branch" = "main" ] && continue
    # 检测 stale: 该 branch 不领先 main, 但落后 main
    ahead=$(git rev-list --count "${MAIN_HEAD}..${branch}" 2>/dev/null || echo 0)
    behind=$(git rev-list --count "${branch}..${MAIN_HEAD}" 2>/dev/null || echo 0)
    size=$(du -sh "$wt" 2>/dev/null | cut -f1)
    if [ "$ahead" = "0" ] && [ "$behind" -gt "0" ]; then
      STALE=$((STALE + 1))
      STALE_LIST="${STALE_LIST}  - ${wt} [${branch} behind=${behind} size=${size}]
"
    else
      DETAIL="${DETAIL}  - ${wt} [${branch} ahead=${ahead} behind=${behind} size=${size}]
"
    fi
  fi
done < <(git worktree list --porcelain)

# 报告
NON_MAIN=$((TOTAL - 1))
if [ "$STALE" -gt "0" ] || [ "$NON_MAIN" -gt "3" ]; then
  echo "⚠️  [worktree state]"
  echo "   total: ${TOTAL} (非 main: ${NON_MAIN})"
  echo "   stale: ${STALE} (ahead=0, 工作已落 main)"
  if [ -n "$STALE_LIST" ]; then
    echo "   stale worktrees:"
    printf '%s' "$STALE_LIST"
  fi
  if [ -n "$DETAIL" ] && [ "$STALE" -gt "0" ]; then
    echo "   active worktrees:"
    printf '%s' "$DETAIL"
  fi
  echo ""
  echo "   按 AGENTS.md worktree 关闭规则: archive 关键产物 → git worktree remove → git branch -D"
  exit 0  # 不阻塞, 只警告
fi
