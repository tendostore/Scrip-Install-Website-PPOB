const crypto = require('crypto');
const axios = require('axios');
const { exec } = require('child_process');
const db = require('../config/database');
const appEvents = require('../utils/events');
const { maskStringTarget } = require('../utils/helpers');

// Pembersihan riwayat lama dan mutasi yang sudah diproses (> 30 Hari dan > 24 Jam)
function cleanupOldHistory() {
    try {
        let now = Date.now();
        let thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        let updates = [];
        
        let stmt = db.dbSqlite.prepare('SELECT id, data FROM users');
        for (const row of stmt.iterate()) {
            let u = JSON.parse(row.data);
            if (u && u.history && u.history.length > 0) {
                let origLen = u.history.length;
                u.history = u.history.filter(h => (now - h.ts) < thirtyDaysMs);
                if (u.history.length !== origLen) {
                    updates.push({ id: row.id, data: u });
                }
            }
        }
        
        if (updates.length > 0) {
            const updateStmt = db.dbSqlite.prepare('INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)');
            db.dbSqlite.transaction(() => {
                for (let up of updates) {
                    updateStmt.run(up.id, JSON.stringify(up.data));
                }
            })();
        }
        
        db.dbSqlite.prepare(`DELETE FROM jwt_blacklist`).run();
        db.dbSqlite.prepare(`DELETE FROM used_mutations WHERE timestamp < ?`).run(Date.now() - 86400000);

    } catch (e) { console.error("Error during cleanup:", e.message); }
}

// Backup Otomatis via Telegram Admin
function doBackupAndSend() {
    let cfg = db.getRecord('config', 'main') || {};
    if (!cfg.teleToken || !cfg.teleChatId) return;
    exec(`[ -d "/etc/letsencrypt" ] && sudo tar -czf ssl_backup.tar.gz -C / etc/letsencrypt 2>/dev/null; rm -f backup.zip && zip backup.zip tendo_database.db ssl_backup.tar.gz 2>/dev/null`, (err) => {
        if (!err) exec(`curl -s -F chat_id="${cfg.teleChatId}" -F document=@"backup.zip" -F caption="📦 Backup Digital Tendo Store (SQLite)" https://api.telegram.org/bot${cfg.teleToken}/sendDocument`);
    });
}

