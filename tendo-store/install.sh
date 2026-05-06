#!/bin/bash

# ==========================================
# WARNA UNTUK UI TERMINAL
# ==========================================
C_RED="\e[31m"
C_GREEN="\e[32m"
C_YELLOW="\e[33m"
C_BLUE="\e[34m"
C_CYAN="\e[36m"
C_MAG="\e[35m"
C_RST="\e[0m"
C_BOLD="\e[1m"

# Buka Port 3000, 80 (HTTP), dan 443 (HTTPS)
sudo ufw allow 3000/tcp > /dev/null 2>&1 || true
sudo ufw allow 80/tcp > /dev/null 2>&1 || true
sudo ufw allow 443/tcp > /dev/null 2>&1 || true
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT > /dev/null 2>&1 || true
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT > /dev/null 2>&1 || true
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT > /dev/null 2>&1 || true

# ==========================================
# 1. BIKIN SHORTCUT 'BOT' DI VPS
# ==========================================
# Membersihkan script startup lama jika ada
sed -i '/# Auto-start bot panel/d' ~/.bashrc
sed -i '/if \[ -t 1 \] && \[ -x \/usr\/bin\/menu \]; then/d' ~/.bashrc
sed -i '/\/usr\/bin\/bot/d' ~/.bashrc
sed -i '/\/usr\/bin\/menu/d' ~/.bashrc

if [ ! -f "/usr/bin/bot" ]; then
    echo -e '#!/bin/bash\ncd "'$(pwd)'"\n./install.sh' | sudo tee /usr/bin/bot > /dev/null
    sudo chmod +x /usr/bin/bot
fi

if [ ! -f "/usr/bin/menu" ]; then
    echo -e '#!/bin/bash\ncd "'$(pwd)'"\n./install.sh' | sudo tee /usr/bin/menu > /dev/null
    sudo chmod +x /usr/bin/menu
fi

# Fitur Auto-Start Panel saat buka VPS
if ! grep -q "/usr/bin/menu" ~/.bashrc; then
    echo '# Auto-start bot panel' >> ~/.bashrc
    echo 'if [ -t 1 ] && [ -x /usr/bin/menu ] && [ -z "$TMUX" ]; then /usr/bin/menu; fi' >> ~/.bashrc
fi

# ==========================================
# 2. FUNGSI INSTALASI DEPENDENSI
# ==========================================
install_dependencies() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}             🚀 MENGINSTALL SISTEM BOT 🚀             ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    
    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a

    spin() {
        local pid=$1
        local delay=0.1
        local spinstr='|/-\'
        while kill -0 $pid 2>/dev/null; do
            local temp=${spinstr#?}
            printf " [%c] " "$spinstr"
            local spinstr=$temp${spinstr%"$temp"}
            sleep $delay
            printf "\b\b\b\b\b"
        done
        printf "      \b\b\b\b\b\b"
        wait $pid
        return $?
    }

    echo -ne "${C_MAG}>> Mengatur zona waktu (Asia/Jakarta)...${C_RST}"
    sudo timedatectl set-timezone Asia/Jakarta > /dev/null 2>&1 || sudo ln -sf /usr/share/zoneinfo/Asia/Jakarta /etc/localtime
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -ne "${C_MAG}>> Mengupdate repositori sistem...${C_RST}"
    (sudo -E apt-get update > /dev/null 2>&1 && sudo -E apt-get upgrade -y > /dev/null 2>&1) &
    spin $!
    if [ $? -ne 0 ]; then echo -e "${C_RED}[Gagal] Cek koneksi internet Anda.${C_RST}"; exit 1; fi
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -ne "${C_MAG}>> Menginstall dependensi (curl, zip, unzip, build-essential, python3, sqlite3)...${C_RST}"
    sudo -E apt-get install -y curl git wget nano zip unzip build-essential python3 sqlite3 > /dev/null 2>&1 &
    spin $!
    if [ $? -ne 0 ]; then echo -e "${C_RED}[Gagal] Menginstall dependensi.${C_RST}"; exit 1; fi
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -ne "${C_MAG}>> Memeriksa dan membuat Swap RAM 2GB...${C_RST}"
    if [ $(swapon --show | wc -l) -eq 0 ]; then
        sudo fallocate -l 2G /swapfile
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile > /dev/null 2>&1
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
        echo -e "${C_GREEN}[Dibuat]${C_RST}"
    else
        echo -e "${C_GREEN}[Sudah Ada]${C_RST}"
    fi
    
    echo -ne "${C_MAG}>> Menginstall Node.js...${C_RST}"
    (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1 && sudo -E apt-get install -y nodejs > /dev/null 2>&1) &
    spin $!
    if [ $? -ne 0 ]; then echo -e "${C_RED}[Gagal] Menginstall Node.js.${C_RST}"; exit 1; fi
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -ne "${C_MAG}>> Menginstall PM2...${C_RST}"
    (sudo npm install -g pm2 > /dev/null 2>&1) &
    spin $!
    if [ $? -ne 0 ]; then echo -e "${C_RED}[Gagal] Menginstall PM2.${C_RST}"; exit 1; fi
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -e "${C_CYAN}>> Menginstal PM2 Logrotate untuk mencegah hardisk penuh...${C_RST}"
    pm2 install pm2-logrotate >/dev/null 2>&1

    echo -ne "${C_MAG}>> Menyiapkan Package NPM...${C_RST}"
    if [ ! -f "package.json" ]; then npm init -y > /dev/null 2>&1; fi
    rm -rf node_modules package-lock.json
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -ne "${C_MAG}>> Mengunduh modul utama (termasuk SQLite, JWT & CORS)...${C_RST}"
    npm install @whiskeysockets/baileys@latest pino qrcode-terminal axios express body-parser node-telegram-bot-api better-sqlite3 jsonwebtoken cors > install_npm.log 2>&1 &
    spin $!
    if [ $? -ne 0 ]; then echo -e "${C_RED}[Gagal] Mengunduh modul npm. Cek install_npm.log.${C_RST}"; exit 1; fi
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -ne "${C_MAG}>> Menjalankan Sistem Utama...${C_RST}"
    pm2 start index.js --name tendobot > /dev/null 2>&1
    pm2 save > /dev/null 2>&1
    pm2 startup > /dev/null 2>&1
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_GREEN}${C_BOLD}                 ✅ INSTALASI SELESAI!                ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    read -p "Tekan Enter untuk kembali..."
}

