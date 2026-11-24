// Palma City — downloaded GLB model library.
//
// Real assets live in public/models/ and are described by manifest.json. The
// browser build inlines every file under public/ as a data: URL (see
// vite.browser.config.js), so a page opened from disk still loads them without
// a request; the Electron build reads them from disk.
//
// Nothing here may break the game: every load and every instance is wrapped, and
// callers fall back to the procedural builder when a model is missing or fails
// to parse. `MODELS.errors` records what went wrong so the test harness can
// assert a clean run.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl } from './asset-map.js';

export const MODELS = {
  manifest: null,
  cars: [],      // manifest entries with .template attached
  helicopters: [],
  humans: [],
  props: [],
  fixtures: [],
  landmarks: [],
  weapons: [],
  pickups: [],
  loaded: 0,
  attempted: 0,
  errors: [],    // strings: "<kind>:<id>:<message>"
  carFallbacks: 0,
  humanFallbacks: 0,
  ready: false
};

// Quaternius' Universal Animation Library (CC0). The downloaded character
// files ship idle/walk/run only; this shared clip set adds aim, shoot, reload,
// death, driving, punch and interact for every character on the same 24-bone
// skeleton.
export const ANIM = { clips: null, ready: false, error: null, rootFix: null };

// The character rig names its spine bottom-up (Hips -> Spine02 -> Spine01 ->
// Spine), the reverse of the library's spine_01..03.
const UAL_BONES = {
  pelvis: 'Hips', spine_01: 'Spine02', spine_02: 'Spine01', spine_03: 'Spine',
  neck_01: 'neck', Head: 'Head',
  clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder', upperarm_r: 'RightArm', lowerarm_r: 'RightForeArm', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', calf_l: 'LeftLeg', foot_l: 'LeftFoot', ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', calf_r: 'RightLeg', foot_r: 'RightFoot', ball_r: 'RightToeBase'
};
// Only the roles the character files do not ship. Idle/walk/run stay the
// models' own clips, which are authored for their rest pose.
const UAL_ROLES = {
  drive: 'Driving_Loop',
  punch: 'Punch_Cross',
  interact: 'Interact',
  jump: 'Jump_Start',
  air: 'Jump_Loop',
  land: 'Jump_Land',
  sprint: 'Sprint_Loop',
  jog: 'Jog_Fwd_Loop'
};
const ualCache = new Map();


// Rebuild a UAL clip on a character skeleton. Raw UAL rotations are relative to
// its own mannequin's rest pose, so copying them straight across folds a
// character onto the floor. Each key is converted to a delta from the library's
// T-pose and applied to this skeleton's bind pose instead. Rotations only: the
// library's hip position tracks would make every character drift.
function ualClipFor(root, suffix, key) {
  const ck = key + '|' + suffix;
  if (ualCache.has(ck)) return ualCache.get(ck);
  const src = (ANIM.clips || []).find((c) => c.name.endsWith(suffix));
  let out = null;
  if (src) {
    const tpose = (ANIM.clips || []).find((c) => c.name.endsWith('A_TPose'));
    const restSrc = new Map();
    if (tpose) {
      for (const t of tpose.tracks) {
        if (!t.name.endsWith('.quaternion') || !t.values || t.values.length < 4) continue;
        const bone = t.name.slice(0, t.name.lastIndexOf('.'));
        restSrc.set(bone, new THREE.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]));
      }
    }
    const tracks = [];
    const q = new THREE.Quaternion();
    const G = ANIM.rootFix || new THREE.Quaternion();
    const Gi = G.clone().invert();
    for (const t of src.tracks) {
      const dot = t.name.lastIndexOf('.');
      if (dot <= 0) continue;
      const bone = t.name.slice(0, dot);
      const prop = t.name.slice(dot + 1);
      if (prop !== 'quaternion') continue;
      const mapped = UAL_BONES[bone];
      if (!mapped) continue;
      const dst = root.getObjectByName(mapped);
      if (!dst) continue;
      const base = dst.quaternion.clone();
      const restQ = restSrc.get(bone) || new THREE.Quaternion();
      const inv = restQ.clone().invert();
      const vals = new Float32Array(t.values.length);
      for (let i = 0; i + 3 < t.values.length; i += 4) {
        q.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
        // D = qAnim * restSrc^-1 is the rotation the library applies in its
        // parent's space. Conjugate it out of the library's Z-up root frame,
        // align the rest directions, then apply it to this bone's bind pose.
        q.premultiply(G);
        q.multiply(inv);
        q.multiply(Gi);
        q.multiply(base);
        vals[i] = q.x; vals[i + 1] = q.y; vals[i + 2] = q.z; vals[i + 3] = q.w;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(mapped + '.quaternion', t.times, vals));
    }
    if (tracks.length) out = new THREE.AnimationClip(src.name, src.duration, tracks);
  }
  ualCache.set(ck, out);
  return out;
}

