// Port Aurelia — the living city: traffic that follows the road grid,
// pedestrians on the sidewalks and promenade, and the Aurelia PD, whose
// cars and foot officers hunt the player while a wanted level lasts.

import { WORLD, WANTED } from './config.js';
import { createRandom, makeCar, collideBuildings, dist, isWater } from './world.js';

const TRAFFIC_COUNT = 14;
const PED_COUNT = 26;

export function spawnTraffic(rand, buildings) {
  const cars = [];
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const axis = rand() < 0.5 ? 'x' : 'z';
    const laneRoad = WORLD.roads[Math.floor(rand() * WORLD.roads.length)];
    const dir = rand() < 0.5 ? 1 : -1;
    const along = -300 + rand() * 560;
    const laneOff = 5.2 * dir;
    const car = makeCar(1000 + i, axis === 'x' ? along : laneRoad + laneOff, axis === 'x' ? laneRoad + laneOff : along, 0, rand, false);
    car.traffic = true; car.axis = axis; car.dir = dir; car.lane = laneRoad;
    car.targetSpeed = 13 + rand() * 7;
    car.angle = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    // makeCar stores angle as heading where 0 faces -z (north); align traffic.
    car.angle = headingOf(axis, dir);
    cars.push(car);
  }
  return cars;
}

function headingOf(axis, dir) {
  // Heading convention: forward = (sin a, -cos a). North is -z.
  if (axis === 'z') return dir > 0 ? Math.PI : 0;      // dir +1 drives south (+z)
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;          // dir +1 drives east (+x)
}

export function updateTraffic(cars, dt, buildings, playerPos) {
  for (const car of cars) {
    if (car.driver === 'player' || car.parked) continue;
    let speed = car.targetSpeed;
    // Slow for anything close ahead: another car, or the player on foot.
    for (const other of cars) {
      if (other === car) continue;
      if (dist(car.x, car.z, other.x, other.z) < 9) {
        const ahead = forwardDot(car, other.x - car.x, other.z - car.z);
        if (ahead > 0) speed = Math.min(speed, Math.max(0, other.speed - 1));
      }
    }
    if (playerPos && dist(car.x, car.z, playerPos.x, playerPos.z) < 8 && forwardDot(car, playerPos.x - car.x, playerPos.z - car.z) > 0) speed = 0;
    car.speed += (speed - car.speed) * Math.min(1, dt * 2.2);
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += -Math.cos(car.angle) * car.speed * dt;
    // At the city edge or the beach, turn around.
    if (car.x < -322 || car.x > 322 || car.z < -322 || car.z > 196) {
      car.dir *= -1; car.angle = headingOf(car.axis, car.dir);
      car.x = Math.max(-322, Math.min(322, car.x));
      car.z = Math.max(-322, Math.min(196, car.z));
    }
    const hit = collideBuildings(buildings, car.x, car.z, 2.2);
    car.x = hit.x; car.z = hit.z;
  }
}

function forwardDot(car, dx, dz) {
  return Math.sin(car.angle) * dx + -Math.cos(car.angle) * dz;
}

export function spawnPeds(rand) {
  const peds = [];
  const outfits = ['#ff6b6b', '#ffd93d', '#6bcbff', '#95e06c', '#f9a8d4', '#fef3c7', '#a78bfa', '#fb923c'];
  for (let i = 0; i < PED_COUNT; i++) {
    const onProm = rand() < 0.35;
    const road = WORLD.roads[Math.floor(rand() * WORLD.roads.length)];
    const along = -310 + rand() * 600;
    peds.push({
      id: i,
      x: onProm ? along : road + (rand() < 0.5 ? -14 : 14),
      z: onProm ? 196 + rand() * 10 : along,
      angle: rand() * Math.PI * 2,
      speed: 2.2 + rand() * 1.8,
      color: outfits[Math.floor(rand() * outfits.length)],
      skin: ['#f2c09a', '#c68642', '#8d5524', '#ffdbac'][Math.floor(rand() * 4)],
      state: 'walk', timer: 2 + rand() * 6, health: 100, officer: false, fallTimer: 0,
    });
  }
  return peds;
}

export function updatePeds(peds, dt, buildings, rand) {
  for (const ped of peds) {
    if (ped.state === 'down') { ped.fallTimer -= dt; if (ped.fallTimer <= 0) { ped.state = 'walk'; ped.health = 100; } continue; }
    if (ped.state === 'flee') {
      ped.timer -= dt;
      movePed(ped, ped.speed * 2.1, dt, buildings);
      if (ped.timer <= 0) ped.state = 'walk';
      continue;
    }
    ped.timer -= dt;
    if (ped.timer <= 0) { ped.angle = rand() * Math.PI * 2; ped.timer = 3 + rand() * 6; }
    movePed(ped, ped.speed, dt, buildings);
  }
}

