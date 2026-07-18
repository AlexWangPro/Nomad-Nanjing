import { mountLocationPicker } from './location-picker.js?v=2.3.0';

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
  photoData: [],
  amapDiagnostics: [],
  submissionLocationPicker: null,
  submissionStep: 1
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

function categoryIconHtml(category) {
  const icons = {
    coffee: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h11v5.5A4.5 4.5 0 0 1 11.5 18h-2A4.5 4.5 0 0 1 5 13.5V8Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M7 5.5c0-1 1-1.2 1-2.2M11 5.5c0-1 1-1.2 1-2.2"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5c2.8-.7 5-.2 7.5 1.5v12c-2.5-1.7-4.7-2.2-7.5-1.5v-12Z"/><path d="M19.5 5.5c-2.8-.7-5-.2-7.5 1.5v12c2.5-1.7 4.7-2.2 7.5-1.5v-12Z"/></svg>',
    coworking: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2.8 19h18.4M9 16v3M15 16v3"/></svg>',
    public: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20v-7h12v7M8 13V9h8v4M10 9V5h4v4"/></svg>',
    hotel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19v-7h16v7M6 12V8.5A2.5 2.5 0 0 1 8.5 6h7A2.5 2.5 0 0 1 18 8.5V12M4 16h16M7 19v2M17 19v2"/></svg>'
  };
  return icons[category] || '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.8 7-12a7 7 0 1 0-14 0c0 6.2 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
}

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
        <span class="category-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>
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
  return `<div class="map-marker category-${escapeHtml(place.category)} ${place.featured ? 'featured' : ''} ${place.verified ? '' : 'unverified'}" data-marker-id="${escapeHtml(place.id)}">
    <span class="map-marker-halo" aria-hidden="true"></span>
    <span class="map-marker-pin"><span class="map-marker-icon">${categoryIconHtml(place.category)}</span></span>
    <span class="map-marker-label">${escapeHtml(place.name)}</span>
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
  $$('.place-card.selected').forEach((item) => item.classList.remove('selected'));
  const activeCard = document.querySelector(`.place-card[data-place-id="${CSS.escape(id)}"]`);
  activeCard?.classList.add('selected');
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
  $$('.place-card.selected').forEach((item) => item.classList.remove('selected'));
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
      <span class="category-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>
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


function setSubmissionStep(step) {
  state.submissionStep = Math.max(1, Math.min(3, Number(step) || 1));
  const stepFeedback = $('#submissionStepFeedback');
  if (stepFeedback) { stepFeedback.textContent = ''; stepFeedback.className = 'form-feedback submission-step-feedback'; }
  $$('[data-submit-step]').forEach((section) => section.classList.toggle('active', Number(section.dataset.submitStep) === state.submissionStep));
  $$('[data-progress-step]').forEach((node) => {
    const value = Number(node.dataset.progressStep);
    node.classList.toggle('active', value === state.submissionStep);
    node.classList.toggle('done', value < state.submissionStep);
  });
  if (state.submissionStep === 3) updateSubmissionSummary();
  $('#submissionForm')?.scrollTo?.({ top: 0, behavior: 'smooth' });
}

function selectedText(name) {
  const input = $(`#submissionForm [name="${name}"]:checked`);
  return input?.closest('label')?.querySelector('span')?.textContent?.trim() || '';
}

function updateSubmissionSummary() {
  const form = $('#submissionForm');
  const node = $('#submissionSummary');
  if (!form || !node) return;
  const name = form.elements.placeName.value || '尚未选择地点';
  const rows = [
    ['地点', name],
    ['总体结论', selectedText('overallSuitability')],
    ['办公时长', selectedText('workDurationChoice')],
    ['安静 / Wi-Fi', [selectedText('quietChoice'), selectedText('wifiChoice')].filter(Boolean).join(' · ')],
    ['插座 / 通话', [selectedText('outletsChoice'), selectedText('callChoice')].filter(Boolean).join(' · ')]
  ];
  node.innerHTML = `<strong>提交摘要</strong>${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value || '未回答')}</b></div>`).join('')}`;
}

function syncPublicLocationFields() {
  const form = $('#submissionForm');
  const selected = state.submissionLocationPicker?.getValue?.();
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

function validateSubmissionStep(step) {
  const form = $('#submissionForm');
  const feedback = $('#submissionStepFeedback');
  feedback.className = 'form-feedback submission-step-feedback';
  feedback.textContent = '';
  if (step === 1) {
    syncPublicLocationFields();
    if (!form.elements.email.checkValidity()) {
      form.elements.email.reportValidity();
      return false;
    }
    if (!form.elements.lng.value || !form.elements.lat.value || !form.elements.address.value || !form.elements.placeName.value) {
      feedback.classList.add('error');
      feedback.textContent = '请先搜索店名，并选择一个具体高德地点。';
      return false;
    }
  }
  if (step === 2) {
    for (const name of ['visitRecency', 'workDurationChoice', 'overallSuitability']) {
      if (!form.querySelector(`[name="${name}"]:checked`)) {
        feedback.classList.add('error');
        feedback.textContent = '请完成带 * 的快速选择。';
        return false;
      }
    }
  }
  return true;
}

const MAX_PHOTOS = 8;
const TARGET_PHOTO_BYTES = 100 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {}
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

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('当前浏览器无法生成 WebP 图片')), 'image/webp', quality);
  });
}

async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} 超过 20MB，请先裁剪后重试`);

  const source = await decodeImage(file);
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
        const blob = await canvasToBlob(canvas, quality);
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= TARGET_PHOTO_BYTES) {
          return {
            id: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            dataUrl: await blobToDataUrl(blob),
            size: blob.size,
            originalName: file.name,
            width,
            height
          };
        }
      }
    }
  } finally {
    source.close?.();
  }

  if (smallest && smallest.size <= TARGET_PHOTO_BYTES) {
    return {
      id: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      dataUrl: await blobToDataUrl(smallest),
      size: smallest.size,
      originalName: file.name,
      width: 0,
      height: 0
    };
  }
  throw new Error(`${file.name} 无法压缩到 100KB 内，请换一张或先裁剪`);
}

