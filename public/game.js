'use strict';

/* ---------------------------------------------------------------
 * Me cung Hasaki - client
 * - Canvas 2D, goc nhin tren xuong, zoom gan nhan vat
 * - Di chuyen tu do (khong theo block), joystick + ban phim
 * - 10 kho bau / 10 cau hoi, multiplayer realtime
 * --------------------------------------------------------------- */

(function () {
  const $ = (id) => document.getElementById(id);

  const SPEED = 4.3; // tiles / second
  const PLAYER_R = 0.3;
  const TREASURE_OPEN_R = 0.95;
  const STATE_INTERVAL = 66; // ms between position updates
  const STORAGE_PREFIX = 'hasaki_';

  /* ------------------------------ DOM ------------------------------ */

  const startScreen = $('startScreen');
  const startForm = $('startForm');
  const startBtn = $('startBtn');
  const nameInput = $('nameInput');
  const startError = $('startError');
  const gameEl = $('game');
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const touchLayer = $('touchLayer');
  const pipsEl = $('pips');
  const progressText = $('progressText');
  const onlineChip = $('onlineChip');
  const leaderboardEl = $('leaderboard');
  const restartBtn = $('restartBtn');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');
  const joyBase = $('joyBase');
  const joyKnob = $('joyKnob');
  const toastEl = $('toast');
  const netBanner = $('netBanner');
  const questionOverlay = $('questionOverlay');
  const questionTag = $('questionTag');
  const questionText = $('questionText');
  const questionOptions = $('questionOptions');
  const questionFeedback = $('questionFeedback');
  const questionLater = $('questionLater');
  const winOverlay = $('winOverlay');
  const winKicker = $('winKicker');
  const winTitle = $('winTitle');
  const winSub = $('winSub');
  const btnContinue = $('btnContinue');
  const btnPlayAgain = $('btnPlayAgain');

  /* ----------------------------- state ----------------------------- */

  const S = {
    ws: null,
    myId: null,
    name: '',
    gameId: null,
    started: false,
    grid: null,
    W: 0,
    H: 0,
    treasures: [],
    collected: new Set(),
    players: new Map(), // remote id -> {name,x,y,tx,ty,fx,fy,progress}
    winner: null,
    me: { x: 1.5, y: 1.5, fx: 1, fy: 0 },
    cam: { x: 1.5, y: 1.5 },
    explored: null,
    dpr: 1,
    viewW: 0,
    viewH: 0,
    tilePx: 40,
    modalOpen: false,
    activeTreasure: null,
    reconnectTimer: null,
  };

  const keys = new Set();
  const joy = { active: false, pointerId: null, ox: 0, oy: 0, vx: 0, vy: 0 };
  const dismissed = new Set(); // treasures the player postponed this visit
  let labelFont = '600 11px sans-serif';

  /* ---------------------------- helpers ---------------------------- */

  function storageKey() {
    return STORAGE_PREFIX + S.gameId;
  }

  function saveCollected() {
    if (!S.gameId) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(Array.from(S.collected)));
    } catch (e) {}
  }

  function loadCollected() {
    if (!S.gameId) return;
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return;
      const ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        if (Number.isInteger(id) && id >= 0 && id < S.treasures.length) S.collected.add(id);
      }
    } catch (e) {}
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    // force reflow so the transition plays
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => {
        toastEl.hidden = true;
      }, 240);
    }, 1900);
  }

  /* ----------------------------- websocket -------------------------- */

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return proto + '://' + location.host;
  }

  function send(obj) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
  }

  function sendState() {
    send({ type: 'state', x: S.me.x, y: S.me.y, fx: S.me.fx, fy: S.me.fy });
  }

  function sendProgress() {
    send({ type: 'progress', collected: Array.from(S.collected) });
  }

  function openWS() {
    if (S.ws) {
      // detach handlers first so the old socket cannot trigger another reconnect
      S.ws.onclose = null;
      S.ws.onerror = null;
      S.ws.onmessage = null;
      S.ws.onopen = null;
      try {
        S.ws.close();
      } catch (e) {}
      S.ws = null;
    }
    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      onSocketDown();
      return;
    }
    S.ws = ws;

    ws.onopen = () => {
      send({ type: 'join', name: S.name });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = () => {
      if (S.ws !== ws) return;
      onSocketDown();
    };
    ws.onerror = () => {};
  }

  function onSocketDown() {
    if (!S.started) {
      startError.hidden = false;
      startError.textContent = 'Không thể kết nối máy chủ. Thử lại sau.';
      startBtn.disabled = false;
      startBtn.textContent = 'VÀO GAME';
      return;
    }
    netBanner.hidden = false;
    clearTimeout(S.reconnectTimer);
    S.reconnectTimer = setTimeout(openWS, 2000);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        handleInit(msg);
        break;
      case 'joined': {
        const p = msg.player;
        if (p && p.id !== S.myId) {
          S.players.set(p.id, {
            name: p.name,
            x: p.x,
            y: p.y,
            tx: p.x,
            ty: p.y,
            fx: p.fx,
            fy: p.fy,
            progress: p.progress || 0,
          });
          updateHUD();
        }
        break;
      }
      case 'left': {
        S.players.delete(msg.id);
        updateHUD();
        break;
      }
      case 'state': {
        const p = S.players.get(msg.id);
        if (p) {
          p.tx = msg.x;
          p.ty = msg.y;
          p.fx = msg.fx;
          p.fy = msg.fy;
        }
        break;
      }
      case 'progress': {
        if (msg.id === S.myId) break;
        const p = S.players.get(msg.id);
        if (p) {
          p.progress = msg.count;
          updateLeaderboard();
        }
        break;
      }
      case 'won': {
        S.winner = { id: msg.id, name: msg.name };
        if (msg.id === S.myId) showWin('self');
        else showWin('announce', msg.name);
        break;
      }
      case 'restart':
        handleRestart(msg);
        break;
      default:
        break;
    }
  }

  function handleInit(msg) {
    const sameGame = S.gameId === msg.gameId;
    const oldKey = S.gameId ? storageKey() : null;

    S.myId = msg.id;
    S.grid = msg.grid;
    S.W = msg.w;
    S.H = msg.h;
    S.treasures = msg.treasures;
    S.explored = new Uint8Array(msg.w * msg.h);

    const firstBoot = !S.started;
    if (!sameGame) {
      S.gameId = msg.gameId;
      if (oldKey && oldKey !== storageKey()) {
        try {
          localStorage.removeItem(oldKey);
        } catch (e) {}
      }
      if (firstBoot) {
        S.collected.clear();
        loadCollected();
      } else {
        S.collected.clear();
      }
    }

    if (firstBoot || !sameGame) {
      S.me.x = msg.start.x;
      S.me.y = msg.start.y;
      S.cam.x = S.me.x;
      S.cam.y = S.me.y;
    }

    // rebuild remotes
    S.players.clear();
    for (const p of msg.players) {
      if (p.id === S.myId) continue;
      S.players.set(p.id, {
        name: p.name,
        x: p.x,
        y: p.y,
        tx: p.x,
        ty: p.y,
        fx: p.fx,
        fy: p.fy,
        progress: p.progress || 0,
      });
    }

    S.winner = msg.winner || null;

    if (firstBoot) {
      startScreen.hidden = true;
      gameEl.hidden = false;
      S.started = true;
      startBtn.disabled = false;
      startBtn.textContent = 'VÀO GAME';
      resize();
      buildPips();
    }

    netBanner.hidden = true;
    buildPips();
    updateHUD();

    // restore progress after reconnect / reload
    if (S.collected.size > 0) sendProgress();
    sendState();

    if (S.winner) {
      if (S.winner.id === S.myId) showWin('self');
      else showWin('announce', S.winner.name);
    } else {
      winOverlay.hidden = true;
    }
  }

  function handleRestart(msg) {
    const oldKey = S.gameId ? storageKey() : null;
    if (oldKey) {
      try {
        localStorage.removeItem(oldKey);
      } catch (e) {}
    }
    S.gameId = msg.gameId;
    S.collected.clear();
    dismissed.clear();
    S.winner = null;
    if (msg.players) {
      for (const p of msg.players) {
        if (p.id === S.myId) continue;
        const rp = S.players.get(p.id);
        if (rp) rp.progress = p.progress || 0;
      }
    }
    winOverlay.hidden = true;
    questionOverlay.hidden = true;
    S.modalOpen = false;
    S.activeTreasure = null;
    buildPips();
    updateHUD();
    toast('Ván mới đã bắt đầu');
  }

  /* ------------------------------ HUD ------------------------------- */

  function buildPips() {
    pipsEl.innerHTML = '';
    const n = Math.max(10, S.treasures.length || 10);
    for (let i = 0; i < n; i++) {
      const span = document.createElement('span');
      span.className = 'pip' + (i < S.collected.size ? ' on' : '');
      pipsEl.appendChild(span);
    }
    progressText.textContent = S.collected.size + '/10';
  }

  function updateHUD() {
    const pips = pipsEl.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('on', i < S.collected.size);
    }
    progressText.textContent = S.collected.size + '/10';
    onlineChip.textContent = S.players.size + 1 + ' NGƯỜI CHƠI';
    updateLeaderboard();
  }

  function updateLeaderboard() {
    const list = [{ id: S.myId, name: S.name || 'Bạn', progress: S.collected.size, me: true }];
    for (const [id, p] of S.players) {
      list.push({ id, name: p.name, progress: p.progress, me: false });
    }
    list.sort((a, b) => b.progress - a.progress || a.name.localeCompare(b.name));
    leaderboardEl.innerHTML = '';
    list.slice(0, 8).forEach((entry, i) => {
      const li = document.createElement('li');
      if (entry.me) li.className = 'me';
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entry.name;
      const count = document.createElement('span');
      count.className = 'lb-count';
      count.textContent = entry.progress + '/10';
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(count);
      leaderboardEl.appendChild(li);
    });
  }

  /* ---------------------------- win overlay ------------------------- */

  function showWin(kind, otherName) {
    if (kind === 'self') {
      winKicker.textContent = 'BẠN ĐÃ HOÀN THÀNH';
      winTitle.textContent = 'CHIẾN THẮNG';
      winSub.textContent = 'Bạn đã tìm đủ 10 kho báu và trả lời đúng 10 câu hỏi.';
      btnContinue.hidden = true;
    } else {
      winKicker.textContent = 'CÓ NGƯỜI THẮNG RỒI';
      winTitle.textContent = otherName ? otherName.toUpperCase() + ' THẮNG' : 'HẾT VÁN';
      winSub.textContent =
        (otherName || 'Người chơi') + ' đã tìm đủ 10 kho báu trước. Bạn vẫn có thể tiếp tục khám phá mê cung.';
      btnContinue.hidden = false;
    }
    winOverlay.hidden = false;
  }

  btnContinue.addEventListener('click', () => {
    winOverlay.hidden = true;
  });
  btnPlayAgain.addEventListener('click', () => {
    send({ type: 'restart' });
    winOverlay.hidden = true;
  });

  /* --------------------------- restart button ----------------------- */

  let restartArmed = false;
  let restartArmTimer = null;
  restartBtn.addEventListener('click', () => {
    if (!restartArmed) {
      restartArmed = true;
      restartBtn.classList.add('armed');
      restartBtn.textContent = 'XÁC NHẬN?';
      clearTimeout(restartArmTimer);
      restartArmTimer = setTimeout(disarmRestart, 3000);
      return;
    }
    disarmRestart();
    send({ type: 'restart' });
  });
  function disarmRestart() {
    restartArmed = false;
    restartBtn.classList.remove('armed');
    restartBtn.textContent = 'VÁN MỚI';
    clearTimeout(restartArmTimer);
  }

  /* --------------------------- question modal ----------------------- */

  function openQuestion(t) {
    if (S.modalOpen || S.collected.size >= 10 || dismissed.has(t.id)) return;
    const q = QUESTIONS[t.q];
    if (!q) return;
    S.modalOpen = true;
    S.activeTreasure = t;
    questionTag.textContent = 'CÂU ' + (t.q + 1) + ' / 10';
    questionText.textContent = q.text;
    questionFeedback.hidden = true;
    questionFeedback.innerHTML = '';
    questionOptions.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-opt';
      const badge = document.createElement('span');
      badge.className = 'q-letter';
      badge.textContent = letters[idx];
      const text = document.createElement('span');
      text.textContent = opt;
      btn.appendChild(badge);
      btn.appendChild(text);
      btn.addEventListener('click', () => answerOption(t, q, idx, btn));
      questionOptions.appendChild(btn);
    });
    questionOverlay.hidden = false;
  }

  function answerOption(t, q, idx, btn) {
    if (btn.disabled) return;
    if (idx === q.answer) {
      // correct
      Array.from(questionOptions.children).forEach((el) => {
        el.disabled = true;
      });
      btn.classList.add('correct');
      const letter = ['A', 'B', 'C', 'D'][idx];
      questionFeedback.hidden = false;
      questionFeedback.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'CHÍNH XÁC';
      const body = document.createElement('span');
      body.textContent = 'Đáp án: ' + letter + '. ' + q.options[idx] + (q.note ? ' — ' + q.note : '');
      questionFeedback.appendChild(strong);
      questionFeedback.appendChild(body);
      setTimeout(() => {
        collectTreasure(t);
        closeQuestion();
      }, 950);
    } else {
      btn.disabled = true;
      btn.classList.add('wrong');
      questionFeedback.hidden = false;
      questionFeedback.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'SAI — CHỌN LẠI';
      questionFeedback.appendChild(strong);
      const body = document.createElement('span');
      body.textContent = 'Đáp án này chưa đúng. Hãy thử đáp án khác.';
      questionFeedback.appendChild(body);
    }
  }

  function closeQuestion() {
    questionOverlay.hidden = true;
    S.modalOpen = false;
    S.activeTreasure = null;
  }

  questionLater.addEventListener('click', () => {
    if (S.activeTreasure) dismissed.add(S.activeTreasure.id);
    closeQuestion();
  });

  function collectTreasure(t) {
    if (S.collected.has(t.id)) return;
    S.collected.add(t.id);
    saveCollected();
    sendProgress();
    updateHUD();
    toast('Đã thu thập ' + S.collected.size + '/10 kho báu');
    if (S.collected.size >= 10) {
      S.winner = { id: S.myId, name: S.name };
      showWin('self');
    }
  }

  /* ------------------------------ input ----------------------------- */

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (
      ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k) &&
      S.started &&
      !S.modalOpen
    ) {
      e.preventDefault();
    }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  touchLayer.addEventListener('pointerdown', (e) => {
    if (joy.active) return;
    joy.active = true;
    joy.pointerId = e.pointerId;
    joy.ox = e.clientX;
    joy.oy = e.clientY;
    joy.vx = 0;
    joy.vy = 0;
    joyBase.hidden = false;
    joyBase.style.left = joy.ox + 'px';
    joyBase.style.top = joy.oy + 'px';
    joyKnob.style.transform = 'translate(0px, 0px)';
    try {
      touchLayer.setPointerCapture(e.pointerId);
    } catch (err) {}
  });

  touchLayer.addEventListener('pointermove', (e) => {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    const max = 52;
    let dx = e.clientX - joy.ox;
    let dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    joyKnob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    const dead = 8;
    if (len < dead) {
      joy.vx = 0;
      joy.vy = 0;
    } else {
      joy.vx = dx / max;
      joy.vy = dy / max;
    }
  });

  function endJoy(e) {
    if (!joy.active || (e && e.pointerId !== joy.pointerId)) return;
    joy.active = false;
    joy.pointerId = null;
    joy.vx = 0;
    joy.vy = 0;
    joyBase.hidden = true;
  }
  touchLayer.addEventListener('pointerup', endJoy);
  touchLayer.addEventListener('pointercancel', endJoy);

  function readMoveInput() {
    let vx = joy.vx;
    let vy = joy.vy;
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vy += 1;
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    return { vx, vy };
  }

  /* ---------------------------- collision --------------------------- */

  function tileAt(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= S.W || gy >= S.H) return '#';
    return S.grid[gy][gx];
  }

  function blocked(x, y) {
    const minX = Math.floor(x - PLAYER_R);
    const maxX = Math.floor(x + PLAYER_R);
    const minY = Math.floor(y - PLAYER_R);
    const maxY = Math.floor(y + PLAYER_R);
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (tileAt(gx, gy) !== '#') continue;
        const cx = Math.max(gx, Math.min(x, gx + 1));
        const cy = Math.max(gy, Math.min(y, gy + 1));
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < PLAYER_R * PLAYER_R) return true;
      }
    }
    return false;
  }

  /* ------------------------------ update ---------------------------- */

  let lastStateSent = 0;

  function update(dt, now) {
    if (!S.grid) return;

    if (!S.modalOpen) {
      const { vx, vy } = readMoveInput();
      const moving = Math.hypot(vx, vy) > 0.05;
      if (moving) {
        S.me.fx = vx;
        S.me.fy = vy;
        const nx = S.me.x + vx * SPEED * dt;
        if (!blocked(nx, S.me.y)) S.me.x = nx;
        const ny = S.me.y + vy * SPEED * dt;
        if (!blocked(S.me.x, ny)) S.me.y = ny;
      }
    }

    // camera with slight look-ahead
    const targetX = S.me.x + S.me.fx * 1.1;
    const targetY = S.me.y + S.me.fy * 1.1;
    const lerp = 1 - Math.exp(-dt * 7);
    S.cam.x += (targetX - S.cam.x) * lerp;
    S.cam.y += (targetY - S.cam.y) * lerp;

    // smooth remote interpolation
    for (const p of S.players.values()) {
      const k = 1 - Math.exp(-dt * 11);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }

    // explored tiles around player
    const px = Math.floor(S.me.x);
    const py = Math.floor(S.me.y);
    const rad = 8;
    for (let gy = py - rad; gy <= py + rad; gy++) {
      for (let gx = px - rad; gx <= px + rad; gx++) {
        if (gx < 0 || gy < 0 || gx >= S.W || gy >= S.H) continue;
        const ddx = gx + 0.5 - S.me.x;
        const ddy = gy + 0.5 - S.me.y;
        if (ddx * ddx + ddy * ddy <= rad * rad) S.explored[gy * S.W + gx] = 1;
      }
    }

    // dismissed treasures re-open only after walking away again
    for (const id of Array.from(dismissed)) {
      const t = S.treasures[id];
      if (!t) {
        dismissed.delete(id);
        continue;
      }
      if (Math.hypot(t.x - S.me.x, t.y - S.me.y) > 1.5) dismissed.delete(id);
    }

    // treasure proximity -> open question
    if (!S.modalOpen && S.collected.size < 10) {
      for (const t of S.treasures) {
        if (S.collected.has(t.id) || dismissed.has(t.id)) continue;
        const d = Math.hypot(t.x - S.me.x, t.y - S.me.y);
        if (d < TREASURE_OPEN_R) {
          openQuestion(t);
          break;
        }
      }
    }

    // network state
    if (now - lastStateSent > STATE_INTERVAL) {
      lastStateSent = now;
      sendState();
    }
  }

  /* ------------------------------ render ---------------------------- */

  function resize() {
    S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.viewW = window.innerWidth;
    S.viewH = window.innerHeight;
    canvas.width = Math.round(S.viewW * S.dpr);
    canvas.height = Math.round(S.viewH * S.dpr);
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);

    const shortSide = Math.min(S.viewW, S.viewH);
    S.tilePx = Math.max(34, Math.min(56, shortSide / 10));

    labelFont = '600 11px ' + getComputedStyle(document.body).fontFamily;

    // minimap
    const mr = minimap.getBoundingClientRect();
    minimap.width = Math.round(mr.width * S.dpr);
    minimap.height = Math.round(mr.height * S.dpr);
    mctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawGem(sx, sy, size, pulse) {
    ctx.save();
    ctx.translate(sx, sy);

    // ground shadow
    ctx.beginPath();
    ctx.ellipse(0, size * 0.5, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fill();

    if (pulse > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.62 + pulse * 0.14), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 - pulse * 0.2).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const r = size * 0.42;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.92, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.92, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.strokeStyle = '#0a0a0a';
    ctx.stroke();

    // facets
    ctx.beginPath();
    ctx.moveTo(-r * 0.92, 0);
    ctx.lineTo(r * 0.92, 0);
    ctx.moveTo(-r * 0.4, -r * 0.56);
    ctx.lineTo(0, -r);
    ctx.lineTo(r * 0.4, -r * 0.56);
    ctx.lineWidth = Math.max(1.2, size * 0.045);
    ctx.stroke();

    ctx.restore();
  }

  function drawPlayer(px, py, fx, fy, name, isMe, scale) {
    const r = 0.34 * scale;
    ctx.save();
    ctx.translate(px, py);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    if (isMe) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0a0a0a';
      ctx.stroke();
    }

    // facing marker
    const flen = Math.hypot(fx, fy) || 1;
    const dx = (fx / flen) * r * 0.55;
    const dy = (fy / flen) * r * 0.55;
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? '#ffffff' : '#0a0a0a';
    ctx.fill();

    // name label
    if (name) {
      ctx.font = labelFont;
      const tw = ctx.measureText(name).width;
      const lw = tw + 14;
      const lh = 18;
      const lx = -lw / 2;
      const ly = -r - 9 - lh;
      roundRectPath(ctx, lx, ly, lw, lh, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(10,10,10,0.35)';
      ctx.stroke();
      ctx.fillStyle = '#0a0a0a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 0, ly + lh / 2 + 0.5);
    }
    ctx.restore();
  }

  function render(now) {
    const w = S.viewW;
    const h = S.viewH;
    const s = S.tilePx;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (!S.grid) return;

    const originX = w / 2 - S.cam.x * s;
    const originY = h / 2 - S.cam.y * s;

    const gx0 = Math.max(0, Math.floor(-originX / s) - 1);
    const gy0 = Math.max(0, Math.floor(-originY / s) - 1);
    const gx1 = Math.min(S.W - 1, Math.ceil((w - originX) / s) + 1);
    const gy1 = Math.min(S.H - 1, Math.ceil((h - originY) / s) + 1);

    // walls (classic black maze on white)
    ctx.fillStyle = '#0a0a0a';
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = S.grid[gy];
      for (let gx = gx0; gx <= gx1; gx++) {
        if (row[gx] !== '#') continue;
        const sx = originX + gx * s;
        const sy = originY + gy * s;
        ctx.fillRect(sx, sy, s + 0.5, s + 0.5);
      }
    }

    // treasures
    const tSize = s;
    for (const t of S.treasures) {
      if (S.collected.has(t.id)) continue;
      const sx = originX + t.x * s;
      const sy = originY + t.y * s + Math.sin(now / 420 + t.id * 1.7) * s * 0.06;
      if (sx < -s || sy < -s || sx > w + s || sy > h + s) continue;
      const d = Math.hypot(t.x - S.me.x, t.y - S.me.y);
      const pulse = d < 2.2 ? (Math.sin(now / 220) + 1) / 2 : 0;
      drawGem(sx, sy, tSize, pulse);
    }

    // fog: fade everything far from the player to white
    const meSX = originX + S.me.x * s;
    const meSY = originY + S.me.y * s;
    const rClear = 4.3 * s;
    const rFull = 8.6 * s;
    const rOut = Math.hypot(w, h);
    const g = ctx.createRadialGradient(meSX, meSY, 0, meSX, meSY, rOut);
    const oClear = Math.min(1, rClear / rOut);
    const oFull = Math.min(1, rFull / rOut);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(oClear, 'rgba(255,255,255,0)');
    g.addColorStop(oFull, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // other players (always visible above fog)
    for (const p of S.players.values()) {
      const sx = originX + p.x * s;
      const sy = originY + p.y * s;
      if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
      drawPlayer(sx, sy, p.fx, p.fy, p.name, false, s);
    }

    // me
    drawPlayer(meSX, meSY, S.me.fx, S.me.fy, S.name || 'Bạn', true, s);
  }

  /* ----------------------------- minimap ---------------------------- */

  let minimapTick = 0;

  function renderMinimap() {
    if (!S.grid) return;
    const mw = minimap.width / S.dpr;
    const mh = minimap.height / S.dpr;
    const m = Math.min(mw / S.W, mh / S.H);
    const offX = (mw - S.W * m) / 2;
    const offY = (mh - S.H * m) / 2;

    mctx.fillStyle = '#f4f4f4';
    mctx.fillRect(0, 0, mw, mh);

    for (let gy = 0; gy < S.H; gy++) {
      for (let gx = 0; gx < S.W; gx++) {
        if (!S.explored[gy * S.W + gx]) continue;
        mctx.fillStyle = S.grid[gy][gx] === '#' ? '#0a0a0a' : '#ffffff';
        mctx.fillRect(offX + gx * m, offY + gy * m, m + 0.4, m + 0.4);
      }
    }

    // collected treasure marks
    mctx.fillStyle = '#0a0a0a';
    for (const t of S.treasures) {
      if (!S.collected.has(t.id)) continue;
      mctx.fillRect(offX + t.x * m - 1.5, offY + t.y * m - 1.5, 3, 3);
    }

    // camera viewport
    const vw = S.viewW / S.tilePx;
    const vh = S.viewH / S.tilePx;
    mctx.strokeStyle = 'rgba(10,10,10,0.4)';
    mctx.lineWidth = 1;
    mctx.strokeRect(
      offX + (S.cam.x - vw / 2) * m,
      offY + (S.cam.y - vh / 2) * m,
      vw * m,
      vh * m
    );

    // remote players
    mctx.fillStyle = '#8a8a8a';
    for (const p of S.players.values()) {
      mctx.beginPath();
      mctx.arc(offX + p.x * m, offY + p.y * m, 2, 0, Math.PI * 2);
      mctx.fill();
    }

    // me
    mctx.beginPath();
    mctx.arc(offX + S.me.x * m, offY + S.me.y * m, 3, 0, Math.PI * 2);
    mctx.fillStyle = '#0a0a0a';
    mctx.fill();
    mctx.lineWidth = 1.5;
    mctx.strokeStyle = '#ffffff';
    mctx.stroke();
  }

  /* ------------------------------- loop ----------------------------- */

  let prevTs = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    const now = ts || performance.now();
    let dt = (now - prevTs) / 1000;
    prevTs = now;
    if (dt > 0.1) dt = 0.1;
    if (!S.started || !S.grid) return;

    update(dt, now);
    render(now);
    if (++minimapTick % 5 === 0) renderMinimap();
  }
  requestAnimationFrame(loop);

  /* ------------------------------ start ----------------------------- */

  startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (nameInput.value || '').trim().slice(0, 16);
    if (!name) {
      nameInput.focus();
      return;
    }
    S.name = name;
    startError.hidden = true;
    startBtn.disabled = true;
    startBtn.textContent = 'ĐANG KẾT NỐI...';
    openWS();
    // safety: if the socket stalls without a close/error event, re-enable
    setTimeout(() => {
      if (!S.started) {
        startBtn.disabled = false;
        startBtn.textContent = 'VÀO GAME';
      }
    }, 5000);
  });

  resize();
})();