const loader = new GLTFLoader();
// The car is meshopt-compressed (2.3 MB instead of 13 MB uncompressed). The
// decoder ships inside the three.js package as a module, so this needs no
// network fetch and works from file://.
loader.setMeshoptDecoder(MeshoptDecoder);

async function loadEntry(entry, kind) {
  MODELS.attempted++;
  const url = assetUrl(`models/${entry.file}`);
  try {
    const gltf = await loader.loadAsync(url);
    entry.template = gltf;
    MODELS.loaded++;
    return true;
  } catch (err) {
    MODELS.errors.push(`${kind}:${entry.id}:${err && err.message ? err.message : err}`);
    return false;
  }
}

export async function loadModels() {
  try {
    const res = await fetch(assetUrl('models/manifest.json'));
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const manifest = await res.json();
    MODELS.manifest = manifest;

    for (const entry of manifest.cars || []) {
      if (await loadEntry(entry, 'car')) MODELS.cars.push(entry);
    }
    for (const entry of manifest.helicopters || []) {
      if (await loadEntry(entry, 'helicopter')) MODELS.helicopters.push(entry);
    }
    for (const entry of manifest.humans || []) {
      if (await loadEntry(entry, 'human')) MODELS.humans.push(entry);
    }
    for (const entry of manifest.props || []) {
      if (await loadEntry(entry, 'prop')) MODELS.props.push(entry);
    }
    for (const entry of manifest.fixtures || []) {
      if (await loadEntry(entry, 'fixture')) MODELS.fixtures.push(entry);
    }
    for (const entry of manifest.landmarks || []) {
      if (await loadEntry(entry, 'landmark')) MODELS.landmarks.push(entry);
    }
    for (const entry of manifest.weapons || []) {
      if (await loadEntry(entry, 'weapon')) MODELS.weapons.push(entry);
    }
    for (const entry of manifest.pickups || []) {
      if (await loadEntry(entry, 'pickup')) MODELS.pickups.push(entry);
    }
    // These are tiny, static meshes reused by every actor/pickup. Flatten them
    // once into a single vertex-coloured geometry so the whole game still pays
    // one draw call per equipped gun and one per pickup.
    for (const entry of MODELS.weapons) {
      entry.geometry = flattenModelGeometry(entry, { length: entry.length || 0.3, center: true });
    }
    for (const entry of MODELS.pickups) {
      entry.geometry = flattenModelGeometry(entry, { height: entry.height || 0.5, center: true });
    }
  } catch (err) {
    MODELS.errors.push(`manifest:${err && err.message ? err.message : err}`);
  }
  // Shared animation library. A missing or broken file must not stop the game:
  // characters keep their own walk/run clips and the rest of the rig still works.
  try {
    const gltf = await loader.loadAsync(assetUrl('models/ual1.glb'));
    ANIM.clips = gltf.animations || [];
    // The library is authored Z-up: its root bone carries a -90 deg X rotation
    // that the character rigs do not have. Every retargeted rotation is
    // conjugated through it.
    const rootBone = gltf.scene.getObjectByName('root');
    ANIM.rootFix = rootBone ? rootBone.quaternion.clone() : new THREE.Quaternion();
    ANIM.root = gltf.scene;
    ANIM.ready = ANIM.clips.length > 0;
  } catch (err) {
    ANIM.error = err && err.message ? err.message : String(err);
    MODELS.errors.push('anim:' + ANIM.error);
  }
  MODELS.ready = true;
  // exposed for the verification harness (read-only use)
  if (typeof window !== 'undefined') window.__PALMA_MODELS__ = MODELS;
  return MODELS;
}

