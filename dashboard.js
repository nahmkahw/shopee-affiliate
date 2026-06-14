/**
 * dashboard.js — Shopee Affiliate Dashboard
 * รัน: node dashboard.js
 * เปิด: http://localhost:3000
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3001;

// ─── Read product data ────────────────────────────────────────────────────────

function loadProducts() {
  const baseDir = path.join(__dirname, 'products');
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir)
    .filter(id => fs.existsSync(path.join(baseDir, id, 'data.json')))
    .map(id => {
      const data    = JSON.parse(fs.readFileSync(path.join(baseDir, id, 'data.json'), 'utf8'));
      const cDir    = path.join(baseDir, id, 'content');
      const imgDir  = path.join(baseDir, id, 'images');
      const hasFB   = fs.existsSync(path.join(cDir, 'facebook.md'));
      const hasIG   = fs.existsSync(path.join(cDir, 'instagram.md'));
      const hasX    = fs.existsSync(path.join(cDir, 'x.md'));
      const hasTT   = fs.existsSync(path.join(cDir, 'tiktok.md'));
      const imgFile = ['1.jpg','2.jpg','3.jpg'].map(f => path.join(imgDir, f)).find(f => fs.existsSync(f));
      const isPosted = data.status === 'posted';
      // posted_platforms อาจเป็น array หรือ undefined
      const postedPlatforms = Array.isArray(data.posted_platforms) ? data.posted_platforms : [];
      // posted_at: ISO string → แปลงเป็นวันที่ไทย
      let postedAtStr = '';
      if (data.posted_at) {
        try {
          postedAtStr = new Date(data.posted_at).toLocaleString('th-TH', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        } catch {}
      }
      return {
        id,
        post_date:      data.post_date || '',
        title:          data.title     || '',
        price:          data.price     || '',
        original_price: data.original_price || '',
        discount:       data.discount  || '',
        rating:         data.rating    || '',
        shop_name:      data.shop_name || '',
        affiliate_link: data.affiliate_short_link || '',
        status:         data.status    || '',
        isPosted,
        postedPlatforms,
        postedAtStr,
        hasFB, hasIG, hasX, hasTT,
        hasAllContent: hasFB && hasIG && hasX && hasTT,
        hasImg: !!imgFile,
        imgPath: imgFile ? `/img/${id}/${path.basename(imgFile)}` : null,
      };
    })
    .filter(p => p.status !== 'placeholder')
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
}

// ─── Serve product image ──────────────────────────────────────────────────────

function serveImage(res, itemId, filename) {
  const filePath = path.join(__dirname, 'products', itemId, 'images', filename);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(filename).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'image/jpeg' });
  fs.createReadStream(filePath).pipe(res);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHTML(products) {
  const today  = new Date().toISOString().slice(0, 10);
  const total      = products.length;
  const posted     = products.filter(p => p.isPosted).length;
  const ready      = products.filter(p => p.hasAllContent && !p.isPosted).length;
  const noContent  = products.filter(p => !p.hasFB && !p.isPosted).length;
  const fbCount    = products.filter(p => p.hasFB).length;
  const igCount    = products.filter(p => p.hasIG).length;
  const xCount     = products.filter(p => p.hasX).length;
  const ttCount    = products.filter(p => p.hasTT).length;
  const todayPrd   = products.filter(p => p.post_date === today).length;
  const pct        = total ? Math.round((ready + posted) / total * 100) : 0;

  // group by date for timeline dots
  const dates = [...new Set(products.map(p => p.post_date))];

  const rows = products.map(p => {
    const isPast    = p.post_date < today;
    const isToday   = p.post_date === today;
    const isFuture  = p.post_date > today;
    const dateClass = isToday ? 'bg-blue-100 text-blue-800 font-bold'
                    : isPast  ? 'text-gray-400'
                    : 'text-gray-700';
    const badge = isToday ? '<span class="ml-1 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">วันนี้</span>' : '';

    const icon = v => v
      ? '<span class="text-green-500 text-lg">✅</span>'
      : '<span class="text-gray-300 text-lg">○</span>';

    const img = p.imgPath
      ? `<img src="${p.imgPath}" class="w-12 h-12 object-cover rounded-lg shadow-sm" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-xs">ไม่มีรูป</div>`;

    const discBadge = p.discount
      ? `<span class="ml-1 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">${p.discount}</span>`
      : '';

    const statusBadge = p.isPosted
      ? `<div class="flex flex-col gap-0.5">
           <span class="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-semibold inline-block">✅ โพสต์แล้ว</span>
           ${p.postedPlatforms.length ? `<span class="text-xs text-purple-400">${p.postedPlatforms.join(', ')}</span>` : ''}
           ${p.postedAtStr ? `<span class="text-xs text-gray-400">${p.postedAtStr}</span>` : ''}
         </div>`
      : p.hasAllContent
      ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">พร้อม</span>'
      : p.hasFB
      ? '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">บางส่วน</span>'
      : '<span class="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">รอ content</span>';

    const rowBg = p.isPosted ? 'bg-purple-50/30' : isToday ? 'bg-blue-50/40' : '';

    return `
    <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors ${rowBg}"
        data-date="${p.post_date}" data-status="${p.isPosted ? 'posted' : p.hasAllContent ? 'ready' : p.hasFB ? 'partial' : 'none'}">
      <td class="py-3 px-3 whitespace-nowrap ${dateClass} text-sm">
        ${p.post_date}${badge}
      </td>
      <td class="py-3 px-3">${img}</td>
      <td class="py-3 px-3">
        <a href="${p.affiliate_link}" target="_blank"
           class="text-sm font-medium text-gray-800 hover:text-blue-600 line-clamp-2 block max-w-xs"
           title="${p.title.replace(/"/g,'&quot;')}">
          ${p.title.substring(0, 60)}${p.title.length > 60 ? '…' : ''}
        </a>
        <div class="text-xs text-gray-400 mt-0.5">${p.shop_name}</div>
      </td>
      <td class="py-3 px-3 text-sm font-semibold text-gray-800 whitespace-nowrap">
        ${p.price}${discBadge}
        ${p.original_price ? `<div class="text-xs text-gray-400 line-through">${p.original_price}</div>` : ''}
      </td>
      <td class="py-3 px-3 text-center">
        ${p.rating ? `<span class="text-sm font-medium text-amber-600">⭐ ${p.rating}</span>` : '<span class="text-gray-300">—</span>'}
      </td>
      <td class="py-3 px-3 text-center">${icon(p.hasFB)}</td>
      <td class="py-3 px-3 text-center">${icon(p.hasIG)}</td>
      <td class="py-3 px-3 text-center">${icon(p.hasX)}</td>
      <td class="py-3 px-3 text-center">${icon(p.hasTT)}</td>
      <td class="py-3 px-3">${statusBadge}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shopee Affiliate Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
  * { font-family: 'Sarabun', sans-serif; }
  .line-clamp-2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .progress-bar { transition: width 0.8s ease; }
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<!-- Header -->
<div class="bg-gradient-to-r from-orange-500 to-orange-400 text-white shadow-lg">
  <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-2xl">🛍️</span>
      <div>
        <h1 class="text-xl font-bold">Shopee Affiliate Dashboard</h1>
        <p class="text-orange-100 text-sm">วันนี้: ${today}</p>
      </div>
    </div>
    <button onclick="location.reload()"
      class="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
      🔄 รีเฟรช
    </button>
  </div>
</div>

<div class="max-w-7xl mx-auto px-6 py-6 space-y-6">

  <!-- Stats Cards -->
  <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <div class="text-3xl font-bold text-gray-800">${total}</div>
      <div class="text-sm text-gray-500 mt-1">สินค้าทั้งหมด</div>
      <div class="text-xs text-blue-500 mt-1">วันนี้ ${todayPrd} รายการ</div>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-purple-100 border-2">
      <div class="text-3xl font-bold text-purple-600">${posted}</div>
      <div class="text-sm text-gray-500 mt-1">โพสต์แล้ว</div>
      <div class="text-xs text-purple-400 mt-1">${total ? Math.round(posted/total*100) : 0}% ของทั้งหมด</div>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <div class="text-3xl font-bold text-green-600">${ready}</div>
      <div class="text-sm text-gray-500 mt-1">Content พร้อม</div>
      <div class="text-xs text-green-500 mt-1">รอโพสต์</div>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <div class="text-3xl font-bold text-red-500">${noContent}</div>
      <div class="text-sm text-gray-500 mt-1">รอสร้าง Content</div>
      <div class="text-xs text-red-400 mt-1">ยังไม่มี facebook.md</div>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <div class="text-3xl font-bold text-orange-500">${total - posted - ready - noContent}</div>
      <div class="text-sm text-gray-500 mt-1">Content บางส่วน</div>
      <div class="text-xs text-orange-400 mt-1">มีบาง platform</div>
    </div>
  </div>

  <!-- Platform Stats + Progress -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

    <!-- Platform breakdown -->
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <h2 class="font-semibold text-gray-700 mb-4">📊 สถิติ Content แต่ละ Platform</h2>
      <div class="space-y-3">
        ${[
          { name: 'Facebook',  count: fbCount, color: 'bg-blue-500',   icon: '📘' },
          { name: 'Instagram', count: igCount, color: 'bg-pink-500',   icon: '📷' },
          { name: 'X',         count: xCount,  color: 'bg-gray-800',   icon: '🐦' },
          { name: 'TikTok',    count: ttCount, color: 'bg-red-500',    icon: '🎵' },
        ].map(p => `
        <div>
          <div class="flex justify-between items-center mb-1">
            <span class="text-sm text-gray-600">${p.icon} ${p.name}</span>
            <span class="text-sm font-semibold text-gray-800">${p.count} / ${total}</span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-2.5">
            <div class="${p.color} h-2.5 rounded-full progress-bar" style="width:${total ? Math.round(p.count/total*100) : 0}%"></div>
          </div>
        </div>`).join('')}
      </div>
    </div>

    <!-- Post date timeline -->
    <div class="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
      <h2 class="font-semibold text-gray-700 mb-4">📅 Timeline โพสต์</h2>
      <div class="space-y-1.5 max-h-52 overflow-y-auto pr-1">
        ${dates.map(date => {
          const dayProducts  = products.filter(p => p.post_date === date);
          const dayPosted    = dayProducts.filter(p => p.isPosted).length;
          const dayReady     = dayProducts.filter(p => p.hasAllContent).length;
          const isToday      = date === today;
          const isPast       = date < today;
          const allPosted    = dayPosted === dayProducts.length && dayProducts.length > 0;
          const pct          = dayProducts.length ? Math.round(dayReady / dayProducts.length * 100) : 0;
          const dotColor     = allPosted ? 'bg-purple-500' : pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-yellow-400' : 'bg-gray-200';
          const barColor     = allPosted ? 'bg-purple-500' : pct === 100 ? 'bg-green-500' : 'bg-orange-400';
          const textColor    = isToday ? 'font-bold text-blue-700' : allPosted ? 'text-purple-500' : isPast ? 'text-gray-400' : 'text-gray-700';
          const label        = allPosted ? ' ✅' : isToday ? ' 📍' : '';
          return `
          <div class="flex items-center gap-3 py-1 ${isToday ? 'bg-blue-50 -mx-1 px-1 rounded-lg' : allPosted ? 'bg-purple-50/40 -mx-1 px-1 rounded-lg' : ''}">
            <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}"></div>
            <span class="text-sm ${textColor} w-28">${date}${label}</span>
            <div class="flex-1 bg-gray-100 rounded-full h-1.5">
              <div class="${barColor} h-1.5 rounded-full" style="width:${pct}%"></div>
            </div>
            <span class="text-xs ${allPosted ? 'text-purple-500 font-medium' : 'text-gray-500'} w-16 text-right">${dayPosted > 0 ? dayPosted+'โพสต์/' : ''}${dayReady}/${dayProducts.length}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-500 inline-block"></span>โพสต์แล้ว</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>ครบ</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-yellow-400 inline-block"></span>บางส่วน</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-gray-200 inline-block"></span>รอ</span>
      </div>
    </div>
  </div>

  <!-- Table -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    <div class="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-semibold text-gray-700">📋 รายการสินค้าทั้งหมด</h2>
      <!-- Filters -->
      <div class="flex flex-wrap gap-2">
        <button onclick="filterTable('all')" id="btn-all"
          class="filter-btn active px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-500 text-white transition-colors">
          ทั้งหมด (${total})
        </button>
        <button onclick="filterTable('today')" id="btn-today"
          class="filter-btn px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          วันนี้ (${todayPrd})
        </button>
        <button onclick="filterTable('ready')" id="btn-ready"
          class="filter-btn px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          ✅ พร้อม (${ready})
        </button>
        <button onclick="filterTable('posted')" id="btn-posted"
          class="filter-btn px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          🟣 โพสต์แล้ว (${posted})
        </button>
        <button onclick="filterTable('none')" id="btn-none"
          class="filter-btn px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          ⚠️ รอ Content (${noContent})
        </button>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full" id="product-table">
        <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th class="py-3 px-3 text-left">วันที่โพสต์</th>
            <th class="py-3 px-3 text-left">รูป</th>
            <th class="py-3 px-3 text-left">ชื่อสินค้า</th>
            <th class="py-3 px-3 text-left">ราคา</th>
            <th class="py-3 px-3 text-center">คะแนน</th>
            <th class="py-3 px-3 text-center">FB</th>
            <th class="py-3 px-3 text-center">IG</th>
            <th class="py-3 px-3 text-center">X</th>
            <th class="py-3 px-3 text-center">TikTok</th>
            <th class="py-3 px-3 text-left">สถานะ</th>
          </tr>
        </thead>
        <tbody id="table-body">
          ${rows}
        </tbody>
      </table>
    </div>

    <div class="px-6 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
      รีเฟรชล่าสุด: ${new Date().toLocaleString('th-TH')} —
      <span id="visible-count">${total}</span> รายการ
    </div>
  </div>

</div><!-- /container -->

<script>
const today = '${today}';
let currentFilter = 'all';

function filterTable(filter) {
  currentFilter = filter;
  const rows = document.querySelectorAll('#table-body tr');
  let visible = 0;
  rows.forEach(row => {
    const date   = row.dataset.date;
    const status = row.dataset.status;
    let show = false;
    if (filter === 'all')    show = true;
    if (filter === 'today')  show = date === today;
    if (filter === 'posted') show = status === 'posted';
    if (filter === 'ready')  show = status === 'ready';
    if (filter === 'none')   show = status === 'none';
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('visible-count').textContent = visible;

  // Update button styles
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('bg-orange-500', 'text-white');
    btn.classList.add('bg-gray-100', 'text-gray-600');
  });
  const active = document.getElementById('btn-' + filter);
  if (active) {
    active.classList.remove('bg-gray-100', 'text-gray-600');
    active.classList.add('bg-orange-500', 'text-white');
  }
}

// Auto refresh ทุก 60 วิ
setTimeout(() => location.reload(), 60000);
</script>
</body>
</html>`;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url;

  // serve product images
  const imgMatch = url.match(/^\/img\/(\d+)\/(.+)$/);
  if (imgMatch) {
    serveImage(res, imgMatch[1], imgMatch[2]);
    return;
  }

  // serve dashboard
  if (url === '/' || url === '/dashboard') {
    const products = loadProducts();
    const html = buildHTML(products);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // API endpoint — JSON data
  if (url === '/api/products') {
    const products = loadProducts();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(products, null, 2));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🛍️  Shopee Affiliate Dashboard`);
  console.log(`📊  http://localhost:${PORT}\n`);
});
