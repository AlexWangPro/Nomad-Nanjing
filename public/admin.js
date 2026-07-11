const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: localStorage.getItem('nwm-portal-token') || '',
  user: null,
  data: null,
  activeSection: 'overview',
  portalPhotos: []
};

const categoryLabel = {
  coffee: '咖啡馆',
  library: '图书馆',
  coworking: '共享办公',
  public: '公共空间',
  hotel: '酒店大堂'
};

const statusLabel = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function feedback(node, message, type = '') {
  node.textContent = message;
  node.className = `form-feedback ${type}`.trim();
}

function setAuthenticated(user) {
  state.user = user;
  $('#loginView').hidden = true;
  $('#portalView').hidden = false;
  $('#portalUserName').textContent = user.name || user.email;
  $('#portalUserRole').textContent = user.role === 'admin' ? '管理员' : '受邀贡献者';
  state.activeSection = user.role === 'admin' ? 'overview' : 'contribute';
  renderNav();
}

function logout() {
  state.token = '';
  state.user = null;
  state.data = null;
  localStorage.removeItem('nwm-portal-token');
  $('#portalView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginForm').reset();
}

function renderNav() {
  const adminItems = [
    ['overview', '工作台'],
    ['submissions', '地点审核'],
    ['places', '地点管理'],
    ['contributors', '贡献者']
  ];
  const contributorItems = [
    ['contribute', '提交新地点'],
    ['overview', '我的提交']
  ];
  const items = state.user.role === 'admin' ? adminItems : contributorItems;
  $('#portalNav').innerHTML = items.map(([id, label]) => `<button type="button" class="${state.activeSection === id ? 'active' : ''}" data-section-target="${id}">${label}</button>`).join('');
  $$('[data-section-target]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.sectionTarget)));
  showSection(state.activeSection, false);
}

function showSection(id, refreshNav = true) {
  state.activeSection = id;
  $$('.portal-section').forEach((section) => section.classList.toggle('active', section.dataset.section === id));
  if (refreshNav) {
    $$('[data-section-target]').forEach((button) => button.classList.toggle('active', button.dataset.sectionTarget === id));
  }
}

function renderStats() {
  const c = state.data.counts;
  const cards = state.user.role === 'admin'
    ? [['待审核', c.pending], ['已发布地点', c.places], ['贡献者', c.contributors], ['已拒绝', c.rejected]]
    : [['待审核', c.pending], ['已通过', c.approved], ['需修改 / 已拒绝', c.rejected], ['我的提交', state.data.submissions.length]];
  $('#statGrid').innerHTML = cards.map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderRecent() {
  const submissions = state.data.submissions.slice(0, 8);
  if (!submissions.length) {
    $('#recentList').innerHTML = '<div class="empty-state">暂无提交记录。</div>';
    return;
  }
  $('#recentList').innerHTML = submissions.map((item) => submissionRow(item, state.user.role === 'admin')).join('');
  wireSubmissionRows($('#recentList'));
}

function submissionRow(item, actionable = true) {
  return `<div class="admin-row">
    <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(categoryLabel[item.category] || '地点')} · ${escapeHtml(item.address)}</small></div>
    <div><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel[item.status] || item.status)}</span><small>${escapeHtml(item.submitterType === 'contributor' ? '贡献者提交' : '公开提交')}</small></div>
    <div><strong>${escapeHtml(item.submitterName || item.submitterEmail)}</strong><small>${new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>
    <div class="row-actions">${actionable ? `<button class="small-button primary" type="button" data-review-submission="${escapeHtml(item.id)}">查看审核</button>` : `<button class="small-button" type="button" data-review-submission="${escapeHtml(item.id)}">查看详情</button>`}</div>
  </div>`;
}

function renderSubmissions() {
  const filter = $('#submissionStatusFilter').value;
  const submissions = state.data.submissions.filter((item) => filter === 'all' || item.status === filter);
  $('#submissionList').innerHTML = submissions.length ? submissions.map((item) => submissionRow(item, true)).join('') : '<div class="empty-state">当前筛选下没有提交。</div>';
  wireSubmissionRows($('#submissionList'));
}

function wireSubmissionRows(root) {
  $$('[data-review-submission]', root).forEach((button) => button.addEventListener('click', () => openSubmission(button.dataset.reviewSubmission)));
}

function renderPlaces() {
  const places = state.data.places || [];
  $('#placeAdminList').innerHTML = places.length ? places.map((place) => `
    <div class="admin-row">
      <div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(categoryLabel[place.category] || '地点')} · ${escapeHtml(place.address)}</small></div>
      <div><span class="status-pill ${place.verified ? 'approved' : 'pending'}">${place.verified ? '已验证' : '待验证'}</span><small>${place.isDemo ? '示例数据' : place.featured ? '编辑精选' : '普通收录'}</small></div>
      <div><strong>${escapeHtml(place.metroStation || '未填写地铁')}</strong><small>${escapeHtml(place.lastVerified || '未确认')}</small></div>
      <div class="row-actions"><button class="small-button primary" type="button" data-edit-place="${escapeHtml(place.id)}">编辑</button><button class="small-button danger" type="button" data-archive-place="${escapeHtml(place.id)}">下架</button></div>
    </div>
  `).join('') : '<div class="empty-state">暂无地点。</div>';
  $$('[data-edit-place]').forEach((button) => button.addEventListener('click', () => openPlaceEditor(button.dataset.editPlace)));
  $$('[data-archive-place]').forEach((button) => button.addEventListener('click', () => archivePlace(button.dataset.archivePlace)));
}

function renderContributors() {
  const contributors = state.data.contributors || [];
  $('#contributorList').innerHTML = contributors.length ? contributors.map((item) => `
    <div class="admin-row">
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.email)}</small></div>
      <div><span class="status-pill ${item.active === false ? 'rejected' : 'approved'}">${item.active === false ? '已停用' : '启用中'}</span><small>受邀贡献者</small></div>
      <div><strong>创建于</strong><small>${new Date(item.createdAt).toLocaleDateString('zh-CN')}</small></div>
      <div class="row-actions"><button class="small-button ${item.active === false ? 'primary' : 'danger'}" type="button" data-toggle-contributor="${escapeHtml(item.id)}" data-active="${item.active !== false}">${item.active === false ? '重新启用' : '停用'}</button></div>
    </div>
  `).join('') : '<div class="empty-state">还没有贡献者。上方创建后，将登录信息单独发送给对方。</div>';
  $$('[data-toggle-contributor]').forEach((button) => button.addEventListener('click', () => toggleContributor(button.dataset.toggleContributor, button.dataset.active !== 'true')));
}

function renderAll() {
  renderStats();
  renderRecent();
  if (state.user.role === 'admin') {
    renderSubmissions();
    renderPlaces();
    renderContributors();
  }
}

async function refreshData() {
  state.data = await api('/api/portal/overview');
  renderAll();
}

function openDrawer(html) {
  $('#drawerContent').innerHTML = html;
  $('#adminDrawer').classList.add('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'false');
  $('#drawerOverlay').classList.add('open');
}

function closeDrawer() {
  $('#adminDrawer').classList.remove('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerOverlay').classList.remove('open');
}

function openSubmission(id) {
  const item = state.data.submissions.find((submission) => submission.id === id);
  if (!item) return;
  const canModerate = state.user.role === 'admin';
  openDrawer(`
    <div class="drawer-header">
      <div><span class="eyebrow">SUBMISSION REVIEW</span><h3>${escapeHtml(item.name)}</h3></div>
      <button class="icon-button" type="button" data-close-drawer aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
    <span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel[item.status] || item.status)}</span>
    <div class="drawer-meta">
      <div><span>提交人</span><strong>${escapeHtml(item.submitterName || item.submitterEmail)}</strong></div>
      <div><span>邮箱</span><strong>${escapeHtml(item.submitterEmail)}</strong></div>
      <div><span>类型</span><strong>${escapeHtml(categoryLabel[item.category] || item.category)}</strong></div>
      <div><span>到访 / 办公</span><strong>${escapeHtml(item.visitDate)} · ${escapeHtml(item.workDuration)}</strong></div>
      <div><span>最近地铁</span><strong>${escapeHtml(item.metroStation || '未填写')} ${item.metroMinutes != null ? `${item.metroMinutes} 分钟` : ''}</strong></div>
      <div><span>坐标</span><strong>${item.lng ?? '—'}, ${item.lat ?? '—'}</strong></div>
      <div><span>Wi-Fi / 插座</span><strong>${escapeHtml(item.wifi || '未填写')} · ${escapeHtml(item.outlets || '未填写')}</strong></div>
      <div><span>消费 / 营业</span><strong>${escapeHtml(item.price || '未填写')} · ${escapeHtml(item.hours || '未填写')}</strong></div>
    </div>
    <div class="detail-section"><h4>地址</h4><p>${escapeHtml(item.address)}</p></div>
    <div class="detail-section"><h4>实际办公体验</h4><p>${escapeHtml(item.description)}</p></div>
    ${item.evidenceNote ? `<div class="detail-section"><h4>证据与注意事项</h4><p>${escapeHtml(item.evidenceNote)}</p></div>` : ''}
    ${item.images?.length ? `<div class="drawer-images">${item.images.map((src) => `<a href="${escapeHtml(src)}" target="_blank"><img src="${escapeHtml(src)}" alt="现场图片" /></a>`).join('')}</div>` : '<div class="detail-footnote">这条提交没有现场图片。</div>'}
    ${item.reviewNote ? `<div class="detail-section"><h4>审核备注</h4><p>${escapeHtml(item.reviewNote)}</p></div>` : ''}
    ${canModerate ? `
      <form class="admin-form" id="reviewForm" style="margin-top:20px">
        <label><span>审核备注</span><textarea name="reviewNote" rows="3" placeholder="拒绝或退回时说明原因">${escapeHtml(item.reviewNote || '')}</textarea></label>
        <div class="check-row"><label class="check"><input name="featured" type="checkbox" /><span>设为编辑精选</span></label><label class="check"><input name="verified" type="checkbox" checked /><span>标记为已验证</span></label></div>
        <label><span>办公方式标签（逗号分隔）</span><input name="workModes" value="深度工作, 临时办公" /></label>
        <div class="form-actions-inline"><button class="danger-button" type="button" data-review-action="rejected">拒绝</button><button class="secondary-button" type="button" data-review-action="pending">保留待审</button><button class="primary-button" type="button" data-review-action="approved">通过并发布</button></div>
        <p class="form-feedback" id="reviewFeedback"></p>
      </form>` : ''}
  `);
  $('[data-close-drawer]').addEventListener('click', closeDrawer);
  if (canModerate) {
    $$('[data-review-action]').forEach((button) => button.addEventListener('click', () => moderateSubmission(id, button.dataset.reviewAction)));
  }
}

async function moderateSubmission(id, status) {
  const form = $('#reviewForm');
  const fd = new FormData(form);
  const payload = {
    status,
    reviewNote: fd.get('reviewNote'),
    featured: form.elements.featured.checked,
    verified: form.elements.verified.checked,
    workModes: String(fd.get('workModes') || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean)
  };
  const node = $('#reviewFeedback');
  feedback(node, '正在保存…');
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    feedback(node, '已保存。', 'success');
    await refreshData();
    setTimeout(closeDrawer, 500);
  } catch (error) {
    feedback(node, error.message, 'error');
  }
}

function placeForm(place = {}) {
  return `
    <form class="admin-form" id="placeForm">
      <div class="form-grid two-col"><label><span>地点名称 *</span><input name="name" required value="${escapeHtml(place.name || '')}" /></label><label><span>类型</span><select name="category">${Object.entries(categoryLabel).map(([value,label]) => `<option value="${value}" ${place.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <label><span>地址 *</span><input name="address" required value="${escapeHtml(place.address || '')}" /></label>
      <div class="form-grid three-col"><label><span>区域</span><input name="district" value="${escapeHtml(place.district || '')}" /></label><label><span>地铁站</span><input name="metroStation" value="${escapeHtml(place.metroStation || '')}" /></label><label><span>步行分钟</span><input name="metroMinutes" type="number" min="0" max="90" value="${place.metroMinutes ?? ''}" /></label></div>
      <div class="form-grid two-col"><label><span>经度 *</span><input name="lng" type="number" step="0.000001" required value="${place.lng ?? ''}" /></label><label><span>纬度 *</span><input name="lat" type="number" step="0.000001" required value="${place.lat ?? ''}" /></label></div>
      <div class="form-grid two-col"><label><span>消费</span><input name="price" value="${escapeHtml(place.price || '')}" /></label><label><span>营业时间</span><input name="hours" value="${escapeHtml(place.hours || '')}" /></label></div>
      <div class="form-grid three-col"><label><span>安静程度</span><select name="quietLevel">${[5,4,3,2,1].map((n) => `<option value="${n}" ${Number(place.quietLevel || 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label><span>Wi-Fi</span><input name="wifi" value="${escapeHtml(place.wifi || '')}" /></label><label><span>插座</span><input name="outlets" value="${escapeHtml(place.outlets || '')}" /></label></div>
      <div class="check-row"><label class="check"><input name="callFriendly" type="checkbox" ${place.callFriendly ? 'checked' : ''}/><span>适合通话</span></label><label class="check"><input name="unlimited" type="checkbox" ${place.unlimited ? 'checked' : ''}/><span>通常不限时</span></label><label class="check"><input name="free" type="checkbox" ${place.free ? 'checked' : ''}/><span>免费</span></label><label class="check"><input name="featured" type="checkbox" ${place.featured ? 'checked' : ''}/><span>编辑精选</span></label><label class="check"><input name="verified" type="checkbox" ${place.verified ? 'checked' : ''}/><span>已验证</span></label></div>
      <label><span>最近确认日期</span><input name="lastVerified" type="date" value="${escapeHtml(place.lastVerified || '')}" /></label>
      <label><span>办公方式标签（逗号分隔）</span><input name="workModes" value="${escapeHtml((place.workModes || []).join(', '))}" /></label>
      <label><span>办公说明</span><textarea name="description" rows="6">${escapeHtml(place.description || '')}</textarea></label>
      <div class="form-actions-inline"><button class="secondary-button" type="button" data-close-drawer>取消</button><button class="primary-button" type="submit">保存地点</button></div>
      <p class="form-feedback" id="placeFeedback"></p>
    </form>`;
}

function openPlaceEditor(id = null) {
  const place = id ? state.data.places.find((item) => item.id === id) : null;
  openDrawer(`
    <div class="drawer-header"><div><span class="eyebrow">${place ? 'EDIT PLACE' : 'NEW PLACE'}</span><h3>${place ? escapeHtml(place.name) : '新增地点'}</h3></div><button class="icon-button" type="button" data-close-drawer aria-label="关闭"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
    ${placeForm(place || {})}
  `);
  $$('[data-close-drawer]').forEach((button) => button.addEventListener('click', closeDrawer));
  $('#placeForm').addEventListener('submit', (event) => savePlace(event, id));
}

async function savePlace(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  for (const key of ['callFriendly','unlimited','free','featured','verified']) payload[key] = form.elements[key].checked;
  payload.workModes = String(fd.get('workModes') || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const node = $('#placeFeedback');
  feedback(node, '正在保存…');
  try {
    await api(id ? `/api/admin/places/${encodeURIComponent(id)}` : '/api/admin/places', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    feedback(node, '保存成功。', 'success');
    await refreshData();
    setTimeout(closeDrawer, 500);
  } catch (error) {
    feedback(node, error.message, 'error');
  }
}

async function archivePlace(id) {
  if (!confirm('确认下架这个地点？数据会保留在数据库中，但不再公开显示。')) return;
  try {
    await api(`/api/admin/places/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

async function toggleContributor(id, active) {
  try {
    await api(`/api/admin/contributors/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

async function createContributor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const node = $('#contributorFeedback');
  feedback(node, '正在创建…');
  try {
    await api('/api/admin/contributors', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    feedback(node, '贡献者已创建。请安全地把邮箱和临时密码发送给对方。', 'success');
    await refreshData();
  } catch (error) {
    feedback(node, error.message, 'error');
  }
}

async function fileToDataUrl(file) {
  if (file.size > 2.5 * 1024 * 1024) throw new Error(`${file.name} 超过 2.5MB`);
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function handlePortalPhotos(event) {
  const files = [...event.target.files].slice(0, 3);
  try {
    state.portalPhotos = await Promise.all(files.map(fileToDataUrl));
    $('#portalPhotoPreview').innerHTML = state.portalPhotos.length ? state.portalPhotos.map((src) => `<img src="${src}" alt="现场图片预览" />`).join('') : '<span>暂未选择图片</span>';
  } catch (error) {
    state.portalPhotos = [];
    event.target.value = '';
    $('#portalPhotoPreview').innerHTML = `<span>${escapeHtml(error.message)}</span>`;
  }
}

async function contributorSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.callFriendly = form.elements.callFriendly.checked;
  payload.unlimited = form.elements.unlimited.checked;
  payload.free = form.elements.free.checked;
  payload.photos = state.portalPhotos;
  const button = $('#portalSubmitButton');
  const node = $('#portalSubmitFeedback');
  button.disabled = true;
  feedback(node, '正在提交…');
  try {
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(payload) });
    feedback(node, '提交成功，已进入审核队列。', 'success');
    form.reset();
    state.portalPhotos = [];
    $('#portalPhotoPreview').innerHTML = '<span>暂未选择图片</span>';
    await refreshData();
  } catch (error) {
    feedback(node, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#loginButton');
  const node = $('#loginFeedback');
  button.disabled = true;
  feedback(node, '正在登录…');
  try {
    const payload = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    state.token = payload.token;
    localStorage.setItem('nwm-portal-token', state.token);
    setAuthenticated(payload.user);
    await refreshData();
    feedback(node, '');
  } catch (error) {
    feedback(node, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function restoreSession() {
  if (!state.token) return;
  try {
    const payload = await api('/api/me');
    setAuthenticated(payload.user);
    await refreshData();
  } catch {
    logout();
  }
}

function wireEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#logoutButton').addEventListener('click', logout);
  $('#drawerOverlay').addEventListener('click', closeDrawer);
  $('#submissionStatusFilter').addEventListener('change', renderSubmissions);
  $('#newPlaceButton').addEventListener('click', () => openPlaceEditor());
  $('#contributorForm').addEventListener('submit', createContributor);
  $('#portalPhotoInput').addEventListener('change', handlePortalPhotos);
  $('#portalSubmissionForm').addEventListener('submit', contributorSubmit);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
}

wireEvents();
restoreSession();
