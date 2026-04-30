const express = require('express');
const axios = require('axios');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { normalizePhone, sanitizeInput, maskStringTarget, cekPemeliharaan } = require('../utils/helpers');
const { convertToDynamicQris } = require('./topup');
const appEvents = require('../utils/events');

const router = express.Router();

// ==============================================================
// CORE LOGIC: EKSEKUSI PEMBUATAN AKUN VPN KE SERVER VPS 
// ==============================================================
async function executeVpnOrder(phone, protocol, productId, mode, vpnUsername, vpnPassword, expiredDays, refIdAsal = null, paymentMethod = 'Saldo Akun') {
    let targetKey = normalizePhone(phone);
    let u = db.getRecord('users', targetKey) || db.getRecord('users', phone);
    if (!u) return { success: false, message: "Sesi tidak valid." };

    let vpnConfig = db.getRecord('vpn_config', 'main') || { products: {}, servers: {} };
    let prod = vpnConfig.products[productId];
    if (!prod) return { success: false, message: "Produk VPN tidak ditemukan atau telah dihapus." };
    if (mode === 'reguler' && parseInt(prod.stok) <= 0) return { success: false, message: "Stok untuk produk ini sedang habis." };

    let serverKey = prod.server_id;
    let srv = vpnConfig.servers[serverKey];
    if (!srv || !srv.host || !srv.api_key) {
        return { success: false, message: "Server VPN ini sedang gangguan / konfigurasi tidak valid." };
    }

    if (mode === 'trial') {
        if (!u.trial_claims) u.trial_claims = {};
        let lastClaim = u.trial_claims[productId] || 0;
        if (Date.now() - lastClaim < 2 * 60 * 60 * 1000) { 
            return { success: false, message: "⚠️ Gagal: Anda sudah melakukan trial di Produk ini. Silakan coba 2 Jam lagi." };
        }
    }

    let hargaFix = 0;
    let saldoSebelum = parseInt(u.saldo);
    if (mode === 'reguler') {
        let basePrice = parseInt(prod.price) || 0;
        let hari = parseInt(expiredDays) || 30;
        if (hari > 30) hari = 30;
        if (hari < 1) hari = 1;
        hargaFix = Math.ceil((basePrice / 30) * hari);
        
        if (paymentMethod === 'Saldo Akun') {
            try {
                let atomicRes = db.atomicDeductBalance(targetKey, hargaFix);
                u = atomicRes.uData;
            } catch (err) {
                return { success: false, message: err.message };
            }
        }
    }

    let protoLower = protocol.toLowerCase();
    let endpoint = '';
    let vpnLimitIp = parseInt(prod.limit_ip) || 2;
    let vpnKuota = parseInt(prod.kuota) || 200;
    let payload = {};
    let cleanHost = srv.host.replace(/^https?:\/\//i, '');

    if (mode === 'trial') {
        payload = { timelimit: "30m", kuota: 2, limitip: 2 };
        if (protoLower === 'ssh') endpoint = `http://${cleanHost}/vps/trialsshvpn`;
        else endpoint = `http://${cleanHost}/vps/trial${protoLower}all`;
    } else {
        payload = { username: sanitizeInput(vpnUsername), expired: parseInt(expiredDays) || 30, limitip: vpnLimitIp, kuota: vpnKuota };
        if (protoLower === 'ssh' || protoLower === 'zivpn') payload.password = sanitizeInput(vpnPassword);
        else payload.uuidv2 = '';
        
        if (protoLower === 'ssh') endpoint = `http://${cleanHost}/vps/sshvpn`;
        else endpoint = `http://${cleanHost}/vps/${protoLower}all`; 
    }

    try {
        let resApi = await axios.post(endpoint, payload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + srv.api_key },
            timeout: 120000,
            validateStatus: () => true, 
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        // Re-fetch user in case it changed
        u = db.getRecord('users', targetKey) || db.getRecord('users', phone);
        if (!u.trial_claims) u.trial_claims = {};

        let isSuccessResponse = (resApi.status >= 200 && resApi.status < 300) && resApi.data && !resApi.data.error && resApi.data.status !== false;
        let isErrorResponse = resApi.data && (resApi.data.status === false || resApi.data.error || resApi.status >= 400);

        if (isSuccessResponse && !isErrorResponse) {
            let apiData = resApi.data.data || resApi.data || {};
            let domain = srv.host;
            let expDate = apiData.expired || apiData.exp || apiData.to || (mode === 'trial' ? '30 Menit' : `${parseInt(expiredDays) || 30} Hari`);
            let vpnDetails = '';
            
            let fixCity = srv.city || apiData.city || '-';
            let fixIsp = srv.isp || apiData.isp || '-';
            let vpnUser = apiData.username || vpnUsername || "TrialUser";

            // Formatting detail akun VPN
            if (protoLower === 'ssh') {
                vpnDetails = `Account Created Successfully\n————————————————————————————————————\nDomain Host     : ${domain}\nCity            : ${fixCity}\nISP             : ${fixIsp}\nUsername        : ${vpnUser}\nPassword        : ${apiData.password || vpnPassword || '1'}\n————————————————————————————————————\nExpired         : ${expDate}\n————————————————————————————————————\nTLS             : ${apiData.port?.tls || '443,8443'}\nNone TLS        : ${apiData.port?.none || '80,8080'}\nAny             : 2082,2083,8880\nOpenSSH         : 444\nDropbear        : 90\n————————————————————————————————————`;
            } else if (protoLower === 'vmess') {
                vpnDetails = `————————————————————————————————————\n               VMESS\n————————————————————————————————————\nRemarks        : ${vpnUser}\nDomain Host    : ${domain}\nCity           : ${fixCity}\nISP            : ${fixIsp}\nPort TLS       : 443,8443\nPort none TLS  : 80,8080\nExpired On     : ${expDate}\n————————————————————————————————————\n           VMESS WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————`;
            } else if (protoLower === 'vless') {
                vpnDetails = `————————————————————————————————————\n               VLESS\n————————————————————————————————————\nRemarks        : ${vpnUser}\nDomain Host    : ${domain}\nCity           : ${fixCity}\nISP            : ${fixIsp}\nPort TLS       : 443,8443\nPort none TLS  : 80,8080\nExpired On     : ${expDate}\n————————————————————————————————————\n            VLESS WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————`;
            } else if (protoLower === 'trojan') {
                vpnDetails = `————————————————————————————————————\n               TROJAN\n————————————————————————————————————\nRemarks      : ${vpnUser}\nDomain Host  : ${domain}\nCity         : ${fixCity}\nISP          : ${fixIsp}\nPort         : 443,8443\nExpired On   : ${expDate}\n————————————————————————————————————\n           TROJAN WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————`;
            } else {
                vpnDetails = `Detail Akun ZIVPN:\nDomain Host: ${domain}\nCity: ${fixCity}\nISP: ${fixIsp}\nUsername: ${vpnUser}\nExp: ${expDate}\nLimit IP: ${vpnLimitIp}\n\nInfo selengkapnya cek di aplikasi.`;
            }

            let prodName = prod.name;
            if (mode === 'trial') prodName += ' (TRIAL)';
            
            if (mode === 'reguler') {
                u.trx_count = (u.trx_count || 0) + 1;
                vpnConfig = db.getRecord('vpn_config', 'main');
                vpnConfig.products[productId].stok -= 1;
                db.saveRecord('vpn_config', 'main', vpnConfig);
            } else if (mode === 'trial') {
                u.trial_claims[productId] = Date.now();
            }
            
            let refId = refIdAsal || ("VPN-" + Date.now());
            
            if (refIdAsal) {
                let existingHist = u.history.find(h => h.sn === refIdAsal);
                if (existingHist) {
                    existingHist.status = 'Sukses';
                    existingHist.vpn_details = vpnDetails;
                    existingHist.nama = prodName;
                    existingHist.type = 'Order VPN';
                    existingHist.saldo_sebelumnya = saldoSebelum;
                    existingHist.saldo_sesudah = u.saldo;
                }
            } else {
                u.history.unshift({
                    ts: Date.now(), 
                    tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 
                    type: 'Order VPN', nama: prodName, tujuan: (mode === 'trial' ? 'Sistem' : vpnUser), status: 'Sukses', sn: '-', amount: hargaFix, ref_id: refId,
                    saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo,
                    vpn_details: vpnDetails
                });
                if (u.history.length > 50) u.history.pop();
            }
            db.saveRecord('users', targetKey, u);

            let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
            let gStats = db.getRecord('global_stats', dateKey) || 0;
            db.saveRecord('global_stats', dateKey, gStats + 1);

            let namaUser = u.username || targetKey;

            if (mode !== 'trial') {
                let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                db.unshiftRecordArray('global_trx', { time: timeStr, product: prodName, user: namaUser, target: maskStringTarget(vpnUser), price: hargaFix, method: paymentMethod });
                appEvents.emit('broadcast-success', prodName, namaUser, vpnUser, hargaFix, paymentMethod);
            }

            let emailUser = u.email || '-';
            let vpnConfNew = db.getRecord('vpn_config', 'main');
            let teleSuccess = `🚀 <b>ORDER VPN PREMIUM SUKSES</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${prodName}\n🎯 Username VPN: ${vpnUser}\n💰 Nominal: Rp ${hargaFix.toLocaleString('id-ID')}\n💳 Metode: ${mode === 'trial' ? 'Gratis (Trial)' : paymentMethod}\n📦 Sisa Stok: ${mode === 'reguler' ? vpnConfNew.products[productId].stok : 'Trial'}\n💳 Saldo Terkini: Rp ${u.saldo.toLocaleString('id-ID')}`;
            appEvents.emit('send-tele-admin', teleSuccess);

            return { success: true };
        } else {
            if (mode === 'reguler' && paymentMethod === 'Saldo Akun') {
                let refHistObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Refund', nama: 'Refund: ' + prod.name, tujuan: vpnUsername, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal || 'VPN-' + Date.now() };
                db.atomicRefundBalance(targetKey, hargaFix, refHistObj);
            }

            let errMsg = "unknown error";
            if (resApi.data && resApi.data.message) errMsg = resApi.data.message;
            else if (resApi.data && resApi.data.error) errMsg = resApi.data.error;
            else if (resApi.statusText) errMsg = resApi.statusText;
            
            if (errMsg.toLowerCase().includes('exist') || errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('sudah ada')) {
                return { success: false, message: "Username sudah ada/terpakai, silakan ganti username lain." };
            }
            return { success: false, message: "Gagal membuat akun di Server VPN. Pesan: " + errMsg };
        }
    } catch(e) {
        if (mode === 'reguler' && paymentMethod === 'Saldo Akun') {
            let refHistObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Refund', nama: 'Refund: ' + prod.name, tujuan: vpnUsername, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal || 'VPN-' + Date.now() };
            db.atomicRefundBalance(targetKey, hargaFix, refHistObj);
        }
        return { success: false, message: "Koneksi ke Server VPN Gagal / Timeout. Pesan: " + e.message };
    }
}

router.post('/order-vpn', verifyToken, async (req, res) => {
    if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
    let { phone, protocol, product_id, mode, username, password, expired } = req.body;
    let result = await executeVpnOrder(phone, protocol, product_id, mode, sanitizeInput(username), sanitizeInput(password), expired, null, 'Saldo Akun');
    res.json(result);
});

router.post('/order-vpn-qris', verifyToken, async (req, res) => {
    try {
        if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
        
        let config = db.getRecord('config', 'main') || {};
        if (!config.gopayToken || (!config.qrisUrl && !config.qrisText)) return res.json({ success: false, message: "Sistem QRIS belum diatur Admin." });
        
        let { phone, protocol, product_id, mode, username, password, expired } = req.body;
        username = sanitizeInput(username); password = sanitizeInput(password);
        
        let pNorm = normalizePhone(phone);
        let uNorm = db.getRecord('users', pNorm);
        let uOri = db.getRecord('users', phone);
        let targetKey = uNorm ? pNorm : (uOri ? phone : null);
        if (!targetKey) return res.json({ success: false, message: 'Sesi Anda tidak valid.' });
        let u = uNorm || uOri;
        
        let vpnConfig = db.getRecord('vpn_config', 'main');
        let prod = vpnConfig.products[product_id];
        if (!prod) return res.json({ success: false, message: 'Produk VPN tidak ditemukan.' });
        if (mode === 'reguler' && parseInt(prod.stok) <= 0) return res.json({ success: false, message: 'Stok habis.' });

        let basePrice = parseInt(prod.price) || 0;
        let hari = parseInt(expired) || 30;
        if (hari > 30) hari = 30; if (hari < 1) hari = 1;
        let nominalAsli = Math.ceil((basePrice / 30) * hari);
        
        let uniqueCode = Math.floor(Math.random() * 999) + 1; 
        let totalPay = nominalAsli + uniqueCode;
        let allTopups = db.getAllRecords('topup');
        let attempts = 0;
        while (Object.values(allTopups).some(t => t.status === 'pending' && t.amount_to_pay === totalPay)) {
            uniqueCode = Math.floor(Math.random() * 999) + 1;
            totalPay = nominalAsli + uniqueCode;
            attempts++;
            if (attempts > 1000) break;
        }

        let finalQrisUrl = config.qrisUrl;
        if (config.qrisText) {
            let dynQris = convertToDynamicQris(config.qrisText, totalPay);
            finalQrisUrl = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=15&format=jpeg&data=" + encodeURIComponent(dynQris);
        }

        let trxId = "VQ-" + Date.now();
        let expiredAt = Date.now() + 10 * 60 * 1000;
        let prodName = prod.name;

        db.saveRecord('topup', trxId, { 
            phone: targetKey, trx_id: trxId, amount_to_pay: totalPay, saldo_to_add: totalPay, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, 
            is_order: true, vpn_data: { protocol, product_id, mode, username, password, expired, nama_produk: prodName, harga_asli: nominalAsli }
        });

        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 
            type: 'Order VPN QRIS', nama: prodName + ' (QRIS)', tujuan: username, status: 'Pending', sn: trxId, amount: totalPay, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if (u.history.length > 50) u.history.pop();
        db.saveRecord('users', targetKey, u);

        res.json({ success: true });
        
        let emailUser = u.email || '-';
        let namaUser = u.username || targetKey;
        let teleMsg = `🛒 <b>ORDER VPN QRIS PENDING</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${prodName}\n🎯 Username VPN: ${username}\n💰 Nominal: Rp ${totalPay.toLocaleString('id-ID')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS Auto\n💳 Saldo Terkini: Rp ${u.saldo.toLocaleString('id-ID')}`;
        
        appEvents.emit('send-tele-admin', teleMsg);
    } catch(e) { res.json({ success: false, message: "Gagal memproses QRIS VPN." }); }
});

router.post('/manual-vpn', verifyToken, async (req, res) => {
    try {
        let cfg = db.getRecord('config', 'main') || {};
        let adminWa = (cfg.botNumber || "").replace(/[^0-9]/g, '');
        if (req.authData.phone !== adminWa && req.authData.phone !== "6282224460678") {
            return res.json({ success: false, message: 'Akses Ditolak: Fitur Generator VPN Manual khusus Admin.' });
        }

        if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
        let { server_id, mode, type, username, password, expired } = req.body;

        let vpnConfig = db.getRecord('vpn_config', 'main');
        if (!vpnConfig || !vpnConfig.servers || !vpnConfig.servers[server_id]) {
            return res.json({ success: false, message: 'Server tidak ditemukan.' });
        }

        let srv = vpnConfig.servers[server_id];
        if (!srv || !srv.host || !srv.api_key) return res.json({ success: false, message: 'Konfigurasi server tidak valid.' });

        let limitip_all = 2;
        let kuota_reguler = 200;
        let kuota_trial = 2;
        let timelimit_trial = "30m";

        let endpoint_url = '';
        let payload = {};
        let cleanHost = srv.host.replace(/^https?:\/\//i, '');
        let protoLower = type.toLowerCase();

        if (mode === 'trial') {
            payload = { timelimit: timelimit_trial, kuota: kuota_trial, limitip: limitip_all };
            if (protoLower === 'ssh') endpoint_url = `http://${cleanHost}/vps/trialsshvpn`;
            else endpoint_url = `http://${cleanHost}/vps/trial${protoLower}all`;
        } else {
            payload = { username: sanitizeInput(username), expired: parseInt(expired) || 30, limitip: limitip_all, kuota: kuota_reguler };
            if (protoLower === 'ssh' || protoLower === 'zivpn') payload.password = sanitizeInput(password);
            else payload.uuidv2 = '';

            if (protoLower === 'ssh') endpoint_url = `http://${cleanHost}/vps/sshvpn`;
            else endpoint_url = `http://${cleanHost}/vps/${protoLower}all`;
        }

        const response = await axios.post(endpoint_url, payload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + srv.api_key },
            timeout: 120000,
            validateStatus: () => true,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        let isSuccessResponse = (response.status >= 200 && response.status < 300) && response.data && !response.data.error && response.data.status !== false;
        
        if (isSuccessResponse) {
            let apiData = response.data.data || response.data || {};
            res.json({ success: true, data: apiData, server: srv });
        } else {
            let errMsg = "Unknown error";
            if (response.data && response.data.message) errMsg = response.data.message;
            else if (response.data && response.data.error) errMsg = response.data.error;
            res.json({ success: false, message: errMsg });
        }
    } catch(e) {
        res.json({ success: false, message: e.message });
    }
});

module.exports = {
    router,
    executeVpnOrder
};
# === SELESAI ===
