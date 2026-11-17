import { EF } from './effort.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import * as M from './model.js';
import * as SH from './shaders.js';

const { clamp } = M;
const $ = (s) => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- noise (CPU)
function hash2(x, y) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v); }
function fbm(x, y, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f + i * 17.3, y * f + i * 9.1); f *= 2.03; a *= 0.5; } return s; }

// ---------- renderer
const canvas = $('#c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#nogl').style.display = 'grid';
  throw e;
}
const SMALL = Math.min(innerWidth, innerHeight) < 600;
renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 2000);
const outside = new THREE.Scene();
const inside = new THREE.Scene();
let active = outside;

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(outside, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.rotateSpeed = 0.6;

// ======================================================================
// OUTSIDE SCENE: terrain, cross-section, sea
// ======================================================================
const RM = 70, DEPTH = 52, CHY = -9;
const NX = 240, NZ = 110;
const mapS = (s) => RM * (0.25 * s + 0.75 * s * s * s);
const xs = new Float32Array(NX + 1);
for (let i = 0; i <= NX; i++) xs[i] = mapS(i / NX * 2 - 1);

const PROF = {
  young: (r) => 3.0 * Math.exp(-(r * r) / 49),
  shield: (r) => {
    const R = 40, H = 7.5, f = (q) => (q >= R ? 0 : H * Math.pow(Math.cos((Math.PI / 2) * q / R), 1.25));
    const rc = 2.6; return r < rc ? f(rc) - 0.8 * (1 - (r / rc) ** 2) : f(r);
  },
  comp: (r) => {
    const R = 24, H = 13, k = 3, e = Math.exp(-k);
    const f = (q) => (q >= R ? 0 : (H * (Math.exp(-k * q / R) - e)) / (1 - e));
    const rc = 1.6; return r < rc ? f(rc) - 1.5 * (1 - (r / rc) ** 2) : f(r);
  },
  cinder: (r) => {
    const R = 8, H = 4.8, f = (q) => (q >= R ? 0 : H * (1 - q / R));
    const rc = 1.9; return r < rc ? f(rc) - 1.4 * (1 - (r / rc) ** 2) : f(r);
  },
};
const SHAPES = { young: [1, 0, 0, 0], shield: [0, 1, 0, 0], composite: [0, 0, 1, 0], cinder: [0, 0, 0, 1] };
const Wt = [1, 0, 0, 0];       // current weights
const Wtarget = [1, 0, 0, 0];
let terrainDirty = true;
let ocean = 'right';

function hB(r) { return Wt[0] * PROF.young(r) + Wt[1] * PROF.shield(r) + Wt[2] * PROF.comp(r) + Wt[3] * PROF.cinder(r); }
function craterR() { return Wt[0] * 0.6 + Wt[1] * 2.6 + Wt[2] * 1.6 + Wt[3] * 1.9; }
function baseT(x, z) {
  const r = Math.hypot(x, z);
  if (ocean === 'all') return -3.4 + (fbm(x * 0.05 + 3, z * 0.05 + 1) - 0.45) * 0.8;
  const hills = Math.max((fbm(x * 0.035 + 11, z * 0.035 + 7) - 0.42) * 3.6 * smooth(24, 54, r), -0.25) + 0.15;
  if (ocean === 'right') return lerp(hills, -3.1 + (fbm(x * 0.06, z * 0.06) - 0.45) * 0.6, smooth(36, 48, x));
  return hills;
}
function groundAt(x, z) { return hB(Math.hypot(x, z)) + baseT(x, z); }

// surface mesh
const surfGeo = new THREE.BufferGeometry();
const SV = (NX + 1) * (NZ + 1);
const sPos = new Float32Array(SV * 3), sCol = new Float32Array(SV * 3);
const sR = new Float32Array(SV), sTh = new Float32Array(SV), sDet = new Float32Array(SV), sGul = new Float32Array(SV), sFz = new Float32Array(SV), sTone = new Float32Array(SV), sBase = new Float32Array(SV);
for (let j = 0; j <= NZ; j++) {
  const z = -mapS(j / NZ);
  for (let i = 0; i <= NX; i++) {
    const k = j * (NX + 1) + i, x = xs[i];
    sPos[k * 3] = x; sPos[k * 3 + 2] = z;
    sR[k] = Math.hypot(x, z); sTh[k] = Math.atan2(z, x);
    sDet[k] = (fbm(x * 0.45 + 5, z * 0.45 + 2) - 0.45) * 0.55;
    sGul[k] = Math.sin(sTh[k] * 26 + fbm(x * 0.2, z * 0.2) * 6);
    sFz[k] = smooth(0, 3, -z);
    sTone[k] = fbm(x * 0.08 + 40, z * 0.08 + 9);
  }
}
const sIdx = [];
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
  sIdx.push(a, b, c, b, d, c);
}
surfGeo.setIndex(sIdx);
surfGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
surfGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
const surface = new THREE.Mesh(surfGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
outside.add(surface);

// cross-section face
const NY = 90;
const fPos = new Float32Array((NX + 1) * (NY + 1) * 3), fTop = new Float32Array((NX + 1) * (NY + 1)), fBase = new Float32Array((NX + 1) * (NY + 1));
const fIdx = [];
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
  fIdx.push(a, b, c, b, d, c);
}
const faceGeo = new THREE.BufferGeometry();
faceGeo.setIndex(fIdx);
faceGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
faceGeo.setAttribute('aTop', new THREE.BufferAttribute(fTop, 1));
faceGeo.setAttribute('aBase', new THREE.BufferAttribute(fBase, 1));
const secU = {
  uTime: { value: 0 }, uSetting: { value: 1 }, uConduit: { value: 0 }, uChY: { value: CHY }, uFeed: { value: 1 },
  uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uMagma: { value: new THREE.Color(3, 1.2, 0.3) }, uPulse: { value: 0 },
};
const face = new THREE.Mesh(faceGeo, new THREE.ShaderMaterial({ uniforms: secU, vertexShader: SH.sectionVert, fragmentShader: SH.sectionFrag, side: THREE.DoubleSide }));
outside.add(face);

// water cross-section strip and sea surface
const wPos = new Float32Array((NX + 1) * 2 * 3);
const wIdx = [];
for (let i = 0; i < NX; i++) { const a = i, b = i + 1, c = i + NX + 1, d = c + 1; wIdx.push(a, b, c, b, d, c); }
const waterGeo = new THREE.BufferGeometry();
waterGeo.setIndex(wIdx);
waterGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
const waterSec = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.22, 0.34), transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }));
waterSec.position.z = 0.04;
outside.add(waterSec);
const seaGeo = new THREE.PlaneGeometry(1, RM, 1, 1); seaGeo.rotateX(-Math.PI / 2); seaGeo.translate(0, 0, -RM / 2);
const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ color: 0x0e3550, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.84 }));
outside.add(sea);

function setOcean(o) {
  ocean = o;
  if (o === 'all') { sea.scale.x = 2 * RM; sea.position.x = 0; sea.visible = true; }
  else if (o === 'right') { sea.scale.x = 32; sea.position.x = 54; sea.visible = true; }
  else sea.visible = false;
  for (let k = 0; k < SV; k++) sBase[k] = baseT(sPos[k * 3], sPos[k * 3 + 2]);
  terrainDirty = true;
}

