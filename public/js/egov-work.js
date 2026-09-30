import { workGet } from './egov1.js';
import { AuthError, stripTags } from './store.js';
export const GROUPS = { sendDraft: 'Chờ xử lý', doing: 'Đã xử lý', waitingToPublished: 'Chờ phát hành' };
export const PENDING_GROUPS = { waiting: 'Chờ xử lý' };
export const groupsFor = catalog => catalog === 'pending' ? PENDING_GROUPS : GROUPS;
const stages = {
  Created: 'Khởi tạo', CancelSend: 'Đã hủy trình', InProgress: 'Đang thực hiện',
  AwaitingApproval: 'Chờ duyệt', AwaitingToSign: 'Chờ ký', AwaitLeaderApproval: 'Chờ thường trực duyệt',
  RefuseCensorship: 'Trả lại kiểm duyệt', RefuseToSign: 'Trả lại ký duyệt',
  RefuseCensorship2: 'Trả lại kiểm duyệt', RefuseToSign2: 'Trả lại ký duyệt', RefuseToRelease: 'Trả lại phát hành',
  AuditorRefuse: 'Pháp chế trả lại', LeaderRefuse: 'Thường trực trả lại',
  SendAuditor: 'Chờ pháp chế', AuditorApproval: 'Pháp chế đã duyệt',
  Censored: 'Đã kiểm duyệt', LeaderApproved: 'Thường trực đã duyệt',
  Finish: 'Đã thực hiện', Close: 'Đã đóng', Delete: 'Đã xóa',
  CloseProfile: 'Đã đóng hồ sơ', CloseAndSendDocument: 'Đã soạn thảo công văn đi',
};
export const isReturn = status => /^(Refuse|AuditorRefuse$|LeaderRefuse$)/.test(status || '');
export const stageLabel = status => stages[status] || (status ? `Trạng thái: ${status}` : 'Chưa có trạng thái trình');
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
// eGov ISO values without an offset are local Vietnam time, independent of device timezone.
export const stamp = value => {
  if (!value) return 0;
  const s = String(value);
  const d = new Date(/^\d{4}-\d{2}-\d{2}T/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? `${s}+07:00` : s);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
};
export const dateTime = value => stamp(value) ? new Date(stamp(value)).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Chưa có thời gian';
const newest = (rows, date) => [...rows].sort((a,b) => stamp(b[date]) - stamp(a[date]));
export function normalizeWork(raw, groups = [], catalog = 'drafts') {
  const people = new Map(list(raw.userApis).map(p => [p.id, stripTags(p.fullName)]));
  for (const f of list(raw.feedbacks)) if (f.userId && f.fullName) people.set(f.userId, stripTags(f.fullName));
  const feedbacks = newest(list(raw.feedbacks), 'createAt').map(f => ({
    id: f.id, content: stripTags(f.content), person: stripTags(f.fullName) || people.get(f.userId) || 'Chưa rõ người xử lý',
    status: f.profileStatus || '', date: f.createAt,
    files: list(f.attachments).map(a => stripTags(a.fileName || a.name)).filter(Boolean),
  }));
  const transitions = newest(list(raw.assignTransitions), 'insertDate').map(t => ({
    sender: stripTags(t.senderName) || people.get(t.senderId) || '',
    receiver: stripTags(t.receiveName) || people.get(t.receiveId) || '',
    content: stripTags(t.content), type: Number(t.followType), date: t.insertDate, receiveId: t.receiveId,
  }));
  const status = raw.profileStatus || '';
  let returned = isReturn(status);
  const workflow = feedbacks.filter(f => f.status);
  const returns = workflow.filter(f => isReturn(f.status));
  const submission = workflow.find(f => ['AwaitingApproval','AwaitingToSign','AwaitLeaderApproval','SendAuditor'].includes(f.status));
  // A return replaces the receiver: leaderApprove can still contain the previous approver.
  const types = returned ? [9] : status === 'AwaitingApproval' ? [3] : status === 'AwaitingToSign' ? [4] : [];
  const route = types.length ? transitions.find(t => types.includes(t.type)) : null;
  const latestStep = workflow.find(f => f.status === status);
  let receiver = route?.receiver || '';
  if (!receiver && returned) receiver = stripTags(latestStep?.content.match(/^Chuyển lại cho\s+([^,]+)/i)?.[1]);
  if (!receiver && status === 'AwaitingApproval') receiver = stripTags(raw.leaderApproveFullName || raw.leaderApprove);
  if (!receiver && status === 'AwaitingToSign') receiver = stripTags(raw.leaderSignFullName || raw.leaderSign);
  if (!receiver && status === 'Created') receiver = people.get(raw.createdUserId) || '';
  const groupList = [...new Set(groups)];
  const pending = catalog === 'pending';
  const primary = newest(list(raw.userApis).filter(p => ['Process','Refuse'].includes(p.assignFollowType) && p.followRoleCode === 'XLC' && p.status !== 0), 'createAt')[0];
  const assignment = pending ? transitions.find(t => [1,9].includes(t.type) && (!primary || t.receiveId === primary.id)) : null;
  if (pending) {
    receiver = assignment?.receiver || stripTags(primary?.fullName);
    // profileStatus may retain an earlier refusal after a newer reassignment.
    returned = isReturn(status) && (assignment ? assignment.type === 9 : true);
  }
  const sender = stripTags(raw.userSender?.fullName) || people.get(raw.userSenderId || raw.createdUserId) || '';
  const monitors = [...new Set(list(raw.userMonitors).map(p => stripTags(p.fullName)).filter(Boolean))];
  const documents = list(raw.documentApis).map(d => ({ id:d.id, symbol:stripTags(d.symbol), title:stripTags(d.abridgment || d.content), issuer:stripTags(d.documentSentCompany || d.publishBy), published:d.publishTime, files:list(d.attachments).map(f => stripTags(f.fileName)).filter(Boolean) }));
  const linkedFiles = list(raw.documentApis).flatMap(d => list(d.attachments));
  const uniqueFiles = new Map([...list(raw.attachmentApis), ...(pending ? linkedFiles : [])].map(f => [f.id || f.filePath || f.fileName, stripTags(f.fileName)]));
  const stage = pending ? (returned ? stageLabel(status) : groupList.includes('waiting') ? 'Chờ xử lý' : 'Trạng thái xử lý đã thay đổi') : groupList.includes('waitingToPublished') && !returned ? 'Chờ phát hành' : stageLabel(status);
  return {
    id: String(raw.id), title: stripTags(raw.content) || 'Chưa có trích yếu', status, stage, returned,
    catalog, groups: groupList, receiver, sender, monitors, assignment, documents, feedbacks, workflow, returns, transitions, submission,
    updated: pending && stamp(assignment?.date) > stamp(raw.workingDate) ? assignment.date : raw.workingDate || workflow[0]?.date || raw.createAt, created: raw.createAt, deadline: raw.deadLineDate,
    mission: stripTags(raw.info?.missionContent || raw.description),
    files: [...uniqueFiles.values()].filter(Boolean),
  };
}
export async function loadAll(onProgress = () => {}, catalog = 'drafts') {
  const pending = catalog === 'pending';
  const items = new Map(), counts = {}, errors = [];
  // Use the native page length. Exhaust every page; never equate page 1 with the whole list.
  const size = 10;
  for (const group of Object.keys(groupsFor(catalog))) {
    let page = 1, total = null, loaded = 0;
    const seen = new Set();
    try {
      do {
        const q = new URLSearchParams({ page, length:size, skip:(page-1)*size, term:'', archiveSearch:'false', type:group, isLoading:'true', defer:'true' });
        if (!pending) { q.set('WorkCreateType','1'); q.set('currentType',group); }
        const response = await workGet(`/api/works/${pending ? 'v1' : 'v2'}?${q}`);
        if (!response || !Array.isArray(response.data) || !Number.isFinite(Number(response.total)) || Number(response.total) < 0) throw new Error('Dữ liệu danh sách tiến độ không hợp lệ.');
        total = Number(response.total);
        let added = 0;
        for (const raw of response.data) {
          if (!raw?.id) continue;
          if (!seen.has(raw.id)) { seen.add(raw.id); loaded++; added++; }
          const prior = items.get(raw.id);
          const groups = [...(prior?.groups || []), group];
          const data = prior && stamp(prior.raw.workingDate) > stamp(raw.workingDate) ? prior.raw : raw;
          items.set(raw.id, { raw:data, groups:[...new Set(groups)] });
        }
        onProgress({ group, loaded, total });
        if (loaded < total && !added) throw new Error('egov1 chưa trả đủ danh sách. Hãy cập nhật lại để tải phần còn thiếu.');
        page++;
      } while (loaded < total);
      counts[group] = { loaded, total, complete:true };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      counts[group] = { loaded, total, complete:false };
      errors.push({ group, message:error.message });
    }
  }
  return { items:[...items.values()].map(v => normalizeWork(v.raw,v.groups,catalog)).sort((a,b) => stamp(b.updated)-stamp(a.updated)), counts, errors };
}
export async function detail(item) {
  const raw = await workGet(`/api/works/${encodeURIComponent(item.id)}?includeChildren=false&readContext=false`);
  if (!raw?.id) throw new Error('Chưa lấy được chi tiết tiến độ.');
  // Group membership is the list snapshot; a refreshed status comes from detail.
  const fresh = normalizeWork(raw, item.groups, item.catalog);
  if (item.catalog === 'pending' && raw.isProcessed === true) {
    fresh.groups = []; fresh.stage = 'Bạn đã xử lý';
  }
  if (fresh.status !== item.status && fresh.groups.includes('waitingToPublished')) fresh.stage = stageLabel(fresh.status);
  return fresh;
}
