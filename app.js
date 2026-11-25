'use strict';
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const STATUS = { want: '想看', scheduled: '已預約', visited: '已看過', considering: '考慮中', rejected: '淘汰' };
const CHECKS = { sunlight: '採光', noise: '安靜（噪音少）', leak: '無漏水', wall_damp: '無壁癌／潮濕',
  water_pressure: '水壓', layout_flow: '格局動線', ventilation: '通風', transport: '交通便利' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, suf = '') => (v === null || v === undefined || v === '') ? '—' : v + suf;

// 發布到 GitHub Pages 的版本（window.STATIC_MODE）：唯讀，資料來自 data.json，篩選在瀏覽器內做
const STATIC = !!window.STATIC_MODE;
if (STATIC) document.body.classList.add('ro');
let _snap;
async function staticApi(path) {
  if (!_snap) {
    const r = await fetch('data.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('讀不到資料');
    _snap = await r.json();
  }
  const [p, qs = ''] = path.split('?');
  const hs = _snap.houses;
  if (p === '/meta') return { districts: [...new Set(hs.map(h => h.district).filter(Boolean))].sort(), published_at: _snap.published_at };
  let m;
  if ((m = p.match(/^\/houses\/(\d+)$/))) {
    const h = hs.find(x => x.id === +m[1]);
    if (!h) throw new Error('找不到這間房子');
    return h;
  }
  if (p === '/houses') {
    const f = Object.fromEntries(new URLSearchParams(qs));
    const num = k => (f[k] === undefined || f[k] === '') ? null : +f[k];
    const [minP, maxP, minA, maxA] = ['min_price', 'max_price', 'min_area', 'max_area'].map(num);
    const terms = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    let items = hs.filter(h => {
      const text = [h.title, h.address, h.district, h.city, h.notes, h.agent_name, h.layout].join('\n').toLowerCase();
      if (!terms.every(t => text.includes(t))) return false;
      if (f.district && h.district !== f.district) return false;
      if (f.status && h.status !== f.status) return false;
      if (minP !== null && !(h.price >= minP)) return false;
      if (maxP !== null && !(h.price <= maxP)) return false;
      if (minA !== null && !(h.area >= minA)) return false;
      if (maxA !== null && !(h.area <= maxA)) return false;
      if (f.rooms && !(h.layout || '').startsWith(f.rooms + '房')) return false;
      return true;
    });
    const nullLast = (a, b, dir) => (a == null) - (b == null) || (a == null ? 0 : dir * (a - b));
    const cmp = {
      price_asc: (a, b) => nullLast(a.price, b.price, 1),
      price_desc: (a, b) => nullLast(a.price, b.price, -1),
      unit_asc: (a, b) => nullLast(a.unit_price, b.unit_price, 1),
      score_desc: (a, b) => nullLast(a.score, b.score, -1),
      visit_asc: (a, b) => (a.visit_at === '') - (b.visit_at === '') || a.visit_at.localeCompare(b.visit_at),
      updated_desc: (a, b) => b.updated_at.localeCompare(a.updated_at),
    }[f.sort] || ((a, b) => b.id - a.id);
    return items.sort(cmp);
  }
  throw new Error('不支援');
}
async function api(path, opts = {}) {
  if (STATIC) return staticApi(path);
  const r = await fetch('/api' + path, opts);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
  return r.status === 204 ? null : r.json();
}
const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }

// ---------- 篩選狀態（記在 localStorage，回到列表時保留） ----------
const defaultFilter = { q: '', district: '', status: '', min_price: '', max_price: '', min_area: '', max_area: '', rooms: '', sort: 'created_desc' };
let filter = { ...defaultFilter };
try { Object.assign(filter, JSON.parse(localStorage.getItem('hm-filter') || '{}')); } catch {}
let picked = new Set();

