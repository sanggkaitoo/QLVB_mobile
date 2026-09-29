import { auth, AuthError } from './store.js';
import * as egov1 from './egov1.js';
import * as csdlvb from './csdlvb.js';
import { makeZip } from './zip.js';

const ADAPTERS = { egov1, csdlvb };
const LABELS = { egov1: 'egov1', csdlvb: 'csdlvb' };
const TITLES = {
  egov1: 'egov1 – Quản lý, điều hành',
  csdlvb: 'csdlvb – CSDL văn bản',
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
  for (const v of ['search', 'basket', 'account']) $(`#view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  if (name === 'basket') renderBasket();
  if (name === 'account') renderAccounts();
  window.scrollTo(0, 0);
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
  $('#status').textContent = on.length ? `Đã đăng nhập: ${on.map((s) => LABELS[s]).join(', ')}` : 'Chưa đăng nhập';
  renderChips();
}

// ---------- tra cứu ----------
function renderChips() {
  $('#source-chips').innerHTML = Object.keys(ADAPTERS)
    .map((s) => {
      const ok = !!auth.valid(s);
      return `<label class="chip ${ok ? '' : 'off'}">
        <input type="checkbox" data-src="${s}" ${state.sources[s] && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}>
        <span class="badge ${s}">${LABELS[s]}</span>${ok ? '' : ' chưa đăng nhập'}</label>`;
    })
    .join('');
}

function activeSources() {
  return Object.keys(ADAPTERS).filter((s) => state.sources[s] && auth.valid(s));
}

function docCard(it) {
  const checked = state.basket.has(keyOf(it)) ? 'checked' : '';
  return `<article class="doc" data-key="${esc(keyOf(it))}">
    <input type="checkbox" class="pick" aria-label="Chọn để tải" ${checked}>
    <div class="main">
      <div class="row1"><span class="badge ${it.sys}">${LABELS[it.sys]}</span>
        <span class="code">${esc(it.soHieu || '(không số)')}</span><span class="date">${esc(it.ngay)}</span></div>
      <p class="abs">${esc(it.trichYeu)}</p>
      <div class="meta">${esc([it.loai, it.coQuan].filter(Boolean).join(' · '))}${
        it.fileCount ? ` · 📎 ${it.fileCount}` : ''
      }</div>
    </div>
  </article>`;
}

const itemIndex = new Map();

function renderResults() {
  const box = $('#results');
  const srcs = Object.keys(ADAPTERS).filter((s) => state.pages[s]);
  if (!srcs.length) {
    box.innerHTML = `<p class="empty">${
      activeSources().length ? 'Nhập từ khoá rồi bấm Tìm (để trống để xem mới nhất).' : 'Hãy đăng nhập ít nhất một hệ thống ở tab Tài khoản.'
    }</p>`;
    $('#more').hidden = true;
    return;
  }
  box.innerHTML = srcs
    .map((s) => {
      const p = state.pages[s];
      if (p.error) return `<p class="group-head">${LABELS[s]}</p><p class="error">${esc(p.error)}</p>`;
      const head = `<p class="group-head"><span class="badge ${s}">${LABELS[s]}</span> ${p.items.length}/${p.total.toLocaleString('vi-VN')} kết quả</p>`;
      return head + (p.items.length ? p.items.map(docCard).join('') : '<p class="empty">Không có kết quả</p>');
    })
    .join('');
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

async function loadPage(sys, page) {
  const opts = { q: state.q, page, size: PAGE_SIZE, from: $('#from').value, to: $('#to').value, sort: state.sort };
  try {
    const r = await ADAPTERS[sys].search(state.kind, opts);
    const prev = page > 1 ? state.pages[sys].items : [];
    r.items.forEach((it) => itemIndex.set(keyOf(it), it));
    state.pages[sys] = { page, total: r.total, items: sortByDate(prev.concat(r.items)) };
  } catch (e) {
    state.pages[sys] = { page, total: 0, items: [], error: handleError(e) };
  }
}

async function runSearch() {
  const srcs = activeSources();
  state.pages = {};
  if (!srcs.length) return renderResults();
  $('#results').innerHTML = '<p class="empty">Đang tìm…</p>';
  $('#more').hidden = true;
  await Promise.all(srcs.map((s) => loadPage(s, 1)));
  renderResults();
}

async function loadMore() {
  const btn = $('#more');
  btn.disabled = true;
  btn.textContent = 'Đang tải…';
  const todo = Object.keys(state.pages).filter((s) => !state.pages[s].error && state.pages[s].items.length < state.pages[s].total);
  await Promise.all(todo.map((s) => loadPage(s, state.pages[s].page + 1)));
  btn.disabled = false;
  btn.textContent = 'Tải thêm';
  renderResults();
}

// ---------- giỏ tải ----------
function setPicked(it, on) {
  if (on) state.basket.set(keyOf(it), it);
  else state.basket.delete(keyOf(it));
  $('#basket-count').textContent = state.basket.size;
}

function renderBasket() {
  const items = [...state.basket.values()];
  $('#basket-list').innerHTML = items.length ? items.map(docCard).join('') : '<p class="empty">Chưa chọn văn bản nào. Tick ô vuông ở kết quả tra cứu.</p>';
  $('#basket-actions').innerHTML = items.length
    ? `<button class="btn primary" id="dl-zip">Tải ${items.length} văn bản (ZIP)</button>
       <button class="btn" id="dl-each">Tải từng file</button>
       <button class="btn danger" id="dl-clear">Bỏ chọn tất cả</button>`
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
  $('#ready').hidden = false;
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
async function openDetail(it) {
  const sheet = $('#sheet');
  $('#sheet-badge').className = `badge ${it.sys}`;
  $('#sheet-badge').textContent = LABELS[it.sys];
  $('#sheet-body').innerHTML = '<p class="empty">Đang tải…</p>';
  sheet.hidden = false;
  sheet.scrollTop = 0;
  history.pushState({ sheet: true }, '');
  try {
    const d = await ADAPTERS[it.sys].detail(it);
    const inBasket = state.basket.has(keyOf(it));
    $('#sheet-body').innerHTML = `
      <h2>${esc(it.soHieu || '(không số)')}</h2>
      <p>${esc(d.fields.find(([k]) => k === 'Trích yếu')?.[1] || it.trichYeu)}</p>
      <dl class="fields">${d.fields.filter(([k]) => k !== 'Số ký hiệu' && k !== 'Trích yếu').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h2>File đính kèm (${d.files.length})</h2>
      ${
        d.files.length
          ? `<ul class="files">${d.files
              .map(
                (f, i) => `<li><input type="checkbox" data-i="${i}" checked aria-label="Chọn file">
                  <span class="fname">${esc(f.name)}</span>
                  <button class="btn" data-view-file="${i}">Xem</button></li>`,
              )
              .join('')}</ul>
             <div class="actions">
               <button class="btn primary" id="dl-files">Tải file đã chọn</button>
               <button class="btn" id="dl-files-zip">Tải dạng ZIP</button>
             </div>`
          : '<p class="hint">Văn bản không có file đính kèm.</p>'
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
      document.querySelectorAll(`.doc[data-key="${CSS.escape(keyOf(it))}"] .pick`).forEach((c) => (c.checked = on));
    });
  } catch (e) {
    $('#sheet-body').innerHTML = `<p class="error">${esc(handleError(e))}</p>`;
  }
}

