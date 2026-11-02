# NEON DRIFT

A top-down neon arena shooter. Vanilla JS + Canvas, no dependencies, no build step.

**Play it:** <https://neon-drift-delta-livid.vercel.app/> — or open `index.html`.

## Arena

The arena is a **torus**: fly off the right edge and you reappear on the left;
same top and bottom. There is no wall to get cornered against.

This is real wrap-around, not just a teleport. Every bit of spatial logic uses
shortest-path (toroidal) math:

- Enemies chase you across the seam instead of walking the length of the map.
- Aiming, the orbital drone, pickups and the black hole all take the short route.
- Bullets and particles persist through the edge and can hit on the far side.
- Objects near a seam are drawn on **both** sides of the screen at once, so you
  can see a threat approaching from the other edge.
- The camera wraps too, lerping in toroidal space so it never whips across the
  world when you cross.

Helpers live in `js/core.js`: `ND.wrapX`, `ND.wrapY`, `ND.wrap`, `ND.delta`,
`ND.distT`. Use `ND.distT` (not `ND.dist`) for any gameplay distance check.


## Play

Open `index.html` in a browser. That's it.

Or serve it locally:

```sh
python -m http.server 8123
# then visit http://localhost:8123/
```

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Aim |
| Hold Left Mouse | Fire |
| `Space` / `Shift` | Dash (brief invulnerability) |
| `Q` / `E` | Cycle weapon |
| `R` | Fire a chargeable special |
| `T` | Open the upgrade screen to spend banked scrap |
| `M` | Mute / unmute sound |
| `Esc` | Pause / resume |
| `B` (in a draft) | Bank the level for scrap |
| `1` `2` `3` (in a draft) | Buy an upgrade |

The game **auto-pauses** when the window loses focus or the tab is hidden, so a
run never continues unseen.

| `1` `2` `3` | Buy an upgrade in a draft |
| `B` | Bank the level for scrap instead (or close the scrap screen) |

On-screen buttons, bottom-left during a run: **PAUSE** (Esc), **UPGRADE** (opens
the scrap shop, same as `T`), **SOUND ON/OFF** (turns red when muted), **STOP**
(abandons the run). The pause screen has **RESUME** / **END RUN**; death offers
**RUN IT BACK** / **MAIN MENU**.

The **BUILD** tracker bottom-right can be folded away by clicking its header
(`HIDE` / `SHOW`). Both the control bar and the tracker are hidden while paused.

## Weapons

Switch freely at any time with `Q` / `E`; the current weapon is shown above the
dash meter. Upgrades apply to all three, plus weapon-specific ones.

| Weapon | Feel |
| --- | --- |
| PULSE | Balanced, high rate of fire. The default. |
| SCATTER | Seven-pellet burst, short range, huge close damage. |
| RAIL | Slow, heavy, pierces 3 enemies and flies fast. |

Weapon-specific upgrades appear with a gold tag on the card:

| Upgrade | Effect |
| --- | --- |
| Pulse Flak | PULSE shots shatter into fragments on impact |
| Buckshot | SCATTER gains +2 pellets and a tighter spread |
| Rail Lance | RAIL gains +2 pierce and +25% damage |
| Overcharged Lance | RAIL charges 30% faster with a wider beam |
| Ram Plating | Dashing into enemies deals +80% burn damage |

## Collision rules

Enemies are always pushed out of your hull, so nothing can camp on your ship.

- **Normal contact** — you take damage and the enemy is knocked back.
- **Chasers explode on impact** instead of lingering. No score or loot for a
  kamikaze kill; it just clears the field.
- **While dashing or invulnerable** — you take no damage and *burn* whatever
  touches you. Dashing deals 3.4× your damage as a ram.

Enemies also push each other apart via a spatial-grid separation pass, so a
large wave reads as a swarm instead of a single stacked blob.

## Soundtrack

The entire soundtrack is **synthesised at runtime** — there are no audio files.
`js/music.js` is a small synthwave engine: a lookahead scheduler queues notes
slightly ahead of the audio clock so timing stays tight even when frames hitch.

| Track | When | Feel |
| --- | --- | --- |
| `menu` | Title screen | Slow, atmospheric, heavy pad |
| `track` | Normal waves | 116 BPM, drums + bass + arp over Am–F–C–G |
| `boss` | Boss fight | 140 BPM, four-on-the-floor kick, saw arp |
| `over` | Game over | Sparse, decaying outro |

All four share one chord progression so switching between them feels musical
rather than jarring. The main loop also gains intensity (drums and bass get
louder) as your wave count climbs.

Sound can be toggled with the **SOUND ON/OFF** button or the `M` key. The
setting persists in `localStorage`. Music and SFX are on separate gain buses, so
muting affects both while they stay independently balanced.

## Performance notes

- Particles are capped at **900**. Beyond that the frame cost spikes sharply and
  the screen is unreadable anyway, so the cap behaves as a graceful ceiling
  rather than a visual downgrade (normal play sits around 20 live particles).
- Particle drawing batches by colour so `shadowBlur` (the expensive part) is set
  once per colour run instead of per particle.
