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
    freeSpend: false,
    boss: null,
    gridOffset: 0,
    killstreak: 0,
    streakTimer: 0,
    // Attract mode: a wordless demo fight that plays behind the title screen.
    // It uses its own tiny world so it can be wiped and respawned freely.
    attract: null,
    // Counts down after the launch shockwave while the wipe plays out.
    launchFx: null
  };
  ND.game = game;

  // ---------------- camera ----------------
  // The world wraps, so the camera wraps too — it is never clamped, and the
  // lerp is done in toroidal space so crossing the seam doesn't whip across
  // the whole map.
  function updateCamera(dt) {
    const p = game.player;
    if (!p) return;
    const targetX = p.x + (p.vx || 0) * 0.22 - ND.view.w / 2;
    const targetY = p.y + (p.vy || 0) * 0.22 - ND.view.h / 2;
    const smooth = 1 - Math.pow(0.001, dt);

    game.camX += ND.delta(game.camX, targetX, ND.WORLD.w) * smooth;
    game.camY += ND.delta(game.camY, targetY, ND.WORLD.h) * smooth;
    game.camX = ND.wrapX(game.camX);
    game.camY = ND.wrapY(game.camY);
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

      x = ND.wrapX(x);
      y = ND.wrapY(y);

      const d = ND.distT(x, y, p.x, p.y);
      if (d > bestD) { bestD = d; best = { x, y }; }
      tries++;
    } while (ND.distT(x, y, p.x, p.y) < 260 && tries < 20);

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
    b.r = 46 * ND.SHIP_SCALE;
    // Boss health tracks the same geometric curve as regular enemies, so a boss
    // stays a 7-10s fight instead of dying to a single volley by wave 12.
    b.maxHp = 420 * Math.pow(1.175, game.wave - 1);
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
    ND.music.play('boss');
    ND.addShake(10);
    toast('WARNING // ' + (game.wave) + '-CLASS SINGULARITY', '#ff2b8a');
  }

  // ---------------- floating text ----------------
  function toast(text, color, small) {
    // A synergy line is much longer than "WAVE 2", so it gets a smaller size;
    // otherwise it would run off the edge of the screen.
    const size = small ? 13 : null;
    game.texts.push({ text, color: color || '#8ef0ff', life: small ? 2.8 : 2.2, maxLife: small ? 2.8 : 2.2, y: 0, size: size });
  }

  function floatText(x, y, text, color) {
    game.texts.push({ text, color, x, y, life: 0.85, maxLife: 0.85, vy: -60, world: true, size: 13 });
  }

  // ---------------- specials ----------------
  // Boss kills hand out these. Once the player holds ND.MAX_SPECIALS, further
  // bosses pay scrap instead, so late bosses still feel worth killing.
  function grantSpecial() {
    const p = game.player;
    const pool = ND.SPECIALS.filter((s) => p.specials.indexOf(s.id) === -1);

    if (p.specials.length >= ND.MAX_SPECIALS || !pool.length) {
      const bonus = 150 + game.wave * 25;
      game.scrap += bonus;
      toast('SALVAGE +' + bonus + ' SCRAP', '#ffd166', true);
      return null;
    }

    const s = pool[ND.randInt(0, pool.length - 1)];
    p.specials.push(s.id);
    p.specialCd[s.id] = 0;
    if (s.id === 'aegis') p.aegis = 1;
    toast(s.name + ' ACQUIRED // ' + s.desc, s.color, true);
    ND.audio.play('synergy');
    updateSpecialBar();
    return s;
  }

  // R fires the first ready active special; if none, it cycles nothing.
  function useSpecial() {
    const p = game.player;
    for (const id of p.specials) {
      const s = ND.SPECIAL_BY_ID[id];
      if (!s || !s.active) continue;
      if ((p.specialCd[id] || 0) > 0) continue;
      s.fire(p, game);
      p.specialCd[id] = s.cooldown;
      updateSpecialBar();
      return true;
    }
    return false;
  }

  // DOM chips under the HUD showing each special and its cooldown.
  function updateSpecialBar() {
    const host = $('specials');
    if (!host) return;
    const p = game.player;
    if (!p || !p.specials.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = p.specials.map((id) => {
      const s = ND.SPECIAL_BY_ID[id];
      const cd = p.specialCd[id] || 0;
      const ready = !s.active || cd <= 0;
      const label = s.active
        ? (ready ? 'R' : Math.ceil(cd) + 's')
        : 'ON';
      return '<div class="spec' + (ready ? ' ready' : '') + '" style="--sc:' + s.color + '" title="' +
        s.name + ' — ' + s.desc + '">' +
        '<span class="sdot"></span>' +
        '<span class="sname">' + s.name + '</span>' +
        '<span class="scd">' + label + '</span>' +
      '</div>';
    }).join('');
  }

  // Slow-motion field from TIME DILATION: scales enemy movement only.
  function enemyTimeScale() {
    return game.slowTime > 0 ? 0.28 : 1;
  }

  // ORBITAL DRONE: circles the ship and auto-fires at the nearest target.
  function updateDrone(dt) {
    const p = game.player;
    if (p.specials.indexOf('drone') === -1) return;
    p.droneAngle += dt * 1.9;
    p.droneCd = Math.max(0, p.droneCd - dt);
    if (p.droneCd > 0) return;

    const orbit = 52;
    const dx = p.x + Math.cos(p.droneAngle) * orbit;
    const dy = p.y + Math.sin(p.droneAngle) * orbit;

    let target = null, bd = 560;
    for (const e of game.enemies) {
      const d = ND.distT(dx, dy, e.x, e.y);
      if (d < bd) { bd = d; target = e; }
    }
    if (!target) return;

    p.droneCd = 0.42;
    const a = Math.atan2(
      ND.delta(dy, target.y, ND.WORLD.h),
      ND.delta(dx, target.x, ND.WORLD.w)
    );
    game.bullets.push({
      x: dx, y: dy,
      vx: Math.cos(a) * 820, vy: Math.sin(a) * 820,
      r: 3, dmg: p.damage * 0.55, crit: false,
      pierce: 0, hits: [], life: 0.9,
      color: '#ffd166', width: 1.4,
      flak: 0, ignite: 0, burst: false, ricochet: 0, bounced: 0,
      drone: true
    });
  }

  // BLACK HOLE: drags enemies in, then detonates.
  function updateBlackHole(dt) {
    const bh = game.blackHole;
    if (!bh) return;
    bh.t += dt;
    bh.life -= dt;

    for (const e of game.enemies) {
      const dx = ND.delta(e.x, bh.x, ND.WORLD.w);
      const dy = ND.delta(e.y, bh.y, ND.WORLD.h);
      const d = Math.hypot(dx, dy) || 1;
      if (d > 420) continue;
      const pull = (1 - d / 420) * 900;
      e.x += (dx / d) * pull * dt;
      e.y += (dy / d) * pull * dt;
      if (Math.random() < dt * 12) {
        ND.spawnParticles(e.x, e.y, 1, {
          color: '#ff2b8a', speed: 120, life: 0.3, size: 2
        });
      }
    }

    if (bh.life <= 0) {
      ND.spawnParticles(bh.x, bh.y, 80, {
        color: '#ff2b8a', speed: 780, life: 0.7, size: 5, drag: 2
      });
      ND.addShake(20);
      ND.audio.play('explode');
      for (const e of game.enemies.slice()) {
        if (ND.distT(bh.x, bh.y, e.x, e.y) < 200 + e.r) {
          ND.damageEnemy(e, game.player.damage * 6, false);
        }
      }
      game.blackHole = null;
    }
  }

  function damageEnemy(e, dmg, crit, silent) {
    e.hp -= dmg;
    e.flash = 1;
    if (e.hp <= 0) {
      killEnemy(e);
    } else if (!silent) {
      ND.audio.play('hit');
      ND.spawnParticles(e.x, e.y, 4, {
        color: e.color, speed: 180, life: 0.3, size: 2.5
      });
      if (crit) floatText(e.x, e.y - e.r, Math.round(dmg), '#ffe066');
    }
  }

  // Exposed so specials (and any future ability) can damage through the one
  // real code path, keeping kills, scrap and particle FX consistent.
  ND.damageEnemy = damageEnemy;
  ND.igniteEnemy = igniteEnemy;
  ND.grantSpecial = grantSpecial;
  ND.useSpecial = useSpecial;

  // Apply a burn stack. Burn deals damage over time through damageEnemy so it
  // can finish an enemy off, and it refreshes rather than stacking infinitely.
  function igniteEnemy(e, dps, time) {
    if (!e || e.hp <= 0) return;
    e.burn = Math.max(e.burn || 0, dps);
    e.burnTimer = Math.max(e.burnTimer || 0, time || 2.2);
  }

  // OVERLOAD: a crit sends a small shockwave into everything nearby.
  function critBurst(e, dmg) {
    const radius = 70;
    ND.spawnParticles(e.x, e.y, 22, {
      color: '#ffe066', speed: 420, life: 0.45, size: 3.4, drag: 2
    });
    ND.audio.play('crit');
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const o = game.enemies[i];
      if (o === e) continue;
      if (ND.distT(o.x, o.y, e.x, e.y) > radius + o.r) continue;
      damageEnemy(o, dmg * 0.55, false);
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
      const heal = p.lifesteal * p.leechMul;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      floatText(e.x, e.y - e.r - 8, '+' + Math.round(heal), '#3bff9e');
    }

    if (kamikaze) {
      if (e.boss) {
        game.boss = null;
        toast('SINGULARITY COLLAPSED', '#ffb020');
      }
      return;
    }

    // Scrap is the upgrade currency: every kill pays out. The Salvage Rig meta
    // upgrade raises the payout for the whole run.
    if (!kamikaze) {
      const gain = ND.scrapValue(e, p.scrapMul || 1);
      game.scrap += gain;
      game.scrapGain = Math.min(1, (game.scrapGain || 0) + 0.28);
      if (e.boss) {
        grantSpecial();
      }
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
        child.r = 10 * ND.SHIP_SCALE;
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
      ND.music.play('track');
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

    // ---- specials ----
    if (game.slowTime > 0) game.slowTime = Math.max(0, game.slowTime - dt);
    for (const id in p.specialCd) {
      if (p.specialCd[id] > 0) p.specialCd[id] = Math.max(0, p.specialCd[id] - dt);
    }
    if (p.specials.indexOf('aegis') !== -1 && p.aegis <= 0) {
      p.aegisTimer -= dt;
      if (p.aegisTimer <= 0) {
        p.aegis = 1;
        ND.spawnParticles(p.x, p.y, 12, {
          color: '#3bff9e', speed: 220, life: 0.45, size: 2.6, drag: 2
        });
      }
    }
    updateDrone(dt);
    updateBlackHole(dt);
    updateCamera(dt);
    if (game.novaFx) {
      game.novaFx.life -= dt;
      if (game.novaFx.life <= 0) game.novaFx = null;
    }    if (p.specials.length) updateSpecialBar();

    if (game.state === 'playing') {
      game.scrapGain = Math.max(0, (game.scrapGain || 0) - dt * 2.2);
    }

    // waves
    game.waveTimer += dt;
    const waveDuration = Math.max(14, 26 - game.wave * 0.8);
    // The wave clock keeps running during a boss fight. Freezing it here meant
    // a second boss at wave 3 could never arrive, so a run stalled forever.
    if (game.waveTimer >= waveDuration) {
      game.waveTimer = 0;
      game.wave++;
      // First boss lands at wave 2 so the opening has a spike, then every 3rd
      // wave after that (3, 6, 9...). A boss already alive skips the summon.
      const isBossWave = game.wave === 2 || game.wave % 3 === 0;
      if (isBossWave && !game.boss) {
        spawnBoss();
      } else if (!game.boss) {
        toast('WAVE ' + game.wave, '#22d3ee');
        ND.audio.play('level');
        ND.music.play('track');
        // The loop gets heavier as the run climbs.
        ND.music.intensity = Math.min(1.35, 1 + game.wave * 0.03);
      }
    }

    // continuous spawn pressure — escorts still trickle in during boss fights
    // so the arena never goes fully quiet, just quieter.
    game.spawnTimer -= dt;
    // The cap used to reach 90 enemies by wave 19 and the spawn interval bottomed
    // out at 0.1s (15.5 spawns/sec) by wave 12, which turned late waves into a
    // wall of bodies rather than a fight. Both ramp more gently now.
    const targetCount = Math.min(64, 12 + Math.round(game.wave * 2.6));
    const cap = game.boss ? Math.ceil(targetCount * 0.4) : targetCount;
    if (game.spawnTimer <= 0 && game.enemies.length < cap) {
      game.spawnTimer = Math.max(0.22, 0.62 - game.wave * 0.03) * (game.boss ? 1.8 : 1);
      spawnWaveEnemy();
      if (game.wave > 1 && Math.random() < 0.45) spawnWaveEnemy();
    }

    // enemies
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const e = game.enemies[i];
      // TIME DILATION slows hostile movement without slowing bullets or you.
      ND.updateEnemy(e, dt * enemyTimeScale(), game);

      // INCENDIARY synergy: burn damage ticks through the normal damage path.
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        damageEnemy(e, e.burn * dt, false, true);
        if (e.burnTimer <= 0) e.burn = 0;
        // Burned enemies shed embers so the effect reads on screen.
        if (Math.random() < dt * 18) {
          ND.spawnParticles(e.x + ND.rand(-6, 6), e.y + ND.rand(-6, 6), 1, {
            color: '#ff8a3c', speed: 60, life: 0.4, size: 2, drag: 2
          });
        }
        if (e.hp <= 0) continue;   // burned to death; killEnemy already ran
      }

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
          const ramMul = (dashing ? 3.4 : 0.7) * p.ramMul * (dashing ? p.ramSynergy : 1);
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

    // Keep the swarm from collapsing into a single stack.
    ND.separateEnemies(game.enemies);

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

      // Rounds live on the torus too, so they wrap rather than vanish. Range
      // is enforced by `life`, not by the world edge.
      b.x = ND.wrapX(b.x);
      b.y = ND.wrapY(b.y);

      let dead = b.life <= 0;

      if (!dead && b.hostile) {
        if (ND.distT(b.x, b.y, p.x, p.y) < p.r + b.r) {
          p.hurt(b.dmg);
          dead = true;
        }
      } else if (!dead) {
        for (let j = game.enemies.length - 1; j >= 0; j--) {
          const e = game.enemies[j];
          if (b.hits.indexOf(e) !== -1) continue;
          if (ND.distT(b.x, b.y, e.x, e.y) < e.r + b.r) {
            damageEnemy(e, b.dmg, b.crit);

            // Synergies: burn on hit, and a crit shockwave.
            if (b.ignite > 0 && e.hp > 0) igniteEnemy(e, b.dmg * b.ignite, 2.2);
            if (b.burst && e.hp > 0) critBurst(e, b.dmg);

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
                  flak: 0,
                  ignite: 0,
                  burst: false,
                  ricochet: 0,
                  bounced: 0
                });
              }
            }

            // BUCKSHOT synergy: scatter pellets bounce off what they hit once.
            if (b.ricochet > 0 && b.bounced < b.ricochet) {
              b.bounced++;
              b.hits = [];              // fresh hit list so it can bite again
              const ra = Math.atan2(b.vy, b.vx) + Math.PI + ND.rand(-0.5, 0.5);
              const rs = Math.hypot(b.vx, b.vy) * 0.85;
              b.vx = Math.cos(ra) * rs;
              b.vy = Math.sin(ra) * rs;
              b.x += Math.cos(ra) * 6;
              b.y += Math.sin(ra) * 6;
              b.life = Math.max(b.life, 0.35);
              b.dmg *= 0.7;
              break;                    // bullet survives; stop checking hits
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

      if (ND.distT(b.x, b.y, p.x, p.y) < 260) b.glow = true;

      if (dead) game.bullets.splice(i, 1);
    }

    // pickups
    for (let i = game.pickups.length - 1; i >= 0; i--) {
      const pk = game.pickups[i];
      pk.life -= dt;
      pk.seed += dt * 4;
      const d = ND.distT(pk.x, pk.y, p.x, p.y);

      // XP orbs always drift toward the player, faster when close.
      // Health orbs need to be walked over, so they keep the tight magnet only.
      // XP orbs drift strongly, but not across the entire arena: at 1200px on a
      // 1920px-wide map every orb flew to you from anywhere, which made Tractor
      // Field pointless and removed any reason to move toward a kill. A circle
      // of 420 + magnet keeps orbs snappy without erasing the upgrade.
      const isOrb = pk.type === 'xp';
      const reach = isOrb ? 300 + p.magnet : p.magnet + 40;

      if (d < reach) {
        const pull = isOrb
          ? 0.35 + 0.65 * (1 - d / reach)
          : 1 - d / (p.magnet + 40);
        const a = Math.atan2(
          ND.delta(pk.y, p.y, ND.WORLD.h),
          ND.delta(pk.x, p.x, ND.WORLD.w)
        );
        const acc = (isOrb ? 1500 : 900) * pull * pull;
        pk.vx += Math.cos(a) * acc * dt;
        pk.vy += Math.sin(a) * acc * dt;
      }
      const drag = Math.max(0, 1 - 2.4 * dt);
      pk.vx *= drag;
      pk.vy *= drag;
      pk.x = ND.wrapX(pk.x + pk.vx * dt);
      pk.y = ND.wrapY(pk.y + pk.vy * dt);

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

  // The world is a torus, so a single screen can show two edges of it at once.
  // These return the world-space offsets we must draw each object at for the
  // current camera, e.g. [0, -2000] when the view straddles the x seam.
  function tileOffsets(cam, span, size) {
    const out = [];
    const first = Math.floor(cam / size);
    const last = Math.floor((cam + span - 0.001) / size);
    // Tile k renders a second copy of the world shifted by k*size, so objects
    // just past a seam appear at the opposite edge of the screen.
    for (let k = first; k <= last; k++) out.push(k * size);
    return out;
  }

  let tilesX = [0];
  let tilesY = [0];

  // Draw a world-space object, repeating it across whichever seams are visible.
  function drawTiled(wx, wy, margin, fn) {
    const x0 = game.camX - margin;
    const x1 = game.camX + ND.view.w + margin;
    const y0 = game.camY - margin;
    const y1 = game.camY + ND.view.h + margin;

    for (let i = 0; i < tilesX.length; i++) {
      const dx = tilesX[i];
      const x = wx + dx;
      if (x < x0 || x > x1) continue;
      for (let j = 0; j < tilesY.length; j++) {
        const dy = tilesY[j];
        const y = wy + dy;
        if (y < y0 || y > y1) continue;

        if (dx === 0 && dy === 0) {
          fn();
          continue;
        }
        ctx.save();
        ctx.translate(dx, dy);
        fn();
        ctx.restore();
      }
    }
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

    // Next free pick, on its own line to the right of the scrap readout. Derived
    // from the same rule as gainXp(): picks land on levels 2, 5, 8, 11...
    // A queued pick takes priority so the label never says "IN 3" while a card
    // is already waiting.
    const nextPick = p.level < 2 ? 2 : p.level - ((p.level - 2) % ND.UPGRADE_EVERY) + ND.UPGRADE_EVERY;
    const toGo = nextPick - p.level;
    const pickReady = game.pendingLevels > 0;
    ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillStyle = pickReady ? '#3bff9e' : '#6b5b8f';
    ctx.fillText(pickReady ? 'PICK READY' : 'PICK IN ' + toGo, bx, yb + 34);
    // scrap bank — the upgrade currency
    ctx.textAlign = 'left';
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = game.scrapGain > 0.02 ? 14 : 0;
    ctx.fillText('⬥ ' + game.scrap + ' SCRAP', bx + 62, yb + 20);
    ctx.shadowBlur = 0;

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
        drawTiled(t.x, t.y, 120, () => ctx.fillText(t.text, t.x, t.y));
      } else {
        const size = t.size || Math.min(26, 14 + t.maxLife * 3);
        ctx.font = '800 ' + size + 'px ui-monospace, monospace';
        // Keep the banner clear of the boss health bar overhead.
        const y = camY + ND.view.h * 0.24 + (t.maxLife - t.life) * 4;
        ctx.fillText(t.text, camX + ND.view.w / 2, y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function draw() {
    // In attract mode the camera belongs to the demo, not the (absent) run.
    const attract = game.state === 'menu' && game.attract ? game.attract : null;
    const shake = ND.shake || 0;
    const camX = Math.round((attract ? attract.camX : game.camX) + ND.rand(-shake, shake) * 0.5);
    const camY = Math.round((attract ? attract.camY : game.camY) + ND.rand(-shake, shake) * 0.5);

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

    tilesX = tileOffsets(camX, ND.view.w, ND.WORLD.w);
    tilesY = tileOffsets(camY, ND.view.h, ND.WORLD.h);

    // Attract mode has its own world; the run's arrays are empty on the menu.
    if (attract) {
      drawAttract(ctx, camX, camY);

      // Push the demo back so the title stays legible over it.
      ctx.save();
      const dim = ctx.createRadialGradient(
        ND.view.w / 2, ND.view.h * 0.42, 60,
        ND.view.w / 2, ND.view.h * 0.42, Math.max(ND.view.w, ND.view.h) * 0.85
      );
      // Light touch: the demo is the point, so it must stay clearly visible.
      // Only the very centre (behind the headline) is knocked back, and the
      // edges get a soft vignette so the title text keeps its contrast.
      dim.addColorStop(0, 'rgba(3,6,12,0.16)');
      dim.addColorStop(0.5, 'rgba(3,6,12,0.06)');
      dim.addColorStop(0.86, 'rgba(3,6,12,0.28)');
      dim.addColorStop(1, 'rgba(3,6,12,0.60)');
      ctx.fillStyle = dim;
      ctx.fillRect(0, 0, ND.view.w, ND.view.h);
      ctx.restore();

      // Text-protection scrim: only the top band (headline + tag) and the very
      // bottom (launch button) are darkened. The middle stays open so the fight
      // shows through the translucent systems panel.
      const scrim = ctx.createLinearGradient(0, 0, 0, ND.view.h);
      scrim.addColorStop(0, 'rgba(3,5,10,0.62)');
      scrim.addColorStop(0.13, 'rgba(3,5,10,0.30)');
      scrim.addColorStop(0.22, 'rgba(3,5,10,0.04)');
      scrim.addColorStop(0.78, 'rgba(3,5,10,0.04)');
      scrim.addColorStop(0.92, 'rgba(3,5,10,0.42)');
      scrim.addColorStop(1, 'rgba(3,5,10,0.66)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, ND.view.w, ND.view.h);

      drawLaunchFx(ctx);
      return;
    }

    ctx.save();
    ctx.translate(-camX, -camY);

    // pickups
    for (const pk of game.pickups) {
      drawTiled(pk.x, pk.y, 40, () => drawPickup(ctx, pk));
    }

    // enemies
    for (const e of game.enemies) {
      drawTiled(e.x, e.y, 80, () => ND.drawEnemy(ctx, e));
    }

    // bullets
    for (const b of game.bullets) {
      drawTiled(b.x, b.y, 40, () => drawBullet(ctx, b));
    }

    // ---- special effects, under the ship ----
    // BLACK HOLE: a dark core with a spinning accretion ring.
    if (game.blackHole) {
      const bh = game.blackHole;
      const t = performance.now() / 1000;
      drawTiled(bh.x, bh.y, 130, () => {
        ctx.save();
        const g2 = ctx.createRadialGradient(bh.x, bh.y, 2, bh.x, bh.y, 120);
        g2.addColorStop(0, 'rgba(0,0,0,0.95)');
        g2.addColorStop(0.5, 'rgba(255,43,138,0.35)');
        g2.addColorStop(1, 'rgba(255,43,138,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(bh.x, bh.y, 120, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = '#ff2b8a';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#ff2b8a';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(bh.x, bh.y, 26 + Math.sin(t * 9) * 4, 0, TAU);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(bh.x, bh.y, 46, t * 3, t * 3 + 2.2);
        ctx.stroke();
        ctx.restore();
      });
    }

    // NOVA: an expanding shockwave ring.
    if (game.novaFx) {
      const n = game.novaFx;
      const k = 1 - n.life / 0.5;
      drawTiled(n.x, n.y, n.max + 20, () => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 10 * (1 - k) + 1;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.max * k, 0, TAU);
        ctx.stroke();
        ctx.restore();
      });
    }

    // ORBITAL DRONE
    const pl = game.player;
    if (pl && pl.specials && pl.specials.indexOf('drone') !== -1) {
      const orbit = 52;
      drawTiled(pl.x, pl.y, orbit + 20, () => {
        const dx = pl.x + Math.cos(pl.droneAngle) * orbit;
        const dy = pl.y + Math.sin(pl.droneAngle) * orbit;
        ctx.save();
        ctx.fillStyle = '#ffd166';
        ctx.shadowColor = '#ffd166';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,209,102,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, orbit, 0, TAU);
        ctx.stroke();
        ctx.restore();
      });
    }

    // player
    if (game.state === 'playing' || game.state === 'paused') {
      drawTiled(pl.x, pl.y, 40, () => {
        game.player.draw(ctx);

        // AEGIS shield bubble while charged.
        if (game.player.aegis > 0) {
          ctx.save();
          const t = performance.now() / 700;
          ctx.strokeStyle = 'rgba(59,255,158,' + (0.45 + Math.sin(t) * 0.18) + ')';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#3bff9e';
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(game.player.x, game.player.y, game.player.r + 14, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // particles
    ND.drawParticles(ctx, camX, camY, tilesX, tilesY);

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

    // During the launch blast the HUD would flicker in behind a bright flash,
    // so it holds off until the wave has mostly cleared.
    const hudVisible = game.state === 'playing' || game.state === 'paused';
    const fxT = game.launchFx ? game.launchFx.t / game.launchFx.duration : 1;
    if (hudVisible && fxT > 0.45) {
      drawHUD(ctx);
      drawBossBar(ctx);
    }

    // The launch wipe sits above the HUD: for a moment the player shouldn't see
    // a half-built HUD behind a fading explosion.
    drawLaunchFx(ctx);
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
    else if (game.state === 'menu') updateAttract(dt);

    // The wipe runs regardless of state so it still plays while the new run is
    // already simulating underneath.
    if (game.launchFx) {
      game.launchFx.t += dt;
      // Reveal the HTML chrome once the flash has mostly cleared.
      if (!game.launchFx.chromeShown && game.launchFx.t / game.launchFx.duration > 0.45) {
        game.launchFx.chromeShown = true;
        setRunChrome(true);
      }
      if (game.launchFx.t >= game.launchFx.duration) game.launchFx = null;
    }

    draw();

    requestAnimationFrame(frame);
  }

  // ---------------- attract mode ----------------
  // A small, self-contained demo fight behind the title screen: a pilot kites a
  // handful of chasers forever, so the menu is never a still image. It reuses
  // the real drawing code (enemies, bullets, particles) but keeps its own
  // entities, so the run's world is untouched and nothing here can affect
  // balance.
  const ATTRACT_MAX = 9;

  function resetAttract() {
    const w = ND.WORLD.w, h = ND.WORLD.h;
    const a = {
      x: w / 2, y: h / 2,
      vx: 0, vy: 0,
      angle: 0,
      cooldown: 0,
      t: 0,
      enemies: [],
      bullets: [],
      // Camera drifts on its own so the shot never feels locked off.
      camX: w / 2 - ND.view.w / 2,
      camY: h / 2 - ND.view.h / 2,
      orbit: Math.random() * Math.PI * 2,
      anchorX: w / 2,
      anchorY: h / 2
    };
    game.attract = a;
    return a;
  }

  function spawnAttractEnemy(a) {
    if (a.enemies.length >= ATTRACT_MAX) return;
    // Ring spawn just inside the visible edge, so the approach is on screen.
    const ang = Math.random() * TAU;
    const rad = Math.max(ND.view.w, ND.view.h) * 0.28;
    const x = ND.wrapX(a.x + Math.cos(ang) * rad);
    const y = ND.wrapY(a.y + Math.sin(ang) * rad);
    // A throwaway game object so the demo never touches the real spawn list
    // and always spawns at wave-1 stats regardless of the last run.
    const shim = { wave: 1, enemies: [] };
    const e = ND.spawnEnemy('chaser', x, y, shim);
    if (!e) return;
    e.hp = e.maxHp = 26;   // three hits, so kills happen on screen
    e.speed *= 0.85;
    e.attract = true;
    a.enemies.push(e);
  }

  function updateAttract(dt) {
    const a = game.attract || resetAttract();
    a.t += dt;

    // --- kite: circle the local crowd rather than outrun it ---
    // The demo ship used to flee at full speed, which meant the chasers (at
    // ~90px/s) could never catch up and simply trailed off-screen. Instead it
    // orbits a slowly drifting centre, so enemies stay in frame and in view.
    let nearest = null, nd = 1e9;
    for (const e of a.enemies) {
      const d = ND.distT(e.x, e.y, a.x, a.y);
      if (d < nd) { nd = d; nearest = e; }
    }

    // The orbit centre drifts gently so the shot travels across the arena.
    a.orbit += dt * 0.35;
    const cx = a.anchorX + Math.cos(a.orbit * 0.42) * 90;
    const cy = a.anchorY + Math.sin(a.orbit * 0.31) * 55;

    // Travel *around* that centre at a fixed radius: always moving, never
    // sprinting away, so the chase stays on screen. The radius and speed are
    // both small enough that the (faster) chasers close in from all sides.
    const ringR = 120;
    const ox = ND.wrapX(a.x) - cx;
    const oy = ND.wrapY(a.y) - cy;
    const od = Math.hypot(ox, oy) || 1;
    const tangX = -oy / od, tangY = ox / od;
    const radialErr = (ringR - od) / ringR;      // pull back onto the ring
    const fx = tangX + (ox / od) * radialErr * 1.6;
    const fy = tangY + (oy / od) * radialErr * 1.6;

    const fl = Math.hypot(fx, fy) || 1;
    const speed = 96;
    a.vx += ((fx / fl) * speed - a.vx) * Math.min(1, dt * 4);
    a.vy += ((fy / fl) * speed - a.vy) * Math.min(1, dt * 4);
    a.x = ND.wrapX(a.x + a.vx * dt);
    a.y = ND.wrapY(a.y + a.vy * dt);

    // --- aim at the nearest hostile, fire on the real cadence ---
    if (nearest) {
      a.angle = Math.atan2(
        ND.delta(a.y, nearest.y, ND.WORLD.h),
        ND.delta(a.x, nearest.x, ND.WORLD.w)
      );
    }
    a.cooldown -= dt;
    if (a.cooldown <= 0) {
      a.cooldown = 0.13;
      const sp = 760;
      const isCrit = Math.random() < 0.12;
      a.bullets.push({
        x: a.x + Math.cos(a.angle) * 18,
        y: a.y + Math.sin(a.angle) * 18,
        vx: Math.cos(a.angle) * sp,
        vy: Math.sin(a.angle) * sp,
        life: 1.1,
        crit: isCrit
      });
      ND.audio.play('shoot');
    }

    // --- move demo bullets and resolve hits ---
    for (let i = a.bullets.length - 1; i >= 0; i--) {
      const b = a.bullets[i];
      b.x = ND.wrapX(b.x + b.vx * dt);
      b.y = ND.wrapY(b.y + b.vy * dt);
      b.life -= dt;
      if (b.life <= 0) { a.bullets.splice(i, 1); continue; }
      for (let j = a.enemies.length - 1; j >= 0; j--) {
        const e = a.enemies[j];
        if (ND.distT(b.x, b.y, e.x, e.y) < e.r + 5) {
          e.hp -= b.crit ? 30 : 12;
          e.flash = 0.12;
          a.bullets.splice(i, 1);
          ND.spawnParticles(b.x, b.y, 4, {
            color: '#8ef0ff', speed: 150, life: 0.28, size: 2
          });
          if (e.hp <= 0) {
            // Kill it here rather than through killEnemy: no score, no scrap,
            // no XP — the demo must not touch run state.
            ND.spawnParticles(e.x, e.y, 16, {
              color: '#ff3b6b', speed: 260, life: 0.55, size: 3, drag: 2.4
            });
            ND.audio.play('explode');
            a.enemies.splice(j, 1);
          }
          break;
        }
      }
    }

    // --- enemies chase the demo ship ---
    for (const e of a.enemies) {
      e.flash = Math.max(0, (e.flash || 0) - dt);
      const dx = ND.delta(e.x, a.x, ND.WORLD.w);
      const dy = ND.delta(e.y, a.y, ND.WORLD.h);
      const d = Math.hypot(dx, dy) || 1;
      const sp = (e.speed || 90) * 0.9;
      e.x = ND.wrapX(e.x + (dx / d) * sp * dt);
      e.y = ND.wrapY(e.y + (dy / d) * sp * dt);
      e.angle = Math.atan2(dy, dx);
      e.hitFlash = e.flash > 0 ? 1 : 0;
      if (e.hp < e.maxHp * 0.999) e.hpBar = true;
    }

    // keep the arena populated
    if (a.enemies.length < 5 && Math.random() < dt * 3) spawnAttractEnemy(a);

    // The title overlay fills the viewport, so the demo is always seen *through*
    // the UI. Keep it centred (where the ship and its tracers read best) and
    // lean on contrast instead of trying to dodge the panel.
    const tx = cx - ND.view.w / 2;
    const ty = cy - ND.view.h / 2;
    const smooth = 1 - Math.pow(0.002, dt);
    a.camX += ND.delta(a.camX, tx, ND.WORLD.w) * smooth;
    a.camY += ND.delta(a.camY, ty, ND.WORLD.h) * smooth;
    a.camX = ND.wrapX(a.camX);
    a.camY = ND.wrapY(a.camY);
  }

  function drawAttract(ctx, camX, camY) {
    const a = game.attract;
    if (!a) return;
    ctx.save();
    ctx.translate(-camX, -camY);

    for (const e of a.enemies) {
      drawTiled(e.x, e.y, 80, () => ND.drawEnemy(ctx, e));
    }
    for (const b of a.bullets) {
      drawTiled(b.x, b.y, 40, () => {
        ctx.save();
        ctx.strokeStyle = b.crit ? '#ffd166' : '#8ef0ff';
        ctx.lineWidth = b.crit ? 3 : 2;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      });
    }
    // demo ship: the real silhouette, drawn from a tiny stand-in
    ctx.save();
    const p = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.strokeStyle = '#7df9ff';
    ctx.fillStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, 12);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, -12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // inner core so the ship reads even at a glance
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, TAU);
    ctx.fillStyle = '#dffcff';
    ctx.fill();
    ctx.restore();

    // engine trail
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(34,211,238,0.5)';
    ctx.beginPath();
    ctx.arc(p.x - Math.cos(p.angle) * 14, p.y - Math.sin(p.angle) * 14, 5, 0, TAU);
    ctx.fill();
    ctx.restore();

    ND.drawParticles(ctx, camX, camY, tilesX, tilesY);
    ctx.restore();
  }

  // ---------------- launch transition ----------------
  // Pressing play detonates the demo: a shockwave swallows the screen, debris
  // flies, then the run begins underneath the wash. The overlay is hidden
  // immediately so the wipe is fully visible, and the run is already live when
  // the white-out fades — the two never sit side by side.
  const LAUNCH_DURATION = 0.85;

  function beginLaunch() {
    const sx = ND.view.w / 2;
    const sy = ND.view.h / 2;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    game.attract = null;
    // Roll the run first: reset() clears particles and the world, so anything
    // spawned before this call would be wiped out.
    startGame({ skipBlast: true });

    // Reduced motion: no flash, no shake — just the run, with chrome restored.
    if (reduce) {
      setRunChrome(true);
      return;
    }

    game.launchFx = {
      t: 0,
      duration: LAUNCH_DURATION,
      x: sx,
      y: sy
    };

    // Sparks are world-space (particles are drawn under the camera transform),
    // so spawn them on the ship — which is screen-centre right after reset.
    const px = game.player ? game.player.x : sx;
    const py = game.player ? game.player.y : sy;
    ND.spawnParticles(px, py, 90, {
      color: '#22d3ee', speed: 900, life: 1.1, size: 5, drag: 1.2
    });
    ND.spawnParticles(px, py, 40, {
      color: '#ffffff', speed: 620, life: 0.8, size: 3.5, drag: 1.4
    });
    ND.spawnParticles(px, py, 30, {
      color: '#ff8a3c', speed: 740, life: 1.0, size: 4, drag: 1.1
    });

    ND.addShake(26);
    ND.audio.play('explode');
    ND.audio.play('level');
  }

  function drawLaunchFx(ctx) {
    const f = game.launchFx;
    if (!f) return;
    const k = ND.clamp(f.t / f.duration, 0, 1);

    // 1. Shockwave ring: snaps outward, thinning as it goes.
    const ringR = k * Math.max(ND.view.w, ND.view.h) * 0.95;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k * 1.05);
    ctx.strokeStyle = '#dffcff';
    ctx.lineWidth = 20 * (1 - k) + 1.5;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 50;
    ctx.beginPath();
    ctx.arc(f.x, f.y, ringR, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 2. White-out core: blooms hard, then fades. This is what hides the swap
    //    from the demo world to the real run, so it must peak near-opaque.
    const core = Math.max(0, 1 - k * 2.1);
    if (core > 0.001) {
      const g = ctx.createRadialGradient(
        f.x, f.y, 0,
        f.x, f.y, Math.max(ND.view.w, ND.view.h) * (0.35 + k * 1.1)
      );
      g.addColorStop(0, 'rgba(255,255,255,' + (core * 0.96) + ')');
      g.addColorStop(0.28, 'rgba(190,250,255,' + (core * 0.85) + ')');
      g.addColorStop(0.55, 'rgba(34,211,238,' + (core * 0.5) + ')');
      g.addColorStop(0.8, 'rgba(140,90,255,' + (core * 0.18) + ')');
      g.addColorStop(1, 'rgba(3,5,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ND.view.w, ND.view.h);
    }

    // 3. Trailing chromatic smear while the wave is near full screen.
    if (k > 0.5) {
      const a = (k - 0.5) * 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.16;
      ctx.fillStyle = '#ff2b8a';
      ctx.fillRect(-6 * a, 0, ND.view.w, ND.view.h);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(6 * a, 0, ND.view.w, ND.view.h);
      ctx.restore();
    }
  }

  // ---------------- upgrades UI ----------------
  // `free` opens the same screen without consuming a pending level: it is the
  // scrap-spending mode (T). Picking a card there costs scrap and returns you
  // straight to play, and cancelling costs nothing.
  function openSpend() {
    if (game.state !== 'playing') return;
    if (game.pendingLevels > 0) { openUpgrades(); return; }
    const cheapest = ND.UPGRADES.reduce((min, u) => {
      const lvl = game.upgradeCounts[u.id] || 0;
      if (u.max && lvl >= u.max) return min;
      return Math.min(min, ND.upgradeCost(u, game.buys || 0));
    }, Infinity);
    if (!isFinite(cheapest) || game.scrap < cheapest) {
      toast('NEED ' + (isFinite(cheapest) ? cheapest - game.scrap : 0) + ' MORE SCRAP', '#ff3b6b', true);
      ND.audio.play('switch');
      return;
    }
    openUpgrades(true);
  }

  function closeSpend() {
    game.state = 'playing';
    game.freeSpend = false;
    $('upgrade').classList.add('hidden');
    setBuildVisible(true);
    last = performance.now();
    ND.mouse.down = false;
  }

  function openUpgrades(free) {
    game.state = 'upgrade';
    game.freeSpend = !!free;
    ND.mouse.down = false;
    ND.audio.play('level');

    // Weapon upgrades only make sense for the weapon you are actually holding.
    // ND.WEAPONS order is pulse -> scatter -> rail, and `player.weapon` indexes it.
    const currentWeapon = (ND.WEAPONS[game.player.weapon] || ND.WEAPONS[0]).id;
    const up_locked = (u) => !!(u.weapon && u.weapon !== currentWeapon);

    function weightedPick(list, weightFn) {
      let total = 0;
      const weights = list.map((u) => { const w = Math.max(0.01, weightFn(u)); total += w; return w; });
      let r = Math.random() * total;
      for (let i = 0; i < list.length; i++) {
        r -= weights[i];
        if (r <= 0) return list[i];
      }
      return list[list.length - 1];
    }

    const picks = [];
    const pool = ND.UPGRADES.slice();

    // Offers used to be uniformly random from all 17 upgrades, which meant a run
    // could hand out 11 picks without ever showing a damage card. Weight the
    // draw so the three cards usually cover different roles (offence, defence,
    // utility) and so the player's existing build nudges what appears next.
    const counts = game.upgradeCounts;
    const role = (up) => {
      if (['dmg', 'rate', 'multi', 'crit', 'pierce', 'bspeed'].includes(up.id)) return 'off';
      if (['hp', 'regen', 'lifesteal', 'dash', 'ram'].includes(up.id)) return 'def';
      return 'util';
    };
    const weightOf = (up) => {
      let w = 1;
      const owned = counts[up.id] || 0;
      if (owned > 0) w += 0.6;                       // lean into the current build
      if (role(up) === 'off' && !counts.dmg) w += 1.4; // never starve a new run
      return w;
    };

    // Draw one candidate per role first (deduped), then fill any gaps so the
    // three cards are never three copies of the same role.
    const roles = ['off', 'def', 'util'];
    for (const r of roles) {
      if (picks.length >= 3) break;
      const candidates = pool.filter((u) => {
        const lvl = counts[u.id] || 0;
        if (u.max && lvl >= u.max) return false;
        if (up_locked(u)) return false;
        return role(u) === r;
      });
      if (!candidates.length) continue;
      const up = weightedPick(candidates, weightOf);
      picks.push(up);
      pool.splice(pool.indexOf(up), 1);
    }
    while (picks.length < 3 && pool.length) {
      const idx = ND.randInt(0, pool.length - 1);
      const up = pool.splice(idx, 1)[0];
      const lvl = counts[up.id] || 0;
      if ((up.max && lvl >= up.max) || up_locked(up)) continue;
      picks.push(up);
    }

    const container = $('cards');
    container.innerHTML = '';
    picks.forEach((up, i) => {
      const lvl = game.upgradeCounts[up.id] || 0;
      const nextLvl = lvl + 1;
      const maxed = up.max && nextLvl >= up.max;
      const cost = ND.upgradeCost(up, game.buys || 0);
      const afford = game.scrap >= cost;

      const el = document.createElement('div');
      el.className = 'card' + (up.weapon ? ' card-weapon' : '') +
        (maxed ? ' card-maxed' : '') + (afford ? '' : ' card-poor');

      // Would this pick complete a synergy? Preview the flags without
      // touching the real player, so the card can advertise the unlock.
      const preview = Object.assign({}, game.upgradeCounts);
      preview[up.id] = (preview[up.id] || 0) + 1;
      const nowActive = (game.player.synergies || []).map((s) => s.id);
      const unlocked = ND.activeSynergies(preview)
        .filter((s) => nowActive.indexOf(s.id) === -1);

      el.innerHTML =
        '<span class="key">' + (i + 1) + '</span>' +
        '<div class="glyph">' + ND.iconSvg(up.icon, 30) + '</div>' +
        (up.weapon ? '<span class="wtag">' + up.weapon.toUpperCase() + '</span>' : '') +
        '<div class="cardbody">' +
          '<h3>' + up.name + '</h3>' +
          '<p>' + up.desc + '</p>' +
          '<div class="lvrow">' +
            '<span class="lvlabel">' + (lvl === 0 ? 'NEW' : 'LV ' + lvl + ' → ' + nextLvl) + '</span>' +
            renderPips(lvl, up.max) +
            (maxed ? '<span class="maxtag">MAX</span>' : '') +
          '</div>' +
          '<div class="synwrap">' + unlocked.map((s) =>
            '<div class="synline" style="color:' + s.color + '">' +
              '<span class="bdot" style="background:' + s.color + ';box-shadow:0 0 7px ' + s.color + '"></span>' +
              'UNLOCKS ' + s.name +
            '</div>'
          ).join('') + '</div>' +
        '</div>' +
        '<div class="costrow' + (afford ? '' : ' short') + '">' +
          '<span class="cost">' + cost + '</span>' +
          '<span class="costunit">SCRAP</span>' +
          (afford ? '' : '<span class="costmiss">need ' + (cost - game.scrap) + '</span>') +
        '</div>';
      el.addEventListener('click', () => chooseUpgrade(up));
      container.appendChild(el);
    });

    // Live scrap readout so it's obvious why a card is dimmed.
    const bank = $('scrapBank');
    if (bank) bank.innerHTML = '<span class="sbnum">' + game.scrap + '</span> SCRAP';

    game.currentPicks = picks;
    // The overlay header and its button reflect which mode we are in: a real
    // level-up, or a free scrap purchase. When several picks arrived at once
    // (one fat XP clump can cross two thresholds in a single frame) the header
    // says so, so back-to-back screens read as one drafting session rather than
    // three surprise interruptions.
    const title = $('upgrade').querySelector('h2');
    const sub = $('upgrade').querySelector('p');
    const skip = $('btnSkip');
    const queued = free ? 0 : game.pendingLevels;
    const noneAffordable = picks.every((up) => game.scrap < ND.upgradeCost(up, game.buys || 0));
    if (title) title.textContent = free ? 'spend scrap' : 'level up';
    if (sub) {
      sub.textContent = free
        ? 'buy an upgrade with banked scrap'
        : (noneAffordable
            // Never leave a draft looking broken: state the rule instead.
            ? 'scrap is short — keep fighting, or bank the level'
            : (queued > 1 ? queued + ' upgrades earned — pick one' : 'spend scrap on an upgrade'));
    }
    if (skip) {
      skip.textContent = free
        ? 'back to the fight'
        : (queued > 1 ? 'bank the level (' + queued + ' left)' : 'bank the level');
    }

    // The upgrade overlay is full-width; the tracker would sit on top of the
    // third card, so it steps aside until the pick is made.
    setBuildVisible(false);
    $('upgrade').classList.remove('hidden');
  }

  // Little level dots under each card. Omitted for uncapped upgrades.
  function renderPips(level, max) {
    if (!max) return '';
    let out = '<span class="pips">';
    for (let i = 0; i < max; i++) {
      out += '<i class="' + (i < level ? 'on' : (i === level ? 'next' : '')) + '"></i>';
    }
    out += '</span>';
    return out;
  }

  // ---------------- build tracker ----------------
  // The panel lists everything acquired this run, strongest first, with a
  // level/max readout. Ordered by raw level so a committed build reads at a
  // glance; maxed entries are tinted green.
  function renderBuild() {
    const host = $('buildList');
    if (!host) return;

    const rows = [];
    for (const id in game.upgradeCounts) {
      const lvl = game.upgradeCounts[id];
      const up = ND.UPGRADE_BY_ID[id];
      if (!up || !lvl) continue;
      rows.push({ up: up, lvl: lvl, maxed: up.max && lvl >= up.max });
    }

    if (!rows.length) {
      host.innerHTML = '<div class="bempty">NO MODULES<br>INSTALLED</div>';
      renderBuildHead();
      return;
    }

    // Rank by how complete each module is (a 3/3 counts as more finished than
    // a 2/8), so the panel reads as a build summary at a glance.
    const frac = (r) => (r.up.max ? Math.min(r.lvl, r.up.max) / r.up.max : 0);
    rows.sort((a, b) => {
      const d = frac(b) - frac(a);
      if (Math.abs(d) > 0.001) return d;
      if (a.maxed !== b.maxed) return a.maxed ? -1 : 1;
      return a.up.name.localeCompare(b.up.name);
    });

    // Keep the panel from growing into the HUD: show the strongest entries and
    // summarise the rest in one compact line.
    const LIMIT = 9;
    const shown = rows.length > LIMIT ? rows.slice(0, LIMIT - 1) : rows;
    const rest = rows.length - shown.length;

    let html = shown.map((r) => {
      const cls = 'brow' + (r.up.weapon ? ' weapon' : '') + (r.maxed ? ' maxed' : '');
      const label = r.up.max ? Math.min(r.lvl, r.up.max) + '/' + r.up.max : String(r.lvl);
      return '<div class="' + cls + '" title="' + r.up.name + '">' +
        '<span class="bico">' + ND.iconSvg(r.up.icon, 12) + '</span>' +
        '<span class="bname">' + r.up.name + '</span>' +
        '<span class="blvl">' + label + '</span>' +
      '</div>';
    }).join('');

    if (rest > 0) {
      html += '<div class="bmore">+' + rest + ' MORE</div>';
    }

    // Active set bonuses, with the requirement pips filled in.
    const active = game.player.synergies || [];
    if (active.length) {
      html += '<div class="bsyn-head">SYNERGY</div>';
      html += active.map((s) =>
        '<div class="bsyn" title="' + s.desc + '">' +
          '<span class="bdot" style="background:' + s.color + ';box-shadow:0 0 7px ' + s.color + '"></span>' +
          '<span class="bname">' + s.name + '</span>' +
        '</div>'
      ).join('');
    } else {
      // Nudge: show the closest synergy so the system is discoverable.
      const next = closestSynergy();
      if (next) {
        html += '<div class="bnext" title="' + next.syn.desc + '">' +
          'NEXT SET · ' + next.syn.name + ' <b>' + next.have + '/' + next.need + '</b>' +
        '</div>';
      }
    }

    host.innerHTML = html;
    renderBuildHead();
  }

  // The synergy the player is closest to unlocking, used as a discoverability
  // hint in the build panel before any set is active.
  function closestSynergy() {
    let best = null;
    for (const syn of ND.SYNERGIES) {
      // Progress is gated by the weakest requirement in the pair.
      let worst = syn.needs[0];
      let ratio = 1;
      for (const [id, req] of syn.needs) {
        const r = Math.min(game.upgradeCounts[id] || 0, req) / req;
        if (r < ratio) { ratio = r; worst = [id, req]; }
      }
      if (ratio <= 0) continue;
      if (!best || ratio > best.ratio) {
        best = {
          syn: syn,
          ratio: ratio,
          have: Math.min(game.upgradeCounts[worst[0]] || 0, worst[1]),
          need: worst[1]
        };
      }
    }
    return best;
  }

  // The tracker is clickable so a long build can be folded away mid-fight; the
  // collapsed state is remembered for the session.
  let buildCollapsed = false;

  function renderBuildHead() {
    const head = document.querySelector('#build .build-head');
    if (!head) return;
    const count = Object.keys(game.upgradeCounts || {}).length;
    head.innerHTML = '<span class="btitle">BUILD' + (count ? ' · ' + count : '') + '</span>' +
      '<span class="bchevlbl">' + (buildCollapsed ? 'SHOW' : 'HIDE') + '</span>';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(!buildCollapsed));
  }

  function setBuildCollapsed(on) {
    buildCollapsed = !!on;
    const el = $('build');
    if (el) el.classList.toggle('collapsed', buildCollapsed);
    renderBuildHead();
  }

  function setBuildVisible(on) {
    const el = $('build');
    if (!el) return;
    if (on) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  // ---------------- meta progression UI ----------------
  // Renders the persistent-upgrade tree into whichever panel is on screen
  // (title or game over). Only one panel exists per screen, so a shared
  // renderer keeps the two in sync for free.
  function renderMeta() {
    const panels = [
      { list: $('metaList'), cores: $('metaCores') },
      { list: $('metaListEnd'), cores: $('metaCoresEnd') }
    ];
    const earned = $('coresEarned');
    if (earned) {
      earned.textContent = game.coresEarned
        ? '+' + game.coresEarned + ' CORES BANKED'
        : '';
      earned.classList.toggle('hidden', !game.coresEarned);
    }

    for (const p of panels) {
      if (p.cores) p.cores.textContent = meta.cores;
      if (!p.list) continue;

      p.list.innerHTML = ND.META.map((up) => {
        const lvl = meta.levels[up.id] || 0;
        const maxed = lvl >= up.max;
        const cost = ND.metaCost(up, lvl);
        const afford = !maxed && meta.cores >= cost;
        return (
          '<button type="button" class="meta-row' +
            (maxed ? ' maxed' : '') + (afford ? ' ready' : '') + '"' +
            ' data-meta="' + up.id + '"' + (maxed ? ' disabled' : '') + '>' +
            '<span class="mico" style="color:' + up.color + '">' + ND.iconSvg(up.icon, 16) + '</span>' +
            '<span class="mtext">' +
              '<span class="mname">' + up.name + '</span>' +
              '<span class="mdesc">' + up.desc + '</span>' +
            '</span>' +
            '<span class="mmeta">' +
              '<span class="mpips">' + renderPips(lvl, up.max) + '</span>' +
              '<span class="mcost">' + (maxed ? 'MAX' : cost + ' ◆') + '</span>' +
            '</span>' +
          '</button>'
        );
      }).join('');

      p.list.onclick = (e) => {
        const btn = e.target.closest('[data-meta]');
        if (btn) buyMeta(btn.getAttribute('data-meta'));
      };
    }
  }

  function buyMeta(id) {
    const up = ND.META_BY_ID[id];
    if (!up) return;
    const lvl = meta.levels[id] || 0;
    if (lvl >= up.max) return;
    const cost = ND.metaCost(up, lvl);
    if (meta.cores < cost) {
      ND.audio.play('switch');
      return;
    }
    meta.cores = Math.min(9999999, meta.cores - cost);
    meta.levels[id] = lvl + 1;
    saveMeta(meta);
    ND.audio.play('synergy');
    renderMeta();
  }

  function chooseUpgrade(up) {
    if (game.state !== 'upgrade') return;

    // Upgrades are bought with scrap farmed from kills, so a pick can be
    // refused if the bank is short. The card stays on screen.
    const lvlBefore = game.upgradeCounts[up.id] || 0;
    const cost = ND.upgradeCost(up, game.buys || 0);
    if (game.scrap < cost) {
      ND.audio.play('switch');
      toast('NOT ENOUGH SCRAP // NEED ' + (cost - game.scrap) + ' MORE', '#ff3b6b', true);
      return;
    }
    game.scrap -= cost;
    game.spent = (game.spent || 0) + cost;
    game.buys = (game.buys || 0) + 1;

    up.apply(game.player);
    game.upgradeCounts[up.id] = lvlBefore + 1;

    // Synergies are recomputed from scratch so a level-up can never double
    // apply a bonus, and losing the flags on reset is automatic.
    const before = new Set((game.player.synergies || []).map((s) => s.id));
    const active = ND.applySynergies(game.player, game.upgradeCounts);
    const fresh = active.filter((s) => !before.has(s.id));
    if (fresh.length) {
      // Surface the strongest unlock first; a doubled toast would just be
      // overwritten by the single toast slot anyway.
      const s = fresh[fresh.length - 1];
      toast(s.name + ' // ' + s.desc, s.color, true);
      ND.audio.play('synergy');
    }

    renderBuild();
    $('upgrade').classList.add('hidden');

    // Capture the mode *before* clearing it, so a scrap-spend purchase never
    // consumes a pending level and a level-up never leaks the flag.
    const wasFree = !!game.freeSpend;
    game.freeSpend = false;

    if (wasFree) {
      // Scrap-spend mode: buying one thing returns you to play, and can be
      // reopened immediately with T if there is still more to buy.
      game.state = 'playing';
      setBuildVisible(true);
      last = performance.now();
      ND.mouse.down = false;
    } else if (game.pendingLevels > 1) {
      game.pendingLevels--;
      openUpgrades();
    } else {
      game.pendingLevels = 0;
      game.state = 'playing';
      setBuildVisible(true);
      last = performance.now();
      ND.mouse.down = false;
    }
  }

  // Bank the pending level without buying: the level-up is refunded as scrap
  // so an unaffordable screen never becomes a dead end.
  function bankLevel() {
    if (game.state !== 'upgrade') return;

    // In scrap-spend mode there is no level to bank; B just closes the screen.
    if (game.freeSpend) {
      closeSpend();
      return;
    }
    if (game.pendingLevels <= 0) return;

    const refund = 6 + game.wave * 2;
    game.scrap += refund;
    game.pendingLevels--;
    $('upgrade').classList.add('hidden');
    toast('LEVEL BANKED +' + refund + ' SCRAP', '#ffd166', true);
    ND.audio.play('pickup');

    if (game.pendingLevels > 0) {
      openUpgrades();
    } else {
      game.state = 'playing';
      setBuildVisible(true);
      last = performance.now();
      ND.mouse.down = false;
    }
  }

  window.addEventListener('keydown', (e) => {
    // Never let gameplay shortcuts fire while typing a callsign.
    if (e.target && e.target.tagName === 'INPUT') return;

    const n = parseInt(e.key, 10);
    if (game.state === 'upgrade' && n >= 1 && n <= 3 && game.currentPicks) {
      chooseUpgrade(game.currentPicks[n - 1]);
    }
    if (game.state === 'upgrade' && (e.key === 'b' || e.key === 'B')) {
      bankLevel();
    }
    if (game.state === 'playing' && (e.key === 'r' || e.key === 'R')) {
      useSpecial();
    }
    // Spend scrap without waiting for a level-up. Level-ups slowed to one per
    // several waves late in a run, which left hundreds of scrap stranded; the
    // scrap bank is meant to be the real currency, so it gets its own key.
    if (game.state === 'playing' && (e.key === 't' || e.key === 'T')) {
      openSpend();
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
      else if (game.state === 'upgrade' && game.freeSpend) closeSpend();
    }
  });

  // ---------------- high score leaderboard ----------------
  const BOARD_KEY = 'neondrift.board.v1';
  const BOARD_SIZE = 8;
  const NAME_KEY = 'neondrift.name.v1';
  const META_KEY = 'neondrift.meta.v1';

  // Anything that comes back from localStorage or a name field is untrusted.
  // These helpers keep the leaderboard renderable and stop a hand-edited save
  // from poisoning the board with NaN, negatives, or absurd values.
  function safeName(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '') // control chars
      .replace(/[<>&"'`]/g, '')                     // belt-and-braces vs markup
      .trim()
      .slice(0, 12) || 'PILOT';
  }

  function safeNum(v, max) {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), max);
  }

  function loadBoard() {
    try {
      const raw = localStorage.getItem(BOARD_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          name: safeName(e.name),
          score: safeNum(e.score, 9999999),
          wave: safeNum(e.wave, 9999),
          time: safeNum(e.time, 1e7),
          kills: safeNum(e.kills, 1e7),
          date: safeNum(e.date, 8.64e15)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, BOARD_SIZE);
    } catch (e) {
      return [];
    }
  }

  function saveBoard(board) {
    try {
      localStorage.setItem(BOARD_KEY, JSON.stringify(board.slice(0, BOARD_SIZE)));
    } catch (e) {
      /* storage can be blocked; never let scoring crash a run */
    }
  }

  // ---------------- meta progression ----------------
  // Same threat model as the leaderboard: this lives in localStorage, so it is
  // untrusted. Every field is clamped to its legal range on load, which means a
  // hand-edited save can only ever grant itself the maximum the UI would allow
  // anyway — it cannot inject markup, produce NaN, or break rendering.
  function defaultMeta() {
    return { cores: 0, levels: {}, runs: 0, bestWave: 0 };
  }

  function sanitizeMeta(raw) {
    const out = defaultMeta();
    if (!raw || typeof raw !== 'object') return out;

    out.cores = safeNum(raw.cores, 9999999);
    out.runs = safeNum(raw.runs, 9999999);
    out.bestWave = safeNum(raw.bestWave, 9999);

    const lv = raw.levels;
    if (lv && typeof lv === 'object' && !Array.isArray(lv)) {
      for (const up of ND.META) {
        const v = Math.min(safeNum(lv[up.id], up.max), up.max);
        if (v > 0) out.levels[up.id] = v;
      }
    }
    return out;
  }

  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return defaultMeta();
      const parsed = JSON.parse(raw);
      const clean = sanitizeMeta(parsed);
      // If the stored value differed from the cleaned one (hand-edited save,
      // older schema, corrupt field), rewrite it now so the junk does not
      // linger in storage for the life of the profile.
      try {
        if (JSON.stringify(parsed) !== JSON.stringify(clean)) {
          localStorage.setItem(META_KEY, JSON.stringify(clean));
        }
      } catch (e) { /* write can fail; the in-memory copy is already clean */ }
      return clean;
    } catch (e) {
      return defaultMeta();
    }
  }

  function saveMeta(meta) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(sanitizeMeta(meta)));
    } catch (e) {
      /* ignore: storage can be blocked */
    }
  }

  // Live copy used by the UI and by startGame().
  let meta = loadMeta();

  function loadName() {
    try {
      return (localStorage.getItem(NAME_KEY) || '').slice(0, 12);
    } catch (e) {
      return '';
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (e) {
      /* ignore */
    }
  }

  // Returns { rank, board } — rank is 1-based, or 0 if it did not place.
  function submitRun(run) {
    const board = loadBoard();
    const date = Number(run.date) || Date.now();
    board.push({
      name: safeName(run.name),
      score: safeNum(run.score, 1e9),
      wave: safeNum(run.wave, 9999),
      time: safeNum(run.time, 1e7),
      kills: safeNum(run.kills, 1e7),
      date: date
    });
    board.sort((a, b) => b.score - a.score || b.wave - a.wave);
    const trimmed = board.slice(0, BOARD_SIZE);
    saveBoard(trimmed);

    const idx = trimmed.findIndex((e) => e.date === date);
    return { rank: idx === -1 ? 0 : idx + 1, board: trimmed, date: date };
  }

  function medalFor(rank) {
    return rank === 1 ? '01' : rank === 2 ? '02' : rank === 3 ? '03' : String(rank).padStart(2, '0');
  }

  function renderBoard(el, board, highlightDate) {
    if (!el) return;
    if (!board.length) {
      el.innerHTML = '<div class="board-empty">no runs recorded</div>';
      return;
    }
    el.innerHTML = board
      .map((e, i) => {
        const rank = i + 1;
        const cls =
          'board-row' +
          (rank === 1 ? ' gold' : rank === 2 ? ' silver' : rank === 3 ? ' bronze' : '') +
          (highlightDate && e.date === highlightDate ? ' me' : '');
        const when = e.date ? new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        return (
          '<div class="' + cls + '">' +
            '<span class="rk">' + medalFor(rank) + '</span>' +
            '<span class="nm">' + escapeHtml(e.name) + '</span>' +
            '<span class="sc">' + e.score + '</span>' +
            '<span class="wv">W' + e.wave + '</span>' +
            '<span class="dt">' + when + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showMenuBest() {
    const board = loadBoard();
    const el = $('menuBest');
    if (!el) return;
    if (!board.length) {
      el.textContent = '';
    } else {
      el.textContent = 'BEST ' + board[0].score + '  ·  ' + board[0].name;
    }
    el.classList.remove('is-record');
    renderBoard($('menuBoard'), board);
  }

  // ---------------- state transitions ----------------
  function reset() {
    game.player = new ND.Player();
    // Permanent upgrades are applied once, on the fresh player, before the
    // run's own upgrades layer on top.
    ND.applyMeta(game.player, meta.levels);
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
    game.freeSpend = false;
    game.boss = null;
    game.killstreak = 0;
    game.streakTimer = 0;
    game.currentPicks = null;
    game.upgradeCounts = {};
    game.scrap = ND.metaStartScrap(meta.levels);
    game.spent = 0;
    game.buys = 0;
    game.scrapGain = 0;
    game.slowTime = 0;
    game.blackHole = null;
    game.novaFx = null;
    renderBuild();
    updateSpecialBar();
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

  function startGame(opts) {
    const skipBlast = !!(opts && opts.skipBlast);
    ND.audio.init();
    reset();
    game.state = 'playing';
    game.attract = null;
    hideAllOverlays();
    $('hudbar').classList.remove('hidden');
    setBuildVisible(true);
    // During the launch wipe the HTML chrome would sit on top of the flash, so
    // it is held back and revealed as the blast clears (see frame()).
    if (skipBlast) setRunChrome(false);
    // Paint the tracker now; otherwise an empty build shows stale markup until
    // the first purchase.
    renderBuild();
    ND.music.intensity = 1;
    ND.music.play('track');
    // The blast toast would fight the launch shockwave for attention.
    if (!skipBlast) toast('WAVE 1 // ENGAGE', '#22d3ee');
    last = performance.now();
  }

  // The DOM control bar and build tracker, toggled together.
  function setRunChrome(on) {
    $('hudbar').classList.toggle('hidden', !on);
    setBuildVisible(!!on);
  }

  // Entry point for the menu button: detonate the demo, then roll the run.
  function launchRun() {
    if (game.state !== 'menu') return;
    ND.audio.init();
    // Fade the title out a beat before the run swaps in, so the shockwave is
    // never competing with a semi-transparent title.
    const start = $('start');
    if (start) start.classList.add('is-launching');
    const go = () => {
      if (start) start.classList.remove('is-launching');
      beginLaunch();
    };
    // Respect reduced-motion: skip straight to the run, no flash.
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { go(); return; }
    setTimeout(go, 140);
  }

  function hideAllOverlays() {
    ['start', 'gameover', 'pause', 'upgrade'].forEach((id) => $(id).classList.add('hidden'));
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    ND.mouse.down = false;
    if (ND.music.ctx) ND.music.ctx.suspend();
    $('pause').classList.remove('hidden');
    // The pause overlay owns the screen; the in-run panels would just show
    // through it at different opacities.
    $('hudbar').classList.add('hidden');
    setBuildVisible(false);
  }

  function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    if (ND.music.ctx) ND.music.ctx.resume();
    last = performance.now();
    $('pause').classList.add('hidden');
    $('hudbar').classList.remove('hidden');
    setBuildVisible(true);
  }

  // Stop the run and return to the title screen (also clears the field).
  function stopGame() {
    if (game.state === 'menu') return;
    game.state = 'menu';
    ND.mouse.down = false;
    ND.keys.clear();
    hideAllOverlays();
    $('hudbar').classList.add('hidden');
    setBuildVisible(false);
    if ($('specials')) $('specials').innerHTML = '';
    clearWorld();
    showMenuBest();
    renderMeta();
    ND.music.intensity = 1;
    ND.music.play('menu');
    $('start').classList.remove('hidden');
    // Returning to the title restarts the demo behind it.
    resetAttract();
    game.launchFx = null;
  }

  function clearWorld() {
    game.bullets.length = 0;
    game.enemies.length = 0;
    game.pickups.length = 0;
    game.texts.length = 0;
    game.pendingLevels = 0;
    game.freeSpend = false;
    game.boss = null;
    game.blackHole = null;
    game.novaFx = null;
    game.slowTime = 0;
    ND.particles.length = 0;
    updateSpecialBar();
  }

  function die() {
    if (game.state === 'dead') return;
    game.state = 'dead';
    ND.mouse.down = false;
    ND.music.play('over');
    ND.addShake(20);
    ND.audio.play('explode');
    ND.spawnParticles(game.player.x, game.player.y, 70, {
      color: '#22d3ee', speed: 520, life: 1.2, size: 4
    });

    $('hudbar').classList.add('hidden');
    setBuildVisible(false);
    if ($('specials')) $('specials').innerHTML = '';

    $('finalStats').innerHTML =
      '<div>TIME SURVIVED &nbsp;<b>' + Math.round(game.time) + 's</b></div>' +
      '<div>WAVE REACHED &nbsp;<b>' + game.wave + '</b></div>' +
      '<div>ELIMINATIONS &nbsp;<b>' + game.player.kills + '</b></div>' +
      '<div>FINAL SCORE &nbsp;<b>' + game.score + '</b></div>';

    // Bank meta currency. This is the only place cores are granted, so a run
    // is never worth zero — every death buys progress toward the tree.
    const earned = ND.coresForRun(game.score, game.wave);
    meta.cores = Math.min(9999999, meta.cores + earned);
    meta.runs = Math.min(9999999, meta.runs + 1);
    meta.bestWave = Math.max(meta.bestWave, game.wave);
    saveMeta(meta);

    // Fill the name field with the last used callsign.
    const nameInput = $('nameInput');
    if (nameInput) {
      nameInput.value = safeName(loadName());
      nameInput.maxLength = 12;
    }

    $('nameEntry').classList.remove('hidden');
    $('bestLine').textContent = '';
    $('gameoverBoard').innerHTML = '';
    $('gameover').classList.remove('hidden');

    game.runRecord = {
      score: game.score,
      wave: game.wave,
      time: Math.round(game.time),
      kills: game.player.kills,
      date: Date.now()
    };

    game.coresEarned = earned;
    renderMeta();

    // Focus the field so a player can type a name immediately.
    setTimeout(() => {
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }, 60);
  }

  // Save the run under the entered callsign and reveal the leaderboard.
  function submitScore() {
    const run = game.runRecord;
    if (!run || run.submitted) return;

    const input = $('nameInput');
    const raw = input ? input.value : '';
    const name = safeName((raw.trim() || 'PILOT').toUpperCase());

    saveName(name);
    const result = submitRun({
      name: name,
      score: run.score,
      wave: run.wave,
      time: run.time,
      kills: run.kills,
      date: run.date
    });
    run.submitted = true;

    $('nameEntry').classList.add('hidden');
    renderBoard($('gameoverBoard'), result.board, run.date);

    const bestEl = $('bestLine');
    bestEl.classList.remove('is-record');
    if (result.rank === 1) {
      bestEl.textContent = 'NEW HIGH SCORE';
      bestEl.classList.add('is-record');
    } else if (result.rank > 0) {
      bestEl.textContent = 'PLACED #' + result.rank + ' ON THE BOARD';
    } else {
      bestEl.textContent = 'NO PLACEMENT — BOARD FULL';
    }

    showMenuBest();
  }

  // Auto-pause when the game loses focus so a run cannot continue unseen.
  ND.onBlur = function () {
    if (game.state === 'playing') pauseGame();
  };

  // ---------------- UI wiring ----------------
  $('play').addEventListener('click', launchRun);

  // Browsers require a gesture before audio can start, so the title-screen
  // music begins on the first interaction with the page.
  function unlockAudio() {
    ND.audio.init();
    if (ND.music.pending || !ND.music.current) ND.music.play('menu');
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  }
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  $('restart').addEventListener('click', startGame);
  $('btnMenu').addEventListener('click', stopGame);

  $('btnSubmit').addEventListener('click', submitScore);

  const nameInput = $('nameInput');
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger Q/E weapon swaps
      if (e.key === 'Enter') {
        e.preventDefault();
        submitScore();
      }
    });
    nameInput.addEventListener('keyup', (e) => e.stopPropagation());
  }

  $('btnPause').addEventListener('click', () => {
    if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused') resumeGame();
  });
  $('btnStop').addEventListener('click', stopGame);

  // Build tracker: click the header (or press B on it) to fold the panel away.
  const buildHead = document.querySelector('#build .build-head');
  if (buildHead) {
    buildHead.addEventListener('click', (e) => {
      e.stopPropagation();
      setBuildCollapsed(!buildCollapsed);
    });
    buildHead.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBuildCollapsed(!buildCollapsed); }
    });
  }
  renderBuildHead();

  $('btnSkip').addEventListener('click', (e) => {
    e.stopPropagation();
    bankLevel();
  });

  // Sound toggle: mutes music and sfx together, remembered between sessions.
  let muted = false;
  try { muted = localStorage.getItem('neondrift.muted.v1') === '1'; } catch (e) { muted = false; }

  function applyMute() {
    ND.audio.muted = muted;
    ND.music.setEnabled(!muted);
    const btn = $('btnMute');
    if (btn) {
      btn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
      btn.classList.toggle('is-off', muted);
      btn.setAttribute('aria-pressed', String(muted));
      btn.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Mute sound');
    }
    try { localStorage.setItem('neondrift.muted.v1', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // UPGRADE button mirrors the T key, so the shop is discoverable without
  // reading the controls list.
  $('btnSpend').addEventListener('click', (e) => {
    e.stopPropagation();
    openSpend();
  });

  $('btnMute').addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    applyMute();
  });

  // M toggles sound from the keyboard.
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      applyMute();
    }
  });

  applyMute();

  $('btnResume').addEventListener('click', (e) => {
    e.stopPropagation();
    resumeGame();
  });  $('btnEnd').addEventListener('click', (e) => {
    e.stopPropagation();
    stopGame();
  });

  // clicking the pause backdrop resumes, but clicks on the panel do not
  $('pause').addEventListener('click', (e) => {
    if (e.target === $('pause')) resumeGame();
  });

  requestAnimationFrame(frame);
  showMenuBest();
  renderMeta();
  // The title is the first thing anyone sees, so start the demo immediately.
  resetAttract();
})(window.ND);
