/**
 * PM2 Ecosystem — Lunex DEX
 *
 * Secrets via Doppler (produção):
 *   1. doppler setup --project lunex-dex --config production
 *   2. doppler run -- pm2 start ecosystem.config.js --env production
 *
 * Desenvolvimento local (sem Doppler):
 *   pm2 start ecosystem.config.js --env development
 */
module.exports = {
  apps: [
    {
      name: 'lunex-api',

      // Doppler injeta os secrets no processo — sem env_file em disco.
      // Em dev, o .env local é lido automaticamente pelo dotenv dentro do app.
      script: 'dist/index.js',
      cwd: '/opt/lunex/spot-api',

      instances: 1,
      exec_mode: 'fork',

      // Variáveis NÃO secretas — tudo secreto vai no Doppler
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        WS_PORT: 4001,
        TRUST_PROXY: 'true',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 4000,
        WS_PORT: 4001,
      },

      max_memory_restart: '512M',
      error_file: '/var/log/lunex/api-error.log',
      out_file: '/var/log/lunex/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
    },
  ],
}
