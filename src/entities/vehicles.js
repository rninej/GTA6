// Palma City — vehicles: procedural car models, arcade physics, traffic AI.
import * as THREE from 'three';
import { MODELS, instanceCar } from '../world/models.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_TYPES, TRAFFIC_MIX, CFG } from '../config.js';
import { clamp, damp, dampAngle, lerp, angleDiff, TAU, resolveCircleAabb, rand, pick } from '../core/utils.js';
import * as TEX from '../world/textures.js';
import * as SURF from '../world/surface.js';
import { colorize } from './humanoid.js';
import { characterAtlas, tileUV, CT } from './character-atlas.js';

const CATLAS = characterAtlas(8);

// Cabin trim: leather grain from the authored atlas, so seats and dash carry
// surface relief instead of reading as flat black boxes behind the glass.
const interiorMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.88, metalness: 0.04,
  map: CATLAS.map, normalMap: CATLAS.normalMap,
  normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.5
});

let CAR_ID = 1;

// which atlas cell (see getLiveryAtlas) goes on which body
const LIVERY_INDEX = { taxi: 0, police: 1, van: 2 };
const LIVERY_MATS = new Map();

/* ----------------------------- liveries ----------------------------- */
// Livery textures are drawn once and shared. Everything below is original
// artwork: Palma Transit, Palma PD and the taxi checker are this project's own
// brands, not copies of a real operator.
const LIVERY_TEX = new Map();
function liveryTexture(kind) {
  if (LIVERY_TEX.has(kind)) return LIVERY_TEX.get(kind);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (kind === 'busSide') {
    c.width = 1024; c.height = 256;
    g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#008f8a'; g.fillRect(0, 178, 1024, 78);
    g.fillStyle = '#ff2d95';
    g.beginPath(); g.moveTo(0, 160); g.lineTo(1024, 140); g.lineTo(1024, 158); g.lineTo(0, 178); g.closePath(); g.fill();
    g.fillStyle = '#141b4d'; g.fillRect(0, 18, 1024, 5);
    g.fillStyle = '#ff6f61'; g.beginPath(); g.arc(120, 92, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff7ec'; g.beginPath(); g.arc(120, 92, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#008f8a'; g.beginPath(); g.arc(120, 92, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#141b4d';
    g.font = 'bold 44px sans-serif';
    g.fillText('PALMA TRANSIT', 232, 88);
    g.font = 'bold 22px sans-serif';
    g.fillStyle = '#0d6b68';
    g.fillText('CITY  \u00b7  12  \u00b7  BEACH LINE', 234, 122);
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px sans-serif';
    g.fillText('PALMA TRANSIT', 232, 236);
  } else if (kind === 'busEnd') {
    c.width = 512; c.height = 256;
    g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#008f8a'; g.fillRect(0, 178, 512, 78);
    g.fillStyle = '#ff2d95'; g.fillRect(0, 148, 512, 18);
    g.fillStyle = '#141b4d'; g.fillRect(0, 18, 512, 5);
    g.fillStyle = '#141b4d'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center';
    g.fillText('PALMA TRANSIT', 256, 96);
    g.fillStyle = '#0d6b68'; g.font = 'bold 22px sans-serif';
    g.fillText('CITY BUS', 256, 128);
  } else if (kind === 'taxi') {
    c.width = 512; c.height = 96;
    g.fillStyle = '#f2c31c'; g.fillRect(0, 0, 512, 96);
    const sq = 16;
    for (let x = 0; x < 512; x += sq) {
      for (let y = 0; y < 96; y += sq) {
        if (((x / sq) + (y / sq)) % 2 === 0) { g.fillStyle = '#15161a'; g.fillRect(x, y, sq, sq); }
      }
    }
    g.fillStyle = '#15161a'; g.fillRect(0, 34, 512, 28);
    g.fillStyle = '#f2c31c'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center';
    g.fillText('PALMA TAXI  \u00b7  555-0100', 256, 55);
  } else if (kind === 'police') {
    c.width = 512; c.height = 96;
    g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#12325f'; g.fillRect(0, 30, 512, 30);
    g.fillStyle = '#f4f6f8'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    g.fillText('PALMA POLICE', 256, 53);
    g.fillStyle = '#b5232c'; g.fillRect(0, 66, 512, 6);
  } else if (kind === 'wheel') {
    c.width = 256; c.height = 256;
    const cx = 128, cy = 128;
    g.fillStyle = '#101114'; g.fillRect(0, 0, 256, 256);
    // tyre: a black ring with a lighter sidewall shoulder
    g.beginPath(); g.arc(cx, cy, 126, 0, Math.PI * 2); g.fillStyle = '#15161a'; g.fill();
    g.beginPath(); g.arc(cx, cy, 122, 0, Math.PI * 2); g.strokeStyle = '#2a2c31'; g.lineWidth = 5; g.stroke();
    // alloy rim with five spokes
    g.beginPath(); g.arc(cx, cy, 84, 0, Math.PI * 2); g.fillStyle = '#c9ced6'; g.fill();
    g.beginPath(); g.arc(cx, cy, 78, 0, Math.PI * 2); g.fillStyle = '#6d7683'; g.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = '#d6dbe2';
      g.beginPath(); g.moveTo(-14, 10); g.lineTo(14, 10); g.lineTo(9, -74); g.lineTo(-9, -74); g.closePath(); g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fillStyle = '#23262c'; g.fill();
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fillStyle = '#aab2bd'; g.fill();
    // rubber shine on the outer sidewall
    g.beginPath(); g.arc(cx, cy, 112, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 9; g.stroke();
  } else if (kind === 'destination') {
    c.width = 512; c.height = 96;
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#ffb43c'; g.font = 'bold 40px monospace'; g.textAlign = 'center';
    g.fillText('12  DOWNTOWN', 256, 52);
    g.font = 'bold 22px monospace'; g.fillStyle = '#ffd89a';
    g.fillText('BEACH LINE', 256, 82);
  } else {
    c.width = 256; c.height = 64;
    g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#008f8a'; g.fillRect(0, 44, 256, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  LIVERY_TEX.set(kind, t);
  return t;
}

function liveryMaterial(kind) {
  const m = new THREE.MeshStandardMaterial({
    map: liveryTexture(kind), roughness: 0.38, metalness: 0.16,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  });
  m.name = 'livery';
  return m;
}

// The biggest opaque mesh in an instanced body is the car shell.
function bodyShell(root) {
  let best = null, bestN = -1;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.name === 'carGlass') return;
    const n = o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
    if (n > bestN) { bestN = n; best = o; }
  });
  return best;
}

function shellBox(root) {
  const mesh = bodyShell(root);
  if (!mesh) return null;
  mesh.geometry.computeBoundingBox();
  return { mesh, box: mesh.geometry.boundingBox.clone() };
}

// A livery that follows the shell: take the body triangles inside a height
// band, push each one a centimetre along its own normal, and re-map it with the
// livery texture. The band therefore sits on the real body surface — over
// arches, creases and the nose taper — instead of floating beside it.
function addSurfaceLivery(root, kind, y0f, y1f) {
  const info = shellBox(root);
  if (!info) return null;
  const { mesh, box } = info;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const H = box.max.y - box.min.y;
  const y0 = box.min.y + H * y0f, y1 = box.min.y + H * y1f;
  const spanY = Math.max(0.001, y1 - y0);
  const spanZ = Math.max(0.001, box.max.z - box.min.z);
  const spanX = Math.max(0.001, box.max.x - box.min.x);
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const P = [], U = [], N = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const get = (i, out) => { const k = idx ? idx.getX(i) : i; return out.fromBufferAttribute(pos, k); };
  for (let t = 0; t < triCount; t++) {
    get(t * 3, a); get(t * 3 + 1, b); get(t * 3 + 2, c);
    const cy = (a.y + b.y + c.y) / 3;
    if (cy < y0 || cy > y1) continue;
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac).normalize();
    // sides only, and only the outer skin: rounded shoulders, arch interiors
    // and the floor were being picked up and painted as torn blotches
    // flanks only: mixing side and nose triangles tore the texture where the
    // fender turns the corner, which read as black blotches
    if (Math.abs(n.y) > 0.3 || Math.abs(n.x) < 0.8) continue;
    const ccx = (a.x + b.x + c.x) / 3;
    const ccz = (a.z + b.z + c.z) / 3;
    if (Math.abs(ccx) < box.max.x - spanX * 0.1) continue;
    // doors and rear quarters only: the nose and tail turn the corner, and
    // including them tore the band across the bonnet
    if (Math.abs(ccz) > spanZ * 0.34) continue;
    for (const p of [a, b, c]) {
      P.push(p.x + n.x * 0.012, p.y + n.y * 0.004, p.z + n.z * 0.012);
      U.push((p.z - box.min.z) / spanZ, (p.y - y0) / spanY);
      N.push(n.x, n.y, n.z);
    }
  }
  if (!P.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const out = new THREE.Mesh(g, liveryMaterial(kind));
  out.name = 'livery';
  out.castShadow = false;
  root.add(out);
  return out;
}

// A flush panel on the flat part of the flank, sitting 8 mm proud of the paint.
function addDoorDecal(root, kind, wFrac, hFrac, yFrac) {
  const info = shellBox(root);
  if (!info) return null;
  const { box } = info;
  const L = box.max.z - box.min.z, W = box.max.x - box.min.x, H = box.max.y - box.min.y;
  const cz = (box.max.z + box.min.z) / 2;
  const cx = (box.max.x + box.min.x) / 2;
  const mat = liveryMaterial(kind);
  const g = new THREE.Group(); g.name = 'doorDecal';
  for (const s of [-1, 1]) {
    const p = new THREE.PlaneGeometry(L * wFrac, H * hFrac);
    p.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.translate(cx + s * (W / 2 + 0.008), box.min.y + H * yFrac, cz);
    g.add(new THREE.Mesh(p, mat));
  }
  root.add(g);
  return g;
}

// Box-shaped bodies (the bus) get a true wrap: four panels standing on the
// body's own side planes, meeting at the corners, so the livery reads as paint
// applied to the vehicle rather than a decal on one flank.
function addBoxLivery(root, sideKind, endKind, y0f, y1f) {
  const info = shellBox(root);
  if (!info) return null;
  const { box } = info;
  const H = box.max.y - box.min.y;
  const y0 = box.min.y + H * y0f, y1 = box.min.y + H * y1f;
  const bandH = Math.max(0.05, y1 - y0);
  const cy = (y0 + y1) / 2;
  const L = box.max.z - box.min.z, W = box.max.x - box.min.x;
  const cz = (box.max.z + box.min.z) / 2, cx = (box.max.x + box.min.x) / 2;
  // wheel arches: the side panel is a shape with two round holes, so the tyres
  // are not painted over by the livery. The radius matches addWheelFaces.
  const zAxle = L * 0.318, archR = L * 0.062 * 1.08;
  const geos = [], sideMat = liveryMaterial(sideKind);
  const endMat = liveryMaterial(endKind);
  for (const s of [-1, 1]) {
    // the two arches are cut into the bottom edge, not added as holes: a hole
    // that crosses the outline breaks the triangulation
    const sh = new THREE.Shape();
    sh.moveTo(-L / 2, 0);
    sh.lineTo(-zAxle - archR, 0);
    sh.absarc(-zAxle, 0, archR, Math.PI, 0, true);
    sh.lineTo(zAxle - archR, 0);
    sh.absarc(zAxle, 0, archR, Math.PI, 0, true);
    sh.lineTo(L / 2, 0);
    sh.lineTo(L / 2, bandH);
    sh.lineTo(-L / 2, bandH);
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 14);
    // ShapeGeometry emits shape-space UVs; re-map so the band texture spans it
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i);
      uv.setXY(i, s > 0 ? (lx + L / 2) / L : 1 - (lx + L / 2) / L, ly / bandH);
    }
    g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(cx + s * (W / 2 + 0.012), y0, cz);
    geos.push({ g, mat: sideMat });
    const e = new THREE.PlaneGeometry(W * 0.985, bandH);
    e.rotateY(s > 0 ? 0 : Math.PI);
    e.translate(cx, cy, cz + s * (L / 2 + 0.012));
    geos.push({ g: e, mat: endMat });
  }
  const mv = new THREE.Group(); mv.name = 'livery';
  for (const { g, mat } of geos) mv.add(new THREE.Mesh(g, mat));
  root.add(mv);
  return mv;
}

