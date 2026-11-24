// Palma City — procedural city, roads, buildings, props, beach, ocean, interiors.
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG, PITCH, HALF, WORLD_EDGE, BEACH_END, DISTRICTS } from '../config.js';
import { RNG, TAU, clamp } from '../core/utils.js';
import { MODELS, instanceProp, flattenModelGeometry } from './models.js';

const SCALE_TMP = new THREE.Vector3();
import * as TEX from './textures.js';
import * as SURF from './surface.js';
import { FACADE_TILE, applyFacadeDepth } from './facades.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// facade family per building style (mirrors STYLE_MAP in facades.js) and the
// window ratios each family paints, so geometry can be placed on the painted
// openings rather than floating over them
const FACADE_FAMILY = {
  glass: 'glass', deco: 'deco', stucco: 'stucco', hotel: 'stucco',
  brick: 'masonry', concrete: 'masonry', shopfront: 'stucco'
};
const WINDOW_RATIO = {
  glass: [0.9, 0.74], masonry: [0.44, 0.5], stucco: [0.42, 0.5], deco: [0.5, 0.5]
};
const AWNING_COLORS = [0xd63f6a, 0x2f7f8a, 0xe8dfc8, 0x3f6b4a, 0xb8563a, 0x2f4f7a, 0xd9a441];

function uvScalePlane(geo, w, h, uOff = 0, vOff = 0, tile = 16) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / tile) + uOff, uv.getY(i) * (h / tile) + vOff);
  }
  uv.needsUpdate = true;
  return geo;
}

const _tint = new THREE.Color();
function applyTint(g, tint) {
  _tint.set(tint);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _tint.r; arr[i * 3 + 1] = _tint.g; arr[i * 3 + 2] = _tint.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Vice City pastels for stucco and art-deco fronts: coral, peach, apricot,
// butter, mint, aqua, sky, lilac, stucco white and rose.
const PASTEL_TINTS = [
  0xff8fa3, 0xffb59e, 0xffd39a, 0xfff0b8, 0xa8efd4,
  0x8fe6ea, 0x9fc6f2, 0xc9b6f5, 0xfff7ec, 0xffb8d9
];

// Roof membranes: weathered grey, warm tan, white coating and a green-grey
// bitumen, so the huge flat slabs are not all the same cream.
const ROOF_TINTS = [0xc9c5bd, 0xb3aea4, 0xd6cab8, 0x9e968b, 0x98a49c, 0xbfb6a8];

// Soft radial falloff used as the halo behind every shop sign.
let SIGN_GLOW_TEX = null;
function signGlowTexture() {
  if (SIGN_GLOW_TEX) return SIGN_GLOW_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.42)');
  grd.addColorStop(0.65, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  SIGN_GLOW_TEX = new THREE.CanvasTexture(c);
  SIGN_GLOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return SIGN_GLOW_TEX;
}

function wallGeo(w, h, uv, x, y, z, rotY, tint, uShift = 0, vShift = 0) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) {
    a.setXY(i,
      ((uShift + a.getX(i) * w) / FACADE_TILE) * uv.us + uv.uo,
      ((vShift + a.getY(i) * h) / FACADE_TILE) * uv.vs + uv.vo);
  }
  a.needsUpdate = true;
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  if (tint) applyTint(g, tint);
  return g;
}

