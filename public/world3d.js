/* MAFIA: THE VILLAGE — 3D world (three.js): walk the village, enter houses, eye / chase / overview cameras */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
const dampAng = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
const ease = t => t * t * (3 - 2 * t);
function mulb(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = (a, b) => a + Math.random() * (b - a);
const ROLE_ICON = { mafia: '🔪', detective: '🕵️', doctor: '💉', villager: '🧑‍🌾' };

const World = { S: null, inGame: false, mode: null, onclick: null, sfx: null, camMode: 'chase', onCam: null, time: 0 };
window.World = World;

// ======================= renderer / scene =======================
const cv = document.getElementById('cv');
const COARSE = matchMedia('(pointer: coarse)').matches, LOW = COARSE || (navigator.hardwareConcurrency || 8) <= 4;   // phones & weak laptops get a lighter, cooler renderer
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !COARSE, powerPreference: COARSE ? 'default' : 'high-performance' });
let PIXR = COARSE ? 1 : Math.min(devicePixelRatio || 1, 1.25); renderer.setPixelRatio(PIXR);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = LOW ? THREE.BasicShadowMap : THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
cv.style.touchAction = 'none';
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfe4ff, 0.0075);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying vec3 vP;uniform vec3 top,mid,bot;void main(){float h=vP.y;vec3 c=h>0.?mix(mid,top,pow(h,.5)):mix(mid,bot,pow(-h,.45));gl_FragColor=vec4(c,1.);}'
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat); sky.renderOrder = -10; scene.add(sky);
const starGeo = new THREE.BufferGeometry(); { const a = []; const r = mulb(3); for (let i = 0; i < 900; i++) { const th = r() * TAU, ph = Math.acos(r() * .98 + .02); a.push(Math.sin(ph) * Math.cos(th) * 480, Math.cos(ph) * 480, Math.sin(ph) * Math.sin(th) * 480); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); scene.add(stars);

function ctex(w, h, draw, rep, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } t.anisotropy = 4; return t; }
const RADIAL = ctex(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xfff1b0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true })); sunSprite.scale.set(120, 120, 1); scene.add(sunSprite);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xcfdcff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true })); moonSprite.scale.set(80, 80, 1); scene.add(moonSprite);
const moonDisk = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xf4f1dc, fog: false })); scene.add(moonDisk);

// lights
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6a8b4a, .7); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2d8, 3); key.castShadow = true; key.shadow.mapSize.set(LOW ? 512 : 1024, LOW ? 512 : 1024);
Object.assign(key.shadow.camera, { left: -54, right: 54, top: 54, bottom: -54, near: 1, far: 260 }); key.shadow.bias = -0.0004; key.shadow.normalBias = .05;
scene.add(key); scene.add(key.target);

