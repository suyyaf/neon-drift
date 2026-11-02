/* NEON DRIFT — entities: player, bullets, enemies, pickups, upgrades. */
(function (ND) {
  'use strict';

  const TAU = ND.TAU;

  // =========================================================
  // PLAYER
  // =========================================================
  ND.Player = function () {
    this.x = ND.WORLD.w / 2;
    this.y = ND.WORLD.h / 2;
    this.r = 13;
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
    if (k.has('w') || k.has('arrowup')) iy -= 1;
    if (k.has('s') || k.has('arrowdown')) iy += 1;
    if (k.has('a') || k.has('arrowleft')) ix -= 1;
    if (k.has('d') || k.has('arrowright')) ix += 1;
    const len = Math.hypot(ix, iy) || 1;
    ix /= len; iy /= len;

    this.dashCd = Math.max(0, this.dashCd - dt);
    this.dashTime = Math.max(0, this.dashTime - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);

    // dash
    if ((k.has(' ') || k.has('shift')) && this.dashCd <= 0 && (ix || iy || this.moving)) {
      this.dashTime = 0.16;
      this.dashCd = this.dashMax;
      this.invuln = Math.max(this.invuln, 0.22);
      // Fall back to the last facing so a dash is always a finite direction.
      this.dashDx = (ix || this.lastDx || 1) || 1;
      this.dashDy = (iy || this.lastDy || 0) || 0;
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

    this.x = ND.clamp(this.x, this.r, ND.WORLD.w - this.r);
    this.y = ND.clamp(this.y, this.r, ND.WORLD.h - this.r);

    // aim at mouse in world space
    const mx = ND.mouse.x + game.camX;
    const my = ND.mouse.y + game.camY;
    this.angle = Math.atan2(my - this.y, mx - this.x);

    // shooting
    this.cooldown -= dt;
    if (ND.mouse.down && this.cooldown <= 0) {
      this.shoot(game);
      this.cooldown = 1 / (this.fireRate * this.weaponDef().rate);
    }

    // regen
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
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

  ND.Player.prototype.cycleWeapon = function (dir) {
    const n = ND.WEAPONS.length;
    this.weapon = (this.weapon + (dir || 1) + n) % n;
    this.cooldown = Math.min(this.cooldown, 0.12);
    ND.audio.play('switch');
    return ND.WEAPONS[this.weapon];
  };

  ND.Player.prototype.shoot = function (game) {
    const w = this.weaponDef();
    const n = w.count || this.bullets;
    const spread = n > 1 ? w.spread : 0;
    const base = n > 1 ? this.angle - spread * (n - 1) / 2 : this.angle;
    const speed = this.bulletSpeed * w.speed;

    for (let i = 0; i < n; i++) {
      const a = base + spread * i + ND.rand(-0.018, 0.018);
      const isCrit = Math.random() < this.crit;
      const dmg = this.damage * w.dmg * (isCrit ? 2.4 : 1);
      game.bullets.push({
        x: this.x + Math.cos(a) * (this.r + 8),
        y: this.y + Math.sin(a) * (this.r + 8),
        vx: Math.cos(a) * speed * ND.rand(0.97, 1.03),
        vy: Math.sin(a) * speed * ND.rand(0.97, 1.03),
        r: (isCrit ? 6 : 4) * (w.id === 'rail' ? 1.35 : 1),
        dmg: dmg,
        crit: isCrit,
        pierce: this.pierce + w.pierce,
        hits: [],
        life: this.bulletLife * w.life,
        color: isCrit ? '#ffe066' : w.color,
        width: w.width
      });
    }

    // muzzle flash
    ND.spawnParticles(
      this.x + Math.cos(this.angle) * (this.r + 10),
      this.y + Math.sin(this.angle) * (this.r + 10),
      w.id === 'scatter' ? 8 : 4,
      { color: w.color, speed: 260, life: 0.14, size: 2.6, dir: this.angle, spread: w.id === 'scatter' ? 1.1 : 0.7, drag: 6 }
    );
    this.vx -= Math.cos(this.angle) * w.kick;
    this.vy -= Math.sin(this.angle) * w.kick;
    ND.audio.play('shoot');
  };

  ND.Player.prototype.hurt = function (dmg) {
    if (this.invuln > 0 || this.dashTime > 0) return false;
    this.hp -= dmg;
    this.invuln = 0.35;
    this.hurtFlash = 1;
    ND.addShake(7);
    ND.audio.play('hurt');
    ND.spawnParticles(this.x, this.y, 12, {
      color: '#ff3b6b', speed: 260, life: 0.5, size: 3
    });
    return true;
  };

  ND.Player.prototype.gainXp = function (amount, game) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(this.xpNext * 1.34 + 3);
      game.pendingLevels++;
    }
  };

  ND.Player.prototype.draw = function (ctx) {
    const t = performance.now() / 1000;

    // dash cooldown ring
    if (this.dashCd > 0) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 12, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - this.dashCd / this.dashMax));
      ctx.strokeStyle = 'rgba(34,211,238,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 12, 0, TAU);
      ctx.strokeStyle = 'rgba(34,211,238,0.85)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // thruster glow behind
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 40) {
      ctx.beginPath();
      ctx.moveTo(-this.r - 2, -5);
      ctx.lineTo(-this.r - 10 - Math.min(16, sp * 0.03), 0);
      ctx.lineTo(-this.r - 2, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,211,238,' + Math.min(0.6, sp / 520) + ')';
      ctx.fill();
    }

    // ship body
    const flash = this.hurtFlash > 0.5;
    ctx.beginPath();
    ctx.moveTo(this.r + 6, 0);
    ctx.lineTo(-this.r * 0.7, this.r * 0.85);
    ctx.lineTo(-this.r * 0.25, 0);
    ctx.lineTo(-this.r * 0.7, -this.r * 0.85);
    ctx.closePath();

    ctx.fillStyle = flash ? '#ffffff' : '#0b2530';
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = flash ? '#ffffff' : (this.invuln > 0 ? '#ff8fb0' : '#5ff0ff');
    ctx.shadowColor = this.invuln > 0 ? '#ff3b6b' : '#22d3ee';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // cockpit
    ctx.beginPath();
    ctx.arc(0, 0, 3.2 + Math.sin(t * 6) * 0.6, 0, TAU);
    ctx.fillStyle = '#d8feff';
    ctx.shadowColor = '#bff6ff';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

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
    const ringMul = 1 + (game.wave - 1) * 0.13;
    const e = {
      type: type,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      r: def.r,
      hp: def.hp * ringMul,
      maxHp: def.hp * ringMul,
      speed: def.speed * Math.min(1.55, 1 + (game.wave - 1) * 0.045),
      dmg: def.dmg * Math.min(2, 1 + (game.wave - 1) * 0.06),
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

    let dx = p.x - e.x;
    let dy = p.y - e.y;
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
        const a = Math.atan2(p.y - e.y, p.x - e.x);
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

    // separation (cheap, avoids stacking)
    e.x = ND.clamp(e.x, e.r, ND.WORLD.w - e.r);
    e.y = ND.clamp(e.y, e.r, ND.WORLD.h - e.r);
  };

  ND.drawEnemy = function (ctx, e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    const hpT = e.hp / e.maxHp;
    const col = e.flash > 0 ? '#ffffff' : e.color;

    ctx.beginPath();
    for (let i = 0; i < e.sides; i++) {
      const a = (i / e.sides) * TAU - Math.PI / 2;
      const px = Math.cos(a) * e.r;
      const py = Math.sin(a) * e.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(8,10,18,0.86)';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.stroke();

    // inner core
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 0.32, 0, TAU);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 200 + e.seed) * 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();

    // hp bar
    if (hpT < 1) {
      const w = e.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 3.5);
      ctx.fillStyle = hpT > 0.4 ? '#3bff9e' : '#ff3b6b';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * hpT, 3.5);
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
  // UPGRADES
  // =========================================================
  ND.UPGRADES = [
    { id: 'dmg', name: 'Overcharge', desc: 'Bullet damage +22%', glyph: 'dmg', apply: (p) => { p.damage *= 1.22; } },
    { id: 'rate', name: 'Hyper Cycle', desc: 'Fire rate +18%', apply: (p) => { p.fireRate *= 1.18; } },
    { id: 'multi', name: 'Split Barrel', desc: '+1 projectile per shot', max: 5, apply: (p) => { p.bullets += 1; } },
    { id: 'speed', name: 'Afterburner', desc: 'Move speed +12%', apply: (p) => { p.speed *= 1.12; } },
    { id: 'hp', name: 'Hull Plating', desc: 'Max HP +25 and heal 25', apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { id: 'pierce', name: 'Railround', desc: 'Bullets pierce +1 enemy', max: 3, apply: (p) => { p.pierce += 1; } },
    { id: 'crit', name: 'Weakpoint AI', desc: 'Crit chance +10%', apply: (p) => { p.crit += 0.1; } },
    { id: 'magnet', name: 'Tractor Field', desc: 'Pickup range +80', apply: (p) => { p.magnet += 80; } },
    { id: 'dash', name: 'Phase Coils', desc: 'Dash cooldown -22%', apply: (p) => { p.dashMax *= 0.78; } },
    { id: 'regen', name: 'Nanorepair', desc: 'Regenerate 1.4 HP/sec', apply: (p) => { p.regen += 1.4; } },
    { id: 'lifesteal', name: 'Vampiric Rounds', desc: 'Heal 1.5 HP on kill', apply: (p) => { p.lifesteal += 1.5; } },
    { id: 'bspeed', name: 'Velocity Rounds', desc: 'Bullet speed +20%', apply: (p) => { p.bulletSpeed *= 1.2; p.bulletLife *= 1.08; } }
  ];
})(window.ND);