/* ---------------------------------------------------------------- merging --- */

// Collapse a subtree's meshes into one mesh per material, baking each mesh's
// world transform into its geometry. A detailed car with 200+ parts drops to a
// handful of draw calls while its separate wheel pivots keep every wheel intact.
function mergeSubtree(container, skipUnder, owned) {
  container.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const meshes = [];
  container.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p && p !== container; p = p.parent) {
      if (p.userData.wheelPivot) return;      // leave wheels for their own merge
    }
    meshes.push(o);
  });
  if (!meshes.length) return;
  const groups = new Map();
  const tmp = new THREE.Vector3();
  for (const mesh of meshes) {
    let geo = mesh.geometry.clone();
    const m = new THREE.Matrix4().copy(toLocal).multiply(mesh.matrixWorld);
    geo.applyMatrix4(m);
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    // mergeAttributes() refuses to merge when one geometry carries a gpuType
    // hint and another does not, which silently dropped whole cars from the
    // merge. Clear the hint on every attribute so the merge is consistent.
    for (const name of Object.keys(geo.attributes)) geo.attributes[name].gpuType = undefined;
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new (geo.attributes.position.array.constructor === Float32Array ? Uint32Array : Uint32Array)(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const key = mesh.material && mesh.material.uuid ? mesh.material.uuid : 'default';
    if (!groups.has(key)) groups.set(key, { material: mesh.material, geos: [] });
    groups.get(key).geos.push(geo);
  }
  for (const mesh of meshes) if (mesh.parent) mesh.parent.remove(mesh);
  for (const { material, geos } of groups.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    if (owned) owned.geometries.add(merged);
    const out = new THREE.Mesh(merged, material);
    out.castShadow = true;
    out.receiveShadow = true;
    container.add(out);
  }
}

// Low-poly downloaded bodies use a handful of flat-colour materials. Bake each
// material colour into vertex colours and merge the whole body into one mesh,
// so a varied car still costs one draw call instead of one per colour.
function flattenSubtree(container, owned) {
  container.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const meshes = [];
  container.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p && p !== container; p = p.parent) {
      if (p.userData.wheelPivot) return;
    }
    meshes.push(o);
  });
  if (!meshes.length) return null;
  const geos = [];
  const c = new THREE.Color();
  let firstMap;
  let allMap = true;
  // Decide up front whether one atlas covers every part. When it does, the map
  // itself carries the colour and the vertex colours stay plain. When it does
  // not (the bus kit has seven separate textures), the map has to be dropped
  // and each part baked down to its texture's average colour instead.
  for (const mesh of meshes) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const map = mat && mat.map ? mat.map : null;
    if (firstMap === undefined) firstMap = map;
    if (!map || map !== firstMap) allMap = false;
  }
  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    const m = new THREE.Matrix4().copy(toLocal).multiply(mesh.matrixWorld);
    geo.applyMatrix4(m);
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    // GLTFLoader may keep normals/UVs as normalised integer arrays; widen them
    // so every merged body is type-consistent and mergeGeometries cannot fail.
    for (const name of ['position', 'normal', 'uv']) {
      const src = geo.getAttribute(name);
      if (!src) continue;
      const out = new Float32Array(src.count * src.itemSize);
      const denom = src.normalized
        ? (src.array instanceof Int8Array ? 127 : src.array instanceof Uint8Array ? 255 :
          src.array instanceof Int16Array ? 32767 : src.array instanceof Uint16Array ? 65535 : 1)
        : 1;
      for (let i = 0; i < src.count; i++) {
        for (let k = 0; k < src.itemSize; k++) {
          const v = k === 0 ? src.getX(i) : k === 1 ? src.getY(i) : k === 2 ? src.getZ(i) : src.getW(i);
          out[i * src.itemSize + k] = v / denom;
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(out, src.itemSize));
    }
    for (const name of Object.keys(geo.attributes)) geo.attributes[name].gpuType = undefined;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const map = mat && mat.map ? mat.map : null;
    c.copy(mat && mat.color ? mat.color : new THREE.Color(0xffffff));
    if (!allMap && map) {
      const avg = textureAverage(map);
      if (avg) c.multiply(avg);
    }
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!geo.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geos.push(geo);
  }
  for (const mesh of meshes) if (mesh.parent) mesh.parent.remove(mesh);
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) return null;
  if (geos.length > 1) for (const g of geos) g.dispose();
  const material = (allMap && firstMap)
    ? new THREE.MeshStandardMaterial({ map: firstMap, vertexColors: true, roughness: 0.58, metalness: 0.18 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.18 });
  if (owned) owned.materials.add(material);
  const out = new THREE.Mesh(merged, material);
  out.castShadow = true;
  out.receiveShadow = true;
  container.add(out);
  if (owned) { owned.geometries.add(merged); owned.materials.add(material); }
  return out;
}

