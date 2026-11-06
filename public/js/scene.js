// Word Fleet — three.js world: ocean, islands, fleets and battle effects.
import * as THREE from 'three';

export const SEG = 3.2;          // length of one letter segment
const SHIP_GAP = 8;              // distance between ships in a fleet
const SECTOR_R = 150;            // distance of each fleet from the centre
export const wave = (x, z, t) => 0.6 * Math.sin(0.05 * x + t * 0.9) + 0.45 * Math.sin(0.07 * z + t * 1.1) + 0.25 * Math.sin(0.11 * (x + z) + t * 1.7);

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// ---------- canvas textures ----------
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const LETTER_STYLES = {
  own:   { bg: '#f3f7fb', fg: '#13233a', bd: '#9fb3c8' },
  hit:   { bg: '#e8461f', fg: '#ffffff', bd: '#ffc2a8' },
  sonar: { bg: 'rgba(30,170,230,0.55)', fg: '#e6fbff', bd: '#7fe3ff' },
  sunk:  { bg: '#46525f', fg: '#d7dee6', bd: '#7d8b99' },
};
function letterTex(ch, style) {
  return canvasTex(`L:${ch}:${style}`, 128, 128, (g, w, h) => {
    const s = LETTER_STYLES[style];
    roundRect(g, 8, 8, w - 16, h - 16, 22); g.fillStyle = s.bg; g.fill();
    g.lineWidth = 7; g.strokeStyle = s.bd; g.stroke();
    g.fillStyle = s.fg; g.font = '900 84px "Lilita One", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, w / 2, h / 2 + 5);
  });
}
const glowTex = () => canvasTex('glow', 128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
});
const puffTex = () => canvasTex('puff', 128, 128, (g, w) => {
  for (let i = 0; i < 7; i++) {
    const x = w / 2 + Math.cos(i * 0.9) * 22, y = w / 2 + Math.sin(i * 1.3) * 18, r = 28 + (i % 3) * 6;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
});
function labelTex(text, color, dim) {
  return canvasTex(`N:${text}:${color}:${dim}`, 512, 128, (g, w, h) => {
    g.font = '400 60px "Lilita One", "Arial Black", sans-serif';
    const tw = Math.min(w - 20, g.measureText(text).width + 70);
    roundRect(g, (w - tw) / 2, 14, tw, h - 28, 40);
    g.fillStyle = dim ? '#56616d' : color; g.fill();
    g.lineWidth = 8; g.strokeStyle = 'rgba(10,20,35,0.85)'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 6;
    g.fillText(text, w / 2, h / 2 + 3, tw - 40);
  });
}
function wreckTex(word) {
  return canvasTex(`W:${word}`, 64 * word.length + 40, 96, (g, w, h) => {
    roundRect(g, 4, 10, w - 8, h - 20, 18); g.fillStyle = 'rgba(40,52,66,0.85)'; g.fill();
    g.fillStyle = '#dfe8f2'; g.font = '400 54px "Lilita One", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(word.split('').join(' '), w / 2, h / 2 + 3);
    g.strokeStyle = '#ff6b6b'; g.lineWidth = 6; g.beginPath(); g.moveTo(20, h / 2); g.lineTo(w - 20, h / 2); g.stroke();
  });
}

function sprite(tex, opts = {}) {
  const m = new THREE.SpriteMaterial({ map: tex, color: opts.color ?? 0xffffff, transparent: true, depthWrite: false, opacity: opts.opacity ?? 1, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: opts.fog ?? true });
  const s = new THREE.Sprite(m);
  if (opts.scale) s.scale.setScalar(opts.scale);
  return s;
}

// ---------- shared materials ----------
const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: 0x5f6f80, roughness: 0.6, metalness: 0.25, flatShading: true }),
  hullDark: new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.9, flatShading: true }),
  deck: new THREE.MeshStandardMaterial({ color: 0x9b7653, roughness: 0.9 }),
  cabin: new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.5, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3d4a57, roughness: 0.5, metalness: 0.5 }),
  window: new THREE.MeshStandardMaterial({ color: 0x23384f, emissive: 0x2a6fa8, emissiveIntensity: 0.6 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x5aa84b, roughness: 1, flatShading: true }),
  grass2: new THREE.MeshStandardMaterial({ color: 0x3f8a3c, roughness: 1, flatShading: true }),
  sand: new THREE.MeshStandardMaterial({ color: 0xead7a0, roughness: 1, flatShading: true }),
  rock: new THREE.MeshStandardMaterial({ color: 0x8a8d91, roughness: 1, flatShading: true }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1, flatShading: true }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 1, flatShading: true, side: THREE.DoubleSide }),
  cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.25 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd94141, roughness: 0.6 }),
};
const colorMats = new Map();
const colorMat = hex => { if (!colorMats.has(hex)) colorMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, flatShading: true })); return colorMats.get(hex); };
const GEO = {
  seg: new THREE.BoxGeometry(SEG * 0.98, 1.4, 2.6),
  deck: new THREE.BoxGeometry(SEG * 0.98, 0.16, 2.2),
  stripe: new THREE.BoxGeometry(SEG * 0.98, 0.28, 2.66),
  bow: (() => { const g = new THREE.ConeGeometry(1.35, 2.8, 4); g.rotateY(Math.PI / 4); g.rotateZ(-Math.PI / 2); g.scale(1, 0.75, 0.97); return g; })(),
  stern: new THREE.BoxGeometry(0.9, 1.4, 2.6),
  cabin: new THREE.BoxGeometry(2.3, 1.5, 1.7),
  bridge: new THREE.BoxGeometry(1.5, 0.8, 1.9),
  win: new THREE.BoxGeometry(1.52, 0.25, 1.95),
  mast: new THREE.CylinderGeometry(0.1, 0.12, 3.4, 5),
  flag: new THREE.PlaneGeometry(1.4, 0.85),
  turret: new THREE.CylinderGeometry(0.75, 0.85, 0.6, 8),
  barrel: new THREE.CylinderGeometry(0.12, 0.12, 2.2, 5),
  funnel: new THREE.CylinderGeometry(0.4, 0.5, 1.4, 8),
  debris: new THREE.BoxGeometry(0.5, 0.3, 0.4),
  shell: new THREE.SphereGeometry(0.6, 10, 8),
};

