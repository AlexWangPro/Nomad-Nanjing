import { mountLocationPicker } from './location-picker.js?v=2.6.0';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: localStorage.getItem('nwm-portal-token') || '',
  user: null,
  data: null,
  activeSection: 'overview',
  portalPhotos: [],
  mapConfig: null,
  portalLocationPicker: null,
  drawerLocationPicker: null
};

const categoryLabel = {
  coffee: '咖啡馆',
  library: '图书馆',
  coworking: '共享办公',
  public: '公共空间',
  hotel: '酒店大堂'
};

const statusLabel = { pending: '待审核', approved: '已通过', rejected: '已拒绝', needs_info: '需要补充', secondary_review: '待二次验证', merged: '已合并' };

const choiceLabels = {
  overallSuitability: { excellent: '非常适合办公', good: '基本适合办公', limited: '只适合短暂停留', unsuitable: '不适合办公' },
  workDurationChoice: { under30: '少于 30 分钟', '30to60': '30–60 分钟', '1to3': '1–3 小时', over3: '3 小时以上', observed: '只观察过' },
  visitRecency: { today: '今天', week: '最近一周', month: '最近一个月', older: '更早' },
  outletsChoice: { many: '很多', some: '有一些', few: '很少', none: '没有', unknown: '不确定' },
  wifiChoice: { stable: '稳定好用', average: '一般', unstable: '不稳定', none: '没有', untested: '没测试', unknown: '不确定' },
  quietChoice: { silent: '很安静', quiet: '比较安静', noisy: '有些嘈杂', loud: '很吵', unknown: '不确定' },
  callChoice: { suitable: '适合', quiet_only: '小声可以', unsuitable: '不太适合', forbidden: '不允许', unknown: '不确定' },
  longStayChoice: { over3: '3 小时以上', '1to3': '1–3 小时', short: '短暂停留', unknown: '不确定' },
  priceChoice: { free: '免费', under30: '¥1–30', '31to50': '¥31–50', '51to100': '¥51–100', over100: '¥100+', unknown: '不确定' },
  seatingChoice: { ample: '座位充足', available: '通常能找到', crowded: '经常满座', unknown: '不确定' },
  crowdChoice: { relaxed: '通常不拥挤', peak_only: '高峰拥挤', crowded: '经常拥挤', unknown: '不确定' }
};

function choiceLabel(group, value, fallback = '未回答') { return choiceLabels[group]?.[value] || fallback; }

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
  if (id === 'contribute') {
    requestAnimationFrame(() => ensurePortalLocationPicker().catch((error) => feedback($('#portalSubmitFeedback'), `位置选择器加载失败：${error.message}`, 'error')));
  }
}

