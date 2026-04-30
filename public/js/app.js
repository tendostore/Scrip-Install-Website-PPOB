let sysMaintStart = "23:00";
let sysMaintEnd = "00:30";
let adminWaNumber = "6282224460678";

// TEMA DAN NEUMORPHISM HANDLER
function applyTheme(isDark) {
    if(isDark) {
        document.body.classList.add('dark-mode');
        let txt = document.getElementById('theme-text');
        if(txt) txt.innerText = 'Mode Terang';
    } else {
        document.body.classList.remove('dark-mode');
        let txt = document.getElementById('theme-text');
        if(txt) txt.innerText = 'Mode Gelap';
    }
}
function toggleTheme() {
    let isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('tendo_theme', !isDark ? 'dark' : 'light');
    applyTheme(!isDark);
}

setInterval(() => {
    let d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    let clockEl = document.getElementById('live-clock');
    if(clockEl) {
        let opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        clockEl.innerText = d.toLocaleString('id-ID', opts).replace(/\./g, ':') + ' WIB';
    }

    let h = d.getHours();
    let m = d.getMinutes();
    let curMins = h * 60 + m;
    let sParts = sysMaintStart.split(':');
    let eParts = sysMaintEnd.split(':');
    let sMins = parseInt(sParts[0])*60 + parseInt(sParts[1]);
    let eMins = parseInt(eParts[0])*60 + parseInt(eParts[1]);
    
    let isMaint = false;
    if(sMins < eMins) isMaint = (curMins >= sMins && curMins < eMins);
    else isMaint = (curMins >= sMins || curMins < eMins);
    
    let mb = document.getElementById('maint-banner');
    let dbScreen = document.getElementById('dashboard-screen');
    if (isMaint && dbScreen) {
        if(!mb) {
            mb = document.createElement('div');
            mb.id = 'maint-banner';
            mb.innerHTML = `🛠️ PEMELIHARAAN SISTEM (${sysMaintStart} - ${sysMaintEnd} WIB). TRANSAKSI SEMENTARA DITUTUP.`;
            mb.style = 'background:#ef4444; color:#fff; font-size:11px; font-weight:bold; text-align:center; padding:14px; margin: 20px 20px 0; border-radius:14px; box-shadow: var(--shadow-outer);';
            dbScreen.prepend(mb);
        }
    } else {
        if(mb) mb.remove();
    }
}, 1000);

let historyStack = [];
let currentState = null;

function pushState(newState) {
    if (currentState && JSON.stringify(currentState) !== JSON.stringify(newState)) {
        historyStack.push(currentState);
    }
    currentState = newState;
}

function goBackGlobal() {
    if (historyStack.length > 0) {
        let prevState = historyStack.pop();
        currentState = prevState; 
        restoreState(prevState);
    } else {
        currentState = {screen: 'dashboard-screen'};
        showDashboardInternal();
    }
}

function restoreState(s) {
    if(s.screen === 'dashboard-screen') showDashboardInternal();
    else if(s.screen === 'etalase-screen') loadEtalaseProductsInternal(s.idx);
    else if(s.screen === 'brand-screen') {
        if(s.subcat_mode) loadSubCategoryInternal(s.cat, s.brand);
        else loadCategoryInternal(s.cat);
    }
    else if(s.screen === 'brand-vpn') loadVpnCategoryInternal(s.proto);
    else if(s.screen === 'produk-vpn') loadVpnProductsListInternal(s.proto, s.serverId);
    else if(s.screen === 'produk-screen') loadProductsInternal(s.cat, s.brand, s.subcat);
    else if(s.screen === 'history-screen') showHistoryInternal(s.filter);
    else if(s.screen === 'profile-screen') showProfileInternal();
    else if(s.screen === 'notif-screen') showNotifInternal();
    else if(s.screen === 'global-trx-screen') showGlobalTrxInternal();
    else if(s.screen === 'tutorial-screen') showTutorialsInternal();
    else if(s.screen === 'panel-vpn-screen') showPanelVPNInternal();
}

function showToast(msg, type='info') {
    let t = document.getElementById('custom-toast-alert');
    if(!t) {
        t = document.createElement('div');
        t.id = 'custom-toast-alert';
        document.body.appendChild(t);
    }
    let icon = type === 'error' ? '⚠️ ' : (type === 'success' ? '✅ ' : 'ℹ️ ');
    t.className = 'custom-toast ' + (type === 'error' ? 'error' : (type === 'success' ? 'success' : '')) + ' show';
    t.innerHTML = icon + '<span>' + msg + '</span>';
    setTimeout(() => { t.classList.remove('show'); }, 3500);
}

function copyData(elementId, label) {
    let text = '';
    let el = document.getElementById(elementId);
    if(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') text = el.value;
    else text = el.innerText;

    if(text && text !== '-') {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(label + ' disalin!', 'success');
            }).catch(err => {
                showToast('Gagal menyalin', 'error');
            });
        } else {
            let textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showToast(label + ' disalin!', 'success');
            } catch (err) {
                showToast('Gagal menyalin', 'error');
            }
            document.body.removeChild(textArea);
        }
    }
}

