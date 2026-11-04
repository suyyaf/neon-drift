/* NEON DRIFT — entities: player, bullets, enemies, pickups, upgrades. */
(function (ND) {
  'use strict';

  const TAU = ND.TAU;

  // All ship hitboxes/visuals are sized through this multiplier. Keeping it in
  // one place means "make everything 35% smaller" is a one-line change, and it
  // scales the collision radius in lockstep with the art.
  const SHIP = 0.65;
  ND.SHIP_SCALE = SHIP;

  // =========================================================
  // PLAYER
  // =========================================================
  ND.Player = function () {
    this.x = ND.WORLD.w / 2;
    this.y = ND.WORLD.h / 2;
    this.r = 13 * SHIP;
    this.scale = SHIP;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;

    this.maxHp = 100;
    this.hp = 100;
    this.speed = 320;
    this.accel = 2600;

    this.damage = 11;
    this.fireRate = 7.5;       // shots per second
    this.bulletSpeed = 900;
    this.bulletLife = 0.8;
    this.bullets = 1;
    this.spread = 0.13;
    this.pierce = 0;
    this.crit = 0.04;
    this.lifesteal = 0;

    this.cooldown = 0;
    this.weapon = 0;

    // weapon-specific upgrade stats
    this.scatterBonus = 0;
    this.scatterTighten = 1;
    this.railPierce = 0;
    this.railDmgMul = 1;
    this.railRate = 1;
    this.railWidth = 0;
    this.flak = 0;
    this.ramMul = 1;

    // synergy flags (set by ND.applySynergies)
    this.ignite = 0;
    this.critBurst = false;
    this.armor = 0;
    this.leechMul = 1;
    this.railSurge = false;
    this.ricochet = 0;
    this.ramSynergy = 1;
    this.synergies = [];

    // boss-kill specials
    this.specials = [];        // array of special ids, max 3
    this.specialCd = {};       // id -> seconds remaining
    this.aegis = 0;            // shield charge, 1 = ready
    this.aegisTimer = 0;
    this.droneAngle = 0;
    this.droneCd = 0;

    this.dashCd = 0;
    this.dashMax = 1.6;
    this.dashTime = 0;
    this.dashDx = 1;
    this.dashDy = 0;
    this.invuln = 0;

    this.level = 1;
    this.xp = 0;
    this.xpNext = 6;
    this.kills = 0;

    this.hurtFlash = 0;
    this.magnet = 150;
    this.regen = 0;
    this.xpNext = 5;
  };

  ND.Player.prototype.update = function (dt, game) {
    const k = ND.keys;
    let ix = 0, iy = 0;
    if (ND.isTouch) {
      // Virtual stick already returns a clamped unit vector.
      ix = ND.touchMove.x;
      iy = ND.touchMove.y;
    } else {
      if (k.has('w') || k.has('arrowup')) iy -= 1;
      if (k.has('s') || k.has('arrowdown')) iy += 1;
      if (k.has('a') || k.has('arrowleft')) ix -= 1;
      if (k.has('d') || k.has('arrowright')) ix += 1;
      const len = Math.hypot(ix, iy) || 1;
      ix /= len; iy /= len;
    }

    if (ND.actions.swap) {
      this.cycleWeapon(ND.actions.swap);
      ND.actions.swap = 0;
    }

    this.dashCd = Math.max(0, this.dashCd - dt);
    this.dashTime = Math.max(0, this.dashTime - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);

    // dash
    const dashBtn = ND.actions.dash;
    const wantDash = k.has(' ') || k.has('shift') || dashBtn;
    ND.actions.dash = false;
    if (wantDash && this.dashCd <= 0 && (ix || iy || this.moving || dashBtn)) {
      this.dashTime = 0.16;
      this.dashCd = this.dashMax;
      this.invuln = Math.max(this.invuln, 0.22);
      if (ix || iy) {
        this.dashDx = ix;
        this.dashDy = iy;
      } else if (dashBtn) {
        // Touch dash button: launch along the aim direction, so a stationary
        // ship still dashes where the player is pointing.
        this.dashDx = Math.cos(this.angle);
        this.dashDy = Math.sin(this.angle);
      } else {
        // Fall back to the last facing so a dash is always a finite direction.
        this.dashDx = this.lastDx || 1;
        this.dashDy = this.lastDy || 0;
      }
      const dl = Math.hypot(this.dashDx, this.dashDy) || 1;
      this.dashDx /= dl;
      this.dashDy /= dl;
      ND.audio.play('dash');
      ND.addShake(4);
      ND.spawnParticles(this.x, this.y, 18, {
        color: '#22d3ee', speed: 340, life: 0.5, size: 3, drag: 3
      });
    }

    if (ix || iy) { this.lastDx = ix; this.lastDy = iy; this.moving = true; }
    else this.moving = false;

    if (this.dashTime > 0) {
      const ds = this.speed * 4.4;
      this.vx = this.dashDx * ds;
      this.vy = this.dashDy * ds;
      if (Math.random() < 0.7) {
        ND.spawnParticles(this.x, this.y, 2, {
          color: '#7df9ff', speed: 60, life: 0.3, size: 2.5
        });
      }
    } else {
      const targetVx = ix * this.speed;
      const targetVy = iy * this.speed;
      const a = this.accel * dt;
      this.vx += ND.clamp(targetVx - this.vx, -a, a);
      this.vy += ND.clamp(targetVy - this.vy, -a, a);
      if (!ix && !iy) {
        const f = Math.max(0, 1 - 11 * dt);
        this.vx *= f; this.vy *= f;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // The arena is a torus: slip out one edge, come back in the other.
    this.x = ND.wrapX(this.x);
    this.y = ND.wrapY(this.y);

    // Aim. Desktop uses the mouse; touch uses the right stick, and falls back
    // to auto-targeting the nearest hostile when that thumb is idle, so the
    // game is playable with one thumb and precise with two.
    if (ND.isTouch) {
      this.angle = ND.aim.active
        ? Math.atan2(ND.aim.y, ND.aim.x)
        : this.autoAim(game);
    } else {
      // The mouse may sit past a seam (the camera wraps), so take the short way
      // round instead of a full-map angle.
      const mx = ND.wrapX(ND.mouse.x + game.camX);
      const my = ND.wrapY(ND.mouse.y + game.camY);
      this.angle = Math.atan2(
        ND.delta(this.y, my, ND.WORLD.h),
        ND.delta(this.x, mx, ND.WORLD.w)
      );
    }

    // shooting
    // Auto-fire: the gun is always hot, so aiming is the only trigger skill.
    // Holding LMB is no longer required (and does nothing extra); the mouse
    // still sets `this.angle` above, so lining up shots is unchanged.
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.shoot(game);
      this.cooldown = 1 / (this.fireRate * this.weaponRate());
    }

    // regen
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
  };

  // Touch fallback: face the closest threat. Range is generous but finite, so
  // the ship keeps its last heading instead of snapping to something offscreen.
  ND.Player.prototype.autoAim = function (game) {
    let best = null;
    let bestD = 780;
    for (let i = 0; i < game.enemies.length; i++) {
      const e = game.enemies[i];
      const d = ND.distT(this.x, this.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return this.angle;
    return Math.atan2(
      ND.delta(this.y, best.y, ND.WORLD.h),
      ND.delta(this.x, best.x, ND.WORLD.w)
    );
  };

  // =========================================================
  // WEAPONS
  // =========================================================
  // Each weapon reuses the player's upgrade stats but reshapes them.
  // `rate` and `speed` are multipliers on the player's base values.
  ND.WEAPONS = [
    {
      id: 'pulse',
      name: 'PULSE',
      hint: 'balanced',
      rate: 1,
      speed: 1,
      life: 1,
      dmg: 1,
      count: 0,        // 0 = use the player's projectile count
      spread: 0.13,
      pierce: 0,       // added to the player's pierce
      width: 1.5,
      color: '#8ef0ff',
      kick: 26
    },
    {
      id: 'scatter',
      name: 'SCATTER',
      hint: 'close burst',
      rate: 0.55,
      speed: 0.82,
      life: 0.42,
      dmg: 0.52,
      count: 7,
      spread: 0.19,
      pierce: 0,
      width: 1.25,
      color: '#ffd166',
      kick: 90
    },
    {
      id: 'rail',
      name: 'RAIL',
      hint: 'piercing shot',
      rate: 0.34,
      speed: 2.3,
      life: 1.25,
      dmg: 3.1,
      count: 1,
      spread: 0,
      pierce: 3,
      width: 3.2,
      color: '#ff6bd6',
      kick: 120
    }
  ];

  ND.Player.prototype.weaponDef = function () {
    return ND.WEAPONS[this.weapon] || ND.WEAPONS[0];
  };

  // Fire-rate multiplier including per-weapon upgrades.
  ND.Player.prototype.weaponRate = function () {
    const w = this.weaponDef();
    return w.id === 'rail' ? w.rate * this.railRate : w.rate;
  };

  ND.Player.prototype.cycleWeapon = function (dir) {
    const n = ND.WEAPONS.length;
    this.weapon = (this.weapon + (dir || 1) + n) % n;
    this.cooldown = Math.min(this.cooldown, 0.12);
    ND.audio.play('switch');
    return ND.WEAPONS[this.weapon];
  };

  ND.Player.prototype.shoot = function (game) {
    const w = this.weaponDef();
    let n = w.count || this.bullets;
    let spread = n > 1 ? w.spread : 0;
    let dmgMul = w.dmg;
    let extraPierce = w.pierce;
    let width = w.width;

    if (w.id === 'scatter') {
      n += this.scatterBonus;
      spread *= this.scatterTighten;
    } else if (w.id === 'rail') {
      extraPierce += this.railPierce;
      dmgMul *= this.railDmgMul;
      width += this.railWidth;
      // RAILGUN synergy: the beam punches deeper.
      if (this.railSurge) extraPierce += 2;
    }

    const base = n > 1 ? this.angle - spread * (n - 1) / 2 : this.angle;
    const speed = this.bulletSpeed * w.speed;

    for (let i = 0; i < n; i++) {
      const a = base + spread * i + ND.rand(-0.018, 0.018);
      const isCrit = Math.random() < this.crit;
      const dmg = this.damage * dmgMul * (isCrit ? 2.4 : 1);
      game.bullets.push({
        x: this.x + Math.cos(a) * (this.r + 8 * this.scale),
        y: this.y + Math.sin(a) * (this.r + 8 * this.scale),
        vx: Math.cos(a) * speed * ND.rand(0.97, 1.03),
        vy: Math.sin(a) * speed * ND.rand(0.97, 1.03),
        r: (isCrit ? 6 : 4) * (w.id === 'rail' ? 1.35 : 1),
        dmg: dmg,
        crit: isCrit,
        pierce: this.pierce + extraPierce,
        hits: [],
        life: this.bulletLife * w.life,
        color: isCrit ? '#ffe066' : w.color,
        width: width,
        flak: w.id === 'pulse' ? this.flak : 0,
        ignite: this.ignite,
        burst: isCrit && this.critBurst,
        ricochet: w.id === 'scatter' ? this.ricochet : 0,
        bounced: 0
      });
    }

    // muzzle flash
    ND.spawnParticles(
      this.x + Math.cos(this.angle) * (this.r + 10 * this.scale),
      this.y + Math.sin(this.angle) * (this.r + 10 * this.scale),
      w.id === 'scatter' ? 8 : 4,
      { color: w.color, speed: 260, life: 0.14, size: 2.6, dir: this.angle, spread: w.id === 'scatter' ? 1.1 : 0.7, drag: 6 }
    );
    this.vx -= Math.cos(this.angle) * w.kick;
    this.vy -= Math.sin(this.angle) * w.kick;
    ND.audio.play('shoot');
  };

  ND.Player.prototype.hurt = function (dmg) {
    if (this.invuln > 0 || this.dashTime > 0) return false;

    // AEGIS special: eats one hit and goes on cooldown.
    if (this.aegis > 0) {
      this.aegis = 0;
      this.aegisTimer = 7;
      this.invuln = 0.4;
      ND.addShake(7);
      ND.audio.play('switch');
      ND.spawnParticles(this.x, this.y, 26, {
        color: '#3bff9e', speed: 380, life: 0.6, size: 3.4, drag: 2
      });
      return false;
    }

    // BULWARK synergy softens every incoming hit.
    this.hp -= dmg * (1 - this.armor);
    this.invuln = 0.35;
    this.hurtFlash = 1;
    ND.addShake(7);
    ND.audio.play('hurt');
    ND.spawnParticles(this.x, this.y, 12, {
      color: '#ff3b6b', speed: 260, life: 0.5, size: 3
    });
    return true;
  };

  // A level-up is not automatically a pick. The shop re-opens every N levels
  // (starting at level 2) so a single fat XP clump cannot dump six cards in two
  // seconds — one measured run opened the screen 10 times in 90 seconds, six of
  // them inside 2 seconds. Scrap spending is unaffected: T opens the same shop
  // at any time, so fewer auto-opens costs no power.
  ND.UPGRADE_EVERY = 3;

  ND.Player.prototype.gainXp = function (amount, game) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      // Multiplicative XP growth outran the (roughly linear) supply of orbs and
      // stalled progression around level 13, leaving hundreds of scrap stranded.
      // The curve still climbs but is capped at 250, so levels keep arriving and
      // the run never runs out of power spikes.
      this.xpNext = Math.min(250, Math.round(this.xpNext * 1.28 + 4));
      if ((this.level - 2) % ND.UPGRADE_EVERY === 0) {
        game.pendingLevels++;
      }
    }
  };

  // Ship art. Drawn in local space with +x forward, so the whole silhouette
  // turns with the aim. `u` is the visual unit: the hull reads roughly 1.5x
  // the collision radius, the usual shmup trick that makes near-misses feel
  // fair. Glow is an additive sprite, not shadowBlur (see core.js).
  ND.Player.prototype.draw = function (ctx) {
    const t = performance.now() / 1000;
    const u = this.r * 1.05;
    const flash = this.hurtFlash > 0.5;
    const sp = Math.hypot(this.vx, this.vy);
    const thrust = Math.min(1, sp / (this.speed || 320));

    // dash cooldown ring: wide dim pass + thin bright pass reads as a glow
    // without paying for a blur every frame.
    const ringGap = 15 * this.scale;
    const rr = this.r + ringGap;
    if (this.dashCd > 0) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - this.dashCd / this.dashMax));
      ctx.strokeStyle = 'rgba(34,211,238,0.32)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, 0, TAU);
      ctx.strokeStyle = 'rgba(34,211,238,0.14)';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, 0, TAU);
      ctx.strokeStyle = 'rgba(150,250,255,0.62)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Bank: squash across the facing axis in proportion to sideways drift.
    // Cheap, and it makes the ship feel like it is turning rather than sliding.
    const lateral = this.vx * -Math.sin(this.angle) + this.vy * Math.cos(this.angle);
    const bank = 1 - Math.min(0.16, Math.abs(lateral) / 2200);
    ctx.scale(1, bank);

    const side = [
      [2.30, 0.00],
      [0.88, 0.24],
      [0.30, 0.56],
      [-0.42, 1.42],
      [-0.98, 1.26],
      [-0.70, 0.52],
      [-1.02, 0.30],
      [-1.22, 0.12],
      [-1.22, 0.00]
    ];

    function hullPath() {
      ctx.beginPath();
      ctx.moveTo(side[0][0] * u, 0);
      for (let i = 1; i < side.length; i++) ctx.lineTo(side[i][0] * u, side[i][1] * u);
      for (let i = side.length - 2; i >= 0; i--) ctx.lineTo(side[i][0] * u, -side[i][1] * u);
      ctx.closePath();
    }

    // ---- engine ----
    if (sp > 24) {
      const flick = 0.82 + Math.random() * 0.36;
      const len = (9 + Math.min(22, sp * 0.035)) * flick;
      for (let s = -1; s <= 1; s += 2) {
        const ey = s * u * 0.42;
        const g = ctx.createLinearGradient(-u * 0.9, 0, -u * 0.9 - len, 0);
        g.addColorStop(0, 'rgba(235,255,255,0.95)');
        g.addColorStop(0.3, 'rgba(90,240,255,0.72)');
        g.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.beginPath();
        ctx.moveTo(-u * 0.86, ey - u * 0.2);
        ctx.lineTo(-u * 0.86 - len, ey);
        ctx.lineTo(-u * 0.86, ey + u * 0.2);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
      }
      ND.drawGlow(ctx, '#22d3ee', -u * 1.0, 0, u * 1.8, 0.18 + thrust * 0.22);
    }

    // ---- hull ----
    // A wide translucent stroke underneath fakes the neon bloom.
    hullPath();
    ctx.strokeStyle = 'rgba(34,211,238,0.26)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const hg = ctx.createLinearGradient(u * 2.1, 0, -u * 1.1, 0);
    hg.addColorStop(0, flash ? '#ffffff' : '#3d9fb8');
    hg.addColorStop(0.45, flash ? '#ffffff' : '#11455a');
    hg.addColorStop(1, flash ? '#ffffff' : '#061520');
    hullPath();
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = flash ? '#ffffff' : (this.invuln > 0 ? '#ff8fb0' : '#c8fdff');
    ctx.lineWidth = 1.9;
    ctx.stroke();

    // Inner plate: a second, narrower silhouette gives the hull depth.
    const inner = [
      [1.82, 0.00],
      [0.50, 0.22],
      [-0.32, 0.27],
      [-0.86, 0.13],
      [-0.86, 0.00]
    ];
    ctx.beginPath();
    ctx.moveTo(inner[0][0] * u, 0);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i][0] * u, inner[i][1] * u);
    for (let i = inner.length - 2; i >= 0; i--) ctx.lineTo(inner[i][0] * u, -inner[i][1] * u);
    ctx.closePath();
    ctx.fillStyle = flash ? '#ffffff' : 'rgba(2,10,16,0.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,250,255,0.32)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Wing stripes.
    ctx.strokeStyle = 'rgba(34,211,238,0.75)';
    ctx.lineWidth = 1;
    for (let s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(-0.02 * u, s * 0.52 * u);
      ctx.lineTo(-0.62 * u, s * 1.26 * u);
      ctx.stroke();
    }

    // Bright spine: gives the silhouette a clear axis even at 30px.
    ctx.strokeStyle = 'rgba(220,255,255,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(2.05 * u, 0);
    ctx.lineTo(0.55 * u, 0);
    ctx.stroke();

    // ---- cockpit ----
    const cg = ctx.createLinearGradient(0.95 * u, 0, -0.25 * u, 0);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.55, '#a9f7ff');
    cg.addColorStop(1, '#1aa6c4');
    ctx.beginPath();
    ctx.moveTo(0.98 * u, 0);
    ctx.quadraticCurveTo(0.35 * u, 0.23 * u, -0.12 * u, 0.13 * u);
    ctx.quadraticCurveTo(-0.30 * u, 0, -0.12 * u, -0.13 * u);
    ctx.quadraticCurveTo(0.35 * u, -0.23 * u, 0.98 * u, 0);
    ctx.closePath();
    ctx.fillStyle = flash ? '#ffffff' : cg;
    ctx.fill();

    // ---- navigation lights ----
    const pulse = 0.55 + Math.sin(t * 5.5) * 0.3;
    ND.drawGlow(ctx, '#ff6bd6', -0.62 * u, 1.3 * u, u * 0.55, pulse * 0.9);
    ND.drawGlow(ctx, '#8ef0ff', -0.62 * u, -1.3 * u, u * 0.55, pulse * 0.9);

    // Invulnerability flicker.
    if (this.invuln > 0) {
      ND.drawGlow(ctx, '#ff3b6b', 0, 0, u * 2.2, 0.14 + Math.sin(t * 28) * 0.07);
    }

    ctx.restore();
  };

  // =========================================================
  // ENEMIES
  // =========================================================
  const ENEMY_TYPES = {
    chaser: {
      r: 15, hp: 20, speed: 138, dmg: 9, xp: 1, color: '#ff3b6b', score: 10, sides: 3
    },
    drifter: {
      r: 17, hp: 34, speed: 88, dmg: 11, xp: 2, color: '#a06bff', score: 18, sides: 4
    },
    shooter: {
      r: 16, hp: 30, speed: 74, dmg: 8, xp: 3, color: '#ffb020', score: 25, sides: 5,
      ranged: true
    },
    tank: {
      r: 26, hp: 120, speed: 52, dmg: 18, xp: 6, color: '#ff5f3b', score: 55, sides: 6
    },
    splitter: {
      r: 22, hp: 60, speed: 96, dmg: 12, xp: 4, color: '#3bff9e', score: 40, sides: 8,
      splits: 3
    }
  };

  ND.spawnEnemy = function (type, x, y, game) {
    const def = ENEMY_TYPES[type];
    // Health scales *geometrically* (1.175x per wave). The old linear 1+0.13w
    // curve fell behind the player's multiplicative damage upgrades: by wave 15
    // a single bullet one-shot everything and the run stopped having a curve.
    // Geometric keeps time-to-kill roughly flat (0.16s -> 0.08s) instead.
    const ringMul = Math.pow(1.175, game.wave - 1);
    const e = {
      type: type,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      r: def.r * SHIP,
      hp: def.hp * ringMul,
      maxHp: def.hp * ringMul,
      // Speed and damage used to cap out at wave ~14 and ~18 respectively, after
      // which late waves were just more bodies at the same pressure. The caps
      // are higher now so dodging keeps mattering deep into a run.
      speed: def.speed * Math.min(1.85, 1 + (game.wave - 1) * 0.05),
      dmg: def.dmg * Math.min(2.8, 1 + (game.wave - 1) * 0.075),
      xp: def.xp,
      color: def.color,
      score: def.score,
      sides: def.sides,
      angle: ND.rand(0, TAU),
      spin: ND.rand(-1.6, 1.6),
      flash: 0,
      ranged: !!def.ranged,
      fireCd: ND.rand(0.8, 2),
      splits: def.splits || 0,
      knockX: 0,
      knockY: 0,
      ramCd: 0,
      seed: ND.rand(0, 100)
    };
    game.enemies.push(e);
    return e;
  };

  ND.ENEMY_TYPES = ENEMY_TYPES;

  ND.updateEnemy = function (e, dt, game) {
    const p = game.player;
    e.flash = Math.max(0, e.flash - dt * 6);
    e.angle += e.spin * dt;

    let dx = ND.delta(e.x, p.x, ND.WORLD.w);
    let dy = ND.delta(e.y, p.y, ND.WORLD.h);
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;

    let sp = e.speed;

    if (e.type === 'chaser') {
      sp *= 1 + Math.sin(performance.now() / 240 + e.seed) * 0.14;
    } else if (e.type === 'shooter') {
      // keep mid range and strafe
      const want = 320;
      const tangentX = -dy, tangentY = dx;
      const radial = d > want + 60 ? 1 : d < want - 60 ? -0.9 : 0;
      e.vx = (dx * radial + tangentX * 0.7) * sp;
      e.vy = (dy * radial + tangentY * 0.7) * sp;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      e.fireCd -= dt;
      if (e.fireCd <= 0 && d < 700) {
        e.fireCd = ND.rand(1.4, 2.3);
        const a = Math.atan2(
          ND.delta(e.y, p.y, ND.WORLD.h),
          ND.delta(e.x, p.x, ND.WORLD.w)
        );
        game.bullets.push({
          hostile: true,
          x: e.x, y: e.y,
          vx: Math.cos(a) * 300,
          vy: Math.sin(a) * 300,
          r: 5, dmg: e.dmg * 0.7, life: 2.4, color: '#ffb020'
        });
        ND.audio.play('hit');
      }
      return;
    } else if (e.type === 'tank') {
      sp *= 0.85;
    } else if (e.type === 'splitter') {
      sp *= 1 + Math.sin(performance.now() / 400 + e.seed) * 0.25;
    }

    e.vx = dx * sp;
    e.vy = dy * sp;

    // knockback decay
    e.x += (e.vx + e.knockX) * dt;
    e.y += (e.vy + e.knockY) * dt;
    e.knockX *= Math.max(0, 1 - 9 * dt);
    e.knockY *= Math.max(0, 1 - 9 * dt);

    e.x = ND.wrapX(e.x);
    e.y = ND.wrapY(e.y);
  };

  // Push overlapping enemies apart so a wave reads as a swarm, not one blob.
  // Uses a uniform spatial grid so this stays cheap with many enemies.
  ND.separateEnemies = function (enemies) {
    const CELL = 64;
    const cols = Math.ceil(ND.WORLD.w / CELL) + 1;
    const rows = Math.ceil(ND.WORLD.h / CELL) + 1;
    const grid = new Map();

    const key = (cx, cy) => cx + ',' + cy;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const cx = (e.x / CELL) | 0;
      const cy = (e.y / CELL) | 0;
      const k = key(cx, cy);
      let bucket = grid.get(k);
      if (!bucket) { bucket = []; grid.set(k, bucket); }
      bucket.push(e);
    }

    const touched = new Set();

    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      const cx = (a.x / CELL) | 0;
      const cy = (a.y / CELL) | 0;

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          // Wrap the neighbour lookup so enemies on opposite sides of a seam
          // still push each other apart.
          const nx = (cx + ox + cols) % cols;
          const ny = (cy + oy + rows) % rows;
          const bucket = grid.get(key(nx, ny));
          if (!bucket) continue;

          for (let j = 0; j < bucket.length; j++) {
            const b = bucket[j];
            if (b === a) continue;

            let dx = ND.delta(a.x, b.x, ND.WORLD.w);
            let dy = ND.delta(a.y, b.y, ND.WORLD.h);
            const minD = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD || d2 === 0) continue;

            const d = Math.sqrt(d2);
            const overlap = (minD - d) * 0.5;
            dx /= d; dy /= d;

            // Split the correction so both parties move, biased by mass.
            const total = a.r + b.r;
            const aShare = b.r / total;
            const bShare = a.r / total;

            a.x -= dx * overlap * aShare;
            a.y -= dy * overlap * aShare;
            b.x += dx * overlap * bShare;
            b.y += dy * overlap * bShare;

            touched.add(a);
            touched.add(b);
          }
        }
      }
    }

    // Keep everyone in-bounds after being nudged (wrapping, not clamping).
    if (touched.size) {
      touched.forEach((e) => {
        e.x = ND.wrapX(e.x);
        e.y = ND.wrapY(e.y);
      });
    }
  };

  // Enemy art. One readable silhouette per type, so a wave can be parsed at a
  // glance: darts chase, diamonds drift, pentagons shoot, hexagons tank, stars
  // split. The aura is an additive sprite rather than a blur pass.
  ND.drawEnemy = function (ctx, e) {
    const t = performance.now() / 1000;
    const hpT = e.hp / e.maxHp;
    const col = e.flash > 0 ? '#ffffff' : e.color;
    const r = e.r;

    // One glow only for bosses: a sprite per enemy was measurably slower than
    // the wide translucent stroke below, which already reads as neon bloom.
    if (e.boss) ND.drawGlow(ctx, col, e.x, e.y, r * 3.4, 0.42);

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    function poly(n, scale, rot) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (rot || 0) + (i / n) * TAU;
        const px = Math.cos(a) * r * scale;
        const py = Math.sin(a) * r * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    // ---- silhouette ----
    if (e.type === 'chaser') {
      // Dart: sharp nose, notched tail. Reads as "coming at you".
      ctx.beginPath();
      ctx.moveTo(r * 1.35, 0);
      ctx.lineTo(-r * 0.62, r * 0.92);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.62, -r * 0.92);
      ctx.closePath();
    } else if (e.type === 'splitter') {
      // Eight-point star with alternating long/short spikes.
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rad = r * (i % 2 ? 0.52 : 1.08);
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      poly(e.sides, 1, 0);
    }

    // Wide dim stroke under the bright one fakes the bloom.
    ctx.strokeStyle = 'rgba(' + ND.toRgb(col) + ',0.18)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.fillStyle = e.flash > 0 ? 'rgba(255,255,255,0.92)' : 'rgba(8,10,18,0.88)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = e.boss ? 2.6 : 1.9;
    ctx.stroke();

    // ---- type details ----
    if (e.type === 'drifter') {
      // Two counter-rotating arc segments: a slow, hypnotic orbit.
      ctx.lineWidth = 1.2;
      for (let s = 0; s < 2; s++) {
        const base = t * (s ? -0.9 : 1.3) + s * Math.PI;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.3, base, base + 1.15);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (e.type === 'shooter') {
      // Barrel + muzzle.
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(r * 0.55, -r * 0.17, r * 0.95, r * 0.34);
      ctx.globalAlpha = 1;
      ND.drawGlow(ctx, col, r * 1.5, 0, r * 0.5, 0.75);
    } else if (e.type === 'tank') {
      // Armour plate + rivets.
      poly(6, 0.62, Math.PI / 6);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, r * 0.09, 0, TAU);
        ctx.fill();
      }
    } else if (e.type === 'chaser') {
      // Spine highlight.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.lineTo(-r * 0.25, 0);
      ctx.stroke();
    } else if (e.type === 'splitter') {
      // Inner gear ring.
      poly(6, 0.44, t * 1.4);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (e.boss) {
      // Boss gets two counter-rotating rings around the body.
      ctx.lineWidth = 1.6;
      for (let s = 0; s < 2; s++) {
        const a0 = t * (s ? -0.55 : 0.8);
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.5 + s * 0.35), a0, a0 + 2.4);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- core ----
    const pulse = 0.55 + Math.sin(t * 4 + e.seed) * 0.28;
    ctx.beginPath();
    ctx.arc(0, 0, r * (e.boss ? 0.3 : 0.26), 0, TAU);
    ctx.fillStyle = col;
    ctx.globalAlpha = pulse;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();

    // hp bar
    if (hpT < 1) {
      const w = Math.max(14, e.r * 2);
      const gap = 8 * ND.SHIP_SCALE;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w / 2, e.y - e.r - gap, w, 3.5);
      ctx.fillStyle = hpT > 0.4 ? '#3bff9e' : '#ff3b6b';
      ctx.fillRect(e.x - w / 2, e.y - e.r - gap, w * hpT, 3.5);
    }
  };

  // =========================================================
  // PICKUPS
  // =========================================================
  ND.spawnPickup = function (x, y, type, value, game) {
    game.pickups.push({
      x: x, y: y, type: type, value: value,
      vx: ND.rand(-90, 90), vy: ND.rand(-90, 90),
      life: 22, seed: ND.rand(0, TAU), bob: 0
    });
  };

  // =========================================================
  // SPECIALS — boss-kill rewards
  // =========================================================
  // Defeating a boss grants one of these. You can hold at most
  // ND.MAX_SPECIALS, after which extra boss kills pay out scrap instead.
  // Actives fire on R; passives tick on their own.
  ND.MAX_SPECIALS = 3;

  ND.SPECIALS = [
    {
      id: 'nova',
      name: 'NOVA CORE',
      desc: 'R: detonate a shockwave that shreds nearby hostiles',
      color: '#22d3ee',
      active: true,
      cooldown: 9,
      fire: (p, game) => {
        const R = 340;
        ND.spawnParticles(p.x, p.y, 60, {
          color: '#22d3ee', speed: 720, life: 0.6, size: 4.5, drag: 2.2
        });
        ND.addShake(16);
        ND.audio.play('explode');
        game.novaFx = { x: p.x, y: p.y, r: 0, max: R, life: 0.5 };
        for (const e of game.enemies.slice()) {
          const d = ND.distT(p.x, p.y, e.x, e.y);
          if (d < R + e.r) ND.damageEnemy(e, p.damage * 4.5, false);
        }
      }
    },
    {
      id: 'dilation',
      name: 'TIME DILATION',
      desc: 'R: slow every hostile to a crawl for 4s',
      color: '#a06bff',
      active: true,
      cooldown: 14,
      fire: (p, game) => {
        game.slowTime = 4;
        ND.addShake(6);
        ND.audio.play('dash');
        ND.spawnParticles(p.x, p.y, 40, {
          color: '#a06bff', speed: 420, life: 0.8, size: 3, drag: 1.6
        });
      }
    },
    {
      id: 'aegis',
      name: 'AEGIS PLATING',
      desc: 'Passive: absorbs one hit, recharges every 7s',
      color: '#3bff9e',
      active: false
    },
    {
      id: 'drone',
      name: 'ORBITAL DRONE',
      desc: 'Passive: a drone circles you and fires on its own',
      color: '#ffd166',
      active: false
    },
    {
      id: 'singularity',
      name: 'BLACK HOLE',
      desc: 'R: collapse hostiles into a point, then detonate',
      color: '#ff2b8a',
      active: true,
      cooldown: 16,
      fire: (p, game) => {
        // Aim at the densest nearby cluster.
        let best = null, bestScore = -1;
        for (const e of game.enemies) {
          if (ND.distT(p.x, p.y, e.x, e.y) > 620) continue;
          let s = 0;
          for (const o of game.enemies) {
            if (ND.distT(e.x, e.y, o.x, o.y) < 170) s++;
          }
          if (s > bestScore) { bestScore = s; best = e; }
        }
        const tx = best ? best.x : p.x + Math.cos(p.angle) * 320;
        const ty = best ? best.y : p.y + Math.sin(p.angle) * 320;
        game.blackHole = { x: tx, y: ty, life: 1.1, t: 0 };
        ND.audio.play('boss');
      }
    }
  ];

  ND.SPECIAL_BY_ID = {};
  ND.SPECIALS.forEach((s) => { ND.SPECIAL_BY_ID[s.id] = s; });

  // Cost in scrap for the next upgrade. Price scales with how many upgrades you
  // have already bought (not with that upgrade's level) so spreading thin is no
  // cheaper than going deep — farming is what actually buys power.
  // The multiplier is 1.42 (was 1.0), because kills pay out far faster than a
  // flat 7/level curve can absorb: a bot run banked 486 unspent scrap by wave
  // 12, which meant the price was never actually a decision. 1.42 keeps the
  // bank near zero without making late upgrades unaffordable.
  ND.upgradeCost = function (up, totalBought) {
    const weaponMul = up.weapon ? 1.5 : 1;
    return Math.round((10 + Math.pow(totalBought, 1.42) * 6) * weaponMul);
  };

  // Scrap paid out for killing an enemy. Scaled off its score so tough
  // enemies are worth farming; bosses are a windfall.
  ND.scrapValue = function (e, mul) {
    const base = e.boss ? 120 : Math.max(1, Math.round((e.score || 10) / 5));
    return Math.max(1, Math.round(base * (mul || 1)));
  };

  // Stacking enough points in related upgrades unlocks a set bonus. These are
  // checked against `game.upgradeCounts` (not the player) so they reset with
  // the run, and `apply` only configures flags — the real work happens in the
  // damage pipeline so it stays cheap.
  ND.SYNERGIES = [
    {
      id: 'incendiary',
      name: 'INCENDIARY',
      desc: 'Bullets set targets alight',
      needs: [['dmg', 4], ['bspeed', 2]],
      color: '#ff8a3c',
      apply: (p) => { p.ignite = 0.3; }   // fraction of hit damage as burn / sec
    },
    {
      id: 'overload',
      name: 'OVERLOAD',
      desc: 'Crits detonate for splash',
      needs: [['crit', 3], ['dmg', 3]],
      color: '#ffe066',
      apply: (p) => { p.critBurst = true; }
    },
    {
      id: 'bulwark',
      name: 'BULWARK',
      desc: 'Damage taken reduced 22%',
      needs: [['hp', 2], ['regen', 2]],
      color: '#3bff9e',
      apply: (p) => { p.armor = 0.22; }
    },
    {
      id: 'hunter',
      name: 'HUNTER',
      desc: 'Kills restore 2x health',
      needs: [['lifesteal', 2], ['magnet', 2]],
      color: '#a06bff',
      apply: (p) => { p.leechMul = 2; }
    },
    {
      id: 'railgun',
      name: 'RAILGUN',
      desc: 'RAIL: shots pierce terrain-thin',
      needs: [['railLance', 2], ['railCharge', 2]],
      color: '#22d3ee',
      apply: (p) => { p.railSurge = true; }
    },
    {
      id: 'buckshot',
      name: 'BUCKSHOT',
      desc: 'SCATTER: pellets ricochet once',
      needs: [['scatterPellets', 2], ['multi', 2]],
      color: '#ffd166',
      apply: (p) => { p.ricochet = 1; }
    },
    {
      id: 'juggernaut',
      name: 'JUGGERNAUT',
      desc: 'Dashing burns 50% hotter',
      needs: [['ram', 2], ['dash', 2]],
      color: '#ff3b6b',
      apply: (p) => { p.ramSynergy = 1.5; }
    }
  ];

  // Which synergy ids the player currently qualifies for.
  ND.activeSynergies = function (counts) {
    const out = [];
    for (const s of ND.SYNERGIES) {
      if (s.needs.every((n) => (counts[n[0]] || 0) >= n[1])) out.push(s);
    }
    return out;
  };

  // Re-evaluate synergies and stamp the resulting flags onto the player.
  // Safe to call every level-up; effects are absolute, not cumulative.
  ND.applySynergies = function (player, counts) {
    player.ignite = 0;
    player.critBurst = false;
    player.armor = 0;
    player.leechMul = 1;
    player.railSurge = false;
    player.ricochet = 0;
    player.ramSynergy = 1;

    const active = ND.activeSynergies(counts);
    for (const s of active) s.apply(player);
    player.synergies = active;
    return active;
  };

  // =========================================================
  // UPGRADES
  // =========================================================
  // `max` is the level cap; omitted means unlimited. `tier` drives the colour
  // accent so a maxed build reads at a glance.
  ND.UPGRADES = [
    { id: 'dmg', name: 'Overcharge', desc: 'Bullet damage +18%', max: 7, apply: (p) => { p.damage *= 1.18; } },
    { id: 'rate', name: 'Hyper Cycle', desc: 'Fire rate +14%', max: 6, apply: (p) => { p.fireRate *= 1.14; } },
    { id: 'multi', name: 'Split Barrel', desc: '+1 projectile per shot', max: 5, apply: (p) => { p.bullets += 1; } },
    { id: 'speed', name: 'Afterburner', desc: 'Move speed +12%', max: 6, apply: (p) => { p.speed *= 1.12; } },
    { id: 'hp', name: 'Hull Plating', desc: 'Max HP +25 and heal 25', max: 6, apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { id: 'pierce', name: 'Railround', desc: 'Bullets pierce +1 enemy', max: 3, apply: (p) => { p.pierce += 1; } },
    { id: 'crit', name: 'Weakpoint AI', desc: 'Crit chance +10%', max: 6, apply: (p) => { p.crit += 0.1; } },
    { id: 'magnet', name: 'Tractor Field', desc: 'Pickup range +80', max: 4, apply: (p) => { p.magnet += 80; } },
    { id: 'dash', name: 'Phase Coils', desc: 'Dash cooldown -22%', max: 4, apply: (p) => { p.dashMax *= 0.78; } },
    { id: 'regen', name: 'Nanorepair', desc: 'Regenerate 1.4 HP/sec', max: 4, apply: (p) => { p.regen += 1.4; } },
    { id: 'lifesteal', name: 'Vampiric Rounds', desc: 'Heal 1.5 HP on kill', max: 4, apply: (p) => { p.lifesteal += 1.5; } },
    { id: 'bspeed', name: 'Velocity Rounds', desc: 'Bullet speed +20%', max: 4, apply: (p) => { p.bulletSpeed *= 1.2; p.bulletLife *= 1.08; } },

    // ---- weapon-specific ----
    {
      id: 'scatterPellets',
      name: 'Buckshot',
      desc: 'SCATTER: +2 pellets, tighter spread',
      max: 4,
      weapon: 'scatter',
      apply: (p) => { p.scatterBonus += 2; p.scatterTighten *= 0.9; }
    },
    {
      id: 'railLance',
      name: 'Rail Lance',
      desc: 'RAIL: +2 pierce and +25% damage',
      max: 3,
      weapon: 'rail',
      apply: (p) => { p.railPierce += 2; p.railDmgMul *= 1.25; }
    },
    {
      id: 'railCharge',
      name: 'Overcharged Lance',
      desc: 'RAIL: 30% faster charge, wider beam',
      max: 3,
      weapon: 'rail',
      apply: (p) => { p.railRate *= 1.3; p.railWidth += 0.5; }
    },
    {
      id: 'pulseFlak',
      name: 'Pulse Flak',
      desc: 'PULSE: shots split on impact',
      max: 2,
      weapon: 'pulse',
      apply: (p) => { p.flak += 2; }
    },
    {
      id: 'ram',
      name: 'Ram Plating',
      desc: 'Dashing into enemies burns them for +80%',
      max: 3,
      apply: (p) => { p.ramMul += 0.8; }
    }
  ];

  // Fast lookup by id, plus an icon id for every upgrade.
  ND.UPGRADE_BY_ID = {};
  ND.UPGRADES.forEach((u) => {
    u.icon = u.id;
    ND.UPGRADE_BY_ID[u.id] = u;
  });

  // =========================================================
  // META PROGRESSION (permanent, stored locally)
  // =========================================================
  // These are bought with CORES between runs, so a death still pays out. They
  // are deliberately modest: the goal is to soften bad runs, not to replace
  // the in-run build. Each is applied once at spawn by ND.applyMeta().
  ND.META = [
    {
      id: 'mHull',
      name: 'Reinforced Hull',
      desc: '+15 starting hull per level',
      max: 3,
      cost: 40,
      color: '#22d3ee',
      apply: (p, lvl) => { p.maxHp += 15 * lvl; p.hp = p.maxHp; }
    },
    {
      id: 'mDamage',
      name: 'Calibrated Barrels',
      desc: '+7% weapon damage per level',
      max: 3,
      cost: 50,
      color: '#ffb020',
      apply: (p, lvl) => { p.damage *= 1 + 0.07 * lvl; }
    },
    {
      id: 'mScrap',
      name: 'Salvage Rig',
      desc: '+12% scrap from every kill per level',
      max: 3,
      cost: 45,
      color: '#3bff9e',
      apply: (p, lvl) => { p.scrapMul = 1 + 0.12 * lvl; }
    },
    {
      id: 'mDash',
      name: 'Afterburner Coils',
      desc: '-8% dash cooldown per level',
      max: 3,
      cost: 35,
      color: '#a06bff',
      apply: (p, lvl) => { p.dashMax *= 1 - 0.08 * lvl; }
    },
    {
      id: 'mStart',
      name: 'Scrap Stipend',
      desc: '+18 starting scrap per level',
      max: 3,
      cost: 30,
      color: '#ffd166',
      apply: () => {} // handled by ND.metaStartScrap, applied to the run bank
    }
  ];

  ND.META_BY_ID = {};
  ND.META.forEach((m) => {
    m.icon = m.id === 'mScrap' || m.id === 'mStart' ? 'salvage' : (m.id === 'mHull' ? 'hp' : m.id === 'mDamage' ? 'dmg' : m.id === 'mDash' ? 'dash' : 'core');
    ND.META_BY_ID[m.id] = m;
  });

  // Cost of the NEXT level of a meta upgrade, given how many are already owned.
  ND.metaCost = function (up, owned) {
    return Math.round(up.cost * (1 + owned * 0.85) / 5) * 5;
  };

  // Cores earned for a finished run. Deliberately sublinear so a lucky deep run
  // doesn't trivialize the tree, and always at least 1 so every run pays.
  ND.coresForRun = function (score, wave) {
    const s = Math.max(0, Number(score) || 0);
    const w = Math.max(1, Number(wave) || 1);
    return Math.max(1, Math.floor(s / 100) + Math.floor(w / 2));
  };

  // Apply every owned meta upgrade to a freshly spawned player.
  ND.applyMeta = function (p, levels) {
    if (!p) return;
    p.scrapMul = 1;
    for (const up of ND.META) {
      const lvl = Math.max(0, Math.min(up.max, (levels && levels[up.id]) | 0));
      if (lvl > 0 && typeof up.apply === 'function') up.apply(p, lvl);
    }
  };

  ND.metaStartScrap = function (levels) {
    const lvl = Math.max(0, Math.min(3, (levels && levels.mStart) | 0));
    return lvl * 18;
  };
})(window.ND);