function renderStats() {
  const c = state.data.counts;
  const cards = state.user.role === 'admin'
    ? [['待审核', c.pending], ['待二次验证', c.secondaryReview || 0], ['已发布地点', c.places], ['需补充', c.needsInfo || 0]]
    : [['待审核', c.pending], ['已通过', c.approved], ['需要补充', c.needsInfo || 0], ['我的提交', state.data.submissions.length]];
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
  const confidence = item.confidence?.label || '待判断';
  const duplicates = item.duplicateMatches?.length || 0;
  return `<div class="admin-row">
    <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(categoryLabel[item.category] || '地点')} · ${escapeHtml(item.address)}</small></div>
    <div><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel[item.status] || item.status)}</span><small>${escapeHtml(confidence)}${duplicates ? ` · ${duplicates} 个疑似重复` : ''}</small></div>
    <div><strong>${escapeHtml(item.submitterName || item.submitterEmail)}</strong><small>${new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>
    <div class="row-actions">${actionable ? `<button class="small-button primary" type="button" data-review-submission="${escapeHtml(item.id)}">快速审核</button>` : `<button class="small-button" type="button" data-review-submission="${escapeHtml(item.id)}">查看详情</button>`}</div>
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
  if (state.user?.role === 'admin') refreshCandidateStatus();
}

async function getMapConfig() {
  if (!state.mapConfig) state.mapConfig = await api('/api/config');
  return state.mapConfig;
}

async function ensurePortalLocationPicker() {
  const root = $('#portalLocationPicker');
  if (!root || state.portalLocationPicker) {
    state.portalLocationPicker?.map?.resize?.();
    return state.portalLocationPicker;
  }
  const config = await getMapConfig();
  state.portalLocationPicker = await mountLocationPicker({ root, amapKey: config.amapKey, city: '南京' });
  return state.portalLocationPicker;
}

async function mountDrawerLocationPicker(root, initial = {}) {
  state.drawerLocationPicker?.destroy?.();
  state.drawerLocationPicker = null;
  const config = await getMapConfig();
  state.drawerLocationPicker = await mountLocationPicker({ root, amapKey: config.amapKey, city: '南京', initial });
  return state.drawerLocationPicker;
}

function openDrawer(html) {
  $('#drawerContent').innerHTML = html;
  $('#adminDrawer').classList.add('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'false');
  $('#drawerOverlay').classList.add('open');
}

function closeDrawer() {
  state.drawerLocationPicker?.destroy?.();
  state.drawerLocationPicker = null;
  $('#adminDrawer').classList.remove('open');
  $('#adminDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerOverlay').classList.remove('open');
}

function openSubmission(id) {
  const item = state.data.submissions.find((submission) => submission.id === id);
  if (!item) return;
  const canModerate = state.user.role === 'admin';
  const confidenceScore = Number(item.confidence?.score || 0);
  const confidenceLabel = item.confidence?.label || '旧版提交，需人工判断';
  const photosCount = item.images?.length || 0;
  const suggestedTags = item.suggestedTags?.length ? item.suggestedTags : (item.workModes || []);
  const choiceRows = [
    ['总体结论', choiceLabel('overallSuitability', item.overallSuitability, item.description || '未回答')],
    ['到访 / 办公', `${choiceLabel('visitRecency', item.visitRecency, item.visitDate || '未填写')} · ${choiceLabel('workDurationChoice', item.workDurationChoice, item.workDuration || '未填写')}`],
    ['插座', choiceLabel('outletsChoice', item.outletsChoice, item.outlets || '未填写')],
    ['Wi-Fi', choiceLabel('wifiChoice', item.wifiChoice, item.wifi || '未填写')],
    ['安静程度', choiceLabel('quietChoice', item.quietChoice, item.quietLevel ? `${item.quietLevel}/5` : '未填写')],
    ['通话 / 会议', choiceLabel('callChoice', item.callChoice, item.callFriendly ? '适合' : '未填写')],
    ['停留时长', choiceLabel('longStayChoice', item.longStayChoice, item.unlimited ? '适合长时间' : '未填写')],
    ['消费', choiceLabel('priceChoice', item.priceChoice, item.price || '未填写')],
    ['座位', choiceLabel('seatingChoice', item.seatingChoice)],
    ['拥挤情况', choiceLabel('crowdChoice', item.crowdChoice)]
  ];
  const duplicates = item.duplicateMatches || [];
  const verifiedDefault = item.submitterType === 'contributor' || (confidenceScore >= 75 && photosCount > 0);
  openDrawer(`
    <div class="drawer-header">
      <div><span class="eyebrow">QUICK MODERATION</span><h3>${escapeHtml(item.name)}</h3></div>
      <button class="icon-button" type="button" data-close-drawer aria-label="关闭"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
    <span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel[item.status] || item.status)}</span>
    <div class="review-health">
      <div class="${confidenceScore >= 75 ? 'good' : confidenceScore < 50 ? 'warn' : ''}"><span>内部可信度</span><strong>${escapeHtml(confidenceLabel)}${confidenceScore ? ` · ${confidenceScore}` : ''}</strong></div>
      <div class="${photosCount ? 'good' : 'warn'}"><span>现场证据</span><strong>${photosCount ? `${photosCount} 张图片` : '没有图片'}</strong></div>
      <div class="${duplicates.length ? 'warn' : 'good'}"><span>重复检测</span><strong>${duplicates.length ? `${duplicates.length} 个疑似地点` : '未发现重复'}</strong></div>
    </div>
    <div class="drawer-meta">
      <div><span>提交人</span><strong>${escapeHtml(item.submitterName || item.submitterEmail)}</strong></div>
      <div><span>邮箱</span><strong>${escapeHtml(item.submitterEmail)}</strong></div>
      <div><span>类型</span><strong>${escapeHtml(categoryLabel[item.category] || item.category)}</strong></div>
      <div><span>地图位置</span><strong>${item.lng != null && item.lat != null ? '已确认' : '未确认'}</strong></div>
    </div>
    <div class="detail-section"><h4>地址</h4><p>${escapeHtml(item.address)}</p></div>
    <div class="review-choice-grid">${choiceRows.map(([label, value]) => `<div class="review-choice"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    ${item.experienceNote ? `<div class="detail-section"><h4>可选补充感受</h4><p>${escapeHtml(item.experienceNote)}</p></div>` : ''}
    ${item.evidenceNote ? `<div class="detail-section"><h4>注意事项</h4><p>${escapeHtml(item.evidenceNote)}</p></div>` : ''}
    ${item.images?.length ? `<div class="drawer-images">${item.images.map((src) => `<a href="${escapeHtml(src)}" target="_blank"><img src="${escapeHtml(src)}" alt="现场图片" /></a>`).join('')}</div>` : '<div class="detail-footnote">没有现场图片，不影响保留为待二次验证。</div>'}
    ${canModerate ? `
      <form class="admin-form" id="reviewForm" style="margin-top:20px">
        ${duplicates.length ? `<div class="duplicate-panel"><h4>疑似已经收录</h4>${duplicates.map((match) => `<div class="duplicate-option"><label><input type="radio" name="mergePlaceId" value="${escapeHtml(match.id)}" /><span><strong>${escapeHtml(match.name)}</strong><small>${escapeHtml(match.reason)} · 约 ${match.distanceMeters} 米<br>${escapeHtml(match.address)}</small></span></label></div>`).join('')}<small>确认是同一地点时，选择后点击“合并到已有地点”。</small></div>` : ''}
        <details class="review-location-details"><summary>位置需要修正？展开地图</summary>
          <section class="location-picker compact" id="reviewLocationPicker">
            <div class="location-search-row"><input type="search" data-location-search placeholder="输入店名重新搜索" autocomplete="off" /><button class="secondary-button" type="button" data-location-search-button>搜索</button></div>
            <p class="location-status" data-location-status>当前位置来自提交者。</p><div class="location-search-results" data-location-results hidden></div><div class="location-picker-map" data-location-map></div><div class="location-summary" data-location-summary></div>
            <input name="lng" type="hidden" value="${item.lng ?? ''}" /><input name="lat" type="hidden" value="${item.lat ?? ''}" /><input name="address" type="hidden" value="${escapeHtml(item.address || '')}" /><input name="district" type="hidden" value="${escapeHtml(item.district || '')}" /><input name="amapPoiId" type="hidden" value="${escapeHtml(item.amapPoiId || '')}" />
          </section>
        </details>
        <label><span>公开展示说明（可修改）</span><textarea name="description" rows="4">${escapeHtml(item.description || '')}</textarea></label>
        <div><span class="field-caption">系统建议标签</span><div class="suggested-tag-grid">${suggestedTags.length ? suggestedTags.map((tag) => `<label><input type="checkbox" name="suggestedTag" value="${escapeHtml(tag)}" checked /><span>${escapeHtml(tag)}</span></label>`).join('') : '<span>没有自动标签，可在公开说明中补充。</span>'}</div></div>
        <div class="check-row"><label class="check"><input name="featured" type="checkbox" /><span>编辑精选</span></label><label class="check"><input name="verified" type="checkbox" ${verifiedDefault ? 'checked' : ''}/><span>标记为已验证</span></label></div>
        <label><span>审核备注</span><textarea name="reviewNote" rows="3" placeholder="需要补充或拒绝时写一句原因">${escapeHtml(item.reviewNote || '')}</textarea></label>
        <div class="review-actions">
          <button class="primary-button approve" type="button" data-review-action="approved">确认标签并发布</button>
          ${duplicates.length ? '<button class="secondary-button" type="button" data-review-action="merged">合并到已有地点</button>' : ''}
          <button class="secondary-button" type="button" data-review-action="secondary_review">待二次验证</button>
          <button class="secondary-button" type="button" data-review-action="needs_info">需要用户补充</button>
          <button class="danger-button" type="button" data-review-action="rejected">拒绝</button>
        </div>
        <p class="form-feedback" id="reviewFeedback"></p>
      </form>` : ''}
  `);
  $('[data-close-drawer]').addEventListener('click', closeDrawer);
  if (canModerate) {
    $$('[data-review-action]').forEach((button) => button.addEventListener('click', () => moderateSubmission(id, button.dataset.reviewAction)));
    const details = $('.review-location-details');
    details?.addEventListener('toggle', () => {
      if (!details.open || state.drawerLocationPicker) return;
      mountDrawerLocationPicker($('#reviewLocationPicker'), { name: item.name, address: item.address, district: item.district, lng: item.lng, lat: item.lat, poiId: item.amapPoiId })
        .catch((error) => feedback($('#reviewFeedback'), `位置选择器加载失败：${error.message}`, 'error'));
    });
  }
}

