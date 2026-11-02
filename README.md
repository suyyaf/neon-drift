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
| `M` | Mute / unmute sound |
| `Esc` | Pause / resume |

The game **auto-pauses** when the window loses focus or the tab is hidden, so a
run never continues unseen.

| `1` `2` `3` | Pick upgrade on level up |

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

Every level-up offers 3 random upgrades with an icon, a level readout, and a
row of pips showing progress toward the cap. Cards badge `NEW` on first
acquisition and `MAX` (green border) when the pick completes the upgrade.

Each upgrade has a `max` level (weapon-specific ones cap lower, at 2–4), so a
build converges rather than scaling forever. Completed upgrades stop appearing
in the offer pool.

A **BUILD** panel sits in the bottom-right during play and lists everything you
have acquired, ranked by how complete each module is. Icons are tinted cyan,
weapon upgrades amber, and maxed modules green with a `n/n` readout. Past 9
entries the panel collapses the rest into a `+n MORE` line so it never grows
into the HUD.

All icons are inline SVG path data in `js/icons.js` (`ND.iconSvg(id, size)`),
drawn on a 24×24 viewBox with `currentColor` so they inherit the accent colour,
and scale crisply at any size.

## Structure

```
index.html        screens: title, level up, pause, game over
css/style.css     layout, CRT scanlines, neon buttons, upgrade cards, build panel
js/core.js        canvas + view, math helpers, input, particles, WebAudio synth
js/icons.js       inline SVG icon set for every upgrade
js/music.js       procedural synthwave soundtrack
js/entities.js    player, enemy types, pickups, upgrade definitions
js/main.js        game loop, wave director, camera, HUD, state machine
```

Everything is global-namespaced under `window.ND` and loaded with plain
`<script>` tags in order: `core` → `icons` → `music` → `entities` → `main`.

## Tuning notes

Adjust these first when balancing:

- `js/core.js` — `ND.WORLD` arena size.
- `js/entities.js` — `ENEMY_TYPES` (hp, speed, damage, xp) and `ND.UPGRADES`.
- `js/main.js` — spawn cadence in `update()`, `waveDuration`, and `spawnBoss()`.
