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
      max_memory_restart: '1024M',// 内存超 1024M 自动重启（2026-08-17 由 512M → 256M → 1024M，根因：旧 build 200MB / 新 build 700MB 基线 + 缓冲 1.5x）
      kill_timeout: 5000,       // 优雅停止最多等 5s
      listen_timeout: 8000,     // listen() 最多 8s
    },
  ],
  // ── Pre-start 钩子：清 stale lease 防 500 ──
  // 历史教训：2026-08-17 旧进程 OOM 死透但 lease 没释放，PM2 auto-restart 后
  // 新进程持续 ELOCKED → 全站 500。Pre-start 在每次 pm2 start 前清掉 mtime > 5min 的
  // stale lease 目录，避免相同事故再发。
  deploy: {
    production: {
      'pre-setup': 'echo "[deploy] Pre-setup: 清 stale lease (mtime > 5min)"; find workspace/.nbook/agent/migrations -maxdepth 1 -name "*.lease" -mmin +5 -delete 2>/dev/null; find workspace/.nbook/agent/migrations -maxdepth 1 -name "*.lease.lock" -mmin +5 -exec rm -rf {} + 2>/dev/null; echo "[deploy] Pre-setup done"',
    },
  },
  // ── Manual pre-start script（用于 pm2 start 之前手动跑）──
  // 用法: 在 ecosystem.config.cjs 修改后, 跑:
  //   bash scripts/clean-stale-lease.sh && pm2 delete book-neoshen && pm2 start ecosystem.config.cjs
  // 详见 scripts/clean-stale-lease.sh
};