// Average colour of a texture, used when flattening a textured model into one
// vertex-coloured mesh. Without this every textured part fell back to the
// material's base colour (usually white), which is why the transit bus arrived
// as a featureless white block.
const _texAvg = new WeakMap();
function textureAverage(tex) {
  if (!tex) return null;
  if (_texAvg.has(tex)) return _texAvg.get(tex);
  let out = null;
  try {
    const img = tex.image;
    if (img && img.width && typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 8; cv.height = 8;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (n) out = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
    }
  } catch (err) { out = null; }
  _texAvg.set(tex, out);
  return out;
}

// Flatten a downloaded static model to one vertex-coloured geometry. This is
// the shared path for tiny repeated assets (guns, pickups, small street props,
// moored boats): no material atlas, no per-part draw calls, and the caller can
// merge many instances into an existing single mesh.
export function flattenModelGeometry(entry, opts = {}) {
  if (!entry || !entry.template || !entry.template.scene) return null;
  const root = entry.template.scene.clone(true);
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());

  if (opts.length) {
    // Make the longest horizontal axis run along +Z (the game's forward).
    if (size.x > size.z && size.x >= size.y) {
      root.rotation.y = Math.PI / 2;
    } else if (size.y > size.z && size.y > size.x) {
      root.rotation.x = Math.PI / 2;
    }
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
    const s = opts.length / Math.max(0.001, size.z);
    root.scale.setScalar(s);
  } else {
    const s = (opts.height || entry.height || 1) / Math.max(0.001, size.y);
    root.scale.setScalar(s);
  }
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= opts.center ? centre.y : box.min.y;
  root.updateMatrixWorld(true);

  const geos = [];
  const c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    // GLTFLoader may keep normals/UVs as normalised Uint8/Uint16 arrays. The
    // merge helper requires identical array types, so widen every attribute to
    // Float32 before any batch is assembled.
    for (const name of ['position', 'normal', 'uv']) {
      const src = geo.getAttribute(name);
      if (!src) continue;
      const out = new Float32Array(src.count * src.itemSize);
      const denom = src.normalized
        ? (src.array instanceof Int8Array ? 127 : src.array instanceof Uint8Array ? 255 :
          src.array instanceof Int16Array ? 32767 : src.array instanceof Uint16Array ? 65535 : 1)
        : 1;
      for (let i = 0; i < src.count; i++) {
        for (let k = 0; k < src.itemSize; k++) {
          let v = k === 0 ? src.getX(i) : k === 1 ? src.getY(i) : k === 2 ? src.getZ(i) : src.getW(i);
          out[i * src.itemSize + k] = v / denom;
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(out, src.itemSize));
    }
    geo.applyMatrix4(o.matrixWorld);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    c.copy(mat && mat.color ? mat.color : new THREE.Color(0xffffff));
    if (mat && mat.map) {
      const avg = textureAverage(mat.map);
      if (avg) c.multiply(avg);
    }
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!geo.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geos.push(geo);
  });
  if (!geos.length) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  if (merged) merged.computeBoundingSphere();
  return merged;
}

