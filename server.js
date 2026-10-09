'use strict';

/* ---------------------------------------------------------------
 * Me cung Hasaki - game server (v2)
 *
 * Phong chu: nguoi vao dau tien = chu phong (xem map toan bo).
 * Nguoi choi vao phong cho, chu phong bat dau khi du so luong.
 * Moi vong 60s: spawn ranh ri maze, ruong o giua, 1 cau hoi.
 * - Nguoi dau tui dot ruong: +diem toc do + tu dong loai 2 dap an sai
 * - Tra loi sai: -30 diem, bi freeze 7s, dap an bi gach (chia se moi nguoi)
 * - Tra loi dung: +diem, cho het vong
 * - 5 nguoi dung (hoac het gio) -> ket vong -> review / chu phong trinh bai
 * 10 vong -> bang xep hang chung.
 * --------------------------------------------------------------- */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QUESTIONS = require('./public/questions.js');
const { mulberry32, shuffle, generateMaze, edgeCells, cellCenter } = require('./maze');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const COLS = 11; // cells -> grid 31 x 23 tiles (vua phai, khong rong)
const ROWS = 9;
const GRID_W = COLS * 2 + 1;
const GRID_H = ROWS * 2 + 1;
const TOTAL_ROUNDS = QUESTIONS.length; // 10
const MAX_CORRECT = 5; // 5 nguoi dung -> het vong som
const ROUND_MS = Number(process.env.ROUND_MS) || 60000; // 1 phut
const FREEZE_MS = Number(process.env.FREEZE_MS) || 7000; // dong bang 7s
const WRONG_PENALTY = 30;
const TOUCH_R = 1.0;

/* ----------------------------- scoring ---------------------------- */
/* +100 + giay con lai: nguoi dau tien dot ruong (100..160)
 * +100 + thuong toc do max 50: tra loi dung (100..150)
 * -30: moi dap an sai
 * +200: tra loi dung ca 10 vong (tinh luc ket thuc)                     */

function touchPoints(secondsIntoRound) {
  const left = Math.max(0, ROUND_MS / 1000 - secondsIntoRound);
  return 100 + Math.round(left);
}
function answerPoints(secondsToAnswer) {
  const bonus = Math.max(0, 50 - Math.ceil(2 * secondsToAnswer));
  return 100 + bonus;
}

/* --------------------------- http static -------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, players: players.size, phase: room.phase, round: room.round }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (filePath === path.join(PUBLIC_DIR, 'questions.js')) {
    const publicQuestions = QUESTIONS.map(q => ({text: q.text, options: q.options}));
    res.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(req.method === 'HEAD' ? undefined : 'const QUESTIONS = ' + JSON.stringify(publicQuestions) + ';');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

/* ------------------------------ room ------------------------------ */

let nextId = 1;
const players = new Map(); // id -> player (insertion order = join order)

function freshRoom() {
  return {
    phase: 'lobby', // lobby | round | review | classroom | gameover
    hostId: null,
    minPlayers: 2,
    round: 0,
    maze: null, // array of strings '#'/'.
    treasure: null, // {x,y}
    spawnPool: [], // shuffled edge centers left to assign
    questionIdx: -1,
    endsAt: 0,
    roundStartedAt: 0,
    touchedBy: null,
    eliminations: new Set(),
    correctCount: 0,
    revealed: null, // picked option idx in classroom phase
    roundEndInfo: null, // snapshot for review/classroom overlay
    roundTimer: null,
    seedCounter: (Date.now() ^ 0x5f3759df) >>> 0,
    completionBonusGiven: false,
  };
}
let room = freshRoom();

function newPlayer(id, name, ws) {
  return {
    id,
    name,
    ws,
    x: 1.5,
    y: 1.5,
    fx: 1,
    fy: 0,
    score: 0,
    totalCorrect: 0,
    totalWrong: 0,
    roundCorrect: false,
    roundWrong: 0,
    roundStartScore: 0,
    touched: false,
    modalOpenedAt: 0,
    frozenUntil: 0,
    spawned: false,
    reachBonus: 0,
    eliminations: new Set(),
    lastStateAt: Date.now(),
    moveBudget: 0.5,
  };
}

