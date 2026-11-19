// render3d.js — Port Aurelia's renderer: a small hand-written WebGL engine.
// No library: one shader pair (Lambert sun light + warm distance fog), one
// static buffer for the whole city built once at boot, and one dynamic buffer
// rebuilt each frame for cars, people, markers and effects. Building windows
// come from a canvas-generated facade texture; everything else is flat colour.

import { CITY, STREETS_X, STREETS_Z, ROAD_HALF, BEACH_Z, WATER_Z, PLACES } from './city.js';

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aCol;
attribute vec3 aNor;
attribute vec2 aUv;
uniform mat4 uMVP;
uniform mat4 uView;
varying vec3 vCol;
varying vec3 vNor;
varying vec2 vUv;
varying float vDist;
void main() {
  vec4 world = vec4(aPos, 1.0);
  vec4 view = uView * world;
  vDist = -view.z;
  vCol = aCol;
  vNor = aNor;
  vUv = aUv;
  gl_Position = uMVP * world;
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uSun;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFlat;
varying vec3 vCol;
varying vec3 vNor;
varying vec2 vUv;
varying float vDist;
void main() {
  vec3 tex = texture2D(uTex, vUv).rgb;
  vec3 base = vCol * tex;
  float diff = max(dot(normalize(vNor), normalize(uSun)), 0.0);
  float light = mix(0.68 + 0.42 * diff, 1.0, uFlat);
  vec3 col = base * light;
  float f = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, f * (1.0 - uFlat * 0.7));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Column-major 4x4 helpers. */
function matPerspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}
function matLookAt(eye, target, up) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ];
  const xl = Math.hypot(x[0], x[1], x[2]) || 1;
  x[0] /= xl; x[1] /= xl; x[2] /= xl;
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const out = new Float32Array(16);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0];
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1];
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}
function matMultiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** The white texel every flat-coloured vertex samples. */
const FLAT_UV = [0.996, 0.996];

