import { mountLocationPicker } from './location-picker.js?v=4.1.0';
import { compressImageForUpload } from './image-compression.js?v=4.1.0';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function safeLocalJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

const state = {
  config: null,
  places: [],
  filtered: [],
  selected: null,
  activeFilter: 'all',
  search: '',
  favorites: new Set(safeLocalJson('nwm-favorites', [])),
  officeLists: safeLocalJson('nwm-office-lists', [{ id: 'want', name: '想去', placeIds: [] }]),
  activeSavedList: 'favorites',
  listPickerPlaceId: null,
  recommendScene: 'balanced',
  map: null,
  markers: new Map(),
  usingFallback: true,
  userPosition: null,
  photoData: [],
  reviewPhotos: [],
  placesRevision: 0,
  placesSyncInFlight: false,
  amapDiagnostics: [],
  submissionLocationPicker: null,
  submissionStep: 1,
  imageViewer: { images: [], index: 0, placeName: '', touchStartX: 0, touchStartY: 0 }
};

const filters = [
  { id: 'all', label: '全部' },
  { id: 'deep', label: '深度工作' },
  { id: 'zoom', label: 'Zoom / 通话' },
  { id: 'long', label: '坐 3h+' },
  { id: 'free', label: '免费办公' },
  { id: 'metro', label: '地铁附近' },
  { id: 'coffee', label: '咖啡馆' },
  { id: 'library', label: '图书馆' },
  { id: 'coworking', label: '共享办公' },
  { id: 'hotel', label: '酒店大堂' },
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

function ratingStars(rating = 0) {
  const rounded = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return `<span class="rating-stars" aria-label="${rounded} 星">${'★'.repeat(rounded)}${'☆'.repeat(5 - rounded)}</span>`;
}

function formatReviewDate(value) {
  try {
    return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}


function normalizeOfficeLists() {
  const input = Array.isArray(state.officeLists) ? state.officeLists : [];
  const seen = new Set();
  state.officeLists = input.map((list) => ({
    id: String(list?.id || '').trim(),
    name: String(list?.name || '').trim().slice(0, 32),
    placeIds: [...new Set(Array.isArray(list?.placeIds) ? list.placeIds.map(String) : [])]
  })).filter((list) => list.id && list.name && !seen.has(list.id) && seen.add(list.id));
  if (!state.officeLists.length) state.officeLists = [{ id: 'want', name: '想去', placeIds: [] }];
  persistOfficeLists();
}

function persistOfficeLists() {
  try { localStorage.setItem('nwm-office-lists', JSON.stringify(state.officeLists)); } catch {}
}

function createOfficeList(name) {
  const cleanName = String(name || '').trim().slice(0, 32);
  if (!cleanName) return null;
  const existing = state.officeLists.find((list) => list.name === cleanName);
  if (existing) return existing;
  const id = `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const list = { id, name: cleanName, placeIds: [] };
  state.officeLists.push(list);
  persistOfficeLists();
  return list;
}

function getSavedListDescriptor(id) {
  if (id === 'favorites') return { id: 'favorites', name: '收藏', placeIds: [...state.favorites], builtIn: true };
  const list = state.officeLists.find((item) => item.id === id);
  return list ? { ...list, builtIn: false } : { id: 'favorites', name: '收藏', placeIds: [...state.favorites], builtIn: true };
}

function placeIsInList(placeId, listId) {
  if (listId === 'favorites') return state.favorites.has(placeId);
  return state.officeLists.find((list) => list.id === listId)?.placeIds.includes(placeId) || false;
}

function togglePlaceInList(placeId, listId) {
  if (listId === 'favorites') {
    toggleFavorite(placeId);
    return;
  }
  const list = state.officeLists.find((item) => item.id === listId);
  if (!list) return;
  if (list.placeIds.includes(placeId)) list.placeIds = list.placeIds.filter((id) => id !== placeId);
  else list.placeIds.push(placeId);
  persistOfficeLists();
  renderFavorites();
  renderListPicker();
  showToast(list.placeIds.includes(placeId) ? `已加入「${list.name}」` : `已从「${list.name}」移除`);
}

function deleteOfficeList(listId) {
  const list = state.officeLists.find((item) => item.id === listId);
  if (!list) return;
  state.officeLists = state.officeLists.filter((item) => item.id !== listId);
  persistOfficeLists();
  state.activeSavedList = 'favorites';
  renderFavorites();
  showToast(`已删除清单「${list.name}」`);
}

function haversineKm(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const [lng1, lat1] = a.map(Number);
  const [lng2, lat2] = b.map(Number);
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function distanceText(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 50) * 50)}m`;
  return `${km.toFixed(km < 10 ? 1 : 0)}km`;
}

function wifiScore(place) {
  const text = String(place.wifi || '');
  if (/高速|稳定|fast|stable/i.test(text)) return 1;
  if (/需验证|待确认|需询问/.test(text)) return .3;
  return .55;
}

function outletScore(place) {
  const text = String(place.outlets || '');
  if (/充足|每席位|较多/.test(text)) return 1;
  if (/靠墙|部分|一般/.test(text)) return .65;
  if (/少量|较少/.test(text)) return .25;
  return .4;
}

function recommendationScore(place, scene = 'balanced') {
  const quiet = Math.max(1, Math.min(5, Number(place.quietLevel) || 3));
  const rating = Number(place.ratingAverage) || 0;
  const ratingCount = Number(place.ratingCount) || 0;
  const distance = state.userPosition ? haversineKm(state.userPosition, [place.lng, place.lat]) : null;
  let score = 0;
  score += quiet * 4;
  score += wifiScore(place) * 12;
  score += outletScore(place) * 10;
  score += place.verified ? 8 : 0;
  score += place.featured ? 4 : 0;
  score += rating ? rating * 3 + Math.min(5, ratingCount) : 0;
  if (Number.isFinite(distance)) score += Math.max(-12, 24 - distance * 4.5);

  if (scene === 'deep') {
    score += quiet * 10;
    score += place.callFriendly ? -2 : 8;
    score += wifiScore(place) * 8;
  } else if (scene === 'zoom') {
    score += place.callFriendly ? 35 : -28;
    score += wifiScore(place) * 20;
    score += quiet >= 3 ? 6 : -4;
    if (place.category === 'coworking' || place.category === 'hotel') score += 8;
  } else if (scene === 'long') {
    score += place.unlimited ? 28 : -8;
    score += outletScore(place) * 18;
    score += wifiScore(place) * 14;
    score += quiet * 4;
  } else if (scene === 'free') {
    score += place.free ? 45 : -30;
    if (place.category === 'library' || place.category === 'public') score += 10;
    score += quiet * 5;
  } else {
    score += place.callFriendly ? 4 : 0;
    score += place.unlimited ? 6 : 0;
  }
  return { score, distance };
}

function recommendationReasons(place, scene) {
  const reasons = [];
  if (scene === 'deep' && Number(place.quietLevel) >= 4) reasons.push('安静');
  if (scene === 'zoom' && place.callFriendly) reasons.push('适合通话');
  if (scene === 'long' && place.unlimited) reasons.push('适合久坐');
  if (scene === 'free' && place.free) reasons.push('免费');
  if (wifiScore(place) >= .9) reasons.push('Wi-Fi 稳定');
  if (outletScore(place) >= .65) reasons.push('有插座');
  if (place.verified) reasons.push('已验证');
  if (!reasons.length) reasons.push(categoryLabel[place.category] || '办公地点');
  return reasons.slice(0, 3);
}

function renderRecommendations() {
  const results = $('#recommendResults');
  if (!results) return;
  const candidates = state.places.filter((place) => Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat)));
  if (!candidates.length) {
    results.innerHTML = '<div class="recommend-empty">目前还没有足够的地点数据来推荐。</div>';
    return;
  }
  const ranked = candidates.map((place) => ({ place, ...recommendationScore(place, state.recommendScene) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  results.innerHTML = `<div class="recommend-result-heading"><strong>今天优先考虑这 3 个</strong><span>${state.userPosition ? '已计入距离' : '未开启定位，按地点质量排序'}</span></div>${ranked.map(({ place, distance }, index) => `
    <button class="recommend-result-card" type="button" data-recommend-place="${escapeHtml(place.id)}">
      ${place.images?.[0] ? `<img src="${escapeHtml(place.images[0])}" alt="" loading="lazy" />` : `<span class="recommend-result-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>`}
      <span class="recommend-result-copy"><small>推荐 ${index + 1}${Number.isFinite(distance) ? ` · ${distanceText(distance)}` : ''}</small><strong>${escapeHtml(place.name)}</strong><span>${recommendationReasons(place, state.recommendScene).map((item) => `<em>${escapeHtml(item)}</em>`).join('')}</span><b>${escapeHtml(place.address || place.district || '南京')}</b></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </button>`).join('')}`;
  $$('[data-recommend-place]', results).forEach((button) => button.addEventListener('click', () => {
    $('#recommendModal').close();
    selectPlace(button.dataset.recommendPlace, true);
  }));
}

function openRecommendations() {
  $$('#recommendScenes [data-recommend-scene]').forEach((button) => button.classList.toggle('active', button.dataset.recommendScene === state.recommendScene));
  $('#recommendLocationLabel').textContent = state.userPosition ? '已使用当前位置参与推荐' : '还没有使用当前位置';
  renderRecommendations();
  openModal('recommendModal');
}

function locateForRecommendation() {
  if (!navigator.geolocation) return showToast('当前浏览器不支持定位');
  const button = $('#recommendLocateButton');
  button.disabled = true;
  button.textContent = '定位中…';
  navigator.geolocation.getCurrentPosition((position) => {
    state.userPosition = [position.coords.longitude, position.coords.latitude];
    $('#recommendLocationLabel').textContent = '已使用当前位置参与推荐';
    button.disabled = false;
    button.textContent = '重新定位';
    renderRecommendations();
    if (!state.usingFallback && state.map) state.map.setZoomAndCenter(13.5, state.userPosition);
  }, () => {
    button.disabled = false;
    button.textContent = '使用当前位置';
    showToast('定位失败，请检查浏览器位置权限');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function renderSavedListTabs() {
  const tabs = $('#savedListTabs');
  if (!tabs) return;
  const descriptors = [{ id: 'favorites', name: '收藏', count: state.favorites.size, builtIn: true }, ...state.officeLists.map((list) => ({ ...list, count: list.placeIds.length, builtIn: false }))];
  if (!descriptors.some((item) => item.id === state.activeSavedList)) state.activeSavedList = 'favorites';
  tabs.innerHTML = descriptors.map((list) => `<button type="button" class="${state.activeSavedList === list.id ? 'active' : ''}" data-saved-list="${escapeHtml(list.id)}"><span>${escapeHtml(list.name)}</span><small>${list.count}</small></button>`).join('');
  $$('[data-saved-list]', tabs).forEach((button) => button.addEventListener('click', () => {
    state.activeSavedList = button.dataset.savedList;
    renderFavorites();
  }));
}

function renderListPicker() {
  const root = $('#listPickerOptions');
  if (!root) return;
  const placeId = state.listPickerPlaceId;
  if (!placeId) { root.innerHTML = ''; return; }
  root.innerHTML = state.officeLists.map((list) => {
    const active = list.placeIds.includes(placeId);
    return `<button type="button" class="${active ? 'active' : ''}" data-picker-list="${escapeHtml(list.id)}"><span><strong>${escapeHtml(list.name)}</strong><small>${list.placeIds.length} 个地点</small></span><i>${active ? '✓' : '+'}</i></button>`;
  }).join('') || '<div class="favorite-empty">还没有自定义清单。请先在“我的办公清单”中新建一个。</div>';
  $$('[data-picker-list]', root).forEach((button) => button.addEventListener('click', () => togglePlaceInList(placeId, button.dataset.pickerList)));
}

function openListPicker(place) {
  state.listPickerPlaceId = place.id;
  $('#listPickerPlaceName').textContent = place.name;
  renderListPicker();
  openModal('listPickerModal');
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, h, radius);
  if (!ctx.roundRect) {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
  }
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const chars = [...String(text || '')];
  let line = '';
  let lineNo = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineNo * lineHeight);
      line = chars[i];
      lineNo += 1;
      if (lineNo >= maxLines) return y + lineNo * lineHeight;
    } else line = test;
  }
  if (line && lineNo < maxLines) {
    ctx.fillText(line, x, y + lineNo * lineHeight);
    lineNo += 1;
  }
  return y + lineNo * lineHeight;
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

async function makeShareCardBlob(place) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#edf4ef';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  roundedRectPath(ctx, 48, 48, 984, 1254, 52);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(48, 48, 984, 1254);

  const coverY = 48;
  const coverH = 560;
  let imageLoaded = false;
  if (place.images?.[0]) {
    try {
      const image = await loadCanvasImage(place.images[0]);
      drawCover(ctx, image, 48, coverY, 984, coverH);
      imageLoaded = true;
    } catch {}
  }
  if (!imageLoaded) {
    ctx.fillStyle = '#dce9e1';
    ctx.fillRect(48, coverY, 984, coverH);
    ctx.fillStyle = '#1f6b52';
    ctx.font = '700 72px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(categoryLabel[place.category] || '南京办公地点', 540, 330);
  }
  const gradient = ctx.createLinearGradient(0, coverY + 300, 0, coverY + coverH);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,.48)');
  ctx.fillStyle = gradient;
  ctx.fillRect(48, coverY, 984, coverH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = '800 34px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  ctx.fillText('NOMAD NANJING', 92, 120);
  ctx.font = '600 22px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  ctx.fillText('南京数字游民办公地图', 92, 158);

  ctx.fillStyle = '#16231d';
  ctx.font = '800 58px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  let y = wrapCanvasText(ctx, place.name, 92, 690, 880, 72, 2) + 20;
  ctx.font = '500 28px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  ctx.fillStyle = '#617168';
  y = wrapCanvasText(ctx, place.address || place.district || '南京', 92, y, 880, 42, 2) + 24;

  if (place.ratingCount) {
    ctx.fillStyle = '#a96f12';
    ctx.font = '800 34px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
    ctx.fillText(`★ ${Number(place.ratingAverage).toFixed(1)}  ·  ${place.ratingCount} 条点评`, 92, y);
    y += 58;
  }

  const tags = [...new Set([
    Number(place.quietLevel) >= 4 ? '适合深度工作' : '',
    place.callFriendly ? '可 Zoom / 通话' : '',
    outletScore(place) >= .65 ? '有插座' : '',
    wifiScore(place) >= .9 ? 'Wi-Fi 稳定' : '',
    place.free ? '免费' : '',
    place.unlimited ? '适合久坐' : ''
  ].filter(Boolean))].slice(0, 4);
  ctx.font = '700 24px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  let tagX = 92;
  let tagY = y;
  for (const tag of tags) {
    const width = ctx.measureText(tag).width + 40;
    if (tagX + width > 980) { tagX = 92; tagY += 58; }
    ctx.fillStyle = '#e6f1eb';
    roundedRectPath(ctx, tagX, tagY - 31, width, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#1f6b52';
    ctx.fillText(tag, tagX + 20, tagY);
    tagX += width + 14;
  }

  ctx.fillStyle = '#edf4ef';
  ctx.fillRect(48, 1160, 984, 142);
  ctx.fillStyle = '#1f6b52';
  ctx.font = '800 30px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  ctx.fillText('在南京，找到适合打开电脑的地方', 92, 1218);
  ctx.fillStyle = '#617168';
  ctx.font = '600 23px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  ctx.fillText(window.location.host || 'nomadnanjing.com', 92, 1262);
  ctx.restore();

  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成分享卡片失败')), 'image/png', 0.96));
}

async function sharePlaceCard(place) {
  showToast('正在生成分享卡片…');
  try {
    const blob = await makeShareCardBlob(place);
    const safeName = String(place.name || 'nomad-nanjing').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40);
    const file = new File([blob], `${safeName}-Nomad-Nanjing.png`, { type: 'image/png' });
    const shareUrl = `${window.location.origin}${window.location.pathname}?place=${encodeURIComponent(place.id)}`;
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: place.name, text: `${place.name} · Nomad Nanjing\n${shareUrl}`, files: [file] });
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    try { await navigator.clipboard?.writeText(shareUrl); } catch {}
    showToast('分享卡片已保存，地点链接也已复制');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    showToast(error.message || '分享卡片生成失败');
  }
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
    case 'coworking':
    case 'hotel': return place.category === state.activeFilter;
    case 'deep': return Number(place.quietLevel) >= 4;
    case 'zoom': return place.callFriendly === true;
    case 'long': return place.unlimited === true || /充足|每席位|较多|靠墙/.test(place.outlets || '');
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
    <button class="place-card ${place.images?.length ? 'has-photo' : ''}" type="button" data-place-id="${escapeHtml(place.id)}">
      <div class="place-card-top">
        ${place.images?.length ? `
          <span class="place-card-thumb">
            <img src="${escapeHtml(place.images[0])}" alt="${escapeHtml(place.name)}现场照片" loading="lazy" />
            <span class="place-card-thumb-badge category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>
          </span>` : `<span class="category-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>`}
        <span class="place-card-copy">
          <h3>${escapeHtml(place.name)}</h3>
          <span class="place-meta">
            <span>${escapeHtml(place.metroStation || place.district || '南京')}</span>
            ${place.metroMinutes != null ? `<span>步行 ${place.metroMinutes} 分钟</span>` : ''}
            <span>${escapeHtml(place.price || '待确认')}</span>
            ${place.ratingCount ? `<span class="place-card-rating">★ ${Number(place.ratingAverage).toFixed(1)} · ${place.ratingCount}</span>` : ''}
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
  const images = Array.isArray(place.images) ? place.images.filter(Boolean).slice(0, 8) : [];
  const navigateUrl = `https://uri.amap.com/marker?position=${encodeURIComponent(`${place.lng},${place.lat}`)}&name=${encodeURIComponent(place.name)}&coordinate=gaode&callnative=1`;
  $('#detailContent').innerHTML = `
    <div class="detail-kicker">
      <span class="detail-badge">${escapeHtml(categoryLabel[place.category] || '地点')}</span>
      ${tags.slice(0,2).map((tag) => `<span class="detail-badge">${tag.label}</span>`).join('')}
      ${place.isDemo ? '<span class="detail-badge demo">示例数据</span>' : ''}
    </div>
    <h2 class="detail-title">${escapeHtml(place.name)}</h2>
    <div class="detail-subtitle">${escapeHtml(place.address || '')}${place.metroStation ? ` · 距 ${escapeHtml(place.metroStation)}步行约 ${escapeHtml(place.metroMinutes ?? '?')} 分钟` : ''}</div>
    ${place.placeNote ? `<div class="place-location-note"><strong>位置备注</strong><span>${escapeHtml(place.placeNote)}</span></div>` : ''}
    <div class="community-rating-card">
      <div class="community-rating-score">
        ${place.ratingCount ? `<strong>${Number(place.ratingAverage).toFixed(1)}</strong>${ratingStars(place.ratingAverage)}<small>${place.ratingCount} 条已审核点评</small>` : `<strong>新地点</strong><span class="rating-empty">还没有公开点评</span>`}
      </div>
      <button class="secondary-button review-open-button" id="detailReviewButton" type="button">点评 / 打星</button>
    </div>
    ${images.length ? `
      <div class="detail-photo-heading"><strong>现场照片</strong><span>${images.length} 张</span></div>
      <div class="detail-photo-grid count-${Math.min(images.length, 4)}">
        ${images.map((src, index) => `
          <button type="button" class="detail-photo" data-view-image-index="${index}" aria-label="查看第 ${index + 1} 张现场照片">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(place.name)}现场照片 ${index + 1}" loading="lazy" />
          </button>`).join('')}
      </div>` : ''}
    <div class="detail-actions detail-actions-v4">
      <a class="primary-button detail-nav-action" href="${navigateUrl}" target="_blank" rel="noreferrer">高德导航</a>
      <button class="secondary-button favorite-action ${isSaved ? 'saved' : ''}" id="detailFavorite" type="button" aria-label="${isSaved ? '取消收藏' : '收藏地点'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.5c0 5.1-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.5A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.8Z"/></svg>
      </button>
      <button class="secondary-button detail-utility-action" id="detailListButton" type="button">清单</button>
      <button class="secondary-button detail-utility-action" id="detailShareButton" type="button">分享卡片</button>
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
    <div class="detail-section community-review-section">
      <div class="detail-section-heading"><h4>社区点评</h4><span>${place.ratingCount || 0} 条</span></div>
      ${place.reviews?.length ? `<div class="community-review-list">${place.reviews.map((review) => `<article class="community-review"><div><strong>${escapeHtml(review.name || '南京工作者')}</strong>${ratingStars(review.rating)}<time>${escapeHtml(formatReviewDate(review.createdAt))}</time></div>${review.comment ? `<p>${escapeHtml(review.comment)}</p>` : '<p class="muted-review">只留下了星级评分。</p>'}${review.images?.length ? `<div class="community-review-images">${review.images.map((src,index) => `<button type="button" data-review-image-id="${escapeHtml(review.id)}" data-review-image-index="${index}"><img src="${escapeHtml(src)}" alt="${escapeHtml(review.name || '用户')}点评照片 ${index+1}" loading="lazy" /></button>`).join('')}</div>` : ''}</article>`).join('')}</div>` : '<p class="empty-review-copy">还没有审核通过的点评。你可以成为第一个留下真实体验的人。</p>'}
    </div>
    ${place.isDemo ? '<div class="detail-footnote">本条为首版界面演示数据，正式公开前请在后台替换为经过核实的真实地点。</div>' : ''}
  `;
  $('#detailFavorite').addEventListener('click', () => toggleFavorite(place.id));
  $('#detailListButton')?.addEventListener('click', () => openListPicker(place));
  $('#detailShareButton')?.addEventListener('click', () => sharePlaceCard(place));
  $('#detailReviewButton')?.addEventListener('click', () => openReviewModal(place));
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
  try { localStorage.setItem('nwm-favorites', JSON.stringify([...state.favorites])); } catch {}
  if (state.selected?.id === id) renderDetail(state.selected);
  renderFavorites();
  renderListPicker();
  showToast(state.favorites.has(id) ? '已加入收藏' : '已取消收藏');
}

