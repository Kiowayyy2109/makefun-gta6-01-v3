// Port Aurelia — boot, the game loop, driving and on-foot control, combat,
// the wanted system glue, HUD, saving, pause and the screenshot scenes.
//
// ?seed=N fixes the city seed. ?shot=start|play|end (with &seed=N) stages a
// deterministic scene instead of free play and sets window.__shotReady.

import { PLAYER, CAR, WANTED, SAVE_KEY, MISSIONS, LANDMARKS } from './config.js';
import { buildCity, createRandom, collideBuildings, clampWorld, dist, isWater, onPier } from './world.js';
import { spawnTraffic, spawnPeds, updateTraffic, updatePeds, spawnPolice, updatePolice, wrapAngle, clamp } from './entities.js';
import { createMissionState, startMission, updateMissions, markerOf, objectiveText, currentMission, stageOf } from './missions.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;

const canvas = document.getElementById('game');
const minimapCanvas = document.getElementById('minimap');
const el = (id) => document.getElementById(id);
const ui = {
  cash: el('cash'), packages: el('packages'), stars: el('stars'), health: el('healthbar'),
  ammo: el('ammo'), objective: el('objective'), prompt: el('prompt'), toast: el('toast'),
  banner: el('banner'), title: el('title'), pause: el('pause'), status: el('status'),
};
const renderer = createRenderer(canvas, minimapCanvas);
const input = createInput();
const audio = createAudio();
const rand = createRandom(seed * 977 + 13);

const city = buildCity(7);
const traffic = spawnTraffic(rand, city.buildings);
const peds = spawnPeds(rand);

const state = {
  player: { x: PLAYER.startX, z: PLAYER.startZ, angle: Math.PI / 2, vx: 0, vz: 0, health: PLAYER.health, car: null, walkPhase: 0 },
  cash: PLAYER.startCash, wanted: 0, unseen: 0, bust: 0, playerSeen: false,
  police: [], officers: [], ammo: 18, time: 0, muzzle: 0, shootCd: 0,
  packagesFound: 0,
};
const ms = createMissionState();
let screen = shot ? 'shot' : 'title';
let camYaw = Math.PI / 2, camX = state.player.x - 14, camZ = state.player.z;
let toastTimer = 0, bannerTimer = 0, saveTimer = 0, started = false;

const hooks = {
  audio,
  toast(msg) { ui.toast.textContent = msg; ui.toast.style.opacity = 1; toastTimer = 3.4; ui.status.textContent = msg; },
  banner(big, sub) {
    ui.banner.querySelector('.big').textContent = big;
    ui.banner.querySelector('.sub').textContent = sub;
    ui.banner.classList.remove('hidden'); bannerTimer = 3.2;
    ui.status.textContent = `${big}. ${sub}`;
  },
  save() { saveGame(); },
  spawnMissionCar() {
    let best = null, bd = Infinity;
    for (const car of city.parked) { const d = dist(car.x, car.z, 104, 176); if (d < bd) { bd = d; best = car; } }
    if (best) { best.missionCar = true; best.color = '#39c2b8'; }
  },
};

function allCars() { return [...city.parked, ...traffic, ...state.police]; }
function allPeds() { return [...peds, ...state.officers]; }

function saveGame() {
  if (shot) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: state.cash, ammo: state.ammo, mission: ms.index,
      packages: city.packages.filter((p) => p.taken).map((p) => p.id),
      health: Math.round(state.player.health),
    }));
  } catch { /* storage unavailable: play on without saving */ }
}

function loadGame() {
  if (shot) return false;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.cash = data.cash | 0; state.ammo = data.ammo | 0;
    ms.index = Math.min(MISSIONS.length, data.mission | 0);
    for (const id of data.packages || []) if (city.packages[id]) { city.packages[id].taken = true; state.packagesFound++; }
    state.player.health = clamp(data.health || 100, 20, 100);
    return ms.index > 0 || state.packagesFound > 0;
  } catch { return false; }
}

function addWanted(n, reason) {
  const before = state.wanted;
  state.wanted = clamp(state.wanted + n, 0, WANTED.max);
  state.unseen = 0;
  if (state.wanted > before) hooks.toast(`${reason} — wanted ${state.wanted}★`);
}

