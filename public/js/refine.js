// Lọc nhiều trường trong kết quả tra cứu (egov1 + csdlvb), kết hợp cùng lúc (AND).
// Mỗi trường gộp các tên trường khác nhau của 2 hệ thống để một điều kiện áp dụng được cho cả hai nguồn.
const clean = (v) => {
  const s = String(v ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return s === '{rỗng}' ? '' : s;
};
export const fold = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Lấy giá trị đầu tiên có nội dung trong các trường gốc (egov1 trước, csdlvb sau).
const pick = (...keys) => (r) => {
  for (const k of keys) {
    const v = clean(r?.[k]);
    if (v) return v;
  }
  return '';
};

// type: text = chứa chữ; select = chọn 1 giá trị; date = khoảng ngày. kinds: chỉ hiện cho văn bản đến/đi.
export const FIELDS = [
  { id: 'soHieu', label: 'Số ký hiệu', type: 'text', get: (r, it) => it.soHieu },
  { id: 'trichYeu', label: 'Trích yếu', type: 'text', get: (r, it) => it.trichYeu },
  { id: 'ngay', label: 'Ngày', type: 'date', get: (r, it) => it.ts },
  { id: 'loai', label: 'Loại văn bản', type: 'select', get: pick('loaivanban', 'dOCUMENT_TYPE_NAME') },
  { id: 'coQuan', label: 'Cơ quan ban hành', type: 'select', kinds: ['den'], get: pick('cqbh', 'pUBLISH_AGENT_INSIDE_NAME', 'pUBLISH_AGENT_OUTSIDE_NAME') },
  { id: 'donViSoan', label: 'Đơn vị soạn thảo', type: 'select', kinds: ['di'], get: pick('cREATE_DEPT_NAME') },
  { id: 'nguoiSoan', label: 'Người soạn', type: 'select', kinds: ['di'], get: pick('nguoisoan', 'cREATOR_NAME') },
  { id: 'nguoiKy', label: 'Người ký', type: 'select', get: pick('nguoiky', 'sIGNER_NAME', 'sIGNER') },
  { id: 'nguoiDuyet', label: 'Người duyệt', type: 'select', get: pick('lanhdaoduyet', 'nguoikiemduyet') },
  { id: 'xuLyChinh', label: 'Người xử lý chính', type: 'select', kinds: ['den'], get: pick('nguoixulychinh') },
  { id: 'nguoiNhan', label: 'Người nhận', type: 'select', kinds: ['den'], get: pick('rECEIVERS') },
  { id: 'linhVuc', label: 'Lĩnh vực', type: 'select', get: pick('tenlinhvuc') },
  { id: 'doKhan', label: 'Độ khẩn', type: 'select', get: pick('capdo', 'eMERGENCY_TYPE_NAME') },
  { id: 'doMat', label: 'Độ mật', type: 'select', get: pick('domat', 'mat', 'sECURITY_TYPE_NAME') },
  { id: 'soVanBan', label: 'Sổ văn bản', type: 'select', get: pick('sovanban', 'loaiso', 'bOOK_NAME') },
  { id: 'hinhThuc', label: 'Hình thức', type: 'select', get: pick('nguonvanban', 'rECEIVE_TYPE_NAME', 'sEND_TYPE_NAME') },
  { id: 'noiNhan', label: 'Nơi nhận', type: 'text', get: pick('noinhan', 'deptNames') },
];
const byId = Object.fromEntries(FIELDS.map((f) => [f.id, f]));
const valueOf = (it, f) => f.get(it.raw || {}, it);

const isSet = (f, v) => (f.type === 'date' ? !!(v?.from || v?.to) : !!v);
export const activeCount = (filters) => Object.entries(filters).filter(([id, v]) => byId[id] && isSet(byId[id], v)).length;

function matchField(it, f, v) {
  const val = valueOf(it, f);
  if (f.type === 'date') {
    if (!Number.isFinite(val)) return false;
    if (v.from && val < new Date(`${v.from}T00:00:00`).getTime()) return false;
    if (v.to && val > new Date(`${v.to}T23:59:59`).getTime()) return false;
    return true;
  }
  if (!val) return false;
  if (f.type === 'select') return fold(val) === v;
  const hay = fold(val);
  return fold(v).split(' ').filter(Boolean).every((w) => hay.includes(w));
}

// Ô lọc nhanh: tìm trên mọi trường chữ. Bộ lọc trường: phải khớp tất cả (trừ trường `except` khi đếm lựa chọn).
export function matches(it, q, filters, except = null) {
  const words = fold(q).split(' ').filter(Boolean);
  if (words.length) {
    const hay = fold([it.soHieu, it.trichYeu, it.coQuan, it.loai, it.soanThao, it.nguoiKy, ...FIELDS.filter((f) => f.type !== 'date').map((f) => valueOf(it, f))].join(' '));
    if (!words.every((w) => hay.includes(w))) return false;
  }
  for (const [id, v] of Object.entries(filters)) {
    const f = byId[id];
    if (id === except || !f || !isSet(f, v)) continue;
    if (!matchField(it, f, v)) return false;
  }
  return true;
}

// Chỉ hiện trường có dữ liệu trong kết quả (và đúng loại văn bản); ghi chú nếu chỉ một nguồn có trường đó.
function available(pool, kind, labels) {
  return FIELDS.filter((f) => !f.kinds || f.kinds.includes(kind)).flatMap((f) => {
    const sys = [...new Set(pool.filter((it) => { const v = valueOf(it, f); return f.type === 'date' ? Number.isFinite(v) : !!v; }).map((it) => it.sys))];
    return sys.length ? [{ f, only: sys.length === 1 && new Set(pool.map((it) => it.sys)).size > 1 ? labels[sys[0]] : '' }] : [];
  });
}

// Lựa chọn của một trường, kèm số văn bản khớp các bộ lọc còn lại (đếm theo bộ lọc hiện tại).
function options(pool, f, q, filters) {
  const map = new Map();
  for (const it of pool) {
    const val = valueOf(it, f);
    if (!val || !matches(it, q, filters, f.id)) continue;
    const key = fold(val);
    const o = map.get(key) || { label: val.charAt(0).toUpperCase() + val.slice(1), n: 0 };
    o.n++;
    map.set(key, o);
  }
  // Lựa chọn đang chọn nhưng không còn văn bản khớp: vẫn giữ trong danh sách, lấy tên gốc (có dấu) từ toàn bộ kết quả.
  const selected = filters[f.id];
  if (selected && !map.has(selected)) {
    const original = pool.map((it) => valueOf(it, f)).find((v) => v && fold(v) === selected) || selected;
    map.set(selected, { label: original.charAt(0).toUpperCase() + original.slice(1), n: 0 });
  }
  return [...map].sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label, 'vi'));
}

