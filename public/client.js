(() => {
  const $ = (id) => document.getElementById(id);

  // ================= Отправляем подробности визита (для /activ) =================
  (function reportVisitDetail() {
    const m = document.cookie.match(/(?:^|; )vid=([^;]*)/);
    const vid = m ? decodeURIComponent(m[1]) : null;
    if (!vid) return;
    fetch('/api/visits/detail', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vid,
        referrer: document.referrer || null,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: `${screen.width}x${screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`
      })
    }).catch(() => {});
  })();

  // ================= Зимний фон: звёзды + снег на canvas =================
  const canvas = $('snow-canvas');
  const ctx = canvas.getContext('2d');
  let flakes = [];
  let stars = [];
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = document.querySelector('.hero').offsetHeight;
  }
  function initFlakes() {
    const count = Math.min(160, Math.round((canvas.width * canvas.height) / 9000));
    flakes = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2.6 + 0.6,
      speed: Math.random() * 0.6 + 0.25,
      drift: Math.random() * 0.6 - 0.3,
      wind: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.01,
      opacity: Math.random() * 0.6 + 0.35,
      detailed: i % 9 === 0 // ~11% снежинок рисуем как настоящие кристаллы
    }));
    const starCount = Math.round((canvas.width * canvas.height) / 6000);
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.65,
      r: Math.random() * 1.1 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.02 + 0.01
    }));
  }
  function drawCrystal(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(230,248,252,0.85)';
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 3) * i);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, r);
      ctx.moveTo(0, r * 0.5);
      ctx.lineTo(r * 0.25, r * 0.32);
      ctx.moveTo(0, r * 0.5);
      ctx.lineTo(-r * 0.25, r * 0.32);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  let t = 0;
  function tickSnow() {
    t += 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const s of stars) {
      const o = 0.35 + 0.5 * Math.abs(Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${o})`;
      ctx.fill();
    }

    for (const f of flakes) {
      f.wind += 0.01;
      f.y += f.speed;
      f.x += f.drift + Math.sin(f.wind) * 0.4;
      f.rot += f.rotSpeed;
      if (f.y > canvas.height + 8) { f.y = -8; f.x = Math.random() * canvas.width; }
      if (f.x > canvas.width + 5) f.x = -5;
      if (f.x < -5) f.x = canvas.width + 5;

      if (f.detailed) {
        drawCrystal(f.x, f.y, f.r * 3.2, f.rot);
      } else {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${f.opacity})`;
        ctx.shadowColor = 'rgba(191,232,242,0.8)';
        ctx.shadowBlur = f.r * 1.5;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    requestAnimationFrame(tickSnow);
  }
  resizeCanvas();
  initFlakes();
  tickSnow();
  window.addEventListener('resize', () => { resizeCanvas(); initFlakes(); });

  // ================= Гирлянда: лампочки + шары-игрушки + сосульки =================
  (function buildGarland() {
    const wire = $('garland-wire');
    const wrap = $('garland-bulbs');
    const lightColors = ['#e0546b', '#f2c869', '#7fd4e6', '#6fe0a0', '#c98fe0'];
    const ornamentColors = ['#e0546b', '#f2c869', '#7fd4e6'];
    const len = wire.getTotalLength();
    const slotCount = Math.round(window.innerWidth / 34);
    for (let i = 0; i < slotCount; i++) {
      const pt = wire.getPointAtLength((i / slotCount) * len);
      const pctX = (pt.x / 1200) * 100;
      const isOrnament = i % 4 === 3;
      const el = document.createElement('div');
      el.className = isOrnament ? 'ornament' : 'bulb';
      el.style.left = pctX + '%';
      el.style.top = pt.y + 'px';
      el.style.background = isOrnament ? ornamentColors[i % ornamentColors.length] : lightColors[i % lightColors.length];
      el.style.animationDelay = (Math.random() * 2.6).toFixed(2) + 's';
      wrap.appendChild(el);

      if (!isOrnament && Math.random() < 0.4) {
        const icicle = document.createElement('div');
        icicle.className = 'icicle';
        icicle.style.left = pctX + '%';
        icicle.style.top = (pt.y + 6) + 'px';
        icicle.style.height = (10 + Math.random() * 16) + 'px';
        icicle.style.animationDelay = (Math.random() * 3.4).toFixed(2) + 's';
        wrap.appendChild(icicle);
      }
    }
  })();

  $('scroll-cue').addEventListener('click', () => {
    document.querySelector('.wall').scrollIntoView({ behavior: 'smooth' });
  });

  // ================= Имя владельца =================
  fetch('/api/config').then(r => r.json()).then(cfg => {
    $('owner-name').textContent = cfg.ownerName;
    document.title = cfg.ownerName + ' — стена';
  }).catch(() => { $('owner-name').textContent = 'Стена'; });

  // ================= Комментарии =================
  const commentsList = $('comments-list');
  const commentsEmpty = $('comments-empty');
  const form = $('comment-form');
  const nameInput = $('name-input');
  const textInput = $('text-input');
  const submitBtn = $('submit-btn');
  const formError = $('form-error');
  const cooldownNote = $('cooldown-note');

  let cooldownInterval = null;
  const savedName = localStorage.getItem('wall-name');
  if (savedName) nameInput.value = savedName;

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function initials(name) {
    return (name.trim()[0] || '?').toUpperCase();
  }

  function renderComments(list) {
    commentsList.innerHTML = '';
    commentsEmpty.classList.toggle('hidden', list.length > 0);
    list.slice().reverse().forEach(c => commentsList.appendChild(buildCommentNode(c)));
  }

  function buildCommentNode(c) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    card.dataset.id = c.id;

    const head = document.createElement('div');
    head.className = 'comment-head';
    const av = document.createElement('div');
    av.className = 'comment-avatar';
    av.textContent = initials(c.name);
    const meta = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'comment-name';
    name.textContent = c.name;
    const date = document.createElement('div');
    date.className = 'comment-date';
    date.textContent = fmtDate(c.ts);
    meta.appendChild(name); meta.appendChild(date);
    head.appendChild(av); head.appendChild(meta);

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.innerHTML = c.text; // экранировано на сервере

    const votes = document.createElement('div');
    votes.className = 'vote-row';
    const upBtn = document.createElement('button');
    upBtn.className = 'vote-btn up' + (c.myVote === 'up' ? ' active' : '');
    upBtn.innerHTML = `👍 <span>${c.up}</span>`;
    const downBtn = document.createElement('button');
    downBtn.className = 'vote-btn down' + (c.myVote === 'down' ? ' active' : '');
    downBtn.innerHTML = `👎 <span>${c.down}</span>`;

    upBtn.addEventListener('click', () => vote(c.id, 'up', upBtn, downBtn));
    downBtn.addEventListener('click', () => vote(c.id, 'down', upBtn, downBtn));
    votes.appendChild(upBtn); votes.appendChild(downBtn);

    card.appendChild(head); card.appendChild(text); card.appendChild(votes);
    return card;
  }

  function vote(id, type, upBtn, downBtn) {
    fetch(`/api/comments/${id}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type })
    }).then(r => r.json()).then(res => {
      if (!res.ok) return;
      upBtn.querySelector('span').textContent = res.up;
      downBtn.querySelector('span').textContent = res.down;
      upBtn.classList.toggle('active', res.myVote === 'up');
      downBtn.classList.toggle('active', res.myVote === 'down');
    });
  }

  function loadComments() {
    fetch('/api/comments').then(r => r.json()).then(res => {
      renderComments(res.comments);
      startCooldown(res.cooldownRemainingMs);
    });
  }

  function startCooldown(ms) {
    clearInterval(cooldownInterval);
    if (!ms || ms <= 0) {
      submitBtn.disabled = false;
      cooldownNote.classList.add('hidden');
      return;
    }
    submitBtn.disabled = true;
    let remaining = Math.ceil(ms / 1000);
    const update = () => {
      cooldownNote.textContent = `Можно будет написать ещё раз через ${remaining} сек.`;
      cooldownNote.classList.remove('hidden');
    };
    update();
    cooldownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownInterval);
        submitBtn.disabled = false;
        cooldownNote.classList.add('hidden');
        return;
      }
      update();
    }, 1000);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError.textContent = '';
    const name = nameInput.value.trim();
    const text = textInput.value.trim();
    if (!name || !text) { formError.textContent = 'Заполните оба поля'; return; }
    submitBtn.disabled = true;
    localStorage.setItem('wall-name', name);
    fetch('/api/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text })
    }).then(r => r.json()).then(res => {
      if (!res.ok) {
        formError.textContent = res.error === 'Слишком часто' ? 'Подождите немного перед следующим комментарием' : res.error;
        if (res.retryAfterMs) startCooldown(res.retryAfterMs);
        else submitBtn.disabled = false;
        return;
      }
      textInput.value = '';
      loadComments();
      startCooldown(res.cooldownRemainingMs);
    }).catch(() => { formError.textContent = 'Ошибка сети, попробуйте ещё раз'; submitBtn.disabled = false; });
  });

  loadComments();
})();
