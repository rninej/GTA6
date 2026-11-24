// Palma City — photographic material library.
//
// Every set here is a CC0 (public domain) scan from Poly Haven: a tileable
// albedo, a tangent-space normal map and a roughness map, all 1024 px. The
// source URL and licence for each one is recorded in CREDITS.md. Nothing is
// taken from a commercial game; the geometry, layout and signage in Palma City
// remain original work.
//
// The images are plain files under public/textures/ for the Electron build.
// The browser build resolves them through assetUrl(), which bakes each one in
// as a data: URL so a page opened from disk needs no requests at all.
import * as THREE from 'three';
import { canvas2d } from '../core/utils.js';
import { assetUrl } from './asset-map.js';

let ANISO = 8;
export function setPhotoAnisotropy(v) { ANISO = v; }

// metres = the real-world size one tile of the photograph covers. Used to keep
// texel density consistent instead of eyeballing UV repeats.
export const PHOTO_SETS = {
  asphalt: { id: 'asphalt_02', metres: 4.0 },
  paving: { id: 'precast_stone_paving', metres: 2.4 },
  brick: { id: 'red_brick', metres: 1.7 },
  plaster: { id: 'painted_plaster_wall', metres: 3.2 },
  concrete: { id: 'concrete_wall_008', metres: 2.6 },
  metal: { id: 'corrugated_iron_02', metres: 2.2 }
};

const registry = new Map();
const failed = [];

export const photo = (name) => registry.get(name) || null;
export const photoCount = () => registry.size;
export const photoFailures = () => failed.slice();
export const photoMetres = (name) => (PHOTO_SETS[name] ? PHOTO_SETS[name].metres : 1);

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = assetUrl(url);
  });
}

function makeTex(img, srgb) {
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Average colour of the photograph, used to normalise the facade detail layer
// so multiplying it in does not darken or tint the wall.
function meanColor(img) {
  const N = 16;
  const { c, g } = canvas2d(N, N);
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  const col = new THREE.Color();
  col.setStyle(`rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`);
  return col;
}

export async function loadPhotoTextures(onStep) {
  const names = Object.keys(PHOTO_SETS);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const def = PHOTO_SETS[name];
    const base = `textures/${def.id}`;
    try {
      const [diff, nor, rough] = await Promise.all([
        loadImage(`${base}_diff.jpg`),
        loadImage(`${base}_nor_gl.jpg`).catch(() => null),
        loadImage(`${base}_rough.jpg`).catch(() => null)
      ]);
      registry.set(name, {
        id: def.id,
        metres: def.metres,
        image: diff,
        map: makeTex(diff, true),
        normalMap: nor ? makeTex(nor, false) : null,
        roughnessMap: rough ? makeTex(rough, false) : null,
        mean: meanColor(diff)
      });
    } catch (err) {
      failed.push(def.id);
      console.warn('[palma] photo set unavailable, using procedural fallback:', def.id);
    }
    if (onStep) onStep(name, i + 1, names.length);
  }
  return registry.size;
}

// Clone with an explicit tiling repeat. Clones share the decoded image but carry
// their own repeat, which is what lets one 1024 px set dress several surfaces.
export function photoMaterial(name, rx, ry, { normal = true, rough = true } = {}) {
  const set = registry.get(name);
  if (!set) return null;
  const out = {};
  const clone = (src) => {
    if (!src) return null;
    const t = src.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  };
  out.map = clone(set.map);
  if (normal && set.normalMap) out.normalMap = clone(set.normalMap);
  if (rough && set.roughnessMap) out.roughnessMap = clone(set.roughnessMap);
  out.mean = set.mean;
  return out;
}
