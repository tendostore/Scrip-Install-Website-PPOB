const crypto = require('crypto');
const db = require('../config/database');

function normalizePhone(phoneStr) {
    if (!phoneStr) return '';
    let num = phoneStr.replace(/[^0-9]/g, '');
    if (num.startsWith('0')) return '62' + num.substring(1);
    return num;
}

function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const hashPassword = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

function maskStringTarget(str) {
    if (!str) return '-';
    let s = str.toString().trim();
    if (s.length <= 3) return s;
    return '*'.repeat(s.length - 3) + s.substring(s.length - 3);
}

function cekPemeliharaan() {
    let cfg = db.getRecord('config', 'main') || {};
    let s = cfg.maintStart || "23:00";
    let e = cfg.maintEnd || "00:30";
    let d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    let h = d.getHours(); let m = d.getMinutes();
    let curMins = h * 60 + m;
    let sParts = s.split(':'); let eParts = e.split(':');
    let sMins = parseInt(sParts[0]) * 60 + parseInt(sParts[1]);
    let eMins = parseInt(eParts[0]) * 60 + parseInt(eParts[1]);
    
    if (sMins < eMins) return (curMins >= sMins && curMins < eMins);
    else return (curMins >= sMins || curMins < eMins);
}

module.exports = {
    normalizePhone,
    sanitizeInput,
    hashPassword,
    maskStringTarget,
    cekPemeliharaan
};
# === SELESAI ===
  