menu_tutorial() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             🎬 MANAJEMEN TUTORIAL 🎬               ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Tambah Tutorial Baru"
        echo -e "  ${C_GREEN}[2]${C_RST} Edit Tutorial"
        echo -e "  ${C_GREEN}[3]${C_RST} Hapus Tutorial"
        echo -e "  ${C_GREEN}[4]${C_RST} Lihat Daftar Tutorial"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-4]: ${C_RST}"
        read tut_choice

        case $tut_choice in
            1)
                echo -e "\n${C_MAG}--- TAMBAH TUTORIAL BARU ---${C_RST}"
                read -p "Masukkan Judul Tutorial: " t_judul
                if [ -z "$t_judul" ]; then echo "Batal."; sleep 1; continue; fi
                
                echo -e "Anda bisa memasukkan URL video (mp4) untuk didownload otomatis,"
                echo -e "ATAU masukkan path file lokal di VPS (contoh: /root/video.mp4)"
                echo -e "ATAU KOSONGKAN saja jika tutorial ini HANYA BERUPA TEKS."
                read -p "URL / Path Video (Boleh Kosong): " t_video_src
                
                if [ -z "$t_video_src" ]; then
                    t_video_name="-"
                    echo -e "${C_YELLOW}Tutorial ini dibuat tanpa video (hanya teks).${C_RST}"
                else
                    read -p "Nama file saat disimpan (contoh: tutor1.mp4): " t_video_name
                    mkdir -p public/tutorials
                    
                    if [[ "$t_video_src" == http* ]]; then
                        echo -e "${C_CYAN}⏳ Mendownload video...${C_RST}"
                        wget -qO "public/tutorials/$t_video_name" "$t_video_src"
                        if [ $? -eq 0 ]; then
                            echo -e "${C_GREEN}✅ Video berhasil didownload!${C_RST}"
                        else
                            echo -e "${C_RED}❌ Gagal mendownload video.${C_RST}"
                        fi
                    else
                        if [ -f "$t_video_src" ]; then
                            cp "$t_video_src" "public/tutorials/$t_video_name"
                            echo -e "${C_GREEN}✅ Video berhasil dicopy!${C_RST}"
                        else
                            echo -e "${C_RED}❌ File lokal tidak ditemukan. Melanjutkan simpan data saja...${C_RST}"
                        fi
                    fi
                fi
                
                echo -e "Untuk baris baru gunakan tag <br>, atau tulis teks panjang."
                read -p "Masukkan Deskripsi (Bisa paragraf/list): " t_desc
                
                T_JUDUL="$t_judul" T_VIDEO="$t_video_name" T_DESC="$t_desc" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let newId = 'TUT-' + Date.now();
                    let data = { id: newId, title: process.env.T_JUDUL, video: process.env.T_VIDEO, desc: process.env.T_DESC };
                    db.prepare('INSERT OR REPLACE INTO tutorial (id, data) VALUES (?, ?)').run(newId, JSON.stringify(data));
                    console.log('\x1b[32m✅ Data tutorial berhasil disimpan!\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_MAG}--- EDIT TUTORIAL ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM tutorial').all();
                    if(rows.length === 0) { console.log('\x1b[31mBelum ada tutorial.\x1b[0m'); process.exit(0); }
                    rows.forEach((r, i) => { let t = JSON.parse(r.data); console.log('[' + (i+1) + '] ' + t.title + ' (' + t.video + ')'); });
                "
                echo ""
                read -p "Pilih nomor tutorial yang ingin diedit: " t_num
                if [[ "$t_num" =~ ^[0-9]+$ ]]; then
                    read -p "Judul Baru (Kosongkan jika tidak diubah): " t_judul
                    read -p "Nama File Video Baru (Kosongkan jika tidak diubah, isi '-' untuk hapus video): " t_video
                    read -p "Deskripsi Baru (Kosongkan jika tidak diubah): " t_desc
                    
                    T_NUM="$t_num" T_JUDUL="$t_judul" T_VIDEO="$t_video" T_DESC="$t_desc" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let rows = db.prepare('SELECT id, data FROM tutorial').all();
                        let idx = parseInt(process.env.T_NUM) - 1;
                        if(rows[idx]) {
                            let t = JSON.parse(rows[idx].data);
                            if(process.env.T_JUDUL !== '') t.title = process.env.T_JUDUL;
                            if(process.env.T_VIDEO !== '') t.video = process.env.T_VIDEO;
                            if(process.env.T_DESC !== '') t.desc = process.env.T_DESC;
                            db.prepare('UPDATE tutorial SET data = ? WHERE id = ?').run(JSON.stringify(t), t.id);
                            console.log('\x1b[32m✅ Tutorial berhasil diupdate!\x1b[0m');
                        } else {
                            console.log('\x1b[31m❌ Nomor tidak valid.\x1b[0m');
                        }
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                echo -e "\n${C_MAG}--- HAPUS TUTORIAL ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM tutorial').all();
                    if(rows.length === 0) { console.log('\x1b[31mBelum ada tutorial.\x1b[0m'); process.exit(0); }
                    rows.forEach((r, i) => { let t = JSON.parse(r.data); console.log('[' + (i+1) + '] ' + t.title); });
                "
                echo ""
                read -p "Pilih nomor tutorial yang ingin dihapus: " t_num
                if [[ "$t_num" =~ ^[0-9]+$ ]]; then
                    T_NUM="$t_num" node -e "
                        const fs = require('fs');
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let rows = db.prepare('SELECT id, data FROM tutorial').all();
                        let idx = parseInt(process.env.T_NUM) - 1;
                        if(rows[idx]) {
                            let t = JSON.parse(rows[idx].data);
                            let videoName = t.video;
                            let filepath = 'public/tutorials/' + videoName;
                            if(videoName !== '-' && fs.existsSync(filepath)) {
                                fs.unlinkSync(filepath);
                                console.log('\x1b[33mFile video ' + videoName + ' dihapus.\x1b[0m');
                            }
                            db.prepare('DELETE FROM tutorial WHERE id = ?').run(t.id);
                            console.log('\x1b[32m✅ Tutorial berhasil dihapus!\x1b[0m');
                        } else {
                            console.log('\x1b[31m❌ Nomor tidak valid.\x1b[0m');
                        }
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                echo -e "\n${C_CYAN}--- DAFTAR TUTORIAL ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM tutorial').all();
                    if(rows.length === 0) { console.log('\x1b[33mBelum ada tutorial.\x1b[0m'); }
                    else {
                        rows.forEach((r, i) => {
                            let t = JSON.parse(r.data);
                            console.log('\n\x1b[36m[' + (i+1) + '] ' + t.title + '\x1b[0m');
                            console.log('   Video: ' + t.video);
                            console.log('   Deskripsi: ' + t.desc);
                        });
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_member() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             👥 MANAJEMEN MEMBER BOT 👥             ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Tambah Saldo Member"
        echo -e "  ${C_GREEN}[2]${C_RST} Kurangi Saldo Member"
        echo -e "  ${C_GREEN}[3]${C_RST} Lihat Daftar Semua Member Aktif"
        echo -e "  ${C_GREEN}[4]${C_RST} Cek Riwayat Transaksi/Topup Member"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-4]: ${C_RST}"
        read subchoice

        case $subchoice in
            1)
                echo -e "\n${C_MAG}--- TAMBAH SALDO ---${C_RST}"
                read -p "Cari Target (Bisa Nomor WA, Email, ATAU Nama Akun): " pencarian
                read -p "Masukkan Jumlah Saldo: " jumlah
                PENCARIAN="$pencarian" JUMLAH="$jumlah" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let input = (process.env.PENCARIAN || '').trim();
                    let normPhone = input.replace(/[^0-9]/g, '');
                    if(input.startsWith('+62')) normPhone = '62' + input.substring(3);
                    else if(input.startsWith('0')) normPhone = '62' + input.substring(1);
                    
                    let rows = db.prepare('SELECT id, data FROM users').all();
                    let target = null;
                    let targetData = null;
                    for(let r of rows) {
                        let u = JSON.parse(r.data);
                        if(r.id === normPhone || (u.email && u.email.toLowerCase() === input.toLowerCase()) || (u.username && u.username.toLowerCase() === input.toLowerCase())) {
                            target = r.id; targetData = u; break;
                        }
                    }
                    
                    if(!target) {
                        if(normPhone === '') {
                            console.log('\x1b[31m\n❌ Akun tidak ditemukan dengan nama atau email tersebut.\x1b[0m');
                            process.exit(0);
                        }
                        target = normPhone;
                        targetData = { saldo: 0, tanggal_daftar: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), jid: target + '@s.whatsapp.net', trx_count: 0, history: [] };
                    }
                    
                    let namaUser = targetData.username || target;
                    let saldoSebelum = parseInt(targetData.saldo || 0);
                    let nominalTambah = parseInt(process.env.JUMLAH || 0);
                    targetData.saldo = saldoSebelum + nominalTambah;
                    
                    targetData.history = targetData.history || [];
                    targetData.history.unshift({ 
                        ts: Date.now(), 
                        tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
                        type: 'Topup', nama: 'Topup Manual (Admin)', tujuan: 'Sistem', status: 'Sukses', sn: '-', amount: nominalTambah, 
                        saldo_sebelumnya: saldoSebelum, saldo_sesudah: targetData.saldo 
                    });
                    if(targetData.history.length > 50) targetData.history.pop();
                    
                    db.prepare('INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)').run(target, JSON.stringify(targetData));
                    console.log('\x1b[32m\n✅ Saldo Rp ' + nominalTambah.toLocaleString('id-ID') + ' berhasil ditambahkan ke ' + namaUser + ' (' + target + ')!\x1b[0m');
                    console.log('\x1b[33mSaldo Sebelumnya: Rp ' + saldoSebelum.toLocaleString('id-ID') + '\x1b[0m');
                    console.log('\x1b[36mSaldo Sekarang  : Rp ' + targetData.saldo.toLocaleString('id-ID') + '\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_MAG}--- KURANGI SALDO ---${C_RST}"
                read -p "Cari Target (Bisa Nomor WA, Email, ATAU Nama Akun): " pencarian
                read -p "Masukkan Jumlah Saldo yg dikurangi: " jumlah
                PENCARIAN="$pencarian" JUMLAH="$jumlah" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let input = (process.env.PENCARIAN || '').trim();
                    let normPhone = input.replace(/[^0-9]/g, '');
                    if(input.startsWith('+62')) normPhone = '62' + input.substring(3);
                    else if(input.startsWith('0')) normPhone = '62' + input.substring(1);
                    
                    let rows = db.prepare('SELECT id, data FROM users').all();
                    let target = null;
                    let targetData = null;
                    for(let r of rows) {
                        let u = JSON.parse(r.data);
                        if(r.id === normPhone || (u.email && u.email.toLowerCase() === input.toLowerCase()) || (u.username && u.username.toLowerCase() === input.toLowerCase())) {
                            target = r.id; targetData = u; break;
                        }
                    }
                    
                    if(!target) { 
                        console.log('\x1b[31m\n❌ Akun tidak ditemukan di database.\x1b[0m'); 
                    } else {
                        let namaUser = targetData.username || target;
                        let saldoSebelum = parseInt(targetData.saldo || 0);
                        let nominalKurang = parseInt(process.env.JUMLAH || 0);
                        
                        targetData.saldo = saldoSebelum - nominalKurang;
                        if(targetData.saldo < 0) targetData.saldo = 0;
                        
                        targetData.history = targetData.history || [];
                        targetData.history.unshift({ 
                            ts: Date.now(), 
                            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
                            type: 'Topup', nama: 'Pengurangan Saldo (Admin)', tujuan: 'Sistem', status: 'Sukses', sn: '-', amount: nominalKurang, 
                            saldo_sebelumnya: saldoSebelum, saldo_sesudah: targetData.saldo 
                        });
                        if(targetData.history.length > 50) targetData.history.pop();
                        
                        db.prepare('INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)').run(target, JSON.stringify(targetData));
                        console.log('\x1b[32m\n✅ Saldo ' + namaUser + ' (' + target + ') berhasil dikurangi!\x1b[0m');
                        console.log('\x1b[33mSaldo Sebelumnya: Rp ' + saldoSebelum.toLocaleString('id-ID') + '\x1b[0m');
                        console.log('\x1b[36mSaldo Sekarang  : Rp ' + targetData.saldo.toLocaleString('id-ID') + '\x1b[0m');
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                echo -e "\n${C_CYAN}--- DAFTAR MEMBER AKTIF ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM users').all();
                    
                    let usersArr = [];
                    db.transaction(() => {
                        for(let r of rows) {
                            let u = JSON.parse(r.data);
                            if (!u.email || u.email.trim() === '-' || u.email.trim() === '') {
                                db.prepare('DELETE FROM users WHERE id = ?').run(r.id);
                            } else {
                                usersArr.push({id: r.id, data: u});
                            }
                        }
                    })();
                    
                    usersArr.sort((a, b) => (b.data.saldo || 0) - (a.data.saldo || 0)); 
                    
                    if(usersArr.length === 0) console.log('\x1b[33mBelum ada member aktif (yang terdaftar email).\x1b[0m');
                    else {
                        usersArr.forEach((m, i) => {
                            let nama = m.data.username || 'Member';
                            let email = m.data.email || '-';
                            console.log((i + 1) + '. Nama: ' + nama + ' | WA: ' + m.id + ' | Email: ' + email + ' | Saldo: Rp ' + m.data.saldo.toLocaleString('id-ID'));
                        });
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                echo -e "\n${C_CYAN}--- RIWAYAT TOPUP/TRANSAKSI MEMBER ---${C_RST}"
                read -p "Cari Target (Bisa Nomor WA, Email, ATAU Nama Akun): " pencarian
                if [ ! -z "$pencarian" ]; then
                    PENCARIAN="$pencarian" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let input = (process.env.PENCARIAN || '').trim();
                        let normPhone = input.replace(/[^0-9]/g, '');
                        if(input.startsWith('+62')) normPhone = '62' + input.substring(3);
                        else if(input.startsWith('0')) normPhone = '62' + input.substring(1);
                        
                        let rows = db.prepare('SELECT id, data FROM users').all();
                        let targetData = null;
                        let targetId = null;
                        for(let r of rows) {
                            let u = JSON.parse(r.data);
                            if(r.id === normPhone || (u.email && u.email.toLowerCase() === input.toLowerCase()) || (u.username && u.username.toLowerCase() === input.toLowerCase())) {
                                targetData = u; targetId = r.id; break;
                            }
                        }
                        
                        if(targetData) {
                            let history = targetData.history || [];
                            let targetSaldo = targetData.saldo || 0;
                            let targetNama = targetData.username || 'Member';
                            let topups = history.filter(h => h.type === 'Topup' || h.type === 'Order QRIS' || h.type === 'Refund' || h.type === 'Order' || h.type === 'Order VPN' || h.type === 'Order VPN QRIS').slice(0, 10);
                            
                            console.log('\n\x1b[36m=== 10 RIWAYAT TERBARU: ' + targetNama + ' (' + targetId + ') ===\x1b[0m');
                            console.log('\x1b[32m💰 Saldo Saat Saat Ini: Rp ' + targetSaldo.toLocaleString('id-ID') + '\x1b[0m');
                            if(topups.length === 0) console.log('\x1b[33mBelum ada riwayat topup di akun ini.\x1b[0m');
                            else {
                                topups.forEach(h => {
                                    let str = '- \x1b[33m' + h.tanggal + '\x1b[0m | ' + h.nama + ' | \x1b[32mRp ' + (h.amount || 0).toLocaleString('id-ID') + '\x1b[0m | Status: ' + h.status;
                                    if (h.saldo_sebelumnya !== undefined) str += '\n    └ Saldo Sblm: Rp ' + h.saldo_sebelumnya.toLocaleString('id-ID');
                                    if (h.saldo_sesudah !== undefined) str += ' | Saldo Stlh: Rp ' + h.saldo_sesudah.toLocaleString('id-ID');
                                    console.log(str);
                                });
                            }
                        } else {
                            console.log('\x1b[31m❌ Akun tidak ditemukan berdasarkan pencarian Anda.\x1b[0m');
                        }
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_keuntungan() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             💰 MANAJEMEN KEUNTUNGAN 💰             ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        
        node -e "
            const Database = require('better-sqlite3');
            const db = new Database('tendo_database.db', { readonly: true });
            let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
            let c = row ? JSON.parse(row.data).margin || {} : {};
            console.log('  \x1b[32m[1]\x1b[0m  Modal Rp 0 - 100               : Rp ' + (c.t1||50));
            console.log('  \x1b[32m[2]\x1b[0m  Modal Rp 100 - 500             : Rp ' + (c.t2||100));
            console.log('  \x1b[32m[3]\x1b[0m  Modal Rp 500 - 1.000           : Rp ' + (c.t3||250));
            console.log('  \x1b[32m[4]\x1b[0m  Modal Rp 1.000 - 2.000         : Rp ' + (c.t4||500));
            console.log('  \x1b[32m[5]\x1b[0m  Modal Rp 2.000 - 3.000         : Rp ' + (c.t5||1000));
            console.log('  \x1b[32m[6]\x1b[0m  Modal Rp 3.000 - 4.000         : Rp ' + (c.t6||1500));
            console.log('  \x1b[32m[7]\x1b[0m  Modal Rp 4.000 - 5.000         : Rp ' + (c.t7||2000));
            console.log('  \x1b[32m[8]\x1b[0m  Modal Rp 5.000 - 10.000        : Rp ' + (c.t8||2500));
            console.log('  \x1b[32m[9]\x1b[0m  Modal Rp 10.000 - 25.000       : Rp ' + (c.t9||3000));
            console.log('  \x1b[32m[10]\x1b[0m Modal Rp 25.000 - 50.000      : Rp ' + (c.t10||4000));
            console.log('  \x1b[32m[11]\x1b[0m Modal Rp 50.000 - 75.000      : Rp ' + (c.t11||5000));
            console.log('  \x1b[32m[12]\x1b[0m Modal Rp 75.000 - 100.000     : Rp ' + (c.t12||7500));
            console.log('  \x1b[32m[13]\x1b[0m Modal Rp 100.000 - Seterusnya : Rp ' + (c.t13||10000));
        "
        
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST}  Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih nomor rentang yang ingin diubah [0-13]: ${C_RST}"
        read k_choice

        if [ "$k_choice" == "0" ]; then
            break
        elif [[ "$k_choice" -ge 1 && "$k_choice" -le 13 ]]; then
            read -p "Masukkan Keuntungan Baru (Rp) untuk Pilihan $k_choice: " nominal_baru
            
            if [ -z "$nominal_baru" ]; then
                echo -e "${C_RED}❌ Dibatalkan, nominal tidak boleh kosong.${C_RST}"
                sleep 1
                continue
            fi
            
            K_CHOICE="$k_choice" NOMINAL_BARU="$nominal_baru" node -e "
                const Database = require('better-sqlite3');
                const db = new Database('tendo_database.db');
                let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                let config = row ? JSON.parse(row.data) : {};
                if(!config.margin) config.margin = { t1:50, t2:100, t3:250, t4:500, t5:1000, t6:1500, t7:2000, t8:2500, t9:3000, t10:4000, t11:5000, t12:7500, t13:10000 };
                let tier = 't' + process.env.K_CHOICE;
                config.margin[tier] = parseInt(process.env.NOMINAL_BARU);
                db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
            "
            echo -e "${C_GREEN}✅ Keuntungan tier $k_choice berhasil diubah! Me-refresh Katalog Website...${C_RST}"
            curl -s http://localhost:3000/api/sync-digiflazz > /dev/null
            sleep 1
        else
            echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"
            sleep 1
        fi
    done
}

menu_sinkron() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}          🔄 SINKRONISASI PRODUK DIGIFLAZZ 🔄         ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_MAG}Sistem akan menarik seluruh data produk dari API Digiflazz,"
    echo -e "menyesuaikan kategori otomatis, dan menata harga berdasarkan"
    echo -e "Manajemen Keuntungan yang sudah kamu atur sebelumnya.${C_RST}\n"
    
    echo -e "${C_YELLOW}⏳ Memulai sinkronisasi... Harap tunggu beberapa detik.${C_RST}"
    
    curl -s http://localhost:3000/api/sync-digiflazz > /dev/null
    
    echo -e "\n${C_GREEN}✅ Sinkronisasi Selesai! Katalog Website dan Harga sudah terupdate secara realtime.${C_RST}"
    read -p "Tekan Enter untuk kembali..."
}

