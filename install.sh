#!/bin/bash
# ====================================================
# SCRIPT INSTALL TOKO ONLINE TAS & VPS PANEL MANAJEMEN
# ====================================================

echo "Memulai instalasi/update sistem Toko Tas Hitam Putih..."

# 1. Update sistem dan install dependensi dasar
sudo apt update -y
sudo apt install -y curl build-essential nginx cron wget jq ufw

# 1.5 BUKA FIREWALL (MENCEGAH ERROR 521 CLOUDFLARE)
echo "Membuka port firewall agar website bisa diakses dari luar..."
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable
sudo ufw reload

# 2. Install Node.js (Versi 20.x)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install PM2 secara global
sudo npm install -y pm2 -g

# 4. Buat direktori proyek
mkdir -p /var/www/tokotas
cd /var/www/tokotas

# 5. Inisialisasi proyek Node.js dan install library
npm init -y
npm install express sqlite3 ejs multer body-parser

# 6. Buat struktur folder
mkdir -p public/uploads
mkdir -p views

# 7. File inisialisasi Database SQLite (init_db.js)
cat << 'EOF' > init_db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tokotas.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, description TEXT, image_url TEXT, category TEXT, stock INTEGER DEFAULT 0)");
  db.all("PRAGMA table_info(products)", (err, columns) => {
     const hasCategory = columns.some(col => col.name === 'category');
     const hasStock = columns.some(col => col.name === 'stock');
     if (!hasCategory) db.run("ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'Lainnya'");
     if (!hasStock) db.run("ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0");
  });
  db.run("CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT)");
});

db.close();
console.log("Database toko berhasil diperbarui.");
EOF

# Jalankan inisialisasi database
node init_db.js

# 8. Buat script utama server (server.js)
cat << 'EOF' > server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

const db = new sqlite3.Database('./tokotas.db');

const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: function(req, file, cb){
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Rute: Halaman Utama
app.get('/', (req, res) => {
  let query = "SELECT * FROM products WHERE 1=1";
  let params = [];
  if (req.query.q) { query += " AND name LIKE ?"; params.push('%' + req.query.q + '%'); }
  if (req.query.category) { query += " AND category = ?"; params.push(req.query.category); }
  query += " ORDER BY id DESC";

  db.all(query, params, (err, products) => {
    if (err) throw err;
    db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 4", [], (err, banners) => {
       if (err) throw err;
       res.render('index', { products: products, banners: banners, searchQuery: req.query.q || '', selectedCategory: req.query.category || '' });
    });
  });
});

// Rute: Halaman Detail Produk
app.get('/product/:id', (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (err) throw err;
    if (!product) return res.redirect('/');
    res.render('detail', { product: product });
  });
});

// Rute: Halaman Keranjang
app.get('/cart', (req, res) => {
  res.render('cart');
});

// Rute: Panel Admin
app.get('/vps-panel', (req, res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
    if (err) throw err;
    db.all("SELECT * FROM banners ORDER BY id DESC", [], (err, banners) => {
       if (err) throw err;
       res.render('admin', { products: products, banners: banners });
    });
  });
});

// Rute: Halaman Edit
app.get('/vps-panel/edit/:id', (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (err) throw err;
    if (!product) return res.redirect('/vps-panel');
    res.render('admin_edit', { product: product });
  });
});

// Aksi Admin
app.post('/vps-panel/edit/:id', upload.single('image'), (req, res) => {
  const { name, price, description, category, stock } = req.body;
  if (req.file) {
    const imageUrl = '/uploads/' + req.file.filename;
    db.run("UPDATE products SET name = ?, price = ?, description = ?, category = ?, stock = ?, image_url = ? WHERE id = ?", 
      [name, price, description, category, stock || 0, imageUrl, req.params.id], (err) => { if (err) throw err; res.redirect('/vps-panel'); });
  } else {
    db.run("UPDATE products SET name = ?, price = ?, description = ?, category = ?, stock = ? WHERE id = ?", 
      [name, price, description, category, stock || 0, req.params.id], (err) => { if (err) throw err; res.redirect('/vps-panel'); });
  }
});

app.post('/vps-panel/add', upload.single('image'), (req, res) => {
  const { name, price, description, category, stock } = req.body;
  const imageUrl = req.file ? '/uploads/' + req.file.filename : '/uploads/default.jpg';
  db.run("INSERT INTO products (name, price, description, image_url, category, stock) VALUES (?, ?, ?, ?, ?, ?)", [name, price, description, imageUrl, category || 'Lainnya', stock || 0], (err) => {
      if (err) throw err; res.redirect('/vps-panel');
  });
});

app.post('/vps-panel/delete/:id', (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", req.params.id, (err) => { if (err) throw err; res.redirect('/vps-panel'); });
});

app.post('/vps-panel/banner-add', upload.single('image'), (req, res) => {
  if (!req.file) return res.redirect('/vps-panel');
  const imageUrl = '/uploads/' + req.file.filename;
  db.run("INSERT INTO banners (image_url) VALUES (?)", [imageUrl], (err) => { if (err) throw err; res.redirect('/vps-panel'); });
});

app.post('/vps-panel/banner-delete/:id', (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", req.params.id, (err) => { if (err) throw err; res.redirect('/vps-panel'); });
});

app.listen(port, () => { console.log(`Server berjalan di port ${port}`); });
EOF