/* ------------------------------------------------------------------ cars --- */

// Car kits name their glazing 'Windows' or 'Kit glass' and ship it as separate
// panes laid into the body shell. Merging those panes into the opaque body (as
// the one-draw-call flatten does) bakes them to a near-black vertex colour, so
// every car had painted-on windows. Pull the panes out first and give them one
// shared glass material; the pillars stay with the body, so each window reads
// as a separate pane framed in painted metal.
const GLASS_MAT_NAMES = /^(windows?|glass|kit glass)$/i;
let CAR_GLASS_MAT = null;

function carGlassMaterial() {
  if (CAR_GLASS_MAT) return CAR_GLASS_MAT;
  CAR_GLASS_MAT = new THREE.MeshPhysicalMaterial({
    color: 0x0b1319, metalness: 0.45, roughness: 0.05,
    transparent: true, opacity: 0.8, envMapIntensity: 3.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
    side: THREE.DoubleSide, depthWrite: false
  });
  CAR_GLASS_MAT.name = 'carGlass';
  return CAR_GLASS_MAT;
}

function extractCarGlass(root, owned) {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.length) return;
    if (!mats.every((m) => m && GLASS_MAT_NAMES.test((m.name || '').trim()))) return;
    meshes.push(o);
  });
  if (!meshes.length) return null;
  const geos = [];
  for (const mesh of meshes) {
    const g = mesh.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().copy(toLocal).multiply(mesh.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    for (const name of Object.keys(g.attributes)) g.attributes[name].gpuType = undefined;
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geos.push(g);
  }
  for (const mesh of meshes) if (mesh.parent) mesh.parent.remove(mesh);
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  if (!merged) return null;
  if (owned) owned.geometries.add(merged);
  return merged;
}

