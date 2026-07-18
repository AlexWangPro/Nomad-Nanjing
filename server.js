import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = '3.0.0';
const PORT = Number(process.env.PORT || 3000);
const RAILWAY_VOLUME_MOUNT_PATH = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
const DATA_DIR = path.resolve(RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data'));
const SQLITE_PATH = path.join(DATA_DIR, 'nomad-nanjing.sqlite');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || (IS_PRODUCTION ? '' : 'admin@nanjing.local')).toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'ChangeMeNow!');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? crypto.randomBytes(32).toString('hex') : 'local-development-secret-change-this-now');
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

fs.mkdirSync(DATA_DIR, { recursive: true });

if (IS_PRODUCTION && (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID) && !RAILWAY_VOLUME_MOUNT_PATH) {
  throw new Error('Persistent storage protection: attach a Railway Volume to this service at /data before deployment. The app refuses to start without a Volume so user data cannot be stored on an ephemeral filesystem.');
}

const categoryLabels = {
  coffee: '咖啡馆',
  library: '图书馆',
  coworking: '共享办公',
  public: '公共空间',
  hotel: '酒店大堂'
};


const submissionOptionLabels = {
  visitRecency: {
    today: '今天',
    week: '最近一周',
    month: '最近一个月',
    older: '一个月以前'
  },
  workDuration: {
    under30: '少于 30 分钟',
    '30to60': '30–60 分钟',
    '1to3': '1–3 小时',
    over3: '3 小时以上',
    observed: '没有办公，只观察过'
  },
  overallSuitability: {
    excellent: '非常适合办公',
    good: '基本适合办公',
    limited: '只适合短暂停留',
    unsuitable: '不适合办公'
  },
  outletsChoice: {
    many: '很多',
    some: '有一些',
    few: '很少',
    none: '没有',
    unknown: '不确定'
  },
  wifiChoice: {
    stable: '稳定好用',
    average: '一般',
    unstable: '不稳定',
    none: '没有',
    untested: '没测试'
  },
  quietChoice: {
    silent: '很安静',
    quiet: '比较安静',
    noisy: '有些嘈杂',
    loud: '很吵',
    unknown: '不确定'
  },
  callChoice: {
    suitable: '适合电话或视频会议',
    quiet_only: '小声通话可以',
    unsuitable: '不太适合',
    forbidden: '明确不允许',
    unknown: '不确定'
  },
  longStayChoice: {
    over3: '适合 3 小时以上',
    '1to3': '适合 1–3 小时',
    short: '只适合短暂停留',
    unknown: '不确定'
  },
  priceChoice: {
    free: '免费',
    under30: '¥1–30',
    '31to50': '¥31–50',
    '51to100': '¥51–100',
    over100: '¥100 以上',
    unknown: '不确定'
  },
  seatingChoice: {
    ample: '座位充足',
    available: '通常能找到',
    crowded: '经常满座',
    unknown: '不确定'
  },
  crowdChoice: {
    relaxed: '通常不拥挤',
    peak_only: '高峰时拥挤',
    crowded: '经常拥挤',
    unknown: '不确定'
  }
};

function enumChoice(group, value, fallback = 'unknown') {
  const clean = cleanString(value, 40);
  return submissionOptionLabels[group]?.[clean] ? clean : fallback;
}

function optionLabel(group, value, fallback = '未回答') {
  return submissionOptionLabels[group]?.[value] || fallback;
}

function normalizedPlaceName(value) {
  return cleanString(value, 160)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/南京|门店|店|分店|旗舰店|咖啡|coffee|空间|中心/g, '')
    .replace(/[\s·•,，.。\-—_\/\\]/g, '');
}