function closeDetail() {
  $('#sheet').hidden = true;
}

// ---------- tài khoản ----------
const logins = {}; // sys -> { loginId }

function renderAccounts() {
  $('#accounts').innerHTML = Object.keys(ADAPTERS)
    .map((s) => {
      const a = auth.get(s);
      const valid = auth.valid(s);
      const until = a?.expiresAt ? new Date(a.expiresAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
      return `<div class="card" data-sys="${s}">
        <h3><span class="badge ${s}">${LABELS[s]}</span> ${esc(TITLES[s])}</h3>
        ${
          valid
            ? `<p class="who"><span class="ok">● Đã đăng nhập</span> – ${esc(a.user?.name || a.user?.userName || '')}${
                a.user?.unit ? `<br>${esc(a.user.unit)}` : ''
              }<br>Hết hạn: ${esc(until)}</p>
               <div class="actions"><button class="btn danger" data-logout="${s}">Đăng xuất</button></div>`
            : `<p class="who">${a ? '<span class="bad">● Phiên đã hết hạn</span>' : 'Chưa đăng nhập'}</p>
               <div class="actions"><button class="btn primary" data-login="${s}">Đăng nhập</button></div>
               <form class="form" data-form="${s}" hidden>
                 <input name="username" placeholder="Tài khoản (SĐT / CCCD / email)" autocomplete="username" value="${esc(
                   localStorage.getItem(`qlvb.user.${s}`) || '',
                 )}" required>
                 <input name="password" type="password" placeholder="Mật khẩu" autocomplete="current-password" required>
                 <div class="captcha"><img alt="Mã xác thực"><button type="button" class="btn" data-recaptcha="${s}" aria-label="Đổi mã">↻</button>
                   <input name="captcha" placeholder="Mã xác thực" autocomplete="off" autocapitalize="off" required></div>
                 <p class="msg"></p>
                 <button class="btn primary" type="submit">Đăng nhập ${LABELS[s]}</button>
               </form>`
        }
      </div>`;
    })
    .join('');
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
  const card = document.querySelector(`.card[data-sys="${sys}"]`);
  const form = card.querySelector('form');
  card.querySelector(`[data-login]`).parentElement.hidden = true;
  form.hidden = false;
  form.querySelector('.msg').textContent = 'Đang mở phiên đăng nhập…';
  try {
    const r = await post('/api/auth/start', { sys });
    logins[sys] = r.loginId;
    form.querySelector('img').src = r.captcha;
    form.querySelector('.msg').textContent = '';
    form.querySelector(form.username.value ? '[name=password]' : '[name=username]').focus();
  } catch (e) {
    form.querySelector('.msg').textContent = e.message;
  }
}