// Black rubber gasket above and below the glazing: without it the panes float
// in a field of cream paint instead of sitting in a framed window band.
function addWindowTrim(root) {
  const info = shellBox(root);
  if (!info) return null;
  const { box } = info;
  const H = box.max.y - box.min.y, L = box.max.z - box.min.z, W = box.max.x - box.min.x;
  const cz = (box.max.z + box.min.z) / 2;
  const frame = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.75, metalness: 0.25 });
  const g = new THREE.Group(); g.name = 'windowTrim';
  // window band from the kit: 1.63..2.47 of a 2.95 tall body
  const yb = box.min.y + H * 0.553, yt = box.min.y + H * 0.838;
  for (const y of [yb, yt]) {
    for (const s of [-1, 1]) {
      const p = new THREE.PlaneGeometry(L * 0.985, H * 0.022);
      p.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
      p.translate((box.max.x + box.min.x) / 2 + s * (W / 2 + 0.014), y, cz);
      g.add(new THREE.Mesh(p, frame));
    }
  }
  root.add(g);
  return g;
}

// Piece of the livery kit each body class gets.
// Round wheel faces over a kit body whose tyres are eight-sided cylinders:
// a disc carrying a radial tyre/rim texture sits flush on the outer sidewall,
// so the silhouette reads as a wheel instead of a polygon.
function addWheelFaces(root) {
  const info = shellBox(root);
  if (!info) return null;
  const { box } = info;
  const L = box.max.z - box.min.z, W = box.max.x - box.min.x, H = box.max.y - box.min.y;
  // a hair larger than the kit tyre: the black disc then reads as a wheel arch
  const zAxle = L * 0.318, r = L * 0.062;
  const y = r, cy = box.min.y + y;
  const group = new THREE.Group(); group.name = 'wheelFaces';
  const mat = new THREE.MeshStandardMaterial({
    map: liveryTexture('wheel'), roughness: 0.42, metalness: 0.3,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  });
  for (const zs of [-1, 1]) {
    for (const xs of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mat);
      disc.position.set(xs * (W / 2 + 0.004), cy, zs * zAxle);
      disc.rotation.y = xs > 0 ? Math.PI / 2 : -Math.PI / 2;
      disc.castShadow = false;
      group.add(disc);
    }
  }
  root.add(group);
  return group;
}

function addDestinationBoard(root) {
  const info = shellBox(root);
  if (!info) return null;
  const { box } = info;
  const W = box.max.x - box.min.x, H = box.max.y - box.min.y;
  const mat = new THREE.MeshStandardMaterial({
    map: liveryTexture('destination'), emissive: 0xffb43c, emissiveIntensity: 0.55,
    emissiveMap: liveryTexture('destination'), roughness: 0.5, metalness: 0.1
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, H * 0.10), mat);
  sign.position.set((box.max.x + box.min.x) / 2, box.min.y + H * 0.86, box.max.z + 0.012);
  sign.name = 'destination';
  root.add(sign);
  return sign;
}

function dressVehicle(root, type) {
  if (type === 'bus') {
    // band ends below the window line (windows start at 1.63 of a 2.95 body)
    addBoxLivery(root, 'busSide', 'busEnd', 0.10, 0.49);
    addWindowTrim(root);
    addWheelFaces(root);
    addDestinationBoard(root);
    return;
  }
  // Door panels are the one part of these low-poly flanks flat enough to carry
  // a clean graphic; clipping the band out of the shell tore at the fender
  // radius, so the taxi and van get a flush door decal instead.
  if (type === 'taxi') addDoorDecal(root, 'taxi', 0.40, 0.15, 0.44);
  else if (type === 'van') addDoorDecal(root, 'fleet', 0.44, 0.16, 0.34);
}

// Type-specific downloaded bodies. Every traffic type, including the transit
// bus, now has its own low-poly silhouette instead of the old shared bodies.
const CAR_MODEL_IDS = {
  police: 'police', taxi: 'taxi', sedan: 'sedan', suv: 'suv',
  coupe: 'coupe', hatch: 'hatch', muscle: 'muscle', sports: 'sports',
  pickup: 'pickup', van: 'van', bus: 'bus'
};

function pickCarEntry(type, n) {
  if (!MODELS.cars || !MODELS.cars.length) return null;
  let id = CAR_MODEL_IDS[type];
  if (type === 'sports' && n % 5 === 0) id = 'sports2';
  if (type === 'sports' && n % 17 === 0) id = 'ferrari';
  if (!id) return null;
  return MODELS.cars.find((c) => c.id === id) || null;
}

function makeGlbParts(color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  return {
    group, body, wheels: [], paint: new THREE.MeshStandardMaterial({ color }),
    glass: null, lightsMat: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    lightbar: null, interior: null, procedural: false
  };
}

