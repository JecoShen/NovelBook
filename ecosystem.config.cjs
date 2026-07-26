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
    },
  ],
};