// ---------- 路由 ----------
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  window.scrollTo(0, 0);
  let m;
  if (h === '/') return listView();
  if ((m = h.match(/^\/house\/(\d+)$/))) return detailView(+m[1]);
  if ((m = h.match(/^\/compare\?ids=([\d,]+)$/))) return compareView(m[1]);
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------- 列表 ----------
async function listView() {
  const meta = await api('/meta');
  app.innerHTML = `
  <header class="top"><div class="row"><h1>🏠 看房筆記</h1>
    ${STATIC ? `<span class="count">更新於 ${esc(meta.published_at)}</span>` : `<button class="btn small" id="pub" title="發布唯讀版到 GitHub Pages">發布</button><a class="btn small" href="/api/backup" title="下載備份">備份</a>`}</div></header>
  <div class="wrap">
    <div class="filters">
      <input type="search" id="q" placeholder="搜尋關鍵字：板橋、捷運、頂樓…" value="${esc(filter.q)}">
      <div class="chips" id="districts"></div>
      <div class="chips" id="statuses"></div>
      <details id="adv"${hasAdv() ? ' open' : ''}><summary class="count" style="cursor:pointer">進階篩選與排序</summary>
        <div class="adv" style="margin-top:10px">
          <label class="f">總價下限（萬）<input type="number" inputmode="decimal" data-k="min_price" value="${esc(filter.min_price)}"></label>
          <label class="f">總價上限（萬）<input type="number" inputmode="decimal" data-k="max_price" value="${esc(filter.max_price)}"></label>
          <label class="f">坪數下限<input type="number" inputmode="decimal" data-k="min_area" value="${esc(filter.min_area)}"></label>
          <label class="f">坪數上限<input type="number" inputmode="decimal" data-k="max_area" value="${esc(filter.max_area)}"></label>
          <label class="f">房數<select data-k="rooms"><option value="">不限</option>${[1,2,3,4,5].map(n => `<option value="${n}"${filter.rooms == n ? ' selected' : ''}>${n} 房</option>`).join('')}</select></label>
          <label class="f">排序<select data-k="sort">${Object.entries({ created_desc: '最新加入', updated_desc: '最近更新', price_asc: '總價低→高', price_desc: '總價高→低', unit_asc: '單價低→高', score_desc: '評分高→低', visit_asc: '看房時間' }).map(([k, v]) => `<option value="${k}"${filter.sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <p><button class="btn small" id="reset">清除篩選</button></p>
      </details>
      <div class="count" id="count"></div>
    </div>
    <div class="grid" id="list"></div>
  </div>
  <div class="fab" id="fab"><button class="btn" id="cmp" hidden></button>${STATIC ? '' : '<button class="btn" id="imp">🔗 匯入網址</button><button class="btn primary" id="add">＋ 新增物件</button>'}</div>`;

  const chips = (el, items, key, allLabel) => {
    el.innerHTML = [['', allLabel], ...items].map(([v, l]) => `<button class="chip${filter[key] === v ? ' on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('');
    el.onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter[key] = b.dataset.v; save(); chips(el, items, key, allLabel); load(); };
  };
  chips($('#districts'), meta.districts.map(d => [d, d]), 'district', '全部區域');
  chips($('#statuses'), Object.entries(STATUS), 'status', '全部狀態');

  let t;
  $('#q').oninput = e => { filter.q = e.target.value; save(); clearTimeout(t); t = setTimeout(load, 250); };
  document.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { filter[el.dataset.k] = el.value; save(); load(); });
  $('#reset').onclick = () => { filter = { ...defaultFilter }; save(); listView(); };
  if (!STATIC) {
    $('#add').onclick = async () => { const h = await api('/houses', jsonOpts('POST', { title: '新物件' })); location.hash = '#/house/' + h.id; };
    $('#imp').onclick = async () => {
      const url = (prompt('貼上 591／信義房屋／永慶房屋的物件網址') || '').trim();
      if (!url) return;
      const b = $('#imp'); b.disabled = true; b.textContent = '匯入中…';
      try {
        const h = await api('/import', jsonOpts('POST', { url }));
        toast(h.duplicate ? '這個網址已經匯入過了' : (h.image_failed ? `已匯入（${h.image_failed} 張照片下載失敗）` : '已匯入'));
        location.hash = '#/house/' + h.id;
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = '🔗 匯入網址'; }
    };
    $('#pub').onclick = publishSite;
  }
  $('#cmp').onclick = () => location.hash = '#/compare?ids=' + [...picked].join(',');
  load();
}
function hasAdv() { return ['min_price', 'max_price', 'min_area', 'max_area', 'rooms'].some(k => filter[k]) || filter.sort !== 'created_desc'; }
function save() { try { localStorage.setItem('hm-filter', JSON.stringify(filter)); } catch {} }