class GeoBuilder {
  constructor(maxVerts) {
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 3);
    this.nor = new Float32Array(maxVerts * 3);
    this.uv = new Float32Array(maxVerts * 2);
    this.idx = new Uint32Array(maxVerts * 3);
    this.v = 0;
    this.i = 0;
  }
  reset() { this.v = 0; this.i = 0; }
  vert(x, y, z, color, normal, uv) {
    const v = this.v;
    this.pos[v * 3] = x; this.pos[v * 3 + 1] = y; this.pos[v * 3 + 2] = z;
    this.col[v * 3] = color[0]; this.col[v * 3 + 1] = color[1]; this.col[v * 3 + 2] = color[2];
    this.nor[v * 3] = normal[0]; this.nor[v * 3 + 1] = normal[1]; this.nor[v * 3 + 2] = normal[2];
    this.uv[v * 2] = uv[0]; this.uv[v * 2 + 1] = uv[1];
    this.v += 1;
    return v;
  }
  tri(a, b, c) {
    this.idx[this.i++] = a; this.idx[this.i++] = b; this.idx[this.i++] = c;
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** A flat ground quad at height y from (x0,z0) to (x1,z1). */
  ground(x0, z0, x1, z1, y, color) {
    const n = [0, 1, 0];
    const a = this.vert(x0, y, z0, color, n, FLAT_UV);
    const b = this.vert(x1, y, z0, color, n, FLAT_UV);
    const c = this.vert(x1, y, z1, color, n, FLAT_UV);
    const d = this.vert(x0, y, z1, color, n, FLAT_UV);
    this.quad(a, b, c, d);
  }
  /**
   * A box centred at (cx, cy, cz) with size (sx, sy, sz). Options: ry/rx/rz
   * Euler rotation, topColor for the up face, facade=true to map the window
   * texture over the four side faces.
   */
  box(cx, cy, cz, sx, sy, sz, opts) {
    const o = opts || {};
    const color = o.color || [1, 1, 1];
    const topColor = o.topColor || color;
    const ry = o.ry || 0, rx = o.rx || 0, rz = o.rz || 0;
    const cy1 = Math.cos(ry), sy1 = Math.sin(ry);
    const cx1 = Math.cos(rx), sx1 = Math.sin(rx);
    const cz1 = Math.cos(rz), sz1 = Math.sin(rz);
    const rot = (x, y, z) => {
      // R = Ry * Rx * Rz
      let X = x * cz1 - y * sz1;
      let Y = x * sz1 + y * cz1;
      let Z = z;
      const Y2 = Y * cx1 - Z * sx1;
      const Z2 = Y * sx1 + Z * cx1;
      Y = Y2; Z = Z2;
      const X2 = X * cy1 + Z * sy1;
      const Z3 = -X * sy1 + Z * cy1;
      return [cx + X2, cy + Y, cz + Z3];
    };
    const rotN = (x, y, z) => {
      let X = x * cz1 - y * sz1;
      let Y = x * sz1 + y * cz1;
      let Z = z;
      const Y2 = Y * cx1 - Z * sx1;
      const Z2 = Y * sx1 + Z * cx1;
      Y = Y2; Z = Z2;
      return [X * cy1 + Z * sy1, Y, -X * sy1 + Z * cy1];
    };
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const corner = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
      [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
    ].map((p) => rot(p[0], p[1], p[2]));
    // Faces: [corner indices], normal, isTop, isSide
    const faces = [
      { f: [4, 5, 6, 7], n: [0, 1, 0], top: true },
      { f: [1, 0, 3, 2], n: [0, -1, 0] },
      { f: [5, 1, 2, 6], n: [1, 0, 0], side: true },
      { f: [0, 4, 7, 3], n: [-1, 0, 0], side: true },
      { f: [7, 6, 2, 3], n: [0, 0, 1], side: true },
      { f: [0, 1, 5, 4], n: [0, 0, -1], side: true },
    ];
    for (const face of faces) {
      const n = rotN(face.n[0], face.n[1], face.n[2]);
      const c = face.top ? topColor : color;
      const ids = [];
      for (let k = 0; k < 4; k++) {
        let uv = FLAT_UV;
        if (o.facade && face.side) {
          const u = (k === 1 || k === 2) ? Math.max(1, Math.round(sx / 9)) : 0;
          const vv = (k >= 2) ? Math.max(1, Math.round(sy / 11)) : 0;
          uv = [u * 0.24, vv * 0.24];
        }
        const p = corner[face.f[k]];
        ids.push(this.vert(p[0], p[1], p[2], c, n, uv));
      }
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  /** A vertical prism (cylinder with `sides` faces) from y0 up by height h. */
  prism(cx, cz, r, y0, h, sides, color, topColor) {
    const top = topColor || color;
    let prevTop = null;
    let prevBot = null;
    let firstTop = null;
    let firstBot = null;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const n = [Math.sin(a), 0, Math.cos(a)];
      const bot = this.vert(x, y0, z, color, n, FLAT_UV);
      const tp = this.vert(x, y0 + h, z, color, n, FLAT_UV);
      if (s === 0) { firstBot = bot; firstTop = tp; }
      if (prevBot !== null) this.quad(prevBot, bot, tp, prevTop);
      prevBot = bot; prevTop = tp;
    }
    // Top cap as a fan around a centre vertex.
    const centre = this.vert(cx, y0 + h, cz, top, [0, 1, 0], FLAT_UV);
    let prev = null;
    let first = null;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const v = this.vert(x, y0 + h, z, top, [0, 1, 0], FLAT_UV);
      if (s === 0) first = v;
      if (prev !== null) this.tri(centre, prev, v);
      prev = v;
    }
    void first; void firstBot; void firstTop;
  }
}

/** Paint the building facade texture: rows of lit and dark windows. */
function makeFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = rnd();
      g.fillStyle = lit < 0.34 ? '#ffd98a' : (lit < 0.6 ? '#aebfd0' : '#71859c');
      g.fillRect(10 + col * 62, 10 + row * 30, 42, 20);
    }
  }
  // The far corner stays plain white: flat geometry samples there.
  g.fillStyle = '#ffffff';
  g.fillRect(248, 248, 8, 8);
  return canvas;
}

