const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

async function getSaldo() {
    try {
        let config = {};
        if (fs.existsSync('tendo_database.db')) {
            const Database = require('better-sqlite3');
            const db = new Database('tendo_database.db', { readonly: true });
            let row = db.prepare("SELECT data FROM config WHERE id = 'main'").get();
            if (row) config = JSON.parse(row.data);
        }
        let user = config.digiflazzUsername || '';
        let key = config.digiflazzApiKey || '';
        if(!user || !key) return console.log('Rp 0 (API Belum Diatur)');
        let sign = crypto.createHash('md5').update(user + key + 'depo').digest('hex');
        let res = await axios.post('https://api.digiflazz.com/v1/cek-saldo', {
            cmd: 'deposit', username: user, sign: sign
        });
        console.log('Rp ' + res.data.data.deposit.toLocaleString('id-ID'));
    } catch(e) { console.log('Rp 0 (Gangguan Server)'); }
}
getSaldo();
