const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  config: null,
  places: [],
  filtered: [],
  selected: null,
  activeFilter: 'all',
  search: '',
  favorites: new Set(JSON.parse(localStorage.getItem('nwm-favorites') || '[]')),
  map: null,
  markers: new Map(),
  usingFallback: true,
  userPosition: null,
  photoData: []
};

const filters = [
  { id: 'all', label: '全部' },
  { id: 'coffee', label: '咖啡馆' },
  { id: 'library', label: '图书馆' },
  { id: 'coworking', label: '共享办公' },
  { id: 'quiet', label: '安静' },
  { id: 'call', label: '可通话' },
  { id: 'outlets', label: '插座多' },
  { id: 'free', label: '免费' },
  { id: 'metro', label: '近地铁' },
  { id: 'verified', label: '已验证' }
];

const categoryIcon = {
  coffee: '☕',
  library: '阅',
  coworking: '工',
  public: '公',
  hotel: '宿'
};

const categoryLabel = {
  coffee: '咖啡馆',
  library: '图书馆',
  coworking: '共享办公',
  public: '公共空间',
  hotel: '酒店大堂'
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function renderFilters() {
  $('#filterRail').innerHTML = filters.map((filter) => `
    <button type="button" class="filter-chip ${state.activeFilter === filter.id ? 'active' : ''}" data-filter="${filter.id}">${filter.label}</button>
  `).join('');
  $$('.filter-chip').forEach((button) => button.addEventListener('click', () => {
    state.activeFilter = button.dataset.filter;
    renderFilters();
    applyFilters();
  }));
}

function placeMatches(place) {
  const query = state.search.trim().toLowerCase();
  const searchText = [place.name, place.address, place.district, place.metroStation, place.description, ...(place.workModes || [])].join(' ').toLowerCase();
  if (query && !searchText.includes(query)) return false;
  switch (state.activeFilter) {
    case 'coffee':
    case 'library':
    case 'coworking': return place.category === state.activeFilter;
    case 'quiet': return Number(place.quietLevel) >= 4;
    case 'call': return place.callFriendly === true;
    case 'outlets': return /充足|每席位|较多|靠墙/.test(place.outlets || '');
    case 'free': return place.free === true;
    case 'metro': return Number(place.metroMinutes) <= 8;
    case 'verified': return place.verified === true;
    default: return true;
  }
}

function applyFilters() {
  state.filtered = state.places.filter(placeMatches);
  renderList();
  renderMarkers();
  $('#placeCount').textContent = String(state.filtered.length);
  if (state.filtered.length) {
    setStatus(`${state.filtered.length} 个精选地点`, true);
  } else {
    setStatus('没有符合条件的地点', false);
  }
}

function getTags(place) {
  const tags = [];
  if (place.featured) tags.push({ label: '编辑精选', accent: true });
  if (place.verified) tags.push({ label: '实地验证', accent: true });
  if (place.quietLevel >= 4) tags.push({ label: '适合深度工作' });
  if (place.callFriendly) tags.push({ label: '可通话' });
  if (place.free) tags.push({ label: '免费' });
  if (place.unlimited) tags.push({ label: '通常不限时' });
  return tags.slice(0, 4);
}

function renderList() {
  const list = $('#placeList');
  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty-state">换一个筛选条件，或者向我们推荐一个真实适合办公的地点。</div>';
    return;
  }
  list.innerHTML = state.filtered.map((place) => `
    <button class="place-card" type="button" data-place-id="${escapeHtml(place.id)}">
      <div class="place-card-top">
        <span class="category-icon">${categoryIcon[place.category] || '地'}</span>
        <span class="place-card-copy">
          <h3>${escapeHtml(place.name)}</h3>
          <span class="place-meta">
            <span>${escapeHtml(place.metroStation || place.district || '南京')}</span>
            ${place.metroMinutes != null ? `<span>步行 ${place.metroMinutes} 分钟</span>` : ''}
            <span>${escapeHtml(place.price || '待确认')}</span>
          </span>
          <span class="place-tags">
            ${getTags(place).map((tag) => `<span class="soft-tag ${tag.accent ? 'accent' : ''}">${tag.label}</span>`).join('')}
          </span>
        </span>
      </div>
    </button>
  `).join('');
  $$('.place-card', list).forEach((button) => button.addEventListener('click', () => selectPlace(button.dataset.placeId, true)));
}

