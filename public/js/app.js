import { auth, AuthError } from './store.js';
import * as egov1 from './egov1.js';
import * as csdlvb from './csdlvb.js';
import { makeZip } from './zip.js';

const ADAPTERS = { egov1, csdlvb };
const LABELS = { egov1: 'egov1', csdlvb: 'csdlvb' };
const TITLES = {
  egov1: 'Quản lý, điều hành',
  csdlvb: 'Cơ sở dữ liệu văn bản',
};
const PAGE_SIZE = 20;

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const keyOf = (it) => `${it.sys}:${it.kind}:${it.id}`;

const state = {
  kind: 'den',
  q: '',
  sources: JSON.parse(localStorage.getItem('qlvb.sources') || '{"egov1":true,"csdlvb":true}'),
  sort: localStorage.getItem('qlvb.sort') === 'asc' ? 'asc' : 'desc',
  from: '', to: '', view: 'search',
  pages: {}, // sys -> { page, total, items }
  basket: new Map(), // key -> item
};

// ---------- tiện ích UI ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function showView(name) {
  state.view = name;
  for (const v of ['search', 'basket', 'account']) $(`#view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const current = b.dataset.view === name;
    b.classList.toggle('on', current);
    if (current) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'basket') renderBasket();
  if (name === 'account') renderAccounts();
  window.scrollTo(0, 0);
}

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
function emptyState(name, title, description, action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon(name)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}
function loadingMarkup(text) {
  return `<div class="loading"><p class="loading-label" role="status"><span class="spinner" aria-hidden="true"></span>${esc(text)}</p>
    <div class="skeleton-grid" aria-hidden="true">${Array.from({ length: 2 }, () => '<div class="skeleton"><span></span><span></span><span></span><span></span></div>').join('')}</div></div>`;
}

// Keep touch scrolling and keyboard focus inside the active dialog.
const modalFocus = new Map();
function setOverlay(id, open) {
  const el = $(`#${id}`);
  if (open) modalFocus.set(id, document.activeElement);
  el.hidden = !open;
  const any = !$('#sheet').hidden || !$('#ready').hidden;
  for (const sel of ['main', '.topbar', '.tabbar']) $(sel).inert = any;
  $('#sheet').inert = !$('#ready').hidden;
  document.body.style.overflow = any ? 'hidden' : '';
  if (open) el.querySelector('button:not([hidden])')?.focus({ preventScroll: true });
  else {
    const previous = modalFocus.get(id);
    if (previous?.isConnected && !previous.closest('[hidden], [inert]')) previous.focus({ preventScroll: true });
    modalFocus.delete(id);
  }
}

function updateSelection() {
  const n = state.basket.size;
  $('#basket-count').textContent = n;
  $('#basket-count').hidden = !n;
  $('#selection-link').hidden = !n;
  $('#selection-link').textContent = `${n} đã chọn`;
  document.querySelectorAll('.doc').forEach((card) => {
    const picked = state.basket.has(card.dataset.key);
    card.classList.toggle('selected', picked);
    card.querySelector('.pick').checked = picked;
  });
}

function handleError(e) {
  if (e instanceof AuthError) {
    toast(`Phiên ${LABELS[e.sys]} hết hạn – hãy đăng nhập lại`);
    renderStatus();
    return `Phiên ${LABELS[e.sys]} hết hạn. Vào tab Tài khoản để đăng nhập lại.`;
  }
  console.error(e);
  return e.message || 'Có lỗi xảy ra';
}