function buildStaticWorld(b) {
  const grass = [0.42, 0.52, 0.34];
  const concrete = [0.62, 0.6, 0.57];
  const asphalt = [0.16, 0.16, 0.19];
  const sand = [0.93, 0.8, 0.55];
  const water = [0.13, 0.45, 0.58];
  // Base ground, sand and sea.
  b.ground(-290, -290, 290, BEACH_Z, 0, grass);
  b.ground(-290, BEACH_Z, 290, WATER_Z + 8, 0.02, sand);
  b.ground(-300, WATER_Z, 300, 345, -0.5, water);
  // Streets: asphalt with concrete kerbs and dashed centre lines.
  for (const sx of STREETS_X) {
    b.ground(sx - ROAD_HALF - 2.5, -288, sx + ROAD_HALF + 2.5, BEACH_Z, 0.03, concrete);
    b.ground(sx - ROAD_HALF, -288, sx + ROAD_HALF, BEACH_Z, 0.06, asphalt);
    for (let z = -280; z < BEACH_Z - 8; z += 14) b.ground(sx - 0.35, z, sx + 0.35, z + 6, 0.09, [0.95, 0.85, 0.4]);
  }
  for (const sz of STREETS_Z) {
    b.ground(-288, sz - ROAD_HALF - 2.5, 288, sz + ROAD_HALF + 2.5, 0.04, concrete);
    b.ground(-288, sz - ROAD_HALF, 288, sz + ROAD_HALF, 0.07, asphalt);
    for (let x = -280; x < 280; x += 14) b.ground(x, sz - 0.35, x + 6, sz + 0.35, 0.1, [0.95, 0.85, 0.4]);
  }
  // The pier: a wooden deck on posts reaching into the water.
  b.box(40, 0.6, 272, 13, 1.2, 82, { color: [0.55, 0.4, 0.26] });
  for (let z = 238; z <= 308; z += 14) {
    b.box(34.5, -0.6, z, 1.1, 2.4, 1.1, { color: [0.4, 0.3, 0.2] });
    b.box(45.5, -0.6, z, 1.1, 2.4, 1.1, { color: [0.4, 0.3, 0.2] });
  }
  // Marina docks and moored boats.
  for (let i = 0; i < 3; i++) {
    b.box(84 + i * 14, 0.3, 224, 3, 0.6, 26, { color: [0.5, 0.38, 0.25] });
    b.box(90 + i * 14, 0.7, 232, 6, 1.1, 11, { color: [0.9, 0.9, 0.88], topColor: [0.7, 0.25, 0.2] });
    b.box(90 + i * 14, 1.6, 230, 3.4, 0.9, 4.5, { color: [0.85, 0.85, 0.9] });
  }
  // Buildings with window facades.
  for (const bd of CITY.buildings) {
    b.box(bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, { color: bd.color, topColor: bd.roof, facade: true });
  }
  // Palms: a leaning trunk and a crown of fronds.
  const trunkC = [0.5, 0.38, 0.24];
  const frondC = [0.2, 0.55, 0.25];
  for (const palm of CITY.palms) {
    b.box(palm.x, 3.4, palm.z, 0.55, 6.8, 0.55, { color: trunkC, rz: palm.lean });
    const topX = palm.x - Math.sin(palm.lean) * 6.6;
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2;
      b.box(topX + Math.sin(a) * 2.2, 7.1, palm.z + Math.cos(a) * 2.2, 0.28, 0.16, 4.6,
        { color: frondC, ry: a, rx: 0.5 });
    }
  }
  // Street lamps.
  for (const lamp of CITY.lamps) {
    b.box(lamp.x, 3, lamp.z, 0.22, 6, 0.22, { color: [0.25, 0.25, 0.3] });
    b.box(lamp.x, 6.1, lamp.z, 0.7, 0.3, 0.7, { color: [1, 0.85, 0.5] });
  }
  // Lighthouse on the eastern point: striped prism, gallery and lamp room.
  const lh = PLACES.lighthouse;
  b.prism(lh.x, lh.z, 6.5, 0, 7, 10, [0.92, 0.92, 0.9]);
  b.prism(lh.x, lh.z, 5.6, 7, 7, 10, [0.85, 0.25, 0.2]);
  b.prism(lh.x, lh.z, 4.8, 14, 7, 10, [0.92, 0.92, 0.9]);
  b.prism(lh.x, lh.z, 6.2, 21, 1.2, 10, [0.3, 0.3, 0.35]);
  b.prism(lh.x, lh.z, 3.4, 22.2, 4, 8, [0.25, 0.28, 0.35]);
  b.box(lh.x, 24.2, lh.z, 3.4, 2.2, 3.4, { color: [1, 0.9, 0.55] });
  b.prism(lh.x, lh.z, 4.2, 26.2, 2, 8, [0.7, 0.2, 0.18]);
  // Ferris wheel supports on the boardwalk (the wheel itself is dynamic).
  const fw = PLACES.boardwalk;
  b.box(fw.x - 8, 11, fw.z, 1.2, 24, 1.2, { color: [0.75, 0.3, 0.4], rz: 0.32 });
  b.box(fw.x + 8, 11, fw.z, 1.2, 24, 1.2, { color: [0.75, 0.3, 0.4], rz: -0.32 });
  // Beach umbrellas.
  const umbCols = [[0.9, 0.3, 0.3], [0.3, 0.6, 0.9], [0.95, 0.8, 0.25], [0.9, 0.5, 0.8]];
  for (let i = 0; i < 14; i++) {
    const ux = -240 + i * 37;
    const uz = 212 + (i % 3) * 9;
    b.box(ux, 1.1, uz, 0.16, 2.2, 0.16, { color: [0.9, 0.9, 0.9] });
    b.prism(ux, uz, 2.6, 2.1, 0.7, 7, umbCols[i % umbCols.length]);
  }
}

