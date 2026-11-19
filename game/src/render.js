// Port Aurelia — renderer. A small software-3D engine on Canvas 2D: world
// points are rotated into camera space, perspective-divided and painted
// far-to-near. Boxes for buildings and cars, billboards for people and
// palms, projected quads for roads, sand and sea. Golden-hour sky throughout.

import { WORLD, PALETTE, LANDMARKS } from './config.js';
import { isWater } from './world.js';

const PITCH = 0.30;

export function createRenderer(canvas, minimapCanvas) {
  const ctx = canvas.getContext('2d');
  const mtx = minimapCanvas.getContext('2d');
  let W = 0, H = 0, focal = 0;

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(window.innerWidth * ratio); H = Math.round(window.innerHeight * ratio);
    canvas.width = W; canvas.height = H;
    focal = H * 0.95;
  }
  window.addEventListener('resize', resize);
  resize();

  // Camera state is smoothed in main and passed in: {x, z, h, yaw}.
  let cam = { x: 0, z: 0, h: 10, yaw: 0 };
  let cosY = 1, sinY = 0;
  const cosP = Math.cos(PITCH), sinP = Math.sin(PITCH);

  function project(x, y, z) {
    const dx = x - cam.x, dy = y - cam.h, dz = z - cam.z;
    const rx = dx * cosY + dz * sinY;
    const depth = dx * sinY - dz * cosY;
    const d2 = depth * cosP - dy * sinP;
    if (d2 < 1.2) return null;
    const ry = dy * cosP + depth * sinP;
    return { x: W / 2 + (rx / d2) * focal, y: H / 2 - (ry / d2) * focal, d: d2, s: focal / d2 };
  }

  function poly(points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (!p) return;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath(); ctx.fill();
  }

  function camSpace(x, y, z) {
    const dx = x - cam.x, dy = y - cam.h, dz = z - cam.z;
    const rx = dx * cosY + dz * sinY;
    const depth = dx * sinY - dz * cosY;
    return { rx, ry: dy * cosP + depth * sinP, d: depth * cosP - dy * sinP };
  }
  function toScreen(p) { return { x: W / 2 + (p.rx / p.d) * focal, y: H / 2 - (p.ry / p.d) * focal, d: p.d, s: focal / p.d }; }

  // Ground quads are huge and routinely cross behind the camera, so they are
  // clipped against the near plane in camera space before projecting.
  function groundQuad(x0, z0, x1, z1, fill) {
    let pts = [camSpace(x0, 0, z0), camSpace(x1, 0, z0), camSpace(x1, 0, z1), camSpace(x0, 0, z1)];
    const clipped = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a.d >= 1.2) clipped.push(a);
      if ((a.d >= 1.2) !== (b.d >= 1.2)) {
        const t = (1.2 - a.d) / (b.d - a.d);
        clipped.push({ rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t, d: 1.2 });
      }
    }
    if (clipped.length < 3) return;
    poly(clipped.map(toScreen), fill);
  }

  function box(item, x, z, hw, hd, h, angle, colors, y0 = 0) {
    // Axis-aligned when angle is 0 (buildings); cars rotate their corners.
    const c = Math.cos(angle), s = Math.sin(angle);
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => ({
      x: x + lx * c - lz * s, z: z + lx * s + lz * c,
    }));
    const base = corners.map((p) => project(p.x, y0, p.z));
    const top = corners.map((p) => project(p.x, h, p.z));
    if (base.some((p) => !p) || top.some((p) => !p)) return;
    // Only faces turned toward the camera: test each face's centre depth gain.
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const mx = (corners[i].x + corners[j].x) / 2 - cam.x, mz = (corners[i].z + corners[j].z) / 2 - cam.z;
      const fx = corners[j].x - corners[i].x, fz = corners[j].z - corners[i].z;
      // Outward normal of edge i (pointing away from box centre).
      let nx = fz, nz = -fx;
      const cxm = (corners[i].x + corners[j].x) / 2 - x, czm = (corners[i].z + corners[j].z) / 2 - z;
      if (nx * cxm + nz * czm < 0) { nx = -nx; nz = -nz; }
      if (nx * -mx + nz * -mz <= 0) continue; // facing away
      poly([base[i], base[j], top[j], top[i]], colors[i % colors.length]);
    }
    poly([top[0], top[1], top[2], top[3]], colors[4] || colors[0]);
    item.topPts = top;
  }

  function person(x, z, shirt, skin, phase, officer) {
    const foot = project(x, 0, z); if (!foot) return;
    const bob = Math.abs(Math.sin(phase || 0)) * 0.12;
    const hip = project(x, 0.95 + bob, z), head = project(x, 1.78 + bob, z);
    if (!hip || !head) return;
    const w = Math.max(1.5, foot.s * 0.34);
    ctx.strokeStyle = officer ? '#1b2547' : '#2b3550';
    ctx.lineWidth = Math.max(1.2, foot.s * 0.16);
    ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(hip.x, hip.y); ctx.stroke();
    ctx.fillStyle = shirt;
    ctx.fillRect(hip.x - w / 2, head.y + (hip.y - head.y) * 0.25, w, hip.y - head.y - (hip.y - head.y) * 0.2);
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(1.4, foot.s * 0.17), 0, Math.PI * 2); ctx.fill();
    if (officer) { ctx.fillStyle = '#ffd76a'; ctx.fillRect(head.x - w * 0.3, head.y - foot.s * 0.05, w * 0.6, Math.max(1, foot.s * 0.05)); }
  }

  function carMesh(car, time) {
    const item = {};
    const shade = shadeColor(car.color, 0.72);
    box(item, car.x, car.z, car.l / 2, car.w / 2, 0.62, -car.angle + Math.PI / 2, [car.color, shade, car.color, shade, shadeColor(car.color, 0.9)]);
    // Cabin.
    const back = 0.3;
    const cxp = car.x - Math.sin(car.angle) * back, czp = car.z + Math.cos(car.angle) * back;
    box({}, cxp, czp, 1.05, 0.86, 1.14, -car.angle + Math.PI / 2, ['#1d2733', '#141c26', '#1d2733', '#141c26', '#232f3d'], 0.55);
    if (car.police) {
      const top = project(car.x, 1.3, car.z);
      if (top) {
        const on = Math.floor(time * 2.4) % 2 === 0;
        ctx.fillStyle = on ? '#ff4040' : '#4060ff';
        ctx.fillRect(top.x - top.s * 0.5, top.y, top.s * 0.42, Math.max(2, top.s * 0.14));
        ctx.fillStyle = on ? '#4060ff' : '#ff4040';
        ctx.fillRect(top.x + top.s * 0.08, top.y, top.s * 0.42, Math.max(2, top.s * 0.14));
      }
    }
  }

  function palm(p) {
    const base = project(p.x, 0, p.z); if (!base) return;
    const topP = project(p.x + p.lean * 3, p.h, p.z); if (!topP) return;
    ctx.strokeStyle = '#7a5a38'; ctx.lineWidth = Math.max(1, base.s * 0.14);
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(topP.x, topP.y); ctx.stroke();
    ctx.strokeStyle = '#3f7d3a'; ctx.lineWidth = Math.max(1, base.s * 0.1);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + p.x;
      ctx.beginPath(); ctx.moveTo(topP.x, topP.y);
      ctx.quadraticCurveTo(topP.x + Math.cos(a) * base.s * 1.1, topP.y - base.s * 0.4, topP.x + Math.cos(a) * base.s * 1.7, topP.y + base.s * 0.35);
      ctx.stroke();
    }
  }

  function drawWorld(state, time) {
    const view = state.view;
    cam = view; cosY = Math.cos(cam.yaw); sinY = Math.sin(cam.yaw);
    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, PALETTE.skyTop); sky.addColorStop(0.55, PALETTE.skyMid); sky.addColorStop(1, PALETTE.skyLow);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Sun, low in the west.
    const sun = project(cam.x - 400, 60, cam.z - 420);
    if (sun) { ctx.fillStyle = PALETTE.sun; ctx.beginPath(); ctx.arc(Math.max(-80, Math.min(W + 80, sun.x)), Math.max(20, Math.min(H * 0.6, sun.y)), H * 0.055, 0, Math.PI * 2); ctx.fill(); }
    // Ground base: grass city-wide, then sand and sea.
    groundQuad(cam.x - 500, cam.z - 500, cam.x + 500, cam.z + 500, PALETTE.grass);
    groundQuad(-340, WORLD.beachZ, 340, WORLD.oceanZ, PALETTE.sand);
    groundQuad(-500, WORLD.oceanZ, 500, 700, PALETTE.sea);
    groundQuad(-500, WORLD.oceanZ, 500, WORLD.oceanZ + 26, PALETTE.seaDeep);
    // Roads: draw each grid line as segments between intersections.
    const R = WORLD.roads;
    for (const r of R) {
      groundQuad(r - WORLD.roadHalf, -330, r + WORLD.roadHalf, WORLD.beachZ, PALETTE.road);
      if (r < WORLD.beachZ) groundQuad(-330, r - WORLD.roadHalf, 330, r + WORLD.roadHalf, PALETTE.road);
    }
    groundQuad(-340, WORLD.beachZ - 4, 340, WORLD.beachZ + 2, '#c9b18a'); // promenade
    // Pier.
    groundQuad(WORLD.pierX - 5, WORLD.beachZ, WORLD.pierX + 5, WORLD.pierEndZ, '#8a6a4a');
    // Lane dashes near the camera only.
    ctx.fillStyle = PALETTE.roadLine;
    for (const r of R) {
      for (let t = -320; t < 200; t += 16) {
        if (Math.abs(t - cam.z) > 150 && Math.abs(r - cam.x) > 150) continue;
        const p = project(r, 0.05, t); if (p && p.d < 150) ctx.fillRect(p.x - 1, p.y - 1, Math.max(1.5, p.s * 0.14), Math.max(1.5, p.s * 0.5));
      }
    }
    // Drawable things, far to near.
    const draws = [];
    const near = (x, z, max) => Math.hypot(x - cam.x, z - cam.z) < max;
    for (const b of state.city.buildings) if (near(b.x, b.z, 300)) draws.push({ d: Math.hypot(b.x - cam.x, b.z - cam.z), f: () => drawBuilding(b) });
    for (const p of state.city.palms) if (near(p.x, p.z, 190)) draws.push({ d: Math.hypot(p.x - cam.x, p.z - cam.z), f: () => palm(p) });
    for (const car of state.allCars) if (near(car.x, car.z, 240)) draws.push({ d: Math.hypot(car.x - cam.x, car.z - cam.z), f: () => carMesh(car, time) });
    for (const ped of state.allPeds) if (near(ped.x, ped.z, 170)) draws.push({ d: Math.hypot(ped.x - cam.x, ped.z - cam.z), f: () => { if (ped.state !== 'down') person(ped.x, ped.z, ped.color, ped.skin, ped.walkPhase, ped.officer); else downPerson(ped); } });
    for (const pk of state.city.packages) if (!pk.taken && near(pk.x, pk.z, 170)) draws.push({ d: Math.hypot(pk.x - cam.x, pk.z - cam.z), f: () => pickup(pk.x, pk.z, time + pk.spin, '#ffd76a') });
    for (const am of state.city.ammo) if (am.ready && near(am.x, am.z, 150)) draws.push({ d: Math.hypot(am.x, am.z, 0) && Math.hypot(am.x - cam.x, am.z - cam.z), f: () => pickup(am.x, am.z, 0, '#57c785') });
    for (const crate of state.crates) draws.push({ d: Math.hypot(crate.x - cam.x, crate.z - cam.z), f: () => box({}, crate.x, crate.z, 1, 1, 1.1, 0, ['#a5713d', '#8a5a2e', '#a5713d', '#8a5a2e', '#bd8547']) });
    draws.push({ d: Math.hypot(LANDMARKS.lighthouse.x - cam.x, LANDMARKS.lighthouse.z - cam.z), f: drawLighthouse });
    draws.push({ d: Math.hypot(LANDMARKS.ferris.x - cam.x, LANDMARKS.ferris.z - cam.z), f: () => drawFerris(time) });
    const pl = state.player;
    if (!pl.car) draws.push({ d: Math.hypot(pl.x - cam.x, pl.z - cam.z) + 0.01, f: () => person(pl.x, pl.z, '#ff4757', '#f2c09a', pl.walkPhase, false) });
    draws.sort((a, b) => b.d - a.d);
    for (const dr of draws) dr.f();
    drawMarker(state, time);
    drawMuzzle(state);
  }

  function drawBuilding(b) {
    const item = {};
    box(item, b.x, b.z, b.hw, b.hd, b.h, 0, [b.color, shadeColor(b.color, 0.78), b.color, shadeColor(b.color, 0.66), b.roof]);
    // Lit windows on the camera-facing top edges: cheap horizontal bands.
    if (item.topPts) {
      const d = Math.hypot(b.x - cam.x, b.z - cam.z);
      if (d < 120 && b.h > 14) {
        ctx.fillStyle = 'rgba(255,214,106,0.5)';
        for (let i = 0; i < 4; i++) {
          const y = 3 + i * (b.h - 5) / 4;
          const a = project(b.x - b.hw, y, b.z + b.hd), c = project(b.x + b.hw, y, b.z + b.hd);
          if (a && c) ctx.fillRect(Math.min(a.x, c.x), a.y, Math.abs(c.x - a.x), Math.max(1, a.s * 0.09));
        }
      }
    }
  }

  function downPerson(ped) {
    const p = project(ped.x, 0.3, ped.z); if (!p) return;
    ctx.fillStyle = ped.color; ctx.fillRect(p.x - p.s * 0.7, p.y, p.s * 1.4, Math.max(2, p.s * 0.25));
  }

  function pickup(x, z, spin, color) {
    const y = 1.6 + Math.sin(spin * 2) * 0.3;
    const c = project(x, y, z); if (!c) return;
    const r = c.s * 0.62, w = r * (0.45 + Math.abs(Math.cos(spin)) * 0.55);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x + w, c.y); ctx.lineTo(c.x, c.y + r); ctx.lineTo(c.x - w, c.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.2, r * 0.18), 0, Math.PI * 2); ctx.fill();
  }

  function drawLighthouse() {
    const L = LANDMARKS.lighthouse;
    for (let i = 0; i < 5; i++) {
      const y0 = i * L.h / 5, y1 = (i + 1) * L.h / 5;
      const w0 = 4.6 - i * 0.55, w1 = 4.6 - (i + 1) * 0.55;
      poly([project(L.x - w0, y0, L.z), project(L.x + w0, y0, L.z), project(L.x + w1, y1, L.z), project(L.x - w1, y1, L.z)], i % 2 ? '#e84e4e' : '#f5f0e6');
    }
    const top = project(L.x, L.h + 2.4, L.z);
    if (top) { ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.arc(top.x, top.y, Math.max(2, top.s * 0.5), 0, Math.PI * 2); ctx.fill(); }
  }

  function drawFerris(time) {
    const F = LANDMARKS.ferris;
    const c = project(F.x, F.h, F.z); if (!c) return;
    const r = F.r * c.s;
    ctx.strokeStyle = '#e8e4f2'; ctx.lineWidth = Math.max(1.5, c.s * 0.16);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.72, 0, Math.PI * 2); ctx.stroke();
    const rot = time * 0.25;
    for (let i = 0; i < 8; i++) {
      const a = rot + i * Math.PI / 4;
      const gx = c.x + Math.cos(a) * r, gy = c.y + Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.fillStyle = ['#ff6b6b', '#ffd93d', '#6bcbff', '#95e06c'][i % 4];
      ctx.fillRect(gx - c.s * 0.5, gy, c.s, c.s * 0.8);
    }
    const legL = project(F.x - 10, 0, F.z), legR = project(F.x + 10, 0, F.z);
    ctx.beginPath();
    if (legL) { ctx.moveTo(c.x, c.y); ctx.lineTo(legL.x, legL.y); }
    if (legR) { ctx.moveTo(c.x, c.y); ctx.lineTo(legR.x, legR.y); }
    ctx.stroke();
  }

  function drawMarker(state, time) {
    const m = state.marker;
    if (!m) return;
    const top = project(m.x, 26 + Math.sin(time * 2) * 1.5, m.z), base = project(m.x, 0, m.z);
    if (top && base) {
      ctx.fillStyle = 'rgba(255,215,106,0.30)';
      ctx.fillRect(top.x - 2, top.y, 4, base.y - top.y);
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath(); ctx.arc(base.x, base.y, Math.max(3, base.s * 0.8), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(top.x, top.y, Math.max(2, top.s * 0.3), 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawMuzzle(state) {
    if (!state.muzzle || state.muzzle <= 0) return;
    const p = state.player;
    const from = project(p.x, 1.45, p.z);
    const tx = p.x + Math.sin(p.angle) * 30, tz = p.z - Math.cos(p.angle) * 30;
    const to = project(tx, 1.3, tz);
    if (from && to) {
      ctx.strokeStyle = 'rgba(255,220,120,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
  }

  // ---- Minimap -------------------------------------------------------------
  function drawMinimap(state) {
    const S = 176, half = S / 2, scale = S / 700;
    mtx.clearRect(0, 0, S, S);
    mtx.save();
    mtx.beginPath(); mtx.arc(half, half, half, 0, Math.PI * 2); mtx.clip();
    mtx.fillStyle = '#4a7a44'; mtx.fillRect(0, 0, S, S);
    const mx = (x) => half + x * scale, mz = (z) => half + z * scale;
    mtx.fillStyle = PALETTE.sand; mtx.fillRect(0, mz(WORLD.beachZ), S, mz(WORLD.oceanZ) - mz(WORLD.beachZ));
    mtx.fillStyle = PALETTE.sea; mtx.fillRect(0, mz(WORLD.oceanZ), S, S);
    mtx.strokeStyle = '#565b68'; mtx.lineWidth = 5;
    for (const r of WORLD.roads) {
      mtx.beginPath(); mtx.moveTo(mx(r), 0); mtx.lineTo(mx(r), mz(WORLD.beachZ)); mtx.stroke();
      if (r < WORLD.beachZ) { mtx.beginPath(); mtx.moveTo(0, mz(r)); mtx.lineTo(S, mz(r)); mtx.stroke(); }
    }
    mtx.fillStyle = '#ffd76a';
    for (const pk of state.city.packages) if (!pk.taken) { mtx.beginPath(); mtx.arc(mx(pk.x), mz(pk.z), 2, 0, Math.PI * 2); mtx.fill(); }
    if (state.marker) { mtx.fillStyle = '#ffdf3d'; mtx.beginPath(); mtx.arc(mx(state.marker.x), mz(state.marker.z), 5, 0, Math.PI * 2); mtx.fill(); }
    mtx.fillStyle = '#ff4040';
    for (const c of state.policeCars) { mtx.beginPath(); mtx.arc(mx(c.x), mz(c.z), 3, 0, Math.PI * 2); mtx.fill(); }
    const p = state.player;
    mtx.save();
    mtx.translate(mx(p.x), mz(p.z)); mtx.rotate(p.angle);
    mtx.fillStyle = '#ffffff';
    mtx.beginPath(); mtx.moveTo(0, -6); mtx.lineTo(4, 5); mtx.lineTo(-4, 5); mtx.closePath(); mtx.fill();
    mtx.restore();
    mtx.restore();
  }

  return {
    draw(state, time) { drawWorld(state, time); drawMinimap(state); },
    resize,
  };
}

const SHADE_CACHE = new Map();
export function shadeColor(hex, f) {
  const key = hex + f;
  if (SHADE_CACHE.has(key)) return SHADE_CACHE.get(key);
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  const out = `rgb(${r},${g},${b})`;
  SHADE_CACHE.set(key, out);
  return out;
}