function respawn(x, z, big, sub) {
  const p = state.player;
  if (p.car) { p.car.driver = null; p.car = null; audio.stopEngine(); }
  p.x = x; p.z = z; p.health = 100; state.wanted = 0; state.bust = 0;
  state.police.length = 0; state.officers.length = 0;
  hooks.banner(big, sub); audio.busted();
}

function checkBustedWasted(dt) {
  const p = state.player;
  if (state.bust >= 1) {
    const fine = Math.max(50, Math.round(state.cash * 0.1));
    state.cash = Math.max(0, state.cash - fine);
    respawn(LANDMARKS.policeStation.x, LANDMARKS.policeStation.z + 16, 'BUSTED', `The Aurelia PD fined you $${fine}.`);
    saveGame();
  }
  if (p.health <= 0) {
    const bill = Math.max(40, Math.round(state.cash * 0.08));
    state.cash = Math.max(0, state.cash - bill);
    respawn(LANDMARKS.hospital.x, LANDMARKS.hospital.z + 16, 'WASTED', `St. Brine patched you up for $${bill}.`);
    saveGame();
  }
  // Officers at high heat rough the player up when they catch them.
  if (state.wanted >= 4) {
    for (const o of state.officers) if (o.state !== 'down' && dist(o.x, o.z, p.x, p.z) < 2.6 && !p.car) p.health -= 6 * dt;
  }
}

// ---- Player ----------------------------------------------------------------

function updateOnFoot(dt) {
  const p = state.player;
  const f = (input.forward() ? 1 : 0) - (input.back() ? 1 : 0);
  const r = (input.right() ? 1 : 0) - (input.left() ? 1 : 0);
  const fx = Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = Math.sin(camYaw);
  let mx = fx * f + rx * r, mz = fz * f + rz * r;
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    mx /= len; mz /= len;
    const speed = (input.sprint() ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * (isWater(p.x, p.z) && !onPier(p.x, p.z) ? 0.45 : 1);
    const want = Math.atan2(mx, -mz);
    p.angle += clamp(wrapAngle(want - p.angle), -12 * dt, 12 * dt);
    p.vx = mx * speed; p.vz = mz * speed;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.walkPhase += dt * speed * 1.6;
  } else { p.vx = 0; p.vz = 0; }
  const hit = collideBuildings(city.buildings, p.x, p.z, PLAYER.radius);
  p.x = hit.x; p.z = hit.z;
  clampWorld(p, 0);
  // Enter a car.
  if (input.take('KeyE')) {
    let best = null, bd = 5;
    for (const car of allCars()) { const d = dist(p.x, p.z, car.x, car.z); if (d < bd && car.driver !== 'player') { bd = d; best = car; } }
    if (best) {
      best.driver = 'player'; best.parked = false;
      if (best.traffic) { best.traffic = false; addWanted(1, 'Carjacked in plain sight'); }
      else if (state.police.length && dist(p.x, p.z, state.police[0].x, state.police[0].z) < 45) addWanted(1, 'Car theft witnessed');
      p.car = best; audio.enterCar(); audio.startEngine();
      hooks.toast(best.missionCar ? 'The teal coupe — Coco’s prize.' : 'Wheels acquired. WASD to drive, E to get out.');
    }
  }
  // Melee.
  if (input.take('KeyF')) {
    audio.melee();
    const tx = p.x + Math.sin(p.angle) * PLAYER.meleeRange, tz = p.z - Math.cos(p.angle) * PLAYER.meleeRange;
    for (const ped of allPeds()) {
      if (ped.state !== 'down' && dist(tx, tz, ped.x, ped.z) < 2.2) {
        ped.health -= PLAYER.meleeDamage;
        if (ped.health <= 0) { ped.state = 'down'; ped.fallTimer = 6; addWanted(1, ped.officer ? 'Officer down' : 'Assault'); }
        else { ped.state = 'flee'; ped.timer = 3; ped.angle = Math.atan2(ped.x - p.x, -(ped.z - p.z)); }
      }
    }
    for (const car of allCars()) if (dist(tx, tz, car.x, car.z) < 3) { car.health -= 10; audio.crash(); }
  }
  // Shooting.
  state.shootCd -= dt;
  if ((input.takeClick() || input.take('KeyJ')) && state.shootCd <= 0) {
    if (state.ammo > 0) {
      state.ammo--; state.shootCd = 0.24; state.muzzle = 0.07; audio.gunshot();
      shootRay(p);
    } else { hooks.toast('Out of ammo — find a green ammo cache.'); state.shootCd = 0.3; }
  }
}

