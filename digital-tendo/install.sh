#!/bin/bash
# install.sh (Versi Ringan)

C_GREEN="\e[32m"
C_MAG="\e[35m"
C_RST="\e[0m"

echo -e "${C_MAG}>> Memulai Instalasi Server Digital Tendo...${C_RST}"

# 1. Buka Port Firewall
sudo ufw allow 3000/tcp > /dev/null 2>&1 || true
sudo ufw allow 80/tcp > /dev/null 2>&1 || true
sudo ufw allow 443/tcp > /dev/null 2>&1 || true

# 2. Update Sistem & Install Paket Dasar
echo -e "${C_MAG}>> Menginstall dependensi dasar Ubuntu...${C_RST}"
sudo apt-get update -y
sudo apt-get install -y curl git wget zip unzip build-essential sqlite3

# 3. Setup Node.js & PM2
echo -e "${C_MAG}>> Menginstall Node.js 20.x & PM2...${C_RST}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
pm2 install pm2-logrotate

# 4. Setup Aplikasi
echo -e "${C_MAG}>> Menginstall NPM Dependencies...${C_RST}"
npm install

# 5. Buat folder untuk logs
mkdir -p logs

echo -e "${C_GREEN}✅ Instalasi Server Selesai!${C_RST}"
echo "Ketik 'npm start' untuk testing, atau 'pm2 start ecosystem.config.js' untuk background."

