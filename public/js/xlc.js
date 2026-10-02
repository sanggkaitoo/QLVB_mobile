// Xem XLC: văn bản đến (egov1) → hồ sơ công việc → người xử lý chính và toàn bộ tiến trình.
// Chỉ đọc: getByDocId + chi tiết hồ sơ (/api/works/{id}), không gọi API đánh dấu "đã xem".
import { auth, AuthError } from './store.js';
import * as egov1 from './egov1.js';
import { workGet } from './egov1.js';
import { normalizeWork, dateTime, stageLabel, isReturn, stamp } from './egov-work.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const PAGE_SIZE = 20;

const state = { q: '', page: 1, total: 0, items: [], loaded: false, busy: false, error: '' };
let version = 0;

// Chuỗi người theo một vai trò, theo thứ tự được giao (cũ → mới), bỏ trùng liên tiếp.
function chain(raw, role, type) {
  const rows = list(raw.userApis)
    .filter((u) => u.followRoleCode === role && (!type || u.assignFollowType === type))
    .sort((a, b) => stamp(a.createAt) - stamp(b.createAt));
  const names = [];
  for (const u of rows) {
    const n = clean(u.fullName);
    if (n && names[names.length - 1] !== n) names.push(n);
  }
  return names;
}

// Trạng thái dễ hiểu từ profileStatus (luồng trình) + assignStatus (luồng giao việc).
function statusOf(raw) {
  const p = raw.profileStatus || '', a = raw.assignStatus || '';
  if (p === 'Finish' || a === 'Finish') return { label: 'Đã hoàn thành', tone: 'done' };
  if (isReturn(p)) return { label: stageLabel(p), tone: 'returned' };
  if (p && p !== 'Created' && p !== 'InProgress') return { label: stageLabel(p), tone: 'waiting' };
  if (a === 'Assign') return { label: 'Mới giao, chưa xử lý', tone: 'new' };
  if (a === 'Working' || p === 'InProgress') return { label: 'Đang xử lý', tone: 'working' };
  return { label: stageLabel(p) || a || 'Chưa rõ trạng thái', tone: 'working' };
}

export function summarize(raw) {
  const w = normalizeWork(raw, [], 'drafts');
  const status = statusOf(raw);
  const xlc = chain(raw, 'XLC', 'Process');
  const approvers = chain(raw, 'XLC', 'Approved');
  const support = [...new Set(chain(raw, 'PH'))];
  const done = status.tone === 'done';
  return {
    ...w,
    status,
    xlc,
    handler: xlc[xlc.length - 1] || '',
    approvers,
    support,
    assigner: clean(raw.userSender?.fullName) || chain(raw, null, 'Create')[0] || '',
    // Người đang giữ hồ sơ = người nhận lần luân chuyển gần nhất (transitions đã xếp mới nhất trước).
    holder: done ? '' : w.transitions[0]?.receiver || '',
    finishedAt: done ? raw.approvaledDate || w.feedbacks[0]?.date : null,
    // assignProfilePublishStatus không đáng tin (=1 cả khi chỉ xác nhận hoàn thành) → chỉ tin mã văn bản đi.
    published: !!raw.info?.sendDocId,
    sendDocId: raw.info?.sendDocId || null,
    kind: clean(raw.kindOfAssignName),
    code: clean(raw.profileCode),
  };
}

// Văn bản đi được phát hành từ hồ sơ (nếu có): lấy số ký hiệu qua API chi tiết văn bản đi.
async function outgoing(id) {
  try {
    const d = await egov1.detail({ kind: 'di', id });
    const f = Object.fromEntries(d.fields);
    return { symbol: f['Số ký hiệu'] || '', title: f['Trích yếu'] || '', date: f['Ngày ban hành'] || '', files: d.files.length };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return null;
  }
}

async function loadProfiles(doc) {
  const works = list(await workGet(`/api/works/getByDocId?docId=${encodeURIComponent(doc.id)}`));
  // Danh sách theo văn bản không có lịch sử luân chuyển → lấy chi tiết từng hồ sơ (song song).
  const details = await Promise.all(
    works.map(async (w) => {
      try {
        const raw = await workGet(`/api/works/${encodeURIComponent(w.id)}?includeChildren=false&readContext=false`);
        const s = summarize(raw?.id ? raw : w);
        if (s.sendDocId) s.outgoing = await outgoing(s.sendDocId);
        return s;
      } catch (e) {
        if (e instanceof AuthError) throw e;
        return { ...summarize(w), partial: e.message };
      }
    }),
  );
  return details.sort((a, b) => stamp(a.created) - stamp(b.created));
}

