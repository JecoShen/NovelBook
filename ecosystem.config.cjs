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
        NEURO_BOOK_APPLICATION_ROOT: '/www/wwwroot/book.neoshen.dpdns.org',
        NEURO_BOOK_STATE_ROOT: '/www/wwwroot/book.neoshen.dpdns.org',
        NEURO_BOOK_CACHE_ROOT: '/www/wwwroot/book.neoshen.dpdns.org/cache',
        // 裸跑 index.mjs 也必须声明 Product 运行态身份（对齐 product-command.mjs 的注入）：
        // 缺 PRODUCT_IMAGE_ROOT 时运行路径会误判为 Source 模式，去加载仓库源码投影
        // （#scripts 解析失败 → Agent API 全 500，2026-09-13 事故）；REPOSITORY_ROOT
        // 是 profile-dsl Import.path 在 Product Runtime 下的强制显式根。
        NEURO_BOOK_REPOSITORY_ROOT: '/www/wwwroot/book.neoshen.dpdns.org',
        NEURO_BOOK_PRODUCT_IMAGE_ROOT: '/www/wwwroot/book.neoshen.dpdns.org/.output',
      },
      // ── 关闭 PM2 进程内 APM（pmx）：Bun 下每 800ms 烧掉半个核 ──
      // 2026-09-09 根因：进程 7.15 天累计烧 4 天 1 小时 CPU（均值 56.6%），空载、无请求、
      // 无日志、无 I/O，99.5% 用户态。链条：
      //   ProcessContainerForkBun.js:12 → ProcessUtils.injectModules()
      //   → ProcessUtils.js:5 `pmx !== 'false'` → require('pm2-io-bpm')
      //   → pm2-io-bpm/index.js:8 `new PMX().init()`（**导入即启动**，
      //      所以 ProcessUtils 第 11 行那个提前 return 拦不住它）
      //   → modules/pm2-io-bpm/metrics/v8.js:74 setInterval(v8.getHeapStatistics, 800)
      // 而 Bun 的 v8.getHeapStatistics() 是 O(堆大小)：空堆 5.5ms，229MB 堆 426-473ms。
      // 于是每 800ms 阻塞主线程约 400ms —— 实测占空比周期正是 800ms，
      // PM2 自报 Event Loop Latency p95 = 394ms，两边吻合。堆越大越糟
      // （新进程 16-19% → 7 天后 90%），这也是 2026-08-28 部署时记过一次
      // 「旧 process 100% CPU 异常」却未查根因的同一现象。
      // 代价：失去 pm2 describe 的进程内指标（堆 / 事件循环延迟 / HTTP 延迟）；
      // pm2 list 的 CPU/内存由 daemon 从 /proc 读，不受影响。
      pmx: false,

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
