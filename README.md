# Port Aurelia

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![make.fun gta6-01 rank](https://make.fun/badge/gta6-01/Kiowayyy2109/makefun-gta6-01-v3/rank.svg)](https://make.fun/bounty/gta6-01)
[![make.fun gta6-01 reward](https://make.fun/badge/gta6-01/Kiowayyy2109/makefun-gta6-01-v3/reward.svg)](https://make.fun/bounty/gta6-01)

**Port Aurelia** is an original open-world crime game that runs entirely in a desktop browser from static files — no build step, no network requests, no external assets. Every building, car, sound and song-free siren is generated in code at play time.

You are Mara Voss, newly arrived in the sun-soaked coastal city of Port Aurelia. Run errands for the Solano crew across a full city grid — beach, pier, lighthouse and a ferris wheel included — lift cars, run checkpoint races, recover lost crates, and shake the Aurelia PD's five-star wanted system.

## Features

- **A living 3D city** rendered by a small software-3D engine on Canvas: road grid, varied pastel buildings, palms, beach and ocean, a pier with a lighthouse, and a turning ferris wheel under golden-hour light.
- **On foot and driving**: enter and exit any parked or traffic car, with arcade driving physics, collisions and a speedometer.
- **Traffic and pedestrians**: AI cars follow the road grid and brake for obstacles; pedestrians stroll the sidewalks and promenade and flee danger.
- **Wanted system, 0–5 stars**: police cars pursue and ram, foot officers join at higher heat, a bust meter fills when they corner you, and stars decay when you break line of sight. Get busted and the PD fines you; get wasted and St. Brine Hospital bills you.
- **An 8-mission story chain** with cash rewards — meetings, a car delivery, two checkpoint races against the clock, a crate recovery, two police escapes and a timed deposit run — plus 20 hidden packages and ammo caches as side activities.
- **Combat**: melee (F) and a pistol with limited ammo (click or J), with pickups around the city.
- **HUD**: cash, health, wanted stars, mission objective with timer, contextual prompts, and a circular minimap showing roads, the objective, police and packages.
- **Synthesized audio**: engine hum, sirens, gunshots, crashes, pickups and mission jingles, all generated with WebAudio — no audio files.
- **Saving**: cash, mission progress, packages, ammo and health persist in `localStorage`.

## Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Move / drive, steer |
| Shift | Sprint |
| E | Enter or exit a car |
| F | Melee attack |
| Mouse click or J | Fire pistol |
| Space | Handbrake |
| P or Esc | Pause |
| Enter | Start |

## How to run

Serve the `game/` folder with any static file server and open it in desktop Chrome:

```sh
node serve.ts
# then open http://localhost:8080
```

Or use any other static server pointed at `game/` (for example `npx serve game`). The game needs no network access once the files are served.

To produce the competition output (copies `game/` and `screenshots/` and writes `dossier.json`):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are staged deterministically with `?shot=start|play|end&seed=1` on the game URL, as listed in `shots.json`.

## Competition

This game is an entry in the make.fun **gta6-01** "Make GTA 6" bounty:

See the bounty page at https://make.fun/bounty/gta6-01 for the rules, leaderboard and rewards.

## License

MIT — see `LICENSE`.
