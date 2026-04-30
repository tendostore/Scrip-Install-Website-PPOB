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
    echo -e '#!/bin/bash\ncd /root/digital-tendo\n./install.sh' | sudo tee /usr/bin/bot > /dev/null
    sudo chmod +x /usr/bin/bot
fi

if [ ! -f "/usr/bin/menu" ]; then
    echo -e '#!/bin/bash\ncd /root/digital-tendo\n./install.sh' | sudo tee /usr/bin/menu > /dev/null
    sudo chmod +x /usr/bin/menu
fi

# Fitur Auto-Start Panel saat buka VPS
if ! grep -q "/usr/bin/menu" ~/.bashrc; then
    echo '# Auto-start bot panel' >> ~/.bashrc
    echo 'if [ -t 1 ] && [ -x /usr/bin/menu ] && [ -z "$TMUX" ]; then /usr/bin/menu; fi' >> ~/.bashrc
fi

# Pindah ke direktori utama jika sudah ada
if [ -d "/root/digital-tendo" ]; then
    cd /root/digital-tendo
fi

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
    }

    echo -ne "${C_MAG}>> Mengatur zona waktu (Asia/Jakarta)...${C_RST}"
    sudo timedatectl set-timezone Asia/Jakarta > /dev/null 2>&1 || sudo ln -sf /usr/share/zoneinfo/Asia/Jakarta /etc/localtime
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -ne "${C_MAG}>> Mengupdate repositori sistem...${C_RST}"
    (sudo -E apt-get update > /dev/null 2>&1 && sudo -E apt-get upgrade -y > /dev/null 2>&1) &
    spin $!
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -ne "${C_MAG}>> Menginstall dependensi (curl, zip, unzip, build-essential, python3, git)...${C_RST}"
    sudo -E apt-get install -y curl git wget nano zip unzip build-essential python3 > /dev/null 2>&1 &
    spin $!
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
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -ne "${C_MAG}>> Menginstall PM2...${C_RST}"
    (sudo npm install -g pm2 > /dev/null 2>&1) &
    spin $!
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    echo -e "${C_CYAN}>> Menginstal PM2 Logrotate untuk mencegah hardisk penuh...${C_RST}"
    pm2 install pm2-logrotate >/dev/null 2>&1

    echo -ne "${C_MAG}>> Mengkloning repositori source code...${C_RST}"
    rm -rf /root/digital-tendo
    git clone https://github.com/tendostore/Scrip-Install-Website-PPOB.git /root/digital-tendo > /dev/null 2>&1 &
    spin $!
    echo -e "${C_GREEN}[Selesai]${C_RST}"

    # MASUK KE DIREKTORI SOURCE CODE SEBELUM NPM INSTALL
    cd /root/digital-tendo

    echo -ne "${C_MAG}>> Membersihkan cache npm...${C_RST}"
    rm -rf node_modules package-lock.json
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -ne "${C_MAG}>> Mengunduh dependensi NPM dari package.json...${C_RST}"
    npm install > install_npm.log 2>&1 &
    spin $!
    echo -e "${C_GREEN}[Selesai]${C_RST}"
    
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    echo -e "${C_GREEN}${C_BOLD}                 ✅ INSTALASI SELESAI!                ${C_RST}"
    echo -e "${C_CYAN}${C_BOLD}======================================================${C_RST}"
    read -p "Tekan Enter untuk kembali..."
}
# === SELESAI ===
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
                    mkdir -p /root/digital-tendo/public/tutorials
                    
                    if [[ "$t_video_src" == http* ]]; then
                        echo -e "${C_CYAN}⏳ Mendownload video...${C_RST}"
                        wget -qO "/root/digital-tendo/public/tutorials/$t_video_name" "$t_video_src"
                        if [ $? -eq 0 ]; then
                            echo -e "${C_GREEN}✅ Video berhasil didownload!${C_RST}"
                        else
                            echo -e "${C_RED}❌ Gagal mendownload video.${C_RST}"
                        fi
                    else
                        if [ -f "$t_video_src" ]; then
                            cp "$t_video_src" "/root/digital-tendo/public/tutorials/$t_video_name"
                            echo -e "${C_GREEN}✅ Video berhasil dicopy!${C_RST}"
                        else
                            echo -e "${C_RED}❌ File lokal tidak ditemukan. Melanjutkan simpan data saja...${C_RST}"
                        fi
                    fi
                fi
                
                echo -e "Untuk baris baru gunakan tag <br>, atau tulis teks panjang."
                read -p "Masukkan Deskripsi (Bisa paragraf/list): " t_desc
                
                cd /root/digital-tendo && T_JUDUL="$t_judul" T_VIDEO="$t_video_name" T_DESC="$t_desc" node -e "
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
                cd /root/digital-tendo && node -e "
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
                    
                    cd /root/digital-tendo && T_NUM="$t_num" T_JUDUL="$t_judul" T_VIDEO="$t_video" T_DESC="$t_desc" node -e "
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
                cd /root/digital-tendo && node -e "
                    const Database = require('better-sqlite3');
                    const db = new Database('tendo_database.db');
                    let rows = db.prepare('SELECT id, data FROM tutorial').all();
                    if(rows.length === 0) { console.log('\x1b[31mBelum ada tutorial.\x1b[0m'); process.exit(0); }
                    rows.forEach((r, i) => { let t = JSON.parse(r.data); console.log('[' + (i+1) + '] ' + t.title); });
                "
                echo ""
                read -p "Pilih nomor tutorial yang ingin dihapus: " t_num
                if [[ "$t_num" =~ ^[0-9]+$ ]]; then
                    cd /root/digital-tendo && T_NUM="$t_num" node -e "
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
                cd /root/digital-tendo && node -e "
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
                cd /root/digital-tendo && PENCARIAN="$pencarian" JUMLAH="$jumlah" node -e "
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
                cd /root/digital-tendo && PENCARIAN="$pencarian" JUMLAH="$jumlah" node -e "
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
                cd /root/digital-tendo && node -e "
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
                    cd /root/digital-tendo && PENCARIAN="$pencarian" node -e "
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
        
        cd /root/digital-tendo && node -e "
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
            
            cd /root/digital-tendo && K_CHOICE="$k_choice" NOMINAL_BARU="$nominal_baru" node -e "
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
# === SELESAI ===