// mergeGeometries refuses a batch where only some geometries carry a colour
// attribute, and a refused batch silently loses whole features (parapets, fire
// escapes, roof plant). Normalise the attribute first: anything without a
// colour gets plain white, which is what the material multiplies by anyway.
function normaliseColors(list) {
  let withColor = 0;
  for (const g of list) if (g.getAttribute && g.getAttribute('color')) withColor++;
  if (!withColor || withColor === list.length) return;
  for (const g of list) {
    if (g.getAttribute && g.getAttribute('color')) continue;
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
}

// A single source geometry with a non-finite vertex poisons the whole merged
// buffer: three.js then logs computeBoundingSphere() NaN errors every frame and
// draws nothing. Clamp those vertices to the origin so the rest of the batch
// still renders, and keep the batch out of the renderer's error path.
function clampNonFinite(geo) {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const a = pos.array;
  let bad = 0;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { a[i] = 0; bad++; }
  if (bad) {
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

function mergeList(list, mat, opts = {}) {
  if (!list.length) return null;
  normaliseColors(list);
  const geo = BGU.mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  if (!geo) return null;
  clampNonFinite(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.castShadow !== false;
  m.receiveShadow = opts.receiveShadow !== false;
  m.matrixAutoUpdate = false;
  return m;
}

export class City {
  constructor(scene, game) {
    this.facadeCounts = { storefronts: 0, awnings: 0, signs: 0, setbacks: 0, windows: 0, glazed: 0 };
    this.scene = scene;
    this.game = game;
    this.rng = new RNG(CFG.SEED);
    this.colliders = [];
    this.colliderGrid = new Map();
    this.cell = 40;
    this.blocks = [];
    this.intersections = [];
    this.graph = [];
    this.pedPaths = [];
    this.parking = [];
    this.palmData = [];
    this.interiors = [];
    this.footprints = [];
    this.shadowBoxes = [];
    this.buildingMeshes = [];
    this.lightTimer = 0;
    this.signMeshes = [];
    this.lampSpots = [];
    this.propSpots = [];
    this.propModelCount = 0;

    this.roadsX = [];
    this.roadsZ = [];
    for (let k = 0; k <= CFG.GRID; k++) {
      const p = k * PITCH - HALF;
      this.roadsX.push(p);
      this.roadsZ.push(p);
    }

    this.streetNamesX = ['PALM AVE', 'CORAL AVE', 'OCEAN DR', 'BISCAYNE ST', 'SUNSET BLVD', 'MARINA WAY',
      'ALAMEDA ST', 'VISTA AVE', 'CARRERA ST', 'LA PALMA DR', 'SANTA CRUZ ST'];
    this.streetNamesZ = ['1ST ST', '2ND ST', '3RD ST', '4TH ST', '5TH ST', '6TH ST',
      '7TH ST', '8TH ST', '9TH ST', '10TH ST', '11TH ST'];

    this.buildGround();
    this.buildBlocks();
    this.buildRoadMarkings();
    this.buildFuelStations();
    this.buildGraph();
    this.buildProps();
    this.buildBeach();
    this.buildInteriors();
    this.signalsDirty = true;

    // Hundreds of tiny static street meshes (road paint, pads, plates, per-building
    // decorations) were each their own draw call with their own material. Merge
    // them by material *signature* (type, map, transparency, side, PBR values),
    // baking each mesh's colour into vertex colours so the variation survives.
    (() => {
      const sig = (m) => [m.type, m.map ? m.map.uuid : '-', m.transparent ? 1 : 0,
        m.side, m.alphaTest || 0, m.opacity, m.metalness, m.roughness].join('|');
      const buckets = new Map();
      for (const o of this.scene.children.slice()) {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry) continue;
        if (o === this.ferris || o.userData.dynamic) continue;
        if (Array.isArray(o.material) || !o.material) continue;
        const g = o.geometry;
        const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        if (tris > 20000) continue;
        const key = sig(o.material);
        if (!buckets.has(key)) buckets.set(key, { mat: o.material, list: [] });
        buckets.get(key).list.push(o);
      }
      for (const { mat, list } of buckets.values()) {
        if (list.length < 2) continue;
        const geos = [];
        for (const m of list) {
          m.updateMatrixWorld(true);
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
            if (g.attributes[name]) g.attributes[name].gpuType = undefined;
          }
          if (!g.attributes.normal) g.computeVertexNormals();
          if (!g.attributes.uv) {
            const n = g.attributes.position.count;
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          }
          if (!g.attributes.color) {
            const n = g.attributes.position.count;
            const c = m.material.color || { r: 1, g: 1, b: 1 };
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
            g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          }
          if (!g.index) {
            const n = g.attributes.position.count;
            const idx = new Uint32Array(n);
            for (let i = 0; i < n; i++) idx[i] = i;
            g.setIndex(new THREE.BufferAttribute(idx, 1));
          }
          geos.push(g);
        }
        const merged = geos.length === 1 ? geos[0] : BGU.mergeGeometries(geos, false);
        if (!merged) continue;
        const outMat = mat.clone();
        outMat.vertexColors = true;
        if (outMat.color) outMat.color.setHex(0xffffff);
        outMat.needsUpdate = true;
        const mesh = new THREE.Mesh(merged, outMat);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        for (const m of list) this.scene.remove(m);
        this.scene.add(mesh);
      }
    })();

    // Merged city meshes are single objects: the shadow camera cannot cull part
    // of one, so any of them inside the shadow box redraws in full. Keep them out
    // of the shadow pass; cars, people and props still cast.
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g) return;
      const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      // Merged batches can end up with several material groups that each cover
      // the whole index buffer, so the renderer draws the same triangles once per
      // group (the trim batch was drawn twice). Collapse to a single group; the
      // per-face tint variation is baked into vertex colours already.
      if (g.groups && g.groups.length > 1 && (tris > 100000 || o.isInstancedMesh)) {
        const total = g.index ? g.index.count : g.attributes.position.count;
        g.clearGroups();
        g.addGroup(0, total, 0);
        if (Array.isArray(o.material)) o.material = o.material[0];
      }
      // Static city geometry stays out of the shadow pass: it is merged, so the
      // shadow camera cannot cull part of it, and its shading is baked.
      if (!o.isInstancedMesh && o.parent === this.scene) o.castShadow = false;
    });
    this.buildPalms();
  }

  /* ----------------------------- helpers ----------------------------- */
  addCollider(minX, maxX, minZ, maxZ, maxY = 30) {
    const c = { minX, maxX, minZ, maxZ, minY: 0, maxY };
    this.colliders.push(c);
    const cs = this.cell;
    for (let i = Math.floor(minX / cs); i <= Math.floor(maxX / cs); i++) {
      for (let j = Math.floor(minZ / cs); j <= Math.floor(maxZ / cs); j++) {
        const k = i + ':' + j;
        let a = this.colliderGrid.get(k);
        if (!a) { a = []; this.colliderGrid.set(k, a); }
        a.push(c);
      }
    }
    return c;
  }

  queryColliders(x, z, r = 1) {
    const cs = this.cell, out = [];
    const i0 = Math.floor((x - r) / cs), i1 = Math.floor((x + r) / cs);
    const j0 = Math.floor((z - r) / cs), j1 = Math.floor((z + r) / cs);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.colliderGrid.get(i + ':' + j);
        if (a) for (const c of a) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  getDistrict(x, z) {
    for (const d of DISTRICTS) if (d.test(x, z)) return d.name;
    return 'PALMA CITY';
  }

  getStreetName(x, z) {
    let bx = 0, bz = 0, dx = 1e9, dz = 1e9;
    for (let i = 0; i < this.roadsX.length; i++) {
      const d = Math.abs(x - this.roadsX[i]);
      if (d < dx) { dx = d; bx = i; }
    }
    for (let i = 0; i < this.roadsZ.length; i++) {
      const d = Math.abs(z - this.roadsZ[i]);
      if (d < dz) { dz = d; bz = i; }
    }
    return dx < dz ? this.streetNamesX[bx % this.streetNamesX.length] : this.streetNamesZ[bz % this.streetNamesZ.length];
  }

  inBlock(x, z) {
    for (const b of this.blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b;
    return null;
  }

  getGroundHeight(x, z) {
    return this.inBlock(x, z) ? 0.22 : 0;
  }

  blockType(i, j) {
    const cx = i * PITCH - HALF + PITCH / 2;
    const cz = j * PITCH - HALF + PITCH / 2;
    if (cz > WORLD_EDGE - PITCH * 1.6) return 'hotel';
    if (Math.abs(cx) < PITCH * 1.8 && Math.abs(cz) < PITCH * 1.8) return 'downtown';
    if (cx < -PITCH * 3.2 && cz < 0) return 'industrial';
    if (cx > PITCH * 3.0 && cz < PITCH * 2.0) return 'residential';
    if (cz < -PITCH * 3.0) return 'residential';
    return this.rng.chance(0.35) ? 'park' : 'mixed';
  }

  /* ----------------------------- ground ----------------------------- */
  buildGround() {
    const S = (WORLD_EDGE * 2) + 40;
    const asphalt = TEX.getAsphalt();
    const asphaltRepeat = S / 6;
    asphalt.repeat.set(asphaltRepeat, asphaltRepeat);
    const asphaltMaps = TEX.photoMaterial('asphalt', asphaltRepeat, asphaltRepeat) || {};
    const mat = new THREE.MeshStandardMaterial({
      // the road texture is darkened in textures.js; tint the base plane to match
      color: new THREE.Color(0.44, 0.44, 0.47),
      map: asphalt, roughness: 0.94, metalness: 0.0,
      normalMap: asphaltMaps.normalMap || null,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: asphaltMaps.roughnessMap || null
    });
    const g = new THREE.PlaneGeometry(S, S, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.y = 0;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.scene.add(m);
    this.groundMesh = m;
    this.groundMat = mat;
    this.groundSize = S;

    // ocean
    this.buildOcean();

    // beach sand
    const sand = TEX.getSand();
    sand.repeat.set(14, 4);
    const sandGeo = new THREE.PlaneGeometry(WORLD_EDGE * 2 + 60, CFG.BEACH + 30);
    sandGeo.rotateX(-Math.PI / 2);
    const sandMesh = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sand, roughness: 0.96 }));
    sandMesh.position.set(0, 0.12, WORLD_EDGE + CFG.BEACH / 2 - 4);
    sandMesh.receiveShadow = true;
    this.scene.add(sandMesh);
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(2400, 1400, 96, 56);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSky: { value: new THREE.Color(0.35, 0.6, 0.85) },
      uDeep: { value: new THREE.Color(0.008, 0.13, 0.26) },
      uShallow: { value: new THREE.Color(0.09, 0.62, 0.62) }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 p = position;
          float w1 = sin(p.x*0.055 + uTime*0.9)*0.30;
          float w2 = sin(p.z*0.08 - uTime*1.15)*0.22;
          float w3 = sin((p.x+p.z)*0.021 + uTime*0.55)*0.42;
          p.y += w1 + w2 + w3;
          vN = normalize(vec3(-cos(p.x*0.055 + uTime*0.9)*0.055*0.30*6.0, 1.0, cos(p.z*0.08 - uTime*1.15)*0.08*0.22*6.0));
          vW = (modelMatrix * vec4(p,1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p,1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uSun; uniform vec3 uSunColor;
        uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uShallow;
        varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 viewDir = normalize(cameraPosition - vW);
          // small ripples as a normal perturbation: they give the sun glitter
          // something to break up, and the far water a fine texture
          float t = uTime;
          vec2 q = vW.xz;
          float n1 = sin(q.x*0.9 + t*1.6)*0.5 + sin(q.y*1.3 - t*1.1)*0.5;
          float n2 = sin((q.x + q.y)*2.1 + t*2.3);
          vec3 n = normalize(vN + vec3(n1*0.06 + n2*0.03, 0.0, n2*0.05 - n1*0.04));
          float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
          // turquoise shallows fading to deep blue offshore
          float dz = max(vW.z - 556.0, 0.0);
          vec3 base = mix(uDeep, uShallow, exp(-dz / 130.0));
          vec3 col = mix(base, uSky, fres * 0.62);
          vec3 h = normalize(uSun + viewDir);
          float ndh = max(dot(n, h), 0.0);
          col += uSunColor * pow(ndh, 320.0) * 3.0;
          col += uSunColor * pow(ndh, 40.0) * 0.12;
          // surf: a wavy foam line along the waterline, not a ruler-straight seam
          float wob = sin(vW.x*0.32 + t*1.3)*4.0 + sin(vW.x*0.09 - t*0.8)*7.0;
          float foam = 1.0 - smoothstep(0.0, 9.0, vW.z - (556.0 + wob));
          foam *= 0.55 + 0.45*sin(vW.x*1.7 + t*2.0);
          col = mix(col, vec3(0.93, 0.98, 0.97), clamp(foam, 0.0, 1.0) * 0.8);
          // haze into the sky at the horizon
          col = mix(col, uSky, smoothstep(400.0, 1500.0, dz) * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -0.6, BEACH_END + 700);
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this.oceanMesh = mesh;
  }

  /* ----------------------------- blocks ----------------------------- */
  buildBlocks() {
    const facadeBatches = new Map(); // style -> geo list
    const roofBatch = [];
    const trimBatch = [];
    const metalBatch = [];
    const awningBatch = [];
    const propBatch = [];
    const signQuads = [];
    const glowQuads = [];
    const glassBatch = [];
    const glazeBatch = [];
    const sidewalkBatch = [];

    const sidewalkTex = TEX.getSidewalk();
    const roofTex = TEX.getRoof();

    for (let j = 0; j < CFG.GRID; j++) {
      for (let i = 0; i < CFG.GRID; i++) {
        const x0 = i * PITCH - HALF + CFG.ROAD / 2;
        const x1 = x0 + CFG.BLOCK;
        const z0 = j * PITCH - HALF + CFG.ROAD / 2;
        const z1 = z0 + CFG.BLOCK;
        const type = this.blockType(i, j);
        const block = { x0, x1, z0, z1, i, j, type };
        this.blocks.push(block);

        // sidewalk slab
        const sw = new THREE.BoxGeometry(CFG.BLOCK, 0.22, CFG.BLOCK);
        const uv = sw.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (CFG.BLOCK / 2.4), uv.getY(k) * (CFG.BLOCK / 2.4));
        sw.translate((x0 + x1) / 2, 0.11, (z0 + z1) / 2);
        sidewalkBatch.push(sw);

        // pedestrian loop around the block
        this.pedPaths.push({
          x0: x0 + 2.6, x1: x1 - 2.6, z0: z0 + 2.6, z1: z1 - 2.6, y: 0.22, block
        });

        const lot = { x0: x0 + CFG.SIDEWALK, x1: x1 - CFG.SIDEWALK, z0: z0 + CFG.SIDEWALK, z1: z1 - CFG.SIDEWALK };
        if (type === 'park') {
          this.buildPark(lot);
          continue;
        }
        const leaves = this.subdivide(lot, 0, type);
        for (const leaf of leaves) {
          if (this.rng.chance(0.06)) continue;
          this.buildBuilding(leaf, type, { facadeBatches, roofBatch, trimBatch, metalBatch, awningBatch, propBatch, signQuads, glowQuads, glassBatch, glazeBatch }, block);
        }
        // parking spots along the block edge
        for (let s = 0; s < 2; s++) {
          const t = 0.3 + this.rng.next() * 0.4;
          this.parking.push({
            x: x0 + 3.2,
            z: z0 + (z1 - z0) * t,
            heading: Math.PI / 2
          });
        }
      }
    }

    this.buildStreetFurniture(propBatch);
    this.spawnLamps();
    this.spawnProps();

    // merge facade batches
    for (const [key, list] of facadeBatches) {
      const style = key.split(':')[0];
      const variant = +key.split(':')[1];
      const fac = TEX.getFacade(style, variant);
      const mat = new THREE.MeshStandardMaterial({
        map: fac.map, emissiveMap: fac.emissiveMap, emissive: new THREE.Color(0xffc98a),
        emissiveIntensity: 0, roughness: fac.roughness, metalness: fac.metalness,
        envMapIntensity: style === 'glass' ? 1.5 : 0.4, vertexColors: true,
        normalMap: fac.normalMap || null,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughnessMap: fac.roughnessMap || null
      });
      mat.userData.isFacade = true;
      applyFacadeDepth(mat, fac);
      const mesh = mergeList(list, mat);
      if (mesh) { mesh.castShadow = false; mesh.receiveShadow = true; this.scene.add(mesh); this.buildingMeshes.push(mesh); }
    }

    roofTex.repeat.set(1, 1);
    // roof slabs and parapets are concrete, not white card
    const roofMaps = TEX.photoMaterial('concrete', 6, 6) || {};
    const roofMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: roofMaps.map || roofTex, roughness: 0.95,
      normalMap: roofMaps.normalMap || null,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: roofMaps.roughnessMap || null
    });
    const roofMesh = mergeList(roofBatch, roofMat);
    if (roofMesh) this.scene.add(roofMesh);

    // cornices, sills, curbs and railings: painted render, with real relief
    const trimMaps = TEX.photoMaterial('plaster', 2, 2) || {};
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xe8e1d3, vertexColors: true, roughness: 0.82,
      map: trimMaps.map || null,
      normalMap: trimMaps.normalMap || null,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: trimMaps.roughnessMap || null
    });
    const trimMesh = mergeList(trimBatch, trimMat);
    if (trimMesh) this.scene.add(trimMesh);

    // corrugated steel: real relief and gloss variation on the metal props
    const metalMaps = TEX.photoMaterial('metal', 1, 1) || {};
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x9aa0a6, roughness: 0.55, metalness: 0.65,
      normalMap: metalMaps.normalMap || null,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: metalMaps.roughnessMap || null
    });
    const metalMesh = mergeList(metalBatch, metalMat);
    if (metalMesh) this.scene.add(metalMesh);

    const awnMaps = SURF.getAwningFabric();
    const awnMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 1.0,
      map: awnMaps.map,
      normalMap: awnMaps.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: awnMaps.roughnessMap
    });
    const awnMesh = mergeList(awningBatch, awnMat);
    if (awnMesh) this.scene.add(awnMesh);

    if (glowQuads.length) {
      // A soft additive halo behind every sign: one merged mesh, one extra draw
      // call, and it is what makes the beachfront read as neon at dusk instead
      // of coloured rectangles.
      const glowMat = new THREE.MeshBasicMaterial({
        map: signGlowTexture(), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, opacity: 0, color: 0xffc2e4
      });
      this.signGlowMat = glowMat;
      const glowMesh = mergeList(glowQuads, glowMat, { castShadow: false, receiveShadow: false });
      if (glowMesh) { glowMesh.renderOrder = 3; this.scene.add(glowMesh); }
    }

    if (signQuads.length) {
      // lit shop signs: the atlas doubles as its own emissive map, so neon
      // lettering glows once the sun goes down
      const signMat = new THREE.MeshStandardMaterial({
        map: TEX.getSignAtlas().map,
        emissiveMap: TEX.getSignAtlas().map,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.15,
        roughness: 0.55,
        metalness: 0.1
      });
      this.signMat = signMat;
      const signMesh = mergeList(signQuads, signMat, { castShadow: false, receiveShadow: false });
      if (signMesh) { this.scene.add(signMesh); this.signMeshes.push(signMesh); }
    }

    if (propBatch.length) {
      // street furniture (bins, benches, meters, barriers): painted metal with
    // chipped edges and scuffs instead of flat vertex colour
    const propMaps = SURF.getPropPaint();
    const propMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.1,
      map: propMaps.map,
      normalMap: propMaps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: propMaps.roughnessMap
    });
      const propMesh = mergeList(propBatch, propMat);
      if (propMesh) {
        // The downloaded prop models (bench, bin, hydrant, planter, mailbox,
        // bollard, trees) replace this procedural furniture batch, which is the
        // single biggest triangle item in the city. Keep the object as a fallback
        // reference but do not draw it.
        propMesh.visible = false;
        this.propMesh = propMesh;
      }
    }

    if (glassBatch.length) {
      const shopMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.12, metalness: 0.6, envMapIntensity: 1.4
      });
      const shopMesh = mergeList(glassBatch, shopMat, { castShadow: false });
      if (shopMesh) { this.scene.add(shopMesh); this.shopGlassMesh = shopMesh; }
    }

    // shopfront glazing: a thin reflective sheet over the recessed interior, so
    // the opening reads as glass with depth behind it rather than a hole
    if (glazeBatch.length) {
      const glazeMat = new THREE.MeshPhysicalMaterial({
        color: 0xa8ccd6, transparent: true, opacity: 0.2, roughness: 0.05,
        metalness: 0.0, envMapIntensity: 1.7, depthWrite: false
      });
      const glazeMesh = mergeList(glazeBatch, glazeMat, { castShadow: false, receiveShadow: false });
      if (glazeMesh) this.scene.add(glazeMesh);
    }

    sidewalkTex.repeat.set(1, 1);
    const swMaps = TEX.photoMaterial('paving', 1, 1) || {};
    const swMat = new THREE.MeshStandardMaterial({
      map: sidewalkTex, roughness: 0.92,
      normalMap: swMaps.normalMap || null,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: swMaps.roughnessMap || null
    });
    const swMesh = mergeList(sidewalkBatch, swMat, { castShadow: false });
    if (swMesh) { this.scene.add(swMesh); this.sidewalkMesh = swMesh; }

    this.buildBuildingShadows();
  }

  /* ------------------------ projected sun shadows ------------------------ */
  // One merged mesh: for every building, its footprint, its roof quad and the
  // four wall sweeps. A vertex attribute carries how far that vertex should
  // slide along the shadow direction, so the whole city's shadows update from a
  // single uniform when the sun moves. Twelve triangles per building.
  buildBuildingShadows() {
    const boxes = this.shadowBoxes;
    if (!boxes || !boxes.length) return;
    const pos = [];
    const mv = [];
    const q = (ax, az, bx, bz, cx, cz, dx, dz, ma, mb, mc, md) => {
      pos.push(ax, 0.25, az, bx, 0.25, bz, cx, 0.25, cz);
      mv.push(ma, mb, mc);
      pos.push(ax, 0.25, az, cx, 0.25, cz, dx, 0.25, dz);
      mv.push(ma, mc, md);
    };
    for (const b of boxes) {
      const { x0, x1, z0, z1, h } = b;
      // footprint and roof
      q(x0, z0, x1, z0, x1, z1, x0, z1, 0, 0, 0, 0);
      q(x0, z0, x1, z0, x1, z1, x0, z1, h, h, h, h);
      // wall sweeps: each edge from the ground to the roof
      q(x0, z0, x1, z0, x1, z0, x0, z0, 0, 0, h, h);
      q(x1, z0, x1, z1, x1, z1, x1, z0, 0, 0, h, h);
      q(x1, z1, x0, z1, x0, z1, x1, z1, 0, 0, h, h);
      q(x0, z1, x0, z0, x0, z0, x0, z1, 0, 0, h, h);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aMove', new THREE.Float32BufferAttribute(mv, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uDir: { value: new THREE.Vector2(0, 0) },
        uColor: { value: new THREE.Color(0x0b1220) },
        uAlpha: { value: 0.3 },
        uFog: { value: 0.001 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // A building's six quads overlap, and neighbouring buildings overlap on
      // the street. Without a stencil each layer darkens the ground again and
      // the block turns into a black carpet. Let only the first shadow win.
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */`
        attribute float aMove;
        uniform vec2 uDir;
        varying float vDepth;
        void main(){
          vec3 p = position;
          p.xz += uDir * aMove;
          vec4 vp = viewMatrix * modelMatrix * vec4(p, 1.0);
          vDepth = -vp.z;
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uAlpha, uFog;
        varying float vDepth;
        void main(){
          float f = exp(-uFog * uFog * vDepth * vDepth);
          gl_FragColor = vec4(uColor, uAlpha * f);
        }`
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.shadowMesh = mesh;
    this.shadowMat = mat;
  }

  subdivide(rect, depth, type) {
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    const minSize = type === 'downtown' ? 26 : type === 'industrial' ? 30 : 15;
    const canSplit = depth < 3 && (w > minSize * 2 || d > minSize * 2);
    if (!canSplit || this.rng.chance(0.16)) return [rect];
    const horizontal = w > d ? true : false;
    if (horizontal) {
      const cut = rect.x0 + w * (0.36 + this.rng.next() * 0.28);
      return [
        ...this.subdivide({ ...rect, x1: cut }, depth + 1, type),
        ...this.subdivide({ ...rect, x0: cut }, depth + 1, type)
      ];
    }
    const cut = rect.z0 + d * (0.36 + this.rng.next() * 0.28);
    return [
      ...this.subdivide({ ...rect, z1: cut }, depth + 1, type),
      ...this.subdivide({ ...rect, z0: cut }, depth + 1, type)
    ];
  }

  pickStyle(type) {
    const r = this.rng;
    if (type === 'downtown') return r.chance(0.75) ? 'glass' : 'concrete';
    if (type === 'hotel') return r.chance(0.7) ? 'hotel' : 'deco';
    if (type === 'industrial') return r.chance(0.7) ? 'concrete' : 'brick';
    if (type === 'residential') return r.chance(0.55) ? 'stucco' : 'brick';
    return r.weighted([['deco', 3], ['stucco', 3], ['brick', 2], ['shopfront', 2], ['glass', 1]]);
  }

  buildBuilding(rect, type, batches, block) {
    const r = this.rng;
    const inset = 0.7 + r.next() * 1.6;
    const x0 = rect.x0 + inset, x1 = rect.x1 - inset;
    const z0 = rect.z0 + inset, z1 = rect.z1 - inset;
    const w = x1 - x0, d = z1 - z0;
    if (w < 5 || d < 5) return;
    // remember the footprint so the interior pass can put a door on every
    // building a player can walk up to
    this.footprints.push({ x0, x1, z0, z1, w, d, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, type, block });

    let h;
    if (type === 'downtown') h = 34 + Math.pow(r.next(), 1.6) * 96;
    else if (type === 'hotel') h = 14 + r.next() * 26;
    else if (type === 'industrial') h = 7 + r.next() * 8;
    else if (type === 'residential') h = 5 + r.next() * 9;
    else h = 7 + r.next() * 22;
    // ground shadow volume: the merged facades cannot join the shadow-map pass
    // without doubling the frame's triangles, so each building records a box
    // the projected-shadow mesh extrudes along the sun direction instead
    this.shadowBoxes.push({ x0, x1, z0, z1, h });

    const style = this.pickStyle(type);
    // four dressed variants per family: two palettes, four different window
    // patterns, so a street no longer repeats one grid on every front
    const variant = r.int(0, 3);
    const key = style + ':' + variant;
    const list = batches.facadeBatches.get(key) || [];
    batches.facadeBatches.set(key, list);

    // per-building UV jitter: offset AND scale, so neighbouring buildings never
    // share a window grid and the tiling does not line up across a street
    const uv = {
      us: 0.86 + r.next() * 0.3,
      vs: 0.94 + r.next() * 0.12,
      uo: r.next() * 5.3,
      vo: r.next() * 3.1
    };
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const isGlass = style === 'glass';
    const fam = FACADE_FAMILY[style] || 'stucco';
    // Leonida palette: saturated pastel stucco and deco on the beach blocks,
    // muted brick and concrete inland, blue-green curtain wall downtown.
    let tint;
    if (isGlass) {
      tint = new THREE.Color().setHSL(0.53 + r.next() * 0.05, 0.32 + r.next() * 0.2, 0.44 + r.next() * 0.14);
    } else if (fam === 'stucco' || fam === 'deco') {
      const pastel = PASTEL_TINTS[r.int(0, PASTEL_TINTS.length - 1)];
      tint = new THREE.Color(pastel).offsetHSL(0, 0, (r.next() - 0.5) * 0.07);
    } else {
      tint = new THREE.Color().setHSL(0.02 + r.next() * 0.1, 0.1 + r.next() * 0.16, 0.44 + r.next() * 0.24);
    }
    const [wr, hr] = WINDOW_RATIO[fam] || WINDOW_RATIO.stucco;
    const trimTint = isGlass
      ? tint.clone().offsetHSL(0, -0.02, -0.06)
      : tint.clone().offsetHSL(0, -0.04, 0.16);

    const box = (arr, sx, sy, sz, px, py, pz) => {
      const b = new THREE.BoxGeometry(sx, sy, sz);
      b.translate(px, py, pz);
      if (arr === batches.trimBatch) applyTint(b, trimTint);
      arr.push(b);
    };
    const cbox = (arr, color, sx, sy, sz, px, py, pz) => {
      const b = new THREE.BoxGeometry(sx, sy, sz);
      b.translate(px, py, pz);
      applyTint(b, color);
      arr.push(b);
    };
    const cyl = (arr, color, rt, rb, hh, seg, px, py, pz) => {
      const b = new THREE.CylinderGeometry(rt, rb, hh, seg);
      b.translate(px, py, pz);
      applyTint(b, color);
      arr.push(b);
    };

    // ---------- massing ----------
    // Tall towers get one or two asymmetric setbacks (the upper tiers drift off
    // centre so the skyline is not a stack of concentric boxes), mid-rise
    // buildings either step back or cantilever their upper floors over the
    // street wall, and low-rise stays a single mass.
    const tiers = [];
    const drift = (k) => (r.next() - 0.5) * k;
    if (h > 30 && r.chance(0.78)) {
      this.facadeCounts.setbacks++;
      const h1 = h * (0.46 + r.next() * 0.24);
      const shrink = 0.62 + r.next() * 0.22;
      const ox = drift(w * 0.1), oz = drift(d * 0.1);
      tiers.push({ y0: 0, y1: h1, w, d, cx, cz });
      const tw = w * shrink, td = d * shrink, tcx = cx + ox, tcz = cz + oz;
      if (h > 56 && r.chance(0.6)) {
        const h2 = h1 + (h - h1) * (0.55 + r.next() * 0.2);
        tiers.push({ y0: h1, y1: h2, w: tw, d: td, cx: tcx, cz: tcz });
        tiers.push({ y0: h2, y1: h, w: tw * 0.74, d: td * 0.74, cx: tcx + ox * 0.5, cz: tcz + oz * 0.5 });
      } else {
        tiers.push({ y0: h1, y1: h, w: tw, d: td, cx: tcx, cz: tcz });
      }
    } else if (h > 16 && r.chance(0.34)) {
      const h1 = h * (0.6 + r.next() * 0.2);
      if (r.chance(0.5)) {
        // upper floors overhang the street wall on a corbelled slab
        tiers.push({ y0: 0, y1: h1, w, d, cx, cz });
        tiers.push({ y0: h1, y1: h, w: w * 1.05, d: d * 1.05, cx, cz });
      } else {
        tiers.push({ y0: 0, y1: h1, w, d, cx, cz });
        tiers.push({ y0: h1, y1: h, w: w * 0.82, d: d * 0.82, cx: cx + drift(w * 0.08), cz });
      }
    } else {
      tiers.push({ y0: 0, y1: h, w, d, cx, cz });
    }

    const trim = batches.trimBatch, metal = batches.metalBatch, prop = batches.propBatch;
    // wall segments at ground level, recorded so the painted windows on the
    // street face can be dressed with real sills, lintels and jambs afterwards
    const groundSegs = [];
    let hasShop = false;

    for (let ti = 0; ti < tiers.length; ti++) {
      const t = tiers[ti];
      const th = t.y1 - t.y0;
      const hy = t.y0 + th / 2;

      // street face (+z): low buildings get a real recessed storefront opening
      const shopFront = ti === 0 && h < 30 && t.d > 9 && t.w > 7;
      if (shopFront) {
        hasShop = true;
        this.facadeCounts.storefronts++;
        const gw = Math.min(t.w * 0.56, 7.2);
        const gh = 2.85;
        const gx = t.cx + (r.next() - 0.5) * Math.max(0, t.w - gw - 2.2);
        const leftW = (gx - gw / 2) - (t.cx - t.w / 2);
        const rightW = (t.cx + t.w / 2) - (gx + gw / 2);
        if (leftW > 0.2) {
          list.push(wallGeo(leftW, th, uv, t.cx - t.w / 2 + leftW / 2, hy, t.cz + t.d / 2, 0, tint, 0, 0));
          if (ti === 0) groundSegs.push({ x: t.cx - t.w / 2 + leftW / 2, z: t.cz + t.d / 2, w: leftW, y0: t.y0, h: th, rotY: 0, uShift: 0, vShift: 0, face: 'front' });
        }
        if (rightW > 0.2) {
          list.push(wallGeo(rightW, th, uv, t.cx + t.w / 2 - rightW / 2, hy, t.cz + t.d / 2, 0, tint, leftW + gw, 0));
          if (ti === 0) groundSegs.push({ x: t.cx + t.w / 2 - rightW / 2, z: t.cz + t.d / 2, w: rightW, y0: t.y0, h: th, rotY: 0, uShift: leftW + gw, vShift: 0, face: 'front' });
        }
        const headH = th - gh;
        if (headH > 0.2) {
          list.push(wallGeo(gw, headH, uv, gx, gh + headH / 2, t.cz + t.d / 2, 0, tint, leftW, gh));
          if (ti === 0) groundSegs.push({ x: gx, z: t.cz + t.d / 2, w: gw, y0: gh, h: headH, rotY: 0, uShift: leftW, vShift: gh, face: 'front' });
        }

        const depth = 0.62;
        const bz = t.cz + t.d / 2 - depth;
        // dark shop interior behind the glazing
        const back = new THREE.PlaneGeometry(gw, gh);
        back.translate(gx, gh / 2, bz);
        applyTint(back, 0x3b3c40);
        batches.glassBatch.push(back);
        // door to the back room, with a warm spill of light
        const bd = new THREE.PlaneGeometry(1.0, 2.1);
        bd.translate(gx - gw * 0.3, 1.05, bz + 0.03);
        applyTint(bd, 0x181a1c); batches.glassBatch.push(bd);
        const spill = new THREE.PlaneGeometry(1.4, 2.3);
        spill.translate(gx - gw * 0.3, 1.15, bz + 0.02);
        applyTint(spill, 0xffd9a0); batches.glassBatch.push(spill);
        // shelving with stock and a counter read as an actual shop behind the glass
        for (let k = 0; k < 3; k++) {
          const shelf = new THREE.BoxGeometry(gw * 0.62, 0.1, 0.28);
          shelf.translate(gx + gw * 0.06, 0.9 + k * 0.55, bz + 0.2);
          applyTint(shelf, 0xc0a273); batches.glassBatch.push(shelf);
          for (let m = 0; m < 3; m++) {
            const good = new THREE.BoxGeometry(0.22, 0.3, 0.2);
            good.translate(gx - gw * 0.16 + m * (gw * 0.19), 1.1 + k * 0.55, bz + 0.2);
            applyTint(good, r.pick([0xc94f3d, 0x3d7ac9, 0xd9c04a, 0x4aa06a, 0xe0e0d6]));
            batches.glassBatch.push(good);
          }
        }
        const counter = new THREE.BoxGeometry(gw * 0.4, 0.95, 0.5);
        counter.translate(gx + gw * 0.22, 0.48, bz + 0.45);
        applyTint(counter, 0x94754e); batches.glassBatch.push(counter);
        // ceiling light panel
        const lamp = new THREE.PlaneGeometry(gw * 0.5, 0.22);
        lamp.rotateX(Math.PI / 2);
        lamp.translate(gx, gh - 0.02, bz + 0.3);
        applyTint(lamp, 0xfff0d0); batches.glassBatch.push(lamp);
        // the glazing sheet itself, just inside the reveal
        const pane = new THREE.PlaneGeometry(gw - 0.12, gh - 0.1);
        pane.translate(gx, gh / 2 - 0.02, t.cz + t.d / 2 - 0.07);
        batches.glazeBatch.push(pane);
        this.facadeCounts.glazed++;
        // jambs, soffit, threshold
        const revL = new THREE.PlaneGeometry(depth, gh);
        revL.rotateY(Math.PI / 2); revL.translate(gx - gw / 2, gh / 2, bz + depth / 2);
        applyTint(revL, trimTint); trim.push(revL);
        const revR = new THREE.PlaneGeometry(depth, gh);
        revR.rotateY(-Math.PI / 2); revR.translate(gx + gw / 2, gh / 2, bz + depth / 2);
        applyTint(revR, trimTint); trim.push(revR);
        const sof = new THREE.PlaneGeometry(gw, depth);
        sof.rotateX(-Math.PI / 2); sof.translate(gx, gh, bz + depth / 2);
        applyTint(sof, trimTint); trim.push(sof);
        const thr = new THREE.PlaneGeometry(gw, depth);
        thr.rotateX(-Math.PI / 2); thr.translate(gx, 0.07, bz + depth / 2);
        applyTint(thr, 0x6b665c); prop.push(thr);
        // mullions across the shop glass
        for (let k = 1; k < 4; k++) {
          const mull = new THREE.BoxGeometry(0.09, gh, 0.09);
          mull.translate(gx - gw / 2 + (gw / 4) * k, gh / 2, bz + 0.06);
          applyTint(mull, 0x2b3236); prop.push(mull);
        }
        // warm interior glow strip at the back of the shop
        const glow = new THREE.PlaneGeometry(gw * 0.9, 0.28);
        glow.translate(gx, 2.62, bz + 0.05);
        applyTint(glow, 0xffe9c4); batches.glassBatch.push(glow);

        // sign above the shopfront, from the shared atlas
        const atlas = TEX.getSignAtlas();
        const cell = r.int(0, atlas.cols * atlas.rows - 1);
        const cu = 1 / atlas.cols, cv = 1 / atlas.rows;
        const u0 = (cell % atlas.cols) * cu;
        const v0 = 1 - (Math.floor(cell / atlas.cols) + 1) * cv;
        const sw = Math.min(gw * 0.92, 7.2), shh = Math.min(1.05, sw * 0.2);
        const q = new THREE.PlaneGeometry(sw, shh);
        const qa = q.attributes.uv;
        for (let i = 0; i < qa.count; i++) qa.setXY(i, u0 + qa.getX(i) * cu, v0 + qa.getY(i) * cv);
        q.translate(gx, gh + 0.55 + shh / 2, t.cz + t.d / 2 + 0.1);
        batches.signQuads.push(q);
    this.facadeCounts.signs++;
        this.facadeCounts.signs++;
        // sign backing board
        cbox(prop, 0x1a1a1c, sw + 0.24, shh + 0.24, 0.08, gx, gh + 0.55 + shh / 2, t.cz + t.d / 2 + 0.04);
        // recorded so the packaged screenshot pass can frame a real shopfront
        (this.shopFronts || (this.shopFronts = [])).push({
          x: gx, z: t.cz + t.d / 2, w: gw, h: th,
          street: !!block && rect.z1 > block.z1 - CFG.SIDEWALK - 7
        });
        // fabric awning over the shop window, plus a blade sign on the pier
        this.addAwning(batches.awningBatch, gx, gh + 0.12, t.cz + t.d / 2 + 0.04,
          Math.min(gw * 0.82, 5.6), 0, r.pick(AWNING_COLORS));
        this.addBladeSign(batches, gx + (r.chance(0.5) ? -1 : 1) * (gw / 2 + 0.45),
          gh + 0.5, t.cz + t.d / 2 + 0.5, 0.78, 2.1, r);
      } else {
        list.push(wallGeo(t.w, th, uv, t.cx, hy, t.cz + t.d / 2, 0, tint));
        if (ti === 0) groundSegs.push({ x: t.cx, z: t.cz + t.d / 2, w: t.w, y0: t.y0, h: th, rotY: 0, uShift: 0, vShift: 0, face: 'front' });
      }

      list.push(wallGeo(t.w, th, uv, t.cx, hy, t.cz - t.d / 2, Math.PI, tint));
      // the side faces were rotated inward, so both were invisible from the
      // street and you could see through the building at a corner
      list.push(wallGeo(t.d, th, uv, t.cx + t.w / 2, hy, t.cz, Math.PI / 2, tint));
      list.push(wallGeo(t.d, th, uv, t.cx - t.w / 2, hy, t.cz, -Math.PI / 2, tint));
      if (ti === 0) {
        groundSegs.push({ x: t.cx, z: t.cz - t.d / 2, w: t.w, y0: t.y0, h: th, rotY: Math.PI, uShift: 0, vShift: 0, face: 'back' });
        groundSegs.push({ x: t.cx + t.w / 2, z: t.cz, w: t.d, y0: t.y0, h: th, rotY: Math.PI / 2, uShift: 0, vShift: 0, face: 'right' });
        groundSegs.push({ x: t.cx - t.w / 2, z: t.cz, w: t.d, y0: t.y0, h: th, rotY: -Math.PI / 2, uShift: 0, vShift: 0, face: 'left' });
      }

      // roof / terrace slab
      const roof = new THREE.PlaneGeometry(t.w, t.d, 1, 1);
      uvScalePlane(roof, t.w, t.d);
      roof.rotateX(-Math.PI / 2);
      roof.translate(t.cx, t.y1 + 0.02, t.cz);
      applyTint(roof, ROOF_TINTS[r.int(0, ROOF_TINTS.length - 1)]);
      batches.roofBatch.push(roof);

      // parapet, cornice and floor bands
      const pw = 0.3, ph = 0.62;
      box(trim, t.w, ph, pw, t.cx, t.y1 + ph / 2, t.cz + t.d / 2 - pw / 2);
      box(trim, t.w, ph, pw, t.cx, t.y1 + ph / 2, t.cz - t.d / 2 + pw / 2);
      box(trim, pw, ph, t.d, t.cx + t.w / 2 - pw / 2, t.y1 + ph / 2, t.cz);
      box(trim, pw, ph, t.d, t.cx - t.w / 2 + pw / 2, t.y1 + ph / 2, t.cz);
      // coping stones on the parapet: a bright cap line against the sky
      box(trim, t.w + 0.14, 0.1, pw + 0.18, t.cx, t.y1 + ph + 0.05, t.cz + t.d / 2 - pw / 2);
      box(trim, t.w + 0.14, 0.1, pw + 0.18, t.cx, t.y1 + ph + 0.05, t.cz - t.d / 2 + pw / 2);
      box(trim, pw + 0.18, 0.1, t.d + 0.14, t.cx + t.w / 2 - pw / 2, t.y1 + ph + 0.05, t.cz);
      box(trim, pw + 0.18, 0.1, t.d + 0.14, t.cx - t.w / 2 + pw / 2, t.y1 + ph + 0.05, t.cz);

      box(trim, t.w + 0.4, 0.36, 0.36, t.cx, t.y1 - 0.4, t.cz + t.d / 2 + 0.08);
      box(trim, t.w + 0.4, 0.36, 0.36, t.cx, t.y1 - 0.4, t.cz - t.d / 2 - 0.08);
      box(trim, 0.36, 0.36, t.d + 0.4, t.cx + t.w / 2 + 0.08, t.y1 - 0.4, t.cz);
      box(trim, 0.36, 0.36, t.d + 0.4, t.cx - t.w / 2 - 0.08, t.y1 - 0.4, t.cz);

      this.roofClutter(batches, t, r, style, isGlass, ti);

      // dentil course under the cornice on street level buildings
      if (ti === 0 && !isGlass && t.w > 6) {
        const nd = Math.min(8, Math.max(3, Math.floor(t.w / 1.4)));
        const step = (t.w - 1.6) / Math.max(1, nd - 1);
        for (let k = 0; k < nd; k++) {
          box(trim, 0.2, 0.22, 0.32, t.cx - t.w / 2 + 0.8 + k * step, t.y1 - 0.68, t.cz + t.d / 2 + 0.12);
        }
      }
      // corbels carrying a cantilevered upper tier
      if (ti > 0 && t.w > tiers[0].w + 0.05) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          box(trim, 0.36, 0.36, 0.36,
            t.cx + sx * (tiers[0].w / 2 - 0.5), t.y0 - 0.18, t.cz + sz * (tiers[0].d / 2 - 0.5));
        }
      }

      // floor bands: subtle on tall towers (a bright band cage reads as white
      // diagonal stripes at street level), more pronounced on low-rise
      const bandT = h > 30 ? 0.07 : 0.11;
      const bandD = h > 30 ? 0.1 : 0.24;
      // tall towers get dark bands: a light metal band cage turns into bright
      // diagonal stripes across the whole facade when seen from street level
      const band = h > 30
        ? (a, b, c, px, py, pz) => cbox(prop, 0x44484d, a, b, c, px, py, pz)
        : (a, b, c, px, py, pz) => box(trim, a, b, c, px, py, pz);
      // bands follow the painted floor lines (3 m pitch in the facade texture,
      // scaled by uv.vs) instead of a fixed 3.2 m, which drifted across the
      // windows and cut through them on every other floor
      const shopHead = ti === 0 && hasShop
        ? groundSegs.find((s) => s.face === 'front' && s.y0 > 0.5) : null;
      const bandY0 = shopHead ? shopHead.y0 : t.y0;
      const bandShift = shopHead ? shopHead.vShift : 0;
      const bandH = shopHead ? shopHead.h : th;
      const rows = [];
      for (const w of this.windowGrid(t.w, bandH, uv, 0, bandShift, wr, hr)) {
        const y = Math.round((w.y + w.h) * 100) / 100;
        if (!rows.includes(y)) rows.push(y);
      }
      rows.sort((a, b) => a - b);
      for (let k = h > 30 ? 1 : 0; k < rows.length; k += h > 30 ? 2 : 1) {
        if (!isGlass) {
          const y = bandY0 + rows[k];
          if (y > t.y1 - 0.5) break;
          band(t.w + 0.1, bandT, bandD, t.cx, y, t.cz + t.d / 2 + bandD * 0.25);
          band(t.w + 0.1, bandT, bandD, t.cx, y, t.cz - t.d / 2 - bandD * 0.25);
          band(bandD, bandT, t.d + 0.1, t.cx + t.w / 2 + bandD * 0.25, y, t.cz);
          band(bandD, bandT, t.d + 0.1, t.cx - t.w / 2 - bandD * 0.25, y, t.cz);
        }
      }
      const floors = rows.length;

      if (!isGlass && (style === 'hotel' || style === 'deco' || style === 'stucco') && t.d > 8) {
        for (let f = 1; f < floors; f++) {
          if (!r.chance(0.42)) continue;
          const y = t.y0 + f * 3.2 + 0.1;
          const face = r.chance(0.5) ? 1 : -1;
          const bw = Math.min(3.2, t.w * 0.34), bd = 1.15;
          const bz = t.cz + face * (t.d / 2 + bd / 2);
          const bx = t.cx + (r.next() - 0.5) * (t.w - bw - 1.2);
          box(trim, bw, 0.14, bd, bx, y, bz);
          box(trim, bw, 0.8, 0.1, bx, y + 0.42, bz + face * (bd / 2 - 0.05));
          box(trim, 0.1, 0.8, bd, bx - bw / 2 + 0.05, y + 0.42, bz);
          box(trim, 0.1, 0.8, bd, bx + bw / 2 - 0.05, y + 0.42, bz);
        }
      }

      if (t.d > 6) {
        for (let f = 1; f < floors; f++) {
          if (!r.chance(0.24)) continue;
          const y = t.y0 + f * 3.2 + 1.1;
          const face = r.chance(0.5) ? 1 : -1;
          const ax = t.cx + (r.next() - 0.5) * (t.w - 2.4);
          const az = t.cz + face * (t.d / 2 + 0.22);
          box(metal, 0.86, 0.58, 0.44, ax, y, az);
        }
      }
    }

    // ---------- rooftop machinery ----------
    const topTier = tiers[tiers.length - 1];
    const th2 = 1.2 + r.next() * 1.6;
    box(metal, Math.min(4.2, topTier.w * 0.3), th2, Math.min(3.4, topTier.d * 0.3),
      topTier.cx + (r.next() - 0.5) * (topTier.w * 0.3), h + th2 / 2, topTier.cz + (r.next() - 0.5) * (topTier.d * 0.3));
    for (let k = 0; k < r.int(1, 4); k++) {
      const bw = 0.8 + r.next() * 1.8, bh = 0.5 + r.next() * 0.9, bd = 0.8 + r.next() * 1.6;
      box(metal, bw, bh, bd,
        topTier.cx + (r.next() - 0.5) * (topTier.w - bw - 1),
        h + bh / 2,
        topTier.cz + (r.next() - 0.5) * (topTier.d - bd - 1));
    }
    if (h > 26 && r.chance(0.45)) {
      const tank = new THREE.CylinderGeometry(1.25, 1.25, 2.5, 12);
      tank.translate(topTier.cx + (r.next() - 0.5) * (topTier.w - 3), h + 1.25, topTier.cz + (r.next() - 0.5) * (topTier.d - 3));
      metal.push(tank);
    }
    if (h > 40 && r.chance(0.55)) {
      const ant = new THREE.CylinderGeometry(0.08, 0.08, 8 + r.next() * 10, 5);
      ant.translate(topTier.cx, h + 6, topTier.cz);
      metal.push(ant);
    }
    // stair housing / lift penthouse so roofs read as built, not as bare slabs
    {
      const shW = Math.min(3.6, Math.max(2.2, topTier.w * 0.34));
      const shD = Math.min(3.2, Math.max(2.0, topTier.d * 0.34));
      const shH = 2.3 + r.next() * 1.0;
      const shX = topTier.cx + (r.next() - 0.5) * Math.max(0, topTier.w - shW - 1.4);
      const shZ = topTier.cz + (r.next() - 0.5) * Math.max(0, topTier.d - shD - 1.4);
      box(trim, shW, shH, shD, shX, h + shH / 2, shZ);
      box(trim, shW + 0.34, 0.16, shD + 0.34, shX, h + shH + 0.08, shZ);
      cbox(prop, 0x2a2c2f, 0.95, 2.0, 0.1, shX, h + 1.0, shZ + shD / 2 + 0.03);
    }
    // mushroom vents and a duct run
    for (let k = 0; k < 2; k++) {
      const vx = topTier.cx + (r.next() - 0.5) * Math.max(0.5, topTier.w - 2.4);
      const vz = topTier.cz + (r.next() - 0.5) * Math.max(0.5, topTier.d - 2.4);
      const vent = new THREE.CylinderGeometry(0.26, 0.26, 0.7, 6);
      vent.translate(vx, h + 0.35, vz); metal.push(vent);
      const cap = new THREE.CylinderGeometry(0.42, 0.36, 0.12, 6);
      cap.translate(vx, h + 0.76, vz); metal.push(cap);
    }
    if (r.chance(0.6)) {
      box(metal, 0.55, 0.5, 1.8 + r.next() * 1.4,
        topTier.cx + (r.next() - 0.5) * Math.max(0.5, topTier.w - 2.2), h + 0.4,
        topTier.cz + (r.next() - 0.5) * Math.max(0.5, topTier.d - 3.4));
    }

    // ---------- street level extras ----------
    if (h < 30) {
      // doorway for buildings without a shopfront
      if (!(tiers[0].d > 9 && tiers[0].w > 7)) {
        const dx = cx + (r.next() - 0.5) * Math.max(0, w * 0.4);
        cbox(prop, 0x3b2a1c, 1.7, 2.95, 0.16, dx, 1.48, z1 + 0.1);
        cbox(prop, 0x1b2226, 1.3, 2.6, 0.2, dx, 1.3, z1 + 0.18);
        cbox(prop, 0x8e8a80, 2.0, 0.16, 0.9, dx, 0.28, z1 + 0.55);
      }
      if (r.chance(0.65)) {
        const px2 = x0 + 1.5 + r.next() * Math.max(0.5, w - 3.2);
        cbox(prop, 0x8a4a32, 1.1, 0.55, 0.75, px2, 0.5, z1 + 0.9);
        const sh = new THREE.SphereGeometry(0.55, 8, 6);
        sh.scale(1, 0.8, 1); sh.translate(px2, 0.95, z1 + 0.9);
        applyTint(sh, 0x2f5c2a); prop.push(sh);
      }
      if (r.chance(0.5)) cyl(prop, 0x27403a, 0.32, 0.28, 0.95, 8, x1 - 1.2, 0.7, z1 + 0.85);
      if (r.chance(0.35)) {
        for (let k = 0; k < 2; k++) cyl(prop, 0x2a2d31, 0.09, 0.11, 0.95, 6, x0 + 0.9 + k * 0.7, 0.7, z1 + 1.15);
      }
    }

    // ---------- architectural dressing ----------
    this.dressGround(batches, groundSegs, {
      block, rect, uv, trimTint, style, rng: r, h, tiers, hasShop, tint
    });

    this.addCollider(x0, x1, z0, z1, h);
  }

  /* -------------------- architectural detail -------------------- */
  // A box oriented to a facade: rotate about Y, then place. Tint is written to
  // vertex colours, which the trim / prop / glass / awning materials multiply.
  // Real window openings. The painted grid still supplies the layout, but each
  // opening on the lowest two floors gets a proud frame, a dark reveal behind
  // it, a glazed pane that catches the sky, mullions, and a blind of its own
  // colour, so at 2-4 m the wall reads as pierced rather than wallpapered.
  dressWindowOpenings(batches, segs, o, primary, street) {
    const { uv, trimTint, rng } = o;
    const fam = FACADE_FAMILY[o.style] || 'stucco';
    if (fam === 'glass') return;
    const [wr, hr] = WINDOW_RATIO[fam] || WINDOW_RATIO.stucco;
    const BLINDS = [0xd9d3c4, 0xcfc7b4, 0x2b2c30, 0x4a5a48, 0x7a3a34, 0xb9b2a2, 0x3d4a5a];
    for (const seg of segs) {
      // Every face gets real openings now. Street faces get all of their floors
      // dressed (that is the wall you actually walk up to); courtyard and rear
      // faces get the lower three so the cost stays bounded.
      const onStreet = !!street[seg.face];
      const nx = Math.sin(seg.rotY), nz = Math.cos(seg.rotY);
      const dirX = Math.cos(seg.rotY), dirZ = -Math.sin(seg.rotY);
      const wins = this.windowGrid(seg.w, seg.h, uv, seg.uShift, seg.vShift, wr, hr);
      this.facadeCounts.windows += wins.length;
      if (!wins.length) continue;
      const rows = [...new Set(wins.map((w) => Math.round(w.y * 100)))].sort((a, b) => a - b);
      const dressedRows = onStreet ? rows.slice(0, 6) : rows.slice(0, 3);
      for (const w of wins) {
        if (!dressedRows.includes(Math.round(w.y * 100))) continue;
        const cx = seg.x + dirX * (w.x + w.w / 2 - seg.w / 2);
        const cz = seg.z + dirZ * (w.x + w.w / 2 - seg.w / 2);
        const yb = seg.y0 + w.y;
        const fw = 0.1, fd = 0.11;
        // Full window frames only where they read: the floors you can stand next
        // to. Above 14 m the frame bars cost triangles and disappear into the
        // facade at any distance, so upper floors keep just the glazing (and the
        // sill/lintel below). This is the facade LOD that keeps the trim batch
        // out of the frame budget without flattening the street.
        if (yb < 9) {
          // dark reveal just proud of the wall, so the opening has a shadowed body
          this.addBox(batches.trimBatch, 0x14161a, w.w - 0.02, w.h - 0.02, 0.03,
            cx + nx * 0.015, yb + w.h / 2, cz + nz * 0.015, seg.rotY);
          // frame: four bars standing 0.11 proud of the wall
          this.addBox(batches.trimBatch, trimTint, w.w + 2 * fw, fw, fd,
            cx + nx * 0.055, yb + w.h + fw / 2, cz + nz * 0.055, seg.rotY);
          this.addBox(batches.trimBatch, trimTint, w.w + 2 * fw, fw, fd,
            cx + nx * 0.055, yb - fw / 2, cz + nz * 0.055, seg.rotY);
          for (const sgn of [-1, 1]) {
            this.addBox(batches.trimBatch, trimTint, fw, w.h, fd,
              cx + dirX * sgn * (w.w / 2 + fw / 2) + nx * 0.055,
              yb + w.h / 2,
              cz + dirZ * sgn * (w.w / 2 + fw / 2) + nz * 0.055, seg.rotY);
          }
        }
        // sill and lintel: ledges that stand proud of the wall, so the opening
        // has a lit top edge and a shadow line underneath at arm's length.
        // Only on the floors you can actually stand next to; above ~14 m the
        // extra boxes cost triangles and never read at that distance.
        if (yb < 7) {
          this.addBox(batches.trimBatch, trimTint, w.w + 0.24, 0.07, 0.17,
            cx + nx * 0.075, yb - 0.075, cz + nz * 0.075, seg.rotY);
          this.addBox(batches.trimBatch, trimTint, w.w + 0.3, 0.09, 0.13,
            cx + nx * 0.06, yb + w.h + 0.075, cz + nz * 0.06, seg.rotY);
        }
        // glazing sits behind the frame's outer face: that gap is the recess
        const pane = new THREE.PlaneGeometry(w.w - 0.03, w.h - 0.03);
        pane.rotateY(seg.rotY);
        pane.translate(cx + nx * 0.085, yb + w.h / 2, cz + nz * 0.085);
        batches.glazeBatch.push(pane);
        // per-window interior: a blind or curtain over part of the glass
        if (rng.chance(0.62)) {
          const drop = 0.28 + rng.next() * 0.45;
          const bl = new THREE.PlaneGeometry(w.w - 0.06, w.h * drop);
          bl.rotateY(seg.rotY);
          bl.translate(cx + nx * 0.09, yb + w.h - (w.h * drop) / 2, cz + nz * 0.09);
          applyTint(bl, rng.pick(BLINDS));
          batches.propBatch.push(bl);
        }
        // mullions: one upright, one transom
        if (w.w > 0.95) {
          this.addBox(batches.propBatch, 0x24272b, 0.045, w.h - 0.02, 0.03,
            cx + nx * 0.088, yb + w.h / 2, cz + nz * 0.088, seg.rotY);
          this.addBox(batches.propBatch, 0x24272b, w.w - 0.04, 0.045, 0.03,
            cx + nx * 0.088, yb + w.h * 0.62, cz + nz * 0.088, seg.rotY);
        }
      }
      // wall-mounted AC boxes and a meter, on the primary face only
      if (seg.face === primary && seg.w > 4 && !o.hasShop) {
        const nAC = rng.int(1, 2);
        for (let k = 0; k < nAC; k++) {
          const t = rng.next() * 0.8 + 0.1;
          const ax = seg.x + dirX * (t - 0.5) * seg.w, az = seg.z + dirZ * (t - 0.5) * seg.w;
          const ay = seg.y0 + 2.9 + rng.next() * 1.6;
          this.addBox(batches.metalBatch, null, 0.78, 0.52, 0.3,
            ax + nx * 0.16, ay, az + nz * 0.16, seg.rotY);
          const grill = new THREE.PlaneGeometry(0.6, 0.36);
          grill.rotateY(seg.rotY);
          grill.translate(ax + nx * 0.38, ay, az + nz * 0.38);
          applyTint(grill, 0x33383d);
          batches.propBatch.push(grill);
        }
        this.addBox(batches.metalBatch, null, 0.26, 0.34, 0.16,
          seg.x + nx * 0.14, seg.y0 + 1.35, seg.z + nz * 0.14, seg.rotY);
      }
    }
  }

  // Rooftop plant: water tanks on legs, AC plant with fan discs, vent stacks and
  // a stair bulkhead, so a roof-level shot and the skyline silhouette have
  // structure instead of a bare slab.
  roofClutter(batches, t, rng, style, isGlass, ti) {
    if (isGlass) return;
    const area = t.w * t.d;
    if (area < 26) return;
    const inset = 1.1;
    const place = () => ({
      x: t.cx + (rng.next() - 0.5) * Math.max(0.5, t.w - inset * 2),
      z: t.cz + (rng.next() - 0.5) * Math.max(0.5, t.d - inset * 2)
    });
    const metal = batches.metalBatch, trim = batches.trimBatch, prop = batches.propBatch;
    // stair bulkhead, once per roof, off to one side
    if (area > 40) {
      const bx = t.cx + (rng.chance(0.5) ? -1 : 1) * (t.w / 2 - 2.1);
      const bz = t.cz + (rng.chance(0.5) ? -1 : 1) * (t.d / 2 - 2.1);
      this.addBox(trim, 0x9c8f7a, 2.0, 2.3, 2.0, bx, t.y1 + 1.15, bz, 0);
      this.addBox(trim, 0x4a4038, 2.2, 0.14, 2.2, bx, t.y1 + 2.36, bz, 0);
      const door = new THREE.PlaneGeometry(0.9, 1.9);
      door.translate(bx, t.y1 + 0.95, bz + 1.01);
      applyTint(door, 0x2a2c30);
      prop.push(door);
    }
    // water tank on four legs
    if (area > 40) {
      const p = place();
      const r = 0.75 + rng.next() * 0.35, hgt = 1.5 + rng.next() * 0.7;
      const tank = new THREE.CylinderGeometry(r, r, hgt, 12);
      tank.translate(p.x, t.y1 + 0.7 + hgt / 2, p.z);
      applyTint(tank, rng.pick([0x7a4a34, 0x4f5a52, 0x6b5a42]));
      metal.push(tank);
      const cap = new THREE.ConeGeometry(r + 0.04, 0.34, 12);
      cap.translate(p.x, t.y1 + 0.7 + hgt + 0.17, p.z);
      applyTint(cap, 0x33302b);
      metal.push(cap);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        this.addBox(metal, null, 0.09, 0.72, 0.09,
          p.x + sx * r * 0.55, t.y1 + 0.36, p.z + sz * r * 0.55, 0);
      }
    }
    // AC plant: condenser boxes with fan faces. Big roofs get physically bigger
    // units (not more of them) so the plant still reads from a distance without
    // adding geometry to a frame that is already at the vertex ceiling.
    const nAC = rng.int(2, 5);
    const uScale = clamp(Math.sqrt(area) / 20, 1, 2.1);
    for (let i = 0; i < nAC; i++) {
      const p = place();
      this.addBox(metal, 0x7d848a, 1.15 * uScale, 0.85 * uScale, 1.35 * uScale,
        p.x, t.y1 + 0.43 * uScale, p.z, 0);
      const fan = new THREE.CircleGeometry(0.34 * uScale, 14);
      fan.translate(p.x, t.y1 + 0.5 * uScale, p.z + 0.69 * uScale);
      applyTint(fan, 0x2c3034);
      prop.push(fan);
      const rim = new THREE.CylinderGeometry(0.36 * uScale, 0.36 * uScale, 0.05, 14);
      rim.rotateX(Math.PI / 2);
      rim.translate(p.x, t.y1 + 0.5 * uScale, p.z + 0.7 * uScale);
      applyTint(rim, 0x6e747a);
      metal.push(rim);
    }
    // vent stacks
    const nV = rng.int(2, 5);
    for (let i = 0; i < nV; i++) {
      const p = place();
      const vh = 0.5 + rng.next() * 0.7;
      const v = new THREE.CylinderGeometry(0.09, 0.1, vh, 8);
      v.translate(p.x, t.y1 + vh / 2, p.z);
      applyTint(v, 0x4a4e52);
      metal.push(v);
      const cap = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 8);
      cap.translate(p.x, t.y1 + vh + 0.03, p.z);
      applyTint(cap, 0x5c6064);
      metal.push(cap);
    }
  }

  addBox(arr, tint, sx, sy, sz, px, py, pz, rotY = 0) {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    if (rotY) b.rotateY(rotY);
    b.translate(px, py, pz);
    if (tint !== null && tint !== undefined) applyTint(b, tint);
    arr.push(b);
    return b;
  }

  // Sloped fabric canopy with a valance and two arms. The awning batch was
  // allocated but never filled, so this costs exactly one draw call.
  addAwning(arr, x, y, z, w, rotY, color) {
    this.facadeCounts.awnings++;
    const ad = 1.25;
    const nx = Math.sin(rotY), nz = Math.cos(rotY);
    const dirX = Math.cos(rotY), dirZ = -Math.sin(rotY);
    const g = new THREE.BoxGeometry(w, 0.05, ad);
    g.rotateX(0.36);
    if (rotY) g.rotateY(rotY);
    g.translate(x + nx * ad * 0.46, y - 0.04, z + nz * ad * 0.46);
    applyTint(g, color);
    arr.push(g);
    const v = new THREE.BoxGeometry(w, 0.32, 0.05);
    if (rotY) v.rotateY(rotY);
    v.translate(x + nx * ad * 0.94, y - 0.3, z + nz * ad * 0.94);
    applyTint(v, color);
    arr.push(v);
    for (const s of [-1, 1]) {
      const a = new THREE.BoxGeometry(0.05, 0.05, ad * 0.92);
      if (rotY) a.rotateY(rotY);
      a.translate(x + dirX * s * (w / 2 - 0.14) + nx * ad * 0.44, y - 0.02,
        z + dirZ * s * (w / 2 - 0.14) + nz * ad * 0.44);
      applyTint(a, 0x6a6a6a);
      arr.push(a);
    }
  }

  // One cell of the shared sign atlas as a plane facing rotY.
  addSignQuad(batches, cell, w, h, x, y, z, rotY) {
    const atlas = TEX.getSignAtlas();
    const cu = 1 / atlas.cols, cv = 1 / atlas.rows;
    const u0 = (cell % atlas.cols) * cu;
    const v0 = 1 - (Math.floor(cell / atlas.cols) + 1) * cv;
    const q = new THREE.PlaneGeometry(w, h);
    const qa = q.attributes.uv;
    for (let i = 0; i < qa.count; i++) qa.setXY(i, u0 + qa.getX(i) * cu, v0 + qa.getY(i) * cv);
    if (rotY) q.rotateY(rotY);
    q.translate(x, y, z);
    batches.signQuads.push(q);
    if (batches.glowQuads) {
      const gl = new THREE.PlaneGeometry(w * 2.3, h * 2.8);
      if (rotY) gl.rotateY(rotY);
      const nx = Math.sin(rotY || 0), nz = Math.cos(rotY || 0);
      gl.translate(x + nx * 0.1, y, z + nz * 0.1);
      batches.glowQuads.push(gl);
    }
    this.facadeCounts.signs++;
  }

  // Vertical sign projecting square off a facade, readable down the street.
  addBladeSign(batches, x, y, z, w, h, rng, rotY = 0) {
    const atlas = TEX.getSignAtlas();
    const cell = rng.int(0, atlas.cols * atlas.rows - 1);
    // the two faces sit just proud of the board, or the board hides them
    const dx = Math.cos(rotY) * 0.045, dz = -Math.sin(rotY) * 0.045;
    this.addSignQuad(batches, cell, w, h, x + dx, y, z + dz, rotY + Math.PI / 2);
    this.addSignQuad(batches, cell, w, h, x - dx, y, z - dz, rotY - Math.PI / 2);
    this.addBox(batches.propBatch, 0x17181b, 0.07, h + 0.1, w + 0.1, x, y, z, rotY);
    this.addBox(batches.metalBatch, null, 0.07, 0.07, 0.7, x, y + h / 2, z, rotY);
  }

  // Painted window grid of a wall segment, in segment-local metres. Derived
  // from the wallGeo UV mapping so geometry lands on the painted openings.
  windowGrid(w, h, uv, uShift, vShift, wr, hr) {
    const ww = (wr * 4) / uv.us, wh = (hr * 3) / uv.vs;
    const px = 4 / uv.us, py = 3 / uv.vs;
    let sx = 24 * ((((1 - wr) / 2) / 6 - uv.uo) / uv.us) - uShift;
    sx -= Math.floor(sx / px) * px;
    let sy = 24 * (((1 - (1 + hr) / 2 / 8) - uv.vo) / uv.vs) - vShift;
    sy -= Math.floor(sy / py) * py;
    const out = [];
    for (let y = sy, f = 0; y + wh <= h + 0.01 && f < 6; y += py, f++) {
      for (let x = sx; x + ww <= w + 0.01; x += px) out.push({ x, y, w: ww, h: wh });
    }
    return out;
  }

  // Steel fire escape: landings with rails, a stair flight between floors and a
  // drop ladder. Sits proud of the facade on the street side.
  addFireEscape(batches, seg, y0, levels) {
    const nx = Math.sin(seg.rotY), nz = Math.cos(seg.rotY);
    const dirX = Math.cos(seg.rotY), dirZ = -Math.sin(seg.rotY);
    const pw = Math.min(3.4, seg.w * 0.45), out = 0.72;
    for (let k = 0; k < levels; k++) {
      const y = y0 + k * 3.0;
      const bx = seg.x + nx * (out + 0.5), bz = seg.z + nz * (out + 0.5);
      this.addBox(batches.metalBatch, null, pw, 0.08, 1.05, bx, y, bz, seg.rotY);
      this.addBox(batches.metalBatch, null, pw, 0.05, 0.05, bx + nx * 0.5, y + 0.98, bz + nz * 0.5, seg.rotY);
      this.addBox(batches.metalBatch, null, pw, 0.05, 0.05, bx + nx * 0.5, y + 0.52, bz + nz * 0.5, seg.rotY);
      for (const s of [-1, 1]) {
        this.addBox(batches.metalBatch, null, 0.05, 1.0, 0.05,
          bx + dirX * s * (pw / 2 - 0.06) + nx * 0.5, y + 0.5,
          bz + dirZ * s * (pw / 2 - 0.06) + nz * 0.5, seg.rotY);
      }
      if (k > 0) {
        const st = new THREE.BoxGeometry(0.85, 0.06, 2.9);
        st.rotateX(0.66);
        if (seg.rotY) st.rotateY(seg.rotY);
        st.translate(bx + dirX * (pw / 2 - 0.5) + nx * 0.2, y - 1.5, bz + dirZ * (pw / 2 - 0.5) + nz * 0.2);
        batches.metalBatch.push(st);
      }
    }
    this.addBox(batches.metalBatch, null, 0.06, 2.7, 0.46,
      seg.x + nx * 0.5 + dirX * (pw / 2 - 0.5), y0 - 1.35,
      seg.z + nz * 0.5 + dirZ * (pw / 2 - 0.5), seg.rotY);
  }

  // Ground-level dressing: plinth, window reveals on the painted grid, awnings,
  // blade signs and fire escapes on whichever face looks onto a street.
  dressGround(batches, segs, o) {
    if (!segs || !segs.length) return;
    const { block, rect, uv, trimTint, style, rng, h, hasShop } = o;
    const fam = FACADE_FAMILY[style] || 'stucco';
    const [wr, hr] = WINDOW_RATIO[fam] || WINDOW_RATIO.stucco;
    const near = (v, edge) => Math.abs(v - edge) < 7.5;
    const street = block ? {
      front: near(rect.z1, block.z1 - CFG.SIDEWALK),
      back: near(rect.z0, block.z0 + CFG.SIDEWALK),
      right: near(rect.x1, block.x1 - CFG.SIDEWALK),
      left: near(rect.x0, block.x0 + CFG.SIDEWALK)
    } : { front: true, back: true, right: true, left: true };
    const primary = ['front', 'back', 'right', 'left'].find((f) => street[f]) || null;
    if (!primary) return;

    // stone plinth course, kept clear of the shop opening
    for (const seg of segs) {
      if (!street[seg.face] || seg.y0 > 0.5) continue;
      const nx = Math.sin(seg.rotY), nz = Math.cos(seg.rotY);
      const dirX = Math.cos(seg.rotY), dirZ = -Math.sin(seg.rotY);
      if (seg.face === 'front' && hasShop) {
        for (const s of [-1, 1]) {
          this.addBox(batches.trimBatch, trimTint, 0.9, 0.62, 0.2,
            seg.x + dirX * s * (seg.w / 2 - 0.45) + nx * 0.07, seg.y0 + 0.33,
            seg.z + dirZ * s * (seg.w / 2 - 0.45) + nz * 0.07, seg.rotY);
        }
      } else {
        this.addBox(batches.trimBatch, trimTint, seg.w, 0.62, 0.2,
          seg.x + nx * 0.07, seg.y0 + 0.33, seg.z + nz * 0.07, seg.rotY);
      }
    }

    // recessed window reveals: sills and lintels on the lowest two painted
    // rows, jambs on the lowest row so the opening reads as cut into the wall
    if (fam !== 'glass') {
      for (const seg of segs) {
        if (!street[seg.face]) continue;
        const nx = Math.sin(seg.rotY), nz = Math.cos(seg.rotY);
        const dirX = Math.cos(seg.rotY), dirZ = -Math.sin(seg.rotY);
        const wins = this.windowGrid(seg.w, seg.h, uv, seg.uShift, seg.vShift, wr, hr);
        if (!wins.length) continue;
        const rows = [...new Set(wins.map((w) => Math.round(w.y * 100)))].sort((a, b) => a - b).slice(0, 2);
        const isPrimary = seg.face === primary;
        for (const w of wins) {
          if (!rows.includes(Math.round(w.y * 100))) continue;
          const cx2 = seg.x + dirX * (w.x + w.w / 2 - seg.w / 2);
          const cz2 = seg.z + dirZ * (w.x + w.w / 2 - seg.w / 2);
          const yb = seg.y0 + w.y;
          this.addBox(batches.trimBatch, trimTint, w.w + 0.36, 0.11, 0.32,
            cx2 + nx * 0.1, yb - 0.03, cz2 + nz * 0.1, seg.rotY);
          if (isPrimary && Math.round(w.y * 100) === rows[0]) {
            for (const s of [-1, 1]) {
              this.addBox(batches.trimBatch, trimTint, 0.16, w.h + 0.26, 0.24,
                cx2 + dirX * s * (w.w / 2 + 0.08) + nx * 0.08, yb + w.h / 2,
                cz2 + dirZ * s * (w.w / 2 + 0.08) + nz * 0.08, seg.rotY);
            }
          }
        }
      }
    }

    this.dressWindowOpenings(batches, segs, o, primary, street);

    // canopy, blade sign and fire escape on the widest street face
    const wide = segs.filter((s) => s.face === primary).sort((a, b) => b.w - a.w)[0];
    if (!wide) return;
    const nx = Math.sin(wide.rotY), nz = Math.cos(wide.rotY);
    const dirX = Math.cos(wide.rotY), dirZ = -Math.sin(wide.rotY);
    if (!hasShop && h < 30 && wide.w > 5 && rng.chance(0.62)) {
      this.addAwning(batches.awningBatch,
        wide.x + dirX * (rng.next() - 0.5) * (wide.w * 0.4), 3.35, wide.z + nz * 0.12,
        Math.min(4.6, wide.w * 0.55), wide.rotY, rng.pick(AWNING_COLORS));
    }
    if (wide.w > 6 && rng.chance(0.5)) {
      this.addBladeSign(batches,
        wide.x + dirX * (wide.w / 2 - 0.7), 4.6 + rng.next() * 1.6,
        wide.z + nz * 0.55, 0.8, 2.0, rng, wide.rotY);
    }
    if (h >= 9 && wide.w > 5 && rng.chance(fam === 'masonry' ? 0.5 : 0.2)) {
      const levels = Math.min(3, Math.max(1, Math.floor((h - 4.5) / 3)));
      this.addFireEscape(batches, wide, 4.3, levels);
    }
  }

  /* -------------------- street furniture around every block -------------------- */
  // One InstancedMesh per part of the downloaded lamp model: 800 posts cost
  // three draw calls instead of 2400.
  spawnLamps() {
    // Lamp posts are drawn as one always-visible instanced batch, so their
    // triangle cost is constant in every frame. 360 (down from 400) keeps the
    // worst storm view under the 4.85M triangle budget with traffic variance.
    if (this.lampSpots.length > 360) this.lampSpots.length = 360;
    const entry = MODELS.props.find((p) => p.id === 'lantern');
    if (!entry || !this.lampSpots.length) return;
    const proto = instanceProp(entry, { height: 4.4 }).root;
    proto.updateMatrixWorld(true);
    const parts = [];
    proto.traverse((o) => { if (o.isMesh) parts.push(o); });
    const holder = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, this.lampSpots.length);
      inst.castShadow = false;
      inst.receiveShadow = false;
      this.lampSpots.forEach((s, i) => {
        holder.makeRotationY(s.yaw).setPosition(s.x, 0.24, s.z);
        m.multiplyMatrices(holder, part.matrixWorld);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
    }
    this.lampCount = this.lampSpots.length;
  }

  // Fade the street-lamp ground pools with the day/night cycle. The heads are
  // flagged in lampPoolHeads and stay solid; only the pool vertices change.
  setLampNight(night) {
    const k = Math.max(0, Math.min(1, (night - 0.18) / 0.5));
    const e = k * k * (3 - 2 * k);
    if (!this.lampPoolAttr || Math.abs(e - this.lampNight) < 0.01) return;
    this.lampNight = e;
    const arr = this.lampPoolAttr.array;
    const heads = this.lampPoolHeads;
    for (let i = 0; i < heads.length; i++) if (!heads[i]) arr[i * 4 + 3] = e;
    this.lampPoolAttr.needsUpdate = true;
  }

  // Instanced downloaded props, one InstancedMesh per part per kind.
  spawnProps() {
    const byKind = new Map();
    for (const s of this.propSpots) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, []);
      byKind.get(s.kind).push(s);
    }
    const holder = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    for (const [kind, spots] of byKind) {
      const entry = MODELS.props.find((p) => p.id === kind);
      if (!entry) continue;
      const proto = instanceProp(entry, { height: entry.height }).root;
      proto.updateMatrixWorld(true);
      const parts = [];
      proto.traverse((o) => { if (o.isMesh) parts.push(o); });
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
        inst.castShadow = false;
        inst.receiveShadow = true;
        spots.forEach((s, i) => {
          const sc = s.scale || 1;
          holder.makeRotationY(s.yaw);
          holder.scale(SCALE_TMP.set(sc, sc, sc));
          holder.setPosition(s.x, 0.24, s.z);
          m.multiplyMatrices(holder, part.matrixWorld);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        this.scene.add(inst);
      }
    }
    this.propModelCount = this.propSpots.length;
  }

  buildStreetFurniture(propBatch) {
    const rng = this.rng;
    const add = (geo, color) => { applyTint(geo, color); propBatch.push(geo); };
    for (const b of this.blocks) {
      // curb ring: dark granite edge that reads as a real kerb
      const cw = 0.28, chh = 0.12;
      const ring = [
        [b.x1 - b.x0, chh, cw, (b.x0 + b.x1) / 2, 0.27, b.z0 + cw / 2],
        [b.x1 - b.x0, chh, cw, (b.x0 + b.x1) / 2, 0.27, b.z1 - cw / 2],
        [cw, chh, b.z1 - b.z0, b.x0 + cw / 2, 0.27, (b.z0 + b.z1) / 2],
        [cw, chh, b.z1 - b.z0, b.x1 - cw / 2, 0.27, (b.z0 + b.z1) / 2]
      ];
      for (const [sx, sy, sz, px, py, pz] of ring) {
        const g = new THREE.BoxGeometry(sx, sy, sz);
        g.translate(px, py, pz);
        add(g, 0x6f6b63);
      }

      const inset = CFG.SIDEWALK + 1.5;
      const lx0 = b.x0 + inset, lx1 = b.x1 - inset, lz0 = b.z0 + inset, lz1 = b.z1 - inset;
      if (lx1 - lx0 < 4 || lz1 - lz0 < 4) continue;
      const edges = [
        [lx0, lz0 - 1.2, lx1, lz0 - 1.2],
        [lx0, lz1 + 1.2, lx1, lz1 + 1.2],
        [lx0 - 1.2, lz0, lx0 - 1.2, lz1],
        [lx1 + 1.2, lz0, lx1 + 1.2, lz1]
      ];
      for (const [ax, az, bx, bz] of edges) {
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        const n = Math.max(1, Math.min(3, Math.floor(len / 18)));
        // face the street: outward normal from the block centre
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        const mx = ax + dx / 2 - cx, mz = az + dz / 2 - cz;
        const nlen = Math.hypot(mx, mz) || 1;
        const inx = -mx / nlen, inz = -mz / nlen;   // inward, toward the building
        const faceYaw = Math.atan2(mx, mz);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          this.addStreetProp(propBatch, ax + dx * t, az + dz * t, rng, faceYaw);
        }
        // real street trees, set back from the kerb behind the furniture
        if (MODELS.props.some((p) => p.id === 'tree')) {
          const trees = Math.max(1, Math.floor(len / 130));
          for (let k = 0; k < trees; k++) {
            const t = (k + 0.5) / trees;
            this.propSpots.push({
              kind: k % 2 ? 'tree' : 'pine',
              x: ax + dx * t + inx * 1.9,
              z: az + dz * t + inz * 1.9,
              yaw: rng.next() * Math.PI * 2,
              scale: 0.8 + rng.next() * 0.45
            });
          }
        }
        // real lamp posts from the downloaded model, along the same kerb line
        const lamps = Math.max(1, Math.floor(len / 120));
        const yaw = Math.atan2(dx, dz);
        for (let k = 0; k < lamps; k++) {
          const t = (k + 0.5) / lamps;
          this.lampSpots.push({ x: ax + dx * t + inx * 0.55, z: az + dz * t + inz * 0.55, yaw });
        }
      }
    }
  }

  addStreetProp(batch, x, z, rng, yaw = 0) {
    const add = (geo, color) => { applyTint(geo, color); batch.push(geo); };
    const kind = rng.int(0, 5);
    // downloaded models for the street furniture; the coded builder below is
    // the fallback when an asset is missing (kind 3 mailbox and kind 5 bollards
    // have no licence-clean model yet — see PLAY-WINDOWS.md)
    const modelId = ['hydrant', 'bin', 'bench', 'mailbox', 'planter', 'bollard'][kind];
    if (modelId && MODELS.props.some((p) => p.id === modelId)) {
      this.propSpots.push({ kind: modelId, x, z, yaw });
      return;
    }
    if (kind === 0) {
      const body = new THREE.CylinderGeometry(0.15, 0.17, 0.72, 8); body.translate(x, 0.55, z); add(body, 0xb22a22);
      const cap = new THREE.SphereGeometry(0.16, 8, 6); cap.translate(x, 0.92, z); add(cap, 0xb22a22);
      for (const sgn of [-1, 1]) {
        const nub = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6);
        nub.rotateZ(Math.PI / 2); nub.translate(x + sgn * 0.18, 0.62, z); add(nub, 0x8e2019);
      }
    } else if (kind === 1) {
      const b = new THREE.CylinderGeometry(0.33, 0.29, 0.95, 8); b.translate(x, 0.7, z); add(b, 0x2c4a3e);
      const rim = new THREE.CylinderGeometry(0.35, 0.35, 0.07, 8); rim.translate(x, 1.19, z); add(rim, 0x1d322a);
    } else if (kind === 2) {
      const seat = new THREE.BoxGeometry(1.7, 0.09, 0.48); seat.translate(x, 0.62, z); add(seat, 0x6b4a2e);
      const back = new THREE.BoxGeometry(1.7, 0.42, 0.08); back.translate(x, 0.9, z - 0.2); add(back, 0x6b4a2e);
      for (const sgn of [-1, 1]) {
        const leg = new THREE.BoxGeometry(0.08, 0.6, 0.42); leg.translate(x + sgn * 0.7, 0.3, z); add(leg, 0x2b2d30);
      }
    } else if (kind === 3) {
      const b = new THREE.BoxGeometry(0.72, 1.15, 0.42); b.translate(x, 0.8, z); add(b, 0x6f7477);
      const dr = new THREE.BoxGeometry(0.5, 0.8, 0.02); dr.translate(x, 0.8, z + 0.22); add(dr, 0x5c6164);
    } else if (kind === 4) {
      const p = new THREE.BoxGeometry(1.1, 0.5, 1.1); p.translate(x, 0.47, z); add(p, 0x7d5238);
      const sp = new THREE.SphereGeometry(0.62, 8, 6); sp.scale(1, 0.85, 1); sp.translate(x, 0.95, z); add(sp, 0x2f5c2a);
    } else {
      for (let k = 0; k < 3; k++) {
        const b = new THREE.CylinderGeometry(0.09, 0.1, 0.95, 6);
        b.translate(x + (k - 1) * 0.55, 0.6, z); add(b, 0x2a2d31);
      }
    }
  }

  buildPark(lot) {
    const grass = TEX.getGrass();
    grass.repeat.set(1, 1);
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 10), uv.getY(i) * (d / 10));
    g.rotateX(-Math.PI / 2);
    g.translate((lot.x0 + lot.x1) / 2, 0.24, (lot.z0 + lot.z1) / 2);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: grass, roughness: 1, color: new THREE.Color(0.74, 0.8, 0.64)
    }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // paths
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.9 });
    const p1 = new THREE.PlaneGeometry(w, 4);
    p1.rotateX(-Math.PI / 2);
    p1.translate((lot.x0 + lot.x1) / 2, 0.25, (lot.z0 + lot.z1) / 2);
    const pm = new THREE.Mesh(p1, pathMat);
    pm.receiveShadow = true;
    this.scene.add(pm);

    // trees & benches
    const hasTrees = MODELS.props.some((p) => p.id === 'tree');
    for (let i = 0; i < 5; i++) {
      const x = lot.x0 + 4 + this.rng.next() * (w - 8);
      const z = lot.z0 + 4 + this.rng.next() * (d - 8);
      if (hasTrees) {
        this.propSpots.push({ kind: i % 3 === 0 ? 'pine' : 'tree', x, z,
          yaw: this.rng.next() * Math.PI * 2, scale: 0.85 + this.rng.next() * 0.5 });
      } else {
        this.addPalm(x, z, 0.24, 6 + this.rng.next() * 5);
      }
    }
    for (let i = 0; i < 4; i++) {
      const bg = new THREE.BoxGeometry(2.2, 0.12, 0.6);
      bg.translate(lot.x0 + 6 + this.rng.next() * (w - 12), 0.8, lot.z0 + 6 + this.rng.next() * (d - 12));
      const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 }));
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  /* ----------------------------- roads ----------------------------- */
  buildRoadMarkings() {
    const road = TEX.getRoad();
    const roadNormal = TEX.getRoadNormal();
    const mat = new THREE.MeshStandardMaterial({
      map: road, roughness: 0.82,
      roughnessMap: TEX.getRoadRoughness(),
      normalMap: roadNormal || null,
      normalScale: new THREE.Vector2(0.75, 0.75),
      polygonOffset: true, polygonOffsetFactor: -2
    });
    // asphalt is a dielectric: at dusk it should catch the pink sky instead of
    // falling to black the moment the sun leaves it
    mat.envMapIntensity = 1.2;
    this.roadMat = mat;
    const geos = [];
    const half = CFG.ROAD / 2;
    for (const x of this.roadsX) {
      for (let j = 0; j < CFG.GRID; j++) {
        const z0 = this.roadsZ[j] + half;
        const z1 = this.roadsZ[j + 1] - half;
        const len = z1 - z0;
        const g = new THREE.PlaneGeometry(CFG.ROAD, len);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), uv.getY(k) * (len / 12));
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.012, (z0 + z1) / 2);
        geos.push(g);
      }
    }
    for (const z of this.roadsZ) {
      for (let i = 0; i < CFG.GRID; i++) {
        const x0 = this.roadsX[i] + half;
        const x1 = this.roadsX[i + 1] - half;
        const len = x1 - x0;
        const g = new THREE.PlaneGeometry(len, CFG.ROAD);
        const uv = g.attributes.uv;
        // The road tile is 20 m across by 12 m along: U must span the 20 m
        // width (0..1) and V the length in 12 m repeats. Swapping them here
        // rotated the lane markings 90 degrees and stretched them across the
        // carriageway, which is what read as "weird stripes".
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k) * (len / 12));
        g.rotateX(-Math.PI / 2);
        g.translate((x0 + x1) / 2, 0.012, z);
        geos.push(g);
      }
    }
    const mesh = mergeList(geos, mat, { castShadow: false });
    if (mesh) this.scene.add(mesh);

    // crosswalks at every intersection approach
    const cw = TEX.getCrosswalk();
    const cwMat = new THREE.MeshBasicMaterial({ map: cw, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const cwGeos = [];
    for (const x of this.roadsX) {
      for (const z of this.roadsZ) {
        const off = half + 2.4;
        const specs = [
          [x, z - off, 0], [x, z + off, 0],
          [x - off, z, Math.PI / 2], [x + off, z, Math.PI / 2]
        ];
        for (const [px, pz, rot] of specs) {
          const g = new THREE.PlaneGeometry(CFG.ROAD - 2, 4.2);
          g.rotateX(-Math.PI / 2);
          g.rotateY(rot);
          g.translate(px, 0.03, pz);
          cwGeos.push(g);
        }
      }
    }
    const cwMesh = mergeList(cwGeos, cwMat, { castShadow: false, receiveShadow: false });
    if (cwMesh) this.scene.add(cwMesh);

    // Intersection pads hide the lane markings inside a junction. They carry the
    // same photographic asphalt as the ground, with UVs computed from world
    // position so the pad continues the surrounding tile instead of reading as
    // a flat grey rectangle under your feet.
    const padMat = this.groundMat.clone();
    padMat.polygonOffset = true;
    padMat.polygonOffsetFactor = -3;
    padMat.polygonOffsetUnits = -3;
    this.padMat = padMat;
    const GS = this.groundSize;
    const pads = [];
    for (const x of this.roadsX) {
      for (const z of this.roadsZ) {
        const g = new THREE.PlaneGeometry(CFG.ROAD, CFG.ROAD);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.018, z);
        const pos = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, 0.5 + pos.getX(i) / GS, 0.5 - pos.getZ(i) / GS);
        }
        uv.needsUpdate = true;
        pads.push(g);
      }
    }
    const padMesh = mergeList(pads, padMat, { castShadow: false });
    if (padMesh) this.scene.add(padMesh);
  }

  /* --------------------------- weather / fuel --------------------------- */
  // Wetness is driven by the weather system: the asphalt loses roughness and
  // gains a little metalness so the sky reflects in it during rain.
  setWetness(w) {
    this.wet = w;
    if (this.roadMat) {
      this.roadMat.roughness = 1.0 + (0.42 - 1.0) * w;
      this.roadMat.metalness = 0.16 * w;
    }
    if (this.padMat) this.padMat.roughness = 1.0 + (0.5 - 1.0) * w;
    if (this.groundMat) this.groundMat.roughness = 0.94 + (0.6 - 0.94) * w;
  }

  // Three roadside fuel stations: canopy, pumps and pillars merged into one
  // mesh, with the pump coordinates exposed for the refuel interaction.
  buildFuelStations() {
    const spots = [
      { x: this.roadsX[1] + 20, z: this.roadsZ[1] + 20 },
      { x: this.roadsX[3] - 20, z: this.roadsZ[2] - 20 },
      { x: this.roadsX[4] + 20, z: this.roadsZ[4] + 20 }
    ];
    const geos = [];
    for (const s of spots) {
      const y = this.getGroundHeight(s.x, s.z);
      const pump = new THREE.BoxGeometry(0.7, 1.5, 0.5);
      pump.translate(s.x, y + 0.75, s.z);
      geos.push(pump);
      const head = new THREE.BoxGeometry(0.78, 0.24, 0.58);
      head.translate(s.x, y + 1.55, s.z);
      geos.push(head);
      const canopy = new THREE.BoxGeometry(6.5, 0.18, 4.6);
      canopy.translate(s.x, y + 2.9, s.z);
      geos.push(canopy);
      for (const dx of [-2.4, 2.4]) {
        const post = new THREE.CylinderGeometry(0.09, 0.09, 2.9, 6);
        post.translate(s.x + dx, y + 1.45, s.z - 1.9);
        geos.push(post);
      }
      const sign = new THREE.BoxGeometry(0.16, 2.2, 0.16);
      sign.translate(s.x + 3.6, y + 1.1, s.z + 2.2);
      geos.push(sign);
    }
    // Share the ground material so the forecourt batches with the pavement
    // instead of costing its own draw call.
    const mesh = mergeList(geos, this.groundMat, { castShadow: false });
    if (mesh) this.scene.add(mesh);
    this.fuelStations = spots;
  }

  buildGraph() {
    const N = CFG.GRID + 1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        this.graph.push({
          x: this.roadsX[i], z: this.roadsZ[j], i, j,
          idx: j * N + i, links: []
        });
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const n = this.graph[j * N + i];
        if (i > 0) n.links.push({ node: j * N + (i - 1), dir: [-1, 0] });
        if (i < N - 1) n.links.push({ node: j * N + (i + 1), dir: [1, 0] });
        if (j > 0) n.links.push({ node: (j - 1) * N + i, dir: [0, -1] });
        if (j < N - 1) n.links.push({ node: (j + 1) * N + i, dir: [0, 1] });
      }
    }
    // traffic signals: one state per intersection
    for (const n of this.graph) {
      this.intersections.push({ x: n.x, z: n.z, ns: this.rng.chance(0.5), t: this.rng.range(6, 16) });
    }
    this.signalMesh = this.buildSignalGeometry();
  }

  buildSignalGeometry() {
    const N = CFG.GRID + 1;
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 6.2, 8);
    const armGeo = new THREE.BoxGeometry(4.2, 0.16, 0.16);
    const headGeo = new THREE.BoxGeometry(0.5, 1.25, 0.36);
    const geos = [];
    for (const n of this.graph) {
      // pole on the +x/+z corner, arm reaching over the road
      const px = n.x + CFG.ROAD / 2 + 1.2;
      const pz = n.z + CFG.ROAD / 2 + 1.2;
      const pole = poleGeo.clone(); pole.translate(px, 3.1, pz); geos.push(pole);
      const arm = armGeo.clone(); arm.translate(px - 2.1, 6.1, pz); geos.push(arm);
      const head = headGeo.clone(); head.translate(px - 4.0, 5.6, pz); geos.push(head);
    }
    poleGeo.dispose(); armGeo.dispose(); headGeo.dispose();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6, metalness: 0.4 });
    const mesh = mergeList(geos, mat, { receiveShadow: false });
    if (mesh) this.scene.add(mesh);

    // lamp instances (3 per intersection) coloured at runtime
    // Signal lamps are 1-3 px at street distance; 5x4 keeps the glow while
    // removing ~17k triangles from the strict swept budget.
    const lampGeo = new THREE.SphereGeometry(0.14, 5, 4);
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, N * N * 3);
    lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const n of this.graph) {
      const px = n.x + CFG.ROAD / 2 + 1.2 - 4.0;
      const pz = n.z + CFG.ROAD / 2 + 1.2;
      for (let l = 0; l < 3; l++) {
        m.makeTranslation(px, 5.98 - l * 0.38, pz + 0.2);
        lamps.setMatrixAt(k, m);
        lamps.setColorAt(k, new THREE.Color(0x111111));
        k++;
      }
    }
    lamps.instanceColor.needsUpdate = true;
    lamps.frustumCulled = false;
    this.scene.add(lamps);
    this.lampMesh = lamps;
    this.lampColors = new Float32Array(N * N * 3 * 3);
    return mesh;
  }

  updateSignals(dt) {
    let changed = this.signalsDirty === true;
    this.signalsDirty = false;
    for (let i = 0; i < this.intersections.length; i++) {
      const it = this.intersections[i];
      it.t -= dt;
      if (it.t <= 0) { it.ns = !it.ns; it.t = 14 + Math.random() * 6; changed = true; }
    }
    if (!changed) return;
    const c = new THREE.Color();
    let k = 0;
    for (const it of this.intersections) {
      const state = it.ns ? 0 : 2;
      for (let l = 0; l < 3; l++) {
        if (l === state) c.setHex(it.ns ? 0x33ff66 : 0xff2a2a);
        else c.setHex(0x141414);
        this.lampMesh.setColorAt(k++, c);
      }
    }
    this.lampMesh.instanceColor.needsUpdate = true;
  }

  isGreen(x, z, dirZ) {
    // find nearest intersection
    let best = null, bd = 1e9;
    for (const it of this.intersections) {
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    if (!best || bd > 40 * 40) return true;
    return dirZ ? best.ns : !best.ns;
  }

  /* ----------------------------- props ----------------------------- */
  buildProps() {
    const rng = this.rng;
    if (!this.palmData) this.palmData = [];

    // palms along beach + boulevards
    for (let i = 0; i < 150; i++) {
      const x = -WORLD_EDGE + 10 + rng.next() * (WORLD_EDGE * 2 - 20);
      this.addPalm(x, WORLD_EDGE + 4 + rng.next() * (CFG.BEACH - 8), 0.12, 7 + rng.next() * 7);
    }
    for (const x of this.roadsX) {
      for (let j = 0; j < CFG.GRID; j++) {
        if (!rng.chance(0.5)) continue;
        const z = this.roadsZ[j] + CFG.ROAD / 2 + 3.4;
        this.addPalm(x + CFG.ROAD / 2 + 2.2, z, 0.22, 6 + rng.next() * 6);
        this.addPalm(x + CFG.ROAD / 2 + 2.2, z + 30, 0.22, 6 + rng.next() * 6);
      }
    }

    // street lights along every road
    const poleGeos = [];
    const lampGeos = [];
    const poolGeos = [];
    const poleMaps = SURF.getChrome();
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x33383c, roughness: 1.0, metalness: 0.5,
      normalMap: poleMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: poleMaps.roughnessMap
    });
    for (const x of this.roadsX) {
      for (let j = 0; j < CFG.GRID; j++) {
        const z0 = this.roadsZ[j] + CFG.ROAD / 2;
        for (let t = 0; t < 2; t++) {
          const z = z0 + (t === 0 ? 18 : 52);
          const side = t === 0 ? 1 : -1;
          const px = x + side * (CFG.ROAD / 2 + 1.6);
          const pole = new THREE.CylinderGeometry(0.09, 0.13, 7.4, 7);
          pole.translate(px, 3.7, z);
          poleGeos.push(pole);
          const arm = new THREE.BoxGeometry(1.9, 0.1, 0.1);
          arm.translate(px - side * 0.95, 7.35, z);
          poleGeos.push(arm);
          const hx = px - side * 1.8;
          const head = new THREE.BoxGeometry(0.62, 0.16, 0.34);
          head.translate(hx, 7.24, z);
          // The head samples the opaque middle of the glow map so it stays a
          // solid warm block; the pool below samples the whole falloff.
          const huv = head.attributes.uv;
          for (let k = 0; k < huv.count; k++) huv.setXY(k, 0.5, 0.5);
          lampGeos.push(head);
          // Light pool on the road under the head. It shares the lamp batch,
          // so the whole city's pools cost no extra draw call.
          const pool = new THREE.CircleGeometry(6.2, 18);
          pool.rotateX(-Math.PI / 2);
          pool.translate(hx, 0.235, z);
          poolGeos.push(pool);
        }
      }
    }
    const poleMesh = mergeList(poleGeos, poleMat, { castShadow: false, receiveShadow: false });
    if (poleMesh) this.scene.add(poleMesh);
    const lampMat = new THREE.MeshBasicMaterial({
      map: TEX.getLampGlow(), color: 0xffe6b0, transparent: true,
      depthWrite: false, toneMapped: false, vertexColors: true
    });
    this.streetLampMat = lampMat;
    const lampMesh = mergeList(lampGeos.concat(poolGeos), lampMat, { castShadow: false, receiveShadow: false });
    if (lampMesh) {
      // One batch holds both the heads and their ground pools, but only the
      // pools should disappear by day: per-vertex alpha keeps the heads solid
      // and lets setLampNight fade the pools as the sun comes up.
      const geo = lampMesh.geometry;
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 4);
      const head = new Uint8Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const isHead = pos.getY(i) > 1;
        head[i] = isHead ? 1 : 0;
        col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1;
        col[i * 4 + 3] = isHead ? 1 : 0;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      this.lampPoolAttr = geo.attributes.color;
      this.lampPoolHeads = head;
      this.lampNight = -1;
      this.scene.add(lampMesh);
    }
    this.streetLampMesh = lampMesh;

    // Small street props (hydrants, bins, benches, cones, dumpsters...). These
    // used to be 260 identical boxes. They are now downloaded CC0 bodies baked
    // into ONE merged vertex-coloured mesh: the same single draw call, real
    // silhouettes and colour, and no new per-frame call. The mix is weighted
    // toward low-triangle props so the worst-case vertex budget stays flat.
    const SMALL_PROP_MIX = [
      ['bollard', 24], ['mailbox', 18], ['bench', 15], ['cone', 15],
      ['dumpster', 10], ['hydrant', 5], ['planter', 5], ['bin', 4]
    ];
    const SMALL_PROP_TOTAL = SMALL_PROP_MIX.reduce((n, x) => n + x[1], 0);
    const smallProto = new Map();
    const protoFor = (kind) => {
      if (smallProto.has(kind)) return smallProto.get(kind);
      const entry = MODELS.props.find((p) => p.id === kind);
      const geo = entry ? flattenModelGeometry(entry, { height: entry.height }) : null;
      smallProto.set(kind, geo);
      return geo;
    };
    const pickSmallKind = () => {
      let n = rng.next() * SMALL_PROP_TOTAL;
      for (const [kind, w] of SMALL_PROP_MIX) { n -= w; if (n <= 0) return kind; }
      return SMALL_PROP_MIX[0][0];
    };
    const smallGeos = [];
    for (let i = 0; i < 260; i++) {
      const b = this.blocks[Math.floor(rng.next() * this.blocks.length)];
      if (!b) break;
      const edge = Math.floor(rng.next() * 4);
      let x = b.x0 + 2, z = b.z0 + 2;
      if (edge === 0) { x = b.x0 + 2 + rng.next() * (b.x1 - b.x0 - 4); z = b.z0 + 1.4; }
      if (edge === 1) { x = b.x0 + 2 + rng.next() * (b.x1 - b.x0 - 4); z = b.z1 - 1.4; }
      if (edge === 2) { x = b.x0 + 1.4; z = b.z0 + 2 + rng.next() * (b.z1 - b.z0 - 4); }
      if (edge === 3) { x = b.x1 - 1.4; z = b.z0 + 2 + rng.next() * (b.z1 - b.z0 - 4); }
      const kind = pickSmallKind();
      let g = protoFor(kind);
      if (g) g = g.clone();
      else { g = new THREE.BoxGeometry(0.45, 0.95, 0.45); applyTint(g, new THREE.Color().setHSL(rng.next(), 0.35, 0.35)); }
      const sc = 0.82 + rng.next() * 0.34;
      g.rotateY(rng.next() * TAU);
      g.scale(sc, sc, sc);
      g.translate(x, 0.24, z);
      smallGeos.push(g);
    }
    const smallCount = smallGeos.length;
    const smallMaps = SURF.getPropPaint();
    const smallMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.1,
      map: smallMaps.map,
      normalMap: smallMaps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: smallMaps.roughnessMap
    });
    const smallMesh = mergeList(smallGeos, smallMat);
    if (smallMesh) {
      this.scene.add(smallMesh);
      this.smallPropMesh = smallMesh;
      this.smallPropCount = smallCount;
    }

    // billboards along the highway edges
    const billboardFrame = [];
    for (let i = 0; i < 10; i++) {
      const x = -WORLD_EDGE + 60 + rng.next() * (WORLD_EDGE * 2 - 120);
      const z = WORLD_EDGE + 16 + rng.next() * 26;
      const w = 12, h = 6;
      const tex = TEX.getBillboard(i % 6);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(x, 10, z);
      mesh.rotation.y = Math.PI;
      this.scene.add(mesh);
      const post = new THREE.BoxGeometry(0.35, 8, 0.35);
      post.translate(x - 4, 4, z + 0.2); billboardFrame.push(post);
      const post2 = post.clone(); post2.translate(8, 0, 0); billboardFrame.push(post2);
      this.signMeshes.push(mesh);
    }
    const bf = mergeList(billboardFrame, poleMat, { castShadow: false });
    if (bf) this.scene.add(bf);

    // pier
    this.buildPier();
  }

  addPalm(x, z, y, height) {
    this.palmData.push({ x, y, z, height, rot: this.rng.next() * TAU, lean: (this.rng.next() - 0.5) * 0.16 });
  }

  buildPier() {
    const zBase = WORLD_EDGE + CFG.BEACH - 6;
    const len = 110;
    // The deck and the moored watercraft are one merged mesh. The boats replace
    // empty water without adding a per-frame draw call.
    const deckGeos = [];
    const deckGeo = new THREE.BoxGeometry(9, 0.4, len);
    deckGeo.translate(-90, 1.9, zBase + len / 2);
    applyTint(deckGeo, 0x7a5c3c);
    deckGeos.push(deckGeo);
    const boatEntry = MODELS.props.find((p) => p.id === 'boat');
    if (boatEntry) {
      const proto = flattenModelGeometry(boatEntry, { length: 5.2 });
      if (proto) {
        const moorings = [
          { x: -101.5, z: zBase + 30, yaw: Math.PI / 2 + 0.08 },
          { x: -78.5, z: zBase + 54, yaw: -Math.PI / 2 - 0.06 },
          { x: -103.5, z: zBase + 84, yaw: Math.PI / 2 - 0.12 }
        ];
        for (const b of moorings) {
          const g = proto.clone();
          g.rotateY(b.yaw);
          g.translate(b.x, -0.45, b.z);
          deckGeos.push(g);
        }
        proto.dispose();
        this.boatCount = moorings.length;
      }
    }
    const deckMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.9 });
    const deck = mergeList(deckGeos, deckMat);
    if (deck) {
      this.scene.add(deck);
      this.pierDeck = deck;
    }

    const pileMat = new THREE.MeshStandardMaterial({ color: 0x4c3a28, roughness: 0.95 });
    const piles = [];
    for (let i = 0; i < 12; i++) {
      for (const dx of [-4, 0, 4]) {
        const g = new THREE.CylinderGeometry(0.28, 0.28, 4.2, 6);
        g.translate(-90 + dx, 0.1, zBase + (len / 11) * i);
        piles.push(g);
      }
    }
    const pm = mergeList(piles, pileMat, { castShadow: false });
    if (pm) this.scene.add(pm);

    // pier buildings
    const shop = new THREE.Mesh(
      new THREE.BoxGeometry(14, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.85 })
    );
    shop.position.set(-90, 5, zBase + 26);
    shop.castShadow = true; shop.receiveShadow = true;
    this.scene.add(shop);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 13), new THREE.MeshStandardMaterial({ color: 0x9c3b3b }));
    roof.position.set(-90, 8.2, zBase + 26);
    this.scene.add(roof);

    // ferris wheel on the pier. Kept procedural: the downloaded 2.8k-tri
    // landmark pushed the swept street view past the 4.669M triangle ceiling,
    // so it was declined and this 33-mesh wheel stays the authored fallback.
    const wheel = new THREE.Group();
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.7, roughness: 0.4 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(13, 0.35, 8, 48), rimMat);
    wheel.add(rim);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 26, 0.16), rimMat);
      spoke.rotation.z = a;
      wheel.add(spoke);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5),
        new THREE.MeshStandardMaterial({ color: [0xff3d7f, 0x22e0ff, 0xffd447, 0x7dff9e][i % 4], roughness: 0.6 }));
      cab.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
      wheel.add(cab);
    }
    wheel.position.set(-90, 20, zBase + 74);
    this.scene.add(wheel);
    this.ferris = wheel;
    for (const dx of [-10, 10]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 21, 6), rimMat);
      leg.position.set(-90 + dx * 0.55, 10, zBase + 74);
      leg.rotation.z = dx > 0 ? -0.24 : 0.24;
      this.scene.add(leg);
    }
    // pier lights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    for (let i = 0; i < 8; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), lightMat);
      l.position.set(-86, 5.6, zBase + 8 + i * 13);
      this.scene.add(l);
      const l2 = l.clone(); l2.position.x = -94; this.scene.add(l2);
    }
  }

  buildPalms() {
    // called after scene setup: instanced trunks + fronds
    const data = this.palmData;
    const trunkGeo = new THREE.CylinderGeometry(0.19, 0.38, 1, 8, 1);
    const trunkTex = TEX.getPalmTrunk();
    const trunkMat = new THREE.MeshStandardMaterial({ map: trunkTex, roughness: 0.92 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, data.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const e = new THREE.Euler();

    const frondTex = TEX.getPalmFrond();
    const frondMat = new THREE.MeshStandardMaterial({
      map: frondTex, transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.85, color: 0xffffff
    });
    const frondGeo = new THREE.PlaneGeometry(2.3, 4.2, 1, 4);
    // bend the frond geometry
    const pos = frondGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.pow((y + 2.1) / 4.2, 2) * 2.1);
    }
    frondGeo.computeVertexNormals();
    frondGeo.translate(0, 2.1, 0);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, data.length * 9);

    let fi = 0;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      e.set(0, d.rot, d.lean);
      q.setFromEuler(e);
      p.set(d.x, d.y + d.height / 2, d.z);
      s.set(1, d.height, 1);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);

      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + d.rot;
        const tilt = 0.72 + Math.random() * 0.55;
        e.set(tilt, a, 0, 'YXZ');
        q.setFromEuler(e);
        p.set(d.x, d.y + d.height, d.z);
        const sc = 0.62 + d.height / 13;
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        fronds.setMatrixAt(fi++, m);
      }
    }
    trunks.instanceMatrix.needsUpdate = true;
    fronds.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    fronds.castShadow = false;
    this.scene.add(trunks);
    this.scene.add(fronds);
    this.palmTrunks = trunks;
    this.palmFronds = fronds;
  }

  buildBeach() {
    const rng = this.rng;
    // promenade / boardwalk
    const promTex = TEX.getSidewalk().clone();
    promTex.needsUpdate = true;
    promTex.repeat.set((WORLD_EDGE * 2) / 2.4, 9 / 2.4);
    const promMaps = TEX.photoMaterial('paving', (WORLD_EDGE * 2) / 2.4, 9 / 2.4) || {};
    const prom = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_EDGE * 2, 0.3, 9),
      new THREE.MeshStandardMaterial({
        map: promTex, roughness: 0.92,
        normalMap: promMaps.normalMap || null,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughnessMap: promMaps.roughnessMap || null
      })
    );
    prom.position.set(0, 0.15, WORLD_EDGE + 5);
    prom.receiveShadow = true;
    this.scene.add(prom);

    // railings
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2f3438, metalness: 0.6, roughness: 0.5 });
    const rails = [];
    for (let x = -WORLD_EDGE; x < WORLD_EDGE; x += 3) {
      const g = new THREE.BoxGeometry(0.08, 1.0, 0.08);
      g.translate(x, 0.8, WORLD_EDGE + 9.2);
      rails.push(g);
    }
    const top = new THREE.BoxGeometry(WORLD_EDGE * 2, 0.1, 0.14);
    top.translate(0, 1.3, WORLD_EDGE + 9.2);
    rails.push(top);
    const rm = mergeList(rails, railMat, { castShadow: false });
    if (rm) this.scene.add(rm);

    // umbrellas
    const umbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    for (let i = 0; i < 26; i++) {
      const x = -WORLD_EDGE + 20 + rng.next() * (WORLD_EDGE * 2 - 40);
      const z = WORLD_EDGE + 24 + rng.next() * 40;
      const col = new THREE.Color().setHSL(rng.next(), 0.6, 0.6);
      const umb = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.75, 10), umbMat.clone());
      umb.material.color = col;
      umb.position.set(x, 2.45, z);
      umb.castShadow = true;
      this.scene.add(umb);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), poleMat);
      pole.position.set(x, 1.2, z);
      this.scene.add(pole);
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshStandardMaterial({ color: col.clone().offsetHSL(0.2, 0, -0.1), roughness: 1 }));
      towel.rotation.x = -Math.PI / 2;
      towel.rotation.z = rng.next();
      towel.position.set(x + 1.4, 0.16, z + 1.2);
      this.scene.add(towel);
    }

    // lifeguard towers
    for (const x of [-260, 40, 300]) {
      const g = new THREE.Group();
      const legMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.9 });
      for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.18), legMat);
        leg.position.set(dx, 1.2, dz);
        g.add(leg);
      }
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3.4), new THREE.MeshStandardMaterial({ color: 0xf0e8d6, roughness: 0.85 }));
      cabin.position.y = 3.4; cabin.castShadow = true;
      g.add(cabin);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0xe0457b, roughness: 0.7 }));
      roof.position.y = 4.6;
      g.add(roof);
      g.position.set(x, 0.2, WORLD_EDGE + 34);
      this.scene.add(g);
    }

    // volleyball nets
    for (const x of [-120, 190]) {
      const net = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      net.position.set(x, 1.7, WORLD_EDGE + 46);
      this.scene.add(net);
    }
  }

  /* ----------------------------- interiors ----------------------------- */
  // Every building gets an interior. Rooms are built once per kind as a kit,
  // cloned per building (clones share geometry and materials), parked in a
  // basement grid far outside the city and hidden until entered - so the whole
  // system costs one room of draw calls while you are inside it and nothing
  // while you are on the street.
  buildInteriors() {
    const sizes = {
      apartment: { w: 13, d: 11, h: 3.2 },
      club: { w: 20, d: 16, h: 5.0 },
      garage: { w: 16, d: 13, h: 4.4 },
      restaurant: { w: 18, d: 13, h: 3.6 }
    };
    const names = {
      apartment: ['APARTMENT', 'STUDIO', 'LOFT', 'FLAT'],
      club: ['CLUB', 'LOUNGE', 'BAR'],
      garage: ['GARAGE', 'WORKSHOP', 'DEPOT'],
      restaurant: ['CAFE', 'DINER', 'RESTAURANT', 'DELI', 'SHOP']
    };
    const kits = {};
    for (const kind of Object.keys(sizes)) {
      const g = new THREE.Group();
      this.buildRoom({ ...sizes[kind], kind, group: g });
      g.visible = false;
      kits[kind] = g;
    }

    const fp = this.footprints || [];
    const cap = fp.length;
    const doorSlots = [];
    const DOOR_MIN = 2.4;
    for (let i = 0; i < cap; i++) {
      const f = fp[i];
      const kind = f.type === 'industrial' ? 'garage'
        : f.type === 'residential' ? 'apartment'
        : (i % 3 === 0 ? 'club' : 'restaurant');
      const size = sizes[kind];
      const group = kits[kind].clone(true);
      const sx = -4200 + (i % 20) * 34;
      const sz = -4200 + Math.floor(i / 20) * 34;
      group.position.set(sx, -140, sz);
      group.visible = false;
      this.scene.add(group);
      // Door slots are unique along the street. Two buildings can snap to the
      // same road point (especially at an intersection), which used to make
      // one of the two interiors unreachable by the F-door loop.
      let s = this.snapToStreetAxis(f.cx, f.z1 + 3);
      let slot = { x: s.x, z: s.z };
      for (let attempt = 0; attempt < 16; attempt++) {
        const step = Math.ceil(attempt / 2) * DOOR_MIN;
        const dir = attempt % 2 === 0 ? 1 : -1;
        const cand = { x: s.x, z: s.z };
        if (s.axis === 'z') cand.z += dir * step; else cand.x += dir * step;
        if (!doorSlots.some((o) => Math.hypot(o.x - cand.x, o.z - cand.z) < DOOR_MIN)) {
          slot = cand;
          break;
        }
      }
      doorSlots.push(slot);
      this.interiors.push({
        name: names[kind][i % names[kind].length] + ' ' + (i + 1),
        kind, x: sx, z: sz, y: -140, w: size.w, d: size.d, h: size.h, group,
        entry: { x: slot.x, z: slot.z, heading: Math.atan2(f.cx - slot.x, f.cz - slot.z) },
        building: f
      });
    }

    // door markers: one instanced draw for every entrance in the city
    const ringGeo = new THREE.CylinderGeometry(1.7, 1.7, 0.12, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22e0ff, transparent: true, opacity: 0.35 });
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, Math.max(1, this.interiors.length));
    const m = new THREE.Matrix4();
    this.interiors.forEach((it, i) => {
      m.makeTranslation(it.entry.x, 0.26, it.entry.z);
      rings.setMatrixAt(i, m);
      it.doorRing = rings;
    });
    rings.instanceMatrix.needsUpdate = true;
    rings.frustumCulled = false;
    this.scene.add(rings);
    this.doorRings = rings;
    this.interiorCount = this.interiors.length;
  }

  buildRoom(room) {
    const { w, d, h, group, kind } = room;
    const floorMat = new THREE.MeshStandardMaterial({ color: kind === 'garage' ? 0x55585c : 0x8a6a4a, roughness: 0.8 });
    const wallMat = new THREE.MeshStandardMaterial({ color: kind === 'club' ? 0x1b1024 : 0xd9cfc0, roughness: 0.9 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.95 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    group.add(ceil);

    const walls = [
      [w, h, 0, h / 2, -d / 2, 0],
      [w, h, 0, h / 2, d / 2, Math.PI],
      [d, h, -w / 2, h / 2, 0, Math.PI / 2],
      [d, h, w / 2, h / 2, 0, -Math.PI / 2]
    ];
    for (const [ww, hh, px, py, pz, rot] of walls) {
      const g = new THREE.PlaneGeometry(ww, hh);
      g.rotateY(rot);
      const mesh = new THREE.Mesh(g, wallMat);
      mesh.position.set(px, py, pz);
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // ceiling lights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, toneMapped: false });
    for (let i = 0; i < Math.max(2, Math.floor(w / 6)); i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5), lightMat);
      l.position.set(-w / 2 + 3 + i * 5, h - 0.1, 0);
      group.add(l);
    }
    const pl = new THREE.PointLight(kind === 'club' ? 0xff5cd0 : 0xffd9a0, kind === 'club' ? 90 : 70, 26, 2);
    pl.position.set(0, h - 0.6, 0);
    group.add(pl);

    const addBox = (bw, bh, bd, x, y, z, color, rot = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
      mesh.position.set(x, y, z);
      mesh.rotation.y = rot;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    if (kind === 'apartment') {
      const bedEntry = MODELS.fixtures && MODELS.fixtures.find((p) => p.id === 'bed');
      const bedGeo = bedEntry ? flattenModelGeometry(bedEntry, { length: 4.2 }) : null;
      if (bedGeo) {
        // One downloaded bed replaces the three procedural boxes (base,
        // mattress, headboard): fewer room meshes, and the geometry is shared
        // by every cloned apartment kit.
        bedGeo.rotateY(Math.PI / 2);
        const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.8
        }));
        bed.name = 'downloaded-bed';
        bed.position.set(-2.4, 0, -2.6);
        bed.castShadow = true; bed.receiveShadow = true;
        group.add(bed);
      } else {
        addBox(4.4, 0.55, 3.2, -2.4, 0.5, -2.6, 0x2f3b4a);            // bed base
        addBox(4.2, 0.35, 2.9, -2.4, 0.95, -2.6, 0xe8e2d4);            // mattress
        addBox(4.2, 0.5, 0.4, -2.4, 1.25, -4.0, 0x8a5a3a);             // headboard
      }
      addBox(3.2, 0.9, 1.4, 2.2, 0.45, 2.4, 0x7a4a3a);               // sofa
      addBox(3.2, 0.7, 0.3, 2.2, 0.95, 3.1, 0x7a4a3a);
      addBox(2.2, 0.12, 1.2, 2.2, 0.5, 0.6, 0x2a2a2e);               // coffee table
      addBox(3.0, 1.6, 0.5, 2.2, 1.0, -4.6, 0x14151a);               // tv
      addBox(0.5, 1.6, 3.0, -5.3, 1.0, 1.6, 0xb08a5a);               // kitchen counter
      addBox(1.6, 0.06, 2.4, 1.0, 0.05, -1.2, 0x9a3b4a);             // rug
      addBox(0.9, 1.9, 0.9, 4.6, 0.95, -3.6, 0x3a3f46);              // fridge
      // window
      addBox(0.12, 1.8, 3.2, -5.9, 1.7, -1.4, 0x9fd8e8);
    } else if (kind === 'club') {
      const dance = new THREE.Mesh(new THREE.PlaneGeometry(10, 8),
        new THREE.MeshStandardMaterial({ color: 0x220a2e, emissive: 0xff2fa0, emissiveIntensity: 0.55, roughness: 0.4 }));
      dance.rotation.x = -Math.PI / 2;
      dance.position.set(0, 0.02, 0.5);
      group.add(dance);
      addBox(14, 1.1, 1.6, 0, 0.55, -6.6, 0x241426);                 // bar
      addBox(14, 0.12, 2.0, 0, 1.16, -6.6, 0x4a2a1a);
      for (let i = 0; i < 6; i++) addBox(0.5, 0.9, 0.5, -6 + i * 2.4, 0.45, -4.6, 0x1b1b22);
      for (let i = 0; i < 4; i++) addBox(1.3, 2.6, 1.3, -8 + i * 5.2, 1.3, 6.4, 0x14141a);
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8),
        new THREE.MeshBasicMaterial({ map: TEX.getNeon('CLUB SOL', '#22e0ff', 110), transparent: true, toneMapped: false }));
      neon.position.set(0, 3.4, -7.6);
      group.add(neon);
    } else if (kind === 'garage') {
      addBox(7, 0.9, 1.4, -3.4, 0.45, -5.2, 0x6a4a2a);               // bench
      addBox(1.0, 1.9, 0.6, 6.6, 0.95, -4.2, 0x8a2a2a);              // toolbox
      addBox(4.2, 1.3, 2.0, 4.2, 0.65, 2.4, 0x1b2a3a);               // engine crate
      addBox(0.3, 3.2, 0.3, -7.6, 1.6, 4.2, 0x555a60);
      addBox(2.6, 0.5, 0.6, -7.0, 3.2, 4.2, 0xffe0a0);
      // roller door
      addBox(6, 3.6, 0.3, 0, 1.8, -6.4, 0x3d4247);
    } else {
      // restaurant
      for (let i = 0; i < 6; i++) {
        addBox(1.5, 0.1, 1.5, -6 + (i % 3) * 5.4, 1.0, -2 + Math.floor(i / 3) * 4.4, 0xd8cbb4);
        addBox(0.2, 1.0, 0.2, -6 + (i % 3) * 5.4, 0.5, -2 + Math.floor(i / 3) * 4.4, 0x4a4a4a);
      }
      addBox(12, 1.2, 1.4, 0, 0.6, -5.6, 0x2a1a1a);
      addBox(12, 0.14, 1.8, 0, 1.24, -5.6, 0x6a4a2a);
    }
  }

  /* ----------------------------- traffic signals / anim ----------------------------- */
  update(dt, game) {
    this.updateSignals(dt);
    // shop signs light up as the sun goes down
    if (this.signMat && game && game.sky) {
      const h = game.sky.hour;
      const night = Math.max(0, Math.min(1, Math.max((6.8 - h) / 1.6, (h - 18.6) / 1.6)));
      this.signMat.emissiveIntensity = 0.12 + night * 2.6;
      if (this.signGlowMat) this.signGlowMat.opacity = night * 0.5;
    }
    // project the building shadows: offset = -sunXZ / sunHeight per metre of
    // height, capped so a low sun does not throw kilometre-long black sheets
    if (this.shadowMat && game && game.sky) {
      const sd = game.sky.sunDir;
      const el = Math.max(sd.y, 0.17);
      this.shadowMat.uniforms.uDir.value.set(-sd.x / el, -sd.z / el);
      // a grazing sun is weak light: long shadows, but only a light stain
      const day = Math.max(0, Math.min(1, (sd.y - 0.02) / 0.3));
      this.shadowMat.uniforms.uAlpha.value = 0.38 * day * day;
      this.shadowMat.uniforms.uFog.value = this.scene.fog ? this.scene.fog.density : 0.001;
      this.shadowMesh.visible = this.shadowMat.uniforms.uAlpha.value > 0.01;
    }
    if (this.ferris) this.ferris.rotation.z += dt * 0.08;
    if (this.oceanUniforms) {
      this.oceanUniforms.uTime.value += dt;
      if (game && game.sky) {
        this.oceanUniforms.uSun.value.copy(game.sky.sunDir);
        this.oceanUniforms.uSunColor.value.copy(game.sky.sunColor);
        this.oceanUniforms.uSky.value.copy(game.sky.horizonColor);
      }
    }
  }

  /* ----------------------------- spawning ----------------------------- */
  spawnCar() {
    const gi = Math.floor(Math.random() * this.graph.length);
    const node = this.graph[gi];
    const link = node.links[Math.floor(Math.random() * node.links.length)];
    const next = this.graph[link.node];
    const dir = new THREE.Vector3(next.x - node.x, 0, next.z - node.z).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const pos = new THREE.Vector3(node.x, 0, node.z).addScaledVector(right, 2.6);
    const heading = Math.atan2(dir.x, dir.z);
    return { x: pos.x, z: pos.z, heading, nodeA: gi, nodeB: link.node };
  }

  spawnPed() {
    const p = this.pedPaths[Math.floor(Math.random() * this.pedPaths.length)];
    const side = Math.floor(Math.random() * 4);
    let x, z;
    if (side === 0) { x = p.x0 + Math.random() * (p.x1 - p.x0); z = p.z0; }
    else if (side === 1) { x = p.x1; z = p.z0 + Math.random() * (p.z1 - p.z0); }
    else if (side === 2) { x = p.x0 + Math.random() * (p.x1 - p.x0); z = p.z1; }
    else { x = p.x0; z = p.z0 + Math.random() * (p.z1 - p.z0); }
    return { x, z, y: 0.22 };
  }

  randomRoadPoint() {
    const x = this.roadsX[Math.floor(Math.random() * this.roadsX.length)];
    const z = this.roadsZ[Math.floor(Math.random() * this.roadsZ.length)];
    return { x, z };
  }

  // find nearest point on a road to (x,z) — used for police spawns / waypoints
  nearestNode(x, z) {
    let best = this.graph[0], bd = Infinity;
    for (const n of this.graph) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  findPath(startIdx, goalIdx) {
    if (startIdx === goalIdx) return [goalIdx];
    const prev = new Int16Array(this.graph.length).fill(-1);
    const queue = [startIdx];
    prev[startIdx] = startIdx;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === goalIdx) break;
      for (const l of this.graph[cur].links) {
        if (prev[l.node] === -1) { prev[l.node] = cur; queue.push(l.node); }
      }
    }
    if (prev[goalIdx] === -1) return [];
    const path = [];
    let c = goalIdx;
    while (c !== startIdx) { path.push(c); c = prev[c]; }
    path.reverse();
    return path;
  }

  // put a point on the nearest road centre line (keeps objectives reachable)
  snapToStreetAxis(x, z) {
    let bx = this.roadsX[0], bz = this.roadsZ[0], dx = 1e9, dz = 1e9;
    for (const rx of this.roadsX) { const d = Math.abs(x - rx); if (d < dx) { dx = d; bx = rx; } }
    for (const rz of this.roadsZ) { const d = Math.abs(z - rz); if (d < dz) { dz = d; bz = rz; } }
    // axis is the direction the door may slide along its street
    return dx <= dz ? { x: bx, z, axis: 'z' } : { x, z: bz, axis: 'x' };
  }

  snapToStreet(x, z) {
    const s = this.snapToStreetAxis(x, z);
    return { x: s.x, z: s.z };
  }

  nearestRoad(x, z) {
    let bx = this.roadsX[0], bz = this.roadsZ[0], bd = 1e9;
    for (const rx of this.roadsX) {
      const d = Math.abs(x - rx);
      if (d < bd) { bd = d; bx = rx; }
    }
    let bd2 = 1e9;
    for (const rz of this.roadsZ) {
      const d = Math.abs(z - rz);
      if (d < bd2) { bd2 = d; bz = rz; }
    }
    return { x: bx, z: bz };
  }
}