async function moderateSubmission(id, status) {
  const form = $('#reviewForm');
  const fd = new FormData(form);
  const payload = {
    status,
    reviewNote: fd.get('reviewNote'),
    description: fd.get('description'),
    featured: form.elements.featured.checked,
    verified: form.elements.verified.checked,
    workModes: $$('[name="suggestedTag"]:checked', form).map((input) => input.value),
    mergePlaceId: fd.get('mergePlaceId') || '',
    lng: fd.get('lng'),
    lat: fd.get('lat'),
    address: fd.get('address'),
    district: fd.get('district'),
    amapPoiId: fd.get('amapPoiId')
  };
  const node = $('#reviewFeedback');
  if (status === 'merged' && !payload.mergePlaceId) {
    feedback(node, '请先选择要合并到的已有地点。', 'error');
    return;
  }
  feedback(node, '正在保存…');
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    feedback(node, status === 'approved' ? '已发布。' : status === 'merged' ? '已合并。' : '状态已更新。', 'success');
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
      <section class="location-picker compact" id="placeLocationPicker">
        <div class="location-picker-heading"><div><strong>搜索并确认精确位置 *</strong><span>管理员也无需填写经纬度，直接在地图中确认。</span></div></div>
        <div class="location-search-row"><input type="search" data-location-search placeholder="输入店名即可，如：星巴克、金陵图书馆" autocomplete="off" /><button class="secondary-button" type="button" data-location-search-button>搜索</button></div>
        <p class="location-status" data-location-status>输入店名会自动显示高德候选结果，无需填写完整地址。</p>
        <div class="location-search-results" data-location-results hidden></div>
        <div class="location-picker-map" data-location-map></div>
        <div class="location-summary" data-location-summary></div>
        <input name="lng" type="hidden" required value="${place.lng ?? ''}" />
        <input name="lat" type="hidden" required value="${place.lat ?? ''}" />
        <input name="amapPoiId" type="hidden" value="${escapeHtml(place.amapPoiId || '')}" />
      </section>
      <label><span>地图识别地址 *</span><input name="address" required readonly value="${escapeHtml(place.address || '')}" /></label>
      <label><span>楼层、入口或座位区域补充</span><input name="addressDetail" placeholder="仅填写地图地址之外的补充信息" /></label>
      <div class="form-grid three-col"><label><span>区域</span><input name="district" value="${escapeHtml(place.district || '')}" /></label><label><span>地铁站</span><input name="metroStation" value="${escapeHtml(place.metroStation || '')}" /></label><label><span>步行分钟</span><input name="metroMinutes" type="number" min="0" max="90" value="${place.metroMinutes ?? ''}" /></label></div>
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
  requestAnimationFrame(() => mountDrawerLocationPicker($('#placeLocationPicker'), {
    name: place?.name, address: place?.address, district: place?.district, lng: place?.lng, lat: place?.lat, poiId: place?.amapPoiId
  }).catch((error) => feedback($('#placeFeedback'), `位置选择器加载失败：${error.message}`, 'error')));
}