// ---------- ship ----------
function buildShip(len, color) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilts/sinks
  group.add(body);
  const half = (len * SEG) / 2;
  const segs = [];
  for (let j = 0; j < len; j++) {
    const x = (j - (len - 1) / 2) * SEG;
    const hull = new THREE.Group();
    hull.position.x = x;
    const h = new THREE.Mesh(GEO.seg, MAT.hull); h.position.y = 0.15; hull.add(h);
    const d = new THREE.Mesh(GEO.deck, MAT.deck); d.position.y = 0.92; hull.add(d);
    const st = new THREE.Mesh(GEO.stripe, colorMat(color)); st.position.y = 0.55; hull.add(st);
    body.add(hull);
    const letter = sprite(letterTex('?', 'own'), { scale: 2.7 });
    letter.position.set(x, 4.9, 0);
    letter.visible = false;
    body.add(letter);
    const fire = new THREE.Group(); fire.position.set(x, 1.2, 0); fire.visible = false; body.add(fire);
    for (let k = 0; k < 3; k++) {
      const f = sprite(glowTex(), { color: k === 2 ? 0xffd54a : 0xff6a1a, additive: true, scale: 1.6 });
      f.position.set((k - 1) * 0.6, 0.4, (k % 2) * 0.5 - 0.25); f.userData = { ph: Math.random() * 10, base: 1.5 + k * 0.3 };
      fire.add(f);
    }
    for (let k = 0; k < 3; k++) {
      const s = sprite(puffTex(), { color: 0x333333, opacity: 0.5, scale: 2 });
      s.userData = { smoke: true, ph: k / 3 };
      fire.add(s);
    }
    segs.push({ x, hull, letter, fire, state: null, pop: 0 });
  }
  const bow = new THREE.Mesh(GEO.bow, MAT.hull); bow.position.set(half + 1.3, 0.15, 0); body.add(bow);
  const stern = new THREE.Mesh(GEO.stern, MAT.hull); stern.position.set(-half - 0.45, 0.15, 0); body.add(stern);
  const sup = new THREE.Group();
  const mid = -SEG * 0.3;
  const cab = new THREE.Mesh(GEO.cabin, MAT.cabin); cab.position.set(mid, 1.75, 0); sup.add(cab);
  const br = new THREE.Mesh(GEO.bridge, MAT.cabin); br.position.set(mid + 0.2, 2.9, 0); sup.add(br);
  const wn = new THREE.Mesh(GEO.win, MAT.window); wn.position.set(mid + 0.2, 3.0, 0); sup.add(wn);
  const mast = new THREE.Mesh(GEO.mast, MAT.metal); mast.position.set(mid - 0.3, 4.4, 0); sup.add(mast);
  const flag = new THREE.Mesh(GEO.flag, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(mid - 1.05, 5.6, 0); sup.add(flag);
  if (len >= 4) { const fu = new THREE.Mesh(GEO.funnel, MAT.metal); fu.position.set(mid - 1.7, 2.0, 0); sup.add(fu); }
  if (len >= 5) {
    const tu = new THREE.Group(); tu.position.set(half - SEG * 0.8, 1.25, 0);
    tu.add(new THREE.Mesh(GEO.turret, MAT.metal));
    const b = new THREE.Mesh(GEO.barrel, MAT.metal); b.rotation.z = Math.PI / 2; b.position.set(1.2, 0.15, 0); tu.add(b);
    sup.add(tu);
  }
  if (len >= 7) {
    const tu = new THREE.Group(); tu.position.set(-half + SEG * 0.8, 1.25, 0); tu.rotation.y = Math.PI;
    tu.add(new THREE.Mesh(GEO.turret, MAT.metal));
    const b = new THREE.Mesh(GEO.barrel, MAT.metal); b.rotation.z = Math.PI / 2; b.position.set(1.2, 0.15, 0); tu.add(b);
    sup.add(tu);
  }
  body.add(sup);
  return { group, body, segs, bow, stern, sup, flag, sinking: 0, sunk: false, wreck: null, len, ph: Math.random() * 6 };
}

// ---------- islands ----------
function palm(r) {
  const g = new THREE.Group();
  const h = 4 + r() * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, h, 5), MAT.trunk);
  trunk.position.y = h / 2; g.add(trunk);
  g.rotation.z = (r() - 0.5) * 0.35; g.rotation.x = (r() - 0.5) * 0.35;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 3), MAT.leaf);
    leaf.scale.set(1, 1, 0.25);
    const piv = new THREE.Group(); piv.position.y = h; piv.rotation.y = (i / n) * Math.PI * 2;
    leaf.rotation.z = -Math.PI / 2 - 0.5; leaf.position.x = 1.8; leaf.position.y = -0.5;
    piv.add(leaf); g.add(piv);
  }
  return g;
}
function islandMesh(radius, seed, withLighthouse) {
  const r = rng(seed);
  const g = new THREE.Group();
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 1.22, 1.6, 18), MAT.sand);
  sand.position.y = 0.1; g.add(sand);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const s1 = r() * 10, s2 = r() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.2 * Math.sin(x * 4.1 + s1) * Math.cos(z * 3.7 + s2) + 0.08 * Math.sin(y * 7 + s1);
    p.setXYZ(i, x * k, Math.max(y, -0.2) * k, z * k);
  }
  geo.computeVertexNormals();
  const hill = new THREE.Mesh(geo, r() > 0.5 ? MAT.grass : MAT.grass2);
  const hh = radius * (0.35 + r() * 0.25);
  hill.scale.set(radius * 0.88, hh, radius * 0.88); hill.position.y = 0.4; g.add(hill);
  if (radius > 14 && !withLighthouse) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.32, 0), MAT.rock);
    rock.position.set((r() - 0.5) * radius * 0.4, hh * 0.85, (r() - 0.5) * radius * 0.4); rock.scale.y = 1.4; g.add(rock);
  }
  const palms = radius > 12 ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
  for (let i = 0; i < palms; i++) {
    const a = r() * Math.PI * 2, d = radius * (0.55 + r() * 0.35);
    const pt = palm(r);
    pt.position.set(Math.cos(a) * d, 1.0 + hh * (1 - d / radius) * 0.6, Math.sin(a) * d);
    g.add(pt);
  }
  for (let i = 0; i < 3; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + r() * 1.4, 0), MAT.rock);
    const a = r() * Math.PI * 2; rock.position.set(Math.cos(a) * radius * 1.1, 0.3, Math.sin(a) * radius * 1.1); g.add(rock);
  }
  if (withLighthouse) {
    const lh = new THREE.Group(); lh.position.y = hh * 0.9;
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(1.6 - i * 0.2, 1.8 - i * 0.2, 2.5, 12), i % 2 ? MAT.red : MAT.white);
      c.position.y = 1.25 + i * 2.5; lh.add(c);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.4, 12), MAT.window); top.position.y = 10.7; lh.add(top);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.6, 12), MAT.red); cap.position.y = 12.2; lh.add(cap);
    const light = sprite(glowTex(), { color: 0xfff2a8, additive: true, scale: 9, fog: false }); light.position.y = 10.7; lh.add(light);
    lh.userData.light = light;
    g.add(lh);
    g.userData.lighthouse = lh;
  }
  return g;
}

