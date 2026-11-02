# NEON DRIFT

A top-down neon arena shooter. Vanilla JS + Canvas, no dependencies, no build step.

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
| `M` | Mute / unmute sound |
| `Esc` | Pause / resume |

The game **auto-pauses** when the window loses focus or the tab is hidden, so a
run never continues unseen.

| `1` `2` `3` | Buy an upgrade on level up |
| `B` | Bank the level for scrap instead |

On-screen buttons: **PAUSE** / **STOP** bottom-left during a run; **RESUME** / **END RUN** on the pause screen; **RUN IT BACK** / **MAIN MENU** after death.

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

## How it plays

Kill enemies, collect XP orbs, level up, and choose 1 of 3 upgrades each time.
Waves escalate on a timer. The first boss arrives on **wave 2**, then every 3rd
wave after that; bosses fire radial bursts.
Dying ends the run and shows your time, wave, kills, and score.

## Upgrades and build tracker

Upgrades are bought with **scrap**, earned from every kill (`score / 5`; tough
enemies pay more, bosses pay 120). Level-ups pause the game and offer three
picks, but you can only take one you can afford:

- The card shows its price and your bank at the top of the screen.
- Unaffordable cards are dimmed with the shortfall in red (`need 35`).
- **BANK THE LEVEL** (or `B`) refunds scrap instead, so a level-up is never a
  dead end.

Price scales with **how many upgrades you have already bought** (`10 + buys * 7`,
×1.5 for weapon upgrades), not with an upgrade's own level. That makes spreading
thin no cheaper than going deep — farming is what buys power. In testing roughly
90% of earned scrap converted into upgrades, which keeps the economy tight but
never starving.

Every upgrade has an icon, a level readout, and pips showing progress toward its
cap. Cards badge `NEW` on first acquisition and `MAX` (green) when a pick
completes the upgrade. Capped upgrades leave the offer pool so a build converges.

A **BUILD** panel sits bottom-right during play, ranked by completion. Icons are
tinted cyan, weapon upgrades amber, maxed modules green. Past 9 entries it
collapses into `+n MORE`. Active set bonuses are listed under `SYNERGY`.

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
js/entities.js    player, enemy types, pickups, upgrades, specials, synergies
js/main.js        game loop, wave director, camera, HUD, state machine
```

Everything is global-namespaced under `window.ND` and loaded with plain
`<script>` tags in order: `core` → `icons` → `music` → `entities` → `main`.

## Tuning notes

Adjust these first when balancing:

- `js/core.js` — `ND.WORLD` arena size.
- `js/entities.js` — `ENEMY_TYPES` (hp, speed, damage, xp) and `ND.UPGRADES`.
- `js/main.js` — spawn cadence in `update()`, `waveDuration`, and `spawnBoss()`.
