const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const { normalizePhone } = require('../utils/helpers');

// ==============================================================
// DYNAMIC SECRET KEY (JWT)
// ==============================================================
let cfgJwt = db.getRecord('config', 'main') || {};
if (!cfgJwt.jwt_secret) {
    cfgJwt.jwt_secret = crypto.randomBytes(64).toString('hex');
    db.saveRecord('config', 'main', cfgJwt);
}
const SECRET_KEY = cfgJwt.jwt_secret;

// ==============================================================
// MIDDLEWARE JWT VERIFY
// ==============================================================
const verifyToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        const token = bearer[1];
        
        // Cek Blacklist Token (Logout)
        const isBlacklisted = db.dbSqlite.prepare(`SELECT id FROM jwt_blacklist WHERE id = ?`).get(token);
        if (isBlacklisted) return res.status(403).json({ success: false, message: 'Token telah di-logout (Blacklist). Silakan login ulang.' });

        jwt.verify(token, SECRET_KEY, (err, authData) => {
            if (err) return res.status(403).json({ success: false, message: 'Token kedaluwarsa atau tidak valid. Silakan login ulang.' });
            
            // Validasi Nomor HP di req.body & req.params (Mencegah Bypass Sesi Antar User)
            if (req.body && req.body.phone) {
                if (normalizePhone(req.body.phone) !== authData.phone) {
                    return res.status(403).json({ success: false, message: 'Akses Ditolak (Sesi Body tidak cocok).' });
                }
            }
            if (req.params && req.params.phone) {
                if (normalizePhone(req.params.phone) !== authData.phone) {
                    return res.status(403).json({ success: false, message: 'Akses Ditolak (Sesi Parameter tidak cocok).' });
                }
            }
            
            req.authData = authData;
            req.token = token;
            next();
        });
    } else {
        res.status(403).json({ success: false, message: 'Akses Ditolak. Token Otorisasi diperlukan.' });
    }
};

module.exports = {
    SECRET_KEY,
    verifyToken
};
# === SELESAI ===
  