const tmpC = new THREE.Color();
function lin(v) { return Math.pow(v, 2.2); }
function updateTerrain() {
  const wy = Wt[0], ws = Wt[1], wc = Wt[2], wk = Wt[3];
  for (let k = 0; k < SV; k++) {
    const r = sR[k], h = hB(r), base = sBase[k];
    const vol = clamp(h / 3, 0, 1);
    const det = sFz[k] * (sDet[k] * (0.45 + 0.55 * vol) + sGul[k] * 0.13 * wc * vol * smooth(1.6, 4, r));
    const y = h + base + det;
    sPos[k * 3 + 1] = y;
    // colour
    let cr, cg, cb;
    const t = sTone[k];
    if (base < -0.4 && y < -0.05) { cr = 0.30 + 0.06 * t; cg = 0.30 + 0.05 * t; cb = 0.26; }
    else { cr = lerp(0.30, 0.42, t); cg = lerp(0.34, 0.33, t); cb = lerp(0.18, 0.22, t); }
    const rr = wy * 0.32 + ws * 0.17 + wc * 0.38 + wk * 0.27;
    const rg = wy * 0.28 + ws * 0.15 + wc * 0.33 + wk * 0.12;
    const rb = wy * 0.24 + ws * 0.14 + wc * 0.30 + wk * 0.09;
    const vv = smooth(0.15, 1.2, h);
    cr = lerp(cr, rr * (0.85 + 0.3 * t), vv); cg = lerp(cg, rg * (0.85 + 0.3 * t), vv); cb = lerp(cb, rb * (0.85 + 0.3 * t), vv);
    const snow = smooth(9.6, 11.5, y) * wc;
    cr = lerp(cr, 0.88, snow); cg = lerp(cg, 0.89, snow); cb = lerp(cb, 0.92, snow);
    const scorch = (1 - smooth(0, 4.5, r)) * 0.6;
    cr = lerp(cr, 0.30, scorch); cg = lerp(cg, 0.10, scorch); cb = lerp(cb, 0.07, scorch);
    sCol[k * 3] = lin(cr); sCol[k * 3 + 1] = lin(cg); sCol[k * 3 + 2] = lin(cb);
  }
  surfGeo.attributes.position.needsUpdate = true;
  surfGeo.attributes.color.needsUpdate = true;
  surfGeo.computeVertexNormals();
  // face
  for (let i = 0; i <= NX; i++) {
    const x = xs[i], base = baseT(x, 0), top = hB(Math.abs(x)) + base;
    for (let j = 0; j <= NY; j++) {
      const k = j * (NX + 1) + i, v = j / NY;
      fPos[k * 3] = x; fPos[k * 3 + 1] = -DEPTH + v * (top + DEPTH); fPos[k * 3 + 2] = 0;
      fTop[k] = top; fBase[k] = base;
    }
    const wet = top < 0 && (ocean === 'all' || (ocean === 'right' && x > 30));
    const k2 = i + NX + 1;
    wPos[i * 3] = x; wPos[i * 3 + 1] = top; wPos[i * 3 + 2] = 0;
    wPos[k2 * 3] = x; wPos[k2 * 3 + 1] = wet ? 0 : top; wPos[k2 * 3 + 2] = 0;
  }
  faceGeo.attributes.position.needsUpdate = true; faceGeo.attributes.aTop.needsUpdate = true; faceGeo.attributes.aBase.needsUpdate = true;
  faceGeo.computeBoundingSphere();
  waterGeo.attributes.position.needsUpdate = true; waterGeo.computeBoundingSphere();
  waterSec.visible = ocean !== 'none';
  secU.uW.value.set(wy, ws, wc, wk);
  // dome sits in the crater
  dome.position.y = groundAt(0, -0.001) - 0.2;
  terrainDirty = false;
}

// sky, lights, fog
const skyU = { uAsh: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SH.skyVert, fragmentShader: SH.skyFrag, side: THREE.BackSide, depthWrite: false }));
outside.add(sky);
outside.fog = new THREE.Fog(new THREE.Color(0.62, 0.42, 0.36), 260, 900);
const hemi = new THREE.HemisphereLight(0xc8d6ff, 0x3a2418, 1.15); outside.add(hemi);
const sun = new THREE.DirectionalLight(0xffcf9e, 2.6); sun.position.set(-40, 55, 45); outside.add(sun);
const vent = new THREE.PointLight(0xff7a2a, 0, 90, 1.4); outside.add(vent);

// lava dome
const domeU = { uTime: { value: 0 }, uMagma: secU.uMagma };
const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, Math.PI, Math.PI, 0, Math.PI / 2), new THREE.ShaderMaterial({ uniforms: domeU, vertexShader: SH.domeVert, fragmentShader: SH.domeFrag, side: THREE.DoubleSide }));
dome.scale.set(0.001, 0.001, 0.001); dome.visible = false;
outside.add(dome);

// lightning bolt
const boltGeo = new THREE.BufferGeometry(); const boltPos = new Float32Array(16 * 3);
boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 6, 9) }));
bolt.visible = false; bolt.frustumCulled = false; outside.add(bolt);
let boltT = 0;
function fireBolt(cx, cy, cz) {
  let x = cx + rand(-4, 4), y = cy + rand(4, 8), z = cz + rand(-3, 3);
  for (let i = 0; i < 16; i++) { boltPos[i * 3] = x; boltPos[i * 3 + 1] = y; boltPos[i * 3 + 2] = z; x += rand(-1.2, 1.2); y -= rand(0.6, 1.4); z += rand(-0.8, 0.8); }
  boltGeo.attributes.position.needsUpdate = true; bolt.visible = true; boltT = 0.13;
}

// ======================================================================
// PARTICLES
// ======================================================================
class Pool {
  constructor(n, frag, blending) {
    this.n = n; this.ptr = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.type = new Uint8Array(n);
    this.a = new Float32Array(n); this.b = new Float32Array(n); this.s0 = new Float32Array(n); this.seed = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 600 } }, vertexShader: SH.pointVert, fragmentShader: frag, transparent: true, depthWrite: false, blending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false;
  }
  spawn(type, x, y, z, vx, vy, vz, life, size) {
    const i = this.ptr; this.ptr = (this.ptr + 1) % this.n;
    this.type[i] = type; this.life[i] = 0; this.max[i] = life; this.s0[i] = size; this.seed[i] = Math.random();
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.alpha[i] = 0;
    return i;
  }
  clear() { this.type.fill(0); this.alpha.fill(0); this.flush(); }
  flush() { const a = this.geo.attributes; a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true; }
}
const SCALE = SMALL ? 0.6 : 1;
const glow = new Pool(Math.round(5200 * SCALE), SH.glowFrag, THREE.AdditiveBlending);
const ash = new Pool(Math.round(2600 * SCALE), SH.ashFrag, THREE.NormalBlending);
outside.add(ash.pts); outside.add(glow.pts);

const G_FOUNT = 1, G_FLOW = 2, G_CINDER = 3, G_SPARK = 4, G_BLOCK = 5, G_PGLOW = 6;
const A_COL = 1, A_PYRO = 2, A_PUFF = 3;

function heatColor(t, out, i) { // t: 0 hot -> 1 cold
  const r = t < 0.5 ? lerp(2.4, 0.9, t * 2) : lerp(0.9, 0.1, (t - 0.5) * 2);
  const g = t < 0.5 ? lerp(0.95, 0.12, t * 2) : lerp(0.12, 0.02, (t - 0.5) * 2);
  const b = t < 0.5 ? lerp(0.22, 0.03, t * 2) : lerp(0.03, 0.01, (t - 0.5) * 2);
  out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
}

function updateGlow(dt) {
  const p = glow;
  for (let i = 0; i < p.n; i++) {
    const ty = p.type[i]; if (!ty) continue;
    p.life[i] += dt; const t = p.life[i] / p.max[i];
    if (t >= 1) { p.type[i] = 0; p.alpha[i] = 0; continue; }
    const i3 = i * 3;
    if (ty === G_FOUNT || ty === G_SPARK || ty === G_BLOCK) {
      const g = ty === G_SPARK ? 4 : 9.8 * 0.8;
      p.vel[i3 + 1] -= g * dt;
      p.pos[i3] += p.vel[i3] * dt; p.pos[i3 + 1] += p.vel[i3 + 1] * dt; p.pos[i3 + 2] += p.vel[i3 + 2] * dt;
      heatColor(ty === G_SPARK ? t * 0.6 : t * 0.5, p.col, i);
      p.alpha[i] = ty === G_SPARK ? 1 - t : 1;
      const x = p.pos[i3], z = p.pos[i3 + 2], y = p.pos[i3 + 1];
      if (p.vel[i3 + 1] < 0) {
        if (z > 0.2) { if (y < -3) { p.type[i] = 0; p.alpha[i] = 0; } continue; }
        const gy = groundAt(x, z);
        if (y < gy + 0.15) {
          if (ty === G_SPARK) { p.type[i] = 0; p.alpha[i] = 0; continue; }
          if (E.key === 'hawaiian' && gy > 0.1) {
            p.type[i] = G_FLOW; p.a[i] = Math.hypot(x, z); p.b[i] = Math.atan2(z, x); p.life[i] = 0; p.max[i] = rand(7, 11);
          } else {
            p.type[i] = G_CINDER; p.life[i] = 0; p.max[i] = rand(3, 6); p.pos[i3 + 1] = gy + 0.12;
          }
        }
      }
    } else if (ty === G_FLOW || ty === G_PGLOW) {
      const r0 = p.a[i], th = p.b[i];
      const h1 = hB(r0), h2 = hB(r0 + 0.4);
      const slope = clamp(Math.abs(h1 - h2) / 0.4 * 1.2 + 0.7, 0.7, 1.8);
      const sp = ty === G_PGLOW ? (8 + p.seed[i] * 5) * (1 - t * 0.6) : (2.4 + p.seed[i] * 1.8) * (1 - t * 0.7) * slope;
      p.a[i] = r0 + sp * dt;
      const x = p.a[i] * Math.cos(th), z = p.a[i] * Math.sin(th);
      const gy = groundAt(x, z);
      p.pos[i3] = x; p.pos[i3 + 2] = z; p.pos[i3 + 1] = gy + (ty === G_PGLOW ? 0.7 : 0.22);
      if (ty === G_FLOW) {
        heatColor(Math.min(1, t * 0.85), p.col, i);
        p.alpha[i] = Math.min(1, p.life[i] * 4) * (1 - smooth(0.85, 1, t));
        if (gy < -0.05 && ocean !== 'none') { // lava meets the sea
          if (Math.random() < 0.08) { ash.spawn(A_PUFF, x, 0.3, z, rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(2.5, 4), rand(2, 3.5)); setPuffColor(0.85, 0.85, 0.88, 0.5); }
          p.type[i] = 0; p.alpha[i] = 0;
        }
      } else {
        heatColor(0.15 + t * 0.6, p.col, i); p.alpha[i] = 0.45 * (1 - t);
      }
    } else if (ty === G_CINDER) {
      heatColor(0.35 + t * 0.65, p.col, i);
      p.alpha[i] = 1 - smooth(0.7, 1, t);
    }
  }
  glow.flush();
}
let lastPuff = -1;
function setPuffColor(r, g, b, a) { const i = (ash.ptr - 1 + ash.n) % ash.n; ash.base[i * 3] = r; ash.base[i * 3 + 1] = g; ash.base[i * 3 + 2] = b; ash.a[i] = a; lastPuff = i; return true; }