function movePed(ped, speed, dt, buildings) {
  let nx = ped.x + Math.sin(ped.angle) * speed * dt;
  let nz = ped.z - Math.cos(ped.angle) * speed * dt;
  if (isWater(nx, nz) || nz > WORLD.beachZ + 60) { ped.angle += Math.PI; return; }
  const hit = collideBuildings(buildings, nx, nz, 0.8);
  if (hit.hit) ped.angle += 1.7;
  ped.x = Math.max(-326, Math.min(326, hit.x));
  ped.z = Math.max(-326, Math.min(340, hit.z));
  ped.walkPhase = (ped.walkPhase || 0) + dt * speed * 2.4;
}

// ---- Police ---------------------------------------------------------------

export function spawnPolice(state, rand) {
  const want = Math.min(6, state.wanted * WANTED.policePerStar + (state.wanted >= 4 ? 2 : 0));
  while (state.police.length < want) {
    const a = rand() * Math.PI * 2;
    const d = 95 + rand() * 40;
    const x = state.player.x + Math.cos(a) * d, z = state.player.z + Math.sin(a) * d;
    const car = makeCar(5000 + state.police.length + Math.floor(rand() * 500), x, Math.min(196, z), 0, rand, false);
    car.police = true; car.color = '#eef2f5'; car.targetSpeed = 24;
    state.police.push(car);
    if (state.wanted >= 3) {
      state.officers.push({
        id: 900 + state.officers.length, x: x + 3, z: z + 3, angle: 0, speed: 8.5,
        color: '#22335c', skin: '#f2c09a', state: 'chase', timer: 0, health: 100, officer: true, fallTimer: 0, walkPhase: 0,
      });
    }
  }
  // Trim far-away units so the hunt stays local and the counts stay sane.
  state.police = state.police.filter((c) => dist(c.x, c.z, state.player.x, state.player.z) < 190);
  state.officers = state.officers.filter((o) => o.state !== 'down' && dist(o.x, o.z, state.player.x, state.player.z) < 190);
}

export function updatePolice(state, dt, buildings) {
  const p = state.player;
  const pSpeed = p.car ? Math.abs(p.car.speed) : Math.hypot(p.vx || 0, p.vz || 0);
  let nearest = Infinity;
  for (const car of state.police) {
    const d = dist(car.x, car.z, p.x, p.z);
    nearest = Math.min(nearest, d);
    const wantAngle = Math.atan2(p.x - car.x, -(p.z - car.z));
    let diff = wrapAngle(wantAngle - car.angle);
    car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
    const top = 21 + state.wanted * 1.6;
    car.speed += ((d > 6 ? top : 4) - car.speed) * Math.min(1, dt * 1.6);
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += -Math.cos(car.angle) * car.speed * dt;
    const hit = collideBuildings(buildings, car.x, car.z, 2.2);
    if (hit.hit) car.speed *= 0.4;
    car.x = hit.x; car.z = Math.min(200, hit.z);
    car.flash = (car.flash || 0) + dt * 7;
  }
  for (const o of state.officers) {
    if (o.state === 'down') continue;
    const d = dist(o.x, o.z, p.x, p.z);
    nearest = Math.min(nearest, d);
    if (d > 2.6) {
      o.angle = Math.atan2(p.x - o.x, -(p.z - o.z));
      movePed(o, o.speed, dt, buildings);
    }
  }
  // Sight: any unit close with a clear-ish line counts as seeing the player.
  state.playerSeen = nearest < 62;
  // The bust meter fills while police are close and the player is slow.
  if (nearest < 7 && pSpeed < 3.2 && state.wanted > 0) state.bust += dt / WANTED.bustSeconds;
  else state.bust = Math.max(0, state.bust - dt * 0.8);
  // Wanted decay: stay unseen and the stars fade one by one.
  if (state.wanted > 0 && !state.playerSeen) {
    state.unseen += dt;
    if (state.unseen >= WANTED.decaySeconds) { state.wanted -= 1; state.unseen = 0; }
  } else state.unseen = 0;
  if (state.wanted === 0) { state.police.length = 0; state.officers.length = 0; state.bust = 0; }
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
