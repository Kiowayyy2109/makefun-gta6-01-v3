// main.js — Port Aurelia's shell: boot, the fixed-step loop, the camera,
// screens (title, play, paused, busted/wasted, story complete), saving to
// localStorage, and turning world events into sound, banners and toasts.
//
// ?seed=N fixes the world seed. ?shot=start|play|end (with &seed=N) stages a
// deterministic scene instead of the interactive loop, paints it twice and
// sets window.__shotReady for the screenshot harness.

import { createWorld } from './world.js';
import { createRenderer } from './render3d.js';
import { createHud } from './hud.js';
import { createInput, ACT_FORWARD, ACT_BACK, ACT_LEFT, ACT_RIGHT, ACT_SPRINT, ACT_BRAKE } from './input.js';
import { createAudio } from './audio.js';
import { stageShot, shotCamera, SCREEN_TITLE, SCREEN_PLAY, SCREEN_OVER } from './shots.js';
import { MISSIONS, TOTAL_REWARD } from './missions.js';
import { CITY } from './city.js';
import { angleDelta } from './rng.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SAVE_KEY = 'port-aurelia.save.v1';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261117;

const canvas = document.getElementById('gl');
const status = document.getElementById('status');
const hudRoot = document.getElementById('hud');
const titlePanel = document.getElementById('title-panel');
const titlePrompt = document.getElementById('title-prompt');
const pausePanel = document.getElementById('pause-panel');
const pauseStats = document.getElementById('pause-stats');
const overPanel = document.getElementById('over-panel');
const overTitle = document.getElementById('over-title');
const overText = document.getElementById('over-text');

const world = createWorld(seed);
const state = world.state;
const renderer = createRenderer(canvas);
const hud = createHud();
const audio = createAudio();

function announce(message) {
  status.textContent = message;
}

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function persist() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.saveData()));
  } catch (e) {
    // Storage may be unavailable; the run simply will not persist.
  }
}

function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------ camera
let camYaw = state.player.heading;
let camX = 0, camY = 30, camZ = 0;

function chaseCamera(dt) {
  const p = state.player;
  const targetYaw = p.heading;
  camYaw += angleDelta(camYaw, targetYaw) * Math.min(1, dt * (p.mode === 'car' ? 4.5 : 7));
  const dist = p.mode === 'car' ? 11.5 : 8.6;
  const height = p.mode === 'car' ? 4.4 : 3.4;
  const tx = p.x - Math.sin(camYaw) * dist;
  const tz = p.z - Math.cos(camYaw) * dist;
  const ty = height;
  const blend = Math.min(1, dt * 6);
  camX += (tx - camX) * blend;
  camY += (ty - camY) * blend;
  camZ += (tz - camZ) * blend;
  return {
    x: camX, y: Math.max(1.4, camY), z: camZ,
    tx: p.x + Math.sin(camYaw) * 6,
    ty: 1.6,
    tz: p.z + Math.cos(camYaw) * 6,
  };
}

function orbitCamera() {
  const a = state.time * 0.05 + 2.4;
  return {
    x: 10 + Math.sin(a) * 95, y: 50, z: 150 + Math.cos(a) * 95,
    tx: 0, ty: 8, tz: 110,
  };
}

// ------------------------------------------------------------ events
let lastHurtSound = 0;
function handleEvents(events) {
  for (const ev of events) {
    switch (ev) {
      case 'gunshot': audio.gunshot(); break;
      case 'cop-shot': audio.gunshot(); break;
      case 'dry-fire': audio.dryFire(); hud.showToast('Out of ammo — find a green ammo crate'); break;
      case 'punch': audio.punch(); break;
      case 'crash': audio.crash(8); break;
      case 'hurt':
        if (state.time - lastHurtSound > 0.35) { audio.hurt(); lastHurtSound = state.time; }
        break;
      case 'pickup-ammo': audio.pickup(); hud.showToast('Pistol ammo +12'); break;
      case 'pickup-health': audio.pickup(); hud.showToast('Patched up +35'); break;
      case 'package':
        audio.cash();
        hud.showToast(`Hidden package found! +$250 (${state.packagesFound}/${CITY.packages.length})`);
        persist();
        break;
      case 'checkpoint': audio.pickup(); hud.showToast('Checkpoint!'); break;
      case 'collect': audio.cash(); hud.showToast('Collected! +$40'); break;
      case 'phase-done': audio.pickup(); break;
      case 'enter-car': audio.enterCar(); break;
      case 'jack': hud.showToast('Carjacked — that was not subtle'); break;
      case 'hit-ped': hud.showToast('You hit a pedestrian!'); break;
      case 'cop-down': hud.showToast('Officer down — the heat is rising'); break;
      case 'mission-done': {
        audio.missionDone();
        const next = MISSIONS[state.missionIndex];
        if (state.storyDone) {
          hud.showBanner('Story Complete', `Mara made $${TOTAL_REWARD.toLocaleString('en-US')} across ${MISSIONS.length} jobs and bought her way out of Port Aurelia. Free roam is yours — ${CITY.packages.length} hidden packages are still out there.`, 7);
        } else if (next) {
          hud.showBanner(`$${MISSIONS[state.missionIndex - 1].reward} — Job Done`, `Next: ${next.title}. ${next.brief}`, 5.5);
        }
        persist();
        break;
      }
      case 'mission-fail':
        audio.missionFail();
        hud.showBanner('Job Failed', 'The clock beat you. The job restarts — the city forgives, the client does not.', 4.5);
        break;
      case 'busted': audio.busted(); break;
      case 'wasted': audio.missionFail(); break;
      default: break;
    }
  }
}