// Sinkronisasi Katalog Digiflazz
async function tarikDataLayananOtomatis() {
    try {
        let config = db.getRecord('config', 'main') || {};
        let namaPengguna = (config.digiflazzUsername || '').trim();
        let kunciAkses = (config.digiflazzApiKey || '').trim();
        if (!namaPengguna || !kunciAkses) return;

        let tandaPengenal = crypto.createHash('md5').update(namaPengguna + kunciAkses + 'pricelist').digest('hex');
        
        const balasanPrepaid = await axios.post('https://api.digiflazz.com/v1/price-list', { cmd: 'prepaid', username: namaPengguna, sign: tandaPengenal });
        const balasanPasca = await axios.post('https://api.digiflazz.com/v1/price-list', { cmd: 'pasca', username: namaPengguna, sign: tandaPengenal });

        let dataPrepaid = balasanPrepaid.data.data || [];
        let dataPasca = balasanPasca.data.data || [];

        if (!Array.isArray(dataPrepaid)) dataPrepaid = [];
        if (!Array.isArray(dataPasca)) dataPasca = [];

        if (dataPrepaid.length === 0 && dataPasca.length === 0) return;

        dataPrepaid = dataPrepaid.map(item => ({ ...item, is_pasca_api: false }));
        dataPasca = dataPasca.map(item => ({ ...item, is_pasca_api: true }));

        let daftarPusat = dataPrepaid.concat(dataPasca);
        let produkLama = db.getAllRecords('produk');
        let daftarLokal = {};
        let m = config.margin || { t1:50, t2:100, t3:250, t4:500, t5:1000, t6:1500, t7:2000, t8:2500, t9:3000, t10:4000, t11:5000, t12:7500, t13:10000 };
        
        Object.keys(produkLama).forEach(k => {
            if (produkLama[k].is_manual_cat) daftarLokal[k] = produkLama[k];
        });
        
        daftarPusat.forEach(item => {
            let kodeBarang = item.buyer_sku_code;
            let namaBarang = item.product_name;
            let hargaModal = item.price || item.admin || 0;
            let statusProduk = (item.buyer_product_status === true && item.seller_product_status === true);
            let catDigi = (item.category || '').trim();
            let catLower = catDigi.toLowerCase();
            let brandLower = (item.brand || '').toLowerCase();
            let kategoriBarang = 'Lainnya';
            
            if (item.is_pasca_api) {
                let combinedSearch = (catLower + ' ' + brandLower);
                if (combinedSearch.includes('pln')) kategoriBarang = 'PLN Pasca';
                else if (combinedSearch.includes('pdam')) kategoriBarang = 'PDAM';
                else if (combinedSearch.includes('bpjs')) kategoriBarang = 'BPJS';
                else if (combinedSearch.includes('gas')) kategoriBarang = 'Gas Negara';
                else if (combinedSearch.includes('internet') || combinedSearch.includes('tv') || combinedSearch.includes('wifi')) kategoriBarang = 'Internet & TV';
                else if (combinedSearch.includes('e-money') || combinedSearch.includes('finance') || combinedSearch.includes('tagihan') || combinedSearch.includes('multifinance')) kategoriBarang = 'E-Money Pasca';
                else kategoriBarang = catDigi || 'Pascabayar Lainnya';
            } else {
                if (catLower === 'pulsa') kategoriBarang = 'Pulsa';
                else if (catLower === 'data') kategoriBarang = 'Data';
                else if (catLower === 'e-money') kategoriBarang = 'E-Money';
                else if (catLower === 'games') kategoriBarang = 'Game';
                else if (catLower === 'pln') kategoriBarang = 'PLN';
                else if (catLower === 'voucher') kategoriBarang = 'Voucher';
                else if (catLower === 'paket sms & telpon' || catLower === 'paket sms & nelepon') kategoriBarang = 'Paket SMS & Telpon';
                else if (catLower === 'masa aktif') kategoriBarang = 'Masa Aktif';
                else if (catLower === 'aktivasi perdana' || catLower === 'perdana') kategoriBarang = 'Aktivasi Perdana';
                else kategoriBarang = catDigi || 'Lainnya';
            }
            
            let keuntungan = 0;
            if(hargaModal <= 100) keuntungan = m.t1;
            else if(hargaModal <= 500) keuntungan = m.t2;
            else if(hargaModal <= 1000) keuntungan = m.t3;
            else if(hargaModal <= 2000) keuntungan = m.t4;
            else if(hargaModal <= 3000) keuntungan = m.t5;
            else if(hargaModal <= 4000) keuntungan = m.t6;
            else if(hargaModal <= 5000) keuntungan = m.t7;
            else if(hargaModal <= 10000) keuntungan = m.t8;
            else if(hargaModal <= 25000) keuntungan = m.t9;
            else if(hargaModal <= 50000) keuntungan = m.t10;
            else if(hargaModal <= 75000) keuntungan = m.t11;
            else if(hargaModal <= 100000) keuntungan = m.t12;
            else keuntungan = m.t13;

            let finalPrice = hargaModal + keuntungan;

            for (let k in daftarLokal) {
                if (daftarLokal[k].is_manual_cat && String(daftarLokal[k].sku_asli).toUpperCase() === String(kodeBarang).toUpperCase()) {
                    daftarLokal[k].harga = finalPrice;
                }
            }

            if (!produkLama[kodeBarang] || !produkLama[kodeBarang].is_manual_cat) {
                daftarLokal[kodeBarang] = {
                    sku_asli: kodeBarang, nama: namaBarang, harga: finalPrice, kategori: kategoriBarang,
                    brand: item.brand || 'Lainnya', sub_kategori: item.type || 'Umum', deskripsi: item.desc || 'Proses Otomatis',
                    status_produk: statusProduk, is_manual_cat: false
                };
            }
        });

        db.dbSqlite.prepare("DELETE FROM produk").run();
        for (let k in daftarLokal) db.saveRecord('produk', k, daftarLokal[k]);

    } catch(err) {}
}