function renderPhotoPreview() {
  const preview = $('#photoPreview');
  $('#photoCount').textContent = `${state.photoData.length} / ${MAX_PHOTOS}`;
  if (!state.photoData.length) {
    preview.innerHTML = '<span class="photo-empty">尚未选择图片</span>';
    return;
  }
  preview.innerHTML = state.photoData.map((photo, index) => `
    <figure class="photo-item">
      <img src="${photo.dataUrl}" alt="现场图片 ${index + 1}" />
      <button type="button" class="photo-remove" data-photo-remove="${photo.id}" aria-label="删除第 ${index + 1} 张图片">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
      <figcaption>${Math.ceil(photo.size / 1024)}KB · WebP</figcaption>
    </figure>
  `).join('');
}

async function handlePhotos(event) {
  const input = event.target;
  const processing = $('#photoProcessing');
  const available = MAX_PHOTOS - state.photoData.length;
  const selected = [...input.files];
  input.value = '';
  if (!selected.length) return;
  if (available <= 0) return showToast('最多上传 8 张图片');

  const files = selected.slice(0, available);
  if (selected.length > available) showToast(`最多 8 张，本次只添加前 ${available} 张`);
  processing.textContent = `正在处理 0 / ${files.length} 张…`;

  let added = 0;
  const errors = [];
  for (let index = 0; index < files.length; index += 1) {
    processing.textContent = `正在转成 WebP 并压缩：${index + 1} / ${files.length}`;
    try {
      const photo = await compressPhoto(files[index]);
      state.photoData.push(photo);
      added += 1;
      renderPhotoPreview();
    } catch (error) {
      errors.push(error.message);
    }
  }

  processing.textContent = added ? `已添加 ${added} 张，均已压缩到 100KB 内。` : '';
  if (errors.length) showToast(errors[0]);
}

function removePhoto(photoId) {
  state.photoData = state.photoData.filter((photo) => photo.id !== photoId);
  renderPhotoPreview();
  $('#photoProcessing').textContent = state.photoData.length ? '可以继续添加或删除图片。' : '';
}

async function ensurePublicLocationPicker() {
  const root = $('#publicLocationPicker');
  if (!root || state.submissionLocationPicker) {
    state.submissionLocationPicker?.map?.resize?.();
    return;
  }
  const status = $('[data-location-status]', root);
  try {
    state.submissionLocationPicker = await mountLocationPicker({
      root,
      amapKey: state.config?.amapKey,
      initial: {},
      city: '南京'
    });
  } catch (error) {
    status.textContent = `位置选择器加载失败：${error.message}`;
    throw error;
  }
}

async function submitPlace(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#submitButton');
  const feedback = $('#submissionFeedback');
  feedback.className = 'form-feedback';
  feedback.textContent = '';
  if (!validateSubmissionStep(1) || !validateSubmissionStep(2)) return;
  syncPublicLocationFields();
  const data = Object.fromEntries(new FormData(form).entries());
  data.actualWorked = data.actualWorked !== 'false';
  data.photos = state.photoData.map((photo) => photo.dataUrl);
  button.disabled = true;
  button.textContent = '正在提交…';
  try {
    const result = await api('/api/submissions', { method: 'POST', body: JSON.stringify(data) });
    feedback.classList.add('success');
    feedback.textContent = result.message || '已提交，正在等待管理员审核。';
    form.reset();
    state.submissionLocationPicker?.reset?.();
    state.photoData = [];
    renderPhotoPreview();
    $('#photoProcessing').textContent = '';
    setSubmissionStep(1);
    $('#submitModal').close();
    openModal('submissionSuccessModal');
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

function isIpHostname(hostname) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost';
}

function recordAmapDiagnostic(message) {
  const text = String(message || '').trim();
  if (!text || state.amapDiagnostics.includes(text)) return;
  state.amapDiagnostics.push(text);
  console.warn('[AMap diagnostic]', text);
}

function waitForMapReady(map, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = window.setTimeout(() => {
      const hasMapSurface = Boolean(document.querySelector('#map .amap-maps, #map canvas, #map .amap-layer'));
      if (hasMapSurface) finish(resolve, true);
      else finish(reject, new Error('高德 SDK 已初始化，但底图未完成渲染'));
    }, timeoutMs);

    try {
      map.on('complete', () => finish(resolve, true));
      requestAnimationFrame(() => {
        try { map.resize(); } catch {}
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function loadExternalScript(src, id, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`${id} 加载失败`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error(`${id} 加载超时`));
    }, timeoutMs);

    script.id = id;
    script.charset = 'utf-8';
    script.src = src;
    script.onload = () => {
      window.clearTimeout(timer);
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(`${id} 无法访问`));
    };
    document.head.appendChild(script);
  });
}

