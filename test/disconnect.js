'use strict';

/* Regression: a player leaving must not take the whole server down.
 * Before the fix, every socket close called an undefined helper, the
 * ReferenceError killed the process and every player lost the game.
 * Covers: student leaves, socket that never joined closes, host leaves
 * (promotion), room empties (reset), and a fresh join after the reset. */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3121;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, timeout = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await sleep(10);
  }
  return fn();
}

async function waitFor(check, label, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const h = await health();
      if (check(h)) return h;
    } catch (e) {
      // server unreachable: keep polling until the timeout
    }
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await sleep(50);
  }
}

function health() {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('health timeout'));
      });
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const inbox = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d)));
    ws.once('open', () =>
      resolve({
        ws,
        inbox,
        send: (o) => ws.send(JSON.stringify(o)),
        last: (t) => inbox.filter((m) => m.t === t).at(-1),
      }),
    );
    ws.once('error', reject);
  });
}

async function join(name) {
  const c = await connect();
  c.send({ t: 'join', name });
  c.init = await until(() => c.last('init'), 'init ' + name);
  return c;
}

(async () => {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ROUND_MS: '60000', FREEZE_MS: '7000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const clients = [];
  try {
    await until(() => log.includes('server v2'), 'boot');

    const host = await join('Teacher');
    clients.push(host);
    const an = await join('An');
    clients.push(an);
    const binh = await join('Binh');
    clients.push(binh);

    // a socket that never sends "join" (e.g. a tab that failed to load the game) closes too
    const stray = await connect();
    clients.push(stray);
    stray.ws.close();
    await waitFor((h) => h.body.players === 3, 'stray socket is not counted as a player');

    // 1) a student leaves mid-lobby: server keeps running
    an.ws.close();
    await waitFor((h) => h.body.players === 2, 'two players online after An left');
    await until(
      () => host.inbox.some((m) => m.t === 'room' && !m.players.some((p) => p.id === an.init.id)),
      'host receives the roster without An',
    );

    // 2) host leaves: the oldest remaining player is promoted
    host.ws.close();
    await until(
      () => binh.inbox.some((m) => m.t === 'room' && m.hostId === binh.init.id),
      'Binh promoted to host',
    );
    await waitFor((h) => h.body.players === 1, 'only Binh left');

    // 3) last player leaves: room resets to the lobby
    binh.ws.close();
    const h = await waitFor((x) => x.body.players === 0 && x.body.phase === 'lobby', 'room reset');
    assert.equal(h.status, 200);

    // 4) the reset room still accepts players, and the first joiner becomes host
    const chi = await join('Chi');
    clients.push(chi);
    assert.equal(chi.init.role, 'host', 'first joiner after reset is host');
    assert(!/ReferenceError|TypeError/.test(log), 'no crash in server log:\n' + log);

    console.log('disconnect OK: leaving players, stray sockets, host promotion and room reset keep the server alive');
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
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