const SHAPES = {
  sedan: {
    body: [[-2.35, 0.24], [-2.36, 0.62], [-2.1, 0.76], [-0.7, 0.82], [1.4, 0.84], [2.1, 0.78], [2.36, 0.64], [2.36, 0.24]],
    cabin: [[-1.3, 0.8], [-0.55, 1.4], [0.65, 1.42], [1.4, 0.82]],
    roof: [-0.55, 0.65, 1.4], wheelR: 0.33, axle: 1.42, w: 1.86
  },
  sports: {
    body: [[-2.25, 0.18], [-2.28, 0.5], [-1.7, 0.66], [-0.6, 0.72], [1.3, 0.74], [2.05, 0.66], [2.3, 0.48], [2.3, 0.18]],
    cabin: [[-1.15, 0.7], [-0.3, 1.14], [0.5, 1.16], [1.15, 0.72]],
    roof: [-0.3, 0.5, 1.16], wheelR: 0.34, axle: 1.35, w: 1.98
  },
  suv: {
    body: [[-2.55, 0.32], [-2.56, 0.82], [-2.2, 0.98], [-0.8, 1.0], [1.6, 1.0], [2.2, 0.94], [2.56, 0.8], [2.56, 0.32]],
    cabin: [[-2.2, 0.98], [-1.9, 1.84], [1.35, 1.86], [1.75, 1.0]],
    roof: [-1.9, 1.35, 1.86], wheelR: 0.42, axle: 1.62, w: 2.06
  },
  pickup: {
    body: [[-2.7, 0.3], [-2.7, 0.92], [-2.4, 1.0], [0.6, 1.0], [1.7, 0.98], [2.55, 0.92], [2.7, 0.8], [2.7, 0.3]],
    cabin: [[-1.05, 0.98], [-0.75, 1.88], [0.55, 1.9], [0.85, 1.0]],
    roof: [-0.75, 0.55, 1.9], wheelR: 0.42, axle: 1.7, w: 2.1, bed: true
  },
  van: {
    body: [[-2.6, 0.3], [-2.6, 0.9], [-2.3, 1.02], [0.9, 1.02], [2.2, 0.96], [2.6, 0.86], [2.6, 0.3]],
    cabin: [[-2.3, 1.0], [-2.1, 2.2], [1.9, 2.24], [2.2, 1.0]],
    roof: [-2.1, 1.9, 2.24], wheelR: 0.4, axle: 1.72, w: 2.0
  },
  taxi: {
    body: [[-2.35, 0.24], [-2.36, 0.62], [-2.1, 0.76], [-0.7, 0.82], [1.4, 0.84], [2.1, 0.78], [2.36, 0.64], [2.36, 0.24]],
    cabin: [[-1.3, 0.8], [-0.55, 1.4], [0.65, 1.42], [1.4, 0.82]],
    roof: [-0.55, 0.65, 1.42], wheelR: 0.33, axle: 1.42, w: 1.88
  },
  police: {
    body: [[-2.45, 0.24], [-2.46, 0.64], [-2.15, 0.8], [-0.7, 0.86], [1.45, 0.88], [2.15, 0.8], [2.45, 0.66], [2.45, 0.24]],
    cabin: [[-1.35, 0.84], [-0.55, 1.46], [0.7, 1.48], [1.45, 0.86]],
    roof: [-0.55, 0.7, 1.48], wheelR: 0.35, axle: 1.5, w: 1.94
  },
  muscle: {
    body: [[-2.45, 0.2], [-2.46, 0.6], [-2.1, 0.76], [-0.6, 0.8], [1.5, 0.8], [2.2, 0.74], [2.45, 0.6], [2.45, 0.2]],
    cabin: [[-1.2, 0.78], [-0.45, 1.3], [0.6, 1.32], [1.3, 0.8]],
    roof: [-0.45, 0.6, 1.32], wheelR: 0.35, axle: 1.45, w: 1.94
  },
  // two-door fastback: long rear glass sloping into a short deck
  coupe: {
    body: [[-2.2, 0.2], [-2.21, 0.56], [-1.95, 0.72], [-0.6, 0.78], [1.35, 0.8], [2.0, 0.72], [2.22, 0.58], [2.22, 0.2]],
    cabin: [[-1.55, 0.74], [-0.5, 1.26], [0.45, 1.28], [1.3, 0.76]],
    roof: [-0.5, 0.45, 1.28], wheelR: 0.34, axle: 1.36, w: 1.9
  },
  // short five-door with a tall, near-vertical hatch
  hatch: {
    body: [[-1.9, 0.26], [-1.92, 0.66], [-1.75, 0.8], [-0.5, 0.84], [1.15, 0.86], [1.8, 0.78], [1.92, 0.62], [1.92, 0.26]],
    cabin: [[-1.72, 0.8], [-1.5, 1.46], [0.9, 1.48], [1.25, 0.84]],
    roof: [-1.5, 0.9, 1.48], wheelR: 0.32, axle: 1.2, w: 1.78
  },
  // long, tall transit body with a near-vertical glasshouse
  bus: {
    body: [[-3.6, 0.34], [-3.6, 1.32], [-3.3, 1.52], [3.3, 1.52], [3.6, 1.32], [3.6, 0.34]],
    cabin: [[-3.42, 1.5], [-3.42, 2.7], [3.42, 2.7], [3.42, 1.5]],
    roof: [-3.3, 3.3, 2.72], wheelR: 0.5, axle: 2.6, w: 2.3
  }
};

function shapeFrom(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

// Side profile with wheel arches cut out of the bottom edge. The old body was a
// flat-bottomed slab, so the wheels simply poked out from underneath it and
// there was no arch for the eye to read. Walking the bottom edge front-to-rear
// and tracing a semicircle over each axle gives a real arch, and the extrude
// bevel then rolls the arch lip over like a pressed steel wing.
function bodyShape(sh) {
  const pts = sh.body;
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);

  const bottom = pts[0][1];
  const R = sh.wheelR + 0.09;
  const yc = sh.wheelR;
  const dz = Math.sqrt(Math.max(0.01, R * R - (yc - bottom) * (yc - bottom)));
  const t0 = Math.asin(clamp((bottom - yc) / R, -1, 1));
  const ARC = 10;
  for (const zc of [sh.axle, -sh.axle]) {
    s.lineTo(zc + dz, bottom);
    for (let i = 1; i <= ARC; i++) {
      const t = t0 + (Math.PI - 2 * t0) * (i / ARC);
      s.lineTo(zc + Math.cos(t) * R, yc + Math.sin(t) * R);
    }
  }
  s.lineTo(pts[0][0], pts[0][1]);
  s.closePath();
  return s;
}

// Cabin: floor, two front seats, a rear bench, dash, wheel, console and door
// cards. Merged into one geometry so a car with a real interior still costs a
// single extra draw call.
function buildInterior(sh) {
  const parts = [];
  const leather = (geo, hex) => { tileUV(geo, CT.leather, 2); parts.push(colorize(geo, hex)); return geo; };
  // sh.cabin is a list of [z, y] roof-line points, so the ends are points, not
  // numbers: reading them directly made every interior measurement NaN and the
  // merged cabin geometry invisible (and spammed computeBoundingSphere errors).
  const zr = sh.cabin[0][0];
  const zf = sh.cabin[sh.cabin.length - 1][0];
  const halfW = sh.w / 2 - 0.1;
  // Floor and seat heights scale with the cabin: a tall van or pickup has the
  // same interior module raised and stretched, so it fills the greenhouse
  // instead of leaving the cabin looking empty from outside.
  const floorY = sh.wheelR + 0.16;
  const vScale = clamp((sh.roof[2] - floorY) / 0.95, 0.9, 1.6);
  const H = (v) => floorY + v * vScale;
  // floor pan and transmission tunnel
  leather((() => { const g = new THREE.BoxGeometry(halfW * 2, 0.05, zf - zr); g.translate(0, floorY - 0.03, (zr + zf) / 2); return g; })(), 0x14161a);
  leather((() => { const g = new THREE.BoxGeometry(0.26, 0.12 * vScale, zf - zr); g.translate(0, floorY + 0.04 * vScale, (zr + zf) / 2); return g; })(), 0x101216);
  // front seats
  for (const s of [-1, 1]) {
    leather((() => { const g = new THREE.BoxGeometry(0.42, 0.11 * vScale, 0.46); g.translate(s * 0.34, H(0.14), 0.02); return g; })(), 0x23262b);
    const back = new THREE.BoxGeometry(0.4, 0.52 * vScale, 0.13);
    back.rotateX(-0.16);
    back.translate(s * 0.34, H(0.44), -0.24);
    leather(back, 0x1d2025);
    const hr = new THREE.BoxGeometry(0.24, 0.16 * vScale, 0.1);
    hr.translate(s * 0.34, H(0.76), -0.29);
    leather(hr, 0x1d2025);
  }
  // rear bench
  leather((() => { const g = new THREE.BoxGeometry(halfW * 1.85, 0.12 * vScale, 0.44); g.translate(0, H(0.14), zr + 0.55); return g; })(), 0x23262b);
  const rb = new THREE.BoxGeometry(halfW * 1.85, 0.46 * vScale, 0.12);
  rb.rotateX(-0.14);
  rb.translate(0, H(0.4), zr + 0.3);
  leather(rb, 0x1d2025);
  // dashboard, binnacle and centre stack
  leather((() => { const g = new THREE.BoxGeometry(halfW * 2, 0.26 * vScale, 0.34); g.translate(0, H(0.3), zf - 0.2); return g; })(), 0x191b20);
  leather((() => { const g = new THREE.BoxGeometry(0.34, 0.16, 0.2); g.translate(-0.34, H(0.46), zf - 0.32); return g; })(), 0x15171b);
  leather((() => { const g = new THREE.BoxGeometry(0.24, 0.34 * vScale, 0.22); g.translate(0, H(0.26), zf - 0.42); return g; })(), 0x15171b);
  // steering wheel and column
  const rim = new THREE.TorusGeometry(0.165, 0.024, 8, 18);
  rim.rotateX(1.28);
  rim.translate(-0.34, H(0.46), zf - 0.5);
  parts.push(colorize(rim, 0x0d0f12));
  const col = new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8);
  col.rotateX(1.28);
  col.translate(-0.34, H(0.38), zf - 0.42);
  parts.push(colorize(col, 0x1a1c20, CT.metal));
  // gear lever and handbrake
  const lever = new THREE.CylinderGeometry(0.014, 0.018, 0.16, 6);
  lever.translate(0.06, H(0.2), zf - 0.62);
  parts.push(colorize(lever, 0x1c1e22, CT.metal));
  const knob = new THREE.SphereGeometry(0.028, 8, 6);
  knob.translate(0.06, H(0.29), zf - 0.62);
  parts.push(colorize(knob, 0x0f1114));
  // door cards
  for (const s of [-1, 1]) {
    leather((() => { const g = new THREE.BoxGeometry(0.05, 0.34 * vScale, zf - zr - 0.1); g.translate(s * (halfW - 0.03), H(0.2), (zr + zf) / 2); return g; })(), 0x1b1e23);
  }
  // parcel shelf behind the rear bench (pickups and vans have a bulkhead there)
  leather((() => { const g = new THREE.BoxGeometry(halfW * 1.8, 0.04, 0.3); g.translate(0, H(0.44), zr + 0.08); return g; })(), 0x15171b);
  return BGU.mergeGeometries(parts, false);
}