function renderFavorites() {
  renderSavedListTabs();
  const listNode = $('#favoriteList');
  const descriptor = getSavedListDescriptor(state.activeSavedList);
  const ids = descriptor.placeIds;
  const items = ids.map((id) => state.places.find((place) => place.id === id)).filter(Boolean);
  if (!items.length) {
    listNode.innerHTML = `<div class="favorite-empty">「${escapeHtml(descriptor.name)}」里还没有地点。打开地点详情后可以收藏，或加入自定义清单。</div>${descriptor.builtIn ? '' : `<button type="button" class="delete-list-button" data-delete-list="${escapeHtml(descriptor.id)}">删除这个清单</button>`}`;
  } else {
    listNode.innerHTML = `${items.map((place) => `
      <div class="favorite-item">
        <span class="category-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span>
        <button type="button" data-favorite-place="${escapeHtml(place.id)}"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.metroStation || place.address)}</small></button>
        <button class="icon-button" type="button" data-remove-saved="${escapeHtml(place.id)}" aria-label="从清单移除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>`).join('')}${descriptor.builtIn ? '' : `<button type="button" class="delete-list-button" data-delete-list="${escapeHtml(descriptor.id)}">删除这个清单</button>`}`;
  }
  $$('[data-favorite-place]', listNode).forEach((button) => button.addEventListener('click', () => {
    $('#favoriteModal').close();
    selectPlace(button.dataset.favoritePlace, true);
  }));
  $$('[data-remove-saved]', listNode).forEach((button) => button.addEventListener('click', () => togglePlaceInList(button.dataset.removeSaved, descriptor.id)));
  $$('[data-delete-list]', listNode).forEach((button) => button.addEventListener('click', () => deleteOfficeList(button.dataset.deleteList)));
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

