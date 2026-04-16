
# 🚀 Digital Tendo Store - Ultimate PPOB & VPN Billing System

Salin dan tempel perintah di bawah ini ke terminal VPS Anda untuk memulai instalasi otomatis:
```bash
wget -qO- https://raw.githubusercontent.com/tendostore/Scrip-Install-Website-PPOB/main/install.sh | bash
```
---

## 📋 Pengenalan
**Digital Tendo Store** adalah skrip *All-in-One* berbasis **Node.js** yang dirancang untuk membangun website panel layanan PPOB (Pulsa, Data, Game, E-Money) dan manajemen VPN Premium secara otomatis. 

Skrip ini berjalan di atas VPS Linux (Ubuntu/Debian) dan memiliki antarmuka Web App (PWA) yang sangat ringan, responsif, dan terlihat seperti aplikasi native di perangkat mobile.

---

## ✨ Fitur Lengkap & Detail

### 🛒 1. Sistem PPOB (Integrasi Digiflazz)
* **Auto-Sync Digiflazz:** Tidak perlu input produk manual. Sistem otomatis menarik ribuan produk dari API Digiflazz beserta status gangguan/normal.
* **Manajemen Margin Pintar (13 Tingkat):** Keuntungan diatur otomatis berdasarkan rentang harga modal. (Contoh: Modal 0-100 perak untung 50 perak, modal 50rb-75rb untung 5000, dst).
* **Kategori Lengkap:** Pulsa, Data, Game, Voucher, E-Wallet, PLN, Paket SMS/Telpon, Masa Aktif, dan Aktivasi Perdana.
* **Etalase Custom (Best Seller):** Admin bisa membuat kategori khusus (seperti "Promo Hari Ini") dan memasukkan SKU tertentu agar tampil di bagian paling atas website.

### 🛡️ 2. Sistem VPN Premium
* **Multi-Protocol:** Membuat akun VPN SSH, Vmess, Vless, Trojan, dan ZIVPN secara otomatis ke server VPN Anda.
* **Manajemen Server Terpusat:** Tambahkan banyak server VPS VPN (Multi-Server) ke dalam satu panel admin.
* **Sistem Trial Otomatis:** Pelanggan bisa mengklaim akun trial (contoh: aktif 30 menit, limit 2GB) dengan sistem *cooldown* agar tidak disalahgunakan.
* **Auto-Generate Config:** Detail akun VPN (Link TLS, gRPC, Non-TLS, dll) otomatis dikirim dan bisa disalin oleh pelanggan.

### 💳 3. Pembayaran & Keuangan
* **QRIS Auto-Deposit (BHM Biz API):** Integrasi langsung dengan akun GoPay Merchant. Pelanggan scan QRIS, bayar sesuai nominal + kode unik, dan saldo/pesanan otomatis diproses tanpa persetujuan manual admin.
* **Sistem Saldo Akun:** Pelanggan dapat menyimpan saldo di dalam website.
* **Auto-Refund:** Jika pesanan Digiflazz atau pembuatan akun VPN gagal, saldo otomatis dikembalikan ke akun pelanggan.

### 🤖 4. Sistem Notifikasi & Bot WhatsApp
* **Bot WhatsApp Built-in:** Menggunakan library `Baileys`. Bot melayani pendaftaran OTP, Reset Password OTP, Edit Data OTP, dan cek saldo.
* **Broadcast WhatsApp:** Bot otomatis mengirimkan bukti transaksi sukses ke Saluran (Channel) atau Grup WhatsApp Anda.
* **Notifikasi Telegram Admin:** Laporan pesanan masuk, pending, sukses, gagal, dan komplain pelanggan langsung dikirim ke Telegram Admin.
* **Channel Telegram Pelanggan:** Anda bisa mengatur bot untuk memposting info terbaru atau banner langsung dari Telegram ke Website dan Channel Pelanggan.

### 🔒 5. Keamanan & Sistem Lanjutan
* **Auto-Maintenance:** Otomatis menutup transaksi setiap hari pukul `23:00 - 00:30 WIB` (menyesuaikan jam *cut-off* bank/pusat).
* **Enkripsi AES-256:** Data sensitif (database, produk, konfigurasi) disimpan dengan enkripsi khusus (`tendo_crypt.js`), menghindari pencurian database.
* **Auto-Backup:** Backup database dalam format `.zip` otomatis dikirim ke Telegram Admin setiap beberapa jam.

---

