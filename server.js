'use strict';

/* ---------------------------------------------------------------
 * Me cung Hasaki - game server
 * - Serves static client (public/)
 * - WebSocket realtime: vi tri nguoi choi, tien do, kho bau, chien thang
 * --------------------------------------------------------------- */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { mulberry32, generateMaze, pickTreasures } = require('./maze');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAZE_COLS = 20; // cells -> grid 41 x 31 tiles
const MAZE_ROWS = 15;
const TREASURE_COUNT = 10;

/* ----------------------- maze & world state ----------------------- */

let gameId = Date.now().toString(36);
const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
const { grid, W, H } = generateMaze(MAZE_COLS, MAZE_ROWS, rng);
const gridRows = grid.map((row) => row.map((v) => (v === 1 ? '#' : '.')).join(''));
const START = { x: 1.5, y: 1.5 };

const treasures = pickTreasures(grid, rng, TREASURE_COUNT).slice(0, TREASURE_COUNT);
// shuffle question assignment so each run differs
const qOrder = Array.from({ length: TREASURE_COUNT }, (_, i) => i);
for (let i = qOrder.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [qOrder[i], qOrder[j]] = [qOrder[j], qOrder[i]];
}
const treasureList = treasures.map((t, i) => ({ id: i, x: t.x, y: t.y, q: qOrder[i] }));

/* ----------------------------- helpers ---------------------------- */

function sanitizeName(raw) {
  let name = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
  if (!name) name = 'Nguoi choi ' + Math.floor(Math.random() * 900 + 100);
  return name;
}

function sanitizeCollected(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= TREASURE_COUNT || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, fx: p.fx, fy: p.fy, progress: p.progress };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  for (const p of players.values()) {
    if (p.id !== exceptId) send(p.ws, msg);
  }
}

/* --------------------------- http static -------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, players: players.size, gameId }));
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

/* ---------------------------- websocket --------------------------- */

const wss = new WebSocketServer({ server });
const players = new Map(); // id -> player
let nextId = 1;
let winner = null; // { id, name }

wss.on('connection', (ws) => {
  const id = String(nextId++);
  ws.isAlive = true;
  ws.playerId = null;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (players.has(id)) return;
      const p = {
        id,
        name: sanitizeName(msg.name),
        x: START.x,
        y: START.y,
        fx: 1,
        fy: 0,
        progress: 0,
        ws,
      };
      players.set(id, p);
      ws.playerId = id;
      send(ws, {
        type: 'init',
        id,
        gameId,
        grid: gridRows,
        w: W,
        h: H,
        start: START,
        treasures: treasureList,
        players: Array.from(players.values()).map(publicPlayer),
        winner: winner ? { id: winner.id, name: winner.name } : null,
      });
      broadcast({ type: 'joined', player: publicPlayer(p) }, id);
      console.log(`[join] ${p.name} (${id}) - online: ${players.size}`);
      return;
    }

    const p = players.get(ws.playerId);
    if (!p) return;

    if (msg.type === 'state') {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (Number.isFinite(x)) p.x = Math.max(0.5, Math.min(W - 0.5, x));
      if (Number.isFinite(y)) p.y = Math.max(0.5, Math.min(H - 0.5, y));
      const fx = Number(msg.fx);
      const fy = Number(msg.fy);
      if (Number.isFinite(fx) && Number.isFinite(fy) && Math.hypot(fx, fy) > 0.001) {
        const len = Math.hypot(fx, fy);
        p.fx = fx / len;
        p.fy = fy / len;
      }
      broadcast({ type: 'state', id: p.id, x: p.x, y: p.y, fx: p.fx, fy: p.fy }, p.id);
      return;
    }

    if (msg.type === 'progress') {
      const collected = sanitizeCollected(msg.collected);
      p.progress = collected.length;
      broadcast({ type: 'progress', id: p.id, count: p.progress }, p.id);
      if (p.progress >= TREASURE_COUNT && !winner) {
        winner = { id: p.id, name: p.name };
        broadcast({ type: 'won', id: p.id, name: p.name });
        console.log(`[win] ${p.name} (${p.id}) finished all ${TREASURE_COUNT} treasures`);
      }
      return;
    }

    if (msg.type === 'restart') {
      winner = null;
      gameId = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      for (const pl of players.values()) pl.progress = 0;
      broadcast({ type: 'restart', gameId, players: Array.from(players.values()).map(publicPlayer) });
      console.log('[restart] new round, gameId=' + gameId);
      return;
    }
  });

  ws.on('close', () => {
    const p = players.get(ws.playerId);
    if (p) {
      players.delete(p.id);
      broadcast({ type: 'left', id: p.id });
      console.log(`[left] ${p.name} (${p.id}) - online: ${players.size}`);
    }
  });

  ws.on('error', () => {});
});

/* heartbeat: drop dead connections */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hasaki maze server running on http://0.0.0.0:${PORT}`);
  console.log(`Maze ${W}x${H} tiles, ${treasureList.length} treasures, gameId=${gameId}`);
});
