// world.js — Port Aurelia's simulation: the player on foot and in cars,
// traffic that drives the grid, pedestrians, police and the wanted system,
// combat, pickups, hidden packages and the mission chain. Pure rules and
// state; rendering and sound live elsewhere. step() returns event strings
// the shell turns into sounds and banners.

import {
  CITY, PLACES, STREETS_X, STREETS_Z, nearestStreetX, nearestStreetZ,
  resolveCollision, hitsBuilding, groundAt,
} from './city.js';
import { MISSIONS } from './missions.js';
import { createRng, randRange, pick, clamp, turnToward, dist2d, headingOf } from './rng.js';

const HEAT_THRESHOLDS = [0, 1, 30, 70, 120, 180];
const SAVE_VERSION = 1;

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 0; i < HEAT_THRESHOLDS.length; i++) if (heat >= HEAT_THRESHOLDS[i]) stars = i;
  return stars;
}

function makeCar(x, z, heading, color, parked) {
  return {
    x, z, heading, speed: 0, color, parked: !!parked, police: false,
    driver: parked ? null : 'traffic', hp: 100, wheelSpin: 0,
    targetX: x, targetZ: z, stuckT: 0, dead: false,
    wpX: 0, wpZ: 0, wpT: 0,
  };
}

export function createWorld(seed) {
  const rng = createRng(seed);
  const state = {
    time: 0,
    player: {
      x: PLACES.spawn.x, z: PLACES.spawn.z, heading: Math.PI, walkPhase: 0,
      moving: false, mode: 'foot', health: 100, car: null,
      shirt: [0.08, 0.5, 0.55], pants: [0.16, 0.16, 0.2], skin: [0.72, 0.5, 0.36],
      officer: false, down: false, shootCd: 0, meleeCd: 0, hurtT: 0,
    },
    cars: [], peds: [], cops: [],
    cash: 120, ammo: 24,
    heat: 0, wanted: 0, lastSeenT: -99, seenNow: false, bustedMeter: 0,
    over: null, // 'busted' | 'wasted'
    packagesFound: 0,
    missionIndex: 0, phaseIndex: 0, missionState: 'active',
    phaseTimer: -1, phaseSub: '', objective: '', objectiveSub: '',
    marker: null, checkpoints: null, checkpointNext: 0,
    collectLeft: 0, escapeStage: '',
    storyDone: false,
    pickups: CITY.pickups,
    fx: { flash: 0 },
    stats: { shotsFired: 0, carsDriven: 0 },
  };

  function resetEntities() {
    state.cars = [];
    // Traffic already rolling on the grid.
    for (let i = 0; i < 14; i++) {
      const onX = rng() < 0.5;
      let x, z, heading;
      if (onX) {
        x = pick(rng, STREETS_X);
        z = randRange(rng, -260, 170);
        heading = rng() < 0.5 ? 0 : Math.PI;
      } else {
        z = pick(rng, STREETS_Z);
        x = randRange(rng, -260, 260);
        heading = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      const car = makeCar(x, z, heading, pick(rng, CAR_PALETTE), false);
      car.speed = randRange(rng, 8, 13);
      pickTarget(car);
      state.cars.push(car);
    }
    // Parked cars from the city's kerb spots.
    const spots = CITY.parkedSpots;
    for (let i = 0; i < spots.length && state.cars.length < 44; i += 2) {
      const spot = spots[i];
      state.cars.push(makeCar(spot.x, spot.z, spot.heading, pick(rng, CAR_PALETTE), true));
    }
    // Pedestrians on the sidewalks.
    state.peds = [];
    for (let i = 0; i < 22; i++) state.peds.push(spawnPed());
    state.cops = [];
  }

  const CAR_PALETTE = [
    [0.85, 0.25, 0.2], [0.2, 0.4, 0.85], [0.95, 0.8, 0.2], [0.9, 0.9, 0.92],
    [0.15, 0.15, 0.18], [0.2, 0.7, 0.4], [0.9, 0.5, 0.15], [0.6, 0.3, 0.7],
    [0.75, 0.75, 0.78], [0.3, 0.75, 0.8],
  ];

  function sidewalkPointNear(x, z, minD, maxD) {
    for (let tries = 0; tries < 12; tries++) {
      const onX = rng() < 0.5;
      let px, pz;
      if (onX) {
        px = nearestStreetX(x + randRange(rng, -90, 90)) + (rng() < 0.5 ? -13.5 : 13.5);
        pz = z + randRange(rng, minD, maxD) * (rng() < 0.5 ? -1 : 1);
      } else {
        pz = nearestStreetZ(z + randRange(rng, -90, 90)) + (rng() < 0.5 ? -13.5 : 13.5);
        px = x + randRange(rng, minD, maxD) * (rng() < 0.5 ? -1 : 1);
      }
      px = clamp(px, -275, 275);
      pz = clamp(pz, -275, 190);
      if (!hitsBuilding(px, pz, 1)) return { x: px, z: pz };
    }
    return { x: PLACES.spawn.x, z: PLACES.spawn.z };
  }

  function spawnPed() {
    const p = sidewalkPointNear(state.player.x, state.player.z, 20, 110);
    return {
      x: p.x, z: p.z, heading: randRange(rng, 0, Math.PI * 2), walkPhase: randRange(rng, 0, 6),
      moving: false, hp: 50, down: false, downT: 0, fleeT: 0,
      targetX: p.x, targetZ: p.z,
      shirt: pick(rng, [[0.8, 0.4, 0.3], [0.3, 0.5, 0.8], [0.9, 0.8, 0.3], [0.4, 0.75, 0.4], [0.85, 0.85, 0.85], [0.7, 0.4, 0.65]]),
      pants: [0.3, 0.3, 0.35], skin: pick(rng, [[0.85, 0.65, 0.5], [0.6, 0.42, 0.3], [0.95, 0.75, 0.6], [0.45, 0.3, 0.2]]),
      officer: false,
    };
  }

  function pickTarget(car) {
    // Aim for a point down the current street, lane-offset to the right.
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const rx = fz;
    const rz = -fx;
    let best = null;
    let bestD = Infinity;
    if (Math.abs(fz) > 0.7) {
      for (const sz of STREETS_Z) {
        const d = (sz - car.z) * Math.sign(fz);
        if (d > 18 && d < bestD) { bestD = d; best = { x: nearestStreetX(car.x), z: sz }; }
      }
    } else {
      for (const sx of STREETS_X) {
        const d = (sx - car.x) * Math.sign(fx);
        if (d > 18 && d < bestD) { bestD = d; best = { x: sx, z: nearestStreetZ(car.z) }; }
      }
    }
    car.turnaround = !best;
    if (!best) best = { x: clamp(car.x + fx * 60, -260, 260), z: clamp(car.z + fz * 60, -260, 175) };
    car.targetX = best.x + rx * 4.2;
    car.targetZ = best.z + rz * 4.2;
  }

  // ---------------------------------------------------------- missions
  function startMission(index) {
    state.missionIndex = index;
    state.phaseIndex = 0;
    state.missionState = 'active';
    setupPhase();
  }

  function setupPhase() {
    const mission = MISSIONS[state.missionIndex];
    if (!mission) {
      state.missionState = 'done';
      state.marker = null;
      state.checkpoints = null;
      state.objective = 'Story complete — Port Aurelia is yours.';
      state.objectiveSub = 'Free roam: find the hidden packages.';
      return;
    }
    const phase = mission.phases[state.phaseIndex];
    state.phaseTimer = phase.timer || -1;
    state.checkpoints = null;
    state.marker = null;
    state.escapeStage = '';
    if (phase.setWanted) addHeat(HEAT_THRESHOLDS[phase.setWanted] - state.heat + 1, true);
    if (phase.kind === 'race') {
      state.checkpoints = phase.points.map((p) => ({ x: p.x, z: p.z, done: false }));
      state.checkpointNext = 0;
      const next = state.checkpoints[0];
      state.marker = { x: next.x, z: next.z };
    } else if (phase.kind === 'collect') {
      state.checkpoints = phase.points.map((p) => ({ x: p.x, z: p.z, done: false }));
      state.collectLeft = phase.points.length;
      state.marker = null;
    } else {
      state.marker = { x: phase.x, z: phase.z };
      if (phase.kind === 'escape') state.escapeStage = 'go';
    }
    refreshObjective();
  }

  function refreshObjective() {
    const mission = MISSIONS[state.missionIndex];
    if (!mission) return;
    const phase = mission.phases[state.phaseIndex];
    let sub = '';
    if (phase.kind === 'race') sub = `Checkpoint ${state.checkpointNext + 1} of ${state.checkpoints.length}`;
    else if (phase.kind === 'collect') sub = `${state.collectLeft} left`;
    else if (phase.kind === 'escape' && state.escapeStage === 'laylow') sub = 'Stay out of sight until the stars fade';
    if (state.phaseTimer > 0) sub += (sub ? ' · ' : '') + `${Math.ceil(state.phaseTimer)}s`;
    state.objective = `${mission.title} — ${phase.kind === 'escape' && state.escapeStage === 'laylow' ? 'Lie low until the heat dies down' : phase.text}`;
    state.objectiveSub = sub;
  }

  function completePhase(events) {
    const mission = MISSIONS[state.missionIndex];
    state.phaseIndex += 1;
    if (state.phaseIndex >= mission.phases.length) {
      state.cash += mission.reward;
      events.push('mission-done');
      if (state.missionIndex + 1 >= MISSIONS.length) {
        state.storyDone = true;
        events.push('story-done');
      }
      startMission(state.missionIndex + 1);
    } else {
      events.push('phase-done');
      setupPhase();
    }
  }

  function failMission(events) {
    events.push('mission-fail');
    state.heat = 0;
    state.wanted = 0;
    startMission(state.missionIndex);
  }

  function updateMissions(dt, events) {
    if (state.missionState !== 'active') return;
    const mission = MISSIONS[state.missionIndex];
    if (!mission) return;
    const phase = mission.phases[state.phaseIndex];
    const p = state.player;
    if (state.phaseTimer > 0) {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) { failMission(events); return; }
    }
    if (phase.kind === 'goto') {
      if (dist2d(p.x, p.z, phase.x, phase.z) < 6) completePhase(events);
    } else if (phase.kind === 'race') {
      const cp = state.checkpoints[state.checkpointNext];
      if (cp && dist2d(p.x, p.z, cp.x, cp.z) < 8) {
        cp.done = true;
        events.push('checkpoint');
        state.checkpointNext += 1;
        if (state.checkpointNext >= state.checkpoints.length) { completePhase(events); return; }
        const next = state.checkpoints[state.checkpointNext];
        state.marker = { x: next.x, z: next.z };
      }
    } else if (phase.kind === 'collect') {
      for (const cp of state.checkpoints) {
        if (!cp.done && dist2d(p.x, p.z, cp.x, cp.z) < 5.5) {
          cp.done = true;
          state.collectLeft -= 1;
          events.push('collect');
          state.cash += 40;
        }
      }
      if (state.collectLeft <= 0) { completePhase(events); return; }
    } else if (phase.kind === 'escape') {
      if (state.escapeStage === 'go') {
        if (dist2d(p.x, p.z, phase.x, phase.z) < 7) {
          state.escapeStage = 'laylow';
          state.marker = null;
          events.push('phase-done');
        }
      } else if (state.wanted === 0) {
        completePhase(events);
        return;
      }
    }
    refreshObjective();
  }

  // ---------------------------------------------------------- crime & police
  function addHeat(amount, force) {
    if (amount <= 0 && !force) return;
    state.heat = clamp(state.heat + amount, 0, 240);
    state.wanted = starsForHeat(state.heat);
  }

  function witnessed(x, z, range) {
    for (const ped of state.peds) {
      if (!ped.down && dist2d(x, z, ped.x, ped.z) < range) return true;
    }
    return state.cops.length > 0;
  }

  function spawnPoliceCar(events) {
    const p = state.player;
    const angle = randRange(rng, 0, Math.PI * 2);
    let x = clamp(p.x + Math.sin(angle) * 130, -265, 265);
    let z = clamp(p.z + Math.cos(angle) * 130, -265, 185);
    x = nearestStreetX(x);
    z = nearestStreetZ(z);
    const car = makeCar(x, z, headingOf(p.x - x, p.z - z), [0.92, 0.92, 0.94], false);
    car.police = true;
    car.driver = 'police';
    state.cars.push(car);
    void events;
  }

  function spawnFootCop() {
    const p = state.player;
    const spot = sidewalkPointNear(p.x, p.z, 30, 55);
    state.cops.push({
      x: spot.x, z: spot.z, heading: headingOf(p.x - spot.x, p.z - spot.z),
      walkPhase: 0, moving: false, hp: 80, down: false, downT: 0, fleeT: 0,
      targetX: p.x, targetZ: p.z, shootCd: randRange(rng, 0.5, 1.4),
      shirt: [0.12, 0.16, 0.38], pants: [0.1, 0.1, 0.16], skin: [0.85, 0.65, 0.5],
      officer: true,
    });
  }

  function updatePolice(dt, events) {
    const p = state.player;
    // Desired strength follows the wanted level.
    const policeCars = state.cars.filter((c) => c.police && !c.dead);
    const wantCars = state.wanted === 0 ? 0 : Math.min(1 + state.wanted, 6);
    // Fresh units only join when no hunter is already close: a player who
    // broke away gets a real chance to stay hidden.
    const hunterClose = policeCars.some((c) => dist2d(c.x, c.z, p.x, p.z) < 90);
    if (policeCars.length < wantCars && !hunterClose && rng() < dt * 1.5) spawnPoliceCar(events);
    const wantCops = state.wanted >= 4 ? state.wanted - 2 : 0;
    if (state.cops.filter((c) => !c.down).length < wantCops && rng() < dt) spawnFootCop();
    // If the heat is gone, distant police give up and leave.
    if (state.wanted === 0) {
      for (const car of state.cars) {
        if (car.police && dist2d(car.x, car.z, p.x, p.z) > 55) car.dead = true;
      }
      if (state.cops.length && dist2d(state.cops[0].x, state.cops[0].z, p.x, p.z) > 40) state.cops = [];
    }
    // Who can see the player right now?
    let seen = false;
    for (const car of state.cars) {
      if (car.police && !car.dead && dist2d(car.x, car.z, p.x, p.z) < 62) seen = true;
    }
    for (const cop of state.cops) {
      if (!cop.down && dist2d(cop.x, cop.z, p.x, p.z) < 50) seen = true;
    }
    state.seenNow = seen;
    if (seen) state.lastSeenT = state.time;
    // Heat decays out of sight; the hideout cools it much faster.
    if (state.time - state.lastSeenT > 2.8 && state.heat > 0) {
      let rate = 7;
      if (state.escapeStage === 'laylow' && dist2d(p.x, p.z, PLACES.hideout.x, PLACES.hideout.z) < 26) rate = 30;
      state.heat = Math.max(0, state.heat - rate * dt);
      state.wanted = starsForHeat(state.heat);
    }
    // Busted meter: a close officer and a slow or on-foot player.
    let pressure = false;
    if (state.wanted > 0 && !state.over) {
      if (p.mode === 'foot') {
        for (const cop of state.cops) if (!cop.down && dist2d(cop.x, cop.z, p.x, p.z) < 4.2) pressure = true;
        for (const car of state.cars) if (car.police && !car.dead && dist2d(car.x, car.z, p.x, p.z) < 5.5) pressure = true;
      } else if (p.car && Math.abs(p.car.speed) < 2.5) {
        for (const car of state.cars) if (car.police && !car.dead && dist2d(car.x, car.z, p.x, p.z) < 6.5) pressure = true;
        for (const cop of state.cops) if (!cop.down && dist2d(cop.x, cop.z, p.x, p.z) < 4.5) pressure = true;
      }
    }
    state.bustedMeter = clamp(state.bustedMeter + (pressure ? dt : -dt * 1.6), 0, 2.2);
    if (state.bustedMeter >= 2.2 && !state.over) {
      state.over = 'busted';
      events.push('busted');
    }
  }

  function drivePoliceCar(car, dt, events) {
    const p = state.player;
    const d = dist2d(car.x, car.z, p.x, p.z);
    if (state.wanted === 0) {
      // The heat is gone: break off, drive away, and leave the area.
      const away = headingOf(car.x - p.x, car.z - p.z);
      car.heading = turnToward(car.heading, away, dt * 2);
      car.speed += clamp(17 - car.speed, -22 * dt, 10 * dt);
      moveCar(car, dt, events, true);
      if (d > 70) car.dead = true;
      return;
    }
    // Stuck recovery: a car grinding on a building for over a second aims
    // for the nearest intersection first, then resumes the pursuit.
    if (Math.abs(car.speed) < 2.5 && d > 12) car.stuckT += dt;
    else car.stuckT = 0;
    let tx = p.x;
    let tz = p.z;
    if (car.wpT > 0) {
      car.wpT -= dt;
      tx = car.wpX;
      tz = car.wpZ;
      if (dist2d(car.x, car.z, tx, tz) < 7) car.wpT = 0;
    } else if (car.stuckT > 1.1) {
      car.stuckT = 0;
      car.wpX = nearestStreetX(car.x);
      car.wpZ = nearestStreetZ(car.z);
      car.wpT = 4;
      tx = car.wpX;
      tz = car.wpZ;
    }
    const desired = headingOf(tx - car.x, tz - car.z);
    car.heading = turnToward(car.heading, desired, dt * (d > 30 ? 1.7 : 2.4));
    // Fast far away, but a clean getaway at full throttle (33) outruns the
    // mid-range pursuit speed: breaking contact is always possible.
    let target = d > 80 ? 34 : d > 40 ? 29.5 : 26;
    if (d < 7) target = 10;
    car.speed += clamp(target - car.speed, -30 * dt, 14 * dt);
    moveCar(car, dt, events, true);
  }

  // ---------------------------------------------------------- cars
  function moveCar(car, dt, events, isPolice) {
    const oldSpeed = car.speed;
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    car.wheelSpin += (car.speed * dt) / 0.36;
    const before = { x: car.x, z: car.z };
    resolveCollision(car, 1.7);
    const hitWall = Math.abs(before.x - car.x) > 0.01 || Math.abs(before.z - car.z) > 0.01;
    if (hitWall && Math.abs(car.speed) > 9) {
      if (events && Math.abs(car.speed) > 13) events.push('crash');
      car.hp -= Math.abs(car.speed) * 0.7;
      car.speed = -car.speed * 0.25;
    } else if (hitWall) {
      car.speed *= 0.6;
    }
    void oldSpeed;
    void isPolice;
  }

  function carCarCollisions(events) {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.dead) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.dead) continue;
        const d = dist2d(a.x, a.z, b.x, b.z);
        if (d < 3.4 && d > 0.001) {
          const push = (3.4 - d) / 2;
          const nx = (b.x - a.x) / d;
          const nz = (b.z - a.z) / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
          const impact = Math.abs(a.speed - b.speed);
          if (impact > 8) {
            a.hp -= impact * 0.8;
            b.hp -= impact * 0.8;
            if (events) events.push('crash');
            if (a.police || b.police) addHeat(10);
            else if (a.driver === 'player' || b.driver === 'player') addHeat(7);
          }
          const swap = (a.speed + b.speed) / 2;
          a.speed = swap * 0.7;
          b.speed = swap * 0.7;
        }
      }
    }
  }

  function driveTraffic(car, dt, events) {
    const d = dist2d(car.x, car.z, car.targetX, car.targetZ);
    if (d < 6 && car.turnaround) {
      // The street ran out (the beach, the city edge): turn around.
      car.heading += Math.PI;
      car.turnaround = false;
      pickTarget(car);
    } else if (d < 6) {
      // At the intersection: mostly straight on, sometimes a turn.
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const roll = rng();
      let newHeading = car.heading;
      if (roll < 0.28) newHeading = car.heading + Math.PI / 2;
      else if (roll < 0.5) newHeading = car.heading - Math.PI / 2;
      if (Math.abs(fz) > 0.7 && car.z > 165 && newHeading !== car.heading) newHeading = car.heading;
      if (car.z > 175 && Math.cos(newHeading) > 0) newHeading = car.heading + Math.PI / 2;
      if (car.x > 262 && Math.sin(newHeading) > 0) newHeading = car.heading + Math.PI / 2;
      if (car.x < -262 && Math.sin(newHeading) < 0) newHeading = car.heading + Math.PI / 2;
      if (car.z < -262 && Math.cos(newHeading) < 0) newHeading = car.heading + Math.PI / 2;
      void fx;
      car.heading = newHeading;
      pickTarget(car);
    }
    const desired = headingOf(car.targetX - car.x, car.targetZ - car.z);
    car.heading = turnToward(car.heading, desired, dt * 2.1);
    // Slow for whatever is ahead.
    let target = car.hp < 25 ? 0 : 13.5;
    for (const other of state.cars) {
      if (other === car || other.dead) continue;
      const ahead = (other.x - car.x) * Math.sin(car.heading) + (other.z - car.z) * Math.cos(car.heading);
      const side = Math.abs((other.x - car.x) * Math.cos(car.heading) - (other.z - car.z) * Math.sin(car.heading));
      if (ahead > 0 && ahead < 10 && side < 2.4) target = Math.min(target, Math.max(0, other.speed - 1));
    }
    const p = state.player;
    if (p.mode === 'foot') {
      const ahead = (p.x - car.x) * Math.sin(car.heading) + (p.z - car.z) * Math.cos(car.heading);
      const side = Math.abs((p.x - car.x) * Math.cos(car.heading) - (p.z - car.z) * Math.sin(car.heading));
      if (ahead > 0 && ahead < 9 && side < 2.2) target = 0;
    }
    car.speed += clamp(target - car.speed, -26 * dt, 9 * dt);
    if (car.hp < 25 && car.driver === 'traffic') {
      car.driver = null;
      car.parked = true;
    }
    moveCar(car, dt, events, false);
  }

  // ---------------------------------------------------------- people
  function updatePed(ped, dt, events) {
    const p = state.player;
    if (ped.down) {
      ped.downT -= dt;
      if (ped.downT <= 0) { ped.down = false; ped.hp = 20; ped.fleeT = 4; }
      return;
    }
    // Respawn far-away pedestrians near the player to keep streets alive.
    if (dist2d(ped.x, ped.z, p.x, p.z) > 175) {
      const spot = sidewalkPointNear(p.x, p.z, 60, 110);
      ped.x = spot.x; ped.z = spot.z; ped.targetX = spot.x; ped.targetZ = spot.z;
    }
    let speed = 0;
    if (ped.fleeT > 0) {
      ped.fleeT -= dt;
      const away = headingOf(ped.x - p.x, ped.z - p.z);
      ped.heading = turnToward(ped.heading, away, dt * 6);
      speed = 5.6;
    } else {
      if (dist2d(ped.x, ped.z, ped.targetX, ped.targetZ) < 2.5) {
        const spot = sidewalkPointNear(ped.x, ped.z, 25, 80);
        ped.targetX = spot.x; ped.targetZ = spot.z;
      }
      const desired = headingOf(ped.targetX - ped.x, ped.targetZ - ped.z);
      ped.heading = turnToward(ped.heading, desired, dt * 5);
      speed = 2.3;
    }
    ped.moving = speed > 0;
    ped.walkPhase += dt * speed * 2.4;
    ped.x += Math.sin(ped.heading) * speed * dt;
    ped.z += Math.cos(ped.heading) * speed * dt;
    resolveCollision(ped, 0.5);
    void events;
  }

  function updateCop(cop, dt, events) {
    const p = state.player;
    if (cop.down) {
      cop.downT -= dt;
      if (cop.downT <= 0) {
        // Officers who go down are taken away; a fresh one may replace them.
        cop.x = -9999;
        cop.z = -9999;
        cop.hp = 0;
      }
      return;
    }
    const d = dist2d(cop.x, cop.z, p.x, p.z);
    let speed = 0;
    if (d > 13) {
      cop.heading = turnToward(cop.heading, headingOf(p.x - cop.x, p.z - cop.z), dt * 6);
      speed = 6.4;
    } else {
      cop.heading = turnToward(cop.heading, headingOf(p.x - cop.x, p.z - cop.z), dt * 8);
      // Shooting stance: strafe slowly closer if the player is far, else hold.
      if (d > 20) speed = 3;
      cop.shootCd -= dt;
      if (cop.shootCd <= 0 && d < 30 && state.wanted >= 2) {
        cop.shootCd = randRange(rng, 0.7, 1.3);
        events.push('cop-shot');
        if (rng() < 0.55) hurtPlayer(p.mode === 'car' ? 3.5 : 6, events);
      }
    }
    cop.moving = speed > 0;
    cop.walkPhase += dt * Math.max(2, speed) * 2.2;
    cop.x += Math.sin(cop.heading) * speed * dt;
    cop.z += Math.cos(cop.heading) * speed * dt;
    resolveCollision(cop, 0.5);
    // Busted by contact: an officer who reaches an on-foot player grabs them.
    if (p.mode === 'foot' && d < 1.6 && state.wanted > 0) state.bustedMeter = Math.min(2.2, state.bustedMeter + dt * 2);
  }

  function hurtPlayer(amount, events) {
    const p = state.player;
    if (state.over) return;
    p.health -= amount;
    p.hurtT = 0.25;
    events.push('hurt');
    if (p.health <= 0) {
      p.health = 0;
      state.over = 'wasted';
      events.push('wasted');
    }
  }

  // ---------------------------------------------------------- player
  function updatePlayerFoot(dt, ctl, events) {
    const p = state.player;
    const mag = Math.hypot(ctl.moveX, ctl.moveZ);
    p.moving = mag > 0.1;
    if (p.moving) {
      const desired = headingOf(ctl.moveX, ctl.moveZ);
      p.heading = turnToward(p.heading, desired, dt * 14);
      const speed = (ctl.sprint ? 11 : 6.8) * Math.min(1, mag);
      p.walkPhase += dt * speed * 1.9;
      p.x += Math.sin(p.heading) * speed * dt * Math.min(1, mag + 0.35);
      p.z += Math.cos(p.heading) * speed * dt * Math.min(1, mag + 0.35);
      // Wading slows you; deep water pushes you back to the shore.
      if (groundAt(p.x, p.z) === 'water') {
        p.z = Math.min(p.z, 236);
      }
      resolveCollision(p, 0.55);
    }
    // Traffic can run the player down.
    for (const car of state.cars) {
      if (car.dead || Math.abs(car.speed) < 5) continue;
      if (dist2d(car.x, car.z, p.x, p.z) < 2.4) {
        hurtPlayer(car.police ? 16 : 11, events);
        p.x += Math.sin(car.heading) * 3;
        p.z += Math.cos(car.heading) * 3;
        if (car.police) addHeat(6);
      }
    }
  }

  function updatePlayerCar(dt, ctl, events) {
    const p = state.player;
    const car = p.car;
    if (!car) { p.mode = 'foot'; return; }
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
    const maxF = car.hp < 20 ? 9 : 33;
    const accel = ctl.throttle > 0 ? 21 : ctl.throttle < 0 ? (car.speed > 0.5 ? -34 : -13) : 0;
    car.speed += accel * dt;
    car.speed -= car.speed * 0.35 * dt;
    if (ctl.brake) car.speed -= car.speed * 3.2 * dt;
    car.speed = clamp(car.speed, -11, maxF);
    if (Math.abs(car.speed) > 0.2) {
      const steerPower = clamp(Math.abs(car.speed) / 9, 0.25, 1) * 1.45;
      car.heading += ctl.steer * steerPower * dt * Math.sign(car.speed);
    }
    const beforeHp = car.hp;
    moveCar(car, dt, events, false);
    if (car.hp < beforeHp - 4) {
      hurtPlayer(1.5, events);
      if (witnessed(car.x, car.z, 30)) addHeat(5);
    }
    // Running people down is the fastest way to fill the stars.
    for (const ped of state.peds) {
      if (ped.down || Math.abs(car.speed) < 4) continue;
      if (dist2d(car.x, car.z, ped.x, ped.z) < 2.3) {
        ped.down = true;
        ped.downT = 9;
        ped.hp = 0;
        events.push('hit-ped');
        addHeat(38);
        for (const other of state.peds) if (dist2d(other.x, other.z, ped.x, ped.z) < 26) other.fleeT = 3.5;
      }
    }
    for (const cop of state.cops) {
      if (cop.down || Math.abs(car.speed) < 4) continue;
      if (dist2d(car.x, car.z, cop.x, cop.z) < 2.3) {
        cop.down = true;
        cop.downT = 6;
        events.push('cop-down');
        addHeat(45);
      }
    }
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
  }

  function tryEnterExit(events) {
    const p = state.player;
    if (state.over) return false;
    if (p.mode === 'car' && p.car) {
      const car = p.car;
      car.driver = null;
      car.parked = true;
      car.speed = 0;
      p.car = null;
      p.mode = 'foot';
      p.x = car.x + Math.cos(car.heading) * 2.4;
      p.z = car.z - Math.sin(car.heading) * 2.4;
      resolveCollision(p, 0.55);
      events.push('exit-car');
      return true;
    }
    let best = null;
    let bestD = 3.6;
    for (const car of state.cars) {
      if (car.dead || car.driver === 'police') continue;
      const d = dist2d(car.x, car.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (!best) return false;
    if (best.driver === 'traffic') {
      // Dragging a driver out is very visible.
      addHeat(16);
      events.push('jack');
      for (const ped of state.peds) if (dist2d(ped.x, ped.z, p.x, p.z) < 30) ped.fleeT = 3;
    } else if (best.parked && witnessed(p.x, p.z, 24)) {
      addHeat(6);
      events.push('jack-quiet');
    }
    best.driver = 'player';
    best.parked = false;
    p.car = best;
    p.mode = 'car';
    p.x = best.x;
    p.z = best.z;
    p.heading = best.heading;
    state.stats.carsDriven += 1;
    events.push('enter-car');
    return true;
  }

  function shoot(events) {
    const p = state.player;
    if (p.shootCd > 0 || state.over) return;
    if (state.ammo <= 0) {
      p.shootCd = 0.3;
      events.push('dry-fire');
      return;
    }
    p.shootCd = 0.24;
    state.ammo -= 1;
    state.stats.shotsFired += 1;
    state.fx.flash = 0.06;
    events.push('gunshot');
    addHeat(11);
    for (const ped of state.peds) if (dist2d(ped.x, ped.z, p.x, p.z) < 30) ped.fleeT = 3;
    // Auto-aim: the closest person or car inside a cone ahead of the player.
    let target = null;
    let targetD = 44;
    let targetKind = '';
    const consider = (obj, kind) => {
      const d = dist2d(obj.x, obj.z, p.x, p.z);
      if (d > targetD || d < 0.5) return;
      const ang = Math.abs(((headingOf(obj.x - p.x, obj.z - p.z) - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ang < 0.42 || d < 3) {
        target = obj;
        targetD = d;
        targetKind = kind;
      }
    };
    for (const ped of state.peds) if (!ped.down) consider(ped, 'ped');
    for (const cop of state.cops) if (!cop.down) consider(cop, 'cop');
    if (!target) for (const car of state.cars) if (!car.dead && car !== p.car) consider(car, 'car');
    if (!target) return;
    if (targetKind === 'car') {
      target.hp -= 12;
      events.push('hit-car');
      if (target.police) addHeat(14);
      return;
    }
    target.hp -= 34;
    // Face the shot.
    p.heading = headingOf(target.x - p.x, target.z - p.z);
    if (target.hp <= 0 && !target.down) {
      target.down = true;
      target.downT = targetKind === 'cop' ? 7 : 9;
      events.push(targetKind === 'cop' ? 'cop-down' : 'ped-down');
      addHeat(targetKind === 'cop' ? 40 : 26);
    } else {
      target.fleeT = 3;
      events.push('hit-person');
    }
  }

  function melee(events) {
    const p = state.player;
    if (p.meleeCd > 0 || state.over) return;
    p.meleeCd = 0.38;
    events.push('punch');
    let target = null;
    let targetD = 2.7;
    let kind = '';
    for (const ped of state.peds) {
      if (ped.down) continue;
      const d = dist2d(ped.x, ped.z, p.x, p.z);
      if (d < targetD) { target = ped; targetD = d; kind = 'ped'; }
    }
    for (const cop of state.cops) {
      if (cop.down) continue;
      const d = dist2d(cop.x, cop.z, p.x, p.z);
      if (d < targetD) { target = cop; targetD = d; kind = 'cop'; }
    }
    if (!target) return;
    p.heading = headingOf(target.x - p.x, target.z - p.z);
    target.hp -= 26;
    if (target.hp <= 0) {
      target.down = true;
      target.downT = 8;
      events.push(kind === 'cop' ? 'cop-down' : 'ped-down');
      addHeat(kind === 'cop' ? 34 : 18);
    } else {
      target.fleeT = 2.5;
      if (witnessed(p.x, p.z, 20)) addHeat(5);
    }
  }

  // ---------------------------------------------------------- pickups & packages
  function updatePickups(dt, events) {
    const p = state.player;
    for (const item of state.pickups) {
      if (!item.active) {
        item.timer -= dt;
        if (item.timer <= 0) item.active = true;
        continue;
      }
      if (dist2d(item.x, item.z, p.x, p.z) < 2) {
        item.active = false;
        item.timer = 25;
        if (item.kind === 'ammo') {
          state.ammo += 12;
          events.push('pickup-ammo');
        } else {
          p.health = Math.min(100, p.health + 35);
          events.push('pickup-health');
        }
      }
    }
    for (const pack of CITY.packages) {
      if (pack.taken) continue;
      if (dist2d(pack.x, pack.z, p.x, p.z) < 2.4) {
        pack.taken = true;
        state.packagesFound += 1;
        state.cash += 250;
        events.push('package');
      }
    }
  }

  // ---------------------------------------------------------- lifecycle
  function reset(save) {
    state.time = 0;
    state.cash = 120;
    state.ammo = 24;
    state.heat = 0;
    state.wanted = 0;
    state.bustedMeter = 0;
    state.over = null;
    state.packagesFound = 0;
    state.storyDone = false;
    state.stats = { shotsFired: 0, carsDriven: 0 };
    for (const pack of CITY.packages) pack.taken = false;
    for (const item of CITY.pickups) { item.active = true; item.timer = 0; }
    const p = state.player;
    p.x = PLACES.spawn.x; p.z = PLACES.spawn.z; p.heading = Math.PI;
    p.health = 100; p.mode = 'foot'; p.car = null; p.down = false;
    resetEntities();
    if (save) {
      state.cash = save.cash ?? state.cash;
      state.ammo = save.ammo ?? state.ammo;
      state.storyDone = !!save.storyDone;
      for (const id of save.packages || []) {
        const pack = CITY.packages[id];
        if (pack && !pack.taken) { pack.taken = true; state.packagesFound += 1; }
      }
      startMission(clamp(save.missionIndex ?? 0, 0, MISSIONS.length));
    } else {
      startMission(0);
    }
  }

  function respawn() {
    const p = state.player;
    const fine = state.over === 'busted' ? Math.min(state.cash, 150) : Math.floor(state.cash * 0.1);
    state.cash -= fine;
    if (p.car) {
      p.car.driver = null;
      p.car.parked = true;
      p.car.speed = 0;
      p.car = null;
    }
    p.mode = 'foot';
    p.x = PLACES.hospital.x;
    p.z = PLACES.hospital.z + 14;
    p.heading = 0;
    p.health = 100;
    state.heat = 0;
    state.wanted = 0;
    state.bustedMeter = 0;
    state.over = null;
    state.cops = [];
    for (const car of state.cars) if (car.police) car.dead = true;
    state.cars = state.cars.filter((c) => !c.dead);
    // A failed run restarts the current mission cleanly.
    if (state.missionState === 'active') startMission(state.missionIndex);
    return fine;
  }

  function saveData() {
    return {
      version: SAVE_VERSION,
      cash: state.cash,
      ammo: state.ammo,
      missionIndex: state.missionIndex,
      storyDone: state.storyDone,
      packages: CITY.packages.filter((pk) => pk.taken).map((pk) => pk.id),
    };
  }

  function step(dt, ctl) {
    const events = [];
    state.time += dt;
    const p = state.player;
    if (p.shootCd > 0) p.shootCd -= dt;
    if (p.meleeCd > 0) p.meleeCd -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (state.fx.flash > 0) state.fx.flash -= dt;
    if (!state.over) {
      if (p.mode === 'foot') updatePlayerFoot(dt, ctl, events);
      else updatePlayerCar(dt, ctl, events);
      if (ctl.shoot && p.mode === 'foot') shoot(events);
      if (ctl.melee && p.mode === 'foot') melee(events);
    }
    for (const car of state.cars) {
      if (car.dead) continue;
      if (car.driver === 'traffic') driveTraffic(car, dt, events);
      else if (car.driver === 'police') drivePoliceCar(car, dt, events);
    }
    state.cars = state.cars.filter((c) => !c.dead);
    carCarCollisions(events);
    for (const ped of state.peds) updatePed(ped, dt, events);
    state.cops = state.cops.filter((c) => c.hp > 0 || !c.down || c.downT > 0);
    for (const cop of state.cops) updateCop(cop, dt, events);
    updatePolice(dt, events);
    updatePickups(dt, events);
    if (!state.over) updateMissions(dt, events);
    return events;
  }

  reset(null);

  return {
    state,
    reset,
    respawn,
    saveData,
    step,
    tryEnterExit,
    /** Test and screenshot hooks: deterministic staging used by shots.js. */
    debug: {
      teleport(x, z) {
        const p = state.player;
        if (p.mode === 'car' && p.car) { p.car.x = x; p.car.z = z; }
        p.x = x; p.z = z;
      },
      setWanted(stars) {
        state.heat = HEAT_THRESHOLDS[clamp(stars, 0, 5)];
        state.wanted = stars;
        state.lastSeenT = state.time;
      },
      setMission(index) { startMission(clamp(index, 0, MISSIONS.length)); },
      addCash(amount) { state.cash += amount; },
      setHealth(value) { state.player.health = value; },
      completePhase() { const ev = []; completePhase(ev); return ev; },
    },
  };
}