function filterGlobalDashboard() {
    let input = document.getElementById('global-search-db').value.toLowerCase();
    let boxes = document.querySelectorAll('.grid-box, #custom-layout-container .brand-row');
    boxes.forEach(box => {
        let text = box.innerText.toLowerCase();
        if (text.includes(input)) box.style.display = 'flex';
        else box.style.display = 'none';
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => { 
    e.preventDefault(); deferredPrompt = e;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

let currentUser = ""; let userData = {}; let allProducts = {}; let selectedSKU = ""; let tempRegPhone = ""; let tempForgotPhone = ""; let tempLoginPhone = ""; let currentEditMode = ""; let currentHistoryItem = null;
let currentCategory = ""; let currentBrand = ""; let currentHistoryFilter = 'Order'; let currentHistoryStatusFilter = 'Semua';
let vpnConfigData = null; let selectedVPNProto = ""; let selectedVPNServer = "";
let currentVpnBasePrice = 0; let currentVpnBaseDesc = "";
let bannerInterval; let qrisInterval;
let titleClicks = 0;

function secretPanelClick() {
    titleClicks++;
    if(titleClicks >= 5) {
        titleClicks = 0;
        if(currentUser) window.showPanelVPN();
        else showToast('Silakan login dulu.', 'error');
    }
    setTimeout(() => { titleClicks = 0; }, 3000);
}

function selectPayment(method) {
    document.getElementById('m-payment-method').value = method;
    if(method === 'saldo') {
        document.getElementById('btn-pay-saldo').classList.add('active');
        document.getElementById('btn-pay-qris').classList.remove('active');
    } else {
        document.getElementById('btn-pay-qris').classList.add('active');
        document.getElementById('btn-pay-saldo').classList.remove('active');
    }
}

function selectPaymentVpn(method) {
    document.getElementById('m-vpn-payment').value = method;
    if(method === 'saldo') {
        document.getElementById('btn-pay-vpn-saldo').classList.add('active');
        document.getElementById('btn-pay-vpn-qris').classList.remove('active');
    } else {
        document.getElementById('btn-pay-vpn-qris').classList.add('active');
        document.getElementById('btn-pay-vpn-saldo').classList.remove('active');
    }
}

let lastDetected = "";
let toastTimer;
function checkProvider(val) {
    if(val.length < 4) { lastDetected = ""; return; }
    let prefix = val.substring(0, 4);
    if(val.startsWith('+62')) prefix = '0' + val.substring(3, 6);
    else if(val.startsWith('62')) prefix = '0' + val.substring(2, 5);

    let provider = "";
    if(['0811','0812','0813','0821','0822','0852','0853','0851'].includes(prefix)) provider = "Telkomsel / By.U";
    else if(['0814','0815','0816','0855','0856','0857','0858'].includes(prefix)) provider = "Indosat";
    else if(['0817','0818','0819','0859','0877','0878'].includes(prefix)) provider = "XL";
    else if(['0831','0832','0833','0838'].includes(prefix)) provider = "Axis";
    else if(['0895','0896','0897','0898','0899'].includes(prefix)) provider = "Tri";
    else if(['0881','0882','0883','0884','0885','0886','0887','0888','0889'].includes(prefix)) provider = "Smartfren";

    if(provider && provider !== lastDetected) {
        lastDetected = provider;
        let toast = document.getElementById('provider-toast');
        toast.innerText = "Terdeteksi: " + provider;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.classList.remove('show'); lastDetected = ""; }, 3000);
    }
}

async function apiCall(url, bodyData) {
    let options = {};
    let headers = {};
    let token = localStorage.getItem('tendo_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    
    if(bodyData) {
        options.method = 'POST';
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(bodyData);
    }
    options.headers = headers;
    let res = await fetch(url, options);
    if(res.status === 403) {
        let data = await res.json();
        if(data.message.includes('Token') || data.message.includes('token') || data.message.includes('Akses') || data.message.includes('Sesi')) {
            logout();
            showToast(data.message || 'Sesi kedaluwarsa, silakan login ulang.', 'error');
            return {success: false, message: 'Sesi kedaluwarsa'};
        }
        return data;
    }
    return await res.json();
}

async function fetchGlobalStats() {
    try {
        let res = await apiCall('/api/stats');
        if(res && res.success) {
            document.getElementById('stat-daily').innerText = res.daily;
            document.getElementById('stat-weekly').innerText = res.weekly;
            document.getElementById('stat-monthly').innerText = res.monthly;
            if(document.getElementById('stat-total')) document.getElementById('stat-total').innerText = res.total;
            if(res.maintStart) sysMaintStart = res.maintStart;
            if(res.maintEnd) sysMaintEnd = res.maintEnd;
            if(res.adminWa) adminWaNumber = res.adminWa.replace(/[^0-9]/g, '');
        }
    } catch(e){}
}

async function fetchLeaderboard() {
    try {
        let res = await apiCall('/api/leaderboard');
        if(res && res.success && res.data.length > 0) {
            let html = '<div class="stats-title" style="margin-top:20px; margin-bottom:15px; font-size:14px; text-transform:uppercase;">🏆 Top Sultan 🏆</div><div style="display:flex; flex-direction:column; gap:15px;">';
            res.data.forEach((u, i) => {
                let badge = (i === 0) ? '👑' : (i === 1) ? '🥈' : (i === 2) ? '🥉' : `<span style="font-size:14px; font-weight:bold; color:var(--text-muted);">${i+1}</span>`;
                html += `
                <div class="brand-row" style="margin: 0; cursor:default;">
                    <div class="b-logo" style="width:40px; height:40px; font-size: 18px;">${badge}</div>
                    <div class="b-name">${u.name}</div>
                    <div style="font-weight:900; color:var(--nav-active); font-size:12px;">${u.trx} Trx</div>
                </div>`;
            });
            html += '</div>';
            document.getElementById('leaderboard-container').innerHTML = html;
        }
    } catch(e) {}
}

async function fetchVPNConfig() {
    try {
        let res = await apiCall('/api/vpn-config');
        if(res && res.success) {
            vpnConfigData = res.data;
            renderVpnGrid();
        }
    } catch(e) {}
}

async function fetchCustomLayout() {
    try {
        let res = await apiCall('/api/custom-layout');
        if(res && res.success && res.data && res.data.sections) {
            window.etalaseData = res.data.sections;
            let container = document.getElementById('custom-layout-container');
            let html = '';
            res.data.sections.forEach((sec, idx) => {
                if(sec.skus && sec.skus.length > 0) {
                    html += `
                    <div class="brand-row" onclick="loadEtalaseProducts(${idx})" style="margin: 0 20px 15px;">
                        <div class="b-logo" style="width: 45px; height: 45px;">
                            ${sec.title.substring(0,2).toUpperCase()}
                        </div>
                        <div class="b-name">${sec.title}</div>
                        <div style="margin-left:auto">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>`;
                }
            });
            if (html !== '') {
                container.innerHTML = '<div class="grid-title">Layanan Unggulan</div>' + html;
            } else {
                container.innerHTML = '';
            }
        }
    } catch(e){}
}

function loadEtalaseProductsInternal(idx) {
    let sec = window.etalaseData[idx];
    if (!sec) return;
    document.getElementById('cat-title-text').innerText = sec.title;
    document.getElementById('search-product').value = '';
    
    let listHTML = '';
    sec.skus.forEach(sku => {
        let p = allProducts[sku];
        if (p) {
            let safeName = p.nama.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            let safeDesc = p.deskripsi ? p.deskripsi.replace(/'/g, "\\'").replace(/"/g, '&quot;') : 'Proses Otomatis';
            let initial = (p.brand || 'O').substring(0,2).toUpperCase();
            let statusBadge = p.status_produk === false 
                ? '<span style="background:var(--bg-main); color:#b91c1c; font-size:9px; padding:4px 8px; border-radius:6px; font-weight:800; box-shadow:var(--shadow-outer); flex-shrink:0; margin-left:8px;">GANGGUAN</span>' 
                : '<span class="badge-open">OPEN</span>';
            let onClickAction = p.status_produk === false
                ? `showToast('Maaf, produk ini sedang gangguan.', 'error')`
                : `openOrderModal('${sku}', '${safeName}', ${p.harga}, '${safeDesc}')`;
            
            listHTML += `
            <div class="product-item" onclick="${onClickAction}">
                <div class="prod-logo">${initial}</div>
                <div class="prod-info">
                    <div class="prod-name">${p.nama} ${statusBadge}</div>
                    <div class="prod-desc">${p.deskripsi ? p.deskripsi.substring(0,40)+'...' : 'Proses Cepat'}</div>
                    <div class="prod-price">Rp ${p.harga.toLocaleString('id-ID')}</div>
                </div>
            </div>`;
        }
    });
    
    document.getElementById('product-list').innerHTML = '<div class="skeleton-box"></div><div class="skeleton-box"></div><div class="skeleton-box"></div>';
    setTimeout(() => {
        document.getElementById('product-list').innerHTML = listHTML || '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">KOSONG</div>';
    }, 600);
    showScreen('produk-screen', 'nav-home');
}

function loadEtalaseProducts(idx) { pushState({screen: 'etalase-screen', idx: idx}); loadEtalaseProductsInternal(idx); }

function renderVpnGrid() {
    let container = document.getElementById('vpn-grid-container');
    if(!vpnConfigData || !vpnConfigData.products) return;

    let protocols = ['SSH', 'Vmess', 'Vless', 'Trojan', 'ZIVPN'];
    let html = '';
    protocols.forEach(proto => {
        let isAvailable = false;
        for(let pId in vpnConfigData.products) {
            let prod = vpnConfigData.products[pId];
            if(prod.protocol.toUpperCase() === proto.toUpperCase()) {
                let sId = prod.server_id;
                if(vpnConfigData.servers && vpnConfigData.servers[sId]) {
                    isAvailable = true;
                    break;
                }
            }
        }
        
        let statusBadge = isAvailable 
            ? '<div style="font-size:9px; background:#16a34a; color:#ffffff; padding:4px 8px; border-radius:6px; margin-top:8px; font-weight:800; box-shadow:var(--shadow-outer);">Tersedia</div>' 
            : '<div style="font-size:9px; background:#ef4444; color:#ffffff; padding:4px 8px; border-radius:6px; margin-top:8px; font-weight:800; box-shadow:var(--shadow-outer);">Kosong</div>';

        let iconSvg = '';
        if(proto.toUpperCase() === 'SSH') iconSvg = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"></path>';
        else if(proto.toUpperCase() === 'VMESS') iconSvg = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>';
        else if(proto.toUpperCase() === 'VLESS') iconSvg = '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>';
        else if(proto.toUpperCase() === 'TROJAN') iconSvg = '<path d="M2 22l5-5M22 2l-5 5M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"></path>';
        else if(proto.toUpperCase() === 'ZIVPN') iconSvg = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>';
        else iconSvg = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>';

        html += `
        <div class="grid-box" onclick="loadVpnCategory('${proto}')">
            <div class="grid-icon-wrap ic-vpn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
                    ${iconSvg}
                </svg>
            </div>
            <div class="grid-text">${proto}</div>
            ${statusBadge}
        </div>`;
    });
    
    html += `
    <div class="grid-box" onclick="showTutorials()">
        <div class="grid-icon-wrap" style="color: #ec4899;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
                <polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
        </div>
        <div class="grid-text">TUTORIAL</div>
    </div>`;

    container.innerHTML = html;
}

function loadVpnCategoryInternal(proto) {
    document.getElementById('brand-cat-title').innerText = proto;
    localStorage.setItem('tendo_current_vpn_proto', proto);
    localStorage.setItem('tendo_current_vpn_server', '');
    localStorage.setItem('tendo_is_vpn', 'true');
    
    let serversMap = {};
    if(vpnConfigData && vpnConfigData.products && vpnConfigData.servers) {
        for(let pId in vpnConfigData.products) {
            let prod = vpnConfigData.products[pId];
            if(prod.protocol.toUpperCase() === proto.toUpperCase()) {
                let sId = prod.server_id;
                if(!serversMap[sId]) {
                    let srv = vpnConfigData.servers[sId];
                    if(srv && srv.host) {
                        let srvName = srv.server_name || sId;
                        let flag = (srv.city && srv.city.toLowerCase().includes('sg')) ? '🇸🇬' : ((srv.city && srv.city.toLowerCase().includes('id')) ? '🇮🇩' : '🌐');
                        serversMap[sId] = { name: srvName, flag: flag };
                    }
                }
            }
        }
    }

    let html = '';
    for(let sId in serversMap) {
        let s = serversMap[sId];
        html += `
        <div class="brand-row" onclick="loadVpnProductsList('${proto}', '${sId}')">
            <div class="b-logo">${s.flag}</div>
            <div class="b-name">Server ${s.name}</div>
            <div style="margin-left:auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
        </div>`;
    }

    if(html === '') html = '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">Belum ada server untuk protokol ini.</div>';
    document.getElementById('brand-list').innerHTML = html;
    showScreen('brand-screen', 'nav-home');
}
function loadVpnCategory(proto) { pushState({screen: 'brand-vpn', proto: proto}); loadVpnCategoryInternal(proto); }

function loadVpnProductsListInternal(proto, serverId) {
    let srv = vpnConfigData.servers[serverId];
    let srvName = srv ? (srv.server_name || serverId) : serverId;
    document.getElementById('cat-title-text').innerText = "Server " + srvName;
    document.getElementById('search-product').value = '';
    localStorage.setItem('tendo_current_vpn_proto', proto);
    localStorage.setItem('tendo_current_vpn_server', serverId);
    localStorage.setItem('tendo_is_vpn', 'true');

    let html = '';
    if(vpnConfigData && vpnConfigData.products) {
        for(let pId in vpnConfigData.products) {
            let prod = vpnConfigData.products[pId];
            if(prod.protocol.toUpperCase() === proto.toUpperCase() && prod.server_id === serverId) {
                let price = prod.price || 0;
                let stok = prod.stok !== undefined ? parseInt(prod.stok) : 0;
                let desc = prod.desc || 'Proses Otomatis';
                let customName = prod.name || `${proto} Premium`;
                let safeDesc = desc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                let safeName = customName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

                let statusBadge = stok > 0 
                    ? '<span class="badge-open" style="background:#16a34a; color:#ffffff; box-shadow:var(--shadow-outer);">STOK: '+stok+'</span>' 
                    : '<span style="background:#ef4444; color:#ffffff; font-size:9px; padding:4px 8px; border-radius:6px; font-weight:800; box-shadow:var(--shadow-outer); flex-shrink:0; margin-left:8px;">HABIS</span>';

                let initial = proto.substring(0,2).toUpperCase();

                html += `
                <div class="product-item" style="cursor:default; display:flex; flex-direction:column; align-items:stretch;">
                    <div style="display:flex; align-items:center; gap:15px; width:100%;">
                        <div class="prod-logo">${initial}</div>
                        <div class="prod-info">
                            <div class="prod-name">${customName} ${statusBadge}</div>
                            <div class="prod-desc">${desc.substring(0,40)}...</div>
                            <div class="prod-price" style="margin-bottom:8px;">Rp ${price.toLocaleString('id-ID')}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:12px; width:100%;">
                        <button class="btn" style="flex:1; padding:12px; font-size:12px; border-radius:12px;" onclick="openVPNOrderModal('${pId}', '${proto}', ${price}, '${safeDesc}', '${safeName}')" ${stok > 0 ? '' : 'disabled'}>Beli Premium</button>
                        <button class="btn-outline" style="flex:1; padding:12px; font-size:12px; border-radius:12px; color:#10b981; margin-top:0;" onclick="openVPNTrialModal('${pId}', '${proto}', '${safeName}')">Trial Gratis</button>
                    </div>
                </div>`;
            }
        }
    }

    document.getElementById('product-list').innerHTML = '<div class="skeleton-box"></div><div class="skeleton-box"></div><div class="skeleton-box"></div>';
    setTimeout(() => {
        document.getElementById('product-list').innerHTML = html || '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">KOSONG</div>';
    }, 600);
    showScreen('produk-screen', 'nav-home');
}
function loadVpnProductsList(proto, serverId) { pushState({screen: 'produk-vpn', proto: proto, serverId: serverId}); loadVpnProductsListInternal(proto, serverId); }

async function loadBanners() {
    try {
        let data = await apiCall('/api/banners');
        let container = document.getElementById('banner-slider-container');
        let slider = document.getElementById('banner-slider');
        
        if (data && data.success && data.data.length > 0) {
            let html = '';
            data.data.forEach(img => {
                html += `<div class="banner-slide"><img src="${img}" alt="Banner"></div>`;
            });
            slider.innerHTML = html;
            container.classList.remove('hidden');
            
            clearInterval(bannerInterval);
            if(data.data.length > 1) {
                bannerInterval = setInterval(() => {
                    if(slider.scrollLeft + slider.clientWidth >= slider.scrollWidth - 10) {
                        slider.scrollTo({ left: 0, behavior: 'smooth' });
                    } else {
                        slider.scrollBy({ left: slider.clientWidth, behavior: 'smooth' });
                    }
                }, 3000);
            }
        } else {
            container.classList.add('hidden');
            clearInterval(bannerInterval);
        }
    } catch(e) {}
}

function filterProducts() {
    let input = document.getElementById('search-product').value.toLowerCase();
    let items = document.querySelectorAll('#product-list .product-item');
    items.forEach(item => {
        let name = item.querySelector('.prod-name').innerText.toLowerCase();
        if (name.includes(input)) item.style.display = 'flex';
        else item.style.display = 'none';
    });
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sb-overlay');
    if(sb.classList.contains('open')) {
        sb.classList.remove('open'); ov.style.opacity = '0'; setTimeout(() => ov.style.display = 'none', 300);
    } else {
        ov.style.display = 'block'; setTimeout(() => { ov.style.opacity = '1'; sb.classList.add('open'); }, 10);
    }
}

function updateNav(activeId) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if(activeId) document.getElementById(activeId).classList.add('active');
}

function showScreen(id, navId) {
    let loader = document.getElementById('initial-loader');
    if(loader) { loader.style.opacity = '0'; setTimeout(() => { if(loader) loader.style.display = 'none'; }, 300); }

    ['login-screen', 'login-otp-screen', 'register-screen', 'otp-screen', 'forgot-screen', 'dashboard-screen', 'brand-screen', 'produk-screen', 'history-screen', 'profile-screen', 'notif-screen', 'global-trx-screen', 'tutorial-screen', 'panel-vpn-screen'].forEach(s => {
        let el = document.getElementById(s);
        if(el) el.classList.add('hidden');
    });
    let targetEl = document.getElementById(id);
    if(targetEl) targetEl.classList.remove('hidden');
    
    if (['dashboard-screen', 'history-screen', 'notif-screen', 'profile-screen', 'brand-screen', 'produk-screen', 'global-trx-screen', 'tutorial-screen'].includes(id)) {
        localStorage.setItem('tendo_last_tab', id);
    }
    if (navId) {
        localStorage.setItem('tendo_last_nav', navId);
        updateNav(navId);
    }
    
    let btnWa = document.getElementById('floating-wa-btn');
    if(id === 'login-screen' || id === 'login-otp-screen' || id === 'register-screen' || id === 'otp-screen' || id === 'forgot-screen' || id === 'panel-vpn-screen') {
        document.getElementById('home-topbar').classList.add('hidden');
        document.getElementById('main-bottom-nav').classList.add('hidden');
        document.getElementById('banner-container-wrap').classList.add('hidden');
        if(btnWa) btnWa.classList.add('hidden');
    } else {
        document.getElementById('home-topbar').classList.remove('hidden');
        document.getElementById('main-bottom-nav').classList.remove('hidden');
        if(btnWa) btnWa.classList.remove('hidden');
        
        if(id === 'dashboard-screen') document.getElementById('banner-container-wrap').classList.remove('hidden');
        else document.getElementById('banner-container-wrap').classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    let savedTheme = localStorage.getItem('tendo_theme');
    if(savedTheme) {
        applyTheme(savedTheme === 'dark');
    } else {
        let hour = new Date().getHours();
        let isNight = hour >= 18 || hour < 6;
        let sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(isNight || sysDark);
    }

    let savedId = localStorage.getItem('tendo_rem_id');
    let savedPass = localStorage.getItem('tendo_rem_pass');
    if(savedId && savedPass) {
        document.getElementById('log-id').value = savedId;
        document.getElementById('log-pass').value = savedPass;
        login(true);
    } else {
        showDashboardInternal(); 
    }
});

async function showDashboardInternal() { 
    showScreen('dashboard-screen', 'nav-home'); 
    if(currentUser) {
        syncUserData(); 
    } else {
        let sbAvatar = document.getElementById('sb-avatar');
        if(sbAvatar) sbAvatar.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--nav-active)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        document.getElementById('sb-name').innerText = "Guest (Belum Login)";
        document.getElementById('sb-phone').innerText = "Silakan login untuk transaksi";
        document.getElementById('user-saldo').innerText = "Rp 0";
        document.getElementById('top-trx-badge').innerText = "0 Trx";
        let btnSidebarLogout = document.getElementById('sidebar-logout-btn');
        if(btnSidebarLogout) btnSidebarLogout.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> <span>Masuk / Daftar</span>';
    }
    await fetchAllProducts(); 
    fetchCustomLayout();
    fetchVPNConfig(); 
    fetchLeaderboard();
}
function showDashboard() { pushState({screen: 'dashboard-screen'}); showDashboardInternal(); }

async function showTutorialsInternal() {
    showScreen('tutorial-screen', 'nav-home');
    try {
        let data = await apiCall('/api/tutorials');
        let html = '';
        if(data && Array.isArray(data) && data.length > 0) {
            data.forEach(t => {
                let videoHtml = '';
                if(t.video && t.video !== '' && t.video !== '-') {
                    videoHtml = `<video width="100%" controls style="border-radius:10px; margin-bottom:10px; background:#000;">
                        <source src="/tutorials/${t.video}" type="video/mp4">
                    </video>`;
                }
                
                html += `
                <div class="card" style="margin-bottom:15px; padding:20px;">
                    <h3 style="margin-top:0; font-size:15px; color:var(--text-main);">${t.title}</h3>
                    ${videoHtml}
                    <div style="font-size:12px; color:var(--text-muted); line-height:1.6; white-space: pre-line;">${t.desc}</div>
                </div>`;
            });
        } else {
            html = '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">Belum ada tutorial saat ini.</div>';
        }
        document.getElementById('tutorial-list').innerHTML = html;
    } catch(e){}
}
function showTutorials() { pushState({screen: 'tutorial-screen'}); showTutorialsInternal(); }

window.showPanelVPNInternal = function() {
    showScreen('panel-vpn-screen');
    let sel = document.getElementById('mv-server');
    sel.innerHTML = '<option value="">Pilih Server...</option>';
    if(vpnConfigData && vpnConfigData.servers) {
        for(let id in vpnConfigData.servers) {
            let opt = document.createElement('option');
            opt.value = id; opt.innerText = id + ' - ' + vpnConfigData.servers[id].server_name;
            sel.appendChild(opt);
        }
    }
}
window.showPanelVPN = function() { pushState({screen: 'panel-vpn-screen'}); showPanelVPNInternal(); }

window.toggleManualVpnFields = function() {
    let mode = document.getElementById('mv-mode').value;
    let type = document.getElementById('mv-type').value;
    if(mode === 'trial') {
        document.getElementById('mv-reguler-group').style.display = 'none';
        document.getElementById('mv-pass-group').style.display = 'none';
        document.getElementById('mv-trial-info').style.display = 'block';
    } else {
        document.getElementById('mv-reguler-group').style.display = 'block';
        document.getElementById('mv-trial-info').style.display = 'none';
        if(type === 'ssh' || type === 'zivpn') document.getElementById('mv-pass-group').style.display = 'block';
        else document.getElementById('mv-pass-group').style.display = 'none';
    }
}

window.processManualVpn = async function() {
    let server_id = document.getElementById('mv-server').value;
    let mode = document.getElementById('mv-mode').value;
    let type = document.getElementById('mv-type').value;
    let username = document.getElementById('mv-user').value;
    let password = document.getElementById('mv-pass').value;
    let expired = document.getElementById('mv-exp').value;

    if(!server_id) return showToast('Pilih server terlebih dahulu!', 'error');
    if(mode === 'reguler' && (!username || username.trim() === '')) return showToast('Isi username pelanggan!', 'error');

    let btn = document.getElementById('btn-mv-submit');
    let ori = btn.innerText; btn.innerText = "Memproses Ke VPS..."; btn.disabled = true;
    document.getElementById('mv-result').classList.add('hidden');

    try {
        let res = await apiCall('/api/manual-vpn', {server_id, mode, type, username, password, expired});
        if(res.success) {
            showToast('Akun berhasil dibuat di server!', 'success');
            let d = res.data; let srv = res.server;
            let expStr = mode === 'trial' ? '30 Menit' : expired + ' Hari';
            
            let text = `====================================\nAkun ${type.toUpperCase()} ${mode === 'trial'?'Trial':'Premium'}\n====================================\n`;
            text += `Domain Host  : ${srv.host}\n`;
            text += `City         : ${d.city || srv.city || '-'}\n`;
            text += `ISP          : ${d.isp || srv.isp || '-'}\n`;
            text += `Username     : ${d.username || username || 'TrialUser'}\n`;
            
            if(type === 'ssh' || type === 'zivpn') {
                text += `Password     : ${d.password || password || '1'}\n`;
            } else {
                text += `ID / UUID    : ${d.uuid || d.id || '-'}\n`;
            }
            text += `Expired On   : ${d.expired || d.exp || d.to || expStr}\n`;
            text += `Limit IP     : 2 Device\n`;
            text += `====================================\n`;

            if(d.port) {
                text += `[ Informasi Port ]\nTLS: ${d.port.tls || '-'}\nNon-TLS: ${d.port.none || '-'}\nUDP Custom: ${d.port.udpcustom || '-'}\n====================================\n`;
            }

            if(d.link) {
                if(d.link.tls) text += `[ Link TLS ]\n${d.link.tls}\n====================================\n`;
                if(d.link.none) text += `[ Link Non-TLS ]\n${d.link.none}\n====================================\n`;
                if(d.link.grpc) text += `[ Link gRPC ]\n${d.link.grpc}\n====================================\n`;
            }

            document.getElementById('mv-result-text').value = text;
            document.getElementById('mv-result').classList.remove('hidden');
        } else {
            showToast('Gagal: ' + res.message, 'error');
        }
    } catch(e) { showToast('Kesalahan Jaringan: ' + e.message, 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

function showHistoryInternal(filter) { 
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu.", "error");
        showScreen("login-screen", null);
        return;
    }
    currentHistoryFilter = filter;
    localStorage.setItem('tendo_history_filter', filter);

    document.getElementById('tab-hist-order').classList.remove('active');
    document.getElementById('tab-hist-topup').classList.remove('active');
    
    if(filter === 'Topup') {
        document.getElementById('tab-hist-topup').classList.add('active');
        document.getElementById('history-title-text').innerText = 'Riwayat Topup';
    } else {
        document.getElementById('tab-hist-order').classList.add('active');
        document.getElementById('history-title-text').innerText = 'Riwayat Transaksi';
    }
    showScreen('history-screen', 'nav-history'); 
    syncUserData(); 
}
function showHistory(filter = 'Order') { pushState({screen: 'history-screen', filter: filter}); showHistoryInternal(filter); }

function filterHistoryStatus(status, el) {
    currentHistoryStatusFilter = status;
    let btns = document.querySelectorAll('#status-filter-container .status-btn');
    btns.forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    syncUserData();
}

function showProfileInternal() { 
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu.", "error");
        showScreen("login-screen", null);
        return;
    }
    showScreen('profile-screen', 'nav-profile'); syncUserData(); 
}
function showProfile() { pushState({screen: 'profile-screen'}); showProfileInternal(); }

async function showGlobalTrxInternal() {
    showScreen('global-trx-screen', 'nav-global-trx');
    try {
        let data = await apiCall('/api/global-trx');
        let html = '';
        if(data && Array.isArray(data) && data.length > 0) {
            data.forEach(n => {
                html += `
                <div class="card" style="border-left: 4px solid #10b981; margin-bottom:15px; padding:18px;">
                    <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-bottom:5px; font-weight:700;">
                        <span>🕒 ${n.time} WIB</span>
                        <span style="color:#10b981;">Berhasil</span>
                    </div>
                    <div style="font-weight:800; font-size:14px; margin-bottom:4px; color:var(--text-main);">${n.product}</div>
                    <div style="font-size:12px; font-weight:600; color:var(--text-muted);">Akun: ${n.user}</div>
                    <div style="font-size:12px; font-weight:600; color:var(--text-muted);">Tujuan: ${n.target}</div>
                    <div style="font-size:12px; font-weight:600; color:var(--text-muted);">Harga: Rp ${n.price ? n.price.toLocaleString('id-ID') : '0'}</div>
                    <div style="font-size:12px; font-weight:600; color:var(--text-muted);">Metode: ${n.method || 'Saldo Akun'}</div>
                </div>`;
            });
        } else {
            html = '<div style="text-align:center; color:var(--text-muted); padding:30px; font-size:13px; font-weight:bold;">Belum ada transaksi terbaru.</div>';
        }
        document.getElementById('global-trx-list').innerHTML = html;
    } catch(e){}
}
function showGlobalTrx() { pushState({screen: 'global-trx-screen'}); showGlobalTrxInternal(); }

async function showNotifInternal() { 
    showScreen('notif-screen', 'nav-notif'); 
    try {
        let data = await apiCall('/api/notif');
        let html = '';
        if(data && Array.isArray(data) && data.length > 0) {
            data.forEach(n => {
                let imgTag = '';
                if(n.image) {
                    let imgSrc = n.image.startsWith('maint_') ? `/maint_images/${n.image}` : `/info_images/${n.image}`;
                    imgTag = `<img src="${imgSrc}" style="width:100%; border-radius:12px; margin-bottom:12px; display:block;">`;
                }
                
                html += `
                <div class="card" style="border-left: 4px solid var(--nav-active); margin-bottom:15px; padding:18px;">
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:5px; font-weight:700;">${n.date}</div>
                    <h3 style="margin-top:0; color: var(--text-main); font-size:15px; margin-bottom:12px;">📢 Info Terbaru</h3>
                    ${imgTag}
                    <p style="color: var(--text-muted); line-height: 1.6; font-size:13px; white-space: pre-wrap; font-weight: 500; margin:0;">${n.text}</p>
                </div>`;
            });
        } else {
            html = '<div style="text-align:center; color:var(--text-muted); padding:30px; font-size:13px; font-weight:bold;">Tidak ada pemberitahuan sistem saat ini.</div>';
        }
        document.getElementById('notif-list').innerHTML = html;
    } catch(e){}
}
function showNotif() { pushState({screen: 'notif-screen'}); showNotifInternal(); }

function openTopupModal() { 
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu untuk isi saldo.", "error");
        showScreen("login-screen", null);
        return;
    }
    document.getElementById('topup-nominal').value = ''; document.getElementById('topup-modal').classList.remove('hidden'); 
}
function closeTopupModal() { document.getElementById('topup-modal').classList.add('hidden'); }

async function generateQris() {
    let nom = parseInt(document.getElementById('topup-nominal').value);
    if(!nom || nom < 1000) return showToast("Minimal Topup Rp 1.000", "error");
    let btn = document.getElementById('btn-topup-submit');
    btn.innerText = "Memproses..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/topup', {phone: currentUser, nominal: nom});
        if(data && data.success) { 
            closeTopupModal();
            document.getElementById('topup-success-modal').classList.remove('hidden');
        } else { showToast(data.message || "Sistem QRIS Sedang Gangguan / Belum diatur admin.", "error"); }
    } catch(e) { showToast("Kesalahan server.", "error"); }
    
    btn.innerText = "Buat QRIS"; btn.disabled = false;
}