function buildCarMesh(type, color, opts = {}) {
  const spec = CAR_TYPES[type];
  const sh = SHAPES[type] || SHAPES.sedan;
  const g = new THREE.Group();
  const bodyG = new THREE.Group();
  g.add(bodyG);

  // body paint: metallic flake albedo, orange-peel normal, gloss variation and a
  // clear coat, so the panels catch the sun and street lamps instead of reading
  // as flat colour. The body colour still comes from the material colour.
  const paintMaps = SURF.getCarPaint();
  // metalness/envMap were high enough that a flat panel at a grazing angle
  // reflected the whole sky and read as white paint: the body colour has to
  // stay dominant, with the reflection only as a sheen
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.1, roughness: 1.0,
    map: paintMaps.map,
    normalMap: paintMaps.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: paintMaps.roughnessMap,
    // clearcoat at 1.0 with a strong env made every upward-facing panel
    // (roof, boot deck) reflect the sky as flat white on a coloured car
    clearcoat: 0.12, clearcoatRoughness: 0.5,
    envMapIntensity: 0.18
  });
  const glassMaps = SURF.getCarGlass();
  // Real glazing: a tinted, reflective, semi-transparent pane with the cabin
  // visible behind it. At 0.86 opacity the greenhouse read as a black slab.
  const glass = new THREE.MeshStandardMaterial({
    color: 0x101c22, metalness: 0.45, roughness: 0.9, transparent: true, opacity: 0.62,
    depthWrite: false, envMapIntensity: 1.5,
    // the extruded greenhouse can present a back face to the camera from some
    // angles; double-sided keeps the pane visible instead of opening the cabin
    side: THREE.DoubleSide,
    map: glassMaps.map,
    normalMap: glassMaps.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: glassMaps.roughnessMap
  });
  const chromeMaps = SURF.getChrome();
  const detailMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.55, roughness: 1.0,
    normalMap: chromeMaps.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: chromeMaps.roughnessMap
  });
  const lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  // The wheel is one merged mesh: dark rubber and bright alloy in the same
  // material, so the map has to be a neutral detail atlas rather than the tyre
  // rubber texture, which was multiplying the rim down to black.
  const wheelMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.45, roughness: 0.85,
    map: CATLAS.map, normalMap: CATLAS.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.9
  });

  const paintGeos = [], glassGeos = [], detailGeos = [], lightGeos = [];
  const D = (geo, hex) => { detailGeos.push(colorize(geo, hex)); return geo; };

  // ---- main body shell ----
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(sh), {
    depth: sh.w - 0.12, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, steps: 1
  });
  bodyGeo.translate(0, 0, -(sh.w - 0.12) / 2);
  bodyGeo.rotateY(-Math.PI / 2);
  paintGeos.push(bodyGeo);

  // ---- glasshouse ----
  const cabW = (sh.w - 0.12) * 0.9;
  const cabGeo = new THREE.ExtrudeGeometry(shapeFrom(sh.cabin), {
    depth: cabW, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, steps: 1
  });
  cabGeo.translate(0, 0, -cabW / 2);
  cabGeo.rotateY(-Math.PI / 2);
  glassGeos.push(cabGeo);

  // ---- roof ----
  const roof = new THREE.BoxGeometry(sh.w * 0.8, 0.06, sh.roof[1] - sh.roof[0]);
  roof.translate(0, sh.roof[2] + 0.01, (sh.roof[0] + sh.roof[1]) / 2);
  paintGeos.push(roof);

  // rear pillar trim, kept below the roof line: at 0.9 long and only 0.1 down
  // the rotated ends poked through the roof as four spikes
  for (const s of [-1, 1]) {
    const p1 = new THREE.BoxGeometry(0.055, 0.045, 0.62);
    p1.rotateX(-0.5);
    p1.translate(s * sh.w * 0.4, sh.roof[2] - 0.16, sh.roof[0] + 0.12);
    paintGeos.push(p1);
  }

  const zFront = sh.body[sh.body.length - 1][0] + 0.02;
  const zRear = sh.body[0][0] - 0.02;

  // the bumpers used to sit 0.08 m *inside* the body shell, so both ends read
  // as one smooth slab; they now stand proud of the nose and tail
  const bumperF = new THREE.BoxGeometry(sh.w * 0.96, 0.18, 0.24);
  bumperF.translate(0, 0.42, zFront + 0.04);
  D(bumperF, 0x14161a);
  const bumperR = new THREE.BoxGeometry(sh.w * 0.96, 0.18, 0.24);
  bumperR.translate(0, 0.42, zRear - 0.04);
  D(bumperR, 0x14161a);

  const grille = new THREE.BoxGeometry(sh.w * 0.55, 0.16, 0.08);
  grille.translate(0, 0.62, zFront);
  D(grille, 0x0d0f12);
  // chrome slats across the grille
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.BoxGeometry(sh.w * 0.5, 0.012, 0.03);
    slat.translate(0, 0.575 + i * 0.045, zFront + 0.045);
    D(slat, 0x9aa0a8);
  }
  // lower intake and splitter
  const intake = new THREE.BoxGeometry(sh.w * 0.62, 0.1, 0.06);
  intake.translate(0, 0.33, zFront - 0.02);
  D(intake, 0x0b0d10);

  for (const s of [-1, 1]) {
    const hx = s * (sh.w * 0.33);
    // headlamp: dark housing, lens and a projector, plus an amber corner
    const hHouse = new THREE.BoxGeometry(0.46, 0.2, 0.09);
    hHouse.translate(hx, 0.68, zFront - 0.03);
    D(hHouse, 0x0a0c0f);
    const hl = new THREE.BoxGeometry(0.4, 0.13, 0.06);
    hl.translate(hx, 0.69, zFront + 0.035);
    lightGeos.push(colorize(hl, 0xfff6d8));
    const proj = new THREE.CylinderGeometry(0.042, 0.042, 0.05, 10);
    proj.rotateX(Math.PI / 2);
    proj.translate(hx - s * 0.08, 0.69, zFront + 0.07);
    lightGeos.push(colorize(proj, 0xffe9b0));
    const amber = new THREE.BoxGeometry(0.055, 0.09, 0.055);
    amber.translate(hx + s * 0.19, 0.66, zFront + 0.02);
    lightGeos.push(colorize(amber, 0xffa23a));
    // tail lamp: housing, red lens and a reverse strip
    const tHouse = new THREE.BoxGeometry(0.44, 0.19, 0.08);
    tHouse.translate(hx, 0.66, zRear + 0.03);
    D(tHouse, 0x0a0c0f);
    const tl = new THREE.BoxGeometry(0.4, 0.14, 0.05);
    tl.translate(hx, 0.66, zRear - 0.025);
    lightGeos.push(colorize(tl, 0xff2a2a));
    const rev = new THREE.BoxGeometry(0.1, 0.045, 0.05);
    rev.translate(hx - s * 0.12, 0.61, zRear - 0.025);
    lightGeos.push(colorize(rev, 0xf2f2ea));
    // mirror: arm, shell and glass face
    const mirror = new THREE.BoxGeometry(0.16, 0.1, 0.12);
    mirror.translate(s * (sh.w / 2 + 0.06), 0.92, sh.cabin[sh.cabin.length - 1][0] + 0.2);
    D(mirror, 0x14161a);
    const mGlass = new THREE.BoxGeometry(0.014, 0.075, 0.09);
    mGlass.translate(s * (sh.w / 2 + 0.142), 0.92, sh.cabin[sh.cabin.length - 1][0] + 0.2);
    D(mGlass, 0x24323a);
  }

  // panel gaps: door shut lines, beltline and a handle. Thin dark strips sit a
  // few millimetres proud of the paint, which is what reads as a shut line.
  {
    const sideX = sh.w / 2 + 0.013;
    const beltY = sh.body[1][1] + 0.02;
    const doorF = sh.cabin[sh.cabin.length - 1][0];
    const doorR = sh.cabin[0][0];
    const gapH = Math.max(0.2, sh.body[1][1] - 0.26);
    for (const s of [-1, 1]) {
      for (const z of [doorF, doorR]) {
        const gap = new THREE.BoxGeometry(0.008, gapH, 0.012);
        gap.translate(s * sideX, 0.26 + gapH / 2, z);
        D(gap, 0x0a0b0d);
      }
      const belt = new THREE.BoxGeometry(0.008, 0.012, Math.abs(doorF - doorR));
      belt.translate(s * sideX, beltY, (doorF + doorR) / 2);
      D(belt, 0x0a0b0d);
      const handle = new THREE.BoxGeometry(0.014, 0.03, 0.13);
      handle.translate(s * (sideX + 0.006), beltY - 0.055, (doorF + doorR) / 2 + 0.34);
      D(handle, 0xc8ccd2);
      // stamped character lines. The flank of an extruded body is a flat sheet,
      // so a shoulder crease under the glass and a lower door crease are added
      // in the paint material: they catch a highlight down their length and the
      // side stops reading as one flat slab.
      const run = Math.abs(doorF - doorR);
      const shoulder = new THREE.BoxGeometry(0.022, 0.032, run + 0.5);
      shoulder.translate(s * (sh.w / 2 - 0.048), beltY - 0.15, (doorF + doorR) / 2);
      paintGeos.push(shoulder);
      const lowCrease = new THREE.BoxGeometry(0.018, 0.024, run + 0.24);
      lowCrease.translate(s * (sh.w / 2 - 0.05), 0.5, (doorF + doorR) / 2);
      paintGeos.push(lowCrease);
      // bright belt strip along the same line, a common period detail
      const beltChrome = new THREE.BoxGeometry(0.012, 0.014, run - 0.05);
      beltChrome.translate(s * (sideX + 0.002), beltY + 0.012, (doorF + doorR) / 2);
      D(beltChrome, 0xb9c0c8);
    }
    // boot-lid shut line across the rear deck
    const bootY = sh.body[1][1] + 0.01;
    const boot = new THREE.BoxGeometry(sh.w * 0.66, 0.014, 0.018);
    boot.translate(0, bootY, zRear + Math.min(0.62, Math.abs(zRear) * 0.28));
    D(boot, 0x0a0b0d);
    // wipers lying on the windscreen
    for (const s of [-1, 1]) {
      const wiper = new THREE.BoxGeometry(0.5, 0.012, 0.024);
      wiper.rotateX(0.66);
      wiper.rotateY(s * 0.1);
      wiper.translate(s * 0.2, sh.body[1][1] + 0.24, sh.cabin[sh.cabin.length - 1][0] + 0.16);
      D(wiper, 0x101215);
    }
  }

  // exhausts
  for (const s of [-1, 1]) {
    const ex = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 7);
    ex.rotateX(Math.PI / 2);
    ex.translate(s * 0.32, 0.3, zRear - 0.02);
    D(ex, 0xb9bec6);
  }

  if (sh.bed) {
    for (const s of [-1, 1]) {
      const wall = new THREE.BoxGeometry(0.1, 0.42, 1.9);
      wall.translate(s * (sh.w / 2 - 0.1), 1.18, -1.55);
      paintGeos.push(wall);
    }
    const tail = new THREE.BoxGeometry(sh.w, 0.42, 0.1);
    tail.translate(0, 1.18, -2.5);
    paintGeos.push(tail);
  }

  if (type === 'van') {
    // rear doors: a body-coloured panel with a window above it and a centre
    // seam, so the back of the van is not one uninterrupted slab of glass
    const rearZ = sh.cabin[0][0];
    const panel = new THREE.BoxGeometry(sh.w * 0.86, 0.78, 0.06);
    panel.translate(0, 1.36, rearZ - 0.01);
    paintGeos.push(panel);
    const win = new THREE.BoxGeometry(sh.w * 0.6, 0.4, 0.05);
    win.translate(0, 1.94, rearZ - 0.03);
    glassGeos.push(win);
    const seam = new THREE.BoxGeometry(0.022, 0.8, 0.07);
    seam.translate(0, 1.36, rearZ - 0.03);
    D(seam, 0x0a0b0d);
    for (const s of [-1, 1]) {
      const hd = new THREE.BoxGeometry(0.16, 0.03, 0.05);
      hd.translate(s * 0.24, 1.3, rearZ - 0.06);
      D(hd, 0x9aa0a8);
    }
  }

  if (type === 'taxi') {
    const sign = new THREE.BoxGeometry(0.7, 0.22, 0.28);
    sign.translate(0, sh.roof[2] + 0.16, (sh.roof[0] + sh.roof[1]) / 2);
    lightGeos.push(colorize(sign, 0xffd447));
  }

  let lightbar = null;
  if (type === 'police') {
    for (const s of [-1, 1]) {
      const panel = new THREE.BoxGeometry(0.04, 0.42, 1.8);
      panel.translate(s * (sh.w / 2 + 0.01), 0.62, 0);
      D(panel, 0xf2f2f2);
    }
    const bar = new THREE.BoxGeometry(1.15, 0.16, 0.32);
    bar.translate(0, sh.roof[2] + 0.12, (sh.roof[0] + sh.roof[1]) / 2);
    D(bar, 0x14161a);
    lightbar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.26), new THREE.MeshBasicMaterial({ color: 0xff1a2a, toneMapped: false }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.26), new THREE.MeshBasicMaterial({ color: 0x1a6aff, toneMapped: false }));
    blue.position.x = 0.3;
    lightbar.add(red, blue);
    lightbar.position.set(0, sh.roof[2] + 0.14, (sh.roof[0] + sh.roof[1]) / 2);
    bodyG.add(lightbar);
    lightbar.userData = { red, blue };
  }

  // arch trim and a dark wheel-well liner: the arch is a hole through the
  // extruded body, so without a liner you see daylight through the car. This
  // has to be built before the detail list is merged below.
  const archR = sh.wheelR + 0.09;
  for (const ax of [sh.axle, -sh.axle]) {
    // open-ended tube: the closed version had dark end caps of radius archR,
    // which sat in front of each wheel and hid the rim, disc and tread entirely
    const liner = new THREE.CylinderGeometry(archR - 0.012, archR - 0.012, sh.w + 0.01, 14, 1, true);
    liner.rotateZ(Math.PI / 2);
    liner.translate(0, sh.wheelR, ax);
    D(liner, 0x0a0b0c);

  }

  const prep = (list) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].index) { const n = list[i].toNonIndexed(); list[i].dispose(); list[i] = n; }
    }
    return list;
  };
  const paintMesh = new THREE.Mesh(BGU.mergeGeometries(prep(paintGeos), false), paint);
  paintMesh.castShadow = true; paintMesh.receiveShadow = true;
  bodyG.add(paintMesh);
  const glassMesh = new THREE.Mesh(BGU.mergeGeometries(prep(glassGeos), false), glass);
  bodyG.add(glassMesh);
  const detailMesh = new THREE.Mesh(BGU.mergeGeometries(prep(detailGeos), false), detailMat);
  detailMesh.castShadow = true;
  bodyG.add(detailMesh);
  const lightsMesh = new THREE.Mesh(BGU.mergeGeometries(prep(lightGeos), false), lightsMat);
  bodyG.add(lightsMesh);

  // door livery: one atlas, one merged quad pair per car, shared material
  const liveryIdx = LIVERY_INDEX[type];
  if (liveryIdx !== undefined) {
    const atlas = SURF.getLiveryAtlas();
    let mat = LIVERY_MATS.get(type);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        map: atlas.map, roughness: 0.5, metalness: 0.12,
        polygonOffset: true, polygonOffsetFactor: -2
      });
      LIVERY_MATS.set(type, mat);
    }
    const quads = [];
    for (const side of [-1, 1]) {
      const q = new THREE.PlaneGeometry(1.55, 0.34);
      const uv = q.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, (liveryIdx + uv.getX(k)) / atlas.count, uv.getY(k));
      }
      if (side < 0) q.rotateY(-Math.PI / 2); else q.rotateY(Math.PI / 2);
      q.translate(side * (sh.w / 2 - 0.03), sh.body[1][1] + 0.16, 0.05);
      quads.push(q);
    }
    const liveryMesh = new THREE.Mesh(BGU.mergeGeometries(quads, false), mat);
    quads.forEach((q) => q.dispose());
    bodyG.add(liveryMesh);
  }
  paintGeos.forEach((x) => x.dispose());
  glassGeos.forEach((x) => x.dispose());
  detailGeos.forEach((x) => x.dispose());
  lightGeos.forEach((x) => x.dispose());

  // plate
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.26),
    new THREE.MeshStandardMaterial({
      map: TEX.getPlate(String(Math.floor(100 + Math.random() * 899)) + ' ' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26))),
      roughness: 0.6
    }));
  plate.position.set(0, 0.44, zRear - 0.165);
  plate.rotation.y = Math.PI;
  bodyG.add(plate);

  // wheels: one merged vertex-coloured mesh each
  const wheels = [];
  const R = sh.wheelR;
  // open-ended: a capped cylinder put a solid black disc over both wheel faces
  // and hid the rotor completely, which is why no amount of disc geometry ever
  // showed up in the close-up
  const tireBase = new THREE.CylinderGeometry(R, R, 0.28, 22, 1, true);
  tireBase.rotateZ(Math.PI / 2);
  const wheelParts = [colorize(tireBase, 0x0e1013, CT.leather)];
  // sidewall shoulders: the tyre is a torus in profile, so the wall rolls into
  // the tread instead of ending in a flat disc edge at grazing angles
  for (const side of [-1, 1]) {
    // sidewall shoulder, tucked inboard of the rim face: at 0.11R tube and
    // 0.115 offset it used to cover the spokes and the disc entirely, which is
    // why the wheels read as black holes from the side
    const shoulder = new THREE.TorusGeometry(R * 0.86, R * 0.075, 8, 22);
    shoulder.rotateY(Math.PI / 2);
    shoulder.translate(side * 0.104, 0, 0);
    wheelParts.push(colorize(shoulder, 0x0b0d10, CT.leather));
    // inner sidewall ring: closes the tyre wall down to the rim mouth without
    // capping the wheel, so the rotor behind the spokes stays visible
    const wall = new THREE.TorusGeometry(R * 0.70, R * 0.082, 8, 22);
    wall.rotateY(Math.PI / 2);
    wall.translate(side * 0.10, 0, 0);
    wheelParts.push(colorize(wall, 0x0d0f12, CT.leather));
    // Tread: four staggered rows of blocks with alternating skew, so the tyre
    // carries a real directional pattern with grooves between the rows instead
    // of 18 evenly spaced lugs.
    const rows = [
      { x: -0.088, w: 0.05, n: 22, off: 0.0, skew: 0.13 },
      { x: -0.03, w: 0.048, n: 26, off: 0.12, skew: -0.15 },
      { x: 0.03, w: 0.048, n: 26, off: 0.06, skew: -0.15 },
      { x: 0.088, w: 0.05, n: 22, off: 0.0, skew: 0.13 }
    ];
    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        const a = (i / row.n) * Math.PI * 2 + row.off;
        const blk = new THREE.BoxGeometry(row.w, 0.026, 0.034);
        blk.rotateY(row.skew);
        blk.translate(row.x, R - 0.004, 0);
        blk.rotateX(a);
        wheelParts.push(colorize(blk, 0x181a1e, CT.leather));
      }
    }
  }
  // Rim: dished barrel, bright lip, five wide spokes, lug nuts, brake disc and
  // caliper. A flat cap disc was what still read as a toy from the kerb.
  for (const side of [-1, 1]) {
    const barrel = new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.16, 20, 1, true);
    barrel.rotateZ(Math.PI / 2);
    barrel.translate(side * 0.06, 0, 0);
    wheelParts.push(colorize(barrel, 0x2a2e34, CT.metal));
    const lip = new THREE.TorusGeometry(R * 0.615, 0.016, 8, 24);
    lip.rotateY(Math.PI / 2);
    lip.translate(side * 0.137, 0, 0);
    wheelParts.push(colorize(lip, 0xb9bfc6, CT.metal));
    // Vented rotor. The vent pattern has to read from the camera's 45 degree
    // angle, not just edge-on, so the slots are cut INTO the friction face: 24
    // face sectors with gaps between them, a dark backing plate behind, and a
    // radial vane standing in every gap. That gives bright friction face, dark
    // slot, vane, dark slot - readable through the spokes at any angle.
    const rIn = R * 0.15, rOut = R * 0.54;
    const back = new THREE.CylinderGeometry(rOut, rOut, 0.006, 24);
    back.rotateZ(Math.PI / 2);
    back.translate(side * 0.08, 0, 0);
    wheelParts.push(colorize(back, 0x0b0d10, CT.metal));
    const SEGS = 14, GAP = 0.14;
    const span = (Math.PI * 2 / SEGS) - GAP;         // angular width of a pad
    const padR = rIn * 0.35 + rOut * 0.65;           // chord measured outboard
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2 + GAP * 0.5;
      // friction pad: a radial slab, bright, standing proud of the backing
      const face = new THREE.BoxGeometry(0.009, rOut - rIn, span * padR);
      face.translate(0, (rIn + rOut) / 2, 0);
      face.rotateX(a0 + span * 0.5);
      face.translate(side * 0.104, 0, 0);
      wheelParts.push(colorize(face, 0xc8ced4, CT.metal));
      // vane standing in the gap, set back so the slot reads as a shadow
      const vane = new THREE.BoxGeometry(0.016, (rOut - rIn) * 0.94, GAP * padR * 0.8);
      vane.translate(0, (rIn + rOut) / 2, 0);
      vane.rotateX(a0 + span + GAP * 0.5);
      vane.translate(side * 0.088, 0, 0);
      wheelParts.push(colorize(vane, 0x5a626a, CT.metal));
    }
    const hat = new THREE.CylinderGeometry(R * 0.19, R * 0.23, 0.052, 14);
    hat.rotateZ(Math.PI / 2);
    hat.translate(side * 0.118, 0, 0);
    wheelParts.push(colorize(hat, 0x585e64, CT.metal));
    const caliper = new THREE.BoxGeometry(0.032, 0.1, 0.05);
    caliper.translate(side * 0.098, -R * 0.3, 0.03);
    wheelParts.push(colorize(caliper, 0x9a3126));
    // five wide spokes standing proud of the barrel, tapered toward the hub
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.BoxGeometry(0.03, R * 0.56, 0.05);
      spoke.translate(0, R * 0.29, 0);
      spoke.rotateX(i * Math.PI * 2 / 5);
      spoke.translate(side * 0.146, 0, 0);
      wheelParts.push(colorize(spoke, 0xa8aeb5, CT.metal));
    }
    const hub = new THREE.CylinderGeometry(0.062, 0.062, 0.03, 12);
    hub.rotateZ(Math.PI / 2);
    hub.translate(side * 0.152, 0, 0);
    wheelParts.push(colorize(hub, 0x9aa1a8, CT.metal));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.014, 6);
      nut.rotateZ(Math.PI / 2);
      nut.translate(side * 0.163, Math.cos(a) * 0.036, Math.sin(a) * 0.036);
      wheelParts.push(colorize(nut, 0xd0d5da, CT.metal));
    }
  }
  const wheelGeo = BGU.mergeGeometries(wheelParts, false);

  const wheelSlots = [];
  for (const ax of [sh.axle, -sh.axle]) {
    for (const s of [-1, 1]) {
      if (opts.simpleWheels) {
        wheelSlots.push({ x: s * (sh.w / 2 - 0.17), y: sh.wheelR, z: ax });
        continue;
      }
      const steer = new THREE.Group();
      // inset from the body side so the arch lip sits proud of the tyre
      steer.position.set(s * (sh.w / 2 - 0.17), sh.wheelR, ax);
      const spin = new THREE.Group();
      steer.add(spin);
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      spin.add(wheel);
      bodyG.add(steer);
      wheels.push({ steer, spin, front: ax > 0 });
    }
  }

  // One instanced mesh for all four wheels: an AI/parked car never spins them,
  // and four separate wheel draws per car add up across the traffic fleet.
  if (wheelSlots.length) {
    const im = new THREE.InstancedMesh(wheelGeo, wheelMat, wheelSlots.length);
    const m4 = new THREE.Matrix4();
    wheelSlots.forEach((slot, i) => {
      m4.makeTranslation(slot.x, slot.y, slot.z);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    bodyG.add(im);
  }

  // ---- cabin interior: visible through the glass ----
  const interior = new THREE.Mesh(buildInterior(sh), interiorMat);
  interior.castShadow = false;
  interior.receiveShadow = true;
  bodyG.add(interior);

  return {
    group: g, body: bodyG, wheels, paint, glass, lightsMat, lightbar, interior, sh, spec,
    procedural: true
  };
}

export class Vehicle {
  constructor(game, type = 'sedan', opts = {}) {
    this.id = CAR_ID++;
    this.game = game;
    this.type = type;
    // false = locked: taking it needs a hotwire (set by missions for keyed cars).
    this.keys = !!opts.keys;
    // Doors are locked independently of the ignition: a successful lockpick
    // opens them, but the engine still needs the hotwire.
    this.locked = opts.locked !== undefined ? !!opts.locked : !this.keys;
    this.lockCooldown = 0;
    this.lockpickFailures = 0;
    this.alarm = 0;
    this.alarmBeep = 0;
    this.isBus = !!opts.isBus;
    this.spec = CAR_TYPES[type] || CAR_TYPES.sedan;
    const color = opts.color || pick(this.spec.colors);
    this.color = color;
    const n = (Vehicle._carVariant = (Vehicle._carVariant || 0) + 1);
    // Every car in the fleet — including the one the player drives — uses the
    // downloaded body. The authored procedural shell is now only the emergency
    // fallback (`noGlb`), because a hand-built car next to the GLB traffic read
    // as two different games.
    const entry = opts.noGlb ? null : pickCarEntry(type, n);
    this.parts = entry ? makeGlbParts(color) : buildCarMesh(type, color, { simpleWheels: opts.driver !== 'player' });
    this.mesh = this.parts.group;
    // A bus is seen from the inside by riders; skip the extra cabin draw call.
    if (this.isBus && this.parts.interior) this.parts.interior.visible = false;

    this.glb = null;
    if (entry) {
      try {
        const inst = instanceCar(entry, {
          length: entry.length || this.spec.length, color,
          // the player's car keeps its wheel pivots so they steer and spin
          mergeWheels: opts.driver !== 'player'
        });
        this.parts.body.add(inst.root);
        this.glb = inst;
        // fleet dressing: livery that follows the shell (the glazing itself is
        // split out of the merged body in instanceCar)
        dressVehicle(inst.root, type);
      } catch (err) {
        MODELS.carFallbacks++;
        MODELS.errors.push('car-instance:' + (err && err.message ? err.message : err));
        this.parts = buildCarMesh(type, color, { simpleWheels: true });
        this.mesh = this.parts.group;
      }
    }
    this.pos = this.mesh.position;
    this.velocity = new THREE.Vector3();
    this.heading = opts.heading || 0;
    this.steerAngle = 0;
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.brake = 0;
    this.handbrake = false;
    this.health = 1000;
    this.maxHealth = 1000;
    // GTA-style upkeep: fuel burns while driving and engine health falls with
    // impacts; both are restored at a fuel station.
    this.fuel = 1;
    this.engineHealth = 1;
    this.engineOn = true;
    this.driver = opts.driver || null;   // null | 'player' | 'ai' | 'cop' | 'gang'
    this.aiMode = opts.aiMode || 'traffic';
    this.nodeA = opts.nodeA ?? 0;
    this.nodeB = opts.nodeB ?? 1;
    this.target = new THREE.Vector3();
    this.dead = false;
    this.burnTimer = 0;
    this.sirenTimer = 0;
    this.sirenOn = type === 'police';
    this.headlightsOn = false;
    this.wheelSpin = 0;
    this.spawnGrace = 0.6;
    this.stuckTimer = 0;

    this.mesh.position.set(opts.x || 0, 0, opts.z || 0);
    this.heading = opts.heading || 0;
    this.mesh.rotation.y = this.heading;
    this.mesh.userData.vehicle = this;
    game.scene.add(this.mesh);
    this.pickTarget();
  }

  get isPlayer() { return this.driver === 'player'; }

  setDriver(kind) {
    this.driver = kind;
    if (kind) {
      this.aiMode = this.aiMode === 'traffic' ? 'traffic' : this.aiMode;
      this.throttle = 0; this.steer = 0; this.brake = 0;
    } else {
      this.throttle = 0; this.steer = 0; this.brake = 1;
    }
    if (kind === 'player') {
      this.aiMode = 'player';
      this.game.cam.setMode('vehicle');
    }
  }

  pickTarget() {
    const city = this.game.city;
    const n = city.graph[this.nodeB] || city.graph[0];
    const a = city.graph[this.nodeA] || city.graph[0];
    const dir = new THREE.Vector3(n.x - a.x, 0, n.z - a.z).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    this.target.set(n.x + right.x * 2.6, 0, n.z + right.z * 2.6);
  }

  pickNext(city) {
    const node = city.graph[this.nodeB];
    if (!node) return;
    const prev = city.graph[this.nodeA];
    const opts = node.links.filter((l) => l.node !== this.nodeA);
    let link = opts.length ? opts[Math.floor(Math.random() * opts.length)] : node.links[0];
    if (opts.length && Math.random() < 0.55) {
      // prefer going straight
      const back = { x: prev.x - node.x, z: prev.z - node.z };
      const straight = opts.find((l) => {
        const nn = city.graph[l.node];
        return (nn.x - node.x) * back.x + (nn.z - node.z) * back.z < 0;
      });
      if (straight) link = straight;
    }
    this.nodeA = this.nodeB;
    this.nodeB = link.node;
    this.pickTarget();
  }

  damage(n, fromDir) {
    if (this.dead) return;
    // The public bus is part of the city service, not a mission target: traffic
    // shunts must not explode it and strand the line mid-route.
    if (this.isBus) return;
    this.health -= n;
    this.engineHealth = Math.max(0, this.engineHealth - n * 0.00018);
    if (this.health < 0) this.health = 0;
    if (this.health <= 0) this.explode();
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.burnTimer = 6;
    this.game.effects.explosion(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.4);
    this.game.audio.play('explosion');
    this.game.cam.shake(1.2, 0.6);
    if (this.driver === 'player') {
      this.game.player.exitVehicle(true);
      this.game.player.takeDamage(160, 'explosion');
    }
    this.parts.paint.color.setHex(0x2a2420);
    this.parts.paint.emissive = new THREE.Color(0x4a1a08);
    this.parts.paint.emissiveIntensity = 0.6;
  }

  update(dt, game) {
    this.spawnGrace = Math.max(0, this.spawnGrace - dt);
    this.lockCooldown = Math.max(0, this.lockCooldown - dt);
    this.alarm = Math.max(0, this.alarm - dt);
    this.alarmBeep = Math.max(0, this.alarmBeep - dt);
    if (this.dead) {
      this.velocity.multiplyScalar(1 - 2.5 * dt);
      this.pos.addScaledVector(this.velocity, dt);
      this.burnTimer -= dt;
      if (this.burnTimer < 0) { this.remove(); }
      return;
    }

    if (this.driver === 'player') {
      this.readPlayerInput(game.input);
    } else if (this.driver === 'ai' || this.driver === 'cop' || this.driver === 'gang') {
      if (this.aiMode === 'chase') this.chaseAI(dt, game);
      else this.trafficAI(dt, game);
    } else if (this.driver === 'bus') {
      // Route driver: Transit sets throttle/steer before the manager update.
    } else {
      this.throttle = 0; this.steer = 0; this.brake = 1; this.handbrake = false;
    }

    this.physics(dt, game);
    this.visuals(dt, game);
    this.collideWorld(game);
    this.hitPlayer(game);
  }

  readPlayerInput(input) {
    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const steer = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    this.throttle = throttle;
    this.steer = steer;
    this.brake = input.down('KeyS') ? 1 : 0;
    this.handbrake = input.down('Space');
    if (input.hit('KeyH')) this.game.audio.horn();
    if (input.hit('KeyV')) this.game.cam.cycleVehicleCam();
  }

  trafficAI(dt, game) {
    const city = game.city;
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const diff = angleDiff(this.heading, desired);
    this.steer = clamp(diff * 2.4, -1, 1);

    let want = 12.5;
    if (dist < 14) want = 7.5;

    const nodeB = city.graph[this.nodeB];
    if (nodeB && dist < 26) {
      const travellingZ = Math.abs(dz) > Math.abs(dx);
      if (!city.isGreen(nodeB.x, nodeB.z, travellingZ)) want = 0;
    }
    // brake for cars ahead
    const ahead = this.obstacleAhead(game);
    if (ahead) want = 0;

    if (this.speed < want - 0.6) { this.throttle = 1; this.brake = 0; }
    else if (this.speed > want + 0.8) { this.throttle = 0; this.brake = 1; }
    else { this.throttle = 0.15; this.brake = 0; }

    if (dist < 6.5) this.pickNext(city);

    // unstick
    if (Math.abs(this.speed) < 0.4 && want > 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3) {
        this.stuckTimer = 0;
        this.throttle = 1; this.steer = 1;
      }
    } else this.stuckTimer = 0;
  }

  chaseAI(dt, game) {
    const target = game.player.pos;
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.pathTimer = (this.pathTimer || 0) - dt;

    // far away: follow the street network so we do not grind into buildings
    if (dist > 55) {
      if (!this.path || this.pathTimer <= 0) {
        const city = game.city;
        const a = city.nearestNode(this.pos.x, this.pos.z);
        const b = city.nearestNode(target.x, target.z);
        this.path = city.findPath(a.idx, b.idx);
        this.pathIdx = 0;
        this.pathTimer = 2.5;
      }
      if (this.path && this.path.length) {
        while (this.pathIdx < this.path.length - 1) {
          const n = game.city.graph[this.path[this.pathIdx]];
          if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < 16) this.pathIdx++;
          else break;
        }
        const n = game.city.graph[this.path[this.pathIdx]];
        const desired = Math.atan2(n.x - this.pos.x, n.z - this.pos.z);
        this.steer = clamp(angleDiff(this.heading, desired) * 2.4, -1, 1);
        if (this.speed < 30) { this.throttle = 1; this.brake = 0; }
        else { this.throttle = 0; this.brake = this.speed > 34 ? 1 : 0; }
        return;
      }
    }

    this.path = null;
    const desired = Math.atan2(dx, dz);
    const diff = angleDiff(this.heading, desired);
    this.steer = clamp(diff * 2.2, -1, 1);
    const want = dist > 18 ? 26 : dist > 9 ? 12 : 0;
    if (this.speed < want) { this.throttle = 1; this.brake = 0; }
    else { this.throttle = 0; this.brake = this.speed > want + 4 ? 1 : 0; }
    this.obstacleAhead(game, true);
  }

  obstacleAhead(game, ignoreBrake = false) {
    let blocked = false;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const v of game.vehicles.all) {
      if (v === this || v.dead) continue;
      const dx = v.pos.x - this.pos.x, dz = v.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 13 || d < 0.1) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot > 0.82) { blocked = true; break; }
    }
    if (blocked && !ignoreBrake) { this.throttle = 0; this.brake = 1; }
    return blocked;
  }

  physics(dt, game) {
    const spec = this.spec;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vLong = this.velocity.x * fx + this.velocity.z * fz;
    let vLat = this.velocity.x * rx + this.velocity.z * rz;

    // fuel burn + engine condition: an empty tank or a wrecked engine cuts drive
    const engineFactor = this.engineOn ? (0.55 + 0.45 * this.engineHealth) : 0;
    if (this.driver) {
      const burn = Math.abs(this.throttle) * 0.00085 + (Math.abs(vLong) > 2 ? 0.00005 : 0);
      this.fuel = Math.max(0, this.fuel - burn * dt);
      if (this.fuel <= 0 && this.engineOn) {
        this.engineOn = false;
        if (this.driver === 'player') this.game.hud.toast('OUT OF FUEL', 'bad');
      }
    }
    if (!this.engineOn) this.throttle = 0;
    if (this.throttle > 0) {
      vLong += spec.accel * engineFactor * this.throttle * (1 - clamp(vLong / spec.top, 0, 0.97)) * dt;
    } else if (this.throttle < 0) {
      vLong += spec.accel * 0.6 * engineFactor * this.throttle * (1 - clamp(-vLong / (spec.top * 0.42), 0, 0.95)) * dt;
    }
    if (this.brake > 0) {
      const b = spec.brake * this.brake * dt;
      if (vLong > 0.2) vLong = Math.max(0, vLong - b);
      else if (vLong < -0.2) vLong = Math.min(0, vLong + b);
      else vLong = 0;
    }
    if (this.handbrake) vLong *= Math.max(0, 1 - 1.6 * dt);

    vLong -= vLong * 0.28 * dt;
    vLong -= Math.sign(vLong) * 0.006 * vLong * vLong * dt;
    vLong = clamp(vLong, -spec.top * 0.4, spec.top);

    const grip = this.handbrake ? 1.1 : spec.grip;
    vLat *= Math.exp(-grip * dt);

    const steerMax = 0.62 * (1 - clamp(Math.abs(vLong) / spec.top, 0, 1) * 0.62);
    this.steerAngle = damp(this.steerAngle, this.steer * steerMax, 9, dt);
    const turnRate = (vLong / 2.7) * Math.tan(this.steerAngle);
    this.heading += turnRate * dt;

    this.velocity.set(fx * vLong + rx * vLat, 0, fz * vLong + rz * vLat);
    this.speed = vLong;

    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.z * dt;

    const gh = game.city.getGroundHeight(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gh, 10, dt);
    this.surface = gh > 0.1 ? 'sidewalk' : 'road';
  }

  collideWorld(game) {
    const radius = this.spec.width * 0.62;
    const pts = [
      { x: this.pos.x + Math.sin(this.heading) * 1.6, z: this.pos.z + Math.cos(this.heading) * 1.6 },
      { x: this.pos.x - Math.sin(this.heading) * 1.6, z: this.pos.z - Math.cos(this.heading) * 1.6 },
      { x: this.pos.x, z: this.pos.z }
    ];
    const seen = new Set();
    for (const p of pts) {
      const cols = game.city.queryColliders(p.x, p.z, radius + 1);
      for (const c of cols) {
        if (seen.has(c)) continue;
        const cx = clamp(p.x, c.minX, c.maxX);
        const cz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        seen.add(c);
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 0.0001 ? dx / d : (p.x > (c.minX + c.maxX) / 2 ? 1 : -1);
        const nz = d2 > 0.0001 ? dz / d : 0;
        const push = radius - d + 0.02;
        this.pos.x += nx * push;
        this.pos.z += nz * push;
        const impact = Math.abs(this.velocity.x * nx + this.velocity.z * nz);
        if (impact > 2.5) {
          this.velocity.x -= nx * impact * 1.5;
          this.velocity.z -= nz * impact * 1.5;
          this.velocity.multiplyScalar(0.55);
          this.damage(impact * 6);
          this.game.audio.play('crash', Math.min(1, impact / 22));
          this.game.cam.shake(Math.min(0.5, impact / 40), 0.16);
          if (this.isPlayer) this.game.player.takeDamage(impact * 0.7, 'crash');
        }
      }
    }
    // world bounds
    const lim = 480 + CFG.BEACH;
    if (this.pos.z > 548) { this.pos.z = 548; this.velocity.z *= -0.3; }
    if (this.pos.x < -lim) { this.pos.x = -lim; this.velocity.x *= -0.3; }
    if (this.pos.x > lim) { this.pos.x = lim; this.velocity.x *= -0.3; }
    if (this.pos.z < -lim) { this.pos.z = -lim; this.velocity.z *= -0.3; }
  }

  hitPlayer(game) {
    if (this.driver === 'player' || this.dead) return;
    const p = game.player;
    if (p.inVehicle) return;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    if (Math.abs(dx) < this.spec.width * 0.7 && Math.abs(dz) < this.spec.length * 0.55 && p.pos.y < 1.4) {
      if (Math.abs(this.speed) > 5) {
        p.takeDamage(Math.abs(this.speed) * 1.4, 'car');
        const push = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(2);
        p.vel.add(push);
        p.vy = 2.4;
      }
    }
  }

  visuals(dt, game) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;

    const accel = this.throttle > 0 ? 1 : (this.brake > 0 ? -1 : 0);
    this.parts.body.rotation.x = damp(this.parts.body.rotation.x, -accel * 0.019, 6, dt);
    this.parts.body.rotation.z = damp(this.parts.body.rotation.z, this.steer * Math.min(1, Math.abs(this.speed) / 18) * 0.048, 6, dt);

    // wheels lock under the handbrake instead of spinning through it
    if (!this.handbrake) this.wheelSpin += (this.speed / 0.34) * dt;
    if (this.glb) {
      for (const w of this.glb.wheels) {
        w.wheel.rotation.x = this.wheelSpin;
        if (w.front) w.pivot.rotation.y = this.steerAngle;
      }
      if (this.glb.steeringWheel) this.glb.steeringWheel.rotation.z = -this.steerAngle * 7;
    }
    for (const w of this.parts.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.steer.rotation.y = this.steerAngle;
    }

    const night = game.sky ? game.sky.night : 0;
    const on = night > 0.35 || this.isPlayer;
    if (on !== this.headlightsOn) {
      this.headlightsOn = on;
      this.parts.lightsMat.color.setScalar(on ? 1 : 0.4);
    }

    if (this.parts.lightbar) {
      this.sirenTimer += dt;
      const phase = Math.floor(this.sirenTimer * 6) % 2;
      const { red, blue } = this.parts.lightbar.userData;
      const active = this.aiMode === 'chase' || this.sirenOn;
      red.material.color.setHex(active && phase === 0 ? 0xff2233 : 0x220508);
      blue.material.color.setHex(active && phase === 1 ? 0x2266ff : 0x050822);
    }

    // Failed lockpick alarm: flash the car's existing lights mesh. No extra
    // geometry or draw call, just the material already on the car.
    if (this.alarm > 0) {
      this._alarmWasOn = true;
      const phase = Math.floor(this.alarm * 6) % 2;
      this.parts.lightsMat.color.setScalar(phase ? 1 : 0.15);
      if (this.alarmBeep <= 0) {
        this.alarmBeep = 0.9;
        game.audio.play('alarm', 1, 0);
      }
    } else if (this._alarmWasOn) {
      this._alarmWasOn = false;
      this.parts.lightsMat.color.setScalar(this.headlightsOn ? 1 : 0.4);
    }

    if ((this.health < 400 || this.engineHealth < 0.4) && Math.random() < dt * 22) {
      const p = this.pos.clone().add(new THREE.Vector3(0, 0.85, 0));
      this.game.effects.smoke(p, this.health < 180 ? 0x222222 : 0x888888, 1);
    }
  }

  remove() {
    this.game.scene.remove(this.mesh);
    // Per-car merged geometries and paint clones are owned by this instance;
    // disposing them stops the long-session GPU-memory creep from traffic that
    // spawns and despawns around the player.
    if (this.glb && this.glb.dispose) this.glb.dispose();
    this.glb = null;
    this.removed = true;
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get right() { return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading)); }
}

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.all = [];
    this.maxTraffic = 32;
    this.trafficTimer = 0;
  }

  spawnAt(type, x, z, heading, opts = {}) {
    const v = new Vehicle(this.game, type, { x, z, heading, ...opts });
    this.all.push(v);
    return v;
  }

  spawnParked() {
    for (const p of this.game.city.parking) {
      if (this.all.length > 18) break;
      const type = Math.random() < 0.5 ? 'sedan' : 'suv';
      this.spawnAt(type, p.x, p.z, p.heading, { driver: null });
    }
  }

  spawnTraffic() {
    const city = this.game.city;
    const p = this.game.player.pos;
    const near = city.graph.filter((n) => {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      return d > 40 && d < 190;
    });
    const node = near.length ? near[Math.floor(Math.random() * near.length)]
      : city.graph[Math.floor(Math.random() * city.graph.length)];
    const link = node.links[Math.floor(Math.random() * node.links.length)];
    const next = city.graph[link.node];
    const dir = new THREE.Vector3(next.x - node.x, 0, next.z - node.z).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const type = pick(TRAFFIC_MIX.map((x) => x[0]));
    const v = this.spawnAt(type, node.x + right.x * 2.6, node.z + right.z * 2.6,
      Math.atan2(dir.x, dir.z), {
        driver: 'ai', nodeA: node.idx, nodeB: link.node, aiMode: 'traffic'
      });
    return v;
  }

  spawnPolice(nearPos, wanted) {
    const city = this.game.city;
    const cands = city.graph.filter((n) => {
      const d = Math.hypot(n.x - nearPos.x, n.z - nearPos.z);
      return d > 70 && d < 170;
    });
    const node = cands.length ? cands[Math.floor(Math.random() * cands.length)]
      : city.nearestNode(nearPos.x, nearPos.z);
    const link = node.links[Math.floor(Math.random() * node.links.length)];
    const next = city.graph[link.node];
    const dir = new THREE.Vector3(next.x - node.x, 0, next.z - node.z).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const v = this.spawnAt('police', node.x + right.x * 2.6, node.z + right.z * 2.6,
      Math.atan2(dir.x, dir.z), {
        driver: 'cop', aiMode: 'chase', nodeA: node.idx, nodeB: link.node
      });
    v.sirenOn = true;
    return v;
  }

  spawnGang(type, x, z, heading) {
    return this.spawnAt(type, x, z, heading, { driver: 'gang', aiMode: 'traffic' });
  }

  nearest(pos, maxDist = 4) {
    let best = null, bd = maxDist;
    for (const v of this.all) {
      if (v.removed) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt, game) {
    // Distance LOD: a detailed car is ~10 draw calls, and from a viewpoint that
    // sees the whole grid all 37 of them were being drawn. Past 135 m they are a
    // few pixels, so stop drawing them; the simulation keeps running.
    const cp = game.camera.position;
    for (const v of this.all) {
      const d = Math.hypot(v.pos.x - cp.x, v.pos.z - cp.z);
      // Keep the street readable while holding the strict swept budget: cars
      // beyond 45 m are not individually legible, and culling them here avoids
      // paying a full body + wheels for traffic that is only a few pixels high.
      v.mesh.visible = d < 45 || v === game.player.vehicle;
    }
    for (let i = this.all.length - 1; i >= 0; i--) {
      const v = this.all[i];
      v.update(dt, game);
      if (v.removed) this.all.splice(i, 1);
    }

    // car vs car
    for (let i = 0; i < this.all.length; i++) {
      const a = this.all[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.all.length; j++) {
        const b = this.all[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = 2.6;
        if (d < min && d > 0.001) {
          const nx = dx / d, nz = dz / d;
          const push = (min - d) * 0.5;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          const rel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
          if (rel < -3) {
            const imp = Math.min(30, -rel);
            a.velocity.x += nx * imp * 0.35; a.velocity.z += nz * imp * 0.35;
            b.velocity.x -= nx * imp * 0.35; b.velocity.z -= nz * imp * 0.35;
            a.damage(imp * 4); b.damage(imp * 4);
            if (a.isPlayer || b.isPlayer) {
              game.audio.play('crash', Math.min(1, imp / 20));
              game.cam.shake(0.3, 0.15);
            }
          }
        }
      }
    }

    // keep traffic around the player
    this.trafficTimer -= dt;
    if (this.trafficTimer <= 0) {
      this.trafficTimer = 0.8;
      const p = game.player.pos;
      let traffic = 0;
      for (const v of this.all) {
        if (v.driver === 'ai') traffic++;
        const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
        const vis = d < (v.driver === 'cop' ? 220 : 150);
        if (v.mesh.visible !== vis) v.mesh.visible = vis;
        if (v.driver === 'ai' && d > 320) v.remove();
      }
      if (traffic < this.maxTraffic) {
        this.spawnTraffic();
      }
    }
  }
}
