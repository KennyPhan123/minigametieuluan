'use strict';

/* Headless client test: runs public/game.js against a mock DOM + Canvas +
 * WebSocket, then plays a full round:
 *   join -> treasure at spawn -> "ĐỂ SAU" stays dismissed -> walk away ->
 *   10 correct answers -> win overlay -> restart resets progress.
 */

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { mulberry32, generateMaze, pickTreasures } = require('../maze');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClassList() {
  const set = new Set();
  return {
    add: (n) => set.add(n),
    remove: (n) => set.delete(n),
    toggle: (n, force) => {
      const on = force === undefined ? !set.has(n) : !!force;
      if (on) set.add(n);
      else set.delete(n);
      return on;
    },
    contains: (n) => set.has(n),
  };
}

function makeElement(tag) {
  const listeners = {};
  let ownText = '';
  const el = {
    tagName: tag || 'div',
    id: '',
    children: [],
    hidden: false,
    disabled: false,
    value: '',
    className: '',
    offsetWidth: 100,
    style: {},
    classList: makeClassList(),
    listeners,
    _innerHTML: '',
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    focus() {},
    setPointerCapture() {},
    getBoundingClientRect() {
      return { width: 112, height: 86 };
    },
    fire(type, ev) {
      (listeners[type] || []).forEach((fn) => fn(ev || { preventDefault() {} }));
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(v) {
      this._innerHTML = v;
      if (v === '') {
        this.children = [];
        ownText = '';
      }
    },
  });
  // mimic the DOM: textContent of a node includes descendants' text
  Object.defineProperty(el, 'textContent', {
    get() {
      let s = ownText;
      for (const c of this.children) s += c.textContent;
      return s;
    },
    set(v) {
      ownText = String(v);
    },
  });
  return el;
}

