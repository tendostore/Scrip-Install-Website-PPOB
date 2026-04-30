const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { verifyToken, SECRET_KEY } = require('../middleware/auth');
const { normalizePhone, sanitizeInput, hashPassword } = require('../utils/helpers');
const appEvents = require('../utils/events'); // Event emitter untuk Bot WA (akan dibuat nanti)

const router = express.Router();

// State Memory (Rate Limiting & OTP)
let tempOtpDB = {}; 
let otpCooldown = {}; 
let loginAttempts = {}; 
let ipOtpLimit = {};

// Clean up state memory secara berkala
setInterval(() => {
    let nowTime = Date.now();
    for (let key in loginAttempts) { if (nowTime - loginAttempts[key].time > 3600000) delete loginAttempts[key]; }
    for (let key in ipOtpLimit) { if (nowTime - ipOtpLimit[key].time > 600000) delete ipOtpLimit[key]; }
}, 6 * 60 * 60 * 1000);

router.post('/login', (req, res) => {
    try {
        let idRaw = (req.body.id || '').trim();
        let id = sanitizeInput(idRaw);
        let password = req.body.password;
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        let limitKey = ip + '_' + id;
        if (loginAttempts[limitKey] && loginAttempts[limitKey].count >= 5) {
            if (Date.now() - loginAttempts[limitKey].time < 300000) {
                return res.json({ success: false, message: 'Terlalu banyak percobaan login gagal. Harap tunggu 5 menit.' });
            } else {
                loginAttempts[limitKey] = { count: 0, time: Date.now() };
            }
        }

        let hashedInput = hashPassword(password);
        let normInput = normalizePhone(id);
        
        // Optimasi Pencarian User: Cek via Key (Phone) Dulu
        let uDirect = db.getRecord('users', normInput) || db.getRecord('users', id);
        let userPhone = null;

        if (uDirect && (uDirect.password === password || uDirect.password === hashedInput)) {
            userPhone = uDirect.jid ? uDirect.jid.split('@')[0] : (db.getRecord('users', normInput) ? normInput : id);
            if (uDirect.password === password) { 
                uDirect.password = hashedInput; 
                db.saveRecord('users', userPhone, uDirect); 
            }
        } else {
            // Pencarian via Email/Username jika Phone gagal
            let users = db.getAllRecords('users');
            userPhone = Object.keys(users).find(k => {
                let usr = users[k];
                if (!usr) return false;
                let matchId = (usr.email && usr.email.toLowerCase() === id.toLowerCase()) || 
                              (usr.username && usr.username.toLowerCase() === id.toLowerCase());
                if (!matchId) return false;
                if (usr.password === password || usr.password === hashedInput) {
                    if (usr.password === password) { usr.password = hashedInput; db.saveRecord('users', k, usr); }
                    return true;
                }
                return false;
            });
        }

        if (userPhone) {
            delete loginAttempts[limitKey]; // Reset rate limit on success
            let uFinal = db.getRecord('users', userPhone);
            let safeData = { ...uFinal }; delete safeData.password;
            const token = jwt.sign({ phone: userPhone }, SECRET_KEY, { expiresIn: '1d' });
            res.json({ success: true, phone: userPhone, data: safeData, token: token });
        } else {
            loginAttempts[limitKey] = loginAttempts[limitKey] || { count: 0, time: Date.now() };
            loginAttempts[limitKey].count += 1;
            res.json({ success: false, message: 'Data Akun (Email/WA/Username) atau Password salah!' });
        }
    } catch(e) { res.json({ success: false, message: 'Server error' }); }
});

router.post('/logout', verifyToken, (req, res) => {
    try {
        db.dbSqlite.prepare(`INSERT OR IGNORE INTO jwt_blacklist (id) VALUES (?)`).run(req.token);
        res.json({ success: true, message: 'Berhasil logout.' });
    } catch(e) { res.json({ success: false }); }
});

