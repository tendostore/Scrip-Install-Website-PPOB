process.env.TZ = 'Asia/Jakarta';
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

// Inisialisasi Express
const app = express();
app.disable('x-powered-by');

// SECURITY: Memblokir akses langsung file konfigurasi JSON/DB lewat URL
app.use((req, res, next) => {
    if ((req.path.endsWith('.json') && !req.path.endsWith('manifest.json')) || req.path.endsWith('.db') || req.path.endsWith('.bak')) {
        return res.status(403).json({ success: false, message: 'Akses Ditolak (Sistem Keamanan Tendo)' });
    }
    next();
});

// Modifikasi body-parser untuk mendapatkan rawBody demi validasi Webhook HMAC SHA1 Digiflazz
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Setup Static Files untuk Frontend
app.use(express.static(path.join(__dirname, 'public')));

// ==============================================================
// IMPORT ROUTES & SERVICES (Placeholder untuk file selanjutnya)
// ==============================================================
// const apiRoutes = require('./routes/api');
// const botService = require('./services/bot');
// const cronService = require('./services/cron');

// Mount Routes
// app.use('/api', apiRoutes);

// ==============================================================
// SERVER INITIALIZATION
// ==============================================================
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[32m🌐 SERVER WEB AKTIF (PORT ${PORT}).\x1b[0m`);
        
        // Memulai Bot WA dan Cron Jobs (Akan diaktifkan nanti)
        // botService.startBot().catch(err => console.error(err));
        // cronService.initCrons();
    });
}

module.exports = app;
# === SELESAI ===
  
