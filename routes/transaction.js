const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { normalizePhone, sanitizeInput, maskStringTarget, cekPemeliharaan } = require('../utils/helpers');
const { convertToDynamicQris } = require('./topup'); // Menggunakan helper QRIS dari route topup
const appEvents = require('../utils/events');

const router = express.Router();

router.post('/order-qris', verifyToken, async (req, res) => {
    try {
        if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
        
        let config = db.getRecord('config', 'main') || {};
        if (!config.gopayToken || (!config.qrisUrl && !config.qrisText)) return res.json({ success: false, message: "Sistem QRIS belum diatur Admin." });
        
        let { phone, sku, tujuan } = req.body; 
        let pNorm = normalizePhone(phone);
        let uNorm = db.getRecord('users', pNorm);
        let uOri = db.getRecord('users', phone);
        let targetKey = uNorm ? pNorm : (uOri ? phone : null);
        
        if (!targetKey) return res.json({ success: false, message: 'Sesi Anda tidak valid.' });
        let u = uNorm || uOri;
        
        let p = db.getRecord('produk', sku);
        if (!p) return res.json({ success: false, message: 'Produk tidak ditemukan.' });
        
        let nominalAsli = parseInt(p.harga);
        
        // MENCEGAH COLLISION QRIS
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

        let trxId = "OQ-" + Date.now();
        let expiredAt = Date.now() + 10 * 60 * 1000;

        db.saveRecord('topup', trxId, { 
            phone: targetKey, trx_id: trxId, amount_to_pay: totalPay, saldo_to_add: totalPay, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, 
            is_order: true, sku: sku, tujuan: sanitizeInput(tujuan), nama_produk: p.nama, harga_asli: nominalAsli 
        });

        u.history = u.history || [];
        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 
            type: 'Order QRIS', nama: p.nama + ' (QRIS)', tujuan: sanitizeInput(tujuan), status: 'Pending', sn: trxId, amount: totalPay, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if (u.history.length > 50) u.history.pop();
        db.saveRecord('users', targetKey, u);

        res.json({ success: true });
        
        let emailUser = u.email || '-';
        let namaUser = u.username || targetKey;
        let teleMsg = `🛒 <b>ORDER QRIS PENDING</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n💰 Nominal: Rp ${totalPay.toLocaleString('id-ID')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS Auto\n💳 Saldo Saat Ini: Rp ${u.saldo.toLocaleString('id-ID')}`;
        
        appEvents.emit('send-tele-admin', teleMsg);
    } catch(e) { res.json({ success: false, message: "Gagal memproses QRIS." }); }
});