function shootRay(p) {
  const dx = Math.sin(p.angle), dz = -Math.cos(p.angle);
  let bestT = 42, hitPed = null, hitCar = null;
  for (const ped of allPeds()) {
    if (ped.state === 'down') continue;
    const t = (ped.x - p.x) * dx + (ped.z - p.z) * dz;
    if (t < 0 || t > bestT) continue;
    const px = p.x + dx * t, pz = p.z + dz * t;
    if (dist(px, pz, ped.x, ped.z) < 1.7) { bestT = t; hitPed = ped; hitCar = null; }
  }
  for (const car of allCars()) {
    const t = (car.x - p.x) * dx + (car.z - p.z) * dz;
    if (t < 0 || t > bestT) continue;
    const px = p.x + dx * t, pz = p.z + dz * t;
    if (dist(px, pz, car.x, car.z) < 3.2) { bestT = t; hitCar = car; hitPed = null; }
  }
  if (hitPed) {
    hitPed.health -= 55;
    if (hitPed.health <= 0) { hitPed.state = 'down'; hitPed.fallTimer = 8; }
    else { hitPed.state = 'flee'; hitPed.timer = 4; }
    addWanted(hitPed.officer ? 2 : 1, hitPed.officer ? 'Shots fired at an officer' : 'Shots fired');
  } else if (hitCar) {
    hitCar.health -= 18; audio.crash();
    if (!hitCar.police) addWanted(1, 'Gunfire reported');
  } else addWanted(1, 'Gunfire reported');
}

function updateDriving(dt) {
  const p = state.player;
  const car = p.car;
  const fwdIn = (input.forward() ? 1 : 0) - (input.back() ? 1 : 0);
  if (fwdIn > 0) car.speed += CAR.accel * dt * (car.speed < 0 ? 2.2 : 1);
  else if (fwdIn < 0) car.speed -= (car.speed > 0 ? CAR.brake : CAR.accel * 0.6) * dt;
  else car.speed -= car.speed * Math.min(1, dt * 0.7);
  if (input.brake()) car.speed -= car.speed * Math.min(1, dt * 3.2);
  car.speed = clamp(car.speed, -CAR.reverseMax, 34);
  const steer = (input.left() ? -1 : 0) + (input.right() ? 1 : 0);
  if (Math.abs(car.speed) > 0.4) car.angle += steer * CAR.turnRate * dt * clamp(Math.abs(car.speed) / 9, 0.25, 1) * Math.sign(car.speed);
  const nx = car.x + Math.sin(car.angle) * car.speed * dt;
  const nz = car.z - Math.cos(car.angle) * car.speed * dt;
  const hit = collideBuildings(city.buildings, nx, nz, 2.3);
  if (hit.hit && Math.abs(car.speed) > 6) { audio.crash(); car.health -= 6; p.health -= 2; }
  if (hit.hit) car.speed *= 0.35;
  car.x = hit.x; car.z = hit.z;
  if (isWater(car.x, car.z) && !onPier(car.x, car.z)) { car.speed *= 0.9; car.z = Math.min(car.z, 296); }
  clampWorld(car, 0);
  p.x = car.x; p.z = car.z; p.angle = car.angle;
  p.walkPhase += dt * Math.abs(car.speed);
  audio.setEngine(clamp(car.speed / 34, -1, 1), dt);
  // Running people and cars over has consequences.
  for (const ped of allPeds()) {
    if (ped.state !== 'down' && Math.abs(car.speed) > 4 && dist(car.x, car.z, ped.x, ped.z) < 2.6) {
      ped.state = 'down'; ped.fallTimer = 8; ped.health = 30;
      addWanted(ped.officer ? 2 : 1, ped.officer ? 'Officer run down' : 'Pedestrian hit');
      car.speed *= 0.6; audio.crash();
    }
  }
  for (const other of allCars()) {
    if (other !== car && dist(car.x, car.z, other.x, other.z) < 3.6 && Math.abs(car.speed) > 5) {
      audio.crash(); car.speed *= -0.25; other.health -= 8;
      if (other.police) addWanted(1, 'Police car rammed');
    }
  }
  if (input.take('KeyE')) {
    car.driver = null;
    if (Math.abs(car.speed) < 1 && !car.police) car.parked = true;
    p.car = null; p.x = car.x + Math.cos(car.angle) * 3; p.z = car.z + Math.sin(car.angle) * 3;
    audio.stopEngine();
  }
}