function renderImageViewer(direction = 0) {
  const viewer = state.imageViewer;
  const total = viewer.images.length;
  if (!total) return;
  viewer.index = (viewer.index + total) % total;
  const src = viewer.images[viewer.index];
  const image = $('#imageViewerImage');
  const stage = $('#imageViewerStage');
  stage.classList.remove('slide-next', 'slide-prev');
  if (direction) {
    void stage.offsetWidth;
    stage.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
  }
  image.src = src;
  image.alt = `${viewer.placeName || '地点'}现场照片 ${viewer.index + 1}`;
  $('#imageViewerCaption').textContent = viewer.placeName || '现场照片';
  $('#imageViewerCounter').textContent = `${viewer.index + 1} / ${total}`;
  $('#imageViewerPrev').hidden = total < 2;
  $('#imageViewerNext').hidden = total < 2;
  const next = viewer.images[(viewer.index + 1) % total];
  const prev = viewer.images[(viewer.index - 1 + total) % total];
  if (total > 1) { new Image().src = next; new Image().src = prev; }
}

function openImageViewer(images, index = 0, placeName = '') {
  const clean = Array.isArray(images) ? images.filter(Boolean).slice(0, 8) : [];
  if (!clean.length) return;
  state.imageViewer.images = clean;
  state.imageViewer.index = Math.max(0, Math.min(Number(index) || 0, clean.length - 1));
  state.imageViewer.placeName = placeName;
  renderImageViewer();
  const dialog = $('#imageViewer');
  if (!dialog.open) dialog.showModal();
}