function roster() {
  return Array.from(players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    fx: p.fx,
    fy: p.fy,
    score: p.score,
    totalCorrect: p.totalCorrect,
    totalWrong: p.totalWrong,
    roundCorrect: p.roundCorrect,
    roundWrong: p.roundWrong,
    touched: p.touched,
    frozenUntil: p.frozenUntil,
    spawned: p.spawned,
  }));
}

function roomInfo() {
  return {
    t: 'room',
    phase: room.phase,
    hostId: room.hostId,
    minPlayers: room.minPlayers,
    players: roster(),
    round: room.round,
    correctCount: room.correctCount,
    revealed: room.revealed,
    correctIdx: room.revealed !== null ? QUESTIONS[room.questionIdx]?.answer : undefined,
    roundEndInfo: room.roundEndInfo,
    endsAt: room.endsAt,
    serverNow: Date.now(),
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  for (const p of players.values()) send(p.ws, msg);
}
function activeSpawnedCount() {
  let n = 0;
  for (const p of players.values()) if (p.spawned) n++;
  return n;
}
function countPlayers() {
  // so nguoi choi (khong tinh chu phong)
  let n = players.size;
  if (room.hostId && players.has(room.hostId)) n--;
  return n;
}
function leaderboardSnapshot() {
  return Array.from(players.values())
    .filter((p) => p.id !== room.hostId) // chu phong khong tham gia bang diem
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      delta: p.score - p.roundStartScore,
      roundCorrect: p.roundCorrect,
      totalCorrect: p.totalCorrect,
      totalWrong: p.totalWrong,
    }))
    .sort((a, b) => b.score - a.score || b.totalCorrect - a.totalCorrect || a.name.localeCompare(b.name));
}

/* --------------------------- round lifecycle ---------------------- */

function assignSpawn(p) {
  if (p.id === room.hostId) {
    p.spawned = false; // chu phong la nguoi dieu hanh, khong choi
    return;
  }
  let spot = room.spawnPool.pop();
  if (!spot) {
    // pool exhausted (many late joiners): random edge cell
    const edges = edgeCells(COLS, ROWS);
    const [c, r] = edges[Math.floor(Math.random() * edges.length)];
    spot = cellCenter(c, r);
  }
  p.x = spot.x;
  p.y = spot.y;
  p.spawned = true;
}

function startRound(n) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.phase = 'round';
  room.round = n;
  room.seedCounter = (room.seedCounter + 0x9e3779b9) >>> 0;
  const rng = mulberry32(room.seedCounter);
  const gen = generateMaze(COLS, ROWS, rng);
  room.maze = gen.grid.map((row) => row.map((v) => (v === 1 ? '#' : '.')).join(''));
  const center = cellCenter(Math.floor(COLS / 2), Math.floor(ROWS / 2));
  room.treasure = center;
  room.questionIdx = n - 1;
  room.touchedBy = null;
  room.eliminations = new Set();
  room.correctCount = 0;
  room.revealed = null;
  room.roundEndInfo = null;

  const edges = edgeCells(COLS, ROWS).map(([c, r]) => cellCenter(c, r));
  room.spawnPool = shuffle(edges, rng);

  for (const p of players.values()) {
    p.roundCorrect = false;
    p.roundWrong = 0;
    p.touched = false;
    p.modalOpenedAt = 0;
    p.frozenUntil = 0;
    p.reachBonus = 0;
    p.eliminations = new Set();
    p.lastStateAt = Date.now();
    p.moveBudget = 0.5;
    p.roundStartScore = p.score;
    assignSpawn(p);
  }

  room.roundStartedAt = Date.now();
  room.endsAt = room.roundStartedAt + ROUND_MS;
  room.roundTimer = setTimeout(() => endRound('time'), ROUND_MS);

  for (const p of players.values()) {
    send(p.ws, {
      t: 'round',
      round: room.round,
      questionIdx: room.questionIdx,
      maze: room.maze,
      treasure: room.treasure,
      spawn: { x: p.x, y: p.y },
      endsAt: room.endsAt,
      serverNow: Date.now(),
      players: roster(),
      eliminations: [],
      correctCount: 0,
    });
  }
  console.log(`[round ${n}] started, treasure at (${center.x},${center.y})`);
}