async function closeTopupSuccessModal() {
    document.getElementById('topup-success-modal').classList.add('hidden');
    await syncUserData(); 
    showHistory('Topup');
    if(userData.history && userData.history.length > 0) {
        let latest = userData.history.find(h => (h.type === 'Topup' || h.type === 'Order QRIS' || h.type === 'Order VPN QRIS') && h.status === 'Pending');
        if(latest) openHistoryDetail(latest);
    }
}

async function shareQRIS() {
    let imgUrl = document.getElementById('hd-qris-img').src;
    if(!imgUrl) return;
    try {
        let response = await fetch(imgUrl, { mode: 'cors' });
        let blob = await response.blob();
        let file = new File([blob], "QRIS_Digital_Tendo.jpg", { type: "image/jpeg" });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: 'QRIS Pembayaran',
                text: 'Silakan scan QRIS berikut untuk melakukan pembayaran.',
                files: [file]
            });
        } else {
            showToast("Browser tidak mendukung bagikan gambar. Gunakan tombol Simpan.", "error");
        }
    } catch(e) { showToast("Gagal membagikan gambar QRIS.", "error"); }
}

async function downloadQRIS() {
    let imgUrl = document.getElementById('hd-qris-img').src;
    if(!imgUrl) return;
    try {
        let response = await fetch(imgUrl, { mode: 'cors' });
        let blob = await response.blob();
        let url = window.URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = 'QRIS_Topup_' + Date.now() + '.jpg';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch(e) {
        let a = document.createElement('a');
        a.href = imgUrl;
        a.target = '_blank';
        a.download = 'QRIS_Topup.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

function manualTopupWA() {
    let email = userData.email || "-";
    let phone = currentUser || "-";
    let nom = document.getElementById('topup-nominal').value || "[Sebutkan Nominal]";
    let pesan = `Halo Admin Digital Tendo Store,%0A%0ASaya ingin melakukan *Topup Saldo Manual*.%0A%0A📧 Email Akun: *${email}*%0A📱 Nomor WA: *${phone}*%0A💰 Nominal: *Rp ${nom}*%0A%0AMohon info panduan transfernya. Terima kasih.`;
    window.open(`https://wa.me/${adminWaNumber}?text=${pesan}`, '_blank');
}

async function logout() {
    try {
        await apiCall('/api/logout', {});
    } catch(e){}
    currentUser = ""; userData = {}; 
    localStorage.removeItem('tendo_rem_id'); localStorage.removeItem('tendo_rem_pass');
    localStorage.removeItem('tendo_last_tab'); localStorage.removeItem('tendo_last_nav');
    localStorage.removeItem('tendo_history_filter');
    localStorage.removeItem('tendo_current_cat'); localStorage.removeItem('tendo_current_brand');
    localStorage.removeItem('tendo_current_vpn_proto'); localStorage.removeItem('tendo_current_vpn_server');
    localStorage.removeItem('tendo_is_vpn');
    localStorage.removeItem('tendo_token');
    let btnSidebarLogout = document.getElementById('sidebar-logout-btn');
    if(btnSidebarLogout) btnSidebarLogout.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> <span>Keluar Akun</span>';
    toggleSidebar(); showScreen('login-screen', null);
    document.getElementById('log-pass').value = '';
}

async function syncUserData() {
    if(!currentUser) return;
    try {
        let data = await apiCall('/api/user/' + currentUser);
        if(data && data.success) {
            userData = data.data; let u = userData;
            
            let elSaldo = document.getElementById('user-saldo');
            elSaldo.setAttribute('data-saldo', u.saldo);
            elSaldo.innerText = 'Rp ' + u.saldo.toLocaleString('id-ID');

            document.getElementById('top-trx-badge').innerText = (u.trx_count || 0) + ' Trx';
            
            let shanksGif = 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
            document.getElementById('sb-avatar').innerHTML = '<img src="' + shanksGif + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
            document.getElementById('sb-name').innerText = u.username || "Member";
            document.getElementById('sb-phone').innerText = currentUser;

            let btnSidebarLogout = document.getElementById('sidebar-logout-btn');
            if(btnSidebarLogout) btnSidebarLogout.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> <span>Keluar Akun</span>';

            document.getElementById('p-avatar').innerHTML = '<img src="' + shanksGif + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
            document.getElementById('p-username').innerText = u.username || "Member";
            document.getElementById('p-id').innerText = "ID: " + (u.id_pelanggan || "TD-000");
            document.getElementById('p-email').innerText = u.email || '-';
            document.getElementById('p-username-val').innerText = u.username || "Member";
            document.getElementById('p-phone').innerText = currentUser;
            document.getElementById('p-date').innerText = u.tanggal_daftar || '-';
            document.getElementById('p-trx').innerText = (u.trx_count || 0) + ' Kali';

            let histHTML = '';
            let historyList = u.history || [];
            
            historyList = historyList.filter(h => {
                let typeMatch = false;
                let type = h.type || 'Order';
                if (currentHistoryFilter === 'Topup') typeMatch = (type === 'Topup');
                else typeMatch = (type === 'Order' || type === 'Order QRIS' || type === 'Refund' || type === 'Order VPN' || type === 'Order VPN QRIS');
                
                if(!typeMatch) return false;

                if (currentHistoryStatusFilter === 'Semua') return true;
                if (currentHistoryStatusFilter === 'Sukses' && (h.status === 'Sukses' || h.status === 'Sukses Bayar')) return true;
                if (currentHistoryStatusFilter === 'Pending' && h.status === 'Pending') return true;
                if (currentHistoryStatusFilter === 'Gagal' && (h.status === 'Gagal' || h.status === 'Gagal (Kedaluwarsa)' || h.status === 'Gagal (Dibatalkan)' || h.status === 'Refund')) return true;
                
                return false;
            });

            if(historyList.length === 0) histHTML = '<div style="text-align:center; color:var(--text-muted); font-weight:bold; margin-top: 30px; font-size:13px;">Belum ada transaksi di filter ini.</div>';
            else {
                historyList.forEach((h, idx) => {
                    let statClass = 'stat-Pending';
                    if(h.status === 'Sukses' || h.status === 'Sukses Bayar') statClass = 'stat-Sukses';
                    if(h.status === 'Gagal' || h.status === 'Gagal (Kedaluwarsa)' || h.status === 'Gagal (Dibatalkan)') statClass = 'stat-Gagal';
                    if(h.type === 'Refund' || h.status === 'Refund') statClass = 'stat-Refund';
                    
                    let displayTujuan = h.tujuan; 
                    
                    let safeH = JSON.stringify(h).replace(/"/g, '&quot;');
                    histHTML += `
                        <div class="hist-item" onclick='openHistoryDetail(${safeH})'>
                            <div class="hist-top"><span>${h.tanggal}</span> <span class="stat-badge ${statClass}">${h.status}</span></div>
                            <div class="hist-title" style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="max-width:65%;">${h.nama}</span>
                                <span style="color:var(--nav-active); font-size:13px;">Rp ${h.amount ? h.amount.toLocaleString('id-ID') : '0'}</span>
                            </div>
                            <div class="hist-target">Tujuan: ${displayTujuan}</div>
                        </div>
                    `;
                });
            }
            document.getElementById('history-list').innerHTML = histHTML;
        }
    } catch(e) {}
}

function startQrisCountdown(expiredAt) {
    clearInterval(qrisInterval);
    let el = document.getElementById('qris-countdown');
    
    function update() {
        let now = Date.now();
        let diff = expiredAt - now;
        if (diff <= 0) {
            clearInterval(qrisInterval);
            el.innerText = "KEDALUWARSA";
            document.getElementById('hd-status').innerText = 'Gagal (Kedaluwarsa)';
            document.getElementById('hd-qris-box').classList.add('hidden');
            if(currentHistoryItem) currentHistoryItem.status = 'Gagal (Kedaluwarsa)';
        } else {
            let m = Math.floor(diff / 60000);
            let s = Math.floor((diff % 60000) / 1000);
            el.innerText = (m < 10 ? "0" + m : m) + " : " + (s < 10 ? "0" + s : s);
        }
    }
    update();
    qrisInterval = setInterval(update, 1000);
}

function openHistoryDetail(h) {
    currentHistoryItem = h;
    document.getElementById('hd-time').innerText = h.tanggal;
    document.getElementById('hd-status').innerText = h.status;
    document.getElementById('hd-name').innerText = h.nama;
    document.getElementById('hd-amount').innerText = h.amount ? 'Rp ' + h.amount.toLocaleString('id-ID') : '-';
    
    let displayTujuan = h.tujuan; 
    document.getElementById('hd-target').innerText = displayTujuan;
    
    document.getElementById('hd-sn').innerText = h.sn || '-';
    
    let btnComplain = document.getElementById('hd-complain-btn');
    btnComplain.classList.remove('hidden'); 

    let btnCancel = document.getElementById('hd-cancel-topup-btn');
    if(h.type === 'Topup' && h.status === 'Pending') {
        btnCancel.classList.remove('hidden');
    } else {
        btnCancel.classList.add('hidden');
    }

    if(h.saldo_sebelumnya !== undefined) {
        document.querySelectorAll('.hd-saldo-row').forEach(el => el.classList.remove('hidden'));
        document.getElementById('hd-saldo-sebelum').innerText = 'Rp ' + h.saldo_sebelumnya.toLocaleString('id-ID');
        document.getElementById('hd-saldo-sesudah').innerText = 'Rp ' + h.saldo_sesudah.toLocaleString('id-ID');
    } else {
        document.querySelectorAll('.hd-saldo-row').forEach(el => el.classList.add('hidden'));
    }
    
    let qrisBox = document.getElementById('hd-qris-box');
    if((h.type === 'Topup' || h.type === 'Order QRIS' || h.type === 'Order VPN QRIS') && h.status === 'Pending') {
        if(Date.now() < h.expired_at) {
            document.getElementById('hd-qris-img').src = h.qris_url;
            document.getElementById('hd-qris-amount').innerText = 'Rp ' + h.amount.toLocaleString('id-ID');
            qrisBox.classList.remove('hidden');
            startQrisCountdown(h.expired_at);
        } else {
            qrisBox.classList.add('hidden');
            document.getElementById('hd-status').innerText = 'Gagal (Kedaluwarsa)';
        }
    } else {
        qrisBox.classList.add('hidden');
        clearInterval(qrisInterval);
    }

    let vpnInfoBox = document.getElementById('hd-vpn-info-box');
    if(h.vpn_details) {
        document.getElementById('hd-vpn-details').value = h.vpn_details;
        vpnInfoBox.classList.remove('hidden');
    } else {
        vpnInfoBox.classList.add('hidden');
    }
    
    document.getElementById('history-detail-modal').classList.remove('hidden');
}

function closeHistoryModal() { 
    clearInterval(qrisInterval);
    document.getElementById('history-detail-modal').classList.add('hidden'); 
}

async function cancelTopup() {
    if(!currentHistoryItem) return;
    if(confirm("Yakin ingin membatalkan topup ini?")) {
        let btn = document.getElementById('hd-cancel-topup-btn');
        let ori = btn.innerText; btn.innerText = "Membatalkan..."; btn.disabled = true;
        try {
            let res = await apiCall('/api/cancel-topup', { sn: currentHistoryItem.sn, phone: currentUser });
            if(res.success) {
                showToast("Topup berhasil dibatalkan", "success");
                closeHistoryModal();
                syncUserData();
            } else {
                showToast(res.message || "Gagal membatalkan", "error");
            }
        } catch(e) { showToast("Kesalahan jaringan", "error"); }
        btn.innerText = ori; btn.disabled = false;
    }
}

function contactAdmin() {
    let pesan = `Halo Admin Digital Tendo Store,%0A%0ASaya butuh bantuan terkait akun / layanan.`;
    window.open(`https://wa.me/${adminWaNumber}?text=${pesan}`, '_blank');
}

function complainAdmin() {
    let h = currentHistoryItem;
    if(!h) { contactAdmin(); return; }
    let email = userData.email || "-";
    let phone = currentUser || "-";
    let currentSaldo = userData.saldo || 0;
    let pesan = `Halo Admin Digital Tendo Store,%0A%0ASaya ingin komplain/tanya transaksi ini:%0A%0A📧 Email: *${email}*%0A📱 Nomor WA: *${phone}*%0A💰 Saldo Saat Ini: *Rp ${currentSaldo.toLocaleString('id-ID')}*%0A💸 Nominal Transaksi: *Rp ${h.amount ? h.amount.toLocaleString('id-ID') : '0'}*%0A📦 Layanan: *${h.nama}*%0A📱 Tujuan: *${h.tujuan}*%0A🕒 Waktu: *${h.tanggal}*%0A⚙️ Status: *${h.status}*%0A🔑 SN/Ref: *${h.sn || '-'}*%0A%0AMohon bantuannya dicek.%0A%0A_*(Note: Jika komplain topup/pembayaran belum masuk, mohon kirimkan juga foto/bukti transfernya)*_ Terima kasih.`;
    window.open(`https://wa.me/${adminWaNumber}?text=${pesan}`, '_blank');
}

async function login(isAuto = false) {
    let idLogin = document.getElementById('log-id').value.trim();
    let pass = document.getElementById('log-pass').value.trim();
    let rem = document.getElementById('rem-login').checked;
    if(!idLogin || !pass) {
        if(!isAuto) showToast('Isi Email/WA/Username & Password!', 'error');
        return;
    }
    
    let btn = document.getElementById('btn-login');
    let ori = btn.innerText;
    btn.innerText = "Memeriksa..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/login', {id: idLogin, password:pass});
        if(data && data.success) {
            currentUser = data.phone; userData = data.data;
            if(data.token) localStorage.setItem('tendo_token', data.token);
            await fetchAllProducts(); 
            await fetchVPNConfig();
            fetchGlobalStats();
            fetchLeaderboard();
            loadBanners();
            
            let lastTab = localStorage.getItem('tendo_last_tab') || 'dashboard-screen';
            currentState = { screen: lastTab };
            let isVpn = localStorage.getItem('tendo_is_vpn') === 'true';
            
            if (lastTab === 'history-screen') {
                let savedFilter = localStorage.getItem('tendo_history_filter') || 'Order';
                showHistoryInternal(savedFilter);
                currentState.filter = savedFilter;
            }
            else if (lastTab === 'profile-screen') showProfileInternal();
            else if (lastTab === 'notif-screen') showNotifInternal();
            else if (lastTab === 'global-trx-screen') showGlobalTrxInternal();
            else if (lastTab === 'tutorial-screen') showTutorialsInternal();
            else if (lastTab === 'panel-vpn-screen') showPanelVPNInternal();
            else if (lastTab === 'brand-screen') {
                if(isVpn) {
                    let cProto = localStorage.getItem('tendo_current_vpn_proto');
                    if(cProto) { loadVpnCategoryInternal(cProto); currentState = {screen: 'brand-vpn', proto: cProto}; }
                    else showDashboardInternal();
                } else {
                    let cCat = localStorage.getItem('tendo_current_cat');
                    if(cCat) { loadCategoryInternal(cCat); currentState.cat = cCat; currentState.subcat_mode = false; }
                    else showDashboardInternal();
                }
            }
            else if (lastTab === 'produk-screen') {
                if(isVpn) {
                    let cProto = localStorage.getItem('tendo_current_vpn_proto');
                    let cServer = localStorage.getItem('tendo_current_vpn_server');
                    if(cProto && cServer) { loadVpnProductsListInternal(cProto, cServer); currentState = {screen: 'produk-vpn', proto: cProto, serverId: cServer}; }
                    else showDashboardInternal();
                } else {
                    let cCat = localStorage.getItem('tendo_current_cat');
                    let cBrand = localStorage.getItem('tendo_current_brand');
                    let cSub = localStorage.getItem('tendo_current_subcat');
                    if(cCat && cBrand) { 
                        loadProductsInternal(cCat, cBrand, (cSub === 'null' ? null : cSub)); 
                        currentState.cat = cCat; currentState.brand = cBrand; currentState.subcat = (cSub === 'null' ? null : cSub);
                    } else showDashboardInternal();
                }
            }
            else showDashboardInternal();
            
            if(rem) { localStorage.setItem('tendo_rem_id', idLogin); localStorage.setItem('tendo_rem_pass', pass); }
            if(!isAuto) showToast('Berhasil Masuk!', 'success');
        } else {
            if(!isAuto) showToast(data && data.message ? data.message : "Data tidak cocok atau Gagal terhubung.", 'error');
            localStorage.removeItem('tendo_rem_id');
            localStorage.removeItem('tendo_rem_pass');
        }
    } catch(e) { if(!isAuto) showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function verifyLoginOTP() {}

async function requestOTP() {
    let user = document.getElementById('reg-user').value.trim();
    let email = document.getElementById('reg-email').value.trim();
    let phone = document.getElementById('reg-phone').value.trim();
    let pass = document.getElementById('reg-pass').value.trim();
    if(!user || !email || !phone || !pass) return showToast('Semua kolom wajib diisi!', 'error');
    
    let btn = document.getElementById('btn-register');
    let ori = btn.innerText;
    btn.innerText = "Mengirim..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/register', {username:user, email, phone, password:pass});
        if(data && data.success) { 
            tempRegPhone = phone; showScreen('otp-screen', null); 
        } else {
            showToast(data && data.message ? data.message : "Pendaftaran Gagal.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan. Pastikan internet lancar.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function verifyOTP() {
    let otp = document.getElementById('otp-code').value.trim();
    if(!otp) return showToast('Masukkan OTP!', 'error');
    
    let btn = document.getElementById('btn-verify');
    let ori = btn.innerText;
    btn.innerText = "Memproses..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/verify-otp', {phone: tempRegPhone, otp});
        if(data && data.success) {
            showToast('Pendaftaran Berhasil! Silakan Login.', 'success');
            document.getElementById('log-id').value = document.getElementById('reg-user').value;
            document.getElementById('log-pass').value = document.getElementById('reg-pass').value;
            showScreen('login-screen', null);
        } else {
            showToast(data && data.message ? data.message : "Sistem sibuk, coba sesaat lagi.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function reqForgotOTP() {
    let phone = document.getElementById('forgot-phone').value.trim();
    if(!phone) return showToast('Masukkan Nomor WhatsApp!', 'error');
    
    let btn = document.getElementById('btn-req-forgot');
    let ori = btn.innerText; btn.innerText = "Mengirim..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/req-forgot-otp', {phone});
        if(data && data.success) {
            tempForgotPhone = phone;
            document.getElementById('forgot-step-1').classList.add('hidden');
            document.getElementById('forgot-step-2').classList.remove('hidden');
        } else {
            showToast(data && data.message ? data.message : "Nomor tidak terdaftar.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function verifyForgotOTP() {
    let otp = document.getElementById('forgot-otp').value.trim();
    let newPass = document.getElementById('forgot-new-pass').value.trim();
    if(!otp || !newPass) return showToast('Isi OTP dan Password Baru!', 'error');
    
    let btn = document.getElementById('btn-verify-forgot');
    let ori = btn.innerText; btn.innerText = "Memproses..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/verify-forgot-otp', {phone: tempForgotPhone, otp, newPass});
        if(data && data.success) {
            showToast('Password berhasil diubah! Silakan login.', 'success');
            showScreen('login-screen', null);
            document.getElementById('forgot-step-1').classList.remove('hidden');
            document.getElementById('forgot-step-2').classList.add('hidden');
            document.getElementById('forgot-phone').value = '';
            document.getElementById('forgot-otp').value = '';
            document.getElementById('forgot-new-pass').value = '';
        } else {
            showToast(data && data.message ? data.message : "Sistem error.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

window.openEditModal = function(type) {
    currentEditMode = type;
    let inp = document.getElementById('edit-input');
    document.getElementById('edit-step-1').classList.remove('hidden');
    document.getElementById('edit-step-2').classList.add('hidden');
    
    if(type === 'email') { 
        document.getElementById('edit-title').innerText = "Ganti Email"; 
        inp.type="email"; inp.placeholder="Email baru"; inp.value = (userData && userData.email) ? userData.email : "";
    }
    if(type === 'phone') { 
        document.getElementById('edit-title').innerText = "Ganti Nomor WA"; 
        inp.type="number"; inp.placeholder="Nomor WA baru (08/62)"; inp.value = currentUser ? currentUser : "";
    }
    if(type === 'password') { 
        document.getElementById('edit-title').innerText = "Ganti Password"; 
        inp.type="text"; inp.placeholder="Password baru"; inp.value = "";
    }
    document.getElementById('edit-modal').classList.remove('hidden');
};

function closeEditModal() { document.getElementById('edit-modal').classList.add('hidden'); }

async function reqEditOTP() {
    let val = document.getElementById('edit-input').value.trim();
    if(!val) return showToast("Isi data baru!", 'error');
    
    let btn = document.getElementById('btn-req-edit');
    let ori = btn.innerText; btn.innerText = "Mengirim..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/req-edit-otp', {phone: currentUser, type: currentEditMode, newValue: val});
        if(data && data.success) {
            document.getElementById('edit-step-1').classList.add('hidden');
            document.getElementById('edit-step-2').classList.remove('hidden');
        } else {
            showToast(data && data.message ? data.message : "Error server", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function verifyEditOTP() {
    let otp = document.getElementById('edit-otp-input').value.trim();
    if(!otp) return showToast("Masukkan OTP!", 'error');
    
    let btn = document.getElementById('btn-verify-edit');
    let ori = btn.innerText; btn.innerText = "Memproses..."; btn.disabled = true;
    
    try {
        let data = await apiCall('/api/verify-edit-otp', {phone: currentUser, otp: otp});
        if(data && data.success) {
            showToast("Berhasil diubah!", 'success');
            closeEditModal();
            if(currentEditMode === 'phone' || currentEditMode === 'password') { logout(); } 
            else { syncUserData(); }
        } else {
            showToast(data && data.message ? data.message : "Error server", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

async function fetchAllProducts() {
    try {
        let data = await apiCall('/api/produk');
        if(data) { allProducts = data; }
    } catch(e){}
}

function loadCategoryInternal(cat) {
    currentCategory = cat; currentBrand = "";
    localStorage.setItem('tendo_current_cat', cat);
    localStorage.setItem('tendo_current_brand', '');
    localStorage.setItem('tendo_current_subcat', '');
    localStorage.setItem('tendo_is_vpn', 'false');
    
    document.getElementById('brand-cat-title').innerText = cat;
    document.getElementById('brand-list').innerHTML = '';
    
    let brands = [];
    for(let key in allProducts) {
        if(allProducts[key].kategori !== cat) continue;
        let b = allProducts[key].brand || 'Lainnya';
        if ((cat === 'Game' || cat === 'Data' || cat === 'Pulsa') && b === 'Lainnya') continue;
        if(!brands.includes(b)) brands.push(b);
    }

    if(brands.length > 0) {
        brands.sort();
        let gridHTML = '';
        brands.forEach(b => {
            let initial = b.substring(0,2).toUpperCase();
            let clickAction = (cat === 'Data') ? `loadSubCategory('${cat}', '${b}')` : `loadProducts('${cat}', '${b}')`;
            
            gridHTML += `
            <div class="brand-row" onclick="${clickAction}">
                <div class="b-logo">${initial}</div>
                <div class="b-name">${b}</div>
                <div style="margin-left:auto">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>`;
        });
        document.getElementById('brand-list').innerHTML = gridHTML;
        showScreen('brand-screen', 'nav-home');
    } else { 
        showToast('Belum ada produk di kategori ini.', 'error');
        document.getElementById('brand-list').innerHTML = '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">Kategori ini sedang kosong</div>'; 
    }
}
function loadCategory(cat) { pushState({screen: 'brand-screen', cat: cat, subcat_mode: false}); loadCategoryInternal(cat); }

function loadSubCategoryInternal(cat, brand) {
    currentCategory = cat; currentBrand = brand;
    localStorage.setItem('tendo_current_cat', cat);
    localStorage.setItem('tendo_current_brand', brand);
    localStorage.setItem('tendo_current_subcat', '');
    localStorage.setItem('tendo_is_vpn', 'false');

    document.getElementById('brand-cat-title').innerText = brand + " (Paket)";
    
    let subs = [];
    for(let key in allProducts) {
        let p = allProducts[key];
        if(p.kategori === cat && (p.brand || 'Lainnya') === brand) {
            let s = p.sub_kategori || 'Umum';
            if(!subs.includes(s)) subs.push(s);
        }
    }
    
    if(subs.length > 0) {
        let sortedSubs = subs.sort((a, b) => {
            let aIsCustom = a.startsWith('\u200B');
            let bIsCustom = b.startsWith('\u200B');
            if (aIsCustom && !bIsCustom) return -1;
            if (!aIsCustom && bIsCustom) return 1;
            return a.localeCompare(b);
        });
        let gridHTML = '';
        sortedSubs.forEach(s => {
            let displayS = s.replace('\u200B', '');
            let initial = displayS.substring(0,2).toUpperCase();
            gridHTML += `
            <div class="brand-row" onclick="loadProducts('${cat}', '${brand}', '${s}')">
                <div class="b-logo">${initial}</div>
                <div class="b-name">${displayS}</div>
                <div style="margin-left:auto">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>`;
        });
        document.getElementById('brand-list').innerHTML = gridHTML;
        showScreen('brand-screen', 'nav-home');
    } else { showToast('Belum ada paket untuk provider ini.', 'error'); }
}
function loadSubCategory(cat, brand) { pushState({screen: 'brand-screen', cat: cat, brand: brand, subcat_mode: true}); loadSubCategoryInternal(cat, brand); }

function loadProductsInternal(cat, brand, subCat = null) {
    currentCategory = cat; currentBrand = brand;
    localStorage.setItem('tendo_current_cat', cat);
    localStorage.setItem('tendo_current_brand', brand);
    localStorage.setItem('tendo_current_subcat', subCat || 'null');
    localStorage.setItem('tendo_is_vpn', 'false');

    document.getElementById('cat-title-text').innerText = subCat ? subCat.replace('\u200B', '') : brand;
    document.getElementById('search-product').value = ''; 
    
    let listHTML = '';
    for(let key in allProducts) {
        let p = allProducts[key];
        if (p.kategori !== cat || (p.brand || 'Lainnya') !== brand) continue;
        if (subCat) {
            let pSub = p.sub_kategori || 'Umum';
            if (pSub !== subCat) continue;
        }
        
        let safeName = p.nama.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        let safeDesc = p.deskripsi ? p.deskripsi.replace(/'/g, "\\'").replace(/"/g, '&quot;') : 'Proses Otomatis 24 Jam';
        let initial = brand.substring(0,2).toUpperCase();
        
        let statusBadge = p.status_produk === false 
            ? '<span style="background:var(--bg-main); color:#b91c1c; font-size:9px; padding:4px 8px; border-radius:6px; font-weight:800; box-shadow:var(--shadow-outer); flex-shrink:0; margin-left:8px;">GANGGUAN</span>' 
            : '<span class="badge-open">OPEN</span>';
        
        let onClickAction = p.status_produk === false
            ? `showToast('Maaf, produk ini sedang gangguan dari pusat.', 'error')`
            : `openOrderModal('${key}', '${safeName}', ${p.harga}, '${safeDesc}')`;
        
        listHTML += `
        <div class="product-item" onclick="${onClickAction}">
            <div class="prod-logo">${initial}</div>
            <div class="prod-info">
                <div class="prod-name">${p.nama} ${statusBadge}</div>
                <div class="prod-desc">${p.deskripsi ? p.deskripsi.substring(0,40)+'...' : 'Proses Cepat'}</div>
                <div class="prod-price">Rp ${p.harga.toLocaleString('id-ID')}</div>
            </div>
        </div>`;
    }
    
    document.getElementById('product-list').innerHTML = '<div class="skeleton-box"></div><div class="skeleton-box"></div><div class="skeleton-box"></div>';
    setTimeout(() => {
        document.getElementById('product-list').innerHTML = listHTML || '<div style="text-align:center; padding:30px; font-weight:bold; color:var(--text-muted);">KOSONG</div>';
    }, 600);
    showScreen('produk-screen', 'nav-home');
}
function loadProducts(cat, brand, subCat = null) { pushState({screen: 'produk-screen', cat: cat, brand: brand, subcat: subCat}); loadProductsInternal(cat, brand, subCat); }

function openOrderModal(sku, nama, harga, desc) {
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu untuk membeli produk.", "error");
        showScreen("login-screen", null);
        return;
    }
    selectedSKU = sku;
    document.getElementById('m-name').innerText = nama;
    document.getElementById('m-price').innerText = 'Rp ' + harga.toLocaleString('id-ID');
    document.getElementById('m-desc').innerText = desc || 'Proses Otomatis';
    document.getElementById('m-target').value = '';
    document.getElementById('m-payment-method').value = 'saldo';
    selectPayment('saldo'); // set default
    document.getElementById('order-modal').classList.remove('hidden');
}
function closeOrderModal() { document.getElementById('order-modal').classList.add('hidden'); }

async function cekRiwayatBaru() {
    document.getElementById('order-success-modal').classList.add('hidden');
    await syncUserData();
    showHistory('Order');
    if(userData.history && userData.history.length > 0) {
        let latest = userData.history[0];
        openHistoryDetail(latest);
    }
}

async function processOrder() {
    if(!currentUser) { showToast('Sesi Anda habis. Silakan login ulang.', 'error'); logout(); return; }
    let target = document.getElementById('m-target').value.trim();
    let method = document.getElementById('m-payment-method').value;

    if(!target || target.length < 4) return showToast("Nomor tujuan tidak valid!", 'error');
    
    let btn = document.getElementById('m-submit');
    let ori = btn.innerText; btn.innerText = 'Proses...'; btn.disabled = true;
    
    try {
        let url = method === 'qris' ? '/api/order-qris' : '/api/order';
        let data = await apiCall(url, {phone: currentUser, sku: selectedSKU, tujuan: target});
        
        if(data && data.success) {
            closeOrderModal();
            await syncUserData();
            
            if (method === 'qris') {
                document.getElementById('topup-success-modal').classList.remove('hidden');
            } else {
                document.getElementById('os-name').innerText = document.getElementById('m-name').innerText;
                document.getElementById('os-target').innerText = target;
                document.getElementById('os-metode').innerText = "Saldo Akun";
                document.getElementById('os-price').innerText = document.getElementById('m-price').innerText;
                document.getElementById('order-success-modal').classList.remove('hidden');
            }
        } else {
            showToast(data && data.message ? 'Gagal: ' + data.message : "Kesalahan server saat memproses order.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }
    
    btn.innerText = ori; btn.disabled = false;
}

function updateVpnPrice() {
    let days = parseInt(document.getElementById('m-vpn-expired').value) || 30;
    if(days > 30) { days = 30; document.getElementById('m-vpn-expired').value = 30; }
    if(days < 1) { days = 1; document.getElementById('m-vpn-expired').value = 1; }
    
    let finalPrice = Math.ceil((currentVpnBasePrice / 30) * days);
    document.getElementById('m-vpn-price').innerText = 'Rp ' + finalPrice.toLocaleString('id-ID');
}

function openVPNServerSelection(protocol) {
    document.getElementById('vpn-modal-title').innerText = "Pilih Produk " + protocol;

    let html = '';
    if(vpnConfigData && vpnConfigData.products && vpnConfigData.servers) {
        for(let pId in vpnConfigData.products) {
            let prod = vpnConfigData.products[pId];
            if(prod.protocol.toUpperCase() === protocol.toUpperCase()) {
                let srv = vpnConfigData.servers[prod.server_id];
                if(srv && srv.host) {
                    let srvName = srv.server_name || prod.server_id;
                    let flag = (srv.city && srv.city.toLowerCase().includes('sg')) ? '🇸🇬 ' : ((srv.city && srv.city.toLowerCase().includes('id')) ? '🇮🇩 ' : '🌐 ');
                    let price = prod.price || 0;
                    let stok = prod.stok !== undefined ? parseInt(prod.stok) : 0;
                    let desc = prod.desc || 'Proses Otomatis';
                    let customName = prod.name || `${protocol} Premium`;
                    let safeDesc = desc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    let safeName = customName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

                    let stokBadge = stok > 0 ? `<span style="background:#16a34a; color:#ffffff; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">Stok: ${stok}</span>` : `<span style="background:#ef4444; color:#ffffff; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">Stok Habis</span>`;
                    let onClick = stok > 0 ? `openVPNOrderModal('${pId}', '${protocol}', ${price}, '${safeDesc}', '${safeName}')` : `showToast('Maaf, stok produk ini sedang habis.', 'error')`;

                    html += `
                    <div class="vpn-server-item" onclick="${onClick}">
                        <div class="vpn-server-info">
                            <div class="vpn-server-name">${flag} ${customName}</div>
                            <div style="font-size:11.5px; color:var(--text-muted); margin-top:3px; font-weight:bold;">Server: ${srvName}</div>
                            <div class="vpn-server-price" style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                                <span>Rp ${price.toLocaleString('id-ID')} / 30 Hari</span>
                                ${stokBadge}
                            </div>
                        </div>
                        <div>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--nav-active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>`;
                }
            }
        }
    }

    if(html === '') html = '<div style="text-align:center; font-size:12px; color:var(--text-muted); margin-top:10px;">Belum ada produk diatur untuk protokol ini.</div>';

    document.getElementById('vpn-server-list').innerHTML = html;
    document.getElementById('vpn-server-modal').classList.remove('hidden');
}

function closeVPNServerModal() {
    document.getElementById('vpn-server-modal').classList.add('hidden');
}

function openVPNTrialModal(productId, protocol, customName) {
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu untuk klaim trial.", "error");
        showScreen("login-screen", null);
        return;
    }
    closeVPNServerModal();
    selectedVPNServer = productId; 
    selectedVPNProto = protocol;
    document.getElementById('m-vpn-trial-name').innerText = customName;
    document.getElementById('vpn-trial-modal').classList.remove('hidden');
}

function closeVPNTrialModal() {
    document.getElementById('vpn-trial-modal').classList.add('hidden');
}

async function processVPNTrial() {
    if(!currentUser) { showToast('Sesi Anda habis. Silakan login ulang.', 'error'); logout(); return; }
    let btn = document.getElementById('m-vpn-trial-submit');
    let ori = btn.innerText; btn.innerText = 'Mengklaim...'; btn.disabled = true;

    try {
        let data = await apiCall('/api/order-vpn', {
            phone: currentUser, 
            protocol: selectedVPNProto, 
            product_id: selectedVPNServer, 
            mode: 'trial',
            username: '', 
            password: '', 
            expired: 1
        });
        
        if(data && data.success) {
            closeVPNTrialModal();
            await syncUserData();
            
            if(userData.history && userData.history.length > 0) {
                let latest = userData.history[0];
                openHistoryDetail(latest);
            }
        } else {
            showToast(data && data.message ? 'Gagal: ' + data.message : "Kesalahan server.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }

    btn.innerText = ori; btn.disabled = false;
}

function openVPNOrderModal(productId, protocol, price, desc, customName) {
    if(!currentUser) {
        showToast("Silakan masuk/daftar terlebih dahulu untuk membeli VPN.", "error");
        showScreen("login-screen", null);
        return;
    }
    closeVPNServerModal();
    selectedVPNServer = productId; 
    selectedVPNProto = protocol;
    currentVpnBasePrice = price;
    currentVpnBaseDesc = desc;
    
    document.getElementById('m-vpn-name').innerText = customName;
    document.getElementById('m-vpn-username').value = '';
    document.getElementById('m-vpn-password').value = '';
    document.getElementById('m-vpn-expired').value = '30';
    
    document.getElementById('m-vpn-payment').value = 'saldo';
    selectPaymentVpn('saldo'); // set default btn

    if(protocol.toUpperCase() === 'SSH' || protocol.toUpperCase() === 'ZIVPN') {
        document.getElementById('m-vpn-password').classList.remove('hidden');
    } else {
        document.getElementById('m-vpn-password').classList.add('hidden');
    }
    document.getElementById('m-vpn-desc').innerText = currentVpnBaseDesc;
    updateVpnPrice();

    document.getElementById('vpn-order-modal').classList.remove('hidden');
}

function closeVPNOrderModal() {
    document.getElementById('vpn-order-modal').classList.add('hidden');
}

async function processVPNOrder() {
    if(!currentUser) { showToast('Sesi Anda habis. Silakan login ulang.', 'error'); logout(); return; }
    
    let username = document.getElementById('m-vpn-username').value.trim();
    let password = document.getElementById('m-vpn-password').value.trim();
    let expired = document.getElementById('m-vpn-expired').value;
    let method = document.getElementById('m-vpn-payment').value;

    if(!username || username.length < 4 || username.length > 17) return showToast("Username VPN harus 4-17 Karakter!", 'error');
    if((selectedVPNProto.toUpperCase() === 'SSH' || selectedVPNProto.toUpperCase() === 'ZIVPN') && (!password || password.length < 4 || password.length > 17)) {
        return showToast("Password VPN harus 4-17 Karakter!", 'error');
    }
    if(!expired || parseInt(expired) < 1) return showToast("Masa aktif tidak valid!", 'error');

    let btn = document.getElementById('m-vpn-submit');
    let ori = btn.innerText; btn.innerText = 'Membuat Akun...'; btn.disabled = true;

    try {
        let url = method === 'qris' ? '/api/order-vpn-qris' : '/api/order-vpn';
        let payload = {
            phone: currentUser, 
            protocol: selectedVPNProto, 
            product_id: selectedVPNServer, 
            mode: 'reguler',
            username: username, 
            password: password, 
            expired: parseInt(expired)
        };

        let data = await apiCall(url, payload);
        
        if(data && data.success) {
            closeVPNOrderModal();
            await syncUserData();
            
            if (method === 'qris') {
                document.getElementById('topup-success-modal').classList.remove('hidden');
            } else {
                document.getElementById('os-name').innerText = document.getElementById('m-vpn-name').innerText;
                document.getElementById('os-target').innerText = username;
                document.getElementById('os-metode').innerText = 'Saldo Akun';
                document.getElementById('os-price').innerText = document.getElementById('m-vpn-price').innerText;
                document.getElementById('order-success-modal').classList.remove('hidden');
            }
        } else {
            showToast(data && data.message ? 'Gagal: ' + data.message : "Kesalahan server saat memproses order VPN.", 'error');
        }
    } catch(e) { showToast('Kesalahan jaringan.', 'error'); }

    btn.innerText = ori; btn.disabled = false;
}
# === SELESAI ===