function updateAsh(dt) {
  const p = ash;
  for (let i = 0; i < p.n; i++) {
    const ty = p.type[i]; if (!ty) continue;
    p.life[i] += dt; const t = p.life[i] / p.max[i];
    if (t >= 1) { p.type[i] = 0; p.alpha[i] = 0; continue; }
    const i3 = i * 3;
    if (ty === A_COL) {
      const y = p.pos[i3 + 1];
      const top = 27 + p.seed[i] * 11;
      if (y < top) {
        p.vel[i3 + 1] = 16 * Math.exp(-Math.max(0, y - 10) / 14) + 1.5;
        p.vel[i3] += (Math.random() - 0.5) * 3 * dt + p.pos[i3] * 0.02 * dt; p.vel[i3 + 2] += (Math.random() - 0.5) * 3 * dt;
      } else {
        p.vel[i3 + 1] *= 0.92;
        const dx = p.pos[i3], dz = p.pos[i3 + 2] + 4, d = Math.hypot(dx, dz) + 0.01;
        p.vel[i3] += (dx / d) * 4.5 * dt + 0.8 * dt; p.vel[i3 + 2] += (dz / d) * 4.5 * dt;
      }
      p.pos[i3] += p.vel[i3] * dt; p.pos[i3 + 1] += p.vel[i3 + 1] * dt; p.pos[i3 + 2] += p.vel[i3 + 2] * dt;
      p.size[i] = Math.min(p.s0[i] * (1 + p.life[i] * 0.8), 30);
      const lt = clamp((p.pos[i3 + 1] - 6) / 28, 0, 1);
      const c = lerp(0.11, 0.42, lt) * (0.85 + 0.3 * p.seed[i]);
      p.col[i3] = c * 1.02; p.col[i3 + 1] = c * 0.96; p.col[i3 + 2] = c * 0.92;
      p.alpha[i] = Math.min(1, p.life[i] * 2) * (1 - smooth(0.65, 1, t)) * 0.72;
    } else if (ty === A_PYRO) {
      const th = p.b[i];
      p.a[i] += (9 + p.seed[i] * 5) * (1 - t * 0.55) * dt;
      const x = p.a[i] * Math.cos(th), z = p.a[i] * Math.sin(th);
      p.pos[i3] = x; p.pos[i3 + 2] = z; p.pos[i3 + 1] = groundAt(x, z) + 0.9 + p.life[i] * 0.9;
      p.size[i] = p.s0[i] * (1 + p.life[i] * 0.7);
      p.col[i3] = 0.42; p.col[i3 + 1] = 0.36; p.col[i3 + 2] = 0.31;
      p.alpha[i] = Math.min(1, p.life[i] * 3) * (1 - smooth(0.55, 1, t)) * 0.7;
    } else if (ty === A_PUFF) {
      p.vel[i3] *= 1 - 0.9 * dt; p.vel[i3 + 2] *= 1 - 0.9 * dt; p.vel[i3 + 1] = p.vel[i3 + 1] * (1 - 0.6 * dt) + 0.8 * dt;
      p.pos[i3] += (p.vel[i3] + 0.4) * dt; p.pos[i3 + 1] += p.vel[i3 + 1] * dt; p.pos[i3 + 2] += p.vel[i3 + 2] * dt;
      p.size[i] = p.s0[i] * (1 + p.life[i] * 0.9);
      p.col[i3] = p.base[i3]; p.col[i3 + 1] = p.base[i3 + 1]; p.col[i3 + 2] = p.base[i3 + 2];
      p.alpha[i] = Math.min(1, p.life[i] * 3) * (1 - smooth(0.5, 1, t)) * (p.a[i] || 0.6);
    }
  }
  ash.flush();
}

// ======================================================================
// ERUPTION CONTROLLER
// ======================================================================
const E = { key: null, t: 0, acc: 0, acc2: 0, acc3: 0, next: 0, nextBolt: 0, chans: [], shake: 0, level: 0 };
function backTheta() { return rand(Math.PI + 0.18, 2 * Math.PI - 0.18); }
function sideTheta() { return Math.random() < 0.5 ? rand(Math.PI + 0.15, Math.PI + 1.15) : rand(2 * Math.PI - 1.15, 2 * Math.PI - 0.15); }
function ventY() { return groundAt(0, -0.001) + 0.1; }
function emit(rate, dt, key) { E[key] += rate * dt; const n = Math.floor(E[key]); E[key] -= n; return n; }

function startEruption(key, quiet, shape) {
  E.key = key; E.quiet = !!quiet; E.t = 0; E.acc = E.acc2 = E.acc3 = 0; E.next = 0.9; E.nextBolt = 3;
  E.chans = []; for (let i = 0; i < 6; i++) E.chans.push(sideTheta());
  const sh = SHAPES[shape || M.OUTCOMES[key].shape]; for (let i = 0; i < 4; i++) Wtarget[i] = sh[i];
  dome.visible = !!M.OUTCOMES[key].dome; dome.scale.set(0.001, 0.001, 0.001);
  if (!quiet) audio.blast(key === 'plinian' ? 1 : key === 'vulcanian' || key === 'strombolian' ? 0.6 : 0.35);
}
function ambient() {
  if (E.key && E.quiet) return;
  if (E.key) stopEruption();
  setOcean('right'); secU.uSetting.value = 1;
  for (let k = 0; k < 4; k++) Wt[k] = Wtarget[k] = SHAPES.composite[k];
  terrainDirty = true; updateTerrain();
  secU.uMagma.value.copy(magmaColor(1080));
  startEruption('strombolian', true, 'composite');
}
function stopEruption() {
  E.key = null; E.quiet = false; glow.clear(); ash.clear(); vent.intensity = 0; skyU.uAsh.value = 0; secU.uConduit.value = 0; dome.visible = false; bolt.visible = false;
  for (let i = 0; i < 4; i++) Wtarget[i] = Wt[i] = SHAPES.young[i];
  terrainDirty = true; audio.rumble(0);
}

