/* NEON DRIFT — core: canvas, math, input, audio, particles. */
window.ND = window.ND || {};
(function (ND) {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  ND.canvas = canvas;
  ND.ctx = ctx;
  ND.view = { w: 0, h: 0, dpr: 1 };
  ND.WORLD = { w: 2000, h: 1500 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ND.view.w = window.innerWidth;
    ND.view.h = window.innerHeight;
    ND.view.dpr = dpr;
    canvas.width = Math.floor(ND.view.w * dpr);
    canvas.height = Math.floor(ND.view.h * dpr);
    canvas.style.width = ND.view.w + 'px';
    canvas.style.height = ND.view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- math ----------
  ND.TAU = Math.PI * 2;
  ND.rand = (a, b) => a + Math.random() * (b - a);
  ND.randInt = (a, b) => Math.floor(ND.rand(a, b + 1));
  ND.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  ND.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  ND.lerp = (a, b, t) => a + (b - a) * t;
  ND.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------- input ----------
  ND.keys = new Set();
  ND.mouse = { x: 0, y: 0, down: false };

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
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => {
    ND.keys.clear();
    ND.mouse.down = false;
  });

  // ---------- particles ----------
  ND.particles = [];

  ND.spawnParticles = function (x, y, count, opts) {
    opts = opts || {};
    const color = opts.color || '#22d3ee';
    const speed = opts.speed || 220;
    const size = opts.size || 3;
    const life = opts.life || 0.5;
    const dir = opts.dir;
    const spread = opts.spread === undefined ? Math.PI * 2 : opts.spread;

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
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr.splice(i, 1);
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  };

  ND.drawParticles = function (ctx, camX, camY) {
    const arr = ND.particles;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
      }
      const s = p.size * (0.4 + t * 0.9);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
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
      }
    }
  }

  ND.audio = new Sound();
})(window.ND);