function distanceMeters(aLng, aLat, bLng, bLat) {
  const toRad = (n) => n * Math.PI / 180;
  const radius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function findDuplicatePlaces(submission, db) {
  const targetName = normalizedPlaceName(submission.name);
  return (db.places || [])
    .filter((place) => !place.archived)
    .map((place) => {
      const samePoi = Boolean(submission.amapPoiId && place.amapPoiId && submission.amapPoiId === place.amapPoiId);
      const distance = Number.isFinite(submission.lng) && Number.isFinite(submission.lat) && Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat))
        ? distanceMeters(submission.lng, submission.lat, Number(place.lng), Number(place.lat))
        : 999999;
      const candidateName = normalizedPlaceName(place.name);
      const similarName = Boolean(targetName && candidateName && (targetName.includes(candidateName) || candidateName.includes(targetName)));
      const likely = samePoi || distance <= 45 || (distance <= 120 && similarName);
      return likely ? {
        id: place.id,
        name: place.name,
        address: place.address,
        distanceMeters: distance,
        reason: samePoi ? '同一高德地点' : distance <= 45 ? '位置非常接近' : '名称相似且位置接近'
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

function suggestedTagsFromSubmission(submission) {
  const tags = [];
  if (['silent', 'quiet'].includes(submission.quietChoice)) tags.push('适合深度工作');
  if (submission.outletsChoice === 'many') tags.push('插座充足');
  else if (submission.outletsChoice === 'some') tags.push('有插座');
  if (submission.wifiChoice === 'stable') tags.push('Wi-Fi 稳定');
  if (submission.callChoice === 'suitable') tags.push('适合视频会议');
  else if (submission.callChoice === 'quiet_only') tags.push('可小声通话');
  if (submission.longStayChoice === 'over3') tags.push('适合长时间办公');
  if (submission.priceChoice === 'free') tags.push('免费办公');
  if (submission.seatingChoice === 'ample') tags.push('座位充足');
  if (['peak_only', 'crowded'].includes(submission.crowdChoice)) tags.push('高峰拥挤');
  if (submission.overallSuitability === 'limited') tags.push('适合短时办公');
  return [...new Set(tags)].slice(0, 8);
}

function calculateSubmissionConfidence(submission) {
  let score = submission.submitterType === 'contributor' ? 35 : 20;
  if (submission.actualWorked) score += 18;
  if (['1to3', 'over3'].includes(submission.workDurationChoice)) score += 12;
  else if (submission.workDurationChoice === '30to60') score += 7;
  if (['today', 'week'].includes(submission.visitRecency)) score += 12;
  else if (submission.visitRecency === 'month') score += 7;
  if (submission.images.length) score += 12;
  const answered = ['outletsChoice', 'wifiChoice', 'quietChoice', 'callChoice', 'longStayChoice', 'priceChoice', 'seatingChoice', 'crowdChoice']
    .filter((key) => !['unknown', 'untested'].includes(submission[key])).length;
  score += Math.min(16, answered * 2);
  if (submission.experienceNote.length >= 30) score += 5;
  score = Math.min(100, score);
  return {
    score,
    label: score >= 75 ? '可信度较高' : score >= 50 ? '信息基本完整' : '需要进一步确认'
  };
}

function generatedSubmissionDescription(submission) {
  const parts = [
    optionLabel('overallSuitability', submission.overallSuitability),
    optionLabel('workDuration', submission.workDurationChoice),
    optionLabel('quietChoice', submission.quietChoice),
    optionLabel('wifiChoice', submission.wifiChoice),
    optionLabel('outletsChoice', submission.outletsChoice),
    optionLabel('callChoice', submission.callChoice),
    optionLabel('longStayChoice', submission.longStayChoice),
    optionLabel('priceChoice', submission.priceChoice),
    optionLabel('seatingChoice', submission.seatingChoice)
  ].filter((value) => value && value !== '未回答' && value !== '不确定' && value !== '没测试');
  return submission.experienceNote || parts.join(' · ') || '用户提交了该地点的办公体验，详细条件待管理员确认。';
}


const candidatePlaceSearches = [
  { query: '南京图书馆', category: 'library' },
  { query: '金陵图书馆', category: 'library' },
  { query: '南京市少年儿童图书馆', category: 'library' },
  { query: '玄武区图书馆', category: 'library' },
  { query: '秦淮区图书馆', category: 'library' },
  { query: '建邺区图书馆', category: 'library' },
  { query: '鼓楼区图书馆 南京', category: 'library' },
  { query: '栖霞区图书馆', category: 'library' },
  { query: '雨花台区图书馆', category: 'library' },
  { query: '江宁区图书馆', category: 'library' },
  { query: '浦口区图书馆', category: 'library' },
  { query: '六合区图书馆', category: 'library' },
  { query: '溧水区图书馆', category: 'library' },
  { query: '高淳区图书馆', category: 'library' },
  { query: '江北新区图书馆', category: 'library' },
  { query: '先锋书店 五台山', category: 'public' },
  { query: '先锋书店 颐和书馆', category: 'public' },
  { query: '大众书局 南京书城', category: 'public' },
  { query: '金陵书苑', category: 'public' },
  { query: '南京城市书房', category: 'library' },
  { query: '星巴克 新街口 南京', category: 'coffee' },
  { query: '星巴克 德基广场', category: 'coffee' },
  { query: '星巴克 南京1912', category: 'coffee' },
  { query: '星巴克 大行宫 南京', category: 'coffee' },
  { query: '星巴克 鼓楼 南京', category: 'coffee' },
  { query: '星巴克 紫峰 南京', category: 'coffee' },
  { query: '星巴克 金鹰世界 南京', category: 'coffee' },
  { query: '星巴克 南京国际金融中心', category: 'coffee' },
  { query: '星巴克 华采天地 南京', category: 'coffee' },
  { query: '星巴克 奥体 南京', category: 'coffee' },
  { query: '星巴克 南京南站', category: 'coffee' },
  { query: '星巴克 景枫中心', category: 'coffee' },
  { query: '星巴克 百家湖 南京', category: 'coffee' },
  { query: '星巴克 仙林金鹰', category: 'coffee' },
  { query: '星巴克 南京万象天地', category: 'coffee' },
  { query: '星巴克 环宇城 南京', category: 'coffee' },
  { query: '星巴克 河西天街 南京', category: 'coffee' },
  { query: '星巴克 江北新区 南京', category: 'coffee' },
  { query: 'MANNER咖啡 新街口 南京', category: 'coffee' },
  { query: 'MANNER咖啡 南京国际金融中心', category: 'coffee' },
  { query: '共享办公 新街口 南京', category: 'coworking' },
  { query: '共享办公 河西 南京', category: 'coworking' },
  { query: '共享办公 南京国际金融中心', category: 'coworking' },
  { query: '共享办公 软件谷 南京', category: 'coworking' },
  { query: '共享办公 江宁 南京', category: 'coworking' },
  { query: '共享办公 江北新区 南京', category: 'coworking' },
  { query: '金陵饭店 南京', category: 'hotel' },
  { query: '南京香格里拉大酒店', category: 'hotel' }
];

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
    version: 3,
    places: seedPlaces,
    submissions: [],
    contributors: [],
    auditLog: [],
    meta: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

let sqlite;

function initializeDatabase() {
  sqlite = new DatabaseSync(SQLITE_PATH);
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state_history (
      revision INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const existing = sqlite.prepare('SELECT id FROM app_state WHERE id = 1').get();
  if (existing) return;

  let initial = defaultDb();
  if (fs.existsSync(LEGACY_DB_PATH)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
      if (legacy && Array.isArray(legacy.places) && Array.isArray(legacy.submissions)) {
        initial = legacy;
        initial.meta ||= {};
        initial.meta.migratedFromJsonAt = new Date().toISOString();

        const migratedMedia = new Map();
        const migrateImageUrl = (imageUrl) => {
          const match = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(String(imageUrl || ''));
          if (!match) return imageUrl;
          if (migratedMedia.has(imageUrl)) return migratedMedia.get(imageUrl);
          const legacyImagePath = path.join(DATA_DIR, 'uploads', match[1]);
          if (!fs.existsSync(legacyImagePath)) return imageUrl;
          try {
            const buffer = fs.readFileSync(legacyImagePath);
            const mediaId = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
            sqlite.prepare('INSERT INTO media (id, content_type, bytes, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(mediaId, 'image/webp', buffer, buffer.length, new Date().toISOString());
            const nextUrl = `/media/${mediaId}.webp`;
            migratedMedia.set(imageUrl, nextUrl);
            return nextUrl;
          } catch (error) {
            console.warn('Legacy image migration skipped:', match[1], error.message);
            return imageUrl;
          }
        };
        for (const collection of [initial.places, initial.submissions]) {
          for (const item of collection) {
            if (Array.isArray(item.images)) item.images = item.images.map(migrateImageUrl);
          }
        }
        initial.meta.migratedMediaCount = migratedMedia.size;
      }
    } catch (error) {
      console.warn('Legacy JSON migration skipped:', error.message);
    }
  }

  initial.updatedAt = new Date().toISOString();
  sqlite.prepare('INSERT INTO app_state (id, data, revision, updated_at) VALUES (1, ?, 1, ?)')
    .run(JSON.stringify(initial), initial.updatedAt);
}

function ensureDb() {
  if (!sqlite) initializeDatabase();
}

function readDb() {
  ensureDb();
  const row = sqlite.prepare('SELECT data FROM app_state WHERE id = 1').get();
  if (!row?.data) throw new Error('SQLite application state is missing. Restore a Railway Volume backup instead of reinitializing the database.');
  try {
    return JSON.parse(row.data);
  } catch (error) {
    throw new Error(`SQLite application state is invalid: ${error.message}. The database was not overwritten.`);
  }
}

function writeDb(db) {
  ensureDb();
  db.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(db);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const current = sqlite.prepare('SELECT data, revision FROM app_state WHERE id = 1').get();
    const nextRevision = Number(current?.revision || 0) + 1;
    if (current?.data) {
      sqlite.prepare('INSERT OR REPLACE INTO app_state_history (revision, data, created_at) VALUES (?, ?, ?)')
        .run(Number(current.revision || 1), current.data, new Date().toISOString());
    }
    sqlite.prepare('UPDATE app_state SET data = ?, revision = ?, updated_at = ? WHERE id = 1')
      .run(serialized, nextRevision, db.updatedAt);
    sqlite.prepare('DELETE FROM app_state_history WHERE revision NOT IN (SELECT revision FROM app_state_history ORDER BY revision DESC LIMIT 50)').run();
    sqlite.exec('COMMIT');
  } catch (error) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function saveMedia(buffer) {
  ensureDb();
  const mediaId = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
  sqlite.prepare('INSERT INTO media (id, content_type, bytes, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(mediaId, 'image/webp', buffer, buffer.length, new Date().toISOString());
  return `/media/${mediaId}.webp`;
}

function deleteMediaByUrl(mediaUrl) {
  const match = /^\/media\/([A-Za-z0-9-]+)\.webp$/.exec(String(mediaUrl || ''));
  if (!match) return;
  ensureDb();
  sqlite.prepare('DELETE FROM media WHERE id = ?').run(match[1]);
}

function getMediaById(mediaId) {
  ensureDb();
  return sqlite.prepare('SELECT content_type, bytes, size_bytes, created_at FROM media WHERE id = ?').get(mediaId);
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

async function convertToWebpUnderLimit(buffer, targetBytes = 100 * 1024) {
  const dimensions = [1600, 1400, 1200, 1000, 850, 720, 600, 480, 360, 280];
  const qualities = [82, 72, 62, 52, 42, 34, 28, 22, 18];
  let smallest = null;

  for (const dimension of dimensions) {
    const base = sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({
        width: dimension,
        height: dimension,
        fit: 'inside',
        withoutEnlargement: true
      });

    for (const quality of qualities) {
      const output = await base.clone().webp({
        quality,
        effort: 5,
        smartSubsample: true
      }).toBuffer();
      if (!smallest || output.length < smallest.length) smallest = output;
      if (output.length <= targetBytes) return output;
    }
  }

  if (smallest && smallest.length <= targetBytes) return smallest;
  throw Object.assign(new Error('图片内容过于复杂，无法压缩到 100KB 内。请换一张或先裁剪后重试。'), { statusCode: 413 });
}

async function saveImage(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw Object.assign(new Error('仅支持 JPG、PNG 或 WebP 图片。'), { statusCode: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 12 * 1024 * 1024) {
    throw Object.assign(new Error('单张原始图片不能超过 12MB。'), { statusCode: 413 });
  }

  let webp;
  try {
    webp = await convertToWebpUnderLimit(buffer);
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error('图片处理失败，请换一张图片后重试。'), { statusCode: 400 });
  }

  return saveMedia(webp);
}

async function normalizeSubmission(body, user = null, db = { places: [] }) {
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 8) : [];
  const savedPhotos = [];
  try {
    for (const photo of photos) {
      const saved = await saveImage(photo);
      if (saved) savedPhotos.push(saved);
    }
  } catch (error) {
    for (const imagePath of savedPhotos) deleteMediaByUrl(imagePath);
    throw error;
  }
  const actualWorked = body.actualWorked === false || body.actualWorked === 'false' ? false : true;
  const quietChoice = enumChoice('quietChoice', body.quietChoice || ({ 5: 'silent', 4: 'quiet', 3: 'unknown', 2: 'noisy', 1: 'loud' }[String(body.quietLevel)]));
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
    amapPoiId: cleanString(body.amapPoiId, 80),
    actualWorked,
    visitRecency: enumChoice('visitRecency', body.visitRecency, 'month'),
    visitDate: cleanString(body.visitDate, 20),
    workDurationChoice: actualWorked ? enumChoice('workDuration', body.workDurationChoice || body.workDuration, '30to60') : 'observed',
    overallSuitability: enumChoice('overallSuitability', body.overallSuitability, 'good'),
    outletsChoice: enumChoice('outletsChoice', body.outletsChoice),
    wifiChoice: enumChoice('wifiChoice', body.wifiChoice),
    quietChoice,
    callChoice: enumChoice('callChoice', body.callChoice),
    longStayChoice: enumChoice('longStayChoice', body.longStayChoice),
    priceChoice: enumChoice('priceChoice', body.priceChoice),
    seatingChoice: enumChoice('seatingChoice', body.seatingChoice),
    crowdChoice: enumChoice('crowdChoice', body.crowdChoice),
    experienceNote: cleanString(body.experienceNote || body.description, 1600),
    evidenceNote: cleanString(body.evidenceNote, 800),
    images: savedPhotos,
    reviewNote: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  submission.workDuration = optionLabel('workDuration', submission.workDurationChoice);
  submission.quietLevel = { silent: 5, quiet: 4, unknown: 3, noisy: 2, loud: 1 }[submission.quietChoice] || 3;
  submission.wifi = optionLabel('wifiChoice', submission.wifiChoice, '待确认');
  submission.outlets = optionLabel('outletsChoice', submission.outletsChoice, '待确认');
  submission.price = optionLabel('priceChoice', submission.priceChoice, '待确认');
  submission.callFriendly = submission.callChoice === 'suitable' || submission.callChoice === 'quiet_only';
  submission.unlimited = submission.longStayChoice === 'over3';
  submission.free = submission.priceChoice === 'free';
  submission.description = generatedSubmissionDescription(submission);
  submission.suggestedTags = suggestedTagsFromSubmission(submission);
  submission.confidence = calculateSubmissionConfidence(submission);
  submission.duplicateMatches = findDuplicatePlaces(submission, db);

  const errors = [];
  if (!submission.name) errors.push('地点名称');
  if (!submission.address) errors.push('地图识别地址');
  if (submission.lng === null || submission.lat === null) errors.push('通过地图确认的精确位置');
  if (!submission.submitterEmail) errors.push('有效邮箱');
  if (!submission.visitRecency) errors.push('到访时间');
  if (!submission.workDurationChoice) errors.push('办公时长');
  if (!submission.overallSuitability) errors.push('总体结论');
  if (cleanString(body.website, 200)) errors.push('提交验证失败');
  if (errors.length) {
    for (const imagePath of savedPhotos) deleteMediaByUrl(imagePath);
    throw Object.assign(new Error(`请补充：${errors.join('、')}。`), { statusCode: 400 });
  }
  return submission;
}

function submissionToPlace(submission, overrides = {}) {
  const chosenTags = Array.isArray(overrides.workModes) && overrides.workModes.length
    ? overrides.workModes
    : submission.suggestedTags || [];
  return {
    id: id('place'),
    name: submission.name,
    category: submission.category,
    lng: submission.lng,
    lat: submission.lat,
    amapPoiId: submission.amapPoiId || '',
    address: submission.address,
    district: submission.district,
    metroStation: '',
    metroMinutes: null,
    price: submission.price || '待确认',
    hours: '待确认',
    quietLevel: submission.quietLevel,
    wifi: submission.wifi || '待确认',
    outlets: submission.outlets || '待确认',
    callFriendly: submission.callFriendly,
    unlimited: submission.unlimited,
    free: submission.free,
    featured: bool(overrides.featured),
    verified: bool(overrides.verified),
    lastVerified: submission.visitDate || new Date().toISOString().slice(0, 10),
    description: cleanString(overrides.description || submission.description, 1600),
    workModes: chosenTags.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 8),
    images: submission.images || [],
    sourceSubmissionId: submission.id,
    communityReports: [{
      submissionId: submission.id,
      submittedAt: submission.createdAt,
      submitterType: submission.submitterType,
      confidence: submission.confidence,
      choices: {
        overallSuitability: submission.overallSuitability,
        outletsChoice: submission.outletsChoice,
        wifiChoice: submission.wifiChoice,
        quietChoice: submission.quietChoice,
        callChoice: submission.callChoice,
        longStayChoice: submission.longStayChoice,
        priceChoice: submission.priceChoice,
        seatingChoice: submission.seatingChoice,
        crowdChoice: submission.crowdChoice
      }
    }],
    isDemo: false,
    verificationStatus: bool(overrides.verified) ? 'verified' : 'community',
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
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "font-src 'self' data: https:",
    "worker-src 'self' blob: https:",
    "frame-src 'self' https:"
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

function serveMedia(res, mediaId) {
  const row = getMediaById(mediaId);
  if (!row?.bytes) return text(res, 404, 'Not found');
  const body = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  res.writeHead(200, {
    'Content-Type': row.content_type || 'image/webp',
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function serveFile(req, res, requestPath) {
  const normalized = requestPath === '/' ? '/index.html' : requestPath;
  const resolved = path.resolve(path.join(PUBLIC_DIR, normalized));
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) return text(res, 403, 'Forbidden');
  fs.stat(resolved, (error, stat) => {
    if (error || !stat.isFile()) return text(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': mimeType(resolved),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, max-age=0, must-revalidate'
    });
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
    amapPoiId: place.amapPoiId || '',
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
    isDemo: place.isDemo === true,
    source: place.source || '',
    sourceQuery: place.sourceQuery || '',
    verificationStatus: place.verificationStatus || (place.verified ? 'verified' : 'pending')
  };
}


async function proxyAmapService(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const securityCode = String(process.env.AMAP_SECURITY_CODE || '').trim().replace(/^["']|["']$/g, '');
  if (!securityCode) return json(res, 503, { error: 'AMAP_SECURITY_CODE 未配置' });

  const relativePath = url.pathname.replace(/^\/_AMapService\/?/, '');
  const isStyleRequest = relativePath.startsWith('v4/map/styles');
  const upstreamBase = isStyleRequest ? 'https://webapi.amap.com/' : 'https://restapi.amap.com/';
  const target = new URL(relativePath + url.search, upstreamBase);
  target.searchParams.set('jscode', securityCode);

  try {
    const response = await fetch(target, {
      method: 'GET',
      headers: {
        'User-Agent': `NomadNanjing/${APP_VERSION}`,
        'Accept': req.headers.accept || '*/*'
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': response.headers.get('cache-control') || 'no-store',
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  } catch (error) {
    json(res, 502, { error: '高德代理请求失败', detail: error instanceof Error ? error.message : String(error) });
  }
}


function cleanMapValue(value) {
  const valueText = String(value || '').trim();
  if ((valueText.startsWith('"') && valueText.endsWith('"')) || (valueText.startsWith("'") && valueText.endsWith("'"))) {
    return valueText.slice(1, -1).trim();
  }
  return valueText;
}

function amapCredentials() {
  return {
    jsKey: cleanMapValue(process.env.AMAP_JS_KEY),
    jsSecurityCode: cleanMapValue(process.env.AMAP_SECURITY_CODE),
    webServiceKey: cleanMapValue(process.env.AMAP_WEB_SERVICE_KEY)
  };
}

async function amapRestRequest(pathname, params = {}, timeoutMs = 12000) {
  const { webServiceKey } = amapCredentials();
  if (!webServiceKey) {
    const error = new Error('AMAP_WEB_SERVICE_KEY 未配置。请创建“Web服务”类型的高德 Key。');
    error.statusCode = 503;
    throw error;
  }
  const upstreamBase = String(process.env.AMAP_REST_BASE || 'https://restapi.amap.com').replace(/\/+$/, '') + '/';
  const target = new URL(String(pathname).replace(/^\/+/, ''), upstreamBase);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(name, String(value));
  }
  target.searchParams.set('key', webServiceKey);
  target.searchParams.set('output', 'JSON');

  const upstream = await fetch(target, {
    headers: { 'User-Agent': `NomadNanjing/${APP_VERSION}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || payload.status !== '1') {
    const error = new Error(payload.info || payload.message || `高德服务请求失败（${upstream.status}）`);
    error.statusCode = 502;
    error.infocode = payload.infocode || '';
    throw error;
  }
  return payload;
}

function amapText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('');
  return cleanString(value, 300);
}

function normalizeAmapPoi(poi) {
  const location = String(poi?.location || '');
  const [lng, lat] = location.split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const province = amapText(poi.pname);
  const city = amapText(poi.cityname);
  const district = amapText(poi.adname);
  const streetAddress = amapText(poi.address);
  const address = [province, city, district, streetAddress].filter(Boolean).join('');
  return {
    id: cleanString(poi.id, 80),
    name: cleanString(poi.name, 160),
    address: address || district || '南京市',
    district,
    lng,
    lat,
    type: cleanString(poi.type, 200),
    typecode: cleanString(poi.typecode, 30),
    tel: amapText(poi.tel)
  };
}

async function searchAmapPlaces(query, { city = '南京', limit = 10 } = {}) {
  const payload = await amapRestRequest('/v3/place/text', {
    keywords: query,
    city,
    citylimit: 'true',
    offset: Math.max(1, Math.min(20, Number(limit) || 10)),
    page: 1,
    extensions: 'all'
  });
  return (Array.isArray(payload.pois) ? payload.pois : []).map(normalizeAmapPoi).filter(Boolean);
}

async function reverseAmapLocation(lng, lat) {
  const payload = await amapRestRequest('/v3/geocode/regeo', {
    location: `${lng},${lat}`,
    extensions: 'base',
    radius: 1000,
    roadlevel: 0
  });
  const regeocode = payload.regeocode || {};
  const component = regeocode.addressComponent || {};
  return {
    address: cleanString(regeocode.formatted_address, 300),
    district: amapText(component.district) || amapText(component.city)
  };
}

function mergeCandidatePlaces(db, rows, { removeDemo = true } = {}) {
  if (removeDemo) db.places = db.places.filter((item) => !item.isDemo);
  const existingPoiIds = new Set(db.places.map((item) => item.amapPoiId).filter(Boolean));
  const existingKeys = new Set(db.places.map((item) => `${String(item.name || '').replace(/\s+/g, '').toLowerCase()}|${String(item.address || '').replace(/\s+/g, '').toLowerCase()}`));
  const imported = [];
  const skipped = [];

  for (const row of rows) {
    const name = cleanString(row.name, 120);
    const address = cleanString(row.address, 240);
    const lng = numberInRange(row.lng, 118.3, 119.4);
    const lat = numberInRange(row.lat, 31.5, 32.6);
    const amapPoiId = cleanString(row.amapPoiId || row.id, 80);
    const sourceQuery = cleanString(row.sourceQuery, 120);
    const key = `${name.replace(/\s+/g, '').toLowerCase()}|${address.replace(/\s+/g, '').toLowerCase()}`;
    if (!name || !address || lng === null || lat === null) {
      skipped.push({ sourceQuery, reason: '位置信息不完整' });
      continue;
    }
    if ((amapPoiId && existingPoiIds.has(amapPoiId)) || existingKeys.has(key)) {
      skipped.push({ sourceQuery, name, reason: '已存在' });
      continue;
    }
    const category = categoryLabels[row.category] ? row.category : 'coffee';
    const place = {
      id: id('place'),
      name,
      category,
      lng,
      lat,
      amapPoiId,
      address,
      district: cleanString(row.district, 60),
      metroStation: '',
      metroMinutes: null,
      price: category === 'library' || category === 'public' ? '待确认' : '待验证',
      hours: '待验证',
      quietLevel: category === 'library' ? 4 : 3,
      wifi: '待验证',
      outlets: '待验证',
      callFriendly: false,
      unlimited: false,
      free: category === 'library',
      featured: false,
      verified: false,
      verificationStatus: 'pending',
      lastVerified: '',
      description: '基础收录：由高德地点检索预录。营业时间、Wi-Fi、插座、安静程度和长时间办公友好度均需实地验证。',
      workModes: ['待实地验证'],
      images: [],
      isDemo: false,
      source: 'amap_candidate',
      sourceQuery,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.places.push(place);
    if (amapPoiId) existingPoiIds.add(amapPoiId);
    existingKeys.add(key);
    imported.push(place);
  }
  return { imported, skipped };
}

async function resolveCandidatePlaces(candidates, onProgress) {
  const rows = [];
  const failed = [];
  let completed = 0;
  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(3, queue.length || 1) }, async () => {
    while (queue.length) {
      const candidate = queue.shift();
      try {
        const places = await searchAmapPlaces(candidate.query, { city: '南京', limit: 5 });
        const place = places[0];
        if (!place) {
          failed.push({ query: candidate.query, reason: '未找到结果' });
        } else {
          rows.push({
            ...place,
            amapPoiId: place.id,
            category: candidate.category,
            sourceQuery: candidate.query
          });
        }
      } catch (error) {
        failed.push({ query: candidate.query, reason: error.message });
      }
      completed += 1;
      onProgress?.({ completed, total: candidates.length, matched: rows.length, failed: failed.length });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  });
  await Promise.all(workers);
  return { rows, failed };
}

let candidateImportStatus = { running: false, completed: 0, total: candidatePlaceSearches.length, matched: 0, failed: 0, message: '尚未开始' };

async function importCandidatePlacesFromAmap({ actor = 'system', force = false } = {}) {
  if (candidateImportStatus.running) return { busy: true, status: candidateImportStatus };
  const db = readDb();
  db.meta ||= {};
  if (!force && Number(db.meta.candidateSeedVersion || 0) >= 3) {
    return { imported: 0, skipped: 0, failed: 0, alreadyDone: true };
  }

  candidateImportStatus = { running: true, completed: 0, total: candidatePlaceSearches.length, matched: 0, failed: 0, message: '正在检索高德地点' };
  try {
    const importedQueries = new Set(db.places.map((item) => item.sourceQuery).filter(Boolean));
    const candidates = force ? candidatePlaceSearches : candidatePlaceSearches.filter((item) => !importedQueries.has(item.query));
    const { rows, failed } = await resolveCandidatePlaces(candidates, (progress) => {
      candidateImportStatus = { running: true, ...progress, message: `正在检索 ${progress.completed}/${progress.total}` };
    });
    const result = mergeCandidatePlaces(db, rows, { removeDemo: rows.length > 0 });
    db.meta.candidateSeedVersion = rows.length > 0 ? 3 : Number(db.meta.candidateSeedVersion || 0);
    db.meta.candidateSeedAt = new Date().toISOString();
    db.meta.candidateSeedImported = result.imported.length;
    db.meta.candidateSeedFailed = failed.length;
    db.auditLog.unshift({ id: id('log'), action: 'candidate_places_imported_server', actor, count: result.imported.length, createdAt: new Date().toISOString() });
    writeDb(db);
    candidateImportStatus = {
      running: false,
      completed: candidates.length,
      total: candidates.length,
      matched: rows.length,
      failed: failed.length,
      message: `完成：新增 ${result.imported.length} 个，失败 ${failed.length} 个`
    };
    return { imported: result.imported.length, skipped: result.skipped.length, failed: failed.length, failedItems: failed.slice(0, 20) };
  } catch (error) {
    candidateImportStatus = { ...candidateImportStatus, running: false, message: `失败：${error.message}` };
    throw error;
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    ensureDb();
    const stateRow = sqlite.prepare('SELECT revision, updated_at FROM app_state WHERE id = 1').get();
    const mediaRow = sqlite.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM media').get();
    return json(res, 200, {
      ok: true,
      version: APP_VERSION,
      time: new Date().toISOString(),
      storage: {
        engine: 'sqlite',
        persistentVolume: Boolean(RAILWAY_VOLUME_MOUNT_PATH) || !IS_PRODUCTION,
        revision: Number(stateRow?.revision || 0),
        updatedAt: stateRow?.updated_at || '',
        mediaCount: Number(mediaRow?.count || 0),
        mediaBytes: Number(mediaRow?.bytes || 0)
      }
    });
  }


  if (url.pathname === '/api/amap/search' && req.method === 'GET') {
    if (rateLimited(req, 'amap-search', 60, 60 * 1000)) return json(res, 429, { error: '搜索过于频繁，请稍后再试。' });
    const query = cleanString(url.searchParams.get('q'), 80);
    const city = cleanString(url.searchParams.get('city') || '南京', 30) || '南京';
    const limit = numberInRange(url.searchParams.get('limit'), 1, 20, 10);
    if (query.length < 2) return json(res, 400, { error: '请输入至少两个字的店名。' });
    try {
      const places = await searchAmapPlaces(query, { city, limit });
      return json(res, 200, { ok: true, query, places });
    } catch (error) {
      return json(res, error.statusCode || 502, { error: error.message, infocode: error.infocode || '' });
    }
  }

  if (url.pathname === '/api/amap/regeo' && req.method === 'GET') {
    if (rateLimited(req, 'amap-regeo', 80, 60 * 1000)) return json(res, 429, { error: '地址识别过于频繁，请稍后再试。' });
    const lng = numberInRange(url.searchParams.get('lng'), 118.3, 119.4);
    const lat = numberInRange(url.searchParams.get('lat'), 31.5, 32.6);
    if (lng === null || lat === null) return json(res, 400, { error: '无效的南京位置。' });
    try {
      const result = await reverseAmapLocation(lng, lat);
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, error.statusCode || 502, { error: error.message, infocode: error.infocode || '' });
    }
  }


  if (url.pathname === '/api/amap-check' && req.method === 'GET') {
    const { jsKey, jsSecurityCode, webServiceKey } = amapCredentials();
    if (!jsKey || !jsSecurityCode || !webServiceKey) {
      return json(res, 200, {
        ok: false,
        stage: 'config',
        mapConfigReady: Boolean(jsKey && jsSecurityCode),
        webServiceReady: Boolean(webServiceKey),
        missing: [
          !jsKey ? 'AMAP_JS_KEY' : '',
          !jsSecurityCode ? 'AMAP_SECURITY_CODE' : '',
          !webServiceKey ? 'AMAP_WEB_SERVICE_KEY' : ''
        ].filter(Boolean),
        message: '高德配置不完整：地图显示需要 Web端(JS API) Key + 安全密钥；店名搜索和预录需要 Web服务 Key。'
      });
    }
    try {
      const target = new URL('https://restapi.amap.com/v3/config/district');
      target.searchParams.set('keywords', '南京市');
      target.searchParams.set('subdistrict', '0');
      target.searchParams.set('extensions', 'base');
      target.searchParams.set('key', webServiceKey);
      const upstream = await fetch(target, { signal: AbortSignal.timeout(10000) });
      const payload = await upstream.json().catch(() => ({}));
      return json(res, 200, {
        ok: payload.status === '1',
        stage: 'amap-webservice',
        mapConfigReady: true,
        webServiceReady: payload.status === '1',
        httpStatus: upstream.status,
        info: payload.info || null,
        infocode: payload.infocode || null,
        message: payload.status === '1'
          ? '高德地图显示配置已就绪，Web服务 Key 验证成功。'
          : 'Web服务 Key 验证失败，请检查 info 和 infocode。'
      });
    } catch (error) {
      return json(res, 200, {
        ok: false,
        stage: 'network',
        mapConfigReady: true,
        webServiceReady: false,
        message: '服务器无法访问高德 Web 服务接口',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    const cleanMapValue = (value) => {
      const text = String(value || '').trim();
      if ((text.startsWith('\"') && text.endsWith('\"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1).trim();
      }
      return text;
    };
    const amapKey = cleanMapValue(process.env.AMAP_JS_KEY);
    const amapSecurityCode = cleanMapValue(process.env.AMAP_SECURITY_CODE);
    return json(res, 200, {
      appName: process.env.APP_NAME || '南京数字游民办公地图',
      appNameEn: process.env.APP_NAME_EN || 'Nomad Nanjing',
      appVersion: APP_VERSION,
      amapKey,
      mapSecurityMode: 'server-proxy',
      mapMode: amapKey ? 'amap' : 'demo',
      mapConfigReady: Boolean(amapKey && amapSecurityCode),
      webServiceConfigured: Boolean(cleanMapValue(process.env.AMAP_WEB_SERVICE_KEY)),
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
    const db = readDb();
    const submission = await normalizeSubmission(body, user?.role === 'contributor' ? user : null, db);
    db.submissions.unshift(submission);
    db.auditLog.unshift({ id: id('log'), action: 'submission_created', actor: submission.submitterEmail, targetId: submission.id, createdAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 201, { ok: true, submissionId: submission.id, message: '已提交，正在等待管理员审核。' });
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
        needsInfo: submissions.filter((item) => item.status === 'needs_info').length,
        secondaryReview: submissions.filter((item) => item.status === 'secondary_review').length,
        merged: submissions.filter((item) => item.status === 'merged').length,
        places: db.places.filter((item) => !item.archived).length,
        contributors: db.contributors.filter((item) => item.active !== false).length
      },
      submissions: submissions.slice(0, 100),
      places: user.role === 'admin' ? db.places.filter((item) => !item.archived) : [],
      contributors: user.role === 'admin' ? db.contributors.map(({ passwordHash, passwordSalt, ...safe }) => safe) : []
    });
  }

  if (url.pathname === '/api/admin/candidate-seeds' && req.method === 'GET') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const db = readDb();
    const importedQueries = new Set(db.places.map((item) => item.sourceQuery).filter(Boolean));
    return json(res, 200, {
      total: candidatePlaceSearches.length,
      candidates: candidatePlaceSearches.map((item, index) => ({ ...item, index, imported: importedQueries.has(item.query) }))
    });
  }

  if (url.pathname === '/api/admin/candidate-import-status' && req.method === 'GET') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const db = readDb();
    return json(res, 200, {
      ...candidateImportStatus,
      seedVersion: Number(db.meta?.candidateSeedVersion || 0),
      lastImportedAt: db.meta?.candidateSeedAt || '',
      imported: Number(db.meta?.candidateSeedImported || 0)
    });
  }

  if (url.pathname === '/api/admin/places/import-candidates' && req.method === 'POST') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req, 200 * 1024).catch(() => ({}));
    try {
      const result = await importCandidatePlacesFromAmap({ actor: user.email, force: bool(body.force) });
      if (result.busy) return json(res, 202, { ok: true, busy: true, status: result.status });
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, error.statusCode || 500, { error: error.message, infocode: error.infocode || '' });
    }
  }

  const submissionMatch = /^\/api\/admin\/submissions\/([^/]+)$/.exec(url.pathname);
  if (submissionMatch && req.method === 'PATCH') {
    const user = requireRole(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const db = readDb();
    const submission = db.submissions.find((item) => item.id === submissionMatch[1]);
    if (!submission) return json(res, 404, { error: '未找到该提交。' });

    const correctedLng = numberInRange(body.lng, 118.3, 119.4, submission.lng);
    const correctedLat = numberInRange(body.lat, 31.5, 32.6, submission.lat);
    if (correctedLng !== null) submission.lng = correctedLng;
    if (correctedLat !== null) submission.lat = correctedLat;
    if ('address' in body && cleanString(body.address, 240)) submission.address = cleanString(body.address, 240);
    if ('district' in body) submission.district = cleanString(body.district, 60);
    if ('amapPoiId' in body) submission.amapPoiId = cleanString(body.amapPoiId, 80);

    const allowedStatuses = ['approved', 'rejected', 'pending', 'needs_info', 'secondary_review', 'merged'];
    const nextStatus = allowedStatuses.includes(body.status) ? body.status : submission.status;
    if (['approved', 'merged'].includes(nextStatus) && (submission.lng === null || submission.lat === null || !submission.address)) {
      return json(res, 400, { error: '通过或合并前，请先在地图中确认准确位置和地址。' });
    }

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
          workModes: body.workModes,
          description: body.description
        });
        db.places.unshift(place);
      } else {
        place.featured = bool(body.featured);
        place.verified = bool(body.verified);
        place.workModes = Array.isArray(body.workModes) ? body.workModes.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 8) : place.workModes;
        if (cleanString(body.description, 1600)) place.description = cleanString(body.description, 1600);
        place.updatedAt = new Date().toISOString();
      }
    }

    if (nextStatus === 'merged') {
      const mergePlaceId = cleanString(body.mergePlaceId, 100);
      place = db.places.find((item) => item.id === mergePlaceId && !item.archived);
      if (!place) return json(res, 400, { error: '请选择一个已有地点进行合并。' });
      place.communityReports = Array.isArray(place.communityReports) ? place.communityReports : [];
      if (!place.communityReports.some((report) => report.submissionId === submission.id)) {
        place.communityReports.unshift({
          submissionId: submission.id,
          submittedAt: submission.createdAt,
          submitterType: submission.submitterType,
          confidence: submission.confidence,
          choices: {
            overallSuitability: submission.overallSuitability,
            outletsChoice: submission.outletsChoice,
            wifiChoice: submission.wifiChoice,
            quietChoice: submission.quietChoice,
            callChoice: submission.callChoice,
            longStayChoice: submission.longStayChoice,
            priceChoice: submission.priceChoice,
            seatingChoice: submission.seatingChoice,
            crowdChoice: submission.crowdChoice
          },
          note: submission.experienceNote || ''
        });
      }
      if (Array.isArray(submission.images) && submission.images.length) {
        place.images = [...new Set([...(place.images || []), ...submission.images])].slice(0, 8);
      }
      place.lastCommunityReportAt = new Date().toISOString();
      place.updatedAt = new Date().toISOString();
      submission.mergedIntoPlaceId = place.id;
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
      amapPoiId: cleanString(body.amapPoiId, 80),
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
      return json(res, 400, { error: '请通过地图确认地点名称、地址和精确位置。' });
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
    const editable = ['name', 'address', 'district', 'metroStation', 'price', 'hours', 'wifi', 'outlets', 'description', 'lastVerified', 'amapPoiId'];
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
    const mediaMatch = /^\/media\/([A-Za-z0-9-]+)\.webp$/.exec(url.pathname);
    if (mediaMatch && req.method === 'GET') {
      serveMedia(res, mediaMatch[1]);
      return;
    }
    if (url.pathname.startsWith('/_AMapService/')) {
      await proxyAmapService(req, res, url);
      return;
    }
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
  console.log(`Nomad Nanjing running on http://0.0.0.0:${PORT}`);
  console.log(`SQLite database: ${SQLITE_PATH}`);
  console.log(`Persistent volume: ${RAILWAY_VOLUME_MOUNT_PATH || 'local development'}`);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    console.warn('WARNING: ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET are not fully configured. Set them before public launch.');
  }
  if (String(process.env.AUTO_IMPORT_CANDIDATES || 'true').toLowerCase() !== 'false') {
    setTimeout(() => {
      importCandidatePlacesFromAmap({ actor: 'system:auto-import', force: false })
        .then((result) => console.log('Candidate auto-import:', result))
        .catch((error) => console.error('Candidate auto-import failed:', error.message));
    }, 1500);
  }
});