- Enemy separation uses a 64px uniform grid, so cost stays near-linear.
- Measured on the dev machine: ~140 FPS idle, ~120 FPS mid-fight, and ~45 FPS
  under an artificial stress load of 60 enemies plus a full particle budget.

## High scores

The game keeps a **top-8 leaderboard** in `localStorage` (`neondrift.board.v1`).
When you die, type a callsign (up to 12 characters, defaults to your last one)
and the run is ranked by score. The board shows rank, name, score, wave, and
date, with gold/silver/bronze accents for the top three and your fresh entry
highlighted. The same board is shown on the title screen.

Your last callsign is remembered in `neondrift.name.v1`. Clearing site data
resets both.

Because both keys are client-side, they are **untrusted input**. Everything read
back is sanitized on load: names are stripped of control characters and markup,
numbers are coerced to finite non-negative integers and capped, and non-object
entries are dropped. A hand-edited save can still lie about its own score — it
is your own browser's board — but it cannot break the page, inject markup, or
crash the renderer.

## How it plays

Kill enemies, collect XP orbs, level up, and choose 1 of 3 upgrades each time.
Waves escalate on a timer. The first boss arrives on **wave 2**, then every 3rd
wave after that; bosses fire radial bursts. The wave clock keeps running during
a boss fight (escorts trickle in at 40% of the normal cap), so a long boss kill
never freezes progression.
Dying ends the run and shows your time, wave, kills, and score.

## Persistent systems (meta progression)

Scrap and upgrades reset with each run, but every run pays out **cores**
(`score / 100 + wave / 2`, minimum 1). Spend them on the title screen or the
game-over screen to permanently upgrade your next runs:

| System | Effect | Max |
| --- | --- | --- |
| **Reinforced Hull** | +15 starting hull per level | 3 |
| **Calibrated Barrels** | +7% weapon damage per level | 3 |
| **Salvage Rig** | +12% scrap from every kill per level | 3 |
| **Afterburner Coils** | −8% dash cooldown per level | 3 |
| **Scrap Stipend** | +18 starting scrap per level | 3 |

Prices scale with how many levels of that system you already own
(`base * (1 + owned * 0.85)`, rounded to 5). The tree is deliberately modest —
it softens a bad run rather than replacing the in-run build.

Stored in `neondrift.meta.v1`. Like the leaderboard it is treated as **untrusted**:
cores are clamped, levels are clamped to each system's cap, unknown keys are
dropped, and the cleaned value is written straight back so a corrupt save heals
itself on load.

## Upgrades and build tracker

Upgrades are bought with **scrap**, earned from every kill (`score / 5`; tough
enemies pay more, bosses pay 120). The draft screen offers three picks, but you
can only take one you can afford:

- The card shows its price and your bank at the top of the screen.
- Unaffordable cards are dimmed with the shortfall in red (`need 35`).
- **BANK THE LEVEL** (or `B`) refunds scrap instead, so a draft is never a
  dead end.

### When the draft opens

A level-up does **not** open the shop every time. Picks land every **3 levels**,
starting at level 2 (levels 2, 5, 8, 11…). The HUD shows a live `PICK IN n`
countdown next to your scrap.

Two measurements drove that rule:

- One run opened the upgrade screen **10 times in 90 seconds**, six of them
  from a single fat XP clump that crossed levels 5→11 in under two seconds.
  Back-to-back screens with no fighting between them feel like a bug, not a
  reward.
- The XP curve was purely multiplicative, so it outran the roughly linear
  supply of orbs and stalled progress near level 13 — stranding hundreds of
  scrap. It is now capped at `250` XP per level, which keeps levels arriving
  all run (the cap is hit around level 12).

`T` is the pressure valve: it opens the same shop at any time and spends banked
scrap, so a slower auto-open cadence costs no power. In a 5-minute bot run the
build came mostly from voluntary `T` purchases (25 buys against 10 level picks).

Price scales with **how many upgrades you have already bought**
(`10 + buys^1.42 * 6`, ×1.5 for weapon upgrades), not with an upgrade's own
level. That makes spreading thin no cheaper than going deep — farming is what
buys power. In testing roughly 90% of earned scrap converted into upgrades,
which keeps the economy tight but never starving.

Every upgrade has an icon, a level readout, and pips showing progress toward its
cap. Cards badge `NEW` on first acquisition and `MAX` (green) when a pick
completes the upgrade. Capped upgrades leave the offer pool so a build converges.

A **BUILD** panel sits bottom-right during play, ranked by completion. Icons are
tinted cyan, weapon upgrades amber, maxed modules green. Past 9 entries it
collapses into `+n MORE`. Active set bonuses are listed under `SYNERGY`. Click
the header to fold the whole panel down to a single line mid-fight.

All icons are inline SVG path data in `js/icons.js` (`ND.iconSvg(id, size)`).

## Boss specials

Every boss kill grants a special ability — you can hold at most **3**. After
that, extra boss kills pay a scrap bonus instead.