// ------------------------------------------------------------ shot mode
function runShot(name) {
  const screen = stageShot(name, world);
  hud.update(state, 0);
  titlePanel.classList.toggle('hidden', screen !== SCREEN_TITLE);
  overPanel.classList.toggle('hidden', screen !== SCREEN_OVER);
  pausePanel.classList.add('hidden');
  if (screen === SCREEN_TITLE) {
    titlePanel.classList.remove('hidden');
    hudRoot.classList.add('hidden');
  } else if (screen === SCREEN_OVER) {
    hudRoot.classList.remove('hidden');
    overTitle.textContent = 'Story Complete';
    overTitle.classList.remove('busted');
    overText.textContent = `Seven jobs, $${state.cash.toLocaleString('en-US')} banked, ${state.packagesFound} of ${CITY.packages.length} hidden packages found. Port Aurelia keeps the rest of its secrets.`;
    overPanel.classList.remove('hidden');
  } else {
    hudRoot.classList.remove('hidden');
    hud.showBanner('Hot Package', 'Deliver the package across town before the clock runs out — and shake the three stars on your tail.', 30);
    hud.update(state, 0);
  }
  let painted = 0;
  function paint() {
    const cam = shotCamera(name, state, performance.now() / 1000) || chaseCamera(1 / 30);
    if (name === 'play') {
      // Snap the chase camera behind the car for a clean framed chase shot.
      camYaw = state.player.heading;
      camX = state.player.x - Math.sin(camYaw) * 13.5;
      camZ = state.player.z - Math.cos(camYaw) * 13.5;
      camY = 5.4;
    }
    renderer.draw(state, name === 'play' ? chaseCamera(0) : cam);
    hud.update(state, 0);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// ------------------------------------------------------------ interactive mode
function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  let meleeQueued = false;

  const existing = loadSave();
  if (existing && (existing.missionIndex > 0 || existing.packages.length > 0 || existing.cash !== 120)) {
    world.reset(existing);
    titlePrompt.textContent = 'Press Enter or click to continue — N for a new game';
  }
  announce('Port Aurelia. Press Enter to start.');

  function showTitle() {
    screen = SCREEN_TITLE;
    titlePanel.classList.remove('hidden');
    hudRoot.classList.add('hidden');
    pausePanel.classList.add('hidden');
    overPanel.classList.add('hidden');
  }

  let begun = false;
  function startPlay() {
    if (!begun) {
      begun = true;
      state.player.health = 100; // the title-screen city idles; start fresh
    }
    screen = SCREEN_PLAY;
    titlePanel.classList.add('hidden');
    pausePanel.classList.add('hidden');
    overPanel.classList.add('hidden');
    hudRoot.classList.remove('hidden');
    audio.unlock();
    audio.click();
    const mission = MISSIONS[state.missionIndex];
    if (mission) hud.showBanner(mission.title, mission.brief, 5);
    announce('Playing.');
  }

  function showOver() {
    screen = SCREEN_OVER;
    const busted = state.over === 'busted';
    overTitle.textContent = busted ? 'Busted' : 'Wasted';
    overTitle.classList.toggle('busted', busted);
    overText.textContent = busted
      ? 'The Aurelia PD finally got hands on Mara. The fine is $150 and the job restarts — the heat, at least, is gone.'
      : 'Mara wakes up outside Aurelia General with a 10% lighter wallet and a restarted job. The city is patient.';
    overPanel.classList.remove('hidden');
    announce(busted ? 'Busted.' : 'Wasted.');
  }

  function togglePause() {
    if (screen === SCREEN_PLAY) {
      screen = 'paused';
      const mission = MISSIONS[state.missionIndex];
      pauseStats.textContent = `Cash $${state.cash.toLocaleString('en-US')} · Mission ${Math.min(state.missionIndex + 1, MISSIONS.length)} of ${MISSIONS.length}${mission ? ` (${mission.title})` : ''} · Packages ${state.packagesFound}/${CITY.packages.length} · Cars driven ${state.stats.carsDriven}`;
      pausePanel.classList.remove('hidden');
      announce('Paused.');
    } else if (screen === 'paused') {
      screen = SCREEN_PLAY;
      pausePanel.classList.add('hidden');
      announce('Playing.');
    }
  }

  function buildControl() {
    const p = state.player;
    if (p.mode === 'car') {
      return {
        moveX: 0, moveZ: 0, sprint: false,
        throttle: (input.down(ACT_FORWARD) ? 1 : 0) - (input.down(ACT_BACK) ? 1 : 0),
        steer: (input.down(ACT_LEFT) ? 1 : 0) - (input.down(ACT_RIGHT) ? 1 : 0),
        brake: input.down(ACT_BRAKE),
        shoot: false, melee: false,
      };
    }
    // On foot, movement is relative to the camera's facing.
    const f = (input.down(ACT_FORWARD) ? 1 : 0) - (input.down(ACT_BACK) ? 1 : 0);
    const r = (input.down(ACT_RIGHT) ? 1 : 0) - (input.down(ACT_LEFT) ? 1 : 0);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = fz, rz = -fx;
    const ctl = {
      moveX: fx * f + rx * r,
      moveZ: fz * f + rz * r,
      sprint: input.down(ACT_SPRINT),
      throttle: 0, steer: 0, brake: false,
      shoot: input.mouseHeld(),
      melee: meleeQueued,
    };
    meleeQueued = false;
    return ctl;
  }

  function handleKeys() {
    if (input.pressed('KeyM')) {
      audio.setMuted(!audio.isMuted());
      hud.showToast(audio.isMuted() ? 'Sound off' : 'Sound on');
    }
    if (screen === SCREEN_TITLE) {
      if (input.pressedAny(['Enter', 'Space']) || input.takeMouseClick()) startPlay();
      else if (input.pressed('KeyN')) {
        clearSave();
        world.reset(null);
        titlePrompt.textContent = 'Press Enter or click to start';
        hud.showToast('New game ready');
      }
      return;
    }
    if (screen === SCREEN_OVER) {
      if (input.pressedAny(['Enter', 'Space']) || input.takeMouseClick()) {
        world.respawn();
        persist();
        startPlay();
      }
      return;
    }
    if (input.pressedAny(['KeyP', 'Escape'])) { togglePause(); return; }
    if (screen !== SCREEN_PLAY) return;
    if (input.pressed('KeyF')) {
      const ev = [];
      if (world.tryEnterExit(ev)) handleEvents(ev);
    }
    if (input.pressed('KeyE')) meleeQueued = true;
    input.takeMouseClick(); // clicks only shoot via mouseHeld; drain the latch
  }

  function stepOnce() {
    const events = world.step(STEP, buildControl());
    handleEvents(events);
    if (state.over && screen === SCREEN_PLAY) showOver();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleKeys();
    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        stepOnce();
        accumulator -= STEP;
      }
      saveTimer += STEP;
      if (saveTimer > 10) { saveTimer = 0; persist(); }
    } else {
      accumulator = 0;
      if (screen === SCREEN_TITLE) {
        // The city idles behind the title: traffic rolls, nobody gets hurt.
        world.step(STEP, { moveX: 0, moveZ: 0, sprint: false, throttle: 0, steer: 0, brake: false, shoot: false, melee: false });
      }
    }
    const cam = screen === SCREEN_TITLE ? orbitCamera() : chaseCamera(1 / 60);
    renderer.draw(state, cam);
    if (screen === SCREEN_PLAY || screen === 'paused') hud.update(state, 1 / 60);
    const sirenNear = state.wanted > 0 && state.cars.some((c) => c.police && Math.hypot(c.x - state.player.x, c.z - state.player.z) < 65);
    audio.update(1 / 60, state.player.mode === 'car', state.player.car ? state.player.car.speed / 33 : 0, sirenNear);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) togglePause();
  });

  showTitle();
  requestAnimationFrame(frame);
}

// Debug/testing handle: the playtest drives the real game through this.
window.__PA = { world, state, getScreen: () => (shot ? 'shot' : undefined) };

if (shot) runShot(shot);
else runGame();
