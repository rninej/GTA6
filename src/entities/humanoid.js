// Palma City — procedural articulated humanoids with hand-authored animation.
//
// Every bone owns merged, vertex-coloured geometry so a fully detailed character
// is a single SkinnedMesh and a single draw call.
//
// Skeleton (model space, feet on y=0):
//
//   hips ─┬─ spine ── chest ─┬─ neck ── head ─┬─ lidL / lidR / jaw
//         │                  └─ shoulderL/R ── elbowL/R ── handR (gun mount)
//         └─ hipL/R ── kneeL/R ── footL/R ── toeL/R
//
// Legs are driven by an analytic two-bone IK to a model-space ankle target, so
// feet stay planted at any hip height (walk, run, crouch, land, seat) and the
// foot bone rolls heel-strike -> flat -> toe-off on the ground plane.
import * as THREE from 'three';
import { MODELS, instanceHuman } from '../world/models.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, angleDiff, TAU } from '../core/utils.js';
import { characterAtlas, tileUV, CT } from './character-atlas.js';

// Authored detail atlas: pores, weave, twill, grain, strands and brushed metal.
// Every cell is near-white so the per-part vertex colour still decides skin
// tone and fabric colour; the atlas only adds surface structure and relief.
const ATLAS = characterAtlas(8);

const matCache = new Map();

function mat(color, rough = 0.78, metal = 0.03) {
  const key = color + ':' + rough + ':' + metal;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    matCache.set(key, m);
  }
  return m;
}

// Cloth and skin both read as soft dielectric surfaces, so the body material
// carries a little sheen (fabric back-scatter) on top of the vertex colours.
// The sheen is deliberately weak: skin should be satin, not velvet.
const VC_MAT = new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.72, metalness: 0.02,
  map: ATLAS.map, normalMap: ATLAS.normalMap,
  normalScale: new THREE.Vector2(0.45, 0.45),
  sheen: 0.18, sheenColor: new THREE.Color(0xffd9c4), sheenRoughness: 0.9,
  envMapIntensity: 0.5
});
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.42, metalness: 0.65 });
const GUN_GLB_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.42, metalness: 0.65 });

// The downloaded guns are flattened to one shared geometry per weapon. Every
// armed actor still costs exactly one draw call, and the player's model changes
// with the selected weapon instead of every gun being the same block.
export function gunGeometry(key = 'pistol') {
  const entry = (MODELS.weapons || []).find((w) => w.id === key && w.geometry);
  return entry ? entry.geometry : GUN_GEO;
}
function gunMaterial(geo) { return geo === GUN_GEO ? GUN_MAT : GUN_GLB_MAT; }

const _c = new THREE.Color();

// Which atlas cell the next colorized part belongs to. Builders set this with
// useTile() and individual parts override it. Reset to null outside buildHuman
// so other entity builders that reuse colorize() keep their own UVs.
let CUR_TILE = null;
const TILE_SCALE = { 0: 1.5, 1: 2.6, 2: 3.2, 3: 2.0, 4: 1.3, 5: 1.0, 6: 2.2, 7: 1.6, 8: 13.0 };
export function useTile(t) { CUR_TILE = t; }

// Colour a geometry by vertex height, so a patch can fade into the skin at its
// edges instead of ending on a hard boundary.
export function colorizeFade(g, cLow, cHigh, yLow, yHigh, tile, scale) {
  const lo = new THREE.Color(cLow), hi = new THREE.Color(cHigh);
  const pos = g.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const span = (yHigh - yLow) || 1e-6;
  for (let i = 0; i < n; i++) {
    const t = clamp((pos.getY(i) - yLow) / span, 0, 1);
    arr[i * 3] = lo.r + (hi.r - lo.r) * t;
    arr[i * 3 + 1] = lo.g + (hi.g - lo.g) * t;
    arr[i * 3 + 2] = lo.b + (hi.b - lo.b) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (tile !== undefined) tileUV(g, tile, scale || (TILE_SCALE[tile] || 1));
  return g;
}

export function colorize(g, color, tile) {
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const t = tile === undefined ? CUR_TILE : tile;
  if (t !== null && t !== undefined) tileUV(g, t, TILE_SCALE[t] || 1);
  return g;
}

function shade(color, amt) {
  _c.set(color);
  return _c.clone().offsetHSL(0, 0, amt).getHex();
}

function mergeColored(list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].index) { const n = list[i].toNonIndexed(); list[i].dispose(); list[i] = n; }
    if (!list[i].attributes.uv) {
      const count = list[i].attributes.position.count;
      list[i].setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
  }
  const merged = BGU.mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return merged;
}