router.post('/order', verifyToken, async (req, res) => {
    let targetKey = ""; let hargaFix = 0; let refId = 'WEB-' + Date.now();
    try {
        if (cekPemeliharaan()) return res.json({ success: false, message: 'Sistem sedang pemeliharaan.' });
        
        let { phone, sku, tujuan } = req.body; 
        let pNorm = normalizePhone(phone);
        let uNorm = db.getRecord('users', pNorm);
        let uOri = db.getRecord('users', phone);
        
        targetKey = uNorm ? pNorm : (uOri ? phone : null);
        if (!targetKey) return res.json({ success: false, message: 'Sesi Anda tidak valid. Silakan Logout dan Login kembali.' });
        
        let p = db.getRecord('produk', sku);
        if (!p) return res.json({ success: false, message: 'Produk tidak ditemukan.' });
        
        let config = db.getRecord('config', 'main') || {};
        let realSku = p.sku_asli || sku;
        hargaFix = parseInt(p.harga);
        
        let username = (config.digiflazzUsername || '').trim();
        let apiKey = (config.digiflazzApiKey || '').trim();
        let isPasca = p.kategori === 'PLN Pasca' || p.kategori === 'PDAM' || p.kategori === 'BPJS' || p.kategori === 'Gas Negara' || p.kategori === 'Internet & TV' || p.kategori === 'E-Money Pasca' || p.is_pasca_api === true;

        if (isPasca) {
            // ALUR PASCABAYAR
            let sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');
            let inqRes;
            try {
                inqRes = await axios.post('https://api.digiflazz.com/v1/transaction', {
                    commands: "inq-pasca", username: username, buyer_sku_code: realSku, customer_no: sanitizeInput(tujuan), ref_id: refId, sign: sign
                });
            } catch(err) {
                return res.json({ success: false, message: err.response?.data?.data?.message || err.message || "Inquiry gagal." });
            }

            if (inqRes.data?.data?.status === 'Gagal') {
                return res.json({ success: false, message: inqRes.data.data.message || "Inquiry gagal." });
            }

            let tagihan = inqRes.data?.data?.selling_price || hargaFix; 
            let atomicRes;
            try {
                atomicRes = db.atomicDeductBalance(targetKey, tagihan);
            } catch (err) {
                return res.json({ success: false, message: err.message });
            }

            let u = atomicRes.uData;
            let saldoSebelum = atomicRes.saldoTerkini + tagihan;

            u.trx_count = (u.trx_count || 0) + 1;
            u.history = u.history || [];
            u.history.unshift({ 
                ts: Date.now(), 
                tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 
                type: 'Order', nama: p.nama, tujuan: tujuan, status: 'Pending', sn: '-', amount: tagihan, ref_id: refId,
                saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo
            });
            if (u.history.length > 50) u.history.pop();
            db.saveRecord('users', targetKey, u);

            let targetJid = u.jid || targetKey + '@s.whatsapp.net';
            db.saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: tagihan, nama: p.nama, tanggal: Date.now(), phone: targetKey });

            try {
                let payRes = await axios.post('https://api.digiflazz.com/v1/transaction', {
                    commands: "pay-pasca", username: username, buyer_sku_code: realSku, customer_no: sanitizeInput(tujuan), ref_id: refId, sign: sign
                });
                let statusOrder = payRes.data?.data?.status;
                let snOrder = payRes.data?.data?.sn || '-';

                let emailUser = u.email || '-';
                let namaUser = u.username || targetKey;

                if (statusOrder === 'Gagal') {
                    let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Refund', nama: 'Refund: ' + p.nama, tujuan: tujuan, status: 'Refund', sn: '-', amount: tagihan, ref_id: refId };
                    u = db.atomicRefundBalance(targetKey, tagihan, histObj);
                    u.history = u.history.filter(h => !(h.ref_id === refId && h.status === 'Pending'));
                    db.saveRecord('users', targetKey, u);
                    db.deleteRecord('trx', refId);
                    
                    let teleMsgFail = `❌ <b>PESANAN PASCABAYAR GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Alasan: ${payRes.data.data.message}\n💰 Nominal: Rp ${tagihan.toLocaleString('id-ID')}\n💳 Metode: Saldo Akun\n💰 Saldo Kembali: Rp ${u.saldo.toLocaleString('id-ID')}`;
                    appEvents.emit('send-tele-admin', teleMsgFail);
                    
                    return res.json({ success: false, message: payRes.data.data.message });
                } else {
                    u = db.getRecord('users', targetKey);
                    let idxHist = u.history.findIndex(h => h.ref_id === refId && h.type === 'Order');
                    if (idxHist !== -1) {
                        u.history[idxHist].status = statusOrder;
                        u.history[idxHist].sn = snOrder;
                        db.saveRecord('users', targetKey, u);
                    }
                    
                    if (statusOrder === 'Sukses') {
                        let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                        let gStats = db.getRecord('global_stats', dateKey) || 0;
                        db.saveRecord('global_stats', dateKey, gStats + 1);

                        let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                        db.unshiftRecordArray('global_trx', { time: timeStr, product: p.nama, user: namaUser, target: maskStringTarget(tujuan), price: tagihan, method: 'Saldo Akun' });
                        appEvents.emit('broadcast-success', p.nama, namaUser, tujuan, tagihan, 'Saldo Akun');
                    }
                    
                    let teleMsg = `🔔 <b>PESANAN PASCABAYAR MASUK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status: <b>${statusOrder}</b>\n💰 Tagihan: Rp ${tagihan.toLocaleString('id-ID')}\n💳 Metode: Saldo Akun\n💳 Saldo Sisa: Rp ${u.saldo.toLocaleString('id-ID')}`;
                    appEvents.emit('send-tele-admin', teleMsg);
                    
                    return res.json({ success: true, saldo: u.saldo });
                }
            } catch (error) {
                if (!res.headersSent) {
                    return res.json({ success: true, message: 'Request pembayaran sedang diproses oleh sistem...', saldo: u.saldo });
                }
            }
        } else {
            // ALUR PRABAYAR
            let atomicRes;
            try {
                atomicRes = db.atomicDeductBalance(targetKey, hargaFix);
            } catch (err) {
                return res.json({ success: false, message: err.message });
            }

            let u = atomicRes.uData;
            let saldoSebelum = atomicRes.saldoTerkini + hargaFix;

            u.trx_count = (u.trx_count || 0) + 1;
            u.history = u.history || [];
            u.history.unshift({ 
                ts: Date.now(), 
                tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 
                type: 'Order', nama: p.nama, tujuan: tujuan, status: 'Pending', sn: '-', amount: hargaFix, ref_id: refId,
                saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo
            });
            if (u.history.length > 50) u.history.pop();
            db.saveRecord('users', targetKey, u);
            
            let targetJid = u.jid || targetKey + '@s.whatsapp.net';
            db.saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: hargaFix, nama: p.nama, tanggal: Date.now(), phone: targetKey });

            let sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

            try {
                const response = await axios.post('https://api.digiflazz.com/v1/transaction', { 
                    username: username, buyer_sku_code: realSku, customer_no: sanitizeInput(tujuan), ref_id: refId, sign: sign, max_price: hargaFix
                });
                let statusOrder = response.data.data.status; 
                let snOrder = response.data.data.sn || '-';

                let emailUser = u.email || '-';
                let namaUser = u.username || targetKey;
                
                if (statusOrder === 'Gagal') {
                    let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), type: 'Refund', nama: 'Refund: ' + p.nama, tujuan: tujuan, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refId };
                    u = db.atomicRefundBalance(targetKey, hargaFix, histObj);
                    
                    u.history = u.history.filter(h => !(h.ref_id === refId && h.status === 'Pending'));
                    db.saveRecord('users', targetKey, u);
                    db.deleteRecord('trx', refId);
                    
                    let teleMsgFail = `❌ <b>PESANAN PRABAYAR GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Alasan: ${response.data.data.message}\n💰 Nominal: Rp ${hargaFix.toLocaleString('id-ID')}\n💳 Metode: Saldo Akun\n💰 Saldo Kembali: Rp ${u.saldo.toLocaleString('id-ID')}`;
                    appEvents.emit('send-tele-admin', teleMsgFail);
                    
                    return res.json({ success: false, message: response.data.data.message });
                } else {
                    u = db.getRecord('users', targetKey);
                    let idxHist = u.history.findIndex(h => h.ref_id === refId && h.type === 'Order');
                    if (idxHist !== -1) {
                        u.history[idxHist].status = statusOrder;
                        u.history[idxHist].sn = snOrder;
                        db.saveRecord('users', targetKey, u);
                    }
                }

                if (statusOrder === 'Sukses') {
                    let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                    let gStats = db.getRecord('global_stats', dateKey) || 0;
                    db.saveRecord('global_stats', dateKey, gStats + 1);

                    let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                    db.unshiftRecordArray('global_trx', { time: timeStr, product: p.nama, user: namaUser, target: maskStringTarget(tujuan), price: hargaFix, method: 'Saldo Akun' });

                    appEvents.emit('broadcast-success', p.nama, namaUser, tujuan, hargaFix, 'Saldo Akun');
                }

                res.json({ success: true, saldo: u.saldo });

                let teleMsg = `🔔 <b>PESANAN PRABAYAR BARU MASUK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status: <b>${statusOrder}</b>\n💰 Nominal: Rp ${hargaFix.toLocaleString('id-ID')}\n💳 Metode: Saldo Akun\n💳 Saldo Sisa: Rp ${u.saldo.toLocaleString('id-ID')}`;
                appEvents.emit('send-tele-admin', teleMsg);

            } catch (error) { 
                if (!res.headersSent) {
                    return res.json({ success: true, message: 'Request sedang diproses oleh sistem...', saldo: u.saldo });
                }
            }
        }
    } catch (e) {
        if (!res.headersSent) return res.json({ success: false, message: "Terjadi kesalahan internal." });
    }
});

module.exports = router;
# === SELESAI ===
                      
