// city.js — the layout of Port Aurelia: a fictional coastal city.
// A grid of streets runs north-south and east-west; the southern edge opens
// onto a beach, a pier and the ocean. Buildings, palms, landmarks, parked-car
// spots, pickups and hidden packages are all placed deterministically from a
// fixed seed, and this module owns collision against the building boxes.

import { createRng, randRange, pick } from './rng.js';

/** Street centre lines. x streets run north-south, z streets east-west. */
export const STREETS_X = [-240, -180, -120, -60, 0, 60, 120, 180, 240];
export const STREETS_Z = [-240, -180, -120, -60, 0, 60, 120, 180];
/** Half the road width: the asphalt spans this far either side of a centre line. */
export const ROAD_HALF = 10;
/** Sidewalks sit just outside the asphalt. */
export const WALK_OFFSET = 13.5;

/** World bounds: solid city to the north/east/west, water to the south. */
export const BOUNDS = { minX: -285, maxX: 285, minZ: -285, maxZ: 330 };
export const BEACH_Z = 196;
export const WATER_Z = 238;

/** Named places other modules navigate to. */
export const PLACES = {
  spawn: { x: 14, z: 132 },
  hospital: { x: -52, z: -112 },
  hideout: { x: -186, z: -186 },
  pierEnd: { x: 40, z: 300 },
  pierBase: { x: 40, z: 205 },
  lighthouse: { x: 218, z: 292 },
  marina: { x: 96, z: 208 },
  carLot: { x: 128, z: 128 },
  tower: { x: 30, z: -30 },
  casino: { x: -150, z: 30 },
  boardwalk: { x: -120, z: 208 },
};

const BUILDING_COLORS = [
  [0.92, 0.78, 0.62], [0.85, 0.62, 0.48], [0.72, 0.74, 0.8], [0.95, 0.85, 0.7],
  [0.66, 0.78, 0.82], [0.88, 0.66, 0.6], [0.78, 0.8, 0.66], [0.6, 0.66, 0.78],
  [0.98, 0.72, 0.55], [0.8, 0.58, 0.72],
];

export const CAR_COLORS = [
  [0.85, 0.25, 0.2], [0.2, 0.4, 0.85], [0.95, 0.8, 0.2], [0.9, 0.9, 0.92],
  [0.15, 0.15, 0.18], [0.2, 0.7, 0.4], [0.9, 0.5, 0.15], [0.6, 0.3, 0.7],
  [0.75, 0.75, 0.78], [0.3, 0.75, 0.8],
];