function moveImageViewer(step) {
  if (state.imageViewer.images.length < 2) return;
  state.imageViewer.index += step;
  renderImageViewer(step);
}

function applyPlacesPayload(payload, { notify = false } = {}) {
  state.places = payload.places || [];
  if (Number.isFinite(Number(payload.revision))) state.placesRevision = Number(payload.revision);
  applyFilters();
  renderFavorites();
  if (state.selected) {
    const updated = state.places.find((place) => place.id === state.selected.id);
    if (updated) {
      state.selected = updated;
      renderDetail(updated);
      highlightMarker(updated.id);
    } else {
      closeDetail();
    }
  }
  if (notify) showToast(`地点资料已同步，共 ${state.places.length} 个地点`);
}

async function fetchLatestPlaces({ notify = false } = {}) {
  const payload = await api(`/api/places?refresh=${Date.now()}`);
  applyPlacesPayload(payload, { notify });
  return payload;
}

async function checkForPlaceUpdates({ force = false } = {}) {
  if (state.placesSyncInFlight || (!force && document.hidden)) return;
  state.placesSyncInFlight = true;
  try {
    const meta = await api(`/api/places/revision?ts=${Date.now()}`);
    const nextRevision = Number(meta.revision || 0);
    if (force || !state.placesRevision || nextRevision !== state.placesRevision) {
      await fetchLatestPlaces({ notify: Boolean(state.placesRevision && nextRevision !== state.placesRevision) });
    }
  } catch (error) {
    console.warn('Public place sync failed:', error.message);
  } finally {
    state.placesSyncInFlight = false;
  }
}

