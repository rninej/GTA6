// Small math / helper library used across the game.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a || 1);
export const smooth = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const sign = (v) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

// Deterministic RNG so the city is identical every launch.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + this.r() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  weighted(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let roll = this.r() * total;
    for (const [v, w] of pairs) { roll -= w; if (roll <= 0) return v; }
    return pairs[pairs.length - 1][0];
  }
}

export function formatMoney(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function timeString(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---- AABB helpers (XZ plane) ----
export function aabbOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
export function pointInAabb(x, z, b) {
  return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
}
export function circleAabb(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
export function resolveCircleAabb(pos, r, b) {
  const cx = clamp(pos.x, b.minX, b.maxX);
  const cz = clamp(pos.z, b.minZ, b.maxZ);
  let dx = pos.x - cx, dz = pos.z - cz;
  let d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 < 1e-6) {
    // centre inside box: push out on the shortest axis
    const dl = pos.x - b.minX, dr = b.maxX - pos.x;
    const db = pos.z - b.minZ, df = b.maxZ - pos.z;
    const m = Math.min(dl, dr, db, df);
    if (m === dl) pos.x = b.minX - r;
    else if (m === dr) pos.x = b.maxX + r;
    else if (m === db) pos.z = b.minZ - r;
    else pos.z = b.maxZ + r;
    return true;
  }
  const d = Math.sqrt(d2);
  pos.x = cx + (dx / d) * r;
  pos.z = cz + (dz / d) * r;
  return true;
}

// Ray vs AABB slab test (3D, used for bullets)
export function rayAabb(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  const axes = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY ?? 0, b.maxY ?? 60],
    [oz, dz, b.minZ, b.maxZ]
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return -1; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Ray vs sphere
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  return tca - thc;
}

export function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
}

export function noiseFill(g, w, h, amount, alpha, rng) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  g.putImageData(img, 0, 0);
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}