| Special | Effect |
| --- | --- |
| **NOVA CORE** | `R`: 340-radius shockwave for 4.5× damage |
| **TIME DILATION** | `R`: slows every hostile to 28% speed for 4s |
| **BLACK HOLE** | `R`: drags enemies into a point, then detonates |
| **AEGIS PLATING** | Passive: absorbs one hit, recharges every 7s |
| **ORBITAL DRONE** | Passive: circles you and auto-fires |

Specials are shown bottom-left with a live cooldown; actives flash bright when
ready. `R` fires the first active special that is off cooldown. Passives are
marked `ON`.

## Ship scale

All ship hitboxes and visuals are sized through `SHIP` in `js/entities.js`
(currently `0.65`). Changing that one constant scales the player, every enemy,
the boss, and — because it feeds the collision radius — the hitboxes in lockstep
with the art. Muzzle offsets, thruster length, cockpit size and the drone orbit
derive from it too.

## Structure

```
index.html        screens: title, level up, pause, game over
css/style.css     layout, CRT scanlines, neon buttons, upgrade cards, build panel
js/core.js        canvas + view, math helpers, input, particles, WebAudio synth
js/icons.js       inline SVG icon set for every upgrade
js/music.js       procedural synthwave soundtrack
js/entities.js    player, enemy types, pickups, upgrades, specials, synergies, meta
js/main.js        game loop, wave director, camera, HUD, state machine, save data
```

Everything is global-namespaced under `window.ND` and loaded with plain
`<script>` tags in order: `core` → `icons` → `music` → `entities` → `main`.

## Deploying

The site is static, so hosting is trivial. `vercel.json` sets the security
headers (CSP, `X-Frame-Options`, `Permissions-Policy`) and disables caching on
`js/` and `css/` so a deploy is picked up immediately.

```sh
vercel deploy            # preview URL
vercel deploy --prod     # promote to production
```

Pushing to `git` and importing the repo in Vercel also works with no build
settings — there is no build step.

## Tuning notes

Adjust these first when balancing:

- `js/core.js` — `ND.WORLD` arena size.
- `js/entities.js` — `ENEMY_TYPES` (hp, speed, damage, xp) and `ND.UPGRADES`.
- `js/main.js` — spawn cadence in `update()`, `waveDuration`, and `spawnBoss()`.

### Why the curves look the way they do

Enemy health scales **geometrically** (`1.175^(wave-1)`) and so does boss health.
Player damage also compounds, so the two have to grow at comparable rates or the
run flattens out. The old curves did not:

| | Before | After |
| --- | --- | --- |
| Enemy health | `1 + 0.13*(wave-1)` (linear) | `1.175^(wave-1)` |
| Boss health | `300 + 180*wave` | `420 * 1.175^(wave-1)` |
| Overcharge | +22% × 8 | +18% × 7 |
| Hyper Cycle | +18% × 8 | +14% × 6 |
| Time-to-kill (wave 1 → 20) | 0.16s → 0.005s | 0.16s → 0.08s |

The measured effect: a single chaser stayed killable in roughly a tenth of a
second at wave 20 instead of dying to one frame of fire, and a wave-2 boss is a
~4 second fight instead of a ~2 second one.

Other knobs that matter:

- **Spawn pressure** — `12 + 2.6*wave` enemies (capped at 64) every
  `max(0.22, 0.62 - 0.03*wave)` seconds. The old floor of `0.1s` meant 15.5
  spawns/sec by wave 12, which read as a wall of bodies rather than a fight.
- **Upgrade price** — `10 + buys^1.42 * 6` (weapon upgrades ×1.5). Tuned so a
  run is always *near* able to afford the next upgrade: a flat `7 * buys` left
  a bot run holding 486 unspent scrap by wave 12.
- **Offers** — each level-up deals one offence, one defence, and one utility
  card, weighted toward your existing build. Uniformly random draws could hand
  out 11 picks without ever showing a damage card.

## Balance testing

There is no test runner; balance was measured by driving the real game loop in a
browser with a kiting bot (aim at the nearest enemy, flee when crowded, dash when
surrounded, buy the strongest affordable card, spend banked scrap with `T`
between drafts) and sampling state once a second.

The bot is deliberately competent but not superhuman. A representative run under
the current pacing (`1-in-3` drafts, 250 XP cap) reached **wave 16 in 5 minutes**,
never dropping below **49% hull**, with damage per second climbing
83 → 222 (wave 3) → 380 (wave 8) → 822 (wave 16). That is the intended "you can
go deep if you play well" ceiling; a human who does not kite should die much
earlier.

Notable finding from that run: of 25 purchases, only 10 came from level picks —
the other 15 were voluntary `T` spends. Cutting the auto-open cadence therefore
costs far less power than the pick count alone suggests, because scrap keeps
buying upgrades between drafts.

Enemy health scales geometrically (`1.175^(wave-1)`, bosses `420 * 1.175^(wave-1)`)
rather than linearly, so wave 20 stays threatening: time-to-kill on a basic
chaser moves from 0.16s on wave 1 to 0.08s on wave 20 with a mid-run build.

