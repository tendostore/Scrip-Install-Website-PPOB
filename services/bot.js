const pino = require('pino');
const db = require('../config/database');
const appEvents = require('../utils/events');
const { cekPemeliharaan } = require('../utils/helpers');

let globalSock = null;
let isMaintenanceNow = cekPemeliharaan();

// Listener untuk mengirim pesan WA dari file/route lain
appEvents.on('send-wa-message', (jid, text) => {
    if (globalSock) {
        globalSock.sendMessage(jid, { text: text }).catch(err => console.error("Gagal kirim WA:", err.message));
    }
});

// Listener untuk OTP
appEvents.on('send-otp', (phone, text) => {
    setTimeout(() => {
        if (globalSock) {
            globalSock.sendMessage(phone + '@s.whatsapp.net', { text: text }).catch(e => {});
        }
    }, 100);
});

async function startBot() {
    // Dynamic import untuk Baileys sesuai format script asli
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default.default || baileys.default;
    const { useMultiFileAuthState, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState('sesi_bot');
    let config = db.getRecord('config', 'main') || {};
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser: Browsers.ubuntu('Chrome'), 
        printQRInTerminal: false, 
        syncFullHistory: false 
    });
    
    globalSock = sock; 

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                if (!config.botNumber) {
                    console.log('\x1b[31m⚠️ Nomor Bot belum diatur! Bot WA belum bisa terhubung.\x1b[0m');
                    return;
                }
                let formattedNumber = config.botNumber.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(formattedNumber);
                console.log(`\n\x1b[36m==================================================\x1b[0m`);
                console.log(`\x1b[32m📱 NOMOR BOT WA  : \x1b[33m+${formattedNumber}\x1b[0m`);
                console.log(`\x1b[32m🔑 KODE PAIRING  : \x1b[1m\x1b[37m${code}\x1b[0m`);
                console.log(`\x1b[36m==================================================\x1b[0m`);
            } catch (error) {}
        }, 8000); 
    }
    
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { 
        if(u.connection === 'close') setTimeout(startBot, 4000); 
    });

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0]; 
            if (!msg.message || msg.key.fromMe) return;
            
            const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            const sender = senderJid.split('@')[0]; 
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (!body) return;

            // Registrasi diam-diam saat user chat bot (sesuai logika asli)
            let u = db.getRecord('users', sender);
            if (!u) { 
                u = { 
                    saldo: 0, 
                    tanggal_daftar: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), 
                    jid: senderJid, 
                    step: 'idle', 
                    trx_count: 0, 
                    history: []
                }; 
                db.saveRecord('users', sender, u); 
            }
        } catch (err) {}
    });

    // Cek Pemeliharaan Otomatis & Broadcast
    setInterval(() => {
        let currentlyMaintenance = cekPemeliharaan();
        let cfg = db.getRecord('config', 'main') || {};
        let sTime = cfg.maintStart || '23:00';
        let eTime = cfg.maintEnd || '00:30';

        if (currentlyMaintenance && !isMaintenanceNow) {
            isMaintenanceNow = true;
            let msg = `🛠️ *INFO PEMELIHARAAN SISTEM*\n\nSaat ini sistem sedang memasuki jam pemeliharaan rutin (${sTime} - ${eTime} WIB). Transaksi sementara ditutup.`;
            if (globalSock && cfg.waBroadcastId) globalSock.sendMessage(cfg.waBroadcastId, { text: msg }).catch(e=>{});
        } else if (!currentlyMaintenance && isMaintenanceNow) {
            isMaintenanceNow = false;
            let msg = "✅ *PEMELIHARAAN SELESAI*\n\nSistem telah beroperasi normal kembali. Silakan lakukan transaksi seperti biasa. Terima kasih atas pengertiannya.";
            if (globalSock && cfg.waBroadcastId) globalSock.sendMessage(cfg.waBroadcastId, { text: msg }).catch(e=>{});
        }
    }, 60000);
}

module.exports = { startBot };
# === SELESAI ===