async function load() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== '' && v != null) p.set(k, v);
  let items;
  try { items = await api('/houses?' + p); } catch (e) { return toast(e.message); }
  if (!$('#list')) return;
  $('#count').textContent = `共 ${items.length} 間`;
  $('#list').innerHTML = items.length ? items.map(card).join('') : `<div class="empty" style="grid-column:1/-1">沒有符合的物件${STATIC ? '' : '<br>按右下角「新增物件」開始記錄'}</div>`;
  $('#list').onchange = e => {
    if (!e.target.matches('.pick input')) return;
    const id = +e.target.dataset.id; e.target.checked ? picked.add(id) : picked.delete(id); updateCmp();
  };
  updateCmp();
}
function updateCmp() {
  const b = $('#cmp'); if (!b) return;
  b.hidden = picked.size < 2; b.textContent = `比較 (${picked.size})`;
}
function card(h) {
  const where = [h.city, h.district].filter(Boolean).join('');
  return `<div class="card">
    <label class="pick"><input type="checkbox" data-id="${h.id}"${picked.has(h.id) ? ' checked' : ''}>比較</label>
    <div class="badges"><span class="badge st-${h.status}">${STATUS[h.status]}</span></div>
    <a class="in" href="#/house/${h.id}">
      <div class="cover" style="${h.cover ? `background-image:url('${h.cover}')` : ''}">${h.cover ? '' : '🏠'}</div>
      <div class="body"><h3>${esc(h.title)}</h3>
        <div class="sub">${esc(where)} ${esc(h.address)}</div>
        <div class="meta"><span class="price">${h.price ? h.price + ' 萬' : '未填價格'}</span>
          ${h.area ? `<span>${h.area} 坪</span>` : ''}${h.unit_price ? `<span>${h.unit_price} 萬/坪</span>` : ''}
          ${h.layout ? `<span>${esc(h.layout)}</span>` : ''}${h.score ? `<span>★ ${h.score}</span>` : ''}
          ${h.media_count ? `<span>📷 ${h.media_count}</span>` : ''}${h.visit_at ? `<span>🗓 ${esc(h.visit_at)}</span>` : ''}</div>
      </div></a></div>`;
}

async function publishSite() {
  const b = $('#pub');
  try {
    let st = await api('/publish');
    if (!st.configured) {
      const remote = (prompt('第一次發布：貼上你建立好的「空的」GitHub repo 網址\n例如 git@github.com:帳號/home-share.git') || '').trim();
      if (!remote) return;
      st = await api('/publish/config', jsonOpts('POST', { remote }));
      if (!confirm(`將發布到：${st.url}\n\n注意：知道網址的人都能看到全部物件、照片與筆記。繼續？`)) return;
    }
    b.disabled = true; b.textContent = '發布中…';
    const r = await api('/publish', { method: 'POST' });
    toast(r.changed ? `已發布 ${r.count} 間，約 1 分鐘後生效` : '沒有變更，網站已是最新');
    if (r.url && confirm(`網址：${r.url}\n\n要開啟看看嗎？`)) window.open(r.url, '_blank', 'noopener');
  } catch (e) { toast(e.message); alert('發布失敗：' + e.message); }
  finally { b.disabled = false; b.textContent = '發布'; }
}

