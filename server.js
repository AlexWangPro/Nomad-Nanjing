import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || (IS_PRODUCTION ? '' : 'admin@nanjing.local')).toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'ChangeMeNow!');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? crypto.randomBytes(32).toString('hex') : 'local-development-secret-change-this-now');
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const categoryLabels = {
  coffee: '咖啡馆',
  library: '图书馆',
  coworking: '共享办公',
  public: '公共空间',
  hotel: '酒店大堂'
};

const seedPlaces = [
  {
    id: 'seed-xinjiekou-coffee',
    name: '示例 · 新街口安静咖啡馆',
    category: 'coffee',
    lng: 118.7789,
    lat: 32.0415,
    address: '新街口商圈（示例数据）',
    district: '秦淮区',
    metroStation: '新街口站',
    metroMinutes: 4,
    price: '¥35–55',
    hours: '08:00–22:00',
    quietLevel: 4,
    wifi: '稳定',
    outlets: '充足',
    callFriendly: false,
    unlimited: true,
    free: false,
    featured: true,
    verified: true,
    lastVerified: '2026-07-01',
    description: '桌面宽、工作日较安静，适合 2–3 小时的电脑办公。周末下午可能拥挤。',
    workModes: ['深度工作', '临时办公'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-daxinggong-library',
    name: '示例 · 大行宫公共图书馆',
    category: 'library',
    lng: 118.7992,
    lat: 32.0404,
    address: '大行宫附近（示例数据）',
    district: '玄武区',
    metroStation: '大行宫站',
    metroMinutes: 3,
    price: '免费',
    hours: '09:00–21:00',
    quietLevel: 5,
    wifi: '需验证',
    outlets: '部分座位',
    callFriendly: false,
    unlimited: true,
    free: true,
    featured: true,
    verified: false,
    lastVerified: '2026-06-20',
    description: '适合安静阅读和深度工作，电话与视频会议应移步指定区域。',
    workModes: ['深度工作', '免费办公'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-hexi-coworking',
    name: '示例 · 河西共享办公空间',
    category: 'coworking',
    lng: 118.7318,
    lat: 32.0129,
    address: '河西 CBD（示例数据）',
    district: '建邺区',
    metroStation: '奥体东站',
    metroMinutes: 6,
    price: '日票 ¥79',
    hours: '09:00–20:00',
    quietLevel: 4,
    wifi: '高速',
    outlets: '每席位',
    callFriendly: true,
    unlimited: true,
    free: false,
    featured: true,
    verified: true,
    lastVerified: '2026-07-03',
    description: '有独立电话间和会议区域，适合视频会议与全天办公。',
    workModes: ['视频会议', '全天办公'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-gulou-coffee',
    name: '示例 · 鼓楼街区咖啡馆',
    category: 'coffee',
    lng: 118.7704,
    lat: 32.0667,
    address: '鼓楼广场附近（示例数据）',
    district: '鼓楼区',
    metroStation: '鼓楼站',
    metroMinutes: 5,
    price: '¥28–48',
    hours: '09:30–21:30',
    quietLevel: 3,
    wifi: '稳定',
    outlets: '一般',
    callFriendly: true,
    unlimited: false,
    free: false,
    featured: false,
    verified: true,
    lastVerified: '2026-06-29',
    description: '氛围轻松，适合处理邮件和短时通话；高峰时段不建议长时间占座。',
    workModes: ['临时办公', '轻度通话'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-xianlin-library',
    name: '示例 · 仙林社区阅读空间',
    category: 'library',
    lng: 118.9063,
    lat: 32.1047,
    address: '仙林中心附近（示例数据）',
    district: '栖霞区',
    metroStation: '仙林中心站',
    metroMinutes: 7,
    price: '免费',
    hours: '10:00–20:00',
    quietLevel: 5,
    wifi: '公共 Wi-Fi',
    outlets: '较少',
    callFriendly: false,
    unlimited: true,
    free: true,
    featured: false,
    verified: false,
    lastVerified: '2026-06-18',
    description: '空间安静，适合阅读与写作。插座情况需要贡献者再次确认。',
    workModes: ['深度工作', '免费办公'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-baijiahu-coffee',
    name: '示例 · 百家湖湖景咖啡馆',
    category: 'coffee',
    lng: 118.8178,
    lat: 31.9395,
    address: '百家湖商圈（示例数据）',
    district: '江宁区',
    metroStation: '百家湖站',
    metroMinutes: 8,
    price: '¥32–58',
    hours: '09:00–22:30',
    quietLevel: 3,
    wifi: '稳定',
    outlets: '靠墙座位',
    callFriendly: true,
    unlimited: true,
    free: false,
    featured: false,
    verified: true,
    lastVerified: '2026-06-25',
    description: '采光好，工作日下午较舒适。建议优先选择靠墙有插座的位置。',
    workModes: ['创意工作', '视频会议'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-south-station-hotel',
    name: '示例 · 南京南站酒店大堂',
    category: 'hotel',
    lng: 118.7974,
    lat: 31.9681,
    address: '南京南站附近（示例数据）',
    district: '雨花台区',
    metroStation: '南京南站',
    metroMinutes: 5,
    price: '饮品约 ¥45',
    hours: '07:00–23:00',
    quietLevel: 3,
    wifi: '需询问',
    outlets: '少量',
    callFriendly: true,
    unlimited: false,
    free: false,
    featured: false,
    verified: false,
    lastVerified: '2026-06-15',
    description: '适合换乘间隙临时处理工作，不建议作为长期办公地点。',
    workModes: ['临时办公', '商务会面'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'seed-yuhuatai-public',
    name: '示例 · 软件谷公共休息空间',
    category: 'public',
    lng: 118.7558,
    lat: 31.9812,
    address: '软件谷片区（示例数据）',
    district: '雨花台区',
    metroStation: '天隆寺站',
    metroMinutes: 9,
    price: '免费',
    hours: '08:30–19:00',
    quietLevel: 3,
    wifi: '需验证',
    outlets: '少量',
    callFriendly: true,
    unlimited: false,
    free: true,
    featured: false,
    verified: false,
    lastVerified: '2026-06-12',
    description: '适合短时间等人、处理邮件或电话，开放规则需进一步核实。',
    workModes: ['临时办公', '免费办公'],
    images: [],
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function defaultDb() {
  return {
    version: 1,
    places: seedPlaces,
    submissions: [],
    contributors: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    writeDb(defaultDb());
  }
}

function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (error) {
    const backupPath = `${DB_PATH}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(DB_PATH, backupPath); } catch {}
    const db = defaultDb();
    writeDb(db);
    return db;
  }
}

function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  const tempPath = `${DB_PATH}.${process.pid}.tmp`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_PATH);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, status, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function parseBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function cleanString(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanString(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function numberInRange(value, min, max, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const encoded = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return verifyToken(token);
}

function requireRole(req, res, roles) {
  const user = authUser(req);
  if (!user || !roles.includes(user.role)) {
    json(res, 401, { error: '请先登录或权限不足。' });
    return null;
  }
  return user;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(derived, hash);
}

function saveImage(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw Object.assign(new Error('仅支持 JPG、PNG 或 WebP 图片。'), { statusCode: 400 });
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2.5 * 1024 * 1024) {
    throw Object.assign(new Error('单张图片不能超过 2.5MB。'), { statusCode: 413 });
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const filename = `${Date.now()}-${crypto.randomBytes(7).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

function normalizeSubmission(body, user = null) {
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 3) : [];
  const savedPhotos = photos.map(saveImage).filter(Boolean);
  const submission = {
    id: id('sub'),
    status: 'pending',
    submitterType: user?.role === 'contributor' ? 'contributor' : 'public',
    submitterEmail: user?.email || cleanEmail(body.email),
    submitterName: user?.name || cleanString(body.name, 80),
    name: cleanString(body.placeName, 120),
    category: categoryLabels[body.category] ? body.category : 'coffee',
    address: cleanString(body.address, 240),
    district: cleanString(body.district, 60),
    lng: numberInRange(body.lng, 118.3, 119.4),
    lat: numberInRange(body.lat, 31.5, 32.6),
    metroStation: cleanString(body.metroStation, 80),
    metroMinutes: numberInRange(body.metroMinutes, 0, 90),
    visitDate: cleanString(body.visitDate, 20),
    workDuration: cleanString(body.workDuration, 60),
    quietLevel: numberInRange(body.quietLevel, 1, 5, 3),
    wifi: cleanString(body.wifi, 60),
    outlets: cleanString(body.outlets, 80),
    price: cleanString(body.price, 60),
    hours: cleanString(body.hours, 80),
    callFriendly: bool(body.callFriendly),
    unlimited: bool(body.unlimited),
    free: bool(body.free),
    description: cleanString(body.description, 1600),
    evidenceNote: cleanString(body.evidenceNote, 800),
    images: savedPhotos,
    reviewNote: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const errors = [];
  if (!submission.name) errors.push('地点名称');
  if (!submission.address) errors.push('详细地址');
  if (!submission.submitterEmail) errors.push('有效邮箱');
  if (!submission.visitDate) errors.push('实际到访日期');
  if (!submission.workDuration) errors.push('实际办公时长');
  if (submission.description.length < 40) errors.push('不少于 40 字的办公体验');
  if (submission.submitterType === 'public' && savedPhotos.length < 1) errors.push('至少 1 张现场图片');
  if (cleanString(body.website, 200)) errors.push('提交验证失败');
  if (errors.length) {
    for (const imagePath of savedPhotos) {
      try { fs.unlinkSync(path.join(DATA_DIR, imagePath.replace(/^\//, ''))); } catch {}
    }
    throw Object.assign(new Error(`请补充：${errors.join('、')}。`), { statusCode: 400 });
  }
  return submission;
}

function submissionToPlace(submission, overrides = {}) {
  return {
    id: id('place'),
    name: submission.name,
    category: submission.category,
    lng: submission.lng,
    lat: submission.lat,
    address: submission.address,
    district: submission.district,
    metroStation: submission.metroStation,
    metroMinutes: submission.metroMinutes,
    price: submission.price || (submission.free ? '免费' : '待确认'),
    hours: submission.hours || '待确认',
    quietLevel: submission.quietLevel,
    wifi: submission.wifi || '待确认',
    outlets: submission.outlets || '待确认',
    callFriendly: submission.callFriendly,
    unlimited: submission.unlimited,
    free: submission.free,
    featured: bool(overrides.featured),
    verified: bool(overrides.verified),
    lastVerified: submission.visitDate || new Date().toISOString().slice(0, 10),
    description: submission.description,
    workModes: Array.isArray(overrides.workModes) ? overrides.workModes.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 4) : [],
    images: submission.images || [],
    sourceSubmissionId: submission.id,
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const rateBuckets = new Map();
function rateLimited(req, key, limit, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const existing = rateBuckets.get(bucketKey) || [];
  const fresh = existing.filter((time) => now - time < windowMs);
  if (fresh.length >= limit) return true;
  fresh.push(now);
  rateBuckets.set(bucketKey, fresh);
  return false;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://webapi.amap.com https://*.amap.com",
    "style-src 'self' 'unsafe-inline' https://webapi.amap.com https://*.amap.com",
    "img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com",
    "connect-src 'self' https://*.amap.com https://*.autonavi.com https://restapi.amap.com",
    "font-src 'self' data:",
    "worker-src 'self' blob:"
  ].join('; '));
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function serveFile(req, res, requestPath) {
  let filePath;
  if (requestPath.startsWith('/uploads/')) {
    filePath = path.join(DATA_DIR, requestPath.replace(/^\//, ''));
  } else {
    const normalized = requestPath === '/' ? '/index.html' : requestPath;
    filePath = path.join(PUBLIC_DIR, normalized);
  }
  const allowedRoot = requestPath.startsWith('/uploads/') ? UPLOAD_DIR : PUBLIC_DIR;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(allowedRoot))) {
    return text(res, 403, 'Forbidden');
  }
  fs.stat(resolved, (error, stat) => {
    if (error || !stat.isFile()) return text(res, 404, 'Not found');
    const headers = {
      'Content-Type': mimeType(resolved),
      'Content-Length': stat.size,
      'Cache-Control': requestPath.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300'
    };
    res.writeHead(200, headers);
    fs.createReadStream(resolved).pipe(res);
  });
}

function publicPlace(place) {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    categoryLabel: categoryLabels[place.category] || '地点',
    lng: place.lng,
    lat: place.lat,
    address: place.address,
    district: place.district,
    metroStation: place.metroStation,
    metroMinutes: place.metroMinutes,
    price: place.price,
    hours: place.hours,
    quietLevel: place.quietLevel,
    wifi: place.wifi,
    outlets: place.outlets,
    callFriendly: place.callFriendly,
    unlimited: place.unlimited,
    free: place.free,
    featured: place.featured,
    verified: place.verified,
    lastVerified: place.lastVerified,
    description: place.description,
    workModes: place.workModes || [],
    images: place.images || [],
    isDemo: place.isDemo === true
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    return json(res, 200, {
      appName: process.env.APP_NAME || '南京办公地图',
      appNameEn: process.env.APP_NAME_EN || 'Nanjing Work Map',
      amapKey: process.env.AMAP_JS_KEY || '',
      amapSecurityCode: process.env.AMAP_SECURITY_CODE || '',
      mapMode: process.env.AMAP_JS_KEY ? 'amap' : 'demo',
      adminConfigured: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET)
    });
  }

  if (url.pathname === '/api/places' && req.method === 'GET') {
    const db = readDb();
    const places = db.places
      .filter((place) => !place.archived)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(publicPlace);
    return json(res, 200, { places });
  }

  if (url.pathname === '/api/submissions' && req.method === 'POST') {
    if (rateLimited(req, 'submission', 5, 60 * 60 * 1000)) {
      return json(res, 429, { error: '提交过于频繁，请稍后再试。' });
    }
    const body = await parseBody(req);
    const user = authUser(req);
    const submission = normalizeSubmission(body, user?.role === 'contributor' ? user : null);
    const db = readDb();
    db.submissions.unshift(submission);
    db.auditLog.unshift({ id: id('log'), action: 'submission_created', actor: submission.submitterEmail, targetId: submission.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 201, { ok: true, submissionId: submission.id, message: '已进入审核队列。' });
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (rateLimited(req, 'login', 12, 15 * 60 * 1000)) {
      return json(res, 429, { error: '登录尝试过多，请稍后再试。' });
    }
    const body = await parseBody(req, 100 * 1024);
    const email = cleanEmail(body.email);
    const password = cleanString(body.password, 300);
    let user = null;
    if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL && safeEqual(password, ADMIN_PASSWORD)) {
      user = { role: 'admin', email: ADMIN_EMAIL, name: '管理员' };
    } else {
      const db = readDb();
      const contributor = db.contributors.find((item) => item.email === email && item.active !== false);
      if (contributor && verifyPassword(password, contributor.passwordSalt, contributor.passwordHash)) {
        user = { role: 'contributor', email: contributor.email, name: contributor.name || contributor.email };
      }
    }
    if (!user) return json(res, 401, { error: '邮箱或密码不正确。' });
    const token = signToken({ ...user, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
    return json(res, 200, { token, user });
  }

  if (url.pathname === '/api/me' && req.method === 'GET') {
    const user = authUser(req);
    return user ? json(res, 200, { user }) : json(res, 401, { error: '登录已失效。' });
  }

  if (url.pathname === '/api/portal/overview' && req.method === 'GET') {
    const user = requireRole(req, res, ['admin', 'contributor']);
    if (!user) return;
    const db = readDb();
    const submissions = user.role === 'admin' ? db.submissions : db.submissions.filter((item) => item.submitterEmail === user.email);
    return json(res, 200, {
      user,
      counts: {
        pending: submissions.filter((item) => item.status === 'pending').length,
        approved: submissions.filter((item) => item.status === 'approved').length,
        rejected: submissions.filter((item) => item.status === 'rejected').length,
        places: db.places.filter((item) => !item.archived).length,
        contributors: db.contributors.filter((item) => item.active !== false).length
      },
      submissions: submissions.slice(0, 100),
      places: user.role === 'admin' ? db.places.filter((item) => !item.archived) : [],
      contributors: user.role === 'admin' ? db.contributors.map(({ passwordHash, passwordSalt, ...safe }) => safe) : []
    });
  }

  const submissionMatch = /^\/api\/admin\/submissions\/([^/]+)$/.exec(url.pathname);
  if (submissionMatch && req.method === 'PATCH') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const db = readDb();
    const submission = db.submissions.find((item) => item.id === submissionMatch[1]);
    if (!submission) return json(res, 404, { error: '未找到该提交。' });
    const nextStatus = ['approved', 'rejected', 'pending'].includes(body.status) ? body.status : submission.status;
    submission.status = nextStatus;
    submission.reviewNote = cleanString(body.reviewNote, 800);
    submission.updatedAt = new Date().toISOString();
    submission.reviewedAt = nextStatus === 'pending' ? null : new Date().toISOString();
    submission.reviewedBy = user.email;
    let place = null;
    if (nextStatus === 'approved') {
      place = db.places.find((item) => item.sourceSubmissionId === submission.id);
      if (!place) {
        place = submissionToPlace(submission, {
          featured: body.featured,
          verified: body.verified,
          workModes: body.workModes
        });
        db.places.unshift(place);
      }
    }
    db.auditLog.unshift({ id: id('log'), action: `submission_${nextStatus}`, actor: user.email, targetId: submission.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 200, { ok: true, submission, place: place ? publicPlace(place) : null });
  }

  if (url.pathname === '/api/admin/places' && req.method === 'POST') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const place = {
      id: id('place'),
      name: cleanString(body.name, 120),
      category: categoryLabels[body.category] ? body.category : 'coffee',
      lng: numberInRange(body.lng, 118.3, 119.4),
      lat: numberInRange(body.lat, 31.5, 32.6),
      address: cleanString(body.address, 240),
      district: cleanString(body.district, 60),
      metroStation: cleanString(body.metroStation, 80),
      metroMinutes: numberInRange(body.metroMinutes, 0, 90),
      price: cleanString(body.price, 60) || '待确认',
      hours: cleanString(body.hours, 80) || '待确认',
      quietLevel: numberInRange(body.quietLevel, 1, 5, 3),
      wifi: cleanString(body.wifi, 60) || '待确认',
      outlets: cleanString(body.outlets, 80) || '待确认',
      callFriendly: bool(body.callFriendly),
      unlimited: bool(body.unlimited),
      free: bool(body.free),
      featured: bool(body.featured),
      verified: bool(body.verified),
      lastVerified: cleanString(body.lastVerified, 20) || new Date().toISOString().slice(0, 10),
      description: cleanString(body.description, 1600),
      workModes: Array.isArray(body.workModes) ? body.workModes.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 4) : [],
      images: [],
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!place.name || !place.address || place.lng === null || place.lat === null) {
      return json(res, 400, { error: '地点名称、地址和有效经纬度为必填项。' });
    }
    const db = readDb();
    db.places.unshift(place);
    db.auditLog.unshift({ id: id('log'), action: 'place_created', actor: user.email, targetId: place.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 201, { ok: true, place: publicPlace(place) });
  }

  const placeMatch = /^\/api\/admin\/places\/([^/]+)$/.exec(url.pathname);
  if (placeMatch && req.method === 'PATCH') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const db = readDb();
    const place = db.places.find((item) => item.id === placeMatch[1]);
    if (!place) return json(res, 404, { error: '未找到地点。' });
    const editable = ['name', 'address', 'district', 'metroStation', 'price', 'hours', 'wifi', 'outlets', 'description', 'lastVerified'];
    for (const key of editable) if (key in body) place[key] = cleanString(body[key], key === 'description' ? 1600 : 240);
    if (categoryLabels[body.category]) place.category = body.category;
    if ('lng' in body) place.lng = numberInRange(body.lng, 118.3, 119.4, place.lng);
    if ('lat' in body) place.lat = numberInRange(body.lat, 31.5, 32.6, place.lat);
    if ('metroMinutes' in body) place.metroMinutes = numberInRange(body.metroMinutes, 0, 90, place.metroMinutes);
    if ('quietLevel' in body) place.quietLevel = numberInRange(body.quietLevel, 1, 5, place.quietLevel);
    for (const key of ['callFriendly', 'unlimited', 'free', 'featured', 'verified']) if (key in body) place[key] = bool(body[key]);
    if (Array.isArray(body.workModes)) place.workModes = body.workModes.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 4);
    place.updatedAt = new Date().toISOString();
    db.auditLog.unshift({ id: id('log'), action: 'place_updated', actor: user.email, targetId: place.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 200, { ok: true, place: publicPlace(place) });
  }

  if (placeMatch && req.method === 'DELETE') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const db = readDb();
    const place = db.places.find((item) => item.id === placeMatch[1]);
    if (!place) return json(res, 404, { error: '未找到地点。' });
    place.archived = true;
    place.updatedAt = new Date().toISOString();
    db.auditLog.unshift({ id: id('log'), action: 'place_archived', actor: user.email, targetId: place.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/contributors' && req.method === 'POST') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req, 200 * 1024);
    const email = cleanEmail(body.email);
    const name = cleanString(body.name, 80);
    const password = cleanString(body.password, 300);
    if (!email || password.length < 8) return json(res, 400, { error: '请输入有效邮箱，临时密码至少 8 位。' });
    const db = readDb();
    if (email === ADMIN_EMAIL || db.contributors.some((item) => item.email === email)) {
      return json(res, 409, { error: '该邮箱已经存在。' });
    }
    const { salt, hash } = hashPassword(password);
    const contributor = {
      id: id('user'),
      email,
      name: name || email.split('@')[0],
      passwordSalt: salt,
      passwordHash: hash,
      active: true,
      createdAt: new Date().toISOString()
    };
    db.contributors.unshift(contributor);
    db.auditLog.unshift({ id: id('log'), action: 'contributor_created', actor: user.email, targetId: contributor.id, createdAt: new Date().toISOString() });
    writeDb(db);
    const { passwordHash, passwordSalt, ...safeContributor } = contributor;
    return json(res, 201, { ok: true, contributor: safeContributor });
  }

  const contributorMatch = /^\/api\/admin\/contributors\/([^/]+)$/.exec(url.pathname);
  if (contributorMatch && req.method === 'PATCH') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req, 200 * 1024);
    const db = readDb();
    const contributor = db.contributors.find((item) => item.id === contributorMatch[1]);
    if (!contributor) return json(res, 404, { error: '未找到贡献者。' });
    if ('active' in body) contributor.active = bool(body.active);
    if (body.password && cleanString(body.password, 300).length >= 8) {
      const { salt, hash } = hashPassword(cleanString(body.password, 300));
      contributor.passwordSalt = salt;
      contributor.passwordHash = hash;
    }
    if (body.name) contributor.name = cleanString(body.name, 80);
    contributor.updatedAt = new Date().toISOString();
    writeDb(db);
    const { passwordHash, passwordSalt, ...safeContributor } = contributor;
    return json(res, 200, { ok: true, contributor: safeContributor });
  }

  return json(res, 404, { error: 'API endpoint not found.' });
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      return serveFile(req, res, '/admin.html');
    }
    serveFile(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      json(res, error.statusCode || 500, { error: error.statusCode ? error.message : '服务器暂时无法处理请求。' });
    } else {
      res.end();
    }
  }
});

ensureDb();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nanjing Work Map running on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    console.warn('WARNING: ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET are not fully configured. Set them before public launch.');
  }
});