function markerHtml(place) {
  return `<div class="map-marker ${place.featured ? 'featured' : ''} ${place.verified ? '' : 'unverified'}" data-marker-id="${escapeHtml(place.id)}">
    <span class="map-marker-pin"></span><span class="map-marker-icon">${categoryIcon[place.category] || '地'}</span>
  </div>`;
}

function clearMarkers() {
  if (state.usingFallback) {
    $$('.fallback-marker', $('#map')).forEach((marker) => marker.remove());
  } else if (state.map) {
    for (const marker of state.markers.values()) state.map.remove(marker);
  }
  state.markers.clear();
}

function renderMarkers() {
  clearMarkers();
  if (state.usingFallback) {
    renderFallbackMarkers();
    return;
  }
  if (!state.map || !window.AMap) return;
  state.filtered.forEach((place) => {
    if (!Number.isFinite(Number(place.lng)) || !Number.isFinite(Number(place.lat))) return;
    const marker = new window.AMap.Marker({
      position: [place.lng, place.lat],
      content: markerHtml(place),
      anchor: 'bottom-center',
      offset: new window.AMap.Pixel(0, 0),
      zIndex: place.featured ? 120 : 100
    });
    marker.on('click', () => selectPlace(place.id, false));
    state.map.add(marker);
    state.markers.set(place.id, marker);
  });
}

function renderFallback() {
  const map = $('#map');
  map.innerHTML = $('#fallbackMapTemplate').innerHTML;
  state.usingFallback = true;
  renderFallbackMarkers();
}