export function selectOptions(pool, id, q, filters) {
  const f = byId[id];
  return `<option value="">Tất cả</option>${options(pool, f, q, filters).map(([k, o]) => `<option value="${esc(k)}" ${filters[id] === k ? 'selected' : ''}>${esc(o.label)} (${o.n})</option>`).join('')}`;
}

export function panelMarkup(pool, kind, q, filters, labels) {
  const rows = available(pool, kind, labels).map(({ f, only }) => {
    const v = filters[f.id];
    const control = f.type === 'select'
      ? `<select data-rf="${f.id}">${selectOptions(pool, f.id, q, filters)}</select>`
      : f.type === 'date'
        ? `<span class="rf-dates"><input type="date" data-rf="${f.id}" data-part="from" value="${esc(v?.from || '')}" aria-label="${f.label} từ ngày"><span>–</span><input type="date" data-rf="${f.id}" data-part="to" value="${esc(v?.to || '')}" aria-label="${f.label} đến ngày"></span>`
        : `<input type="search" data-rf="${f.id}" value="${esc(v || '')}" placeholder="Chứa…" autocomplete="off">`;
    return `<label class="rf-field ${isSet(f, v) ? 'on' : ''}"><span class="rf-label">${f.label}${only ? ` <small>(${esc(only)})</small>` : ''}</span>${control}</label>`;
  });
  return rows.length
    ? `<div class="rf-grid">${rows.join('')}</div><div class="actions"><button type="button" class="btn" data-rf-clear>Xoá tất cả bộ lọc</button></div>`
    : '<p class="hint">Chưa có trường nào để lọc.</p>';
}

// Các điều kiện đang áp dụng, hiện dạng chip để xoá nhanh khi bảng lọc đang đóng.
export function chipsMarkup(pool, filters) {
  return Object.entries(filters).filter(([id, v]) => byId[id] && isSet(byId[id], v)).map(([id, v]) => {
    const f = byId[id];
    let text = v;
    if (f.type === 'select') text = options(pool, f, '', {}).find(([k]) => k === v)?.[1].label || v;
    if (f.type === 'date') text = [v.from && `từ ${v.from.split('-').reverse().join('/')}`, v.to && `đến ${v.to.split('-').reverse().join('/')}`].filter(Boolean).join(' ');
    return `<button type="button" class="rf-chip" data-rf-remove="${id}" aria-label="Bỏ lọc ${esc(f.label)}">${esc(f.label)}: ${esc(text)} <span aria-hidden="true">✕</span></button>`;
  }).join('');
}
