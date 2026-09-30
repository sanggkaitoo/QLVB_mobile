// Adapter egov1.laocai.gov.vn (VNPT iWork → iOffice v3 qua egov-gateway). Gọi trực tiếp, CORS *.
// Chỉ dùng các API đọc; KHÔNG gọi click_xemden/clickxem_vanban để không đổi trạng thái "đã xem".
import { auth, AuthError, fmtDate, stripTags, toTime } from './store.js';

const SYS = 'egov1';
const GW = 'https://egov-gateway.laocai.gov.vn';
const IOFFICE_DOC_PATH = 'Vm01d2RFQXhNak09/Vanban/';

async function refresh(a) {
  if (!a?.refreshToken) return null;
  const q = new URLSearchParams({ refreshToken: a.refreshToken, domain: 'https://egov1.laocai.gov.vn' });
  try {
    const res = await fetch(`${GW}/iwork/Oauth/api/v1/RefreshToken?${q}`, {
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    const j = await res.json();
    if (j.code !== 'OK' || !j.value?.accessToken) return null;
    const exp = JSON.parse(atob(j.value.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
    const next = { ...a, accessToken: j.value.accessToken, refreshToken: j.value.refreshToken, expiresAt: exp * 1000 };
    auth.set(SYS, next);
    return next;
  } catch {
    return null;
  }
}

async function token() {
  const a = auth.valid(SYS) || (await refresh(auth.get(SYS)));
  if (!a) throw new AuthError(SYS);
  return a;
}

// Upstream database failures can arrive as HTTP 200 with a .NET stack trace.
// Preserve diagnostics for the console while showing a useful message in the UI.
function upstreamError(message, status) {
  const raw = String(message || '');
  const error = new Error(raw || `egov1 lỗi (${status})`);
  error.sys = SYS;
  if (/timeout.*(?:connection from the pool|pooled connections|max pool size)/i.test(raw)) {
    error.code = 'EGOV_DATABASE_BUSY';
    error.message = 'Máy chủ egov1 đang hết thời gian chờ kết nối cơ sở dữ liệu. Chưa thể lấy danh sách văn bản. Vui lòng thử lại sau ít phút.';
    error.cause = new Error(raw);
  } else if (/System\.[\w.]+Exception|OracleException/i.test(raw)) {
    error.code = 'EGOV_SERVER_ERROR';
    error.message = 'Máy chủ egov1 gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.';
    error.cause = new Error(raw);
  }
  return error;
}

async function api(path) {
  let a = await token();
  let res = await fetch(`${GW}/ioffice${path}`, { headers: { authorization: `Bearer ${a.accessToken}` } });
  if (res.status === 401) {
    a = await refresh(a);
    if (!a) throw new AuthError(SYS);
    res = await fetch(`${GW}/ioffice${path}`, { headers: { authorization: `Bearer ${a.accessToken}` } });
  }
  if (res.status === 401) throw new AuthError(SYS);
  const j = await res.json();
  if (j.code !== 'OK') throw upstreamError(j.message, res.status);
  return j.value;
}

// Tài khoản có quyền văn thư (IOFFICE_VB_XULYDEN) thì tra trong sổ văn bản đến của đơn vị,
// ngược lại tra văn bản đến của cá nhân. dateCol = cột ngày để sắp xếp (theo bảng của web gốc).
function listPath(kind) {
  if (kind === 'di') return { path: '/Ajax/IworkHandler.ashx?type=xemdi', dateCol: 'ngaytao' };
  const perms = auth.get(SYS)?.user?.permissions || [];
  return perms.includes('IOFFICE_VB_XULYDEN')
    ? { path: '/Ajax/IworkVanThuHandler.ashx?type=xulyden&trangthai=2', dateCol: 'ngayden' }
    : { path: '/Ajax/IworkHandler.ashx?type=xemden&xem=-1&xuly=-1&t=-1&xlc=-1', dateCol: 'ngaynhan' };
}

const looksLikeCode = (q) => /\d+\s*\/\s*[\p{L}]/u.test(q);

async function fetchPage(kind, { q = '', page = 1, size = 20, sort = 'desc' }, mode) {
  const { path, dateCol } = listPath(kind);
  const p = new URLSearchParams({ page, length: size, skip: (page - 1) * size, archiveSearch: 'false', term: mode === 'term' ? q : '' });
  if (mode && mode !== 'term' && q) p.set(mode, q);
  p.set('order_col', dateCol);
  p.set('order_type', sort === 'asc' ? 'asc' : 'desc');
  return api(`${path}&${p}`);
}

export async function search(kind, opts) {
  const q = (opts.q || '').trim();
  // Ưu tiên tìm toàn cục (term); nếu rỗng thì thử tìm theo cột số hiệu / trích yếu như giao diện gốc.
  const modes = q ? ['term', looksLikeCode(q) ? 'column_sohieu' : 'column_trichyeu'] : ['term'];
  let v;
  for (const mode of modes) {
    v = await fetchPage(kind, opts, mode);
    if (Number(v.total) > 0) break;
  }
  return {
    total: Number(v.total) || 0,
    items: (v.data || []).map((r) => {
      const date = r.ngayden || r.ngaynhan || r.ngaybanhanh || r.ngaybh || r.ngaytao;
      return {
        sys: SYS,
        kind,
        id: r.macongvan,
        soHieu: stripTags(r.sohieu),
        trichYeu: stripTags(r.trichyeu),
        ngay: fmtDate(date),
        ts: toTime(date),
        coQuan: stripTags(r.cqbh || r.nguoiky || ''),
        loai: stripTags(r.loaivanban),
        fileCount: Array.isArray(r.files) ? r.files.length : undefined,
      };
    }),
  };
}

export async function detail(item) {
  const type = item.kind === 'di' ? 'xemdi_chitiet' : 'xemden_chitiet';
  const v = await api(`/Ajax/IworkHandler.ashx?type=${type}&documentId=${encodeURIComponent(item.id)}`);
  const clean = (s) => (s && s !== '{rỗng}' ? stripTags(s) : '');
  const fields = [
    ['Số ký hiệu', v.SoHieu],
    ['Trích yếu', v.TrichYeu],
    ['Loại văn bản', v.LoaiVanBan],
    ['Lĩnh vực', v.LinhVuc],
    ['Cơ quan ban hành', v.CoQuanBanHanh],
    ['Người ký', v.NguoiKy],
    ['Ngày ban hành', v.NgayBanHanh],
    ['Ngày đến', v.NgayDen],
    ['Số đến', v.SoDen],
    ['Độ khẩn', v.TenCapDo],
    ['Độ mật', v.DoMat],
    ['Nơi nhận', v.NoiNhan],
    ['Nguồn', v.NguonVanBan],
    ['Bút phê', v.ButPhe],
  ]
    .map(([k, val]) => [k, clean(val)])
    .filter(([, val]) => val);
  const files = (v.Attachments || []).map((f) => ({ id: f.Id, name: f.FileName || f.FilePath?.split('/').pop(), path: f.FilePath }));
  return { fields, files };
}

export async function download(file) {
  const a = await token();
  const t = encodeURIComponent(a.accessToken);
  const url = /^https?:\/\//.test(file.path)
    ? `${file.path}${file.path.includes('?') ? '&' : '?'}token=${t}`
    : `${GW}/ioffice/Ajax/IworkFileHandler.ashx?action=getfile&fileName=${IOFFICE_DOC_PATH}${file.path}&access_token=${t}`;
  const res = await fetch(url);
  if (res.status === 401) throw new AuthError(SYS);
  if (!res.ok) throw new Error(`Không tải được "${file.name}" (HTTP ${res.status})`);
  return res.blob();
}

// Read-only draft progress endpoints; shares the existing egov session and refresh.
export async function workGet(path) {
  if (!/^\/api\/works\/(?:v2\?|[a-f0-9-]+\?includeChildren=false&readContext=false$)/i.test(path)) throw new Error('API tiến độ không hợp lệ');
  let a = await token();
  const read = () => fetch(`${GW}/work${path}`, { headers: { authorization: `Bearer ${a.accessToken}` } });
  let res = await read();
  if (res.status === 401) {
    a = await refresh(a);
    if (!a) throw new AuthError(SYS);
    res = await read();
  }
  if (res.status === 401) throw new AuthError(SYS);
  if (res.status === 403) throw new Error('Tài khoản chưa có quyền xem văn bản trình này.');
  const j = await res.json().catch(() => { throw new Error('Máy chủ egov1 trả về dữ liệu tiến độ không hợp lệ.'); });
  if (!res.ok || (j.code && j.code !== 'OK')) throw upstreamError(j.message, res.status);
  return j.code === 'OK' ? j.value : j;
}
