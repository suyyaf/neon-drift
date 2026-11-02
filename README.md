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
| `Esc` | Pause / resume |
| `1` `2` `3` | Pick upgrade on level up |

On-screen buttons: **PAUSE** / **STOP** bottom-left during a run; **RESUME** / **END RUN** on the pause screen; **RUN IT BACK** / **MAIN MENU** after death.

## How it plays

Kill enemies, collect XP orbs, level up, and choose 1 of 3 upgrades each time.
Waves escalate on a timer; every 3rd wave spawns a boss that fires radial bursts.
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
