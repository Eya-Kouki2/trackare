module.exports = {
  apps: [
    {
      name: 'trackare-backend',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'trackare-iot',
      script: './backend/ml/iot/pc_server.py',
      interpreter: './backend/ml/.venv/Scripts/python.exe',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
    },
  ],
};
