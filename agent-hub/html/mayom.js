'use strict';
/**
 * agent-hub/html/mayom.js — Dashboard HTML สำหรับ Agent มะยม (Money Slip Logger)
 * การ์ดสรุป + กราฟรายวัน stacked-by-category + ตารางแยก user + ตารางรายการ (แก้ inline/ลบ)
 */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#F7FEE7;color:#1a2e05;padding:24px;min-height:100vh}
h1{font-size:22px;font-weight:700}h2{font-size:15px;margin-bottom:10px}
.sub{color:#65A30D;font-size:13px;margin-top:2px}
.card{background:#fff;border:1px solid #d9f99d;border-radius:12px;padding:18px;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:#fff;border:1px solid #d9f99d;border-radius:12px;padding:14px 16px}
.stat .n{font-size:24px;font-weight:700}.stat .l{font-size:12px;color:#65A30D;margin-top:2px}
.stat.warn .n{color:#b45309}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ecfccb}
th{color:#4d7c0f;font-size:12px;font-weight:600}
.chart{display:flex;align-items:flex-end;gap:3px;height:170px;padding-top:8px;overflow-x:auto}
.bar{flex:1;min-width:14px;display:flex;flex-direction:column-reverse;position:relative}
.bar .seg{width:100%}
.bar .lbl{font-size:9px;color:#65A30D;text-align:center;margin-top:3px;white-space:nowrap;writing-mode:vertical-rl;height:34px}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:11px}
.legend span{display:inline-flex;align-items:center;gap:4px}
.dot{width:10px;height:10px;border-radius:2px;display:inline-block}
input,select{font-family:inherit;font-size:12px;border:1px solid #d9f99d;border-radius:5px;padding:4px 6px;background:#fff;color:#1a2e05}
input:focus,select:focus{outline:none;border-color:#65A30D}
.amt{width:80px;text-align:right}.note{width:130px}
.btn{border:none;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;background:#65A30D;color:#fff}
.btn:hover{opacity:.85}.btn.ghost{background:#ecfccb;color:#4d7c0f}.btn.danger{background:#fecaca;color:#7f1d1d}
.badge{font-size:10px;padding:1px 7px;border-radius:9px;font-weight:600}
.b-recorded{background:#bbf7d0;color:#14532d}.b-needs_review{background:#fed7aa;color:#9a3412}
.b-dup{background:#fecaca;color:#7f1d1d}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.thumb{width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:zoom-in;background:#ecfccb}
#lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99;align-items:center;justify-content:center;cursor:zoom-out}
#lb.open{display:flex}#lb img{max-width:92vw;max-height:92vh;border-radius:8px}
a{color:#4d7c0f}
`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const baht = n => (n == null ? '—' : Number(n).toLocaleString('th-TH'));

function chartHtml(daily, cats) {
  const max = Math.max(1, ...daily.map(d => d.total));
  const bars = daily.map(d => {
    const segs = cats.filter(c => d.byCat[c.name] > 0).map(c =>
      `<div class="seg" style="height:${(d.byCat[c.name] / max * 150).toFixed(1)}px;background:${c.color}"></div>`).join('');
    return `<div class="bar" title="${esc(d.day)}: ${baht(d.total)} บาท">${segs}<div class="lbl">${esc(d.day)}</div></div>`;
  }).join('');
  const legend = cats.map(c => `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('');
  return `<div class="chart">${bars}</div><div class="legend">${legend}</div>`;
}

function userRows(byUser) {
  if (!byUser.length) return '<tr><td colspan="4" style="color:#65A30D">ยังไม่มีข้อมูล</td></tr>';
  return byUser.map(u => `<tr>
    <td><input value="${esc(u.display)}" data-uid="${esc(u.key)}" class="alias" style="width:130px"></td>
    <td>${u.count}</td><td style="text-align:right">${baht(u.total)}</td>
    <td><button class="btn ghost" onclick="saveAlias('${esc(u.key)}')">💾 ตั้งชื่อ</button></td>
  </tr>`).join('');
}

function txRows(rows, cats) {
  if (!rows.length) return '<tr><td colspan="9" style="color:#65A30D">ยังไม่มีรายการ</td></tr>';
  const opts = sel => cats.map(c => `<option${(sel === c.name) ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return rows.map(t => `<tr data-id="${t.id}">
    <td><img class="thumb" src="/dashboard/mayom/slip/${t.id}" onclick="lb(this.src)" onerror="this.style.display='none'"></td>
    <td>${esc((t.created_at || '').slice(5, 16).replace('T', ' '))}</td>
    <td>${esc(t.display)}</td>
    <td><input class="amt" type="number" step="0.01" value="${t.amount == null ? '' : t.amount}"></td>
    <td style="font-size:11px;max-width:170px;line-height:1.4">${esc(t.bank_from) || '—'}<span style="color:#65A30D"> → </span>${esc(t.bank_to) || '—'}</td>
    <td><select class="cat">${opts(cats.some(c => c.name === t.category) ? t.category : 'อื่นๆ')}</select></td>
    <td><input class="note" value="${esc(t.note)}"></td>
    <td>${t.duplicate ? '<span class="badge b-dup">ซ้ำ</span>' : ''}<span class="badge b-${t.status}">${t.status === 'needs_review' ? 'ตรวจ' : 'ok'}</span>
        <label style="font-size:10px;display:block;margin-top:2px"><input type="checkbox" class="dup" ${t.duplicate ? 'checked' : ''}> ซ้ำ</label></td>
    <td><button class="btn ghost" onclick="saveTx('${t.id}')">💾</button>
        <button class="btn danger" onclick="delTx('${t.id}')">🗑️</button></td>
  </tr>`).join('');
}

function renderDashboard(summary, filter = {}) {
  const { totals, daily, cats, byUser, rows, users } = summary;
  const userOpts = ['<option value="">— ทุกคน —</option>']
    .concat(byUser.map(u => `<option value="${esc(u.key)}"${filter.user === u.key ? ' selected' : ''}>${esc(u.display)}</option>`)).join('');
  const catOpts = ['<option value="">— ทุกหมวด —</option>']
    .concat(cats.map(c => `<option${filter.category === c.name ? ' selected' : ''}>${esc(c.name)}</option>`)).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>มะยม — Money Slip Logger</title><style>${CSS}</style></head><body>
<h1>🧾 มะยม</h1><div class="sub">บันทึกสลิปโอนเงินจากกลุ่ม LINE — สรุปรวม / รายวัน / แยกตามผู้ส่ง</div>

<details class="card" id="setup" style="padding:12px 16px">
  <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#4d7c0f;list-style:none">⚙️ Setup — หา Group ID ▾</summary>
  <div style="margin-top:10px;font-size:13px">
    <div>Group ID ที่ตั้งไว้ (.env): <code id="cfg-group" style="background:#ecfccb;padding:2px 6px;border-radius:4px">—</code></div>
    <div style="margin-top:8px">Group ล่าสุดที่ยิงเข้ามา: <code id="last-group" style="background:#ecfccb;padding:2px 6px;border-radius:4px">— (ยังไม่มี event)</code>
      <button class="btn ghost" id="copy-group" style="display:none;margin-left:6px" onclick="copyGroup()">📋 คัดลอก</button></div>
    <div id="setup-hint" style="font-size:12px;color:#65A30D;margin-top:8px">ส่งข้อความ/สลิปในกลุ่ม LINE แล้วกดรีเฟรชแถวนี้ — เอา Group ID ไปใส่ <code>MAYOM_LINE_GROUP_ID</code> ใน .env แล้วรีสตาร์ท hub</div>
    <button class="btn ghost" onclick="loadLastGroup()" style="margin-top:6px">🔄 รีเฟรช</button>
  </div>
</details>

<div class="cards">
  <div class="stat"><div class="n">${baht(totals.today)}</div><div class="l">วันนี้ (บาท)</div></div>
  <div class="stat"><div class="n">${baht(totals.month)}</div><div class="l">เดือนนี้ (บาท)</div></div>
  <div class="stat"><div class="n">${baht(totals.all)}</div><div class="l">ทั้งหมด (บาท)</div></div>
  <div class="stat"><div class="n">${totals.count}</div><div class="l">จำนวนรายการ</div></div>
  <div class="stat warn"><div class="n">${totals.needsReview}</div><div class="l">ต้องตรวจ (needs_review)</div></div>
</div>

<div class="card"><h2>กราฟรายวัน (30 วัน) — แยกสีตามหมวด</h2>${chartHtml(daily, cats)}</div>

<div class="card"><h2>สรุปแยกตามผู้ส่ง (LINE user)</h2>
  <table><thead><tr><th>ชื่อเล่น (แก้ได้)</th><th>จำนวนสลิป</th><th style="text-align:right">ยอดรวม</th><th></th></tr></thead>
  <tbody>${userRows(byUser)}</tbody></table>
  <div id="amsg" style="font-size:12px;color:#65A30D;margin-top:6px"></div>
</div>

<div class="card"><h2>รายการล่าสุด</h2>
  <form class="filters" method="GET" action="/dashboard/mayom">
    <label style="font-size:12px">จาก <input type="date" name="from" value="${esc(filter.from || '')}"></label>
    <label style="font-size:12px">ถึง <input type="date" name="to" value="${esc(filter.to || '')}"></label>
    <select name="user">${userOpts}</select>
    <select name="category">${catOpts}</select>
    <button class="btn" type="submit">🔍 กรอง</button>
    <a class="btn ghost" href="/dashboard/mayom" style="text-decoration:none">ล้าง</a>
  </form>
  <div id="tmsg" style="font-size:12px;color:#65A30D;margin-bottom:6px"></div>
  <div style="overflow-x:auto"><table><thead><tr>
    <th>สลิป</th><th>เวลา</th><th>ผู้ส่ง</th><th>ยอด</th><th>จาก → ถึง</th><th>หมวด</th><th>โน้ต</th><th>สถานะ</th><th></th>
  </tr></thead><tbody>${txRows(rows, cats)}</tbody></table></div>
</div>

<div id="lb" onclick="this.classList.remove('open')"><img id="lbi" src=""></div>
<script>
function lb(src){document.getElementById('lbi').src=src;document.getElementById('lb').classList.add('open');}
let _lastGroup='';
async function loadLastGroup(){
  try{
    const j=await(await fetch('/api/mayom/last-group')).json();
    document.getElementById('cfg-group').textContent=j.configured||'(ยังไม่ตั้ง)';
    const g=j.last&&j.last.groupId;
    _lastGroup=g||'';
    document.getElementById('last-group').textContent=g?(g+'  ('+(j.last.at||'').slice(0,19).replace('T',' ')+')'):'— (ยังไม่มี event)';
    document.getElementById('copy-group').style.display=g?'inline-block':'none';
    if(g&&j.configured&&g===j.configured)document.getElementById('setup-hint').textContent='✅ ตรงกับ .env แล้ว — พร้อมใช้งาน';
  }catch(e){document.getElementById('last-group').textContent='❌ '+e.message;}
}
function copyGroup(){if(_lastGroup)navigator.clipboard.writeText(_lastGroup).then(()=>{document.getElementById('copy-group').textContent='✅ คัดลอกแล้ว';setTimeout(()=>document.getElementById('copy-group').textContent='📋 คัดลอก',1500);});}
loadLastGroup();
async function saveTx(id){
  const tr=document.querySelector('tr[data-id="'+id+'"]');
  const body={amount:tr.querySelector('.amt').value===''?null:parseFloat(tr.querySelector('.amt').value),
    category:tr.querySelector('.cat').value,note:tr.querySelector('.note').value,duplicate:tr.querySelector('.dup').checked};
  document.getElementById('tmsg').textContent='⏳ บันทึก...';
  try{const j=await(await fetch('/api/mayom/tx/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    document.getElementById('tmsg').textContent=j.ok?'✅ บันทึกแล้ว':'❌ '+(j.error||'error');if(j.ok)setTimeout(()=>location.reload(),500);}
  catch(e){document.getElementById('tmsg').textContent='❌ '+e.message;}
}
async function delTx(id){
  if(!confirm('ลบรายการนี้ถาวร?'))return;
  try{const j=await(await fetch('/api/mayom/tx/'+id,{method:'DELETE'})).json();
    if(j.ok){const tr=document.querySelector('tr[data-id="'+id+'"]');if(tr)tr.remove();}
    else document.getElementById('tmsg').textContent='❌ '+(j.error||'error');}
  catch(e){document.getElementById('tmsg').textContent='❌ '+e.message;}
}
async function saveAlias(uid){
  const inp=document.querySelector('input.alias[data-uid="'+uid+'"]');
  document.getElementById('amsg').textContent='⏳ ตั้งชื่อ...';
  try{const j=await(await fetch('/api/mayom/alias',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:uid,alias:inp.value})})).json();
    document.getElementById('amsg').textContent=j.ok?'✅ ตั้งชื่อแล้ว':'❌ '+(j.error||'error');if(j.ok)setTimeout(()=>location.reload(),500);}
  catch(e){document.getElementById('amsg').textContent='❌ '+e.message;}
}
</script></body></html>`;
}

module.exports = { renderDashboard };
