// server.js — «Стена» (гостевая книга): комментарии + лайки/дизлайки + лог посещений (/activ)
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const AVATAR_DIR = path.join(__dirname, 'avatar-source');
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
  visits.push({
    ip: clientIp(req),
    ua,
    os, browser, device,
    ts: Date.now(),
    path: req.path
  });
  if (visits.length > MAX_VISITS_STORED) visits = visits.slice(-MAX_VISITS_STORED);
  writeJSON(VISITS_FILE, visits);
}

// ---------- Страницы (с логированием посещений) ----------
app.get(['/', '/activ'], (req, res, next) => {
  logVisit(req);
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
      id: c.id, name: c.name, text: c.text, ts: c.ts,
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
  let { name, text } = req.body || {};
  name = (name || '').toString().trim().slice(0, MAX_NAME_LEN);
  text = (text || '').toString().trim().slice(0, MAX_TEXT_LEN);
  if (!name || !text) return res.status(400).json({ ok: false, error: 'Заполните имя и комментарий' });

  const comment = {
    id: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
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
app.get('/api/visits', (req, res) => {
  res.json({
    visits: visits.slice().reverse().map(v => ({
      ip: v.ip, os: v.os, browser: v.browser, device: v.device, ts: v.ts, path: v.path
    }))
  });
});

app.listen(PORT, () => {
  console.log(`Wall running on port ${PORT}`);
});
