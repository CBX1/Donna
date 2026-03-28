module.exports = {
  apps: [{
    name: 'donna',
    script: 'src/app.js',
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
    },
    env_development: {
      NODE_ENV: 'development',
    },
  }],
};
