const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const { maskStringTarget } = require('../utils/helpers');
const appEvents = require('../utils/events');

const router = express.Router();

router.post('/webhook', (req, res) => {
    try {
        let config = db.getRecord('config', 'main') || {};
        let secret = config.webhookSecret;
        if (!secret) return res.status(403).json({ success: false, message: 'Secret webhook belum diatur admin.' });

        let signature = req.headers['x-hub-signature'];
        if (!signature) return res.status(403).json({ success: false, message: 'No signature found' });

        // Verifikasi HMAC menggunakan rawBody
        let hmac = crypto.createHmac('sha1', secret).update(req.rawBody).digest('hex');
        let expectedSignature = 'sha1=' + hmac;

        if (signature !== expectedSignature) {
            return res.status(403).json({ success: false, message: 'Invalid signature' });
        }

        let data = req.body.data;
        if (!data) return res.status(400).send('Payload invalid');

        let refId = data.ref_id;
        let statusOrder = data.status;
        let sn = data.sn || '-';
        let message = data.message || '';

        if (statusOrder === 'Pending') {
            return res.status(200).send('OK');
        }

        let trx = db.getRecord('trx', refId);
        if (!trx) return res.status(200).send('OK - No Trx'); 

        let phoneKey = trx.phone || trx.jid.split('@')[0];
        let u = db.getRecord('users', phoneKey);
        if (!u) {
            db.deleteRecord('trx', refId);
            return res.status(200).send('OK');
        }

        let namaUser = u.username || phoneKey;
        let emailUser = u.email || '-';

        if (statusOrder === 'Sukses') {
            let wasNotSuccess = false;
            if (u.history) {
                let hist = u.history.find(h => h.ref_id === refId);
                if (hist && hist.status !== 'Sukses') { 
                    hist.status = 'Sukses'; 
                    hist.sn = sn; 
                    db.saveRecord('users', phoneKey, u); 
                    wasNotSuccess = true;
                }
            }
            
            if (wasNotSuccess) {
                let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                let gStats = db.getRecord('global_stats', dateKey) || 0;
                db.saveRecord('global_stats', dateKey, gStats + 1);
                
                let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                db.unshiftRecordArray('global_trx', { time: timeStr, product: trx.nama, user: namaUser, target: maskStringTarget(trx.tujuan), price: parseInt(trx.harga), method: 'Sistem Otomatis' });

                appEvents.emit('broadcast-success', trx.nama, namaUser, trx.tujuan, parseInt(trx.harga), 'Sistem Otomatis');

                let teleSuccess = `✅ <b>PESANAN SUKSES</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phoneKey}\n📦 Produk: ${trx.nama}\n🎯 Tujuan: ${trx.tujuan}\n🔖 Ref: ${refId}\n🔑 SN: ${sn}\n💳 Saldo Terkini: Rp ${u.saldo.toLocaleString('id-ID')}`;
                appEvents.emit('send-tele-admin', teleSuccess);
            }
            db.deleteRecord('trx', refId);

        } else if (statusOrder === 'Gagal') {
            let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Refund', nama: 'Refund: ' + trx.nama, tujuan: trx.tujuan, status: 'Refund', sn: '-', amount: parseInt(trx.harga), ref_id: refId };
            let uRefund = db.atomicRefundBalance(phoneKey, parseInt(trx.harga), histObj);
            
            appEvents.emit('send-wa-message', trx.jid, `❌ *PESANAN GAGAL & DI-REFUND*\n\nMaaf pesanan ${trx.nama} tujuan ${trx.tujuan} gagal diproses pusat.\nAlasan: ${message}\n\n💰 Saldo Rp ${parseInt(trx.harga).toLocaleString('id-ID')} telah dikembalikan utuh ke akun Anda.`);
            
            let teleFail = `❌ <b>PESANAN GAGAL & REFUND</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phoneKey}\n📦 Produk: ${trx.nama}\n🎯 Tujuan: ${trx.tujuan}\n🔖 Ref: ${refId}\n📝 Alasan: ${message}\n\n💰 Saldo telah otomatis dikembalikan.`;
            appEvents.emit('send-tele-admin', teleFail);
            
            db.deleteRecord('trx', refId);
        }

        res.status(200).send('OK');
    } catch (err) {
        res.status(500).send('Error webhook processing');
    }
});

module.exports = router;
# === SELESAI ===
