module.exports = {
  apps: [
    {
      name: 'trackare-backend',
      script: './backend/server.js',
      instances: 'max', // Or set a specific number like 2
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