function endRound(reason) {
  if (room.phase !== 'round') return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = null;
  room.phase = room.correctCount > 0 ? 'review' : 'classroom';

  const info = {
    phase: room.phase,
    correctIdx: room.phase === 'review' ? QUESTIONS[room.questionIdx].answer : undefined,
    note: room.phase === 'review' ? QUESTIONS[room.questionIdx].note : undefined,
    round: room.round,
    questionIdx: room.questionIdx,
    correctCount: room.correctCount,
    reason,
    leaderboard: leaderboardSnapshot(),
    winners: Array.from(players.values())
      .filter((p) => p.roundCorrect)
      .map((p) => ({ id: p.id, name: p.name, delta: p.score - p.roundStartScore, reachBonus: p.reachBonus })),
    serverNow: Date.now(),
  };
  room.roundEndInfo = info;
  broadcast({ t: 'roundEnd', ...info });
  console.log(`[round ${room.round}] ended (${reason}) -> ${room.phase}, correct=${room.correctCount}`);
}

function finishGame() {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = null;
  if (!room.completionBonusGiven) {
    for (const p of players.values()) {
      if (p.totalCorrect >= TOTAL_ROUNDS) p.score += 200;
    }
    room.completionBonusGiven = true;
  }
  room.phase = 'gameover';
  const board = leaderboardSnapshot().map((e) => ({ ...e, bonus: e.totalCorrect >= TOTAL_ROUNDS ? 200 : 0 }));
  broadcast({ t: 'gameover', leaderboard: board, serverNow: Date.now() });
  console.log('[game] finished');
}

/* ------------------------------ events ---------------------------- */

function handleTouch(p) {
  if (room.phase !== 'round' || Date.now() >= room.endsAt || !p.spawned || p.id === room.hostId) {
    send(p.ws, { t: 'touchAck', ok: false, reason: 'round' });
    return;
  }
  const now = Date.now();
  const dist = Math.hypot(p.x - room.treasure.x, p.y - room.treasure.y);
  if (dist > TOUCH_R) {
    send(p.ws, { t: 'touchAck', ok: false, reason: 'distance' });
    return;
  }

  if (p.touched) return;
  const first = !room.touchedBy;
  let reach = 0;
  if (first) {
    room.touchedBy = p.id;
    // tu dong loai 50% dap an sai (2/3 dap an sai)
    const answer = QUESTIONS[room.questionIdx].answer;
    const wrongs = shuffle([0, 1, 2, 3].filter((i) => i !== answer), Math.random);
    p.eliminations = new Set(wrongs.slice(0, 2));
    const into = (now - room.roundStartedAt) / 1000;
    reach = touchPoints(into);
    p.score += reach;
    p.reachBonus = reach;
  }
  p.touched = true;
  if (!p.modalOpenedAt) p.modalOpenedAt = now;

  broadcast({ t: 'touchEvent', id: p.id, first, score: p.score, reachBonus: reach, serverNow: now });
  send(p.ws, {
    t: 'touchAck',
    ok: true,
    first,
    eliminations: Array.from(p.eliminations),
    score: p.score,
    reachBonus: reach,
    modalOpenedAt: p.modalOpenedAt,
    serverNow: now,
  });
}