const people = (names, empty) => (names.length ? names.map(esc).join(' <span class="xlc-arrow">→</span> ') : esc(empty));

function profileMarkup(p, i, total) {
  const result = p.status.tone === 'done'
    ? p.published
      ? `Đã phát hành văn bản đi${p.outgoing?.symbol ? ` <strong>${esc(p.outgoing.symbol)}</strong>${p.outgoing.date ? ` ngày ${esc(p.outgoing.date)}` : ''}` : ''}`
      : 'Hoàn thành, không phát hành văn bản (chỉ chuyển duyệt)'
    : '';
  return `<section class="xlc-profile glass">
    <div class="work-card-head"><span class="xlc-status ${p.status.tone}">${esc(p.status.label)}</span>${total > 1 ? `<span class="hint">Hồ sơ ${i + 1}/${total}</span>` : ''}</div>
    <h3>${esc(p.title)}</h3>
    ${p.partial ? `<p class="work-error" role="alert">Chưa tải được đầy đủ hồ sơ: ${esc(p.partial)}</p>` : ''}
    <dl class="fields">
      <dt>Xử lý chính</dt><dd><strong>${esc(p.handler || 'Chưa giao')}</strong></dd>
      ${p.xlc.length > 1 ? `<dt>Chuỗi giao XLC</dt><dd>${people(p.xlc, '')}</dd>` : ''}
      ${p.holder ? `<dt>Đang ở</dt><dd>${esc(p.holder)}</dd>` : ''}
      ${p.approvers.length ? `<dt>Trình duyệt</dt><dd>${people(p.approvers, '')}</dd>` : ''}
      ${p.support.length ? `<dt>Phối hợp</dt><dd>${esc(p.support.join(', '))}</dd>` : ''}
      <dt>Người giao</dt><dd>${esc(p.assigner || 'Chưa rõ')}</dd>
      <dt>Ngày tạo</dt><dd>${esc(dateTime(p.created))}</dd>
      ${p.deadline ? `<dt>Hạn xử lý</dt><dd>${esc(dateTime(p.deadline))}</dd>` : ''}
      ${p.finishedAt ? `<dt>Hoàn thành</dt><dd>${esc(dateTime(p.finishedAt))}</dd>` : ''}
      ${result ? `<dt>Kết quả</dt><dd>${result}</dd>` : ''}
      ${p.code ? `<dt>Mã hồ sơ</dt><dd>${esc(p.code)}</dd>` : ''}
    </dl>
    <h4>Tiến trình xử lý</h4><p class="hint">Mới nhất trước · Nội dung từ egov1</p>
    ${p.feedbacks.length
      ? `<ol class="work-timeline">${p.feedbacks.map((f) => `<li class="${isReturn(f.status) ? 'returned' : ''}"><div class="timeline-top"><strong>${esc(f.person)}</strong>${f.status ? `<span>${esc(stageLabel(f.status))}</span>` : ''}</div><time>${esc(dateTime(f.date))}</time><p>${esc(f.content || 'Không có nội dung')}</p>${f.files.length ? `<small>Tệp: ${esc(f.files.join(' · '))}</small>` : ''}</li>`).join('')}</ol>`
      : '<p class="hint">Chưa có tiến trình xử lý.</p>'}
    <details class="work-routes"><summary>Lịch sử luân chuyển (${p.transitions.length})</summary>${p.transitions.length
      ? `<ol class="work-timeline">${p.transitions.map((t) => `<li><strong>${esc(t.sender || 'Chưa rõ người gửi')} → ${esc(t.receiver || 'Chưa rõ người nhận')}</strong><time>${esc(dateTime(t.date))}</time><p>${esc(t.content)}</p></li>`).join('')}</ol>`
      : '<p class="hint">Chưa có dữ liệu luân chuyển.</p>'}</details>
    ${p.files.length ? `<details class="work-routes"><summary>Tệp trong hồ sơ (${p.files.length})</summary><ul class="work-file-names">${p.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

export function sheetMarkup(doc, profiles) {
  return `<div class="detail-intro"><p class="eyebrow">VĂN BẢN ĐẾN · HỒ SƠ CÔNG VIỆC</p><h2>${esc(doc.soHieu || 'Văn bản không số')}</h2><p>${esc(doc.trichYeu)}</p>
    <p class="hint">${esc([doc.coQuan, doc.ngay && `Ngày đến ${doc.ngay}`].filter(Boolean).join(' · '))}</p></div>
    ${profiles.length
      ? `<h2>Hồ sơ công việc (${profiles.length})</h2>${profiles.map((p, i) => profileMarkup(p, i, profiles.length)).join('')}`
      : `<div class="empty-state"><span class="empty-icon">${icon('progress')}</span><h3>Chưa có hồ sơ công việc</h3><p>Văn bản này chưa được tạo hồ sơ để phân người xử lý trên egov1.</p></div>`}`;
}

function docCard(d) {
  return `<article class="work-card glass xlc-doc">
    <div class="work-card-head"><span class="badge egov1">${esc(d.soHieu || 'Không số')}</span><span class="hint">${esc(d.ngay)}</span></div>
    <h3>${esc(d.trichYeu || 'Chưa có trích yếu')}</h3>
    <p class="hint">${esc([d.loai, d.coQuan].filter(Boolean).join(' · '))}</p>
    <div class="work-card-foot"><span></span><button type="button" class="btn compact" data-xlc-doc="${esc(d.id)}">Xem hồ sơ${icon('arrow')}</button></div>
  </article>`;
}

export function initXlc({ openSheet, handleError }) {
  const blank = (title, text, action = '') =>
    `<div class="empty-state"><span class="empty-icon">${icon('progress')}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;

  function render() {
    const logged = !!auth.get('egov1')?.accessToken;
    const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $('#xlc-summary').textContent = state.busy
      ? 'Đang tải văn bản đến…'
      : state.loaded
        ? `${state.total.toLocaleString('vi-VN')} văn bản${state.q ? ` khớp “${state.q}”` : ''}`
        : '';
    $('#xlc-results').setAttribute('aria-busy', String(state.busy));
    if (!logged) $('#xlc-results').innerHTML = blank('Kết nối egov1 để xem hồ sơ', 'Dùng tài khoản egov1 trong tab Tài khoản.', '<button class="btn primary" data-go-account>Đăng nhập egov1</button>');
    else if (state.busy) $('#xlc-results').innerHTML = '<div class="loading"><p class="loading-label"><span class="spinner" aria-hidden="true"></span>Đang đọc văn bản đến từ egov1…</p></div>';
    else if (state.error) $('#xlc-results').innerHTML = `<p class="work-error" role="alert">${esc(state.error)}</p>`;
    else if (state.loaded && !state.items.length) $('#xlc-results').innerHTML = blank('Không có văn bản phù hợp', 'Thử từ khoá khác (số ký hiệu hoặc trích yếu).');
    else $('#xlc-results').innerHTML = state.items.map(docCard).join('');
    const pager = $('#xlc-pagination');
    pager.hidden = !state.loaded || state.busy || pages <= 1;
    pager.innerHTML = `<button class="btn page-button" type="button" data-xlc-page="prev" aria-label="Trang trước" ${state.page <= 1 ? 'disabled' : ''}>${icon('back')}</button><span class="page-position">Trang ${state.page} / ${pages}</span><button class="btn page-button" type="button" data-xlc-page="next" aria-label="Trang sau" ${state.page >= pages ? 'disabled' : ''}>${icon('arrow')}</button>`;
  }

  async function load(page = 1) {
    if (!auth.get('egov1')?.accessToken) return render();
    const current = ++version;
    Object.assign(state, { busy: true, error: '', page });
    render();
    try {
      const r = await egov1.search('den', { q: state.q, page, size: PAGE_SIZE, sort: 'desc' });
      if (current !== version) return;
      Object.assign(state, { items: r.items, total: r.total, loaded: true });
    } catch (e) {
      if (current !== version) return;
      Object.assign(state, { items: [], total: 0, loaded: true, error: handleError(e) });
    } finally {
      if (current === version) { state.busy = false; render(); }
    }
  }

  $('#xlc-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = $('#xlc-q').value.trim();
    $('#xlc-q').blur();
    load(1);
  });
  $('#view-xlc').addEventListener('click', (e) => {
    const pager = e.target.closest('[data-xlc-page]');
    if (pager && !pager.disabled) {
      load(state.page + (pager.dataset.xlcPage === 'next' ? 1 : -1));
      $('#xlc-summary').scrollIntoView({ block: 'start' });
    }
    const b = e.target.closest('[data-xlc-doc]');
    if (b) {
      const doc = state.items.find((d) => d.id === b.dataset.xlcDoc);
      if (doc) openSheet(doc, async () => sheetMarkup(doc, await loadProfiles(doc)), '', 'Hồ sơ công việc');
    }
  });

  function reset() {
    version++;
    Object.assign(state, { q: '', page: 1, total: 0, items: [], loaded: false, busy: false, error: '' });
    $('#xlc-q').value = '';
    render();
  }

  render();
  return {
    enter() { if (!state.loaded && !state.busy) load(1); else render(); },
    reset,
  };
}