// ---------- ocean / sky shaders ----------
const OCEAN_VS = `
uniform float uTime;
varying vec3 vWorld; varying float vH; varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float a = 0.05 * wp.x + uTime * 0.9, b = 0.07 * wp.z + uTime * 1.1, c = 0.11 * (wp.x + wp.z) + uTime * 1.7;
  float h = 0.6 * sin(a) + 0.45 * sin(b) + 0.25 * sin(c);
  float dx = 0.03 * cos(a) + 0.0275 * cos(c);
  float dz = 0.0315 * cos(b) + 0.0275 * cos(c);
  wp.y += h;
  vH = h; vWorld = wp.xyz; vN = normalize(vec3(-dx * 3.0, 1.0, -dz * 3.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const OCEAN_FS = `
uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uSun;
uniform float uFogNear; uniform float uFogFar; uniform vec4 uIslands[28]; uniform int uCount;
varying vec3 vWorld; varying float vH; varying vec3 vN;
void main() {
  vec3 N = normalize(vN + vec3(0.05 * sin(vWorld.x * 0.7 + uTime * 2.1) * sin(vWorld.z * 0.5), 0.0, 0.05 * cos(vWorld.z * 0.8 + uTime * 1.7) * sin(vWorld.x * 0.4)));
  vec3 V = normalize(cameraPosition - vWorld);
  float shallow = 0.0; float foam = 0.0;
  for (int i = 0; i < 28; i++) {
    if (i >= uCount) break;
    vec4 isl = uIslands[i];
    float d = length(vWorld.xz - isl.xy) / isl.z;
    shallow = max(shallow, 1.0 - smoothstep(1.0, 2.0, d));
    float lap = 1.25 + 0.06 * sin(uTime * 1.5 + isl.x);
    foam = max(foam, smoothstep(lap - 0.12, lap, d) * (1.0 - smoothstep(lap, lap + 0.25, d)));
  }
  vec3 col = mix(uDeep, uShallow, clamp(vH * 0.18 + 0.25, 0.0, 1.0) * 0.45);
  col = mix(col, uShallow * 1.15, shallow * 0.9);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col = mix(col, uSky, fres * 0.55);
  vec3 R = reflect(-uSun, N);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, V), 0.0), 140.0) * 1.4;
  col = mix(col, vec3(1.0), smoothstep(0.95, 1.25, vH) * 0.3);
  col = mix(col, vec3(1.0), foam * 0.75);
  float dist = length(cameraPosition - vWorld);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SKY_VS = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.6));
  float s = max(dot(normalize(vDir), uSun), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(s, 400.0) * 2.0 + pow(s, 12.0) * 0.25);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// =====================================================================