function handleAnswer(p, idx) {
  const now = Date.now();
  const reject = (reason) => send(p.ws, { t: 'answerAck', ok: false, reason });
  if (room.phase !== 'round' || now >= room.endsAt || p.id === room.hostId || !p.spawned) return reject('round');
  if (p.roundCorrect) return reject('done');
  if (!p.touched) return reject('notouch');
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return reject('badidx');
  if (p.eliminations.has(idx)) return reject('eliminated');
  if (p.frozenUntil > now) return reject('frozen');

  const q = QUESTIONS[room.questionIdx];
  if (idx === q.answer) {
    p.roundCorrect = true;
    p.totalCorrect++;
    const seconds = Math.max(0, (now - p.modalOpenedAt) / 1000);
    const points = answerPoints(seconds);
    p.score += points;
    room.correctCount++;
    broadcast({
      t: 'correct',
      id: p.id,
      name: p.name,
      points,
      score: p.score,
      correctCount: room.correctCount,
      serverNow: now,
    });
    send(p.ws, { t: 'answerAck', ok: true, correct: true, points, score: p.score });
    if (room.correctCount >= MAX_CORRECT) endRound('correct');
  } else {
    p.totalWrong++;
    p.roundWrong++;
    p.frozenUntil = now + FREEZE_MS;
    p.eliminations.add(idx);
    p.score -= WRONG_PENALTY;
    broadcast({
      t: 'wrong',
      id: p.id,
      name: p.name,
      option: idx,
      until: p.frozenUntil,
      roundWrong: p.roundWrong,
      score: p.score,
      penalty: WRONG_PENALTY,
      serverNow: now,
    });
    send(p.ws, { t: 'answerAck', ok: true, correct: false, until: p.frozenUntil, score: p.score, eliminations: Array.from(p.eliminations) });
  }
}

function handleHost(p, action, value) {
  if (p.id !== room.hostId) return;
  if (action === 'min') {
    const v = Number(value);
    if (Number.isFinite(v)) room.minPlayers = Math.max(1, Math.min(100, Math.round(v)));
    broadcast(roomInfo());
    return;
  }
  if (action === 'start') {
    if (room.phase !== 'lobby') return;
    if (countPlayers() < room.minPlayers) return;
    for (const pl of players.values()) {
      pl.score = 0;
      pl.totalCorrect = 0;
      pl.totalWrong = 0;
      pl.spawned = false;
    }
    room.completionBonusGiven = false;
    startRound(1);
    return;
  }
  if (action === 'next') {
    if (room.phase === 'classroom' && room.revealed === null) return; // phai chon truoc
    if (room.phase !== 'review' && room.phase !== 'classroom') return;
    if (room.round >= TOTAL_ROUNDS) finishGame();
    else startRound(room.round + 1);
    return;
  }
  if (action === 'reveal') {
    if (room.phase !== 'classroom' || room.revealed !== null) return;
    const idx = Number(value);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    room.revealed = idx;
    broadcast({ t: 'reveal', picked: idx, correctIdx: QUESTIONS[room.questionIdx].answer, serverNow: Date.now() });
    broadcast(roomInfo());
    return;
  }
  if (action === 'again') {
    if (room.phase !== 'gameover') return;
    const oldHost = room.hostId;
    room = freshRoom();
    room.hostId = oldHost; // chu phong cu van la chu phong
    for (const pl of players.values()) {
      pl.score = 0;
      pl.totalCorrect = 0;
      pl.totalWrong = 0;
      pl.roundCorrect = false;
      pl.roundWrong = 0;
      pl.touched = false;
      pl.frozenUntil = 0;
      pl.spawned = false;
      pl.x = 1.5;
      pl.y = 1.5;
    }
    broadcast(roomInfo());
    console.log('[game] back to lobby');
    return;
  }
}

