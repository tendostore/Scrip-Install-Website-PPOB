const axios = require('axios');
const db = require('../config/database');
const appEvents = require('../utils/events');
const { maskStringTarget } = require('../utils/helpers');

function sendTelegramAdmin(message) {
    try {
        let cfg = db.getRecord('config', 'main') || {};
        if (cfg.teleToken && cfg.teleChatId) {
            let chatIdStr = cfg.teleChatId.toString();
            axios.post(`https://api.telegram.org/bot${cfg.teleToken}/sendMessage`, {
                chat_id: chatIdStr,
                text: message,
                parse_mode: 'HTML'
            }).catch(e => {});
        }
    } catch(e) {}
}

function sendBroadcastSuccess(productName, rawUser, rawTarget, price, method) {
    try {
        let cfg = db.getRecord('config', 'main') || {};
        let maskTarget = maskStringTarget(rawTarget); 
        let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
        let priceStr = price ? `\n💰 Harga: Rp ${price.toLocaleString('id-ID')}` : '';
        let methodStr = method ? `\n💳 Metode: ${method}` : '';
        
        let msgTele = `✅ <b>PEMBELIAN BERHASIL</b>\n\n👤 Pelanggan: ${rawUser}\n📦 Layanan: ${productName}\n🎯 Tujuan: ${maskTarget}${priceStr}${methodStr}\n🕒 Waktu: ${timeStr} WIB\n\n<i>🌐 Transaksi diproses otomatis oleh sistem.</i>`;

        // Broadcast Telegram
        if (cfg.teleTokenInfo && cfg.teleChannelId) {
            let channelIdStr = cfg.teleChannelId.toString();
            if (!channelIdStr.startsWith('-100') && !channelIdStr.startsWith('@')) {
                channelIdStr = '-100' + channelIdStr;
            }
            axios.post(`https://api.telegram.org/bot${cfg.teleTokenInfo}/sendMessage`, {
                chat_id: channelIdStr,
                text: msgTele,
                parse_mode: 'HTML'
            }).catch(e => { console.error("Gagal kirim Telegram Channel:", e.message); });
        }

        // Broadcast WhatsApp
        if (cfg.waBroadcastId) {
            let msgWa = `✅ *PEMBELIAN BERHASIL*\n\n👤 Pelanggan: ${rawUser}\n📦 Layanan: ${productName}\n🎯 Tujuan: ${maskTarget}${priceStr}${methodStr}\n🕒 Waktu: ${timeStr} WIB\n\n_🌐 Transaksi diproses otomatis oleh sistem._`;
            appEvents.emit('send-wa-message', cfg.waBroadcastId, msgWa);
        }
    } catch(e) {}
}

// Daftarkan listener event
appEvents.on('send-tele-admin', sendTelegramAdmin);
appEvents.on('broadcast-success', sendBroadcastSuccess);

module.exports = {
    sendTelegramAdmin,
    sendBroadcastSuccess
};
# === SELESAI ===