// Turn a shared GLB scene into a car instance: normalised scale, forward along
// +Z, wheels sitting on y = 0, and each wheel wrapped in a pivot so the physics
// can steer and spin it without moving it.
export function instanceCar(entry, opts = {}) {
  const root = entry.template.scene.clone(true);
  const owned = { geometries: new Set(), materials: new Set() };

  // material variety: clone the paint material per car so traffic is not all
  // one colour
  if (opts.color !== undefined) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const next = mats.map((m) => {
        if (!m) return m;
        const isBody = entry.bodyMaterial && m.name === entry.bodyMaterial;
        if (!isBody) return m;
        // Clearcoat on the paint: a thin glossy layer over the base colour is
        // what separates a showroom car from a flat-shaded one in the sun.
        // Copy only the standard-material fields: calling MeshPhysicalMaterial's
        // own copy() on a plain standard material reads clearcoat/specular
        // vectors that do not exist there and throws.
        const c = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(c, m);
        c.color = new THREE.Color(opts.color);
        // the bus kit body carries a terracotta texture that would multiply the
        // fleet cream back to salmon; its detail lives on separate meshes
        if (entry.flatPaint) c.map = null;
        c.clearcoat = 1.0;
        c.clearcoatRoughness = 0.08;
        c.envMapIntensity = 1.4;
        owned.materials.add(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
  }

  // orient: the long axis is the car's length; make it +Z
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) {
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }

  const targetLength = opts.length || entry.length || 4.5;
  const scale = targetLength / Math.max(0.001, size.z);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= box.min.y;   // wheels on the ground
  root.updateMatrixWorld(true);

  // wheel pivots
  const wanted = entry.wheels || {};
  const byName = {};
  root.traverse((o) => { byName[o.name] = o; });
  const wheels = [];
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const node = byName[wanted[key]];
    if (!node || !node.parent) continue;
    const parent = node.parent;
    const pivot = new THREE.Group();
    pivot.name = `pivot_${key}`;
    pivot.position.copy(node.position);
    pivot.quaternion.copy(node.quaternion);
    pivot.scale.copy(node.scale);
    parent.add(pivot);
    node.position.set(0, 0, 0);
    node.quaternion.identity();
    node.scale.set(1, 1, 1);
    pivot.add(node);
    wheels.push({ key, pivot, wheel: node, front: key === 'fl' || key === 'fr' });
  }

  // Some assets split each wheel into many flat nodes (tire, rim, blocks).
  // Group them under a pivot at the wheel's centre so they can still spin and
  // steer; Object3D.attach keeps every part where it was.
  const prefixes = entry.wheelPrefixes;
  if (prefixes && !wheels.length) {
    root.updateMatrixWorld(true);
    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const prefix = prefixes[key];
      if (!prefix) continue;
      const parts = [];
      root.traverse((o) => { if (o.name && o.name.indexOf(prefix) === 0) parts.push(o); });
      if (!parts.length) continue;
      const parent = parts[0].parent;
      const box = new THREE.Box3();
      for (const part of parts) box.union(new THREE.Box3().setFromObject(part));
      const centre = box.getCenter(new THREE.Vector3());
      parent.worldToLocal(centre);
      const pivot = new THREE.Group();
      pivot.name = `pivot_${key}`;
      pivot.userData.wheelPivot = true;
      pivot.position.copy(centre);
      parent.add(pivot);
      parent.updateMatrixWorld(true);
      for (const part of parts) pivot.attach(part);
      wheels.push({ key, pivot, wheel: pivot, front: key === 'fl' || key === 'fr' });
    }
  }

  // glazing is split out before the one-draw-call merge so it can stay glass
  const glassGeo = extractCarGlass(root, owned);

  if (entry.flat) {
    root.updateMatrixWorld(true);
    // AI traffic does not need independent wheels: flatten the whole car into
    // one vertex-coloured mesh, one draw call per car. The player's car keeps
    // the wheel pivots so they can steer and spin.
    if (opts.mergeWheels) {
      for (const w of wheels) w.pivot.userData.wheelPivot = false;
      wheels.length = 0;
      flattenSubtree(root, owned);
    } else {
      flattenSubtree(root, owned);
      for (const w of wheels) flattenSubtree(w.pivot, owned);
    }
  } else if (entry.merge) {
    root.updateMatrixWorld(true);
    for (const w of wheels) mergeSubtree(w.pivot, null, owned);
    root.updateMatrixWorld(true);
    // AI traffic does not need four independent spinning wheels: baking them
    // into the body turns 4 draw calls per car into 0 and saves ~110 calls
    // across the traffic fleet. The car the player drives keeps its pivots.
    if (opts.mergeWheels) {
      for (const w of wheels) w.pivot.userData.wheelPivot = false;
      wheels.length = 0;
    }
    mergeSubtree(root, null, owned);
  }

  if (glassGeo) {
    const gm = new THREE.Mesh(glassGeo, carGlassMaterial());
    gm.name = 'carGlass';
    gm.renderOrder = 4;
    gm.castShadow = false;
    gm.receiveShadow = false;
    root.add(gm);
  }

  let steeringWheel = null;
  if (entry.steeringWheel) steeringWheel = byName[entry.steeringWheel] || null;

  // Face the car the way it drives. The front wheels are the ground truth for
  // which end is the nose; do this last, with final world matrices, then
  // re-centre so a half turn does not shift the body off its axle line.
  if (wheels.length) {
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    let z = 0, n = 0;
    for (const w of wheels) {
      if (!w.front) continue;
      w.pivot.getWorldPosition(p);
      root.worldToLocal(p);
      z += p.z; n++;
    }
    if (n && z / n < 0) {
      // Turn the body inside a holder: rotating the root would not move its
      // children relative to itself, which is what "which end is the nose"
      // actually measures.
      const holder = new THREE.Group();
      holder.name = 'carBody';
      holder.add(root);
      root.rotation.y += Math.PI;
      holder.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(holder);
      const c = bb.getCenter(new THREE.Vector3());
      root.position.x -= c.x;
      root.position.z -= c.z;
      root.position.y -= bb.min.y;
      holder.updateMatrixWorld(true);
      return { root: holder, wheels, steeringWheel, entry, groupedWheels: !!(prefixes && prefixes.fl), dispose: () => disposeOwned(owned) };
    }
  }

  return { root, wheels, steeringWheel, entry, groupedWheels: !!(prefixes && prefixes.fl), dispose: () => disposeOwned(owned) };
}

