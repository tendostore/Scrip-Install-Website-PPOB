const express = require('express');
const fs = require('fs');
const db = require('../config/database');

const router = express.Router();

router.get('/banners', (req, res) => {
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

router.get('/stats', (req, res) => {
    try {
        let gStats = db.getAllRecords('global_stats');
        let cfg = db.getRecord('config', 'main') || {};
        let daily = 0, weekly = 0, monthly = 0, total = 0;
        
        let now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        let nowYear = now.getFullYear();
        let nowMonth = now.getMonth();
        let nowString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        
        let day = now.getDay() || 7; 
        let monday = new Date(now);
        monday.setDate(now.getDate() - day + 1);
        monday.setHours(0,0,0,0);

        for (let k in gStats) {
            let count = gStats[k];
            total += count;
            let recordDate = new Date(k + 'T00:00:00+07:00');
            if (k === nowString) daily += count;
            if (recordDate >= monday) weekly += count;
            if (recordDate.getFullYear() === nowYear && recordDate.getMonth() === nowMonth) monthly += count;
        }
        res.json({ 
            success: true, daily, weekly, monthly, total, 
            maintStart: cfg.maintStart || '23:00', maintEnd: cfg.maintEnd || '00:30',
            adminWa: cfg.botNumber || "6282224460678"
        });
    } catch(e) { res.json({ success: false, daily: 0, weekly: 0, monthly: 0, total: 0 }); }
});

router.get('/produk', (req, res) => { 
    res.json(db.getAllRecords('produk')); 
});

router.get('/leaderboard', (req, res) => {
    try {
        let users = db.getAllRecords('users');
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

router.get('/notif', (req, res) => { 
    res.json(db.getAllRecordsArray('web_notif')); 
});

router.get('/global-trx', (req, res) => { 
    res.json(db.getAllRecordsArray('global_trx')); 
});

router.get('/custom-layout', (req, res) => { 
    res.json({ success: true, data: db.getRecord('custom_layout', 'main') || { sections: [] } }); 
}); 

router.get('/tutorials', (req, res) => { 
    res.json(db.getAllRecordsArray('tutorial')); 
});

router.get('/vpn-config', (req, res) => {
    try {
        let vpn = db.getRecord('vpn_config', 'main') || {};
        let safeConfig = JSON.parse(JSON.stringify(vpn));
        if (safeConfig.servers) {
            for (let srv in safeConfig.servers) {
                delete safeConfig.servers[srv].pass;
                delete safeConfig.servers[srv].user;
                delete safeConfig.servers[srv].api_key;
                delete safeConfig.servers[srv].port;
            }
        }
        res.json({ success: true, data: safeConfig });
    } catch(e) { res.json({ success: false }); }
});

module.exports = router;
# === SELESAI ===
             