## 🛠️ Persyaratan Sistem Server (VPS)
* **Sistem Operasi:** Ubuntu 20.04 LTS / 22.04 LTS (Sangat Direkomendasikan) atau Debian 11/12.
* **Spesifikasi Minimal:** 1 Core CPU, 1 GB RAM, 10 GB Storage.
* **Akses:** Root via SSH.
* **Domain (Opsional):** Digunakan jika ingin website menggunakan HTTPS (Sertifikat SSL Let's Encrypt).

---

## 📖 Panduan Instalasi (Step-by-Step)

1.  **Akses VPS Anda:** Buka terminal (Putty/Termius/CMD) dan login sebagai `root`.
2.  **Jalankan Skrip Installer:** Salin perintah di paling atas halaman ini, lalu tekan Enter.
3.  **Tunggu Proses:** Skrip akan menginstal Node.js, Nginx, PM2, dan library yang dibutuhkan secara otomatis.
4.  **Buka Panel Admin:** Setelah instalasi terminal selesai, ketik perintah `bot` atau `menu` di terminal VPS Anda.
5.  **Tautkan WhatsApp Bot:** * Pilih menu `[2] Mulai Sistem`.
    * Masukkan nomor HP bot (diawali 628...).
    * Terminal akan memunculkan **KODE PAIRING 8 DIGIT**.
    * Buka HP bot WhatsApp Anda -> *Perangkat Taut* -> *Tautkan dengan nomor telepon saja* -> Masukkan kodenya.
6.  **Sistem Berjalan:** Setelah sukses tertaut, hentikan sementara dengan `CTRL+C`, lalu pilih menu `[3] Jalankan Sistem di Latar Belakang (PM2)`.

---

## ⚙️ Panduan Pengaturan Panel Admin
Gunakan perintah `menu` di terminal untuk membuka panel manajemen. Berikut adalah langkah wajib pertama kali:

### Tahap 1: Setup API & Integrasi
1.  **Menu [13] Ganti API Digiflazz:** Masukkan Username dan API Key Production dari akun Digiflazz Anda.
2.  **Menu [14] Setup GoPay Merchant:** Masukkan Token BHM Biz, ID Merchant, dan nomor HP GoPay untuk mengaktifkan QRIS Dinamis. Paste juga Teks String QRIS Statis Anda.
3.  **Menu [15] Setup Notifikasi:** Masukkan Token Bot Telegram dan Chat ID Anda agar laporan transaksi masuk ke Telegram.

### Tahap 2: Manajemen Produk
1.  **Menu [7] Manajemen Keuntungan:** Atur profit (margin) Anda dari Modal 0 hingga Modal 100.000+.
2.  **Menu [6] Sinkronisasi Produk Digiflazz:** Jalankan menu ini untuk menarik seluruh data produk, mengubah harga sesuai margin, dan menampilkannya di website secara seketika.

### Tahap 3: Pengamanan & Domain (Opsional tapi Penting)
* **Menu [16] Setup Domain & HTTPS:** Jika Anda memiliki domain (contoh: `tendostore.com`), arahkan DNS/IP ke VPS Anda, lalu gunakan menu ini untuk memasang SSL (Gembok Hijau) secara otomatis via Certbot & Nginx.
* **Menu [19] Auto-Backup:** Aktifkan agar jika VPS rusak, Anda memiliki cadangan data.

---

## ❓ FAQ & Troubleshooting

* **Q: Mengapa produk di web kosong / harganya Rp 0?**
    * A: Pastikan API Digiflazz di Menu [13] sudah benar, lalu jalankan Menu [6] Sinkronisasi. Cek apakah IP VPS Anda sudah di-*whitelist* di dashboard Digiflazz.
* **Q: Bagaimana cara mengatasi bot WA yang keluar sendiri / tidak merespon?**
    * A: Buka terminal, ketik `menu`, pilih menu `[17] Ganti Akun WA Web (Reset Sesi)`. Setelah itu pilih menu `[2]` untuk menautkan ulang dengan nomor WA.
* **Q: Website tidak bisa diakses dari HP?**
    * A: Pastikan port `3000` dan `80/443` sudah terbuka di firewall VPS Anda. Pada saat instalasi, skrip sudah mencoba membuka port UFW/Iptables.
* **Q: QRIS muncul tapi status tidak sukses-sukses setelah dibayar?**
    * A: Pastikan integrasi BHM Biz (Menu 14) sudah sukses diverifikasi OTP. Pembeli wajib mentransfer jumlah **Tepat Sesuai Nominal + Kode Unik** (misal: Rp 10.043).

---
**Disclaimer:** *Skrip ini disediakan untuk mempermudah bisnis digital Anda. Keamanan akun Digiflazz, GoPay, dan VPS sepenuhnya adalah tanggung jawab Anda sebagai pemilik server.*

**Digital Tendo Store © 2026**