function stepEruption(dt) {
  if (!E.key) return;
  E.t += dt; const t = E.t;
  const I = smooth(0.6, 2.4, t) * (t > 16 ? 0.5 : 1);
  secU.uConduit.value = smooth(0, 1.8, t);
  const vy0 = ventY();
  const k = E.key;
  let light = 0;
  E.shake = 0;
  if (k === 'hawaiian') {
    for (let n = emit(30 * I * SCALE, dt, 'acc'); n > 0; n--) {
      const th = backTheta(), sp = rand(0.4, 1.6);
      glow.spawn(G_FOUNT, rand(-0.4, 0.4), vy0, rand(-0.6, 0), Math.cos(th) * sp, rand(4, 8.5), Math.sin(th) * sp * 0.8, 4, rand(0.5, 0.9));
    }
    for (let n = emit(150 * I * SCALE, dt, 'acc2'); n > 0; n--) {
      const ch = E.chans[(Math.random() * E.chans.length) | 0];
      const i = glow.spawn(G_FLOW, 0, 0, 0, 0, 0, 0, rand(9, 13), rand(1.1, 1.7));
      glow.a[i] = craterR() + rand(0.6, 1.4); glow.b[i] = ch + rand(-0.07, 0.07);
    }
    light = 1.0;
  } else if (k === 'strombolian') {
    if (t > E.next) {
      E.next = t + rand(0.6, 1.3);
      const n = Math.round(rand(60, 110) * SCALE);
      for (let j = 0; j < n; j++) {
        const th = rand(0, Math.PI * 2), sp = rand(0.5, 4.5);
        glow.spawn(G_FOUNT, rand(-0.3, 0.3), vy0, rand(-0.5, 0.1), Math.cos(th) * sp, rand(8, 15), Math.sin(th) * sp, 5, rand(0.5, 1.0));
      }
      for (let j = 0; j < 6; j++) { ash.spawn(A_PUFF, rand(-0.5, 0.5), vy0 + 1, rand(-0.5, 0), rand(-1, 1), rand(4, 7), rand(-1, 0.5), rand(3, 5), rand(2, 3.5)); setPuffColor(0.36, 0.33, 0.31, 0.55); }
      if (!E.quiet) audio.blast(0.35); E.flash = 1;
    }
    light = 0.5 + (E.flash || 0); E.flash = Math.max(0, (E.flash || 0) - dt * 3);
  } else if (k === 'dome') {
    const g = smooth(0.4, 10, t);
    dome.scale.set(0.2 + 1.9 * g, 0.15 + 1.35 * g, 0.2 + 1.9 * g);
    if (t > E.next) {
      E.next = t + rand(0.8, 1.6);
      const th = backTheta();
      for (let j = 0; j < 8; j++) glow.spawn(G_BLOCK, Math.cos(th) * 1.6 * g, vy0 + 1.2 * g, Math.sin(th) * 1.6 * g, Math.cos(th) * rand(1, 2.5), rand(0, 1.5), Math.sin(th) * rand(1, 2.5), 4, rand(0.4, 0.7));
    }
    for (let n = emit(5 * I, dt, 'acc'); n > 0; n--) { ash.spawn(A_PUFF, rand(-1, 1), vy0 + 1.5 * g, rand(-1, 0), 0, rand(1, 2), 0, rand(4, 6), rand(1.5, 2.5)); setPuffColor(0.8, 0.79, 0.8, 0.3); }
    light = 0.35;
  } else if (k === 'vulcanian') {
    if (t > E.next) {
      E.next = t + rand(2.2, 3.2);
      for (let j = 0; j < 28 * SCALE; j++) { const th = rand(0, Math.PI * 2), sp = rand(2, 7); glow.spawn(G_BLOCK, 0, vy0, -0.2, Math.cos(th) * sp, rand(10, 18), Math.sin(th) * sp, 6, rand(0.7, 1.2)); }
      for (let j = 0; j < 80 * SCALE; j++) { ash.spawn(A_PUFF, rand(-0.6, 0.6), vy0 + rand(0, 2), rand(-0.6, 0.2), rand(-2.5, 2.5), rand(6, 16), rand(-2, 1.5), rand(5, 8), rand(2.5, 4.5)); setPuffColor(0.26, 0.24, 0.23, 0.75); }
      audio.blast(0.7); E.flash = 1; E.kick = 0.7;
    }
    E.flash = Math.max(0, (E.flash || 0) - dt * 2); E.kick = Math.max(0, (E.kick || 0) - dt * 1.5);
    light = 0.25 + 1.4 * E.flash; E.shake = E.kick;
  } else if (k === 'plinian') {
    for (let n = emit(170 * I * SCALE, dt, 'acc'); n > 0; n--) ash.spawn(A_COL, rand(-1.2, 1.2), vy0 + rand(0, 1), rand(-1.2, 0.4), rand(-0.8, 0.8), 14, rand(-0.8, 0.8), rand(11, 15), rand(3.2, 5.6));
    for (let n = emit(160 * I * SCALE, dt, 'acc2'); n > 0; n--) glow.spawn(G_SPARK, rand(-0.5, 0.5), vy0, rand(-0.5, 0.2), rand(-1.5, 1.5), rand(14, 26), rand(-1.5, 1.5), rand(0.4, 0.9), rand(0.4, 0.9));
    if (t > 5) {
      for (let n = emit(55 * I * SCALE, dt, 'acc3'); n > 0; n--) {
        const th = sideTheta();
        const i = ash.spawn(A_PYRO, 0, 0, 0, 0, 0, 0, rand(3, 4.5), rand(2.2, 3.4)); ash.a[i] = craterR() + 0.5; ash.b[i] = th;
        if (Math.random() < 0.5) { const g2 = glow.spawn(G_PGLOW, 0, 0, 0, 0, 0, 0, rand(1.5, 2.5), rand(1.2, 2)); glow.a[g2] = craterR() + 0.5; glow.b[g2] = th; }
      }
    }
    if (t > E.nextBolt) { E.nextBolt = t + rand(0.5, 1.6); fireBolt(rand(-4, 4), vy0 + rand(10, 22), rand(-4, 1)); }
    skyU.uAsh.value = smooth(1, 12, t) * 0.75;
    light = 1.1; E.shake = 0.32 * I;
  }
  vent.position.set(0, vy0 + 1.2, -0.5);
  vent.intensity = light * I * 260 * (0.85 + 0.3 * Math.random());
  if (!E.quiet) audio.rumble((k === 'plinian' ? 0.9 : k === 'dome' ? 0.25 : 0.55) * I);
  if (boltT > 0) { boltT -= dt; if (boltT <= 0) bolt.visible = false; }
}

// ======================================================================
// INSIDE SCENE
// ======================================================================
inside.fog = new THREE.FogExp2(0x1c0602, 0.03);
inside.background = new THREE.Color(0x120402);
const wallU = { uTime: { value: 0 }, uFlow: { value: 1 }, uHot: { value: new THREE.Color(3, 1.3, 0.35) } };
const wall = new THREE.Mesh(new THREE.SphereGeometry(42, 64, 32), new THREE.ShaderMaterial({ uniforms: wallU, vertexShader: SH.wallVert, fragmentShader: SH.wallFrag, side: THREE.BackSide, fog: false }));
inside.add(wall);
inside.add(new THREE.AmbientLight(0xff6a30, 0.35));
const inLight = new THREE.PointLight(0xffa860, 30, 0, 1.1); inLight.position.set(0, 4, 6); inside.add(inLight);
const inLight2 = new THREE.PointLight(0xff4a10, 18, 0, 1.1); inLight2.position.set(-8, -6, -6); inside.add(inLight2);

const MAXT = 460;
const tetMat = new THREE.MeshStandardMaterial({ color: 0xeafcff, emissive: 0x5cc4ff, emissiveIntensity: 0.4, roughness: 0.28, metalness: 0.05, flatShading: true });
const tetra = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.42), tetMat, MAXT);
const linkMat = new THREE.MeshStandardMaterial({ color: 0xaee8ff, emissive: 0x58c8ff, emissiveIntensity: 0.6, roughness: 0.4 });
const links = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 6), linkMat, MAXT);
const silica = new THREE.Group(); silica.add(tetra); silica.add(links); inside.add(silica);

const MAXB = 200;
const bubU = { uRim: { value: new THREE.Color(2.4, 1.3, 0.5) }, uP: { value: 0 }, uTime: { value: 0 } };
const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({ uniforms: bubU, vertexShader: SH.bubbleVert, fragmentShader: SH.bubbleFrag, transparent: true, depthWrite: false }), MAXB);
inside.add(bubbles);
const bub = []; for (let i = 0; i < MAXB; i++) bub.push({ x: rand(-12, 12), y: rand(-14, 14), z: rand(-12, 10), r: rand(0.12, 0.5), s: Math.random() });
const dummy = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);

function buildSilica(S) {
  const p = clamp((S - 45) / 30, 0, 1);
  const total = Math.round(80 + 340 * p);
  const len = 1 + Math.floor(Math.pow(p, 1.6) * 14);
  let ti = 0, li = 0;
  while (ti < Math.min(total, MAXT)) {
    let pos = new THREE.Vector3().randomDirection().multiplyScalar(rand(3.5, 13));
    let dir = new THREE.Vector3().randomDirection();
    for (let k = 0; k < len && ti < MAXT; k++) {
      dummy.position.copy(pos); dummy.rotation.set(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)); dummy.scale.setScalar(1); dummy.updateMatrix();
      tetra.setMatrixAt(ti++, dummy.matrix);
      if (k < len - 1) {
        const nxt = pos.clone().addScaledVector(dir, 0.95);
        dummy.position.copy(pos).add(nxt).multiplyScalar(0.5);
        dummy.quaternion.setFromUnitVectors(up, dir); dummy.scale.set(1, 0.95, 1); dummy.updateMatrix();
        if (li < MAXT) links.setMatrixAt(li++, dummy.matrix);
        dummy.rotation.set(0, 0, 0);
        pos = nxt; dir.add(new THREE.Vector3().randomDirection().multiplyScalar(0.55)).normalize();
      }
    }
  }
  tetra.count = ti; links.count = li;
  tetra.instanceMatrix.needsUpdate = true; links.instanceMatrix.needsUpdate = true;
}