router.post('/register', (req, res) => {
    try {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        ipOtpLimit[ip] = ipOtpLimit[ip] || { count: 0, time: Date.now() };
        if (Date.now() - ipOtpLimit[ip].time > 600000) { ipOtpLimit[ip] = { count: 1, time: Date.now() }; } 
        else { ipOtpLimit[ip].count++; }
        if (ipOtpLimit[ip].count > 3) return res.json({ success: false, message: 'Terlalu banyak request dari IP Anda. Tunggu 10 menit.' });

        let username = sanitizeInput(req.body.username);
        let email = sanitizeInput(req.body.email);
        let password = req.body.password;
        let phone = normalizePhone(req.body.phone); 
        
        if (!phone || phone.length < 9) return res.json({ success: false, message: 'Nomor WA tidak valid!' });
        if (otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({ success: false, message: 'Tunggu 1 menit untuk request OTP lagi!' });
        otpCooldown[phone] = Date.now();
        
        let users = db.getAllRecords('users');
        let isEmailExist = Object.values(users).some(u => u && u.email && u.email.toLowerCase() === email.toLowerCase());
        if (isEmailExist) return res.json({ success: false, message: 'Email terdaftar!' });
        
        let isUsernameExist = Object.values(users).some(u => u && u.username && u.username.toLowerCase() === username.toLowerCase());
        if (isUsernameExist) return res.json({ success: false, message: 'Username sudah digunakan!' });

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        tempOtpDB[phone] = { username, email, password: hashPassword(password), otp, attempts: 0 };
        
        // Auto-delete OTP setelah 5 menit (Cegah Memory Leak)
        setTimeout(() => { if (tempOtpDB[phone]) delete tempOtpDB[phone]; }, 300000);

        res.json({ success: true });
        
        // Emit event untuk mengirim OTP via Bot WA
        appEvents.emit('send-otp', phone, `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nHai ${username},\nKode OTP Pendaftaran: *${otp}*\n\n_⚠️ Jangan bagikan kode ini!_`);

    } catch(e) { if (!res.headersSent) res.json({ success: false, message: 'Gagal memproses pendaftaran.' }); }
});

router.post('/verify-otp', (req, res) => {
    try {
        let otp = req.body.otp; let phone = normalizePhone(req.body.phone);
        let session = tempOtpDB[phone];
        if (!session) return res.json({ success: false, message: 'Sesi pendaftaran kadaluwarsa. Silakan request OTP ulang.' });

        if (session.otp === otp) {
            let idPelanggan = 'TD-' + Math.floor(100000 + Math.random() * 900000); 
            let u = db.getRecord('users', phone) || { 
                id_pelanggan: idPelanggan, saldo: 0, 
                tanggal_daftar: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), 
                jid: phone + '@s.whatsapp.net', step: 'idle', trx_count: 0, history: [] 
            };
            
            u.username = session.username; 
            u.email = session.email; 
            u.password = session.password;
            if (!u.id_pelanggan) u.id_pelanggan = idPelanggan;
            
            db.saveRecord('users', phone, u); 
            delete tempOtpDB[phone]; 
            res.json({ success: true });
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
                delete tempOtpDB[phone];
                return res.json({ success: false, message: 'Sesi diblokir, silakan request OTP ulang.' });
            }
            res.json({ success: false, message: 'Kode OTP Salah!' });
        }
    } catch(e) { res.json({ success: false, message: 'Server error' }); }
});

