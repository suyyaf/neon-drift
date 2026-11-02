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
| `Esc` | Pause / resume |
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

## Structure

```
index.html        screens: title, level up, pause, game over
css/style.css     layout, CRT scanlines, neon buttons, upgrade cards
js/core.js        canvas + view, math helpers, input, particles, WebAudio synth
js/entities.js    player, enemy types, pickups, upgrade definitions
js/main.js        game loop, wave director, camera, HUD, state machine
```

Everything is global-namespaced under `window.ND` and loaded with plain
`<script>` tags in order: `core` → `entities` → `main`.

## Tuning notes

Adjust these first when balancing:

- `js/core.js` — `ND.WORLD` arena size.
- `js/entities.js` — `ENEMY_TYPES` (hp, speed, damage, xp) and `ND.UPGRADES`.
- `js/main.js` — spawn cadence in `update()`, `waveDuration`, and `spawnBoss()`.
