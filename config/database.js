const Database = require('better-sqlite3');
const path = require('path');

// Inisialisasi database di root project
const dbPath = path.resolve(__dirname, '../tendo_database.db');
const dbSqlite = new Database(dbPath);

// Eksekusi PRAGMA untuk optimasi performa SQLite
dbSqlite.pragma('journal_mode = WAL');
dbSqlite.pragma('busy_timeout = 5000');
dbSqlite.pragma('synchronous = NORMAL');

// Setup Table sesuai struktur bawaan
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
`);

// ==============================================================
// SQLITE CRUD HELPERS (Logika Asli Dipertahankan)
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
    for (let r of rows) res[r.id] = JSON.parse(r.data);
    return res;
}

function getAllRecordsArray(table, limit = 100) {
    if (table === 'tutorial') {
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

// ==============================================================
// SQLITE ATOMIC TRANSACTIONS (MENCEGAH RACE CONDITION)
// ==============================================================
const atomicDeductBalance = dbSqlite.transaction((phone, amount) => {
    const row = dbSqlite.prepare(`SELECT data FROM users WHERE id = ?`).get(phone);
    if (!row) throw new Error("User tidak valid.");
    
    let u = JSON.parse(row.data);
    let hargaFix = parseInt(amount);
    
    if (parseInt(u.saldo) < hargaFix) {
        throw new Error("Saldo tidak cukup.");
    }
    
    u.saldo = parseInt(u.saldo) - hargaFix;
    dbSqlite.prepare(`UPDATE users SET data = ? WHERE id = ?`).run(JSON.stringify(u), phone);
    
    return { saldoTerkini: u.saldo, uData: u };
});

const atomicRefundBalance = dbSqlite.transaction((phone, amount, historyObj = null) => {
    const row = dbSqlite.prepare(`SELECT data FROM users WHERE id = ?`).get(phone);
    if (!row) return null;
    
    let u = JSON.parse(row.data);
    let saldoSebelum = parseInt(u.saldo);
    u.saldo = saldoSebelum + parseInt(amount);
    
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
    let saldoSebelum = parseInt(u.saldo);
    u.saldo = saldoSebelum + parseInt(amount);
    
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

module.exports = {
    dbSqlite,
    getRecord,
    saveRecord,
    deleteRecord,
    getAllRecords,
    getAllRecordsArray,
    unshiftRecordArray,
    atomicDeductBalance,
    atomicRefundBalance,
    atomicAddBalance
};
# === SELESAI ===
      
