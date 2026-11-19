// hud.js — the on-screen layer for Port Aurelia: health, cash, wanted stars,
// ammo, the mission objective, banners and toasts in the DOM, and the circular
// minimap on a small 2D canvas. The WebGL canvas draws the world; everything
// readable lives here so text stays crisp at any resolution.

import { CITY, STREETS_X, STREETS_Z, BEACH_Z } from './city.js';

const MAP_RANGE = 130; // metres shown from centre to edge of the minimap

export function createHud() {
  const el = (id) => document.getElementById(id);
  const healthFill = el('health-fill');
  const healthText = el('health-text');
  const cashEl = el('cash');
  const starsEl = el('stars');
  const ammoEl = el('ammo');
  const objectiveEl = el('objective');
  const objectiveSubEl = el('objective-sub');
  const packagesEl = el('packages');
  const speedEl = el('speed');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerText = el('banner-text');
  const toastEl = el('toast');
  const bustedBar = el('busted-wrap');
  const bustedFill = el('busted-fill');
  const hurtEl = el('hurt');
  const mapCanvas = el('minimap');
  const mapCtx = mapCanvas.getContext('2d');

  let bannerT = 0;
  let toastT = 0;
  let lastCash = -1;
  let lastStars = -1;
  let lastHealth = -1;
  let lastAmmo = -1;
  let lastObjective = '';
  let lastObjectiveSub = '';
  let lastPackages = -1;

  function showBanner(title, text, seconds) {
    bannerTitle.textContent = title;
    bannerText.textContent = text;
    bannerEl.classList.add('show');
    bannerT = seconds || 4;
  }
  function showToast(text, seconds) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    toastT = seconds || 2.6;
  }

  function drawMinimap(state) {
    const size = mapCanvas.width;
    const half = size / 2;
    const scale = half / MAP_RANGE;
    const p = state.player;
    const g = mapCtx;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(half, half, half - 2, 0, Math.PI * 2);
    g.clip();
    // Ground: city grey-green, beach sand, water blue.
    g.fillStyle = '#3d4a38';
    g.fillRect(0, 0, size, size);
    const toMap = (x, z) => [half + (x - p.x) * scale, half + (z - p.z) * scale];
    let a = toMap(-290, BEACH_Z);
    let b = toMap(290, 340);
    g.fillStyle = '#c9a86a';
    g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    a = toMap(-290, 238);
    g.fillStyle = '#2e6f8e';
    g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    // Streets.
    g.strokeStyle = '#22242a';
    g.lineWidth = Math.max(2, 20 * scale);
    for (const sx of STREETS_X) {
      const pt = toMap(sx, 0);
      g.beginPath(); g.moveTo(pt[0], -4); g.lineTo(pt[0], size + 4); g.stroke();
    }
    for (const sz of STREETS_Z) {
      const pt = toMap(0, sz);
      g.beginPath(); g.moveTo(-4, pt[1]); g.lineTo(size + 4, pt[1]); g.stroke();
    }
    // Buildings as faint blocks near the player.
    g.fillStyle = 'rgba(200,190,170,0.5)';
    for (const bd of CITY.buildings) {
      if (Math.abs(bd.x - p.x) > MAP_RANGE || Math.abs(bd.z - p.z) > MAP_RANGE) continue;
      const pt = toMap(bd.x, bd.z);
      g.fillRect(pt[0] - bd.w * scale / 2, pt[1] - bd.d * scale / 2, bd.w * scale, bd.d * scale);
    }
    const dot = (x, z, color, r) => {
      if (Math.abs(x - p.x) > MAP_RANGE || Math.abs(z - p.z) > MAP_RANGE) return;
      const pt = toMap(x, z);
      g.fillStyle = color;
      g.beginPath(); g.arc(pt[0], pt[1], r, 0, Math.PI * 2); g.fill();
    };
    // Packages glint gold; pickups show as crosses and clips.
    for (const pack of CITY.packages) if (!pack.taken) dot(pack.x, pack.z, '#ffd34d', 2);
    for (const car of state.cars) {
      if (car.dead) continue;
      dot(car.x, car.z, car.police ? (Math.floor(state.time * 3) % 2 ? '#ff4040' : '#4d7dff') : '#e8e8e8', car.police ? 3.4 : 2.4);
    }
    for (const ped of state.peds) if (!ped.down) dot(ped.x, ped.z, '#b9b9b9', 1.6);
    for (const cop of state.cops) if (!cop.down) dot(cop.x, cop.z, '#4d7dff', 2.6);
    if (state.checkpoints) {
      for (const cp of state.checkpoints) if (!cp.done) dot(cp.x, cp.z, '#39d5e8', 3);
    }
    if (state.marker) {
      const pulse = 4 + Math.sin(state.time * 5) * 1.4;
      dot(state.marker.x, state.marker.z, '#ffc21f', pulse);
    }
    // Player arrow, always centred, rotated to heading.
    g.translate(half, half);
    g.rotate(Math.PI - state.player.heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#111';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // Rim.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(half, half, half - 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', half, 13);
  }

  return {
    showBanner,
    showToast,
    /** Sync the DOM with the world state; cheap fields only change when values do. */
    update(state, dt) {
      const p = state.player;
      const health = Math.ceil(p.health);
      if (health !== lastHealth) {
        lastHealth = health;
        healthFill.style.width = `${Math.max(0, health)}%`;
        healthFill.style.background = health > 50 ? '#57d95e' : health > 25 ? '#e8b93c' : '#e04b3c';
        healthText.textContent = `${health}`;
      }
      if (state.cash !== lastCash) {
        lastCash = state.cash;
        cashEl.textContent = `$${state.cash.toLocaleString('en-US')}`;
      }
      if (state.wanted !== lastStars) {
        lastStars = state.wanted;
        starsEl.textContent = '★★★★★'.slice(0, state.wanted) + '☆☆☆☆☆'.slice(0, 5 - state.wanted);
        starsEl.classList.toggle('hot', state.wanted > 0);
      }
      const ammoText = p.mode === 'car' ? '—' : `${state.ammo}`;
      if (ammoText !== lastAmmo) {
        lastAmmo = ammoText;
        ammoEl.textContent = `Pistol · ${ammoText}`;
      }
      if (state.objective !== lastObjective) {
        lastObjective = state.objective;
        objectiveEl.textContent = state.objective;
      }
      if (state.objectiveSub !== lastObjectiveSub) {
        lastObjectiveSub = state.objectiveSub;
        objectiveSubEl.textContent = state.objectiveSub;
      }
      if (state.packagesFound !== lastPackages) {
        lastPackages = state.packagesFound;
        packagesEl.textContent = `Packages ${state.packagesFound} / ${CITY.packages.length}`;
      }
      if (p.mode === 'car' && p.car) {
        speedEl.textContent = `${Math.round(Math.abs(p.car.speed) * 3.6)} km/h`;
        speedEl.style.opacity = '1';
      } else {
        speedEl.style.opacity = '0';
      }
      const bust = state.bustedMeter > 0.05 && state.wanted > 0;
      bustedBar.style.opacity = bust ? '1' : '0';
      if (bust) bustedFill.style.width = `${(state.bustedMeter / 2.2) * 100}%`;
      hurtEl.style.opacity = p.hurtT > 0 ? String(Math.min(0.55, p.hurtT * 2)) : '0';
      if (bannerT > 0) {
        bannerT -= dt;
        if (bannerT <= 0) bannerEl.classList.remove('show');
      }
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toastEl.classList.remove('show');
      }
      drawMinimap(state);
    },
  };
}