export class World {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    const fogCol = new THREE.Color(0xcfe7f3);
    this.scene.fog = new THREE.Fog(fogCol, 380, 1150);
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 4000);

    this.sunDir = new THREE.Vector3(0.45, 0.6, 0.3).normalize();
    this.scene.add(new THREE.HemisphereLight(0xe3f4ff, 0x31566b, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
    sun.position.copy(this.sunDir).multiplyScalar(400);
    this.scene.add(sun);

    // sky
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(0x3f8fde) }, uHorizon: { value: fogCol.clone() }, uSun: { value: this.sunDir } },
    })));

    // ocean
    const og = new THREE.PlaneGeometry(2600, 2600, 230, 230); og.rotateX(-Math.PI / 2);
    this.oceanU = {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x0d4a7a) }, uShallow: { value: new THREE.Color(0x2fc4c9) },
      uSky: { value: new THREE.Color(0xbfe0f5) }, uFog: { value: fogCol.clone() }, uSun: { value: this.sunDir },
      uFogNear: { value: 380 }, uFogFar: { value: 1150 },
      uIslands: { value: Array.from({ length: 28 }, () => new THREE.Vector4(9999, 9999, 1, 0)) }, uCount: { value: 0 },
    };
    this.ocean = new THREE.Mesh(og, new THREE.ShaderMaterial({ vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, uniforms: this.oceanU }));
    this.scene.add(this.ocean);

    // clouds
    this.clouds = [];
    const cr = rng(7);
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      const n = 4 + Math.floor(cr() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + cr() * 7, 0), MAT.cloud);
        m.position.set(k * 7 - n * 3.5, cr() * 4, (cr() - 0.5) * 8); m.scale.y = 0.6; c.add(m);
      }
      c.position.set((cr() - 0.5) * 1400, 110 + cr() * 60, (cr() - 0.5) * 1400);
      c.userData.speed = 2 + cr() * 3;
      this.scene.add(c); this.clouds.push(c);
    }

    this.islands = new THREE.Group(); this.scene.add(this.islands);
    this.fleetsRoot = new THREE.Group(); this.scene.add(this.fleetsRoot);
    this.fxRoot = new THREE.Group(); this.scene.add(this.fxRoot);
    this.sectors = new Map();
    this.effects = [];
    this.layoutKey = null;
    this.islandKey = null;
    this.myId = null;
    this.selectedId = null;
    this.turnId = null;
    this.revealAll = false;
    this.onPick = null;
    this.shake = 0;
    this.time = 0;
    this.idleSpin = true;
    this.viewShift = 0;

    // camera rig
    this.cam = { target: new THREE.Vector3(), theta: 0.6, phi: 0.95, dist: 520 };
    this.goal = { target: new THREE.Vector3(), theta: 0.6, phi: 0.95, dist: 520 };
    this.lastUserMove = 0;
    this.buildIslands(6);
    this.initInput();
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.applyView();
  }
  // Shift the picture up so the action isn't hidden behind the bottom control panel.
  setViewShift(px) { if (px === this.viewShift) return; this.viewShift = px; this.applyView(); }
  applyView() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.viewShift) this.camera.setViewOffset(w, h, 0, this.viewShift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ---------- layout ----------
  sectorAngle(i, n) { return -Math.PI / 2 + (i / n) * Math.PI * 2; }

  buildIslands(n) {
    const key = String(n);
    if (this.islandKey === key) return;
    this.islandKey = key;
    this.islands.clear();
    const r = rng(1234 + n * 17);
    const list = [];
    list.push({ x: 0, z: 0, rad: 20, light: true });
    for (let i = 0; i < 3; i++) { const a = r() * Math.PI * 2; list.push({ x: Math.cos(a) * 48, z: Math.sin(a) * 48, rad: 7 + r() * 5 }); }
    const slots = Math.max(n, 2);
    for (let i = 0; i < slots; i++) {
      const a = this.sectorAngle(i + 0.5, slots);
      const d = SECTOR_R * (0.95 + r() * 0.25);
      list.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad: 11 + r() * 7 });
      const d2 = SECTOR_R * 0.55;
      if (r() > 0.35) list.push({ x: Math.cos(a) * d2, z: Math.sin(a) * d2, rad: 6 + r() * 4 });
    }
    let tries = 0;
    while (list.length < 26 && tries++ < 200) {
      const a = r() * Math.PI * 2, d = 250 + r() * 260;
      const c = { x: Math.cos(a) * d, z: Math.sin(a) * d, rad: 10 + r() * 18 };
      if (list.every(o => Math.hypot(o.x - c.x, o.z - c.z) > o.rad + c.rad + 30)) list.push(c);
    }
    list.forEach((o, i) => {
      const m = islandMesh(o.rad, 99 + i * 31 + n, !!o.light);
      m.position.set(o.x, 0, o.z);
      m.rotation.y = r() * 6;
      this.islands.add(m);
      if (o.light) this.lighthouse = m.userData.lighthouse;
      this.oceanU.uIslands.value[i].set(o.x, o.z, o.rad, 0);
    });
    this.oceanU.uCount.value = list.length;
  }

  // Rebuild sectors (one per competitor). Fleets are built when their ship lengths are known.
  layout(players) {
    const comps = players.filter(p => !p.spectator);
    const n = comps.length;
    const key = comps.map(p => `${p.id}:${p.color}:${p.fleet.map(s => s.len).join('.')}`).join('|');
    if (key === this.layoutKey) return false;
    this.layoutKey = key;
    this.buildIslands(Math.max(n, 2));
    for (const s of this.sectors.values()) this.fleetsRoot.remove(s.group);
    this.sectors.clear();
    comps.forEach((p, i) => {
      const a = this.sectorAngle(i, Math.max(n, 2));
      const center = new THREE.Vector3(Math.cos(a) * SECTOR_R, 0, Math.sin(a) * SECTOR_R);
      const group = new THREE.Group();
      group.position.copy(center);
      group.rotation.y = Math.PI / 2 - a; // local +z points outward (toward the focus camera)
      this.fleetsRoot.add(group);
      const N = p.fleet.length;
      const depth = Math.max(N, 3) * SHIP_GAP;
      const sec = { id: p.id, angle: a, center, group, ships: [], color: p.color, fog: [], depth };
      // buoy + name label on the far side
      const buoy = new THREE.Group(); buoy.position.set(0, 0, -depth / 2 - 7);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), MAT.metal); pole.position.y = 4.5; buoy.add(pole);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshStandardMaterial({ color: p.color, side: THREE.DoubleSide }));
      fl.position.set(1.7, 7.8, 0); buoy.add(fl);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 1.6, 10), colorMat(p.color)); base.position.y = 0.3; buoy.add(base);
      group.add(buoy);
      sec.flag = fl; sec.buoy = buoy;
      sec.label = sprite(labelTex(p.name, p.color, false), { fog: false });
      sec.label.scale.set(26, 6.5, 1);
      sec.label.position.set(0, 15, -depth / 2 - 7);
      sec.labelKey = '';
      group.add(sec.label);
      // selection + turn rings
      const ringGeo = new THREE.RingGeometry(36, 38.5, 64); ringGeo.rotateX(-Math.PI / 2);
      sec.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      sec.ring.position.y = 1.4; sec.ring.visible = false; group.add(sec.ring);
      const tGeo = new THREE.RingGeometry(40, 41.5, 64); tGeo.rotateX(-Math.PI / 2);
      sec.turnRing = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
      sec.turnRing.position.y = 1.3; sec.turnRing.visible = false; group.add(sec.turnRing);
      // invisible pick disc
      const pg = new THREE.CircleGeometry(40, 24); pg.rotateX(-Math.PI / 2);
      sec.picker = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      sec.picker.position.y = 2; sec.picker.userData.playerId = p.id; group.add(sec.picker);
      // ships
      p.fleet.forEach((s, i2) => {
        const ship = buildShip(s.len, p.color);
        ship.group.position.set(0, 0, (i2 - (N - 1) / 2) * SHIP_GAP);
        group.add(ship.group);
        sec.ships.push(ship);
      });
      // fog banks (hide enemy waters)
      for (let k = 0; k < 7; k++) {
        const f = sprite(puffTex(), { color: 0xeef6fb, opacity: 0.0, scale: 22 + Math.random() * 10 });
        f.position.set((Math.random() - 0.5) * 50, 2 + Math.random() * 2, (Math.random() - 0.5) * depth);
        f.userData = { ph: Math.random() * 6, x0: f.position.x };
        group.add(f); sec.fog.push(f);
      }
      this.sectors.set(p.id, sec);
    });
    return true;
  }

  // ---------- sync from server state ----------
  sync(state, opts = {}) {
    this.myId = state.you;
    const me = state.players.find(p => p.id === state.you);
    this.spectator = !!(me && me.spectator);
    const battle = state.phase === 'battle' || state.phase === 'over' || state.phase === 'setup';
    const players = state.phase === 'lobby' ? state.players.map(p => ({ ...p, fleet: [] })) : state.players;
    const rebuilt = this.layout(players);
    this.turnId = state.turnId;
    const over = state.phase === 'over';
    for (const p of players) {
      const sec = this.sectors.get(p.id);
      if (!sec) continue;
      const own = p.id === state.you;
      const open = own || over || (this.spectator && this.revealAll);
      const dead = state.phase !== 'lobby' && state.phase !== 'setup' && !p.alive;
      const lk = `${p.name}|${dead}|${p.connected}`;
      if (lk !== sec.labelKey) {
        sec.labelKey = lk;
        sec.label.material.map = labelTex((dead ? '☠ ' : '') + p.name + (p.connected ? '' : ' (offline)'), p.color, dead || !p.connected);
        sec.label.material.needsUpdate = true;
      }
      sec.fogTarget = (!own && battle && !over && !(this.spectator && this.revealAll)) ? 0.22 : 0;
      sec.ring.visible = p.id === this.selectedId;
      sec.turnRing.visible = p.id === state.turnId;
      p.fleet.forEach((s, i) => {
        const ship = sec.ships[i];
        if (!ship) return;
        // superstructure & bow/stern only show for open fleets or sunk ships
        const shipOpen = open || s.sunk;
        if (s.sunk && !ship.sunk) {
          ship.sunk = true;
          if (rebuilt || opts.instant) this.finishSink(ship, s, sec);
          else this.startSink(ship, s, sec);
        }
        if (!s.sunk && ship.sunk) { // back to lobby / new layout
          ship.sunk = false; ship.sinking = 0; ship.body.position.y = 0; ship.body.rotation.set(0, 0, 0); ship.group.visible = true;
          if (ship.wreck) { ship.group.parent && ship.group.parent.remove(ship.wreck); ship.wreck = null; }
        }
        ship.sup.visible = shipOpen || (s.hits.filter(Boolean).length >= Math.ceil(s.len / 2));
        ship.bow.visible = shipOpen || s.hits[s.len - 1];
        ship.stern.visible = shipOpen || s.hits[0];
        s.letters.forEach((ch, j) => {
          const seg = ship.segs[j];
          let st;
          if (s.sunk) st = 'sunk';
          else if (s.hits[j]) st = 'hit';
          else if (open) st = 'own';
          else if (ch && s.sonar[j]) st = 'sonar';
          else st = 'hidden';
          const letter = ch || (over ? '?' : null);
          this.setSeg(seg, st, letter, sec, opts.instant || rebuilt);
        });
      });
    }
    // camera defaults when layout changes
    if (rebuilt) {
      if (state.phase === 'lobby') this.idleSpin = true;
      else { this.idleSpin = false; this.overview(true); }
    }
  }

  setSeg(seg, st, ch, sec, instant) {
    const key = `${st}:${ch}`;
    if (seg.state === key) return;
    const prev = seg.state ? seg.state.split(':')[0] : null;
    seg.state = key;
    seg.hull.visible = st !== 'hidden' && st !== 'sonar';
    seg.fire.visible = st === 'hit';
    if (ch && st !== 'hidden') {
      seg.letter.visible = true;
      seg.letter.material.map = letterTex(ch, st === 'hidden' ? 'own' : st);
      seg.letter.material.needsUpdate = true;
    } else seg.letter.visible = false;
    if (!instant && prev && prev !== st) {
      seg.pop = 1;
      if (prev === 'hit' && (st === 'hidden' || st === 'own')) this.steam(this.segWorld(seg));
    }
  }

  segWorld(seg) {
    const v = new THREE.Vector3(seg.x, 1.2, 0);
    return seg.hull.parent.localToWorld(v);
  }
  shipWorld(ship) { return ship.group.localToWorld(new THREE.Vector3(0, 1, 0)); }

  startSink(ship, s, sec) {
    ship.segs.forEach((seg, j) => this.setSeg(seg, 'sunk', s.letters[j] || '?', sec, true));
    ship.sup.visible = ship.bow.visible = ship.stern.visible = true;
    ship.segs.forEach(seg => { seg.hull.visible = true; seg.fire.visible = false; });
    ship.sinking = 0.0001;
    ship.word = s.letters.map(c => c || '?').join('');
    const p = this.shipWorld(ship);
    for (let i = 0; i < 4; i++) setTimeout(() => this.explosion(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * ship.len * SEG, 0, (Math.random() - 0.5) * 2)), 0.8), i * 250);
  }
  finishSink(ship, s, sec) {
    ship.word = s.letters.map(c => c || '?').join('');
    ship.sinking = 0; ship.group.visible = false;
    this.addWreck(ship);
  }
  addWreck(ship) {
    if (ship.wreck) return;
    const w = sprite(wreckTex(ship.word), { opacity: 0.92 });
    const len = ship.word.length;
    w.scale.set(1.25 * len + 0.8, 1.5, 1);
    w.position.copy(ship.group.position); w.position.y = 2.2;
    ship.group.parent.add(w);
    ship.wreck = w;
  }

  // ---------- selection / camera ----------
  setSelected(id) {
    this.selectedId = id;
    for (const [pid, sec] of this.sectors) sec.ring.visible = pid === id;
  }
  setRevealAll(v) { this.revealAll = v; }

  overview(snap) {
    const me = this.sectors.get(this.myId);
    const n = this.sectors.size || 6;
    const theta = me ? me.angle : 0.6;
    this.goal.target.set(0, 0, 0);
    this.goal.theta = theta; this.goal.phi = 0.82; this.goal.dist = n > 4 ? 460 : 400;
    if (snap) { this.cam.target.copy(this.goal.target); Object.assign(this.cam, { theta: this.goal.theta, phi: this.goal.phi, dist: this.goal.dist }); }
  }
  focus(id, dist) {
    const sec = this.sectors.get(id);
    if (!sec) return;
    this.goal.target.copy(sec.center).setY(2);
    this.goal.theta = sec.angle; this.goal.phi = 0.92; this.goal.dist = dist || Math.max(70, sec.depth * 2.4);
    this.idleSpin = false;
  }
  userRecentlyMoved() { return performance.now() - this.lastUserMove < 2500; }

  initInput() {
    const el = this.renderer.domElement;
    const ptrs = new Map();
    let down = null, pinch = 0;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = { x: e.clientX, y: e.clientY, btn: e.button, moved: 0, shift: e.shiftKey };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId) || !down) return;
      const prev = ptrs.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (down.moved < 4) return;
      this.lastUserMove = performance.now(); this.idleSpin = false;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.goal.dist = Math.min(700, Math.max(35, this.goal.dist * pinch / d));
        pinch = d; return;
      }
      if (down.btn === 2 || down.shift) { // pan
        const k = this.cam.dist * 0.0016;
        const fwd = new THREE.Vector3(-Math.cos(this.cam.theta), 0, -Math.sin(this.cam.theta));
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        this.goal.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
        this.goal.target.clampLength(0, 600);
      } else {
        this.goal.theta += dx * 0.006;
        this.goal.phi = Math.min(1.38, Math.max(0.2, this.goal.phi - dy * 0.005));
      }
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (down && down.moved < 6 && e.type === 'pointerup' && down.btn === 0) this.pick(e.clientX, e.clientY);
      if (!ptrs.size) down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.lastUserMove = performance.now(); this.idleSpin = false;
      this.goal.dist = Math.min(700, Math.max(35, this.goal.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    }, { passive: false });
  }

  pick(x, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), this.camera);
    const hits = ray.intersectObjects([...this.sectors.values()].map(s => s.picker), false);
    if (hits.length && this.onPick) this.onPick(hits[0].object.userData.playerId);
  }

  // ---------- effects ----------
  addFx(update) { this.effects.push(update); }

  puff(pos, { color = 0x777777, size = 3, grow = 3, life = 1.5, rise = 3, opacity = 0.6, vel = null } = {}) {
    const s = sprite(puffTex(), { color, opacity, scale: size });
    s.position.copy(pos);
    this.fxRoot.add(s);
    let t = 0;
    const v = vel ? vel.clone() : new THREE.Vector3();
    this.addFx(dt => {
      t += dt; const k = t / life;
      if (k >= 1) { this.fxRoot.remove(s); s.material.dispose(); return false; }
      s.position.addScaledVector(v, dt); s.position.y += rise * dt;
      s.scale.setScalar(size + grow * k);
      s.material.opacity = opacity * (1 - k);
      return true;
    });
  }

  flash(pos, { color = 0xffa040, size = 14, life = 0.45 } = {}) {
    const s = sprite(glowTex(), { color, additive: true, scale: 1, fog: false });
    s.position.copy(pos); this.fxRoot.add(s);
    let t = 0;
    this.addFx(dt => {
      t += dt; const k = t / life;
      if (k >= 1) { this.fxRoot.remove(s); s.material.dispose(); return false; }
      s.scale.setScalar(size * (0.3 + k)); s.material.opacity = 1 - k * k;
      return true;
    });
  }

  explosion(pos, scale = 1) {
    this.flash(pos.clone().setY(pos.y + 1), { size: 13 * scale });
    this.flash(pos.clone().setY(pos.y + 2), { color: 0xffe08a, size: 7 * scale, life: 0.3 });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(GEO.debris, MAT.hullDark);
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * 16, 8 + Math.random() * 12, (Math.random() - 0.5) * 16).multiplyScalar(scale);
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.fxRoot.add(m);
      let t = 0;
      this.addFx(dt => {
        t += dt; v.y -= 30 * dt; m.position.addScaledVector(v, dt);
        m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt;
        if (m.position.y < -1 || t > 2) { this.fxRoot.remove(m); return false; }
        return true;
      });
    }
    for (let i = 0; i < 5; i++) this.puff(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + i * 0.5, (Math.random() - 0.5) * 3)), { color: i < 2 ? 0x553322 : 0x444444, size: 3 * scale, grow: 7 * scale, life: 1.6 + Math.random(), rise: 4 });
    this.shake = Math.max(this.shake, 0.9 * scale);
  }

  splash(pos, scale = 1) {
    for (let i = 0; i < 14; i++) {
      const s = sprite(glowTex(), { color: 0xe8f8ff, scale: 1.4 * scale, opacity: 0.9 });
      s.position.copy(pos).setY(0.5);
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 10 + Math.random() * 12, (Math.random() - 0.5) * 5).multiplyScalar(scale);
      this.fxRoot.add(s);
      let t = 0;
      this.addFx(dt => {
        t += dt; v.y -= 28 * dt; s.position.addScaledVector(v, dt);
        s.material.opacity = Math.max(0, 0.9 - t * 0.6);
        if (s.position.y < 0 && v.y < 0) { this.fxRoot.remove(s); s.material.dispose(); return false; }
        return true;
      });
    }
    const rg = new THREE.RingGeometry(0.8, 1.4, 32); rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(pos).setY(1.0); this.fxRoot.add(ring);
    let t = 0;
    this.addFx(dt => {
      t += dt; ring.scale.setScalar(1 + t * 10 * scale); ring.material.opacity = 0.8 * (1 - t / 1.2);
      if (t > 1.2) { this.fxRoot.remove(ring); rg.dispose(); ring.material.dispose(); return false; }
      return true;
    });
    this.puff(pos.clone().setY(1.5), { color: 0xffffff, size: 4 * scale, grow: 6, life: 1.2, rise: 2, opacity: 0.5 });
  }

  steam(pos) {
    for (let i = 0; i < 6; i++) setTimeout(() => this.puff(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)), { color: 0xffffff, size: 2, grow: 5, life: 1.8, rise: 5, opacity: 0.65 }), i * 90);
    this.flash(pos, { color: 0x7fe3ff, size: 8, life: 0.6 });
  }

  dome(id, color = 0x6fe3ff) {
    const sec = this.sectors.get(id); if (!sec) return;
    const g = new THREE.SphereGeometry(40, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: false }));
    const wf = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, wireframe: true, depthWrite: false }));
    m.position.copy(sec.center); wf.position.copy(sec.center);
    this.fxRoot.add(m); this.fxRoot.add(wf);
    let t = 0;
    this.addFx(dt => {
      t += dt; const k = t / 1.6;
      const o = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      m.material.opacity = 0.35 * o; wf.material.opacity = 0.6 * o;
      m.scale.setScalar(1 + 0.03 * Math.sin(t * 30) * o);
      if (k >= 1) { this.fxRoot.remove(m); this.fxRoot.remove(wf); g.dispose(); m.material.dispose(); wf.material.dispose(); return false; }
      return true;
    });
  }

  smokeScreen(id) {
    const sec = this.sectors.get(id); if (!sec) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 32;
      const p = sec.center.clone().add(new THREE.Vector3(Math.cos(a) * d, 2 + Math.random() * 4, Math.sin(a) * d));
      setTimeout(() => this.puff(p, { color: 0xb8c0c8, size: 10, grow: 14, life: 3 + Math.random(), rise: 1.5, opacity: 0.75 }), i * 35);
    }
  }

  sonarPing(id) {
    const sec = this.sectors.get(id); if (!sec) return;
    for (let k = 0; k < 3; k++) {
      setTimeout(() => {
        const rg = new THREE.RingGeometry(1, 1.8, 64); rg.rotateX(-Math.PI / 2);
        const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x36d6ff, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
        ring.position.copy(sec.center).setY(1.6); this.fxRoot.add(ring);
        let t = 0;
        this.addFx(dt => {
          t += dt; ring.scale.setScalar(1 + t * 28); ring.material.opacity = 0.9 * (1 - t / 1.4);
          if (t > 1.4) { this.fxRoot.remove(ring); rg.dispose(); ring.material.dispose(); return false; }
          return true;
        });
      }, k * 350);
    }
  }

  reconPlane(fromId, toId) {
    const a = this.sectors.get(fromId), b = this.sectors.get(toId); if (!b) return Promise.resolve();
    const plane = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 6, 6), MAT.cabin); body.rotation.z = Math.PI / 2; plane.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.15, 8), MAT.cabin); plane.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.15), MAT.red); tail.position.set(-2.7, 0.7, 0); plane.add(tail);
    const start = (a ? a.center.clone() : new THREE.Vector3()).setY(30);
    const end = b.center.clone().multiplyScalar(1.8).setY(30);
    this.fxRoot.add(plane);
    return new Promise(res => {
      let t = 0;
      this.addFx(dt => {
        t += dt; const k = t / 3;
        plane.position.lerpVectors(start, end, k);
        plane.lookAt(end); plane.rotateY(-Math.PI / 2);
        if (k > 0.45 && !plane.userData.pinged) { plane.userData.pinged = true; this.sonarPing(toId); }
        if (k >= 1) { this.fxRoot.remove(plane); res(); return false; }
        return true;
      });
    });
  }

  shoot(from, to, { duration = 1.3, arc = 0.35, color = 0xff8a3d } = {}) {
    const shell = new THREE.Mesh(GEO.shell, MAT.hullDark);
    const glow = sprite(glowTex(), { color, additive: true, scale: 4, fog: false });
    shell.add(glow);
    this.fxRoot.add(shell);
    const dist = from.distanceTo(to);
    const h = Math.max(15, dist * arc);
    let t = 0, trail = 0;
    return new Promise(res => {
      this.addFx(dt => {
        t += dt; const k = Math.min(1, t / duration);
        shell.position.lerpVectors(from, to, k);
        shell.position.y += Math.sin(Math.PI * k) * h;
        trail += dt;
        if (trail > 0.03) { trail = 0; this.puff(shell.position, { color: 0xdddddd, size: 1.2, grow: 2.5, life: 0.9, rise: 0.5, opacity: 0.5 }); }
        if (k >= 1) { this.fxRoot.remove(shell); glow.material.dispose(); res(); return false; }
        return true;
      });
    });
  }

  fireworks(id) {
    const sec = this.sectors.get(id) || { center: new THREE.Vector3() };
    const cols = [0xff4d6d, 0xf2c14e, 0x2ec4b6, 0x9b5de5, 0x4ea8de, 0xffffff];
    for (let b = 0; b < 10; b++) {
      setTimeout(() => {
        const p = sec.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 35 + Math.random() * 25, (Math.random() - 0.5) * 60));
        const col = cols[b % cols.length];
        this.flash(p, { color: col, size: 20, life: 0.5 });
        for (let i = 0; i < 26; i++) {
          const s = sprite(glowTex(), { color: col, additive: true, scale: 1.6, fog: false });
          s.position.copy(p); this.fxRoot.add(s);
          const v = new THREE.Vector3().randomDirection().multiplyScalar(14 + Math.random() * 8);
          let t = 0;
          this.addFx(dt => {
            t += dt; v.y -= 9 * dt; v.multiplyScalar(0.985); s.position.addScaledVector(v, dt);
            s.material.opacity = 1 - t / 1.8;
            if (t > 1.8) { this.fxRoot.remove(s); s.material.dispose(); return false; }
            return true;
          });
        }
      }, b * 280);
    }
  }

  // ---------- play a server event ----------
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async playEvent(ev, opts = {}) {
    const auto = opts.autoCam && !this.userRecentlyMoved();
    const src = this.sectors.get(ev.from);
    const dst = this.sectors.get(ev.to);
    const from = src ? src.center.clone().setY(6) : new THREE.Vector3(0, 30, 0);
    if (ev.type === 'letter' || ev.type === 'word') {
      if (!dst) return;
      if (auto) this.focus(ev.to);
      await this.sleep(auto ? 350 : 0);
      if (ev.result === 'evaded') this.smokeScreen(ev.to);
      const shots = [];
      if (ev.type === 'word') {
        const ship = dst.ships[ev.ship];
        const to = ship ? this.shipWorld(ship) : dst.center.clone();
        if (!ev.correct) to.add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, 4));
        await this.shoot(from, to, { duration: 1.4, color: 0x7fe3ff });
        if (ev.correct && ship) {
          for (let j = 0; j < ship.segs.length; j++) {
            const seg = ship.segs[j];
            this.setSeg(seg, 'hit', ev.word[j], dst, false);
            this.explosion(this.segWorld(seg), 0.8);
            opts.onImpact && opts.onImpact('hit');
            await this.sleep(110);
          }
        } else { this.splash(to); opts.onImpact && opts.onImpact(ev.result === 'evaded' ? 'evaded' : 'miss'); }
      } else if (ev.result === 'hit') {
        ev.hits.forEach((h, n) => {
          const ship = dst.ships[h.ship];
          if (!ship) return;
          const seg = ship.segs[h.pos];
          shots.push(this.sleep(n * 160).then(() => this.shoot(from, this.segWorld(seg), { duration: 1.25 })).then(() => {
            this.setSeg(seg, 'hit', ev.letter, dst, false);
            this.explosion(this.segWorld(seg), 1);
            opts.onImpact && opts.onImpact('hit');
          }));
        });
        await Promise.all(shots);
      } else if (ev.result === 'blocked') {
        const to = dst.center.clone().setY(28);
        await this.shoot(from, to, { duration: 1.2, arc: 0.2 });
        this.dome(ev.to); this.explosion(to, 0.7);
        opts.onImpact && opts.onImpact('blocked');
      } else {
        const to = dst.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 30)).setY(0);
        await this.shoot(from, to, { duration: 1.25 });
        this.splash(to);
        opts.onImpact && opts.onImpact(ev.result);
      }
      await this.sleep(ev.sunk && ev.sunk.length ? 900 : 450);
    } else if (ev.type === 'repair') {
      const sec = this.sectors.get(ev.who);
      const ship = sec && sec.ships[ev.ship];
      if (ship) this.steam(this.segWorld(ship.segs[ev.pos]));
    } else if (ev.type === 'smoke') {
      this.smokeScreen(ev.who);
    } else if (ev.type === 'sonar') {
      if (auto) this.focus(ev.to);
      this.sonarPing(ev.to);
      await this.sleep(700);
    } else if (ev.type === 'recon') {
      if (auto) this.focus(ev.to, 140);
      await this.reconPlane(ev.who, ev.to);
    } else if (ev.type === 'gameover') {
      if (ev.winner) { this.focus(ev.winner, 110); this.fireworks(ev.winner); }
      await this.sleep(1500);
    }
  }

  // ---------- frame ----------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    this.oceanU.uTime.value = t;

    // camera
    if (this.idleSpin) this.goal.theta += dt * 0.04;
    const k = 1 - Math.exp(-dt * 3.2);
    this.cam.target.lerp(this.goal.target, k);
    this.cam.theta += angDiff(this.cam.theta, this.goal.theta) * k;
    this.cam.phi = lerp(this.cam.phi, this.goal.phi, k);
    this.cam.dist = lerp(this.cam.dist, this.goal.dist, k);
    const c = this.cam;
    this.camera.position.set(
      c.target.x + c.dist * Math.sin(c.phi) * Math.cos(c.theta),
      c.target.y + c.dist * Math.cos(c.phi),
      c.target.z + c.dist * Math.sin(c.phi) * Math.sin(c.theta),
    );
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
    }
    this.camera.lookAt(c.target);

    // clouds
    for (const cl of this.clouds) { cl.position.x += cl.userData.speed * dt; if (cl.position.x > 800) cl.position.x = -800; }
    if (this.lighthouse) {
      const l = this.lighthouse.userData.light;
      l.material.opacity = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2));
    }

    // fleets
    for (const sec of this.sectors.values()) {
      sec.flag.rotation.y = Math.sin(t * 3 + sec.angle) * 0.3;
      const pulse = 0.6 + 0.4 * Math.sin(t * 4);
      sec.ring.material.opacity = 0.5 + 0.4 * pulse;
      sec.ring.rotation.y = t * 0.3;
      sec.turnRing.material.opacity = 0.4 + 0.5 * pulse;
      sec.label.position.y = 15 + Math.sin(t * 1.5 + sec.angle) * 0.6;
      sec.buoy.position.y = wave(sec.center.x, sec.center.z, t) * 0.5;
      for (const f of sec.fog) {
        f.material.opacity = lerp(f.material.opacity, sec.fogTarget || 0, 1 - Math.exp(-dt * 1.5));
        f.position.x = f.userData.x0 + Math.sin(t * 0.2 + f.userData.ph) * 6;
      }
      for (const ship of sec.ships) {
        const wp = ship.group.getWorldPosition(new THREE.Vector3());
        ship.group.position.y = wave(wp.x, wp.z, t) * 0.55;
        ship.group.rotation.x = Math.sin(t * 0.9 + ship.ph) * 0.035;
        ship.group.rotation.z = Math.sin(t * 0.7 + ship.ph * 2) * 0.02;
        if (ship.sinking > 0) {
          ship.sinking += dt / 3.2;
          const s = Math.min(1, ship.sinking);
          ship.body.rotation.z = -0.35 * easeInOut(s);
          ship.body.rotation.x = 0.12 * s;
          ship.body.position.y = -9 * easeInOut(s);
          if (Math.random() < 0.3) this.puff(wp.clone().add(new THREE.Vector3((Math.random() - 0.5) * ship.len * 2.5, 0.5, 0)), { color: 0xffffff, size: 1, grow: 1.5, life: 0.8, rise: 3, opacity: 0.6 });
          if (ship.sinking >= 1) { ship.sinking = 0; ship.group.visible = false; this.addWreck(ship); }
        }
        if (ship.wreck) ship.wreck.position.y = 2.2 + wave(wp.x, wp.z, t) * 0.4;
        for (const seg of ship.segs) {
          if (seg.pop > 0) { seg.pop = Math.max(0, seg.pop - dt * 2.5); }
          const sc = 2.7 * (1 + seg.pop * 0.8);
          seg.letter.scale.set(sc, sc, 1);
          if (seg.fire.visible) {
            for (const f of seg.fire.children) {
              const u = f.userData;
              if (u.smoke) {
                const ph = (t * 0.45 + u.ph) % 1;
                f.position.set(Math.sin(ph * 6 + u.ph * 9) * 0.4, 1 + ph * 7, 0);
                f.scale.setScalar(1.5 + ph * 4);
                f.material.opacity = 0.55 * (1 - ph);
              } else {
                const s = u.base * (0.8 + 0.35 * Math.sin(t * 18 + u.ph) + 0.15 * Math.sin(t * 31 + u.ph * 2));
                f.scale.set(s, s * 1.4, 1);
              }
            }
          }
        }
      }
    }

    // effects
    this.effects = this.effects.filter(fn => fn(dt));
    this.renderer.render(this.scene, this.camera);
  }
}
