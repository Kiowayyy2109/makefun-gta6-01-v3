// Port Aurelia — the story mission chain: stage tracking, timers,
// checkpoints, rewards and failure/retry, driven by the MISSIONS table.

import { MISSIONS } from './config.js';
import { dist } from './world.js';

export function createMissionState() {
  return {
    index: 0,          // which mission is active (== MISSIONS.length: story done)
    stage: 0,
    pointIndex: 0,     // checkpoint / crate index inside a race/collect stage
    timer: -1,         // seconds left on a timed stage (-1: untimed)
    active: false,     // a stage is live (false between missions, briefly)
    completeTimer: 0,
    failed: false,
  };
}

export function currentMission(ms) {
  return ms.index < MISSIONS.length ? MISSIONS[ms.index] : null;
}

export function stageOf(ms) {
  const m = currentMission(ms);
  return m ? m.stages[ms.stage] : null;
}

// Where the HUD marker should point right now, or null.
export function markerOf(ms) {
  const st = stageOf(ms);
  if (!st) return null;
  if ((st.type === 'race' || st.type === 'collect') && st.points) {
    const p = st.points[ms.pointIndex];
    return p ? { x: p[0], z: p[1] } : null;
  }
  return { x: st.x, z: st.z };
}

export function startStage(ms, state, hooks) {
  const st = stageOf(ms);
  if (!st) return;
  ms.pointIndex = 0;
  ms.timer = st.time || -1;
  ms.active = true;
  if (st.armWanted) {
    state.wanted = Math.max(state.wanted, st.armWanted);
    hooks.toast(`Wanted level ${st.armWanted} — the Aurelia PD is rolling!`);
  }
  if (st.carSpot) hooks.spawnMissionCar();
}

export function startMission(ms, state, hooks) {
  const m = currentMission(ms);
  if (!m) return;
  ms.stage = 0;
  hooks.banner(m.title, `${m.giver} — $${m.reward}`);
  hooks.toast(m.intro);
  startStage(ms, state, hooks);
}

function finishMission(ms, state, hooks) {
  const m = currentMission(ms);
  state.cash += m.reward;
  hooks.audio.cash(); hooks.audio.jingle();
  hooks.banner('MISSION COMPLETE', `${m.title} — +$${m.reward}`);
  ms.index += 1; ms.stage = 0; ms.active = false;
  if (ms.index >= MISSIONS.length) hooks.banner('STORY COMPLETE', 'Mara Voss owns a piece of Port Aurelia now. Free roam!');
  else startMission(ms, state, hooks);
  hooks.save();
}

function failStage(ms, state, hooks, why) {
  hooks.audio.fail();
  hooks.banner('MISSION FAILED', why);
  const st = stageOf(ms);
  ms.timer = st && st.time ? st.time : -1;
  ms.pointIndex = 0;
  if (st && st.type === 'escape') state.wanted = Math.max(state.wanted, 2);
}

// Advance the active stage. Called every frame with the world state.
export function updateMissions(ms, state, dt, hooks) {
  const st = stageOf(ms);
  if (!st || !ms.active) return;
  if (ms.timer > 0) {
    ms.timer -= dt;
    if (ms.timer <= 0) { failStage(ms, state, hooks, 'Out of time — the stage restarts.'); return; }
  }
  const p = state.player;
  const at = (x, z, r) => dist(p.x, p.z, x, z) <= r;
  switch (st.type) {
    case 'goto':
      if (at(st.x, st.z, 6)) nextStage(ms, state, hooks);
      break;
    case 'drive':
      if (st.carSpot) {
        if (p.car && p.car.missionCar) nextStage(ms, state, hooks);
      } else if (p.car && at(st.x, st.z, 8)) nextStage(ms, state, hooks);
      break;
    case 'race': {
      const pt = st.points[ms.pointIndex];
      if (pt && at(pt[0], pt[1], 9)) {
        hooks.audio.checkpoint();
        ms.pointIndex += 1;
        hooks.toast(`Checkpoint ${ms.pointIndex} / ${st.points.length}`);
        if (ms.pointIndex >= st.points.length) nextStage(ms, state, hooks);
      }
      break;
    }
    case 'collect': {
      const pt = st.points[ms.pointIndex];
      if (pt && at(pt[0], pt[1], 4.5)) {
        hooks.audio.pickup();
        ms.pointIndex += 1;
        hooks.toast(`Crate ${ms.pointIndex} / ${st.count}`);
        if (ms.pointIndex >= st.count) nextStage(ms, state, hooks);
      }
      break;
    }
    case 'escape':
      // Must arrive clean: heat still on means keep running.
      if (at(st.x, st.z, 7) && state.wanted === 0) nextStage(ms, state, hooks);
      break;
  }
}

function nextStage(ms, state, hooks) {
  const m = currentMission(ms);
  ms.stage += 1;
  if (ms.stage >= m.stages.length) finishMission(ms, state, hooks);
  else { hooks.audio.checkpoint(); startStage(ms, state, hooks); }
}

export function objectiveText(ms, state) {
  const m = currentMission(ms);
  if (!m) return { title: 'Port Aurelia — free roam', text: 'Story complete. Cruise, collect packages, outrun the PD.', timer: '' };
  const st = stageOf(ms);
  if (!st) return { title: m.title, text: m.intro, timer: '' };
  let text = st.label;
  if (st.type === 'race') text += ` — checkpoint ${Math.min(ms.pointIndex + 1, st.points.length)} of ${st.points.length}`;
  if (st.type === 'collect') text += ` — ${ms.pointIndex} of ${st.count}`;
  if (st.type === 'escape' && state.wanted > 0) text = `Lose the police first (${state.wanted}★), then reach the hideout`;
  const timer = ms.timer > 0 ? `${Math.ceil(ms.timer)}s` : '';
  return { title: `Mission ${ms.index + 1}/${MISSIONS.length} — ${m.title}`, text, timer };
}
