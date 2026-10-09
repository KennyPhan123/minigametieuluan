'use strict';

/* End-to-end smoke test: boots the server on a test port, connects two
 * WebSocket clients and exercises join / move / progress / win / restart. */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const PORT = 3111;
const BASE = 'http://127.0.0.1:' + PORT;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function health(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      http
        .get(BASE + '/health', (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            } else if (left > 0) setTimeout(() => attempt(left - 1), 150);
            else reject(new Error('health bad status ' + res.statusCode));
          });
        })
        .on('error', () => {
          if (left > 0) setTimeout(() => attempt(left - 1), 150);
          else reject(new Error('server never came up'));
        });
    };
    attempt(retries);
  });
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    const inbox = [];
    ws.on('message', (d) => {
      try {
        inbox.push(JSON.parse(d.toString()));
      } catch (e) {}
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', name }));
      resolve({ ws, inbox, name });
    });
    ws.on('error', reject);
  });
}

function waitFor(inbox, type, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const m = inbox.find((x) => x.type === type);
      if (m) return resolve(m);
      if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for ' + type));
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  try {
    const h = await health();
    assert.strictEqual(h.ok, true, 'health ok');

    // --- client 1 joins ---
    const c1 = await connect('An');
    const init1 = await waitFor(c1.inbox, 'init');
    assert.ok(Array.isArray(init1.grid) && init1.grid.length > 10, 'grid rows');
    assert.ok(init1.grid[0].length > 10, 'grid cols');
    assert.strictEqual(init1.treasures.length, 10, '10 treasures');
    assert.strictEqual(init1.players.length, 1, 'one player after first join');
    assert.strictEqual(init1.start.x, 1.5, 'start x');
    assert.ok(init1.gameId, 'gameId present');
    // every treasure on a passage
    for (const t of init1.treasures) {
      const gx = Math.floor(t.x);
      const gy = Math.floor(t.y);
      assert.strictEqual(init1.grid[gy][gx], '.', 'treasure on passage');
    }
    // question ids are a permutation of 0..9
    const qs = init1.treasures.map((t) => t.q).sort((a, b) => a - b);
    assert.deepStrictEqual(qs, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'question permutation');

    // --- client 2 joins, client 1 gets notified ---
    const c2 = await connect('Binh');
    const init2 = await waitFor(c2.inbox, 'init');
    assert.strictEqual(init2.players.length, 2, 'two players');
    const joined = await waitFor(c1.inbox, 'joined');
    assert.strictEqual(joined.player.name, 'Binh', 'joined name relayed');

    // --- position relay ---
    c1.ws.send(JSON.stringify({ type: 'state', x: 5.25, y: 6.5, fx: 1, fy: 0 }));
    const st = await waitFor(c2.inbox, 'state');
    assert.ok(Math.abs(st.x - 5.25) < 0.001 && Math.abs(st.y - 6.5) < 0.001, 'state relayed');
    assert.strictEqual(st.id, init1.id, 'state from c1');

    // --- progress relay ---
    c1.ws.send(JSON.stringify({ type: 'progress', collected: [0, 1, 2] }));
    const pr = await waitFor(c2.inbox, 'progress');
    assert.strictEqual(pr.count, 3, 'progress count');
    assert.strictEqual(pr.id, init1.id, 'progress owner');

    // --- win at 10 ---
    c1.ws.send(JSON.stringify({ type: 'progress', collected: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    const won1 = await waitFor(c1.inbox, 'won');
    const won2 = await waitFor(c2.inbox, 'won');
    assert.strictEqual(won1.id, init1.id, 'winner is c1');
    assert.strictEqual(won2.name, 'An', 'winner name relayed');

    // --- reconnect keeps progress bookkeeping consistent ---
    const health2 = await health();
    assert.ok(health2.players >= 2, 'server tracks players');

    // --- restart resets progress ---
    c2.ws.send(JSON.stringify({ type: 'restart' }));
    const rs1 = await waitFor(c1.inbox, 'restart');
    const rs2 = await waitFor(c2.inbox, 'restart');
    assert.ok(rs1.gameId && rs1.gameId !== init1.gameId, 'restart changes gameId');
    for (const p of rs1.players) assert.strictEqual(p.progress, 0, 'progress reset');
    assert.ok(rs2.players, 'restart broadcast to both');

    // --- leave notification ---
    const leftPromise = waitFor(c2.inbox, 'left');
    c1.ws.close();
    const left = await leftPromise;
    assert.strictEqual(left.id, init1.id, 'left id matches');

    // --- static files served ---
    const page = await new Promise((resolve, reject) => {
      http.get(BASE + '/', (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.strictEqual(page.status, 200, 'index served');
    assert.ok(page.body.includes('MÊ CUNG'), 'index content');

    c2.ws.close();
    console.log('smoke test OK');
  } finally {
    server.kill('SIGTERM');
    await wait(150);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