function buildCity() {
  const rng = createRng(20261117);
  const buildings = [];
  const palms = [];
  const lamps = [];

  // Blocks sit between neighbouring streets; each block holds up to four lots.
  for (let xi = 0; xi < STREETS_X.length - 1; xi++) {
    for (let zi = 0; zi < STREETS_Z.length - 1; zi++) {
      const x0 = STREETS_X[xi] + ROAD_HALF + 3;
      const x1 = STREETS_X[xi + 1] - ROAD_HALF - 3;
      const z0 = STREETS_Z[zi] + ROAD_HALF + 3;
      const z1 = STREETS_Z[zi + 1] - ROAD_HALF - 3;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      // A few blocks stay open: a plaza, two car parks and a small park.
      const openKind = (xi === 2 && zi === 4) ? 'plaza'
        : (xi === 5 && zi === 5) ? 'parking'
        : (xi === 1 && zi === 1) ? 'parking'
        : (xi === 6 && zi === 2) ? 'park'
        : null;
      if (openKind) {
        if (openKind === 'park' || openKind === 'plaza') {
          for (let p = 0; p < 5; p++) {
            palms.push({ x: cx + randRange(rng, -16, 16), z: cz + randRange(rng, -16, 16), lean: randRange(rng, -0.08, 0.08) });
          }
        }
        continue;
      }
      const lots = [
        { x: (x0 + cx) / 2, z: (z0 + cz) / 2 }, { x: (cx + x1) / 2, z: (z0 + cz) / 2 },
        { x: (x0 + cx) / 2, z: (cz + z1) / 2 }, { x: (cx + x1) / 2, z: (cz + z1) / 2 },
      ];
      for (const lot of lots) {
        if (rng() < 0.12) continue; // an alley gap
        const downtown = Math.abs(lot.x) < 130 && Math.abs(lot.z) < 130;
        const h = downtown ? randRange(rng, 16, 52) : randRange(rng, 8, 26);
        buildings.push({
          x: lot.x, z: lot.z,
          w: randRange(rng, 15, 19), d: randRange(rng, 15, 19),
          h, color: pick(rng, BUILDING_COLORS),
          roof: [0.35 + rng() * 0.2, 0.3 + rng() * 0.15, 0.28 + rng() * 0.12],
        });
      }
    }
  }

  // The Aurelia Tower: the one true skyscraper, on its own block downtown.
  buildings.push({ x: PLACES.tower.x, z: PLACES.tower.z, w: 26, d: 26, h: 96, color: [0.55, 0.68, 0.85], roof: [0.3, 0.34, 0.4] });
  // The casino: a wide low block with a bright crown near the west avenue.
  buildings.push({ x: PLACES.casino.x, z: PLACES.casino.z, w: 30, d: 22, h: 15, color: [0.95, 0.6, 0.35], roof: [0.5, 0.2, 0.3] });

  // Palms line the beach and the boardwalk.
  for (let x = -260; x <= 260; x += 26) {
    palms.push({ x: x + randRange(rng, -4, 4), z: 190 + randRange(rng, -3, 3), lean: randRange(rng, -0.1, 0.1) });
    if (rng() < 0.7) palms.push({ x: x + 13, z: 222 + randRange(rng, -3, 3), lean: randRange(rng, -0.1, 0.1) });
  }
  // Street lamps at intersections.
  for (const sx of STREETS_X) for (const sz of STREETS_Z) {
    lamps.push({ x: sx + ROAD_HALF + 2, z: sz + ROAD_HALF + 2 });
  }

  // Parked cars hug the kerbs on a deterministic subset of street segments.
  const parkedSpots = [];
  for (const sx of STREETS_X) {
    for (let zi = 0; zi < STREETS_Z.length - 1; zi++) {
      const zMid = (STREETS_Z[zi] + STREETS_Z[zi + 1]) / 2;
      if (rng() < 0.55) parkedSpots.push({ x: sx - 7.2, z: zMid + randRange(rng, -8, 8), heading: Math.PI });
      if (rng() < 0.55) parkedSpots.push({ x: sx + 7.2, z: zMid + randRange(rng, -8, 8), heading: 0 });
    }
  }
  for (const sz of STREETS_Z) {
    for (let xi = 0; xi < STREETS_X.length - 1; xi++) {
      const xMid = (STREETS_X[xi] + STREETS_X[xi + 1]) / 2;
      if (rng() < 0.4) parkedSpots.push({ x: xMid + randRange(rng, -8, 8), z: sz - 7.2, heading: Math.PI / 2 });
      if (rng() < 0.4) parkedSpots.push({ x: xMid + randRange(rng, -8, 8), z: sz + 7.2, heading: -Math.PI / 2 });
    }
  }

  // Hidden packages: tucked in alleys, on the pier, behind the casino, and so on.
  const packages = [
    { x: 40, z: 296 }, { x: 218, z: 282 }, { x: -150, z: 44 }, { x: -186, z: -172 },
    { x: 30, z: -52 }, { x: -52, z: -126 }, { x: 96, z: 196 }, { x: -238, z: 208 },
    { x: 128, z: 114 }, { x: -8, z: 8 }, { x: 248, z: -248 }, { x: -248, z: -8 },
    { x: 68, z: -188 }, { x: -128, z: 68 }, { x: 188, z: 128 }, { x: -68, z: -68 },
    { x: 8, z: 188 }, { x: 240, z: 196 }, { x: -196, z: -240 }, { x: 44, z: -124 },
  ].map((p, i) => ({ id: i, x: p.x, z: p.z, taken: false }));

  // Pickups that respawn: pistol ammo and first aid, at street corners.
  const pickups = [
    { kind: 'ammo', x: 14, z: 74 }, { kind: 'ammo', x: -112, z: -52 },
    { kind: 'ammo', x: 172, z: 52 }, { kind: 'ammo', x: -52, z: 172 },
    { kind: 'health', x: -52, z: -98 }, { kind: 'health', x: 74, z: -112 },
    { kind: 'health', x: 40, z: 214 }, { kind: 'health', x: -172, z: -172 },
  ].map((p, i) => ({ id: i, kind: p.kind, x: p.x, z: p.z, active: true, timer: 0 }));

  return { buildings, palms, lamps, parkedSpots, packages, pickups };
}

export const CITY = buildCity();

/** Is this point on asphalt (either a north-south or an east-west street)? */
export function onRoad(x, z) {
  if (z > 186) return false;
  for (const sx of STREETS_X) if (Math.abs(x - sx) <= ROAD_HALF) return true;
  for (const sz of STREETS_Z) if (Math.abs(z - sz) <= ROAD_HALF) return true;
  return false;
}

/** The nearest street centre line value to v in the given list. */
function nearestLine(list, v) {
  let best = list[0];
  let bestD = Infinity;
  for (const s of list) {
    const d = Math.abs(v - s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
export function nearestStreetX(x) { return nearestLine(STREETS_X, x); }
export function nearestStreetZ(z) { return nearestLine(STREETS_Z, z); }

/** Push a circle (centre + radius) out of every building box and the world bounds. Mutates and returns pos. */
export function resolveCollision(pos, radius) {
  const buildings = CITY.buildings;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const hw = b.w / 2 + radius;
    const hd = b.d / 2 + radius;
    const dx = pos.x - b.x;
    const dz = pos.z - b.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const pushX = hw - Math.abs(dx);
      const pushZ = hd - Math.abs(dz);
      if (pushX < pushZ) pos.x = b.x + Math.sign(dx || 1) * hw;
      else pos.z = b.z + Math.sign(dz || 1) * hd;
    }
  }
  if (pos.x < BOUNDS.minX + radius) pos.x = BOUNDS.minX + radius;
  if (pos.x > BOUNDS.maxX - radius) pos.x = BOUNDS.maxX - radius;
  if (pos.z < BOUNDS.minZ + radius) pos.z = BOUNDS.minZ + radius;
  if (pos.z > BOUNDS.maxZ - radius) pos.z = BOUNDS.maxZ - radius;
  return pos;
}

/** Would a circle at (x, z) overlap a building? Used for spawn checks. */
export function hitsBuilding(x, z, radius) {
  const buildings = CITY.buildings;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius) return true;
  }
  return false;
}

/** Ground type at a point, for speed and rendering cues: 'road' | 'sand' | 'water' | 'land'. */
export function groundAt(x, z) {
  if (z >= WATER_Z) return 'water';
  if (z >= BEACH_Z) return 'sand';
  if (onRoad(x, z)) return 'road';
  return 'land';
}