function drawCar(b, car, time) {
  const s = Math.sin(car.heading);
  const c = Math.cos(car.heading);
  const at = (lx, lz) => [car.x + lx * c + lz * s, car.z - lx * s + lz * c];
  // Soft blob shadow.
  b.ground(car.x - 2.6, car.z - 1.5, car.x + 2.6, car.z + 1.5, 0.12, [0.1, 0.1, 0.1]);
  const body = car.police ? [0.92, 0.92, 0.94] : car.color;
  b.box(car.x, 0.62, car.z, 2.0, 0.72, 4.5, { color: body, ry: car.heading });
  b.box(car.x, 1.2, car.z, 1.8, 0.55, 2.3, { color: [0.16, 0.2, 0.28], ry: car.heading });
  if (car.police) {
    b.box(car.x, 0.64, car.z, 2.04, 0.4, 4.54, { color: [0.12, 0.12, 0.16], ry: car.heading });
    const flash = Math.floor(time * 3) % 2 === 0;
    b.box(car.x, 1.58, car.z, 1.2, 0.22, 0.7, { color: [0.3, 0.3, 0.35], ry: car.heading });
    const offL = at(-0.32, 0);
    const offR = at(0.32, 0);
    b.box(offL[0], 1.6, offL[1], 0.5, 0.26, 0.6, { color: flash ? [1, 0.15, 0.1] : [0.4, 0.05, 0.05], ry: car.heading });
    b.box(offR[0], 1.6, offR[1], 0.5, 0.26, 0.6, { color: flash ? [0.1, 0.2, 0.5] : [0.15, 0.3, 1], ry: car.heading });
  }
  // Headlights and tail lights.
  const fl = at(-0.7, 2.26); const fr = at(0.7, 2.26);
  const rl = at(-0.7, -2.26); const rr = at(0.7, -2.26);
  b.box(fl[0], 0.66, fl[1], 0.42, 0.2, 0.1, { color: [1, 0.95, 0.7], ry: car.heading });
  b.box(fr[0], 0.66, fr[1], 0.42, 0.2, 0.1, { color: [1, 0.95, 0.7], ry: car.heading });
  b.box(rl[0], 0.7, rl[1], 0.42, 0.18, 0.1, { color: [0.9, 0.15, 0.1], ry: car.heading });
  b.box(rr[0], 0.7, rr[1], 0.42, 0.18, 0.1, { color: [0.9, 0.15, 0.1], ry: car.heading });
  // Wheels.
  const spin = car.wheelSpin || 0;
  const wpos = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]];
  for (const w of wpos) {
    const p = at(w[0], w[1]);
    b.box(p[0], 0.36, p[1], 0.3, 0.72, 0.72, { color: [0.08, 0.08, 0.1], ry: car.heading, rx: spin });
  }
  void s; void c;
}

function drawPerson(b, person, time) {
  const swing = Math.sin(person.walkPhase || 0) * (person.moving ? 0.5 : 0.05);
  const x = person.x, z = person.z;
  b.ground(x - 0.55, z - 0.55, x + 0.55, z + 0.55, 0.11, [0.12, 0.12, 0.12]);
  const shirt = person.shirt;
  const pants = person.pants || [0.25, 0.25, 0.3];
  const skin = person.skin || [0.85, 0.65, 0.5];
  const ry = person.heading;
  const legSwing = swing * 0.7;
  b.box(x, 0.45, z, 0.34, 0.9, 0.4, { color: pants, ry, rx: legSwing });
  b.box(x, 0.45, z, 0.34, 0.9, 0.4, { color: pants, ry, rx: -legSwing });
  b.box(x, 1.28, z, 0.62, 0.78, 0.4, { color: shirt, ry });
  b.box(x, 1.3, z, 0.2, 0.7, 0.24, { color: shirt, ry, rx: -swing * 0.6 });
  b.box(x, 1.3, z, 0.2, 0.7, 0.24, { color: shirt, ry, rx: swing * 0.6 });
  b.box(x, 1.86, z, 0.42, 0.44, 0.42, { color: skin, ry });
  if (person.officer) {
    b.box(x, 2.12, z, 0.5, 0.12, 0.5, { color: [0.1, 0.15, 0.4], ry });
  }
  if (person.down) {
    // Knocked down: draw the body low and flat instead.
  }
  void time;
}