// Bind a part across two bones with a vertical falloff: weight 1 on `idxMain`
// at yMain, weight 1 on `idxOther` at yOther, smoothstepped between. This is
// what lets an outer sleeve bend across the elbow instead of staying rigid.
function skinPartBlend(list, idxMain, idxOther, yMain, yOther) {
  const span = (yOther - yMain) || 1e-6;
  for (const g of list) {
    const pos = g.attributes.position;
    const n = pos.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = clamp((pos.getY(i) - yMain) / span, 0, 1);
      const e = t * t * (3 - 2 * t);
      si[i * 4] = idxMain; sw[i * 4] = 1 - e;
      si[i * 4 + 1] = idxOther; sw[i * 4 + 1] = e;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
}

// Bind a part's geometry to one bone (weight 1). Everything is merged into a
// single SkinnedMesh afterwards, so a fully jointed character is one draw call.
function skinPart(list, boneIndex) {
  for (const g of list) {
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
}

// ---- primitives (fresh each time: they get merged and disposed) ----
const cap = (r, len, rs = 10) => new THREE.CapsuleGeometry(r, len, 4, rs);
const sph = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

const GUN_GEO = (() => {
  const parts = [];
  const body = box(0.048, 0.085, 0.21); body.translate(0, 0, 0.05); parts.push(body);
  const slide = box(0.05, 0.03, 0.19); slide.translate(0, 0.05, 0.06); parts.push(slide);
  const grip = box(0.042, 0.12, 0.055); grip.rotateX(0.3); grip.translate(0, -0.075, -0.02); parts.push(grip);
  const barrel = box(0.026, 0.026, 0.06); barrel.translate(0, 0.02, 0.17); parts.push(barrel);
  return BGU.mergeGeometries(parts, false);
})();

/* ------------------------------------------------------------------ *
 * Skeleton measurements (model space). Legs are solved against these.
 * ------------------------------------------------------------------ */
const HIP_Y = 0.92;
const HIP_DX = 0.098;
const HIP_DY = -0.02;
const THIGH = 0.42;
const SHIN = 0.375;
// Ankle height with the sole flat on the ground (sole bottom sits at -0.114
// in foot space).
const ANKLE_Y = 0.112;
// Pivots above the hips.
const SPINE_DY = 0.09;
const CHEST_DY = 0.31;   // spine + chest
const NECK_DY = 0.24;
const HEAD_DY = 0.032;
const LEG_REACH = THIGH + SHIN - 0.008;

/* ------------------------------------------------------------------ *
 * Body construction. Local space: feet at y=0, hips at 0.92, head top 1.78.
 * ------------------------------------------------------------------ */
function buildPelvis(list, o) {
  useTile(CT.denim);
  const pelvis = cyl(0.142, 0.128, 0.17, 12);
  pelvis.scale(1.0, 1, 0.72); pelvis.translate(0, 0.055, 0);
  list.push(colorize(pelvis, o.pants));
  const belt = cyl(0.147, 0.147, 0.045, 12);
  belt.scale(1.0, 1, 0.74); belt.translate(0, 0.14, 0);
  list.push(colorize(belt, o.belt || 0x201a16));
  const buckle = box(0.05, 0.032, 0.02); buckle.translate(0, 0.14, 0.112);
  list.push(colorize(buckle, 0xc8a24a, CT.metal));
  // belt loops
  for (let i = 0; i < 5; i++) {
    const a = -0.55 + i * 0.275;
    const loop = box(0.014, 0.055, 0.012);
    loop.rotateY(a);
    loop.translate(Math.sin(a) * 0.145, 0.152, Math.cos(a) * 0.108);
    list.push(colorize(loop, shade(o.pants, -0.14)));
  }
  // trouser front pockets
  for (const s of [-1, 1]) {
    const pk = box(0.05, 0.062, 0.012);
    pk.translate(s * 0.088, 0.072, 0.099);
    list.push(colorize(pk, shade(o.pants, -0.08)));
    const lip = box(0.052, 0.007, 0.013);
    lip.translate(s * 0.088, 0.104, 0.1);
    list.push(colorize(lip, shade(o.pants, -0.16)));
  }
  // shirt hem sitting over the waistband
  const hem = cyl(0.152, 0.16, 0.05, 12);
  hem.scale(1.03, 1, 0.74); hem.translate(0, 0.152, 0);
  list.push(colorize(hem, shade(o.shirt, -0.05)));
  // fly seam
  const fly = box(0.008, 0.07, 0.012);
  fly.translate(0, 0.09, 0.103);
  list.push(colorize(fly, shade(o.pants, -0.18)));
}

function buildTorso(list, o) {
  useTile(CT.cloth);
  const shirt = o.shirt;
  // ribcage / torso: tapered so it reads as a body, not a capsule
  const torso = cyl(0.176, 0.146, 0.38, 18);
  torso.scale(1.06, 1, 0.7); torso.translate(0, 0.34, 0);
  list.push(colorize(torso, shirt));
  // chest volume
  const chest = sph(0.163, 18, 12);
  chest.scale(1.07, 0.8, 0.68); chest.translate(0, 0.44, 0.008);
  list.push(colorize(chest, shirt));
  // pectorals: two shallow domes, so the front is a chest rather than a wall
  for (const s of [-1, 1]) {
    const pec = sph(0.062, 12, 9);
    pec.scale(1.06, 0.7, 0.42);
    pec.translate(s * 0.071, 0.408, 0.098);
    list.push(colorize(pec, shade(shirt, 0.01)));
  }
  // waist ring, narrower than the ribcage: gives the torso a taper
  const waist = cyl(0.146, 0.15, 0.1, 18);
  waist.scale(1.06, 1, 0.72);
  waist.translate(0, 0.185, 0);
  list.push(colorize(waist, shade(shirt, -0.035)));
  // placket / zip
  const zip = box(0.022, 0.36, 0.018);
  zip.translate(0, 0.33, 0.126);
  list.push(colorize(zip, shade(shirt, -0.16)));
  const pull = box(0.016, 0.026, 0.012);
  pull.translate(0, 0.512, 0.132);
  list.push(colorize(pull, 0xb9bec6, CT.metal));
  // chest pockets
  for (const s of [-1, 1]) {
    const pk = box(0.075, 0.06, 0.012);
    pk.translate(s * 0.085, 0.4, 0.128);
    list.push(colorize(pk, shade(shirt, -0.07)));
    const pf = box(0.078, 0.008, 0.014);
    pf.translate(s * 0.085, 0.432, 0.129);
    list.push(colorize(pf, shade(shirt, -0.16)));
  }
  // side seams
  for (const s of [-1, 1]) {
    const seam = box(0.007, 0.33, 0.012);
    seam.translate(s * 0.166, 0.33, 0.046);
    list.push(colorize(seam, shade(shirt, -0.15)));
  }
  // cloth folds across the chest: shallow creases under the pecs
  for (let i = 0; i < 3; i++) {
    const f = box(0.19 - i * 0.022, 0.011, 0.018);
    f.rotateZ((i % 2 ? 1 : -1) * 0.05);
    f.translate(0, 0.30 + i * 0.058, 0.118 - i * 0.004);
    list.push(colorize(f, shade(shirt, -0.11 - i * 0.02)));
  }

  // Jacket worn open over the shirt. It is a shell that wraps the back and
  // sides but stops short of the front centre, so the shirt, zip and pockets
  // underneath stay visible: the layers read as clothing, not a recolour.
  if (o.jacket) {
    useTile(CT.denim);
    const jk = o.jacket;
    const shell = new THREE.CylinderGeometry(0.188, 0.158, 0.43, 16, 1, true,
      Math.PI * 0.2, Math.PI * 1.6);
    shell.scale(1.06, 1, 0.74);
    shell.translate(0, 0.345, 0);
    list.push(colorize(shell, jk));
    // hem band and shoulder yoke
    const hem = new THREE.CylinderGeometry(0.191, 0.191, 0.034, 16, 1, true,
      Math.PI * 0.2, Math.PI * 1.6);
    hem.scale(1.06, 1, 0.74);
    hem.translate(0, 0.138, 0);
    list.push(colorize(hem, shade(jk, -0.14)));
    const collar = new THREE.CylinderGeometry(0.088, 0.1, 0.055, 14, 1, true);
    collar.scale(1.05, 1, 0.86);
    collar.translate(0, 0.552, 0.004);
    list.push(colorize(collar, shade(jk, -0.07)));
    for (const s of [-1, 1]) {
      // lapel folded back from the opening
      const lap = box(0.054, 0.15, 0.022);
      lap.rotateZ(s * 0.16);
      lap.rotateY(s * 0.5);
      lap.translate(s * 0.06, 0.452, 0.106);
      list.push(colorize(lap, shade(jk, 0.05)));
      // patch pocket low on the front
      const pk = box(0.062, 0.05, 0.016);
      pk.translate(s * 0.106, 0.238, 0.102);
      list.push(colorize(pk, shade(jk, -0.08)));
      // piping down the front edge of the opening
      const edge = box(0.013, 0.4, 0.02);
      edge.translate(s * 0.031, 0.34, 0.116);
      list.push(colorize(edge, shade(jk, -0.2)));
    }
  }
}

function buildChest(list, o) {
  useTile(o.jacket ? CT.denim : CT.cloth);
  const shirt = o.shirt, skin = o.skin;
  // shoulder caps and traps follow the outer layer, so a jacket's shoulders are
  // jacket coloured instead of reading as bare shirt patches
  const outer = o.jacket || shirt;
  for (const s of [-1, 1]) {
    const delt = sph(0.072, 10, 8);
    delt.scale(1, 0.95, 0.95); delt.translate(s * 0.185, 0.475, 0);
    list.push(colorize(delt, shade(outer, 0.02)));
  }
  // shoulder caps that overlap the arm's own deltoid, so the arm-to-torso join
  // is a rounded socket instead of a hard box edge
  for (const s of [-1, 1]) {
    const cap = sph(0.079, 12, 9);
    cap.scale(1.0, 0.88, 0.93);
    cap.translate(s * 0.163, 0.462, 0);
    list.push(colorize(cap, shade(outer, 0.012)));
  }
  // trapezius: a wedge from the neck out to each shoulder, not a flat shelf
  for (const s of [-1, 1]) {
    const trap = sph(0.055, 9, 7);
    trap.scale(1.35, 0.4, 0.82);
    trap.rotateZ(s * 0.3);
    trap.translate(s * 0.108, 0.503, -0.012);
    list.push(colorize(trap, shade(outer, -0.03)));
  }
  // collar
  const collar = cyl(0.081, 0.09, 0.05, 12);
  collar.scale(1.05, 1, 0.85); collar.translate(0, 0.532, 0.006);
  list.push(colorize(collar, shade(shirt, -0.1)));
  // neck
  const neck = cyl(0.05, 0.058, 0.1, 10);
  neck.translate(0, 0.566, 0.004);
  list.push(colorize(neck, skin, CT.skin));
  // sternocleidomastoid, so the neck is not a plain tube from the front
  for (const s of [-1, 1]) {
    const scm = cyl(0.011, 0.009, 0.075, 6);
    scm.rotateX(0.1); scm.rotateZ(s * 0.16);
    scm.translate(s * 0.024, 0.556, 0.036);
    list.push(colorize(scm, shade(skin, -0.03), CT.skin));
  }
  // open collar flaps
  for (const s of [-1, 1]) {
    const flap = box(0.05, 0.05, 0.018);
    flap.rotateZ(s * 0.4); flap.rotateY(s * 0.28);
    flap.translate(s * 0.043, 0.512, 0.092);
    list.push(colorize(flap, shade(shirt, -0.12)));
  }
}

function buildHead(list, o) {
  useTile(CT.skin);
  const skin = o.skin, hair = o.hair;
  // cranium
  const skull = sph(0.092, 26, 20);
  skull.scale(1.0, 1.02, 1.0);
  skull.translate(0, 0.138, 0);
  list.push(colorize(skull, skin));
  // occiput: the skull is deeper behind the ear line than in front
  const occ = sph(0.078, 18, 14);
  occ.scale(0.98, 0.95, 0.7);
  occ.translate(0, 0.128, -0.036);
  list.push(colorize(occ, skin));
  // jaw: a wedge from the cheekbones down to the chin, not a ball
  const jaw = cyl(0.086, 0.043, 0.1, 20);
  jaw.scale(1, 1, 0.9);
  jaw.translate(0, 0.086, 0.002);
  list.push(colorize(jaw, skin));
  // mouth interior: dark cavity revealed when the jaw opens
  const cavity = sph(0.021, 9, 7);
  cavity.scale(1.0, 0.4, 0.45);
  cavity.translate(0, 0.0615, 0.0455);
  list.push(colorize(cavity, 0x2a1416));
  // cheekbone: flat pads, not balls
  for (const s of [-1, 1]) {
    const ck = sph(0.028, 8, 6);
    ck.scale(1, 0.42, 0.3);
    ck.translate(s * 0.059, 0.098, 0.041);
    list.push(colorize(ck, shade(skin, 0.012)));
  }
  // nose: bridge, tip and wings
  const bridge = box(0.02, 0.058, 0.017);
  bridge.rotateX(0.06);
  bridge.translate(0, 0.116, 0.0865);
  list.push(colorize(bridge, shade(skin, -0.02)));
  const tip = sph(0.019, 9, 7);
  tip.scale(1.05, 0.82, 1.0);
  tip.translate(0, 0.0935, 0.0845);
  list.push(colorize(tip, shade(skin, 0.03)));
  for (const s of [-1, 1]) {
    const wing = sph(0.0122, 7, 5);
    wing.scale(1, 0.8, 0.9);
    wing.translate(s * 0.018, 0.0895, 0.0825);
    list.push(colorize(wing, shade(skin, -0.04)));
    const nostril = sph(0.005, 5, 4);
    nostril.translate(s * 0.0135, 0.0855, 0.0875);
    list.push(colorize(nostril, shade(skin, -0.42)));
  }
  // eyes: dark socket patch, sclera, iris, pupil, lash line
  for (const s of [-1, 1]) {
    const soc = sph(0.0205, 10, 8);
    soc.scale(1.0, 0.62, 0.3);
    soc.translate(s * 0.036, 0.135, 0.0795);
    list.push(colorize(soc, shade(skin, -0.32)));
    const eye = sph(0.015, 14, 10);
    eye.scale(1.0, 0.7, 0.34);
    eye.translate(s * 0.036, 0.135, 0.0815);
    list.push(colorize(eye, 0xdedad2, CT.eye));
    const iris = sph(0.0072, 10, 8);
    iris.scale(1, 1, 0.34);
    iris.translate(s * 0.036, 0.1345, 0.0848);
    list.push(colorize(iris, o.eye || 0x3a2a1c, CT.eye));
    const pupil = sph(0.0036, 8, 6);
    pupil.scale(1, 1, 0.3);
    pupil.translate(s * 0.036, 0.1345, 0.0874);
    list.push(colorize(pupil, 0x07070a, CT.eye));
    const lash = box(0.028, 0.0042, 0.006);
    lash.rotateZ(s * -0.06);
    lash.translate(s * 0.036, 0.1425, 0.0855);
    list.push(colorize(lash, shade(skin, -0.5)));
    const eb = box(0.029, 0.006, 0.007);
    eb.rotateZ(s * -0.1);
    eb.translate(s * 0.037, 0.1518, 0.0845);
    list.push(colorize(eb, hair, CT.hair));
    // individual brow hairs laid over the ridge, so the brow reads as hair at
    // portrait distance instead of a painted bar
    for (let i = 0; i < 14; i++) {
      const u = (i / 13) - 0.5;
      const bh = box(0.0045, 0.0016, 0.0105);
      bh.rotateZ(s * (-0.1 + u * 0.42));
      bh.rotateX(-0.1 + (i % 3) * 0.08);
      bh.translate(s * (0.037 + u * 0.026), 0.1526 + Math.abs(u) * -0.004, 0.0852 + (i % 2) * 0.0012);
      list.push(colorize(bh, shade(hair, (i % 4) * 0.05 - 0.06), CT.hair));
    }
  }
  // brow ridge
  for (const s of [-1, 1]) {
    const br = box(0.044, 0.01, 0.012);
    br.rotateZ(s * 0.1);
    br.translate(s * 0.03, 0.1525, 0.0775);
    list.push(colorize(br, shade(skin, -0.05)));
  }
  // mouth
  const lip = box(0.038, 0.0085, 0.011);
  lip.translate(0, 0.0675, 0.0605);
  list.push(colorize(lip, o.lips || shade(skin, -0.26)));
  const phil = box(0.009, 0.015, 0.005);
  phil.translate(0, 0.0765, 0.0665);
  list.push(colorize(phil, shade(skin, -0.14)));

  // --- cranial structure -------------------------------------------------
  // chin with a form of its own, mandible angles, temples, lip volumes and
  // eyelid creases: at the close-up camera the head has to read as a skull
  // under skin, not as a sphere with features stuck on.
  // (the chin volume itself lives on the jaw bone, so it opens with the mouth)
  for (const s of [-1, 1]) {
    // mandible angle where the jawline turns up toward the ear
    const ang = sph(0.0175, 8, 6);
    ang.scale(0.8, 1.0, 0.72);
    ang.translate(s * 0.0655, 0.0625, 0.008);
    list.push(colorize(ang, shade(skin, -0.05)));
    // nasolabial crease from the nose wing toward the mouth corner
    const nl = box(0.005, 0.025, 0.006);
    nl.rotateZ(s * 0.3);
    nl.translate(s * 0.0275, 0.0675, 0.0715);
    list.push(colorize(nl, shade(skin, -0.13)));
    // temple: flattens the skull above the cheekbone
    const tmp = sph(0.03, 8, 6);
    tmp.scale(0.42, 1.0, 0.92);
    tmp.translate(s * 0.0775, 0.152, 0.026);
    list.push(colorize(tmp, shade(skin, -0.035)));
    // cheek hollow under the cheekbone
    const hol = sph(0.024, 8, 6);
    hol.scale(0.8, 0.85, 0.34);
    hol.translate(s * 0.05, 0.0855, 0.062);
    list.push(colorize(hol, shade(skin, -0.03)));
    // upper lip halves meeting at the cupid's bow
    const bow = sph(0.0068, 6, 5);
    bow.scale(1.2, 0.62, 0.6);
    bow.translate(s * 0.0115, 0.0765, 0.0645);
    list.push(colorize(bow, o.lips || shade(skin, -0.2)));
    // eyelid crease above the lid
    const cr = box(0.029, 0.0042, 0.006);
    cr.rotateZ(s * -0.1);
    cr.translate(s * 0.036, 0.1472, 0.0805);
    list.push(colorize(cr, shade(skin, -0.19)));
  }
  // upper lip ridge and a fuller lower lip
  const ulip = box(0.031, 0.0062, 0.008);
  ulip.translate(0, 0.0742, 0.0625);
  list.push(colorize(ulip, o.lips || shade(skin, -0.24)));
  const llip = sph(0.0175, 9, 7);
  llip.scale(1.22, 0.5, 0.5);
  llip.translate(0, 0.0575, 0.0575);
  list.push(colorize(llip, o.lips || shade(skin, -0.17)));
  // stubble / beard shadow for the characters that carry one
  if (o.stubble) {
    // The shell carries the per-hair texture and stays close to the skin
    // colour, so the tone reads through the beard instead of being masked by a
    // flat dark shape.
    const beardDark = shade(skin, -0.085), beardLight = shade(skin, 0.02);
    for (const s of [-1, 1]) {
      const st = sph(0.031, 12, 9);
      st.scale(0.66, 0.86, 0.15);
      st.translate(s * 0.047, 0.0575, 0.0455);
      // fades to plain skin at the cheekbone, so the beard has no hard edge
      list.push(colorizeFade(st, beardDark, beardLight, 0.041, 0.081, CT.stubble, 20));
    }
    const chinSt = sph(0.027, 12, 9);
    chinSt.scale(1.05, 0.62, 0.18);
    chinSt.translate(0, 0.0485, 0.0495);
    list.push(colorizeFade(chinSt, beardDark, beardLight, 0.036, 0.072, CT.stubble, 20));
    // Individual hairs sitting on the jaw surface. The jaw is a tapered
    // cylinder, so the radius is solved per hair: they land on the skin instead
    // of floating in front of it.
    for (let i = 0; i < 46; i++) {
      const ang = -1.15 + (i % 13) * 0.19;
      const hy = 0.0455 + ((i * 5) % 8) * 0.0038;
      const t = clamp((hy - 0.036) / 0.1, 0, 1);
      const rr = 0.043 + (0.086 - 0.043) * t;
      const hx = Math.sin(ang) * rr * 0.995;
      const hz = Math.cos(ang) * rr * 0.9 * 0.995 + 0.002;
      const bit = box(0.0015, 0.0034 + (i % 3) * 0.0014, 0.0011);
      bit.rotateZ(ang * 0.5);
      bit.translate(hx, hy, hz);
      list.push(colorize(bit, shade(skin, -0.34), CT.hair));
    }
  }
  // ears
  for (const s of [-1, 1]) {
    const ear = sph(0.024, 8, 6);
    ear.scale(0.42, 1.0, 0.78);
    ear.translate(s * 0.09, 0.125, 0.006);
    list.push(colorize(ear, shade(skin, -0.05)));
    const lobe = sph(0.011, 6, 5);
    lobe.scale(0.5, 0.8, 0.8);
    lobe.translate(s * 0.091, 0.109, 0.008);
    list.push(colorize(lobe, shade(skin, -0.09)));
    const inner = sph(0.013, 6, 5);
    inner.scale(0.28, 0.85, 0.62);
    inner.translate(s * 0.094, 0.128, 0.004);
    list.push(colorize(inner, shade(skin, -0.24)));
  }
  // hair
  useTile(CT.hair);
  const hv = o.hairStyle || (o.female ? 'long' : 'short');
  if (hv === 'short') {
    for (const s of [-1, 1]) {
      const sb = box(0.012, 0.04, 0.026);
      sb.translate(s * 0.081, 0.148, 0.018);
      list.push(colorize(sb, shade(hair, -0.02)));
    }
  }
  if (hv !== 'bald') {
    const cap1 = new THREE.SphereGeometry(0.096, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
    cap1.scale(0.99, 1.1, 1.0);
    cap1.translate(0, 0.14, -0.006);
    list.push(colorize(cap1, hair));
    const backH = sph(0.08, 12, 9);
    backH.scale(1.0, 1.0, 0.7);
    backH.translate(0, 0.125, -0.044);
    list.push(colorize(backH, hair));
    // hairline: a widow's peak and crisp temple edges, so the hair meets the
    // forehead along a line instead of ending in a smooth cap
    const peak = new THREE.SphereGeometry(0.0978, 16, 6, Math.PI * 0.74, Math.PI * 0.52, 0.3, 0.34);
    peak.scale(1.0, 1.05, 1.0);
    peak.translate(0, 0.1425, 0.002);
    list.push(colorize(peak, shade(hair, 0.025)));
    for (const s of [-1, 1]) {
      const side = box(0.013, 0.052, 0.032);
      side.translate(s * 0.0835, 0.106, 0.028);
      list.push(colorize(side, shade(hair, -0.05)));
    }
    // strand cards: thin tapered slivers laid over the shell so both the
    // surface and the silhouette break up at close range instead of reading as
    // one smooth helmet, and no shell edge shows as a bald seam
    for (let i = 0; i < 88; i++) {
      const a = (i / 88) * Math.PI * 2 + (i % 5) * 0.021;
      const t = 0.42 + (i % 5) * 0.12;
      const sx = Math.sin(a) * Math.sin(t) * 0.0985;
      const sz = Math.cos(a) * Math.sin(t) * 0.0985;
      const sy = Math.cos(t) * 0.0985;
      const sl = box(0.0058, 0.018 + (i % 4) * 0.005, 0.003);
      sl.rotateZ(-sx * 2.6);
      sl.rotateX(sz * 2.6);
      sl.translate(sx * 1.005, 0.138 + sy * 1.02, sz * 1.005 - 0.006);
      list.push(colorize(sl, shade(hair, ((i % 7) - 3) * 0.011)));
    }
    // layered shell strips so the hair silhouette is not one smooth helmet
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.SphereGeometry(0.0988 + i * 0.0016, 16, 5,
        0, Math.PI * 2, 0.18 + i * 0.24, 0.26);
      strip.scale(1.0, 1.06, 1.02);
      strip.translate(0, 0.138, -0.008);
      list.push(colorize(strip, shade(hair, 0.035 - i * 0.022)));
    }
  }
  if (hv === 'long') {
    const bh = box(0.128, 0.24, 0.066);
    bh.translate(0, -0.02, -0.072);
    list.push(colorize(bh, hair));
    for (const s of [-1, 1]) {
      const strand = box(0.032, 0.19, 0.055);
      strand.translate(s * 0.079, 0.008, 0.002);
      list.push(colorize(strand, shade(hair, -0.03)));
    }
    const fringe = box(0.15, 0.048, 0.048);
    fringe.translate(0, 0.196, 0.058);
    list.push(colorize(fringe, shade(hair, 0.02)));
    // a few loose strands over the shoulders
    for (const s of [-1, 1]) {
      const lock = box(0.026, 0.16, 0.03);
      lock.rotateZ(s * 0.08);
      lock.translate(s * 0.09, -0.06, 0.028);
      list.push(colorize(lock, shade(hair, -0.06)));
    }
  } else if (hv === 'bun') {
    const bun = sph(0.052, 10, 8);
    bun.scale(1, 0.9, 1);
    bun.translate(0, 0.205, -0.086);
    list.push(colorize(bun, shade(hair, 0.02)));
  } else if (hv === 'ponytail') {
    const tie = cyl(0.021, 0.021, 0.03, 8);
    tie.rotateX(Math.PI / 2);
    tie.translate(0, 0.17, -0.096);
    list.push(colorize(tie, shade(hair, 0.05)));
    const tail = cap(0.034, 0.16, 8);
    tail.rotateX(-0.45);
    tail.translate(0, 0.07, -0.128);
    list.push(colorize(tail, hair));
  }
  useTile(CT.knit);
  if (o.hat) {
    const crown = new THREE.SphereGeometry(0.104, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    crown.scale(0.99, 1.0, 1.0);
    crown.translate(0, 0.198, -0.004);
    list.push(colorize(crown, o.hat));
    const brim = box(0.196, 0.015, 0.098);
    brim.translate(0, 0.19, 0.096);
    list.push(colorize(brim, shade(o.hat, -0.05)));
    const band = cyl(0.1035, 0.1035, 0.016, 14);
    band.translate(0, 0.202, -0.004);
    list.push(colorize(band, shade(o.hat, -0.12)));
  }
  useTile(CT.skin);
}

// Lower jaw: chin and lower lip, drawn in jaw-bone space (bone sits at
// head-local 0, 0.078, 0.012) so it can open for talking and recoil.
function buildJaw(list, o) {
  useTile(CT.skin);
  const skin = o.skin;
  const chin = sph(0.024, 9, 7);
  chin.scale(1.15, 0.85, 0.9);
  chin.translate(0, -0.042, 0.014);
  list.push(colorize(chin, skin));
  const lipLow = box(0.03, 0.0075, 0.01);
  lipLow.translate(0, -0.0195, 0.0475);
  list.push(colorize(lipLow, shade(skin, -0.07)));
  return list;
}

// Eyelid: a shell that swings down over the eye when the lid bone rotates.
function buildLid(list, o) {
  useTile(CT.skin);
  const lid = sph(0.0182, 10, 8);
  lid.scale(1.02, 0.62, 0.55);
  lid.translate(0, -0.0075, 0.0008);
  list.push(colorize(lid, shade(o.skin, 0.01)));
  return list;
}

function buildArm(list, o) {
  useTile(o.jacket ? CT.denim : CT.cloth);
  const shirt = o.jacket || o.shirt, skin = o.skin;
  // rounded deltoid so the shoulder silhouette is not a cut cylinder
  const delt = sph(0.066, 10, 8);
  delt.scale(1, 0.9, 0.95);
  delt.translate(0, -0.006, 0);
  list.push(colorize(delt, shirt));
  const sleeve = cyl(0.063, 0.049, 0.17, 10);
  sleeve.scale(1, 1, 0.95);
  sleeve.translate(0, -0.1, 0);
  list.push(colorize(sleeve, shirt));
  // cuff rolled back from the wrist
  const cuff = cyl(0.05, 0.047, 0.03, 10);
  cuff.translate(0, -0.19, 0);
  list.push(colorize(cuff, shade(shirt, -0.12)));
  const upper = cap(0.045, 0.1, 9);
  upper.translate(0, -0.235, 0);
  list.push(colorize(upper, skin, CT.skin));
  // biceps belly
  const biceps = sph(0.043, 9, 7);
  biceps.scale(1, 0.9, 0.94);
  biceps.translate(0, -0.2, 0.004);
  list.push(colorize(biceps, shade(skin, 0.015), CT.skin));
  return list;
}

function buildForearm(list, o) {
  useTile(o.jacket ? CT.denim : CT.cloth);
  const skin = o.skin;
  // elbow ball on the joint pivot: fills the notch that opens when the arm is
  // bent, and carries the sleeve colour when a jacket is worn
  const elbowBall = sph(0.049, 10, 8);
  elbowBall.scale(1, 0.94, 0.96);
  elbowBall.translate(0, 0.004, 0);
  list.push(colorize(elbowBall, o.jacket ? o.jacket : shade(skin, -0.02), o.jacket ? CT.denim : CT.skin));
  const fore = cap(0.043, 0.16, 9);
  fore.scale(1, 1, 0.92); fore.translate(0, -0.105, 0);
  list.push(colorize(fore, skin));
  // jacket sleeve carried down the forearm to a buttoned cuff at the wrist
  if (o.jacket) {
    const sl = cyl(0.056, 0.048, 0.17, 12);
    sl.translate(0, -0.092, 0);
    list.push(colorize(sl, o.jacket));
    const jcuff = cyl(0.049, 0.046, 0.034, 12);
    jcuff.translate(0, -0.178, 0);
    list.push(colorize(jcuff, shade(o.jacket, -0.15)));
    const btn = sph(0.006, 6, 5);
    btn.translate(0.032, -0.172, 0.026);
    list.push(colorize(btn, 0x9aa0a6, CT.metal));
  }
  // forearm swell below the elbow
  const swell = sph(0.046, 9, 7);
  swell.scale(1, 0.72, 0.92); swell.translate(0, -0.058, 0.002);
  list.push(colorize(swell, shade(skin, 0.02)));
  // wrist
  const wrist = cyl(0.036, 0.031, 0.035, 8);
  wrist.translate(0, -0.2, 0);
  list.push(colorize(wrist, shade(skin, -0.05)));
  // wrist watch on the left arm only
  if (o.watch) {
    const strap = cyl(0.038, 0.038, 0.016, 12);
    strap.translate(0, -0.196, 0);
    list.push(colorize(strap, 0x1a1a1c));
    const face = box(0.024, 0.026, 0.008);
    face.translate(0, -0.196, 0.036);
    list.push(colorize(face, 0xd8d2c4, CT.metal));
  }
  // palm: flattened, wider at the knuckles, with a thenar pad
  useTile(CT.skin);
  const palm = box(0.06, 0.072, 0.044);
  palm.translate(0, -0.243, 0.006);
  list.push(colorize(palm, skin));
  // back of the hand: rounded so the palm is not a flat slab
  const backHand = sph(0.032, 9, 7);
  backHand.scale(0.95, 1.05, 0.62);
  backHand.translate(0, -0.246, 0.004);
  list.push(colorize(backHand, shade(skin, 0.01)));
  const thenar = sph(0.026, 8, 6);
  thenar.scale(1, 0.92, 0.82); thenar.translate(-0.027, -0.238, 0.024);
  list.push(colorize(thenar, shade(skin, 0.02)));
  // knuckle row
  const knuck = box(0.058, 0.024, 0.046);
  knuck.translate(0, -0.281, 0.008);
  list.push(colorize(knuck, shade(skin, -0.03)));
  // four separate fingers, splayed slightly and curled into a relaxed hand
  for (let i = 0; i < 4; i++) {
    const fx = -0.0198 + i * 0.0132;
    const len = 0.042 - Math.abs(i - 1.2) * 0.0035;
    const f1 = cyl(0.0072, 0.0066, len, 6);
    f1.rotateX(-0.08);
    f1.translate(fx, -0.296 - len * 0.3, 0.011);
    list.push(colorize(f1, shade(skin, i === 3 ? -0.02 : 0.012)));
    const f2 = cyl(0.0066, 0.0054, len * 0.78, 6);
    f2.rotateX(-0.4);
    f2.translate(fx, -0.318 - len * 0.48, 0.02);
    list.push(colorize(f2, shade(skin, -0.055)));
    // knuckle crease at the finger base
    const kn = box(0.0115, 0.004, 0.009);
    kn.translate(fx, -0.2885, 0.0165);
    list.push(colorize(kn, shade(skin, -0.17)));
    // nail bed on the fingertip
    const nail = box(0.0078, 0.0065, 0.0035);
    nail.translate(fx, -0.317 - len * 0.52, 0.0235);
    list.push(colorize(nail, shade(skin, 0.16)));
  }
  // thumb: two segments, angled across the palm
  const th1 = cyl(0.0088, 0.0078, 0.031, 6);
  th1.rotateZ(0.72); th1.translate(-0.036, -0.262, 0.026);
  list.push(colorize(th1, shade(skin, 0.03)));
  const th2 = cyl(0.0078, 0.0063, 0.027, 6);
  th2.rotateZ(0.5); th2.translate(-0.043, -0.282, 0.031);
  list.push(colorize(th2, shade(skin, -0.02)));
  return list;
}

function buildLeg(list, o) {
  useTile(CT.denim);
  const pants = o.pants;
  // hip ball: fills the step between the pelvis cylinder and the thigh so the
  // leg does not start as a narrower tube hanging under the hips
  const hipBall = sph(0.086, 10, 8);
  hipBall.scale(1.02, 0.92, 0.96); hipBall.translate(0, -0.012, 0);
  list.push(colorize(hipBall, pants));
  const thigh = cyl(0.084, 0.066, 0.36, 10);
  thigh.scale(1, 1, 0.94); thigh.translate(0, -0.2, 0);
  list.push(colorize(thigh, pants));
  const kneeCap = sph(0.068, 10, 8);
  kneeCap.scale(1, 0.92, 0.96); kneeCap.translate(0, -0.385, 0.006);
  list.push(colorize(kneeCap, shade(pants, -0.03)));
  // cloth creases above the knee: narrow and only across the front, so they
  // read as folded fabric instead of rings around the leg
  for (let i = 0; i < 2; i++) {
    const cr = box(0.05, 0.008, 0.01);
    cr.translate(0, -0.3 - i * 0.045, 0.06);
    list.push(colorize(cr, shade(pants, -0.07)));
  }
  // cargo pocket
  const pk = box(0.055, 0.08, 0.02);
  pk.translate(0.055, -0.14, 0.055);
  list.push(colorize(pk, shade(pants, -0.06)));
  const flap = box(0.058, 0.012, 0.022);
  flap.translate(0.055, -0.104, 0.055);
  list.push(colorize(flap, shade(pants, -0.13)));
  return list;
}

function buildShin(list, o) {
  useTile(CT.denim);
  const pants = o.pants;
  // knee ball on the joint pivot, so the thigh and shin meet in a bend instead
  // of showing a step in the silhouette when the knee is flexed
  const kneeBall = sph(0.067, 10, 8);
  kneeBall.scale(1, 0.9, 0.95); kneeBall.translate(0, -0.004, 0.004);
  list.push(colorize(kneeBall, pants));
  // knee -> ankle is 0.34, so the foot bone takes over at the ankle
  const shin = cyl(0.062, 0.045, 0.34, 10);
  shin.scale(1, 1, 0.92); shin.translate(0, -0.19, 0);
  list.push(colorize(shin, pants));
  // calf swell at the back of the lower leg
  const calf = sph(0.052, 9, 7);
  calf.scale(1, 1.25, 0.85); calf.translate(0, -0.13, -0.012);
  list.push(colorize(calf, shade(pants, 0.02)));
  // trouser cuff breaking over the shoe
  const ankle = cyl(0.043, 0.041, 0.055, 10);
  ankle.scale(1, 1, 0.95);
  ankle.translate(0, -0.348, 0.004);
  list.push(colorize(ankle, shade(pants, -0.1)));
  const cuffEdge = cyl(0.045, 0.045, 0.008, 10);
  cuffEdge.translate(0, -0.373, 0.004);
  list.push(colorize(cuffEdge, shade(pants, -0.17)));
  // ankle ball: closes the gap between the trouser cuff and the shoe collar
  const ankleBall = sph(0.046, 9, 7);
  ankleBall.scale(1, 0.85, 0.95); ankleBall.translate(0, -0.36, 0.004);
  list.push(colorize(ankleBall, shade(pants, -0.05)));
  return list;
}

// Shoe, authored around the ankle pivot (foot bone): sole flat at y = -0.114.
function buildFoot(list, o) {
  useTile(CT.leather);
  const shoes = o.shoes;
  const sole = box(0.098, 0.03, 0.19);
  sole.translate(0, -0.088, 0.005);
  list.push(colorize(sole, 0x14161a));
  const welt = box(0.105, 0.012, 0.196);
  welt.translate(0, -0.071, 0.005);
  list.push(colorize(welt, 0x2d3034));
  const heel = box(0.094, 0.032, 0.078);
  heel.translate(0, -0.099, -0.055);
  list.push(colorize(heel, 0x101216));
  const upper = box(0.09, 0.066, 0.19);
  upper.translate(0, -0.034, 0.046);
  list.push(colorize(upper, shoes));
  const heelCup = box(0.088, 0.072, 0.046);
  heelCup.translate(0, -0.027, -0.05);
  list.push(colorize(heelCup, shade(shoes, -0.09)));
  // padded collar around the ankle opening
  const collar = cyl(0.046, 0.048, 0.042, 10);
  collar.scale(1, 1, 0.86);
  collar.translate(0, 0.006, -0.012);
  list.push(colorize(collar, shade(shoes, -0.04)));
  const tongue = box(0.047, 0.05, 0.055);
  tongue.rotateX(0.2); tongue.translate(0, -0.004, 0.062);
  list.push(colorize(tongue, shade(shoes, 0.11)));
  for (let i = 0; i < 3; i++) {
    const lace = box(0.048, 0.006, 0.007);
    lace.translate(0, -0.01 + i * 0.015, 0.079 + i * 0.011);
    list.push(colorize(lace, 0xd6d0c2));
  }
  // outsole lugs, so the sole is not a flat slab in a close-up
  for (let i = 0; i < 4; i++) {
    const lug = box(0.084, 0.008, 0.026);
    lug.translate(0, -0.106, -0.07 + i * 0.042);
    list.push(colorize(lug, 0x0c0e11));
  }
  // stitched toe seam at the vamp
  const seam = box(0.086, 0.006, 0.008);
  seam.translate(0, -0.048, 0.086);
  list.push(colorize(seam, shade(shoes, -0.2)));
  return list;
}

// Toe box, authored around the ball-of-foot pivot (toe bone).
function buildToe(list, o) {
  useTile(CT.leather);
  const shoes = o.shoes;
  const toe = sph(0.045, 10, 8);
  toe.scale(0.98, 0.6, 1.02);
  toe.translate(0, 0.007, 0.037);
  list.push(colorize(toe, shade(shoes, 0.05)));
  const sole = box(0.098, 0.03, 0.088);
  sole.translate(0, -0.043, 0.042);
  list.push(colorize(sole, 0x14161a));
  const welt = box(0.104, 0.012, 0.09);
  welt.translate(0, -0.026, 0.042);
  list.push(colorize(welt, 0x2d3034));
  for (let i = 0; i < 2; i++) {
    const lug = box(0.084, 0.008, 0.026);
    lug.translate(0, -0.061, 0.018 + i * 0.038);
    list.push(colorize(lug, 0x0c0e11));
  }
  return list;
}

// Jacket hem flaps. Authored around the hem bone: the bone sits on the hem
// line, the cloth hangs below it, so rotating the bone swings the skirt.
function buildJacketHem(list, o, dir) {
  useTile(CT.denim);
  const jk = o.jacket;
  if (!jk) return list;
  const r = 0.197;
  // the flap hangs from its bone but is a ring around the body axis, so shift
  // it back by the bone's own z offset
  const dz = dir < 0 ? 0.078 : -0.072;
  const arcs = dir < 0
    ? [[Math.PI * 0.46, Math.PI * 1.08]]
    : [[Math.PI * 0.16, Math.PI * 0.2], [Math.PI * 1.64, Math.PI * 0.2]];
  for (const [start, len] of arcs) {
    const flap = new THREE.CylinderGeometry(r, r * 1.03, 0.085, 12, 1, true, start, len);
    flap.scale(1.06, 1, 0.76);
    flap.translate(0, -0.042, dz);
    list.push(colorize(flap, shade(jk, dir < 0 ? -0.11 : -0.16)));
    const edge = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.014, 12, 1, true, start, len);
    edge.scale(1.06, 1, 0.76);
    edge.translate(0, -0.082, dz);
    list.push(colorize(edge, shade(jk, -0.3)));
  }
  return list;
}

export function buildHuman(opts = {}, detailed = false) {
  useTile(null);
  const o = Object.assign({
    shirt: 0x2f6fb5, pants: 0x2b3040, skin: 0xc08a63, hair: 0x241a14,
    jacket: null, stubble: false,
    shoes: 0x14151a, height: 1.0, hat: null, female: false,
    hairStyle: null, belt: 0x201a16, watch: false
  }, opts);

  const g = new THREE.Group();
  const s = o.height;
  g.scale.setScalar(s);
  const parts = {};

  const bones = [];
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones.push(b);
    return b;
  };

  const hips = bone(null, 0, HIP_Y, 0);
  const spine = bone(hips, 0, SPINE_DY, 0);
  const chest = bone(spine, 0, CHEST_DY - SPINE_DY, 0);
  // jacket hem flaps: their own bones, so the skirt of the jacket can lag
  // behind the body instead of being welded to the torso
  const hemF = bone(spine, 0, 0.048, 0.072);
  const hemB = bone(spine, 0, 0.048, -0.078);
  const neck = bone(chest, 0, NECK_DY, 0);
  const headG = bone(neck, 0, HEAD_DY, 0);
  parts.hips = hips; parts.spine = spine; parts.chest = chest;
  parts.neck = neck; parts.head = headG;
  parts.hemF = hemF; parts.hemB = hemB;
  // kept for older call sites that lean the whole upper body
  parts.torso = chest;

  const segs = [];
  // Part builders author in the space of the bone they grew up around; `dy`
  // shifts a list that was authored in hips-local space onto a higher pivot.
  const seg = (b, fill, dy = 0) => {
    const list = [];
    fill(list);
    if (dy) for (const geo of list) geo.translate(0, dy, 0);
    if (list.length) segs.push([b, list, null]);
  };
  // a part whose vertices are shared between two bones, so it deforms across a
  // joint rather than rotating rigidly with one of them
  const segBlend = (b, fill, other, yMain, yOther) => {
    const list = [];
    fill(list);
    if (list.length) segs.push([b, list, { other, yMain, yOther }]);
  };

  if (o.jacket) {
    seg(hemB, (l) => buildJacketHem(l, o, -1));
    seg(hemF, (l) => buildJacketHem(l, o, 1));
  }
  seg(hips, (l) => buildPelvis(l, o));
  seg(spine, (l) => buildTorso(l, o), -SPINE_DY);
  seg(chest, (l) => buildChest(l, o), -CHEST_DY);
  seg(headG, (l) => buildHead(l, o));

  // eyelids and jaw get their own bones so blinking and talking animate
  const lidL = bone(headG, -0.036, 0.1455, 0.0812);
  const lidR = bone(headG, 0.036, 0.1455, 0.0812);
  parts.lidL = lidL; parts.lidR = lidR;
  seg(lidL, (l) => buildLid(l, o));
  seg(lidR, (l) => buildLid(l, o));
  const jaw = bone(headG, 0, 0.078, 0.012);
  parts.jaw = jaw;
  seg(jaw, (l) => buildJaw(l, o));

  const mkArm = (side) => {
    const shoulder = bone(chest, side * 0.196, 0.472 - CHEST_DY, 0);
    const elbow = bone(shoulder, 0, -0.245, 0);
    // the upper sleeve hands over to the elbow bone at its lower end, and the
    // forearm sleeve hands back to the shoulder at its top, so the outer layer
    // bends across the joint instead of stepping
    segBlend(shoulder, (l) => buildArm(l, o), elbow, -0.12, -0.255);
    segBlend(elbow, (l) => buildForearm(l, { ...o, watch: side < 0 && o.watch }), shoulder, -0.1, 0.03);
    const hand = new THREE.Object3D();
    hand.position.set(0, -0.27, 0.01);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = mkArm(-1), armR = mkArm(1);
  parts.shoulderL = armL.shoulder; parts.shoulderR = armR.shoulder;
  parts.elbowL = armL.elbow; parts.elbowR = armR.elbow;
  parts.handR = armR.hand; parts.handL = armL.hand;

  const mkLeg = (side) => {
    const hip = bone(hips, side * HIP_DX, HIP_DY, 0);
    seg(hip, (l) => buildLeg(l, o));
    const knee = bone(hip, 0, -THIGH, 0);
    seg(knee, (l) => buildShin(l, o));
    const foot = bone(knee, 0, -SHIN, 0);
    seg(foot, (l) => buildFoot(l, o));
    const toe = bone(foot, 0, -0.045, 0.105);
    seg(toe, (l) => buildToe(l, o));
    return { hip, knee, foot, toe };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  parts.hipL = legL.hip; parts.hipR = legR.hip;
  parts.kneeL = legL.knee; parts.kneeR = legR.knee;
  parts.footL = legL.foot; parts.footR = legR.foot;
  parts.toeL = legL.toe; parts.toeR = legR.toe;

  // one merged, skinned mesh per character. Each part was built around its own
  // bone origin, so bake the bind-pose bone offset into the vertices first.
  const bindOffset = (b) => {
    const v = new THREE.Vector3();
    let n = b;
    while (n && n.isBone) { v.add(n.position); n = n.parent; }
    return v;
  };
  const geos = [];
  for (const [b, list, blend] of segs) {
    const idx = bones.indexOf(b);
    const off = bindOffset(b);
    if (blend) skinPartBlend(list, idx, bones.indexOf(blend.other), blend.yMain, blend.yOther);
    else skinPart(list, idx);
    for (const geo of list) {
      if (off.lengthSq() > 1e-9) geo.translate(off.x, off.y, off.z);
      geos.push(geo);
    }
  }
  const merged = mergeColored(geos);
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.45);
  const mesh = new THREE.SkinnedMesh(merged, VC_MAT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(hips);
  g.add(mesh);
  g.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  // The skull was authored a touch small for a 1.78 m body (about 1/9 of the
  // height, where a person reads closer to 1/7.5). Scaling after bind leaves
  // the inverse bind matrices alone, so the head grows about its own pivot and
  // the lids and jaw scale with it.
  headG.scale.setScalar(1.09);
  // leave the tile scope closed so other entity builders that reuse colorize()
  // (cars, props) keep their own UV layout
  useTile(null);

  return { group: g, parts, detailed: true, height: s, mesh, skeleton, opts: o };
}

/* ------------------------------------------------------------------ *
 * Rig: gait, idle and reactions.
 *
 * The legs are IK-driven from foot targets in model space, so planting is
 * explicit: the stance foot's target slides backwards at exactly the ground
 * speed (no skating), the swing foot follows a lifted arc, and the foot bone
 * rolls heel -> flat -> toe-off against the ground plane.
 * ------------------------------------------------------------------ */
const _target = new THREE.Vector3();

export class HumanRig {
  constructor(model, opts = {}) {
    this.model = model;
    this.group = model.group;
    this.p = model.parts;
    this.simple = false;
    this.t = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this.deadT = 0;
    this.dead = false;
    this.recoil = 0;
    this.shootT = 0;
    this.pullT = 0;
    this._glbAction = null;
    this.aimBlend = 0;
    this.runBlend = 0;
    this.seatBlend = 0;
    this.jumpBlend = 0;
    this.lowBlend = 0;
    this.moveBlend = 0;
    this.land = 0;
    this.wasAir = false;
    this.talking = false;
    this.gun = null;
    this.phaseOffset = Math.random() * Math.PI * 2;

    // Downloaded rigged character. If it loaded, it replaces the procedural
    // body; if anything goes wrong the coded mesh stays and the game plays on.
    this.glb = null;
    this._glbRole = null;
    if (MODELS.humans && MODELS.humans.length) {
      try {
        const entry = HumanRig.humanEntry(opts);
        this.attachGLB(instanceHuman(entry));
      } catch (err) {
        MODELS.humanFallbacks++;
        MODELS.errors.push('human-instance:' + (err && err.message ? err.message : err));
      }
    }

    // per-character gait personality: nobody walks exactly like anybody else
    this.gait = {
      stride: opts.stride || (0.92 + Math.random() * 0.16),
      arm: opts.arm || (0.85 + Math.random() * 0.3),
      bob: 0.85 + Math.random() * 0.3,
      sway: 0.8 + Math.random() * 0.4,
      lift: 0.85 + Math.random() * 0.3,
      limp: Math.random() < 0.12 ? 0.12 + Math.random() * 0.16 : 0
    };
    this.leanBack = 0;

    // relaxed idle pose (used until the first update)
    const p = this.p;
    p.shoulderL.rotation.z = -0.1;
    p.shoulderR.rotation.z = 0.1;
    p.shoulderL.rotation.x = 0.05;
    p.shoulderR.rotation.x = -0.05;
    p.elbowL.rotation.x = -0.16;
    p.elbowR.rotation.x = -0.2;
    p.lidL.rotation.x = -1.28;
    p.lidR.rotation.x = -1.28;
    p.jaw.rotation.x = 0;
    this._prevYaw = this.group.rotation.y;
  }

  // Where the gun actually is, in world space. The procedural hand sits at the
  // bind pose when a downloaded body is driving the visuals, so combat has to
  // ask the bone the gun is parented to.
  getMuzzle(out) {
    const hand = this.glb && (this.glb.root.getObjectByName('RightHand')
      || this.glb.root.getObjectByName('mixamorigRightHand'));
    if (hand) return hand.getWorldPosition(out);
    return (this.p.handR || this.p.shoulderR).getWorldPosition(out);
  }

  attachGun(key = 'pistol') {
    const geo = gunGeometry(key);
    if (this.gun && this.gun.geometry === geo) { this.gunKey = key; return; }
    if (this.gun) this.gun.parent.remove(this.gun);
    // A downloaded body carries the gun in its right hand bone; the procedural
    // fallback body has no hand bone, so it hangs off the forearm instead.
    const hand = this.glb && (this.glb.root.getObjectByName('RightHand')
      || this.glb.root.getObjectByName('mixamorigRightHand'));
    // Dark gunmetal on a bone-mounted gun: the shared GLB weapon material is
    // vertex-coloured and reads as a white blob against a lit character.
    const gun = new THREE.Mesh(geo, hand ? GUN_MAT : gunMaterial(geo));
    if (hand) {
      // The character is authored in centimetres and then scaled down to a
      // 1.7 m body, so a metre-sized gun in a bone would render millimetres
      // long. Undo the accumulated model scale on the gun itself.
      this.glb.root.updateMatrixWorld(true);
      const ws = new THREE.Vector3();
      hand.getWorldScale(ws);
      const k = 1 / (ws.x || 1);
      // Bone-local units here are centimetres: sit the gun in the palm, not on
      // the wrist joint, and keep the barrel along the hand's own direction so
      // it follows the arm when the aim pose rotates it.
      gun.position.set(0.0, 7, 1);
      const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
      const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(handQ).normalize();
      const desired = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fingers);
      gun.quaternion.copy(handQ.clone().invert().multiply(desired));
      gun.scale.setScalar(k * 0.9);
      hand.add(gun);
    } else {
      gun.position.set(0, -0.3, 0.055);
      gun.rotation.x = Math.PI * 0.5;
      this.p.elbowR.add(gun);
    }
    this.gun = gun;
    this.gunKey = key;
  }

  // Aim the downloaded body's arms without trusting bone conventions: rotate
  // the upper arm and forearm in world space from wherever the skeleton is to
  // the direction the player is facing. The gun is parented to the hand, so it
  // ends up pointing down the crosshair.
  _pointBone(bone, child, wantWorldDir) {
    const a = bone.getWorldPosition(new THREE.Vector3());
    const b = child.getWorldPosition(new THREE.Vector3());
    const cur = b.sub(a).normalize();
    const dq = new THREE.Quaternion().setFromUnitVectors(cur, wantWorldDir);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
    dq.multiply(worldQ);
    bone.quaternion.copy(parentQ.invert().multiply(dq));
    bone.updateMatrixWorld(true);
  }

  _aimArms() {
    const root = this.glb && this.glb.root;
    if (!root) return;
    const up = root.getObjectByName('RightArm');
    const fore = root.getObjectByName('RightForeArm');
    const hand = root.getObjectByName('RightHand');
    const lup = root.getObjectByName('LeftArm');
    const lfore = root.getObjectByName('LeftForeArm');
    const lhand = root.getObjectByName('LeftHand');
    if (!up || !fore || !hand) return;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const down = new THREE.Vector3(0, -1, 0);
    const kick = 0.45 * this.recoil;
    const shoulder = up.getWorldPosition(new THREE.Vector3());
    const target = shoulder.clone().addScaledVector(fwd, 0.62).addScaledVector(down, 0.10 - 0.06 * kick);

    this._pointBone(up, fore, fwd.clone().addScaledVector(down, 0.55 - kick).normalize());
    let elbow = fore.getWorldPosition(new THREE.Vector3());
    this._pointBone(fore, hand, target.clone().sub(elbow).normalize());

    if (lup && lfore && lhand) {
      const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
      this._pointBone(lup, lfore, fwd.clone().addScaledVector(down, 0.85).addScaledVector(rightAxis, 0.3).normalize());
      elbow = lfore.getWorldPosition(new THREE.Vector3());
      const support = target.clone().addScaledVector(fwd, -0.05).addScaledVector(rightAxis, -0.04);
      this._pointBone(lfore, lhand, support.sub(elbow).normalize());
    }
  }

  // Play one animation-library role on the downloaded body. `once` restarts a
  // one-shot (shoot, reload, death) instead of treating it as already current.
  _glbPlay(role, fade = 0.2, once = false) {
    const inst = this.glb;
    let next = inst && inst.byRole && inst.byRole[role];
    if (!next) {
      // A missing clip used to leave the previous action running, which is why
      // stopping could keep the walk cycle going. Fall back through the roles
      // this rig actually has, and if even that fails freeze the current pose.
      const chain = role === 'walk' ? ['jog', 'run', 'idle']
        : role === 'run' || role === 'sprint' ? ['jog', 'walk', 'idle']
          : role === 'idle' ? ['walk'] : [];
      for (const alt of chain) {
        next = inst.byRole && inst.byRole[alt];
        if (next) break;
      }
      if (!next) {
        if (this._glbAction) this._glbAction.paused = true;
        return false;
      }
    }
    if (!once && next === this._glbAction && next.isRunning()) return true;
    const prev = this._glbAction;
    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(fade);
    next.play();
    // the synthesized idle is a paused first frame of the walk clip; reset()
    // clears the paused flag, so it has to be re-applied or stopping resumes
    // the walk cycle in place
    if (next.__pausedIdle) { next.paused = true; next.time = 0; }
    if (prev && prev !== next) prev.fadeOut(fade);
    this._glbAction = next;
    this._glbRole = role;
    return true;
  }
  detachGun() {
    if (this.gun) { this.gun.parent.remove(this.gun); this.gun = null; }
  }

  // Analytic two-bone solve. `target` is a model-space ankle position; `pitch`
  // is the foot's world pitch (positive = toe down); `toeBend` is the toe joint
  // relative to the foot (negative lifts the toe, which keeps it flat during
  // push-off while the heel rises).
  _solveLeg(side, hip, knee, foot, toe, target, pitch, toeBend) {
    const hips = this.p.hips;
    let tx = target.x - hips.position.x - side * HIP_DX;
    let ty = target.y - hips.position.y - HIP_DY;
    let tz = target.z - hips.position.z;
    // undo the pelvis yaw so the solve happens in the leg's own plane
    const a = -hips.rotation.y;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rx = tx * ca + tz * sa;
    const rz = -tx * sa + tz * ca;
    tx = rx; tz = rz;

    const dist = clamp(Math.sqrt(tx * tx + ty * ty + tz * tz), 0.12, LEG_REACH);
    const base = Math.atan2(tz, -ty);
    const hipOff = Math.acos(clamp((dist * dist + THIGH * THIGH - SHIN * SHIN) / (2 * dist * THIGH), -1, 1));
    const kneeInt = Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - dist * dist) / (2 * THIGH * SHIN), -1, 1));

    hip.rotation.x = -(base + hipOff);
    knee.rotation.x = Math.PI - kneeInt;
    foot.rotation.x = pitch - (hip.rotation.x + knee.rotation.x);
    toe.rotation.x = toeBend;
  }

  // Swap the procedural body for a downloaded skinned model. The group is kept
  // because it carries the entity's position and heading.
  // Curated model pools keep robots and soldiers out of the civilian crowd and
  // give each faction a believable silhouette.
  static humanEntry(opts = {}) {
    const list = MODELS.humans || [];
    if (!list.length) return null;
    if (opts.humanPool && opts.humanPool.length) {
      const pool = opts.humanPool.map((id) => list.find((h) => h.id === id)).filter(Boolean);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    if (opts.humanId) {
      const found = list.find((h) => h.id === opts.humanId);
      if (found) return found;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  attachGLB(inst) {
    this.model.group.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) o.visible = false;
    });
    this.model.group.add(inst.root);
    this.glb = inst;
    inst.play('idle', 0);
    this._glbRole = 'idle';
  }

  update(dt, state) {
    if (this.glb) {
      const s = state || {};
      this.recoil = Math.max(0, this.recoil - dt * 6.5);
      if (this.dead) {
        // Tip the whole body over, the same way the procedural rig falls. The
        // library's death clip rotates the hips without the root translation it
        // was authored with, which leaves a body hovering on its side.
        this.deadT += dt;
        const e = 1 - Math.pow(1 - Math.min(1, this.deadT * 2.4), 3);
        this.group.rotation.x = -Math.PI / 2 * e;
        this.glb.mixer.update(dt);
        return;
      }
      if (!this.glb.hasUAL) {
        // No shared library: fall back to the file's own walk/run clips.
        const role0 = (s.speed || 0) > 4.6 ? 'run' : (s.speed || 0) > 0.25 ? 'walk' : 'idle';
        if (role0 !== this._glbRole && this.glb.play(role0)) this._glbRole = role0;
        this.glb.mixer.update(dt);
        return;
      }
      if (this.shootT > 0) this.shootT = Math.max(0, this.shootT - dt);
      if (this.pullT > 0) {
        this.pullT = Math.max(0, this.pullT - dt);
        if (this._glbRole !== 'interact') this._glbPlay('interact', 0.06, true);
      } else if (s.inVehicle) {
        this._glbPlay('drive', 0.25);
      } else if (s.airborne) {
        // real jump take-off, then a looping airborne pose on the way down
        this._glbPlay((s.vy || 0) > 0 ? 'jump' : 'air', 0.1);
      } else if (s.aiming) {
        this._glbPlay((s.speed || 0) > 0.25 ? 'walk' : 'idle', 0.2);
      } else if ((s.speed || 0) > 4.6) {
        // the character's own run clip is authored for its proportions; the
        // retargeted sprint cycle on a female rig is what read as a broken run
        this._glbPlay('run', 0.18);
      } else if ((s.speed || 0) > 0.25) {
        this._glbPlay('walk', 0.2);
      } else {
        this._glbPlay('idle', 0.25);
      }
      // match the cycle rate to ground speed so the feet do not skate
      if (this._glbAction && this._glbRole !== 'idle' && !this._glbAction.__pausedIdle) {
        const ref = this._glbRole === 'run' || this._glbRole === 'sprint' ? 5.4 : 1.5;
        this._glbAction.timeScale = clamp((s.speed || 0) / ref, 0.7, 1.55);
      }
      this.glb.mixer.update(dt);
      if (s.aiming) this._aimArms();
      return;
    }
    const s = state || {};
    const speed = s.speed || 0;
    const p = this.p;
    const gait = this.gait;

    this.deadT = this.dead ? this.deadT + dt : 0;
    this.recoil = Math.max(0, this.recoil - dt * 6.5);
    const blinkCycle = 3.4 + (this.blinkSeed || (this.blinkSeed = Math.random() * 1.6));
    this.blink = ((this.blink || 0) + dt) % blinkCycle;
    this.t += dt;

    if (this.dead) {
      const t = Math.min(1, this.deadT * 2.4);
      const e = 1 - Math.pow(1 - t, 3);
      this.group.rotation.x = -Math.PI / 2 * e;
      this.group.position.y = lerp(this.group.position.y, 0.15, 0.25);
      p.hipL.rotation.x = 0.25 * e; p.hipR.rotation.x = -0.16 * e;
      p.kneeL.rotation.x = 0.5 * e; p.kneeR.rotation.x = 0.2 * e;
      p.footL.rotation.x = -0.2 * e; p.footR.rotation.x = -0.1 * e;
      p.toeL.rotation.x = 0; p.toeR.rotation.x = 0;
      p.shoulderL.rotation.x = 0.55 * e; p.shoulderR.rotation.x = -0.35 * e;
      p.shoulderL.rotation.z = -0.35 * e; p.shoulderR.rotation.z = 0.35 * e;
      p.elbowL.rotation.x = -0.4 * e; p.elbowR.rotation.x = -0.3 * e;
      p.spine.rotation.x = 0.12 * e; p.chest.rotation.x = 0.1 * e;
      p.neck.rotation.x = 0.2 * e; p.head.rotation.x = 0.1 * e;
      return;
    }

    // eyelids blink on a slow cycle; the jaw opens for speech and recoil
    const blinkAmt = this.blink > blinkCycle - 0.36
      ? Math.sin(((this.blink - (blinkCycle - 0.36)) / 0.36) * Math.PI) : 0;
    p.lidL.rotation.x = -1.28 + blinkAmt * 1.34;
    p.lidR.rotation.x = -1.28 + blinkAmt * 1.34;
    const talk = this.talking ? 0.13 + Math.abs(Math.sin(this.t * 12)) * 0.1 : 0;
    p.jaw.rotation.x = damp(p.jaw.rotation.x, talk + this.recoil * 0.16, 16, dt);

    // blends
    this.lowBlend = damp(this.lowBlend, s.low ? 1 : 0, 9, dt);
    this.aimBlend = damp(this.aimBlend, s.aiming ? 1 : 0, 11, dt);
    this.runBlend = damp(this.runBlend, speed > 3.0 ? 1 : 0, 6, dt);
    this.seatBlend = damp(this.seatBlend, s.sitting ? 1 : 0, 9, dt);
    this.jumpBlend = damp(this.jumpBlend, s.airborne ? 1 : 0, 8, dt);
    this.moveBlend = damp(this.moveBlend, speed > 0.15 ? 1 : 0, 10, dt);

    // land: absorb on touchdown, then push back up
    if (this.wasAir && !s.airborne) this.land = 1;
    this.wasAir = !!s.airborne;
    this.land = Math.max(0, this.land - dt * 4.2);

    // heading turn rate, used to bank into corners
    const turn = clamp(angleDiff(this._prevYaw, this.group.rotation.y) / Math.max(dt, 1e-4), -6, 6);
    this._prevYaw = this.group.rotation.y;
    const turnLean = clamp(turn * 0.05, -0.14, 0.14) * clamp(speed / 3, 0, 1);

    // cloth: the jacket hem flaps trail behind the body as it moves and swing
    // out in a corner. They are separate bones, so this is real secondary
    // motion of the mesh, not a whole-torso lean.
    if (p.hemB) {
      const trail = clamp(speed * 0.085 + Math.sin(this.t * 6.5) * 0.03 * this.moveBlend, 0, 0.6)
        * (1 - this.seatBlend);
      p.hemB.rotation.x = damp(p.hemB.rotation.x, trail, 7.5, dt);
      p.hemB.rotation.z = damp(p.hemB.rotation.z, turnLean * 1.6, 6, dt);
      p.hemF.rotation.x = damp(p.hemF.rotation.x, -trail * 0.45, 9, dt);
      p.hemF.rotation.z = damp(p.hemF.rotation.z, turnLean * 0.8, 6, dt);
    }

    // Stride phase follows ground speed. The legs are close to full extension
    // when standing, so the pelvis has to drop while walking/running or the
    // stance foot simply cannot reach the ground at the ends of the stride.
    const gaitDrop = (0.045 + 0.05 * this.runBlend) * this.moveBlend;
    const stanceFrac = lerp(0.62, 0.4, this.runBlend);
    // how far the ankle can travel fore/aft and still be solvable
    const hipHeight = HIP_Y - gaitDrop;
    const vert = Math.max(0.12, hipHeight - ANKLE_Y);
    const zMax = Math.sqrt(Math.max(0.0004, LEG_REACH * LEG_REACH - vert * vert));
    // foot roll moves the ankle ~0.2 m less than the contact patch, so the
    // ankle excursion can be a little shorter than the step itself
    const maxStep = (zMax * 2 + 0.2) * gait.stride;
    let freq = this.moveBlend > 0.01 ? clamp(0.72 + Math.min(speed, 9) * 0.24, 0.8, 2.7) : 0;
    let stepLen = speed * stanceFrac / Math.max(freq, 1) * gait.stride;
    if (stepLen > maxStep) {
      stepLen = maxStep;
      // keep the planted foot moving at ground speed: cadence gives way first
      freq = speed * stanceFrac / Math.max(stepLen, 0.15);
    }
    stepLen = clamp(stepLen, 0.16, 1.15);
    this.phase += dt * TAU * freq;

    const cyc = this.phase + this.phaseOffset;
    const stride = Math.sin(cyc);
    const amp = clamp(speed / 4.4, 0, 1.3);
    const breathe = Math.sin(this.t * 1.55) * 0.0045;

    // ---- pelvis ----
    const bob = -Math.cos(cyc * 2) * 0.016 * amp * gait.bob - this.land * 0.11
      - this.seatBlend * 0.06 - this.lowBlend * 0.3 - gaitDrop;
    p.hips.position.y = HIP_Y + bob + breathe;
    p.hips.position.x = Math.sin(cyc) * 0.02 * amp * gait.sway + this.seatBlend * 0.02;
    p.hips.rotation.y = damp(p.hips.rotation.y, -stride * 0.1 * amp, 12, dt);
    p.hips.rotation.z = damp(p.hips.rotation.z,
      Math.sin(cyc) * 0.035 * amp * gait.sway + turnLean * 0.5 - this.lowBlend * 0.04, 10, dt);
    p.hips.rotation.x = damp(p.hips.rotation.x, this.seatBlend * -0.12 + this.lowBlend * 0.1, 8, dt);

    // ---- spine / chest: the lean is shared, the twist counter-rotates ----
    const lean = amp * 0.09 + this.runBlend * 0.15 + (s.lean || 0)
      + this.jumpBlend * 0.08 + this.land * 0.16 + this.lowBlend * 0.16;
    p.spine.rotation.x = damp(p.spine.rotation.x, lean * 0.45, 8, dt);
    p.chest.rotation.x = damp(p.chest.rotation.x, lean * 0.55, 8, dt);
    p.spine.rotation.y = damp(p.spine.rotation.y, stride * 0.07 * amp - this.aimBlend * 0.08 + (s.twist || 0) * 0.5, 10, dt);
    p.chest.rotation.y = damp(p.chest.rotation.y, stride * 0.16 * amp - this.aimBlend * 0.22 + (s.twist || 0), 10, dt);
    p.chest.rotation.z = damp(p.chest.rotation.z, turnLean * -0.5, 8, dt);
    p.chest.scale.set(1, 1 + breathe * 0.5, 1);

    // ---- neck and head: stabilised against the torso, then aimed ----
    const headYaw = s.lookAt
      ? clamp(angleDiff(this.group.rotation.y, Math.atan2(s.lookAt.x - this.group.position.x, s.lookAt.z - this.group.position.z)), -1.1, 1.1)
      : (s.lookY || 0);
    p.neck.rotation.y = damp(p.neck.rotation.y, -p.chest.rotation.y * 0.55 - p.hips.rotation.y * 0.3, 8, dt);
    p.neck.rotation.x = damp(p.neck.rotation.x, -p.chest.rotation.x * 0.5, 8, dt);
    p.head.rotation.y = damp(p.head.rotation.y, headYaw - p.neck.rotation.y * 0.6, 7, dt);
    p.head.rotation.x = damp(p.head.rotation.x,
      (s.lookX || 0) - this.runBlend * 0.14 + this.land * 0.1 - p.neck.rotation.x * 0.5, 7, dt);
    p.head.rotation.z = damp(p.head.rotation.z, -turnLean * 0.4 + Math.sin(cyc) * 0.01 * amp, 6, dt);

    // ---- legs: IK to foot targets ----
    const lift = lerp(0.085, 0.2, this.runBlend) * gait.lift;
    const legs = [
      { side: -1, hip: p.hipL, knee: p.kneeL, foot: p.footL, toe: p.toeL, off: 0 },
      { side: 1, hip: p.hipR, knee: p.kneeR, foot: p.footR, toe: p.toeR, off: Math.PI }
    ];
    for (const L of legs) {
      // idle: planted under the hips, toes turned out a touch
      const idleX = L.side * 0.105;
      const idleZ = 0.018;
      let fz = idleZ, fy = ANKLE_Y, pitch = 0, toeBend = 0;
      const u = (((cyc + L.off) / TAU) % 1 + 1) % 1;
      let gaitX = L.side * 0.104;

      if (u < stanceFrac) {
        // stance: the foot slides backwards at exactly ground speed
        const k = u / stanceFrac;
        fz = stepLen * 0.5 - k * stepLen;
        if (k < 0.14) pitch = lerp(-0.26, 0, k / 0.14);
        else if (k < 0.6) pitch = 0;
        else pitch = Math.pow((k - 0.6) / 0.4, 1.6) * (0.34 + 0.16 * this.runBlend);
        const heel = Math.max(0, -pitch), ball = Math.max(0, pitch);
        fy = ANKLE_Y + heel * 0.11 + ball * 0.2;
        toeBend = -ball;
        gaitX = L.side * (0.104 + (1 - k) * 0.006);
      } else {
        // swing: lifted arc from back to front, toe clears the ground. The
        // ankle also has to clear the still-pointed foot at toe-off, otherwise
        // the toe drags through the road for the first few centimetres.
        const k = (u - stanceFrac) / (1 - stanceFrac);
        const e = k * k * (3 - 2 * k);
        fz = -stepLen * 0.5 + e * stepLen;
        pitch = lerp(0.3 + 0.14 * this.runBlend, -0.26, Math.min(1, k * 2.2));
        const heel = Math.max(0, -pitch), ball = Math.max(0, pitch);
        fy = ANKLE_Y + Math.sin(Math.PI * k) * lift + heel * 0.11 + ball * 0.2;
        toeBend = -0.16 * Math.sin(Math.PI * k);
        gaitX = L.side * (0.104 - Math.sin(Math.PI * k) * 0.012);
      }
      if (gait.limp) {
        // a slight hitch: the bad leg swings lower and lands sooner
        if (L.side > 0) fy -= gait.limp * Math.max(0, Math.sin(Math.PI * u)) * 0.05;
      }

      const mb = this.moveBlend;
      // the ankle sits behind the heel at heel strike and ahead of the toe at
      // push-off, which is what lets a short-legged model take a longer step
      fz += pitch * 0.35;
      let tx = lerp(idleX, gaitX, mb);
      let ty = lerp(ANKLE_Y, fy, mb);
      let tz = lerp(idleZ, fz, mb);
      let fp = pitch * mb;

      // crouch: knees travel forward, feet stay put
      if (this.lowBlend > 0.01) {
        tz += 0.05 * this.lowBlend;
        fp -= 0.06 * this.lowBlend;
      }
      // seated: thighs forward, shins down, toes up on the pedals
      if (this.seatBlend > 0.01) {
        tx = lerp(tx, L.side * 0.11, this.seatBlend);
        ty = lerp(ty, 0.27, this.seatBlend);
        tz = lerp(tz, 0.4, this.seatBlend);
        fp = lerp(fp, -0.3, this.seatBlend);
      }
      // airborne: knees tuck up
      if (this.jumpBlend > 0.01) {
        ty = lerp(ty, 0.3, this.jumpBlend);
        tz = lerp(tz, 0.1 + L.side * 0.02, this.jumpBlend);
        fp = lerp(fp, 0.15, this.jumpBlend);
      }

      _target.set(tx, ty, tz);
      this._solveLeg(L.side, L.hip, L.knee, L.foot, L.toe, _target, fp, toeBend * mb);
    }

    // ---- arms ----
    const swing = stride * 0.52 * amp * gait.arm;
    const aim = this.aimBlend;
    const kick = this.recoil * 0.6;
    const idleSway = Math.sin(this.t * 1.1) * 0.012;

    let lx = lerp(swing, -1.3, aim);
    let rx = lerp(-swing, -1.52 - kick, aim);
    let lz = lerp(-0.07 + idleSway, 0.42, aim);
    let rz = lerp(0.07 + idleSway, -0.16, aim);

    // running arms tuck up and pump harder, elbows tight
    lx = lerp(lx, swing * 1.4 - 0.4, this.runBlend * (1 - aim));
    rx = lerp(rx, -swing * 1.4 - 0.4, this.runBlend * (1 - aim));
    lz = lerp(lz, -0.26, this.runBlend * (1 - aim));
    rz = lerp(rz, 0.26, this.runBlend * (1 - aim));

    // seated driving grip: hands at ten and two
    lx = lerp(lx, -1.12, this.seatBlend);
    rx = lerp(rx, -1.12, this.seatBlend);
    lz = lerp(lz, 0.26, this.seatBlend);
    rz = lerp(rz, -0.26, this.seatBlend);

    p.shoulderL.rotation.x = damp(p.shoulderL.rotation.x, lx, 14, dt);
    p.shoulderR.rotation.x = damp(p.shoulderR.rotation.x, rx, 16, dt);
    p.shoulderL.rotation.z = damp(p.shoulderL.rotation.z, lz, 12, dt);
    p.shoulderR.rotation.z = damp(p.shoulderR.rotation.z, rz, 12, dt);

    // elbows: a walk lets the forearm trail, a run locks the angle, aiming
    // braces the gun arm and brings the support hand across
    const runBend = -1.2;
    const walkBendL = -0.22 - Math.max(0, -swing) * 0.55;
    const walkBendR = -0.22 - Math.max(0, swing) * 0.55;
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x,
      lerp(lerp(walkBendL, runBend, this.runBlend), -1.35, aim), 12, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x,
      lerp(lerp(walkBendR, runBend, this.runBlend), -0.12 - kick * 0.5, aim), 12, dt);
    // support hand slides toward the gun when aiming
    p.shoulderL.rotation.y = damp(p.shoulderL.rotation.y, aim * 0.42, 10, dt);
  }

  fire() {
    this.recoil = 1;
    this.shootT = 0.26;
  }
  die() { this.dead = true; this.deadT = 0; }
}

export function makeGunMesh(key = 'pistol') {
  const geo = gunGeometry(key);
  return new THREE.Mesh(geo, gunMaterial(geo));
}

// Remove a human's per-actor geometry without touching the shared materials,
// atlas textures or GUN_GEO. Disposing those shared resources made every later
// actor re-upload the atlas and was the source of the texture-count creep.
export function disposeHuman(root) {
  if (!root) return;
  const skeletons = new Set();
  const weaponGeos = new Set((MODELS.weapons || []).map((w) => w.geometry));
  root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry !== GUN_GEO && !weaponGeos.has(o.geometry)) o.geometry.dispose();
    // Three allocates a per-skeleton bone texture for each SkinnedMesh. It is
    // not shared, so it must be released with the actor or repeated interior
    // visits slowly fill the texture budget.
    if (o.isSkinnedMesh && o.skeleton) skeletons.add(o.skeleton);
  });
  for (const s of skeletons) if (s.dispose) s.dispose();
}
