const KB = 1024;

const DEFAULT_OPTIONS = {
  targetBytes: 100 * KB,
  minBytes: 88 * KB,
  maxBytes: 114 * KB,
  jpegTransportTargetBytes: 132 * KB,
  jpegTransportMinBytes: 108 * KB,
  jpegTransportMaxBytes: 155 * KB,
  maxSourceBytes: 35 * 1024 * 1024,
  dimensions: [2200, 2048, 1920, 1760, 1600, 1440, 1280, 1120, 960, 840, 720],
  minQuality: 0.34,
  maxQuality: 0.96,
  preferredQuality: 0.58,
  idPrefix: 'photo',
  serverEndpoint: '/api/images/compress',
  serverTimeoutMs: 120000
};

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function looksLikeImage(file) {
  if (String(file?.type || '').startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file?.name || ''));
}

function createResult(payload, file, options) {
  return {
    id: `${options.idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    dataUrl: payload.dataUrl,
    size: Number(payload.size || 0),
    originalName: file.name,
    width: Number(payload.width || 0),
    height: Number(payload.height || 0),
    transportType: payload.type || 'image/webp',
    finalType: 'image/webp'
  };
}

async function compressOnServer(file, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.serverTimeoutMs);
  let response;
  try {
    response = await fetch(options.serverEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Nomad-Image-Upload': '1'
      },
      body: file,
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('手机上传图片超时，请检查网络后重试'), { retryLocally: true });
    }
    throw Object.assign(new Error('手机网络未能上传原图，正在尝试本地压缩'), { retryLocally: true });
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || `图片上传失败（${response.status}）`;
    const retryLocally = [400, 404, 415, 422].includes(response.status) || response.status >= 500;
    throw Object.assign(new Error(message), { retryLocally, status: response.status });
  }

  if (!payload.dataUrl?.startsWith('data:image/webp;base64,') || !Number(payload.size)) {
    throw Object.assign(new Error('服务器返回的图片格式不正确'), { retryLocally: true });
  }
  return createResult(payload, file, options);
}

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url)
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('手机无法读取这张照片，请改选 JPG、PNG 或 WebP 图片'));
    };
    image.src = url;
  });
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.()
      };
    } catch {
      // iOS, HEIC and embedded Android browsers are often more reliable via <img>.
    }
  }
  return loadImageElement(file);
}

function encodeCanvas(canvas, type, quality, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('手机处理图片超时，请一次少选几张后重试'));
    }, timeoutMs);

    try {
      canvas.toBlob((blob) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!blob || !blob.size) {
          reject(new Error('当前浏览器无法处理这张图片'));
          return;
        }
        resolve(blob);
      }, type, quality);
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function detectEncoder(canvas) {
  try {
    const webp = await encodeCanvas(canvas, 'image/webp', 0.9);
    if (webp.type === 'image/webp') return 'image/webp';
  } catch {
    // The server will convert the JPEG compatibility upload to WebP.
  }
  const jpeg = await encodeCanvas(canvas, 'image/jpeg', 0.92);
  if (!jpeg.type.startsWith('image/jpeg')) throw new Error('当前手机浏览器无法生成可上传的图片');
  return 'image/jpeg';
}

function chooseBest(records, targetBytes) {
  return [...records].sort((a, b) => {
    const aDistance = Math.abs(a.blob.size - targetBytes);
    const bDistance = Math.abs(b.blob.size - targetBytes);
    if (aDistance !== bDistance) return aDistance - bDistance;
    return b.quality - a.quality;
  })[0] || null;
}

async function searchQuality(canvas, encoder, range, options) {
  const records = [];
  const encode = async (quality) => {
    const blob = await encodeCanvas(canvas, encoder, quality);
    const record = { blob, quality };
    records.push(record);
    return record;
  };

  const high = await encode(options.maxQuality);
  if (high.blob.size < range.minBytes) return { candidate: high, tooSmallAtMaximumQuality: true };

  const low = await encode(options.minQuality);
  if (low.blob.size > range.maxBytes) return { candidate: low, tooLargeAtMinimumQuality: true };

  let lowQuality = options.minQuality;
  let highQuality = options.maxQuality;
  for (let index = 0; index < 8; index += 1) {
    const quality = (lowQuality + highQuality) / 2;
    const record = await encode(quality);
    if (record.blob.size < range.targetBytes) lowQuality = quality;
    else highQuality = quality;
  }

  return { candidate: chooseBest(records, range.targetBytes) };
}

function candidateScore(candidate, range, dimension, options) {
  const sizeDistance = Math.abs(candidate.blob.size - range.targetBytes) / range.targetBytes;
  const qualityPenalty = Math.max(0, options.preferredQuality - candidate.quality) * 1.8;
  const dimensionPenalty = Math.max(0, (1280 - dimension) / 1280) * 0.35;
  const outsidePenalty = candidate.blob.size < range.minBytes
    ? 0.65 + ((range.minBytes - candidate.blob.size) / range.minBytes)
    : candidate.blob.size > range.maxBytes
      ? 1.8 + ((candidate.blob.size - range.maxBytes) / range.maxBytes)
      : 0;
  return sizeDistance + qualityPenalty + dimensionPenalty + outsidePenalty;
}

async function compressLocally(file, options) {
  const decoded = await decodeImage(file);
  const sourceWidth = Number(decoded.width || 0);
  const sourceHeight = Number(decoded.height || 0);
  if (!sourceWidth || !sourceHeight) {
    decoded.close?.();
    throw new Error(`${file.name} 无法读取图片尺寸`);
  }

  let encoder = null;
  let best = null;
  let bestScore = Infinity;

  try {
    for (const dimension of options.dimensions) {
      const scale = Math.min(1, dimension / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!context) throw new Error('当前手机浏览器无法创建图片画布');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);

      try {
        if (!encoder) encoder = await detectEncoder(canvas);
        const range = encoder === 'image/webp'
          ? { targetBytes: options.targetBytes, minBytes: options.minBytes, maxBytes: options.maxBytes }
          : {
              targetBytes: options.jpegTransportTargetBytes,
              minBytes: options.jpegTransportMinBytes,
              maxBytes: options.jpegTransportMaxBytes
            };
        const result = await searchQuality(canvas, encoder, range, options);
        const candidate = { ...result.candidate, width, height, encoder };
        const score = candidateScore(candidate, range, dimension, options);
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }

        const inRange = candidate.blob.size >= range.minBytes && candidate.blob.size <= range.maxBytes;
        if (inRange && candidate.quality >= options.preferredQuality) {
          best = candidate;
          break;
        }
        if (result.tooSmallAtMaximumQuality) {
          best = candidate;
          break;
        }
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
      await nextFrame();
    }
  } finally {
    decoded.close?.();
  }

  if (!best?.blob) throw new Error(`${file.name} 处理失败，请重新选择后再试`);
  return createResult({
    dataUrl: await dataUrlFromBlob(best.blob),
    size: best.blob.size,
    width: best.width,
    height: best.height,
    type: best.encoder
  }, file, options);
}

export async function compressImageForUpload(file, suppliedOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...suppliedOptions };
  if (!looksLikeImage(file)) throw new Error(`${file?.name || '所选文件'} 不是支持的图片`);
  if (file.size > options.maxSourceBytes) throw new Error(`${file.name} 超过 35MB，请换一张照片`);

  try {
    return await compressOnServer(file, options);
  } catch (serverError) {
    if (!serverError.retryLocally) throw serverError;
    try {
      return await compressLocally(file, options);
    } catch (localError) {
      throw new Error(`${serverError.message}；备用处理也失败：${localError.message}`);
    }
  }
}
