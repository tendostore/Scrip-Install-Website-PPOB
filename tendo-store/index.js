process.env.TZ = 'Asia/Jakarta';
const fs = require('fs');
const pino = require('pino');
const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const axios = require('axios'); 
const crypto = require('crypto'); 
const TelegramBot = require('node-telegram-bot-api');
const { pipeline } = require('stream/promises');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const app = express();
app.disable('x-powered-by');

// SECURITY: Memblokir akses langsung file konfigurasi JSON/DB lewat URL
app.use((req, res, next) => {
    if ((req.path.endsWith('.json') && !req.path.endsWith('manifest.json')) || req.path.endsWith('.db') || req.path.endsWith('.bak')) {
        return res.status(403).json({success: false, message: 'Akses Ditolak (Sistem Keamanan Tendo)'});
    }
    next();
});

// Modifikasi body-parser untuk mendapatkan rawBody demi validasi Webhook HMAC SHA1 & SHA256 (AutoGoPay)
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.static('public')); 

// ==============================================================
// INIT SQLITE DATABASE & OPTIMASI PRAGMA
// ==============================================================
const dbSqlite = new Database('tendo_database.db');

// Eksekusi PRAGMA untuk optimasi performa SQLite
dbSqlite.pragma('journal_mode = WAL');
dbSqlite.pragma('busy_timeout = 5000');
dbSqlite.pragma('synchronous = NORMAL');

dbSqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS produk (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS trx (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS topup (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS web_notif (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
    CREATE TABLE IF NOT EXISTS global_trx (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
    CREATE TABLE IF NOT EXISTS global_stats (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS tutorial (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS vpn_config (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS custom_layout (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE IF NOT EXISTS jwt_blacklist (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS used_mutations (id TEXT PRIMARY KEY, timestamp INTEGER);
    CREATE TABLE IF NOT EXISTS otp_sessions (id TEXT PRIMARY KEY, data TEXT);
`);

// ==============================================================
// SQLITE CRUD HELPERS & ATOMIC
// ==============================================================
function getRecord(table, id) {
    const row = dbSqlite.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.data) : null;
}

function saveRecord(table, id, data) {
    dbSqlite.prepare(`INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(data));
}

function deleteRecord(table, id) {
    dbSqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function getAllRecords(table) {
    const rows = dbSqlite.prepare(`SELECT id, data FROM ${table}`).all();
    let res = {};
    for(let r of rows) res[r.id] = JSON.parse(r.data);
    return res;
}

function getAllRecordsArray(table, limit = 100) {
    if(table === 'tutorial') {
        const rows = dbSqlite.prepare(`SELECT data FROM ${table}`).all();
        return rows.map(r => JSON.parse(r.data));
    }
    const rows = dbSqlite.prepare(`SELECT data FROM ${table} ORDER BY id DESC LIMIT ?`).all(limit);
    return rows.map(r => JSON.parse(r.data));
}

function unshiftRecordArray(table, data, maxLen = 100) {
    dbSqlite.prepare(`INSERT INTO ${table} (data) VALUES (?)`).run(JSON.stringify(data));
    dbSqlite.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY id DESC LIMIT ?)`).run(maxLen);
}

function normalizePhone(phoneStr) {
    if(!phoneStr) return '';
    let num = phoneStr.replace(/[^0-9]/g, '');
    if(num.startsWith('0')) return '62' + num.substring(1);
    return num;
}

function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper Atomic (Instruksi 6) untuk mencegah eksekusi ganda pada Topup/QRIS
function markTopupSuccess(id) {
    let info = dbSqlite.prepare("UPDATE topup SET data = json_set(data, '$.status', 'sukses') WHERE id = ? AND json_extract(data, '$.status') = 'pending'").run(id);
    return info.changes > 0;
}

// ==============================================================
// DYNAMIC SECRET KEY (JWT)
// ==============================================================
let cfgJwt = getRecord('config', 'main') || {};
if (!cfgJwt.jwt_secret) {
    cfgJwt.jwt_secret = crypto.randomBytes(64).toString('hex');
    saveRecord('config', 'main', cfgJwt);
    dbSqlite.pragma('wal_checkpoint(FULL)');
}
const SECRET_KEY = cfgJwt.jwt_secret;

// ==============================================================
// MIDDLEWARE JWT VERIFY
// ==============================================================
const verifyToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if(typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        const token = bearer[1];
        
        // Cek Blacklist Token
        const isBlacklisted = dbSqlite.prepare(`SELECT id FROM jwt_blacklist WHERE id = ?`).get(token);
        if (isBlacklisted) return res.status(403).json({success: false, message: 'Token telah di-logout (Blacklist). Silakan login ulang.'});

        jwt.verify(token, SECRET_KEY, (err, authData) => {
            if(err) return res.status(403).json({success: false, message: 'Token kedaluwarsa atau tidak valid. Silakan login ulang.'});
            
            // Validasi Nomor HP di req.body & req.params (Mencegah Bypass Sesi)
            if (req.body && req.body.phone) {
                if (normalizePhone(req.body.phone) !== authData.phone) {
                    return res.status(403).json({success: false, message: 'Akses Ditolak (Sesi Body tidak cocok).'});
                }
            }
            if (req.params && req.params.phone) {
                if (normalizePhone(req.params.phone) !== authData.phone) {
                    return res.status(403).json({success: false, message: 'Akses Ditolak (Sesi Parameter tidak cocok).'});
                }
            }
            
            req.authData = authData;
            req.token = token;
            next();
        });
    } else {
        res.status(403).json({success: false, message: 'Akses Ditolak. Token Otorisasi diperlukan.'});
    }
};

// ==============================================================
// SQLITE ATOMIC TRANSACTIONS (MENCEGAH RACE CONDITION)
// ==============================================================
const atomicDeductBalance = dbSqlite.transaction((phone, amount) => {
    const row = dbSqlite.prepare(`SELECT data FROM users WHERE id = ?`).get(phone);
    if (!row) throw new Error("User tidak valid.");
    
    let u = JSON.parse(row.data);
    let hargaFix = parseInt(amount) || 0; // BUG 24 FIX
    
    if (parseInt(u.saldo || 0) < hargaFix) {
        throw new Error("Saldo tidak cukup.");
    }
    
    u.saldo = parseInt(u.saldo || 0) - hargaFix;
    dbSqlite.prepare(`UPDATE users SET data = ? WHERE id = ?`).run(JSON.stringify(u), phone);
    
    return { saldoTerkini: u.saldo, uData: u };
});

const atomicRefundBalance = dbSqlite.transaction((phone, amount, historyObj = null) => {
    const row = dbSqlite.prepare(`SELECT data FROM users WHERE id = ?`).get(phone);
    if (!row) return null;
    
    let u = JSON.parse(row.data);
    let saldoSebelum = parseInt(u.saldo || 0);
    u.saldo = saldoSebelum + (parseInt(amount) || 0); // BUG 24 FIX
    
    if (historyObj) {
        historyObj.saldo_sebelumnya = saldoSebelum;
        historyObj.saldo_sesudah = u.saldo;
        u.history = u.history || [];
        u.history.unshift(historyObj);
        if (u.history.length > 50) u.history.pop();
    }
    
    dbSqlite.prepare(`UPDATE users SET data = ? WHERE id = ?`).run(JSON.stringify(u), phone);
    return u;
});

const atomicAddBalance = dbSqlite.transaction((phone, amount, historyObj = null) => {
    const row = dbSqlite.prepare(`SELECT data FROM users WHERE id = ?`).get(phone);
    if (!row) return null;
    
    let u = JSON.parse(row.data);
    let saldoSebelum = parseInt(u.saldo || 0);
    u.saldo = saldoSebelum + (parseInt(amount) || 0); // BUG 24 FIX
    
    if (historyObj) {
        historyObj.saldo_sebelumnya = saldoSebelum;
        historyObj.saldo_sesudah = u.saldo;
        
        u.history = u.history || [];
        
        let existingHist = u.history.find(h => h.sn === historyObj.sn && h.type === 'Topup');
        if (existingHist) {
            existingHist.status = historyObj.status;
            existingHist.saldo_sebelumnya = historyObj.saldo_sebelumnya;
            existingHist.saldo_sesudah = historyObj.saldo_sesudah;
        } else {
            u.history.unshift(historyObj);
            if (u.history.length > 50) u.history.pop();
        }
    }
    
    dbSqlite.prepare(`UPDATE users SET data = ? WHERE id = ?`).run(JSON.stringify(u), phone);
    return u;
});

const hashPassword = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

function maskStringTarget(str) {
    if (!str) return '-';
    let s = str.toString().trim();
    if (s.length <= 3) return s;
    return '*'.repeat(s.length - 3) + s.substring(s.length - 3);
}

function cekPemeliharaan() {
    let cfg = getRecord('config', 'main') || {};
    let s = cfg.maintStart || "23:00";
    let e = cfg.maintEnd || "00:30";
    let d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    let h = d.getHours(); let m = d.getMinutes();
    let curMins = h * 60 + m;
    let sParts = s.split(':'); let eParts = e.split(':');
    
    let sMins = parseInt(sParts[0], 10)*60 + parseInt(sParts[1], 10);
    let eMins = parseInt(eParts[0], 10)*60 + parseInt(eParts[1], 10);
    
    if(sMins < eMins) return (curMins >= sMins && curMins < eMins);
    else return (curMins >= sMins || curMins < eMins);
}

function cleanupOldHistory() {
    try {
        let now = Date.now();
        let thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        let updates = [];
        
        let stmt = dbSqlite.prepare('SELECT id, data FROM users');
        for (const row of stmt.iterate()) {
            let u = JSON.parse(row.data);
            if (u && u.history && u.history.length > 0) {
                let origLen = u.history.length;
                u.history = u.history.filter(h => (now - h.ts) < thirtyDaysMs);
                if (u.history.length !== origLen) {
                    updates.push({id: row.id, data: u});
                }
            }
        }
        
        if (updates.length > 0) {
            const updateStmt = dbSqlite.prepare('INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)');
            dbSqlite.transaction(() => {
                for (let up of updates) {
                    updateStmt.run(up.id, JSON.stringify(up.data));
                }
            })();
        }
        
        // Membersihkan blacklist JWT & OTP usang
        dbSqlite.prepare(`DELETE FROM jwt_blacklist`).run();
        
        const deleteExpiredOtp = dbSqlite.prepare(`SELECT id, data FROM otp_sessions`);
        dbSqlite.transaction(() => {
            for (const row of deleteExpiredOtp.iterate()) {
                let session = JSON.parse(row.data);
                if (now > session.expiresAt) {
                    dbSqlite.prepare(`DELETE FROM otp_sessions WHERE id = ?`).run(row.id);
                }
            }
        })();

        // Membersihkan mutasi usang (> 24 jam)
        dbSqlite.prepare(`DELETE FROM used_mutations WHERE timestamp < ?`).run(Date.now() - 86400000);

        let nowTime = Date.now();
        for (let key in loginAttempts) { if (nowTime - loginAttempts[key].time > 3600000) delete loginAttempts[key]; }
        for (let key in ipOtpLimit) { if (nowTime - ipOtpLimit[key].time > 600000) delete ipOtpLimit[key]; }

    } catch (e) {
        console.error("Error during cleanup:", e.message);
    }
}
setInterval(cleanupOldHistory, 6 * 60 * 60 * 1000); 

function sendTelegramAdmin(message) {
    try {
        let cfg = getRecord('config', 'main') || {};
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
        let cfg = getRecord('config', 'main') || {};
        let maskTarget = maskStringTarget(rawTarget); 
        let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
        let priceStr = price ? `\n💰 Harga: Rp ${(price ? price.toLocaleString('id-ID') : '0')}` : ''; // BUG 23 FIX
        let methodStr = method ? `\n💳 Metode: ${method}` : '';
        
        let msgTele = `✅ <b>PEMBELIAN BERHASIL</b>\n\n👤 Pelanggan: ${rawUser}\n📦 Layanan: ${productName}\n🎯 Tujuan: ${maskTarget}${priceStr}${methodStr}\n🕒 Waktu: ${timeStr} WIB\n\n<i>🌐 Transaksi diproses otomatis oleh sistem.</i>`;

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

        if (globalSock && cfg.waBroadcastId) {
            let msgWa = `✅ *PEMBELIAN BERHASIL*\n\n👤 Pelanggan: ${rawUser}\n📦 Layanan: ${productName}\n🎯 Tujuan: ${maskTarget}${priceStr}${methodStr}\n🕒 Waktu: ${timeStr} WIB\n\n_🌐 Transaksi diproses otomatis oleh sistem._`;
            globalSock.sendMessage(cfg.waBroadcastId, { text: msgWa }).catch(e => {});
        }
    } catch(e) {}
}

let configAwal = getRecord('config', 'main') || {};
configAwal.botName = configAwal.botName || "Digital Tendo Store";
configAwal.botNumber = configAwal.botNumber || "";
configAwal.gopayToken = configAwal.gopayToken || "";
configAwal.teleTokenInfo = configAwal.teleTokenInfo || ""; 
configAwal.margin = configAwal.margin || { t1:50, t2:100, t3:250, t4:500, t5:1000, t6:1500, t7:2000, t8:2500, t9:3000, t10:4000, t11:5000, t12:7500, t13:10000 };
saveRecord('config', 'main', configAwal);

let vpnAwal = getRecord('vpn_config', 'main') || {};
if(!vpnAwal.servers) vpnAwal.servers = {};
if(!vpnAwal.products) vpnAwal.products = {};
saveRecord('vpn_config', 'main', vpnAwal);

let customLayoutAwal = getRecord('custom_layout', 'main') || {};
if(!customLayoutAwal.sections) customLayoutAwal.sections = [];
saveRecord('custom_layout', 'main', customLayoutAwal);

if(!fs.existsSync('./public/maint_images')) fs.mkdirSync('./public/maint_images', { recursive: true });

let globalSock = null;
let otpCooldown = {}; 
let loginAttempts = {}; 
let ipOtpLimit = {};
let isMaintenanceNow = cekPemeliharaan();

let teleBotInfo = null;
let teleState = {}; 

if (configAwal.teleTokenInfo) {
    try {
        teleBotInfo = new TelegramBot(configAwal.teleTokenInfo, {polling: true});
        teleBotInfo.on('polling_error', () => {});
        teleBotInfo.on('error', () => {});
    } catch(e) {}
}

// BUG 1 FIX: Endpoint API Proxy Gambar
app.get('/api/proxy-image', async (req, res) => {
    try {
        let imgUrl = req.query.url;
        if(!imgUrl) return res.status(400).send('No URL');
        let response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Access-Control-Allow-Origin', '*');
        res.send(response.data);
    } catch(e) {
        res.status(500).send('Failed to fetch image');
    }
});

app.get('/api/banners', (req, res) => {
    let banners = [];
    try {
        for (let i = 1; i <= 5; i++) {
            let folderPath = `./public/baner${i}`;
            if (fs.existsSync(folderPath)) {
                let files = fs.readdirSync(folderPath);
                let imgFiles = files.filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
                if (imgFiles.length > 0) banners.push(`/baner${i}/${imgFiles[0]}`);
            }
        }
    } catch(e) {}
    res.json({ success: true, data: banners });
});

app.get('/api/stats', (req, res) => {
    try {
        let gStats = getAllRecords('global_stats');
        let cfg = getRecord('config', 'main') || {};
        let daily = 0, weekly = 0, monthly = 0, total = 0;
        
        let now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        let nowYear = now.getFullYear();
        let nowMonth = now.getMonth();
        let nowString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        
        let day = now.getDay() || 7; 
        let monday = new Date(now);
        monday.setDate(now.getDate() - day + 1);
        monday.setHours(0,0,0,0);

        for(let k in gStats) {
            let count = gStats[k];
            total += count;
            let recordDate = new Date(k + 'T00:00:00+07:00');
            if(k === nowString) daily += count;
            if(recordDate >= monday) weekly += count;
            if(recordDate.getFullYear() === nowYear && recordDate.getMonth() === nowMonth) monthly += count;
        }
        res.json({ 
            success: true, daily, weekly, monthly, total, 
            maintStart: cfg.maintStart || '23:00', maintEnd: cfg.maintEnd || '00:30',
            adminWa: cfg.botNumber || ""
        });
    } catch(e) { res.json({ success: false, daily: 0, weekly: 0, monthly: 0, total: 0 }); }
});

app.get('/api/produk', (req, res) => { 
    let produkMap = getAllRecords('produk');
    let entries = Object.entries(produkMap);
    // Sort agar is_custom_top selalu berada di atas
    entries.sort((a, b) => {
        let isTopA = a[1].is_custom_top ? 1 : 0;
        let isTopB = b[1].is_custom_top ? 1 : 0;
        return isTopB - isTopA; 
    });
    // Kembalikan ke format Object (karena frontend memprosesnya sebagai Dictionary)
    let sortedObject = {};
    for(let [k, v] of entries) { sortedObject[k] = v; }
    res.json(sortedObject); 
});

app.get('/api/leaderboard', (req, res) => {
    try {
        let users = getAllRecords('users');
        let leaderboard = [];
        for (let id in users) {
            let u = users[id];
            let trx = u.trx_count || 0;
            if (trx > 0) {
                let nameStr = u.username || id;
                let maskedName = nameStr.length > 5 ? nameStr.substring(0, 4) + '***' + nameStr.substring(nameStr.length - 2) : nameStr.substring(0, 2) + '***';
                leaderboard.push({ name: maskedName, trx: trx });
            }
        }
        leaderboard.sort((a, b) => b.trx - a.trx);
        res.json({ success: true, data: leaderboard.slice(0, 5) }); 
    } catch(e) { 
        res.json({ success: false, data: [] }); 
    }
});

app.get('/api/notif', (req, res) => { res.json(getAllRecordsArray('web_notif')); });
app.get('/api/global-trx', (req, res) => { res.json(getAllRecordsArray('global_trx')); });
app.get('/api/custom-layout', (req, res) => { res.json({success: true, data: getRecord('custom_layout', 'main') || {sections:[]}}); }); 
app.get('/api/tutorials', (req, res) => { res.json(getAllRecordsArray('tutorial')); });

app.get('/api/vpn-config', (req, res) => {
    try {
        let vpn = getRecord('vpn_config', 'main') || {};
        let safeConfig = JSON.parse(JSON.stringify(vpn));
        if(safeConfig.servers) {
            for(let srv in safeConfig.servers) {
                delete safeConfig.servers[srv].pass;
                delete safeConfig.servers[srv].user;
                delete safeConfig.servers[srv].api_key;
                delete safeConfig.servers[srv].port;
            }
        }
        res.json({success: true, data: safeConfig});
    } catch(e) { res.json({success: false}); }
});

app.get('/api/user/:phone', verifyToken, (req, res) => {
    try {
        let p = req.params.phone;
        let u = getRecord('users', p);
        if(u) {
            let safeData = { ...u }; delete safeData.password; 
            res.json({success: true, data: safeData});
        } else res.json({success: false});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/cancel-topup', verifyToken, (req, res) => {
    try {
        let { sn, phone } = req.body;
        let topup = getRecord('topup', sn);
        
        if(topup && topup.phone === phone) {
            topup.status = 'gagal';
            saveRecord('topup', sn, topup);
            
            // BUG 20 FIX: Tembak auto cancel ke GoPay jika dibatalkan oleh user
            let config = getRecord('config', 'main') || {};
            if (topup.autogopay_trx_id && config.gopayToken) {
                axios.post('https://v1-gateway.autogopay.site/qris/cancel', {
                    transaction_id: topup.autogopay_trx_id
                }, { headers: { 'Authorization': 'Bearer ' + config.gopayToken, 'Content-Type': 'application/json' }}).catch(e=>{});
            }
        }
        
        let u = getRecord('users', phone);
        if(u) {
            let hist = u.history.find(h => h.sn === sn);
            if(hist && hist.status === 'Pending') {
                hist.status = 'Gagal (Dibatalkan)';
                saveRecord('users', phone, u);
                return res.json({success: true});
            }
        }
        res.json({success: false, message: 'Topup tidak ditemukan atau sudah diproses.'});
    } catch(e) { res.json({success: false, message: 'Server error'}); }
});

app.post('/api/logout', verifyToken, (req, res) => {
    try {
        dbSqlite.prepare(`INSERT OR IGNORE INTO jwt_blacklist (id) VALUES (?)`).run(req.token);
        res.json({success: true, message: 'Berhasil logout.'});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/login', (req, res) => {
    try {
        let idRaw = (req.body.id || '').trim();
        let id = sanitizeInput(idRaw);
        let password = req.body.password;
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        let limitKey = ip + '_' + id;
        if (loginAttempts[limitKey] && loginAttempts[limitKey].count >= 5) {
            if (Date.now() - loginAttempts[limitKey].time < 300000) {
                return res.json({success: false, message: 'Terlalu banyak percobaan login gagal. Harap tunggu 5 menit.'});
            } else {
                loginAttempts[limitKey] = {count: 0, time: Date.now()};
            }
        }

        let hashedInput = hashPassword(password);
        let normInput = normalizePhone(id);
        
        let uDirect = getRecord('users', normInput) || getRecord('users', id);
        let userPhone = null;

        if (uDirect && (uDirect.password === password || uDirect.password === hashedInput)) {
            userPhone = uDirect.jid ? uDirect.jid.split('@')[0] : (getRecord('users', normInput) ? normInput : id);
            if(uDirect.password === password) { uDirect.password = hashedInput; saveRecord('users', userPhone, uDirect); }
        } else {
            let users = getAllRecords('users');
            userPhone = Object.keys(users).find(k => {
                let usr = users[k];
                if (!usr) return false;
                let matchId = (usr.email && usr.email.toLowerCase() === id.toLowerCase()) || 
                              (usr.username && usr.username.toLowerCase() === id.toLowerCase());
                if (!matchId) return false;
                if (usr.password === password || usr.password === hashedInput) {
                    if (usr.password === password) { usr.password = hashedInput; saveRecord('users', k, usr); }
                    return true;
                }
                return false;
            });
        }

        if (userPhone) {
            delete loginAttempts[limitKey]; 
            let uFinal = getRecord('users', userPhone);
            let safeData = { ...uFinal }; delete safeData.password;
            const token = jwt.sign({ phone: userPhone }, SECRET_KEY, { expiresIn: '1d' });
            res.json({success: true, phone: userPhone, data: safeData, token: token});
        } else {
            loginAttempts[limitKey] = loginAttempts[limitKey] || {count: 0, time: Date.now()};
            loginAttempts[limitKey].count += 1;
            res.json({success: false, message: 'Data Akun (Email/WA/Username) atau Password salah!'});
        }
    } catch(e) { res.json({success: false, message: 'Server error'}); }
});

app.post('/api/register', (req, res) => {
    try {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        ipOtpLimit[ip] = ipOtpLimit[ip] || { count: 0, time: Date.now() };
        if (Date.now() - ipOtpLimit[ip].time > 600000) { ipOtpLimit[ip] = { count: 1, time: Date.now() }; } 
        else { ipOtpLimit[ip].count++; }
        if (ipOtpLimit[ip].count > 3) return res.json({success: false, message: 'Terlalu banyak request dari IP Anda. Tunggu 10 menit.'});

        let username = sanitizeInput(req.body.username);
        let email = sanitizeInput(req.body.email);
        let password = req.body.password;
        let phone = normalizePhone(req.body.phone); 
        
        if(!phone || phone.length < 9) return res.json({success: false, message: 'Nomor WA tidak valid!'});
        if(otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({success: false, message: 'Tunggu 1 menit untuk request OTP lagi!'});
        otpCooldown[phone] = Date.now();
        
        let users = getAllRecords('users');
        let isEmailExist = Object.values(users).some(u => u && u.email && u.email.toLowerCase() === email.toLowerCase());
        if (isEmailExist) return res.json({success: false, message: 'Email terdaftar!'});
        
        let isUsernameExist = Object.values(users).some(u => u && u.username && u.username.toLowerCase() === username.toLowerCase());
        if (isUsernameExist) return res.json({success: false, message: 'Username sudah digunakan!'});

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        let expiresAt = Date.now() + 300000;
        saveRecord('otp_sessions', phone, { username, email, password: hashPassword(password), otp, attempts: 0, expiresAt });

        res.json({success: true});
        setTimeout(() => {
            if (globalSock) globalSock.sendMessage(phone + '@s.whatsapp.net', { text: `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nHai ${username},\nKode OTP Pendaftaran: *${otp}*\n\n_⚠️ Jangan bagikan kode ini!_` }).catch(e=>{});
        }, 100);

    } catch(e) { if (!res.headersSent) res.json({success: false, message: 'Gagal memproses pendaftaran.'}); }
});

app.post('/api/verify-otp', (req, res) => {
    try {
        let otp = req.body.otp; let phone = normalizePhone(req.body.phone);
        let session = getRecord('otp_sessions', phone);
        if(!session || Date.now() > session.expiresAt) {
            if(session) deleteRecord('otp_sessions', phone);
            return res.json({success: false, message: 'Sesi pendaftaran kadaluwarsa. Silakan request OTP ulang.'});
        }

        if(session.otp === otp) {
            let idPelanggan = 'TD-' + Math.floor(100000 + Math.random() * 900000); 
            let u = getRecord('users', phone) || { 
                id_pelanggan: idPelanggan, saldo: 0, 
                tanggal_daftar: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), 
                jid: phone + '@s.whatsapp.net', step: 'idle', trx_count: 0, history: [] 
            };
            
            u.username = session.username; 
            u.email = session.email; 
            u.password = session.password;
            if(!u.id_pelanggan) u.id_pelanggan = idPelanggan;
            
            saveRecord('users', phone, u); 
            deleteRecord('otp_sessions', phone);
            res.json({success: true});
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if(session.attempts >= 3) {
                deleteRecord('otp_sessions', phone);
                return res.json({success: false, message: 'Sesi diblokir, silakan request OTP ulang.'});
            }
            saveRecord('otp_sessions', phone, session);
            res.json({success: false, message: 'Kode OTP Salah!'});
        }
    } catch(e) { res.json({success: false, message: 'Server error'}); }
});

app.post('/api/req-edit-otp', verifyToken, (req, res) => {
    try {
        let { phone, type, newValue } = req.body; 
        let u = getRecord('users', phone);
        if(!u) return res.json({success: false, message: 'User tidak ditemukan.'});
        if(otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({success: false, message: 'Tunggu 1 menit untuk request OTP lagi!'});
        otpCooldown[phone] = Date.now();

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        if (type === 'password') newValue = hashPassword(newValue);
        let expiresAt = Date.now() + 300000;
        saveRecord('otp_sessions', phone + '_edit', { type, newValue, otp, attempts: 0, expiresAt });
        
        res.json({success: true});

        setTimeout(() => {
            if (globalSock) globalSock.sendMessage(phone + '@s.whatsapp.net', { text: `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nKode OTP perubahan data: *${otp}*\n\n_⚠️ Jangan berikan ke siapapun!_` }).catch(e=>{});
        }, 100);
    } catch(e) { if (!res.headersSent) res.json({success: false, message: 'Gagal memproses OTP.'}); }
});

app.post('/api/verify-edit-otp', verifyToken, (req, res) => {
    try {
        let { phone, otp } = req.body; 
        let session = getRecord('otp_sessions', phone + '_edit');
        if(!session || Date.now() > session.expiresAt) {
            if(session) deleteRecord('otp_sessions', phone + '_edit');
            return res.json({success: false, message: 'Sesi kadaluwarsa, silakan request ulang.'});
        }

        if(session.otp === otp) {
            let u = getRecord('users', phone);
            if(session.type === 'email') u.email = session.newValue;
            if(session.type === 'password') u.password = session.newValue;
            if(session.type === 'phone') {
                let newPhone = normalizePhone(session.newValue);
                let existU = getRecord('users', newPhone);
                if(existU) return res.json({success: false, message: 'Nomor sudah dipakai akun lain.'});
                u.jid = newPhone + '@s.whatsapp.net';
                saveRecord('users', newPhone, u);
                deleteRecord('users', phone);
            } else {
                saveRecord('users', phone, u);
            }
            deleteRecord('otp_sessions', phone + '_edit'); 
            res.json({success: true});
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if(session.attempts >= 3) {
                deleteRecord('otp_sessions', phone + '_edit');
                return res.json({success: false, message: 'Sesi diblokir, silakan request OTP ulang.'});
            }
            saveRecord('otp_sessions', phone + '_edit', session);
            res.json({success: false, message: 'OTP Salah!'});
        }
    } catch(e) { res.json({success: false, message: 'Server error'}); }
});

app.post('/api/req-forgot-otp', (req, res) => {
    try {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        ipOtpLimit[ip] = ipOtpLimit[ip] || { count: 0, time: Date.now() };
        if (Date.now() - ipOtpLimit[ip].time > 600000) { ipOtpLimit[ip] = { count: 1, time: Date.now() }; } 
        else { ipOtpLimit[ip].count++; }
        if (ipOtpLimit[ip].count > 3) return res.json({success: false, message: 'Terlalu banyak request dari IP Anda. Tunggu 10 menit.'});

        let phone = normalizePhone(req.body.phone);
        let u = getRecord('users', phone);
        if(!u) return res.json({success: false, message: 'Nomor WA tidak terdaftar!'});
        if(otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({success: false, message: 'Tunggu 1 menit untuk request OTP lagi!'});
        otpCooldown[phone] = Date.now();

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        let expiresAt = Date.now() + 300000;
        saveRecord('otp_sessions', phone + '_forgot', { otp, attempts: 0, expiresAt });
        
        res.json({success: true});

        setTimeout(() => {
            if (globalSock) globalSock.sendMessage(phone + '@s.whatsapp.net', { text: `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nPermintaan Reset Password.\nKode OTP: *${otp}*\n\n_⚠️ Abaikan jika bukan Anda!_` }).catch(e=>{});
        }, 100);
    } catch(e) { if (!res.headersSent) res.json({success: false, message: 'Gagal memproses OTP.'}); }
});

app.post('/api/verify-forgot-otp', (req, res) => {
    try {
        let phone = normalizePhone(req.body.phone); let { otp, newPass } = req.body;
        let session = getRecord('otp_sessions', phone + '_forgot');
        if(!session || Date.now() > session.expiresAt) {
            if(session) deleteRecord('otp_sessions', phone + '_forgot');
            return res.json({success: false, message: 'Sesi OTP tidak ditemukan atau sudah expired.'});
        }

        if(session.otp === otp) {
            let u = getRecord('users', phone);
            if(u) { u.password = hashPassword(newPass); saveRecord('users', phone, u); }
            deleteRecord('otp_sessions', phone + '_forgot'); 
            res.json({success: true});
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if(session.attempts >= 3) {
                deleteRecord('otp_sessions', phone + '_forgot');
                return res.json({success: false, message: 'Sesi diblokir, silakan request OTP ulang.'});
            }
            saveRecord('otp_sessions', phone + '_forgot', session);
            res.json({success: false, message: 'Kode OTP Salah!'});
        }
    } catch(e) { res.json({success: false, message: 'Server error'}); }
});

// ==============================================================
// ENDPOINT: GENERATE AUTOGOPAY QRIS (TOPUP)
// ==============================================================
app.post('/api/topup', verifyToken, async (req, res) => {
    try {
        if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
        let config = getRecord('config', 'main') || {};
        if(!config.gopayToken) return res.json({success: false, message: "Token AutoGoPay belum diatur Admin."});
        
        let { phone, nominal } = req.body;
        let u = getRecord('users', phone);
        if(!u) return res.json({success: false, message: "User tidak ditemukan."});
        
        let kodeUnik = Math.floor(Math.random() * 99) + 1;
        let nominalBayar = parseInt(nominal) + kodeUnik;
        let trxId = "TP-" + Date.now() + '-' + Math.floor(Math.random() * 1000);
        
        // MINTA QRIS DARI AUTOGOPAY
        let response;
        try {
            response = await axios.post('https://v1-gateway.autogopay.site/qris/generate', {
                amount: nominalBayar
            }, {
                headers: { 'Authorization': 'Bearer ' + config.gopayToken, 'Content-Type': 'application/json' }
            });
        } catch(err) {
            return res.json({success: false, message: "Gagal memanggil API AutoGoPay dari server."});
        }

        if (!response.data || !response.data.data) return res.json({success: false, message: "Respons AutoGoPay tidak valid."});
        
        let finalQrisUrl = response.data.data.qr_url;
        let autogopay_trx_id = response.data.data.transaction_id;
        let expiredAt = Date.now() + 10 * 60 * 1000;

        saveRecord('topup', trxId, { 
            phone, trx_id: trxId, autogopay_trx_id: autogopay_trx_id, amount_to_pay: nominalBayar, saldo_to_add: nominalBayar, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, is_order: false 
        });

        u.history = u.history || [];
        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
            type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Pending', sn: trxId, amount: nominalBayar, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if(u.history.length > 50) u.history.pop();
        saveRecord('users', phone, u);

        res.json({success: true});
        
        // BUG 23 FIX: Gunakan fallback ternary
        let emailUser = u.email || '-';
        let namaUser = u.username || phone;
        let teleMsg = `⏳ <b>TOPUP PENDING (AUTOGOPAY)</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n💰 Nominal: Rp ${(nominalBayar ? nominalBayar.toLocaleString('id-ID') : '0')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS AutoGoPay\n💳 Saldo Saat Ini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
        sendTelegramAdmin(teleMsg);
    } catch(e) { 
        if (!res.headersSent) {
            res.json({success: false, message: "Gagal memproses QRIS."}); 
        } else {
            console.error("Error pasca-response QRIS (Topup):", e.message);
        }
    }
});

// ==============================================================
// ENDPOINT: GENERATE AUTOGOPAY QRIS (ORDER PPOB)
// ==============================================================
app.post('/api/order-qris', verifyToken, async (req, res) => {
    try {
        if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
        let config = getRecord('config', 'main') || {};
        if(!config.gopayToken) return res.json({success: false, message: "Token AutoGoPay belum diatur Admin."});
        
        let { phone, sku, tujuan } = req.body; let pNorm = normalizePhone(phone);
        let uNorm = getRecord('users', pNorm);
        let uOri = getRecord('users', phone);
        let targetKey = uNorm ? pNorm : (uOri ? phone : null);
        if (!targetKey) return res.json({success: false, message: 'Sesi Anda tidak valid.'});
        let u = uNorm || uOri;
        
        let p = getRecord('produk', sku);
        if (!p) return res.json({success: false, message: 'Produk tidak ditemukan.'});

        let isPasca = p.kategori === 'PLN Pasca' || p.kategori === 'PDAM' || p.kategori === 'BPJS' || p.kategori === 'Gas Negara' || p.kategori === 'Internet & TV' || p.kategori === 'E-Money Pasca' || p.is_pasca_api === true;
        if (isPasca) return res.json({success: false, message: 'Layanan Pascabayar (Tagihan) tidak mendukung pembayaran instan via QRIS. Silakan isi Saldo Akun terlebih dahulu.'});

        let kodeUnik = Math.floor(Math.random() * 101) + 100;
        let nominalBayar = parseInt(p.harga) + kodeUnik;
        let trxId = "OQ-" + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // MINTA QRIS DARI AUTOGOPAY
        let response;
        try {
            response = await axios.post('https://v1-gateway.autogopay.site/qris/generate', {
                amount: nominalBayar
            }, {
                headers: { 'Authorization': 'Bearer ' + config.gopayToken, 'Content-Type': 'application/json' }
            });
        } catch(err) {
            return res.json({success: false, message: "Gagal memanggil API AutoGoPay dari server."});
        }

        if (!response.data || !response.data.data) return res.json({success: false, message: "Respons AutoGoPay tidak valid."});
        
        let finalQrisUrl = response.data.data.qr_url;
        let autogopay_trx_id = response.data.data.transaction_id;
        let expiredAt = Date.now() + 10 * 60 * 1000;

        saveRecord('topup', trxId, { 
            phone: targetKey, trx_id: trxId, autogopay_trx_id: autogopay_trx_id, amount_to_pay: nominalBayar, saldo_to_add: nominalBayar, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, 
            is_order: true, sku: sku, tujuan: sanitizeInput(tujuan), nama_produk: p.nama, harga_asli: nominalBayar 
        });

        u.history = u.history || [];
        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
            type: 'Order QRIS', nama: p.nama + ' (QRIS)', tujuan: sanitizeInput(tujuan), status: 'Pending', sn: trxId, amount: nominalBayar, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if(u.history.length > 50) u.history.pop();
        saveRecord('users', targetKey, u);

        res.json({success: true});
        
        // BUG 23 FIX: Gunakan fallback ternary
        let emailUser = u.email || '-';
        let namaUser = u.username || targetKey;
        let teleMsg = `🛒 <b>ORDER QRIS PENDING</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n💰 Nominal: Rp ${(nominalBayar ? nominalBayar.toLocaleString('id-ID') : '0')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS AutoGoPay\n💳 Saldo Saat Ini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
        sendTelegramAdmin(teleMsg);
    } catch(e) { 
        if (!res.headersSent) {
            res.json({success: false, message: "Gagal memproses QRIS."}); 
        } else {
            console.error("Error pasca-response QRIS (Order PPOB):", e.message);
        }
    }
});

// ==============================================================
// LOGIKA PEMBAYARAN SALDO: PRABAYAR & PASCABAYAR
// ==============================================================
app.post('/api/order', verifyToken, async (req, res) => {
    let targetKey = ""; let hargaFix = 0; let refId = 'WEB-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    try {
        if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
        
        let { phone, sku, tujuan } = req.body; let pNorm = normalizePhone(phone);
        let uNorm = getRecord('users', pNorm);
        let uOri = getRecord('users', phone);
        
        targetKey = uNorm ? pNorm : (uOri ? phone : null);
        if (!targetKey) return res.json({success: false, message: 'Sesi Anda tidak valid. Silakan Logout dan Login kembali.'});
        
        let p = getRecord('produk', sku);
        if (!p) return res.json({success: false, message: 'Produk tidak ditemukan.'});
        let config = getRecord('config', 'main') || {};
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
                return res.json({success: false, message: err.response?.data?.data?.message || err.message || "Inquiry gagal."});
            }

            if (inqRes.data?.data?.status === 'Gagal') {
                return res.json({success: false, message: inqRes.data.data.message || "Inquiry gagal."});
            }

            let tagihan = inqRes.data?.data?.selling_price || hargaFix; 
            let atomicRes;
            try {
                atomicRes = atomicDeductBalance(targetKey, tagihan);
            } catch (err) {
                return res.json({success: false, message: err.message});
            }

            let u = atomicRes.uData;
            let saldoSebelum = atomicRes.saldoTerkini + tagihan;

            u.trx_count = (u.trx_count || 0) + 1;
            u.history = u.history || [];
            u.history.unshift({ 
                ts: Date.now(), 
                tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
                type: 'Order', nama: p.nama, tujuan: tujuan, status: 'Pending', sn: '-', amount: tagihan, ref_id: refId,
                saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo
            });
            if(u.history.length > 50) u.history.pop();
            saveRecord('users', targetKey, u);

            let targetJid = u.jid || targetKey + '@s.whatsapp.net';
            saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: tagihan, nama: p.nama, tanggal: Date.now(), phone: targetKey });

            try {
                let payRes = await axios.post('https://api.digiflazz.com/v1/transaction', {
                    commands: "pay-pasca", username: username, buyer_sku_code: realSku, customer_no: sanitizeInput(tujuan), ref_id: refId, sign: sign
                });
                let statusOrder = payRes.data?.data?.status;
                let snOrder = payRes.data?.data?.sn || '-';

                let emailUser = u.email || '-';
                let namaUser = u.username || targetKey;

                if (statusOrder === 'Gagal') {
                    let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + p.nama, tujuan: tujuan, status: 'Refund', sn: '-', amount: tagihan, ref_id: refId };
                    u = atomicRefundBalance(targetKey, tagihan, histObj);
                    u.history = u.history.filter(h => !(h.ref_id === refId && h.status === 'Pending'));
                    saveRecord('users', targetKey, u);
                    deleteRecord('trx', refId);
                    
                    // BUG 23 FIX: Ternary fallback
                    let teleMsgFail = `❌ <b>PESANAN PASCABAYAR GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Alasan: ${payRes.data.data.message}\n💰 Nominal: Rp ${(tagihan ? tagihan.toLocaleString('id-ID') : '0')}\n💳 Metode: Saldo Akun\n💰 Saldo Kembali: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                    sendTelegramAdmin(teleMsgFail);
                    
                    return res.json({success: false, message: payRes.data.data.message});
                } else {
                    u = getRecord('users', targetKey);
                    let idxHist = u.history.findIndex(h => h.ref_id === refId && h.type === 'Order');
                    if (idxHist !== -1) {
                        u.history[idxHist].status = statusOrder;
                        u.history[idxHist].sn = snOrder;
                        saveRecord('users', targetKey, u);
                    }
                    
                    if (statusOrder === 'Sukses') {
                        let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                        let gStats = getRecord('global_stats', dateKey) || 0;
                        saveRecord('global_stats', dateKey, gStats + 1);

                        let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                        unshiftRecordArray('global_trx', { time: timeStr, product: p.nama, user: namaUser, target: maskStringTarget(tujuan), price: tagihan, method: 'Saldo Akun' });
                        sendBroadcastSuccess(p.nama, namaUser, tujuan, tagihan, 'Saldo Akun');
                    }
                    
                    let teleMsg = `🔔 <b>PESANAN PASCABAYAR MASUK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status: <b>${statusOrder}</b>\n💰 Tagihan: Rp ${(tagihan ? tagihan.toLocaleString('id-ID') : '0')}\n💳 Metode: Saldo Akun\n💳 Saldo Sisa: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                    sendTelegramAdmin(teleMsg);
                    
                    return res.json({success: true, saldo: u.saldo});
                }
            } catch (error) {
                if (!res.headersSent) {
                    return res.json({success: true, message: 'Request pembayaran sedang diproses oleh sistem...', saldo: u.saldo});
                }
            }

        } else {
            // ALUR PRABAYAR (LAMA)
            let atomicRes;
            try {
                atomicRes = atomicDeductBalance(targetKey, hargaFix);
            } catch (err) {
                return res.json({success: false, message: err.message});
            }

            let u = atomicRes.uData;
            let saldoSebelum = atomicRes.saldoTerkini + hargaFix;

            u.trx_count = (u.trx_count || 0) + 1;
            u.history = u.history || [];
            u.history.unshift({ 
                ts: Date.now(), 
                tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
                type: 'Order', nama: p.nama, tujuan: tujuan, status: 'Pending', sn: '-', amount: hargaFix, ref_id: refId,
                saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo
            });
            if(u.history.length > 50) u.history.pop();
            saveRecord('users', targetKey, u);
            
            let targetJid = u.jid || targetKey + '@s.whatsapp.net';
            saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: hargaFix, nama: p.nama, tanggal: Date.now(), phone: targetKey });

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
                    let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + p.nama, tujuan: tujuan, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refId };
                    u = atomicRefundBalance(targetKey, hargaFix, histObj);
                    
                    u.history = u.history.filter(h => !(h.ref_id === refId && h.status === 'Pending'));
                    saveRecord('users', targetKey, u);
                    deleteRecord('trx', refId);
                    
                    let teleMsgFail = `❌ <b>PESANAN PRABAYAR GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Alasan: ${response.data.data.message}\n💰 Nominal: Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')}\n💳 Metode: Saldo Akun\n💰 Saldo Kembali: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                    sendTelegramAdmin(teleMsgFail);
                    
                    return res.json({success: false, message: response.data.data.message});
                } else {
                    u = getRecord('users', targetKey);
                    let idxHist = u.history.findIndex(h => h.ref_id === refId && h.type === 'Order');
                    if (idxHist !== -1) {
                        u.history[idxHist].status = statusOrder;
                        u.history[idxHist].sn = snOrder;
                        saveRecord('users', targetKey, u);
                    }
                }

                if (statusOrder === 'Sukses') {
                    let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                    let gStats = getRecord('global_stats', dateKey) || 0;
                    saveRecord('global_stats', dateKey, gStats + 1);

                    let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                    unshiftRecordArray('global_trx', { time: timeStr, product: p.nama, user: namaUser, target: maskStringTarget(tujuan), price: hargaFix, method: 'Saldo Akun' });

                    sendBroadcastSuccess(p.nama, namaUser, tujuan, hargaFix, 'Saldo Akun');
                }

                res.json({success: true, saldo: u.saldo});

                let teleMsg = `🔔 <b>PESANAN PRABAYAR BARU MASUK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${p.nama}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status: <b>${statusOrder}</b>\n💰 Nominal: Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')}\n💳 Metode: Saldo Akun\n💳 Saldo Sisa: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                sendTelegramAdmin(teleMsg);

            } catch (error) { 
                if (!res.headersSent) {
                    return res.json({success: true, message: 'Request sedang diproses oleh sistem...', saldo: u.saldo});
                }
            }
        }
    } catch (e) {
        if (!res.headersSent) return res.json({success: false, message: "Terjadi kesalahan internal."});
    }
});

// ==============================================================
// CORE LOGIC: EKSEKUSI PEMBUATAN AKUN VPN KE SERVER VPS 
// ==============================================================
async function executeVpnOrder(phone, protocol, productId, mode, vpnUsername, vpnPassword, expiredDays, refIdAsal = null, paymentMethod = 'Saldo Akun') {
    let targetKey = normalizePhone(phone);
    let u = getRecord('users', targetKey) || getRecord('users', phone);
    if(!u) return { success: false, message: "Sesi tidak valid." };

    let vpnConfig = getRecord('vpn_config', 'main') || {products:{}, servers:{}};
    let prod = vpnConfig.products[productId];
    if(!prod) return { success: false, message: "Produk VPN tidak ditemukan atau telah dihapus." };
    if(mode === 'reguler' && parseInt(prod.stok) <= 0) return { success: false, message: "Stok untuk produk ini sedang habis." };

    let serverKey = prod.server_id;
    let srv = vpnConfig.servers[serverKey];
    if(!srv || !srv.host || !srv.api_key) {
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
                let atomicRes = atomicDeductBalance(targetKey, hargaFix);
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
        if(protoLower === 'ssh') endpoint = `http://${cleanHost}/vps/trialsshvpn`;
        else endpoint = `http://${cleanHost}/vps/trial${protoLower}all`;
    } else {
        payload = { username: sanitizeInput(vpnUsername), expired: parseInt(expiredDays) || 30, limitip: vpnLimitIp, kuota: vpnKuota };
        if(protoLower === 'ssh' || protoLower === 'zivpn') payload.password = sanitizeInput(vpnPassword);
        else payload.uuidv2 = '';
        
        if(protoLower === 'ssh') endpoint = `http://${cleanHost}/vps/sshvpn`;
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
        u = getRecord('users', targetKey) || getRecord('users', phone);
        if (!u.trial_claims) u.trial_claims = {};

        let isSuccessResponse = (resApi.status >= 200 && resApi.status < 300) && resApi.data && !resApi.data.error && resApi.data.status !== false;
        let isErrorResponse = resApi.data && (resApi.data.status === false || resApi.data.error || resApi.status >= 400);

        if(isSuccessResponse && !isErrorResponse) {
            let apiData = resApi.data.data || resApi.data || {};
            let domain = srv.host;
            let expDate = apiData.expired || apiData.exp || apiData.to || (mode === 'trial' ? '30 Menit' : `${parseInt(expiredDays) || 30} Hari`);
            let vpnDetails = '';
            
            let fixCity = srv.city || apiData.city || '-';
            let fixIsp = srv.isp || apiData.isp || '-';
            let vpnUser = apiData.username || vpnUsername || "TrialUser";

            if (protoLower === 'ssh') {
                vpnDetails = `Account Created Successfully\n————————————————————————————————————\nDomain Host     : ${domain}\nCity            : ${fixCity}\nISP             : ${fixIsp}\nUsername        : ${vpnUser}\nPassword        : ${apiData.password || vpnPassword || '1'}\n————————————————————————————————————\nExpired         : ${expDate}\n————————————————————————————————————\nTLS             : ${apiData.port?.tls || '443,8443'}\nNone TLS        : ${apiData.port?.none || '80,8080'}\nAny             : 2082,2083,8880\nOpenSSH         : 444\nDropbear        : 90\n————————————————————————————————————\nSlowDNS         : 53,5300\nUDP-Custom      : 1-65535\nOHP + SSH       : 9080\nSquid Proxy     : 3128\nUDPGW           : 7100-7600\nOpenVPN TCP     : 80,1194\nOpenVPN SSL     : 443\nOpenVPN UDP     : 25000\nOpenVPN DNS     : 53\nOHP + OVPN      : 9088\n————————————————————————————————————`;
            } else if (protoLower === 'vmess') {
                vpnDetails = `————————————————————————————————————\n               VMESS\n————————————————————————————————————\nRemarks        : ${vpnUser}\nDomain Host    : ${domain}\nCity           : ${fixCity}\nISP            : ${fixIsp}\nPort TLS       : 443,8443\nPort none TLS  : 80,8080\nPort any       : 2052,2053,8880\nid             : ${apiData.uuid || apiData.id || '-'}\nalterId        : 0\nSecurity       : auto\nnetwork        : ws,grpc,upgrade\npath ws        : /vmess\nserviceName    : vmess\npath upgrade   : /upvmess\nExpired On     : ${expDate}\n————————————————————————————————————\n           VMESS WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————\n          VMESS WS NO TLS\n————————————————————————————————————\n${apiData.link?.none || '-'}\n————————————————————————————————————\n             VMESS GRPC\n————————————————————————————————————\n${apiData.link?.grpc || '-'}\n————————————————————————————————————`;
            } else if (protoLower === 'vless') {
                vpnDetails = `————————————————————————————————————\n               VLESS\n————————————————————————————————————\nRemarks        : ${vpnUser}\nDomain Host    : ${domain}\nCity           : ${fixCity}\nISP            : ${fixIsp}\nPort TLS       : 443,8443\nPort none TLS  : 80,8080\nPort any       : 2052,2053,8880\nid             : ${apiData.uuid || apiData.id || '-'}\nEncryption     : none\nNetwork        : ws,grpc,upgrade\nPath ws        : /vless\nserviceName    : vless\nPath upgrade   : /upvless\nExpired On     : ${expDate}\n————————————————————————————————————\n            VLESS WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————\n          VLESS WS NO TLS\n————————————————————————————————————\n${apiData.link?.none || '-'}\n————————————————————————————————————\n             VLESS GRPC\n————————————————————————————————————\n${apiData.link?.grpc || '-'}\n————————————————————————————————————`;
            } else if (protoLower === 'trojan') {
                vpnDetails = `————————————————————————————————————\n               TROJAN\n————————————————————————————————————\nRemarks      : ${vpnUser}\nDomain Host  : ${domain}\nCity         : ${fixCity}\nISP          : ${fixIsp}\nPort         : 443,8443\nPort any     : 2052,2053,8880\nKey          : ${apiData.uuid || apiData.id || '-'}\nNetwork      : ws,grpc,upgrade\nPath ws      : /trojan\nserviceName  : trojan\nPath upgrade : /uptrojan\nExpired On   : ${expDate}\n————————————————————————————————————\n           TROJAN WS TLS\n————————————————————————————————————\n${apiData.link?.tls || '-'}\n————————————————————————————————————\n            TROJAN GRPC\n————————————————————————————————————\n${apiData.link?.grpc || '-'}\n————————————————————————————————————`;
            } else {
                vpnDetails = `Detail Akun ZIVPN:\nDomain Host: ${domain}\nCity: ${fixCity}\nISP: ${fixIsp}\nUsername: ${vpnUser}\nExp: ${expDate}\nLimit IP: ${vpnLimitIp}\n\nInfo selengkapnya cek di aplikasi.`;
            }

            let prodName = prod.name;
            if (mode === 'trial') prodName += ' (TRIAL)';
            
            if (mode === 'reguler') {
                u.trx_count = (u.trx_count || 0) + 1;
                vpnConfig = getRecord('vpn_config', 'main');
                vpnConfig.products[productId].stok -= 1;
                saveRecord('vpn_config', 'main', vpnConfig);
            } else if (mode === 'trial') {
                u.trial_claims[productId] = Date.now();
            }
            
            let refId = refIdAsal || ("VPN-" + Date.now() + '-' + Math.floor(Math.random() * 1000));
            
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
                    tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
                    type: 'Order VPN', nama: prodName, tujuan: (mode==='trial'?'Sistem':vpnUser), status: 'Sukses', sn: '-', amount: hargaFix, ref_id: refId,
                    saldo_sebelumnya: saldoSebelum, saldo_sesudah: u.saldo,
                    vpn_details: vpnDetails
                });
                if(u.history.length > 50) u.history.pop();
            }
            saveRecord('users', targetKey, u);

            let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
            let gStats = getRecord('global_stats', dateKey) || 0;
            saveRecord('global_stats', dateKey, gStats + 1);

            let namaUser = u.username || targetKey;

            if (mode !== 'trial') {
                let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                unshiftRecordArray('global_trx', { time: timeStr, product: prodName, user: namaUser, target: maskStringTarget(vpnUser), price: hargaFix, method: paymentMethod });
                sendBroadcastSuccess(prodName, namaUser, vpnUser, hargaFix, paymentMethod);
            }

            let emailUser = u.email || '-';
            let vpnConfNew = getRecord('vpn_config', 'main');
            // BUG 23 FIX: Gunakan Safe Navigation (Ternary) untuk toLocaleString pada laporan sukses
            let teleSuccess = `🚀 <b>ORDER VPN PREMIUM SUKSES</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${prodName}\n🎯 Username VPN: ${vpnUser}\n💰 Nominal: Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')}\n💳 Metode: ${mode === 'trial' ? 'Gratis (Trial)' : paymentMethod}\n📦 Sisa Stok: ${mode === 'reguler' ? vpnConfNew.products[productId].stok : 'Trial'}\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
            sendTelegramAdmin(teleSuccess);

            return { success: true };
        } else {
            // Revert Deduction if Failed (Dengan Atomic Refund + Unshift History Pembatalan)
            if (mode === 'reguler' && paymentMethod === 'Saldo Akun') {
                let refHistObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + prod.name, tujuan: vpnUsername, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal || 'VPN-'+Date.now()+'-'+Math.floor(Math.random()*1000) };
                atomicRefundBalance(targetKey, hargaFix, refHistObj);
            }

            let errMsg = "unknown error";
            if (resApi.data && resApi.data.message) errMsg = resApi.data.message;
            else if (resApi.data && resApi.data.error) errMsg = resApi.data.error;
            else if (resApi.statusText) errMsg = resApi.statusText;
            
            if(errMsg.toLowerCase().includes('exist') || errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('sudah ada')) {
                return { success: false, message: "Username sudah ada/terpakai, silakan ganti username lain." };
            }
            return { success: false, message: "Gagal membuat akun di Server VPN. Pesan: " + errMsg };
        }
    } catch(e) {
        if (mode === 'reguler' && paymentMethod === 'Saldo Akun') {
            let refHistObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + prod.name, tujuan: vpnUsername, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal || 'VPN-'+Date.now()+'-'+Math.floor(Math.random()*1000) };
            atomicRefundBalance(targetKey, hargaFix, refHistObj);
        }
        return { success: false, message: "Koneksi ke Server VPN Gagal / Timeout. Pesan: " + e.message };
    }
}

// ==============================================================
// ENDPOINT: ORDER VPN SALDO
// ==============================================================
app.post('/api/order-vpn', verifyToken, async (req, res) => {
    if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
    let { phone, protocol, product_id, mode, username, password, expired } = req.body;
    let result = await executeVpnOrder(phone, protocol, product_id, mode, sanitizeInput(username), sanitizeInput(password), expired, null, 'Saldo Akun');
    res.json(result);
});

// ==============================================================
// ENDPOINT: ORDER VPN QRIS (AUTOGOPAY)
// ==============================================================
app.post('/api/order-vpn-qris', verifyToken, async (req, res) => {
    try {
        if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
        
        let config = getRecord('config', 'main') || {};
        if(!config.gopayToken) return res.json({success: false, message: "Token AutoGoPay belum diatur Admin."});
        
        let { phone, protocol, product_id, mode, username, password, expired } = req.body;
        username = sanitizeInput(username); password = sanitizeInput(password);
        
        let pNorm = normalizePhone(phone);
        let uNorm = getRecord('users', pNorm);
        let uOri = getRecord('users', phone);
        let targetKey = uNorm ? pNorm : (uOri ? phone : null);
        if (!targetKey) return res.json({success: false, message: 'Sesi Anda tidak valid.'});
        let u = uNorm || uOri;
        
        let vpnConfig = getRecord('vpn_config', 'main');
        let prod = vpnConfig.products[product_id];
        if(!prod) return res.json({success: false, message: 'Produk VPN tidak ditemukan.'});
        if(mode === 'reguler' && parseInt(prod.stok) <= 0) return res.json({success: false, message: 'Stok habis.'});

        let basePrice = parseInt(prod.price) || 0;
        let hari = parseInt(expired) || 30;
        if(hari > 30) hari = 30; if(hari < 1) hari = 1;
        
        let kodeUnik = Math.floor(Math.random() * 101) + 100;
        let nominalBayar = Math.ceil((basePrice / 30) * hari) + kodeUnik;
        let trxId = "VQ-" + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // MINTA QRIS DARI AUTOGOPAY
        let response;
        try {
            response = await axios.post('https://v1-gateway.autogopay.site/qris/generate', {
                amount: nominalBayar
            }, {
                headers: { 'Authorization': 'Bearer ' + config.gopayToken, 'Content-Type': 'application/json' }
            });
        } catch(err) {
            return res.json({success: false, message: "Gagal memanggil API AutoGoPay dari server."});
        }

        if (!response.data || !response.data.data) return res.json({success: false, message: "Respons AutoGoPay tidak valid."});
        
        let finalQrisUrl = response.data.data.qr_url;
        let autogopay_trx_id = response.data.data.transaction_id;
        let expiredAt = Date.now() + 10 * 60 * 1000;
        let prodName = prod.name;

        saveRecord('topup', trxId, { 
            phone: targetKey, trx_id: trxId, autogopay_trx_id: autogopay_trx_id, amount_to_pay: nominalBayar, saldo_to_add: nominalBayar, 
            status: 'pending', timestamp: Date.now(), expired_at: expiredAt, 
            is_order: true, vpn_data: { protocol, product_id, mode, username, password, expired, nama_produk: prodName, harga_asli: nominalBayar }
        });

        u.history.unshift({ 
            ts: Date.now(), 
            tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), 
            type: 'Order VPN QRIS', nama: prodName + ' (QRIS)', tujuan: username, status: 'Pending', sn: trxId, amount: nominalBayar, qris_url: finalQrisUrl, expired_at: expiredAt
        });
        if(u.history.length > 50) u.history.pop();
        saveRecord('users', targetKey, u);

        res.json({success: true});
        
        let emailUser = u.email || '-';
        let namaUser = u.username || targetKey;
        let teleMsg = `🛒 <b>ORDER VPN QRIS PENDING</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${targetKey}\n📦 Produk: ${prodName}\n🎯 Username VPN: ${username}\n💰 Nominal: Rp ${(nominalBayar ? nominalBayar.toLocaleString('id-ID') : '0')}\n🔖 Ref: ${trxId}\n💳 Metode: QRIS AutoGoPay\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
        sendTelegramAdmin(teleMsg);
    } catch(e) { 
        if (!res.headersSent) {
            res.json({success: false, message: "Gagal memproses QRIS VPN."}); 
        } else {
            console.error("Error pasca-response QRIS (Order VPN):", e.message);
        }
    }
});

app.post('/api/manual-vpn', verifyToken, async (req, res) => {
    try {
        let cfg = getRecord('config', 'main') || {};
        let adminWa = (cfg.botNumber || "").replace(/[^0-9]/g, '');
        if (req.authData.phone !== adminWa) {
            return res.json({success: false, message: 'Akses Ditolak: Fitur Generator VPN Manual khusus Admin.'});
        }

        if(cekPemeliharaan()) return res.json({success: false, message: 'Sistem sedang pemeliharaan.'});
        let { server_id, mode, type, username, password, expired } = req.body;

        let vpnConfig = getRecord('vpn_config', 'main');
        if(!vpnConfig || !vpnConfig.servers || !vpnConfig.servers[server_id]) {
            return res.json({success: false, message: 'Server tidak ditemukan.'});
        }

        let srv = vpnConfig.servers[server_id];
        if(!srv || !srv.host || !srv.api_key) return res.json({success: false, message: 'Konfigurasi server tidak valid.'});

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
            if(protoLower === 'ssh') endpoint_url = `http://${cleanHost}/vps/trialsshvpn`;
            else endpoint_url = `http://${cleanHost}/vps/trial${protoLower}all`;
        } else {
            payload = { username: sanitizeInput(username), expired: parseInt(expired) || 30, limitip: limitip_all, kuota: kuota_reguler };
            if(protoLower === 'ssh' || protoLower === 'zivpn') payload.password = sanitizeInput(password);
            else payload.uuidv2 = '';

            if(protoLower === 'ssh') endpoint_url = `http://${cleanHost}/vps/sshvpn`;
            else endpoint_url = `http://${cleanHost}/vps/${protoLower}all`;
        }

        const response = await axios.post(endpoint_url, payload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + srv.api_key },
            timeout: 120000,
            validateStatus: () => true,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        let isSuccessResponse = (response.status >= 200 && response.status < 300) && response.data && !response.data.error && response.data.status !== false;
        
        if(isSuccessResponse) {
            let apiData = response.data.data || response.data || {};
            res.json({success: true, data: apiData, server: srv});
        } else {
            let errMsg = "Unknown error";
            if (response.data && response.data.message) errMsg = response.data.message;
            else if (response.data && response.data.error) errMsg = response.data.error;
            res.json({success: false, message: errMsg});
        }
    } catch(e) {
        res.json({success: false, message: e.message});
    }
});

// BUG 23 FIX: Gunakan Safe Navigation (Ternary) untuk toLocaleString pada fungsi ini
async function prosesAutoOrderVPN(phone, vpnData, refIdAsal) {
    try {
        let result = await executeVpnOrder(phone, vpnData.protocol, vpnData.product_id, vpnData.mode, vpnData.username, vpnData.password, vpnData.expired, refIdAsal, 'QRIS');
        let u = getRecord('users', phone);
        
        let hist = u.history.find(h => h.sn === refIdAsal);
        if(!hist) return;

        if(!result.success) {
            let hargaFix = parseInt(vpnData.harga_asli) || 0;
            let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + vpnData.nama_produk, tujuan: vpnData.username, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal };
            let uRefund = atomicRefundBalance(phone, hargaFix, histObj);
            
            if (!uRefund) return;

            hist.status = 'Refund';
            saveRecord('users', phone, uRefund);
            
            let failMsg = result.message || "GAGAL VPS";
            let emailUser = uRefund.email || '-';
            let namaUser = uRefund.username || phone;
            let teleMsg = `⚠️ <b>INFO ORDER VPN QRIS: GAGAL VPS</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n🔖 Ref: ${refIdAsal}\n⚙️ Alasan: ${failMsg}\n💰 Saldo Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah otomatis di-refund ke akun pengguna.\n💳 Metode: QRIS AutoGoPay`;
            sendTelegramAdmin(teleMsg);
        }
    } catch (e) {
        console.error("Error di prosesAutoOrderVPN:", e.message);
    }
}

async function prosesAutoOrderQRIS(phone, sku, tujuan, nama_produk, harga_asli, refIdAsal) {
    let hargaFix = parseInt(harga_asli);
    try {
        let config = getRecord('config', 'main') || {}; 
        let p = getRecord('produk', sku) || {};
        let realSku = p.sku_asli || sku;

        let username = (config.digiflazzUsername || '').trim();
        let apiKey = (config.digiflazzApiKey || '').trim();
        let refId = 'WEB-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        let sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

        let isPasca = p.kategori === 'PLN Pasca' || p.kategori === 'PDAM' || p.kategori === 'BPJS' || p.kategori === 'Gas Negara' || p.kategori === 'Internet & TV' || p.kategori === 'E-Money Pasca' || p.is_pasca_api === true;

        if (isPasca) {
            let inqRes = await axios.post('https://api.digiflazz.com/v1/transaction', {
                commands: "inq-pasca", username: username, buyer_sku_code: realSku, customer_no: tujuan, ref_id: refId, sign: sign
            });
            
            if (inqRes.data?.data?.status === 'Gagal') {
                throw new Error(inqRes.data.data.message || "Inquiry Pasca Gagal");
            }
            
            const response = await axios.post('https://api.digiflazz.com/v1/transaction', { 
                commands: "pay-pasca", username: username, buyer_sku_code: realSku, customer_no: tujuan, ref_id: refId, sign: sign
            });
            
            const statusOrder = response.data.data.status; 
            
            let u = getRecord('users', phone);
            let saldoTerkini = parseInt(u.saldo);
            let emailUser = u.email || '-';
            let namaUser = u.username || phone;

            if (statusOrder === 'Gagal') {
                let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + nama_produk, tujuan: tujuan, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refId };
                u = atomicRefundBalance(phone, hargaFix, histObj);
                
                if (!u) return;

                let hist = u.history.find(h => h.sn === refIdAsal && h.type === 'Order QRIS');
                if(hist) hist.status = 'Refund';
                saveRecord('users', phone, u);
                
                if(globalSock) {
                    globalSock.sendMessage(u.jid || phone + '@s.whatsapp.net', { text: `❌ *PESANAN GAGAL & DI-REFUND*\n\nMaaf, pesanan ${nama_produk} tujuan ${tujuan} ditolak oleh sistem.\n\n💰 Saldo Anda sebesar Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah dikembalikan utuh ke akun Website.` }).catch(e=>{});
                }

                let teleMsgFail = `⚠️ <b>INFO ORDER QRIS: GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n🔖 Ref: ${refIdAsal}\n⚙️ Status Digiflazz Gagal.\n💰 Saldo Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah otomatis di-refund ke akun pengguna.\n💳 Metode: QRIS AutoGoPay`;
                sendTelegramAdmin(teleMsgFail);
                return;
            }
            
            u.trx_count = (u.trx_count || 0) + 1;
            let hist = u.history.find(h => h.sn === refIdAsal && h.type === 'Order QRIS');
            if(hist) {
                hist.status = statusOrder;
                hist.sn = response.data.data.sn || '-';
                hist.nama = nama_produk;
                hist.type = 'Order';
                hist.amount = hargaFix;
                hist.ref_id = refId;
                hist.saldo_sebelumnya = saldoTerkini + hargaFix;
                hist.saldo_sesudah = saldoTerkini;
            } else {
                u.history.unshift({ ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Order', nama: nama_produk, tujuan: tujuan, status: statusOrder, sn: response.data.data.sn || '-', amount: hargaFix, ref_id: refId, saldo_sebelumnya: saldoTerkini + hargaFix, saldo_sesudah: saldoTerkini });
                if(u.history.length > 50) u.history.pop();
            }
            saveRecord('users', phone, u);
            
            let targetJid = u.jid || phone + '@s.whatsapp.net';
            saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: hargaFix, nama: nama_produk, tanggal: Date.now(), phone: phone });

            if (statusOrder === 'Sukses') {
                let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                unshiftRecordArray('global_trx', { time: timeStr, product: nama_produk, user: namaUser, target: maskStringTarget(tujuan), price: hargaFix, method: 'QRIS' });
                sendBroadcastSuccess(nama_produk, namaUser, tujuan, hargaFix, 'QRIS');
            }

            let teleMsg = `🚀 <b>AUTO ORDER PASCABAYAR QRIS BERHASIL DITEMBAK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n📦 Produk: ${nama_produk}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status Awal: <b>${statusOrder}</b>\n💳 Metode: QRIS AutoGoPay\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
            sendTelegramAdmin(teleMsg);

        } else {
            // ALUR PRABAYAR QRIS
            const response = await axios.post('https://api.digiflazz.com/v1/transaction', { 
                username: username, buyer_sku_code: realSku, customer_no: tujuan, ref_id: refId, sign: sign, max_price: hargaFix
            });
            
            const statusOrder = response.data.data.status; 
            
            let u = getRecord('users', phone);
            let saldoTerkini = parseInt(u.saldo);
            let emailUser = u.email || '-';
            let namaUser = u.username || phone;

            if (statusOrder === 'Gagal') {
                let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + nama_produk, tujuan: tujuan, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refId };
                u = atomicRefundBalance(phone, hargaFix, histObj);
                
                if (!u) return;
                
                let hist = u.history.find(h => h.sn === refIdAsal && h.type === 'Order QRIS');
                if(hist) hist.status = 'Refund';
                saveRecord('users', phone, u);
                
                if(globalSock) {
                    globalSock.sendMessage(u.jid || phone + '@s.whatsapp.net', { text: `❌ *PESANAN GAGAL & DI-REFUND*\n\nMaaf, pesanan ${nama_produk} tujuan ${tujuan} ditolak oleh sistem.\n\n💰 Saldo Anda sebesar Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah dikembalikan utuh ke akun Website.` }).catch(e=>{});
                }

                let teleMsgFail = `⚠️ <b>INFO ORDER QRIS: GAGAL DIGIFLAZZ</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n🔖 Ref: ${refIdAsal}\n⚙️ Status Digiflazz Gagal.\n💰 Saldo Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah otomatis di-refund ke akun pengguna.\n💳 Metode: QRIS AutoGoPay`;
                sendTelegramAdmin(teleMsgFail);
                return;
            }
            
            u.trx_count = (u.trx_count || 0) + 1;
            let hist = u.history.find(h => h.sn === refIdAsal && h.type === 'Order QRIS');
            if(hist) {
                hist.status = statusOrder;
                hist.sn = response.data.data.sn || '-';
                hist.nama = nama_produk;
                hist.type = 'Order';
                hist.amount = hargaFix;
                hist.ref_id = refId;
                hist.saldo_sebelumnya = saldoTerkini + hargaFix;
                hist.saldo_sesudah = saldoTerkini;
            } else {
                u.history.unshift({ ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Order', nama: nama_produk, tujuan: tujuan, status: statusOrder, sn: response.data.data.sn || '-', amount: hargaFix, ref_id: refId, saldo_sebelumnya: saldoTerkini + hargaFix, saldo_sesudah: saldoTerkini });
                if(u.history.length > 50) u.history.pop();
            }
            saveRecord('users', phone, u);
            
            let targetJid = u.jid || phone + '@s.whatsapp.net';
            saveRecord('trx', refId, { jid: targetJid, sku: realSku, tujuan: tujuan, harga: hargaFix, nama: nama_produk, tanggal: Date.now(), phone: phone });

            if (statusOrder === 'Sukses') {
                let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                unshiftRecordArray('global_trx', { time: timeStr, product: nama_produk, user: namaUser, target: maskStringTarget(tujuan), price: hargaFix, method: 'QRIS' });
                sendBroadcastSuccess(nama_produk, namaUser, tujuan, hargaFix, 'QRIS');
            }

            let teleMsg = `🚀 <b>AUTO ORDER QRIS BERHASIL DITEMBAK</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n📦 Produk: ${nama_produk}\n🎯 Tujuan: ${tujuan}\n🔖 Ref: ${refId}\n⚙️ Status Awal: <b>${statusOrder}</b>\n💳 Metode: QRIS AutoGoPay\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
            sendTelegramAdmin(teleMsg);
        }

    } catch(e) {
        let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + nama_produk, tujuan: tujuan, status: 'Refund', sn: '-', amount: hargaFix, ref_id: refIdAsal };
        let uRefund = atomicRefundBalance(phone, hargaFix, histObj);
        
        if (!uRefund) return;
        
        let hist = uRefund.history.find(h => h.sn === refIdAsal && h.type === 'Order QRIS');
        if(hist) {
            hist.status = 'Refund';
            saveRecord('users', phone, uRefund);
        }

        let emailUser = uRefund.email || '-';
        let namaUser = uRefund.username || phone;
        let errMsg = e.response && e.response.data && e.response.data.data ? e.response.data.data.message : e.message;

        let teleMsgFail = `⚠️ <b>INFO ORDER QRIS: KONEKSI PPOB ERROR</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phone}\n🔖 Ref: ${refIdAsal}\n⚙️ Error: ${errMsg}\n💰 Saldo Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah dikembalikan otomatis ke akun pengguna.\n💳 Metode: QRIS AutoGoPay`;
        sendTelegramAdmin(teleMsgFail);
        
        if(globalSock) {
            globalSock.sendMessage(uRefund.jid || phone + '@s.whatsapp.net', { text: `❌ *PESANAN GAGAL PPOB*\n\nMaaf, pesanan ${nama_produk} gagal diproses karena gangguan pusat.\n\n💰 Saldo Anda sebesar Rp ${(hargaFix ? hargaFix.toLocaleString('id-ID') : '0')} telah dikembalikan ke akun Website.` }).catch(err=>{});
        }
    }
}

