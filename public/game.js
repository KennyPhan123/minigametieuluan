'use strict';

/* ---------------------------------------------------------------
 * Me cung Hasaki - client v2
 * - Chu phong: map toan canh + bang xep hang + feed su kien
 * - Nguoi choi: zoom gan, di chuyen tu do bang joystick / ban phim
 * - Vong 60s: ruong o giua, cham de mo cau hoi, dong bang 7s khi sai
 * --------------------------------------------------------------- */

(function () {
  const $ = (id) => document.getElementById(id);

  const SPEED = 5.5; // tiles per second, continuous analog movement
  const TOUCH_R = 0.9;
  const PLAYER_R = 0.28;
  const JOY_RADIUS = 52;
  const VIEW_RADIUS = 4.5;

  /* ------------------------------ DOM ------------------------------ */

  const startScreen = $('startScreen');
  const startForm = $('startForm');
  const startBtn = $('startBtn');
  const nameInput = $('nameInput');
  const startError = $('startError');
  const lobbyScreen = $('lobbyScreen');
  const lobbyTitle = $('lobbyTitle');
  const roleBadge = $('roleBadge');
  const lobbyCount = $('lobbyCount');
  const lobbyMinLabel = $('lobbyMinLabel');
  const minControls = $('minControls');
  const minDown = $('minDown');
  const minUp = $('minUp');
  const minValue = $('minValue');
  const lobbyPlayers = $('lobbyPlayers');
  const startBtnLobby = $('startBtnLobby');
  const lobbyHint = $('lobbyHint');
  const gameEl = $('game');
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const touchLayer = $('touchLayer');
  const hudRound = $('hudRound');
  const hudTimer = $('hudTimer');
  const leaderTitle = $('leaderTitle');
  const leaderboardEl = $('leaderboard');
  const hostFeed = $('hostFeed');
  const feedList = $('feedList');
  const playerStatus = $('playerStatus');
  const myScoreEl = $('myScore');
  const myStateEl = $('myState');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');
  const toastEl = $('toast');
  const netBanner = $('netBanner');
  const questionOverlay = $('questionOverlay');
  const questionCard = $('questionCard');
  const questionTag = $('questionTag');
  const questionSub = $('questionSub');
  const questionText = $('questionText');
  const questionOptions = $('questionOptions');
  const questionFeedback = $('questionFeedback');
  const freezeBox = $('freezeBox');
  const freezeNum = $('freezeNum');
  const reviewOverlay = $('reviewOverlay');
  const reviewKicker = $('reviewKicker');
  const reviewWinners = $('reviewWinners');
  const reviewQuestion = $('reviewQuestion');
  const reviewBoard = $('reviewBoard');
  const btnNextReview = $('btnNextReview');
  const waitNextReview = $('waitNextReview');
  const classroomOverlay = $('classroomOverlay');
  const classroomCard = $('classroomCard');
  const classroomKicker = $('classroomKicker');
  const classroomQ = $('classroomQ');
  const classroomOptions = $('classroomOptions');
  const classroomResult = $('classroomResult');
  const btnNextClass = $('btnNextClass');
  const waitOverlay = $('waitOverlay');
  const waitTitle = $('waitTitle');
  const waitSub = $('waitSub');
  const gameoverOverlay = $('gameoverOverlay');
  const finalBoard = $('finalBoard');
  const btnAgain = $('btnAgain');
  const waitAgain = $('waitAgain');

  const ALL_OVERLAYS = [questionOverlay, reviewOverlay, classroomOverlay, waitOverlay, gameoverOverlay];

  /* ----------------------------- state ----------------------------- */

  const S = {
    ws: null,
    myId: null,
    name: '',
    role: 'player',
    phase: 'lobby', // lobby | round | review | classroom | gameover
    hostId: null,
    minPlayers: 2,
    players: new Map(), // id -> roster entry (+ tx/ty for interp)
    round: 0,
    totalRounds: 10,
    maxCorrect: 5,
    roundMs: 60000,
    freezeMs: 7000,
    grid: null,
    W: 0,
    H: 0,
    treasure: null,
    treasureFound: false,
    questionIdx: 0,
    eliminations: new Set(),
    correctCount: 0,
    endsAt: 0,
    roundEndInfo: null,
    revealed: null,
    timeOffset: 0,
    touchSent: false,
    modalOpen: false,
    modalSolved: false,
    freezeUntil: 0,
    freezeTimer: null,
    feed: [],
    reconnectTimer: null,
    dpr: 1,
    viewW: 0,
    viewH: 0,
    tilePx: 40,
    cam: { x: 1.5, y: 1.5 },
    labelFont: '600 11px sans-serif',
  };

  // vi tri rieng cua minh tren client (server chi luu ban copy)
  const me = { x: 1.5, y: 1.5, fx: 1, fy: 0 };

  const keys = new Set();
  const joystick = { id: null, sx: 0, sy: 0, x: 0, y: 0 };
  const joyBase = $('joyBase');
  const joyKnob = $('joyKnob');

  function myEntry() {
    return S.players.get(S.myId) || null;
  }

  /* ---------------------------- helpers ---------------------------- */

  function send(obj) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
  }

  function nowServer() {
    return Date.now() + S.timeOffset;
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => (toastEl.hidden = true), 240);
    }, 1900);
  }

  function hideOverlaysExcept(keep) {
    for (const o of ALL_OVERLAYS) if (o !== keep) o.hidden = true;
  }

  /* ----------------------------- websocket -------------------------- */

  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
  }

  function openWS() {
    if (S.ws) {
      S.ws.onclose = S.ws.onerror = S.ws.onmessage = S.ws.onopen = null;
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
    ws.onopen = () => send({ t: 'join', name: S.name });
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
    if (lobbyScreen.hidden && gameEl.hidden) {
      // con o man hinh bat dau
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

  /* -------- role: phu thuoc vao hostId hien tai (co the doi khi len host) -------- */
  function syncRole() {
    S.role = S.myId && S.hostId === S.myId ? 'host' : 'player';
    hostFeed.hidden = S.role !== 'host';
    playerStatus.hidden = S.role === 'host';
    leaderTitle.textContent = S.role === 'host' ? 'AI DẪN ĐẦU' : 'ĐIỂM';
  }

  function playerCountView() {
    // so nguoi choi (khong tinh chu phong)
    return Math.max(0, S.players.size - (S.hostId ? 1 : 0));
  }

  /* --------------------------- message router ----------------------- */

  function handleMessage(msg) {
    if (msg.serverNow) S.timeOffset = msg.serverNow - Date.now();
    switch (msg.t) {
      case 'init':
        handleInit(msg);
        break;
      case 'room':
        handleRoom(msg);
        break;
      case 'round':
        handleRound(msg);
        break;
      case 'state': {
        if (msg.id === S.myId) break;
        const p = S.players.get(msg.id);
        if (p) {
          p.tx = msg.x;
          p.ty = msg.y;
          p.fx = msg.fx;
          p.fy = msg.fy;
        }
        break;
      }
      case 'touchEvent':
        handleTouchEvent(msg);
        break;
      case 'touchAck':
        handleTouchAck(msg);
        break;
      case 'wrong':
        handleWrong(msg);
        break;
      case 'correct':
        handleCorrect(msg);
        break;
      case 'answerAck':
        handleAnswerAck(msg);
        break;
      case 'roundEnd':
        handleRoundEnd(msg);
        break;
      case 'reveal':
        renderReveal(msg.picked, msg.correctIdx);
        break;
      case 'gameover':
        handleGameover(msg);
        break;
      default:
        break;
    }
  }

  function syncRoster(list) {
    const seen = new Set();
    for (const e of list || []) {
      seen.add(e.id);
      const old = S.players.get(e.id);
      if (old) {
        Object.assign(old, e);
        if (e.id !== S.myId) {
          old.tx = e.x;
          old.ty = e.y;
        }
      } else {
        S.players.set(e.id, { ...e, tx: e.x, ty: e.y });
      }
    }
    for (const id of Array.from(S.players.keys())) if (!seen.has(id)) S.players.delete(id);
  }

  function handleInit(msg) {
    S.myId = msg.id;
    S.role = msg.role;
    S.hostId = msg.hostId;
    S.minPlayers = msg.minPlayers;
    S.phase = msg.phase;
    S.round = msg.round;
    S.roundMs = msg.roundMs || S.roundMs;
    S.freezeMs = msg.freezeMs || S.freezeMs;
    S.totalRounds = msg.totalRounds || S.totalRounds;
    S.maxCorrect = msg.maxCorrect || S.maxCorrect;
    S.correctCount = msg.correctCount;
    S.revealed = msg.revealed;
    S.correctIdx = msg.correctIdx;
    S.roundEndInfo = msg.roundEndInfo;
    S.timeOffset = msg.serverNow - Date.now();
    S.hostId = msg.hostId;
    syncRole();
    syncRoster(msg.players);
    S.treasureFound = (msg.players || []).some((e) => e.touched);

    startScreen.hidden = true;
    S.grid = msg.maze ? parseMaze(msg.maze) : null;
    if (msg.treasure) S.treasure = msg.treasure;
    if (Number.isInteger(msg.questionIdx)) S.questionIdx = msg.questionIdx;
    S.eliminations = new Set(msg.eliminations || []);
    S.endsAt = msg.endsAt || 0;

    netBanner.hidden = true;
    if (S.phase === 'lobby') {
      enterLobby();
      return;
    }

    // vao giua van
    gameEl.hidden = false;
    lobbyScreen.hidden = true;
    if (msg.spawn && msg.spawn.x) {
      setMeAt(msg.spawn.x, msg.spawn.y);
    }
    const mine = msg.me || {};
    const p = myEntry();
    if (p) {
      p.touched = !!mine.touched;
      p.roundCorrect = !!mine.roundCorrect;
      p.frozenUntil = mine.frozenUntil || 0;
    }
    S.touchSent = !!mine.touched;
    resize();
    buildRoundHUD();

    if (S.phase === 'round') {
      if (mine.roundCorrect) {
        renderSolvedModal();
      } else if (mine.touched) {
        openModal();
        if (mine.frozenUntil > nowServer()) startFreeze(mine.frozenUntil);
      }
    } else if (S.phase === 'review' && S.roundEndInfo) {
      renderReview(S.roundEndInfo);
    } else if (S.phase === 'classroom') {
      if (S.role === 'host') {
        renderClassroom();
        if (S.revealed !== null && S.revealed !== undefined) renderReveal(S.revealed, S.correctIdx);
        else btnNextClass.hidden = true;
      } else {
        renderWait('VÒNG KẾT THÚC', 'Chủ phòng đang trình bày câu hỏi cho cả lớp…');
      }
    } else if (S.phase === 'gameover') {
      renderGameover(null);
    }
    netBanner.hidden = true;
  }

  function handleRoom(msg) {
    if (msg.serverNow) S.timeOffset = msg.serverNow - Date.now();
    const oldRole = S.role;
    S.hostId = msg.hostId;
    S.minPlayers = msg.minPlayers;
    S.phase = msg.phase;
    S.round = msg.round;
    S.correctCount = msg.correctCount;
    S.revealed = msg.revealed;
    S.correctIdx = msg.correctIdx;
    S.endsAt = msg.endsAt || S.endsAt;
    if (msg.roundEndInfo) S.roundEndInfo = msg.roundEndInfo;
    syncRole();
    syncRoster(msg.players);
    if (S.phase === 'lobby') { enterLobby(); return; }
    updateRoleUI();
    updateLeaderboard();
    updateStatusChip();
    if (oldRole !== S.role) {
      closeModal(true);
      if (S.phase === 'review') renderReview(S.roundEndInfo);
      if (S.phase === 'classroom') {
        renderClassroom();
        if (S.revealed !== null) renderReveal(S.revealed, S.correctIdx);
      }
      if (S.phase === 'gameover') renderGameover(null);
    }
  }

  function handleRound(msg) {
    S.phase = 'round';
    S.round = msg.round;
    S.questionIdx = msg.questionIdx;
    S.grid = parseMaze(msg.maze);
    S.W = S.grid[0].length;
    S.H = S.grid.length;
    S.treasure = msg.treasure;
    S.treasureFound = false;
    S.endsAt = msg.endsAt;
    S.timeOffset = msg.serverNow - Date.now();
    S.eliminations = new Set(msg.eliminations || []);
    S.correctCount = msg.correctCount || 0;
    S.revealed = null;
    S.roundEndInfo = null;
    S.touchSent = false;
    syncRoster(msg.players);
    setMeAt(msg.spawn.x, msg.spawn.y);
    const p = myEntry();
    if (p) {
      p.touched = false;
      p.roundCorrect = false;
      p.frozenUntil = 0;
    }
    stopFreeze();
    closeModal(true);
    hideOverlaysExcept(null);
    S.feed = [];
    if (S.role === 'host') addFeed('VÒNG ' + S.round + ' BẮT ĐẦU');
    gameEl.hidden = false;
    lobbyScreen.hidden = true;
    resize();
    buildRoundHUD();
    S.cam.x = me.x;
    S.cam.y = me.y;
    toast('VÒNG ' + S.round + ' — giữ joystick hoặc phím để di chuyển');
  }

  function handleTouchEvent(msg) {
    S.touchSent = S.touchSent || msg.id === S.myId;
    const visitor = S.players.get(msg.id);
    if (visitor) visitor.touched = true;
    if (msg.first) {
      S.treasureFound = true;
      const p = S.players.get(msg.id);
      if (p) p.score = msg.score;
      addFeed((nameOf(msg.id) || 'Ai đó') + ' TÌM THẤY RƯƠNG');
      if (msg.id !== S.myId) toast(nameOf(msg.id) + ' đã tìm thấy rương');
      updateLeaderboard();
      if (S.modalOpen) renderOptions();
    } else if (msg.id !== S.myId) {
      addFeed(nameOf(msg.id) + ' ĐẾN RƯƠNG');
    }
  }

  function handleTouchAck(msg) {
    if (!msg.ok) {
      S.touchSent = false;
      return;
    }
    S.touchSent = true;
    S.eliminations = new Set(msg.eliminations || []);
    if (msg.first) {
      S.treasureFound = true;
      const p = myEntry();
      if (p) p.score = msg.score;
      updateLeaderboard();
      updateStatusChip();
    }
    const p = myEntry();
    if (p) p.touched = true;

    if (p && p.roundCorrect) {
      toast('Bạn đã trả lời đúng rồi — chờ hết vòng');
      return;
    }
    if (S.phase !== 'round') return;
    openModal();
    if (msg.first && S.role !== 'host') {
      questionFeedback.hidden = false;
      questionFeedback.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'BẠN LÀ NGƯỜI ĐẦU TIÊN';
      const body = document.createElement('span');
      body.textContent = 'Hệ thống đã tự động loại 2 đáp án sai cho bạn.';
      questionFeedback.appendChild(strong);
      questionFeedback.appendChild(body);
    }
    if (p && p.frozenUntil > nowServer()) startFreeze(p.frozenUntil);
  }

  function handleWrong(msg) {
    const p = S.players.get(msg.id);
    if (p) {
      p.score = msg.score;
      p.roundWrong = msg.roundWrong;
      p.frozenUntil = msg.until;
    }
    if (msg.id === S.myId) {
      if (msg.eliminations) S.eliminations = new Set(msg.eliminations);
      else S.eliminations.add(msg.option);
    }
    addFeed(nameOf(msg.id) + ' TRẢ LỜI SAI — ĐÓNG BĂNG 7s');
    if (msg.id === S.myId) {
      questionFeedback.hidden = false;
      questionFeedback.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'SAI — ĐIỂM ' + msg.score;
      const body = document.createElement('span');
      body.textContent = 'Đáp án này không đúng. Bạn bị đóng băng 7 giây.';
      questionFeedback.appendChild(strong);
      questionFeedback.appendChild(body);
      questionCard.classList.remove('shake');
      void questionCard.offsetWidth;
      questionCard.classList.add('shake');
      renderOptions();
      startFreeze(msg.until);
      toast('SAI — bị đóng băng 7 giây (' + msg.penalty + ' điểm)');
    } else {
      toast(nameOf(msg.id) + ' trả lời sai');
    }
    updateLeaderboard();
    updateStatusChip();
  }

  function handleCorrect(msg) {
    const p = S.players.get(msg.id);
    if (p) {
      p.score = msg.score;
      p.roundCorrect = true;
    }
    S.correctCount = msg.correctCount;
    addFeed(nameOf(msg.id) + ' TRẢ LỜI ĐÚNG +' + msg.points);
    if (msg.id === S.myId) {
      stopFreeze();
      S.modalOpen = true;
      S.modalSolved = true;
      renderSolvedModal(msg.points);
      toast('CHÍNH XÁC — +' + msg.points + ' điểm');
    } else {
      toast(nameOf(msg.id) + ' trả lời đúng');
    }
    updateLeaderboard();
    updateStatusChip();
  }

  function handleAnswerAck(msg) {
    if (msg.eliminations) { S.eliminations = new Set(msg.eliminations); if (!S.modalSolved) renderOptions(); }
    if (!msg.ok && S.modalOpen && !S.modalSolved) renderOptions();
    if (msg.ok) return; // xu ly qua broadcast wrong/correct
    const map = {
      frozen: 'Bạn đang bị đóng băng',
      eliminated: 'Đáp án này đã bị loại',
      done: 'Bạn đã trả lời đúng rồi',
      notouch: 'Hãy tới rương trước',
      round: 'Vòng đã kết thúc',
      badidx: 'Đáp án không hợp lệ',
    };
    toast(map[msg.reason] || 'Không hợp lệ');
  }

  function handleRoundEnd(msg) {
    resetInput();
    S.phase = msg.phase;
    S.roundEndInfo = msg;
    S.correctCount = msg.correctCount;
    stopFreeze();
    closeModal(true);
    if (msg.phase === 'review') {
      renderReview(msg);
    } else {
      // classroom
      if (S.role === 'host') {
        S.revealed = null;
        renderClassroom();
      } else {
        renderWait('VÒNG ' + msg.round + ' KẾT THÚC', 'Chưa có ai trả lời đúng. Chủ phòng đang trình bày câu hỏi cho cả lớp…');
      }
    }
  }

  function renderReveal(picked, correctIdx) {
    S.revealed = picked;
    S.correctIdx = correctIdx;
    if (S.role !== 'host' || S.phase !== 'classroom') return;
    const q = QUESTIONS[S.questionIdx];
    Array.from(classroomOptions.children).forEach((btn, i) => {
      btn.disabled = true;
      if (i === correctIdx) btn.classList.add('correct');
      if (i === picked && picked !== correctIdx) {
        btn.classList.add('wrong');
        btn.style.textDecoration = 'line-through';
      }
      if (i === picked && picked === correctIdx) btn.classList.add('picked');
    });
    classroomResult.hidden = false;
    const letter = ['A', 'B', 'C', 'D'][correctIdx];
    classroomResult.textContent =
      picked === correctIdx
        ? 'CHỌN ' + letter + ' — ĐÚNG! Đáp án: ' + letter + '. ' + q.options[correctIdx]
        : 'CHỌN ' + ['A', 'B', 'C', 'D'][picked] + ' — SAI. Đáp án đúng: ' + letter + '. ' + q.options[correctIdx];
    btnNextClass.hidden = false;
    classroomKicker.textContent = 'ĐÃ HIỂN THỊ ĐÁP ÁN';
  }

  function handleGameover(msg) {
    S.phase = 'gameover';
    renderGameover(msg.leaderboard);
  }

  /* ------------------------------ lobby ----------------------------- */

  function nameOf(id) {
    const p = S.players.get(id);
    return p ? p.name : '';
  }

  function updateRoleUI() {
    syncRole();
    const isHost = S.role === 'host';
    roleBadge.textContent = isHost ? 'BẠN LÀ CHỦ PHÒNG' : 'NGƯỜI CHƠI';
    roleBadge.classList.toggle('plain', !isHost);
    lobbyTitle.textContent = isHost ? 'PHÒNG CHỜ' : 'CHỜ BẮT ĐẦU';
    minControls.hidden = !isHost;
    startBtnLobby.hidden = !isHost;
    lobbyHint.hidden = isHost;
    lobbyMinLabel.textContent = '/ ' + S.minPlayers + ' NGƯỜI';
    minValue.textContent = String(S.minPlayers);
    lobbyCount.textContent = String(playerCountView());
    const ready = playerCountView() >= S.minPlayers;
    startBtnLobby.disabled = !ready;
    lobbyHint.textContent = 'Cần ít nhất ' + S.minPlayers + ' người để bắt đầu';
    leaderTitle.textContent = isHost ? 'AI DẪN ĐẦU' : 'ĐIỂM';
    document.querySelector('.minimap-wrap').hidden = true;
    gameEl.classList.toggle('host-mode', isHost);
    hostFeed.hidden = !isHost;
    playerStatus.hidden = isHost;
  }

  function enterLobby() {
    hideOverlaysExcept(null);
    gameEl.hidden = true;
    lobbyScreen.hidden = false;
    updateRoleUI();
    renderLobbyList();
  }

  function renderLobbyList() {
    lobbyPlayers.innerHTML = '';
    let i = 1;
    for (const p of S.players.values()) {
      const li = document.createElement('li');
      if (p.id === S.myId) li.className = 'me';
      const name = document.createElement('span');
      name.textContent = p.name;
      li.appendChild(name);
      if (p.id === S.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'CHỦ PHÒNG';
        li.appendChild(tag);
      }
      lobbyPlayers.appendChild(li);
      i++;
    }
    lobbyCount.textContent = String(playerCountView());
    if (S.role === 'host') startBtnLobby.disabled = playerCountView() < S.minPlayers;
    else lobbyHint.textContent = 'Cần ít nhất ' + S.minPlayers + ' người để bắt đầu';
  }

  startBtnLobby.addEventListener('click', () => send({ t: 'host', action: 'start' }));
  minUp.addEventListener('click', () => {
    S.minPlayers = Math.min(100, S.minPlayers + 1);
    send({ t: 'host', action: 'min', value: S.minPlayers });
    updateRoleUI();
  });
  minDown.addEventListener('click', () => {
    S.minPlayers = Math.max(1, S.minPlayers - 1);
    send({ t: 'host', action: 'min', value: S.minPlayers });
    updateRoleUI();
  });

  /* -------------------------- round HUD / UI ------------------------ */

  function buildRoundHUD() {
    hudRound.textContent = 'VÒNG ' + S.round + ' / ' + S.totalRounds;
    updateLeaderboard();
    updateStatusChip();
  }

  function updateLeaderboard() {
    const list = Array.from(S.players.values()).filter(p => p.id !== S.hostId).sort(
      (a, b) => b.score - a.score || b.totalCorrect - a.totalCorrect || a.name.localeCompare(b.name)
    );
    renderBoard(leaderboardEl, list, { compact: true, max: 6, badges: true });
  }

  function renderBoard(el, list, opts) {
    el.innerHTML = '';
    const max = (opts && opts.max) || list.length;
    list.slice(0, max).forEach((e, i) => {
      const li = document.createElement('li');
      if (e.id === S.myId) li.className = 'me';
      else if (i === 0) li.className = 'top1';
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = e.name;
      li.appendChild(rank);
      li.appendChild(name);
      if (opts && opts.badges && S.phase === 'round') {
        if (e.roundCorrect) {
          const b = document.createElement('span');
          b.className = 'lb-badge';
          b.textContent = 'ĐÚNG';
          li.appendChild(b);
        } else if (e.frozenUntil > nowServer()) {
          const b = document.createElement('span');
          b.className = 'lb-badge';
          b.textContent = 'ĐÓNG BĂNG';
          li.appendChild(b);
        }
      }
      if (opts && opts.delta && typeof e.delta === 'number') {
        const d = document.createElement('span');
        d.className = 'lb-delta';
        d.textContent = (e.delta >= 0 ? '+' : '') + e.delta;
        li.appendChild(d);
      }
      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = String(e.score);
      li.appendChild(score);
      el.appendChild(li);
    });
  }

  function updateStatusChip() {
    const p = myEntry();
    if (!p) return;
    myScoreEl.textContent = String(p.score);
    myStateEl.classList.remove('freeze');
    const remain = p.frozenUntil - nowServer();
    if (S.phase !== 'round') {
      myStateEl.textContent = 'ĐỢI VÒNG TIẾP THEO';
    } else if (!p.spawned) {
      myStateEl.textContent = 'CHỜ VÒNG TIẾP THEO';
    } else if (p.roundCorrect) {
      myStateEl.textContent = 'ĐÃ TRẢ LỜI ĐÚNG — CHỜ HẾT VÒNG';
    } else if (remain > 0) {
      myStateEl.textContent = 'ĐÓNG BĂNG ' + Math.ceil(remain / 1000) + 's';
      myStateEl.classList.add('freeze');
    } else if (p.touched) {
      myStateEl.textContent = 'ĐANG TRẢ LỜI CÂU HỎI';
    } else {
      myStateEl.textContent = 'ĐANG TÌM RƯƠNG';
    }
  }

  function addFeed(text) {
    S.feed.unshift(text);
    if (S.feed.length > 6) S.feed.pop();
    renderFeed();
  }

  function renderFeed() {
    feedList.innerHTML = '';
    for (const line of S.feed) {
      const li = document.createElement('li');
      li.textContent = line;
      feedList.appendChild(li);
    }
  }

  /* ----------------------------- overlays --------------------------- */

  function closeModal(force) {
    S.modalOpen = false;
    if (force || S.modalSolved) {
      questionOverlay.hidden = true;
      S.modalSolved = false;
      questionCard.classList.remove('solved');
    }
  }

  function openModal() {
    resetInput();
    if (S.modalSolved) return;
    S.modalOpen = true;
    questionCard.classList.remove('solved');
    questionTag.textContent = 'CÂU ' + (S.questionIdx + 1) + ' / ' + S.totalRounds;
    questionSub.textContent = 'CHỌN 1 ĐÁP ÁN';
    const q = QUESTIONS[S.questionIdx];
    questionText.textContent = q.text;
    questionFeedback.hidden = true;
    questionFeedback.innerHTML = '';
    freezeBox.hidden = true;
    renderOptions();
    questionOverlay.hidden = false;
  }

  function renderOptions() {
    const q = QUESTIONS[S.questionIdx];
    questionOptions.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    const frozen = myEntry() && myEntry().frozenUntil > nowServer();
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-opt';
      const eliminated = S.eliminations.has(idx);
      if (eliminated) btn.classList.add('eliminated');
      const badge = document.createElement('span');
      badge.className = 'q-letter';
      badge.textContent = letters[idx];
      const text = document.createElement('span');
      text.textContent = opt;
      btn.appendChild(badge);
      btn.appendChild(text);
      if (eliminated || frozen) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        send({ t: 'answer', idx });
        Array.from(questionOptions.children).forEach((el) => (el.disabled = true));
        questionSub.textContent = 'ĐANG CHỜ…';
      });
      questionOptions.appendChild(btn);
    });
    questionSub.textContent = frozen ? 'ĐANG ĐÓNG BĂNG' : 'CHỌN 1 ĐÁP ÁN';
  }

  function startFreeze(until) {
    S.freezeUntil = until;
    freezeBox.hidden = false;
    updateStatusChip();
    if (S.freezeTimer) return;
    const tick = () => {
      const remain = S.freezeUntil - nowServer();
      if (remain <= 0 || S.phase !== 'round') {
        stopFreeze();
        if (S.modalOpen && !S.modalSolved) {
          freezeBox.hidden = true;
          renderOptions();
        }
        updateStatusChip();
        return;
      }
      freezeNum.textContent = String(Math.ceil(remain / 1000));
      updateStatusChip();
      S.freezeTimer = setTimeout(tick, 150);
    };
    tick();
  }

  function stopFreeze() {
    clearTimeout(S.freezeTimer);
    S.freezeTimer = null;
    S.freezeUntil = 0;
    freezeBox.hidden = true;
  }

  function renderSolvedModal(points) {
    S.modalOpen = true;
    S.modalSolved = true;
    questionCard.classList.add('solved');
    questionCard.classList.remove('shake');
    questionTag.textContent = 'CÂU ' + (S.questionIdx + 1) + ' / ' + S.totalRounds;
    questionSub.textContent = '';
    questionText.textContent = '';
    questionFeedback.hidden = true;
    freezeBox.hidden = true;
    questionOptions.innerHTML = '';
    const p = myEntry();
    const box = document.createElement('div');
    box.className = 'solved-box';
    const t = document.createElement('div');
    t.className = 'solved-title';
    t.textContent = 'CHÍNH XÁC';
    box.appendChild(t);
    if (points !== undefined) {
      const pts = document.createElement('div');
      pts.className = 'solved-points';
      pts.textContent = '+' + points + ' ĐIỂM';
      box.appendChild(pts);
    }
    const sub = document.createElement('div');
    sub.className = 'solved-sub';
    sub.textContent = 'Vòng kết thúc khi ' + S.maxCorrect + ' người trả lời đúng hoặc hết 60 giây. Bạn đã xong — chờ tới hết vòng.';
    box.appendChild(sub);
    const btn = document.createElement('button');
    btn.className = 'btn btn-solid';
    btn.type = 'button';
    btn.textContent = 'XEM MAP';
    btn.addEventListener('click', () => closeModal(true));
    box.appendChild(btn);
    questionOptions.appendChild(box);
    questionOverlay.hidden = false;
  }

  function optionRow(q, idx, opts) {
    const row = document.createElement('div');
    row.className = 'review-opt';
    if (opts && opts.isAnswer) row.classList.add('is-answer');
    if (opts && opts.isElim) row.classList.add('is-elim');
    const letter = document.createElement('span');
    letter.className = 'q-letter';
    letter.textContent = ['A', 'B', 'C', 'D'][idx];
    const text = document.createElement('span');
    text.textContent = q.options[idx];
    row.appendChild(letter);
    row.appendChild(text);
    return row;
  }

  function renderReview(info) {
    const isHost = S.role === 'host';
    reviewKicker.textContent = 'KẾT QUẢ VÒNG ' + info.round;
    // nguoi dung vong
    reviewWinners.innerHTML = '';
    for (const w of info.winners || []) {
      const chip = document.createElement('span');
      chip.className = 'winner-chip';
      chip.textContent = w.name + ' TRẢ LỜI ĐÚNG';
      const b = document.createElement('b');
      b.textContent = (w.delta >= 0 ? '+' : '') + w.delta;
      chip.appendChild(b);
      reviewWinners.appendChild(chip);
    }
    if (!(info.winners || []).length) {
      const chip = document.createElement('span');
      chip.className = 'winner-chip';
      chip.textContent = 'CHƯA AI TRẢ LỜI ĐÚNG';
      reviewWinners.appendChild(chip);
    }
    // cau hoi + dap an dung
    const q = { ...QUESTIONS[info.questionIdx], answer: info.correctIdx }; 
    reviewQuestion.innerHTML = '';
    const qt = document.createElement('div');
    qt.className = 'review-q-text';
    qt.textContent = q.text;
    reviewQuestion.appendChild(qt);
    const opts = document.createElement('div');
    opts.className = 'review-opts';
    for (let i = 0; i < q.options.length; i++) {
      opts.appendChild(optionRow(q, i, { isAnswer: i === q.answer, isElim: S.eliminations.has(i) && i !== q.answer }));
    }
    reviewQuestion.appendChild(opts);
    if (info.note) { const note = document.createElement('p'); note.textContent = info.note; reviewQuestion.appendChild(note); }
    // bang xep hang tai thoi diem ket thuc
    renderBoard(reviewBoard, info.leaderboard || [], { delta: true, badges: false });
    btnNextReview.hidden = !isHost;
    waitNextReview.hidden = isHost;
    hideOverlaysExcept(reviewOverlay);
    reviewOverlay.hidden = false;
  }

  function renderClassroom() {
    const q = QUESTIONS[S.questionIdx];
    classroomKicker.textContent = 'HẾT GIỜ — CHƯA AI TRẢ LỜI ĐÚNG';
    classroomQ.textContent = q.text;
    classroomOptions.innerHTML = '';
    classroomResult.hidden = true;
    btnNextClass.hidden = true;
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
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        send({ t: 'host', action: 'reveal', value: idx });
        Array.from(classroomOptions.children).forEach((el) => (el.disabled = true));
      });
      classroomOptions.appendChild(btn);
    });
    hideOverlaysExcept(classroomOverlay);
    classroomOverlay.hidden = false;
  }

  function renderWait(title, sub) {
    waitTitle.textContent = title;
    waitSub.textContent = sub;
    hideOverlaysExcept(waitOverlay);
    waitOverlay.hidden = false;
  }

  function renderGameover(board) {
    if (!board && S.roundEndInfo) board = null;
    const list = (board || []).map((e) => ({ ...e }));
    if (!list.length) {
      for (const p of S.players.values()) {
        if (p.id === S.hostId) continue;
        list.push({
          id: p.id,
          name: p.name,
          score: p.score,
          totalCorrect: p.totalCorrect,
          totalWrong: p.totalWrong,
          bonus: p.totalCorrect >= S.totalRounds ? 200 : 0,
        });
      }
      list.sort((a, b) => b.score - a.score);
    }
    finalBoard.innerHTML = '';
    list.forEach((e, i) => {
      const li = document.createElement('li');
      if (e.id === S.myId) li.className = 'me';
      else if (i === 0) li.className = 'top1';
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = e.name + (e.bonus ? ' (+200)' : '');
      const detail = document.createElement('span');
      detail.className = 'lb-delta';
      detail.textContent = (e.totalCorrect || 0) + '/' + S.totalRounds + ' câu';
      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = String(e.score);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(detail);
      li.appendChild(score);
      finalBoard.appendChild(li);
    });
    const isHost = S.role === 'host';
    btnAgain.hidden = !isHost;
    waitAgain.hidden = isHost;
    hideOverlaysExcept(gameoverOverlay);
    gameoverOverlay.hidden = false;
  }

  btnNextReview.addEventListener('click', () => send({ t: 'host', action: 'next' }));
  btnNextClass.addEventListener('click', () => send({ t: 'host', action: 'next' }));
  btnAgain.addEventListener('click', () => send({ t: 'host', action: 'again' }));

  /* ------------------------------ input ----------------------------- */

  function canMove() {
    if (S.phase !== 'round' || S.role === 'host' || S.modalOpen || S.touchSent) return false;
    const p = myEntry();
    if (!p || !p.spawned || p.roundCorrect || p.frozenUntil > nowServer()) return false;
    return true;
  }

  function tileOpen(x, y) {
    return !!S.grid && S.grid[y]?.[x] === '.';
  }

  function resetInput() {
    keys.clear();
    joystick.id = null;
    joystick.x = joystick.y = 0;
    joyBase.hidden = true;
    joyKnob.style.transform = 'translate(0px, 0px)';
  }

  function setMeAt(x, y) {
    me.x = x; me.y = y;
    S.cam.x = x; S.cam.y = y;
    resetInput();
  }

  function fits(x, y) {
    for (let gy = Math.floor(y - PLAYER_R); gy <= Math.floor(y + PLAYER_R); gy++) {
      for (let gx = Math.floor(x - PLAYER_R); gx <= Math.floor(x + PLAYER_R); gx++) {
        if (tileOpen(gx, gy)) continue;
        const nx = Math.max(gx, Math.min(x, gx + 1));
        const ny = Math.max(gy, Math.min(y, gy + 1));
        if ((x - nx) ** 2 + (y - ny) ** 2 < PLAYER_R ** 2) return false;
      }
    }
    return true;
  }

  function moveFreely(dt) {
    let dx = joystick.x, dy = joystick.y;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    me.fx = dx / length; me.fy = dy / length;
    if (length > 1) { dx /= length; dy /= length; }
    // Small substeps prevent tunnelling; resolve axes separately to slide along walls.
    const steps = Math.max(1, Math.ceil(SPEED * dt / 0.08));
    for (let i = 0; i < steps; i++) {
      const nx = me.x + dx * SPEED * dt / steps;
      if (fits(nx, me.y)) me.x = nx;
      const ny = me.y + dy * SPEED * dt / steps;
      if (fits(me.x, ny)) me.y = ny;
    }
  }

  const movementKeys = ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'];
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (!movementKeys.includes(k) || gameEl.hidden) return;
    e.preventDefault();
    if (canMove()) keys.add(k);
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });

  touchLayer.addEventListener('pointerdown', e => {
    if (!canMove() || joystick.id !== null || (e.button !== undefined && e.button !== 0)) return;
    joystick.id = e.pointerId;
    joystick.sx = e.clientX; joystick.sy = e.clientY;
    joystick.x = joystick.y = 0;
    joyBase.style.left = e.clientX + 'px'; joyBase.style.top = e.clientY + 'px';
    joyKnob.style.transform = 'translate(0px, 0px)';
    joyBase.hidden = false;
    try { touchLayer.setPointerCapture(e.pointerId); } catch (_) {}
  });
  touchLayer.addEventListener('pointermove', e => {
    if (e.pointerId !== joystick.id) return;
    const dx = e.clientX - joystick.sx, dy = e.clientY - joystick.sy;
    const length = Math.hypot(dx, dy), radius = Math.min(JOY_RADIUS, length);
    const x = length ? dx / length : 0, y = length ? dy / length : 0;
    const strength = Math.max(0, (radius - 7) / (JOY_RADIUS - 7));
    joystick.x = x * strength; joystick.y = y * strength;
    joyKnob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
  });
  function releasePointer(e) { if (e.pointerId === joystick.id) resetInput(); }
  touchLayer.addEventListener('pointerup', releasePointer);
  touchLayer.addEventListener('pointercancel', releasePointer);
  touchLayer.addEventListener('lostpointercapture', releasePointer);

  /* ------------------------------ update ---------------------------- */

  let lastStateSent = 0;
  let lastSentX = -1;
  let lastSentY = -1;

  function update(dt, now) {
    if (S.phase !== 'round' || !S.grid) return;

    if (canMove()) moveFreely(dt);

    // camera keo theo + nhin toi huong di
    const lerp = 1 - Math.exp(-dt * 7);
    S.cam.x += (me.x + me.fx * 0.9 - S.cam.x) * lerp;
    S.cam.y += (me.y + me.fy * 0.9 - S.cam.y) * lerp;

    // interpolate remote
    const k = 1 - Math.exp(-dt * 11);
    for (const p of S.players.values()) {
      if (p.id === S.myId) continue;
      if (p.tx === undefined) continue;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }

    // gui vi tri
    if (S.role !== 'host' && now - lastStateSent > 66) {
      const moved = Math.abs(me.x - lastSentX) + Math.abs(me.y - lastSentY) > 0.001;
      if (moved) {
        lastSentX = me.x;
        lastSentY = me.y;
        send({ t: 'state', x: me.x, y: me.y, fx: me.fx, fy: me.fy });
      }
      lastStateSent = now;
    }

    // cham ruong -> mo cau hoi
    if (S.role !== 'host' && S.treasure && !S.touchSent) {
      const p = myEntry();
      if (p && p.spawned && !p.roundCorrect) {
        const d = Math.hypot(S.treasure.x - me.x, S.treasure.y - me.y);
        if (d < TOUCH_R) {
          S.touchSent = true;
          send({ t: 'state', x: me.x, y: me.y, fx: me.fx, fy: me.fy });
          send({ t: 'touch' });
        }
      }
    }
  }

  /* ------------------------------ render ---------------------------- */

  function parseMaze(rows) {
    S.W = rows[0].length;
    S.H = rows.length;
    return rows;
  }

  function resize() {
    S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.viewW = window.innerWidth;
    S.viewH = window.innerHeight;
    canvas.width = Math.round(S.viewW * S.dpr);
    canvas.height = Math.round(S.viewH * S.dpr);
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    const shortSide = Math.min(S.viewW, S.viewH);
    S.tilePx = Math.max(44, Math.min(90, shortSide / 7));
    S.labelFont = '600 11px ' + getComputedStyle(document.body).fontFamily;
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
    ctx.beginPath();
    ctx.ellipse(0, size * 0.5, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fill();
    if (pulse > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.62 + pulse * 0.16), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.4 - pulse * 0.22).toFixed(3) + ')';
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

  function drawPlayer(px, py, p, isMe, scale) {
    const r = 0.34 * scale;
    const frozen = p.frozenUntil > nowServer();
    const correct = !!p.roundCorrect;
    ctx.save();
    ctx.translate(px, py);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    if (isMe || correct) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.lineWidth = frozen ? 2 : 3;
    ctx.strokeStyle = isMe || correct ? '#ffffff' : '#0a0a0a';
    ctx.stroke();

    if (frozen) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0a0a0a';
      ctx.stroke();
      ctx.restore();
    }

    if (correct) {
      // dau tick trang
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, 0.02 * r);
      ctx.lineTo(-r * 0.12, r * 0.36);
      ctx.lineTo(r * 0.46, -r * 0.34);
      ctx.lineWidth = Math.max(2, r * 0.28);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      // cham huong
      const fx = p.fx || 1;
      const fy = p.fy || 0;
      const flen = Math.hypot(fx, fy) || 1;
      ctx.beginPath();
      ctx.arc((fx / flen) * r * 0.55, (fy / flen) * r * 0.55, r * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = isMe ? '#ffffff' : '#0a0a0a';
      ctx.fill();
    }

    // nhan ten + trang thai
    const label = p.name + (frozen ? '  ' + Math.ceil((p.frozenUntil - nowServer()) / 1000) + 's' : '');
    ctx.font = S.labelFont;
    const tw = ctx.measureText(label).width;
    const lw = tw + 14;
    const lh = 18;
    const lx = -lw / 2;
    const ly = -r - 8 - lh;
    roundRectPath(ctx, lx, ly, lw, lh, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = frozen ? '#0a0a0a' : 'rgba(10,10,10,0.35)';
    ctx.stroke();
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, ly + lh / 2 + 0.5);
    ctx.restore();
  }

  function viewTransform() {
    if (S.role === 'host') {
      const wide = S.viewW >= 800;
      const mapW = wide ? S.viewW - 270 : S.viewW;
      const mapH = wide ? S.viewH - 110 : S.viewH - 340;
      const scale = Math.max(3, Math.min((mapW - 24) / S.W, mapH / S.H));
      const ox = mapW / 2 - S.W * scale / 2;
      const oy = (wide ? 90 : 210) + Math.max(0,mapH - S.H * scale) / 2;
      return { scale, ox, oy, fog: false };
    }
    const s = S.tilePx;
    const ox = S.viewW / 2 - S.cam.x * s;
    const oy = S.viewH / 2 - S.cam.y * s;
    return { scale: s, ox, oy, fog: true };
  }

  function visibleFromMe(x, y) {
    const distance = Math.hypot(x - me.x, y - me.y);
    if (distance >= VIEW_RADIUS) return false;
    const steps = Math.max(1, Math.ceil(distance * 12));
    for (let i = 1; i <= steps; i++) {
      if (!tileOpen(Math.floor(me.x + (x-me.x)*i/steps), Math.floor(me.y + (y-me.y)*i/steps))) return false;
    }
    return true;
  }

  function render(now) {
    const w = S.viewW;
    const h = S.viewH;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (!S.grid) return;

    const { scale: s, ox, oy, fog } = viewTransform();
    const gx0 = Math.max(0, Math.floor(-ox / s) - 1);
    const gy0 = Math.max(0, Math.floor(-oy / s) - 1);
    const gx1 = Math.min(S.W - 1, Math.ceil((w - ox) / s) + 1);
    const gy1 = Math.min(S.H - 1, Math.ceil((h - oy) / s) + 1);

    ctx.fillStyle = '#0a0a0a';
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = S.grid[gy];
      for (let gx = gx0; gx <= gx1; gx++) {
        if (row[gx] !== '#') continue;
        ctx.fillRect(ox + gx * s, oy + gy * s, s + 0.5, s + 0.5);
      }
    }

    // Treasure stays hidden outside player sight; host always sees it.
    if (S.treasure && (!fog || visibleFromMe(S.treasure.x, S.treasure.y))) {
      const sx = ox + S.treasure.x * s;
      const sy = oy + S.treasure.y * s + Math.sin(now / 420) * s * 0.05;
      const d = S.role === 'host' ? 0 : Math.hypot(S.treasure.x - me.x, S.treasure.y - me.y);
      const pulse = d < 3 ? (Math.sin(now / 220) + 1) / 2 : 0;
      drawGem(sx, sy, s, pulse);
      if (S.treasureFound) {
        // song bao "da co nguoi tim thay"
        const wave = ((now % 1400) / 1400);
        ctx.beginPath();
        ctx.arc(sx, sy, s * (0.6 + wave * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(10,10,10,' + (0.5 * (1 - wave)).toFixed(3) + ')';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    if (fog) {
      const meSX = ox + me.x * s;
      const meSY = oy + me.y * s;
      const rClear = 2.5 * s;
      const rFull = VIEW_RADIUS * s;
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
    }

    // cac nguoi choi
    for (const p of S.players.values()) {
      if (p.id === S.myId || !p.spawned) continue;
      const sx = ox + p.x * s;
      const sy = oy + p.y * s;
      if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
      if (fog && !visibleFromMe(p.x, p.y)) continue;
      drawPlayer(sx, sy, p, false, s);
    }
    // minh
    const pMe = myEntry();
    if (pMe && pMe.spawned && S.role !== 'host') {
      pMe.fx = me.fx;
      pMe.fy = me.fy;
      drawPlayer(ox + me.x * s, oy + me.y * s, pMe, true, s);
    }
  }

  function renderMinimap() {
    if (!S.grid || S.role !== 'host') return;
    const mw = minimap.width / S.dpr;
    const mh = minimap.height / S.dpr;
    const m = Math.min(mw / S.W, mh / S.H);
    const offX = (mw - S.W * m) / 2;
    const offY = (mh - S.H * m) / 2;

    mctx.fillStyle = '#f4f4f4';
    mctx.fillRect(0, 0, mw, mh);
    for (let gy = 0; gy < S.H; gy++) {
      for (let gx = 0; gx < S.W; gx++) {
        mctx.fillStyle = S.grid[gy][gx] === '#' ? '#0a0a0a' : '#ffffff';
        mctx.fillRect(offX + gx * m, offY + gy * m, m + 0.4, m + 0.4);
      }
    }

    // ruong o giua
    if (S.treasure) {
      const tx = offX + S.treasure.x * m;
      const ty = offY + S.treasure.y * m;
      mctx.beginPath();
      mctx.arc(tx, ty, 3.4, 0, Math.PI * 2);
      mctx.fillStyle = '#0a0a0a';
      mctx.fill();
      mctx.beginPath();
      mctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
      mctx.lineWidth = 1.2;
      mctx.strokeStyle = '#0a0a0a';
      mctx.stroke();
    }

    for (const p of S.players.values()) {
      if (!p.spawned) continue;
      const px = offX + (p.id === S.myId ? me.x : p.x) * m;
      const py = offY + (p.id === S.myId ? me.y : p.y) * m;
      if (p.id === S.myId) {
        mctx.beginPath();
        mctx.arc(px, py, 3, 0, Math.PI * 2);
        mctx.fillStyle = '#0a0a0a';
        mctx.fill();
        mctx.lineWidth = 1.5;
        mctx.strokeStyle = '#ffffff';
        mctx.stroke();
      } else {
        mctx.beginPath();
        mctx.arc(px, py, 2.4, 0, Math.PI * 2);
        mctx.fillStyle = p.roundCorrect ? '#0a0a0a' : '#8a8a8a';
        mctx.fill();
        if (p.frozenUntil > nowServer()) {
          mctx.beginPath();
          mctx.arc(px, py, 4, 0, Math.PI * 2);
          mctx.lineWidth = 1;
          mctx.strokeStyle = '#0a0a0a';
          mctx.stroke();
        }
      }
    }
  }

  /* ------------------------------- loop ----------------------------- */

  let prevTs = 0;
  let minimapTick = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    const now = ts || performance.now();
    let dt = (now - prevTs) / 1000;
    prevTs = now;
    if (dt > 0.1) dt = 0.1;
    if (gameEl.hidden) return;

    update(dt, now);
    if (S.grid) {
      render(now);
      if (++minimapTick % 5 === 0) renderMinimap();
    }

    // dong ho
    if (S.phase === 'round' && S.endsAt) {
      const remain = Math.max(0, S.endsAt - nowServer());
      const total = Math.ceil(remain / 1000);
      const mm = Math.floor(total / 60);
      const ss = String(total % 60).padStart(2, '0');
      hudTimer.textContent = mm + ':' + ss;
      hudRound.textContent = 'VÒNG ' + S.round + '/10 · ' + S.correctCount + '/5 ĐÚNG';
      hudTimer.classList.toggle('low', remain <= 10000);
      if (S.modalOpen && !S.modalSolved) updateStatusChip();
    }
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
    setTimeout(() => {
      if (startScreen.hidden) return;
      startBtn.disabled = false;
      startBtn.textContent = 'VÀO GAME';
    }, 5000);
  });

  resize();
})();
