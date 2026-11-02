/* BMW Pong — HTML5 canvas ping pong.
 * The playfield uses a fixed logical size (W x H) and is scaled to fit the window.
 */
(() => {
  "use strict";

  const BRAND = window.BRAND;
  const C = BRAND.colors;

  // ---------- Constants ----------
  const W = 1600;
  const H = 900;
  const PADDLE_W = 18;
  const PADDLE_H = 130;
  const PADDLE_MARGIN = 56;
  const PADDLE_SPEED = 950;      // keyboard / gamepad speed, px/s
  const MOUSE_SPEED = 2200;      // max follow speed for mouse control
  const BALL_R = 11;
  const BALL_START_SPEED = 760;
  const BALL_MAX_SPEED = 1750;
  const BALL_SPEEDUP = 1.045;
  const MAX_BOUNCE_ANGLE = (58 * Math.PI) / 180;
  const WIN_SCORE = 11;

  const DIFFICULTY = {
    easy:   { speed: 520, reaction: 0.24, error: 80 },
    normal: { speed: 760, reaction: 0.12, error: 40 },
    hard:   { speed: 1050, reaction: 0.05, error: 14 },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const ui = {
    hud: $("hud"),
    menu: $("menu"),
    pause: $("pause"),
    gameover: $("gameover"),
    mainButtons: $("main-buttons"),
    difficultyButtons: $("difficulty-buttons"),
    howto: $("howto"),
    p1Score: $("p1-score"),
    p2Score: $("p2-score"),
    p1Name: $("p1-name"),
    p2Name: $("p2-name"),
    p1Serve: $("p1-serve"),
    p2Serve: $("p2-serve"),
    winnerText: $("winner-text"),
    finalScore: $("final-score"),
    toast: $("toast"),
  };

  $("brand-logo").src = BRAND.logo;
  $("brand-tagline").textContent = BRAND.tagline;
  const logoImg = new Image();
  logoImg.src = BRAND.logo;

  // ---------- Audio (synthesised, no asset files needed) ----------
  const audio = {
    ctx: null,
    muted: false,
    ensure() {
      // Audio is optional: never let a blocked or failing AudioContext stop input.
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      } catch (err) {
        this.ctx = null;
      }
    },
    tone(freq, dur, opts) {
      try { this._tone(freq, dur, opts); } catch (err) { /* ignore audio errors */ }
    },
    _tone(freq, dur, { type = "square", vol = 0.08, slide = 0, delay = 0 } = {}) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    paddle(speedRatio) { this.tone(420 + speedRatio * 520, 0.07, { type: "square", vol: 0.07, slide: 180 }); },
    wall() { this.tone(260, 0.05, { type: "triangle", vol: 0.09 }); },
    score() {
      // A short "engine rev" — low sawtooth sweeping up
      this.tone(90, 0.35, { type: "sawtooth", vol: 0.06, slide: 260 });
      this.tone(660, 0.12, { type: "triangle", vol: 0.06, delay: 0.05 });
    },
    serve() { this.tone(520, 0.05, { type: "triangle", vol: 0.06 }); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", vol: 0.08, delay: i * 0.12 }));
    },
  };

  // ---------- Input ----------
  const keys = new Set();
  const mouse = { y: H / 2, active: false, lastMove: 0 };
  let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    audio.ensure();

    if (e.code === "F11" || (e.code === "KeyF" && !e.repeat)) { e.preventDefault(); toggleFullscreen(); return; }
    if (e.code === "KeyM" && !e.repeat) { toggleMute(); return; }
    if (e.code === "Escape" || e.code === "KeyP") {
      if (state.mode === "paused") resume();
      else if (isInGame()) pause();
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      if (state.mode === "serve") { e.preventDefault(); tryHumanServe(); }
    }
    if (["ArrowUp", "ArrowDown", "Space"].includes(e.code) && isInGame()) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => { keys.clear(); if (isInGame()) pause(); });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) * view.dpr - view.oy) / view.scale;
    mouse.y = Math.max(0, Math.min(H, y));
    mouse.active = true;
    mouse.lastMove = performance.now();
  });
  canvas.addEventListener("mousedown", () => { audio.ensure(); if (state.mode === "serve") tryHumanServe(); });

  // Gamepads: pad 0 controls player 1, pad 1 controls player 2.
  function gamepadAxis(index) {
    // getGamepads() throws when the page is embedded in a frame that blocks
    // the Gamepad API, so treat that as "no gamepad" instead of crashing.
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() || [] : []; } catch { pads = []; }
    const pad = pads[index];
    if (!pad) return { axis: 0, serve: false };
    let axis = pad.axes[1] || 0;
    if (pad.buttons[12] && pad.buttons[12].pressed) axis = -1;
    if (pad.buttons[13] && pad.buttons[13].pressed) axis = 1;
    if (Math.abs(axis) < 0.18) axis = 0;
    const serve = !!(pad.buttons[0] && pad.buttons[0].pressed);
    const start = !!(pad.buttons[9] && pad.buttons[9].pressed);
    return { axis, serve, start };
  }
  let padStartHeld = false;

  window.addEventListener("error", (e) => toast("Error: " + (e.message || "unknown"), 6000));
  window.addEventListener("unhandledrejection", (e) => console.warn(e.reason));

  // ---------- Game state ----------
  const makePaddle = (side) => ({
    side,
    x: side === 0 ? PADDLE_MARGIN : W - PADDLE_MARGIN - PADDLE_W,
    y: H / 2,
    vy: 0,
    prevY: H / 2,
    glow: 0,
    ai: { target: H / 2, timer: 0 },
  });

  const state = {
    mode: "menu",        // menu | serve | play | point | paused | over
    resumeMode: "serve",
    vsCpu: true,
    difficulty: "normal",
    score: [0, 0],
    firstServer: 0,
    server: 0,
    paddles: [makePaddle(0), makePaddle(1)],
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, spin: 0, speed: BALL_START_SPEED },
    trail: [],
    particles: [],
    shake: 0,
    flash: 0,
    flashSide: 0,
    timer: 0,
    rally: 0,
  };

  const isInGame = () => ["serve", "play", "point"].includes(state.mode);

  // ---------- Flow ----------
  function showMenuPanel(which) {
    ui.mainButtons.classList.toggle("hidden", which !== "main");
    ui.difficultyButtons.classList.toggle("hidden", which !== "difficulty");
    ui.howto.classList.toggle("hidden", which !== "howto");
    const first = document.querySelector(
      which === "main" ? "#main-buttons button" : which === "difficulty" ? "#difficulty-buttons .primary" : "#howto button"
    );
    if (first) first.focus();
  }

  function startMatch() {
    state.score = [0, 0];
    state.firstServer = Math.random() < 0.5 ? 0 : 1;
    state.paddles = [makePaddle(0), makePaddle(1)];
    state.particles = [];
    state.trail = [];
    ui.p1Name.textContent = BRAND.names.p1;
    ui.p2Name.textContent = state.vsCpu ? `${BRAND.names.cpu} · ${diffLabel(state.difficulty)}` : BRAND.names.p2;
    ui.menu.classList.add("hidden");
    ui.gameover.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    resize();
    prepareServe();
    updateHud();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.focus();
  }

  function diffLabel(d) { return { easy: "COMFORT", normal: "SPORT", hard: "SPORT+" }[d]; }

  function currentServer() {
    const total = state.score[0] + state.score[1];
    const deuce = state.score[0] >= WIN_SCORE - 1 && state.score[1] >= WIN_SCORE - 1;
    const turns = deuce ? total : Math.floor(total / 2);
    return (state.firstServer + turns) % 2;
  }

  function prepareServe() {
    state.server = currentServer();
    state.mode = "serve";
    state.timer = 0;
    state.rally = 0;
    state.trail = [];
    const b = state.ball;
    b.vx = b.vy = b.spin = 0;
    b.speed = BALL_START_SPEED;
    attachBallToServer();
    updateHud();
  }

  function attachBallToServer() {
    const p = state.paddles[state.server];
    state.ball.x = state.server === 0 ? p.x + PADDLE_W + BALL_R + 6 : p.x - BALL_R - 6;
    state.ball.y = p.y;
  }

  function serverIsHuman() { return !(state.vsCpu && state.server === 1); }

  function tryHumanServe() { if (serverIsHuman()) launchBall(); }

  function launchBall() {
    const b = state.ball;
    const dir = state.server === 0 ? 1 : -1;
    const p = state.paddles[state.server];
    const angle = (Math.random() * 2 - 1) * (18 * Math.PI) / 180;
    b.speed = BALL_START_SPEED;
    b.vx = Math.cos(angle) * b.speed * dir;
    b.vy = Math.sin(angle) * b.speed + p.vy * 0.15;
    b.spin = 0;
    state.mode = "play";
    audio.serve();
  }

  function pointTo(side) {
    state.score[side]++;
    state.mode = "point";
    state.timer = 0;
    state.flash = 1;
    state.flashSide = side;
    state.shake = 14;
    audio.score();
    spawnParticles(side === 0 ? W - 10 : 10, state.ball.y, BRAND.paddles[side], 40, side === 0 ? -1 : 1);
    updateHud();
  }

  function checkWin() {
    const [a, b] = state.score;
    if ((a >= WIN_SCORE || b >= WIN_SCORE) && Math.abs(a - b) >= 2) return a > b ? 0 : 1;
    return -1;
  }

  function endMatch(winner) {
    state.mode = "over";
    const name = winner === 0 ? BRAND.names.p1 : state.vsCpu ? BRAND.names.cpu : BRAND.names.p2;
    ui.winnerText.textContent = state.vsCpu ? (winner === 0 ? "You win" : "CPU wins") : `${name} wins`;
    ui.finalScore.textContent = `${state.score[0]} – ${state.score[1]}`;
    ui.gameover.classList.remove("hidden");
    ui.gameover.querySelector(".primary").focus();
    audio.win();
  }

  function pause() {
    if (!isInGame()) return;
    state.resumeMode = state.mode;
    state.mode = "paused";
    ui.pause.classList.remove("hidden");
    ui.pause.querySelector(".primary").focus();
  }

  function resume() {
    state.mode = state.resumeMode;
    ui.pause.classList.add("hidden");
    lastTime = performance.now();
  }

  function quitToMenu() {
    state.mode = "menu";
    ui.pause.classList.add("hidden");
    ui.gameover.classList.add("hidden");
    ui.hud.classList.add("hidden");
    ui.menu.classList.remove("hidden");
    showMenuPanel("main");
    resize();
  }

  function updateHud() {
    ui.p1Score.textContent = state.score[0];
    ui.p2Score.textContent = state.score[1];
    const s = state.mode === "menu" ? -1 : currentServer();
    ui.p1Serve.classList.toggle("on", s === 0);
    ui.p2Serve.classList.toggle("on", s === 1);
  }

  function toast(msg, ms = 1400) {
    ui.toast.textContent = msg;
    ui.toast.classList.remove("hidden");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => ui.toast.classList.add("hidden"), ms);
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    toast(audio.muted ? "Sound off" : "Sound on");
  }

  async function toggleFullscreen() {
    const tauriWin = window.__TAURI__ && window.__TAURI__.window;
    try {
      if (tauriWin) {
        const win = tauriWin.getCurrentWindow();
        await win.setFullscreen(!(await win.isFullscreen()));
        return;
      }
    } catch (err) { console.warn("Tauri fullscreen failed, falling back", err); }
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // Menu buttons
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    audio.ensure();
    audio.tone(700, 0.04, { type: "triangle", vol: 0.04 });
    const { action, difficulty } = btn.dataset;
    if (difficulty) { state.vsCpu = true; state.difficulty = difficulty; startMatch(); return; }
    switch (action) {
      case "single": showMenuPanel("difficulty"); break;
      case "versus": state.vsCpu = false; startMatch(); break;
      case "howto": showMenuPanel("howto"); break;
      case "back": showMenuPanel("main"); break;
      case "resume": resume(); break;
      case "restart": startMatch(); break;
      case "quit": quitToMenu(); break;
    }
  });

  // ---------- Update ----------
  function clampPaddle(p) {
    const half = PADDLE_H / 2;
    p.y = Math.max(half, Math.min(H - half, p.y));
  }

  function updateHumanPaddle(p, dt, upKeys, downKeys, padIndex, allowMouse) {
    let dir = 0;
    if (upKeys.some((k) => keys.has(k))) dir -= 1;
    if (downKeys.some((k) => keys.has(k))) dir += 1;
    const pad = gamepadAxis(padIndex);
    if (pad.axis) dir = pad.axis;
    if (pad.serve && state.mode === "serve" && state.server === p.side) tryHumanServe();

    if (dir !== 0) {
      p.y += dir * PADDLE_SPEED * dt;
      if (allowMouse) mouse.active = false;
    } else if (allowMouse && mouse.active) {
      const diff = mouse.y - p.y;
      const step = MOUSE_SPEED * dt;
      p.y += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    }
  }

  function predictBallY(targetX) {
    const b = state.ball;
    if ((targetX - b.x) / b.vx < 0) return H / 2;
    const t = (targetX - b.x) / b.vx;
    let y = b.y + b.vy * t;
    // Unfold wall bounces
    const lo = BALL_R, hi = H - BALL_R, span = hi - lo;
    y -= lo;
    const period = span * 2;
    y = ((y % period) + period) % period;
    if (y > span) y = period - y;
    return y + lo;
  }

  function updateCpuPaddle(p, dt) {
    const d = DIFFICULTY[state.difficulty];
    const b = state.ball;
    p.ai.timer -= dt;
    if (p.ai.timer <= 0) {
      p.ai.timer = d.reaction;
      const incoming = state.mode === "play" && b.vx > 0;
      if (incoming) {
        const err = (Math.random() * 2 - 1) * d.error;
        // Aim slightly off-centre so the CPU puts angle on returns
        const english = (Math.random() * 2 - 1) * PADDLE_H * 0.28;
        p.ai.target = predictBallY(p.x) + err + english;
      } else if (state.mode === "serve" && state.server === 1) {
        p.ai.target = H / 2 + Math.sin(performance.now() / 400) * 120;
      } else {
        p.ai.target = H / 2 + (b.y - H / 2) * 0.3;
      }
    }
    const diff = p.ai.target - p.y;
    const step = d.speed * dt;
    p.y += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  }

  function spawnParticles(x, y, color, count, dir) {
    for (let i = 0; i < count; i++) {
      const a = (Math.random() - 0.5) * Math.PI * 0.9;
      const s = 150 + Math.random() * 520;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s * dir,
        vy: Math.sin(a) * s,
        life: 1,
        decay: 1.4 + Math.random() * 1.6,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  function hitPaddle(p) {
    const b = state.ball;
    const rel = Math.max(-1, Math.min(1, (b.y - p.y) / (PADDLE_H / 2 + BALL_R)));
    const angle = rel * MAX_BOUNCE_ANGLE;
    b.speed = Math.min(BALL_MAX_SPEED, b.speed * BALL_SPEEDUP);
    const dir = p.side === 0 ? 1 : -1;
    b.vx = Math.cos(angle) * b.speed * dir;
    b.vy = Math.sin(angle) * b.speed;
    // Moving paddle imparts spin which curves the ball
    b.spin = Math.max(-1.6, Math.min(1.6, p.vy / 600));
    b.x = p.side === 0 ? p.x + PADDLE_W + BALL_R : p.x - BALL_R;
    p.glow = 1;
    state.rally++;
    state.shake = Math.max(state.shake, 3 + (b.speed / BALL_MAX_SPEED) * 5);
    spawnParticles(b.x, b.y, BRAND.paddles[p.side], 14, dir);
    audio.paddle((b.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED));
  }

  function stepBall(dt) {
    const b = state.ball;
    // Spin curves the trajectory and slowly decays
    b.vy += b.spin * 520 * dt;
    b.spin *= Math.exp(-1.2 * dt);
    // Keep total speed roughly constant so spin bends rather than accelerates
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) { b.vx *= b.speed / sp; b.vy *= b.speed / sp; }
    // Never let the ball get too vertical
    const minVx = b.speed * 0.42;
    if (Math.abs(b.vx) < minVx) {
      b.vx = Math.sign(b.vx || 1) * minVx;
      b.vy = Math.sign(b.vy || 1) * Math.sqrt(Math.max(0, b.speed * b.speed - minVx * minVx));
    }

    const px = b.x;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); b.spin *= -0.5; audio.wall(); }
    if (b.y > H - BALL_R) { b.y = H - BALL_R; b.vy = -Math.abs(b.vy); b.spin *= -0.5; audio.wall(); }

    const [p1, p2] = state.paddles;
    const reach = PADDLE_H / 2 + BALL_R;
    // Left paddle: crossed its front face this sub-step while moving left
    const f1 = p1.x + PADDLE_W;
    if (b.vx < 0 && px - BALL_R >= f1 - 1 && b.x - BALL_R <= f1 && Math.abs(b.y - p1.y) <= reach) hitPaddle(p1);
    const f2 = p2.x;
    if (b.vx > 0 && px + BALL_R <= f2 + 1 && b.x + BALL_R >= f2 && Math.abs(b.y - p2.y) <= reach) hitPaddle(p2);

    if (b.x < -BALL_R * 4) return pointTo(1);
    if (b.x > W + BALL_R * 4) return pointTo(0);
  }

  function update(dt) {
    // Gamepad start button toggles pause
    const start = gamepadAxis(0).start || gamepadAxis(1).start;
    if (start && !padStartHeld) { if (state.mode === "paused") resume(); else if (isInGame()) pause(); }
    padStartHeld = start;

    if (!isInGame()) {
      updateParticles(dt);
      return;
    }

    const [p1, p2] = state.paddles;
    const p1Keys = state.vsCpu ? [["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]] : [["KeyW"], ["KeyS"]];
    updateHumanPaddle(p1, dt, p1Keys[0], p1Keys[1], 0, true);
    if (state.vsCpu) updateCpuPaddle(p2, dt);
    else updateHumanPaddle(p2, dt, ["ArrowUp"], ["ArrowDown"], 1, false);

    for (const p of state.paddles) {
      clampPaddle(p);
      p.vy = (p.y - p.prevY) / dt;
      p.prevY = p.y;
      p.glow = Math.max(0, p.glow - dt * 3);
    }

    if (state.mode === "serve") {
      attachBallToServer();
      state.timer += dt;
      if (!serverIsHuman() && state.timer > 0.9) launchBall();
    } else if (state.mode === "play") {
      const b = state.ball;
      const steps = Math.max(1, Math.ceil((b.speed * dt) / 6));
      for (let i = 0; i < steps && state.mode === "play"; i++) stepBall(dt / steps);
      state.trail.push({ x: b.x, y: b.y });
      if (state.trail.length > 16) state.trail.shift();
    } else if (state.mode === "point") {
      state.timer += dt;
      if (state.timer > 1.0) {
        const winner = checkWin();
        if (winner >= 0) endMatch(winner);
        else prepareServe();
      }
    }

    state.shake = Math.max(0, state.shake - dt * 40);
    state.flash = Math.max(0, state.flash - dt * 1.6);
    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (const pt of state.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-2.5 * dt);
      pt.vy *= Math.exp(-2.5 * dt);
      pt.life -= pt.decay * dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  // ---------- Rendering ----------
  let carbon = null;
  function makeCarbonPattern() {
    const s = 12;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    g.fillStyle = "#0c0f13";
    g.fillRect(0, 0, s, s);
    const grad = (x, y, w, h, horiz) => {
      const lg = horiz ? g.createLinearGradient(x, y, x, y + h) : g.createLinearGradient(x, y, x + w, y);
      lg.addColorStop(0, "#14181e");
      lg.addColorStop(0.5, "#1a1f26");
      lg.addColorStop(1, "#0f1216");
      g.fillStyle = lg;
      g.fillRect(x, y, w, h);
    };
    grad(0, 0, s / 2, s / 2, true);
    grad(s / 2, s / 2, s / 2, s / 2, true);
    grad(s / 2, 0, s / 2, s / 2, false);
    grad(0, s / 2, s / 2, s / 2, false);
    return ctx.createPattern(c, "repeat");
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const pad = 24 * dpr;
    const scale = Math.min((canvas.width - pad * 2) / W, (canvas.height - pad * 2) / H);
    view = {
      scale,
      ox: (canvas.width - W * scale) / 2,
      oy: (canvas.height - H * scale) / 2,
      dpr,
    };
    carbon = makeCarbonPattern();
  }
  window.addEventListener("resize", resize);

  function drawTable() {
    // Surface
    const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, "#151a22");
    g.addColorStop(1, C.table);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Faint logo watermark
    if (logoImg.complete && logoImg.naturalWidth) {
      ctx.globalAlpha = 0.05;
      const s = 360;
      ctx.drawImage(logoImg, W / 2 - s / 2, H / 2 - s / 2, s, s);
      ctx.globalAlpha = 1;
    }

    // Border and centre line (like a table tennis table seen from above)
    ctx.strokeStyle = C.lines;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Net in M colours
    const colors = [C.mLight, C.mDark, C.mRed];
    const dash = 26, gap = 12;
    let i = 0;
    for (let y = 8; y < H - 8; y += dash + gap, i++) {
      ctx.fillStyle = colors[i % 3];
      ctx.fillRect(W / 2 - 3, y, 6, Math.min(dash, H - 8 - y));
    }
  }

  function drawPaddle(p) {
    const color = BRAND.paddles[p.side];
    const top = p.y - PADDLE_H / 2;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 24 + p.glow * 40;
    ctx.fillStyle = color;
    roundRect(p.x, top, PADDLE_W, PADDLE_H, 6);
    ctx.fill();
    ctx.restore();
    // Bright inner LED strip, like a light bar
    ctx.fillStyle = `rgba(255,255,255,${0.55 + p.glow * 0.45})`;
    const inset = p.side === 0 ? PADDLE_W - 6 : 2;
    roundRect(p.x + inset, top + 10, 4, PADDLE_H - 20, 2);
    ctx.fill();
  }

  function drawBall() {
    const b = state.ball;
    // Motion trail
    for (let i = 0; i < state.trail.length; i++) {
      const t = state.trail[i];
      const a = (i + 1) / state.trail.length;
      ctx.fillStyle = `rgba(129,196,255,${a * 0.22})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.35 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = C.ball;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawServeHint() {
    if (state.mode !== "serve" || !serverIsHuman()) return;
    const pulse = 0.45 + Math.sin(performance.now() / 260) * 0.25;
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.font = "500 22px 'Segoe UI', Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    const who = state.vsCpu ? "" : state.server === 0 ? "PLAYER 1 · " : "PLAYER 2 · ";
    ctx.fillText(`${who}PRESS SPACE TO SERVE`, W / 2, H - 48);
  }

  function drawPointFlash() {
    if (state.flash <= 0) return;
    const side = state.flashSide;
    const g = side === 0
      ? ctx.createLinearGradient(W, 0, W - 400, 0)
      : ctx.createLinearGradient(0, 0, 400, 0);
    const col = BRAND.paddles[side];
    g.addColorStop(0, hexA(col, 0.35 * state.flash));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = carbon || C.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sx = state.shake ? (Math.random() - 0.5) * state.shake : 0;
    const sy = state.shake ? (Math.random() - 0.5) * state.shake : 0;
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox + sx * view.scale, view.oy + sy * view.scale);

    // Clip to the table for everything inside it
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    drawTable();
    drawPointFlash();
    if (state.mode !== "menu") {
      drawParticles();
      if (state.mode !== "point") drawBall();
      state.paddles.forEach(drawPaddle);
      drawServeHint();
    } else {
      drawAttract();
    }
    ctx.restore();
  }

  // Idle animation behind the main menu
  function drawAttract() {
    const t = performance.now() / 1000;
    const x = W / 2 + Math.sin(t * 0.9) * (W / 2 - 120);
    const y = H / 2 + Math.sin(t * 1.7) * (H / 2 - 60);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = BRAND.paddles[0];
    roundRect(PADDLE_MARGIN, y - PADDLE_H / 2, PADDLE_W, PADDLE_H, 6); ctx.fill();
    ctx.fillStyle = BRAND.paddles[1];
    roundRect(W - PADDLE_MARGIN - PADDLE_W, y - PADDLE_H / 2, PADDLE_W, PADDLE_H, 6); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    requestAnimationFrame(frame);
    try {
      if (state.mode !== "paused") update(dt);
      render();
    } catch (err) {
      console.error(err);
    }
  }

  const jsWarning = document.getElementById("js-warning");
  if (jsWarning) jsWarning.remove();
  resize();
  showMenuPanel("main");
  requestAnimationFrame(frame);

  // Expose for debugging / automated tests
  window.__pong = { state, startMatch, launchBall };
})();