// Logika Backup SQLite
function doBackupAndSend() {
    let cfg = getRecord('config', 'main') || {};
    if (!cfg.teleToken || !cfg.teleChatId) return;
    exec(`sqlite3 tendo_database.db ".backup backup_aman.db" && [ -d "/etc/letsencrypt" ] && sudo tar -czf ssl_backup.tar.gz -C / etc/letsencrypt 2>/dev/null; rm -f backup.zip && zip backup.zip backup_aman.db ssl_backup.tar.gz 2>/dev/null && rm backup_aman.db`, (err) => {
        if (!err) exec(`curl -s -F chat_id="${cfg.teleChatId}" -F document=@"backup.zip" -F caption="📦 Backup Digital Tendo Store (SQLite)" https://api.telegram.org/bot${cfg.teleToken}/sendDocument`);
    });
}
let cfgBackupCheck = getRecord('config', 'main') || {};
if (cfgBackupCheck.autoBackup) setInterval(doBackupAndSend, (cfgBackupCheck.backupInterval || 720) * 60 * 1000); 

async function startBot() {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default.default || baileys.default;
    const { useMultiFileAuthState, DisconnectReason, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState('sesi_bot');
    let config = getRecord('config', 'main') || {};
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: Browsers.ubuntu('Chrome'), printQRInTerminal: false, syncFullHistory: false });
    globalSock = sock; 

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                if (!config.botNumber) {
                    console.log('\x1b[31m⚠️ Nomor Bot belum diatur! Bot WA belum bisa terhubung. Abaikan jika Anda baru pertama kali menginstal.\x1b[0m');
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
    sock.ev.on('connection.update', (u) => { if(u.connection === 'close') setTimeout(startBot, 4000); });

    sock.ev.on('call', async (calls) => { /* Call Logic Omitted for brevity */ });

    setInterval(() => {
        let currentlyMaintenance = cekPemeliharaan();
        let cfg = getRecord('config', 'main') || {};
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

    let isCheckingQris = false;
    
    // ==============================================================
    // FALLBACK & CANCELER CHECKER (INTERVAL) AUTOGOPAY
    // ==============================================================
    setInterval(async () => {
        if(isCheckingQris) return;
        isCheckingQris = true;
        try {
            let cfg = getRecord('config', 'main') || {};
            let topups = getAllRecords('topup');
            let pendingKeys = Object.keys(topups).filter(k => topups[k].status === 'pending');
            
            if(pendingKeys.length === 0 || !cfg.gopayToken) {
                isCheckingQris = false;
                return;
            }

            for(let key of pendingKeys) {
                let reqData = topups[key];
                let now = Date.now();

                // 1. Jika Waktu Pembayaran Habis -> Hit API Cek Status dulu (Perbaikan Instruksi 7)
                if (now > reqData.expired_at) {
                    try {
                        let checkRes = await axios.post('https://v1-gateway.autogopay.site/qris/status', {
                            transaction_id: reqData.autogopay_trx_id
                        }, { headers: { 'Authorization': `Bearer ${cfg.gopayToken}`, 'Content-Type': 'application/json' }});

                        let statusPusat = (checkRes.data && checkRes.data.data) ? checkRes.data.data.transaction_status : null;
                        
                        if (statusPusat === 'settlement') {
                            if (markTopupSuccess(key)) {
                                reqData.status = 'sukses';
                                saveRecord('topup', key, reqData);
                                
                                let u = getRecord('users', reqData.phone);
                                if(u) {
                                    if (!reqData.is_order) {
                                        let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Sukses', sn: reqData.trx_id, amount: reqData.amount_to_pay, qris_url: '' };
                                        atomicAddBalance(reqData.phone, reqData.saldo_to_add, histObj);
                                    } else {
                                        atomicAddBalance(reqData.phone, reqData.saldo_to_add, null);
                                        if(reqData.vpn_data) {
                                            let nominalBeliVpn = parseInt(reqData.harga_asli);
                                            try { atomicDeductBalance(reqData.phone, nominalBeliVpn); } catch(err) { }
                                            prosesAutoOrderVPN(reqData.phone, reqData.vpn_data, reqData.trx_id);
                                        } else {
                                            let nominalBeli = parseInt(reqData.harga_asli);
                                            try { atomicDeductBalance(reqData.phone, nominalBeli); } catch(err) { }
                                            prosesAutoOrderQRIS(reqData.phone, reqData.sku, reqData.tujuan, reqData.nama_produk, reqData.harga_asli, reqData.trx_id);
                                        }
                                    }
                                }
                            }
                            continue; 
                        } else if (statusPusat === 'cancel' || statusPusat === 'expire') {
                            // Sudah gagal di pusat, lanjutkan gagalkan di lokal
                        } else {
                            // Masih pending di pusat, batalkan
                            await axios.post('https://v1-gateway.autogopay.site/qris/cancel', {
                                transaction_id: reqData.autogopay_trx_id
                            }, { headers: { 'Authorization': `Bearer ${cfg.gopayToken}`, 'Content-Type': 'application/json' }});
                        }
                    } catch(e) {}
                    
                    reqData.status = 'gagal'; saveRecord('topup', key, reqData);
                    let u = getRecord('users', reqData.phone);
                    if(u) {
                        let hist = u.history.find(h => h.sn === reqData.trx_id);
                        if(hist && hist.status === 'Pending') { hist.status = 'Gagal (Kedaluwarsa)'; saveRecord('users', reqData.phone, u); }
                    }
                } 
                // 2. Jika Masih Berjalan -> Hit API Cek Status Fallback
                else {
                    try {
                        let checkRes = await axios.post('https://v1-gateway.autogopay.site/qris/status', {
                            transaction_id: reqData.autogopay_trx_id
                        }, { headers: { 'Authorization': `Bearer ${cfg.gopayToken}`, 'Content-Type': 'application/json' }});

                        if (checkRes.data && checkRes.data.data) {
                            let statusPusat = checkRes.data.data.transaction_status;
                            if (statusPusat === 'settlement') {
                                if (markTopupSuccess(key)) {
                                    reqData.status = 'sukses';
                                    saveRecord('topup', key, reqData);
                                    
                                    let u = getRecord('users', reqData.phone);
                                    if(u) {
                                        if (!reqData.is_order) {
                                            let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Sukses', sn: reqData.trx_id, amount: reqData.amount_to_pay, qris_url: '' };
                                            atomicAddBalance(reqData.phone, reqData.saldo_to_add, histObj);
                                            
                                            u = getRecord('users', reqData.phone);
                                            let emailUser = u.email || '-';
                                            let namaUser = u.username || reqData.phone;
                                            let teleMsg = `✅ <b>TOPUP QRIS SUKSES MASUK (FALLBACK)</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${reqData.phone}\n💰 Saldo Masuk: Rp ${(reqData.saldo_to_add ? reqData.saldo_to_add.toLocaleString('id-ID') : '0')}\n🔖 Ref: ${reqData.trx_id}\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                                            sendTelegramAdmin(teleMsg);
                                        } else {
                                            atomicAddBalance(reqData.phone, reqData.saldo_to_add, null);
                                            if(reqData.vpn_data) {
                                                let nominalBeliVpn = parseInt(reqData.harga_asli);
                                                try { atomicDeductBalance(reqData.phone, nominalBeliVpn); } catch(err) { }
                                                prosesAutoOrderVPN(reqData.phone, reqData.vpn_data, reqData.trx_id);
                                            } else {
                                                let nominalBeli = parseInt(reqData.harga_asli);
                                                try { atomicDeductBalance(reqData.phone, nominalBeli); } catch(err) { }
                                                prosesAutoOrderQRIS(reqData.phone, reqData.sku, reqData.tujuan, reqData.nama_produk, reqData.harga_asli, reqData.trx_id);
                                            }
                                        }
                                    }
                                }
                            } else if (statusPusat === 'cancel' || statusPusat === 'expire') {
                                reqData.status = 'gagal'; saveRecord('topup', key, reqData);
                                let u = getRecord('users', reqData.phone);
                                if(u) {
                                    let hist = u.history.find(h => h.sn === reqData.trx_id);
                                    if(hist && hist.status === 'Pending') { hist.status = 'Gagal (Dibatalkan)'; saveRecord('users', reqData.phone, u); }
                                }
                            }
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {
            console.log("Error cek Fallback QRIS AutoGoPay:", e.message);
        }
        isCheckingQris = false;
    }, 30000); 

    // ==============================================================
    // AUTOGOPAY WEBHOOK ENDPOINT
    // ==============================================================
    app.post('/webhook/gopay', async (req, res) => {
        try {
            if (!req.rawBody) {
                return res.status(400).send('Bad Request: No rawBody provided');
            }

            let config = getRecord('config', 'main') || {};
            let signature = req.headers['x-signature'];
            
            if (!signature || !config.gopayToken) {
                return res.status(401).json({ success: false, message: 'Invalid signature or token missing' });
            }

            const expectedSignature = crypto.createHmac('sha256', config.gopayToken).update(req.rawBody).digest('hex');
            if (signature !== expectedSignature) {
                return res.status(401).json({ success: false, message: 'Invalid signature' });
            }

            const body = req.body;
            
            if (body.event === 'verification.challenge') {
                return res.json({ success: true });
            }

            if (body.event === 'transaction.received') {
                const trx = body.transaction;
                if (trx.status === 'settlement') {
                    // Temukan Trx di DB Topup lokal
                    let allTopups = getAllRecords('topup');
                    let targetKey = Object.keys(allTopups).find(k => allTopups[k].autogopay_trx_id === trx.id && allTopups[k].status === 'pending');
                    
                    if (targetKey) {
                        if (markTopupSuccess(targetKey)) {
                            let reqData = getRecord('topup', targetKey);
                            reqData.status = 'sukses';
                            saveRecord('topup', targetKey, reqData);
                            
                            let u = getRecord('users', reqData.phone);
                            if(u) {
                                if (!reqData.is_order) {
                                    let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Topup', nama: 'Topup Saldo QRIS', tujuan: 'Sistem Pembayaran', status: 'Sukses', sn: reqData.trx_id, amount: reqData.amount_to_pay, qris_url: '' };
                                    atomicAddBalance(reqData.phone, reqData.saldo_to_add, histObj);
                                    
                                    u = getRecord('users', reqData.phone);
                                    let emailUser = u.email || '-';
                                    let namaUser = u.username || reqData.phone;
                                    let teleMsg = `✅ <b>TOPUP QRIS SUKSES MASUK (WEBHOOK)</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${reqData.phone}\n💰 Saldo Masuk: Rp ${(reqData.saldo_to_add ? reqData.saldo_to_add.toLocaleString('id-ID') : '0')}\n🔖 Ref: ${reqData.trx_id}\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                                    sendTelegramAdmin(teleMsg);
                                } else {
                                    atomicAddBalance(reqData.phone, reqData.saldo_to_add, null);
                                    if(reqData.vpn_data) {
                                        let nominalBeliVpn = parseInt(reqData.harga_asli);
                                        try { atomicDeductBalance(reqData.phone, nominalBeliVpn); } catch(err) { }
                                        prosesAutoOrderVPN(reqData.phone, reqData.vpn_data, reqData.trx_id);
                                    } else {
                                        let nominalBeli = parseInt(reqData.harga_asli);
                                        try { atomicDeductBalance(reqData.phone, nominalBeli); } catch(err) { }
                                        prosesAutoOrderQRIS(reqData.phone, reqData.sku, reqData.tujuan, reqData.nama_produk, reqData.harga_asli, reqData.trx_id);
                                    }
                                }
                            }
                        }
                    }
                }
                return res.json({ success: true });
            }
            return res.json({ success: true });
        } catch (error) {
            console.error('Webhook AutoGoPay Error:', error.message);
            return res.status(500).json({ success: false });
        }
    });

    // Webhook Endpoint Digiflazz Pengganti Sistem Polling
    app.post('/api/webhook', (req, res) => {
        try {
            let config = getRecord('config', 'main') || {};
            let secret = config.webhookSecret;
            if (!secret) return res.status(403).json({success: false, message: 'Secret webhook belum diatur admin.'});

            let signature = req.headers['x-hub-signature'];
            if (!signature) return res.status(403).json({success: false, message: 'No signature found'});

            // BUG 18 FIX: Menghindari error HMAC jika rawBody undefined
            let hmac = crypto.createHmac('sha1', secret).update(req.rawBody || '').digest('hex');
            let expectedSignature = 'sha1=' + hmac;

            if (signature !== expectedSignature) {
                return res.status(403).json({success: false, message: 'Invalid signature'});
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

            let trx = getRecord('trx', refId);
            if (!trx) return res.status(200).send('OK - No Trx'); 

            let phoneKey = trx.phone || trx.jid.split('@')[0];
            let u = getRecord('users', phoneKey);
            if (!u) {
                deleteRecord('trx', refId);
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
                        saveRecord('users', phoneKey, u); 
                        wasNotSuccess = true;
                    }
                }
                
                if (wasNotSuccess) {
                    let dateKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
                    let gStats = getRecord('global_stats', dateKey) || 0;
                    saveRecord('global_stats', dateKey, gStats + 1);
                    
                    let timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
                    unshiftRecordArray('global_trx', { time: timeStr, product: trx.nama, user: namaUser, target: maskStringTarget(trx.tujuan), price: parseInt(trx.harga), method: 'Sistem Otomatis' });

                    sendBroadcastSuccess(trx.nama, namaUser, trx.tujuan, parseInt(trx.harga), 'Sistem Otomatis');

                    let teleSuccess = `✅ <b>PESANAN SUKSES</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phoneKey}\n📦 Produk: ${trx.nama}\n🎯 Tujuan: ${trx.tujuan}\n🔖 Ref: ${refId}\n🔑 SN: ${sn}\n💳 Saldo Terkini: Rp ${(u.saldo ? u.saldo.toLocaleString('id-ID') : '0')}`;
                    sendTelegramAdmin(teleSuccess);
                }
                deleteRecord('trx', refId);

            } else if (statusOrder === 'Gagal') {
                let histObj = { ts: Date.now(), tanggal: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), type: 'Refund', nama: 'Refund: ' + trx.nama, tujuan: trx.tujuan, status: 'Refund', sn: '-', amount: parseInt(trx.harga), ref_id: refId };
                let uRefund = atomicRefundBalance(phoneKey, parseInt(trx.harga), histObj);
                
                if (globalSock) {
                    let hargaTrxFallback = parseInt(trx.harga) || 0;
                    globalSock.sendMessage(trx.jid, { text: `❌ *PESANAN GAGAL & DI-REFUND*\n\nMaaf pesanan ${trx.nama} tujuan ${trx.tujuan} gagal diproses pusat.\nAlasan: ${message}\n\n💰 Saldo Rp ${(hargaTrxFallback ? hargaTrxFallback.toLocaleString('id-ID') : '0')} telah dikembalikan utuh ke akun Anda.` }).catch(e=>{});
                }
                
                let teleFail = `❌ <b>PESANAN GAGAL & REFUND</b>\n\n👤 Username: ${namaUser}\n📧 Email: ${emailUser}\n📱 WA: ${phoneKey}\n📦 Produk: ${trx.nama}\n🎯 Tujuan: ${trx.tujuan}\n🔖 Ref: ${refId}\n📝 Alasan: ${message}\n\n💰 Saldo telah otomatis dikembalikan.`;
                sendTelegramAdmin(teleFail);
                
                deleteRecord('trx', refId);
            }

            res.status(200).send('OK');
        } catch (err) {
            res.status(500).send('Error webhook processing');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0]; if (!msg.message || msg.key.fromMe) return;
            const from = msg.key.remoteJid; const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            const sender = senderJid.split('@')[0]; const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (!body) return;

            let u = getRecord('users', sender);
            if (!u) { 
                u = { saldo: 0, tanggal_daftar: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), jid: senderJid, step: 'idle', trx_count:0, history:[]}; 
                saveRecord('users', sender, u); 
            }
        } catch (err) {}
    });
}