// ---------- 詳細頁 ----------
async function detailView(id) {
  let h;
  try { h = await api('/houses/' + id); } catch (e) { toast(e.message); location.hash = '#/'; return; }
  const inp = (k, label, type = 'text', extra = '', cls = '') => `<label class="f ${cls}">${label}<input type="${type}" data-f="${k}" value="${esc(h[k] ?? '')}" ${extra}></label>`;
  const num = (k, label) => inp(k, label, 'number', 'inputmode="decimal" step="any"');
  app.innerHTML = `
  <header class="top"><div class="row"><a class="back" href="#/">‹</a><h1 id="ttl">${esc(h.title)}</h1><span class="saved" id="saved"></span></div></header>
  <div class="wrap">
    <section class="box"><h2>基本資料</h2><div class="fields">
      ${inp('title', '標題', 'text', '', 'wide')}
      <label class="f">狀態<select data-f="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${h.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      ${inp('visit_at', '看房日期', 'date')}
      <div style="display:flex;align-items:end"><a class="btn small" id="ics" href="/api/houses/${id}/ics"${h.visit_at ? '' : ' hidden'}>🗓 加到行事曆</a></div>
      ${inp('city', '縣市')}${inp('district', '區域（如：板橋區）')}${inp('address', '地址', 'text', '', 'wide')}
      ${num('price', '總價（萬）')}${num('area', '權狀坪數')}
      <label class="f">單價（萬/坪）<input type="text" id="unit" readonly value="${h.unit_price ?? ''}"></label>
      ${inp('layout', '格局（如：3房2廳2衛）')}${inp('floor', '樓層（如：5/12）')}${num('age', '屋齡（年）')}
      ${num('mgmt_fee', '管理費（元/月）')}${inp('parking', '車位')}
      ${inp('agent_name', '仲介姓名')}${inp('agent_phone', '仲介電話', 'tel')}${inp('url', '物件連結', 'url', '', 'wide')}
    </div>
    <div class="links" id="links"></div>
    <div id="mapbox"></div></section>

    <section class="box"><h2>照片與影片</h2>
      <div class="uprow">
        <label class="btn primary">📷 拍照<input type="file" accept="image/*" capture="environment" id="up-photo"></label>
        <label class="btn primary">🎥 錄影<input type="file" accept="video/*" capture="environment" id="up-video"></label>
        <label class="btn">🖼 從相簿選<input type="file" accept="image/*,video/*" multiple id="up-lib"></label>
      </div>
      <div class="progress" id="prog" hidden><div></div></div>
      <div class="media" id="media"></div></section>

    <section class="box"><h2>看房檢查（點星星評分，再點一次取消）</h2><div id="checks"></div>
      <div class="count" id="score" style="margin-top:6px"></div></section>

    <section class="box"><h2>心得備註</h2>
      <textarea data-f="notes" placeholder="看完當下的感覺、優缺點、跟仲介談的內容、出價想法…">${esc(h.notes)}</textarea></section>

    <p><button class="btn danger" id="del">刪除這個物件</button></p>
  </div>`;

  if (STATIC) document.querySelectorAll('#app [data-f]').forEach(el => el.disabled = true);

  // --- 自動儲存 ---
  const pending = {}; let timer, inflight = 0;
  const setSaved = (m, err) => { const s = $('#saved'); if (s) { s.textContent = m; s.className = 'saved' + (err ? ' err' : ''); } };
  const flush = async () => {
    const body = { ...pending }; for (const k in pending) delete pending[k];
    if (!Object.keys(body).length) return;
    inflight++; setSaved('儲存中…');
    try { const r = await api('/houses/' + id, jsonOpts('PATCH', body)); Object.assign(h, r, { media: h.media }); setSaved('已儲存 ✓'); }
    catch (e) { Object.assign(pending, body); setSaved('儲存失敗：' + e.message, true); }
    finally { inflight--; }
    refreshDerived();
  };
  const queue = (k, v, now) => { pending[k] = v; setSaved('…'); clearTimeout(timer); now ? flush() : timer = setTimeout(flush, 700); };
  window.onbeforeunload = null;
  const leave = () => { if (Object.keys(pending).length) flush(); };
  window.addEventListener('hashchange', leave, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });

  document.querySelectorAll('[data-f]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.f; queue(k, el.value, el.tagName === 'SELECT');
      if (k === 'title') $('#ttl').textContent = el.value || '未命名';
      if (k === 'price' || k === 'area') { const p = +$('[data-f=price]').value, a = +$('[data-f=area]').value; $('#unit').value = p && a ? (p / a).toFixed(1) : ''; }
      if (k === 'visit_at') $('#ics').hidden = !el.value;
      if (['city', 'district', 'address'].includes(k)) { Object.assign(h, { [k]: el.value }); renderLinks(); }
    });
  });
  function refreshDerived() { $('#score') && renderScore(); }

  // --- 地圖 / 連結 ---
  function renderLinks() {
    const addr = [h.city, h.district, h.address].filter(Boolean).join('');
    const links = [];
    if (addr) links.push(`<a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">📍 Google 地圖</a>`);
    if (h.agent_phone) links.push(`<a class="btn small" href="tel:${esc(h.agent_phone)}">📞 打給仲介</a>`);
    if (h.url) links.push(`<a class="btn small" target="_blank" rel="noopener" href="${esc(h.url)}">🔗 物件頁面</a>`);
    $('#links').innerHTML = links.join('');
    $('#mapbox').innerHTML = addr ? `<button class="btn small" id="showmap" style="margin-top:10px">顯示地圖</button>` : '';
    const b = $('#showmap'); if (b) b.onclick = () => { $('#mapbox').innerHTML = `<iframe class="map" loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(addr)}&output=embed&hl=zh-TW"></iframe>`; };
  }
  renderLinks();

  // --- 檢查清單 ---
  function renderChecks() {
    $('#checks').innerHTML = Object.entries(CHECKS).map(([k, l]) => `<div class="check"><span>${l}</span><span class="stars" data-k="${k}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${(h.checks[k] || 0) >= n ? 'on' : ''}" aria-label="${l} ${n} 分">★</button>`).join('')}</span></div>`).join('');
    renderScore();
  }
  function renderScore() { $('#score').textContent = h.score ? `平均評分：★ ${h.score}（5 分最好）` : '尚未評分'; }
  $('#checks').onclick = e => {
    const b = e.target.closest('button'); if (!b || STATIC) return;
    const k = b.parentNode.dataset.k, n = +b.dataset.n;
    h.checks[k] = h.checks[k] === n ? 0 : n;
    const vals = Object.values(h.checks).filter(v => v > 0); h.score = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
    renderChecks(); queue('checks', h.checks, true);
  };
  renderChecks();

  // --- 媒體 ---
  const all = () => h.media;
  function renderMedia() {
    $('#media').innerHTML = all().length ? all().map((m, i) => `<div class="m" data-i="${i}">${m.kind === 'image' ? `<img loading="lazy" src="${m.thumb}" alt="">` : `<video preload="metadata" muted playsinline src="${m.url}#t=0.1"></video><span class="tag">▶ 影片</span>`}</div>`).join('') : '<div class="count">還沒有照片或影片</div>';
  }
  $('#media').onclick = e => { const m = e.target.closest('.m'); if (m) openLightbox(all(), +m.dataset.i, async mid => { await api('/media/' + mid, { method: 'DELETE' }); h.media = h.media.filter(x => x.id !== mid); renderMedia(); }); };
  renderMedia();

  function upload(files) {
    files = [...files]; if (!files.length) return;
    const fd = new FormData(); files.forEach(f => fd.append('files', f));
    const prog = $('#prog'), bar = prog.firstElementChild; prog.hidden = false; bar.style.width = '0';
    const x = new XMLHttpRequest(); x.open('POST', `/api/houses/${id}/media`);
    x.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
    x.onload = () => {
      prog.hidden = true;
      if (x.status === 201) { const r = JSON.parse(x.responseText); h.media = r.media; renderMedia(); toast(`已上傳 ${files.length} 個檔案`); }
      else { let m = '上傳失敗'; try { m = JSON.parse(x.responseText).detail || m; } catch {} toast(m); }
    };
    x.onerror = () => { prog.hidden = true; toast('上傳失敗，請確認網路連線'); };
    x.send(fd);
  }
  ['up-photo', 'up-video', 'up-lib'].forEach(i => { const el = $('#' + i); el.onchange = () => { upload(el.files); el.value = ''; }; });

  $('#del').onclick = async () => {
    if (!confirm(`確定刪除「${h.title}」？照片與影片也會一併刪除，無法復原。`)) return;
    await api('/houses/' + id, { method: 'DELETE' }); picked.delete(id); location.hash = '#/';
  };
}

// ---------- 燈箱 ----------
function openLightbox(items, i, onDelete) {
  const lb = $('#lightbox');
  const show = () => {
    const m = items[i];
    lb.innerHTML = `${m.kind === 'image' ? `<img src="${m.url}" alt="">` : `<video src="${m.url}" controls autoplay playsinline></video>`}
      <button class="x" aria-label="關閉">×</button>
      ${items.length > 1 ? '<button class="nav" style="left:0" data-d="-1">‹</button><button class="nav" style="right:0" data-d="1">›</button>' : ''}
      <button class="btn danger small" style="position:absolute;bottom:calc(16px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%)" data-del>刪除</button>`;
  };
  const close = () => { lb.hidden = true; lb.innerHTML = ''; document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  const step = d => { i = (i + d + items.length) % items.length; show(); };
  lb.onclick = async e => {
    if (e.target.closest('.x') || e.target === lb) return close();
    const n = e.target.closest('.nav'); if (n) return step(+n.dataset.d);
    if (e.target.closest('[data-del]') && confirm('刪除這個檔案？')) { await onDelete(items[i].id); if (!items.length) return close(); i = Math.min(i, items.length - 1); show(); }
  };
  let sx = 0; lb.ontouchstart = e => sx = e.touches[0].clientX;
  lb.ontouchend = e => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60 && items.length > 1) step(dx < 0 ? 1 : -1); };
  document.addEventListener('keydown', key); lb.hidden = false; show();
}

// ---------- 比較 ----------
async function compareView(ids) {
  const hs = await Promise.all(ids.split(',').map(i => api('/houses/' + i).catch(() => null)));
  const list = hs.filter(Boolean);
  const best = (vals, low) => { const v = vals.filter(x => x != null); if (v.length < 2) return null; return low ? Math.min(...v) : Math.max(...v); };
  const row = (label, fn, opt) => {
    const vals = list.map(h => opt ? opt.val(h) : null); const b = opt ? best(vals, opt.low) : null;
    return `<tr><td>${label}</td>${list.map((h, i) => `<td${opt && b != null && vals[i] === b ? ' class="best"' : ''}>${fn(h)}</td>`).join('')}</tr>`;
  };
  app.innerHTML = `<header class="top"><div class="row"><a class="back" href="#/">‹</a><h1>物件比較</h1></div></header>
  <div class="wrap"><p class="count">綠色標示為該項目最佳</p><div class="tbl"><table>
    <tr><td></td>${list.map(h => `<th><a href="#/house/${h.id}">${esc(h.title)}</a></th>`).join('')}</tr>
    ${row('照片', h => h.cover ? `<img src="${h.cover}" alt="">` : '—')}
    ${row('狀態', h => STATUS[h.status])}
    ${row('區域', h => esc([h.city, h.district].filter(Boolean).join('')) || '—')}
    ${row('總價', h => fmt(h.price, ' 萬'), { val: h => h.price, low: true })}
    ${row('坪數', h => fmt(h.area, ' 坪'), { val: h => h.area })}
    ${row('單價', h => fmt(h.unit_price, ' 萬/坪'), { val: h => h.unit_price, low: true })}
    ${row('格局', h => esc(h.layout) || '—')}
    ${row('樓層', h => esc(h.floor) || '—')}
    ${row('屋齡', h => fmt(h.age, ' 年'), { val: h => h.age, low: true })}
    ${row('管理費', h => fmt(h.mgmt_fee, ' 元/月'), { val: h => h.mgmt_fee, low: true })}
    ${row('車位', h => esc(h.parking) || '—')}
    ${row('平均評分', h => h.score ? '★ ' + h.score : '—', { val: h => h.score })}
    ${Object.entries(CHECKS).map(([k, l]) => row(l, h => h.checks[k] ? '★'.repeat(h.checks[k]) : '—', { val: h => h.checks[k] || null })).join('')}
  </table></div></div>`;
}

route();

if (!STATIC && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