async function loadAmap(key) {
  if (window.AMap) return window.AMap;

  const cleanKey = String(key || '').trim().replace(/^['"]|['"]$/g, '');
  if (!cleanKey) throw new Error('未读取到 AMAP_JS_KEY');

  // 使用高德官方推荐的 Loader，并把安全密钥留在服务器端代理中。
  window._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/_AMapService`
  };

  await loadExternalScript('https://webapi.amap.com/loader.js', 'amap-loader');
  if (!window.AMapLoader?.load) {
    throw new Error('高德 Loader 已下载，但 AMapLoader 未生成');
  }

  return window.AMapLoader.load({
    key: cleanKey,
    version: '2.0',
    plugins: []
  });
}


async function initMap() {
  if (!state.config?.amapKey) {
    renderFallback();
    setStatus('演示地图 · 添加高德 Key 后启用真实地图', false);
    return;
  }

  try {
    const AMap = await loadAmap(state.config.amapKey);
    $('#map').innerHTML = '';

    const map = new AMap.Map('map', {
      center: [118.7969, 32.0603],
      zoom: 11.7,
      zooms: [9, 18],
      viewMode: '2D',
      mapStyle: 'amap://styles/whitesmoke',
      features: ['bg', 'road', 'building', 'point'],
      showLabel: true,
      showIndoorMap: false,
      resizeEnable: true,
      animateEnable: true,
      jogEnable: false
    });

    state.map = map;
    state.usingFallback = false;
    renderMarkers();

    await waitForMapReady(map);
    setStatus(`${state.filtered.length} 个精选地点`, true);
  } catch (error) {
    console.error('[AMap]', error);
    recordAmapDiagnostic(error instanceof Error ? error.message : error);
    try { state.map?.destroy?.(); } catch {}
    state.map = null;
    renderFallback();
    const reason = error instanceof Error ? error.message : '未知错误';
    let diagnosticText = '';
    try {
      const diagnostic = await api('/api/amap-check');
      if (!diagnostic.ok) {
        diagnosticText = ` · ${diagnostic.info || diagnostic.message || diagnostic.detail || '高德验证失败'}${diagnostic.infocode ? ` (${diagnostic.infocode})` : ''}`;
      }
    } catch {}
    setStatus(`高德加载失败：${reason}${diagnosticText}`, false);
    $('#mapStatus').title = `${reason}${diagnosticText}`;
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
  $('#submitOpen').addEventListener('click', async () => {
    setSubmissionStep(1);
    openModal('submitModal');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try { await ensurePublicLocationPicker(); } catch (error) { showToast(error.message); }
  });
  $('#detailClose').addEventListener('click', closeDetail);
  $('#locationButton').addEventListener('click', locateUser);
  $('#photoInput').addEventListener('change', handlePhotos);
  $('#photoPreview').addEventListener('click', (event) => {
    const button = event.target.closest('[data-photo-remove]');
    if (button) removePhoto(button.dataset.photoRemove);
  });
  $('#submissionForm').addEventListener('submit', submitPlace);
  $$('[data-submit-next]').forEach((button) => button.addEventListener('click', () => { if (validateSubmissionStep(state.submissionStep)) setSubmissionStep(state.submissionStep + 1); }));
  $$('[data-submit-back]').forEach((button) => button.addEventListener('click', () => setSubmissionStep(state.submissionStep - 1)));
  $('#submissionForm').addEventListener('change', () => { if (state.submissionStep === 3) updateSubmissionSummary(); });
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
  renderPhotoPreview();
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

window.addEventListener('error', (event) => {
  const source = String(event.filename || '');
  const message = String(event.message || '');
  if (/amap|autonavi|高德/i.test(`${source} ${message}`)) {
    recordAmapDiagnostic(message || source || '高德脚本错误');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason?.message || String(event.reason || '');
  if (/amap|autonavi|高德/i.test(message)) recordAmapDiagnostic(message);
});

init();