async function savePlace(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  if (!payload.lng || !payload.lat || !payload.address) {
    feedback($('#placeFeedback'), '请先通过搜索或地图确认精确位置。', 'error');
    return;
  }
  if (payload.addressDetail?.trim()) payload.address = `${payload.address} · ${payload.addressDetail.trim()}`;
  delete payload.addressDetail;
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


async function refreshCandidateStatus() {
  const node = $('#candidateImportFeedback');
  if (!node || state.user?.role !== 'admin') return;
  try {
    const status = await api('/api/admin/candidate-import-status');
    if (status.running) {
      feedback(node, `服务器正在预录：${status.completed}/${status.total}，已匹配 ${status.matched} 个…`);
      window.setTimeout(refreshCandidateStatus, 1800);
    } else if (status.seedVersion >= 3) {
      feedback(node, `首批地点已预录：最近新增 ${status.imported || 0} 个。你可以逐个编辑并验证。`, 'success');
    } else if (status.message && status.message.startsWith('失败：')) {
      feedback(node, `预录失败：${status.message.slice(3)}`, 'error');
    }
  } catch {}
}

async function importCandidatePlaces() {
  const button = $('#importCandidatesButton');
  const node = $('#candidateImportFeedback');
  if (!confirm('服务器将直接调用高德检索首批南京候选地点，并导入为“待验证”。继续吗？')) return;
  button.disabled = true;
  feedback(node, '香港服务器正在调用高德检索并写入数据库，请不要关闭页面…');
  try {
    const result = await api('/api/admin/places/import-candidates', {
      method: 'POST',
      body: JSON.stringify({ force: true })
    });
    if (result.busy) {
      feedback(node, '预录任务已经在服务器运行，正在读取进度…');
      window.setTimeout(refreshCandidateStatus, 1000);
      return;
    }
    await refreshData();
    const extra = result.failed ? `，${result.failed} 个未匹配` : '';
    const already = result.alreadyDone ? '首批候选地点已经完成预录。' : `预录完成：新增 ${result.imported || 0} 个，跳过重复 ${result.skipped || 0} 个${extra}。`;
    feedback(node, `${already} 所有新地点均标记为待验证。`, 'success');
  } catch (error) {
    feedback(node, `预录失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
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

const MAX_PORTAL_PHOTOS = 8;
const TARGET_PORTAL_PHOTO_BYTES = 100 * 1024;
const MAX_PORTAL_SOURCE_BYTES = 20 * 1024 * 1024;

function portalBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function decodePortalImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function portalCanvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('当前浏览器无法生成 WebP 图片')), 'image/webp', quality);
  });
}

async function compressPortalPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
  if (file.size > MAX_PORTAL_SOURCE_BYTES) throw new Error(`${file.name} 超过 20MB，请先裁剪后重试`);
  const source = await decodePortalImage(file);
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const dimensions = [1600, 1400, 1200, 1000, 850, 720, 600, 480, 360, 280];
  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34, 0.28, 0.22, 0.18];
  let smallest = null;
  try {
    for (const maxDimension of dimensions) {
      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      for (const quality of qualities) {
        const blob = await portalCanvasToBlob(canvas, quality);
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= TARGET_PORTAL_PHOTO_BYTES) {
          return { id: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`, dataUrl: await portalBlobToDataUrl(blob), size: blob.size };
        }
      }
    }
  } finally {
    source.close?.();
  }
  if (smallest && smallest.size <= TARGET_PORTAL_PHOTO_BYTES) {
    return { id: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`, dataUrl: await portalBlobToDataUrl(smallest), size: smallest.size };
  }
  throw new Error(`${file.name} 无法压缩到 100KB 内，请换一张或先裁剪`);
}

function renderPortalPhotoPreview() {
  $('#portalPhotoCount').textContent = `${state.portalPhotos.length} / ${MAX_PORTAL_PHOTOS}`;
  const preview = $('#portalPhotoPreview');
  if (!state.portalPhotos.length) {
    preview.innerHTML = '<span class="photo-empty">尚未选择图片</span>';
    return;
  }
  preview.innerHTML = state.portalPhotos.map((photo, index) => `
    <figure class="photo-item">
      <img src="${photo.dataUrl}" alt="现场图片 ${index + 1}" />
      <button type="button" class="photo-remove" data-portal-photo-remove="${photo.id}" aria-label="删除第 ${index + 1} 张图片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <figcaption>${Math.ceil(photo.size / 1024)}KB · WebP</figcaption>
    </figure>
  `).join('');
}

async function handlePortalPhotos(event) {
  const input = event.target;
  const available = MAX_PORTAL_PHOTOS - state.portalPhotos.length;
  const selected = [...input.files];
  input.value = '';
  if (!selected.length) return;
  if (available <= 0) return feedback($('#portalSubmitFeedback'), '最多上传 8 张图片。', 'error');
  const files = selected.slice(0, available);
  const processing = $('#portalPhotoProcessing');
  const errors = [];
  let added = 0;
  for (let index = 0; index < files.length; index += 1) {
    processing.textContent = `正在转成 WebP 并压缩：${index + 1} / ${files.length}`;
    try {
      state.portalPhotos.push(await compressPortalPhoto(files[index]));
      added += 1;
      renderPortalPhotoPreview();
    } catch (error) {
      errors.push(error.message);
    }
  }
  processing.textContent = added ? `已添加 ${added} 张，均已压缩到 100KB 内。` : '';
  if (errors.length) feedback($('#portalSubmitFeedback'), errors[0], 'error');
}

function removePortalPhoto(photoId) {
  state.portalPhotos = state.portalPhotos.filter((photo) => photo.id !== photoId);
  renderPortalPhotoPreview();
  $('#portalPhotoProcessing').textContent = state.portalPhotos.length ? '可以继续添加或删除图片。' : '';
}

function syncPortalLocationFields(form) {
  const selected = state.portalLocationPicker?.getValue?.();
  if (!form || !selected) return;
  const values = {
    placeName: selected.name,
    lng: Number.isFinite(Number(selected.lng)) ? Number(selected.lng).toFixed(6) : '',
    lat: Number.isFinite(Number(selected.lat)) ? Number(selected.lat).toFixed(6) : '',
    address: selected.address,
    district: selected.district,
    amapPoiId: selected.poiId
  };
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements[name];
    if (field && value !== undefined && value !== null && String(value).trim()) field.value = value;
  }
}

async function contributorSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  syncPortalLocationFields(form);
  const payload = Object.fromEntries(new FormData(form).entries());
  if (!payload.lng || !payload.lat || !payload.address || !payload.placeName) {
    feedback($('#portalSubmitFeedback'), '请先输入店名并选择一个具体高德地点。', 'error');
    $('#portalLocationPicker').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  payload.actualWorked = payload.actualWorked !== 'false';
  payload.photos = state.portalPhotos.map((photo) => photo.dataUrl);
  const button = $('#portalSubmitButton');
  const node = $('#portalSubmitFeedback');
  button.disabled = true;
  feedback(node, '正在提交…');
  try {
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(payload) });
    feedback(node, '提交成功，已进入审核队列。', 'success');
    form.reset();
    state.portalLocationPicker?.reset?.();
    state.portalPhotos = [];
    renderPortalPhotoPreview();
    $('#portalPhotoProcessing').textContent = '';
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
  $('#importCandidatesButton').addEventListener('click', importCandidatePlaces);
  $('#contributorForm').addEventListener('submit', createContributor);
  $('#portalPhotoInput').addEventListener('change', handlePortalPhotos);
  $('#portalPhotoPreview').addEventListener('click', (event) => {
    const button = event.target.closest('[data-portal-photo-remove]');
    if (button) removePortalPhoto(button.dataset.portalPhotoRemove);
  });
  renderPortalPhotoPreview();
  $('#portalSubmissionForm').addEventListener('submit', contributorSubmit);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
}

wireEvents();
restoreSession();
