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
  return `<strong>${escapeHtml(name || '已确认地图位置')}</strong><span>${escapeHtml(address || district || '南京市')}</span><small>可拖动标记或点击地图微调位置</small>`;
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

  if (!searchInput || !searchButton || !resultsNode || !mapNode || !summaryNode || !statusNode) {
    throw new Error('位置选择器页面结构不完整，请刷新后重试');
  }

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

  let current = {
    name: text(initial.name),
    address: text(initial.address),
    district: text(initial.district),
    lng: hasInitial ? initialLng : null,
    lat: hasInitial ? initialLat : null,
    poiId: text(initial.poiId)
  };
  let destroyed = false;
  let inputTimer = null;
  let requestSerial = 0;
  let searchController = null;

  function updateSummary() {
    summaryNode.innerHTML = summaryHtml(current);
    root.classList.toggle('has-location', Number.isFinite(current.lng) && Number.isFinite(current.lat));
  }

  function emit() {
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
    current = {
      ...current,
      name: meta.name || current.name,
      address: meta.address || current.address,
      district: meta.district || current.district,
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
    if (!meta.address || !meta.district) await reverseGeocode(point, true);
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

  searchButton.addEventListener('click', () => search());
  searchInput.addEventListener('input', () => {
    window.clearTimeout(inputTimer);
    const keyword = searchInput.value.trim();
    if (keyword.length < 2) {
      resultsNode.hidden = true;
      statusNode.textContent = '输入至少两个字即可搜索店名，不需要完整地址。';
      return;
    }
    inputTimer = window.setTimeout(() => search(keyword, { quiet: true }), 380);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });

  map.on('click', async (event) => {
    statusNode.textContent = '正在识别这个位置…';
    await chooseLocation(event.lnglat, { poiId: '' });
    statusNode.textContent = '位置已确认，可继续拖动标记微调。';
  });

  marker.on('dragend', async (event) => {
    const point = getLngLat(event.lnglat || marker.getPosition());
    if (!point) return;
    current.lng = point[0];
    current.lat = point[1];
    current.poiId = '';
    statusNode.textContent = '正在更新地址…';
    await reverseGeocode(point, true);
    statusNode.textContent = '位置已更新。';
  });

  updateSummary();
  if (hasInitial) emit();
  window.setTimeout(() => map.resize(), 100);

  const controller = {
    map,
    getValue: () => ({ ...current }),
    reset() {
      current = { name: '', address: '', district: '', lng: null, lat: null, poiId: '' };
      marker.hide();
      map.setZoomAndCenter(12, DEFAULT_CENTER);
      searchInput.value = '';
      resultsNode.hidden = true;
      statusNode.textContent = '输入店名即可搜索，也可以直接点击地图。';
      emit();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(inputTimer);
      searchController?.abort();
      try { map.destroy(); } catch {}
      root.__locationPicker = null;
    }
  };
  root.__locationPicker = controller;
  return controller;
}