function buildDynamicWorld(b, state) {
  const time = state.time;
  // Mission marker: a tall golden beacon plus a pulsing ground ring.
  if (state.marker) {
    const m = state.marker;
    b.prism(m.x, m.z, 2.6, 0.2, 55, 8, [1, 0.78, 0.2]);
    const r = 4 + Math.sin(time * 4) * 0.7;
    b.ground(m.x - r, m.z - 0.4, m.x + r, m.z + 0.4, 0.16, [1, 0.8, 0.25]);
    b.ground(m.x - 0.4, m.z - r, m.x + 0.4, m.z + r, 0.16, [1, 0.8, 0.25]);
  }
  // Race checkpoints still to hit: cyan pillars.
  if (state.checkpoints) {
    for (let i = 0; i < state.checkpoints.length; i++) {
      const p = state.checkpoints[i];
      if (p.done) continue;
      b.prism(p.x, p.z, 1.8, 0.2, 26, 6, i === state.checkpointNext ? [0.3, 0.95, 1] : [0.25, 0.5, 0.6]);
    }
  }
  // Hidden packages: small spinning gold cases.
  for (const pack of CITY.packages) {
    if (pack.taken) continue;
    const bob = 1 + Math.sin(time * 2.4 + pack.id) * 0.25;
    b.box(pack.x, bob, pack.z, 0.9, 0.6, 0.9, { color: [1, 0.75, 0.15], ry: time * 1.8 + pack.id });
  }
  // Pickups.
  for (const item of state.pickups) {
    if (!item.active) continue;
    const bob = 0.9 + Math.sin(time * 3 + item.id * 2) * 0.15;
    if (item.kind === 'ammo') {
      b.box(item.x, bob, item.z, 0.8, 0.5, 0.8, { color: [0.25, 0.55, 0.25], ry: time * 2 });
    } else {
      b.box(item.x, bob, item.z, 0.85, 0.55, 0.85, { color: [0.95, 0.95, 0.95], ry: time * 2 });
      b.box(item.x, bob + 0.3, item.z, 0.6, 0.06, 0.2, { color: [0.9, 0.15, 0.15] });
      b.box(item.x, bob + 0.3, item.z, 0.2, 0.06, 0.6, { color: [0.9, 0.15, 0.15] });
    }
  }
  // Ferris wheel: rim segments and cabins turning slowly over the boardwalk.
  const fw = PLACES.boardwalk;
  const wheelA = time * 0.18;
  const R = 21;
  for (let i = 0; i < 12; i++) {
    const a = wheelA + (i / 12) * Math.PI * 2;
    const x = fw.x + Math.cos(a) * R;
    const y = 24 + Math.sin(a) * R;
    b.box(x, y, fw.z, 3.2, 0.7, 0.7, { color: [0.95, 0.6, 0.3], rz: a + Math.PI / 2 });
    if (i % 2 === 0) {
      b.box(x, y - 2.4, fw.z, 2.4, 2.2, 2, { color: [0.85, 0.3, 0.45] });
    }
  }
  b.prism(fw.x, fw.z, 1.6, 22.4, 3, 8, [0.9, 0.85, 0.6]);
  // Cars, people, then the player.
  for (const car of state.cars) drawCar(b, car, time);
  for (const ped of state.peds) if (!ped.down) drawPerson(b, ped, time);
  for (const cop of state.cops) if (!cop.down) drawPerson(b, cop, time);
  if (state.player.mode === 'foot') drawPerson(b, state.player, time);
  // Muzzle flash.
  if (state.fx.flash > 0) {
    const p = state.player;
    const fx = p.x + Math.sin(p.heading) * 1.2;
    const fz = p.z + Math.cos(p.heading) * 1.2;
    b.box(fx, 1.35, fz, 0.7, 0.7, 0.7, { color: [1, 0.85, 0.3], ry: time * 30 });
  }
  // Downed people are drawn lying flat.
  for (const ped of state.peds) {
    if (!ped.down) continue;
    b.box(ped.x, 0.25, ped.z, 0.6, 0.35, 1.8, { color: ped.shirt, ry: ped.heading });
  }
  for (const cop of state.cops) {
    if (!cop.down) continue;
    b.box(cop.x, 0.25, cop.z, 0.6, 0.35, 1.8, { color: cop.shirt, ry: cop.heading });
  }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
  if (!gl) throw new Error('WebGL is not available in this browser.');
  gl.getExtension('OES_element_index_uint');

  function compile(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader failed: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(program);
  gl.useProgram(program);

  const loc = {
    pos: gl.getAttribLocation(program, 'aPos'),
    col: gl.getAttribLocation(program, 'aCol'),
    nor: gl.getAttribLocation(program, 'aNor'),
    uv: gl.getAttribLocation(program, 'aUv'),
    mvp: gl.getUniformLocation(program, 'uMVP'),
    view: gl.getUniformLocation(program, 'uView'),
    tex: gl.getUniformLocation(program, 'uTex'),
    sun: gl.getUniformLocation(program, 'uSun'),
    fogColor: gl.getUniformLocation(program, 'uFogColor'),
    fogNear: gl.getUniformLocation(program, 'uFogNear'),
    fogFar: gl.getUniformLocation(program, 'uFogFar'),
    flat: gl.getUniformLocation(program, 'uFlat'),
  };

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeFacadeTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  function makeBuffer(builder, dynamic) {
    const buffers = {};
    const usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    const bind = (name, array, size) => {
      buffers[name] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name]);
      gl.bufferData(gl.ARRAY_BUFFER, array, usage);
    };
    bind('pos', builder.pos, 3);
    bind('col', builder.col, 3);
    bind('nor', builder.nor, 3);
    bind('uv', builder.uv, 2);
    buffers.idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, builder.idx, usage);
    return buffers;
  }
  function upload(builder, buffers) {
    const sub = (name, array) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, array);
    };
    sub('pos', builder.pos);
    sub('col', builder.col);
    sub('nor', builder.nor);
    sub('uv', builder.uv);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.idx);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, builder.idx);
  }
  function drawBuffers(buffers, count) {
    const bindAttr = (buffer, location, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    bindAttr(buffers.pos, loc.pos, 3);
    bindAttr(buffers.col, loc.col, 3);
    bindAttr(buffers.nor, loc.nor, 3);
    bindAttr(buffers.uv, loc.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.idx);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
  }

  const staticBuilder = new GeoBuilder(260000);
  buildStaticWorld(staticBuilder);
  const staticBuffers = makeBuffer(staticBuilder, false);
  const staticCount = staticBuilder.i;

  const dynBuilder = new GeoBuilder(60000);
  const dynBuffers = makeBuffer(dynBuilder, true);

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * ratio);
    const h = Math.round(window.innerHeight * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    /** Paint one frame of the world from the given camera {x,y,z,tx,ty,tz}. */
    draw(state, camera) {
      resize();
      const proj = matPerspective(1.12, canvas.width / Math.max(1, canvas.height), 0.1, 950);
      const view = matLookAt(
        [camera.x, camera.y, camera.z],
        [camera.tx, camera.ty, camera.tz],
        [0, 1, 0],
      );
      const mvp = matMultiply(proj, view);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(loc.mvp, false, mvp);
      gl.uniformMatrix4fv(loc.view, false, view);
      gl.uniform1i(loc.tex, 0);
      gl.uniform3f(loc.sun, 0.55, 0.62, 0.45);
      gl.uniform3f(loc.fogColor, 0.99, 0.62, 0.4);
      gl.uniform1f(loc.fogNear, 130);
      gl.uniform1f(loc.fogFar, 460);
      gl.uniform1f(loc.flat, 0);
      drawBuffers(staticBuffers, staticCount);
      dynBuilder.reset();
      buildDynamicWorld(dynBuilder, state);
      upload(dynBuilder, dynBuffers);
      // The beacon and flashes read better unlit: draw dynamic geometry flat-lit.
      gl.uniform1f(loc.flat, 0.25);
      drawBuffers(dynBuffers, dynBuilder.i);
    },
  };
}