async function tarikDataLayananOtomatis() {
    try {
        let config = getRecord('config', 'main') || {};
        let namaPengguna = (config.digiflazzUsername || '').trim();
        let kunciAkses = (config.digiflazzApiKey || '').trim();
        if (!namaPengguna || !kunciAkses) return;

        let tandaPengenal = crypto.createHash('md5').update(namaPengguna + kunciAkses + 'pricelist').digest('hex');
        
        let dataPrepaid = [];
        let dataPasca = [];

        try {
            const balasanPrepaid = await axios.post('https://api.digiflazz.com/v1/price-list', {
                cmd: 'prepaid', username: namaPengguna, sign: tandaPengenal
            });
            dataPrepaid = balasanPrepaid.data.data || [];
        } catch (e) {
            console.log('\x1b[33m⚠️ Gagal menarik data Prepaid Digiflazz.\x1b[0m');
        }
        
        try {
            const balasanPasca = await axios.post('https://api.digiflazz.com/v1/price-list', {
                cmd: 'pasca', username: namaPengguna, sign: tandaPengenal
            });
            dataPasca = balasanPasca.data.data || [];
        } catch (e) {
            console.log('\x1b[33m⚠️ Gagal menarik data Pascabayar Digiflazz.\x1b[0m');
        }

        if (!Array.isArray(dataPrepaid)) dataPrepaid = [];
        if (!Array.isArray(dataPasca)) dataPasca = [];

        if (dataPrepaid.length === 0 && dataPasca.length === 0) {
            console.log('\x1b[33m⚠️ Data produk dari Digiflazz kosong. Sinkronisasi dibatalkan untuk mencegah hilangnya database lokal.\x1b[0m');
            return;
        }

        dataPrepaid = dataPrepaid.map(item => ({ ...item, is_pasca_api: false }));
        dataPasca = dataPasca.map(item => ({ ...item, is_pasca_api: true }));

        let daftarPusat = dataPrepaid.concat(dataPasca);
        let produkLama = getAllRecords('produk');
        let daftarLokal = {};
        let m = config.margin || { t1:50, t2:100, t3:250, t4:500, t5:1000, t6:1500, t7:2000, t8:2500, t9:3000, t10:4000, t11:5000, t12:7500, t13:10000 };
        
        Object.keys(produkLama).forEach(k => {
            if(produkLama[k].is_manual_cat) daftarLokal[k] = produkLama[k];
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
                    sku_asli: kodeBarang,
                    nama: namaBarang,
                    harga: finalPrice,
                    kategori: kategoriBarang,
                    brand: item.brand || 'Lainnya',
                    sub_kategori: item.type || 'Umum',
                    deskripsi: item.desc || 'Proses Otomatis',
                    status_produk: statusProduk,
                    is_manual_cat: false
                };
            }
        });

        dbSqlite.prepare("DELETE FROM produk").run();
        for(let k in daftarLokal) saveRecord('produk', k, daftarLokal[k]);

        console.log('\x1b[32m✅ Data Produk Digiflazz Berhasil Tersinkronisasi ke SQLite!\x1b[0m');

    } catch(err) {
        let errorMsg = err.response && err.response.data && err.response.data.data ? err.response.data.data.message : err.message;
        console.log('\x1b[31m❌ Gagal Sinkronisasi Digiflazz.\x1b[0m Alasan:', errorMsg); 
    }
}
// ==============================================================
// ENDPOINT: INTERNAL BROADCAST (Dengan Dukungan Gambar/Video)
// ==============================================================
app.post('/api/internal/broadcast', (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Keamanan: Hanya izinkan akses dari localhost VPS
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        return res.status(403).json({success: false, message: 'Akses ditolak.'});
    }

    try {
        let { title, text, media_url, media_type } = req.body;
        let cfg = getRecord('config', 'main') || {};

        // 1. Simpan ke Pemberitahuan Website (web_notif)
        let dateStr = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) + ' WIB';
        
        let webImage = (media_type === 'image' && media_url && !media_url.startsWith('http')) ? media_url : '';
        let notifData = { title: title || '📢 Pemberitahuan Baru', text: text, date: dateStr, image: webImage };
        dbSqlite.prepare("INSERT INTO web_notif (data) VALUES (?)").run(JSON.stringify(notifData));


        // 2. Kirim ke Channel Telegram
        if (cfg.teleTokenInfo && cfg.teleChannelId) {
            let channelIdStr = cfg.teleChannelId.toString();
            if (!channelIdStr.startsWith('-100') && !channelIdStr.startsWith('@')) channelIdStr = '-100' + channelIdStr;

            let teleCaption = `📢 <b>${title}</b>\n\n${text}`;
            let teleApiUrl = `https://api.telegram.org/bot${cfg.teleTokenInfo}`;

            if (media_type === 'image' && media_url) {
                axios.post(`${teleApiUrl}/sendPhoto`, { chat_id: channelIdStr, photo: media_url, caption: teleCaption, parse_mode: 'HTML' }).catch(e=>{});
            } else if (media_type === 'video' && media_url) {
                axios.post(`${teleApiUrl}/sendVideo`, { chat_id: channelIdStr, video: media_url, caption: teleCaption, parse_mode: 'HTML' }).catch(e=>{});
            } else {
                axios.post(`${teleApiUrl}/sendMessage`, { chat_id: channelIdStr, text: teleCaption, parse_mode: 'HTML' }).catch(e=>{});
            }
        }

        // 3. Kirim ke Saluran / Grup WhatsApp
        if (globalSock && cfg.waBroadcastId) {
            let waCaption = `*${title.toUpperCase()}*\n\n${text}`;
            let waPayload = {};

            if (media_type === 'image' && media_url) {
                waPayload = { image: { url: media_url }, caption: waCaption };
            } else if (media_type === 'video' && media_url) {
                waPayload = { video: { url: media_url }, caption: waCaption };
            } else {
                waPayload = { text: waCaption };
            }

            globalSock.sendMessage(cfg.waBroadcastId, waPayload).catch(e => { console.error("Gagal broadcast WA:", e.message); });
        }

        res.json({success: true, message: 'Broadcast terkirim ke semua platform.'});
    } catch(e) {
        res.json({success: false, message: e.message});
    }
});

app.get('/api/sync-digiflazz', async (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        return res.status(403).json({success: false, message: 'Akses ditolak.'});
    }
    await tarikDataLayananOtomatis();
    res.json({success: true, message: 'Sinkronisasi Selesai.'});
});

setInterval(tarikDataLayananOtomatis, 30 * 60 * 1000);
setTimeout(tarikDataLayananOtomatis, 10000);

if (require.main === module) {
    app.listen(3000, '0.0.0.0', () => { console.log('\x1b[32m🌐 SERVER WEB AKTIF (PORT 3000).\x1b[0m'); });
    startBot().catch(err => {});
}
