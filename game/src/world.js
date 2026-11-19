// Port Aurelia — the city itself: a seeded, deterministic layout of city
// blocks and buildings, palms, parked cars and pickups, plus the collision
// helpers every other system shares. Same seed, same city, every visit.

import { WORLD, PACKAGE_SPOTS, AMMO_SPOTS } from './config.js';

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDING_COLORS = ['#e8b4a0', '#f2d5a7', '#a8d8d0', '#f4e3c1', '#e89bb4', '#b5c7e8', '#ffd9a0', '#cdeac0', '#f0a868', '#d9b8e6', '#9fd3e8', '#f7f0dc'];
const CAR_COLORS = ['#e84e4e', '#4e9be8', '#f2c94c', '#57c785', '#f2f2f2', '#333a45', '#e87fb0', '#7a5fd0', '#ff8c42', '#39c2b8'];

export function isRoad(x, z) {
  if (z >= WORLD.beachZ) return false;
  for (const r of WORLD.roads) if (Math.abs(x - r) <= WORLD.roadHalf || Math.abs(z - r) <= WORLD.roadHalf) return true;
  return false;
}
export function isSand(x, z) { return z >= WORLD.beachZ && z < WORLD.oceanZ; }
export function isWater(x, z) { return z >= WORLD.oceanZ && !(Math.abs(x - WORLD.pierX) <= 5 && z <= WORLD.pierEndZ); }
export function onPier(x, z) { return Math.abs(x - WORLD.pierX) <= 5 && z >= WORLD.beachZ && z <= WORLD.pierEndZ; }

export function buildCity(seed) {
  const rand = createRandom(seed);
  const buildings = [];
  let palms = [];
  const parked = [];
  const roads = WORLD.roads;
  // Blocks sit between neighbouring roads; each block holds 1-4 buildings.
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      const x0 = roads[i] + WORLD.roadHalf + 4, x1 = roads[i + 1] - WORLD.roadHalf - 4;
      const z0 = roads[j] + WORLD.roadHalf + 4, z1 = roads[j + 1] - WORLD.roadHalf - 4;
      if (z0 > WORLD.beachZ - 16) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const big = rand() < 0.3;
      if (big) {
        buildings.push(makeBuilding(rand, cx, cz, 30 + rand() * 14, 30 + rand() * 14));
      } else {
        const offs = [[-17, -17], [17, -17], [-17, 17], [17, 17]];
        for (const [ox, oz] of offs) {
          if (rand() < 0.22) continue;
          buildings.push(makeBuilding(rand, cx + ox, cz + oz, 15 + rand() * 9, 15 + rand() * 9));
        }
      }
    }
  }
  // Promenade and beach palms, plus a few inland.
  for (let x = -320; x <= 320; x += 26) {
    if (Math.abs(x - WORLD.pierX) < 12) continue;
    palms.push({ x: x + (rand() - 0.5) * 8, z: WORLD.beachZ + 8 + rand() * 16, h: 7 + rand() * 3, lean: (rand() - 0.5) * 0.5 });
    if (rand() < 0.6) palms.push({ x: x + 13, z: WORLD.beachZ + 44 + rand() * 22, h: 6 + rand() * 4, lean: (rand() - 0.5) * 0.7 });
  }
  for (let i = 0; i < 26; i++) palms.push({ x: -310 + rand() * 620, z: -310 + rand() * 500, h: 6 + rand() * 3, lean: (rand() - 0.5) * 0.4 });
  palms = palms.filter((p) => !isRoad(p.x, p.z) && !buildingAt(buildings, p.x, p.z, 2));
  // Parked cars hug the kerbs of the north-south roads.
  let id = 1;
  for (const r of roads) {
    for (let z = -315; z < 195; z += 34 + rand() * 30) {
      if (rand() < 0.45) continue;
      const side = rand() < 0.5 ? -1 : 1;
      parked.push(makeCar(id++, r + side * (WORLD.roadHalf - 2.6), z, Math.PI / 2 * (side > 0 ? 1 : 3) * 0 + (side > 0 ? Math.PI : 0), rand, true));
    }
  }
  for (let i = 0; i < 8; i++) {
    const r = roads[Math.floor(rand() * roads.length)];
    parked.push(makeCar(id++, -300 + rand() * 600, r + (rand() < 0.5 ? -8 : 8), rand() < 0.5 ? 0 : Math.PI, rand, true));
  }
  const packages = PACKAGE_SPOTS.map(([x, z], i) => ({ id: i, x, z, taken: false, spin: rand() * 6.28 }));
  const ammo = AMMO_SPOTS.map(([x, z]) => ({ x, z, ready: true, timer: 0 }));
  return { buildings, palms, parked, packages, ammo };
}

function makeBuilding(rand, x, z, w, d) {
  const nearBeach = z > 120;
  const h = nearBeach ? 9 + rand() * 16 : 12 + rand() * 38;
  return {
    x, z, hw: w / 2, hd: d / 2, h,
    color: BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)],
    roof: ['#8a5a44', '#6e4a3a', '#7d6a58', '#5d4a42'][Math.floor(rand() * 4)],
    lit: rand(),
  };
}

export function makeCar(id, x, z, angle, rand, parkedCar) {
  return {
    id, x, z, angle, speed: 0, steer: 0,
    w: 2.1, l: 4.4,
    color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
    parked: !!parkedCar, police: false, traffic: false, driver: null,
    health: 100, lane: 0, axis: 'z', dir: 1, targetSpeed: 0, honk: 0,
  };
}

export function buildingAt(buildings, x, z, pad) {
  for (const b of buildings) {
    if (Math.abs(x - b.x) <= b.hw + pad && Math.abs(z - b.z) <= b.hd + pad) return b;
  }
  return null;
}

// Push a circle (x, z, r) out of every building it overlaps; returns the
// corrected position. Cars use a bigger radius than the player.
export function collideBuildings(buildings, x, z, r) {
  let hit = false;
  for (const b of buildings) {
    const dx = x - b.x, dz = z - b.z;
    const px = b.hw + r - Math.abs(dx), pz = b.hd + r - Math.abs(dz);
    if (px > 0 && pz > 0) {
      hit = true;
      if (px < pz) x = b.x + (dx >= 0 ? b.hw + r : -b.hw - r);
      else z = b.z + (dz >= 0 ? b.hd + r : -b.hd - r);
    }
  }
  return { x, z, hit };
}

export function clampWorld(pos, margin) {
  pos.x = Math.max(WORLD.cityMin - 10, Math.min(WORLD.cityMax + 10, pos.x));
  pos.z = Math.max(WORLD.cityMin - 10, Math.min(WORLD.pierEndZ + 6, pos.z));
  return pos;
}

export function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
