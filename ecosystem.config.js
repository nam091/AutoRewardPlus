module.exports = {
  apps: [{
    name: 'autoreward-dashboard',
    script: 'dist/dashboard/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3030,
      DASHBOARD_PORT: 3030,
      DASHBOARD_HOST: '0.0.0.0',
      DASHBOARD_ALLOW_NO_AUTH: '1',
      DEFAULT_PROXY_URL: 'http://100.74.159.41',
      DEFAULT_PROXY_PORT: 10808
    }
  }]
};
