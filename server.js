// server.js — «Стена» (гостевая книга): комментарии + лайки/дизлайки + лог посещений (/activ)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const AVATAR_DIR = path.join(__dirname, 'avatar-source');
const SOUND_DIR = path.join(__dirname, 'sound-source');
const SOCIAL_ICONS_DIR = path.join(__dirname, 'social-icons');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const VISITS_FILE = path.join(DATA_DIR, 'visits.json');

const COOLDOWN_MS = 60 * 1000; // 1 комментарий в минуту
const MAX_NAME_LEN = 40;
const MAX_TEXT_LEN = 800;
const MAX_VISITS_STORED = 5000; // не даём логу расти бесконечно

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Простое персистентное хранилище на JSON-файлах ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.error('Ошибка записи', file, e.message); }
}

let comments = readJSON(COMMENTS_FILE, []); // {id, name, text, ts, up, down, votes:{ip:'up'|'down'}}
let visits = readJSON(VISITS_FILE, []);     // {ip, ua, os, browser, device, ts, path}
const lastCommentByIp = new Map(); // ip -> timestamp последнего комментария (сбрасывается при рестарте — ок)

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clientIp(req) {
  // За прокси Render отдаёт реальный IP через X-Forwarded-For
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

// ---------- Очень простой разбор User-Agent (без внешних зависимостей) ----------
function parseUA(ua) {
  ua = ua || '';
  let os = 'Неизвестно';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Неизвестно';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

  const device = /mobile/i.test(ua) ? 'Телефон' : (/ipad|tablet/i.test(ua) ? 'Планшет' : 'Компьютер');
  return { os, browser, device };
}

function logVisit(req) {
  const ua = req.headers['user-agent'] || '';
  const { os, browser, device } = parseUA(ua);
  const id = crypto.randomUUID();
  visits.push({
    id,
    ip: clientIp(req),
    ua,
    os, browser, device,
    ts: Date.now(),
    path: req.path,
    referrer: req.headers['referer'] || req.headers['referrer'] || null,
    language: null, timezone: null, screen: null, viewport: null
  });
  if (visits.length > MAX_VISITS_STORED) visits = visits.slice(-MAX_VISITS_STORED);
  writeJSON(VISITS_FILE, visits);
  return id;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

// ---------- Страницы (с логированием посещений) ----------
app.get(['/', '/activ'], (req, res, next) => {
  const vid = logVisit(req);
  res.setHeader('Set-Cookie', `vid=${vid}; Path=/; Max-Age=60; SameSite=Lax`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/activ', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'activ.html'));
});

// ---------- Аватар: берём любой png/jpg из avatar-source/ ----------
app.get('/avatar.png', (req, res) => {
  try {
    const files = fs.readdirSync(AVATAR_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    if (files.length === 0) return res.redirect('/default-avatar.svg');
    const filePath = path.join(AVATAR_DIR, files[0]);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.redirect('/default-avatar.svg');
  }
});

// ---------- Звук уведомлений: берём любой файл из sound-source/ ----------
app.get('/notify-sound', (req, res) => {
  try {
    const files = fs.readdirSync(SOUND_DIR).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
    if (files.length === 0) return res.status(404).end();
    const filePath = path.join(SOUND_DIR, files[0]);
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' }[ext];
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.status(404).end();
  }
});

// ---------- Соцсети: ссылки из socials.json + иконки из social-icons/ ----------
// file — какое имя файла (без расширения) искать в social-icons/; badge — подпись-заглушка,
// если файла нет (например social-icons/t.png для телеграма).
const SOCIAL_DEFS = {
  telegram: { label: 'Telegram', file: 't', badge: 'TG' },
  telegram_channel: { label: 'Telegram-канал', file: 'tc', badge: 'TG' },
  spotify: { label: 'Spotify', file: 's', badge: 'SP' },
  x: { label: 'X (Twitter)', file: 'x', badge: 'X' },
  pinterest: { label: 'Pinterest', file: 'p', badge: 'P' },
  brawlstars: { label: 'Brawl Stars', file: 'b', badge: 'BS' },
  discord: { label: 'Discord', file: 'd', badge: 'DC' },
  tiktok: { label: 'TikTok', file: 'tk', badge: 'TT' }
};

function findIconFile(fileCode) {
  try {
    const match = fs.readdirSync(SOCIAL_ICONS_DIR)
      .find(f => new RegExp(`^${fileCode}\\.(png|jpe?g|webp|svg)$`, 'i').test(f));
    return match ? path.join(SOCIAL_ICONS_DIR, match) : null;
  } catch (e) {
    return null;
  }
}

app.get('/api/socials', (req, res) => {
  const links = readJSON(path.join(__dirname, 'socials.json'), {});
  const list = Object.keys(SOCIAL_DEFS)
    .map(key => {
      const url = (links[key] || '').toString().trim();
      if (!url) return null;
      const def = SOCIAL_DEFS[key];
      return { key, label: def.label, badge: def.badge, url, hasIcon: !!findIconFile(def.file) };
    })
    .filter(Boolean);
  res.json({ socials: list });
});

app.get('/social-icon/:key', (req, res) => {
  const def = SOCIAL_DEFS[req.params.key];
  if (!def) return res.status(404).end();
  const filePath = findIconFile(def.file);
  if (!filePath) return res.status(404).end();
  const ext = path.extname(filePath).toLowerCase();
  const mime = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] || 'image/jpeg';
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

// ---------- Конфиг (имя владельца) ----------
app.get('/api/config', (req, res) => {
  const cfg = readJSON(path.join(__dirname, 'config.json'), { ownerName: 'Владелец страницы' });
  res.json({ ownerName: cfg.ownerName || 'Владелец страницы' });
});

// ---------- Комментарии ----------
app.get('/api/comments', (req, res) => {
  const ip = clientIp(req);
  res.json({
    comments: comments.map(c => ({
      id: c.id, parentId: c.parentId || null, name: c.name, text: c.text, ts: c.ts,
      up: c.up, down: c.down, myVote: c.votes[ip] || null
    })),
    cooldownRemainingMs: cooldownRemaining(ip)
  });
});

function cooldownRemaining(ip) {
  const last = lastCommentByIp.get(ip);
  if (!last) return 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

app.post('/api/comments', (req, res) => {
  const ip = clientIp(req);
  const remaining = cooldownRemaining(ip);
  if (remaining > 0) {
    return res.status(429).json({ ok: false, error: 'Слишком часто', retryAfterMs: remaining });
  }
  let { name, text, parentId } = req.body || {};
  name = (name || '').toString().trim().slice(0, MAX_NAME_LEN);
  text = (text || '').toString().trim().slice(0, MAX_TEXT_LEN);
  if (!name || !text) return res.status(400).json({ ok: false, error: 'Заполните имя и комментарий' });

  parentId = (typeof parentId === 'string' && comments.some(c => c.id === parentId)) ? parentId : null;

  const comment = {
    id: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    parentId,
    name: escapeHtml(name),
    text: escapeHtml(text),
    ts: Date.now(),
    up: 0, down: 0,
    votes: {}
  };
  comments.push(comment);
  writeJSON(COMMENTS_FILE, comments);
  lastCommentByIp.set(ip, Date.now());

  res.json({ ok: true, comment: { ...comment, votes: undefined, myVote: null }, cooldownRemainingMs: COOLDOWN_MS });
});

app.post('/api/comments/:id/vote', (req, res) => {
  const ip = clientIp(req);
  const type = req.body && req.body.type;
  if (type !== 'up' && type !== 'down') return res.status(400).json({ ok: false, error: 'Некорректный тип голоса' });

  const comment = comments.find(c => c.id === req.params.id);
  if (!comment) return res.status(404).json({ ok: false, error: 'Комментарий не найден' });

  const current = comment.votes[ip] || null;
  if (current === type) {
    // повторный клик по тому же — снимаем голос
    comment[type]--;
    delete comment.votes[ip];
  } else {
    if (current) comment[current]--; // снимаем предыдущий голос, если был
    comment[type]++;
    comment.votes[ip] = type;
  }
  writeJSON(COMMENTS_FILE, comments);
  res.json({ ok: true, up: comment.up, down: comment.down, myVote: comment.votes[ip] || null });
});

// ---------- Лог посещений (/activ) ----------
app.post('/api/visits/detail', (req, res) => {
  const cookies = parseCookies(req);
  const vid = cookies.vid || (req.body && req.body.vid);
  if (!vid) return res.json({ ok: false });
  // ищем среди последних записей — обычно это самая свежая запись для этого браузера
  for (let i = visits.length - 1; i >= Math.max(0, visits.length - 50); i--) {
    if (visits[i].id === vid) {
      const { referrer, language, timezone, screen, viewport } = req.body || {};
      if (referrer && !visits[i].referrer) visits[i].referrer = referrer;
      visits[i].language = language || null;
      visits[i].timezone = timezone || null;
      visits[i].screen = screen || null;
      visits[i].viewport = viewport || null;
      writeJSON(VISITS_FILE, visits);
      break;
    }
  }
  res.json({ ok: true });
});

app.get('/api/visits', (req, res) => {
  res.json({
    visits: visits.slice().reverse().map(v => ({
      ip: v.ip, os: v.os, browser: v.browser, device: v.device, ts: v.ts, path: v.path,
      referrer: v.referrer || null, language: v.language || null,
      timezone: v.timezone || null, screen: v.screen || null, viewport: v.viewport || null
    }))
  });
});

app.listen(PORT, () => {
  console.log(`Wall running on port ${PORT}`);
});
