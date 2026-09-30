import { auth, AuthError } from './store.js';
import * as work from './egov-work.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const sizes = [5,10,20,50,100];
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d');
const saved = Number(localStorage.getItem('qlvb.work.pageSize'));
const state = { catalog:'drafts', items:[], counts:{}, errors:[], loaded:false, busy:false, group:'all', q:'', page:1, size:sizes.includes(saved)?saved:20, at:null };
let version = 0, sessionToken = null;
const filtersFor = () => state.catalog === 'pending' ? { all:'Tất cả', returned:'Đang trả lại' } : { all:'Tất cả', ...work.GROUPS, returned:'Đang trả lại' };
const groupLabel = (it,g) => work.groupsFor(it.catalog)[g] || g;
const documentMarkup = it => it.documents?.length ? `<div class="work-documents">${it.documents.map(d => `<div><strong>${esc(d.symbol || 'Văn bản không số')}</strong><span>${esc(d.issuer || 'Chưa có đơn vị phát hành')}</span></div>`).join('')}</div>` : '';
const pendingFields = it => `<dt>Người giao việc</dt><dd>${esc(it.sender || 'Chưa rõ người giao')}</dd><dt>Phụ trách</dt><dd>${esc(it.monitors?.join(' · ') || 'Chưa có thông tin')}</dd><dt>Hạn xử lý</dt><dd>${esc(it.deadline ? work.dateTime(it.deadline) : 'Chưa có hạn xử lý')}</dd>${it.assignment ? `<dt>Giao gần nhất</dt><dd>${esc(it.assignment.sender || 'Chưa rõ người giao')} → ${esc(it.assignment.receiver || 'Chưa rõ người nhận')}<br>${esc(work.dateTime(it.assignment.date))}</dd>` : ''}`;
const matchGroup = (item,group) => group === 'all' || (group === 'returned' ? item.returned : item.groups.includes(group));
const selected = () => state.items.filter(it => matchGroup(it,state.group) && (!state.q || fold([it.title,it.receiver,it.sender,it.monitors?.join(' '),it.documents?.map(d=>`${d.symbol} ${d.title} ${d.issuer}`).join(' '),it.stage,...it.feedbacks.map(f => `${f.person} ${f.content}`)].join(' ')).includes(fold(state.q))));
const blank = (title,text,action='') => `<div class="empty-state"><span class="empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-progress"/></svg></span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
const badge = it => `<span class="work-stage ${it.returned?'returned':''}">${esc(it.stage)}</span>`;
const returnsMarkup = it => it.returns.length ? `<section class="return-notes"><h2>Ý kiến trả lại (${it.returns.length})</h2>${it.returns.map(f => `<div class="return-note"><strong>${esc(f.person)}</strong><time>${esc(work.dateTime(f.date))}</time><p>${esc(f.content || 'Không có nội dung ý kiến.')}</p></div>`).join('')}</section>` : '';
export function detailMarkup(it) {
 const pending = it.catalog === 'pending';
 return `<div class="detail-intro"><p class="eyebrow">${pending ? 'VĂN BẢN CHỜ XỬ LÝ' : 'TIẾN ĐỘ VĂN BẢN TRÌNH'}</p><h2>${esc(it.title)}</h2>${badge(it)}</div>
 <dl class="fields"><dt>${pending?'Xử lý chính':it.returned?'Đã trả về':'Đang ở'}</dt><dd>${esc(it.receiver || 'Chưa xác định người nhận từ dữ liệu egov1')}</dd><dt>Cập nhật tiến độ</dt><dd>${esc(work.dateTime(it.updated))}</dd>
 ${pending ? pendingFields(it) : ''}
 ${!pending && it.submission?`<dt>Trình gần nhất</dt><dd>${esc(it.submission.person)} · ${esc(work.dateTime(it.submission.date))}<br>${esc(it.submission.content)}</dd>`:''}
 ${!pending && it.deadline?`<dt>Hạn xử lý</dt><dd>${esc(work.dateTime(it.deadline))}</dd>`:''}
 <dt>Nhóm tra cứu</dt><dd>${esc(it.groups.map(g => groupLabel(it,g)).join(' · '))}</dd></dl>
 ${pending && it.documents?.length ? `<h2>Văn bản liên kết (${it.documents.length})</h2><div class="work-linked-docs">${it.documents.map(d => `<div><strong>${esc(d.symbol || 'Không số')}</strong><p>${esc(d.title)}</p><span>${esc(d.issuer)} · ${esc(work.dateTime(d.published))}</span></div>`).join('')}</div>` : ''}
 ${it.mission?`<div class="info-banner"><p>${esc(it.mission)}</p></div>`:''}
 ${returnsMarkup(it)}
 <h2>Lịch sử xử lý</h2><p class="hint">Mới nhất trước · Nội dung từ egov1</p>
 ${it.feedbacks.length?`<ol class="work-timeline">${it.feedbacks.map(f => `<li class="${work.isReturn(f.status)?'returned':''}"><div class="timeline-top"><strong>${esc(f.person)}</strong>${f.status?`<span>${esc(work.stageLabel(f.status))}</span>`:''}</div><time>${esc(work.dateTime(f.date))}</time><p>${esc(f.content || 'Không có nội dung')}</p>${f.files.length?`<small>Tệp: ${esc(f.files.join(' · '))}</small>`:''}</li>`).join('')}</ol>`:'<p class="hint">Chưa có lịch sử phản hồi.</p>'}
 <details class="work-routes"><summary>Lịch sử luân chuyển (${it.transitions.length})</summary>${it.transitions.length?`<ol class="work-timeline">${it.transitions.map(t => `<li><strong>${esc(t.sender || 'Chưa rõ người gửi')} → ${esc(t.receiver || 'Chưa rõ người nhận')}</strong><time>${esc(work.dateTime(t.date))}</time><p>${esc(t.content)}</p></li>`).join('')}</ol>`:'<p class="hint">Chưa có dữ liệu luân chuyển.</p>'}</details>
 ${it.files.length?`<h2>${pending?'Tệp đính kèm':'Tệp dự thảo'} (${it.files.length})</h2><ul class="work-file-names">${it.files.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>`:''}
 ${pending ? '<p class="hint">Danh sách chờ xử lý theo tài khoản egov1 của bạn. Hạn trống nghĩa là egov1 chưa cung cấp hạn xử lý.</p>' : '<p class="hint">“Đã xử lý” là nhóm công việc của tài khoản. Trạng thái duyệt hiển thị ở phía trên.</p>'}`;
}
export function initProgress({ openSheet, handleError }) {
 function reset(catalog = state.catalog) {
  version++; sessionToken=null;
  Object.assign(state,{catalog,items:[],counts:{},errors:[],loaded:false,busy:false,at:null,page:1,q:'',group:'all'});
  $('#work-q').value=''; render();
 }
 function render() {
  const pending = state.catalog === 'pending';
  $('#progress-title').textContent = pending ? 'Văn bản chờ xử lý' : 'Nhiệm vụ';
  $('#work-eyebrow').textContent = pending ? 'VĂN BẢN ĐẾN · EGOV1' : 'VĂN BẢN TRÌNH · EGOV1';
  $('#work-intro').textContent = pending ? 'Theo dõi người giao, nhiệm vụ cần xử lý và hạn thực hiện.' : 'Theo dõi đang ở ai, đã chuyển đến đâu và ý kiến trả lại.';
  $('#work-list-title').textContent = pending ? 'Danh sách chờ xử lý' : 'Nhiệm vụ văn bản trình';
  $('#work-explanation').textContent = pending ? 'Danh sách theo mục Chờ xử lý của tài khoản egov1. Các lần giao và ý kiến được giữ trong lịch sử.' : '“Đã xử lý” vẫn có thể đang chờ lãnh đạo duyệt. Văn bản trả lại nằm trong Chờ xử lý.';
  document.querySelectorAll('[data-work-catalog]').forEach(b => { b.classList.toggle('on',b.dataset.workCatalog===state.catalog); b.setAttribute('aria-pressed',b.dataset.workCatalog===state.catalog); });
  const logged = !!auth.get('egov1')?.accessToken;
  const rows = selected(), start = (state.page-1)*state.size, pages = Math.max(1,Math.ceil(rows.length/state.size));
  state.page = Math.min(state.page,pages);
  $('#work-refresh').disabled = state.busy || !logged;
  $('#work-size').value = state.size;
  $('#work-size').disabled = state.busy;
  $('#work-filters').innerHTML = Object.entries(filtersFor()).map(([key,label]) => {
    const count = key==='all'?state.items.length:state.items.filter(it=>matchGroup(it,key)).length;
    const incomplete = key==='all' || key==='returned' ? state.errors.length>0 : state.counts[key]?.complete===false;
    return `<button class="work-filter ${state.group===key?'on':''}" type="button" data-work-group="${key}" aria-pressed="${state.group===key}">${esc(label)}<b>${count}${incomplete?'+':''}</b></button>`;
  }).join('');
  $('#work-errors').innerHTML = state.errors.map(e => `<p class="work-error" role="alert"><strong>${esc(work.groupsFor(state.catalog)[e.group])}:</strong> ${esc(e.message)} <span>Đã tải ${state.counts[e.group]?.loaded || 0}${state.counts[e.group]?.total != null?` / ${state.counts[e.group].total}`:''} nhiệm vụ.</span></p>`).join('');
  $('#work-updated').textContent = state.at ? `Cập nhật ${work.dateTime(state.at)}${state.errors.length?' · Danh sách chưa đầy đủ':''}` : 'Từ hệ thống egov1';
  $('#work-summary').textContent = state.busy?'Đang tải toàn bộ nhiệm vụ…':state.loaded?`${rows.length} nhiệm vụ${state.errors.length?' đã tải được':''}${rows.length?` · Hiển thị ${start+1}–${Math.min(start+state.size,rows.length)}`:''}`:'Chưa tải dữ liệu';
  $('#work-results').setAttribute('aria-busy',String(state.busy));
  if (!logged) $('#work-results').innerHTML = blank('Kết nối egov1 để xem tiến độ','Dùng tài khoản egov1 trong tab Tài khoản.', '<button class="btn primary" data-go-account>Đăng nhập egov1</button>');
  else if (state.busy) $('#work-results').innerHTML = '<div class="loading"><p class="loading-label"><span class="spinner" aria-hidden="true"></span><span id="work-loading">Đang đọc danh sách từ egov1…</span></p></div>';
  else if (!state.loaded) $('#work-results').innerHTML = blank(pending?'Văn bản đang chờ xử lý':'Theo dõi văn bản trình',pending?'Xem người giao việc, văn bản liên kết và hạn xử lý.':'Xem người đang nhận trình và ý kiến trả lại của lãnh đạo.', '<button class="btn primary" data-work-load>Tải tiến độ</button>');
  else if (!rows.length) $('#work-results').innerHTML = blank(state.errors.length?'Chưa lấy được nhiệm vụ phù hợp':'Không có nhiệm vụ phù hợp',state.errors.length?'Một số nhóm chưa tải đủ. Bấm Cập nhật để thử lại.':'Thử đổi nhóm hoặc từ khóa tìm kiếm.');
  else $('#work-results').innerHTML = rows.slice(start,start+state.size).map(it=>`<article class="work-card glass">
    <div class="work-card-head">${badge(it)}<span class="hint">${esc(work.dateTime(it.updated))}</span></div>
    <h3>${esc(it.title)}</h3>${pending ? documentMarkup(it) : ''}<p class="work-recipient"><span>${pending?'Xử lý chính':it.returned?'Đã trả về':'Đang ở'}</span><strong>${esc(it.receiver || 'Chưa rõ người nhận')}</strong></p>
    ${pending ? `<p class="work-submission">Người giao việc: ${esc(it.sender || 'Chưa rõ')}<br>Hạn xử lý: ${esc(it.deadline ? work.dateTime(it.deadline) : 'Chưa có hạn xử lý')}<br>${it.files.length} tệp đính kèm</p>` : ''}
    ${!pending && it.submission?`<p class="work-submission">Trình gần nhất: ${esc(it.submission.person)}<br>${esc(work.dateTime(it.submission.date))}</p>`:''}
    ${it.returns.length?`<div class="work-return-preview"><strong>${it.returned?'Đang trả lại':'Đã từng trả lại'} · ${it.returns.length} lần</strong><p>${esc(it.returns[0].content || 'Không có nội dung ý kiến')}</p><small>${esc(it.returns[0].person)} · ${esc(work.dateTime(it.returns[0].date))}</small></div>`:''}
    <div class="work-card-foot"><span>${esc(it.groups.map(g=>groupLabel(it,g)).join(' · '))}</span><button type="button" class="btn compact" data-work-detail="${esc(it.id)}">Xem tiến trình<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></button></div></article>`).join('');
  for (const pos of ['top','bottom']) {
   const pager=$(`#work-pagination-${pos}`); pager.hidden=!state.loaded || !rows.length;
   pager.innerHTML=`<button class="btn page-button" type="button" data-work-page="prev" aria-label="Trang tiến độ trước" ${state.page<=1||state.busy?'disabled':''}><svg class="icon" aria-hidden="true"><use href="#i-back"/></svg></button><span class="page-position">Trang ${state.page} / ${pages}</span><button class="btn page-button" type="button" data-work-page="next" aria-label="Trang tiến độ sau" ${state.page>=pages||state.busy?'disabled':''}><svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
  }
 }
 async function load() {
  if(state.busy) return;
  const current = ++version, catalog = state.catalog;
  sessionToken=auth.get('egov1')?.accessToken;
  if(!sessionToken) {reset();return;}
  state.busy=true;state.errors=[];render();
  try {
   const result=await work.loadAll(({group,loaded,total})=> {
    if(current!==version)return;
    const label=$('#work-loading');if(label)label.textContent=`${work.groupsFor(catalog)[group]}: ${loaded} / ${total} nhiệm vụ`;
   }, catalog);
   if(current!==version)return;
   Object.assign(state,result,{loaded:true,page:1,at:new Date().toISOString()});
   sessionToken=auth.get('egov1')?.accessToken;
  } catch(e) {
   if(current!==version)return;
   // Never keep another account's snapshot or label it as a fresh successful load.
   state.items=[];state.counts={};state.loaded=false;state.at=null;
   state.errors=[{group:catalog==='pending'?'waiting':'sendDraft',message:handleError(e)}];
   if(e instanceof AuthError) sessionToken=null;
  } finally { if(current===version){state.busy=false;render();} }
 }
 $('#work-catalogs').addEventListener('click',e=>{const b=e.target.closest('[data-work-catalog]');if(!b || b.dataset.workCatalog===state.catalog)return;reset(b.dataset.workCatalog);load();});
 $('#work-refresh').addEventListener('click',load);
 $('#work-q').addEventListener('input',e=>{state.q=e.target.value.trim();state.page=1;render();});
 $('#work-size').addEventListener('change',e=>{state.size=Number(e.target.value);localStorage.setItem('qlvb.work.pageSize',state.size);state.page=1;render();});
 $('#view-progress').addEventListener('click',e=>{
  if(e.target.closest('[data-work-load]'))load();
  const filter=e.target.closest('[data-work-group]');if(filter){state.group=filter.dataset.workGroup;state.page=1;render();}
  const pager=e.target.closest('[data-work-page]');if(pager && !pager.disabled){state.page+=pager.dataset.workPage==='next'?1:-1;render();$('#work-summary').scrollIntoView({block:'start'});}
  const button=e.target.closest('[data-work-detail]');
  if(button){ const item=state.items.find(it=>it.id===button.dataset.workDetail);if(item)openSheet(item,async()=>detailMarkup(await work.detail(item)),detailMarkup(item)); }
 });
 window.addEventListener('storage',e=>{if(e.key==='qlvb.auth.egov1'){reset();}});
 render();
 return {
  enter(){ if(sessionToken && sessionToken!==auth.get('egov1')?.accessToken)reset();if(!state.loaded && !state.busy && auth.get('egov1')?.accessToken)load();else render(); },
  reset,
 };
}
