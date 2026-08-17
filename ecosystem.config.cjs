module.exports = {
  apps: [
    {
      name: 'book-neoshen',
      script: '.output/server/index.mjs',
      interpreter: '/www/server/nodejs/v24.15.0/bin/bun',
      cwd: '/www/wwwroot/book.neoshen.dpdns.org',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '0.0.0.0',
        NITRO_PORT: 3001,
        NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
      },
      // ── 防护配置（防脚本路径失效时狂重启刷爆日志）──
      // 历史教训：2026-08-17 book-neoshen 6,891,715 次重启
      // 根因：worktree 被清空，bash 找不到脚本 → exit 127 → autorestart 立即循环
      // 教训见 .agent/memory/ 中的 PM2 防护记录
      min_uptime: '10s',        // 进程至少运行 10s 才算"启动成功"
      max_restarts: 10,         // 在 max_restart_time 窗口内最多重启 10 次
      max_restart_time: '5m',   // 5 分钟内的重启计数窗口
      restart_delay: 5000,      // 重启前等 5s（避免立即循环）
      exp_backoff: true,        // 指数退避：10s → 20s → 40s ...（最多 60s）
      max_memory_restart: '1536M',// 内存超 1536M 自动重启（2026-08-17 由 1024M 调高；新 build 700-800MB 基线 + 150MB 突发缓冲 = 接近 1024M 上限，加 0.5x 缓冲防峰值误触）
      kill_timeout: 5000,       // 优雅停止最多等 5s
      listen_timeout: 8000,     // listen() 最多 8s
    },
  ],
  // ── Pre-start 钩子：清 stale lease 防 500 ──
  // 历史教训：2026-08-17 旧进程 OOM 死透但 lease 没释放，PM2 auto-restart 后
  // 新进程持续 ELOCKED → 全站 500。Pre-start 在每次 pm2 deploy setup 前清掉
  // mtime > 1min 的 stale lease。注：sub-minute 残留（< 30s）由 proper-lockfile
  // 心跳 + clearStaleSelfLock 处理，与 clean-stale-lease.sh 30s 阈值保持一致。
  deploy: {
    production: {
      'pre-setup': 'echo "[deploy] Pre-setup: 清 stale lease (mtime > 1min)"; find workspace/.nbook/agent/migrations -maxdepth 1 -name "*.lease" -mmin +1 -delete 2>/dev/null; find workspace/.nbook/agent/migrations -maxdepth 1 -name "*.lease.lock" -mmin +1 -exec rm -rf {} + 2>/dev/null; echo "[deploy] Pre-setup done"',
    },
  },
  // ── Manual pre-start script（用于 pm2 start 之前手动跑）──
  // 用法: 在 ecosystem.config.cjs 修改后, 跑:
  //   bash scripts/clean-stale-lease.sh && pm2 delete book-neoshen && pm2 start ecosystem.config.cjs
  // 详见 scripts/clean-stale-lease.sh
};