/* --------------------------- websocket ---------------------------- */

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  const id = String(nextId++);
  ws.isAlive = true;
  ws.playerId = null;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (ws.playerId) return;
      if (players.size === 0 && room.phase !== 'lobby') {
        // phong trong -> lam lai tu dau
        if (room.roundTimer) clearTimeout(room.roundTimer);
        room = freshRoom();
      }
      let name = String(msg.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
      if (!name) name = 'Nguoi choi ' + Math.floor(Math.random() * 900 + 100);
      const p = newPlayer(id, name, ws);
      players.set(id, p);
      ws.playerId = id;
      if (!room.hostId) room.hostId = id; // nguoi vao dau tien = chu phong
      if (false) { // late arrivals wait for the next round
        // vao giua vong -> spawn ngay o ria
        p.roundStartScore = p.score;
        assignSpawn(p);
      }
      send(ws, {
        ...roomInfo(),
        t: 'init',
        id,
        role: p.id === room.hostId ? 'host' : 'player',
        serverNow: Date.now(),
        roundMs: ROUND_MS,
        freezeMs: FREEZE_MS,
        totalRounds: TOTAL_ROUNDS,
        maxCorrect: MAX_CORRECT,
        maze: room.maze,
        treasure: room.treasure,
        questionIdx: room.questionIdx,
        eliminations: Array.from(p.eliminations),
        spawn: { x: p.x, y: p.y },
        me: { touched: p.touched, roundCorrect: p.roundCorrect, frozenUntil: p.frozenUntil, modalOpenedAt: p.modalOpenedAt },
      });
      broadcast(roomInfo());
      console.log(`[join] ${name} (${id}) as ${p.id === room.hostId ? 'HOST' : 'player'} - online ${players.size}`);
      return;
    }

    const p = players.get(ws.playerId);
    if (!p) return;

    if (msg.t === 'state') {
      if (!p.spawned || p.id === room.hostId || p.touched || p.frozenUntil > Date.now() || p.roundCorrect || room.phase !== 'round' || Date.now() >= room.endsAt) return; // khong di chuyen khi dong bang / da dung / het vong
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const now = Date.now();
      const distance = Math.hypot(x - p.x, y - p.y);
      p.moveBudget = Math.min(2, p.moveBudget + (now - p.lastStateAt) / 1000 * 6.5);
      p.lastStateAt = now;
      if (distance > p.moveBudget) return;
      const steps = Math.max(1, Math.ceil(distance * 10));
      for (let i = 0; i <= steps; i++) {
        const tx = Math.floor(p.x + (x - p.x) * i / steps);
        const ty = Math.floor(p.y + (y - p.y) * i / steps);
        if (!room.maze[ty] || room.maze[ty][tx] !== '.') return;
      }
      p.x = x; p.y = y; p.moveBudget -= distance;
      const fx = Number(msg.fx);
      const fy = Number(msg.fy);
      if (Number.isFinite(fx) && Number.isFinite(fy) && Math.hypot(fx, fy) > 0.001) {
        const l = Math.hypot(fx, fy);
        p.fx = fx / l;
        p.fy = fy / l;
      }
      broadcast({ t: 'state', id: p.id, x: p.x, y: p.y, fx: p.fx, fy: p.fy });
      return;
    }

    if (msg.t === 'touch') return handleTouch(p);
    if (msg.t === 'answer') return handleAnswer(p, msg.idx);
    if (msg.t === 'host') return handleHost(p, msg.action, msg.value);
  });

  ws.on('close', () => {
    const p = results_getPlayer(ws);
    if (!p) return;
    players.delete(p.id);
    const wasHost = p.id === room.hostId;
    if (players.size === 0) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      room = freshRoom();
      console.log('[room] empty -> reset');
      return;
    }
    if (wasHost) {
      room.hostId = players.values().next().value.id;
      players.get(room.hostId).spawned = false; // nguoi oldest con lai
      console.log(`[host] promoted ${room.hostId}`);
    }
    // neu so nguoi choi giam -> kiem tra dieu ket vong som

    broadcast(roomInfo());
    console.log(`[left] ${p.name} (${p.id}) - online ${players.size}`);
  });

  ws.on('error', () => {});
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hasaki maze server v2 on http://0.0.0.0:${PORT}`);
  console.log(`maze ${GRID_W}x${GRID_H}, round ${ROUND_MS}ms, freeze ${FREEZE_MS}ms, ${TOTAL_ROUNDS} rounds`);
});
