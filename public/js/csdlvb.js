// Adapter csdlvb.laocai.gov.vn (Data360X). Gọi trực tiếp csdlvb-backend, CORS *.
import { auth, AuthError, fmtDate, stripTags, toTime } from './store.js';

const SYS = 'csdlvb';
const API = 'https://csdlvb-backend.laocai.gov.vn/api/';
const KINDS = {
  den: { alias: 'documentreveice', idField: 'dOCUMENT_RECEIVE_ID', attachKey: 'documentReveiceId' },
  di: { alias: 'documentpublic', idField: 'dOCUMENT_PUBLISH_ID', attachKey: 'DocumentPublishId' },
};

function token() {
  const a = auth.valid(SYS);
  if (!a) throw new AuthError(SYS);
  return a.accessToken;
}

async function call(path, body) {
  const init = { headers: { authorization: `Bearer ${token()}` } };
  if (body !== undefined) {
    init.method = 'POST';
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, init);
  if (res.status === 401) throw new AuthError(SYS);
  if (!res.ok) throw new Error(`csdlvb lỗi (HTTP ${res.status})`);
  return res.json();
}

// Ngày gửi dạng ISO như giao diện gốc (dịch theo múi giờ để giữ đúng ngày).
const isoDay = (d) => (d ? `${d}T00:00:00.000Z` : undefined);

export async function search(kind, { q = '', page = 1, size = 20, from, to, sort = 'desc' }) {
  const k = KINDS[kind];
  // sortOrder theo kiểu PrimeReact của web gốc: 1 = tăng dần, -1 = giảm dần.
  const body = { pageSize: size, pageIndex: page, isPaging: true, sortOrder: sort === 'asc' ? 1 : -1, sortField: 'pUBLISH_DATE' };
  if (q.trim()) body.KeyWord = q.trim();
  if (from) body.publish_date_from = isoDay(from);
  if (to) body.publish_date_to = isoDay(to);
  const j = await call(`${k.alias}/get-all`, body);
  return {
    total: Number(j.totalRecords) || 0,
    items: (j.items || []).map((r) => ({
      sys: SYS,
      kind,
      id: r[k.idField],
      soHieu: stripTags(r.dOCUMENT_CODE),
      trichYeu: stripTags(r.aBSTRACT),
      ngay: fmtDate(r.pUBLISH_DATE || r.dATE_PUBLISH || r.ngayDen),
      ts: toTime(r.pUBLISH_DATE || r.dATE_PUBLISH || r.ngayDen),
      coQuan: stripTags(r.pUBLISH_AGENT_INSIDE_NAME || r.pUBLISH_AGENT_OUTSIDE_NAME || r.cREATE_DEPT_NAME || r.officE_NAME || ''),
      loai: stripTags(r.dOCUMENT_TYPE_NAME),
    })),
  };
}

export async function detail(item) {
  const k = KINDS[item.kind];
  const [v, att] = await Promise.all([
    call(`${k.alias}/get-by-id?Id=${encodeURIComponent(item.id)}`),
    call(`${k.alias}/get-attachs-by-id`, { pageSize: 100, pageIndex: 1, isPaging: true, [k.attachKey]: item.id }),
  ]);
  const fields = [
    ['Số ký hiệu', v.dOCUMENT_CODE],
    ['Trích yếu', v.aBSTRACT],
    ['Loại văn bản', v.dOCUMENT_TYPE_NAME],
    ['Cơ quan ban hành', v.pUBLISH_AGENT_INSIDE_NAME || v.pUBLISH_AGENT_OUTSIDE_NAME || v.cREATE_DEPT_NAME],
    ['Người ký', v.sIGNER || v.sIGNER_NAME],
    ['Ngày ban hành', fmtDate(v.pUBLISH_DATE || v.dATE_PUBLISH)],
    ['Ngày đến', fmtDate(v.ngayDen)],
    ['Sổ văn bản', v.bOOK_NAME],
    ['Số đến/đi', v.bOOK_NUMBER],
    ['Hình thức nhận', v.rECEIVE_TYPE_NAME],
    ['Người nhận', v.rECEIVERS],
  ]
    .map(([key, val]) => [key, stripTags(val)])
    .filter(([, val]) => val && val !== '0');
  const files = (att.items || []).map((f) => ({ id: f.attacH_ID, name: f.attacH_NAME, isOld: !!f.isOld }));
  return { fields, files };
}

export async function download(file, item) {
  const k = KINDS[item.kind];
  const url = `${API}${k.alias}/get-attach-by-id?attachId=${file.id}&token=${encodeURIComponent(token())}&isOld=${file.isOld}`;
  const res = await fetch(url);
  if (res.status === 401) throw new AuthError(SYS);
  if (!res.ok) throw new Error(`Không tải được "${file.name}" (HTTP ${res.status})`);
  return res.blob();
}
