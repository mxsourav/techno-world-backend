module.exports = {
  apps: [
    {
      name: 'techno-world-api',
      script: 'dist/server.js',
      cwd: '/home/technoworldbookswebsite/techno-world-backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '450M',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
