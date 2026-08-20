const DEFAULT_CENTER = [118.7969, 32.0603];

function text(value = '') {
  return String(value ?? '');
}

function escapeHtml(value = '') {
  return text(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function loadExternalScript(src, id, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === 'true') return resolve();
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('高德地图加载器加载失败')), { once: true });
      return;
    }

    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error('高德地图加载超时'));
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
      reject(new Error('无法访问高德地图加载器'));
    };
    document.head.appendChild(script);
  });
}

export async function ensureAmap(amapKey) {
  if (window.AMap) return window.AMap;
  const cleanKey = text(amapKey).trim().replace(/^['"]|['"]$/g, '');
  if (!cleanKey) throw new Error('未读取到高德 Web 端 Key');

  window._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/_AMapService`
  };

  await loadExternalScript('https://webapi.amap.com/loader.js', 'amap-loader');
  if (!window.AMapLoader?.load) throw new Error('高德 Loader 未正确初始化');

  return window.AMapLoader.load({
    key: cleanKey,
    version: '2.0',
    plugins: []
  });
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `请求失败（${response.status}）`);
  return payload;
}

function getLngLat(location) {
  if (!location) return null;
  if (typeof location === 'string') {
    const [lng, lat] = location.split(',').map(Number);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const lng = typeof location.getLng === 'function' ? location.getLng() : Number(location.lng ?? location[0]);
  const lat = typeof location.getLat === 'function' ? location.getLat() : Number(location.lat ?? location[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '';
  return distance < 1000 ? `${Math.max(1, Math.round(distance))}m` : `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)}km`;
}

function loadAmapPlugin(AMap, pluginName, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('定位组件加载超时'));
    }, timeoutMs);
    try {
      AMap.plugin([pluginName], () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      });
    } catch (error) {
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    }
  });
}

function setField(root, name, value) {
  const field = root.querySelector(`[name="${name}"]`);
  if (!field) return;
  field.value = value ?? '';
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function getPlaceNameField(root) {
  return root.querySelector('[name="placeName"]') || root.querySelector('[name="name"]');
}

function summaryHtml({ name, address, district, lng, lat }) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return '<strong>尚未确认位置</strong><span>输入店名搜索，或直接点击地图选择。</span>';
  }
  return `<strong>${escapeHtml(name || '已确认地图位置')}</strong><span>${escapeHtml(address || district || '地址请手动填写')}</span><small>地图负责确认坐标；手动标注时请直接填写详细地址</small>`;
}

export async function mountLocationPicker({
  root,
  amapKey,
  initial = {},
  city = '南京',
  onChange
}) {
  if (!root) throw new Error('缺少位置选择器容器');
  if (root.__locationPicker?.destroy) root.__locationPicker.destroy();

  const fieldRoot = root.closest('form') || root;
  const searchInput = root.querySelector('[data-location-search]');
  const searchButton = root.querySelector('[data-location-search-button]');
  const resultsNode = root.querySelector('[data-location-results]');
  const mapNode = root.querySelector('[data-location-map]');
  const summaryNode = root.querySelector('[data-location-summary]');
  const statusNode = root.querySelector('[data-location-status]');
  const customNameInput = getPlaceNameField(fieldRoot);
  const addressInput = fieldRoot.querySelector('[data-location-address]') || fieldRoot.querySelector('[name="address"]');

  if (!searchInput || !searchButton || !resultsNode || !mapNode || !summaryNode || !statusNode) {
    throw new Error('位置选择器页面结构不完整，请刷新后重试');
  }

  root.querySelectorAll('[data-location-generated]').forEach((node) => node.remove());
  let mapShell = mapNode.closest('.location-map-shell');
  if (!mapShell) {
    mapShell = document.createElement('div');
    mapShell.className = 'location-map-shell';
    mapNode.parentNode.insertBefore(mapShell, mapNode);
    mapShell.appendChild(mapNode);
  }

  // Keep the map directly under the search field on every public/admin picker.
  // This makes the geographic context visible before the user chooses a POI or types a manual address.
  const searchRow = searchInput.closest('.location-search-row');
  if (searchRow && searchRow.parentNode === mapShell.parentNode) {
    searchRow.insertAdjacentElement('afterend', mapShell);
  }

  const mapTools = document.createElement('div');
  mapTools.className = 'location-map-tools';
  mapTools.dataset.locationGenerated = 'true';
  mapTools.innerHTML = `
    <button type="button" class="location-map-tool primary" data-location-locate aria-label="定位到我的位置">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>定位到我 · 推荐最近</span>
    </button>
    <button type="button" class="location-map-tool" data-location-nearby aria-label="搜索地图中心周边地点">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg><span>此处周边</span>
    </button>`;
  mapShell.appendChild(mapTools);

  const nearbyPanel = document.createElement('section');
  nearbyPanel.className = 'location-nearby-panel';
  nearbyPanel.dataset.locationGenerated = 'true';
  nearbyPanel.hidden = true;
  nearbyPanel.innerHTML = `
    <div class="location-nearby-heading"><div><strong>周边地点</strong><span>点击任一地点，自动放置地点戳并作为地址。</span></div><button type="button" data-location-nearby-close aria-label="收起周边地点">收起</button></div>
    <div class="location-nearby-list" data-location-nearby-list></div>`;
  mapShell.insertAdjacentElement('afterend', nearbyPanel);

  const nearestPanel = document.createElement('section');
  nearestPanel.className = 'location-nearest-panel';
  nearestPanel.dataset.locationGenerated = 'true';
  nearestPanel.hidden = true;
  nearestPanel.innerHTML = `
    <div class="location-nearest-heading"><div><strong>离你最近的匹配</strong><span>基于当前位置和输入店名，优先推荐最近门店。</span></div><span data-location-nearest-label></span></div>
    <div class="location-nearest-list" data-location-nearest-list></div>`;
  resultsNode.parentNode.insertBefore(nearestPanel, resultsNode);

  const locateButton = mapTools.querySelector('[data-location-locate]');
  const nearbyButton = mapTools.querySelector('[data-location-nearby]');
  const nearbyList = nearbyPanel.querySelector('[data-location-nearby-list]');
  const nearbyCloseButton = nearbyPanel.querySelector('[data-location-nearby-close]');
  const nearestList = nearestPanel.querySelector('[data-location-nearest-list]');
  const nearestLabel = nearestPanel.querySelector('[data-location-nearest-label]');

  const AMap = await ensureAmap(amapKey);

  const initialLng = Number(initial.lng);
  const initialLat = Number(initial.lat);
  const hasInitial = Number.isFinite(initialLng) && Number.isFinite(initialLat);
  const center = hasInitial ? [initialLng, initialLat] : DEFAULT_CENTER;

  const map = new AMap.Map(mapNode, {
    center,
    zoom: hasInitial ? 16 : 12,
    zooms: [10, 19],
    viewMode: '2D',
    mapStyle: 'amap://styles/whitesmoke',
    features: ['bg', 'road', 'building', 'point'],
    showIndoorMap: false,
    resizeEnable: true
  });

  const marker = new AMap.Marker({
    position: center,
    draggable: true,
    anchor: 'bottom-center',
    visible: hasInitial,
    content: '<div class="location-picker-pin"><span></span></div>'
  });
  map.add(marker);

  const userLocationMarker = new AMap.Marker({
    position: center,
    visible: false,
    anchor: 'center',
    zIndex: 120,
    content: '<div class="location-user-dot"><span></span></div>'
  });
  const accuracyCircle = new AMap.Circle({
    center,
    radius: 0,
    visible: false,
    strokeColor: '#2879d0',
    strokeOpacity: 0.35,
    strokeWeight: 1,
    fillColor: '#5aa7f0',
    fillOpacity: 0.12,
    zIndex: 20
  });
  map.add([accuracyCircle, userLocationMarker]);

  let current = {
    name: text(initial.name || customNameInput?.value),
    address: text(initial.address),
    district: text(initial.district),
    lng: hasInitial ? initialLng : null,
    lat: hasInitial ? initialLat : null,
    poiId: text(initial.poiId)
  };
  if (customNameInput && current.name) customNameInput.value = current.name;

  let destroyed = false;
  let inputTimer = null;
  let requestSerial = 0;
  let searchController = null;
  let suggestionSerial = 0;
  let suggestionController = null;
  let suggestionTimer = null;
  let userLocationPoint = null;

  function updateSummary() {
    summaryNode.innerHTML = summaryHtml(current);
    root.classList.toggle('has-location', Number.isFinite(current.lng) && Number.isFinite(current.lat));
  }

  function emit() {
    if (customNameInput && customNameInput.value.trim()) current.name = customNameInput.value.trim();
    setField(fieldRoot, 'lng', Number.isFinite(current.lng) ? current.lng.toFixed(6) : '');
    setField(fieldRoot, 'lat', Number.isFinite(current.lat) ? current.lat.toFixed(6) : '');
    setField(fieldRoot, 'address', current.address || '');
    setField(fieldRoot, 'district', current.district || '');
    setField(fieldRoot, 'amapPoiId', current.poiId || '');
    if (current.name) {
      const nameField = getPlaceNameField(fieldRoot);
      if (nameField) nameField.value = current.name;
    }
    updateSummary();
    onChange?.({ ...current });
  }

  async function reverseGeocode(point, preserveName = true) {
    try {
      const payload = await apiJson(`/api/amap/regeo?lng=${encodeURIComponent(point[0])}&lat=${encodeURIComponent(point[1])}`);
      if (destroyed) return;
      current.address = payload.address || current.address;
      current.district = payload.district || current.district;
      if (!preserveName && payload.address) current.name = payload.address;
    } catch (error) {
      statusNode.textContent = `地址识别失败：${error.message}。坐标已保留，可稍后重试。`;
    }
    emit();
  }

  async function chooseLocation(lnglat, meta = {}) {
    const point = getLngLat(lnglat);
    if (!point) return;
    const hasAddress = Object.prototype.hasOwnProperty.call(meta, 'address');
    const hasDistrict = Object.prototype.hasOwnProperty.call(meta, 'district');
    current = {
      ...current,
      name: meta.name || current.name,
      address: hasAddress ? text(meta.address) : current.address,
      district: hasDistrict ? text(meta.district) : current.district,
      poiId: meta.poiId || '',
      lng: point[0],
      lat: point[1]
    };
    if (meta.name) {
      const nameField = getPlaceNameField(fieldRoot);
      if (nameField) nameField.value = meta.name;
    }
    marker.setPosition(point);
    marker.show();
    map.setZoomAndCenter(16, point);
    emit();
    if (meta.autoAddress !== false && (!current.address || !current.district)) await reverseGeocode(point, true);
  }

  function recommendationKeyword() {
    return text(searchInput.value || customNameInput?.value || '').trim();
  }

  function renderNearestResults(places) {
    const usable = (places || []).filter((place) => Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat))).slice(0, 6);
    nearestPanel.hidden = false;
    nearestLabel.textContent = usable.length ? `${usable.length} 个` : '';
    if (!usable.length) {
      nearestList.innerHTML = '<div class="location-nearest-empty">当前位置附近没有找到匹配门店。下方仍可查看全南京搜索结果。</div>';
      return;
    }
    nearestList.innerHTML = usable.map((place, index) => `
      <button type="button" class="location-nearest-item" data-location-nearest-item="${index}">
        <span class="location-nearest-rank">${index + 1}</span>
        <span class="location-nearest-copy"><strong>${escapeHtml(place.name || '未命名地点')}</strong><small>${escapeHtml([place.district, place.address].filter(Boolean).join(' · ') || '南京市')}</small></span>
        <em>${escapeHtml(formatDistance(place.distance))}</em>
      </button>`).join('');
    nearestList.querySelectorAll('[data-location-nearest-item]').forEach((button) => {
      button.addEventListener('click', async () => {
        const place = usable[Number(button.dataset.locationNearestItem)];
        if (!place) return;
        searchInput.value = place.name || searchInput.value;
        statusNode.textContent = `已选择离你约 ${formatDistance(place.distance)} 的“${place.name || '门店'}”，正在确认地址…`;
        await chooseLocation([Number(place.lng), Number(place.lat)], {
          name: place.name,
          address: place.address,
          district: place.district,
          poiId: place.id
        });
        statusNode.textContent = `已选择最近匹配门店：${place.name || '未命名地点'} · ${formatDistance(place.distance)}`;
        resultsNode.hidden = true;
      });
    });
  }

  async function loadNearestRecommendations(keyword = recommendationKeyword(), point = userLocationPoint) {
    const query = text(keyword).trim();
    const target = getLngLat(point);
    if (!target || query.length < 2) {
      nearestPanel.hidden = true;
      return;
    }
    const serial = ++suggestionSerial;
    suggestionController?.abort();
    suggestionController = new AbortController();
    nearestPanel.hidden = false;
    nearestLabel.textContent = '定位推荐';
    nearestList.innerHTML = '<div class="location-nearest-loading"><span></span>正在按距离匹配最近门店…</div>';
    try {
      const payload = await apiJson(`/api/amap/suggest?q=${encodeURIComponent(query)}&lng=${encodeURIComponent(target[0])}&lat=${encodeURIComponent(target[1])}&city=${encodeURIComponent(city)}&limit=6`, {
        signal: suggestionController.signal
      });
      if (destroyed || serial !== suggestionSerial) return;
      renderNearestResults(payload.places || []);
    } catch (error) {
      if (error.name === 'AbortError' || destroyed || serial !== suggestionSerial) return;
      nearestPanel.hidden = false;
      nearestLabel.textContent = '';
      nearestList.innerHTML = `<div class="location-nearest-empty">最近门店推荐失败：${escapeHtml(error.message)}。仍可使用普通搜索。</div>`;
    }
  }

  function scheduleNearestRecommendation(keyword = recommendationKeyword()) {
    window.clearTimeout(suggestionTimer);
    if (!userLocationPoint || text(keyword).trim().length < 2) {
      nearestPanel.hidden = true;
      return;
    }
    suggestionTimer = window.setTimeout(() => loadNearestRecommendations(keyword, userLocationPoint), 260);
  }

  function renderNearbyResults(places) {
    const usable = (places || []).filter((place) => Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat))).slice(0, 12);
    nearbyPanel.hidden = false;
    if (!usable.length) {
      nearbyList.innerHTML = '<div class="location-nearby-empty">附近暂时没有可选地点。你仍然可以直接点击地图并填写店名。</div>';
      return;
    }
    nearbyList.innerHTML = usable.map((place, index) => `
      <button type="button" class="location-nearby-item" data-location-nearby-item="${index}">
        <span class="location-nearby-pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg></span>
        <span class="location-nearby-copy"><strong>${escapeHtml(place.name || '未命名地点')}</strong><small>${escapeHtml([place.district, place.address].filter(Boolean).join(' · ') || '南京市')}</small></span>
        ${Number.isFinite(Number(place.distance)) ? `<em>${escapeHtml(formatDistance(place.distance))}</em>` : ''}
      </button>`).join('');
    nearbyList.querySelectorAll('[data-location-nearby-item]').forEach((button) => {
      button.addEventListener('click', async () => {
        const place = usable[Number(button.dataset.locationNearbyItem)];
        if (!place) return;
        searchInput.value = place.name || '';
        statusNode.textContent = `已选择周边地点“${place.name || '未命名地点'}”，正在放置地点戳…`;
        await chooseLocation([Number(place.lng), Number(place.lat)], {
          name: place.name,
          address: place.address,
          district: place.district,
          poiId: place.id
        });
        statusNode.textContent = '地点戳与地址已确认，可拖动微调。';
        nearbyPanel.hidden = true;
      });
    });
  }

  async function loadNearby(point, label = '这个位置') {
    const target = getLngLat(point);
    if (!target) return;
    nearbyPanel.hidden = false;
    nearbyList.innerHTML = '<div class="location-nearby-loading"><span></span>正在查找周边地点…</div>';
    try {
      const payload = await apiJson(`/api/amap/around?lng=${encodeURIComponent(target[0])}&lat=${encodeURIComponent(target[1])}&radius=1200&limit=12`);
      if (destroyed) return;
      renderNearbyResults(payload.places || []);
      statusNode.textContent = payload.places?.length
        ? `${label}附近找到 ${payload.places.length} 个地点，点击即可作为地址。`
        : `${label}附近没有可选地点，可以直接点击地图标注。`;
    } catch (error) {
      nearbyList.innerHTML = `<div class="location-nearby-empty">周边地点加载失败：${escapeHtml(error.message)}</div>`;
      statusNode.textContent = `周边地点加载失败：${error.message}`;
    }
  }

  function showUserLocation(point, accuracy = 0) {
    userLocationMarker.setPosition(point);
    userLocationMarker.show();
    if (Number.isFinite(Number(accuracy)) && Number(accuracy) > 0) {
      accuracyCircle.setCenter(point);
      accuracyCircle.setRadius(Math.min(1500, Math.max(20, Number(accuracy))));
      accuracyCircle.show();
    } else {
      accuracyCircle.hide();
    }
  }

  async function getPreciseLocation() {
    await loadAmapPlugin(AMap, 'AMap.Geolocation');
    return new Promise((resolve, reject) => {
      const geolocation = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 12000,
        noIpLocate: 0,
        noGeoLocation: 0,
        convert: true,
        showButton: false,
        showMarker: false,
        showCircle: false,
        panToLocation: false,
        zoomToAccuracy: false
      });
      geolocation.getCurrentPosition((status, result) => {
        if (status === 'complete') {
          const point = getLngLat(result.position);
          if (point) return resolve({ point, accuracy: Number(result.accuracy || 0) });
        }
        reject(new Error(result?.message || '浏览器未能获取当前位置'));
      });
    });
  }

  async function locateAndShowNearby() {
    locateButton.disabled = true;
    locateButton.classList.add('loading');
    statusNode.textContent = '正在定位，请允许浏览器使用位置权限…';
    try {
      const { point, accuracy } = await getPreciseLocation();
      if (destroyed) return;
      userLocationPoint = point;
      showUserLocation(point, accuracy);
      map.setZoomAndCenter(17, point);
      const keyword = recommendationKeyword();
      await Promise.all([
        loadNearby(point, '你当前位置'),
        keyword.length >= 2 ? loadNearestRecommendations(keyword, point) : Promise.resolve()
      ]);
      if (keyword.length < 2) statusNode.textContent = '定位成功。现在输入店名，系统会优先推荐离你最近的匹配门店。';
    } catch (error) {
      statusNode.textContent = `定位失败：${error.message}。请确认使用 HTTPS 并允许位置权限。`;
    } finally {
      locateButton.disabled = false;
      locateButton.classList.remove('loading');
    }
  }

  function renderResults(places) {
    const usable = (places || []).filter((place) => Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat))).slice(0, 10);
    if (!usable.length) {
      resultsNode.innerHTML = '<div class="location-search-empty">没有找到匹配地点。可以换一个更短的店名，或直接点击地图。</div>';
      resultsNode.hidden = false;
      return;
    }

    resultsNode.innerHTML = usable.map((place, index) => `
      <button type="button" class="location-result" data-location-result="${index}">
        <strong>${escapeHtml(place.name || '未命名地点')}</strong>
        <span>${escapeHtml([place.district, place.address].filter(Boolean).join(' · ') || '南京市')}</span>
      </button>
    `).join('');
    resultsNode.hidden = false;

    resultsNode.querySelectorAll('[data-location-result]').forEach((button) => {
      button.addEventListener('click', async () => {
        const place = usable[Number(button.dataset.locationResult)];
        if (!place) return;
        searchInput.value = place.name || searchInput.value;
        resultsNode.hidden = true;
        statusNode.textContent = '已选择高德地点，正在确认位置…';
        await chooseLocation([Number(place.lng), Number(place.lat)], {
          name: place.name,
          address: place.address,
          district: place.district,
          poiId: place.id
        });
        statusNode.textContent = '位置已确认，可拖动标记微调。';
      });
    });
  }

  async function search(forcedKeyword = '', { quiet = false } = {}) {
    const keyword = text(forcedKeyword || searchInput.value).trim();
    if (!keyword) {
      statusNode.textContent = '请输入店名，例如“星巴克”“金陵图书馆”。';
      return;
    }

    const serial = ++requestSerial;
    searchController?.abort();
    searchController = new AbortController();
    searchButton.disabled = true;
    if (!quiet) statusNode.textContent = `正在搜索“${keyword}”…`;

    try {
      const payload = await apiJson(`/api/amap/search?q=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&limit=10`, {
        signal: searchController.signal
      });
      if (destroyed || serial !== requestSerial) return;
      renderResults(payload.places || []);
      if (userLocationPoint) loadNearestRecommendations(keyword, userLocationPoint);
      statusNode.textContent = payload.places?.length
        ? `找到 ${payload.places.length} 个候选地点，请选择具体门店。`
        : '没有找到匹配地点，可以换一个关键词或直接点击地图。';
    } catch (error) {
      if (error.name === 'AbortError' || destroyed || serial !== requestSerial) return;
      resultsNode.innerHTML = `<div class="location-search-empty">搜索失败：${escapeHtml(error.message)}</div>`;
      resultsNode.hidden = false;
      statusNode.textContent = `高德地点搜索失败：${error.message}`;
    } finally {
      if (serial === requestSerial) searchButton.disabled = false;
    }
  }

  locateButton.addEventListener('click', locateAndShowNearby);
  nearbyButton.addEventListener('click', () => {
    const centerPoint = getLngLat(map.getCenter());
    if (centerPoint) loadNearby(centerPoint, '地图中心');
  });
  nearbyCloseButton.addEventListener('click', () => { nearbyPanel.hidden = true; });

  searchButton.addEventListener('click', () => search());
  searchInput.addEventListener('input', () => {
    window.clearTimeout(inputTimer);
    const keyword = searchInput.value.trim();
    if (keyword.length < 2) {
      resultsNode.hidden = true;
      statusNode.textContent = '输入至少两个字即可搜索店名，不需要完整地址。';
      return;
    }
    scheduleNearestRecommendation(keyword);
    inputTimer = window.setTimeout(() => search(keyword, { quiet: true }), 380);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });

  customNameInput?.addEventListener('input', () => {
    current.name = customNameInput.value.trim();
    if (!searchInput.value.trim()) scheduleNearestRecommendation(current.name);
    updateSummary();
    onChange?.({ ...current });
  });

  addressInput?.addEventListener('input', () => {
    current.address = addressInput.value.trim();
    updateSummary();
    onChange?.({ ...current });
  });

  map.on('click', async (event) => {
    const point = getLngLat(event.lnglat);
    statusNode.textContent = '位置已确认。请直接填写店名和详细地址，或从周边地点中选择。';
    await chooseLocation(event.lnglat, { poiId: '', address: addressInput?.value.trim() || '', district: '', autoAddress: false });
    if (point) await loadNearby(point, '所选位置');
  });

  marker.on('dragend', async (event) => {
    const point = getLngLat(event.lnglat || marker.getPosition());
    if (!point) return;
    current.lng = point[0];
    current.lat = point[1];
    current.poiId = '';
    statusNode.textContent = '坐标已更新。地址保持手动输入，也可以从周边地点中重新选择。';
    emit();
    await loadNearby(point, '标记位置');
  });

  updateSummary();
  if (hasInitial) emit();
  window.setTimeout(() => map.resize(), 100);

  const controller = {
    map,
    getValue: () => ({ ...current, name: customNameInput?.value.trim() || current.name }),
    reset() {
      current = { name: '', address: '', district: '', lng: null, lat: null, poiId: '' };
      marker.hide();
      map.setZoomAndCenter(12, DEFAULT_CENTER);
      searchInput.value = '';
      if (customNameInput) customNameInput.value = '';
      resultsNode.hidden = true;
      nearbyPanel.hidden = true;
      nearbyList.innerHTML = '';
      nearestPanel.hidden = true;
      nearestList.innerHTML = '';
      userLocationPoint = null;
      userLocationMarker.hide();
      accuracyCircle.hide();
      statusNode.textContent = '输入店名搜索、定位到附近，或直接点击地图。';
      emit();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(inputTimer);
      window.clearTimeout(suggestionTimer);
      searchController?.abort();
      suggestionController?.abort();
      try { map.destroy(); } catch {}
      root.__locationPicker = null;
    }
  };
  root.__locationPicker = controller;
  return controller;
}