function initCrons() {
    setInterval(cleanupOldHistory, 6 * 60 * 60 * 1000); 
    setInterval(tarikDataLayananOtomatis, 30 * 60 * 1000);
    setTimeout(tarikDataLayananOtomatis, 10000);

    let cfgBackupCheck = db.getRecord('config', 'main') || {};
    if (cfgBackupCheck.autoBackup) {
        setInterval(doBackupAndSend, (cfgBackupCheck.backupInterval || 720) * 60 * 1000); 
    }

    // Polling Pengecekan Mutasi GoPay (Setiap 30 detik)
    let isCheckingQris = false;
    setInterval(async () => {
        if (isCheckingQris) return;
        isCheckingQris = true;
        try {
            let cfg = db.getRecord('config', 'main') || {};
            let topups = db.getAllRecords('topup');
            let pendingKeys = Object.keys(topups).filter(k => topups[k].status === 'pending');
            
            if (pendingKeys.length === 0 || !cfg.gopayToken || !cfg.gopayMerchantId) {
                isCheckingQris = false;
                return;
            }

            let apiUrl = `http://gopay.bhm.biz.id/api/transactions`;
            const gopayRes = await axios.get(apiUrl, { headers: { 'Authorization': 'Bearer ' + cfg.gopayToken } });

            for (let key of pendingKeys) {
                let req = topups[key];

                if (Date.now() > req.expired_at) {
                    req.status = 'gagal'; db.saveRecord('topup', key, req);
                    let u = db.getRecord('users', req.phone);
                    if (u) {
                        let hist = u.history.find(h => h.sn === req.trx_id);
                        if (hist && hist.status === 'Pending') { hist.status = 'Gagal (Kedaluwarsa)'; db.saveRecord('users', req.phone, u); }
                        appEvents.emit('send-tele-admin', `❌ <b>${req.is_order ? 'ORDER QRIS' : 'TOPUP'} KEDALUWARSA</b>\n\n📱 WA: ${req.phone}\n💰 Rp ${req.amount_to_pay.toLocaleString('id-ID')}\n🔖 Ref: ${req.trx_id}`);
                    }
                } 
                else {
                    let claimMutasiId = null;
                    let isFound = false;

                    if (gopayRes && gopayRes.data) {
                        let strData = JSON.stringify(gopayRes.data);
                        let search1 = `"${req.amount_to_pay}"`;      
                        let search2 = `:${req.amount_to_pay}`;       
                        let search3 = `"${req.amount_to_pay}.00"`;   
                        let search4 = `:${req.amount_to_pay}.00`;    

                        if (strData.includes(search1) || strData.includes(search2) || strData.includes(search3) || strData.includes(search4)) {
                            let mutIdFallback = "LOCKED_NOMINAL_" + req.amount_to_pay;
                            let isUsed = db.dbSqlite.prepare("SELECT id FROM used_mutations WHERE id = ?").get(mutIdFallback);
                            
                            if (!isUsed) {
                                isFound = true;
                                claimMutasiId = mutIdFallback;
                            }
                        }
                    }

                    if (isFound && claimMutasiId) {
                        db.dbSqlite.prepare("INSERT INTO used_mutations (id, timestamp) VALUES (?, ?)").run(claimMutasiId, Date.now());
                        req.status = 'sukses';
                        db.saveRecord('topup', key, req);
                        
                        let u = db.getRecord('users', req.phone);
                        if (u) {
                            if (!req.is_order) {
                                let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Sukses', sn: req.trx_id, amount: req.amount_to_pay, qris_url: '' };
                                db.atomicAddBalance(req.phone, req.saldo_to_add, histObj);
                                
                                u = db.getRecord('users', req.phone);
                                let emailUser = u.email || '-';
                                let namaUser = u.username || req.phone;
                                let teleMsg = `✅ <b>TOPUP QRIS SUKSES MASUK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${req.phone}\n💰 Saldo Masuk: Rp ${req.saldo_to_add.toLocaleString('id-ID')}\n🔖 Ref: ${req.trx_id}\n💳 Saldo Terkini: Rp ${u.saldo.toLocaleString('id-ID')}`;
                                appEvents.emit('send-tele-admin', teleMsg);
                            } else {
                                db.atomicAddBalance(req.phone, req.saldo_to_add, null);
                                if (req.vpn_data) {
                                    // Panggil event untuk proses auto-order VPN QRIS
                                    appEvents.emit('process-auto-vpn-qris', req.phone, req.vpn_data, req.trx_id);
                                } else {
                                    let nominalBeli = parseInt(req.harga_asli);
                                    try { db.atomicDeductBalance(req.phone, nominalBeli); } catch(err) { }
                                    // Panggil event untuk proses auto-order Reguler QRIS
                                    appEvents.emit('process-auto-order-qris', req.phone, req.sku, req.tujuan, req.nama_produk, req.harga_asli, req.trx_id);
                                }
                            }
                        }
                    }
                }
            }
        } catch(e) { }
        isCheckingQris = false;
    }, 30000);
}

module.exports = { initCrons };
# === SELESAI ===
