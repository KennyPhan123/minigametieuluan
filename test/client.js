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

const drawnLabels = [];
let ellipseCalls = 0; // drawGem dung ellipse(): dem de biet ruong co duoc ve hay khong
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
    setLineDash: noop,
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
    ellipse: () => { ellipseCalls++; },
    fill: noop,
    stroke: noop,
    fillText: text => drawnLabels.push(text),
    createRadialGradient: () => gradient,
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

async function main() {
  /* ---------------------------- mock DOM ---------------------------- */

  const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'),'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const els = {};
  for (const id of ids) els[id] = makeElement('div');
  els.startForm.tagName = 'form';
  els.startBtn.tagName = 'button';




  els.gameCanvas.getContext = () => makeCtx();
  els.minimap.getContext = () => makeCtx();

  const created = [];
  const document = {
    body: makeElement('body'),
    addEventListener() {},
    querySelector: () => makeElement('div'),
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
        if (this.sent[i].t === type) return this.sent[i];
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
  vm.runInContext('QUESTIONS.forEach(q => { delete q.answer; delete q.note; });', ctx);
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


  els.nameInput.value = 'Tester';
  els.startForm.fire('submit');
  await waitFor(() => sockets[0]?.last('join'), 'join');
  const ws = sockets[0];
  const roster = [
    {id:'host', name:'Teacher',score:0,spawned:false,totalCorrect:0},
    {id:'me',name:'Tester',score:0,spawned:true,roundCorrect:false,totalCorrect:0,x:1.5,y:1.5},
    {id:'other',name:'HiddenOpponent',score:0,spawned:true,totalCorrect:0,x:1.5,y:1.5}
  ];
  ws.feed({t:'init',id:'me',role:'player',hostId:'host',minPlayers:1,phase:'lobby',round:0,players:roster,serverNow:Date.now()});
  assert(els.startScreen.hidden);
  assert(!els.lobbyScreen.hidden);
  assert(els.startBtnLobby.hidden, 'player cannot start');
  const round = {t:'round', round:1,questionIdx:0,maze:['#######','#.....#','#.#.#.#','#.....#','#######'],treasure:{x:5.5,y:1.5},spawn:{x:1.5,y:1.5},endsAt:Date.now()+60000,serverNow:Date.now(),players:roster};
  ws.feed(round);
  drawnLabels.length=0; pump(2);
  assert(drawnLabels.includes('Tester'),'self remains visible');
  assert(!els.treasureCompass.hidden,'player sees treasure direction');
  // arrow orbits the player: offset from the player's centre points at the chest, rotation matches
  const arrow = () => {
    const cx = parseFloat(els.treasureCompass.style.left), cy = parseFloat(els.treasureCompass.style.top);
    return { dx: parseFloat(els.compassArrow.style.left), dy: parseFloat(els.compassArrow.style.top), cx, cy, rot: els.compassArrow.style.transform };
  };
  let a = arrow();
  assert(a.dx > 0 && Math.abs(a.dy) < 1e-6 && a.rot.includes('rotate(90deg)'), 'treasure to right: arrow east of player');
  ws.feed({...round, treasure:{x:1.5,y:3.5}}); pump(2);
  a = arrow(); assert(Math.abs(a.dx) < 1e-6 && a.dy > 0 && a.rot.includes('rotate(180deg)'), 'treasure below: arrow south');
  ws.feed({...round,spawn:{x:5.5,y:1.5},treasure:{x:1.5,y:1.5}}); pump(2);
  a = arrow(); assert(a.dx < 0 && Math.abs(a.dy) < 1e-6 && a.rot.includes('rotate(270deg)'), 'treasure to left: arrow west');
  ws.feed({...round,spawn:{x:1.5,y:3.5},treasure:{x:1.5,y:1.5}}); pump(2);
  a = arrow(); assert(Math.abs(a.dx) < 1e-6 && a.dy < 0 && a.rot.includes('rotate(0deg)'), 'treasure above: arrow north');
  assert(a.cx > 0 && a.cy > 0, 'compass container follows the player on screen');
  ws.feed(round); pump(2);
  assert(!drawnLabels.includes('HiddenOpponent'),'other players hidden even at same position');
  // chest is drawn inside the view radius even behind a wall, and hidden beyond it
  const wallRound = {...round, maze:['#########','#..#....#','#.......#','#########'], treasure:{x:4.5,y:1.5}};
  ws.feed(wallRound); ellipseCalls = 0; pump(2);
  assert(ellipseCalls > 0, 'chest 3 tiles away behind a wall is drawn');
  ws.feed({...wallRound, treasure:{x:7.5,y:2.5}}); ellipseCalls = 0; pump(2);
  assert.equal(ellipseCalls, 0, 'chest beyond view radius stays hidden');
  ws.feed(round); pump(2);
  press('ArrowRight'); pump(10); release('ArrowRight'); pump(6);
  const stopped = ws.last('state').x;
  assert(stopped > 1.5 && stopped < 3, 'continuous, non-grid movement');
  pump(20);
  assert.equal(ws.last('state').x, stopped, 'release stops immediately');
  press('ArrowUp'); pump(25); release('ArrowUp'); pump(6);
  assert(ws.last('state').y >= 1.28, 'circle collision blocks border walls');
  ws.feed(round);
  els.touchLayer.fire('pointerdown',{pointerId:1,clientX:100,clientY:200});
  els.touchLayer.fire('pointermove',{pointerId:1,clientX:152,clientY:200});
  assert(!els.joyBase.hidden, 'joystick appears where touched');
  pump(10);
  els.touchLayer.fire('pointerup',{pointerId:1}); pump(6);
  assert(els.joyBase.hidden);
  const afterTouch=ws.last('state').x; pump(15);
  assert.equal(ws.last('state').x,afterTouch,'lifting finger stops movement');
  assert(afterTouch>1.5,'joystick moves player');
  press('ArrowRight'); pump(50); release('ArrowRight');
  assert(ws.last('touch'), 'holding direction reaches chest');
  ws.feed({t:'touchAck',ok:true,first:true,eliminations:[0,2],score:150});
  assert(!els.questionOverlay.hidden);
  assert.equal(els.questionOptions.children.length,4);
  assert(els.questionOptions.children[0].disabled);
  els.questionOptions.children[3].fire('click');
  assert.equal(ws.last('answer').idx,3);
  ws.feed({t:'wrong',id:'me',score:120,until:Date.now()+30,eliminations:[0,2,3],roundWrong:1,penalty:30});
  assert(!els.freezeBox.hidden);
  assert(els.questionCard.classList.contains('shake'));
  await sleep(170);
  assert(els.freezeBox.hidden);
  assert(!els.questionOptions.children[1].disabled);
  ws.feed({t:'correct',id:'me',score:260,points:140,correctCount:1});
  assert(els.questionCard.classList.contains('solved'));
  ws.feed({t:'roundEnd',phase:'review',round:1,questionIdx:0,correctIdx:1,correctCount:1,leaderboard:roster.slice(1),winners:[{id:'me',name:'Tester',delta:260}]});
  assert(!els.reviewOverlay.hidden);
  assert(els.reviewQuestion.children[1].children[1].classList.contains('is-answer'), 'server reveals the correct answer only at review');
  assert(els.btnNextReview.hidden);
  // Host promotion during review must reveal controls.
  ws.feed({t:'room',phase:'review',hostId:'me',minPlayers:1,round:1,correctCount:1,players:roster.slice(1)});
  assert(!els.btnNextReview.hidden);
  drawnLabels.length=0;
  ws.feed({...round, round:2, questionIdx:1}); pump(3);
  assert(drawnLabels.includes('HiddenOpponent'),'host still sees participants');
  assert(els.treasureCompass.hidden,'host has full map, no personal compass');
  ws.feed({t:'roundEnd',phase:'classroom',round:2,questionIdx:1,correctCount:0,leaderboard:[]});
  assert(!els.classroomOverlay.hidden);
  assert(els.btnNextClass.hidden);
  els.classroomOptions.children[0].fire('click');
  assert.equal(ws.last('host').action,'reveal');
  ws.feed({t:'reveal',picked:0,correctIdx:1});
  assert(!els.btnNextClass.hidden);
  ws.feed({t:'gameover',leaderboard:[{id:'p',name:'Player',score:100,totalCorrect:1}]});
  assert(!els.gameoverOverlay.hidden);
  assert(!els.btnAgain.hidden);
  console.log('client OK: lobby, free movement, stop-on-release, wall collision, joystick, personal hints, freeze, solved, review, promotion, classroom, final');
}
main().then(()=>process.exit(0),err=>{console.error(err);process.exit(1)});