function renderStatus() {
  const on = Object.keys(ADAPTERS).filter((s) => auth.valid(s));
  const status = $('#status');
  status.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${on.length ? `${on.length} hệ thống` : 'Đăng nhập'}${icon('arrow')}</span>`;
  status.classList.toggle('connected', !!on.length);
  status.title = on.length ? `Đã đăng nhập: ${on.map((s) => LABELS[s]).join(', ')}` : 'Đăng nhập để tra cứu';
  status.setAttribute('aria-label', on.length ? `${status.title}. Xem tài khoản` : 'Đăng nhập tài khoản');
  renderChips();
}

// ---------- tra cứu ----------
function renderChips() {
  $('#source-chips').innerHTML = Object.keys(ADAPTERS).map((s) => {
    const ok = !!auth.valid(s);
    return `<label class="chip ${ok ? '' : 'off'}"><input type="checkbox" data-src="${s}" aria-label="Tra cứu nguồn ${LABELS[s]}" ${state.sources[s] && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}>
      <span class="chip-name">${LABELS[s]}</span>${ok ? '' : `${icon('lock')}<span class="chip-note">Chưa kết nối</span>`}</label>`;
  }).join('');
}

function activeSources() {
  return Object.keys(ADAPTERS).filter((s) => state.sources[s] && auth.valid(s));
}

function docCard(it) {
  const picked = state.basket.has(keyOf(it));
  return `<article class="doc ${picked ? 'selected' : ''}" data-key="${esc(keyOf(it))}">
    <label class="pick-wrap"><input type="checkbox" class="pick" aria-label="Chọn văn bản ${esc(it.soHieu || it.id)} để tải" ${picked ? 'checked' : ''}></label>
    <div class="main" role="button" tabindex="0" aria-label="Xem chi tiết ${esc(it.soHieu || 'văn bản')}">
      <div class="row1"><span class="badge ${it.sys}">${LABELS[it.sys]}</span><span class="code">${esc(it.soHieu || '(không số)')}</span></div>
      <div class="date">${icon('calendar')}${esc(it.ngay || 'Chưa có ngày')}</div>
      <p class="abs">${esc(it.trichYeu || 'Chưa có trích yếu')}</p>
      <div class="meta"><span>${esc([it.loai, it.coQuan].filter(Boolean).join(' · '))}${it.fileCount ? ` <span class="file-count">${icon('clip')}${it.fileCount} tệp</span>` : ''}</span><span class="open-hint">Chi tiết${icon('arrow')}</span></div>
    </div></article>`;
}

const itemIndex = new Map();

function renderResults() {
  const box = $('#results');
  box.setAttribute('aria-busy', 'false');
  const srcs = Object.keys(ADAPTERS).filter((s) => state.pages[s]);
  if (!srcs.length) {
    const active = activeSources().length;
    const loggedIn = Object.keys(ADAPTERS).some((s) => auth.valid(s));
    $('#result-summary').textContent = active ? 'Tra cứu từ các nguồn đã kết nối' : 'Chưa có nguồn dữ liệu được chọn';
    box.innerHTML = active
      ? emptyState('search', 'Bạn cần tìm văn bản nào?', 'Nhập số ký hiệu hoặc một phần trích yếu. Để trống ô tìm kiếm để xem văn bản mới nhất.', '<button type="button" class="btn primary" data-latest>Xem văn bản mới nhất</button>')
      : loggedIn
        ? emptyState('filter', 'Chọn nguồn dữ liệu', 'Chọn egov1 hoặc csdlvb ở phía trên để bắt đầu tra cứu.')
        : emptyState('lock', 'Kết nối để bắt đầu', 'Đăng nhập ít nhất một hệ thống để tìm và tải văn bản của bạn.', '<button type="button" class="btn primary" data-go-account>Đăng nhập tài khoản</button>');
    $('#more').hidden = true;
    return;
  }
  const pages = srcs.map((s) => state.pages[s]);
  const loaded = pages.reduce((n, p) => n + p.items.length, 0);
  const total = pages.reduce((n, p) => n + p.total, 0);
  const errors = pages.filter((p) => p.error).length;
  $('#result-summary').textContent = errors === pages.length
    ? `Chưa lấy được kết quả · ${errors} nguồn gặp lỗi`
    : `Hiển thị ${loaded.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} văn bản${errors ? ` · ${errors} nguồn gặp lỗi` : ''}`;
  box.innerHTML = srcs.map((s) => {
    const p = state.pages[s];
    const head = `<p class="group-head"><span class="badge ${s}">${LABELS[s]}</span>${p.items.length.toLocaleString('vi-VN')} / ${p.total.toLocaleString('vi-VN')} văn bản</p>`;
    if (p.error) return `<p class="group-head"><span class="badge ${s}">${LABELS[s]}</span></p><div class="error" role="alert">${esc(p.error)}<div class="actions"><button type="button" class="btn" data-retry="${s}">Thử lại</button></div></div>`;
    return head + (p.items.length ? p.items.map(docCard).join('') : emptyState('search', 'Chưa tìm thấy văn bản', 'Thử từ khóa ngắn hơn hoặc điều chỉnh bộ lọc.'));
  }).join('');
  $('#more').hidden = !srcs.some((s) => !state.pages[s].error && state.pages[s].items.length < state.pages[s].total);
}

// Sắp lại trên máy để thứ tự hiển thị luôn đúng (kể cả khi máy chủ bỏ qua tham số sắp xếp).
// Văn bản không có ngày luôn nằm cuối; cùng ngày thì giữ thứ tự máy chủ trả về.
function sortByDate(items) {
  const dir = state.sort === 'asc' ? 1 : -1;
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const x = a.it.ts, y = b.it.ts;
      if (isNaN(x) || isNaN(y)) return isNaN(x) - isNaN(y) || a.i - b.i;
      return (x - y) * dir || a.i - b.i;
    })
    .map((w) => w.it);
}

let searchVersion = 0;
async function loadPage(sys, page, version = searchVersion) {
  const opts = { q: state.q, page, size: PAGE_SIZE, from: state.from, to: state.to, sort: state.sort };
  const kind = state.kind;
  try {
    const r = await ADAPTERS[sys].search(kind, opts);
    if (version !== searchVersion) return;
    const prev = page > 1 ? state.pages[sys].items : [];
    r.items.forEach((it) => itemIndex.set(keyOf(it), it));
    state.pages[sys] = { page, total: r.total, items: sortByDate(prev.concat(r.items)) };
  } catch (e) {
    if (version !== searchVersion) return;
    state.pages[sys] = { page, total: 0, items: [], error: handleError(e) };
  }
}

async function runSearch() {
  const version = ++searchVersion;
  const srcs = activeSources();
  state.pages = {};
  $('#more').disabled = false;
  $('#more').textContent = 'Xem thêm văn bản';
  if (!srcs.length) return renderResults();
  $('#results').innerHTML = loadingMarkup('Đang tìm văn bản…');
  $('#results').setAttribute('aria-busy', 'true');
  $('#result-summary').textContent = 'Đang tra cứu các nguồn đã chọn…';
  $('#more').hidden = true;
  await Promise.all(srcs.map((s) => loadPage(s, 1, version)));
  if (version === searchVersion) renderResults();
}

// A manual retry should not reload another system whose results are already available.
async function retrySource(sys, button) {
  if (!activeSources().includes(sys)) return runSearch();
  const version = searchVersion;
  button.disabled = true;
  button.textContent = 'Đang thử lại…';
  $('#results').setAttribute('aria-busy', 'true');
  await loadPage(sys, 1, version);
  if (version === searchVersion) renderResults();
}

async function loadMore() {
  const version = searchVersion;
  const btn = $('#more');
  btn.disabled = true;
  btn.textContent = 'Đang tải…';
  const todo = Object.keys(state.pages).filter((s) => !state.pages[s].error && state.pages[s].items.length < state.pages[s].total);
  await Promise.all(todo.map((s) => loadPage(s, state.pages[s].page + 1, version)));
  if (version !== searchVersion) return;
  btn.disabled = false;
  btn.textContent = 'Xem thêm văn bản';
  renderResults();
}

// ---------- giỏ tải ----------
function setPicked(it, on) {
  if (on) state.basket.set(keyOf(it), it);
  else state.basket.delete(keyOf(it));
  updateSelection();
}

function renderBasket() {
  const items = [...state.basket.values()];
  $('#basket-list').innerHTML = items.length ? items.map(docCard).join('') : emptyState('download', 'Danh sách tải đang trống', 'Chạm vào ô chọn bên cạnh văn bản trong kết quả tra cứu để thêm vào đây.', '<button type="button" class="btn primary" data-go-search>Tra cứu văn bản</button>');
  $('#basket-actions').hidden = !items.length;
  $('#basket-actions').innerHTML = items.length
    ? `<button class="btn primary" id="dl-zip">Tải ${items.length} văn bản (ZIP)</button><button class="btn" id="dl-each">Tải từng tệp</button><button class="btn danger" id="dl-clear">Bỏ chọn tất cả</button>`
    : '';
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

async function collectFiles(items, onProgress) {
  const out = [];
  let i = 0;
  for (const it of items) {
    onProgress(`Đang lấy danh sách file ${++i}/${items.length}…`);
    const d = await ADAPTERS[it.sys].detail(it);
    const folder = safeName(`${it.soHieu || it.id}`) || String(it.id);
    for (const f of d.files) out.push({ it, f, folder });
  }
  const res = [];
  let n = 0;
  for (const { it, f, folder } of out) {
    onProgress(`Đang tải file ${++n}/${out.length}: ${f.name}`);
    res.push({ name: f.name, folder, blob: await ADAPTERS[it.sys].download(f, it) });
  }
  return res;
}

async function downloadBasket(asZip) {
  const items = [...state.basket.values()];
  const btns = document.querySelectorAll('#basket-actions .btn');
  btns.forEach((b) => (b.disabled = true));
  try {
    const files = await collectFiles(items, toast);
    if (!files.length) return toast('Các văn bản đã chọn không có file đính kèm');
    if (asZip) {
      const used = new Set();
      const entries = files.map((x) => {
        let name = `${x.folder}/${safeName(x.name) || 'file'}`;
        for (let k = 2; used.has(name); k++) name = `${x.folder}/${k}_${safeName(x.name)}`;
        used.add(name);
        return { name, blob: x.blob };
      });
      const stamp = new Date().toISOString().slice(0, 10);
      offer([{ name: `van-ban_${stamp}.zip`, blob: await makeZip(entries) }]);
    } else {
      offer(files.map((x) => ({ name: x.name, blob: x.blob })));
    }
  } catch (e) {
    toast(handleError(e));
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------- lưu file: iOS cần thao tác chạm mới để mở bảng Chia sẻ ----------
let pending = [];
function offer(files) {
  pending = files;
  const total = files.reduce((s, f) => s + f.blob.size, 0);
  $('#ready-text').textContent = `Đã sẵn sàng ${files.length} tệp (${(total / 1048576).toFixed(1)} MB).`;
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  $('#ready-share').hidden = !(navigator.canShare && navigator.canShare({ files: asFiles }));
  setOverlay('ready', true);
}

function saveViaAnchor(files) {
  files.forEach((f, i) =>
    setTimeout(() => {
      const url = URL.createObjectURL(f.blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: f.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, i * 400),
  );
}

// ---------- chi tiết ----------
let detailVersion = 0;
async function openDetail(it) {
  const version = ++detailVersion;
  const sheet = $('#sheet');
  $('#sheet-badge').className = `badge ${it.sys}`;
  $('#sheet-badge').textContent = LABELS[it.sys];
  $('#sheet-body').innerHTML = loadingMarkup('Đang mở văn bản…');
  setOverlay('sheet', true);
  sheet.scrollTop = 0;
  history.pushState({ sheet: true }, '');
  try {
    const d = await ADAPTERS[it.sys].detail(it);
    if (version !== detailVersion) return;
    const inBasket = state.basket.has(keyOf(it));
    $('#sheet-body').innerHTML = `
      <div class="detail-intro"><p class="eyebrow">VĂN BẢN ${it.kind === 'den' ? 'ĐẾN' : 'ĐI'}</p><h2>${esc(it.soHieu || '(không số)')}</h2>
      <p>${esc(d.fields.find(([k]) => k === 'Trích yếu')?.[1] || it.trichYeu)}</p></div>
      <dl class="fields">${d.fields.filter(([k]) => k !== 'Số ký hiệu' && k !== 'Trích yếu').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h2>Tệp đính kèm (${d.files.length})</h2>
      ${
        d.files.length
          ? `<ul class="files">${d.files
              .map(
                (f, i) => `<li><label><input type="checkbox" data-i="${i}" checked aria-label="Chọn tệp ${esc(f.name)}">
                  <span class="fname">${esc(f.name)}</span></label>
                  <button class="btn" data-view-file="${i}">Xem</button></li>`,
              )
              .join('')}</ul>
             <div class="actions">
               <button class="btn primary" id="dl-files">Tải tệp đã chọn</button>
               <button class="btn" id="dl-files-zip">Tải dạng ZIP</button>
             </div>`
          : '<p class="hint">Văn bản không có tệp đính kèm.</p>'
      }
      <div class="actions"><button class="btn" id="toggle-basket">${inBasket ? 'Bỏ khỏi danh sách tải' : 'Thêm vào danh sách tải'}</button></div>`;

    const body = $('#sheet-body');
    const chosen = () => [...body.querySelectorAll('.files input:checked')].map((c) => d.files[+c.dataset.i]);
    const fetchChosen = async (btn) => {
      const list = chosen();
      if (!list.length) return toast('Chưa chọn file nào'), [];
      btn.disabled = true;
      try {
        const out = [];
        for (const [n, f] of list.entries()) {
          toast(`Đang tải ${n + 1}/${list.length}: ${f.name}`);
          out.push({ name: f.name, blob: await ADAPTERS[it.sys].download(f, it) });
        }
        return out;
      } catch (e) {
        toast(handleError(e));
        return [];
      } finally {
        btn.disabled = false;
      }
    };
    body.querySelector('#dl-files')?.addEventListener('click', async (e) => {
      const out = await fetchChosen(e.currentTarget);
      if (out.length) offer(out);
    });
    body.querySelector('#dl-files-zip')?.addEventListener('click', async (e) => {
      const out = await fetchChosen(e.currentTarget);
      if (out.length) offer([{ name: `${safeName(it.soHieu) || 'van-ban'}.zip`, blob: await makeZip(out.map((x) => ({ name: safeName(x.name), blob: x.blob }))) }]);
    });
    body.querySelectorAll('[data-view-file]').forEach((b) =>
      b.addEventListener('click', async () => {
        const f = d.files[+b.dataset.viewFile];
        const win = window.open('', '_blank'); // mở ngay trong thao tác chạm để không bị chặn popup
        try {
          b.disabled = true;
          const blob = await ADAPTERS[it.sys].download(f, it);
          const url = URL.createObjectURL(blob);
          if (win) win.location.href = url;
          else offer([{ name: f.name, blob }]);
        } catch (e) {
          win?.close();
          toast(handleError(e));
        } finally {
          b.disabled = false;
        }
      }),
    );
    body.querySelector('#toggle-basket').addEventListener('click', (e) => {
      const on = !state.basket.has(keyOf(it));
      setPicked(it, on);
      e.currentTarget.textContent = on ? 'Bỏ khỏi danh sách tải' : 'Thêm vào danh sách tải';
      if (state.view === 'basket') renderBasket();
      document.querySelectorAll(`.doc[data-key="${CSS.escape(keyOf(it))}"] .pick`).forEach((c) => (c.checked = on));
    });
  } catch (e) {
    if (version === detailVersion) $('#sheet-body').innerHTML = `<p class="error" role="alert">${esc(handleError(e))}</p>`;
  }
}

function closeDetail() {
  detailVersion++;
  setOverlay('sheet', false);
}

// ---------- tài khoản ----------
const logins = {}; // sys -> loginId
const loginVersions = { egov1: 0, csdlvb: 0 };

function renderAccounts() {
  $('#accounts').innerHTML = Object.keys(ADAPTERS).map((s) => {
    const a = auth.get(s);
    const valid = auth.valid(s);
    const until = a?.expiresAt ? new Date(a.expiresAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    return `<div class="card" data-sys="${s}">
      <div class="account-head"><span class="system-icon ${s}">${icon(s === 'egov1' ? 'document' : 'download')}</span><div><h3>${esc(TITLES[s])}</h3><span class="system-url">${s}.laocai.gov.vn</span></div></div>
      ${valid
        ? `<p class="who"><span class="connection-state ok">${icon('check')} Đã kết nối</span><br><strong>${esc(a.user?.name || a.user?.userName || 'Tài khoản đã đăng nhập')}</strong>${a.user?.unit ? `<br>${esc(a.user.unit)}` : ''}<br>Phiên hết hạn: ${esc(until)}</p>
          <div class="actions"><button class="btn primary" data-search="${s}">Tra cứu văn bản</button><button class="btn danger" data-logout="${s}">Đăng xuất</button></div>`
        : `<p class="who"><span class="connection-state ${a ? 'bad' : ''}">${a ? 'Phiên đã hết hạn' : 'Chưa kết nối'}</span><br>${a ? 'Đăng nhập lại để tiếp tục tra cứu.' : 'Kết nối tài khoản để tra cứu và tải văn bản.'}</p>
          <div class="actions"><button class="btn primary" data-login="${s}">Đăng nhập ${LABELS[s]}</button></div>
          <form class="form" data-form="${s}" hidden>
            <label for="username-${s}">Tài khoản<input id="username-${s}" name="username" placeholder="SĐT / CCCD / email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(localStorage.getItem(`qlvb.user.${s}`) || '')}" required></label>
            <label for="password-${s}">Mật khẩu<input id="password-${s}" name="password" type="password" placeholder="Nhập mật khẩu" autocomplete="current-password" required></label>
            <div class="captcha"><img alt="Mã xác thực"><button type="button" class="btn" data-recaptcha="${s}" aria-label="Đổi mã xác thực">${icon('refresh')}</button><label for="captcha-${s}">Mã xác thực<input id="captcha-${s}" name="captcha" placeholder="Nhập mã trong ảnh" autocomplete="off" autocapitalize="off" spellcheck="false" required></label></div>
            <p class="msg" role="status"></p>
            <button class="btn primary" type="submit">Kết nối ${LABELS[s]}</button>
            <button class="btn ghost" type="button" data-cancel-login="${s}">Hủy đăng nhập</button>
          </form>`}
    </div>`;
  }).join('');
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `Lỗi máy chủ (${res.status})`), { expired: j.expired });
  return j;
}

async function beginLogin(sys) {
  const version = ++loginVersions[sys];
  const card = document.querySelector(`.card[data-sys="${sys}"]`);
  const form = card.querySelector('form');
  card.querySelector(`[data-login]`).parentElement.hidden = true;
  form.hidden = false;
  form.querySelector('.msg').textContent = 'Đang mở phiên đăng nhập…';
  try {
    const r = await post('/api/auth/start', { sys });
    if (version !== loginVersions[sys] || !form.isConnected || form.hidden) return;
    logins[sys] = r.loginId;
    form.querySelector('img').src = r.captcha;
    form.querySelector('.msg').textContent = '';
    form.querySelector(form.username.value ? '[name=password]' : '[name=username]').focus();
  } catch (e) {
    if (version === loginVersions[sys] && form.isConnected) form.querySelector('.msg').textContent = e.message;
  }
}

async function submitLogin(sys, form) {
  const msg = form.querySelector('.msg');
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  const cancel = form.querySelector('[data-cancel-login]');
  cancel.disabled = true;
  msg.textContent = 'Đang đăng nhập…';
  try {
    const r = await post('/api/auth/finish', {
      loginId: logins[sys],
      username: form.username.value,
      password: form.password.value,
      captcha: form.captcha.value.trim(),
    });
    if (!r.ok) {
      msg.textContent = r.error;
      form.captcha.value = '';
      if (r.captcha) form.querySelector('img').src = r.captcha;
      if (r.restart) {
        form.password.value = '';
        await beginLogin(sys);
        msg.textContent = r.error;
      }
      return;
    }
    localStorage.setItem(`qlvb.user.${sys}`, form.username.value.trim());
    auth.set(sys, { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt, user: r.user });
    delete logins[sys];
    state.sources[sys] = true;
    toast(`Đã đăng nhập ${LABELS[sys]}`);
    renderAccounts();
    renderStatus();
    renderResults();
  } catch (e) {
    msg.textContent = e.message;
    if (e.expired) await beginLogin(sys);
  } finally {
    btn.disabled = false;
    cancel.disabled = false;
  }
}

// ---------- gắn sự kiện ----------

function bind() {
  $('#status').addEventListener('click', () => showView('account'));
  $('.brand').addEventListener('click', (e) => { e.preventDefault(); showView('search'); });
  $('#selection-link').addEventListener('click', () => showView('basket'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-go-account]')) showView('account');
    if (e.target.closest('[data-go-search]')) showView('search');
    if (e.target.closest('[data-latest]')) {
      $('#q').value = '';
      state.q = '';
      runSearch();
    }
    const retry = e.target.closest('[data-retry]');
    if (retry) retrySource(retry.dataset.retry, retry);
  });
  document.addEventListener('keydown', (e) => {
    const modal = !$('#ready').hidden ? $('#ready') : !$('#sheet').hidden ? $('#sheet') : null;
    if (!modal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (modal.id === 'ready') setOverlay('ready', false);
      else history.back();
    }
    if (e.key === 'Tab') {
      const targets = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"], a[href]')].filter((x) => x.getClientRects().length && !x.closest('[hidden], [inert]'));
      const first = targets[0], last = targets.at(-1);
      if (!first) { e.preventDefault(); modal.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === modal)) { e.preventDefault(); first.focus(); }
    }
  });
  const networkState = () => { $('#network-notice').hidden = navigator.onLine; };
  window.addEventListener('online', networkState);
  window.addEventListener('offline', networkState);
  networkState();
  $('#date-apply').addEventListener('click', () => {
    const from = $('#from').value, to = $('#to').value;
    if (from && to && from > to) {
      toast('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      $('#to').focus();
      return;
    }
    state.from = from; state.to = to;
    $('#date-count').hidden = !(from || to);
    $('.dates').open = false;
    runSearch();
  });
  $('#date-clear').addEventListener('click', () => {
    $('#from').value = ''; $('#to').value = '';
    state.from = ''; state.to = '';
    $('#date-count').hidden = true;
    $('.dates').open = false;
    runSearch();
  });

  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = $('#q').value;
    $('#q').blur();
    runSearch();
  });
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (!b || b.dataset.kind === state.kind) return;
    state.kind = b.dataset.kind;
    document.querySelectorAll('.seg button').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b);
    });
    runSearch();
  });
  $('#source-chips').addEventListener('change', (e) => {
    const s = e.target.dataset.src;
    if (!s) return;
    state.sources[s] = e.target.checked;
    localStorage.setItem('qlvb.sources', JSON.stringify(state.sources));
    runSearch();
  });
  $('#more').addEventListener('click', loadMore);
  $('#sort').value = state.sort;
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    localStorage.setItem('qlvb.sort', state.sort);
    if (Object.keys(state.pages).length) runSearch();
  });

  // Chọn / mở văn bản (dùng chung cho kết quả và giỏ)
  for (const sel of ['#results', '#basket-list']) {
    $(sel).addEventListener('click', (e) => {
      const card = e.target.closest('.doc');
      if (!card) return;
      const it = itemIndex.get(card.dataset.key) || state.basket.get(card.dataset.key);
      if (!it) return;
      if (e.target.classList.contains('pick')) {
        setPicked(it, e.target.checked);
        if (sel === '#basket-list') renderBasket();
      } else if (e.target.closest('.main')) openDetail(it);

    });
    $(sel).addEventListener('keydown', (e) => {
      const main = e.target.closest('.doc .main');
      if (!main || !['Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      const key = main.closest('.doc').dataset.key;
      const it = itemIndex.get(key) || state.basket.get(key);
      if (it) openDetail(it);
    });
  }
  $('#basket-actions').addEventListener('click', (e) => {
    if (e.target.id === 'dl-zip') downloadBasket(true);
    if (e.target.id === 'dl-each') downloadBasket(false);
    if (e.target.id === 'dl-clear') {
      state.basket.clear();
      updateSelection();
      renderBasket();
    }
  });

  $('#sheet-close').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    if (!$('#ready').hidden) setOverlay('ready', false);
    closeDetail();
  });

  $('#ready-share').addEventListener('click', async () => {
    const files = pending.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
    try {
      await navigator.share({ files });
      setOverlay('ready', false);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Không mở được bảng chia sẻ, hãy dùng "Tải xuống"');
    }
  });
  $('#ready-save').addEventListener('click', () => {
    saveViaAnchor(pending);
    setOverlay('ready', false);
  });
  $('#ready-close').addEventListener('click', () => setOverlay('ready', false));

  $('#accounts').addEventListener('click', (e) => {

    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.search) {
      state.sources[t.dataset.search] = true;
      localStorage.setItem('qlvb.sources', JSON.stringify(state.sources));
      renderChips(); showView('search'); runSearch();
    }
    if (t.dataset.cancelLogin) {
      loginVersions[t.dataset.cancelLogin]++;
      delete logins[t.dataset.cancelLogin];
      const card = t.closest('.card');
      card.querySelector('form').reset();
      card.querySelector('form').hidden = true;
      card.querySelector('[data-login]').parentElement.hidden = false;
      card.querySelector('[data-login]').focus();
    }
    if (t.dataset.login) beginLogin(t.dataset.login);
    if (t.dataset.logout) {
      auth.clear(t.dataset.logout);
      renderAccounts();
      renderStatus();
      runSearch();
    }
    if (t.dataset.recaptcha) {
      const sys = t.dataset.recaptcha;
      post('/api/auth/captcha', { loginId: logins[sys] })
        .then((r) => (document.querySelector(`.card[data-sys="${sys}"] img`).src = r.captcha))
        .catch((err) => (err.expired ? beginLogin(sys) : toast(err.message)));
    }
  });
  $('#accounts').addEventListener('submit', (e) => {
    e.preventDefault();
    submitLogin(e.target.dataset.form, e.target);
  });
}

bind();
renderStatus();
renderResults();
if (!activeSources().length) showView('account');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
