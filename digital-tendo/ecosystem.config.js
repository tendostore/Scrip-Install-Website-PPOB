module.exports = {
  apps: [{
    name: "tendobot",
    script: "./src/index.js",
    env: {
      NODE_ENV: "production",
      TZ: "Asia/Jakarta"
    },
    watch: false,
    max_memory_restart: "1G",
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm Z",
    merge_logs: true
  }]
}

