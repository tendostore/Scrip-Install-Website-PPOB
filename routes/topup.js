const express = require('express');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { cekPemeliharaan } = require('../utils/helpers');
const appEvents = require('../utils/events');

const router = express.Router();

function convertToDynamicQris(staticQris, amount) {
    try {
        if (!staticQris || staticQris.length < 30) return staticQris;
        let qris = staticQris.substring(0, staticQris.length - 8);
        qris = qris.replace("010211", "010212");
        let parsed = ""; let i = 0;
        while (i < qris.length) {
            let id = qris.substring(i, i+2);
            let lenStr = qris.substring(i+2, i+4);
            let len = parseInt(lenStr, 10);
            if (isNaN(len)) break;
            let val = qris.substring(i+4, i+4+len);
            if (id !== "54") parsed += id + lenStr + val;
            i += 4 + len;
        }
        let amtStr = amount.toString();
        let amtLen = amtStr.length.toString().padStart(2, '0');
        let tag54 = "54" + amtLen + amtStr;
        let finalQris = "";
        if (parsed.includes("5802ID")) finalQris = parsed.replace("5802ID", tag54 + "5802ID");
        else finalQris = parsed + tag54;
        finalQris += "6304";
        
        let crc = 0xFFFF;
        for (let j=0; j<finalQris.length; j++){
            crc ^= finalQris.charCodeAt(j) << 8;
            for (let k=0; k<8; k++){
                if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
                else crc = crc << 1;
            }
        }
        let crcStr = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
        return finalQris + crcStr;
    } catch(e) { return staticQris; }
}

router.post('/topup', verifyToken, async (req, res) => {
    try {
        if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
        let config = db.getRecord('config', 'main') || {};
        if (!config.gopayToken || (!config.qrisUrl && !config.qrisText)) return res.json({ success: false, message: "Sistem QRIS belum diatur Admin." });
        
        let { phone, nominal } = req.body;
        let u = db.getRecord('users', phone);
        if (!u) return res.json({ success: false, message: "User tidak ditemukan." });
        
        let nominalAsli = parseInt(nominal);
        
        // MENCEGAH COLLISION KODE UNIK
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

        let trxId = "TP-" + Date.now();
        let expiredAt = Date.now() + 10 * 60 * 1000;

        db.saveRecord('topup', trxId, { 
            phone, trx_id: trxId, amount_to_pay: totalPay, saldo_to_add: totalPay, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, is_order: false 
        });

        u.history = u.history || [];
        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
            type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Pending', sn: trxId, amount: totalPay, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if (u.history.length > 50) u.history.pop();
        db.saveRecord('users', phone, u);

        res.json({ success: true });
        
        let emailUser = u.email || '-';
        let namaUser = u.username || phone;
        let teleMsg = `⏳ <b>TOPUP PENDING (QRIS)</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n💰 Nominal: Rp ${totalPay.toLocaleString('id-ID')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS Auto\n💳 Saldo Saat Ini: Rp ${u.saldo.toLocaleString('id-ID')}`;
        
        appEvents.emit('send-tele-admin', teleMsg);
    } catch(e) { res.json({ success: false, message: "Gagal memproses QRIS." }); }
});

router.post('/cancel-topup', verifyToken, (req, res) => {
    try {
        let { sn, phone } = req.body;
        let topup = db.getRecord('topup', sn);
        
        if (topup && topup.phone === phone) {
            topup.status = 'gagal';
            db.saveRecord('topup', sn, topup);
        }
        
        let u = db.getRecord('users', phone);
        if (u) {
            let hist = u.history.find(h => h.sn === sn);
            if (hist && hist.status === 'Pending') {
                hist.status = 'Gagal (Dibatalkan)';
                db.saveRecord('users', phone, u);
                return res.json({ success: true });
            }
        }
        res.json({ success: false, message: 'Topup tidak ditemukan atau sudah diproses.' });
    } catch(e) { res.json({ success: false, message: 'Server error' }); }
});

// Anda bisa mengekspor fungsi convertToDynamicQris jika dibutuhkan di file lain
module.exports = {
    router,
    convertToDynamicQris
};
# === SELESAI ===
  