function magmaColor(T) {
  const u = clamp((T - 650) / 600, 0, 1);
  return new THREE.Color(lerp(1.2, 2.1, u), lerp(0.12, 0.95, u * u), lerp(0.02, 0.26, u * u * u));
}

function stepInside(dt, time) {
  const { S, T, W } = sim;
  const L = M.logEta(S, T, W), op = M.overpressure(L, W);
  const f = clamp((6.5 - L) / 5.5, 0.012, 1);
  wallU.uFlow.value = lerp(wallU.uFlow.value, 0.06 + 1.4 * f, Math.min(1, dt * 2));
  silica.rotation.y += dt * 0.05 * f; silica.rotation.x += dt * 0.012 * f;
  const nB = Math.round(MAXB * clamp(W / 7, 0, 1));
  bubbles.count = Math.max(nB, W > 0.2 ? 6 : 0);
  bubU.uP.value = op; bubU.uTime.value = time;
  bubU.uRim.value.setRGB(lerp(2.4, 3.6, op), lerp(1.3, 0.7, op), lerp(0.5, 0.35, op));
  const gs = 0.7 + 0.7 * clamp(W / 5, 0, 1);
  for (let i = 0; i < bubbles.count; i++) {
    const b = bub[i];
    const rad = b.r * gs * (1 + op * 0.55 * (0.5 + 0.5 * Math.sin(time * 5 + b.s * 20)));
    b.y += (0.2 + 6.0 * f * f) * (0.5 + b.r * 1.6) * dt;
    b.x += Math.sin(time * 0.7 + b.s * 9) * 0.15 * f * dt;
    if (b.y > 15) { b.y = -15; b.x = rand(-12, 12); b.z = rand(-12, 10); }
    dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(rad); dummy.updateMatrix();
    bubbles.setMatrixAt(i, dummy.matrix);
  }
  bubbles.instanceMatrix.needsUpdate = true;
}

// ======================================================================
// AUDIO (synthesised, no files)
// ======================================================================
const audio = (() => {
  let ctx = null, rg = null, on = true, noiseBuf = null;
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = ctx.sampleRate * 3; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
      rg = ctx.createGain(); rg.gain.value = 0;
      src.connect(lp).connect(rg).connect(ctx.destination); src.start();
    } catch (e) { ctx = null; }
  }
  return {
    init,
    toggle() { on = !on; if (!on && rg) rg.gain.setTargetAtTime(0, ctx.currentTime, 0.1); return on; },
    rumble(level) { if (ctx && rg) rg.gain.setTargetAtTime(on ? level * 0.9 : 0, ctx.currentTime, 0.25); },
    blast(level) {
      if (!ctx || !on) return;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      const g = ctx.createGain(); g.gain.setValueAtTime(level * 1.6, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
      s.connect(f).connect(g).connect(ctx.destination); s.start(); s.stop(ctx.currentTime + 1.7);
    },
  };
})();

// ======================================================================
// CAMERA, LAYOUT
// ======================================================================
let panelTarget = 0, panelNow = 0, panelIsBottom = false;
function freeSize() {
  const W = innerWidth, H = innerHeight;
  return panelIsBottom ? { w: W, h: H - panelTarget } : { w: W - panelTarget, h: H };
}
function applyView() {
  const W = innerWidth, H = innerHeight;
  const P = panelIsBottom ? 0 : panelNow, Pb = panelIsBottom ? panelNow : 0;
  camera.aspect = W / H;
  camera.setViewOffset(W, H, P / 2, Pb / 2, W, H);
  camera.updateProjectionMatrix();
  const sc = (H * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  glow.mat.uniforms.uScale.value = sc; ash.mat.uniforms.uScale.value = sc;
}
function layout() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H); composer.setSize(W, H);
  panelIsBottom = W <= 820;
  applyView();
}
function setPanel(open) {
  const W = innerWidth, H = innerHeight;
  panelIsBottom = W <= 820;
  panelTarget = open ? (panelIsBottom ? Math.round(H * 0.52) : 424) : 0;
}
function fitDist(w, h) {
  const { w: fw, h: fh } = freeSize();
  const tv = Math.tan((camera.fov * Math.PI) / 360), H = innerHeight;
  return Math.max((h * H) / (2 * tv * fh), (w * H) / (2 * tv * fw)) * 1.04;
}
function viewPos(target, dir, w, h) { return target.clone().add(dir.clone().normalize().multiplyScalar(fitDist(w, h))); }

