/* NEON DRIFT — main loop, waves, camera, rendering, UI glue. */
(function (ND) {
  'use strict';

  const ctx = ND.ctx;
  const TAU = ND.TAU;
  const $ = (id) => document.getElementById(id);

  const game = {
    state: 'menu', // menu | playing | upgrade | paused | dead
    player: null,
    bullets: [],
    enemies: [],
    pickups: [],
    texts: [],
    camX: 0,
    camY: 0,
    wave: 1,
    waveTimer: 0,
    spawnTimer: 0,
    score: 0,
    time: 0,
    pendingLevels: 0,
    boss: null,
    gridOffset: 0,
    killstreak: 0,
    streakTimer: 0
  };
  ND.game = game;

  // ---------------- camera ----------------
  function updateCamera(dt) {
    const p = game.player;
    if (!p) return;
    const targetX = p.x + (p.vx || 0) * 0.22 - ND.view.w / 2;
    const targetY = p.y + (p.vy || 0) * 0.22 - ND.view.h / 2;
    const smooth = 1 - Math.pow(0.001, dt);
    game.camX = ND.lerp(game.camX, targetX, smooth);
    game.camY = ND.lerp(game.camY, targetY, smooth);
    game.camX = ND.clamp(game.camX, 0, Math.max(0, ND.WORLD.w - ND.view.w));
    game.camY = ND.clamp(game.camY, 0, Math.max(0, ND.WORLD.h - ND.view.h));
    if (ND.WORLD.w < ND.view.w) game.camX = (ND.WORLD.w - ND.view.w) / 2;
    if (ND.WORLD.h < ND.view.h) game.camY = (ND.WORLD.h - ND.view.h) / 2;
  }

  // ---------------- spawning ----------------
  function spawnPointAwayFromPlayer() {
    const p = game.player;
    // Spawn just outside the visible viewport so threats arrive promptly
    // instead of crawling in from the far world edges.
    const pad = 70;
    const vx = game.camX, vy = game.camY;
    const vw = ND.view.w, vh = ND.view.h;
    let x, y, tries = 0, best = null, bestD = -1;

    do {
      const side = ND.randInt(0, 3);
      if (side === 0) { x = vx + ND.rand(0, vw); y = vy - pad; }
      else if (side === 1) { x = vx + ND.rand(0, vw); y = vy + vh + pad; }
      else if (side === 2) { x = vx - pad; y = vy + ND.rand(0, vh); }
      else { x = vx + vw + pad; y = vy + ND.rand(0, vh); }

      x = ND.clamp(x, 30, ND.WORLD.w - 30);
      y = ND.clamp(y, 30, ND.WORLD.h - 30);

      const d = ND.dist(x, y, p.x, p.y);
      if (d > bestD) { bestD = d; best = { x, y }; }
      tries++;
    } while (ND.dist(x, y, p.x, p.y) < 260 && tries < 20);

    return best || { x, y };
  }

  function pickEnemyType() {
    const w = game.wave;
    const pool = ['chaser', 'chaser', 'chaser'];
    if (w >= 2) pool.push('drifter');
    if (w >= 3) pool.push('shooter');
    if (w >= 4) pool.push('splitter', 'drifter');
    if (w >= 6) pool.push('tank');
    if (w >= 7) pool.push('shooter', 'tank');
    return ND.pick(pool);
  }

  function spawnWaveEnemy() {
    const pt = spawnPointAwayFromPlayer();
    ND.spawnEnemy(pickEnemyType(), pt.x, pt.y, game);
  }

  function spawnBoss() {
    const pt = spawnPointAwayFromPlayer();
    const b = ND.spawnEnemy('tank', pt.x, pt.y, game);
    b.boss = true;
    b.r = 46;
    b.maxHp = 300 + game.wave * 180;
    b.hp = b.maxHp;
    b.speed = 62;
    b.dmg = 26;
    b.xp = 40;
    b.score = 400;
    b.sides = 10;
    b.color = '#ff2b8a';
    b.spin = 0.8;
    b.fireCd = 1.4;
    b.splits = 0;
    game.boss = b;
    ND.audio.play('boss');
    ND.addShake(10);
    toast('WARNING // ' + (game.wave) + '-CLASS SINGULARITY', '#ff2b8a');
  }

  // ---------------- floating text ----------------
  function toast(text, color) {
    game.texts.push({ text, color: color || '#8ef0ff', life: 2.2, maxLife: 2.2, y: 0 });
  }

  function floatText(x, y, text, color) {
    game.texts.push({ text, color, x, y, life: 0.85, maxLife: 0.85, vy: -60, world: true, size: 13 });
  }

  // ---------------- damage / death ----------------
  function damageEnemy(e, dmg, crit) {
    e.hp -= dmg;
    e.flash = 1;
    e.knockX += 0;
    if (e.hp <= 0) {
      killEnemy(e);
    } else {
      ND.audio.play('hit');
      ND.spawnParticles(e.x, e.y, 4, {
        color: e.color, speed: 180, life: 0.3, size: 2.5
      });
      if (crit) floatText(e.x, e.y - e.r, Math.round(dmg), '#ffe066');
    }
  }

  function killEnemy(e, kamikaze) {
    const p = game.player;
    const idx = game.enemies.indexOf(e);
    if (idx === -1) return;
    game.enemies.splice(idx, 1);

    // A kamikaze death still wipes the enemy off the field, but the player
    // gets no score, streak, or loot for it.
    if (!kamikaze) {
      game.score += e.score || 10;
      p.kills++;
      game.killstreak++;
      game.streakTimer = 2.6;
    } else {
      game.killstreak = 0;
      game.streakTimer = 0;
    }

    ND.spawnParticles(e.x, e.y, e.boss ? 90 : 16, {
      color: e.color,
      speed: e.boss ? 620 : 340,
      life: e.boss ? 1.1 : 0.6,
      size: e.boss ? 5 : 3
    });
    ND.audio.play('explode');
    ND.addShake(e.boss ? 22 : 3);

    if (!kamikaze && p.lifesteal > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.lifesteal);
      floatText(e.x, e.y - e.r - 8, '+' + Math.round(p.lifesteal), '#3bff9e');
    }

    if (kamikaze) {
      if (e.boss) {
        game.boss = null;
        toast('SINGULARITY COLLAPSED', '#ffb020');
      }
      return;
    }

    // xp orbs
    const drops = e.boss ? 14 : 1;
    for (let i = 0; i < drops; i++) {
      const ox = e.boss ? ND.rand(-40, 40) : 0;
      const oy = e.boss ? ND.rand(-40, 40) : 0;
      ND.spawnPickup(e.x + ox, e.y + oy, 'xp', e.xp, game);
    }
    // chance of health
    if (Math.random() < (e.boss ? 1 : 0.06)) {
      ND.spawnPickup(e.x, e.y, 'hp', e.boss ? 45 : 18, game);
    }

    // splitter children
    if (e.splits > 0) {
      for (let i = 0; i < e.splits; i++) {
        const a = (i / e.splits) * TAU;
        const child = ND.spawnEnemy('chaser', e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, game);
        child.r = 10;
        child.maxHp = child.hp = e.maxHp * 0.16;
        child.xp = 1;
        child.speed *= 1.25;
        child.color = '#3bff9e';
      }
    }

    if (e.boss) {
      game.boss = null;
      toast('SINGULARITY PURGED', '#3bff9e');
      ND.addShake(18);
    }
  }

  // ---------------- update ----------------
  function update(dt) {
    const p = game.player;
    game.time += dt;

    // Safety net: never let a bad frame poison the whole sim.
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.vx) || !isFinite(p.vy)) {
      p.x = ND.clamp(isFinite(p.x) ? p.x : ND.WORLD.w / 2, p.r, ND.WORLD.w - p.r);
      p.y = ND.clamp(isFinite(p.y) ? p.y : ND.WORLD.h / 2, p.r, ND.WORLD.h - p.r);
      p.vx = 0; p.vy = 0;
    }

    p.update(dt, game);

    // waves
    game.waveTimer += dt;
    const waveDuration = Math.max(14, 26 - game.wave * 0.8);
    if (game.waveTimer >= waveDuration && !game.boss) {
      game.waveTimer = 0;
      game.wave++;
      // First boss lands at wave 2 so the opening has a spike, then every 3rd.
      const isBossWave = game.wave === 2 || game.wave % 3 === 0;
      if (isBossWave) {
        spawnBoss();
      } else {
        toast('WAVE ' + game.wave, '#22d3ee');
        ND.audio.play('level');
      }
    }

    // continuous spawn pressure
    game.spawnTimer -= dt;
    const targetCount = Math.min(90, 14 + game.wave * 4);
    if (game.spawnTimer <= 0 && game.enemies.length < targetCount && !game.boss) {
      game.spawnTimer = Math.max(0.1, 0.58 - game.wave * 0.04);
      spawnWaveEnemy();
      if (game.wave > 1 && Math.random() < 0.55) spawnWaveEnemy();
    }

    // enemies
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const e = game.enemies[i];
      ND.updateEnemy(e, dt, game);

      // ---------------- contact / ram ----------------
      const rr = p.r + e.r;
      let cdx = e.x - p.x;
      let cdy = e.y - p.y;
      let cd = Math.hypot(cdx, cdy);

      if (cd < rr) {
        // Always separate first, so an enemy can never sit inside the ship,
        // even while the player is invulnerable or dashing.
        const nx = cd > 0.001 ? cdx / cd : 1;
        const ny = cd > 0.001 ? cdy / cd : 0;
        const overlap = rr - cd;

        e.x += nx * overlap;
        e.y += ny * overlap;

        const dashing = p.dashTime > 0;

        if (dashing || p.invuln > 0) {
          // RAM: an invulnerable ship burns whatever touches it.
          const ramMul = (dashing ? 3.4 : 0.7) * p.ramMul;
          e.knockX += nx * (dashing ? 620 : 300);
          e.knockY += ny * (dashing ? 620 : 300);

          if (!e.ramCd || e.ramCd <= 0) {
            e.ramCd = 0.16;
            ND.spawnParticles(e.x, e.y, dashing ? 14 : 6, {
              color: dashing ? '#7df9ff' : '#ffb020',
              speed: dashing ? 420 : 240,
              life: 0.42,
              size: 3
            });
            if (dashing) ND.addShake(4);
            damageEnemy(e, p.damage * ramMul, false);
          }
        } else if (p.hurt(e.dmg)) {
          e.knockX += nx * 380;
          e.knockY += ny * 380;

          // Chasers are kamikaze drones: they blow up on impact instead of
          // camping on top of the ship.
          if (e.type === 'chaser' || e.kamikaze) {
            ND.spawnParticles(e.x, e.y, 26, {
              color: e.color,
              speed: 520,
              life: 0.55,
              size: 4
            });
            ND.spawnParticles(e.x, e.y, 10, {
              color: '#ffd9a0',
              speed: 320,
              life: 0.4,
              size: 5
            });
            ND.addShake(9);
            ND.audio.play('explode');
            killEnemy(e, true);
          }
        }
      }

      if (e.ramCd > 0) e.ramCd -= dt;
    }

    // boss extra behavior: radial burst
    if (game.boss) {
      const b = game.boss;
      b.fireCd -= dt;
      if (b.fireCd <= 0) {
        b.fireCd = Math.max(0.9, 2.0 - game.wave * 0.05);
        const n = 12;
        const off = ND.rand(0, TAU);
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          game.bullets.push({
            hostile: true,
            x: b.x, y: b.y,
            vx: Math.cos(a) * 220,
            vy: Math.sin(a) * 220,
            r: 6, dmg: 12, life: 3.2, color: '#ff2b8a'
          });
        }
        ND.addShake(5);
      }
    }

    // bullets
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let dead = b.life <= 0 ||
        b.x < -60 || b.y < -60 || b.x > ND.WORLD.w + 60 || b.y > ND.WORLD.h + 60;

      if (!dead && b.hostile) {
        if (ND.dist(b.x, b.y, p.x, p.y) < p.r + b.r) {
          p.hurt(b.dmg);
          dead = true;
        }
      } else if (!dead) {
        for (let j = game.enemies.length - 1; j >= 0; j--) {
          const e = game.enemies[j];
          if (b.hits.indexOf(e) !== -1) continue;
          if (ND.dist(b.x, b.y, e.x, e.y) < e.r + b.r) {
            damageEnemy(e, b.dmg, b.crit);
            ND.spawnParticles(b.x, b.y, 5, {
              color: b.crit ? '#ffe066' : '#bff6ff', speed: 240, life: 0.25, size: 2.4
            });
            b.hits.push(e);

            // Pulse Flak: the round shatters into fragments on impact.
            if (b.flak > 0) {
              for (let f = 0; f < b.flak; f++) {
                const fa = Math.atan2(b.vy, b.vx) + Math.PI + ND.rand(-0.7, 0.7);
                const fs = 420;
                game.bullets.push({
                  x: b.x, y: b.y,
                  vx: Math.cos(fa) * fs,
                  vy: Math.sin(fa) * fs,
                  r: 2.5,
                  dmg: b.dmg * 0.45,
                  crit: false,
                  pierce: 0,
                  hits: [],
                  life: 0.3,
                  color: '#bff6ff',
                  width: 1.1,
                  flak: 0
                });
              }
            }

            if (b.pierce > 0) {
              b.pierce--;
            } else {
              dead = true;
            }
            break;
          }
        }
      }

      if (ND.dist(b.x, b.y, p.x, p.y) < 260) b.glow = true;

      if (dead) game.bullets.splice(i, 1);
    }

    // pickups
    for (let i = game.pickups.length - 1; i >= 0; i--) {
      const pk = game.pickups[i];
      pk.life -= dt;
      pk.seed += dt * 4;
      const d = ND.dist(pk.x, pk.y, p.x, p.y);

      // XP orbs always drift toward the player, faster when close.
      // Health orbs need to be walked over, so they keep the tight magnet only.
      const isOrb = pk.type === 'xp';
      const reach = isOrb ? 1200 : p.magnet + 40;

      if (d < reach) {
        const pull = isOrb
          ? 0.35 + 0.65 * (1 - d / reach)
          : 1 - d / (p.magnet + 40);
        const a = Math.atan2(p.y - pk.y, p.x - pk.x);
        const acc = (isOrb ? 1500 : 900) * pull * pull;
        pk.vx += Math.cos(a) * acc * dt;
        pk.vy += Math.sin(a) * acc * dt;
      }
      const drag = Math.max(0, 1 - 2.4 * dt);
      pk.vx *= drag;
      pk.vy *= drag;
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;

      if (d < p.r + 12) {
        if (pk.type === 'xp') {
          p.gainXp(pk.value, game);
          ND.audio.play('pickup');
          ND.spawnParticles(pk.x, pk.y, 4, { color: '#8ef0ff', speed: 120, life: 0.3, size: 2 });
        } else if (pk.type === 'hp') {
          p.hp = Math.min(p.maxHp, p.hp + pk.value);
          floatText(p.x, p.y - 24, '+' + pk.value, '#3bff9e');
          ND.audio.play('pickup');
        }
        game.pickups.splice(i, 1);
        continue;
      }

      if (pk.life <= 0) {
        // xp never fully vanishes; converts to direct xp at half value
        if (pk.type === 'xp') p.gainXp(Math.max(1, Math.round(pk.value * 0.5)), game);
        game.pickups.splice(i, 1);
      }
    }

    // floating texts
    for (let i = game.texts.length - 1; i >= 0; i--) {
      const t = game.texts[i];
      t.life -= dt;
      if (t.world) t.y += t.vy * dt;
      if (t.life <= 0) game.texts.splice(i, 1);
    }

    // streak decay
    if (game.streakTimer > 0) {
      game.streakTimer -= dt;
      if (game.streakTimer <= 0) game.killstreak = 0;
    }

    ND.updateParticles(dt);
    if (ND.shake > 0) ND.shake = Math.max(0, ND.shake - 44 * dt);

    // level ups
    if (game.pendingLevels > 0) {
      openUpgrades();
      return;
    }

    // death
    if (p.hp <= 0) die();
  }

  // ---------------- draw ----------------
  function drawGrid(ctx, camX, camY) {
    const size = 96;
    ctx.lineWidth = 1;
    const startX = -(camX % size);
    const startY = -(camY % size);

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.075)';
    ctx.beginPath();
    for (let x = startX; x < ND.view.w; x += size) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ND.view.h);
    }
    for (let y = startY; y < ND.view.h; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(ND.view.w, y);
    }
    ctx.stroke();

    // brighter intersections
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    for (let x = startX; x < ND.view.w; x += size) {
      for (let y = startY; y < ND.view.h; y += size) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  function drawWorldBounds(ctx, camX, camY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 59, 107, 0.35)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff3b6b';
    ctx.shadowBlur = 22;
    ctx.strokeRect(-camX, -camY, ND.WORLD.w, ND.WORLD.h);
    ctx.restore();
  }

  function drawPickup(ctx, pk) {
    const t = performance.now() / 1000;
    const bob = Math.sin(pk.seed) * 3;
    const fade = pk.life < 4 ? 0.35 + 0.65 * Math.abs(Math.sin(t * 9)) : 1;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(pk.x, pk.y + bob);

    if (pk.type === 'xp') {
      ctx.rotate(t * 2.4);
      ctx.fillStyle = 'rgba(142, 240, 255, 0.9)';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.shadowColor = '#3bff9e';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#3bff9e';
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);
    }
    ctx.restore();
  }

  function drawBullet(ctx, b) {
    ctx.save();
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const tx = -b.vx / speed;
    const ty = -b.vy / speed;
    const len = b.hostile ? 8 : 16 + (b.r * 1.5) * (b.width || 1);

    ctx.strokeStyle = b.color;
    ctx.lineWidth = (b.r * 1.5) * (b.width || 1);
    ctx.lineCap = 'round';
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + tx * len, b.y + ty * len);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(b.x, b.y, b.r * 0.62, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBossBar(ctx) {
    const b = game.boss;
    if (!b) return;
    const w = Math.min(560, ND.view.w * 0.7);
    const x = (ND.view.w - w) / 2;
    const y = 64;
    const t = Math.max(0, b.hp / b.maxHp);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillStyle = '#ff8fb0';
    ctx.letterSpacing = '3px';
    ctx.fillText('SINGULARITY // ' + Math.round(t * 100) + '%', ND.view.w / 2, y - 10);

    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y, w, 7);
    ctx.fillStyle = '#ff2b8a';
    ctx.shadowColor = '#ff2b8a';
    ctx.shadowBlur = 16;
    ctx.fillRect(x, y, w * t, 7);
    ctx.restore();
  }

  function drawHUD(ctx) {
    const p = game.player;
    if (!p) return;

    // health bar
    const bw = Math.min(300, ND.view.w * 0.36);
    const bx = 22, by = 22;
    ctx.save();
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6f8ba0';
    ctx.fillText('HULL', bx, by - 8);

    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(bx, by, bw, 12);
    const hpT = ND.clamp(p.hp / p.maxHp, 0, 1);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, hpT > 0.35 ? '#22d3ee' : '#ff3b6b');
    grad.addColorStop(1, hpT > 0.35 ? '#3bff9e' : '#ff8fb0');
    ctx.fillStyle = grad;
    ctx.shadowColor = hpT > 0.35 ? '#22d3ee' : '#ff3b6b';
    ctx.shadowBlur = 14;
    ctx.fillRect(bx, by, bw * hpT, 12);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cfeaf5';
    ctx.fillText(Math.max(0, Math.ceil(p.hp)) + ' / ' + p.maxHp, bx + bw + 12, by + 10);

    // xp bar
    const yb = by + 26;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(bx, yb, bw, 5);
    ctx.fillStyle = '#a06bff';
    ctx.shadowColor = '#a06bff';
    ctx.shadowBlur = 12;
    ctx.fillRect(bx, yb, bw * (p.xp / p.xpNext), 5);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#a06bff';
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillText('LV ' + p.level, bx, yb + 20);

    // right side stats
    ctx.textAlign = 'right';
    ctx.fillStyle = '#dff8ff';
    ctx.font = '800 26px ui-monospace, monospace';
    ctx.fillText(String(game.score).padStart(5, '0'), ND.view.w - 22, 44);

    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillStyle = '#6f8ba0';
    ctx.fillText('SCORE', ND.view.w - 22, 60);
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('WAVE ' + game.wave + '  ·  ' + Math.round(game.time) + 's', ND.view.w - 22, 80);

    // dash indicator
    ctx.textAlign = 'center';
    ctx.font = '700 10px ui-monospace, monospace';
    const ready = p.dashCd <= 0;
    ctx.fillStyle = ready ? '#22d3ee' : '#37505e';
    ctx.fillText(ready ? 'DASH READY' : 'DASH ' + p.dashCd.toFixed(1) + 's', ND.view.w / 2, ND.view.h - 22);

    // weapon selector
    const w = p.weaponDef();
    ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillStyle = w.color;
    ctx.shadowColor = w.color;
    ctx.shadowBlur = 12;
    ctx.fillText('◄ ' + w.name + ' ►', ND.view.w / 2, ND.view.h - 42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4d6478';
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.fillText('Q / E', ND.view.w / 2, ND.view.h - 60);

    // killstreak
    if (game.killstreak >= 10) {
      ctx.font = '800 15px ui-monospace, monospace';
      ctx.fillStyle = '#ffe066';
      ctx.shadowColor = '#ffb020';
      ctx.shadowBlur = 18;
      ctx.fillText('x' + game.killstreak + ' STREAK', ND.view.w / 2, ND.view.h - 48);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawTexts(ctx, camX, camY) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of game.texts) {
      const a = Math.max(0, Math.min(1, t.life / t.maxLife));
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 14;

      if (t.world) {
        ctx.font = '700 ' + (t.size || 13) + 'px ui-monospace, monospace';
        // already inside the camera transform
        ctx.fillText(t.text, t.x, t.y);
      } else {
        ctx.font = '800 ' + Math.min(26, 14 + t.maxLife * 3) + 'px ui-monospace, monospace';
        ctx.fillText(t.text, camX + ND.view.w / 2, camY + ND.view.h * 0.24 + (t.maxLife - t.life) * 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function draw() {
    const camX = Math.round(game.camX + ND.rand(-ND.shake, ND.shake) * 0.5);
    const camY = Math.round(game.camY + ND.rand(-ND.shake, ND.shake) * 0.5);

    ctx.setTransform(ND.view.dpr, 0, 0, ND.view.dpr, 0, 0);

    // backdrop
    const bg = ctx.createRadialGradient(
      ND.view.w / 2, ND.view.h / 2, 60,
      ND.view.w / 2, ND.view.h / 2, Math.max(ND.view.w, ND.view.h) * 0.8
    );
    bg.addColorStop(0, '#0a1220');
    bg.addColorStop(1, '#03050a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ND.view.w, ND.view.h);

    drawGrid(ctx, camX, camY);

    ctx.save();
    ctx.translate(-camX, -camY);

    drawWorldBounds(ctx, camX, camY);

    // pickups
    for (const pk of game.pickups) {
      if (pk.x < camX - 40 || pk.x > camX + ND.view.w + 40) continue;
      if (pk.y < camY - 40 || pk.y > camY + ND.view.h + 40) continue;
      drawPickup(ctx, pk);
    }

    // enemies
    for (const e of game.enemies) {
      if (e.x < camX - 80 || e.x > camX + ND.view.w + 80) continue;
      if (e.y < camY - 80 || e.y > camY + ND.view.h + 80) continue;
      ND.drawEnemy(ctx, e);
    }

    // bullets
    for (const b of game.bullets) drawBullet(ctx, b);

    // player
    if (game.state === 'playing' || game.state === 'paused') game.player.draw(ctx);

    // particles
    ND.drawParticles(ctx, camX, camY);

    drawTexts(ctx, camX, camY);
    ctx.restore();

    // screen edge vignette
    const vg = ctx.createRadialGradient(
      ND.view.w / 2, ND.view.h / 2, Math.min(ND.view.w, ND.view.h) * 0.34,
      ND.view.w / 2, ND.view.h / 2, Math.max(ND.view.w, ND.view.h) * 0.78
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, ND.view.w, ND.view.h);

    // low-hp red pulse
    if (game.player && game.player.hp / game.player.maxHp < 0.3 && game.state === 'playing') {
      const pulse = 0.12 + Math.sin(performance.now() / 180) * 0.07;
      ctx.fillStyle = 'rgba(255, 40, 80, ' + Math.max(0, pulse) + ')';
      ctx.fillRect(0, 0, ND.view.w, ND.view.h);
    }

    if (game.state === 'playing' || game.state === 'paused') {
      drawHUD(ctx);
      drawBossBar(ctx);
    }
  }

  // ---------------- loop ----------------
  let last = performance.now();
  function frame(now) {
    // rAF timestamps can lag performance.now() (e.g. right after a resume),
    // which would yield a negative dt and corrupt motion math.
    let dt = (now - last) / 1000;
    if (!isFinite(dt) || dt < 0) dt = 0;
    last = now;
    dt = Math.min(dt, 0.05);

    if (game.state === 'playing') update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------- upgrades UI ----------------
  const UPGRADE_LIMIT = {};
  function openUpgrades() {
    game.state = 'upgrade';
    ND.mouse.down = false;
    ND.audio.play('level');

    const picks = [];
    const pool = ND.UPGRADES.slice();
    while (picks.length < 3 && pool.length) {
      const idx = ND.randInt(0, pool.length - 1);
      const up = pool.splice(idx, 1)[0];
      if (up.max && (game.upgradeCounts[up.id] || 0) >= up.max) continue;
      picks.push(up);
    }
    const container = $('cards');
    container.innerHTML = '';
    picks.forEach((up, i) => {
      const el = document.createElement('div');
      el.className = 'card' + (up.weapon ? ' card-weapon' : '');
      el.innerHTML =
        '<span class="key">' + (i + 1) + '</span>' +
        '<div class="glyph"></div>' +
        (up.weapon ? '<span class="wtag">' + up.weapon.toUpperCase() + '</span>' : '') +
        '<h3>' + up.name + '</h3>' +
        '<p>' + up.desc + '</p>';
      el.addEventListener('click', () => chooseUpgrade(up));
      container.appendChild(el);
    });

    game.currentPicks = picks;
    $('upgrade').classList.remove('hidden');
  }

  function chooseUpgrade(up) {
    if (game.state !== 'upgrade') return;
    up.apply(game.player);
    game.upgradeCounts[up.id] = (game.upgradeCounts[up.id] || 0) + 1;
    game.pendingLevels--;
    $('upgrade').classList.add('hidden');

    if (game.pendingLevels > 0) {
      openUpgrades();
    } else {
      game.state = 'playing';
      last = performance.now();
      ND.mouse.down = false;
    }
  }

  window.addEventListener('keydown', (e) => {
    const n = parseInt(e.key, 10);
    if (game.state === 'upgrade' && n >= 1 && n <= 3 && game.currentPicks) {
      chooseUpgrade(game.currentPicks[n - 1]);
    }
    if (game.state === 'playing' && (e.key === 'q' || e.key === 'Q')) {
      game.player.cycleWeapon(-1);
    }
    if (game.state === 'playing' && (e.key === 'e' || e.key === 'E')) {
      game.player.cycleWeapon(1);
    }
    if (e.key === 'Escape') {
      if (game.state === 'playing') pauseGame();
      else if (game.state === 'paused') resumeGame();
    }
  });

  // ---------------- best run persistence ----------------
  const BEST_KEY = 'neondrift.best.v1';

  function loadBest() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (!raw) return { score: 0, wave: 0, time: 0, kills: 0 };
      const b = JSON.parse(raw);
      return {
        score: Number(b.score) || 0,
        wave: Number(b.wave) || 0,
        time: Number(b.time) || 0,
        kills: Number(b.kills) || 0
      };
    } catch (e) {
      return { score: 0, wave: 0, time: 0, kills: 0 };
    }
  }

  function saveBest(best) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch (e) {
      /* storage can be blocked; a high score is not worth crashing a run */
    }
  }

  function showMenuBest() {
    const best = loadBest();
    const el = $('menuBest');
    if (!el) return;
    el.textContent = best.score > 0
      ? 'BEST ' + best.score + '  ·  WAVE ' + best.wave
      : 'NO RUNS RECORDED';
    el.classList.toggle('is-record', false);
  }

  // ---------------- state transitions ----------------
  function reset() {
    game.player = new ND.Player();
    game.bullets.length = 0;
    game.enemies.length = 0;
    game.pickups.length = 0;
    game.texts.length = 0;
    ND.particles.length = 0;
    game.wave = 1;
    game.waveTimer = 0;
    game.spawnTimer = 0;
    game.score = 0;
    game.time = 0;
    game.pendingLevels = 0;
    game.boss = null;
    game.killstreak = 0;
    game.streakTimer = 0;
    game.currentPicks = null;
    game.upgradeCounts = {};
    ND.shake = 0;
    game.camX = game.player.x - ND.view.w / 2;
    game.camY = game.player.y - ND.view.h / 2;

    // starting trickle of orbs so the first level-up is quick
    const vw = ND.view.w / 2, vh = ND.view.h / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ex = ND.clamp(game.player.x + Math.cos(a) * ND.rand(vw * 0.75, vw * 1.15), 40, ND.WORLD.w - 40);
      const ey = ND.clamp(game.player.y + Math.sin(a) * ND.rand(vh * 0.75, vh * 1.15), 40, ND.WORLD.h - 40);
      ND.spawnEnemy('chaser', ex, ey, game);
    }
  }

  function startGame() {
    ND.audio.init();    reset();
    game.state = 'playing';
    game.lastShot = 0;
    hideAllOverlays();
    $('hudbar').classList.remove('hidden');
    toast('WAVE 1 // ENGAGE', '#22d3ee');
    last = performance.now();
  }

  function hideAllOverlays() {
    ['start', 'gameover', 'pause', 'upgrade'].forEach((id) => $(id).classList.add('hidden'));
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    ND.mouse.down = false;
    $('pause').classList.remove('hidden');
  }

  function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    last = performance.now();
    $('pause').classList.add('hidden');
  }

  // Stop the run and return to the title screen (also clears the field).
  function stopGame() {
    if (game.state === 'menu') return;
    game.state = 'menu';
    ND.mouse.down = false;
    ND.keys.clear();
    hideAllOverlays();
    $('hudbar').classList.add('hidden');
    clearWorld();
    showMenuBest();
    $('start').classList.remove('hidden');
  }

  function clearWorld() {
    game.bullets.length = 0;
    game.enemies.length = 0;
    game.pickups.length = 0;
    game.texts.length = 0;
    game.pendingLevels = 0;
    game.boss = null;
    ND.particles.length = 0;
  }

  function die() {
    if (game.state === 'dead') return;
    game.state = 'dead';
    ND.mouse.down = false;
    ND.addShake(20);
    ND.audio.play('explode');
    ND.spawnParticles(game.player.x, game.player.y, 70, {
      color: '#22d3ee', speed: 520, life: 1.2, size: 4
    });

    $('hudbar').classList.add('hidden');

    const best = loadBest();
    const isRecord = game.score > best.score;
    if (isRecord) {
      saveBest({
        score: game.score,
        wave: game.wave,
        time: Math.round(game.time),
        kills: game.player.kills
      });
    }

    $('finalStats').innerHTML =
      '<div>TIME SURVIVED &nbsp;<b>' + Math.round(game.time) + 's</b></div>' +
      '<div>WAVE REACHED &nbsp;<b>' + game.wave + '</b></div>' +
      '<div>ELIMINATIONS &nbsp;<b>' + game.player.kills + '</b></div>' +
      '<div>FINAL SCORE &nbsp;<b>' + game.score + '</b></div>';

    const bestEl = $('bestLine');
    if (isRecord && game.score > 0) {
      bestEl.textContent = 'NEW RECORD';
      bestEl.classList.add('is-record');
    } else {
      bestEl.textContent = 'BEST ' + best.score + '  ·  WAVE ' + best.wave + '  ·  ' + best.kills + ' KILLS';
      bestEl.classList.remove('is-record');
    }

    $('gameover').classList.remove('hidden');
  }

  // ---------------- UI wiring ----------------
  $('play').addEventListener('click', startGame);
  $('restart').addEventListener('click', startGame);
  $('btnMenu').addEventListener('click', stopGame);

  $('btnPause').addEventListener('click', () => {
    if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused') resumeGame();
  });
  $('btnStop').addEventListener('click', stopGame);

  $('btnResume').addEventListener('click', (e) => {
    e.stopPropagation();
    resumeGame();
  });
  $('btnEnd').addEventListener('click', (e) => {
    e.stopPropagation();
    stopGame();
  });

  // clicking the pause backdrop resumes, but clicks on the panel do not
  $('pause').addEventListener('click', (e) => {
    if (e.target === $('pause')) resumeGame();
  });

  requestAnimationFrame(frame);
  showMenuBest();
})(window.ND);
