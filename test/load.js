'use strict';

/* Load check for a full classroom: 1 host + N players, every player moving at
 * the real client rate (a state message every 66ms). Measures what each device
 * has to download and how the server event loop behaves.
 *
 *   node test/load.js [players=50] [seconds=6]
 *
 * Not part of `npm test` (it opens 50+ sockets and takes ~15s); run it with
 * `npm run load` before a big session.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3131);
const N = Number(process.argv[2] || 50);
const SECONDS = Number(process.argv[3] || 6);
const STATE_MS = 66; // the real client sends state at most every 66ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rate = (bytes, seconds) => ((bytes / 1024 / seconds).toFixed(1) + ' KB/s').padStart(9);

async function until(fn, label, timeout = 20000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await sleep(10);
  }
  return fn();
}

// % of one CPU core the server burned so far (Linux only; 0 when unavailable)
function cpuSeconds(pid) {
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(f[11]) + Number(f[12])) / 100;
  } catch (e) {
    return 0;
  }
}

function healthLatency() {
  const t0 = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('health timeout')));
  });
}

async function main() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ROUND_MS: '60000', FREEZE_MS: '7000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));

  const clients = [];
  function connect(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { name, ws, inbox: [], bytes: 0, msgs: 0, seen: new Set(), init: null };
    c.reset = () => { c.bytes = 0; c.msgs = 0; };
    ws.on('message', (d) => {
      c.bytes += d.length;
      c.msgs++;
      const m = JSON.parse(d);
      if (m.t === 'state') c.seen.add(m.id);
      c.inbox.push(m);
      if (c.inbox.length > 300) c.inbox.splice(0, c.inbox.length - 300);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    c.last = (t) => c.inbox.filter((m) => m.t === t).at(-1);
    clients.push(c);
    return c;
  }

  try {
    await until(() => log.includes('server v2'), 'boot');

    const tJoin = Date.now();
    const host = connect('Teacher');
    await until(() => host.ws.readyState === 1, 'host open');
    host.send({ t: 'join', name: 'Teacher' });
    host.init = await until(() => host.last('init'), 'host init');

    const players = [];
    for (let i = 0; i < N; i++) {
      const c = connect('Hoc sinh ' + (i + 1));
      players.push(c);
      await until(() => c.ws.readyState === 1, 'socket ' + i);
      c.send({ t: 'join', name: 'Hoc sinh ' + (i + 1) });
    }
    await until(() => players.every((c) => c.last('init')), 'all inits');
    const joinMs = Date.now() - tJoin;

    host.send({ t: 'host', action: 'start' });
    await until(() => players.every((c) => c.last('round')), 'round broadcast');
    const spawn = players[0].last('round').spawn;
    assert(spawn && Number.isFinite(spawn.x), 'round has a shared spawn');

    /* ------------- movement phase: everyone drags the joystick ------------- */
    for (const c of [host, ...players]) c.reset();
    const timers = players.map((c, i) => {
      const dx = 0.15 + (i % 3) * 0.01; // stays inside the spawn tile and under the server budget
      let side = 1;
      return setInterval(() => {
        side = -side;
        c.send({ t: 'state', x: spawn.x + side * dx, y: spawn.y, fx: side, fy: 0 });
      }, STATE_MS);
    });
    const latencies = [];
    const sampler = setInterval(() => {
      healthLatency().then((ms) => latencies.push(ms)).catch(() => {});
    }, 250);

    const cpuBefore = cpuSeconds(proc.pid);
    const t0 = Date.now();
    while (Date.now() - t0 < SECONDS * 1000) await sleep(50);
    const elapsed = (Date.now() - t0) / 1000;
    const cpuUsed = cpuSeconds(proc.pid) - cpuBefore;
    clearInterval(sampler);
    for (const t of timers) clearInterval(t);
    await sleep(200);

    const perPlayer = players.reduce((s, c) => s + c.bytes, 0) / players.length;
    const perPlayerMsgs = players.reduce((s, c) => s + c.msgs, 0) / players.length;
    const hostMsgsPerSec = host.msgs / elapsed;
    const sorted = latencies.slice().sort((a, b) => a - b);
    const pick = (q) => (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0);
    const classBytes = host.bytes + players.reduce((s, c) => s + c.bytes, 0);

    console.log(`\n${N} players + 1 host · everyone moving for ${elapsed.toFixed(1)}s · ${N} joins in ${joinMs}ms`);
    console.log(`  host downloads       ${rate(host.bytes, elapsed)}  (${hostMsgsPerSec.toFixed(0)} msgs/s, ${host.seen.size}/${N} players tracked)`);
    console.log(`  each player          ${rate(perPlayer, elapsed)}  (${(perPlayerMsgs / elapsed).toFixed(1)} msgs/s)`);
    console.log(`  class traffic / 10s  ${((classBytes / 1024) / elapsed * 10).toFixed(0)} KB`);
    console.log(`  server CPU           ${(cpuUsed / elapsed * 100).toFixed(0)}% of one core`);
    console.log(`  /health round trip   p50 ${pick(0.5).toFixed(0)}ms · p95 ${pick(0.95).toFixed(0)}ms · worst ${pick(1).toFixed(0)}ms\n`);

    assert(players.every((c) => c.ws.readyState === 1), 'nobody got dropped');
    assert.equal(host.seen.size, N, 'host still tracks every player');
    assert(hostMsgsPerSec > N * 0.8, 'host receives the whole class');
    assert(perPlayerMsgs / elapsed < 3, 'players no longer receive every opponents position');
    assert(pick(0.95) < 250, `server stays responsive (p95 ${pick(0.95).toFixed(0)}ms)`);
    console.log('load OK: host tracks everyone, players stay quiet, event loop stays responsive');
  } catch (e) {
    console.error(log);
    throw e;
  } finally {
    for (const c of clients) c.ws.terminate();
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await exited;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