function updatePickups(dt) {
  const p = state.player;
  for (const pk of city.packages) {
    if (!pk.taken && dist(p.x, p.z, pk.x, pk.z) < 3) {
      pk.taken = true; state.packagesFound++; state.cash += 50;
      audio.pickup(); hooks.toast(`Hidden package ${state.packagesFound} / ${city.packages.length} — +$50`);
      saveGame();
    }
  }
  for (const am of city.ammo) {
    if (!am.ready) { am.timer -= dt; if (am.timer <= 0) am.ready = true; continue; }
    if (dist(p.x, p.z, am.x, am.z) < 3) { am.ready = false; am.timer = 30; state.ammo += 12; audio.pickup(); hooks.toast('Pistol ammo +12'); }
  }
}

// ---- HUD -------------------------------------------------------------------

const hudCache = {};
function setText(node, key, value) { if (hudCache[key] !== value) { hudCache[key] = value; node.textContent = value; } }
function updateHUD() {
  setText(ui.cash, 'cash', `$${state.cash}`);
  setText(ui.packages, 'pkg', `Packages ${state.packagesFound} / ${city.packages.length}`);
  let stars = '';
  for (let i = 0; i < WANTED.max; i++) stars += i < state.wanted ? '★' : '☆';
  if (state.bust > 0.05 && state.wanted > 0) stars += `  BUSTING ${Math.round(state.bust * 100)}%`;
  setText(ui.stars, 'stars', stars);
  ui.health.style.width = `${clamp(state.player.health, 0, 100)}%`;
  setText(ui.ammo, 'ammo', state.player.car ? `Speed ${Math.abs(Math.round(state.player.car.speed * 3.6))} km/h` : `Pistol ${state.ammo}`);
  const obj = objectiveText(ms, state);
  setText(ui.objective.querySelector('.mtitle'), 'mt', screen === 'title' ? '' : obj.title);
  setText(ui.objective.querySelector('.mtext'), 'mx', screen === 'title' ? '' : obj.text);
  setText(ui.objective.querySelector('.mtimer'), 'tm', obj.timer);
  const p = state.player;
  let prompt = '';
  if (!p.car && screen === 'play') {
    let bd = 5;
    for (const car of allCars()) bd = Math.min(bd, dist(p.x, p.z, car.x, car.z));
    if (bd < 5) prompt = 'E — enter vehicle';
  }
  if (state.wanted > 0 && state.playerSeen) prompt = prompt || 'Police have eyes on you — break line of sight!';
  ui.prompt.classList.toggle('hidden', !prompt);
  setText(ui.prompt, 'pr', prompt);
}

// ---- Camera ------------------------------------------------------------------

function updateCamera(dt) {
  const p = state.player;
  const targetYaw = p.car ? p.car.angle : p.angle;
  camYaw += wrapAngle(targetYaw - camYaw) * Math.min(1, dt * (p.car ? 4.5 : 7));
  const back = p.car ? 17 : 13.5, h = p.car ? 9.5 : 8;
  const tx = p.x - Math.sin(camYaw) * back, tz = p.z + Math.cos(camYaw) * back;
  camX += (tx - camX) * Math.min(1, dt * 8);
  camZ += (tz - camZ) * Math.min(1, dt * 8);
  return { x: camX, z: camZ, h, yaw: camYaw };
}

// ---- Shot staging --------------------------------------------------------------