menu_telegram() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             ⚙️ AUTO-BACKUP KE TELEGRAM ⚙️            ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Aktifkan/Matikan Notifikasi Backup Otomatis"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-1]: ${C_RST}"
        read telechoice

        case $telechoice in
            1)
                echo -e "\n${C_MAG}--- SET AUTO BACKUP ---${C_RST}"
                read -p "Aktifkan Auto-Backup ke Telegram? (y/n): " set_auto
                if [ "$set_auto" == "y" ] || [ "$set_auto" == "Y" ]; then
                    status="true"
                    read -p "Berapa MENIT sekali bot harus backup? (Contoh: 60): " menit
                    if ! [[ "$menit" =~ ^[0-9]+$ ]]; then
                        menit=720
                    fi
                    echo -e "\n${C_GREEN}✅ Auto-Backup DIAKTIFKAN setiap $menit menit!${C_RST}"
                else
                    status="false"
                    menit=720
                    echo -e "\n${C_RED}❌ Auto-Backup DIMATIKAN!${C_RST}"
                fi
                STATUS="$status" MENIT="$menit" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                    let config = row ? JSON.parse(row.data) : {};
                    config.autoBackup = process.env.STATUS === 'true';
                    config.backupInterval = parseInt(process.env.MENIT);
                    db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_backup() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}               💾 BACKUP & RESTORE 💾               ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Backup Data (Kirim ke Telegram Admin)"
        echo -e "  ${C_GREEN}[2]${C_RST} Restore Database & Bot dari Link"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-2]: ${C_RST}"
        read backchoice

        case $backchoice in
            1)
                echo -e "\n${C_MAG}⏳ Sedang memproses arsip backup SQLite...${C_RST}"
                if ! command -v zip &> /dev/null; then sudo apt install zip -y > /dev/null 2>&1; fi
                rm -f backup.zip backup_aman.db ssl_backup.tar.gz
                
                sqlite3 tendo_database.db ".backup backup_aman.db"
                
                if [ -d "/etc/letsencrypt" ]; then
                    sudo tar -czf ssl_backup.tar.gz -C / etc/letsencrypt 2>/dev/null
                    zip backup.zip backup_aman.db ssl_backup.tar.gz 2>/dev/null
                else
                    zip backup.zip backup_aman.db 2>/dev/null
                fi
                
                rm -f backup_aman.db ssl_backup.tar.gz
                
                echo -e "${C_GREEN}✅ File backup.zip berhasil dikompresi!${C_RST}"
                node -e "
                    const { exec } = require('child_process');
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db', { readonly: true });
                    let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                    let config = row ? JSON.parse(row.data) : {};
                    
                    if(config.teleToken && config.teleChatId) {
                        console.log('\x1b[36m⏳ Sedang mengirim ke Telegram Admin...\x1b[0m');
                        let cmd = \`curl -s -F chat_id=\"\${config.teleChatId}\" -F document=@\"backup.zip\" -F caption=\"📦 Manual Backup Data SQLite + SSL\" https://api.telegram.org/bot\${config.teleToken}/sendDocument\`;
                        exec(cmd, (err) => {
                            if(err) console.log('\x1b[31m❌ Gagal mengirim ke Telegram.\x1b[0m');
                            else console.log('\x1b[32m✅ File Backup berhasil mendarat di Telegram Admin!\x1b[0m');
                        });
                    } else {
                        console.log('\x1b[33m⚠️ Token Telegram Admin belum diisi di menu setup notifikasi.\x1b[0m');
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_RED}${C_BOLD}⚠️ PERHATIAN: Restore akan MENIMPA seluruh file bot Anda!${C_RST}"
                read -p "Apakah Anda yakin ingin melanjutkan? (y/n): " yakin
                if [ "$yakin" == "y" ] || [ "$yakin" == "Y" ]; then
                    read -p "🔗 Masukkan Direct Link file ZIP Backup Anda: " linkzip
                    if [ ! -z "$linkzip" ]; then
                        wget -qO restore.zip "$linkzip"
                        if [ -f "restore.zip" ]; then
                            if ! command -v unzip &> /dev/null; then sudo apt install unzip -y > /dev/null 2>&1; fi
                            unzip -o restore.zip > /dev/null 2>&1
                            
                            mv backup_aman.db tendo_database.db 2>/dev/null || true
                            pm2 restart tendobot > /dev/null 2>&1
                            
                            if [ -f "tendo_database.db" ]; then
                                echo -e "${C_GREEN}✅ Database berhasil dipulihkan!${C_RST}"
                            fi
                            
                            if [ -f "ssl_backup.tar.gz" ]; then
                                sudo tar -xzf ssl_backup.tar.gz -C / 2>/dev/null
                                echo -e "${C_GREEN}✅ Sertifikat SSL berhasil direstore!${C_RST}"
                            fi
                            rm -f restore.zip
                            npm install > /dev/null 2>&1
                            
                            echo -e "\n${C_GREEN}${C_BOLD}✅ RESTORE BERHASIL SEPENUHNYA!${C_RST}"
                        else
                            echo -e "${C_RED}❌ Gagal mendownload file.${C_RST}"
                        fi
                    fi
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

submenu_server_vpn() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             🌍 MANAJEMEN SERVER VPN 🌍             ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Tambah / Edit Koneksi Server"
        echo -e "  ${C_GREEN}[2]${C_RST} List Daftar Server"
        echo -e "  ${C_GREEN}[3]${C_RST} Hapus Koneksi Server"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-3]: ${C_RST}"
        read srv_choice

        case $srv_choice in
            1)
                echo -e "\n${C_MAG}--- TAMBAH / EDIT KONEKSI SERVER ---${C_RST}"
                read -p "Buat ID Server (Unik, misal: srv1 atau SG-VIP): " srv_id
                if [ -z "$srv_id" ]; then echo "Batal."; sleep 1; continue; fi
                
                read -p "Masukkan Nama Server (Misal: VIP Singapura): " srv_name
                read -p "Masukkan Hostname / IP Server: " srv_host
                read -p "Masukkan Port Server (Biarkan kosong jika default): " srv_port
                read -p "Masukkan Username VPS: " srv_user
                read -p "Masukkan Password VPS: " srv_pass
                read -p "Masukkan API Key VPN Panel: " srv_api
                read -p "Masukkan Nama ISP Server: " srv_isp
                read -p "Masukkan Nama Kota/City: " srv_city
                
                SRV_ID="$srv_id" SRV_NAME="$srv_name" SRV_HOST="$srv_host" SRV_PORT="$srv_port" SRV_USER="$srv_user" SRV_PASS="$srv_pass" SRV_API="$srv_api" SRV_ISP="$srv_isp" SRV_CITY="$srv_city" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {servers:{}, products:{}};
                    if(!vpnDb.servers) vpnDb.servers = {};
                    vpnDb.servers[process.env.SRV_ID] = {
                        server_name: process.env.SRV_NAME, host: process.env.SRV_HOST, port: process.env.SRV_PORT,
                        user: process.env.SRV_USER, pass: process.env.SRV_PASS, api_key: process.env.SRV_API,
                        isp: process.env.SRV_ISP, city: process.env.SRV_CITY
                    };
                    db.prepare(\"INSERT OR REPLACE INTO vpn_config (id, data) VALUES ('main', ?)\").run(JSON.stringify(vpnDb));
                    console.log('\x1b[32m\n✅ Konfigurasi Server (' + process.env.SRV_ID + ') berhasil disimpan!\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_CYAN}--- DAFTAR SERVER VPN ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {servers:{}, products:{}};
                    let servers = vpnDb.servers || {};
                    let count = 0;
                    for(let id in servers) {
                        count++;
                        let s = servers[id];
                        console.log('- ID: \x1b[33m' + id + '\x1b[0m | Nama: ' + s.server_name + ' | Host: ' + s.host);
                    }
                    if(count === 0) console.log('\x1b[31mBelum ada server VPN yang ditambahkan.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                echo -e "\n${C_MAG}--- HAPUS KONEKSI SERVER ---${C_RST}"
                read -p "Masukkan ID Server yang ingin dihapus: " del_id
                DEL_ID="$del_id" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : null;
                    if(vpnDb && vpnDb.servers && vpnDb.servers[process.env.DEL_ID]) {
                        delete vpnDb.servers[process.env.DEL_ID];
                        db.prepare(\"UPDATE vpn_config SET data = ? WHERE id = 'main'\").run(JSON.stringify(vpnDb));
                        console.log('\x1b[32m\n✅ Server dengan ID (' + process.env.DEL_ID + ') berhasil dihapus!\x1b[0m');
                    } else {
                        console.log('\x1b[31m\n❌ Server dengan ID (' + process.env.DEL_ID + ') tidak ditemukan.\x1b[0m');
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

submenu_produk_vpn() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}             📦 MANAJEMEN PRODUK VPN 📦             ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Tambah Produk VPN Baru (ID Otomatis Unik)"
        echo -e "  ${C_GREEN}[2]${C_RST} Edit Produk VPN Yang Sudah Ada"
        echo -e "  ${C_GREEN}[3]${C_RST} List Daftar Produk"
        echo -e "  ${C_GREEN}[4]${C_RST} Atur Ulang Stok Produk"
        echo -e "  ${C_GREEN}[5]${C_RST} Hapus Produk"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-5]: ${C_RST}"
        read prod_choice

        case $prod_choice in
            1)
                echo -e "\n${C_MAG}--- TAMBAH PRODUK VPN BARU ---${C_RST}"
                prod_id="VPN-$(date +%s)"
                echo -e "${C_GREEN}Membuat ID Produk Unik: $prod_id${C_RST}"

                echo -e "\nPilih Protokol:"
                echo -e "  [1] SSH\n  [2] Vmess\n  [3] Vless\n  [4] Trojan\n  [5] ZIVPN"
                read -p "Pilihan [1-5]: " proto_opt
                target_proto=""
                case $proto_opt in
                    1) target_proto="SSH" ;;
                    2) target_proto="Vmess" ;;
                    3) target_proto="Vless" ;;
                    4) target_proto="Trojan" ;;
                    5) target_proto="ZIVPN" ;;
                    *) target_proto="SSH" ;;
                esac

                echo -e "\nServer Tersedia:"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {servers:{}};
                    let servers = vpnDb.servers || {};
                    for(let id in servers) console.log('  - ' + id + ' (' + servers[id].server_name + ')');
                "
                read -p "Ketik ID Server target: " srv_id_target
                read -p "Nama Layanan (Misal: SSH Premium SG VIP): " p_nama
                read -p "Harga Patokan 30 Hari (Rp): " p_harga
                read -p "Limit IP (contoh: 2): " p_limitip
                read -p "Limit Bandwidth Kuota GB (contoh: 200, Kosongkan utk SSH): " p_kuota
                read -p "Jumlah Stok Awal: " p_stok
                read -p "Deskripsi / Fitur Singkat: " p_desc
                
                PROD_ID="$prod_id" TARGET_PROTO="$target_proto" SRV_ID_TARGET="$srv_id_target" P_NAMA="$p_nama" P_HARGA="$p_harga" P_DESC="$p_desc" P_LIMITIP="$p_limitip" P_KUOTA="$p_kuota" P_STOK="$p_stok" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {servers:{}, products:{}};
                    if(!vpnDb.products) vpnDb.products = {};
                    
                    vpnDb.products[process.env.PROD_ID] = {
                        protocol: process.env.TARGET_PROTO,
                        server_id: process.env.SRV_ID_TARGET,
                        name: process.env.P_NAMA !== '' ? process.env.P_NAMA : 'VPN Premium',
                        price: process.env.P_HARGA !== '' ? parseInt(process.env.P_HARGA) : 0,
                        desc: process.env.P_DESC !== '' ? process.env.P_DESC : 'Proses Otomatis',
                        limit_ip: process.env.P_LIMITIP !== '' ? parseInt(process.env.P_LIMITIP) : 2,
                        kuota: process.env.P_KUOTA !== '' ? parseInt(process.env.P_KUOTA) : 200,
                        stok: process.env.P_STOK !== '' ? parseInt(process.env.P_STOK) : 0
                    };
                    
                    db.prepare(\"INSERT OR REPLACE INTO vpn_config (id, data) VALUES ('main', ?)\").run(JSON.stringify(vpnDb));
                    console.log('\x1b[32m\n✅ Produk VPN Baru (' + process.env.PROD_ID + ') berhasil ditambahkan ke Server!\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_MAG}--- EDIT PRODUK VPN ---${C_RST}"
                read -p "Masukkan ID Produk yang ingin diedit: " edit_prod_id
                if [ -z "$edit_prod_id" ]; then echo "Batal."; sleep 1; continue; fi

                echo -e "\nPilih Protokol (KOSONGKAN jika tidak ingin diubah):"
                echo -e "  [1] SSH\n  [2] Vmess\n  [3] Vless\n  [4] Trojan\n  [5] ZIVPN"
                read -p "Pilihan [1-5]: " proto_opt
                target_proto=""
                case $proto_opt in
                    1) target_proto="SSH" ;;
                    2) target_proto="Vmess" ;;
                    3) target_proto="Vless" ;;
                    4) target_proto="Trojan" ;;
                    5) target_proto="ZIVPN" ;;
                    *) target_proto="" ;;
                esac

                echo -e "\nServer Tersedia:"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {servers:{}};
                    let servers = vpnDb.servers || {};
                    for(let id in servers) console.log('  - ' + id + ' (' + servers[id].server_name + ')');
                "
                read -p "Ketik ID Server target (Kosongkan jika tidak ingin diubah): " srv_id_target
                
                echo -e "\n${C_MAG}*Catatan: KOSONGKAN isian jika tidak ingin mengubah data lama.${C_RST}"
                read -p "Nama Layanan: " p_nama
                read -p "Harga Patokan 30 Hari (Rp): " p_harga
                read -p "Limit IP: " p_limitip
                read -p "Limit Bandwidth Kuota GB: " p_kuota
                read -p "Deskripsi / Fitur Singkat: " p_desc
                
                EDIT_PROD_ID="$edit_prod_id" TARGET_PROTO="$target_proto" SRV_ID_TARGET="$srv_id_target" P_NAMA="$p_nama" P_HARGA="$p_harga" P_DESC="$p_desc" P_LIMITIP="$p_limitip" P_KUOTA="$p_kuota" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : null;
                    if(!vpnDb || !vpnDb.products || !vpnDb.products[process.env.EDIT_PROD_ID]) {
                        console.log('\x1b[31m❌ ID Produk tidak ditemukan!\x1b[0m');
                        process.exit(0);
                    }
                    
                    let existing = vpnDb.products[process.env.EDIT_PROD_ID];
                    
                    vpnDb.products[process.env.EDIT_PROD_ID] = {
                        protocol: process.env.TARGET_PROTO !== '' ? process.env.TARGET_PROTO : existing.protocol,
                        server_id: process.env.SRV_ID_TARGET !== '' ? process.env.SRV_ID_TARGET : existing.server_id,
                        name: process.env.P_NAMA !== '' ? process.env.P_NAMA : existing.name,
                        price: process.env.P_HARGA !== '' ? parseInt(process.env.P_HARGA) : existing.price,
                        desc: process.env.P_DESC !== '' ? process.env.P_DESC : existing.desc,
                        limit_ip: process.env.P_LIMITIP !== '' ? parseInt(process.env.P_LIMITIP) : existing.limit_ip,
                        kuota: process.env.P_KUOTA !== '' ? parseInt(process.env.P_KUOTA) : existing.kuota,
                        stok: existing.stok
                    };
                    
                    db.prepare(\"UPDATE vpn_config SET data = ? WHERE id = 'main'\").run(JSON.stringify(vpnDb));
                    console.log('\x1b[32m\n✅ Produk VPN (' + process.env.EDIT_PROD_ID + ') berhasil diupdate!\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                echo -e "\n${C_CYAN}--- DAFTAR PRODUK VPN ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : {products:{}};
                    let products = vpnDb.products || {};
                    let count = 0;
                    for(let id in products) {
                        count++;
                        let p = products[id];
                        console.log('- ID: \x1b[33m' + id + '\x1b[0m | Nama: ' + p.name + ' | Proto: ' + p.protocol + ' | Server: ' + p.server_id + ' | Stok: ' + p.stok + ' | Harga: Rp ' + p.price);
                    }
                    if(count === 0) console.log('\x1b[31mBelum ada produk VPN yang ditambahkan.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                echo -e "\n${C_MAG}--- ATUR ULANG STOK PRODUK ---${C_RST}"
                read -p "Masukkan ID Produk: " stok_id
                read -p "Masukkan Jumlah Stok Baru: " stok_baru
                STOK_ID="$stok_id" STOK_BARU="$stok_baru" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : null;
                    if(vpnDb && vpnDb.products && vpnDb.products[process.env.STOK_ID]) {
                        vpnDb.products[process.env.STOK_ID].stok = parseInt(process.env.STOK_BARU) || 0;
                        db.prepare(\"UPDATE vpn_config SET data = ? WHERE id = 'main'\").run(JSON.stringify(vpnDb));
                        console.log('\x1b[32m\n✅ Stok Produk (' + process.env.STOK_ID + ') berhasil diupdate menjadi ' + vpnDb.products[process.env.STOK_ID].stok + '!\x1b[0m');
                    } else {
                        console.log('\x1b[31m\n❌ ID Produk tidak ditemukan.\x1b[0m');
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            5)
                echo -e "\n${C_MAG}--- HAPUS PRODUK ---${C_RST}"
                read -p "Masukkan ID Produk yang ingin dihapus: " del_id
                DEL_ID="$del_id" node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM vpn_config WHERE id = 'main'\").get();
                    let vpnDb = row ? JSON.parse(row.data) : null;
                    if(vpnDb && vpnDb.products && vpnDb.products[process.env.DEL_ID]) {
                        delete vpnDb.products[process.env.DEL_ID];
                        db.prepare(\"UPDATE vpn_config SET data = ? WHERE id = 'main'\").run(JSON.stringify(vpnDb));
                        console.log('\x1b[32m\n✅ Produk (' + process.env.DEL_ID + ') berhasil dihapus!\x1b[0m');
                    } else {
                        console.log('\x1b[31m\n❌ ID Produk tidak ditemukan.\x1b[0m');
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_manajemen_vpn() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}              🛡️ MANAJEMEN VPN PREMIUM 🛡️           ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Manajemen Server VPN"
        echo -e "  ${C_GREEN}[2]${C_RST} Manajemen Produk VPN"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-2]: ${C_RST}"
        read vpn_choice

        case $vpn_choice in
            1) submenu_server_vpn ;;
            2) submenu_produk_vpn ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_etalase_custom() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}          🌟 MANAJEMEN ETALASE CUSTOM 🌟            ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Buat Etalase Baru (Cth: Best Seller)"
        echo -e "  ${C_GREEN}[2]${C_RST} Tambah Produk (SKU) ke Etalase"
        echo -e "  ${C_GREEN}[3]${C_RST} Hapus Produk dari Etalase"
        echo -e "  ${C_GREEN}[4]${C_RST} Hapus Etalase"
        echo -e "  ${C_GREEN}[5]${C_RST} Lihat Daftar Etalase & Produk"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-5]: ${C_RST}"
        read etalase_choice

        case $etalase_choice in
            1)
                echo -e "\n${C_MAG}--- BUAT ETALASE BARU ---${C_RST}"
                read -p "Masukkan Judul Etalase (Cth: Best Seller): " judul_etalase
                if [ ! -z "$judul_etalase" ]; then
                    JUDUL_ETALASE="$judul_etalase" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                        let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                        if(!layoutDb.sections) layoutDb.sections = [];
                        layoutDb.sections.push({title: process.env.JUDUL_ETALASE, skus: []});
                        db.prepare(\"INSERT OR REPLACE INTO custom_layout (id, data) VALUES ('main', ?)\").run(JSON.stringify(layoutDb));
                        console.log('\x1b[32m✅ Etalase \'' + process.env.JUDUL_ETALASE + '\' berhasil dibuat!\x1b[0m');
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                echo -e "\n${C_MAG}--- TAMBAH PRODUK KE ETALASE ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                    let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                    if(!layoutDb.sections || layoutDb.sections.length === 0) { console.log('\x1b[31mBelum ada etalase. Buat dulu!\x1b[0m'); process.exit(0); }
                    layoutDb.sections.forEach((sec, idx) => console.log('[' + (idx+1) + '] ' + sec.title));
                "
                echo -e ""
                read -p "Pilih nomor Etalase: " nomor_etalase
                if [[ "$nomor_etalase" =~ ^[0-9]+$ ]]; then
                    read -p "Masukkan KODE SKU Produk: " sku_tambah
                    if [ ! -z "$sku_tambah" ]; then
                        NOMOR_ETALASE="$nomor_etalase" SKU_TAMBAH="$sku_tambah" node -e "
                            const Database = require('better-sqlite3');
                            const db = new Database('tendo_database.db');
                            let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                            let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                            let idx = parseInt(process.env.NOMOR_ETALASE) - 1;
                            if(layoutDb.sections[idx]) {
                                if(!layoutDb.sections[idx].skus.includes(process.env.SKU_TAMBAH)) {
                                    layoutDb.sections[idx].skus.push(process.env.SKU_TAMBAH);
                                    db.prepare(\"UPDATE custom_layout SET data = ? WHERE id = 'main'\").run(JSON.stringify(layoutDb));
                                    console.log('\x1b[32m✅ SKU \'' + process.env.SKU_TAMBAH + '\' berhasil ditambahkan ke ' + layoutDb.sections[idx].title + '!\x1b[0m');
                                } else {
                                    console.log('\x1b[33mSKU sudah ada di etalase ini.\x1b[0m');
                                }
                            } else {
                                console.log('\x1b[31m❌ Nomor etalase tidak valid.\x1b[0m');
                            }
                        "
                    fi
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                echo -e "\n${C_MAG}--- HAPUS PRODUK DARI ETALASE ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                    let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                    if(!layoutDb.sections || layoutDb.sections.length === 0) { console.log('\x1b[31mBelum ada etalase.\x1b[0m'); process.exit(0); }
                    layoutDb.sections.forEach((sec, idx) => console.log('[' + (idx+1) + '] ' + sec.title));
                "
                echo -e ""
                read -p "Pilih nomor Etalase: " nomor_etalase
                if [[ "$nomor_etalase" =~ ^[0-9]+$ ]]; then
                    read -p "Masukkan KODE SKU Produk yg ingin dihapus: " sku_hapus
                    if [ ! -z "$sku_hapus" ]; then
                        NOMOR_ETALASE="$nomor_etalase" SKU_HAPUS="$sku_hapus" node -e "
                            const Database = require('better-sqlite3');
                            const db = new Database('tendo_database.db');
                            let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                            let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                            let idx = parseInt(process.env.NOMOR_ETALASE) - 1;
                            if(layoutDb.sections[idx]) {
                                let oldLen = layoutDb.sections[idx].skus.length;
                                layoutDb.sections[idx].skus = layoutDb.sections[idx].skus.filter(s => s !== process.env.SKU_HAPUS);
                                if(layoutDb.sections[idx].skus.length < oldLen) {
                                    db.prepare(\"UPDATE custom_layout SET data = ? WHERE id = 'main'\").run(JSON.stringify(layoutDb));
                                    console.log('\x1b[32m✅ SKU \'' + process.env.SKU_HAPUS + '\' berhasil dihapus dari ' + layoutDb.sections[idx].title + '!\x1b[0m');
                                } else {
                                    console.log('\x1b[31mSKU tidak ditemukan di etalase ini.\x1b[0m');
                                }
                            } else {
                                console.log('\x1b[31m❌ Nomor etalase tidak valid.\x1b[0m');
                            }
                        "
                    fi
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                echo -e "\n${C_MAG}--- HAPUS ETALASE ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                    let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                    if(!layoutDb.sections || layoutDb.sections.length === 0) { console.log('\x1b[31mBelum ada etalase.\x1b[0m'); process.exit(0); }
                    layoutDb.sections.forEach((sec, idx) => console.log('[' + (idx+1) + '] ' + sec.title));
                "
                echo -e ""
                read -p "Pilih nomor Etalase yg ingin dihapus: " nomor_etalase
                if [[ "$nomor_etalase" =~ ^[0-9]+$ ]]; then
                    NOMOR_ETALASE="$nomor_etalase" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                        let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                        let idx = parseInt(process.env.NOMOR_ETALASE) - 1;
                        if(layoutDb.sections[idx]) {
                            let title = layoutDb.sections[idx].title;
                            layoutDb.sections.splice(idx, 1);
                            db.prepare(\"UPDATE custom_layout SET data = ? WHERE id = 'main'\").run(JSON.stringify(layoutDb));
                            console.log('\x1b[32m✅ Etalase \'' + title + '\' berhasil dihapus!\x1b[0m');
                        } else {
                            console.log('\x1b[31m❌ Nomor etalase tidak valid.\x1b[0m');
                        }
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            5)
                echo -e "\n${C_CYAN}--- DAFTAR ETALASE & PRODUK ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let row = db.prepare(\"SELECT data FROM custom_layout WHERE id = 'main'\").get();
                    let layoutDb = row ? JSON.parse(row.data) : {sections: []};
                    
                    if(!layoutDb.sections || layoutDb.sections.length === 0) {
                        console.log('\x1b[33mBelum ada etalase yang dibuat.\x1b[0m');
                    } else {
                        layoutDb.sections.forEach((sec, idx) => {
                            console.log('\n\x1b[36m[' + (idx+1) + '] ' + sec.title + '\x1b[0m');
                            if(sec.skus.length === 0) console.log('   (Kosong)');
                            else {
                                sec.skus.forEach(sku => {
                                    let pRow = db.prepare(\"SELECT data FROM produk WHERE id = ?\").get(sku);
                                    let pName = pRow ? JSON.parse(pRow.data).nama : 'Produk Tidak Ditemukan/Dihapus';
                                    console.log('   - ' + sku + ' : ' + pName);
                                });
                            }
                        });
                    }
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_manajemen_produk_instan() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}        📦 MANAJEMEN PRODUK INSTAN (CUSTOM)         ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Tambah Produk Custom"
        echo -e "  ${C_GREEN}[2]${C_RST} Hapus Produk Custom"
        echo -e "  ${C_GREEN}[3]${C_RST} Edit Nama/Kategori Produk"
        echo -e "  ${C_GREEN}[4]${C_RST} Daftar Produk Custom"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-4]: ${C_RST}"
        read c_prod

        case $c_prod in
            1)
                read -p "Masukkan Kode SKU Digiflazz: " sku_code
                if [ -z "$sku_code" ]; then continue; fi
                
                # Fetch API & Simpan via Node.js
                SKU="$sku_code" node -e "
                    const crypto = require('crypto');
                    const axios = require('axios');
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    
                    async function addCustom() {
                        let cfg = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                        let config = cfg ? JSON.parse(cfg.data) : {};
                        let user = config.digiflazzUsername || '';
                        let key = config.digiflazzApiKey || '';
                        
                        if(!user || !key) { console.log('\x1b[31mAPI Digiflazz belum disetup!\x1b[0m'); return; }
                        
                        let sign = crypto.createHash('md5').update(user + key + 'pricelist').digest('hex');
                        try {
                            // Cek Prepaid
                            let res = await axios.post('https://api.digiflazz.com/v1/price-list', { cmd: 'prepaid', username: user, sign: sign });
                            let items = res.data.data || [];
                            let item = items.find(i => i.buyer_sku_code === process.env.SKU);
                            
                            if(!item) {
                                // Cek Pasca
                                let resPasca = await axios.post('https://api.digiflazz.com/v1/price-list', { cmd: 'pasca', username: user, sign: sign });
                                items = resPasca.data.data || [];
                                item = items.find(i => i.buyer_sku_code === process.env.SKU);
                            }
                            
                            if(item) {
                                let modal = item.price || item.admin || 0;
                                console.log('\x1b[32mProduk Ditemukan: ' + item.product_name + ' (Modal: Rp ' + modal + ')\x1b[0m');
                                
                                const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
                                readline.question('Masukkan Nama Custom: ', (namaCustom) => {
                                    readline.question('Masukkan Kategori Custom: ', (katCustom) => {
                                        let margin = config.margin || {t1:50, t2:100, t3:250, t4:500, t5:1000, t6:1500, t7:2000, t8:2500, t9:3000, t10:4000, t11:5000, t12:7500, t13:10000};
                                        let keuntungan = 0;
                                        if(modal <= 100) keuntungan = margin.t1;
                                        else if(modal <= 500) keuntungan = margin.t2;
                                        else if(modal <= 1000) keuntungan = margin.t3;
                                        else if(modal <= 2000) keuntungan = margin.t4;
                                        else if(modal <= 3000) keuntungan = margin.t5;
                                        else if(modal <= 4000) keuntungan = margin.t6;
                                        else if(modal <= 5000) keuntungan = margin.t7;
                                        else if(modal <= 10000) keuntungan = margin.t8;
                                        else if(modal <= 25000) keuntungan = margin.t9;
                                        else if(modal <= 50000) keuntungan = margin.t10;
                                        else if(modal <= 75000) keuntungan = margin.t11;
                                        else if(modal <= 100000) keuntungan = margin.t12;
                                        else keuntungan = margin.t13;
                                        
                                        let hargaJual = modal + keuntungan;
                                        let isPasca = !!item.admin;
                                        
                                        let newProd = {
                                            sku_asli: process.env.SKU, nama: namaCustom || item.product_name,
                                            harga: hargaJual, kategori: katCustom || 'Custom', brand: item.brand || 'Lainnya',
                                            sub_kategori: 'Custom', deskripsi: item.desc || 'Proses Cepat',
                                            status_produk: true, is_manual_cat: true, is_custom_top: 1, is_pasca_api: isPasca
                                        };
                                        
                                        db.prepare('INSERT OR REPLACE INTO produk (id, data) VALUES (?, ?)').run(process.env.SKU, JSON.stringify(newProd));
                                        console.log('\x1b[32m✅ Produk Custom Disimpan! Harga Jual: Rp ' + hargaJual + '\x1b[0m');
                                        readline.close();
                                    });
                                });
                            } else {
                                console.log('\x1b[31mSKU Tidak Ditemukan di Digiflazz!\x1b[0m');
                            }
                        } catch(e) { console.log('Error: ' + e.message); }
                    }
                    addCustom();
                "
                sleep 2
                ;;
            2)
                read -p "Masukkan SKU Produk yang akan dihapus: " del_sku
                if [ ! -z "$del_sku" ]; then
                    SKU="$del_sku" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let info = db.prepare('DELETE FROM produk WHERE id = ?').run(process.env.SKU);
                        if(info.changes > 0) console.log('\x1b[32m✅ Produk terhapus!\x1b[0m');
                        else console.log('\x1b[31m❌ SKU tidak ditemukan.\x1b[0m');
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                read -p "Masukkan SKU Produk yang akan diedit: " edit_sku
                if [ ! -z "$edit_sku" ]; then
                    read -p "Nama Baru (Kosongkan jika tetap): " edit_nama
                    read -p "Kategori Baru (Kosongkan jika tetap): " edit_kat
                    SKU="$edit_sku" NAMA="$edit_nama" KAT="$edit_kat" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let row = db.prepare('SELECT data FROM produk WHERE id = ?').get(process.env.SKU);
                        if(row) {
                            let p = JSON.parse(row.data);
                            if(process.env.NAMA) p.nama = process.env.NAMA;
                            if(process.env.KAT) p.kategori = process.env.KAT;
                            db.prepare('UPDATE produk SET data = ? WHERE id = ?').run(JSON.stringify(p), process.env.SKU);
                            console.log('\x1b[32m✅ Produk diupdate!\x1b[0m');
                        } else {
                            console.log('\x1b[31m❌ SKU tidak ditemukan.\x1b[0m');
                        }
                    "
                fi
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                echo -e "\n${C_MAG}--- DAFTAR PRODUK CUSTOM (TOP) ---${C_RST}"
                node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM produk').all();
                    let count = 0;
                    for(let r of rows) {
                        let p = JSON.parse(r.data);
                        if(p.is_custom_top === 1) {
                            console.log('[' + r.id + '] ' + p.nama + ' | Kat: ' + p.kategori + ' | Rp ' + p.harga);
                            count++;
                        }
                    }
                    if(count === 0) console.log('Belum ada produk custom.');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}

menu_pemeliharaan() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}          🛠️ ATUR WAKTU PEMELIHARAAN SISTEM 🛠️        ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    node -e "
        const Database = require('better-sqlite3');
        const db = new Database('tendo_database.db');
        let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
        let cfg = row ? JSON.parse(row.data) : {};
        console.log('Waktu Pemeliharaan Saat Ini: ' + (cfg.maintStart || '23:00') + ' s/d ' + (cfg.maintEnd || '00:30') + ' WIB');
    "
    echo -e "${C_MAG}Format waktu 24 Jam (Contoh: 23:00)${C_RST}"
    read -p "Masukkan Jam Mulai Pemeliharaan: " m_start
    read -p "Masukkan Jam Selesai Pemeliharaan: " m_end
    
    if [ ! -z "$m_start" ] && [ ! -z "$m_end" ]; then
        M_START="$m_start" M_END="$m_end" node -e "
            const Database = require('better-sqlite3');
            const db = new Database('tendo_database.db');
            let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
            let cfg = row ? JSON.parse(row.data) : {};
            cfg.maintStart = process.env.M_START;
            cfg.maintEnd = process.env.M_END;
            db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(cfg));
            console.log('\x1b[32m✅ Waktu pemeliharaan berhasil diupdate menjadi ' + process.env.M_START + ' - ' + process.env.M_END + ' WIB!\x1b[0m');
        "
    else
        echo -e "${C_RED}❌ Gagal, format waktu tidak boleh kosong!${C_RST}"
    fi
    read -p "Tekan Enter untuk kembali..."
}

menu_setup_cs() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}        🎧 SETUP NOMOR ADMIN / CUSTOMER SERVICE       ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    read -p "Masukkan Nomor WA Admin Baru (Awali dengan 62): " input_wa
    
    # Membersihkan input dari karakter selain angka menggunakan sed
    clean_wa=$(echo "$input_wa" | sed 's/[^0-9]//g')
    
    if [ ! -z "$clean_wa" ]; then
        CLEAN_WA="$clean_wa" node -e "
            const Database = require('better-sqlite3');
            const db = new Database('tendo_database.db');
            let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
            let config = row ? JSON.parse(row.data) : {};
            config.botNumber = process.env.CLEAN_WA;
            db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
            console.log('\x1b[32m✅ Nomor Admin/CS berhasil diperbarui menjadi: ' + process.env.CLEAN_WA + '\x1b[0m');
        "
    else
        echo -e "${C_RED}❌ Input tidak valid!${C_RST}"
    fi
    read -p "Tekan Enter untuk kembali..."
}

menu_cek_log() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}               📊 LIVE LOG MONITOR (PM2)            ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_MAG}>> Menampilkan log realtime dari PM2...${C_RST}"
    echo -e "${C_RED}${C_BOLD}[INFO] Tekan CTRL+C untuk keluar dari monitor log ini.${C_RST}\n"
    pm2 logs
    echo ""
    read -p "Tekan Enter untuk kembali ke menu utama..."
}

menu_config_api() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}             ⚙️ KONFIGURASI API GATEWAY             ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_MAG}Kosongkan dan tekan Enter jika tidak ingin mengubah nilai yang ada.${C_RST}\n"
    read -p "Digiflazz Username: " df_user
    read -p "Digiflazz API Key: " df_key
    read -p "GoPay Token: " gp_token
    read -p "GoPay Merchant ID: " gp_mid
    
    DF_USER="$df_user" DF_KEY="$df_key" GP_TOKEN="$gp_token" GP_MID="$gp_mid" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('tendo_database.db');
        let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
        let config = row ? JSON.parse(row.data) : {};
        
        if(process.env.DF_USER) config.digiflazzUsername = process.env.DF_USER;
        if(process.env.DF_KEY) config.digiflazzApiKey = process.env.DF_KEY;
        if(process.env.GP_TOKEN) config.gopayToken = process.env.GP_TOKEN;
        if(process.env.GP_MID) config.gopayMerchantId = process.env.GP_MID;
        
        db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
        console.log('\x1b[32m\n✅ Konfigurasi API Gateway berhasil disimpan ke database!\x1b[0m');
    "
    read -p "Tekan Enter untuk kembali..."
}

menu_restart_services() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}               🔄 RESTART SEMUA SERVICES            ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_MAG}>> Memulai ulang layanan backend melalui PM2...${C_RST}"
    pm2 restart all
    
    echo -e "\n${C_MAG}>> Memulai ulang layanan Nginx...${C_RST}"
    sudo systemctl restart nginx
    
    echo -e "\n${C_GREEN}${C_BOLD}✅ Semua service berhasil di-restart! Sistem kembali fresh.${C_RST}"
    read -p "Tekan Enter untuk kembali..."
}

menu_db_stats() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}              📈 STATISTIK DATABASE SQLite          ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    node -e "
        const Database = require('better-sqlite3');
        const db = new Database('tendo_database.db', { readonly: true });
        
        try {
            let userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
            let prodCount = db.prepare('SELECT COUNT(*) as c FROM produk').get().c;
            let trxCount = db.prepare('SELECT COUNT(*) as c FROM trx').get().c;
            let topupCount = db.prepare('SELECT COUNT(*) as c FROM topup').get().c;
            let globalTrxCount = db.prepare('SELECT COUNT(*) as c FROM global_trx').get().c;
            let optCount = db.prepare('SELECT COUNT(*) as c FROM otp_sessions').get().c;
            
            console.log('\x1b[32m👥 Total Pengguna Terdaftar : \x1b[1m' + userCount + '\x1b[0m');
            console.log('\x1b[36m📦 Total Produk Tersedia    : \x1b[1m' + prodCount + '\x1b[0m');
            console.log('\x1b[33m🛒 Transaksi Sedang Proses  : \x1b[1m' + trxCount + '\x1b[0m');
            console.log('\x1b[35m💳 Topup Saldo Berjalan     : \x1b[1m' + topupCount + '\x1b[0m');
            console.log('\x1b[34m🌐 Riwayat Transaksi Global : \x1b[1m' + globalTrxCount + '\x1b[0m');
            console.log('\x1b[36m🔑 Sesi OTP Aktif (In-DB)   : \x1b[1m' + optCount + '\x1b[0m');
        } catch(e) {
            console.log('\x1b[31mGagal membaca database: ' + e.message + '\x1b[0m');
        }
    "
    echo ""
    read -p "Tekan Enter untuk kembali..."
}

menu_notifikasi() {
    while true; do
        clear
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "${C_YELLOW}${C_BOLD}          📢 SETUP INTEGRASI NOTIFIKASI             ${C_RST}"
        echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
        echo -e "  ${C_GREEN}[1]${C_RST} Setup Telegram ADMIN"
        echo -e "  ${C_GREEN}[2]${C_RST} Setup Telegram PELANGGAN"
        echo -e "  ${C_GREEN}[3]${C_RST} Setup Grup/Saluran WA"
        echo -e "  ${C_GREEN}[4]${C_RST} Hapus Notifikasi Website (Web Alert)"
        echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
        echo -e "  ${C_RED}[0]${C_RST} Kembali ke Panel Utama"
        echo -e "${C_CYAN}======================================================${C_RST}"
        echo -ne "${C_YELLOW}Pilih menu [0-4]: ${C_RST}"
        read n_choice

        case $n_choice in
            1)
                read -p "Token Bot Telegram Admin: " t_token
                read -p "Chat ID Admin: " t_chatid
                TOKEN="$t_token" CHATID="$t_chatid" node -e "
                    const db = require('better-sqlite3')('tendo_database.db');
                    let r = db.prepare(\"SELECT data FROM config WHERE id='main'\").get();
                    let c = r ? JSON.parse(r.data) : {};
                    if(process.env.TOKEN) c.teleToken = process.env.TOKEN;
                    if(process.env.CHATID) c.teleChatId = process.env.CHATID;
                    db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(c));
                    console.log('\x1b[32m✅ Setup Tele Admin Disimpan.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            2)
                read -p "Token Bot Telegram Pelanggan: " t_token_p
                read -p "Channel/Grup ID Pelanggan (Cth: -100xxx): " t_chatid_p
                read -p "Link Channel Pelanggan (Opsional): " t_link
                TOKEN="$t_token_p" CHATID="$t_chatid_p" LINK="$t_link" node -e "
                    const db = require('better-sqlite3')('tendo_database.db');
                    let r = db.prepare(\"SELECT data FROM config WHERE id='main'\").get();
                    let c = r ? JSON.parse(r.data) : {};
                    if(process.env.TOKEN) c.teleTokenInfo = process.env.TOKEN;
                    if(process.env.CHATID) c.teleChannelId = process.env.CHATID;
                    if(process.env.LINK) c.teleLinkPelanggan = process.env.LINK;
                    db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(c));
                    console.log('\x1b[32m✅ Setup Tele Pelanggan Disimpan.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            3)
                read -p "JID Grup WhatsApp (Cth: 12036xxx@g.us): " wa_grup
                JID="$wa_grup" node -e "
                    const db = require('better-sqlite3')('tendo_database.db');
                    let r = db.prepare(\"SELECT data FROM config WHERE id='main'\").get();
                    let c = r ? JSON.parse(r.data) : {};
                    if(process.env.JID) c.waBroadcastId = process.env.JID;
                    db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(c));
                    console.log('\x1b[32m✅ Setup WA Broadcast Disimpan.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            4)
                node -e "
                    const db = require('better-sqlite3')('tendo_database.db');
                    db.prepare('DELETE FROM web_notif').run();
                    console.log('\x1b[32m✅ Semua alert web dihapus.\x1b[0m');
                "
                read -p "Tekan Enter untuk kembali..."
                ;;
            0) break ;;
            *) echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"; sleep 1 ;;
        esac
    done
}
menu_broadcast() {
    clear
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}             📢 BROADCAST PESAN GLOBAL              ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_MAG}Pesan akan dikirim otomatis ke:${C_RST}"
    echo -e "- Pemberitahuan Website"
    echo -e "- Channel Telegram"
    echo -e "- Grup / Saluran WhatsApp\n"

    read -p "Masukkan Judul Pesan (Cth: PROMO HARI INI): " b_title
    if [ -z "$b_title" ]; then echo "Dibatalkan."; sleep 1; return; fi

    echo -e "Ketik isi pesan teks Anda:"
    read -p ">> " b_text
    if [ -z "$b_text" ]; then echo "Dibatalkan."; sleep 1; return; fi

    echo -e "\n${C_CYAN}Apakah Anda ingin menyertakan Media (Gambar/Video)?${C_RST}"
    echo -e "  ${C_GREEN}[1]${C_RST} Ya, sertakan Gambar (JPEG/PNG)"
    echo -e "  ${C_GREEN}[2]${C_RST} Ya, sertakan Video (MP4)"
    echo -e "  ${C_GREEN}[3]${C_RST} Tidak, kirim Teks saja"
    echo -ne "${C_YELLOW}Pilih opsi [1-3]: ${C_RST}"
    read b_media_choice

    b_media_url=""
    b_media_type="none"

    if [ "$b_media_choice" == "1" ]; then
        echo -e "${C_MAG}Masukkan Direct URL Gambar yang valid (Cth: https://domain.com/promo.jpg)${C_RST}"
        read -p "URL Gambar: " b_media_url
        b_media_type="image"
    elif [ "$b_media_choice" == "2" ]; then
        echo -e "${C_MAG}Masukkan Direct URL Video yang valid (Cth: https://domain.com/tutorial.mp4)${C_RST}"
        read -p "URL Video: " b_media_url
        b_media_type="video"
    fi

    echo -e "\n${C_YELLOW}⏳ Memproses dan mengirim broadcast...${C_RST}"

    # Escape quotes agar JSON tidak error
    b_title=$(echo "$b_title" | sed 's/"/\\"/g')
    b_text=$(echo "$b_text" | sed 's/"/\\"/g')
    
    # Hit API internal menggunakan curl
    RESPONSE=$(curl -s -X POST http://localhost:3000/api/internal/broadcast \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"$b_title\", \"text\":\"$b_text\", \"media_url\":\"$b_media_url\", \"media_type\":\"$b_media_type\"}")

    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo -e "${C_GREEN}✅ Broadcast berhasil dikirim ke semua platform!${C_RST}"
    else
        echo -e "${C_RED}❌ Gagal mengirim broadcast. Pastikan Bot (PM2) sedang berjalan aktif.${C_RST}"
        echo -e "Detail Error: $RESPONSE"
    fi

    echo ""
    read -p "Tekan Enter untuk kembali..."
}

while true; do
    clear
    
    SALDO_DIGI="Rp 0 (Memuat...)"
    if [ -f "cek_saldo.js" ]; then
        SALDO_DIGI=$(node cek_saldo.js 2>/dev/null)
    fi

    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_YELLOW}${C_BOLD}        🤖 PANEL ADMIN DIGITAL TENDO STORE 🤖         ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_GREEN}${C_BOLD} 💰 Sisa Saldo Digiflazz : ${C_YELLOW}${SALDO_DIGI}${C_RST}"
    echo -e "${C_CYAN}------------------------------------------------------${C_RST}"
    echo -e "${C_MAG}▶ 🟢 SISTEM UTAMA${C_RST}"
    echo -e "  ${C_GREEN}[1]${C_RST}  Install & Perbarui Sistem (Wajib Jalankan Dulu)"
    echo -e "  ${C_GREEN}[2]${C_RST}  Mulai Sistem (Terminal / Scan QR)"
    echo -e "  ${C_GREEN}[3]${C_RST}  Jalankan Sistem di Latar Belakang (PM2)"
    echo -e "  ${C_GREEN}[4]${C_RST}  Hentikan Sistem (PM2)"
    echo -e "  ${C_GREEN}[5]${C_RST}  Lihat Log / Error (Lama)"
    echo ""
    echo -e "${C_MAG}▶ 📦 MANAJEMEN PRODUK & KATEGORI${C_RST}"
    echo -e "  ${C_GREEN}[6]${C_RST}  🔄 Sinkronisasi Produk Digiflazz"
    echo -e "  ${C_GREEN}[7]${C_RST}  💰 Manajemen Keuntungan Harga (13 Tingkat)"
    echo -e "  ${C_GREEN}[8]${C_RST}  📦 Manajemen Produk Instan (Paket Custom)"
    echo -e "  ${C_GREEN}[9]${C_RST}  🛡️ Manajemen VPN Premium"
    echo -e "  ${C_GREEN}[10]${C_RST} 🌟 Manajemen Etalase Custom (Best Seller)"
    echo -e "  ${C_GREEN}[11]${C_RST} 🎬 Manajemen Tutorial"
    echo ""
    echo -e "${C_MAG}▶ 👥 MANAJEMEN PENGGUNA${C_RST}"
    echo -e "  ${C_GREEN}[12]${C_RST} 👥 Manajemen Saldo & Member"
    echo ""
    echo -e "${C_MAG}▶ ⚙️ PENGATURAN & INTEGRASI${C_RST}"
    echo -e "  ${C_GREEN}[13]${C_RST} 🔌 Setup API Digiflazz"
    echo -e "  ${C_GREEN}[14]${C_RST} 🔐 Setup Secret Digiflazz"
    echo -e "  ${C_GREEN}[15]${C_RST} 💳 Setup GoPay Merchant API"
    echo -e "  ${C_GREEN}[16]${C_RST} 📢 Setup Integrasi Notifikasi (Tele/Web)"
    echo -e "  ${C_GREEN}[17]${C_RST} 🌍 Setup Domain & HTTPS (SSL)"
    echo -e "  ${C_GREEN}[18]${C_RST} 🔄 Ganti Akun WA Web OTP (Reset Sesi)"
    echo -e "  ${C_GREEN}[19]${C_RST} 🛠️ Atur Waktu Pemeliharaan Sistem"
    echo -e "  ${C_GREEN}[22]${C_RST} 🎧 Setup Nomor Admin / CS (Baru)"
    echo -e "  ${C_GREEN}[23]${C_RST} ⚙️ Konfigurasi API Gateway (Baru)"
    echo ""
    echo -e "${C_MAG}▶ 💾 SYSTEM TOOLS & UTILITIES${C_RST}"
    echo -e "  ${C_GREEN}[20]${C_RST} 💾 Backup & Restore Database"
    echo -e "  ${C_GREEN}[21]${C_RST} ⚙️ Pengaturan Auto-Backup Telegram"
    echo -e "  ${C_GREEN}[24]${C_RST} 📊 Live Log Monitor (PM2) (Baru)"
    echo -e "  ${C_GREEN}[25]${C_RST} 📈 Statistik Database SQLite (Baru)"
    echo -e "  ${C_GREEN}[26]${C_RST} 🔄 Restart Services"
    echo -e "  ${C_GREEN}[27]${C_RST} 📢 Broadcast Pesan Global"
    echo -e "${C_CYAN}======================================================${C_RST}"
    echo -e "  ${C_RED}[0]${C_RST}  Keluar dari Panel"
    echo -e "${C_CYAN}======================================================${C_RST}"
    echo -ne "${C_YELLOW}Pilih menu [0-27]: ${C_RST}"
    read choice

    case $choice in
        1) install_dependencies ;;
        2) 
            if [ ! -f "index.js" ]; then echo -e "${C_RED}❌ Jalankan Menu 1 (Install) dulu!${C_RST}"; sleep 2; continue; fi
            if [ ! -d "sesi_bot" ] || [ -z "$(ls -A sesi_bot 2>/dev/null)" ]; then
                read -p "📲 Masukkan Nomor WA Bot (Awali 628...): " nomor_bot
                if [ ! -z "$nomor_bot" ]; then
                    NOMOR_BOT="$nomor_bot" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                        let config = row ? JSON.parse(row.data) : {};
                        config.botNumber = process.env.NOMOR_BOT;
                        config.botName = config.botName || 'Digital Tendo Store';
                        db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
                    "
                fi
            fi
            echo -e "${C_CYAN}Memulai bot... Jika muncul QR, segera scan menggunakan WA tertaut.${C_RST}"
            node index.js
            ;;
        3) 
            if [ ! -f "index.js" ]; then echo -e "${C_RED}❌ Jalankan Menu 1 (Install) dulu!${C_RST}"; sleep 2; continue; fi
            pm2 start index.js --name tendobot > /dev/null 2>&1
            pm2 save > /dev/null 2>&1
            pm2 startup > /dev/null 2>&1
            echo -e "${C_GREEN}✅ Sistem berhasil dijalankan di latar belakang!${C_RST}"
            sleep 2
            ;;
        4) 
            pm2 stop tendobot > /dev/null 2>&1
            echo -e "${C_RED}🛑 Sistem telah dihentikan!${C_RST}"
            sleep 2
            ;;
        5) 
            pm2 logs tendobot --lines 100
            read -p "Tekan Enter untuk kembali..."
            ;;
        6) menu_sinkron ;;
        7) menu_keuntungan ;;
        8) menu_manajemen_produk_instan ;;
        9) menu_manajemen_vpn ;;
        10) menu_etalase_custom ;;
        11) menu_tutorial ;;
        12) menu_member ;;
        13)
            clear
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_YELLOW}${C_BOLD}                🔌 SETUP API DIGIFLAZZ              ${C_RST}"
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            read -p "Masukkan Username Digiflazz: " df_user
            read -p "Masukkan API Key (Production): " df_key
            DF_USER="$df_user" DF_KEY="$df_key" node -e "
                const Database = require('better-sqlite3');
                const db = new Database('tendo_database.db');
                let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                let config = row ? JSON.parse(row.data) : {};
                if(process.env.DF_USER !== '') config.digiflazzUsername = process.env.DF_USER;
                if(process.env.DF_KEY !== '') config.digiflazzApiKey = process.env.DF_KEY;
                db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
            "
            echo -e "${C_GREEN}✅ API Digiflazz berhasil disimpan!${C_RST}"
            sleep 2
            ;;
        14)
            clear
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_YELLOW}${C_BOLD}              🔐 SETUP SECRET DIGIFLAZZ             ${C_RST}"
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "Secret Key digunakan untuk menerima laporan (Webhook) dari Digiflazz."
            read -p "Masukkan Webhook Secret Key: " wh_secret
            WH_SECRET="$wh_secret" node -e "
                const Database = require('better-sqlite3');
                const db = new Database('tendo_database.db');
                let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                let config = row ? JSON.parse(row.data) : {};
                if(process.env.WH_SECRET !== '') config.webhookSecret = process.env.WH_SECRET;
                db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
            "
            echo -e "${C_GREEN}✅ Secret Key Webhook berhasil disimpan!${C_RST}"
            sleep 2
            ;;
        15)
            clear
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_YELLOW}${C_BOLD}               💳 SETUP API MERCHAN/QRIS            ${C_RST}"
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            read -p "Masukkan Token (GoPay / Gateway): " gp_token
            read -p "Masukkan Teks QRIS / Link SVG Asli Anda: " gp_qris
            
            GP_TOKEN="$gp_token" GP_QRIS="$gp_qris" node -e "
                const Database = require('better-sqlite3');
                const db = new Database('tendo_database.db');
                let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                let config = row ? JSON.parse(row.data) : {};
                
                if(process.env.GP_TOKEN !== '') config.gopayToken = process.env.GP_TOKEN;
                
                let inputQris = process.env.GP_QRIS || '';
                if(inputQris.startsWith('http')) {
                    config.qrisUrl = inputQris;
                    config.qrisText = '';
                } else if(inputQris !== '') {
                    config.qrisText = inputQris;
                    config.qrisUrl = '';
                    config.gopayMerchantId = 'CustomQRIS';
                }
                
                db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
            "
            echo -e "${C_GREEN}✅ Konfigurasi Pembayaran (QRIS) berhasil disimpan!${C_RST}"
            sleep 2
            ;;
        16) menu_notifikasi ;;

        17)
            clear
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_YELLOW}${C_BOLD}            🌍 SETUP DOMAIN & HTTPS (SSL)           ${C_RST}"
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            read -p "Masukkan Nama Domain (contoh: store.tendo.id): " domain_name
            read -p "Masukkan Alamat Email (Untuk Notifikasi Expired SSL): " email_ssl
            
            if [ -z "$domain_name" ] || [ -z "$email_ssl" ]; then
                echo -e "${C_RED}❌ Domain dan Email tidak boleh kosong!${C_RST}"
                sleep 2
                continue
            fi
            
            echo -e "${C_MAG}>> Menginstal Nginx dan Certbot...${C_RST}"
            sudo apt update > /dev/null 2>&1
            sudo apt install nginx certbot python3-certbot-nginx -y > /dev/null 2>&1
            
            echo -e "${C_MAG}>> Konfigurasi Proxy Nginx ke Port 3000...${C_RST}"
            cat << EOF | sudo tee /etc/nginx/sites-available/$domain_name > /dev/null
server {
    listen 80;
    server_name $domain_name;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
            sudo ln -s /etc/nginx/sites-available/$domain_name /etc/nginx/sites-enabled/ > /dev/null 2>&1
            sudo systemctl restart nginx > /dev/null 2>&1
            
            echo -e "${C_MAG}>> Mengajukan Sertifikat SSL Let's Encrypt...${C_RST}"
            sudo certbot --nginx -d $domain_name --non-interactive --agree-tos -m $email_ssl
            
            echo -e "${C_GREEN}✅ Setup Domain dan HTTPS selesai! Silakan akses https://$domain_name${C_RST}"
            read -p "Tekan Enter untuk kembali..."
            ;;
        18)
            clear
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_YELLOW}${C_BOLD}             🔄 RESET AKUN WHATSAPP BOT             ${C_RST}"
            echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
            echo -e "${C_RED}⚠️ PERINGATAN: Ini akan menghapus sesi WhatsApp Bot saat ini!${C_RST}"
            read -p "Apakah Anda yakin ingin reset bot WA? (y/n): " reset_wa
            
            if [ "$reset_wa" == "y" ] || [ "$reset_wa" == "Y" ]; then
                pm2 stop tendobot > /dev/null 2>&1
                rm -rf sesi_bot
                
                read -p "Masukkan Nomor WA Bot BARU (Awali 628...): " nomor_bot
                if [ ! -z "$nomor_bot" ]; then
                    NOMOR_BOT="$nomor_bot" node -e "
                        const Database = require('better-sqlite3');
                        const db = new Database('tendo_database.db');
                        let row = db.prepare(\"SELECT data FROM config WHERE id = 'main'\").get();
                        let config = row ? JSON.parse(row.data) : {};
                        config.botNumber = process.env.NOMOR_BOT;
                        db.prepare(\"INSERT OR REPLACE INTO config (id, data) VALUES ('main', ?)\").run(JSON.stringify(config));
                    "
                fi
                echo -e "${C_GREEN}✅ Sesi berhasil dihapus. Silakan pilih menu [2] untuk Scan Ulang.${C_RST}"
            else
                echo -e "${C_YELLOW}Reset dibatalkan.${C_RST}"
            fi
            sleep 2
            ;;
        19) menu_pemeliharaan ;;
        20) menu_backup ;;
        21) menu_telegram ;;
        22) menu_setup_cs ;;
        23) menu_config_api ;;
        24) menu_cek_log ;;
        25) menu_db_stats ;;
        26) menu_restart_services ;;
        27) menu_broadcast ;;
        0) 
            clear
            echo -e "${C_GREEN}Terima kasih telah menggunakan Panel Digital Tendo Store!${C_RST}"
            exit 0 
            ;;
        *) 
            echo -e "${C_RED}❌ Pilihan tidak valid!${C_RST}"
            sleep 1 
            ;;
    esac
done 

