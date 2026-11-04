/* NEON DRIFT — core: canvas, math, input, audio, particles. */
window.ND = window.ND || {};
(function (ND) {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  ND.canvas = canvas;
  ND.ctx = ctx;
  ND.view = { w: 0, h: 0, dpr: 1 };
  ND.WORLD = { w: 1920, h: 1440 };

  // ---------- device class / render quality ----------
  // Phones report devicePixelRatio 2-3, so a full-screen canvas at native
  // resolution costs 4-9x the pixels of a 1x display. Rendering at 1.6x is
  // visually indistinguishable on a phone but roughly halves the fill cost.
  // Quality is adaptive: if frames start slipping the canvas drops a tier.
  ND.isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 0);

  ND.quality = ND.isTouch ? 1 : 2;   // 2 = high, 1 = medium, 0 = low
  const QUALITY_DPR = [1, 1.5, 2];

  function dprForQuality() {
    const raw = window.devicePixelRatio || 1;
    // A touch screen never needs more than 1.6x, even at quality 2.
    const cap = ND.isTouch ? Math.min(QUALITY_DPR[ND.quality], 1.6) : QUALITY_DPR[ND.quality];
    return Math.min(raw, cap);
  }

  function resize() {
    const dpr = dprForQuality();
    ND.view.w = window.innerWidth;
    ND.view.h = window.innerHeight;
    ND.view.dpr = dpr;
    canvas.width = Math.floor(ND.view.w * dpr);
    canvas.height = Math.floor(ND.view.h * dpr);
    canvas.style.width = ND.view.w + 'px';
    canvas.style.height = ND.view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Screen-space caches (backdrop, vignette) must be rebuilt at the new size.
    if (ND.onResize) ND.onResize();
  }

  let resizeRaf = 0;
  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; resize(); });
  }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);
  resize();

  // Rolling frame-time average drives automatic quality. Thresholds are
  // generous (22ms ~= 45fps) because a single slow frame is not a problem and
  // flapping between tiers is worse than staying one tier lower.
  let frameAvg = 16.7;
  let goodFor = 0;
  let badFor = 0;
  ND.sampleFrame = function (dt) {
    if (!(dt > 0) || dt > 0.2) return;
    frameAvg += (dt * 1000 - frameAvg) * 0.06;
    if (frameAvg > 22) { badFor++; goodFor = 0; }
    else if (frameAvg < 13.5) { goodFor++; badFor = 0; }
    else { badFor = Math.max(0, badFor - 1); goodFor = Math.max(0, goodFor - 1); }

    if (badFor > 100 && ND.quality > 0) {
      ND.quality--;
      badFor = 0;
      goodFor = 0;
      frameAvg = 16.7;
      resize();
    } else if (goodFor > 420 && ND.quality < (ND.isTouch ? 1 : 2)) {
      ND.quality++;
      goodFor = 0;
      badFor = 0;
      frameAvg = 16.7;
      resize();
    }
  };

  // ---------- math ----------
  ND.TAU = Math.PI * 2;
  ND.rand = (a, b) => a + Math.random() * (b - a);
  ND.randInt = (a, b) => Math.floor(ND.rand(a, b + 1));
  ND.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  ND.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  ND.lerp = (a, b, t) => a + (b - a) * t;
  ND.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------- toroidal (wrap-around) space ----------
  // The arena is a torus: leaving one edge brings you in the opposite one.
  // Distance and direction take the SHORT way round, so an enemy at x=10 still
  // chases a player at x=1990 across the seam instead of walking the map.
  ND.wrapX = (x) => {
    const w = ND.WORLD.w;
    return ((x % w) + w) % w;
  };
  ND.wrapY = (y) => {
    const h = ND.WORLD.h;
    return ((y % h) + h) % h;
  };
  ND.wrap = (o) => { o.x = ND.wrapX(o.x); o.y = ND.wrapY(o.y); return o; };

  // Shortest signed delta from a to b on an axis of length n.
  ND.delta = (a, b, n) => {
    let d = b - a;
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    return d;
  };

  ND.distT = (ax, ay, bx, by) => Math.hypot(
    ND.delta(ax, bx, ND.WORLD.w),
    ND.delta(ay, by, ND.WORLD.h)
  );

  // ---------- cached glow sprites ----------
  // `shadowBlur` is a per-draw Skia blur pass and was the single biggest cost
  // in the frame: 64 enemies + 150 bullets + hundreds of particles each paid
  // for their own blur. A pre-rendered radial sprite drawn with the additive
  // blend looks the same and costs one drawImage.
  const glowCache = new Map();

  function toRgb(hex) {
    if (typeof hex !== 'string') return '255,255,255';
    let h = hex.trim();
    if (h[0] !== '#') {
      const m = h.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      return m ? (m[1] | 0) + ',' + (m[2] | 0) + ',' + (m[3] | 0) : '255,255,255';
    }
    h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!isFinite(n)) return '255,255,255';
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  ND.toRgb = toRgb;

  ND.glowSprite = function (color) {
    let c = glowCache.get(color);
    if (c) return c;
    const S = 96;
    c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const rgb = toRgb(color);
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(' + rgb + ',0.95)');
    grd.addColorStop(0.22, 'rgba(' + rgb + ',0.45)');
    grd.addColorStop(0.5, 'rgba(' + rgb + ',0.14)');
    grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    glowCache.set(color, c);
    return c;
  };

  // Additive soft glow. `radius` is the visible half-size.
  ND.drawGlow = function (ctx, color, x, y, radius, alpha) {
    const sp = ND.glowSprite(color);
    const prev = ctx.globalCompositeOperation;
    const prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (prevA === 1 ? 1 : prevA) * (alpha === undefined ? 1 : alpha);
    ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = prevA;
    ctx.globalCompositeOperation = prev;
  };


  // ---------- input ----------
  ND.keys = new Set();
  ND.mouse = { x: 0, y: 0, down: false };

  // One-shot actions requested by on-screen buttons (mobile) or any other UI.
  // The player update consumes and clears them.
  ND.actions = { dash: false, swap: 0 };

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    ND.keys.add(k);
  });
  window.addEventListener('keyup', (e) => ND.keys.delete(e.key.toLowerCase()));

  window.addEventListener('mousemove', (e) => {
    ND.mouse.x = e.clientX;
    ND.mouse.y = e.clientY;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) ND.mouse.down = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) ND.mouse.down = false;
  });
  // If the pointer leaves the page mid-hold, drop the trigger instead of
  // firing forever until the player clicks again.
  window.addEventListener('mouseleave', () => {
    ND.mouse.down = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- touch / virtual sticks ----------
  // Two thumbs, the way every mobile twin-stick shooter works:
  //   left half  -> movement stick
  //   right half -> aim stick (also sets the firing direction)
  // Guns auto-fire, and when the aim thumb is idle the ship auto-targets the
  // nearest hostile, so one-thumb play is viable and aiming is an upgrade,
  // not a requirement.
  ND.touchMove = { x: 0, y: 0 };
  ND.aim = { active: false, x: 1, y: 0 };
  ND.sticks = [];              // [{role, ox, oy, x, y, r}] for the HUD overlay
  const STICK_DEAD = 0.16;
  const pointers = new Map();

  function stickRadius() {
    return Math.max(46, Math.min(78, ND.view.w * 0.14));
  }

  function roleFor(x) {
    // A stick keeps the half it started in, so a thumb drifting across the
    // midline never steals the other hand's control.
    const used = new Set([...pointers.values()].map((p) => p.role));
    if (x < ND.view.w * 0.5) return used.has('move') ? null : 'move';
    return used.has('aim') ? null : 'aim';
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const role = roleFor(e.clientX);
    if (!role) return;
    e.preventDefault();
    const r = stickRadius();
    const p = { id: e.pointerId, role, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, r };
    pointers.set(e.pointerId, p);
    ND.sticks.push(p);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    applyStick(p);
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX;
    p.y = e.clientY;
    applyStick(p);
  }, { passive: false });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    const i = ND.sticks.indexOf(p);
    if (i !== -1) ND.sticks.splice(i, 1);
    if (p.role === 'move') { ND.touchMove.x = 0; ND.touchMove.y = 0; }
    else { ND.aim.active = false; }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  function applyStick(p) {
    let dx = (p.x - p.ox) / p.r;
    let dy = (p.y - p.oy) / p.r;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    if (p.role === 'move') {
      const mag = Math.hypot(dx, dy);
      if (mag < STICK_DEAD) { ND.touchMove.x = 0; ND.touchMove.y = 0; }
      else {
        // Rescale past the deadzone so fine control still starts at zero.
        const k = (mag - STICK_DEAD) / (1 - STICK_DEAD) / mag;
        ND.touchMove.x = dx * k;
        ND.touchMove.y = dy * k;
      }
    } else {
      const mag = Math.hypot(dx, dy);
      if (mag < STICK_DEAD) { ND.aim.active = false; }
      else {
        ND.aim.active = true;
        ND.aim.x = dx / mag;
        ND.aim.y = dy / mag;
      }
    }
  }

  // Releasing focus must not leave a stick stuck on.
  function clearInputs() {
    ND.keys.clear();
    ND.mouse.down = false;
    pointers.clear();
    ND.sticks.length = 0;
    ND.touchMove.x = 0;
    ND.touchMove.y = 0;
    ND.aim.active = false;
    ND.actions.dash = false;
  }

  // Losing focus (alt-tab, clicking another window) must pause, not keep
  // simulating in the background where the player can die unseen.
  window.addEventListener('blur', () => {
    clearInputs();
    if (ND.onBlur) ND.onBlur();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInputs();
      if (ND.onBlur) ND.onBlur();
    }
  });

  // ---------- particles ----------
  ND.particles = [];
  // Hard cap: beyond this the frame cost explodes and the screen is unreadable
  // anyway. Oldest particles are recycled rather than grown indefinitely.
  const MAX_PARTICLES = 900;

  ND.spawnParticles = function (x, y, count, opts) {
    opts = opts || {};
    const color = opts.color || '#22d3ee';
    const speed = opts.speed || 220;
    const size = opts.size || 3;
    const life = opts.life || 0.5;
    const dir = opts.dir;
    const spread = opts.spread === undefined ? Math.PI * 2 : opts.spread;

    // Degrade gracefully when saturated: keep the newest effects readable.
    const room = MAX_PARTICLES - ND.particles.length;
    if (room <= 0) return;
    if (count > room) count = room;

    for (let i = 0; i < count; i++) {
      const a = dir !== undefined ? dir + ND.rand(-spread / 2, spread / 2) : ND.rand(0, ND.TAU);
      const s = speed * ND.rand(0.25, 1);
      ND.particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * ND.rand(0.6, 1.2),
        maxLife: life,
        size: size * ND.rand(0.6, 1.4),
        color: color,
        drag: opts.drag === undefined ? 2.6 : opts.drag,
        glow: opts.glow === undefined ? true : opts.glow
      });
    }
  };

  ND.updateParticles = function (dt) {
    const arr = ND.particles;
    // Swap-with-last removal avoids splice() shifting the whole array.
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  };

  ND.drawParticles = function (ctx, camX, camY, tilesX, tilesY) {
    const arr = ND.particles;
    const txs = tilesX || [0];
    const tys = tilesY || [0];
    const x0 = camX - 40, x1 = camX + ND.view.w + 40;
    const y0 = camY - 40, y1 = camY + ND.view.h + 40;
    const multi = txs.length > 1 || tys.length > 1;
    // Glow sprites are cheaper than a blur pass per particle, but on the
    // lowest quality tier plain squares are cheaper still.
    const useGlow = ND.quality > 0;
    const prevA = ctx.globalAlpha;

    if (useGlow) ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const t = p.life / p.maxLife;
      if (t <= 0) continue;

      if (!multi && (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1)) continue;

      const s = p.size * (0.45 + t * 1.1);
      ctx.globalAlpha = t > 1 ? 1 : t;

      if (!multi) {
        if (useGlow && p.glow) {
          const r = s * 3.2;
          ctx.drawImage(ND.glowSprite(p.color), p.x - r, p.y - r, r * 2, r * 2);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
        continue;
      }

      // Near a seam the same particle can appear on both sides of the screen.
      for (let a = 0; a < txs.length; a++) {
        const px = p.x + txs[a];
        if (px < x0 || px > x1) continue;
        for (let b = 0; b < tys.length; b++) {
          const py = p.y + tys[b];
          if (py < y0 || py > y1) continue;
          if (useGlow && p.glow) {
            const r = s * 3.2;
            ctx.drawImage(ND.glowSprite(p.color), px - r, py - r, r * 2, r * 2);
          } else {
            ctx.fillStyle = p.color;
            ctx.fillRect(px - s / 2, py - s / 2, s, s);
          }
        }
      }
    }

    ctx.globalAlpha = prevA;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---------- screen shake ----------
  ND.shake = 0;
  ND.addShake = function (v) {
    ND.shake = Math.min(26, ND.shake + v);
  };

  // ---------- audio (tiny WebAudio synth) ----------
  class Sound {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuf = null;
      this.lastShot = 0;
      this.muted = false;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // The music engine shares the context but has its own gain bus, so the
      // music/sfx volumes stay independent.
      ND.noiseBuffer = buf;
      if (ND.music) ND.music.attach(this.ctx, this.ctx.destination);
    }

    tone(freq, endFreq, dur, type, vol) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq && endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    noise(dur, vol, filterFreq, sweep) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(filterFreq || 1600, t);
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweep), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'shoot': {
          const now = performance.now();
          if (now - this.lastShot < 28) return;
          this.lastShot = now;
          this.tone(ND.rand(780, 900), 260, 0.07, 'square', 0.05);
          break;
        }
        case 'hit':
          this.noise(0.06, 0.05, 3200);
          break;
        case 'explode':
          this.noise(0.32, 0.14, 1800, 120);
          this.tone(140, 45, 0.3, 'sine', 0.1);
          break;
        case 'hurt':
          this.tone(220, 60, 0.28, 'sawtooth', 0.14);
          this.noise(0.2, 0.1, 900, 200);
          break;
        case 'pickup':
          this.tone(1100, 1750, 0.07, 'sine', 0.04);
          break;
        case 'level':
          this.tone(520, 520, 0.09, 'triangle', 0.09);
          setTimeout(() => this.tone(780, 780, 0.09, 'triangle', 0.09), 90);
          setTimeout(() => this.tone(1120, 1120, 0.16, 'triangle', 0.09), 180);
          break;
        case 'dash':
          this.noise(0.22, 0.1, 2400, 300);
          break;
        case 'switch':
          this.tone(620, 900, 0.06, 'triangle', 0.05);
          break;
        case 'boss':
          this.tone(90, 60, 0.7, 'sawtooth', 0.12);
          break;
        case 'crit':
          this.tone(1500, 620, 0.12, 'square', 0.05);
          break;
        case 'synergy':
          this.tone(440, 660, 0.12, 'triangle', 0.08);
          setTimeout(() => this.tone(660, 990, 0.16, 'triangle', 0.08), 110);
          break;
      }
    }
  }

  ND.audio = new Sound();
})(window.ND);