# 9. Buat Tampilan Halaman Utama Toko (views/index.ejs) - UPDATE SIDEBAR HITAM
cat << 'EOF' > views/index.ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Toko Online Premium</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; }
    :root { --black: #000000; --dark-gray: #333333; --light-gray: #f9f9f9; --white: #ffffff; --border: #e0e0e0; --red: #e74c3c; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: var(--light-gray); color: var(--black); }
    
    .header { background: var(--black); padding: 12px 15px 12px 2px; display: flex; align-items: center; gap: 8px; position: sticky; top: 0; z-index: 50; }
    .icon-btn { background: none; border: none; color: var(--white); cursor: pointer; display: flex; align-items: center; padding: 5px; margin: 0; position: relative;}
    .icon-btn svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    
    .cart-badge { position: absolute; top: 0; right: 0; background: var(--red); color: white; font-size: 10px; font-weight: bold; border-radius: 50%; padding: 2px 6px; display: none; }

    .search-box { flex-grow: 1; background: var(--white); border-radius: 4px; display: flex; align-items: center; padding: 8px 12px; }
    .search-box input { border: none; outline: none; width: 100%; font-size: 14px; color: var(--black); }
    .search-box button { background: none; border: none; cursor: pointer; color: var(--dark-gray); display: flex; align-items: center; padding: 0; }
    .search-box button svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }

    .banner-wrapper { padding: 15px; background: var(--light-gray); }
    .banner-container { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 15px; padding: 0; scrollbar-width: none; scroll-behavior: smooth;}
    .banner-container::-webkit-scrollbar { display: none; }
    .banner-item { flex: 0 0 100%; scroll-snap-align: center; height: 180px; display: flex; justify-content: center; align-items: center; background: #222; color: #fff; border-radius: 12px; overflow: hidden; text-transform: uppercase; letter-spacing: 2px; }
    .banner-item img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px;}
    
    .category-container { display: flex; justify-content: center; gap: 10px; padding: 5px 20px 20px; flex-wrap: wrap; }
    .cat-item { padding: 8px 18px; border: 1px solid var(--black); border-radius: 4px; color: var(--black); text-decoration: none; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; transition: 0.2s; background: var(--white); }
    .cat-item.active { background: var(--black); color: var(--white); }
    .cat-item:hover { background: var(--black); color: var(--white); }

    .section-title { font-size: 18px; font-weight: bold; padding: 0 20px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
    .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; padding: 20px; }
    @media (min-width: 768px) { .product-grid { grid-template-columns: repeat(4, 1fr); } }
    
    .product-card { background: var(--white); border: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; transition: 0.3s; position: relative;}
    .product-card:hover { border-color: var(--black); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .product-card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; border-bottom: 1px solid var(--border); }
    .cat-badge { position: absolute; top: 10px; left: 10px; background: var(--black); color: var(--white); padding: 4px 8px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
    .product-info { padding: 15px; display: flex; flex-direction: column; flex-grow: 1; }
    .product-title { font-size: 14px; margin: 0 0 8px; color: var(--dark-gray); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .product-price { font-size: 16px; font-weight: bold; color: var(--black); margin-bottom: 15px; }
    .btn-detail { background: var(--white); color: var(--black); border: 1px solid var(--black); text-align: center; text-decoration: none; padding: 10px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-top: auto; cursor: pointer; transition: 0.2s; }
    .btn-detail:hover { background: var(--black); color: var(--white); }

    /* UPDATE: Sidebar Hitam Elegan */
    .sidebar { height: 100%; width: 0; position: fixed; z-index: 1000; top: 0; left: 0; background-color: var(--black); overflow-x: hidden; transition: 0.3s; box-shadow: 2px 0 10px rgba(0,0,0,0.5); border-right: 1px solid var(--dark-gray); }
    .sidebar-header { background: var(--black); color: var(--white); padding: 20px; font-size: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--dark-gray); }
    .closebtn { color: var(--white); font-size: 28px; text-decoration: none; font-weight: normal; }
    .sidebar-menu a { padding: 18px 20px; text-decoration: none; font-size: 14px; font-weight: bold; color: var(--white); display: block; border-bottom: 1px solid var(--dark-gray); text-transform: uppercase; letter-spacing: 1px; transition: 0.2s;}
    .sidebar-menu a:hover { background: var(--dark-gray); }
    .sidebar-icon { width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; margin-right: 10px; vertical-align: middle; }
  </style>
</head>
<body>

  <div id="mySidebar" class="sidebar">
    <div class="sidebar-header"><span>Menu Toko</span><a href="javascript:void(0)" class="closebtn" onclick="toggleMenu()">&times;</a></div>
    <div class="sidebar-menu">
      <a href="/">Semua Produk</a>
      <a href="/?category=Tas">Kategori Tas</a>
      <a href="/?category=Sepatu">Kategori Sepatu</a>
      <a href="/?category=Baju">Kategori Baju</a>
      <a href="/cart" style="display: flex; align-items: center;">
        <svg class="sidebar-icon" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg> Keranjang Saya
      </a>
    </div>
  </div>

  <div class="header">
    <button class="icon-btn" onclick="toggleMenu()"><svg viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
    <form action="/" method="GET" class="search-box">
      <input type="text" name="q" placeholder="Temukan produk disini" value="<%= searchQuery %>">
      <button type="submit"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>
    </form>
    <a href="/cart" class="icon-btn" style="padding-right: 0; text-decoration:none;">
      <svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
      <span id="cart-badge" class="cart-badge">0</span>
    </a>
  </div>

  <div class="banner-wrapper"><div class="banner-container" id="bannerContainer">
    <% if (banners.length === 0) { %><div class="banner-item">BANNER KOSONG</div><% } else { %>
      <% banners.forEach(function(banner) { %><div class="banner-item"><img src="<%= banner.image_url %>"></div><% }); %>
    <% } %>
  </div></div>

  <div class="category-container">
    <a href="/" class="cat-item <%= selectedCategory === '' ? 'active' : '' %>">SEMUA</a>
    <a href="/?category=Tas" class="cat-item <%= selectedCategory === 'Tas' ? 'active' : '' %>">TAS</a>
    <a href="/?category=Sepatu" class="cat-item <%= selectedCategory === 'Sepatu' ? 'active' : '' %>">SEPATU</a>
    <a href="/?category=Baju" class="cat-item <%= selectedCategory === 'Baju' ? 'active' : '' %>">BAJU</a>
  </div>

  <h2 class="section-title"><%= selectedCategory ? 'KATEGORI: ' + selectedCategory : 'PRODUK PILIHAN' %></h2>
  <div class="product-grid">
    <% if (products.length === 0) { %><div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #888;">Belum ada produk.</div><% } %>
    <% products.forEach(function(product) { %>
      <div class="product-card">
        <span class="cat-badge"><%= product.category %></span><img src="<%= product.image_url %>">
        <div class="product-info">
          <h3 class="product-title"><%= product.name %></h3>
          <div class="product-price">Rp <%= parseInt(product.price).toLocaleString('id-ID') %></div>
          <a href="/product/<%= product.id %>" class="btn-detail">Detail Produk</a>
        </div>
      </div>
    <% }); %>
  </div>

  <script>
    function toggleMenu() { document.getElementById("mySidebar").style.width = document.getElementById("mySidebar").style.width === "260px" ? "0" : "260px"; }
    const bc = document.getElementById('bannerContainer'); const bs = document.querySelectorAll('.banner-item'); let cb = 0;
    if (bs.length > 1) setInterval(() => { cb = (cb + 1) % bs.length; bc.scrollTo({ left: bs[cb].offsetLeft, behavior: 'smooth' }); }, 4000);
    
    function updateCartBadge() {
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      let badge = document.getElementById('cart-badge');
      if (cart.length > 0) { badge.innerText = cart.length; badge.style.display = 'block'; } else { badge.style.display = 'none'; }
    }
    updateCartBadge();
  </script>
</body>
</html>
EOF

# 10. Buat Tampilan Halaman Detail Produk (views/detail.ejs) - UPDATE SIDEBAR HITAM
cat << 'EOF' > views/detail.ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Detail Produk - <%= product.name %></title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; }
    :root { --black: #000000; --dark-gray: #333333; --light-gray: #f9f9f9; --white: #ffffff; --border: #e0e0e0; --red: #e74c3c; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: var(--light-gray); color: var(--black); }
    
    .header { background: var(--black); padding: 12px 15px 12px 2px; display: flex; align-items: center; gap: 8px; position: sticky; top: 0; z-index: 50; }
    .icon-btn { background: none; border: none; color: var(--white); cursor: pointer; display: flex; align-items: center; padding: 5px; margin: 0; position:relative;}
    .icon-btn svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .cart-badge { position: absolute; top: 0; right: 0; background: var(--red); color: white; font-size: 10px; font-weight: bold; border-radius: 50%; padding: 2px 6px; display: none; }
    .search-box { flex-grow: 1; background: var(--white); border-radius: 4px; display: flex; align-items: center; padding: 8px 12px; }
    .search-box input { border: none; outline: none; width: 100%; font-size: 14px; color: var(--black); }
    .search-box button { background: none; border: none; cursor: pointer; color: var(--dark-gray); display: flex; align-items: center; padding: 0; }
    .search-box button svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }

    .detail-wrapper { max-width: 800px; margin: 20px auto; background: var(--white); border: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; }
    @media (min-width: 768px) { .detail-wrapper { flex-direction: row; margin: 40px auto; border-radius: 8px; } }
    .detail-img-box { flex: 1; border-bottom: 1px solid var(--border); background: var(--light-gray); }
    @media (min-width: 768px) { .detail-img-box { border-bottom: none; border-right: 1px solid var(--border); } }
    .detail-img-box img { width: 100%; height: 100%; object-fit: cover; display: block; max-height: 400px; }

    .detail-info-box { flex: 1; padding: 25px; display: flex; flex-direction: column; }
    .badge { display: inline-block; background: var(--black); color: var(--white); padding: 4px 10px; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 1px; }
    .title { margin: 0 0 10px 0; font-size: 22px; color: var(--black); line-height: 1.3; }
    .price { font-size: 24px; font-weight: bold; color: var(--dark-gray); margin-bottom: 10px; }
    .stock { font-size: 13px; color: #e67e22; font-weight: bold; margin-bottom: 20px; }
    .desc-title { font-size: 13px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px; color: var(--black); }
    .description { font-size: 14px; color: #555; line-height: 1.6; margin-bottom: 30px; white-space: pre-wrap; flex-grow: 1;}
    
    .action-group { display: flex; gap: 10px; margin-bottom: 15px; }
    .btn-cart { flex: 1; background: var(--white); color: var(--black); border: 2px solid var(--black); text-align: center; text-decoration: none; padding: 15px 5px; font-size: 13px; font-weight: bold; text-transform: uppercase; cursor: pointer; transition: 0.2s; border-radius: 4px; }
    .btn-cart:hover { background: var(--black); color: var(--white); }
    .btn-buy { flex: 1; background: var(--black); color: var(--white); border: 2px solid var(--black); text-align: center; text-decoration: none; padding: 15px 5px; font-size: 13px; font-weight: bold; text-transform: uppercase; cursor: pointer; transition: 0.2s; border-radius: 4px; }
    .btn-buy:hover { background: var(--dark-gray); border-color: var(--dark-gray); }
    .btn-back { display: block; background: var(--white); color: var(--black); border: 1px solid var(--border); text-align: center; text-decoration: none; padding: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-radius: 4px; }
    .btn-back:hover { background: var(--light-gray); }

    /* UPDATE: Sidebar Hitam Elegan */
    .sidebar { height: 100%; width: 0; position: fixed; z-index: 1000; top: 0; left: 0; background-color: var(--black); overflow-x: hidden; transition: 0.3s; box-shadow: 2px 0 10px rgba(0,0,0,0.5); border-right: 1px solid var(--dark-gray); }
    .sidebar-header { background: var(--black); color: var(--white); padding: 20px; font-size: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--dark-gray); }
    .closebtn { color: var(--white); font-size: 28px; text-decoration: none; font-weight: normal; }
    .sidebar-menu a { padding: 18px 20px; text-decoration: none; font-size: 14px; font-weight: bold; color: var(--white); display: block; border-bottom: 1px solid var(--dark-gray); text-transform: uppercase; letter-spacing: 1px; transition: 0.2s;}
    .sidebar-menu a:hover { background: var(--dark-gray); }
    .sidebar-icon { width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; margin-right: 10px; vertical-align: middle; }
  </style>
</head>
<body>

  <div id="mySidebar" class="sidebar">
    <div class="sidebar-header"><span>Menu Toko</span><a href="javascript:void(0)" class="closebtn" onclick="toggleMenu()">&times;</a></div>
    <div class="sidebar-menu">
      <a href="/">Semua Produk</a>
      <a href="/?category=Tas">Kategori Tas</a>
      <a href="/?category=Sepatu">Kategori Sepatu</a>
      <a href="/?category=Baju">Kategori Baju</a>
      <a href="/cart" style="display: flex; align-items: center;">
        <svg class="sidebar-icon" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg> Keranjang Saya
      </a>
    </div>
  </div>

  <div class="header">
    <a href="/" class="icon-btn"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg></a>
    <form action="/" method="GET" class="search-box"><input type="text" name="q" placeholder="Cari barang lain..."><button type="submit"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button></form>
    <a href="/cart" class="icon-btn" style="padding-right: 0; text-decoration:none;">
      <svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
      <span id="cart-badge" class="cart-badge">0</span>
    </a>
  </div>

  <div class="detail-wrapper">
    <div class="detail-img-box"><img src="<%= product.image_url %>" alt="<%= product.name %>"></div>
    <div class="detail-info-box">
      <div><span class="badge"><%= product.category %></span></div>
      <h1 class="title"><%= product.name %></h1>
      <div class="price">Rp <%= parseInt(product.price).toLocaleString('id-ID') %></div>
      <div class="stock">Sisa Stok: <%= product.stock %></div>
      <div class="desc-title">Deskripsi Lengkap</div>
      <div class="description"><%= product.description || '-' %></div>
      
      <div class="action-group">
        <button onclick="addToCart('<%= product.id %>', '<%= product.name.replace(/'/g, "\\'") %>', <%= product.price %>, '<%= product.category %>', '<%= product.image_url %>')" class="btn-cart">Masuk Keranjang</button>
        <a href="https://wa.me/6282224460678?text=Halo%20Admin,%20saya%20mau%20pesan:%0A%0ABarang:%20<%= encodeURIComponent(product.name) %>%0AHarga:%20Rp%20<%= parseInt(product.price).toLocaleString('id-ID') %>%0A%0AMohon%20info%20ketersediaannya." class="btn-buy" target="_blank">Beli</a>
      </div>
      <a href="/" class="btn-back">Lihat Produk Lainnya</a>
    </div>
  </div>

  <script>
    function toggleMenu() { document.getElementById("mySidebar").style.width = document.getElementById("mySidebar").style.width === "260px" ? "0" : "260px"; }
    function updateCartBadge() {
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      let badge = document.getElementById('cart-badge');
      if (cart.length > 0) { badge.innerText = cart.length; badge.style.display = 'block'; } else { badge.style.display = 'none'; }
    }
    function addToCart(id, name, price, category, img) {
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      cart.push({ id: id, name: name, price: price, category: category, img: img });
      localStorage.setItem('tokotas_cart', JSON.stringify(cart));
      updateCartBadge();
      alert('Produk berhasil ditambahkan ke keranjang!');
    }
    updateCartBadge();
  </script>
</body>
</html>
EOF

# 11. Buat File Baru HALAMAN KERANJANG (views/cart.ejs) - UPDATE SIDEBAR HITAM
cat << 'EOF' > views/cart.ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keranjang Belanja</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; }
    :root { --black: #000000; --dark-gray: #333333; --light-gray: #f9f9f9; --white: #ffffff; --border: #e0e0e0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: var(--light-gray); color: var(--black); }
    
    .header { background: var(--black); padding: 15px 20px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
    .header-title { color: var(--white); font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 16px; margin: 0;}
    .icon-btn { background: none; border: none; color: var(--white); cursor: pointer; display: flex; align-items: center; padding: 0; text-decoration: none;}
    .icon-btn svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    
    .cart-container { max-width: 800px; margin: 20px auto; padding: 0 15px; }
    
    .cart-header-actions { background: var(--white); padding: 15px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; font-weight: bold; font-size: 14px; }
    .cart-header-actions input[type="checkbox"] { transform: scale(1.4); margin-right: 15px; cursor: pointer; accent-color: var(--black); }

    .cart-item { display: flex; background: var(--white); padding: 15px; border: 1px solid var(--border); margin-bottom: 15px; border-radius: 8px; align-items: center; gap: 15px; }
    .cart-item input[type="checkbox"] { transform: scale(1.4); cursor: pointer; accent-color: var(--black); }
    .cart-item img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }
    .item-info { flex-grow: 1; }
    .item-title { font-size: 15px; font-weight: bold; margin: 0 0 5px; color: var(--black); }
    .item-cat { font-size: 12px; color: #777; margin: 0 0 5px; text-transform: uppercase; }
    .item-price { font-size: 15px; font-weight: bold; color: var(--dark-gray); }
    .btn-remove { background: transparent; color: #e74c3c; border: 1px solid #e74c3c; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; text-transform: uppercase; }

    .cart-summary { background: var(--white); padding: 20px; border: 1px solid var(--border); border-radius: 8px; margin-top: 20px; text-align: right; position: sticky; bottom: 10px;}
    .total-text { font-size: 16px; margin-bottom: 15px; color: #555; }
    .total-price { font-size: 24px; font-weight: bold; color: var(--black); display: block; margin-top: 5px;}
    
    .btn-buy-all { background: var(--black); color: var(--white); text-align: center; text-decoration: none; padding: 15px; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; border: none; cursor: pointer; border-radius: 4px; display: block; width: 100%; box-sizing: border-box; transition: 0.2s; }
    .btn-buy-all:hover { background: var(--dark-gray); }
    .btn-buy-all:disabled { background: #ccc; cursor: not-allowed; }
    .empty-cart { text-align: center; padding: 50px 20px; color: #777; font-size: 16px; }

    /* UPDATE: Sidebar Hitam Elegan */
    .sidebar { height: 100%; width: 0; position: fixed; z-index: 1000; top: 0; left: 0; background-color: var(--black); overflow-x: hidden; transition: 0.3s; box-shadow: 2px 0 10px rgba(0,0,0,0.5); border-right: 1px solid var(--dark-gray); }
    .sidebar-header { background: var(--black); color: var(--white); padding: 20px; font-size: 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--dark-gray); }
    .closebtn { color: var(--white); font-size: 28px; text-decoration: none; font-weight: normal; }
    .sidebar-menu a { padding: 18px 20px; text-decoration: none; font-size: 14px; font-weight: bold; color: var(--white); display: block; border-bottom: 1px solid var(--dark-gray); text-transform: uppercase; letter-spacing: 1px; transition: 0.2s;}
    .sidebar-menu a:hover { background: var(--dark-gray); }
    .sidebar-icon { width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; margin-right: 10px; vertical-align: middle; }
  </style>
</head>
<body>

  <div id="mySidebar" class="sidebar">
    <div class="sidebar-header"><span>Menu Toko</span><a href="javascript:void(0)" class="closebtn" onclick="toggleMenu()">&times;</a></div>
    <div class="sidebar-menu">
      <a href="/">Semua Produk</a>
      <a href="/?category=Tas">Kategori Tas</a>
      <a href="/?category=Sepatu">Kategori Sepatu</a>
      <a href="/?category=Baju">Kategori Baju</a>
      <a href="/cart" style="display: flex; align-items: center;">
        <svg class="sidebar-icon" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg> Keranjang Saya
      </a>
    </div>
  </div>

  <div class="header">
    <button class="icon-btn" onclick="toggleMenu()"><svg viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
    <h1 class="header-title">Keranjang Saya</h1>
    <div style="width:24px;"></div>
  </div>

  <div class="cart-container" id="cart-content"></div>

  <script>
    function toggleMenu() { document.getElementById("mySidebar").style.width = document.getElementById("mySidebar").style.width === "260px" ? "0" : "260px"; }

    function loadCart() {
      const cartContainer = document.getElementById('cart-content');
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      
      if (cart.length === 0) {
        cartContainer.innerHTML = '<div class="empty-cart">Keranjang Anda masih kosong.<br><br><a href="/" style="color: black; font-weight: bold; padding: 10px; border: 1px solid black; display:inline-block; margin-top:15px; border-radius:4px; text-decoration:none;">Mulai Belanja</a></div>';
        return;
      }

      let html = `<div class="cart-header-actions"><label style="display:flex; align-items:center; cursor:pointer; width:100%;"><input type="checkbox" id="check-all" checked onchange="toggleAll()"> Pilih Semua</label></div>`;

      cart.forEach((item, index) => {
        html += `
          <div class="cart-item">
            <input type="checkbox" class="item-check" checked onchange="updateCheckout()">
            <img src="${item.img}" alt="${item.name}">
            <div class="item-info">
              <div class="item-title">${item.name}</div>
              <div class="item-cat">${item.category}</div>
              <div class="item-price">Rp ${item.price.toLocaleString('id-ID')}</div>
            </div>
            <button class="btn-remove" onclick="removeItem(${index})">Hapus</button>
          </div>
        `;
      });

      html += `<div class="cart-summary"><div class="total-text">Total Harga <span id="total-price-display" class="total-price">Rp 0</span></div><button id="btn-checkout" class="btn-buy-all">BELI SEKARANG</button></div>`;
      cartContainer.innerHTML = html;
      updateCheckout(); 
    }

    function toggleAll() {
      let checkAll = document.getElementById('check-all').checked;
      document.querySelectorAll('.item-check').forEach(cb => cb.checked = checkAll);
      updateCheckout();
    }

    function updateCheckout() {
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      let checkboxes = document.querySelectorAll('.item-check');
      let btnCheckout = document.getElementById('btn-checkout');
      let checkAllBox = document.getElementById('check-all');
      
      let total = 0; let selectedCount = 0; let allChecked = true;
      let waText = "Halo Admin, saya mau pesan barang dari keranjang:\n\n";

      checkboxes.forEach((cb, index) => {
        if (cb.checked) {
          let item = cart[index];
          total += item.price; selectedCount++;
          waText += `${selectedCount}. ${item.name}\n   Kategori: ${item.category}\n   Harga: Rp ${item.price.toLocaleString('id-ID')}\n\n`;
        } else { allChecked = false; }
      });

      if(checkAllBox) checkAllBox.checked = allChecked;
      document.getElementById('total-price-display').innerText = `Rp ${total.toLocaleString('id-ID')}`;

      if (selectedCount === 0) {
        btnCheckout.innerText = 'PILIH BARANG DULU';
        btnCheckout.style.opacity = '0.5';
        btnCheckout.onclick = function() { alert('Silakan centang barang yang ingin dibeli terlebih dahulu!'); };
      } else {
        btnCheckout.innerText = `BELI YANG DIPILIH (${selectedCount})`;
        btnCheckout.style.opacity = '1';
        waText += `*TOTAL KESELURUHAN: Rp ${total.toLocaleString('id-ID')}*\n\nMohon info ketersediaannya.`;
        const waLink = `https://wa.me/6282224460678?text=${encodeURIComponent(waText)}`;
        btnCheckout.onclick = function() { window.open(waLink, '_blank'); };
      }
    }

    function removeItem(index) {
      let cart = JSON.parse(localStorage.getItem('tokotas_cart')) || [];
      cart.splice(index, 1);
      localStorage.setItem('tokotas_cart', JSON.stringify(cart));
      loadCart();
    }

    loadCart();
  </script>
</body>
</html>
EOF

# 12. Buat Tampilan Panel Admin & Edit (views/admin.ejs & views/admin_edit.ejs)
cat << 'EOF' > views/admin.ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Admin Panel</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f9f9f9; padding: 20px; color: #000; }
    .panel { max-width: 900px; margin: 0 auto 30px; background: #fff; padding: 30px; border: 1px solid #e0e0e0; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    h2 { border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 0; text-transform: uppercase; letter-spacing: 1px; }
    .form-group { margin-bottom: 15px; }
    label { font-weight: bold; font-size: 13px; text-transform: uppercase; display: block; margin-bottom: 5px; }
    input, textarea, select { width: 100%; padding: 12px; border: 1px solid #ccc; box-sizing: border-box; font-family: inherit; }
    input:focus, textarea:focus, select:focus { border-color: #000; outline: none; }
    .btn-add { background: #000; color: #fff; border: none; padding: 12px 20px; cursor: pointer; font-weight: bold; width: 100%; text-transform: uppercase; letter-spacing: 1px; transition: 0.2s; }
    .btn-add:hover { background: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
    th { background: #f0f0f0; text-transform: uppercase; font-size: 13px; letter-spacing: 1px; }
    .btn-delete { background: #fff; color: #000; border: 1px solid #000; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: bold; transition: 0.2s; }
    .btn-delete:hover { background: #000; color: #fff; }
    .btn-edit { background: #fff; color: #000; border: 1px solid #000; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; margin-right: 5px;}
    .btn-edit:hover { background: #eee; }
  </style>
</head>
<body>
  <div class="panel">
    <h2>Manajemen Banner Depan (Maks 4)</h2>
    <form action="/vps-panel/banner-add" method="POST" enctype="multipart/form-data">
      <div class="form-group"><label>Upload Foto Banner Baru:</label><input type="file" name="image" required></div>
      <button type="submit" class="btn-add">TAMBAH BANNER</button>
    </form>
    <table>
      <tr><th>Foto Banner</th><th>Aksi</th></tr>
      <% banners.forEach(function(banner) { %>
        <tr>
          <td><img src="<%= banner.image_url %>" style="width:120px; height:60px; object-fit:cover; border: 1px solid #eee;"></td>
          <td><form action="/vps-panel/banner-delete/<%= banner.id %>" method="POST" style="margin:0;"><button type="submit" class="btn-delete">HAPUS</button></form></td>
        </tr>
      <% }); %>
    </table>
  </div>
  
  <div class="panel">
    <h2>Tambah Produk Baru</h2>
    <form action="/vps-panel/add" method="POST" enctype="multipart/form-data">
      <div class="form-group">
        <label>Kategori Produk</label>
        <select name="category" required><option value="Tas">Tas</option><option value="Sepatu">Sepatu</option><option value="Baju">Baju</option></select>
      </div>
      <div class="form-group"><label>Nama Barang</label><input type="text" name="name" required></div>
      <div class="form-group"><label>Harga (Rp)</label><input type="number" name="price" required></div>
      <div class="form-group"><label>Stok Barang</label><input type="number" name="stock" required></div>
      <div class="form-group"><label>Deskripsi</label><textarea name="description" style="height: 100px;"></textarea></div>
      <div class="form-group"><label>Upload Foto</label><input type="file" name="image" required></div>
      <button type="submit" class="btn-add">SIMPAN PRODUK BARU</button>
    </form>

    <h2 style="margin-top: 40px;">Daftar Produk</h2>
    <table>
      <tr><th>Foto</th><th>Kategori</th><th>Nama Barang</th><th>Harga</th><th>Stok</th><th>Aksi</th></tr>
      <% products.forEach(function(product) { %>
        <tr>
          <td><img src="<%= product.image_url %>" style="width:50px; height:50px; object-fit:cover; border: 1px solid #eee;"></td>
          <td><b><%= product.category %></b></td>
          <td><%= product.name %></td>
          <td>Rp <%= parseInt(product.price).toLocaleString('id-ID') %></td>
          <td><%= product.stock %></td>
          <td style="display: flex;">
            <a href="/vps-panel/edit/<%= product.id %>" class="btn-edit">EDIT</a>
            <form action="/vps-panel/delete/<%= product.id %>" method="POST" style="margin:0;"><button type="submit" class="btn-delete">HAPUS</button></form>
          </td>
        </tr>
      <% }); %>
    </table>
    <br><br><a href="/" style="color: #000; text-decoration: none; font-weight: bold; border-bottom: 1px solid #000;">KEMBALI KE TOKO</a>
  </div>
</body>
</html>
EOF

cat << 'EOF' > views/admin_edit.ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Edit Produk - Admin Panel</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f9f9f9; padding: 20px; color: #000; }
    .panel { max-width: 800px; margin: 0 auto 30px; background: #fff; padding: 30px; border: 1px solid #e0e0e0; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    h2 { border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 0; text-transform: uppercase; letter-spacing: 1px; }
    .form-group { margin-bottom: 15px; }
    label { font-weight: bold; font-size: 13px; text-transform: uppercase; display: block; margin-bottom: 5px; }
    input, textarea, select { width: 100%; padding: 12px; border: 1px solid #ccc; box-sizing: border-box; font-family: inherit; }
    input:focus, textarea:focus, select:focus { border-color: #000; outline: none; }
    .btn-add { background: #000; color: #fff; border: none; padding: 12px 20px; cursor: pointer; font-weight: bold; width: 100%; text-transform: uppercase; letter-spacing: 1px; transition: 0.2s; }
    .btn-add:hover { background: #333; }
    .btn-back { display: block; text-align: center; margin-top: 15px; color: #000; font-weight: bold; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="panel">
    <h2>Edit Produk: <%= product.name %></h2>
    <form action="/vps-panel/edit/<%= product.id %>" method="POST" enctype="multipart/form-data">
      
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="<%= product.image_url %>" style="width: 150px; height: 150px; object-fit: cover; border: 1px solid #ccc; border-radius: 8px;">
        <p style="font-size: 12px; color: #777;">(Foto saat ini)</p>
      </div>

      <div class="form-group">
        <label>Kategori Produk</label>
        <select name="category" required>
          <option value="Tas" <%= product.category === 'Tas' ? 'selected' : '' %>>Tas</option>
          <option value="Sepatu" <%= product.category === 'Sepatu' ? 'selected' : '' %>>Sepatu</option>
          <option value="Baju" <%= product.category === 'Baju' ? 'selected' : '' %>>Baju</option>
        </select>
      </div>
      <div class="form-group"><label>Nama Barang</label><input type="text" name="name" value="<%= product.name %>" required></div>
      <div class="form-group"><label>Harga (Rp)</label><input type="number" name="price" value="<%= product.price %>" required></div>
      <div class="form-group"><label>Stok Barang</label><input type="number" name="stock" value="<%= product.stock %>" required></div>
      <div class="form-group"><label>Deskripsi Lengkap</label><textarea name="description" style="height: 150px;"><%= product.description %></textarea></div>
      
      <div class="form-group">
        <label>Ganti Foto Barang (Opsional)</label>
        <input type="file" name="image">
        <small style="color:#777;">*Biarkan kosong jika tidak ingin mengganti foto.</small>
      </div>
      
      <button type="submit" class="btn-add">UPDATE PRODUK SEKARANG</button>
    </form>
    <a href="/vps-panel" class="btn-back">Batalkan & Kembali</a>
  </div>
</body>
</html>
EOF

# 13. SET NGINX DEFAULT (PROXY PORT 3000)
cat << 'EOF' > /etc/nginx/sites-available/tokotas_default
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 50M;
    location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
}
EOF
ln -sf /etc/nginx/sites-available/tokotas_default /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

# 14. SCRIPT AUTO BACKUP TELEGRAM (/usr/local/bin/autobackup)
cat << 'EOF' > /usr/local/bin/autobackup
#!/bin/bash
TOKEN=$(cat /root/.tg_token 2>/dev/null)
CHAT_ID=$(cat /root/.tg_chat 2>/dev/null)
if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ]; then exit 0; fi
TANGGAL=$(date +%Y%m%d_%H%M%S)
NAMA_BACKUP="/root/backup_tokotas_${TANGGAL}.tar.gz"
tar -czf $NAMA_BACKUP -C /var/www tokotas 2>/dev/null
if [ -f /etc/nginx/sites-available/tokotas_domain ]; then tar -rf $NAMA_BACKUP -C /etc/nginx sites-available/tokotas_domain 2>/dev/null; fi
curl -s -F document=@"$NAMA_BACKUP" https://api.telegram.org/bot$TOKEN/sendDocument?chat_id=$CHAT_ID > /dev/null
rm -f $NAMA_BACKUP
EOF
chmod +x /usr/local/bin/autobackup

# 15. SCRIPT CLI MENU ENTERPRISE (/usr/local/bin/menu)
cat << 'EOF' > /usr/local/bin/menu
#!/bin/bash
clear
echo "==================================================="
echo "         MENU ENTERPRISE TOKO TAS (VPS CLI)        "
echo "==================================================="
echo "1. Setup / Ganti Domain Website"
echo "2. Manajemen Backup (Telegram & Auto)"
echo "3. Restore Website (Dari Backup)"
echo "4. Uninstall & Reset Sistem"
echo "5. Keluar"
echo "==================================================="
read -p "Pilih menu (1-5): " pilihan

case $pilihan in
  1)
    echo ""
    read -p "Masukkan Domain Anda (contoh: toko.com): " domain_name
    cat <<NGINX > /etc/nginx/sites-available/tokotas_domain
server { listen 80; server_name $domain_name; client_max_body_size 50M; location / { proxy_pass http://localhost:3000; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; } }
NGINX
    ln -sf /etc/nginx/sites-available/tokotas_domain /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/tokotas_default
    systemctl restart nginx
    echo "$domain_name" > /var/www/tokotas/domain.txt
    echo "==================================================="
    echo "Domain $domain_name berhasil dipasang!"
    echo "==================================================="
    ;;
  2)
    echo ""
    echo "--- MANAJEMEN BACKUP TELEGRAM ---"
    echo "1. Backup Manual Sekarang"
    echo "2. Set Token & ID Bot"
    echo "3. Set Waktu Auto-Backup"
    echo "4. Matikan Auto-Backup"
    read -p "Pilih (1-4): " pil_backup
    if [ "$pil_backup" == "1" ]; then /usr/local/bin/autobackup; echo "Selesai! Cek Telegram Anda.";
    elif [ "$pil_backup" == "2" ]; then read -p "Token Bot: " tg_token; read -p "Chat ID: " tg_chat; echo "$tg_token" > /root/.tg_token; echo "$tg_chat" > /root/.tg_chat; echo "Tersimpan!";
    elif [ "$pil_backup" == "3" ]; then
       echo "A. Setiap X Menit | B. Setiap X Jam"
       read -p "Pilihan (A/B): " pil_waktu
       if [ "$pil_waktu" == "A" ] || [ "$pil_waktu" == "a" ]; then read -p "Berapa menit?: " wkt; (crontab -l 2>/dev/null | grep -v "autobackup"; echo "*/$wkt * * * * /usr/local/bin/autobackup") | crontab -; echo "Set setiap $wkt menit.";
       elif [ "$pil_waktu" == "B" ] || [ "$pil_waktu" == "b" ]; then read -p "Berapa jam?: " wkt; (crontab -l 2>/dev/null | grep -v "autobackup"; echo "0 */$wkt * * * /usr/local/bin/autobackup") | crontab -; echo "Set setiap $wkt jam."; fi
    elif [ "$pil_backup" == "4" ]; then (crontab -l 2>/dev/null | grep -v "autobackup") | crontab -; echo "Auto-Backup dimatikan."; fi
    ;;
  3)
    echo ""
    echo "--- RESTORE WEBSITE ---"
    echo "1. Dari File Backup Lokal"
    echo "2. Dari Direct Link"
    read -p "Pilih (1/2): " pil_restore
    if [ "$pil_restore" == "2" ]; then read -p "Link File (.tar.gz): " url_dl; wget -qO /root/backup_restore.tar.gz "$url_dl"; FILE_RES="/root/backup_restore.tar.gz";
    elif [ "$pil_restore" == "1" ]; then ls -1 /root/backup_tokotas_*.tar.gz 2>/dev/null; read -p "Nama File: " nf; FILE_RES="/root/$nf"; fi
    
    pm2 stop tokotas 2>/dev/null || true
    rm -rf /var/www/tokotas
    tar -xzf $FILE_RES -C /var/www 2>/dev/null || tar -xzf $FILE_RES -C /
    if [ -f /var/www/tokotas/domain.txt ]; then DOMAIN_RES=$(cat /var/www/tokotas/domain.txt); cat <<NGINX_RES > /etc/nginx/sites-available/tokotas_domain
server { listen 80; server_name $DOMAIN_RES; client_max_body_size 50M; location / { proxy_pass http://localhost:3000; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; } }
NGINX_RES
    ln -sf /etc/nginx/sites-available/tokotas_domain /etc/nginx/sites-enabled/; rm -f /etc/nginx/sites-enabled/tokotas_default; fi
    pm2 start /var/www/tokotas/server.js --name "tokotas" 2>/dev/null || pm2 restart tokotas
    systemctl restart nginx
    echo "Restore Berhasil!"
    ;;
  4)
    pm2 delete tokotas 2>/dev/null || true
    rm -rf /var/www/tokotas
    rm -f /etc/nginx/sites-enabled/tokotas_domain /etc/nginx/sites-available/tokotas_domain
    systemctl restart nginx
    echo "Uninstall Selesai!"
    ;;
  5) echo "Keluar."; ;;
esac
EOF

sudo chmod +x /usr/local/bin/menu

# 16. Restart Semua Service
sudo pm2 delete tokotas 2>/dev/null || true
sudo pm2 start server.js --name "tokotas"
sudo pm2 save
sudo pm2 startup

echo "================================================================"
echo " UPDATE SIDEBAR HITAM SELESAI DENGAN SEMPURNA! "
echo "================================================================"