function makeCtx() {
  const gradient = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    createRadialGradient: () => gradient,
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

async function main() {
  /* ---------------------------- mock DOM ---------------------------- */

  const ids = [
    'startScreen', 'startForm', 'startBtn', 'nameInput', 'startError', 'game',
    'gameCanvas', 'touchLayer', 'pips', 'progressText', 'onlineChip', 'leaderboard',
    'restartBtn', 'minimap', 'joyBase', 'joyKnob', 'toast', 'netBanner',
    'questionOverlay', 'questionTag', 'questionText', 'questionOptions',
    'questionFeedback', 'questionLater', 'winOverlay', 'winKicker', 'winTitle',
    'winSub', 'btnContinue', 'btnPlayAgain',
  ];
  const els = {};
  for (const id of ids) els[id] = makeElement('div');
  els.startForm.tagName = 'form';
  els.startBtn.tagName = 'button';
  els.questionLater.tagName = 'button';
  els.btnContinue.tagName = 'button';
  els.btnPlayAgain.tagName = 'button';
  els.restartBtn.tagName = 'button';
  els.gameCanvas.getContext = () => makeCtx();
  els.minimap.getContext = () => makeCtx();

  const created = [];
  const document = {
    body: makeElement('body'),
    getElementById: (id) => els[id] || null,
    createElement: (tag) => {
      const el = makeElement(tag);
      created.push(el);
      return el;
    },
  };

  const windowListeners = {};
  const windowObj = {
    innerWidth: 390,
    innerHeight: 780,
    devicePixelRatio: 2,
    addEventListener(type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    },
  };

  const rafQueue = [];
  let clock = 0;

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const sockets = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      sockets.push(this);
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      const fn = this.onclose;
      if (fn) fn();
    }
    last(type) {
      for (let i = this.sent.length - 1; i >= 0; i--) {
        if (this.sent[i].type === type) return this.sent[i];
      }
      return null;
    }
    feed(msg) {
      this.onmessage && this.onmessage({ data: JSON.stringify(msg) });
    }
  }

  // accelerate long in-game timers (950ms feedback, 5s safety, ...)
  const fastSetTimeout = (fn, delay, ...rest) =>
    setTimeout(fn, delay >= 300 ? 5 : delay, ...rest);

  const sandbox = {
    document,
    window: windowObj,
    location: { protocol: 'http:', host: 'localhost:3111' },
    localStorage,
    WebSocket: FakeWS,
    requestAnimationFrame: (cb) => rafQueue.push(cb),
    performance: { now: () => clock },
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    setTimeout: fastSetTimeout,
    clearTimeout,
    console,
    Math,
    JSON,
    Number,
    Array,
    Object,
    String,
    Set,
    Map,
    Uint8Array,
  };
  const ctx = vm.createContext(sandbox);

  const questionsCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'questions.js'), 'utf8');
  const gameCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');
  vm.runInContext(questionsCode, ctx, { filename: 'questions.js' });
  const QUESTIONS = vm.runInContext('QUESTIONS', ctx);
  assert.strictEqual(QUESTIONS.length, 10, '10 questions loaded');
  vm.runInContext(gameCode, ctx, { filename: 'game.js' });

  function pump(frames, stepMs) {
    for (let i = 0; i < frames; i++) {
      clock += stepMs || 16;
      const cbs = rafQueue.splice(0, rafQueue.length);
      cbs.forEach((cb) => cb(clock));
    }
  }

  async function waitFor(cond, what, timeout) {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > (timeout || 1500)) throw new Error('timeout: ' + what);
      await sleep(5);
    }
  }

  const press = (key) => windowListeners.keydown.forEach((fn) => fn({ key, preventDefault() {} }));
  const release = (key) => windowListeners.keyup.forEach((fn) => fn({ key }));

  /* ------------------------- build real maze ------------------------ */

  const rng = mulberry32(42);
  const { grid, W, H } = generateMaze(20, 15, rng);
  const gridRows = grid.map((row) => row.map((v) => (v === 1 ? '#' : '.')).join(''));
  const farTreasures = pickTreasures(grid, rng, 10).map((t, i) => ({ id: i, x: t.x, y: t.y, q: i }));

  function makeInit(gameId, treasures, start) {
    return {
      type: 'init',
      id: 'me',
      gameId,
      grid: gridRows,
      w: W,
      h: H,
      start: start || { x: 1.5, y: 1.5 },
      treasures,
      players: [{ id: 'me', name: 'Tester', x: start ? start.x : 1.5, y: start ? start.y : 1.5, fx: 1, fy: 0, progress: 0 }],
      winner: null,
    };
  }

  /* ----------------------------- 1. join ---------------------------- */

  els.nameInput.value = 'Tester';
  els.startForm.fire('submit');
  await waitFor(() => sockets.length === 1, 'socket opened');
  const ws = sockets[0];
  await waitFor(() => ws.last('join'), 'join sent');
  assert.strictEqual(ws.last('join').name, 'Tester', 'join name');

  // one treasure right at spawn, the other nine far away
  const near = [{ id: 0, x: 1.5, y: 1.5, q: 0 }].concat(farTreasures.slice(1));
  ws.feed(makeInit('g1', near));
  assert.strictEqual(els.startScreen.hidden, true, 'start screen hidden');
  assert.strictEqual(els.game.hidden, false, 'game visible');
  assert.strictEqual(els.onlineChip.textContent, '1 NGƯỜI CHƠI', 'online chip');
  pump(3);

  /* --------------------- 2. treasure opens modal -------------------- */

  assert.strictEqual(els.questionOverlay.hidden, false, 'question modal opened at spawn');
  assert.strictEqual(els.questionTag.textContent, 'CÂU 1 / 10', 'question tag');
  assert.strictEqual(els.questionOptions.children.length, 4, 'four options');
  assert.strictEqual(els.questionText.textContent, QUESTIONS[0].text, 'question text matches');

  // wrong answer: option disabled, feedback shown, modal still open
  const wrongIdx = (QUESTIONS[0].answer + 1) % 4;
  els.questionOptions.children[wrongIdx].fire('click');
  assert.strictEqual(els.questionOptions.children[wrongIdx].disabled, true, 'wrong option disabled');
  assert.strictEqual(els.questionOverlay.hidden, false, 'modal stays open after wrong');
  assert.ok(els.questionFeedback.textContent.includes('SAI'), 'wrong feedback shown');

  /* ------------------------ 3. "ĐỂ SAU" flow ------------------------ */

  els.questionLater.fire('click');
  assert.strictEqual(els.questionOverlay.hidden, true, 'modal closed by ĐỂ SAU');
  pump(10);
  assert.strictEqual(els.questionOverlay.hidden, true, 'dismissed treasure stays closed nearby');

  /* ------------------------- 4. walk away --------------------------- */

  const base = ws.last('state') || { x: 1.5, y: 1.5 };
  const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  let moved = false;
  for (let round = 0; round < 8 && !moved; round++) {
    for (const d of dirs) {
      press(d);
      pump(40);
      release(d);
      const s = ws.last('state');
      if (s && Math.hypot(s.x - base.x, s.y - base.y) > 1.7) {
        moved = true;
        break;
      }
    }
  }
  assert.ok(moved, 'player moved away from spawn');
  const pos = ws.last('state');

  /* ----------------- 5. reload view: 10 treasures on me -------------- */

  const allNear = Array.from({ length: 10 }, (_, i) => ({ id: i, x: pos.x, y: pos.y, q: i }));
  ws.feed(makeInit('g1', allNear, { x: pos.x, y: pos.y }));
  // keep the position the client already had (same gameId => sameGame keeps pos)
  pump(2);
  assert.strictEqual(els.questionOverlay.hidden, false, 'question reopened at new spot');
  assert.strictEqual(els.questionTag.textContent, 'CÂU 1 / 10', 'dismissal cleared after walking away');

  /* ------------------------ 6. answer all 10 ------------------------ */

  for (let i = 0; i < 10; i++) {
    await waitFor(
      () => !els.questionOverlay.hidden && els.questionOptions.children.length === 4,
      'modal open for treasure ' + (i + 1)
    );
    const n = parseInt(els.questionTag.textContent.match(/CÂU (\d+)/)[1], 10);
    assert.strictEqual(n, i + 1, 'question order ' + (i + 1));
    const answer = QUESTIONS[n - 1].answer;
    els.questionOptions.children[answer].fire('click');
    await waitFor(() => els.questionOverlay.hidden, 'modal closed after correct');
    assert.strictEqual(els.progressText.textContent, (i + 1) + '/10', 'progress ' + (i + 1));
    pump(2);
  }

  const prog = ws.last('progress');
  assert.strictEqual(prog.collected.length, 10, 'progress sent with 10 treasures');
  assert.strictEqual(els.winOverlay.hidden, false, 'win overlay shown');
  assert.strictEqual(els.winTitle.textContent, 'CHIẾN THẮNG', 'win title');

  /* --------------------------- 7. restart --------------------------- */

  els.btnPlayAgain.fire('click');
  const rs = ws.last('restart');
  assert.ok(rs, 'restart message sent');
  ws.feed({ type: 'restart', gameId: 'g2', players: [{ id: 'me', name: 'Tester', x: pos.x, y: pos.y, fx: 1, fy: 0, progress: 0 }] });
  assert.strictEqual(els.progressText.textContent, '0/10', 'progress reset');
  assert.strictEqual(els.winOverlay.hidden, true, 'win overlay hidden after restart');
  assert.strictEqual(els.pips.children.length, 10, 'ten pips');
  pump(2);

  console.log('client test OK');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('CLIENT TEST FAILED:', err && err.stack || err);
    process.exit(1);
  }
);