function stageShot(name) {
  ui.title.classList.add('hidden');
  screen = 'play'; started = true;
  const p = state.player;
  if (name === 'start') {
    ui.title.classList.remove('hidden');
    screen = 'title';
    p.x = -40; p.z = 150; p.angle = 0.6;
    camYaw = 0.6; camX = p.x - Math.sin(camYaw) * 16; camZ = p.z + Math.cos(camYaw) * 16;
    ms.index = 0;
    return;
  }
  if (name === 'play') {
    state.cash = 1250; state.wanted = 3; p.health = 82; state.ammo = 14;
    ms.index = 2;
    startMission(ms, state, hooks);
    ui.banner.classList.add('hidden'); bannerTimer = 0;
    // Put Mara in the mission coupe on the shore road, mid-race, PD behind.
    hooks.spawnMissionCar();
    const car = city.parked.find((c) => c.missionCar) || city.parked[0];
    car.x = -90; car.z = 60; car.angle = Math.PI; car.speed = 19; car.parked = false; car.driver = 'player';
    p.car = car; p.x = car.x; p.z = car.z; p.angle = car.angle;
    camYaw = Math.PI; camX = car.x; camZ = car.z - 17;
    state.police = [];
    for (let i = 0; i < 3; i++) {
      const pc = traffic[i];
      pc.police = true; pc.traffic = false; pc.color = '#eef2f5';
      pc.x = car.x + (i - 1) * 7; pc.z = car.z - 14 - i * 6; pc.angle = Math.PI; pc.speed = 17;
      state.police.push(pc);
    }
    state.packagesFound = 4;
    return;
  }
  // end: story complete on the pier at golden hour.
  state.cash = 5140; state.packagesFound = 14; p.health = 100; state.ammo = 30;
  ms.index = MISSIONS.length;
  p.x = 40; p.z = 250; p.angle = 1.49;
  camYaw = 1.49; camX = p.x - Math.sin(camYaw) * 14; camZ = p.z + Math.cos(camYaw) * 14;
  hooks.banner('STORY COMPLETE', 'Mara Voss owns a piece of Port Aurelia now.');
  bannerTimer = 9999;
}

// ---- Loop ----------------------------------------------------------------------

let last = performance.now(), frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (dt <= 0) dt = 0.016;
  state.time += dt;
  if (state.muzzle > 0) state.muzzle -= dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.style.opacity = 0; }
  if (bannerTimer > 0 && bannerTimer < 9000) { bannerTimer -= dt; if (bannerTimer <= 0) ui.banner.classList.add('hidden'); }

  if (screen === 'title') {
    // Slow cinematic drift behind the title.
    camYaw += dt * 0.05;
    camX = state.player.x - Math.sin(camYaw) * 17;
    camZ = state.player.z + Math.cos(camYaw) * 17;
    updatePeds(peds, dt, city.buildings, rand);
    updateTraffic(traffic, dt, city.buildings, null);
    if (input.take('Enter', 'Mouse') || input.takeClick()) {
      ui.title.classList.add('hidden'); screen = 'play'; audio.unlock();
      if (!started) { started = true; if (currentMission(ms)) startMission(ms, state, hooks); }
    }
  } else if (screen === 'paused') {
    if (input.take('KeyP', 'Escape')) { ui.pause.classList.add('hidden'); screen = 'play'; }
  } else {
    if (!shot && input.take('KeyP', 'Escape')) { ui.pause.classList.remove('hidden'); screen = 'paused'; }
    if (state.player.car) updateDriving(dt); else updateOnFoot(dt);
    updateTraffic(traffic, dt, city.buildings, state.player.car ? null : state.player);
    updatePeds(peds, dt, city.buildings, rand);
    if (state.wanted > 0) { spawnPolice(state, rand); updatePolice(state, dt, city.buildings); }
    else { state.police.length = 0; state.officers.length = 0; }
    audio.updateSiren(state.wanted > 0 && state.police.length > 0, dt);
    if (!state.player.car && state.wanted === 0 && state.player.health < 100) state.player.health = Math.min(100, state.player.health + dt * 1.6);
    updatePickups(dt);
    updateMissions(ms, state, dt, hooks);
    checkBustedWasted(dt);
    saveTimer += dt;
    if (saveTimer > 5) { saveTimer = 0; saveGame(); }
  }

  const st = stageOf(ms);
  const crates = st && st.type === 'collect' && st.points[ms.pointIndex] ? [{ x: st.points[ms.pointIndex][0], z: st.points[ms.pointIndex][1] }] : [];
  const view = screen === 'title'
    ? { x: camX, z: camZ, h: 9, yaw: camYaw }
    : updateCamera(dt);
  if (screen === 'title') { /* camera already set */ }
  renderer.draw({
    view, city, player: state.player,
    allCars: allCars(), allPeds: allPeds(), policeCars: state.police,
    marker: screen === 'title' ? null : markerOf(ms),
    crates, muzzle: state.muzzle,
  }, state.time);
  updateHUD();
  frames++;
  if (shot && frames > 40) window.__shotReady = true;
}

if (shot) stageShot(shot);
else {
  const resumed = loadGame();
  if (resumed) hooks.toast('Save loaded — welcome back to Port Aurelia.');
}
requestAnimationFrame(frame);