function disposeOwned(owned) {
  for (const g of owned.geometries) g.dispose();
  for (const m of owned.materials) m.dispose();
  owned.geometries.clear();
  owned.materials.clear();
}

/* ------------------------------------------------------------ helicopters --- */

export function instanceHeli(entry) {
  const root = entry.template.scene.clone(true);
  const owned = { geometries: new Set(), materials: new Set() };
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) {
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }
  const target = entry.length || 9;
  root.scale.setScalar(target / Math.max(0.001, Math.max(size.x, size.z)));
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= centre.y;
  root.updateMatrixWorld(true);
  flattenSubtree(root, owned);
  return { root, dispose: () => disposeOwned(owned) };
}

/* ---------------------------------------------------------------- humans --- */

// A skinned clone plus a mixer. SkeletonUtils.clone is required: a plain
// Object3D.clone() would share the skeleton and every character would animate
// into the same pose.
export function instanceHuman(entry, opts = {}) {
  let root = cloneSkinned(entry.template.scene);
  // Measure the skeleton, not the geometry: a skinned mesh's geometry box
  // ignores the armature's own scale, which is what made everyone gigantic.
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  root.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldPosition(v);
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  });
  const boneSpan = Math.max(0.001, maxY - minY);
  const target = opts.height || entry.height || 1.8;
  // bones run ankle-to-head-top, a little short of the real height
  const scale = target / (boneSpan * 1.08);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;

  // Which way does the character face? Most of these rigs have no toe/foot
  // bones to ask, so the test is geometric: in the rest pose the toes reach
  // further forward than the heels, so the mean Z of the lowest 12% of vertices
  // (the feet) relative to the body's mean Z says which way the model faces.
  // If that is -Z the body is turned half a turn inside a holder, because the
  // game moves everyone along heading 0 = +Z.
  let modelFront = null;
  {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const meshes = [];
    root.traverse((o) => {
      if ((o.isMesh || o.isSkinnedMesh) && o.geometry && o.geometry.attributes.position) meshes.push(o);
    });
    if (meshes.length) {
      const tmp = new THREE.Vector3();
      const pts = [];
      let sumZ = 0, minY = Infinity, maxY = -Infinity;
      for (const m of meshes) {
        const pos = m.geometry.attributes.position;
        const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        const step = Math.max(1, Math.floor(pos.count / 600));
        for (let i = 0; i < pos.count; i += step) {
          tmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
          pts.push(tmp.y, tmp.z);
          sumZ += tmp.z;
          if (tmp.y < minY) minY = tmp.y;
          if (tmp.y > maxY) maxY = tmp.y;
        }
      }
      const n = pts.length / 2;
      if (n) {
        const bodyZ = sumZ / n;
        const cut = minY + (maxY - minY) * 0.12;
        const headCut = maxY - (maxY - minY) * 0.10;
        let fz = 0, fn = 0, hz = 0, hn = 0;
        for (let i = 0; i < pts.length; i += 2) {
          if (pts[i] <= cut) { fz += pts[i + 1]; fn++; }
          if (pts[i] >= headCut) { hz += pts[i + 1]; hn++; }
        }
        const feetFront = fn ? (fz / fn) - bodyZ : 0;
        // Most humanoids stand with the feet centred under the hips, so the
        // toe offset is often a millimetre or two and the old test flipped
        // models on noise. The face is a much stronger signal: the nose and
        // brow reach several centimetres in front of the skull's centre.
        const headFront = hn ? (hz / hn) - bodyZ : 0;
        const useFeet = Math.abs(feetFront) >= 0.02;
        const front = useFeet ? feetFront : headFront;
        if (Math.abs(front) >= 0.005) modelFront = front;
      }
    }
  }
  let flipped = false;
  if (modelFront !== null && modelFront < 0) {
    const holder = new THREE.Group();
    holder.name = 'humanBody';
    holder.add(root);
    root.rotation.y += Math.PI;
    holder.updateMatrixWorld(true);
    root = holder;
    modelFront = -modelFront;
    flipped = true;
  }
  // Fallback for rigs whose mesh has no usable rest pose: ask the bones.
  if (modelFront === null) {
    root.updateMatrixWorld(true);
    const toes = [], feet = [];
    root.traverse((o) => {
      if (!o.isBone) return;
      const n = (o.name || '').toLowerCase();
      if (n.indexOf('toe') >= 0) toes.push(o);
      else if (n.indexOf('foot') >= 0 || n.indexOf('ankle') >= 0) feet.push(o);
    });
    if (toes.length && feet.length) {
      const p = new THREE.Vector3();
      const avgZ = (list) => {
        let z = 0;
        for (const b of list) { b.getWorldPosition(p); root.worldToLocal(p); z += p.z; }
        return z / list.length;
      };
      if (avgZ(toes) - avgZ(feet) < 0) {
        const holder = new THREE.Group();
        holder.name = 'humanBody';
        holder.add(root);
        root.rotation.y += Math.PI;
        holder.updateMatrixWorld(true);
        root = holder;
        flipped = true;
      }
    }
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  const clips = entry.template.animations || [];
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    actions[clip.name] = action;
  }

  // map the manifest's role names onto whatever the file calls its clips
  const roles = entry.clips || { idle: 'Idle', walk: 'Walk', run: 'Run' };
  const byRole = {};
  for (const role of Object.keys(roles)) {
    const name = roles[role];
    byRole[role] = actions[name] || null;
  }

  // Some realistic scans ship walk/run only. Give them a standing pose made from
  // the first frame of the walk clip, so an idle pedestrian never T-poses.
  if (!byRole.idle && byRole.walk) {
    const idleClip = byRole.walk.getClip().clone();
    idleClip.name = '__idle_pose';
    const idleAction = mixer.clipAction(idleClip);
    idleAction.play();
    idleAction.paused = true;
    idleAction.setEffectiveWeight(0);
    idleAction.__pausedIdle = true;
    byRole.idle = idleAction;
  }

  // Bind the shared library onto this skeleton when it is the 24-bone
  // Quaternius rig the clip names were mapped to.
  let hasUAL = false;
  if (ANIM.ready && root.getObjectByName('Hips') && root.getObjectByName('RightHand')) {
    for (const role of Object.keys(UAL_ROLES)) {
      const clip = ualClipFor(root, UAL_ROLES[role], entry.id);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      if (role === 'shoot' || role === 'reload' || role === 'death' || role === 'punch' || role === 'interact' || role === 'jump' || role === 'land') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      byRole[role] = action;
      actions['ual:' + role] = action;
      hasUAL = true;
    }
  }

  let current = null;
  const play = (role, fade = 0.22) => {
    const next = byRole[role];
    if (!next || next === current) return false;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (next.__pausedIdle) { next.paused = true; next.time = 0; }
    if (current) current.fadeOut(fade);
    current = next;
    return true;
  };

  root.userData.modelFront = modelFront;
  return { root, mixer, actions, byRole, play, current: () => current, entry, modelFront, flipped, hasUAL };
}

/* ----------------------------------------------------------------- props --- */

// A static prop: normalised height, centred on its own origin, base at y = 0,
// so the city can drop it on the pavement without per-asset offsets.
export function instanceProp(entry, opts = {}) {
  const root = entry.template.scene.clone(true);
  const box = new THREE.Box3().setFromObject(root);
  const raw = Math.max(0.001, box.max.y - box.min.y);
  const scale = (opts.height || entry.height || 4) / raw;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  root.position.x -= (b2.min.x + b2.max.x) / 2;
  root.position.z -= (b2.min.z + b2.max.z) / 2;
  root.position.y -= b2.min.y;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, entry };
}