let tween = null;
function flyTo(pos, target, dur, done) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, u: 0, dur: REDUCED ? 0.01 : dur, done };
  controls.enabled = false;
}
function snap(pos, target) { tween = null; camera.position.copy(pos); controls.target.copy(target); camera.lookAt(target); }
function outsideControls(free) {
  controls.enabled = free; controls.autoRotate = false;
  controls.minDistance = 12; controls.maxDistance = 260;
  controls.minAzimuthAngle = -1.15; controls.maxAzimuthAngle = 1.15;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.75;
  controls.enableZoom = true;
}
function insideControls() {
  controls.enabled = true; controls.autoRotate = !REDUCED; controls.autoRotateSpeed = 0.45;
  controls.minDistance = 6; controls.maxDistance = 24;
  controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI - 0.2;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VIEWS = {
  overview: () => { const t = V(0, -12, -6); return { t, p: viewPos(t, V(0.42, 0.5, 1), 150, 80) }; },
  section: () => { const t = V(0, -18, 0); return { t, p: viewPos(t, V(0.26, 0.42, 1), 150, 78) }; },
  chamber: () => ({ t: V(0, CHY, 0), p: V(0.6, CHY + 0.6, 7.5) }),
  erupt: (big) => { const t = big ? V(0, 15, -10) : V(0, 2.5, -12); return { t, p: viewPos(t, V(0.34, big ? 0.2 : 0.24, 1), big ? 120 : 96, big ? 84 : 46) }; },
};

// ======================================================================
// LABELS
// ======================================================================
const labelsEl = $('#labels');
let labels = [];
function setLabels(list) {
  labelsEl.innerHTML = ''; labels = [];
  for (const L of list) {
    const el = document.createElement('div'); el.className = 'lbl' + (L.below ? ' below' : '');
    el.innerHTML = L.t + (L.s ? `<small>${L.s}</small>` : '');
    labelsEl.appendChild(el); labels.push({ el, p: L.p, below: L.below });
    setTimeout(() => el.classList.add('on'), 300 + labels.length * 180);
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  for (const L of labels) {
    _v.copy(L.p).project(camera);
    const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
    L.el.style.left = x + 'px'; L.el.style.top = (y + (L.below ? 22 : -22)) + 'px';
    L.el.style.visibility = _v.z < 1 ? 'visible' : 'hidden';
  }
}
const LABELSETS = {
  plume: [
    { t: 'Mantle plume', s: 'Hot rock rising, not magma', p: V(0, -44, 0.1) },
    { t: 'Decompression melting', s: 'Pressure drops, rock partly melts', p: V(17, -29, 0.1) },
    { t: 'Oceanic plate', p: V(-34, -5, 0.1), below: true },
    { t: 'Magma chamber', p: V(0, CHY + 2.6, 0.1) },
    { t: 'Pacific Ocean', p: V(-44, 0.4, -14) },
  ],
  subduction: [
    { t: 'Ocean plate sinks', s: 'Subduction', p: V(44, -14, 0.1), below: true },
    { t: 'Water leaves the plate', p: V(15, -30, 0.1), below: true },
    { t: 'Flux melting', s: 'Water lowers the melting point', p: V(-6, -38, 0.1), below: true },
    { t: 'Continental crust', p: V(-40, -8, 0.1), below: true },
    { t: 'Magma chamber', p: V(0, CHY + 2.6, 0.1) },
  ],
};

// ======================================================================
// UI / STATE
// ======================================================================
const ui = $('#ui');
const sim = { m: 0, S: 49, T: 1170, W: 1.0, pred: null, outcome: null };
const runs = [];
let state = 'title';
let hintTimer = 0;
function hint(on) { $('#hint').classList.toggle('on', on); if (on) hintTimer = 4.5; }

function fade(on) { $('#fade').style.opacity = on ? 1 : 0; return new Promise((r) => setTimeout(r, REDUCED ? 50 : 900)); }
const sup = (x) => `10<sup>${x.toFixed(1)}</sup>`;

function show(html, kind) {
  ui.innerHTML = `<div class="${kind}" role="region">${html}</div>`;
  document.body.classList.toggle('vig', kind === 'center');
  setPanel(kind === 'panel');
}

function goTitle() {
  state = 'title';
  active = outside; renderPass.scene = outside; setLabels([]);
  outsideControls(false); ambient();
  show(`<div class="titlewrap">
    <p class="eyebrow">Physical Geology · Volcanism</p>
    <h1>Into the<br><em>Magma Chamber</em></h1>
    <p>Ride magma from the mantle to the surface. Change its silica, temperature and gas, predict the eruption, then set it off.</p>
    <div class="row" style="margin-top:20px"><button class="btn" id="begin">Begin the descent</button>
    <span class="dim small">5 to 10 minutes · Built on Earle, <i>Physical Geology</i> 2e, Chapter 4</span></div></div>`, 'center');
  $('#begin').onclick = () => { audio.init(); goMissions(); };
}

function goMissions() {
  state = 'missions';
  ambient();
  active = outside; renderPass.scene = outside; setLabels([]);
  const cards = M.MISSIONS.map((m, i) => {
    const done = runs.some((r) => r.m === i);
    return `<button class="card" data-m="${i}">${done ? '<span class="done">✓ done</span>' : ''}
      <span class="n">${m.n.toUpperCase()}</span><span class="t">${m.name}</span><span class="pl">${m.place}</span><span class="d">${m.card}</span></button>`;
  }).join('');
  show(`<div class="titlewrap"><p class="eyebrow">Choose a mission</p><h2 style="font-size:34px">Where does this magma come from?</h2>
    <p class="dim">Each mission starts with a plate tectonic setting. You then dive into the magma chamber and decide what the volcano will do.</p></div>
    <div class="cards">${cards}</div>
    ${runs.length ? `<div class="row" style="margin-top:16px"><button class="btn ghost" id="toDebrief">See your debrief (${runs.length} eruption${runs.length > 1 ? 's' : ''})</button></div>` : ''}`, 'center');
  ui.querySelectorAll('.card').forEach((c) => (c.onclick = () => goSetting(+c.dataset.m)));
  if ($('#toDebrief')) $('#toDebrief').onclick = goDebrief;
  outsideControls(false);
  const v = VIEWS.overview(); flyTo(v.p, v.t, 2.2, () => {});
}

function loadMission(i) {
  sim.m = i; const m = M.MISSIONS[i];
  Object.assign(sim, m.preset); sim.pred = null;
  setOcean(m.ocean);
  secU.uSetting.value = m.setting === 'plume' ? 0 : 1;
  for (let k = 0; k < 4; k++) Wt[k] = Wtarget[k] = SHAPES.young[k];
  terrainDirty = true;
  secU.uMagma.value.copy(magmaColor(sim.T));
}

function goSetting(i) {
  state = 'setting';
  if (E.key) stopEruption();
  loadMission(i);
  const m = M.MISSIONS[i];
  show(`<p class="eyebrow">${m.n} · ${m.place}</p><h2>${m.name}</h2>
    <p>${m.brief}</p>
    <p class="src">Source: Earle, <i>Physical Geology</i> 2e, <a href="https://opentextbc.ca/physicalgeology2ed/chapter/4-1-plate-tectonics-and-volcanism/" target="_blank" rel="noopener">${m.src}</a></p>
    <h3>What to watch</h3>
    <p class="dim small">${m.setting === 'plume' ? 'The orange column is solid rock that is hot enough to flow. Melt appears only near the top, where the pressure drops. Droplets rise through a dike into the chamber.' : 'Blue dots are water driven out of the sinking plate. Where it rises into the hot mantle above, rock melts. Droplets rise through a dike into the chamber.'}</p>
    <div class="row" style="margin-top:18px"><button class="btn" id="dive">Dive into the magma chamber</button><button class="btn ghost" id="back">Missions</button></div>`, 'panel');
  setLabels(LABELSETS[m.setting]);
  outsideControls(false);
  const v = VIEWS.section();
  flyTo(v.p, v.t, 2.8, () => { outsideControls(true); hint(true); });
  $('#dive').onclick = goInside;
  $('#back').onclick = goMissions;
}

async function goInside() {
  setLabels([]); hint(false);
  if (state === 'setting') {
    const v = VIEWS.chamber();
    await new Promise((r) => flyTo(v.p, v.t, 2.0, r));
  }
  await fade(true);
  if (E.key) stopEruption();
  for (let k = 0; k < 4; k++) Wt[k] = Wtarget[k] = SHAPES.young[k];
  terrainDirty = true;
  state = 'inside';
  active = inside; renderPass.scene = inside;
  snap(V(0, 1.5, 18), V(0, 0, 0)); insideControls();
  buildSilica(sim.S);
  sim.pred = null;
  renderInsidePanel();
  audio.rumble(0.12);
  await fade(false);
  hint(true);
}

function renderInsidePanel() {
  const m = M.MISSIONS[sim.m];
  show(`<p class="eyebrow">${m.n} · Inside the magma chamber</p><h2>Set the magma</h2>
    <p class="dim small">You are inside the chamber in the upper crust. Move the sliders and watch the melt.</p>
    <div class="legend"><span class="sw" style="background:radial-gradient(circle,#2a0a04 40%,#ffb060 80%)"></span><span>Gas bubbles (mostly water vapour)</span>
    <span class="sw" style="background:#bfe9ff;border-radius:3px;transform:rotate(45deg) scale(.8)"></span><span>Silica tetrahedra. Links show polymerization.</span></div>
    ${slider('S', 'Silica (SiO₂)', 45, 75, 0.5, '%', 'Earle: mafic ≈47–50%, intermediate ≈57–64%, felsic ≈69–72%', 'linear-gradient(90deg,#3b2a26,#9fc7d6)')}
    ${slider('T', 'Temperature', 650, 1250, 10, ' °C', 'Typical: basaltic ≈1100–1200 °C, felsic ≈700–850 °C (general literature)', 'linear-gradient(90deg,#5a0d02,#ff6a1a,#ffe08a)')}
    ${slider('W', 'Dissolved gas', 0, 7, 0.1, ' wt%', 'Earle: mafic ≈1–3%, intermediate ≈3–4%, felsic ≈4–7%', 'linear-gradient(90deg,#2a1a14,#7fd3ff)')}
    <div id="readout"></div>
    <h3>Reason it out, then erupt</h3>
    <p class="dim small">Your answers are kept and shown beside the model after the eruption.</p>
    ${pickRow('rE', 'As this magma rises, how easily can gas leave it?', RE)}
    ${pickRow('rG', 'How much gas is there to leave?', RG)}
    <p class="q">So the eruption will be:</p>
    <div class="preds">${M.PRED.map((p) => `<button class="pred" data-c="${p.cls}">${p.label}<small>${p.sub}</small></button>`).join('')}</div>
    ${pickRow('conf', 'How sure are you?', CONF)}
    <div class="row"><button class="btn" id="erupt" disabled>Erupt</button><button class="btn ghost" id="back">Missions</button></div>`, 'panel');
  for (const key of ['S', 'T', 'W']) {
    const el = $('#r' + key);
    el.oninput = () => { sim[key] = +el.value; onSim(key); };
  }
  sim.rE = sim.rG = sim.conf = null;
  const ready = () => { $('#erupt').disabled = !(sim.pred != null && sim.rE != null && sim.rG != null && sim.conf != null); };
  ui.querySelectorAll('.pred').forEach((b) => (b.onclick = () => {
    sim.pred = +b.dataset.c; ui.querySelectorAll('.pred').forEach((x) => x.classList.toggle('sel', x === b)); ready();
  }));
  ui.querySelectorAll('.pick').forEach((b) => (b.onclick = () => {
    sim[b.dataset.k] = +b.dataset.v; ui.querySelectorAll(`.pick[data-k="${b.dataset.k}"]`).forEach((x) => x.classList.toggle('sel', x === b)); ready();
  }));
  $('#erupt').onclick = goErupt;
  $('#back').onclick = async () => { await fade(true); active = outside; renderPass.scene = outside; goMissions(); await fade(false); };
  onSim();
}
EF.watch(() => (document.querySelector('#erupt') ? 'Mission: ' + M.MISSIONS[sim.m].name : null));
const RE = ['Easily', 'With difficulty', 'Hardly at all'], RG = ['Very little', 'A fair amount', 'A great deal'], CONF = ['Guessing', 'Fairly sure', 'Very sure'];
const refE = (L) => (L < 3 ? 0 : L < 5 ? 1 : 2), refG = (W) => (W < 1.5 ? 0 : W < 3.5 ? 1 : 2);
function pickRow(k, q, opts) {
  return `<p class="q">${q}</p><div class="seg3" role="group" aria-label="${q}">${opts.map((o, i) => `<button class="pick" data-k="${k}" data-v="${i}">${o}</button>`).join('')}</div>`;
}
function slider(k, label, min, max, step, unit, sub, trk) {
  return `<div class="slider"><div class="top"><label for="r${k}">${label}</label><span class="val" id="v${k}"></span></div>
  <input type="range" id="r${k}" min="${min}" max="${max}" step="${step}" value="${sim[k]}" style="--trk:${trk}" aria-describedby="s${k}">
  <div class="sub" id="s${k}">${sub}</div></div>`;
}
let silicaT = 0;
function onSim(changed) {
  const { S, T, W } = sim;
  $('#vS').textContent = S.toFixed(1) + '%  ' + M.compClass(S).toLowerCase();
  $('#vT').textContent = Math.round(T) + ' °C';
  $('#vW').textContent = W.toFixed(1) + ' wt%';
  const L = M.logEta(S, T, W), op = M.overpressure(L, W);
  const chk = M.natureCheck(S, T, W);
  const tick = (v, t) => `<span style="left:${(v / 11) * 100}%">${t}</span>`;
  $('#readout').innerHTML = `
    <div class="meter"><div class="mt"><span>Viscosity</span><b>${sup(L)} Pa·s</b></div>
      <div class="bar"><i style="width:${(L / 11) * 100}%;background:linear-gradient(90deg,#ffd27a,#ff7a1a,#7a1a08)"></i></div>
      <div class="ticks">${tick(1, 'honey')}${tick(2.4, 'peanut<br>butter')}${tick(8.4, 'pitch')}</div></div>
    ${chk ? `<div class="note">${chk}</div>` : ''}
    <p class="src">Viscosity here comes from a simplified illustrative model, not a published one. See "About this demo".</p>`;
  secU.uMagma.value.copy(magmaColor(T));
  wallU.uHot.value.copy(magmaColor(T)).multiplyScalar(0.32);
  if (changed === 'S') { clearTimeout(silicaT); silicaT = setTimeout(() => buildSilica(sim.S), 60); }
}

async function goErupt() {
  const { S, T, W } = sim;
  const key = M.classify(S, T, W);
  sim.outcome = key;
  const o = M.OUTCOMES[key];
  { const L0 = M.logEta(S, T, W); EF.resolved(); EF.mark({ ok: sim.pred === o.cls, conf: sim.conf }); if (sim.pred !== o.cls) EF.wrong(); if (runs.length >= 2) EF.extra('Extra eruption'); runs.push({ m: sim.m, S, T, W, pred: sim.pred, out: key, ok: sim.pred === o.cls, rE: sim.rE, rG: sim.rG, conf: sim.conf, eE: refE(L0), eG: refG(W) }); }
  hint(false);
  await fade(true);
  state = 'erupt';
  active = outside; renderPass.scene = outside;
  show('', 'none'); ui.innerHTML = '';
  setPanel(false); panelNow = 0; applyView();
  for (let k = 0; k < 4; k++) Wt[k] = Wtarget[k] = SHAPES.young[k];
  updateTerrain();
  const big = key === 'plinian' || key === 'vulcanian';
  const v = VIEWS.erupt(big);
  const near = v.t.clone().add(v.p.clone().sub(v.t).multiplyScalar(0.55));
  snap(near, v.t.clone().add(V(0, -2, 0)));
  outsideControls(false);
  startEruption(key);
  await fade(false);
  flyTo(v.p, v.t, 7, () => {});
  setTimeout(() => { if (state === 'erupt') goResult(); }, REDUCED ? 3000 : 8500);
}

function goResult() {
  state = 'result';
  const { S, T, W, pred, outcome } = sim;
  const o = M.OUTCOMES[outcome];
  const ok = pred === o.cls;
  const L = M.logEta(S, T, W), op2 = M.overpressure(L, W), run = runs[runs.length - 1];
  const mis = M.misconception(pred, outcome, S, T, W);
  const shapeName = { shield: 'Shield volcano', composite: 'Composite volcano', cinder: 'Cinder cone' }[o.shape] + (o.dome ? ' with a lava dome' : '');
  const secUrl = o.shape === 'shield' || o.shape === 'cinder' ? '4-3-types-of-volcanoes' : '4-2-magma-composition-and-eruption-style';
  show(`<p class="eyebrow">Result</p>
    <div class="verdict ${ok ? 'ok' : 'no'}"><span class="big">${ok ? '✓' : '✗'}</span><div><b>You predicted: ${M.PRED[pred].label}.</b><br><span class="dim small">The eruption was ${M.PRED[o.cls].label.toLowerCase()}.</span></div></div>
    <h2>${o.name}</h2>
    <dl class="kv"><dt>Magma</dt><dd>${M.compClass(S)}, ${S.toFixed(1)}% SiO₂, ${Math.round(T)} °C, ${W.toFixed(1)} wt% gas</dd>
    <dt>Viscosity</dt><dd>${sup(L)} Pa·s (model)</dd><dt>Gas trapped</dt><dd>${op2 < 0.2 ? 'Low' : op2 < 0.5 ? 'Moderate' : 'High'} (model)</dd><dt>Builds</dt><dd>${shapeName}</dd></dl>
    <h3>Your reasoning beside the model</h3>
    <table class="runs"><tr><th></th><th>You said</th><th>Model</th><th></th></tr>
    <tr><td>Gas can leave</td><td>${RE[run.rE]}</td><td>${RE[run.eE]}</td><td>${run.rE === run.eE ? '✓' : '✗'}</td></tr>
    <tr><td>Gas present</td><td>${RG[run.rG]}</td><td>${RG[run.eG]}</td><td>${run.rG === run.eG ? '✓' : '✗'}</td></tr>
    <tr><td>Eruption</td><td>${M.PRED[pred].label}, ${CONF[run.conf].toLowerCase()}</td><td>${M.PRED[o.cls].label}</td><td>${ok ? '✓' : '✗'}</td></tr></table>
    ${ok && !(run.rE === run.eE && run.rG === run.eG) ? '<div class="note">Right outcome, but a step in your reasoning differs from the model. Check the row marked ✗.</div>' : ''}
    <p>${o.why}</p>
    ${mis ? `<div class="note">${mis}</div>` : ''}
    <p class="small"><b>Real world:</b> <span class="dim">${o.analog}</span></p>
    <p class="src">Source: Earle, <i>Physical Geology</i> 2e, <a href="https://opentextbc.ca/physicalgeology2ed/chapter/${secUrl}/" target="_blank" rel="noopener">${o.src}</a>. Time is compressed: the volcano shows what many eruptions like this build.</p>
    <div class="row" style="margin-top:14px"><button class="btn" id="again">Try a different mix</button><button class="btn ghost" id="next">Missions</button>
    ${runs.length >= 2 ? '<button class="btn ghost" id="deb">Debrief</button>' : ''}</div>`, 'panel');
  $('#again').onclick = goInside;
  $('#next').onclick = goMissions;
  if ($('#deb')) $('#deb').onclick = goDebrief;
  outsideControls(true);
  hint(true);
}

function goDebrief() {
  state = 'debrief';
  const n = runs.length, ok = runs.filter((r) => r.ok).length;
  const settings = new Set(runs.map((r) => M.MISSIONS[r.m].setting));
  const outs = new Set(runs.map((r) => r.out));
  const shapes = new Set(runs.map((r) => M.OUTCOMES[r.out].shape));
  const cov = [settings.size >= 2, outs.size >= 2, shapes.size >= 2];
  const todo = ['Play the Hotspot mission and a subduction mission.', 'Produce two different eruption styles.', 'Build two different kinds of volcano.'];
  const mk = (a, b, names) => `${names[a]}${a === b ? '' : ' <span class="dim">(model: ' + names[b].toLowerCase() + ')</span>'}`;
  const rows = runs.map((r, i) => `<tr><td>${i + 1}</td><td>${M.MISSIONS[r.m].name}<br><span class="dim">${r.S.toFixed(0)}% · ${Math.round(r.T)}° · ${r.W.toFixed(1)}%</span></td><td>${mk(r.rE, r.eE, RE)}</td><td>${mk(r.rG, r.eG, RG)}</td><td>${M.PRED[r.pred].label}<br><span class="dim">${CONF[r.conf].toLowerCase()}</span></td><td>${M.OUTCOMES[r.out].name}</td><td>${r.ok ? '✓' : '✗'}</td></tr>`).join('');
  EF.resolved();
  const full = runs.filter((r) => r.ok && r.rE === r.eE && r.rG === r.eG).length, lucky = ok - full;
  const sure = runs.filter((r) => r.conf === 2), sureOk = sure.filter((r) => r.ok).length;
  const stiffQuiet = runs.some((r) => r.out === 'dome');
  show(`<div class="debrief"><p class="eyebrow">Debrief</p><h2 style="font-size:32px">${ok} of ${n} predictions correct</h2>
    <p class="small">${full} with both reasons matching the model.${lucky ? ` ${lucky} right with a reason that differs.` : ''}${sure.length ? ` When you were very sure, you were right ${sureOk} of ${sure.length} times.` : ''}</p>
    <div class="grid2"><div><h3>Learning objectives (Earle, Ch. 4)</h3>
    ${M.OBJECTIVES.map((o, i) => `<div class="obj"><span class="ck ${cov[i] ? 'y' : ''}">${cov[i] ? '✓' : i + 1}</span><div>${o.text}<div class="src">${o.ref}${cov[i] ? '' : ' · <b style="color:#ffd9a8">To cover: ' + todo[i] + '</b>'}</div></div></div>`).join('')}
    </div><div><h3>Your eruptions</h3><table class="runs"><tr><th>#</th><th>Mission and mix</th><th>Gas can leave</th><th>Gas present</th><th>Predicted</th><th>Outcome</th><th></th></tr>${rows}</table>
    ${EF.html()}
    <div class="obj"><span class="ck ${stiffQuiet ? 'y' : ''}">${stiffQuiet ? '✓' : '?'}</span><div>Challenge: make a stiff magma that erupts quietly. Say why before you erupt it.</div></div></div></div>
    <h3>Read more</h3><p class="small dim">Earle, S. (2019). <i>Physical Geology</i> (2nd ed.), Chapter 4: Volcanism, §4.1–4.3. BCcampus. <a href="https://opentextbc.ca/physicalgeology2ed/part/chapter-4-volcanism/" target="_blank" rel="noopener">opentextbc.ca/physicalgeology2ed</a>. CC BY 4.0.</p>
    <div class="row" style="margin-top:10px"><button class="btn" id="more">Back to missions</button></div></div>`, 'center');
  $('#more').onclick = goMissions;
}

function about() {
  const d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="box" role="dialog" aria-label="About this demo"><p class="eyebrow">About this demo</p><h2>Into the Magma Chamber</h2>
  <p class="dim">A short 3D simulation for an introductory physical geology course, built on objectives 1 to 3 of Earle, <i>Physical Geology</i> 2e, Chapter 4.</p>
  <h3>How it was made</h3><ul><li>Built with Claude (Anthropic) from a plain-language request, as a single HTML file using the open-source Three.js library. It runs in a browser and can be hosted free on GitHub Pages.</li></ul>
  <h3>What is simplified</h3><ul>
  <li>Viscosity comes from a simple formula in silica, temperature and water, fitted by hand to typical textbook ranges (basalt ≈10² Pa·s, hydrous rhyolite ≈10⁷ Pa·s). It is illustrative, not a research model. For a published model, see Giordano, Russell and Dingwell (2008), <i>Earth and Planetary Science Letters</i> 271, 123–134.</li>
  <li>Eruption style comes from fixed thresholds on viscosity and gas content.</li>
  <li>Before each eruption you say how easily gas can leave, how much gas there is, what the eruption will be and how sure you are. The page keeps those answers and shows them beside the model. The model's reading uses the same thresholds: gas leaves easily below 10³ Pa·s and hardly at all above 10⁵; gas is very little below 1.5 wt% and a great deal from 3.5 wt%. The debrief also reports time spent on open decisions and any extra eruptions you chose to run. Nothing is sent anywhere.</li>
  <li>Silica and gas ranges follow Earle §4.2. Earle gives no magma temperatures, so the temperature notes use typical values from the general literature.</li>
  <li>Lava domes and Vulcanian eruptions go beyond Earle §4.3.</li>
  <li>Vertical scale is exaggerated about 2×, depths are not to scale, and time is compressed.</li></ul>
  <h3>Source</h3><ul><li>Earle, S. (2019). <i>Physical Geology</i> (2nd ed.). BCcampus. <a href="https://opentextbc.ca/physicalgeology2ed/" target="_blank" rel="noopener">opentextbc.ca/physicalgeology2ed</a>. CC BY 4.0.</li></ul>
  <div class="row"><button class="btn" id="closeAbout">Close</button></div></div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.onclick = (e) => { if (e.target === d) close(); };
  d.querySelector('#closeAbout').onclick = close;
  d.querySelector('#closeAbout').focus();
}
$('#aboutBtn').onclick = about;
$('#soundBtn').onclick = () => { audio.init(); const on = audio.toggle(); $('#soundBtn').textContent = 'Sound: ' + (on ? 'on' : 'off'); $('#soundBtn').setAttribute('aria-pressed', on); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.modal')?.remove(); });

// ======================================================================
// LOOP
// ======================================================================
let last = performance.now(), time = 0, orbitA = 0;
const DTCAP = +(new URLSearchParams(location.search).get('dtcap') || 0.05);
const shakeOff = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(DTCAP, (now - last) / 1000); last = now; time += dt;
  // panel offset easing
  if (Math.abs(panelNow - panelTarget) > 0.5) { panelNow += (panelTarget - panelNow) * Math.min(1, dt * 6); applyView(); }
  else if (panelNow !== panelTarget) { panelNow = panelTarget; applyView(); }

  bloom.strength = active === outside ? 0.6 : 0.4;
  if (active === outside) {
    // terrain morph
    let moving = false;
    for (let i = 0; i < 4; i++) { const d = Wtarget[i] - Wt[i]; if (Math.abs(d) > 0.002) { Wt[i] += d * Math.min(1, dt * 0.55); moving = true; } else Wt[i] = Wtarget[i]; }
    if (moving || terrainDirty) updateTerrain();
    secU.uTime.value = time; domeU.uTime.value = time;
    secU.uPulse.value = state === 'setting' ? 0.5 + 0.5 * Math.sin(time * 2) : 0;
    stepEruption(dt);
    updateGlow(dt); updateAsh(dt);
    if (state === 'title' || state === 'missions') {
      if (!tween) {
        orbitA += dt * 0.08;
        const t = V(0, -10, -4), base = VIEWS.overview().p.sub(t);
        const r = base.length(), a = 0.38 + Math.sin(orbitA) * 0.5;
        camera.position.set(t.x + Math.sin(a) * r * 0.94, t.y + base.y, t.z + Math.cos(a) * r * 0.94);
        controls.target.copy(t); camera.lookAt(t);
      }
    }
  } else {
    wallU.uTime.value = time;
    stepInside(dt, time);
  }

  if (tween) {
    tween.u += dt / tween.dur; const e = ease(Math.min(1, tween.u));
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); camera.lookAt(controls.target);
    if (tween.u >= 1) { const cb = tween.done; tween = null; cb && cb(); }
  } else if (controls.enabled) controls.update();

  // shake
  camera.position.sub(shakeOff); shakeOff.set(0, 0, 0);
  if (E.shake > 0 && !REDUCED && active === outside) { shakeOff.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(E.shake * 0.35); camera.position.add(shakeOff); }

  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hint(false); }
  updateLabels();
  composer.render(dt);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => { setPanel(panelTarget > 0); panelNow = panelTarget; layout(); });
layout();
setOcean('right'); loadMission(1); updateTerrain();
goTitle();
snap(VIEWS.overview().p, VIEWS.overview().t);
requestAnimationFrame(frame);

// testing hooks
window.__demo = {
  goMissions, goSetting, goInside, goErupt, goResult, goDebrief,
  set(o) { Object.assign(sim, o); if (state === 'inside') { for (const k of ['S', 'T', 'W']) { const el = $('#r' + k); if (el) el.value = sim[k]; } onSim('S'); } },
  predict(c) { ui.querySelector(`.pred[data-c="${c}"]`)?.click(); },
  reason(e, g, c) { [['rE', e], ['rG', g], ['conf', c]].forEach(([k, v]) => ui.querySelector(`.pick[data-k="${k}"][data-v="${v}"]`)?.click()); },
  get sim() { return sim; },
  get state() { return state; }, runs,
};