function projectFallback(place) {
  const bounds = { minLng: 118.64, maxLng: 118.96, minLat: 31.91, maxLat: 32.17 };
  const x = ((place.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - ((place.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat))) * 100;
  return { x: Math.max(4, Math.min(96, x)), y: Math.max(10, Math.min(92, y)) };
}

function renderFallbackMarkers() {
  const map = $('#map');
  state.filtered.forEach((place) => {
    if (!Number.isFinite(Number(place.lng)) || !Number.isFinite(Number(place.lat))) return;
    const { x, y } = projectFallback(place);
    const button = document.createElement('button');
    button.className = 'fallback-marker';
    button.type = 'button';
    button.style.left = `${x}%`;
    button.style.top = `${y}%`;
    button.style.transform = 'translate(-50%, -100%)';
    button.innerHTML = markerHtml(place);
    button.setAttribute('aria-label', place.name);
    button.addEventListener('click', () => selectPlace(place.id, false));
    map.appendChild(button);
    state.markers.set(place.id, button);
  });
}

function highlightMarker(id) {
  $$('.map-marker.selected').forEach((item) => item.classList.remove('selected'));
  const fallback = state.markers.get(id);
  if (state.usingFallback && fallback) $('.map-marker', fallback)?.classList.add('selected');
  if (!state.usingFallback) {
    const node = document.querySelector(`[data-marker-id="${CSS.escape(id)}"]`);
    node?.classList.add('selected');
  }
}

function quietBars(level) {
  return `<span class="quiet-meter">${[1,2,3,4,5].map((n) => `<i class="${n <= Number(level) ? 'on' : ''}"></i>`).join('')}</span>`;
}

function renderDetail(place) {
  const isSaved = state.favorites.has(place.id);
  const tags = getTags(place);
  const navigateUrl = `https://uri.amap.com/marker?position=${encodeURIComponent(`${place.lng},${place.lat}`)}&name=${encodeURIComponent(place.name)}&coordinate=gaode&callnative=1`;
  $('#detailContent').innerHTML = `
    <div class="detail-kicker">
      <span class="detail-badge">${escapeHtml(categoryLabel[place.category] || '地点')}</span>
      ${tags.slice(0,2).map((tag) => `<span class="detail-badge">${tag.label}</span>`).join('')}
      ${place.isDemo ? '<span class="detail-badge demo">示例数据</span>' : ''}
    </div>
    <h2 class="detail-title">${escapeHtml(place.name)}</h2>
    <div class="detail-subtitle">${escapeHtml(place.address || '')}${place.metroStation ? ` · 距 ${escapeHtml(place.metroStation)}步行约 ${escapeHtml(place.metroMinutes ?? '?')} 分钟` : ''}</div>
    <div class="detail-actions">
      <a class="primary-button" style="display:flex;align-items:center;justify-content:center" href="${navigateUrl}" target="_blank" rel="noreferrer">高德导航</a>
      <button class="secondary-button favorite-action ${isSaved ? 'saved' : ''}" id="detailFavorite" type="button" aria-label="${isSaved ? '取消收藏' : '收藏地点'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.5c0 5.1-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.5A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.8Z"/></svg>
      </button>
    </div>
    <div class="detail-metrics">
      <div class="metric-card"><span>安静程度</span><strong>${place.quietLevel >= 4 ? '适合专注工作' : place.quietLevel >= 3 ? '一般' : '偏嘈杂'}</strong>${quietBars(place.quietLevel)}</div>
      <div class="metric-card"><span>消费 / 使用</span><strong>${escapeHtml(place.price || '待确认')}</strong></div>
      <div class="metric-card"><span>Wi-Fi</span><strong>${escapeHtml(place.wifi || '待确认')}</strong></div>
      <div class="metric-card"><span>插座</span><strong>${escapeHtml(place.outlets || '待确认')}</strong></div>
    </div>
    <div class="detail-section">
      <h4>适合的办公方式</h4>
      <div class="mode-row">${(place.workModes?.length ? place.workModes : getTags(place).map((t) => t.label)).map((mode) => `<span class="mode-tag">${escapeHtml(mode)}</span>`).join('')}</div>
    </div>
    <div class="detail-section">
      <h4>办公说明</h4>
      <p>${escapeHtml(place.description || '暂无详细说明。')}</p>
    </div>
    <div class="detail-section">
      <h4>营业与验证</h4>
      <p>营业时间：${escapeHtml(place.hours || '待确认')}<br>最近确认：${escapeHtml(place.lastVerified || '待确认')}<br>${place.callFriendly ? '允许轻度通话或视频会议。' : '不建议在主要座位区通话。'} ${place.unlimited ? '通常不限时。' : '可能存在限时或高峰占座规则。'}</p>
    </div>
    ${place.isDemo ? '<div class="detail-footnote">本条为首版界面演示数据，正式公开前请在后台替换为经过核实的真实地点。</div>' : ''}
  `;
  $('#detailFavorite').addEventListener('click', () => toggleFavorite(place.id));
}

function selectPlace(id, pan) {
  const place = state.places.find((item) => item.id === id);
  if (!place) return;
  state.selected = place;
  renderDetail(place);
  const sheet = $('#detailSheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  highlightMarker(id);
  if (pan && !state.usingFallback && state.map) {
    state.map.panTo([place.lng, place.lat]);
  }
}

function closeDetail() {
  $('#detailSheet').classList.remove('open');
  $('#detailSheet').setAttribute('aria-hidden', 'true');
  state.selected = null;
  $$('.map-marker.selected').forEach((item) => item.classList.remove('selected'));
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  localStorage.setItem('nwm-favorites', JSON.stringify([...state.favorites]));
  if (state.selected?.id === id) renderDetail(state.selected);
  renderFavorites();
  showToast(state.favorites.has(id) ? '已加入收藏' : '已取消收藏');
}

function renderFavorites() {
  const list = $('#favoriteList');
  const items = state.places.filter((place) => state.favorites.has(place.id));
  if (!items.length) {
    list.innerHTML = '<div class="favorite-empty">还没有收藏地点。打开任意地点详情即可收藏。</div>';
    return;
  }
  list.innerHTML = items.map((place) => `
    <div class="favorite-item">
      <span class="category-icon">${categoryIcon[place.category] || '地'}</span>
      <button type="button" data-favorite-place="${escapeHtml(place.id)}"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.metroStation || place.address)}</small></button>
      <button class="icon-button" type="button" data-remove-favorite="${escapeHtml(place.id)}" aria-label="取消收藏"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
  `).join('');
  $$('[data-favorite-place]', list).forEach((button) => button.addEventListener('click', () => {
    $('#favoriteModal').close();
    selectPlace(button.dataset.favoritePlace, true);
  }));
  $$('[data-remove-favorite]', list).forEach((button) => button.addEventListener('click', () => toggleFavorite(button.dataset.removeFavorite)));
}

function setStatus(message, healthy = true) {
  $('#mapStatusText').textContent = message;
  $('.status-dot').style.background = healthy ? 'var(--accent)' : 'var(--warm)';
}

function showToast(message) {
  let toast = $('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function openModal(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
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

async function handlePhotos(event) {
  const files = [...event.target.files].slice(0, 3);
  const preview = $('#photoPreview');
  try {
    state.photoData = await Promise.all(files.map(fileToDataUrl));
    preview.innerHTML = state.photoData.length ? state.photoData.map((src) => `<img src="${src}" alt="现场图片预览" />`).join('') : '<span>点击选择图片</span>';
  } catch (error) {
    state.photoData = [];
    event.target.value = '';
    preview.innerHTML = `<span>${escapeHtml(error.message)}</span>`;
  }
}

async function submitPlace(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#submitButton');
  const feedback = $('#submissionFeedback');
  feedback.className = 'form-feedback';
  feedback.textContent = '';
  if (!state.photoData.length) {
    feedback.classList.add('error');
    feedback.textContent = '请至少上传一张现场图片。';
    return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  data.callFriendly = form.elements.callFriendly.checked;
  data.unlimited = form.elements.unlimited.checked;
  data.free = form.elements.free.checked;
  data.photos = state.photoData;
  button.disabled = true;
  button.textContent = '正在提交…';
  try {
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(data) });
    feedback.classList.add('success');
    feedback.textContent = '提交成功，已进入审核队列。';
    form.reset();
    state.photoData = [];
    $('#photoPreview').innerHTML = '<span>点击选择图片</span>';
    setTimeout(() => $('#submitModal').close(), 1200);
  } catch (error) {
    feedback.classList.add('error');
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = '提交审核';
  }
}

function locateUser() {
  if (!navigator.geolocation) return showToast('当前浏览器不支持定位');
  setStatus('正在获取位置', true);
  navigator.geolocation.getCurrentPosition((position) => {
    state.userPosition = [position.coords.longitude, position.coords.latitude];
    if (!state.usingFallback && state.map) {
      state.map.setZoomAndCenter(14, state.userPosition);
      if (window.AMap) {
        const marker = new window.AMap.Marker({
          position: state.userPosition,
          content: '<div style="width:18px;height:18px;border:4px solid white;border-radius:50%;background:#276eaa;box-shadow:0 4px 18px rgba(39,110,170,.4)"></div>',
          anchor: 'center'
        });
        state.map.add(marker);
      }
    }
    setStatus('已定位到当前位置', true);
  }, () => {
    setStatus(`${state.filtered.length} 个精选地点`, true);
    showToast('定位失败，请检查浏览器权限');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function loadAmap(key, securityCode) {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap);

    const cleanKey = String(key || '').trim().replace(/^['"]|['"]$/g, '');
    const cleanSecurityCode = String(securityCode || '').trim().replace(/^['"]|['"]$/g, '');
    if (!cleanKey) return reject(new Error('未读取到 AMAP_JS_KEY'));
    if (!cleanSecurityCode) return reject(new Error('未读取到 AMAP_SECURITY_CODE'));

    // 高德要求安全密钥和异步回调都必须在 JS API 脚本加载之前声明。
    window._AMapSecurityConfig = { securityJsCode: cleanSecurityCode };

    const callbackName = `__nwmAmapReady_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('高德地图加载超时，请检查 Key 类型、域名白名单或网络连接'));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    }

    window[callbackName] = () => {
      cleanup();
      if (window.AMap) resolve(window.AMap);
      else reject(new Error('高德回调已执行，但 AMap 对象未生成'));
    };

    script.id = 'amap-jsapi';
    script.charset = 'utf-8';
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(cleanKey)}&callback=${encodeURIComponent(callbackName)}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('高德地图脚本无法访问；请检查 CSP、网络或高德服务状态'));
    };
    document.head.appendChild(script);
  });
}

function loadAmapPlugin(AMap, pluginName, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const constructorName = pluginName.split('.').pop();
    if (typeof AMap?.[constructorName] === 'function') {
      resolve(AMap[constructorName]);
      return;
    }
    if (typeof AMap?.plugin !== 'function') {
      reject(new Error(`${pluginName} 插件加载器不可用`));
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${pluginName} 插件加载超时`));
    }, timeoutMs);

    try {
      AMap.plugin(pluginName, () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (typeof AMap[constructorName] === 'function') {
          resolve(AMap[constructorName]);
        } else {
          reject(new Error(`${pluginName} 插件已回调，但构造器不可用`));
        }
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    }
  });
}

async function initMap() {
  if (!state.config?.amapKey) {
    renderFallback();
    setStatus('演示地图 · 添加高德 Key 后启用真实地图', false);
    return;
  }
  try {
    const AMap = await loadAmap(state.config.amapKey, state.config.amapSecurityCode);
    $('#map').innerHTML = '';
    state.map = new AMap.Map('map', {
      center: [118.7969, 32.0603],
      zoom: 11.7,
      mapStyle: 'amap://styles/whitesmoke',
      viewMode: '2D',
      showLabel: true,
      resizeEnable: true
    });
    state.usingFallback = false;
    renderMarkers();
    setStatus(`${state.filtered.length} 个精选地点`, true);

    // Scale 属于高德插件。必须等 AMap.plugin 回调后再实例化；
    // 插件失败不应让整张地图退回演示模式。
    try {
      const Scale = await loadAmapPlugin(AMap, 'AMap.Scale');
      state.map.addControl(new Scale());
    } catch (pluginError) {
      console.warn('[AMap.Scale]', pluginError);
    }
  } catch (error) {
    console.error('[AMap]', error);
    renderFallback();
    const reason = error instanceof Error ? error.message : '未知错误';
    setStatus(`高德加载失败：${reason}`, false);
    $('#mapStatus').title = reason;
  }
}

function wireEvents() {
  $('#brandButton').addEventListener('click', () => {
    state.activeFilter = 'all';
    state.search = '';
    $('#searchInput').value = '';
    renderFilters();
    applyFilters();
    closeDetail();
    if (!state.usingFallback && state.map) state.map.setZoomAndCenter(11.7, [118.7969, 32.0603]);
  });
  $('#searchToggle').addEventListener('click', () => {
    $('#searchStrip').hidden = false;
    setTimeout(() => $('#searchInput').focus(), 20);
  });
  $('#searchClose').addEventListener('click', () => {
    $('#searchStrip').hidden = true;
    state.search = '';
    $('#searchInput').value = '';
    applyFilters();
  });
  $('#searchInput').addEventListener('input', (event) => {
    state.search = event.target.value;
    applyFilters();
  });
  $('#favoriteToggle').addEventListener('click', () => {
    renderFavorites();
    openModal('favoriteModal');
  });
  $('#submitOpen').addEventListener('click', () => openModal('submitModal'));
  $('#detailClose').addEventListener('click', closeDetail);
  $('#locationButton').addEventListener('click', locateUser);
  $('#photoInput').addEventListener('change', handlePhotos);
  $('#submissionForm').addEventListener('submit', submitPlace);
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.closeModal).close()));
  $$('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#detailSheet').classList.contains('open')) closeDetail();
  });
}

async function init() {
  wireEvents();
  renderFilters();
  try {
    const [config, placesPayload] = await Promise.all([api('/api/config'), api('/api/places')]);
    state.config = config;
    state.places = placesPayload.places || [];
    $('#appName').textContent = config.appName;
    $('#appNameEn').textContent = config.appNameEn;
    document.title = config.appName;
    applyFilters();
    await initMap();
  } catch (error) {
    renderFallback();
    $('#placeList').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br>请稍后刷新页面。</div>`;
    setStatus('数据加载失败', false);
  }
}

init();
