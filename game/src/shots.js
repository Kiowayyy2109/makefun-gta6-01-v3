// shots.js — deterministic scenes behind ?shot=start|play|end&seed=N.
// Each scene drives the real simulation for a fixed number of fixed steps
// from a seeded world, so the same seed always frames the same picture:
//   start — the title screen over a slow orbit of the beachfront;
//   play  — mid-chase: Mara in a car, three stars, police behind, a timed
//           delivery on the HUD;
//   end   — the story complete: Mara on foot at the lighthouse at dusk with
//           the takings banked and the completion panel up.

import { CITY, PLACES } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_OVER = 'over';

const STEP = 1 / 60;

function runSteps(world, seconds, ctl) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) world.step(STEP, ctl);
}

const IDLE = { moveX: 0, moveZ: 0, sprint: false, throttle: 0, steer: 0, brake: false, shoot: false, melee: false };

/**
 * Stage the named scene on `world` (already created with the shot's seed).
 * Returns the screen the shell should present over the scene.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'play') {
    // Second mission, delivery leg: put Mara in the car at the pickup and
    // let her drive east for a few seconds with the law behind her.
    world.debug.setMission(1);
    runSteps(world, 0.5, IDLE);
    world.debug.teleport(-128, 68);
    runSteps(world, 0.5, IDLE); // pickup phase completes, delivery timer starts
    // Find the parked car nearest the pickup corner and get in.
    let best = null;
    let bestD = Infinity;
    for (const car of state.cars) {
      if (car.police) continue;
      const d = Math.hypot(car.x - state.player.x, car.z - state.player.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (best) {
      world.debug.teleport(best.x, best.z);
      const ev = [];
      world.tryEnterExit(ev);
    }
    // Stage the chase on the straight east-west avenue at z = 60: Mara's car
    // in the eastbound lane at speed, two police cars right behind her.
    const drive = { ...IDLE, throttle: 1 };
    const car = state.player.car;
    if (car) {
      car.x = -40; car.z = 64.2; car.heading = Math.PI / 2; car.speed = 19;
      state.player.x = car.x; state.player.z = car.z; state.player.heading = car.heading;
    }
    world.debug.setWanted(3);
    runSteps(world, 1.6, drive); // police spawn and give chase
    const hunters = state.cars.filter((c) => c.police && !c.dead);
    if (car && hunters[0]) {
      hunters[0].x = car.x - 15; hunters[0].z = 64.2;
      hunters[0].heading = Math.PI / 2; hunters[0].speed = 21;
    }
    if (car && hunters[1]) {
      // One hunter pulls ahead in the next lane, cutting Mara off — visible
      // in the chase camera, where a car directly behind would be hidden.
      hunters[1].x = car.x + 30; hunters[1].z = 55.8;
      hunters[1].heading = Math.PI / 2; hunters[1].speed = 19;
    }
    runSteps(world, 0.4, drive);
    world.debug.setWanted(3);
    return SCREEN_PLAY;
  }
  if (name === 'end') {
    // The chain is done: bank the takings, scatter a few packages as found,
    // and stand Mara by the lighthouse with the completion panel showing.
    world.debug.setMission(7);
    state.storyDone = true;
    world.debug.addCash(4480);
    for (let i = 0; i < 11 && i < CITY.packages.length; i++) {
      if (!CITY.packages[i].taken) {
        CITY.packages[i].taken = true;
        state.packagesFound += 1;
      }
    }
    world.debug.teleport(PLACES.lighthouse.x - 13, PLACES.lighthouse.z - 37);
    state.player.heading = 0.34; // face the lighthouse itself
    runSteps(world, 1.2, IDLE);
    return SCREEN_OVER;
  }
  // start: a calm city, the title screen over it.
  runSteps(world, 2, IDLE);
  return SCREEN_TITLE;
}

/** Camera for the staged scenes: a slow beachfront orbit for the title. */
export function shotCamera(name, state, t) {
  if (name === 'play') return null; // the shell uses its chase camera
  if (name === 'end') {
    const p = state.player;
    return {
      x: p.x - Math.sin(p.heading) * 13,
      y: 5.2,
      z: p.z - Math.cos(p.heading) * 13,
      tx: p.x + Math.sin(p.heading) * 8,
      ty: 3.2,
      tz: p.z + Math.cos(p.heading) * 8,
    };
  }
  const a = t * 0.05 + 2.4;
  return {
    x: 10 + Math.sin(a) * 95,
    y: 50,
    z: 150 + Math.cos(a) * 95,
    tx: 0, ty: 8, tz: 110,
  };
}