// ======================= textures & materials =======================
const grassTex = ctex(512, 512, (g, w, h) => { g.fillStyle = '#5d9a3a'; g.fillRect(0, 0, w, h); const r = mulb(1); for (let i = 0; i < 6000; i++) { const l = 28 + r() * 30; g.fillStyle = `hsla(${88 + r() * 30},${45 + r() * 25}%,${l}%,.5)`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 3 + r() * 5); } }, [90, 90]);
const dirtTex = ctex(256, 256, (g, w, h) => { g.fillStyle = '#b39468'; g.fillRect(0, 0, w, h); const r = mulb(2); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${90 + r() * 90},${70 + r() * 70},${40 + r() * 40},.35)`; g.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 3); } }, [10, 10]);
const cobbleTex = ctex(512, 512, (g, w, h) => { g.fillStyle = '#7d776b'; g.fillRect(0, 0, w, h); const r = mulb(4); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = (y % 2) * 16; const v = 150 + r() * 70; g.fillStyle = `rgb(${v},${v - 6},${v - 18})`; g.beginPath(); g.roundRect(x * 32 + o - 16 + 1.5, y * 32 + 1.5, 29, 29, 8); g.fill(); } }, [5, 5]);
const plasterTex = ctex(256, 256, (g, w, h) => { g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h); const r = mulb(5); for (let i = 0; i < 3000; i++) { const v = 205 + r() * 50; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6); } }, [2, 1]);
const roofTex = ctex(64, 256, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.1)'); g.fillStyle = gr; g.fillRect(0, y, w, 16); } }, [1, 1]);
const woodTex = ctex(256, 256, (g, w, h) => { g.fillStyle = '#9a6a3c'; g.fillRect(0, 0, w, h); const r = mulb(6); for (let x = 0; x < w; x += 32) { g.fillStyle = `rgba(0,0,0,${.12 + r() * .12})`; g.fillRect(x, 0, 2, h); for (let k = 0; k < 20; k++) { g.fillStyle = `rgba(60,30,10,${r() * .2})`; g.fillRect(x + 3 + r() * 24, r() * h, 1.5, 6 + r() * 20); } } }, [2, 2]);
const stdM = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0, ...o });
const M = { dirt: stdM(0xffffff, { map: dirtTex }), cobble: stdM(0xffffff, { map: cobbleTex, roughness: .9 }), wood: stdM(0xffffff, { map: woodTex }), woodDark: stdM('#5a3a20'), stone: stdM('#b9b3a4', { roughness: .95 }), cream: stdM('#f3e9d2'), brick: stdM('#a65a4a'), white: stdM('#f5f5f5'), black: stdM('#1b1b22'), concrete: stdM('#9d9a94') };

// ======================= static scenery =======================
const R = mulb(11);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), stdM(0xffffff, { map: grassTex, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const RING = 34, PLAZA = 15;
function flatDisc(r0, r1, m, y, seg = 64) { const g = new THREE.Mesh(new THREE.RingGeometry(r0, r1, seg), m); g.rotation.x = -Math.PI / 2; g.position.y = y; g.receiveShadow = true; scene.add(g); return g; }
flatDisc(0, PLAZA, M.cobble, .03);
{ const rim = flatDisc(PLAZA, PLAZA + .5, M.stone, .05); }
{ const road = flatDisc(25, 29, M.dirt, .02, 96); M.dirt.map.repeat.set(30, 3); }

// merge helper: list of {geo, color, pos, rot, scale}
function mergeBits(bits, mat) {
  const geos = bits.map(b => { let g = b.geo.clone(); const m = new THREE.Matrix4().compose(b.pos || new THREE.Vector3(), new THREE.Quaternion().setFromEuler(b.rot || new THREE.Euler()), b.scale || new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m); const c = new THREE.Color(b.color), n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (g.index) g = g.toNonIndexed(); return g; });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
const circles = []; // {x,z,r} static colliders
// trees
{
  const vm = stdM(0xffffff, { vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  const bits = [];
  const sph = new THREE.IcosahedronGeometry(1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 7), cone = new THREE.ConeGeometry(1, 1, 8);
  const addTree = (x, z, kind, s) => {
    if (kind === 'palm') {
      const h = 7 + R() * 4, lean = (R() - .5) * .5, dir = R() * TAU;
      for (let k = 0; k < 6; k++) { const t = k / 6; bits.push({ geo: cyl, color: '#8a6a45', pos: new THREE.Vector3(x + Math.cos(dir) * lean * t * t * h, h * t + h / 12, z + Math.sin(dir) * lean * t * t * h), scale: new THREE.Vector3(.28 - t * .1, h / 6 + .1, .28 - t * .1) }); }
      const tx = x + Math.cos(dir) * lean * h, tz = z + Math.sin(dir) * lean * h;
      for (let f = 0; f < 9; f++) { const a = f / 9 * TAU; bits.push({ geo: cone, color: f % 2 ? '#2f8f3a' : '#3fa44a', pos: new THREE.Vector3(tx + Math.cos(a) * 1.5, h + .15, tz + Math.sin(a) * 1.5), rot: new THREE.Euler(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25 + 0), scale: new THREE.Vector3(.35, 3.6, .1) }); }
      bits.push({ geo: sph, color: '#6b4a1f', pos: new THREE.Vector3(tx, h - .1, tz), scale: new THREE.Vector3(.35, .35, .35) });
    } else {
      const h = (3 + R() * 2) * s;
      bits.push({ geo: cyl, color: '#6e4b2c', pos: new THREE.Vector3(x, h / 2, z), scale: new THREE.Vector3(.35 * s, h, .35 * s) });
      for (let k = 0; k < 4; k++) bits.push({ geo: sph, color: k % 2 ? '#3d8f3d' : '#4fa64a', pos: new THREE.Vector3(x + (R() - .5) * 2 * s, h + 1 * s + (R() - .3) * 1.8, z + (R() - .5) * 2 * s), scale: new THREE.Vector3(1.9 * s, 1.6 * s, 1.9 * s) });
    }
  };
  for (let i = 0; i < (LOW ? 70 : 110); i++) {
    const a = R() * TAU, d = 44 + Math.pow(R(), .7) * 110, x = Math.cos(a) * d, z = Math.sin(a) * d;
    addTree(x, z, R() < .45 ? 'palm' : 'round', .8 + R() * .7); if (d < 70) circles.push({ x, z, r: .6 });
  }
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + .3; addTree(Math.cos(a) * (PLAZA + 2.5), Math.sin(a) * (PLAZA + 2.5), 'palm', 1); circles.push({ x: Math.cos(a) * (PLAZA + 2.5), z: Math.sin(a) * (PLAZA + 2.5), r: .6 }); }
  scene.add(mergeBits(bits, vm));
}
// grass tufts + flowers
{
  const blade = ctex(64, 64, (g, w, h) => { for (let i = 0; i < 7; i++) { const x = 8 + i * 8; g.fillStyle = `hsl(${95 + i * 6},55%,${30 + i * 3}%)`; g.beginPath(); g.moveTo(x - 3, h); g.quadraticCurveTo(x, h * .4, x + (i % 2 ? 6 : -6), 6); g.quadraticCurveTo(x + 1, h * .5, x + 3, h); g.fill(); } });
  const bits = [], q = new THREE.PlaneGeometry(.9, .7);
  for (let i = 0; i < (LOW ? 700 : 1400); i++) { const a = R() * TAU, d = Math.sqrt(R()) * 120; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (d < PLAZA + 1 || (d > 24.5 && d < 29.5)) continue; const s = .7 + R() * .9, r = R() * 3; bits.push({ geo: q, color: '#ffffff', pos: new THREE.Vector3(x, .3 * s, z), rot: new THREE.Euler(0, r, 0), scale: new THREE.Vector3(s, s, s) }); bits.push({ geo: q, color: '#ffffff', pos: new THREE.Vector3(x, .3 * s, z), rot: new THREE.Euler(0, r + 1.57, 0), scale: new THREE.Vector3(s, s, s) }); }
  const m = mergeBits(bits, new THREE.MeshStandardMaterial({ map: blade, alphaTest: .45, side: THREE.DoubleSide, vertexColors: true, roughness: 1 })); m.castShadow = false; scene.add(m);
  const fb = [], dot = new THREE.IcosahedronGeometry(.1, 0), cols = ['#ff6fa0', '#ffe066', '#ffffff', '#c9a7ff', '#ff9f5a'];
  for (let i = 0; i < (LOW ? 200 : 400); i++) { const a = R() * TAU, d = Math.sqrt(R()) * 90; if (d < PLAZA + 1) continue; fb.push({ geo: dot, color: cols[Math.floor(R() * 5)], pos: new THREE.Vector3(Math.cos(a) * d, .22, Math.sin(a) * d), scale: new THREE.Vector3(1, 1, 1) }); }
  const fm = mergeBits(fb, stdM(0xffffff, { vertexColors: true })); fm.castShadow = false; scene.add(fm);
}
// distant hills
for (let i = 0; i < 22; i++) { const a = i / 22 * TAU + R(), d = 230 + R() * 60, s = 40 + R() * 60; const h = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), stdM(R() < .5 ? '#4d8d55' : '#3f7c52', { roughness: 1 })); h.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); h.scale.set(s * 1.7, s * (.5 + R() * .5), s * 1.7); scene.add(h); }
// well
const wellLight = new THREE.PointLight(0x88ccff, 0, 20, 2); wellLight.position.set(0, 2.6, 0); scene.add(wellLight);
const waterMat = new THREE.MeshStandardMaterial({ color: '#3aa0e8', roughness: .1, metalness: .2, emissive: '#1a6ab0', emissiveIntensity: .25 });
{
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.05, 1, 28, 1, true), M.stone); ring.position.y = .5; ring.castShadow = ring.receiveShadow = true; g.add(ring);
  const ringIn = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1, 28, 1, true), M.stone); ringIn.material = M.stone.clone(); ringIn.material.side = THREE.BackSide; ringIn.position.y = .5; g.add(ringIn);
  const top = new THREE.Mesh(new THREE.TorusGeometry(1.97, .12, 8, 28), M.stone); top.rotation.x = Math.PI / 2; top.position.y = 1; g.add(top);
  const w = new THREE.Mesh(new THREE.CircleGeometry(1.85, 28), waterMat); w.rotation.x = -Math.PI / 2; w.position.y = .82; g.add(w);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 3, 8), M.woodDark); p.position.set(s * 1.8, 2.3, 0); p.castShadow = true; g.add(p); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.1, 4), stdM('#b5443a')); roof.position.y = 4.3; roof.rotation.y = Math.PI / 4; roof.scale.z = .6; roof.castShadow = true; g.add(roof);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(.25, .2, .35, 10), M.wood); bucket.position.set(0, 2.2, 0); g.add(bucket);
  scene.add(g); circles.push({ x: 0, z: 0, r: 2.3 });
}
// market stalls
const stripeTex = ctex(64, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#fff'; g.fillRect(i * 8, 0, 8, h); g.fillStyle = i % 2 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.35)'; g.fillRect(i * 8, 0, 8, h); } });
[[0.8, '#e63946'], [2.4, '#2a9d8f'], [3.95, '#f4a261'], [5.5, '#4361ee']].forEach(([a, col], k) => {
  const x = Math.cos(a) * 10.5, z = Math.sin(a) * 10.5, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z) + Math.PI;
  const tab = new THREE.Mesh(new THREE.BoxGeometry(3, .9, 1.2), M.wood); tab.position.y = .45; tab.castShadow = tab.receiveShadow = true; g.add(tab);
  for (const sx of [-1.4, 1.4]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 2.6, 6), M.woodDark); p.position.set(sx, 1.3, -.5); p.castShadow = true; g.add(p); }
  const can = new THREE.Mesh(new THREE.ConeGeometry(2.4, .9, 8), stdM(col, { map: stripeTex, side: THREE.DoubleSide })); can.position.set(0, 2.7, -.2); can.scale.set(1.15, 1, .7); can.castShadow = true; g.add(can);
  const goods = ['#ff7043', '#ffd54f', '#66bb6a', '#ab47bc'];
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.17, 8, 6), stdM(goods[(i + k) % 4])); m.position.set(-1.2 + i * .3, 1.0, (i % 2) * .25 - .1); g.add(m); }
  scene.add(g); circles.push({ x, z, r: 1.7 });
});
// danfo bus (Lagos yellow bus) outside the ring
{
  const g = new THREE.Group(); const y = stdM('#f2c200'), bl = stdM('#161616');
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2, 5.6), y); b.position.y = 1.55; g.add(b);
  const st = new THREE.Mesh(new THREE.BoxGeometry(2.32, .35, 5.62), bl); st.position.y = 1.45; g.add(st);
  const wi = new THREE.Mesh(new THREE.BoxGeometry(2.34, .8, 4.6), stdM('#6fa8c8', { roughness: .1, metalness: .3 })); wi.position.set(0, 2.1, -.1); g.add(wi);
  for (const [x, z] of [[-1.1, 1.7], [1.1, 1.7], [-1.1, -1.7], [1.1, -1.7]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, .35, 16), bl); w.rotation.z = Math.PI / 2; w.position.set(x, .5, z); g.add(w); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(-46, 0, 18); g.rotation.y = .5; scene.add(g); circles.push({ x: -46, z: 18, r: 3.2 });
}
// lamp posts (pooled point lights)
const lampLights = [], lampHeads = [];
for (let i = 0; i < 6; i++) {
  const a = i / 6 * TAU + .52, x = Math.cos(a) * 20.5, z = Math.sin(a) * 20.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 4.2, 8), stdM('#3a3646')); pole.position.set(x, 2.1, z); pole.castShadow = true; scene.add(pole);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 10), new THREE.MeshStandardMaterial({ color: '#fff4c8', emissive: '#ffcf7a', emissiveIntensity: 0 })); head.position.set(x, 4.4, z); scene.add(head); lampHeads.push(head);
  if (i % 2 === 0) { const L = new THREE.PointLight(0xffcf8a, 0, 22, 2); L.position.set(x, 4.3, z); scene.add(L); lampLights.push(L); }   // every other lamp lights the ground (fewer lights = cooler GPU)
}
const homeLight = new THREE.PointLight(0xffc27a, 0, 11, 2); scene.add(homeLight);
const atkLight = new THREE.PointLight(0xfff0d0, 0, 14, 2); scene.add(atkLight);   // the room light that gets switched on when the Mafia strike

// ======================= characters =======================
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .6, ...o });
function cfgFromLook(p) {
  let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) | 0; h = Math.abs(h);
  const hairs = ['lowcut', 'braids', 'bun', 'bald', 'default'];
  return { figure: h % 2 ? 'female' : 'male', skin: p.look.skin, hair: p.look.hat === 'gele' ? 'bald' : hairs[h % hairs.length], hairColor: ['#1b120d', '#2a1a12', '#0d0907', '#3b2417'][h % 4], top: p.look.color, bottom: ['#1f2937', '#334155', '#3f3f46', '#1e3a5f'][h % 4], shoes: '#20202a', height: .97 + (h % 7) / 100, hat: p.look.hat, glasses: h % 5 === 0, pat: p.look.pat };
}
const DARKC = new THREE.Color('#06060b');
class Character {
  constructor(cfg) {
    this.cfg = cfg; this.root = new THREE.Group(); this.speed = 0; this.phase = 0; this.lie = 0; this.talk = 0; this.activity = 'idle'; this.running = false; this.blinkT = 1 + Math.random() * 4; this.seed = Math.random() * 10; this.sm = {}; this.mats = [];
    this.parts = this.build(cfg); this.root.scale.setScalar(cfg.height * (cfg.figure === 'female' ? .96 : 1));
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  }
  M(c, o) { const m = mat(c, o); this.mats.push(m); return m; }
  build(a) {
    const fem = a.figure === 'female', rig = new THREE.Group(); this.root.add(rig);
    const skin = this.M(a.skin), topM = this.M(a.top, { roughness: .55 }), pants = this.M(a.bottom), shoe = this.M(a.shoes);
    const legs = {};
    [-1, 1].forEach(side => {
      const hip = new THREE.Group(); hip.position.set(side * .1, .88, 0); rig.add(hip);
      const th = new THREE.Mesh(new THREE.CapsuleGeometry(.078, .3, 6, 12), pants); th.position.y = -.21; hip.add(th);
      const knee = new THREE.Group(); knee.position.y = -.43; hip.add(knee);
      const sh = new THREE.Mesh(new THREE.CapsuleGeometry(.068, .28, 6, 12), pants); sh.position.y = -.19; knee.add(sh);
      const foot = new THREE.Group(); foot.position.y = -.4; knee.add(foot);
      const f = new THREE.Mesh(new THREE.BoxGeometry(.13, .08, .26), shoe); f.position.set(0, -.01, .05); foot.add(f);
      legs[side < 0 ? 'hipL' : 'hipR'] = hip; legs[side < 0 ? 'kneeL' : 'kneeR'] = knee; legs[side < 0 ? 'footL' : 'footR'] = foot;
    });
    const torso = new THREE.Group(); torso.position.y = .86; rig.add(torso);
    const chest = new THREE.Group(); torso.add(chest);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(fem ? .2 : .21, .44, 6, 16), topM); body.position.y = .4; body.scale.set(fem ? .95 : 1, 1, .74); chest.add(body);
    const sho = new THREE.Mesh(new THREE.SphereGeometry(.24, 20, 12, 0, TAU, 0, Math.PI / 2), topM); sho.position.y = .7; sho.scale.set(fem ? 1 : 1.08, .5, .78); chest.add(sho);
    if (a.pat === 1) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.215, .215, .06, 16, 1, true), this.M('#ffffff')); s.position.y = .5; s.scale.set(1, 1, .76); chest.add(s); const s2 = s.clone(); s2.position.y = .3; chest.add(s2); }
    if (a.pat === 2) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.215, .215, .07, 16, 1, true), this.M('#ffd24a')); b.position.y = .2; b.scale.set(1, 1, .76); chest.add(b); }
    const arms = {};
    [-1, 1].forEach(side => {
      const sh = new THREE.Group(); sh.position.set(side * (fem ? .265 : .28), .72, 0); chest.add(sh);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(.062, .2, 6, 12), topM); up.position.y = -.14; sh.add(up);
      const el = new THREE.Group(); el.position.y = -.3; sh.add(el);
      const fo = new THREE.Mesh(new THREE.CapsuleGeometry(.054, .18, 6, 12), skin); fo.position.y = -.12; el.add(fo);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.056, 12, 12), skin); hand.position.y = -.27; el.add(hand);
      sh.rotation.z = side * .1; arms[side < 0 ? 'armL' : 'armR'] = sh; arms[side < 0 ? 'elbL' : 'elbR'] = el;
    });
    const head = new THREE.Group(); head.position.y = .92; chest.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, .12, 12), skin); neck.position.y = -.06; head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(.17, 24, 20), skin); skull.position.y = .1; skull.scale.set(1, 1.08, 1); head.add(skull);
    [-1, 1].forEach(sd => { const e = new THREE.Mesh(new THREE.SphereGeometry(.034, 10, 10), skin); e.position.set(sd * .17, .09, 0); head.add(e); });
    const eyeM = new THREE.MeshStandardMaterial({ color: '#111' });
    const eyes = [-1, 1].map(sd => { const e = new THREE.Mesh(new THREE.SphereGeometry(.021, 10, 10), eyeM); e.position.set(sd * .06, .12, .155); head.add(e); return e; });
    const smile = new THREE.Mesh(new THREE.TorusGeometry(.04, .008, 6, 12, Math.PI), this.M('#4a1d10')); smile.position.set(0, .05, .16); smile.rotation.z = Math.PI; head.add(smile);
    if (a.glasses) [-1, 1].forEach(sd => { const r = new THREE.Mesh(new THREE.TorusGeometry(.04, .007, 6, 18), this.M('#111827')); r.position.set(sd * .06, .12, .165); head.add(r); });
    const hairG = new THREE.Group(); head.add(hairG); this.buildHair(a, hairG); this.buildHat(a, hairG);
    // ---- night outfits: shown on anyone who is out after dark
    // Mafia: a full black hooded jacket, hood up, mask with glowing eyes — head to toe black (the whole body gets tinted black too)
    const blackM = new THREE.MeshStandardMaterial({ color: '#0a0a0f', roughness: .95, side: THREE.DoubleSide });
    const hoodCap = new THREE.Mesh(new THREE.SphereGeometry(.215, 18, 14), blackM); hoodCap.position.set(0, .1, -.02); hoodCap.scale.set(1.03, 1.12, 1.1); head.add(hoodCap);
    const hoodPeak = new THREE.Mesh(new THREE.ConeGeometry(.15, .22, 10), blackM); hoodPeak.position.set(0, .3, -.1); hoodPeak.rotation.x = -.45; head.add(hoodPeak);
    const hoodRim = new THREE.Mesh(new THREE.TorusGeometry(.17, .045, 8, 18), blackM); hoodRim.position.set(0, .1, .07); hoodRim.scale.set(1, 1.15, 1); head.add(hoodRim);
    const maskM = new THREE.Mesh(new THREE.SphereGeometry(.15, 14, 12), new THREE.MeshBasicMaterial({ color: '#000' })); maskM.position.set(0, .09, .1); maskM.scale.set(1, 1.1, .6); head.add(maskM);
    const re = [-1, 1].map(sd => { const e = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 8), new THREE.MeshBasicMaterial({ color: '#ff2040' })); e.position.set(sd * .055, .12, .17); head.add(e); return e; });
    const jacket = new THREE.Mesh(new THREE.CapsuleGeometry(.235, .5, 6, 16), blackM); jacket.position.y = .4; jacket.scale.set(1, 1, .8); chest.add(jacket);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, .14, 12, 1, true), blackM); collar.position.y = .86; chest.add(collar);
    // Detective: trench coat + fedora
    const coatM = this.M('#8a7656', { side: THREE.DoubleSide });
    const coat = new THREE.Mesh(new THREE.CapsuleGeometry(.245, .56, 6, 16), coatM); coat.position.y = .38; coat.scale.set(1.04, 1, .84); chest.add(coat);
    const coatHem = new THREE.Mesh(new THREE.CylinderGeometry(.25, .285, .46, 14, 1, true), coatM); coatHem.position.y = -.2; chest.add(coatHem);
    const fedoraM = this.M('#3a3226'); const crown = new THREE.Mesh(new THREE.CylinderGeometry(.115, .13, .16, 16), fedoraM); crown.position.set(0, .34, 0); head.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .018, 22), fedoraM); brim.position.set(0, .27, 0); head.add(brim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.132, .132, .04, 16), this.M('#14110c')); band.position.set(0, .3, 0); head.add(band);
    // Doctor: white coat, head mirror and a bag
    const whiteM = this.M('#f2f4f8', { side: THREE.DoubleSide });
    const lab = new THREE.Mesh(new THREE.CapsuleGeometry(.245, .56, 6, 16), whiteM); lab.position.y = .38; lab.scale.set(1.04, 1, .84); chest.add(lab);
    const labHem = new THREE.Mesh(new THREE.CylinderGeometry(.25, .27, .4, 14, 1, true), whiteM); labHem.position.y = -.17; chest.add(labHem);
    const mirror = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .012, 14), this.M('#cfd8e3', { metalness: .8, roughness: .2 })); mirror.position.set(0, .22, .16); mirror.rotation.x = Math.PI / 2 - .3; head.add(mirror);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .1), this.M('#5a3a22')); bag.position.set(0, -.34, .05); arms.elbL.add(bag);
    this.suits = { mafia: [hoodCap, hoodPeak, hoodRim, maskM, ...re, jacket, collar], detective: [coat, coatHem, crown, brim, band], doctor: [lab, labHem, mirror, bag] };
    Object.values(this.suits).forEach(a => a.forEach(o => { o.visible = false; }));
    this.hairG = hairG; this.skullParts = [skull, smile]; this._suit = null;
    return { rig, torso, chest, head, eyes, ...legs, ...arms };
  }
  buildHair(a, head) {
    const hm = this.M(a.hairColor, { roughness: .95 });
    const cap = (r, ph, y, rx) => { const c = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16, 0, TAU, 0, Math.PI * ph), hm); c.position.y = y; c.rotation.x = rx; head.add(c); };
    switch (a.hair) {
      case 'lowcut': cap(.176, .45, .13, -.3); break; case 'bald': break;
      case 'braids': cap(.18, .6, .12, -.4); for (let i = 0; i < 9; i++) { const ang = Math.PI * .25 + i * Math.PI * .5 / 8; const b = new THREE.Mesh(new THREE.CapsuleGeometry(.018, .26, 4, 6), hm); b.position.set(Math.cos(ang + Math.PI / 2) * .15, -.05, -Math.abs(Math.sin(ang + Math.PI / 2)) * .14 - .02); head.add(b); } break;
      case 'bun': cap(.178, .55, .12, -.35); { const b = new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 12), hm); b.position.set(0, .3, -.08); head.add(b); } break;
      default: cap(.178, .55, .12, -.35);
    }
  }
  buildHat(a, head) {
    const c = a.top; const m = this.M(c, { roughness: .6 });
    switch (a.hat) {
      case 'cap': { const d = new THREE.Mesh(new THREE.SphereGeometry(.185, 20, 12, 0, TAU, 0, Math.PI * .5), m); d.position.y = .14; head.add(d); const br = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .012, 16, 1, false, -Math.PI / 2, Math.PI), this.M('#222')); br.position.set(0, .14, .15); br.rotation.x = .1; head.add(br); break; }
      case 'beanie': { const d = new THREE.Mesh(new THREE.SphereGeometry(.19, 20, 12, 0, TAU, 0, Math.PI * .55), m); d.position.y = .13; head.add(d); const pm = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), this.M('#fff')); pm.position.y = .33; head.add(pm); break; }
      case 'gele': { const wm = this.M(c, { roughness: .7 }); const ring = new THREE.Mesh(new THREE.TorusGeometry(.16, .075, 10, 24), wm); ring.position.y = .22; ring.rotation.x = Math.PI / 2 - .25; head.add(ring); const top = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 10, 0, TAU, 0, Math.PI / 2), wm); top.position.y = .24; head.add(top); const fan = new THREE.Mesh(new THREE.ConeGeometry(.12, .24, 6), this.M('#ffffff', { roughness: .6 })); fan.position.set(.1, .36, 0); fan.rotation.z = -.7; head.add(fan); break; }
      case 'crown': { const gm = this.M('#ffd24a', { metalness: .8, roughness: .3 }); const r = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .08, 16, 1, true), gm); r.material.side = THREE.DoubleSide; r.position.y = .28; head.add(r); for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(.025, .09, 6), gm); const an = i / 6 * TAU; s.position.set(Math.cos(an) * .13, .35, Math.sin(an) * .13); head.add(s); } break; }
      case 'bow': { const bm = this.M(c); for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(.06, .12, 8), bm); w.rotation.z = -s * Math.PI / 2; w.position.set(.12 + s * .07, .27, .05); head.add(w); } break; }
      case 'tophat': { const tm = this.M('#25232f'); const t = new THREE.Mesh(new THREE.CylinderGeometry(.11, .12, .24, 16), tm); t.position.y = .4; head.add(t); const br = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .02, 20), tm); br.position.y = .28; head.add(br); const bd = new THREE.Mesh(new THREE.CylinderGeometry(.121, .121, .04, 16), m); bd.position.y = .31; head.add(bd); break; }
      case 'headband': { const t = new THREE.Mesh(new THREE.TorusGeometry(.17, .018, 6, 24), m); t.position.y = .17; t.rotation.x = Math.PI / 2 - .12; head.add(t); break; }
    }
  }
  setGhost(on) { if (this._ghost === on) return; this._ghost = on; for (const m of this.mats) { m.transparent = on; m.opacity = on ? .4 : 1; m.depthWrite = !on; m.emissive = new THREE.Color(on ? '#9fb4ff' : '#000000'); m.emissiveIntensity = on ? .5 : 0; } }
  setSuit(kind) {   // what someone out at night looks like (also visible as a black shape in the dark)
    if (this._suit === kind) return; this._suit = kind;
    for (const k in this.suits) for (const o of this.suits[k]) o.visible = k === kind;
    this.hairG.visible = !(kind === 'mafia' || kind === 'detective');
    this.apply();
  }
  apply() {
    const dark = this._sil || this._suit === 'mafia';
    for (const m of this.mats) { if (!m.userData.orig) m.userData.orig = m.color.clone(); m.color.copy(dark ? DARKC : m.userData.orig); m.roughness = dark ? 1 : .6; }
  }
  setSilhouette(on) { if (this._sil === on) return; this._sil = on; this.apply(); }   // in the dark you can't see colours or faces, only a dark figure
  setWeapon(w) {
    if (this._w === w) return; this._w = w;
    if (!this.wg) { this.wg = new THREE.Group(); this.parts.elbR.add(this.wg); this.wg.position.set(0, -.27, .04); }
    while (this.wg.children.length) this.wg.remove(this.wg.children[0]);
    if (!w) return;
    const steel = new THREE.MeshStandardMaterial({ color: '#d8dde6', metalness: .9, roughness: .25 }), dark = new THREE.MeshStandardMaterial({ color: '#1a1a22', roughness: .5 });
    if (w === 'knife') { const b = new THREE.Mesh(new THREE.BoxGeometry(.03, .26, .01), steel); b.position.set(0, -.12, .06); b.rotation.x = -1.2; this.wg.add(b); const hd = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .1, 6), dark); hd.rotation.x = -1.2; this.wg.add(hd); }
    else { const bar = new THREE.Mesh(new THREE.BoxGeometry(.04, .05, .22), dark); bar.position.set(0, -.02, .12); this.wg.add(bar); const gr = new THREE.Mesh(new THREE.BoxGeometry(.04, .13, .05), dark); gr.position.set(0, -.08, .03); this.wg.add(gr); }
    this.wg.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  update(dt, t) {
    const P = this.parts, k = Math.min(1, this.speed / 2.4), rk = clamp((this.speed - 2.6) / 1.6, 0, 1);
    this.phase += this.speed * dt * (this.running ? 4 : 4.8); const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const hipA = (.5 + rk * .3) * k, kneeA = (.9 + rk * .5) * k;
    P.hipL.rotation.x = -s * hipA; P.hipR.rotation.x = s * hipA; P.kneeL.rotation.x = Math.max(0, c) * kneeA + .05 * k; P.kneeR.rotation.x = Math.max(0, -c) * kneeA + .05 * k;
    P.footL.rotation.x = -P.kneeL.rotation.x * .35 + Math.max(0, -s) * .2 * k; P.footR.rotation.x = -P.kneeR.rotation.x * .35 + Math.max(0, s) * .2 * k;
    P.rig.position.y = k ? (Math.abs(c) * .035 - .025) * k : 0;
    let aL = s * (.45 + rk * .35) * k, eL = -.15 - (.2 + rk * .6) * k - Math.max(0, s) * .3 * k, aR = -s * (.45 + rk * .35) * k, eR = -.15 - (.2 + rk * .6) * k - Math.max(0, -s) * .3 * k, zL = -.1, zR = .1, lean = k * (.06 + rk * .12), hx = k ? -.04 : 0, hy = 0;
    const sd = this.seed, act = k > .2 ? 'idle' : this.activity; let tg = null;
    if (act === 'stab') tg = [-.3, -.2, -.1, -2.4 + Math.sin(t * 16) * .5, -.4, .1, .22, .1, 0];
    else if (act === 'hand') tg = [-.3, -.2, -.1, -2.95, -.15, .1, .05, -.05, 0];
    else if (act === 'scared') tg = [-.8, -1.5, -.4, -.8, -1.5, .4, -.1, -.2, Math.sin(t * 9) * .12];
    else if (act === 'talk') tg = [-.35, -1.0, -.1, -.45 + Math.sin(t * 3 + sd) * .25, -1.1, .1, .04, 0, Math.sin(t * .8 + sd) * .3];
    else if (act === 'look') tg = [-.05, -.15, -.1, -.05, -.15, .1, 0, -.05, Math.sin(t * .6 + sd) * .6];
    if (tg) { aL = tg[0]; eL = tg[1]; zL = tg[2]; aR = tg[3]; eR = tg[4]; zR = tg[5]; lean = tg[6]; hx = tg[7]; hy = tg[8]; }
    const sm = this.sm, kk = 9;
    for (const [n, v] of Object.entries({ aL, eL, zL, aR, eR, zR, lean, hx, hy })) sm[n] = sm[n] == null ? v : damp(sm[n], v, kk, dt);
    P.armL.rotation.x = sm.aL; P.elbL.rotation.x = sm.eL; P.armL.rotation.z = sm.zL; P.armR.rotation.x = sm.aR; P.elbR.rotation.x = sm.eR; P.armR.rotation.z = sm.zR;
    P.torso.rotation.x = sm.lean; P.chest.rotation.y = s * .1 * k;
    const br = Math.sin(t * 2.1 + sd) * (1 - k); P.chest.scale.set(1 + br * .012, 1 + br * .01, 1 + br * .015);
    P.head.rotation.y = sm.hy; P.head.rotation.x = sm.hx + Math.sin(t * 7) * .05 * this.talk;
    this.blinkT -= dt; const bl = this.blinkT < 0 ? .1 : 1; if (this.blinkT < -.12) this.blinkT = 2.5 + Math.random() * 3.5;
    const L = this.lie;
    if (L > .001) {
      P.rig.rotation.x = -(Math.PI / 2 - .1) * L; P.rig.position.y = P.rig.position.y * (1 - L) + .12 * L;
      for (const j of [P.hipL, P.hipR, P.kneeL, P.kneeR, P.footL, P.footR]) j.rotation.x *= 1 - L;
      P.armL.rotation.x *= 1 - L; P.armR.rotation.x *= 1 - L; P.elbL.rotation.x = P.elbL.rotation.x * (1 - L) - .12 * L; P.elbR.rotation.x = P.elbR.rotation.x * (1 - L) - .12 * L; P.torso.rotation.x *= 1 - L; P.head.rotation.x *= 1 - L; P.head.rotation.y *= 1 - L;
    } else P.rig.rotation.x = 0;
    P.eyes.forEach(e => e.scale.y = L > .8 ? .1 : bl);
  }
}

// ======================= houses =======================
const WALLS = ['#ffe9a8', '#ffd6c9', '#cdeedd', '#cfe6ff', '#fff6e6', '#ffd9ec', '#e2dcff', '#d9f2c8'];
const DOORS = ['#2f6f8f', '#b3472f', '#2f8a5a', '#7b4aa8', '#c28a1a'];
let houses = [], villageGroup = new THREE.Group(); scene.add(villageGroup);
const occluders = [];
function nameTex(name) { return ctex(256, 64, (g, w, h) => { g.fillStyle = '#7a4f2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#f7e2b8'; g.fillRect(5, 5, w - 10, h - 10); g.fillStyle = '#3b2210'; g.font = '700 34px Fredoka,Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name.length > 10 ? name.slice(0, 9) + '…' : name, w / 2, h / 2 + 2); }); }
const RIDGE_M = stdM('#3a3a44'), CEIL_M = stdM('#efe3cc'), TRIM_STONE = stdM('#c7ccd8');
function makeHouse(i, n, p) {
  const g = new THREE.Group(), ang = -Math.PI / 2 + Math.PI / n + i * TAU / n, x = Math.cos(ang) * RING, z = Math.sin(ang) * RING, yaw = Math.atan2(-Math.cos(ang), -Math.sin(ang));
  g.position.set(x, 0, z); g.rotation.y = yaw;
  const wallC = WALLS[(i * 3 + 1) % WALLS.length];
  const wallM = stdM(wallC, { map: plasterTex }), roofM = stdM(p.look.color, { map: roofTex, metalness: .35, roughness: .5 }), glass = new THREE.MeshStandardMaterial({ color: '#9fc6e8', emissive: '#ffcf7a', emissiveIntensity: 0, roughness: .15, side: THREE.DoubleSide });
  const roofTexI = roofTex.clone(); roofTexI.repeat.set(1, 8); roofTexI.needsUpdate = true; roofM.map = roofTexI;
  // ---- everything static is batched: one merged mesh per material (a handful of draw calls instead of ~60 per house)
  const batches = new Map(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const put = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, occ = false) => {
    _m.compose(_v.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s); let gg = geo.clone().applyMatrix4(_m); if (gg.index) gg = gg.toNonIndexed();
    const key = mat.uuid + (occ ? 'o' : ''); let b = batches.get(key); if (!b) { b = { mat, occ, list: [] }; batches.set(key, b); } b.list.push(gg);
  };
  const bx = (w, h, d, m, px, py, pz, occ = true, ry = 0) => put(new THREE.BoxGeometry(w, h, d), m, px, py, pz, 0, ry, 0, occ);
  bx(7.5, 3, .3, wallM, 0, 1.5, -3); bx(.3, 3, 6.3, wallM, -3.6, 1.5, 0); bx(.3, 3, 6.3, wallM, 3.6, 1.5, 0);
  const winWall = cx => { bx(3.1, 1.1, .3, wallM, cx, .55, 3); bx(3.1, .7, .3, wallM, cx, 2.65, 3); bx(.9, 1.2, .3, wallM, cx - 1.1, 1.7, 3); bx(.9, 1.2, .3, wallM, cx + 1.1, 1.7, 3); };
  winWall(-2.2); winWall(2.2); bx(1.3, .9, .3, wallM, 0, 2.55, 3);   // the two front windows are real openings you can look out of
  const tri = new THREE.Shape(); tri.moveTo(-3.9, 3); tri.lineTo(3.9, 3); tri.lineTo(0, 4.95); tri.closePath(); const triG = new THREE.ShapeGeometry(tri);
  put(triG, wallM, 0, 0, 3.0, 0, 0, 0, true); put(triG, wallM, 0, 0, -3.0, 0, Math.PI, 0, true);
  const run = 4.3, rise = 2.05, L = Math.hypot(run, rise), th = Math.atan2(rise, run), slab = new THREE.BoxGeometry(L, .14, 7.6);
  for (const s of [-1, 1]) put(slab, roofM, s * (run / 2 - .15), 3 + rise / 2 + .08, 0, 0, 0, -s * th, true);
  put(new THREE.BoxGeometry(.4, .16, 7.7), RIDGE_M, 0, 5.1, 0);
  put(new THREE.PlaneGeometry(6.9, 5.7), CEIL_M, 0, 2.98, 0, Math.PI / 2, 0, 0);
  put(new THREE.PlaneGeometry(6.9, 5.7), M.wood, 0, .03, 0, -Math.PI / 2, 0, 0);
  bx(2.2, .12, .9, M.concrete, 0, .06, 3.5, false); bx(.7, 1.8, .7, M.brick, 2.2, 4.8, -1.4, false);
  // ---- door (moves, so it stays its own mesh)
  const doorPivot = new THREE.Group(); doorPivot.position.set(-.6, 0, 3); g.add(doorPivot);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, .09), stdM(DOORS[i % DOORS.length], { map: woodTex })); leaf.position.set(.6, 1.05, 0); leaf.castShadow = true; doorPivot.add(leaf);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), stdM('#ffd24a', { metalness: .8, roughness: .3 })); knob.position.set(1.0, 1.0, .07); doorPivot.add(knob);
  // ---- windows
  const clear = new THREE.MeshStandardMaterial({ color: '#bcd8ee', transparent: true, opacity: .14, roughness: .05, metalness: .1, depthWrite: false, side: THREE.DoubleSide });
  const curtain = new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffb84a', emissiveIntensity: 0, transparent: true, opacity: 0, depthWrite: false });
  const flat = (gm, mt, px, py, pz, ry) => { const m = new THREE.Mesh(gm, mt); m.position.set(px, py, pz); m.rotation.y = ry; g.add(m); return m; };
  const paneG = new THREE.PlaneGeometry(1.25, 1.05), pane2G = new THREE.PlaneGeometry(1.3, 1.2);
  for (const cx of [-2.2, 2.2]) {
    flat(pane2G, clear, cx, 1.7, 3.0, 0); flat(pane2G, curtain, cx, 1.7, 2.84, 0);   // the curtain only faces outward: warm glow seen from outside, invisible from inside
    for (const [w, h2, ox, oy] of [[1.5, .08, 0, .64], [1.5, .08, 0, -.64], [.08, 1.3, -.7, 0], [.08, 1.3, .7, 0], [.04, 1.2, 0, 0], [1.3, .04, 0, 0]]) put(new THREE.BoxGeometry(w, h2, .12), M.wood, cx + ox, 1.7 + oy, 3.0);
  }
  const win = (px, py, pz, ry) => { put(new THREE.BoxGeometry(1.5, 1.3, .08), M.wood, px, py, pz, 0, ry, 0); const sx = Math.sin(ry), cz = Math.cos(ry); flat(paneG, glass, px + sx * .05, py, pz + cz * .05, ry); put(new THREE.BoxGeometry(.06, 1.05, .03), M.wood, px + sx * .07, py, pz + cz * .07, 0, ry, 0); put(new THREE.BoxGeometry(1.26, .06, .03), M.wood, px + sx * .07, py, pz + cz * .07, 0, ry, 0); };
  win(-3.77, 1.7, 0, -Math.PI / 2); win(3.77, 1.7, 0, Math.PI / 2);
  for (const s of [-1, 1]) flat(paneG, glass, s * 3.43, 1.7, 0, -s * Math.PI / 2);
  flat(paneG, glass, 0, 1.7, -2.83, 0); win(0, 1.7, -3.17, Math.PI);
  // ---- plaque, lantern, bedside lamp (these glow at night, so they are separate)
  const plaqM = new THREE.MeshBasicMaterial({ map: nameTex(p.name) }); const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.9, .48), plaqM); plaque.position.set(0, 3.55, 3.18); g.add(plaque);
  const bulbG = new THREE.SphereGeometry(.13, 10, 8);
  const lantern = new THREE.Mesh(bulbG, new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffbf5a', emissiveIntensity: 0 })); lantern.position.set(1.15, 2.2, 3.2); g.add(lantern);
  const lamp = new THREE.Mesh(bulbG, new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffbf5a', emissiveIntensity: 0 })); lamp.position.set(-1.25, .85, -2.5); g.add(lamp);
  // ---- furniture
  bx(1.25, .35, 2.3, M.wood, -2.3, .22, -1.8, false); bx(1.12, .2, 2.1, stdM(p.look.color, { roughness: .9 }), -2.3, .5, -1.8, false); bx(.85, .14, .45, M.white, -2.3, .66, -2.62, false); bx(1.14, .1, 1.1, stdM(new THREE.Color(p.look.color).multiplyScalar(.7), { roughness: .9 }), -2.3, .62, -1.35, false);
  bx(.5, .6, .5, M.wood, -1.2, .3, -2.55, false); bx(1.4, 2.0, .7, M.woodDark, 2.6, 1, -2.5, false); bx(1.5, .1, 1.1, M.wood, 2.3, .8, .2, false); for (const [dx, dz] of [[-.6, -.4], [.6, -.4], [-.6, .4], [.6, .4]]) bx(.08, .78, .08, M.woodDark, 2.3 + dx, .4, .2 + dz, false);
  bx(.5, .1, .5, M.wood, 1.2, .5, .3, false); bx(.5, .5, .5, M.wood, 1.2, .25, .3, false);
  put(new THREE.CylinderGeometry(1.4, 1.4, .02, 20), stdM(new THREE.Color(p.look.color).offsetHSL(.5, 0, .0), { roughness: 1 }), 0, .05, -.2);
  // ---- tombstone (appears when the owner dies)
  const tomb = new THREE.Group(); tomb.position.set(3.2, 0, 4.6); tomb.visible = false; g.add(tomb);
  const sl = new THREE.Mesh(new THREE.BoxGeometry(.8, 1.1, .2), TRIM_STONE); sl.position.y = .55; sl.castShadow = true; tomb.add(sl); const sc = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .2, 14, 1, false, 0, Math.PI), TRIM_STONE); sc.rotation.x = Math.PI / 2; sc.rotation.z = Math.PI / 2; sc.position.y = 1.1; tomb.add(sc);
  const cr = new THREE.Mesh(new THREE.BoxGeometry(.12, .5, .05), M.stone); cr.position.set(0, .65, .12); tomb.add(cr); const cr2 = new THREE.Mesh(new THREE.BoxGeometry(.4, .12, .05), M.stone); cr2.position.set(0, .75, .12); tomb.add(cr2);
  const mound = new THREE.Mesh(new THREE.SphereGeometry(.6, 10, 6, 0, TAU, 0, Math.PI / 2), stdM('#6d5a3a')); mound.scale.set(1, .3, 1.6); mound.position.set(0, 0, .7); tomb.add(mound);
  // ---- flush the batches
  for (const b of batches.values()) { const m = new THREE.Mesh(mergeGeometries(b.list), b.mat); m.castShadow = true; m.receiveShadow = true; g.add(m); if (b.occ) occluders.push(m); b.list.forEach(q => q.dispose()); }
  const pick = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 7), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 2.5; g.add(pick);
  g.traverse(o => { o.userData.owner = p.id; }); pick.userData.proxy = true;
  g.updateMatrixWorld(true);
  const cols = [[-3.75, 3.75, -3.15, -2.85], [-3.75, -3.45, -3.15, 3.15], [3.45, 3.75, -3.15, 3.15], [-3.75, -.65, 2.85, 3.15], [.65, 3.75, 2.85, 3.15], [-2.95, -1.65, -2.95, -.65], [1.9, 3.3, -2.9, -2.1], [1.5, 3.1, -.4, .8]];
  return { group: g, i, x, z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), glass, curtain, doorPivot, door: 0, tomb, cols, lantern, lamp, owner: p.id, smokeT: Math.random(), sparkT: 0, lit: false, plaqueM: plaqM };
}
const loc2w = (h, lx, lz) => new THREE.Vector3(h.x + lx * h.cos + lz * h.sin, 0, h.z - lx * h.sin + lz * h.cos);
const w2loc = (h, wx, wz) => { const dx = wx - h.x, dz = wz - h.z; return [dx * h.cos - dz * h.sin, dx * h.sin + dz * h.cos]; };
const inHouse = (h, wx, wz, m = 0) => { const [lx, lz] = w2loc(h, wx, wz); return lx > -3.45 + m && lx < 3.45 - m && lz > -2.85 + m && lz < 2.85 - m; };
let spokes = null;
function buildVillage(players) {
  villageGroup.traverse(o => { if (o.isMesh) { o.geometry && o.geometry.dispose(); } }); scene.remove(villageGroup); villageGroup = new THREE.Group(); scene.add(villageGroup);
  occluders.length = 0; houses = [];
  const n = players.length;
  players.forEach((p, i) => { const h = makeHouse(i, n, p); villageGroup.add(h.group); houses.push(h); });
  for (const h of houses) { const L = RING - 3.9 - PLAZA + 1; const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, L), M.dirt); s.rotation.x = -Math.PI / 2; s.rotation.z = Math.atan2(h.x, h.z) * -1 + Math.PI; s.rotation.order = 'YXZ'; s.rotation.set(-Math.PI / 2, 0, 0); const dir = new THREE.Vector3(-h.x, 0, -h.z).normalize(); const mid = new THREE.Vector3(h.x, 0, h.z).normalize().multiplyScalar(PLAZA - 1 + L / 2); s.position.set(mid.x, .025, mid.z); s.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.x, dir.z) + Math.PI); s.receiveShadow = true; villageGroup.add(s); }
}
// ======================= entities =======================
const ents = {};
const labelsEl = document.createElement('div'); labelsEl.id = 'labels'; document.body.appendChild(labelsEl);
const cutEl = document.createElement('div'); cutEl.id = 'cutText'; document.body.appendChild(cutEl);
const flashEl = document.createElement('div'); flashEl.id = 'flash'; document.body.appendChild(flashEl);
const markerGeo = new THREE.RingGeometry(.5, .62, 24);
function makeEnt(p) {
  const ch = new Character(cfgFromLook(p)); scene.add(ch.root);
  const tag = document.createElement('div'); tag.className = 'tag3'; labelsEl.appendChild(tag);
  const bub = document.createElement('div'); bub.className = 'bub3'; labelsEl.appendChild(bub);
  const cnt = document.createElement('div'); cnt.className = 'cnt3'; labelsEl.appendChild(cnt);
  const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide })); marker.rotation.x = -Math.PI / 2; marker.visible = false; scene.add(marker);
  return { id: p.id, ch, tag, bub, cnt, marker, p, locKey: null, route: [], tgt: null, pause: 0, lieT: 0, wantLie: false, inH: -1, yaw: 0, control: false, remote: null, bubT: -99, hidden: false, prevLoc: null, speedS: 0, lastPos: new THREE.Vector3(), spot: 0, finalLie: -1 };
}
function disposeEnt(e) { scene.remove(e.ch.root); scene.remove(e.marker); e.tag.remove(); e.bub.remove(); e.cnt.remove(); }
let sig = '';
function syncPlayers(players, demo) {
  const s = players.map(p => p.id + '|' + p.name + '|' + p.look.color).join(',');
  if (s !== sig) { sig = s; buildVillage(players); for (const id of Object.keys(ents)) if (!players.find(p => p.id === id)) { disposeEnt(ents[id]); delete ents[id]; } }
  for (const p of players) {
    if (!ents[p.id]) { const e = ents[p.id] = makeEnt(p); e.spot = p.house; initPlace(e, p, demo); }
    ents[p.id].p = p;
  }
}
const door = (i) => loc2w(houses[i], 0, 4.7);
const doorIn = (i) => loc2w(houses[i], 0, 2.2);
const bedStand = (i) => loc2w(houses[i], -1.0, -.95);
const bedFoot = (i) => loc2w(houses[i], -2.3, -.95);
const victimStand = (i) => loc2w(houses[i], -.7, -1.7);
function plazaSpot(i, n) { const a = i * 2.39996 + .6, r = 4 + 1.9 * Math.sqrt(i + .5) * (n > 10 ? .9 : 1.1); return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * .95); }
function placeLying(e, i) { const h = houses[i], f = bedFoot(i); e.ch.root.position.set(f.x, .5, f.z); e.yaw = h.yaw; e.ch.root.rotation.y = h.yaw; e.lieT = 1; e.ch.lie = 1; e.route = []; }
function initPlace(e, p, demo) {
  const loc = p.loc, i = p.house;
  if (loc === 'home') placeLying(e, i);
  else if (loc === 'plaza') { const s = plazaSpot(i, houses.length); e.ch.root.position.copy(s); e.yaw = Math.atan2(-s.x, -s.z); }
  else if (loc === 'meet') { e.ch.root.position.set(Math.cos(i) * 3, 0, Math.sin(i) * 3); }
  else { const d = door(i); e.ch.root.position.copy(d); }
  e.locKey = loc; e.prevLoc = loc;
}
function currentHouse(e) { const p = e.ch.root.position; for (const h of houses) { const dx = p.x - h.x, dz = p.z - h.z; if (dx * dx + dz * dz < 64 && inHouse(h, p.x, p.z, -.3)) return h.i; } return -1; }
function exitRoute(e) { // from wherever inside a house to its doorstep
  const j = currentHouse(e); const r = [];
  if (j >= 0) { if (e.lieT > .05) r.push({ stand: true, p: bedStand(j) }); r.push(bedStand(j)); r.push(doorIn(j)); r.push(door(j)); }
  return r;
}
function planRoute(e, p, viewerMafiaOrGod) {
  const loc = p.loc, i = p.house; let r = [];
  const j = currentHouse(e);
  if (loc === 'plaza') { r = exitRoute(e); if (!r.length || j >= 0) { const sp = plazaSpot(i, houses.length); const mid = door(j >= 0 ? j : i).clone().multiplyScalar(.6); if (j >= 0) r.push(mid); r.push(sp); } else r.push(plazaSpot(i, houses.length)); e.finalLie = -1; }
  else if (loc === 'home') {
    if (j === i) { r = [bedStand(i)]; }
    else { r = exitRoute(e); const here = e.ch.root.position; if (j >= 0) r.push(door(j).clone().multiplyScalar(.85)); r.push(door(i).clone().multiplyScalar(.85), door(i), doorIn(i), bedStand(i)); }
    e.finalLie = i;
  }
  else if (loc === 'meet') { r = exitRoute(e); const mafs = (World.S ? World.S.players.filter(q => q.loc === 'meet') : []), k = Math.max(0, mafs.findIndex(q => q.id === p.id)), a = k / Math.max(1, mafs.length) * TAU; if (j >= 0) r.push(door(j).clone().multiplyScalar(.8)); r.push(new THREE.Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2)); e.finalLie = -1; }
  else if (loc.startsWith('at:')) { const K = +loc.slice(3); r = exitRoute(e); if (j >= 0) r.push(door(j).clone().multiplyScalar(.85)); const d = door(K), side = K < houses.length / 2 ? -1 : 1; const off = loc2w(houses[K], 2.6 * side, 5.6); r.push(off); e.finalLie = -1; }
  else if (loc.startsWith('in:')) { const K = +loc.slice(3); r = exitRoute(e); r.push(door(K), doorIn(K), victimStand(K)); e.finalLie = -1; }
  e.route = r.map(x => x.stand ? x : { p: x }); e.route = e.route.map(x => x.p ? x : { p: x });
  if (e.route.some(x => x.stand)) { e.route.forEach(x => { x.stand = x.stand || false; }); }
}
const AUTO_SPEED = 5.2;
// local player / free camera
const me = { control: false, anchor: new THREE.Vector3(0, 2, 26), yawVel: 0, path: [], stuck: 0 };
const keys = {}; let joy = { x: 0, y: 0 };
const cam = { mode: 'chase', yaw: 0, pitch: .28, dist: 4.6, eyeUp: -.05, topYaw: .6, topDist: 46, topPitch: .95, lastDrag: -99, cutLook: null, pos: new THREE.Vector3(0, 5, 20), look: new THREE.Vector3(), snap: true };
function myEnt() { return World.S ? ents[World.S.you.id] : null; }
function isGodView() { return !World.S || World.S.god || World.S.you.watcher || !World.inGame; }
World.setCam = m => { cam.mode = m; World.camMode = m; if (m === 'chase') cam.pitch = .28; if (m === 'eye') cam.eyeUp = myEnt() && myEnt().lieT > .5 ? .35 : -.05; cam.snap = true; World.onCam && World.onCam(m); };
addEventListener('keydown', ev => { if (/INPUT|TEXTAREA/.test(ev.target.tagName)) return; keys[ev.code] = true; if (ev.code === 'Digit1') World.setCam('chase'); if (ev.code === 'Digit2') World.setCam('eye'); if (ev.code === 'Digit3') World.setCam('top'); if (ev.code === 'KeyC') World.setCam(cam.mode === 'chase' ? 'eye' : cam.mode === 'eye' ? 'top' : 'chase'); if (['Space', 'ArrowUp', 'ArrowDown'].includes(ev.code)) ev.preventDefault(); });
addEventListener('keyup', ev => { keys[ev.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// pointer: orbit + click/tap + pinch (mouse and touch)
let drag = null; const ptrs = new Map(); let pinch = 0;
function zoomBy(k) { if (cam.mode === 'top') cam.topDist = clamp(cam.topDist * k, 10, 110); else if (cam.mode === 'chase') cam.dist = clamp(cam.dist * k, 1.6, 14); }
cv.addEventListener('pointerdown', ev => { try { cv.setPointerCapture(ev.pointerId); } catch { } ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; } else drag = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false }; });
cv.addEventListener('pointermove', ev => {
  if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) zoomBy(pinch / d); pinch = d; return; }
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; drag.x = ev.clientX; drag.y = ev.clientY; if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > (COARSE ? 10 : 5)) drag.moved = true;
    if (drag.moved) {
      cam.lastDrag = World.time;
      if (cam.mode === 'top') { cam.topYaw -= dx * .006; cam.topPitch = clamp(cam.topPitch + dy * .005, .25, 1.5); }
      else if (cam.mode === 'eye') { cam.yaw -= dx * .005; cam.eyeUp = clamp(cam.eyeUp - dy * .004, -1.2, 1.2); }
      else { cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .005, -.1, 1.3); }
    }
  } else hoverAt(ev.clientX, ev.clientY);
});
function endPtr(ev) { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = 0; }
cv.addEventListener('pointerup', ev => { const was = drag; endPtr(ev); if (was && !was.moved && ptrs.size === 0) { const h = pickAt(ev.clientX, ev.clientY); if (h && h.type === 'player' && World.onclick && !isGodView()) World.onclick(h); else clickMove(ev.clientX, ev.clientY); } drag = null; });
cv.addEventListener('pointercancel', ev => { endPtr(ev); drag = null; });
// click anywhere to walk there (a house = walk to its door and go in)
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const moveMark = new THREE.Mesh(new THREE.RingGeometry(.35, .5, 24), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide })); moveMark.rotation.x = -Math.PI / 2; moveMark.visible = false; scene.add(moveMark);
function clickMove(x, y) {
  const S = World.S; if (!S || useDemo) return;
  if (isGodView()) {   // ghosts & spectators: tap anywhere to glide there
    ray.setFromCamera(ndcOf(x, y), camera); const gp = new THREE.Vector3();
    if (ray.ray.intersectPlane(groundPlane, gp) && Math.hypot(gp.x, gp.z) < 120) { me.gpath = gp; World.sfx && World.sfx('click'); }
    return;
  }
  const e = myEnt(); if (!e || World.frozen || World.frozen2 || !S.you.alive) return;
  ray.setFromCamera(ndcOf(x, y), camera);
  const hit = ray.intersectObjects(villageGroup.children, true).find(h => h.object.userData.owner && !h.object.userData.proxy);
  let path = []; const meIn = currentHouse(e);
  if (hit) { const idx = houses.findIndex(h => h.owner === hit.object.userData.owner); if (idx >= 0 && meIn !== idx) path = [door(idx), doorIn(idx), loc2w(houses[idx], 0, .5)]; else path = [hit.point.clone().setY(0)]; }
  else { const pt = new THREE.Vector3(); if (ray.ray.intersectPlane(groundPlane, pt)) path = [pt]; }
  if (!path.length) return;
  const last = path[path.length - 1]; if (Math.hypot(last.x, last.z) > 75) return;
  if (meIn >= 0 && !(hit && houses.findIndex(h => h.owner === hit.object.userData.owner) === meIn)) path.unshift(doorIn(meIn), door(meIn));   // leave the room through the door first
  me.path = path; e.sleep = false; me.stuck = 0; World.sfx && World.sfx('click');
}
cv.addEventListener('wheel', ev => { ev.preventDefault(); const k = Math.exp(ev.deltaY * .001); if (cam.mode === 'top') cam.topDist = clamp(cam.topDist * k, 10, 110); else if (cam.mode === 'chase') cam.dist = clamp(cam.dist * k, 1.6, 14); }, { passive: false });
// joystick for touch
if (matchMedia('(pointer: coarse)').matches) {
  const jz = document.createElement('div'); jz.id = 'joy'; jz.innerHTML = '<div id="joyk"></div>'; document.body.appendChild(jz); const k = jz.firstChild; let act = false;
  const set = ev => { const r = jz.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (ev.clientX - cx) / 50, dy = (ev.clientY - cy) / 50; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = -dy; k.style.transform = `translate(${dx * 40}px,${dy * 40}px)`; };
  jz.addEventListener('pointerdown', ev => { act = true; jz.setPointerCapture(ev.pointerId); set(ev); }); jz.addEventListener('pointermove', ev => { if (act) set(ev); }); jz.addEventListener('pointerup', () => { act = false; joy.x = joy.y = 0; k.style.transform = ''; });
}
const ray = new THREE.Raycaster(), v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
function ndcOf(x, y) { return new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); }
function pickAt(x, y) {
  if (!World.S) return null;
  let best = null, bd = 44;
  for (const id in ents) { const e = ents[id]; if (e.hidden || !e.ch.root.visible) continue; const a = e.ch.root.position; v3.set(a.x, a.y + .3 * (1 - e.lieT) + .3, a.z).project(camera); v3b.set(a.x, a.y + 1.6 * (1 - e.lieT) + .7, a.z).project(camera); if (v3.z > 1) continue; const sx = (v3.x + 1) / 2 * innerWidth, sy = (1 - v3.y) / 2 * innerHeight, tx = (v3b.x + 1) / 2 * innerWidth, ty = (1 - v3b.y) / 2 * innerHeight; const px = tx - sx, py = ty - sy, L2 = px * px + py * py || 1; let t = clamp(((x - sx) * px + (y - sy) * py) / L2, 0, 1); const d = Math.hypot(x - (sx + px * t), y - (sy + py * t)); if (d < bd) { bd = d; best = { type: 'player', id }; } }
  if (best) return best;
  ray.setFromCamera(ndcOf(x, y), camera); const hit = ray.intersectObjects(villageGroup.children, true).find(h => h.object.userData.owner);
  return hit ? { type: 'house', id: hit.object.userData.owner } : null;
}
let hover = null; function hoverAt(x, y) { hover = pickAt(x, y); cv.style.cursor = 'pointer'; }

// ======================= FX =======================
const fx = []; const fxPool = [];
function spr(tex, color, add = true) { const m = new THREE.SpriteMaterial({ map: tex || RADIAL, color, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }); const s = new THREE.Sprite(m); scene.add(s); return s; }
function emit(o) { const s = fxPool.pop() || spr(null, 0xffffff); s.visible = true; s.material.map = o.map || RADIAL; s.material.color.set(o.color || '#fff'); s.material.blending = o.add === false ? THREE.NormalBlending : THREE.AdditiveBlending; s.material.opacity = 1; s.position.copy(o.pos); s.scale.setScalar(o.size || .3); fx.push({ s, v: o.v || new THREE.Vector3(), life: o.life || 1, t: 0, size: o.size || .3, grow: o.grow || 0, g: o.g || 0, fade: o.fade !== false, op: o.op || 1, onEnd: o.onEnd, fn: o.fn }); }
const ghostTex = ctex(128, 160, (g, w, h) => { g.fillStyle = 'rgba(240,244,255,.95)'; g.beginPath(); g.moveTo(14, h - 6); g.lineTo(14, 60); g.arc(w / 2, 56, 50, Math.PI, 0); g.lineTo(w - 14, h - 6); for (let q = 0; q < 4; q++) g.quadraticCurveTo(w - 14 - q * 25 - 12, h - 26 * (q % 2 ? 1 : 0) + 6, w - 14 - (q + 1) * 25, h - 6); g.closePath(); g.fill(); g.fillStyle = '#334'; g.beginPath(); g.ellipse(46, 62, 8, 12, 0, 0, TAU); g.ellipse(82, 62, 8, 12, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(64, 96, 8, 11, 0, 0, TAU); g.fill(); });
const paperTex = ctex(32, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(4, 8, 24, 16); g.fillStyle = '#e0264a'; g.fillRect(8, 14, 16, 4); });
function burst(pos, color, n = 24, sp = 4, life = 1.1) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), b = rnd(-.3, 1); emit({ pos, color, size: rnd(.15, .4), life: rnd(life * .5, life), v: new THREE.Vector3(Math.cos(a) * sp * rnd(.3, 1), b * sp, Math.sin(a) * sp * rnd(.3, 1)), g: 3 }); } }
function ghostRise(pos) { emit({ pos: pos.clone().setY(1.4), map: ghostTex, color: '#ffffff', size: 2.2, life: 3.4, v: new THREE.Vector3(0, 2.2, 0), add: false, op: .9, grow: .3 }); burst(pos.clone().setY(1), '#ffffff', 18, 3, 1.6); World.sfx && World.sfx('ghost'); }
function ringFx(pos, color, r = 4) { emit({ pos, color, size: .5, life: 1.1, grow: r * 1.6 }); }
World.ballot = function () { const al = Object.values(ents).filter(e => !e.hidden && e.ch.root.visible); if (!al.length) return; const e = al[Math.floor(Math.random() * al.length)]; const from = e.ch.root.position.clone().setY(1.8); emit({ pos: from, map: paperTex, color: '#fff', size: .6, life: 1.2, add: false, fade: false, fn: (f, k) => { f.s.position.lerpVectors(from, new THREE.Vector3(0, 2.2, 0), ease(k)); f.s.position.y += Math.sin(k * Math.PI) * 3; f.s.material.rotation = k * 8; } }); };
let flies = []; { const r = mulb(9); for (let i = 0; i < 70; i++) flies.push({ x: (r() - .5) * 110, y: .6 + r() * 2.6, z: (r() - .5) * 110, a: r() * TAU, ph: r() * 6 }); }
const flyGeo = new THREE.BufferGeometry(); flyGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(70 * 3), 3));
const flyPts = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xd8ff78, size: .22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: RADIAL })); flyPts.frustumCulled = false; scene.add(flyPts);

// ======================= state hookup =======================
const demoPlayers = ['Tunde', 'Amaka', 'Chidi', 'Ngozi', 'Bisi', 'Emeka', 'Zainab', 'Kunle'].map((n, i) => ({ id: 'demo' + i, name: n, house: i, alive: true, loc: 'plaza', look: { color: ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#38d9a9', '#f783ac'][i], hat: ['cap', 'gele', 'beanie', 'none', 'crown', 'bow', 'tophat', 'headband'][i], skin: ['#8d5524', '#c68642', '#e0ac69', '#6b4226', '#a0693b', '#5c3a21', '#8d5524', '#c68642'][i], pat: i % 3 } }));
let useDemo = true, startedCamFor = '';
World.setInGame = v => { World.inGame = v; };
World.setState = function (S, prev) {
  World.S = S;
  const real = S && S.phase !== 'lobby';
  if (!real) { if (!useDemo || !Object.keys(ents).length || ents[demoPlayers[0].id] == null) { useDemo = true; for (const id of Object.keys(ents)) { disposeEnt(ents[id]); delete ents[id]; } sig = ''; syncPlayers(demoPlayers, true); World.setCam('top'); } return; }
  if (useDemo) { useDemo = false; for (const id of Object.keys(ents)) { disposeEnt(ents[id]); delete ents[id]; } sig = ''; }
  if (prev && prev.you && prev.you.alive && !S.you.alive && ents[S.you.id]) { const q = ents[S.you.id].ch.root.position; me.anchor.set(q.x, 2.6, q.z + 2); World.setCam('top'); }
  syncPlayers(S.players, false);
  const fresh = !prev || prev.phaseId !== S.phaseId; const myKey = S.code + ':' + S.you.id;
  if (startedCamFor !== myKey) {
    startedCamFor = myKey; me.anchor.set(0, 2, 24); World.setCam(isGodView() ? 'top' : 'chase');
    const e = myEnt(); if (e && !isGodView()) { const sp = loc2w(houses[S.players.findIndex(p => p.id === S.you.id)], 0, 10.5); e.ch.root.position.copy(sp); e.lieT = 0; e.ch.lie = 0; e.yaw = Math.atan2(-sp.x, -sp.z); cam.yaw = e.yaw; cam.snap = true; lastSent = ''; }   // you start on your own doorstep
  }
  for (const p of S.players) {
    const e = ents[p.id]; if (!e) continue;
    if (e.p.alive !== undefined && e._alive === true && !p.alive) { ghostRise(e.ch.root.position.clone()); if (p.house !== undefined) { } }
    e._alive = p.alive; e.p = p;
  }
  if (fresh) onPhase(S, prev);
};
let cutT0 = 0, cutState = null;
function onPhase(S, prev) {
  const ph = S.phase;
  if (ph === 'dawn') for (let i = 0; i < 40; i++) emit({ pos: new THREE.Vector3(rnd(-30, 30), rnd(1, 5), rnd(-30, 30)), color: '#ffe699', size: rnd(.15, .35), life: rnd(2, 4), v: new THREE.Vector3(0, rnd(.2, .8), 0) });
  if (ph === 'voteResult') { World.tallyUntil = World.time + 8; World.tally = S.tally; }
  if (ph === 'nightFall') { World.sfx && World.sfx('night'); }
  if (ph === 'day' || ph === 'dawn') { World.sfx && World.sfx('dawn'); }
  if (ph !== 'nightAttack' && ph !== 'nightReturn') World.frozen = false;
  if (ph !== 'nightReturn') { cutState = null; cutEl.style.opacity = 0; cutEl.innerHTML = ''; flashEl.style.opacity = 0; flashEl.style.background = '#fff'; }
  if (ph === 'day') clearBlood();
  if (ph === 'nightAttack' && S.attack) {
    const vi = S.players.findIndex(p => p.id === S.attack.victim), vh = houses[vi], vEnt = ents[S.attack.victim];
    const isVictim = S.attack.victim === S.you.id && S.attack.showFace, strikers = S.attack.strikers || [S.attack.striker];
    const isStriker = strikers.includes(S.you.id);
    if (vh) {
      const vlie = !!(vEnt && vEnt.lieT > .5);
      let vp = vEnt ? vEnt.ch.root.position.clone() : bedFoot(vi);
      if (!vlie) { vp.y = 0; if (!inHouse(vh, vp.x, vp.z, .2)) vp = victimStand(vi).clone(); }
      const vyaw = vEnt ? vEnt.yaw : vh.yaw, spots = {};
      const dirV = doorIn(vi).clone().sub(vp); dirV.y = 0; if (dirV.length() < .5) dirV.set(Math.sin(vh.yaw), 0, Math.cos(vh.yaw)); dirV.normalize();
      strikers.forEach((id, k) => {
        let sp;
        if (vlie) sp = (k % 2 === 0 ? victimStand(vi) : loc2w(vh, -2.3, -.1)).clone();
        else { const ang = strikers.length > 1 ? (k % 2 === 0 ? -1 : 1) * (.55 + .5 * Math.floor(k / 2)) : 0; sp = clampInHouse(vh, vp.clone().add(new THREE.Vector3(dirV.x * Math.cos(ang) - dirV.z * Math.sin(ang), 0, dirV.x * Math.sin(ang) + dirV.z * Math.cos(ang)).multiplyScalar(1.05))); }
        spots[id] = sp;
      });
      const chest = vlie ? loc2w(vh, -2.3, -1.75).setY(.8) : vp.clone().setY(1.1);
      Object.values(ents).forEach(en => { en.atkR = null; });
      World.atk = { t0: World.time, vh, vi, victim: S.attack.victim, striker: S.attack.striker, strikers, saved: !!S.attack.saved, hits: 0, nextHit: 0, pool: null, floor: null, role: isVictim ? 'victim' : isStriker ? 'striker' : 'watch', vpos: vp, vlie, vyaw, spots, chest, collapse: false };
      cutT0 = World.time; cutState = { victim: isVictim, striker: strikers[0], saved: !!S.attack.saved, house: vh };
      if (isVictim) { World.setCam('eye'); World.sfx && World.sfx('creak'); World.frozen = true; }   // you stay exactly where you are — and you see it all
      if (isStriker && cam.mode === 'eye') World.setCam('chase');
    }
  }
}
function setTod() {
  const S = World.S;
  let target;
  if (!S || S.phase === 'lobby' || !World.inGame) target = clamp(.5 + Math.sin(World.time * .05) * .8, 0, 1);
  else if (S.phase === 'reveal') target = .55;
  else if (['nightFall', 'nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn'].includes(S.phase)) target = 1; else target = 0;
  return target;
}
let tod = .35;
const C = c => new THREE.Color(c);
const SKY = { day: [C('#2f7fe0'), C('#b9e0ff'), C('#8dbf8a')], dusk: [C('#4a3a8a'), C('#ff9a5a'), C('#6a4a5a')], night: [C('#02030f'), C('#141b4a'), C('#080a18')] };
function applyTod(dt) {
  tod += clamp(setTod() - tod, -dt * .32, dt * .32);
  const t = tod, night = clamp((t - .3) / .5, 0, 1);
  const a = t < .5 ? SKY.day : SKY.dusk, b = t < .5 ? SKY.dusk : SKY.night, k = t < .5 ? t / .5 : (t - .5) / .5;
  skyMat.uniforms.top.value.copy(a[0]).lerp(b[0], k); skyMat.uniforms.mid.value.copy(a[1]).lerp(b[1], k); skyMat.uniforms.bot.value.copy(a[2]).lerp(b[2], k);
  scene.fog.color.copy(skyMat.uniforms.mid.value); scene.fog.density = lerp(.0062, .0095, night);
  const sunEl = lerp(.95, -.12, ease(clamp(t / .62, 0, 1))), moonEl = lerp(-.2, .85, ease(clamp((t - .4) / .6, 0, 1)));
  const sunDir = new THREE.Vector3(.5, Math.sin(sunEl * 1.3), .55 + .2 * Math.cos(sunEl)).normalize(), moonDir = new THREE.Vector3(-.5, Math.sin(moonEl * 1.3), .4).normalize();
  const sunI = clamp(sunDir.y * 3.2, 0, 1) * 3.2, moonI = night * .75 * clamp(moonDir.y * 3, 0, 1);
  const useSun = sunI >= moonI; const dir = useSun ? sunDir : moonDir;
  key.intensity = Math.max(sunI, moonI) + .001; key.color.set(useSun ? (sunDir.y < .35 ? '#ffb070' : '#fff2d8') : '#9db4ff');
  key.position.copy(dir).multiplyScalar(110).add(key.target.position); key.target.position.set(0, 0, 0); key.target.updateMatrixWorld();
  hemi.intensity = lerp(.75, .32, night); hemi.color.copy(skyMat.uniforms.top.value).lerp(C('#ffffff'), .5 * (1 - night)); hemi.groundColor.set(night > .5 ? '#101c28' : '#6a8b4a');
  renderer.toneMappingExposure = lerp(1.05, 1.5, night);
  stars.material.opacity = night; stars.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 440); sunSprite.material.opacity = clamp(sunDir.y * 4 + .3, 0, 1);
  moonSprite.position.copy(camera.position).addScaledVector(moonDir, 440); moonSprite.material.opacity = clamp(moonDir.y * 4, 0, 1) * night;
  moonDisk.position.copy(camera.position).addScaledVector(moonDir, 450); moonDisk.lookAt(camera.position); moonDisk.visible = moonDir.y > .02 && night > .1; moonDisk.material.opacity = 1;
  sky.position.copy(camera.position);
  for (const L of lampLights) L.intensity = 55 * night; for (const h of lampHeads) h.material.emissiveIntensity = 3 * night;
  flyPts.material.opacity = night * .9;
  return night;
}

// ======================= update loop =======================
const clock = { last: performance.now() };
let sendT = 0, lastSent = '';
const NIGHTPH = new Set(['nightFall', 'nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn']);
World.RACK = new THREE.Vector3(4.2, 0, 2.6);
World.debug = () => { const e = myEnt(); return JSON.stringify({ pos: e && e.ch.root.position.toArray().map(v => +v.toFixed(1)), lieT: e && e.lieT, sleep: e && e.sleep, lie: e && e.ch.lie, frozen: World.frozen, cam: cam.mode, sil: e && e.sil, inH: e && e.inH, vis: e && e.ch.root.visible, hood: e && e.ch._hood, silOn: e && e.ch._sil, tod: tod }); };
function clampInHouse(h, v) { const [lx, lz] = w2loc(h, v.x, v.z); return loc2w(h, clamp(lx, -3.0, 3.0), clamp(lz, -2.4, 2.4)); }
// the victim stays exactly where they were (awake at a window, or asleep in bed) while the attack happens
function holdVictim(e, p, dt) {
  const A = World.atk, ch = e.ch, pos = ch.root.position; e.route = []; e.locKey = p.loc;
  pos.set(A.vpos.x, A.vlie ? .5 : (A.collapse ? .05 : 0), A.vpos.z); e.yaw = A.vyaw;
  if (A.vlie) { e.lieT = 1; ch.lie = 1; } else if (A.collapse) { e.lieT = Math.min(1, e.lieT + dt * 1.3); ch.lie = ease(e.lieT); } else { e.lieT = 0; ch.lie = 0; }
}
// every killer walks in through the door and takes a place around the victim
function approachAtk(e, p, dt) {
  const A = World.atk, pos = e.ch.root.position; e.ch.lie = 0; e.lieT = 0; e.locKey = p.loc; pos.y = 0;
  const spot = A.spots[p.id] || victimStand(A.vi);
  if (!e.atkR) e.atkR = inHouse(A.vh, pos.x, pos.z, 0) ? [spot] : [door(A.vi), doorIn(A.vi), spot];
  let moving = false, speed = 0; const w = e.atkR[0];
  if (w) { const dx = w.x - pos.x, dz = w.z - pos.z, d = Math.hypot(dx, dz), st = 3.6 * dt; if (d <= st) { pos.x = w.x; pos.z = w.z; e.atkR.shift(); } else { pos.x += dx / d * st; pos.z += dz / d * st; e.yaw = Math.atan2(dx, dz); moving = true; speed = 3; } }
  else e.yaw = dampAng(e.yaw, Math.atan2(A.vpos.x - pos.x, A.vpos.z - pos.z), 8, dt);
  return { moving, speed };
}
function updateEnts(dt, night) {
  const S = World.S, n = houses.length, t = World.time; if (!S && !useDemo) return;
  const players = useDemo ? demoPlayers : S.players;
  const viewerMafia = !!S && S.you.role === 'mafia', godV = !!S && S.god, nightPh = !!S && !useDemo && NIGHTPH.has(S.phase);
  const lock = !!S && !useDemo && S.lock, unlockArr = (S && S.unlock) || [];
  const meetOn = players.some(p => p.loc === 'meet');
  const camIn = camInHouse();
  for (const p of players) {
    const e = ents[p.id]; if (!e) continue; const ch = e.ch, pos = ch.root.position;
    const isMe = !useDemo && !!S && p.id === S.you.id && !isGodView();
    // ---- dead: ghosts are only visible to other ghosts
    if (p.loc === 'dead') {
      e.hidden = !godV; e.sil = false;
      if (godV) { if (!e.ghostPos) e.ghostPos = pos.clone(); const sp = plazaSpot(p.house, n); e.ghostPos.lerp(sp, dt * .6); pos.set(e.ghostPos.x, 1.2 + Math.sin(t * 2 + p.house) * .25, e.ghostPos.z); ch.setGhost(true); ch.setSilhouette(false); ch.speed = 0; ch.lie = 0; ch.root.visible = true; ch.update(dt, t); }
      else ch.root.visible = false;
      e.marker.visible = false; continue;
    }
    if (e.ghostPos) { e.ghostPos = null; ch.setGhost(false); pos.y = 0; }
    let moving = false, speed = 0;
    if (isMe) {
      // ---- YOU: full free movement, any time, anywhere you are allowed to go
      e.locKey = p.loc; e.route = [];
      const A = World.atk, input = () => (keys.KeyW || keys.ArrowUp || keys.KeyS || keys.ArrowDown || keys.KeyA || keys.ArrowLeft || keys.KeyD || keys.ArrowRight || joy.x || joy.y);
      if (World.frozen) { holdVictim(e, p, dt); }
      else if (A && A.strikers.includes(p.id) && S.phase === 'nightAttack') { me.path.length = 0; const r = approachAtk(e, p, dt); moving = r.moving; speed = r.speed; }
      else if (e.sleep) {   // lying in bed: any movement wakes you
        if (input()) e.sleep = false;
        else { e.lieT = Math.min(1, e.lieT + dt * .8); const f = bedFoot(p.house), st = bedStand(p.house), k = ease(e.lieT); pos.set(lerp(st.x, f.x, k), lerp(0, .5, k), lerp(st.z, f.z, k)); ch.lie = e.lieT; e.yaw = houses[p.house].yaw; me.path.length = 0; }
      }
      else if (e.lieT > .02) { e.lieT = Math.max(0, e.lieT - dt * 1.4); const f = bedFoot(p.house), st = bedStand(p.house), k = ease(e.lieT); pos.set(lerp(st.x, f.x, k), lerp(0, .5, k), lerp(st.z, f.z, k)); ch.lie = e.lieT; }
      else {
        ch.lie = 0; pos.y = 0; e.control = true;
        const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y, r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
        if (f || r) {
          me.path.length = 0;
          const cy = cam.mode === 'top' ? cam.topYaw + Math.PI : cam.yaw; const fx_ = Math.sin(cy), fz_ = Math.cos(cy), rx_ = -Math.cos(cy), rz_ = Math.sin(cy);
          let dx = fx_ * f + rx_ * r, dz = fz_ * f + rz_ * r; const m = Math.hypot(dx, dz) || 1; dx /= m; dz /= m;
          const run = keys.ShiftLeft || keys.ShiftRight; speed = run ? 5.6 : 3.2; ch.running = run;
          pos.x += dx * speed * dt; pos.z += dz * speed * dt; collide(pos); e.yaw = Math.atan2(dx, dz); moving = true;
        } else if (me.path.length) {   // click-to-move
          const w = me.path[0], dx = w.x - pos.x, dz = w.z - pos.z, d = Math.hypot(dx, dz);
          if (d < .4) me.path.shift();
          else { speed = 4.3; const ox = pos.x, oz = pos.z; pos.x += dx / d * speed * dt; pos.z += dz / d * speed * dt; collide(pos); e.yaw = Math.atan2(dx, dz); moving = true; me.stuck = Math.hypot(pos.x - ox, pos.z - oz) < speed * dt * .3 ? me.stuck + dt : 0; if (me.stuck > .6) { me.path.length = 0; me.stuck = 0; } }
        }
        // the sealed door shocks you
        if (lock && moving && (e.zapT || 0) < t) { for (const h of houses) { if (unlockArr.includes(h.i)) continue; const [lx, lz] = w2loc(h, pos.x, pos.z); if (Math.abs(lx) < 1.2 && lz > 2.1 && lz < 4.4) { e.zapT = t + 1.6; zapDoor(h); World.onToast && World.onToast(h.i === p.house ? '⚡ Your door is sealed — you can\'t leave until dawn!' : '⚡ That house is sealed.'); break; } } }
      }
      const last = me.path[me.path.length - 1]; moveMark.visible = !!last; if (last) { moveMark.position.set(last.x, .08, last.z); moveMark.scale.setScalar(1 + Math.sin(t * 6) * .15); }
    } else if (World.atk && p.id === World.atk.victim && (S.phase === 'nightAttack' || S.phase === 'nightReturn')) {
      holdVictim(e, p, dt);
    } else if (World.atk && S.phase === 'nightAttack' && World.atk.strikers.includes(p.id)) {
      const r = approachAtk(e, p, dt); moving = r.moving; speed = r.speed;
    } else if (!useDemo && !p.ai && e.remote) {
      // ---- another real person: follow where they actually walk
      const rx = e.remote.x, rz = e.remote.z, dx = rx - pos.x, dz = rz - pos.z, d = Math.hypot(dx, dz);
      if (d > 9) { pos.x = rx; pos.z = rz; } else if (d > .02) { const st = Math.min(d, d * 9 * dt + .001); pos.x += dx / d * st; pos.z += dz / d * st; }
      speed = d > .12 ? clamp(d * 2.4, 0, 5.6) : 0; moving = speed > .3; e.yaw = dampAng(e.yaw, e.remote.ry, 10, dt); e.lieT = 0; ch.lie = 0; pos.y = 0; e.locKey = p.loc; e.route = [];
    } else {
      // ---- villagers run by the game (NPCs): they follow the story state
      if (e.locKey !== p.loc) {
        const prev = e.locKey; e.locKey = p.loc; e.prevLoc = prev;
        if ((p.loc.startsWith('in:') || p.loc.startsWith('at:')) && prev === 'home' && !viewerMafia && !godV) { const K = +p.loc.slice(3); pos.copy(door(K)); e.lieT = 0; ch.lie = 0; e.route = []; }
        planRoute(e, p); e.pause = 0;
      }
      if (e.route.length) {
        if (e.lieT > .02) { e.lieT = Math.max(0, e.lieT - dt * 1.3); const f = bedFoot(p.house), st = bedStand(p.house); const k = ease(e.lieT); pos.set(lerp(st.x, f.x, k), lerp(0, .5, k), lerp(st.z, f.z, k)); ch.lie = e.lieT; }
        else {
          ch.lie = 0; pos.y = 0; const w = e.route[0].p; const dx = w.x - pos.x, dz = w.z - pos.z, d = Math.hypot(dx, dz), step = AUTO_SPEED * dt;
          if (d <= step) { pos.x = w.x; pos.z = w.z; e.route.shift(); }
          else { pos.x += dx / d * step; pos.z += dz / d * step; e.yaw = Math.atan2(dx, dz); moving = true; speed = AUTO_SPEED * .9; }
        }
      } else if (e.finalLie >= 0 && p.loc === 'home') {
        const f = bedFoot(p.house), st = bedStand(p.house); e.lieT = Math.min(1, e.lieT + dt * .7); const k = ease(e.lieT); pos.set(lerp(st.x, f.x, k), lerp(0, .5, k), lerp(st.z, f.z, k)); ch.lie = e.lieT; e.yaw = dampAng(e.yaw, houses[p.house].yaw, 4, dt);
      } else if (p.loc === 'plaza') {
        if (!e.tgt || e.pause > 0) { e.pause -= dt; if (e.pause <= 0 && !e.tgt) { const a = rnd(0, TAU), r = rnd(3.5, PLAZA - 2); e.tgt = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); } }
        if (e.tgt) { const dx = e.tgt.x - pos.x, dz = e.tgt.z - pos.z, d = Math.hypot(dx, dz); if (d < .25) { e.tgt = null; e.pause = rnd(2, 7); } else { const sp = 1.35 * dt; pos.x += dx / d * sp; pos.z += dz / d * sp; e.yaw = Math.atan2(dx, dz); speed = 1.35; moving = true; } }
        else { if ((e.lookT || 0) < t) { e.lookT = t + .8; const near = Object.values(ents).filter(o => o !== e && !o.hidden && o.p.loc === 'plaza' && o.ch.root.position.distanceTo(pos) < 6); e.lookO = near.length ? near[p.house % near.length] : null; } if (e.lookO) e.yaw = dampAng(e.yaw, Math.atan2(e.lookO.ch.root.position.x - pos.x, e.lookO.ch.root.position.z - pos.z), 3, dt); }
        const dw = Math.hypot(pos.x, pos.z); if (dw < 2.8) { pos.x = pos.x / (dw || 1) * 2.8; pos.z = pos.z / (dw || 1) * 2.8; }
      } else if (p.loc === 'meet') { e.yaw = dampAng(e.yaw, Math.atan2(-pos.x, -pos.z), 3, dt); }
    }
    e.speedS = damp(e.speedS, moving ? Math.max(speed, .6) : 0, 12, dt);
    ch.speed = e.speedS; ch.running = ch.speed > 3.5 || (isMe && moving && (keys.ShiftLeft || keys.ShiftRight));
    ch.root.rotation.y = e.lieT > .5 ? dampAng(ch.root.rotation.y, houses[p.house].yaw, 6, dt) : dampAng(ch.root.rotation.y, e.yaw, 9, dt);
    // ---- visibility: walls hide what is inside; at night you only see dark figures
    e.inH = currentHouse(e);
    const A9 = World.atk, revealed = !!(cutState && cutState.unhood && A9 && A9.strikers.includes(p.id));
    const seeIn = godV || (viewerMafia && nightPh);   // the Mafia look through the windows like anyone standing outside
    const wallHide = e.inH >= 0 && e.inH !== camIn && !seeIn && !isMe;
    e.hidden = wallHide; e.noLabel = e.inH >= 0 && e.inH !== camIn && !godV && !isMe;   // names never show through walls
    const sil = nightPh && night > .45 && !godV && !isMe && !viewerMafia && !revealed;   // villagers only see dark shapes outside after dark
    e.sil = sil; ch.setSilhouette(sil);
    ch.setSuit(revealed ? null : (nightPh && night > .45 ? (p.nl || null) : null));
    ch.setGhost(false); ch.setWeapon(p.weapon || null);
    ch.talk = World.time - e.bubT < 3 ? 1 : 0; let act = 'idle'; if (ch.talk) act = 'talk'; else if (e.speedS < .1 && p.loc === 'plaza') act = Math.sin(t * .3 + p.house) > .3 ? 'look' : 'idle';
    if (cutState && World.atk && World.atk.strikers.includes(p.id) && cutState.stab) act = 'stab';
    if (cutState && cutState.victim && isMe && cutState.scared) act = 'scared';
    ch.activity = act;
    ch.root.visible = !wallHide && !(isMe && (cam.mode === 'eye' || camHeadClose));
    ch.update(dt, t);
    const mm = World.mode; e.marker.visible = false;
    if (mm && mm.kind === 'player' && mm.valid(p.id) && !e.hidden) { e.marker.visible = true; e.marker.position.set(pos.x, .08, pos.z); const sel = mm.selected === p.id, hv = hover && hover.type === 'player' && hover.id === p.id; e.marker.material.color.set(sel ? '#ffd24a' : hv ? '#ffffff' : '#ff8a9a'); e.marker.scale.setScalar(1 + Math.sin(t * 5) * (sel ? .12 : .05) + (hv ? .15 : 0)); }
  }
  // ---- houses: doors, windows, sealed-door sparks, tombstones, chimney smoke
  houses.forEach((h, i) => {
    const p = players[i]; if (!p) return;
    let want = 0; for (const id in ents) { const e = ents[id]; if (lock && S && id === S.you.id && !unlockArr.includes(i)) continue; const q = e.ch.root.position; if (Math.abs(q.x - h.x) < 7 && Math.abs(q.z - h.z) < 7) { const [lx, lz] = w2loc(h, q.x, q.z); if (Math.abs(lx) < 1.6 && lz > 1.4 && lz < 5.5) want = 1; } }
    if (lock && !godV && !unlockArr.includes(i) && S && ents[S.you.id] && inHouse(h, ents[S.you.id].ch.root.position.x, ents[S.you.id].ch.root.position.z, -.5)) want = 0;
    h.door = damp(h.door, want, 7, dt); h.doorPivot.rotation.y = h.door * 1.45;
    const occupied = godV ? p.loc === 'home' || true : true; const lit = (night > .35 && !p.dead && p.alive !== false && occupied && p.loc !== 'meet') || !!(World.atk && World.atk.vi === i && World.time - World.atk.t0 > 1.2 && (S.phase === 'nightAttack' || S.phase === 'nightReturn'));
    h.glass.emissiveIntensity = damp(h.glass.emissiveIntensity, lit ? 1.6 : 0, 4, dt); const k = h.glass.emissiveIntensity / 1.6;
    h.curtain.opacity = .85 * k; h.curtain.emissiveIntensity = 1.6 * k; h.lantern.material.emissiveIntensity = h.glass.emissiveIntensity * 1.4; h.lamp.material.emissiveIntensity = h.glass.emissiveIntensity * 1.2;
    h.tomb.visible = !!p.dead;
    h.smokeT -= dt; if (h.smokeT < 0 && !p.dead) { h.smokeT = rnd(LOW ? 3 : 1.6, LOW ? 5 : 2.6); const w = loc2w(h, 2.2, -1.4); emit({ pos: new THREE.Vector3(w.x, 6, w.z), color: night > .5 ? '#6b7288' : '#e8e8f0', add: false, size: .5, grow: 1.4, life: 3.2, op: .35, v: new THREE.Vector3(.6, 1.1, .2) }); }
    if (lock && !godV && !unlockArr.includes(i)) { h.sparkT -= dt; if (h.sparkT < 0) { h.sparkT = rnd(.12, .4); const w = loc2w(h, rnd(-.6, .6), 3.25); emit({ pos: new THREE.Vector3(w.x, rnd(.2, 2), w.z), color: '#7fd8ff', size: rnd(.12, .3), life: .25, v: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)) }); } }
  });
  const AK = World.atk; if (AK && S && (S.phase === 'nightAttack' || S.phase === 'nightReturn')) { const ct = World.time - AK.t0, c = loc2w(AK.vh, 0, 0); atkLight.position.set(c.x, 2.5, c.z); atkLight.intensity = 80 * (ct < 1.2 ? 0 : ct < 1.9 ? (Math.random() < .5 ? .15 : 1) : 1); } else atkLight.intensity = 0;
  const myI = S && !useDemo ? S.players.findIndex(p => p.id === S.you.id) : -1;
  if (myI >= 0 && houses[myI] && camInHouse() === myI) { const w = loc2w(houses[myI], 0, 0); homeLight.position.set(w.x, 2.5, w.z); homeLight.intensity = 14 + 16 * night; } else homeLight.intensity = 0;
  const redWell = meetOn && S && (S.god || S.you.role === 'mafia');
  wellLight.color.set(redWell ? 0xff3355 : 0x88ccff); wellLight.intensity = redWell ? 55 : 25 * night; waterMat.emissive.set(redWell ? '#a01030' : '#1a6ab0');
  rackG.visible = !!S && !useDemo && ['nightSummon', 'nightActions', 'nightTravel'].includes(S.phase) && (godV || (S.you.role === 'mafia' && S.you.alive));
}
function zapDoor(h) { const w = loc2w(h, 0, 3.3); for (let i = 0; i < 14; i++) emit({ pos: new THREE.Vector3(w.x, rnd(.3, 2.1), w.z), color: '#9fe6ff', size: rnd(.15, .4), life: .4, v: new THREE.Vector3(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)) }); flashEl.style.background = '#8fe0ff'; flashEl.style.opacity = .35; setTimeout(() => { flashEl.style.opacity = 0; flashEl.style.background = '#fff'; }, 120); World.sfx && World.sfx('zap'); }
// the Mafia's weapon crate (only they can see it, only at night)
const rackG = new THREE.Group(); rackG.visible = false; scene.add(rackG);
{ rackG.position.copy(World.RACK); const crate = new THREE.Mesh(new THREE.BoxGeometry(1.7, .8, .9), stdM('#2b2030')); crate.position.y = .4; crate.castShadow = true; rackG.add(crate); const lid = new THREE.Mesh(new THREE.BoxGeometry(1.8, .08, 1), stdM('#7a1530')); lid.position.y = .84; rackG.add(lid);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.05, .5, .02), new THREE.MeshStandardMaterial({ color: '#dde3ee', metalness: .9, roughness: .2 })); b.position.set(-.5 + i * .22, 1.1, 0); b.rotation.z = .25 * (i - 1); rackG.add(b); }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.4, .12, .1), stdM('#15151b')); gun.position.set(.55, .95, .1); rackG.add(gun); const gp = new THREE.Mesh(new THREE.BoxGeometry(.1, .25, .1), stdM('#15151b')); gp.position.set(.42, .82, .1); rackG.add(gp);
  const gl = new THREE.PointLight(0xff2a4a, 12, 8, 2); gl.position.set(0, 1.6, 0); rackG.add(gl); }
function collide(pos) {
  for (const c of circles) { const dx = pos.x - c.x, dz = pos.z - c.z, r = c.r + .32, d2 = dx * dx + dz * dz; if (d2 < r * r) { const d = Math.sqrt(d2) || .001; pos.x = c.x + dx / d * r; pos.z = c.z + dz / d * r; } }
  for (const h of houses) {
    const dx = pos.x - h.x, dz = pos.z - h.z; if (dx * dx + dz * dz > 100) continue;
    let [lx, lz] = w2loc(h, pos.x, pos.z), ch = false;
    const lockd = World.S && World.S.lock && !(World.S.unlock || []).includes(h.i); for (const [x0, x1, z0, z1] of (lockd ? h.cols.concat([[-.65, .65, 2.8, 3.2]]) : h.cols)) { const cx = clamp(lx, x0, x1), cz = clamp(lz, z0, z1), ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez), r = .32; if (d < r) { ch = true; if (d > 1e-4) { lx = cx + ex / d * r; lz = cz + ez / d * r; } else { const px = Math.min(lx - x0, x1 - lx), pz = Math.min(lz - z0, z1 - lz); if (px < pz) lx += (lx - x0 < x1 - lx ? -1 : 1) * (px + r); else lz += (lz - z0 < z1 - lz ? -1 : 1) * (pz + r); } } }
    if (ch) { pos.x = h.x + lx * h.cos + lz * h.sin; pos.z = h.z - lx * h.sin + lz * h.cos; }
  }
  const d = Math.hypot(pos.x, pos.z); if (d > 70) { pos.x *= 70 / d; pos.z *= 70 / d; }
}
function camInHouse() { for (const h of houses) { const dx = camera.position.x - h.x, dz = camera.position.z - h.z; if (dx * dx + dz * dz < 64 && inHouse(h, camera.position.x, camera.position.z, -.4) && camera.position.y < 3.2) return h.i; } return -1; }
let camHeadClose = false;
const camRay = new THREE.Raycaster();
function updateCamera(dt) {
  const S = World.S, t = World.time, god = isGodView(); let e = god ? null : myEnt();
  // free-fly anchor for ghosts / spectators / demo
  if (!e) {
    if (useDemo) { cam.topYaw += dt * .06; me.anchor.set(0, 1.6, 0); }
    else {
      const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y, r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x, up = (keys.KeyE || keys.Space ? 1 : 0) - (keys.KeyQ ? 1 : 0);
      const cy = cam.mode === 'top' ? cam.topYaw + Math.PI : cam.yaw, sp = (keys.ShiftLeft ? 18 : 9) * dt;
      if (f || r || up) me.gpath = null; else if (me.gpath) { const gx = me.gpath.x - me.anchor.x, gz = me.gpath.z - me.anchor.z, gd = Math.hypot(gx, gz); if (gd < .6) me.gpath = null; else { const st = Math.min(gd, 14 * dt); me.anchor.x += gx / gd * st; me.anchor.z += gz / gd * st; } }
      moveMark.visible = !!me.gpath; if (me.gpath) moveMark.position.set(me.gpath.x, .08, me.gpath.z);
      me.anchor.x += (Math.sin(cy) * f - Math.cos(cy) * r) * sp; me.anchor.z += (Math.cos(cy) * f + Math.sin(cy) * r) * sp; me.anchor.y = clamp(me.anchor.y + up * sp, 1.2, 40);
      const d = Math.hypot(me.anchor.x, me.anchor.z); if (d > 120) { me.anchor.x *= 120 / d; me.anchor.z *= 120 / d; }
    }
  }
  const P = e ? e.ch.root.position : me.anchor;
  let want = new THREE.Vector3(), look = new THREE.Vector3();
  camHeadClose = false;
  // the killing gets a proper camera: from the corner of the room, looking at the bed
  const AT = World.atk;
  if (AT && S && !useDemo && S.phase === 'nightAttack' && AT.role !== 'victim' && !god && (AT.role === 'striker' || camInHouse() === AT.vi)) {
    const w = loc2w(AT.vh, 3.0, 2.5).setY(2.3), lk = AT.chest.clone().setY(.8), k = 1 - Math.exp(-5 * dt);
    cam.pos.lerp(w, k); cam.look.lerp(lk, k); camera.position.copy(cam.pos); camera.lookAt(cam.look); cam.snap = false; if (e) camHeadClose = false; return;
  }
  // victim cutscene drives the view
  if (cutState && cutState.victim && e) {
    const st = ents[cutState.striker]; const ct = World.time - cutT0;
    if (st) { const hp = new THREE.Vector3(); st.ch.parts.head.getWorldPosition(hp); const tgt = ct > 1.4 ? hp : loc2w(cutState.house, 0, 3).setY(1.2); const hd = new THREE.Vector3(); e.ch.parts.head.getWorldPosition(hd); const dir = tgt.clone().sub(hd); cam.yaw = dampAng(cam.yaw, Math.atan2(dir.x, dir.z), 4, dt); cam.eyeUp = damp(cam.eyeUp, Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) + (ct < 1.4 ? .25 : 0), 4, dt); }
  }
  if (cam.mode === 'eye') {
    const hp = new THREE.Vector3(); if (e) e.ch.parts.head.getWorldPosition(hp); else hp.copy(P);
    if (e) { hp.y += .1; if (e.lieT < .5) { hp.x += Math.sin(cam.yaw) * .1; hp.z += Math.cos(cam.yaw) * .1; } }
    want.copy(hp); look.set(hp.x + Math.sin(cam.yaw) * Math.cos(cam.eyeUp), hp.y + Math.sin(cam.eyeUp), hp.z + Math.cos(cam.yaw) * Math.cos(cam.eyeUp));
    camera.position.copy(want); camera.lookAt(look); cam.pos.copy(want); cam.look.copy(look); cam.snap = false; return;
  }
  const target = new THREE.Vector3(P.x, e ? (e.lieT > .5 ? .9 : 1.35) : P.y, P.z);
  if (cam.mode === 'top') {
    const r = cam.topDist * Math.cos(cam.topPitch), yv = cam.topDist * Math.sin(cam.topPitch);
    const c0 = e ? target : new THREE.Vector3(me.anchor.x, 0, me.anchor.z); const tgt = e ? target.clone().lerp(new THREE.Vector3(0, 0, 0), clamp(cam.topDist / 120, 0, .7)) : c0;
    want.set(tgt.x + Math.sin(cam.topYaw) * r, yv, tgt.z + Math.cos(cam.topYaw) * r); look.copy(tgt);
  } else {
    if (e && e.speedS > .5 && World.time - cam.lastDrag > 1.1 && !(cutState && cutState.victim)) cam.yaw = dampAng(cam.yaw, e.yaw, 2.2, dt);
    const d = cam.dist, back = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw)), close = clamp((3.2 - d) / 2, 0, 1), right = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(-1);
    want.copy(target).addScaledVector(back, -d * Math.cos(cam.pitch)).setY(target.y + d * Math.sin(cam.pitch) + .3); want.addScaledVector(right, close * .4 + .3 * (1 - close) * 0);
    look.copy(target).addScaledVector(back, 1.2 + close * 1.4); look.y += .1;
    // keep the lens out of walls
    const from = new THREE.Vector3(target.x, Math.max(1.1, target.y), target.z), dir = want.clone().sub(from), len = dir.length();
    if (len > .01) { dir.divideScalar(len); camRay.set(from, dir); camRay.far = len; const hit = camRay.intersectObjects(occluders, false)[0]; if (hit) want.copy(from).addScaledVector(dir, Math.max(.35, hit.distance - .3)); }
    if (e) camHeadClose = want.distanceTo(new THREE.Vector3(P.x, 1.5, P.z)) < .85;
  }
  if (cam.snap) { cam.pos.copy(want); cam.look.copy(look); cam.snap = false; } else { const k = cam.mode === 'top' ? 7 : 11; cam.pos.set(damp(cam.pos.x, want.x, k, dt), damp(cam.pos.y, want.y, k, dt), damp(cam.pos.z, want.z, k, dt)); cam.look.set(damp(cam.look.x, look.x, 12, dt), damp(cam.look.y, look.y, 12, dt), damp(cam.look.z, look.z, 12, dt)); }
  camera.position.copy(cam.pos); camera.lookAt(cam.look); if (camera.position.y < .4) camera.position.y = .4;
}
function updateFX(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt; const k = f.t / f.life; if (k >= 1) { f.s.visible = false; fxPool.push(f.s); fx.splice(i, 1); f.onEnd && f.onEnd(); continue; }
    f.v.y -= f.g * dt; f.s.position.addScaledVector(f.v, dt); f.s.scale.setScalar(Math.max(.01, f.size + f.grow * k)); if (f.fade) f.s.material.opacity = f.op * (1 - k); if (f.fn) f.fn(f, k);
  }
  // fireflies
  const arr = flyGeo.attributes.position.array; flies.forEach((f, i) => { f.a += Math.sin(World.time * .5 + f.ph) * dt; f.x += Math.cos(f.a) * 1.2 * dt; f.z += Math.sin(f.a * 1.3) * 1.2 * dt; arr[i * 3] = f.x; arr[i * 3 + 1] = f.y + Math.sin(World.time + f.ph) * .4; arr[i * 3 + 2] = f.z; }); flyGeo.attributes.position.needsUpdate = true;
}
const bloodPools = [];
function clearBlood() { while (bloodPools.length) { const b = bloodPools.pop(); scene.remove(b); b.geometry.dispose(); b.material.dispose(); } }
function addPool(x, y, z, r) { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#5e000d', transparent: true, opacity: .93, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.setScalar(.05); m.userData.r = r; scene.add(m); bloodPools.push(m); return m; }
function bloodBurst(w, n = 16) { for (let i = 0; i < n; i++) emit({ pos: w.clone().add(new THREE.Vector3(rnd(-.2, .2), rnd(0, .3), rnd(-.2, .2))), color: Math.random() < .5 ? '#b3001b' : '#7a0012', add: false, size: rnd(.1, .26), life: rnd(.6, 1.2), v: new THREE.Vector3(rnd(-1.8, 1.8), rnd(1.5, 4.2), rnd(-1.8, 1.8)), g: 8 }); }
function updateCut(dt) {
  const A = World.atk, S = World.S; if (!A || !S) return;
  if (S.phase !== 'nightAttack' && S.phase !== 'nightReturn') { World.atk = null; cutState = null; cutEl.style.opacity = 0; World.frozen = false; return; }
  const ct = World.time - A.t0, cs = cutState || (cutState = { victim: false, striker: A.striker });
  const chest = A.chest, snames = A.strikers.map(id => (S.players.find(p => p.id === id) || {}).name || '?').join(' & ');
  if (ct > 1.2 && !cs.f0) { cs.f0 = true; World.sfx && World.sfx('click'); }   // someone flicks the light on
  if (cs.victim && ct > 1.8 && !cs.f1) { cs.f1 = true; cs.unhood = true; cs.scared = true; flashEl.style.background = '#fff'; flashEl.style.opacity = 1; setTimeout(() => flashEl.style.opacity = 0, 160); cutEl.innerHTML = `<div class="cbig">IT'S ${snames.toUpperCase()}!</div>`; cutEl.style.opacity = 1; }
  if (ct > 2.4 && ct < 5.5) {
    cs.stab = true;
    if (World.time >= (A.nextHit || 0)) {   // a stab every ~0.45s
      A.nextHit = World.time + .45; A.hits++;
      if (A.saved) { burst(chest.clone().setY(1.2), '#ffe27a', 16, 4, .7); ringFx(chest.clone().setY(1), '#fff3b0', 2.2); World.sfx && World.sfx('holy'); }
      else {
        bloodBurst(chest, 18); World.shake = Math.max(World.shake, .5); World.sfx && World.sfx('stab');
        if (!A.pool) A.pool = addPool(chest.x, A.vlie ? .625 : .045, chest.z, A.vlie ? 1.0 : 1.3);
        if (cs.victim) { flashEl.style.background = '#c00020'; flashEl.style.opacity = .4; setTimeout(() => { flashEl.style.opacity = 0; flashEl.style.background = '#fff'; }, 110); }
      }
    }
  } else cs.stab = false;
  if (!A.saved && ct > 4.4) A.collapse = true;   // a standing victim crumples to the floor
  if (A.pool) {   // the victim bleeds out: the pool spreads, and (from a bed) drips onto the floor
    A.pool.scale.setScalar(Math.min(A.pool.userData.r, A.pool.scale.x + dt * .22));
    if (A.vlie && ct > 4 && !A.floor) { const fp = loc2w(A.vh, -1.45, -1.75); A.floor = addPool(fp.x, .045, fp.z, 1.15); }
    if (ct > 3 && Math.random() < dt * 6) { const w = chest.clone().add(new THREE.Vector3(rnd(-.3, .3), -.1, rnd(-.3, .3))); emit({ pos: w, color: '#8a0014', add: false, size: .12, life: .7, v: new THREE.Vector3(0, -.5, 0), g: 6 }); }
  }
  if (A.floor) A.floor.scale.setScalar(Math.min(A.floor.userData.r, A.floor.scale.x + dt * .18));
  if (ct > 5.6 && !cs.f3) {
    cs.f3 = true; cs.stab = false;
    if (cs.victim) {
      if (A.saved) { const w = chest.clone().setY(1.3); burst(w, '#ffe27a', 60, 6, 1.8); ringFx(w, '#fff3b0', 4); World.sfx && World.sfx('holy'); flashEl.style.background = '#ffe9a0'; flashEl.style.opacity = .9; setTimeout(() => { flashEl.style.opacity = 0; flashEl.style.background = '#fff'; }, 400); cutEl.innerHTML = `<div class="cbig gold">✨ SOMETHING PROTECTED YOU! ✨</div><div class="csm">You survived — and you saw it was ${snames}.</div>`; }
      else { flashEl.style.background = '#000'; flashEl.style.opacity = .93; cutEl.innerHTML = `<div class="cbig red">YOU WERE MURDERED</div><div class="csm">${snames} killed you. You bleed out… and become a ghost.</div>`; }
      cutEl.style.opacity = 1;
    } else if (A.role === 'striker') { cutEl.innerHTML = A.saved ? '<div class="cbig gold">🛡 THEY WERE PROTECTED!</div><div class="csm">A golden light stopped you. RUN HOME!</div>' : '<div class="cbig red">🩸 IT IS DONE</div><div class="csm">Run home before you are seen!</div>'; cutEl.style.opacity = 1; setTimeout(() => { if (World.atk === A) cutEl.style.opacity = 0; }, 4200); }
  }
}
World.shake = 0;
const tagTmp = new THREE.Vector3();
function updateLabels() {
  const S = World.S; if (!S || useDemo) { for (const id in ents) { ents[id].tag.style.display = 'none'; ents[id].bub.style.display = 'none'; ents[id].cnt.style.display = 'none'; } return; }
  const w = innerWidth, h = innerHeight;
  for (const id in ents) {
    const e = ents[id], p = e.p; const pos = e.ch.root.position;
    const show = !e.sil && !e.noLabel && (!e.hidden && (p.loc !== 'dead' || S.god) && e.ch.root.visible !== false || (id === S.you.id && !isGodView() && !e.hidden));
    tagTmp.set(pos.x, pos.y + (e.lieT > .5 ? .9 : 2.15) * e.ch.root.scale.y, pos.z);
    const d = camera.position.distanceTo(tagTmp); tagTmp.project(camera);
    const vis = show && tagTmp.z < 1 && tagTmp.z > -1 && d < 55 && !(cam.mode === 'eye' && id === S.you.id);
    if (!vis) { e.tag.style.display = 'none'; e.bub.style.display = 'none'; e.cnt.style.display = 'none'; continue; }
    const x = (tagTmp.x + 1) / 2 * w, y = (1 - tagTmp.y) / 2 * h, sc = clamp(1.25 - d / 70, .6, 1.1);
    e.tag.style.display = 'block'; e.tag.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${sc})`;
    const mine = id === S.you.id; const icon = p.role && (mine || S.god || p.role === 'mafia' || p.dead) ? (ROLE_ICON[p.role] || '') : '';
    const sel = World.mode && World.mode.selected === id;
    const html = `${icon ? `<span class="ri">${icon}</span>` : ''}${p.name}${mine ? ' <i>(you)</i>' : ''}`; if (e._html !== html) { e._html = html; e.tag.innerHTML = html; } e.tag.className = 'tag3' + (mine ? ' me' : '') + (sel ? ' sel' : '') + (p.alive === false ? ' dead' : '');
    const age = World.time - e.bubT;
    if (age < 7 && e.bubText) { e.bub.style.display = 'block'; e.bub.textContent = e.bubText; e.bub.style.opacity = age > 6 ? 7 - age : 1; e.bub.style.transform = `translate(${x}px,${y - 24}px) translate(-50%,-100%) scale(${sc})`; } else e.bub.style.display = 'none';
    const T = World.tally && World.time < (World.tallyUntil || 0) ? World.tally : null; const c = T && T.counts && T.counts[id];
    if (c) { e.cnt.style.display = 'block'; e.cnt.textContent = c; e.cnt.className = 'cnt3' + (T.eliminated === id ? ' out' : ''); e.cnt.style.transform = `translate(${x}px,${y - (age < 7 ? 80 : 30)}px) translate(-50%,-100%)`; } else e.cnt.style.display = 'none';
  }
}
World.bubble = (id, text) => { const e = ents[id]; if (e) { e.bubText = text.length > 110 ? text.slice(0, 108) + '…' : text; e.bubT = World.time; } };
// house markers
const houseMarks = new THREE.Group(); scene.add(houseMarks); const iconTex = {};
function emojiTex(ch) { if (!iconTex[ch]) iconTex[ch] = ctex(128, 128, (g, w, h) => { g.font = '96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, w / 2, h / 2 + 6); }); return iconTex[ch]; }
let hmSig = '';
function updateHouseMarks() {
  const S = World.S, mm = World.mode; const s = !S || useDemo || !mm || mm.kind !== 'house' ? '' : mm.icon + mm.selected + S.players.filter(p => mm.valid(p.id)).map(p => p.id).join();
  while (houseMarks.children.length) { const c = houseMarks.children.pop(); c.material && c.material.dispose(); c.geometry && c.geometry.dispose(); }
  if (!s) return;
  const t = World.time;
  S.players.forEach((p, i) => { if (!mm.valid(p.id) || !houses[i]) return; const h = houses[i], sel = mm.selected === p.id, hv = hover && hover.type === 'house' && hover.id === p.id; const d = door(i); const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color: sel ? mm.color : hv ? '#ffffff' : '#9fd0ff', transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, .1, d.z); ring.scale.setScalar(1 + Math.sin(t * 5) * .08 + (hv ? .2 : 0)); houseMarks.add(ring); if (sel) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(mm.icon), depthTest: false, transparent: true })); sp.position.set(h.x, 7.5 + Math.sin(t * 5) * .3, h.z); sp.scale.set(3, 3, 1); houseMarks.add(sp); const beam = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, 8, 8), new THREE.MeshBasicMaterial({ color: mm.color, transparent: true, opacity: .35, depthWrite: false })); beam.position.set(d.x, 4, d.z); houseMarks.add(beam); } });
}
// ======================= things you can interact with =======================
let nearSig = '', nearT = 0; World.near = [];
function updateNear(dt) {
  nearT -= dt; if (nearT > 0) return; nearT = .15;
  const S = World.S; let out = [];
  const e = S && !useDemo && !isGodView() ? myEnt() : null;
  if (e && S.you.alive && !World.frozen) {
    const P = e.ch.root.position, ph = S.phase, role = S.you.role, N = S.night, myI = S.players.findIndex(p => p.id === S.you.id);
    if (['day', 'vote', 'revote', 'voteResult', 'dawn'].includes(ph)) {
      S.players.filter(p => p.id !== S.you.id && p.alive && ents[p.id] && !ents[p.id].hidden && ents[p.id].ch.root.position.distanceTo(P) < 4.2).sort((a, b) => ents[a.id].ch.root.position.distanceTo(P) - ents[b.id].ch.root.position.distanceTo(P)).slice(0, 3).forEach(p => out.push({ act: 'talk', id: p.id, label: `💬 Talk to ${p.name}` }));
    }
    if (role === 'mafia' && N && ['nightSummon', 'nightActions', 'nightTravel'].includes(ph) && !N.weapon && Math.hypot(P.x - World.RACK.x, P.z - World.RACK.z) < 3.8) out.push({ act: 'weapon', w: 'knife', label: '🔪 Take the knife' }, { act: 'weapon', w: 'gun', label: '🔫 Take the gun' });
    if (role === 'mafia' && N && ph === 'nightTravel' && N.weapon && !N.struck && N.victimHouse >= 0 && houses[N.victimHouse]) {
      const vh = houses[N.victimHouse], b = loc2w(vh, -1.0, -1.5);
      if (inHouse(vh, P.x, P.z, .6) && Math.hypot(P.x - b.x, P.z - b.z) < 4.4) out.push({ act: 'murder', label: `${N.weapon === 'gun' ? '🔫 SHOOT' : '🗡 MURDER'} ${S.players[N.victimHouse].name}` });
    }
    if ((role === 'detective' || role === 'doctor') && N && N.open && !(role === 'detective' && N.used)) {
      let best = -1, bd = 1e9;
      houses.forEach((h, i) => { if (role === 'detective' && i === myI) return; const d = inHouse(h, P.x, P.z, .3) ? 2 : Math.hypot(P.x - door(i).x, P.z - door(i).z); if (d < 6.5 && d < bd) { bd = d; best = i; } });
      if (best >= 0) out.push(role === 'detective' ? { act: 'investigate', id: S.players[best].id, label: `🔍 Investigate ${S.players[best].name}'s house` } : { act: 'protect', id: S.players[best].id, label: `💉 Protect ${S.players[best].name}'s house` });
    }
  }
  if (e && S.you.alive && !World.frozen && !(World.atk && S.phase === 'nightAttack')) {   // things anyone can do at home
    const P = e.ch.root.position, myI = S.players.findIndex(p => p.id === S.you.id), meIn = currentHouse(e);
    if (e.sleep || e.lieT > .5) out.push({ act: 'getup', label: '🧍 Get up' });
    else {
      if (meIn === myI) { const b = bedStand(myI); if (Math.hypot(P.x - b.x, P.z - b.z) < 3.4) out.push({ act: 'sleep', label: '🛏 Lie down on your bed' }); }
      if (meIn >= 0) { const [lx, lz] = w2loc(houses[meIn], P.x, P.z); if (lz > .8) { const side = lx < 0 ? -1 : 1; if (Math.abs(lx - 2.2 * side) < 2.2) out.push({ act: 'window', side, h: meIn, label: '🪟 Look out of the window' }); } }
    }
  }
  const sig = out.map(o => o.act + (o.id || '') + (o.w || '') + o.label).join('|');
  if (sig !== nearSig) { nearSig = sig; World.near = out; World.onNear && World.onNear(out); }
}
addEventListener('keydown', ev => { if (/INPUT|TEXTAREA/.test(ev.target.tagName)) return; if (ev.code === 'KeyE' && World.near.length && World.onAct) World.onAct(World.near[0]); });
// glowing beacon + dotted path that tells you where to go
const guideBeam = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false })); guideBeam.visible = false; scene.add(guideBeam);
const guideLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#ffd24a', dashSize: .7, gapSize: .5, transparent: true, opacity: .95, depthTest: false })); guideLine.renderOrder = 5; guideLine.visible = false; guideLine.frustumCulled = false; scene.add(guideLine);
const guideEl = document.createElement('div'); guideEl.id = 'guide'; document.body.appendChild(guideEl);
function updateGuide() {
  const S = World.S; let g = null;
  const e = S && !useDemo && !isGodView() ? myEnt() : null;
  if (e && S.you.alive && houses.length) {
    const role = S.you.role, N = S.night, ph = S.phase, P = e.ch.root.position, myI = S.players.findIndex(p => p.id === S.you.id), homeIn = inHouse(houses[myI], P.x, P.z, .3), dd = door(myI);
    if (ph === 'nightFall' && !homeIn) g = { x: dd.x, z: dd.z, label: '🏠 Get inside your house!', color: '#ffb347' };
    else if (role === 'mafia' && N) {
      if ((ph === 'nightSummon' || ph === 'nightActions') && Math.hypot(P.x, P.z) > 6) g = { x: 0, z: 0, label: '🌑 Meeting ground', color: '#ff4d6a' };
      else if (ph === 'nightTravel') {
        if (!N.weapon) g = { x: World.RACK.x, z: World.RACK.z, label: '🔪 Weapon crate', color: '#ff4d6a' };
        else if (!N.struck && N.victimHouse >= 0 && houses[N.victimHouse]) { const vh = houses[N.victimHouse]; if (inHouse(vh, P.x, P.z, .3)) { const b = loc2w(vh, -1.0, -1.5); g = { x: b.x, z: b.z, label: '🗡 Find your victim', color: '#ff4d6a' }; } else { const d = door(N.victimHouse); g = { x: d.x, z: d.z, label: `🎯 ${S.players[N.victimHouse].name}'s house`, color: '#ff4d6a' }; } }
      } else if ((ph === 'nightAttack' || ph === 'nightReturn') && !homeIn) g = { x: dd.x, z: dd.z, label: '🏃 Run home!', color: '#ffb347' };
    } else if ((role === 'detective' || role === 'doctor') && ph === 'nightReturn' && !homeIn) g = { x: dd.x, z: dd.z, label: '🏃 Run home!', color: '#ffb347' };
  }
  if (!g) { guideBeam.visible = false; guideLine.visible = false; guideEl.style.display = 'none'; return; }
  const P = e.ch.root.position, col = g.color || '#ffd24a';
  guideBeam.visible = true; guideBeam.position.set(g.x, 20, g.z); guideBeam.material.color.set(col);
  guideLine.visible = true; guideLine.material.color.set(col); const pa = guideLine.geometry.attributes.position; pa.setXYZ(0, P.x, .15, P.z); pa.setXYZ(1, g.x, .15, g.z); pa.needsUpdate = true; guideLine.computeLineDistances();
  tagTmp.set(g.x, 4, g.z).project(camera);
  if (tagTmp.z < 1) { guideEl.style.display = 'block'; guideEl.style.borderColor = col; guideEl.innerHTML = `${g.label}<small> · ${Math.round(Math.hypot(P.x - g.x, P.z - g.z))} m</small>`; guideEl.style.transform = `translate(${(tagTmp.x + 1) / 2 * innerWidth}px,${clamp((1 - tagTmp.y) / 2 * innerHeight, 90, innerHeight - 160)}px) translate(-50%,-50%)`; } else guideEl.style.display = 'none';
}
World.localAct = a => {   // things only you see: lie down, get up, look out of a window
  const e = myEnt(), S = World.S; if (!e || !S) return; const myI = S.players.findIndex(p => p.id === S.you.id);
  if (a.act === 'sleep') { e.ch.root.position.copy(bedStand(myI)); e.lieT = 0; e.sleep = true; me.path.length = 0; if (cam.mode === 'eye') { cam.yaw = houses[myI].yaw; cam.eyeUp = .35; } }
  else if (a.act === 'getup') { e.sleep = false; if (cam.mode === 'eye') cam.eyeUp = -.05; }
  else if (a.act === 'window') { const h = houses[a.h]; e.sleep = false; e.lieT = 0; e.ch.lie = 0; e.ch.root.position.copy(loc2w(h, 2.2 * a.side, 2.3)); e.yaw = h.yaw; cam.yaw = h.yaw; cam.eyeUp = 0; me.path.length = 0; World.setCam('eye'); }
};
World.debugWalk = i => { const e = myEnt(); me.path = [door(i), doorIn(i), victimStand(i)]; if (e) e.sleep = false; };
World.teleport = m => {
  const e = myEnt(); if (!e || isGodView()) return;
  burst(e.ch.root.position.clone().setY(1), '#b48cff', 24, 4, .9);
  e.ch.root.position.set(m.x, 0, m.z); e.yaw = m.ry || 0; e.lieT = 0; e.ch.lie = 0; e.route = []; cam.yaw = m.ry || 0; cam.snap = true; lastSent = ''; hb = 9;
  burst(e.ch.root.position.clone().setY(1), '#b48cff', 24, 4, .9); World.sfx && World.sfx('ghost');
  if (m.note) World.onToast && World.onToast(m.note);
};
let hb = 0;
let qAcc = 0, qN = 0, qLevel = 0, shadowTick = 0, labelTick = 0;
function applyQuality() {   // the game quietly lowers its own detail if the device struggles
  if (qLevel === 1) { PIXR = Math.max(.8, PIXR - .3); renderer.setPixelRatio(PIXR); resize(); }
  else if (qLevel === 2) { key.castShadow = false; renderer.shadowMap.needsUpdate = true; }
  else { PIXR = Math.max(.65, PIXR - .2); renderer.setPixelRatio(PIXR); resize(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const el = now - clock.last; if (COARSE && el < 30) return;   // phones: 30 fps cap keeps them cool
  const dt = Math.min(.05, el / 1000); clock.last = now; World.time += dt;
  qAcc += el; qN++; if (qAcc > 2500) { const avg = qAcc / qN; qAcc = 0; qN = 0; if (avg > (COARSE ? 42 : 30) && qLevel < 3) { qLevel++; applyQuality(); } }
  if ((shadowTick = (shadowTick + 1) % (LOW ? 4 : 2)) === 0) renderer.shadowMap.needsUpdate = true;
  const night = applyTod(dt);
  updateEnts(dt, night); updateCut(dt); updateCamera(dt); updateFX(dt); if ((labelTick ^= 1)) updateLabels(); updateHouseMarks(); updateNear(dt); updateGuide();
  if (World.shake > .01) { camera.position.x += rnd(-1, 1) * World.shake * .15; camera.position.y += rnd(-1, 1) * World.shake * .15; World.shake *= .9; }
  // send my position to others
  sendT += dt; if (sendT > .1 && World.S && !useDemo && World.send) { sendT = 0; hb += .1; const e = myEnt(); if (e && e.control && World.S.you.alive && !isGodView()) { const p = e.ch.root.position; const s = `${p.x.toFixed(1)},${p.z.toFixed(1)},${e.yaw.toFixed(2)}`; if (s !== lastSent || hb > 1) { hb = 0; lastSent = s; World.send({ type: 'pos', x: p.x, z: p.z, ry: e.yaw }); } } }
  renderer.render(scene, camera);
}
World.onPos = m => { const e = ents[m.id]; if (e) e.remote = { x: m.x, z: m.z, ry: m.ry, t: World.time }; };
// the HUD shows my live camera mode
World.getMode = () => cam.mode;
syncPlayers(demoPlayers, true); World.setCam('top');
requestAnimationFrame(frame);