async function submitLogin(sys, form) {
  const msg = form.querySelector('.msg');
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
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
  } catch (e) {
    msg.textContent = e.message;
    if (e.expired) await beginLogin(sys);
  } finally {
    btn.disabled = false;
  }
}

// ---------- gắn sự kiện ----------
function bind() {
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
  }
  $('#basket-actions').addEventListener('click', (e) => {
    if (e.target.id === 'dl-zip') downloadBasket(true);
    if (e.target.id === 'dl-each') downloadBasket(false);
    if (e.target.id === 'dl-clear') {
      state.basket.clear();
      $('#basket-count').textContent = 0;
      document.querySelectorAll('.pick').forEach((c) => (c.checked = false));
      renderBasket();
    }
  });

  $('#sheet-close').addEventListener('click', () => history.back());
  window.addEventListener('popstate', closeDetail);

  $('#ready-share').addEventListener('click', async () => {
    const files = pending.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
    try {
      await navigator.share({ files });
      $('#ready').hidden = true;
    } catch (e) {
      if (e.name !== 'AbortError') toast('Không mở được bảng chia sẻ, hãy dùng "Tải xuống"');
    }
  });
  $('#ready-save').addEventListener('click', () => {
    saveViaAnchor(pending);
    $('#ready').hidden = true;
  });
  $('#ready-close').addEventListener('click', () => ($('#ready').hidden = true));

  $('#accounts').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.login) beginLogin(t.dataset.login);
    if (t.dataset.logout) {
      auth.clear(t.dataset.logout);
      renderAccounts();
      renderStatus();
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