router.post('/req-edit-otp', verifyToken, (req, res) => {
    try {
        let { phone, type, newValue } = req.body; 
        let u = db.getRecord('users', phone);
        if (!u) return res.json({ success: false, message: 'User tidak ditemukan.' });
        if (otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({ success: false, message: 'Tunggu 1 menit untuk request OTP lagi!' });
        otpCooldown[phone] = Date.now();

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        if (type === 'password') newValue = hashPassword(newValue);
        tempOtpDB[phone + '_edit'] = { type, newValue, otp, attempts: 0 };
        
        setTimeout(() => { if (tempOtpDB[phone + '_edit']) delete tempOtpDB[phone + '_edit']; }, 300000);
        res.json({ success: true });

        appEvents.emit('send-otp', phone, `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nKode OTP perubahan data: *${otp}*\n\n_⚠️ Jangan berikan ke siapapun!_`);
    } catch(e) { if (!res.headersSent) res.json({ success: false, message: 'Gagal memproses OTP.' }); }
});

router.post('/verify-edit-otp', verifyToken, (req, res) => {
    try {
        let { phone, otp } = req.body; let session = tempOtpDB[phone + '_edit'];
        if (!session) return res.json({ success: false, message: 'Sesi kadaluwarsa, silakan request ulang.' });

        if (session.otp === otp) {
            let u = db.getRecord('users', phone);
            if (session.type === 'email') u.email = session.newValue;
            if (session.type === 'password') u.password = session.newValue;
            if (session.type === 'phone') {
                let newPhone = normalizePhone(session.newValue);
                let existU = db.getRecord('users', newPhone);
                if (existU) return res.json({ success: false, message: 'Nomor sudah dipakai akun lain.' });
                u.jid = newPhone + '@s.whatsapp.net';
                db.saveRecord('users', newPhone, u);
                db.deleteRecord('users', phone);
            } else {
                db.saveRecord('users', phone, u);
            }
            delete tempOtpDB[phone + '_edit']; res.json({ success: true });
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
                delete tempOtpDB[phone + '_edit'];
                return res.json({ success: false, message: 'Sesi diblokir, silakan request OTP ulang.' });
            }
            res.json({ success: false, message: 'OTP Salah!' });
        }
    } catch(e) { res.json({ success: false, message: 'Server error' }); }
});

router.post('/req-forgot-otp', (req, res) => {
    try {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        ipOtpLimit[ip] = ipOtpLimit[ip] || { count: 0, time: Date.now() };
        if (Date.now() - ipOtpLimit[ip].time > 600000) { ipOtpLimit[ip] = { count: 1, time: Date.now() }; } 
        else { ipOtpLimit[ip].count++; }
        if (ipOtpLimit[ip].count > 3) return res.json({ success: false, message: 'Terlalu banyak request dari IP Anda. Tunggu 10 menit.' });

        let phone = normalizePhone(req.body.phone);
        let u = db.getRecord('users', phone);
        if (!u) return res.json({ success: false, message: 'Nomor WA tidak terdaftar!' });
        if (otpCooldown[phone] && Date.now() - otpCooldown[phone] < 60000) return res.json({ success: false, message: 'Tunggu 1 menit untuk request OTP lagi!' });
        otpCooldown[phone] = Date.now();

        let otp = Math.floor(1000 + Math.random() * 9000).toString();
        tempOtpDB[phone + '_forgot'] = { otp, attempts: 0 };
        
        setTimeout(() => { if (tempOtpDB[phone + '_forgot']) delete tempOtpDB[phone + '_forgot']; }, 300000);
        res.json({ success: true });

        appEvents.emit('send-otp', phone, `*🛡️ DIGITAL TENDO STORE 🛡️*\n\nPermintaan Reset Password.\nKode OTP: *${otp}*\n\n_⚠️ Abaikan jika bukan Anda!_`);
    } catch(e) { if (!res.headersSent) res.json({ success: false, message: 'Gagal memproses OTP.' }); }
});

router.post('/verify-forgot-otp', (req, res) => {
    try {
        let phone = normalizePhone(req.body.phone); let { otp, newPass } = req.body;
        let session = tempOtpDB[phone + '_forgot'];
        if (!session) return res.json({ success: false, message: 'Sesi OTP tidak ditemukan atau sudah expired.' });

        if (session.otp === otp) {
            let u = db.getRecord('users', phone);
            if (u) { u.password = hashPassword(newPass); db.saveRecord('users', phone, u); }
            delete tempOtpDB[phone + '_forgot']; res.json({ success: true });
        } else {
            session.attempts = (session.attempts || 0) + 1;
            if (session.attempts >= 3) {
                delete tempOtpDB[phone + '_forgot'];
                return res.json({ success: false, message: 'Sesi diblokir, silakan request OTP ulang.' });
            }
            res.json({ success: false, message: 'Kode OTP Salah!' });
        }
    } catch(e) { res.json({ success: false, message: 'Server error' }); }
});

module.exports = router;
# === SELESAI ===
              