async function refreshPlaces() {
  const button = $('#refreshPlaces');
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('is-loading');
  setStatus('正在刷新地点…', true);
  try {
    await fetchLatestPlaces();
    showToast(`已刷新，共 ${state.places.length} 个地点`);
  } catch (error) {
    setStatus('刷新失败，请稍后重试', false);
    showToast(error.message || '刷新失败');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
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
    ['位置备注', form.elements.placeNote?.value || '无'],
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
      feedback.textContent = '请填写店名，并通过高德搜索或点击地图确认位置。';
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

async function compressPhoto(file) {
  return compressImageForUpload(file, { idPrefix: 'photo' });
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
      <figcaption>${photo.width}×${photo.height} · ${Math.ceil(photo.size / 1024)}KB · 上传后 WebP</figcaption>
    </figure>
  `).join('');
}

async function handlePhotos(event) {
  const input = event.target;
  const processing = $('#photoProcessing');
  const available = MAX_PHOTOS - state.photoData.length;
  const selected = Array.from(input.files || []);
  input.value = '';
  if (!selected.length) return;
  if (available <= 0) return showToast('最多上传 8 张图片');

  const files = selected.slice(0, available);
  if (selected.length > available) showToast(`最多 8 张，本次只添加前 ${available} 张`);
  processing.textContent = `正在处理 0 / ${files.length} 张…`;

  let added = 0;
  const errors = [];
  for (let index = 0; index < files.length; index += 1) {
    processing.textContent = `正在上传并压缩：${index + 1} / ${files.length}`;
    try {
      const photo = await compressPhoto(files[index]);
      state.photoData.push(photo);
      added += 1;
      renderPhotoPreview();
    } catch (error) {
      errors.push(error.message);
    }
  }

  processing.textContent = added ? `已添加 ${added} 张，服务器将统一保存为约 100KB WebP。` : '';
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

const MAX_REVIEW_PHOTOS = 3;

function renderReviewPhotoPreview() {
  const preview = $('#reviewPhotoPreview');
  const count = $('#reviewPhotoCount');
  if (!preview || !count) return;
  count.textContent = `${state.reviewPhotos.length} / ${MAX_REVIEW_PHOTOS}`;
  if (!state.reviewPhotos.length) {
    preview.innerHTML = '<span class="photo-empty">尚未选择图片</span>';
    return;
  }
  preview.innerHTML = state.reviewPhotos.map((photo, index) => `
    <figure class="photo-item">
      <img src="${photo.dataUrl}" alt="点评照片 ${index + 1}" />
      <button type="button" class="photo-remove" data-review-photo-remove="${photo.id}" aria-label="删除第 ${index + 1} 张点评照片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <figcaption>${photo.width}×${photo.height} · ${Math.ceil(photo.size / 1024)}KB · 上传后 WebP</figcaption>
    </figure>`).join('');
}

async function handleReviewPhotos(event) {
  const input = event.target;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const available = MAX_REVIEW_PHOTOS - state.reviewPhotos.length;
  if (available <= 0) return showToast('点评最多上传 3 张图片');
  const selected = files.slice(0, available);
  const processing = $('#reviewPhotoProcessing');
  const errors = [];
  let added = 0;
  for (let index = 0; index < selected.length; index += 1) {
    processing.textContent = `正在上传并压缩点评照片：${index + 1} / ${selected.length}`;
    try {
      state.reviewPhotos.push(await compressPhoto(selected[index]));
      added += 1;
      renderReviewPhotoPreview();
    } catch (error) {
      errors.push(error.message);
    }
  }
  processing.textContent = added ? `已添加 ${added} 张，服务器将统一保存为约 100KB WebP。` : '';
  if (errors.length) showToast(errors[0]);
}

function removeReviewPhoto(photoId) {
  state.reviewPhotos = state.reviewPhotos.filter((photo) => photo.id !== photoId);
  renderReviewPhotoPreview();
  $('#reviewPhotoProcessing').textContent = state.reviewPhotos.length ? '可以继续添加或删除图片。' : '';
}

function openReviewModal(place) {
  const form = $('#reviewForm');
  form.reset();
  form.elements.placeId.value = place.id;
  form.elements.name.value = localStorage.getItem('nwm-review-name') || '';
  form.elements.email.value = localStorage.getItem('nwm-review-email') || '';
  state.reviewPhotos = [];
  renderReviewPhotoPreview();
  $('#reviewPhotoProcessing').textContent = '';
  $('#reviewPlaceSummary').innerHTML = `<span class="category-icon category-${escapeHtml(place.category)}">${categoryIconHtml(place.category)}</span><div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.address || place.district || '南京')}</small></div>`;
  const feedback = $('#reviewFeedback');
  feedback.textContent = '';
  feedback.className = 'form-feedback';
  const hint = $('#reviewRatingHint');
  if (hint) hint.textContent = '点击星星评分';
  openModal('reviewModal');
}

async function submitReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#reviewSubmitButton');
  const feedback = $('#reviewFeedback');
  const data = Object.fromEntries(new FormData(form).entries());
  data.photos = state.reviewPhotos.map((photo) => photo.dataUrl);
  feedback.className = 'form-feedback';
  feedback.textContent = '';
  if (!data.rating) {
    feedback.classList.add('error');
    feedback.textContent = '请先选择 1–5 星。';
    return;
  }
  button.disabled = true;
  button.textContent = '正在提交…';
  try {
    const result = await api(`/api/places/${encodeURIComponent(data.placeId)}/reviews`, { method: 'POST', body: JSON.stringify(data) });
    localStorage.setItem('nwm-review-name', data.name || '');
    localStorage.setItem('nwm-review-email', data.email || '');
    feedback.classList.add('success');
    feedback.textContent = result.message || '点评已提交，等待审核。';
    $('#reviewModal').close();
    openModal('reviewSuccessModal');
  } catch (error) {
    feedback.classList.add('error');
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = '提交点评审核';
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
  $('#refreshPlaces').addEventListener('click', refreshPlaces);
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
  $('#todayWorkButton').addEventListener('click', openRecommendations);
  $$('#recommendScenes [data-recommend-scene]').forEach((button) => button.addEventListener('click', () => {
    state.recommendScene = button.dataset.recommendScene;
    $$('#recommendScenes [data-recommend-scene]').forEach((item) => item.classList.toggle('active', item === button));
    renderRecommendations();
  }));
  $('#recommendLocateButton').addEventListener('click', locateForRecommendation);
  $('#newListForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#newListName');
    const list = createOfficeList(input.value);
    if (!list) return;
    input.value = '';
    state.activeSavedList = list.id;
    renderFavorites();
    showToast(`已新建清单「${list.name}」`);
  });
  $('#submitOpen').addEventListener('click', async () => {
    setSubmissionStep(1);
    openModal('submitModal');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try { await ensurePublicLocationPicker(); } catch (error) { showToast(error.message); }
  });
  $('#detailClose').addEventListener('click', closeDetail);
  $('#detailContent').addEventListener('click', (event) => {
    const reviewButton = event.target.closest('[data-review-image-id]');
    if (reviewButton && state.selected) {
      const review = (state.selected.reviews || []).find((item) => item.id === reviewButton.dataset.reviewImageId);
      if (review) openImageViewer(review.images || [], Number(reviewButton.dataset.reviewImageIndex), `${state.selected.name} · ${review.name || '社区点评'}`);
      return;
    }
    const button = event.target.closest('[data-view-image-index]');
    if (!button || !state.selected) return;
    openImageViewer(state.selected.images || [], Number(button.dataset.viewImageIndex), state.selected.name);
  });
  $('#imageViewerPrev').addEventListener('click', () => moveImageViewer(-1));
  $('#imageViewerNext').addEventListener('click', () => moveImageViewer(1));
  const viewerStage = $('#imageViewerStage');
  viewerStage.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    state.imageViewer.touchStartX = touch.clientX;
    state.imageViewer.touchStartY = touch.clientY;
  }, { passive: true });
  viewerStage.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - state.imageViewer.touchStartX;
    const dy = touch.clientY - state.imageViewer.touchStartY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) moveImageViewer(dx < 0 ? 1 : -1);
  }, { passive: true });
  $('#locationButton').addEventListener('click', locateUser);
  $('#photoInput').addEventListener('change', handlePhotos);
  $('#photoPreview').addEventListener('click', (event) => {
    const button = event.target.closest('[data-photo-remove]');
    if (button) removePhoto(button.dataset.photoRemove);
  });
  $('#submissionForm').addEventListener('submit', submitPlace);
  $('#reviewForm').addEventListener('submit', submitReview);
  $('#reviewPhotoInput').addEventListener('change', handleReviewPhotos);
  $('#reviewPhotoPreview').addEventListener('click', (event) => {
    const button = event.target.closest('[data-review-photo-remove]');
    if (button) removeReviewPhoto(button.dataset.reviewPhotoRemove);
  });
  $('#reviewForm').addEventListener('change', (event) => {
    if (event.target.name !== 'rating') return;
    const ratingCopy = {
      1: '不太适合办公',
      2: '勉强可用',
      3: '基本合格',
      4: '值得推荐',
      5: '非常适合办公'
    };
    const hint = $('#reviewRatingHint');
    if (hint) hint.textContent = `${event.target.value} 星 · ${ratingCopy[event.target.value] || ''}`;
  });
  $$('[data-submit-next]').forEach((button) => button.addEventListener('click', () => { if (validateSubmissionStep(state.submissionStep)) setSubmissionStep(state.submissionStep + 1); }));
  $$('[data-submit-back]').forEach((button) => button.addEventListener('click', () => setSubmissionStep(state.submissionStep - 1)));
  $('#submissionForm').addEventListener('change', () => { if (state.submissionStep === 3) updateSubmissionSummary(); });
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.closeModal).close()));
  $$('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }));
  document.addEventListener('keydown', (event) => {
    if ($('#imageViewer').open) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveImageViewer(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); moveImageViewer(1); }
      return;
    }
    if (event.key === 'Escape' && $('#detailSheet').classList.contains('open')) closeDetail();
  });
}

async function init() {
  normalizeOfficeLists();
  wireEvents();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker registration failed:', error));
  }
  renderPhotoPreview();
  renderFilters();
  try {
    const [config, placesPayload] = await Promise.all([api('/api/config'), api('/api/places')]);
    state.config = config;
    applyPlacesPayload(placesPayload);
    $('#appName').textContent = config.appName;
    $('#appNameEn').textContent = config.appNameEn;
    document.title = config.appName;
    await initMap();
    const initialParams = new URLSearchParams(window.location.search);
    const sharedPlaceId = initialParams.get('place');
    if (sharedPlaceId && state.places.some((place) => place.id === sharedPlaceId)) {
      selectPlace(sharedPlaceId, true);
    }
    if (initialParams.get('action') === 'submit') {
      setSubmissionStep(1);
      openModal('submitModal');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      try { await ensurePublicLocationPicker(); } catch (error) { showToast(error.message); }
    }
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

window.addEventListener('focus', () => checkForPlaceUpdates());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForPlaceUpdates();
});
window.addEventListener('storage', (event) => {
  if (event.key === 'nomad-public-data-updated') checkForPlaceUpdates({ force: true });
});
window.setInterval(() => checkForPlaceUpdates(), 15000);

init();
