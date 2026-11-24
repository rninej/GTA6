// Palma City — procedural hi-resolution texture library.
// Everything is generated at runtime on <canvas> so the app ships no copyrighted art.
import * as THREE from 'three';
import { RNG, canvas2d, clamp } from '../core/utils.js';
import { setFacadeAnisotropy } from './facades.js';
import { photo, photoMaterial, photoMetres } from './photos.js';

let ANISO = 8;
export function setAnisotropy(v) { ANISO = v; setFacadeAnisotropy(v); }

const cache = new Map();

function toTex(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  let v = cache.get(key);
  if (!v) { v = fn(); cache.set(key, v); }
  return v;
}

function grain(g, w, h, amount, rng) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  g.putImageData(img, 0, 0);
}

function streaks(g, w, h, rng, count, alpha = 0.08) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h * 0.5;
    const len = h * (0.2 + rng.next() * 0.6);
    const wd = 4 + rng.next() * 22;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, `rgba(20,18,14,${alpha})`);
    grd.addColorStop(1, 'rgba(20,18,14,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, wd, len);
  }
}

/* ============================== GROUND ============================== */

export function getAsphalt() {
  return cached('asphalt', () => {
    const p = photo('asphalt');
    if (p) {
      const t = p.map.clone();
      t.repeat.set(1, 1);
      t.needsUpdate = true;
      return t;
    }
    const S = 1024, rng = new RNG(11);
    const { c, g } = canvas2d(S, S);
    g.fillStyle = '#33353a'; g.fillRect(0, 0, S, S);
    // aggregate speckle
    for (let i = 0; i < 42000; i++) {
      const v = 40 + rng.next() * 90;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rng.next() * 0.4})`;
      g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 2.4, 1 + rng.next() * 2.4);
    }
    // patches
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${22 + rng.next() * 26},${22 + rng.next() * 26},${24 + rng.next() * 26},0.22)`;
      g.beginPath();
      const x = rng.next() * S, y = rng.next() * S, r = 20 + rng.next() * 120;
      g.ellipse(x, y, r, r * (0.4 + rng.next() * 0.8), rng.next() * 6.28, 0, 6.28);
      g.fill();
    }
    // cracks
    g.strokeStyle = 'rgba(14,14,16,0.55)';
    for (let i = 0; i < 16; i++) {
      g.lineWidth = 0.8 + rng.next() * 1.6;
      g.beginPath();
      let x = rng.next() * S, y = rng.next() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rng.next() - 0.5) * 90; y += (rng.next() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    grain(g, S, S, 16, rng);
    return toTex(c, { repeat: [1, 1] });
  });
}

/* ---------------------------- road surface ---------------------------- */
// The photographic asphalt and the painted markings are composited into one
// canvas, and a matching roughness map is built in the same pass so the paint
// always reads glossier than the aggregate around it.
const ROAD_W = 20;   // metres of carriageway across one tile
const ROAD_L = 12;   // metres of length

function buildRoad() {
  return cached('roadBuild', () => {
    const S = 1024;
    const rng = new RNG(23);
    const col = canvas2d(S, S);
    const rgh = canvas2d(S, S);
    const g = col.g, r = rgh.g;
    const px = S / ROAD_W, py = S / ROAD_L;
    const p = photo('asphalt');

    if (p) {
      const tx = Math.round((p.metres / ROAD_W) * S);
      const ty = Math.round((p.metres / ROAD_L) * S);
      for (let y = 0; y < S; y += ty) for (let x = 0; x < S; x += tx) g.drawImage(p.image, x, y, tx, ty);
      if (p.roughnessMap) {
        for (let y = 0; y < S; y += ty) for (let x = 0; x < S; x += tx) r.drawImage(p.roughnessMap.image, x, y, tx, ty);
      } else {
        r.fillStyle = 'rgb(232,232,232)'; r.fillRect(0, 0, S, S);
      }
    } else {
      g.fillStyle = '#33353a'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 42000; i++) {
        const v = 40 + rng.next() * 90;
        g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rng.next() * 0.4})`;
        g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 2.4, 1 + rng.next() * 2.4);
      }
      r.fillStyle = 'rgb(232,232,232)'; r.fillRect(0, 0, S, S);
    }

    // GTA-style asphalt: multiply the photographic base down before the paint
    // goes on, so the carriageway is near-black while the markings stay bright.
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(112,112,120)';
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';

    // tyre polish: darker and smoother in the wheel tracks
    for (const lane of [-7.4, -2.6, 2.6, 7.4]) {
      const x = S / 2 + lane * px;
      const grd = g.createLinearGradient(x - 0.6 * px, 0, x + 0.6 * px, 0);
      grd.addColorStop(0, 'rgba(20,20,22,0)');
      grd.addColorStop(0.5, 'rgba(20,20,22,0.28)');
      grd.addColorStop(1, 'rgba(20,20,22,0)');
      g.fillStyle = grd; g.fillRect(x - 0.6 * px, 0, 1.2 * px, S);
      const rgr = r.createLinearGradient(x - 0.6 * px, 0, x + 0.6 * px, 0);
      rgr.addColorStop(0, 'rgba(0,0,0,0)');
      rgr.addColorStop(0.5, 'rgba(0,0,0,0.3)');
      rgr.addColorStop(1, 'rgba(0,0,0,0)');
      r.fillStyle = rgr; r.fillRect(x - 0.6 * px, 0, 1.2 * px, S);
    }

    // painted markings, drawn into both maps: the paint is smoother than asphalt
    const marks = [];
    marks.push([S / 2 - 0.32 * px, 0, 0.14 * px, S, '#d8b038']);
    marks.push([S / 2 + 0.18 * px, 0, 0.14 * px, S, '#d8b038']);
    for (const off of [-5, 5]) {
      const x = S / 2 + off * px;
      for (let y = 0; y < S; y += 3 * py) marks.push([x - 0.06 * px, y, 0.12 * px, 1.6 * py, '#e6e6e1']);
    }
    marks.push([0.4 * px, 0, 0.12 * px, S, 'rgba(226,226,220,0.8)']);
    marks.push([S - 0.52 * px, 0, 0.12 * px, S, 'rgba(226,226,220,0.8)']);
    for (const m of marks) {
      g.fillStyle = m[4]; g.fillRect(m[0], m[1], m[2], m[3]);
      r.fillStyle = 'rgb(74,74,74)'; r.fillRect(m[0], m[1], m[2], m[3]);
    }

    // tar seams
    g.strokeStyle = 'rgba(16,16,18,0.5)';
    for (let i = 0; i < 5; i++) {
      g.lineWidth = 2 + rng.next() * 3;
      g.beginPath();
      let x = rng.next() * S;
      g.moveTo(x, -10);
      for (let y = 0; y <= S + 10; y += 64) { x += (rng.next() - 0.5) * 26; g.lineTo(x, y); }
      g.stroke();
    }

    // worn paint: scuff the lines with asphalt-coloured flecks
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(44,44,47,${0.18 + rng.next() * 0.42})`;
      g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 5, 1 + rng.next() * 4);
    }

    return { map: toTex(col.c), roughnessMap: toTex(rgh.c, { srgb: false }) };
  });
}

export function getRoad() { return buildRoad().map; }
export function getRoadRoughness() { return buildRoad().roughnessMap; }

export function getRoadNormal() {
  return cached('roadNormal', () => {
    const p = photo('asphalt');
    if (!p || !p.normalMap) return null;
    const t = p.normalMap.clone();
    t.repeat.set(ROAD_W / p.metres, ROAD_L / p.metres);
    t.needsUpdate = true;
    return t;
  });
}

export function getCrosswalk() {
  return cached('crosswalk', () => {
    const W = 512, H = 256, rng = new RNG(31);
    const { c, g } = canvas2d(W, H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(228,226,218,0.6)';
    for (let x = 8; x < W - 8; x += 48) g.fillRect(x, 14, 24, H - 28);
    // worn effect: light scuffing only, keeps the stripes crisp
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${rng.next() * 0.35})`;
      g.fillRect(rng.next() * W, rng.next() * H, 1.5 + rng.next() * 4, 1.5 + rng.next() * 3);
    }
    g.globalCompositeOperation = 'source-over';
    return toTex(c);
  });
}

export function getSidewalk() {
  return cached('sidewalk', () => {
    const p = photo('paving');
    if (p) {
      const t = p.map.clone();
      t.repeat.set(1, 1);
      t.needsUpdate = true;
      return t;
    }
    const S = 512, rng = new RNG(41);
    const { c, g } = canvas2d(S, S); // 8 m tile
    g.fillStyle = '#8b8882'; g.fillRect(0, 0, S, S);
    const cell = S / 4; // 2 m slabs
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = 128 + rng.next() * 20;
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        g.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      }
    }
    g.strokeStyle = 'rgba(70,68,64,0.55)'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(S, i * cell); g.stroke();
    }
    for (let i = 0; i < 9000; i++) {
      const v = 110 + rng.next() * 80;
      g.fillStyle = `rgba(${v},${v},${v - 5},0.25)`;
      g.fillRect(rng.next() * S, rng.next() * S, 1.5, 1.5);
    }
    // stains
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(60,58,52,${0.05 + rng.next() * 0.08})`;
      g.beginPath(); g.ellipse(rng.next() * S, rng.next() * S, 20 + rng.next() * 60, 14 + rng.next() * 40, 0, 0, 6.28); g.fill();
    }
    grain(g, S, S, 10, rng);
    return toTex(c);
  });
}

export function getSand() {
  return cached('sand', () => {
    const S = 512, rng = new RNG(53);
    const { c, g } = canvas2d(S, S);
    g.fillStyle = '#c2ab82'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 30000; i++) {
      const v = 160 + rng.next() * 50;
      g.fillStyle = `rgba(${v},${v - 14},${v - 55},${0.25 + rng.next() * 0.4})`;
      g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 2, 1 + rng.next() * 2);
    }
    // ripples
    g.strokeStyle = 'rgba(140,118,84,0.35)';
    for (let i = 0; i < 40; i++) {
      g.lineWidth = 1 + rng.next() * 2;
      g.beginPath();
      const y0 = rng.next() * S;
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.03 + i) * 8);
      g.stroke();
    }
    grain(g, S, S, 14, rng);
    return toTex(c);
  });
}

export function getGrass() {
  return cached('grass', () => {
    const S = 512, rng = new RNG(61);
    const { c, g } = canvas2d(S, S);
    g.fillStyle = '#4b6b38'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const r = 40 + rng.next() * 40, gg = 75 + rng.next() * 60, b = 30 + rng.next() * 30;
      g.strokeStyle = `rgba(${r},${gg},${b},${0.3 + rng.next() * 0.5})`;
      g.lineWidth = 1;
      const x = rng.next() * S, y = rng.next() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng.next() - 0.5) * 4, y - 3 - rng.next() * 5); g.stroke();
    }
    return toTex(c);
  });
}

export function getRoof() {
  return cached('roof', () => {
    const S = 512, rng = new RNG(71);
    const { c, g } = canvas2d(S, S);
    g.fillStyle = '#6c6a66'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 24000; i++) {
      const v = 70 + rng.next() * 70;
      g.fillStyle = `rgba(${v},${v},${v - 4},0.4)`;
      g.fillRect(rng.next() * S, rng.next() * S, 2, 2);
    }
    g.strokeStyle = 'rgba(40,40,40,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
    }
    grain(g, S, S, 18, rng);
    return toTex(c);
  });
}

/* ============================== FACADES ============================== */

const S = 768;
const BAYS = 4;
const FLOORS = 5;
const CW = S / BAYS;
const CH = S / FLOORS;

function windowCells(cb, wr = 0.56, hr = 0.5) {
  for (let f = 0; f < FLOORS; f++) {
    for (let b = 0; b < BAYS; b++) {
      const w = CW * wr, h = CH * hr;
      cb(b * CW + (CW - w) / 2, f * CH + (CH - h) / 2, w, h, f, b);
    }
  }
}

function litWindow(eg, x, y, w, h, rng, warm = true) {
  if (rng.next() > 0.42) return;
  const grd = eg.createLinearGradient(x, y, x, y + h);
  if (warm) { grd.addColorStop(0, 'rgba(255,214,150,0.95)'); grd.addColorStop(1, 'rgba(255,168,86,0.55)'); }
  else { grd.addColorStop(0, 'rgba(190,232,255,0.9)'); grd.addColorStop(1, 'rgba(120,190,255,0.4)'); }
  eg.fillStyle = grd;
  eg.fillRect(x, y, w, h);
  // silhouettes / blinds
  eg.fillStyle = 'rgba(0,0,0,0.35)';
  if (rng.next() > 0.5) eg.fillRect(x, y + h * 0.55, w, h * 0.45);
  if (rng.next() > 0.7) eg.fillRect(x + w * (0.2 + rng.next() * 0.5), y + h * 0.3, w * 0.16, h * 0.7);
}

function glassPane(g, x, y, w, h, rng, tint = [26, 58, 70]) {
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, `rgb(${tint[0] + 12},${tint[1] + 18},${tint[2] + 20})`);
  grd.addColorStop(0.45, `rgb(${tint[0]},${tint[1]},${tint[2]})`);
  grd.addColorStop(1, `rgb(${tint[0] + 26},${tint[1] + 34},${tint[2] + 30})`);
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  // sky reflection sweep
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(200,235,255,0.10)';
  g.beginPath();
  g.moveTo(x, y + h * 0.15); g.lineTo(x + w, y - h * 0.2);
  g.lineTo(x + w, y + h * 0.28); g.lineTo(x, y + h * 0.62);
  g.fill();
  g.restore();
}

const PALETTES = {
  deco: [
    { wall: '#f2d8c4', trim: '#fbf3e8', glass: [28, 62, 74], accent: '#e9a7a0' },
    { wall: '#cfe4dd', trim: '#ffffff', glass: [24, 58, 66], accent: '#8fd0c8' },
    { wall: '#f6c7cf', trim: '#fff6f2', glass: [30, 60, 70], accent: '#f39ab0' },
    { wall: '#e7dfc6', trim: '#fffaf0', glass: [26, 56, 64], accent: '#d9b86c' }
  ],
  glass: [
    { wall: '#24424d', trim: '#3a5560', glass: [30, 66, 78], accent: '#4a7280' },
    { wall: '#2a4a55', trim: '#456470', glass: [34, 74, 86], accent: '#5a8290' }
  ],
  stucco: [
    { wall: '#ded3bd', trim: '#f4ede0', glass: [34, 54, 58], accent: '#7a8a63' },
    { wall: '#e8ddcb', trim: '#fff8ec', glass: [30, 50, 54], accent: '#5d7a86' },
    { wall: '#d9c3a8', trim: '#f7ecd9', glass: [36, 54, 56], accent: '#8a6a4a' }
  ],
  brick: [
    { wall: '#8d5a44', trim: '#e6dccb', glass: [34, 46, 50], accent: '#5d3a2c' },
    { wall: '#a06a50', trim: '#eadfce', glass: [30, 44, 48], accent: '#6b4433' }
  ],
  concrete: [
    { wall: '#8b8d8c', trim: '#b9bab8', glass: [40, 52, 54], accent: '#5c5f60' },
    { wall: '#9a9b96', trim: '#c6c6c1', glass: [38, 50, 52], accent: '#6a6c6b' }
  ],
  hotel: [
    { wall: '#f7f2e8', trim: '#ffffff', glass: [26, 62, 74], accent: '#6fd3c8' },
    { wall: '#f2e6ef', trim: '#ffffff', glass: [30, 58, 70], accent: '#f19ab6' },
    { wall: '#eef1e6', trim: '#ffffff', glass: [26, 60, 68], accent: '#f0c26a' }
  ],
  shopfront: [
    { wall: '#e3d6c3', trim: '#fff7ea', glass: [24, 40, 46], accent: '#e0457b' },
    { wall: '#d6dcd6', trim: '#ffffff', glass: [22, 42, 46], accent: '#2aa7a0' },
    { wall: '#e8d9cf', trim: '#fff5ec', glass: [26, 42, 48], accent: '#f0a13c' }
  ]
};

function drawDeco(bg, eg, rng, p) {
  bg.fillStyle = p.wall; bg.fillRect(0, 0, S, S);
  // vertical pilasters
  for (let b = 0; b <= BAYS; b++) {
    bg.fillStyle = p.trim; bg.globalAlpha = 0.55;
    bg.fillRect(b * CW - 9, 0, 18, S);
    bg.globalAlpha = 1;
  }
  // floor bands
  for (let f = 0; f <= FLOORS; f++) {
    bg.fillStyle = p.trim; bg.globalAlpha = 0.75;
    bg.fillRect(0, f * CH - 7, S, 14);
    bg.globalAlpha = 1;
  }
  windowCells((x, y, w, h) => {
    bg.fillStyle = p.trim; bg.fillRect(x - 9, y - 9, w + 18, h + 18);
    glassPane(bg, x, y, w, h, rng, p.glass);
    // eyebrow ledge
    bg.fillStyle = p.accent; bg.fillRect(x - 16, y - 20, w + 32, 8);
    litWindow(eg, x, y, w, h, rng, rng.next() > 0.25);
  }, 0.54, 0.48);
  streaks(bg, S, S, rng, 26, 0.05);
}

function drawGlass(bg, eg, rng, p) {
  const grd = bg.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#1d3b46'); grd.addColorStop(0.5, p.wall); grd.addColorStop(1, '#0f2027');
  bg.fillStyle = grd; bg.fillRect(0, 0, S, S);
  // spandrels
  for (let f = 0; f <= FLOORS; f++) {
    bg.fillStyle = 'rgba(8,16,20,0.85)'; bg.fillRect(0, f * CH - 12, S, 24);
    bg.fillStyle = p.accent; bg.globalAlpha = 0.35; bg.fillRect(0, f * CH - 3, S, 3); bg.globalAlpha = 1;
  }
  for (let b = 0; b <= BAYS; b++) {
    bg.fillStyle = 'rgba(70,92,100,0.8)'; bg.fillRect(b * CW - 4, 0, 8, S);
  }
  windowCells((x, y, w, h) => {
    glassPane(bg, x - 2, y - 2, w + 4, h + 4, rng, p.glass);
    // mullion
    bg.fillStyle = 'rgba(60,82,90,0.55)';
    bg.fillRect(x + w * 0.5 - 2, y, 4, h);
    litWindow(eg, x, y, w, h, rng, rng.next() > 0.5);
  }, 0.86, 0.74);
  // big diagonal glare
  bg.save();
  bg.globalCompositeOperation = 'lighter';
  const gl = bg.createLinearGradient(0, S, S, 0);
  gl.addColorStop(0.32, 'rgba(150,220,255,0)');
  gl.addColorStop(0.42, 'rgba(150,220,255,0.10)');
  gl.addColorStop(0.5, 'rgba(150,220,255,0)');
  bg.fillStyle = gl; bg.fillRect(0, 0, S, S);
  bg.restore();
}

function drawStucco(bg, eg, rng, p) {
  bg.fillStyle = p.wall; bg.fillRect(0, 0, S, S);
  grain(bg, S, S, 12, rng);
  windowCells((x, y, w, h, f, b) => {
    bg.fillStyle = p.trim; bg.fillRect(x - 7, y - 7, w + 14, h + 14);
    glassPane(bg, x, y, w, h, rng, p.glass);
    // shutters
    bg.fillStyle = p.accent;
    bg.fillRect(x - 26, y - 4, 18, h + 8);
    bg.fillRect(x + w + 8, y - 4, 18, h + 8);
    bg.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 5; i++) bg.fillRect(x - 26, y + (h / 5) * i + 4, 18, 2);
    // sill
    bg.fillStyle = p.trim; bg.fillRect(x - 14, y + h + 6, w + 28, 7);
    if (f === FLOORS - 1 && rng.next() > 0.55) {
      // balcony
      bg.fillStyle = 'rgba(0,0,0,0.16)'; bg.fillRect(x - 30, y + h + 16, w + 60, 12);
      bg.fillStyle = p.trim; bg.fillRect(x - 30, y + h + 13, w + 60, 5);
      bg.strokeStyle = p.trim; bg.lineWidth = 3;
      for (let i = 0; i <= 10; i++) {
        const rx = x - 30 + ((w + 60) / 10) * i;
        bg.beginPath(); bg.moveTo(rx, y + h + 16); bg.lineTo(rx, y + h + 42); bg.stroke();
      }
    }
    litWindow(eg, x, y, w, h, rng, true);
  }, 0.5, 0.46);
  streaks(bg, S, S, rng, 20, 0.06);
}

function drawBrick(bg, eg, rng, p) {
  bg.fillStyle = '#c9b8a2'; bg.fillRect(0, 0, S, S);
  const bh = 22, bw = 62;
  for (let y = 0; y < S; y += bh) {
    const off = (Math.floor(y / bh) % 2) * (bw / 2);
    for (let x = -bw; x < S; x += bw) {
      const v = rng.next();
      const r = 125 + v * 45, gg = 74 + v * 34, b = 56 + v * 26;
      bg.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      bg.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
    }
  }
  windowCells((x, y, w, h) => {
    bg.fillStyle = p.trim; bg.fillRect(x - 10, y - 10, w + 20, h + 20);
    bg.fillStyle = '#2a3236';
    bg.beginPath();
    bg.moveTo(x, y + h);
    bg.lineTo(x, y + h * 0.35);
    bg.quadraticCurveTo(x + w / 2, y - h * 0.28, x + w, y + h * 0.35);
    bg.lineTo(x + w, y + h);
    bg.closePath(); bg.fill();
    glassPane(bg, x + 4, y + h * 0.3, w - 8, h * 0.66, rng, p.glass);
    bg.fillStyle = p.accent; bg.fillRect(x - 16, y + h + 8, w + 32, 9);
    litWindow(eg, x, y + h * 0.3, w, h * 0.7, rng, true);
  }, 0.46, 0.52);
  streaks(bg, S, S, rng, 30, 0.07);
}

function drawConcrete(bg, eg, rng, p) {
  bg.fillStyle = p.wall; bg.fillRect(0, 0, S, S);
  grain(bg, S, S, 22, rng);
  for (let f = 0; f <= FLOORS; f++) {
    bg.fillStyle = 'rgba(0,0,0,0.13)'; bg.fillRect(0, f * CH - 3, S, 6);
  }
  for (let b = 0; b <= BAYS; b++) {
    bg.fillStyle = 'rgba(0,0,0,0.10)'; bg.fillRect(b * CW - 2, 0, 4, S);
  }
  windowCells((x, y, w, h) => {
    const ww = w * 0.8, hh = h * 0.4;
    const xx = x + (w - ww) / 2, yy = y + (h - hh) / 2;
    bg.fillStyle = '#1e2528'; bg.fillRect(xx, yy, ww, hh);
    bg.fillStyle = 'rgba(140,160,165,0.25)'; bg.fillRect(xx + 3, yy + 3, ww - 6, hh * 0.35);
    bg.fillStyle = '#6b6d6c'; bg.fillRect(xx - 6, yy + hh, ww + 12, 6);
    litWindow(eg, xx, yy, ww, hh, rng, false);
  }, 0.6, 0.6);
  // rust streaks
  for (let i = 0; i < 12; i++) {
    const x = rng.next() * S, y = rng.next() * S * 0.7;
    const grd = bg.createLinearGradient(0, y, 0, y + 140);
    grd.addColorStop(0, 'rgba(120,70,40,0.28)');
    grd.addColorStop(1, 'rgba(120,70,40,0)');
    bg.fillStyle = grd; bg.fillRect(x, y, 8 + rng.next() * 14, 140);
  }
  // roller door on the bottom
  bg.fillStyle = '#5d5f5e'; bg.fillRect(CW * 1.1, S - CH * 0.82, CW * 1.8, CH * 0.8);
  bg.strokeStyle = 'rgba(30,30,30,0.5)'; bg.lineWidth = 3;
  for (let i = 0; i < 10; i++) {
    const y = S - CH * 0.8 + i * (CH * 0.08);
    bg.beginPath(); bg.moveTo(CW * 1.1, y); bg.lineTo(CW * 2.9, y); bg.stroke();
  }
}

function drawHotel(bg, eg, rng, p) {
  bg.fillStyle = p.wall; bg.fillRect(0, 0, S, S);
  for (let f = 0; f <= FLOORS; f++) {
    // balcony slab
    bg.fillStyle = 'rgba(0,0,0,0.18)'; bg.fillRect(0, f * CH - 4, S, 10);
    bg.fillStyle = '#f2f0ea'; bg.fillRect(0, f * CH - 10, S, 12);
    bg.strokeStyle = 'rgba(240,240,235,0.95)'; bg.lineWidth = 3;
    for (let i = 0; i < 32; i++) {
      const x = (S / 32) * i;
      bg.beginPath(); bg.moveTo(x, f * CH - 10); bg.lineTo(x, f * CH - 40); bg.stroke();
    }
    bg.fillStyle = 'rgba(240,240,235,0.9)'; bg.fillRect(0, f * CH - 43, S, 4);
    bg.fillStyle = p.accent; bg.globalAlpha = 0.5; bg.fillRect(0, f * CH + 2, S, 5); bg.globalAlpha = 1;
  }
  windowCells((x, y, w, h) => {
    bg.fillStyle = '#e9e6de'; bg.fillRect(x - 6, y - 6, w + 12, h + 12);
    glassPane(bg, x, y, w, h, rng, p.glass);
    bg.fillStyle = 'rgba(255,255,255,0.55)';
    bg.fillRect(x + w * 0.5 - 2, y, 4, h);
    litWindow(eg, x, y, w, h, rng, rng.next() > 0.4);
  }, 0.66, 0.52);
}

function drawShopfront(bg, eg, rng, p) {
  bg.fillStyle = p.wall; bg.fillRect(0, 0, S, S);
  grain(bg, S, S, 10, rng);
  // upper windows
  for (let b = 0; b < BAYS; b++) {
    const x = b * CW + CW * 0.24, y = CH * 0.16, w = CW * 0.52, h = CH * 0.46;
    bg.fillStyle = p.trim; bg.fillRect(x - 8, y - 8, w + 16, h + 16);
    glassPane(bg, x, y, w, h, rng, p.glass);
    litWindow(eg, x, y, w, h, rng, true);
  }
  // sign band
  bg.fillStyle = p.accent; bg.fillRect(0, CH * 0.86, S, CH * 0.2);
  bg.fillStyle = 'rgba(0,0,0,0.18)'; bg.fillRect(0, CH * 0.86, S, 6);
  // shop glass + awnings on lower half
  bg.fillStyle = '#20292c'; bg.fillRect(0, S * 0.52, S, S * 0.48);
  for (let b = 0; b < BAYS; b++) {
    const x = b * CW + 8, w = CW - 16, y = S * 0.56, h = S * 0.4;
    glassPane(bg, x, y, w, h, rng, [18, 34, 40]);
    bg.fillStyle = 'rgba(255,235,200,0.35)'; bg.fillRect(x + 10, y + h * 0.55, w - 20, h * 0.35);
    // awning stripes
    for (let i = 0; i < 8; i++) {
      bg.fillStyle = i % 2 ? '#f2efe6' : p.accent;
      bg.fillRect(x + (w / 8) * i, y - 34, w / 8, 34);
    }
    litWindow(eg, x + 10, y + h * 0.55, w - 20, h * 0.35, rng, true);
  }
  // door
  bg.fillStyle = '#161d20'; bg.fillRect(S * 0.44, S * 0.58, S * 0.12, S * 0.4);
  bg.fillStyle = 'rgba(180,220,240,0.18)'; bg.fillRect(S * 0.45, S * 0.59, S * 0.1, S * 0.36);
}

// Facade materials live in facades.js: higher resolution, four families with
// per-window variation, and a parallax height map for recessed glazing.
export { getFacade, getSignAtlas, setFacadeAnisotropy, FACADE_TILE } from './facades.js';
export { photoMaterial, photoMetres } from './photos.js';

/* ============================== SIGNAGE ============================== */

export function getBillboard(i) {
  return cached(`bill:${i}`, () => {
    const W = 1024, H = 512;
    const { c, g } = canvas2d(W, H);
    const rng = new RNG(200 + i);
    const designs = [
      () => {
        const grd = g.createLinearGradient(0, 0, W, H);
        grd.addColorStop(0, '#ff2f6d'); grd.addColorStop(0.55, '#ff7a3d'); grd.addColorStop(1, '#ffd36e');
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.beginPath(); g.roundRect(150, 120, 180, 300, 40); g.fill();
        g.fillStyle = '#e8332f'; g.fillRect(150, 200, 180, 120);
        g.fillStyle = '#fff'; g.font = 'italic 900 92px Arial Black, sans-serif';
        g.fillText('SUNSET', 370, 240);
        g.font = '900 92px Arial Black, sans-serif';
        g.fillText('COLA', 370, 330);
        g.font = '700 30px Arial, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillText('TASTE THE GOLDEN HOUR', 372, 392);
      },
      () => {
        g.fillStyle = '#0b2540'; g.fillRect(0, 0, W, H);
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, '#1a5f9e'); grd.addColorStop(1, '#7fd6ff');
        g.fillStyle = grd; g.beginPath();
        g.moveTo(0, H); g.lineTo(0, H * 0.55); g.quadraticCurveTo(W * 0.5, H * 0.2, W, H * 0.6); g.lineTo(W, H); g.fill();
        g.fillStyle = '#fff'; g.font = '900 86px Arial Black, sans-serif';
        g.fillText('PALMA AIR', 60, 140);
        g.font = '600 30px Arial, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillText('NONSTOP TO EVERYWHERE', 64, 190);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.moveTo(720, 330); g.lineTo(980, 250); g.lineTo(860, 380); g.closePath(); g.fill();
      },
      () => {
        g.fillStyle = '#10031c'; g.fillRect(0, 0, W, H);
        g.shadowColor = '#ff3df0'; g.shadowBlur = 40;
        g.fillStyle = '#ff5cf0'; g.font = '900 120px Arial Black, sans-serif';
        g.fillText('NEON', 80, 220);
        g.fillStyle = '#5cf0ff'; g.fillText('NIGHTS', 300, 350);
        g.shadowBlur = 0;
        g.fillStyle = '#fff'; g.font = '700 40px Arial, sans-serif';
        g.fillText('88.1 FM', 700, 200);
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '500 26px Arial, sans-serif';
        g.fillText('THE SOUND OF PALMA', 660, 250);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(255,92,240,${0.15 + rng.next() * 0.4})`;
          g.fillRect(rng.next() * W, rng.next() * H, 3, 3);
        }
      },
      () => {
        g.fillStyle = '#f6f2e8'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#0f8f88';
        g.beginPath(); g.moveTo(0, H * 0.75); g.quadraticCurveTo(W * 0.3, H * 0.5, W * 0.6, H * 0.8);
        g.quadraticCurveTo(W * 0.85, H, W, H * 0.7); g.lineTo(W, H); g.lineTo(0, H); g.fill();
        g.fillStyle = '#111'; g.font = '900 78px Arial Black, sans-serif';
        g.fillText('CORAL HEIGHTS', 56, 150);
        g.font = '600 34px Arial, sans-serif'; g.fillStyle = '#3a3a3a';
        g.fillText('LIVE ABOVE THE WATER', 60, 205);
        g.fillStyle = '#e0457b'; g.fillRect(60, 240, 320, 74);
        g.fillStyle = '#fff'; g.font = '800 34px Arial, sans-serif';
        g.fillText('FROM $1.2M', 88, 290);
      },
      () => {
        g.fillStyle = '#08080a'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#ff2d55';
        g.beginPath();
        g.moveTo(120, 400); g.lineTo(300, 300); g.lineTo(520, 290); g.lineTo(700, 340);
        g.lineTo(860, 330); g.lineTo(900, 400); g.closePath(); g.fill();
        g.fillStyle = '#1a1a1e';
        g.beginPath(); g.moveTo(280, 300); g.lineTo(380, 220); g.lineTo(600, 220); g.lineTo(680, 300); g.closePath(); g.fill();
        g.fillStyle = '#0d0d10';
        g.beginPath(); g.arc(320, 400, 56, 0, 6.28); g.fill();
        g.beginPath(); g.arc(760, 400, 56, 0, 6.28); g.fill();
        g.fillStyle = '#fff'; g.font = '900 88px Arial Black, sans-serif';
        g.fillText('VULCANO', 60, 120);
        g.fillStyle = '#ff2d55'; g.font = '700 40px Arial, sans-serif';
        g.fillText('GT · 720 HP', 64, 175);
      },
      () => {
        g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 64) for (let x = 0; x < W; x += 64) {
          if (((x / 64) + (y / 64)) % 2 === 0) { g.fillStyle = '#f2f2f2'; g.fillRect(x, y, 64, 64); }
        }
        g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(90, 150, 840, 210);
        g.fillStyle = '#ffd447'; g.font = '900 96px Arial Black, sans-serif';
        g.fillText('PALMA GP', 120, 270);
        g.fillStyle = '#fff'; g.font = '600 28px Arial, sans-serif';
        g.fillText('STREET CIRCUIT · THIS SUNDAY', 124, 320);
      }
    ];
    designs[i % designs.length]();
    // grime + frame
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 12); g.fillRect(0, H - 12, W, 12);
    return toTex(c);
  });
}

export function getNeon(text, color = '#ff3d7f', size = 128) {
  return cached(`neon:${text}:${color}:${size}`, () => {
    const pad = 40;
    const { c, g } = canvas2d(1024, 320);
    g.clearRect(0, 0, 1024, 320);
    g.font = `900 ${size}px Arial Black, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 46;
    g.fillStyle = color;
    g.fillText(text, 512, 150);
    g.fillText(text, 512, 150);
    g.shadowBlur = 12;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(text, 512, 150);
    g.globalAlpha = 1;
    return toTex(c);
  });
}

export function getShopSign(text, bg = '#0d0f14', fg = '#ffd447') {
  return cached(`shop:${text}:${bg}:${fg}`, () => {
    const { c, g } = canvas2d(512, 128);
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(8, 8, 496, 112);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 64;
    g.font = `800 ${fs}px Arial Black, sans-serif`;
    while (g.measureText(text).width > 440 && fs > 24) { fs -= 4; g.font = `800 ${fs}px Arial Black, sans-serif`; }
    g.fillText(text, 256, 68);
    return toTex(c);
  });
}

export function getStreetSign(text) {
  return cached(`street:${text}`, () => {
    const { c, g } = canvas2d(512, 128);
    g.fillStyle = '#12603c'; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#e9f5ee'; g.lineWidth = 5; g.strokeRect(6, 6, 500, 116);
    g.fillStyle = '#eef7f1'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 54px Arial, sans-serif';
    g.fillText(text, 256, 68);
    return toTex(c);
  });
}

export function getPlate(text) {
  return cached(`plate:${text}`, () => {
    const { c, g } = canvas2d(256, 128);
    g.fillStyle = '#f0efe6'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#9a9a90'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = '#12213a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 58px Arial, sans-serif';
    g.fillText(text, 128, 60);
    g.font = '600 20px Arial, sans-serif'; g.fillStyle = '#b03a2e';
    g.fillText('PALMA COUNTY', 128, 104);
    return toTex(c);
  });
}

export function getParticle() {
  return cached('particle', () => {
    const S2 = 128;
    const { c, g } = canvas2d(S2, S2);
    const grd = g.createRadialGradient(S2 / 2, S2 / 2, 0, S2 / 2, S2 / 2, S2 / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S2, S2);
    return toTex(c);
  });
}

// Radial falloff used twice by the street-lamp batch: the ground pool under a
// lamp samples the whole disc, and the lamp head itself samples its centre, so
// one map and one draw call cover both.
export function getLampGlow() {
  return cached('lampglow', () => {
    const S2 = 256;
    const { c, g } = canvas2d(S2, S2);
    const grd = g.createRadialGradient(S2 / 2, S2 / 2, 0, S2 / 2, S2 / 2, S2 / 2);
    grd.addColorStop(0.0, 'rgba(255,255,255,0.72)');
    grd.addColorStop(0.3, 'rgba(255,252,240,0.44)');
    grd.addColorStop(0.66, 'rgba(255,246,222,0.15)');
    grd.addColorStop(1.0, 'rgba(255,240,210,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S2, S2);
    return toTex(c);
  });
}

export function getPalmFrond() {
  return cached('frond', () => {
    const W = 256, H = 512;
    const { c, g } = canvas2d(W, H);
    g.clearRect(0, 0, W, H);
    // soft leaf blade for mass
    const blade = g.createLinearGradient(0, H, 0, 0);
    blade.addColorStop(0, 'rgba(48,88,38,0.95)');
    blade.addColorStop(0.55, 'rgba(66,112,46,0.9)');
    blade.addColorStop(1, 'rgba(38,72,30,0.55)');
    g.fillStyle = blade;
    g.beginPath();
    g.moveTo(W / 2, H);
    g.bezierCurveTo(W * 0.18, H * 0.7, W * 0.06, H * 0.35, W * 0.16, 8);
    g.lineTo(W * 0.5, 20);
    g.lineTo(W * 0.84, 8);
    g.bezierCurveTo(W * 0.94, H * 0.35, W * 0.82, H * 0.7, W / 2, H);
    g.closePath();
    g.fill();
    // leaflets
    for (let i = 0; i < 44; i++) {
      const t = i / 44;
      const y = H - 6 - t * (H - 26);
      const len = (118 * Math.sin(Math.PI * (0.1 + t * 0.9))) * (1 - t * 0.18);
      for (const sgn of [-1, 1]) {
        const grd = g.createLinearGradient(W / 2, y, W / 2 + sgn * len, y - len * 0.5);
        grd.addColorStop(0, '#5c8c3a');
        grd.addColorStop(1, '#2c4c1e');
        g.strokeStyle = grd;
        g.lineWidth = 7.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(W / 2, y);
        g.quadraticCurveTo(W / 2 + sgn * len * 0.6, y - len * 0.1, W / 2 + sgn * len, y - len * 0.55);
        g.stroke();
      }
    }
    // rib
    g.strokeStyle = '#7a6a3a'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 14); g.stroke();
    return toTex(c);
  });
}

export function getSkyEnvCanvas(hour, sunDirY) {
  const W = 1024, H = 512;
  const { c, g } = canvas2d(W, H);
  const day = clamp((sunDirY + 0.25) / 0.85, 0, 1);
  const dusk = Math.exp(-Math.pow((sunDirY - 0.02) / 0.16, 2));
  const top = new THREE.Color().setHSL(0.6, 0.62, 0.08 + day * 0.42);
  const bot = new THREE.Color().setHSL(0.07 + day * 0.02, 0.55 * (0.3 + dusk), 0.1 + day * 0.66);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, `#${top.getHexString()}`);
  grd.addColorStop(0.48, `#${top.clone().lerp(bot, 0.5).getHexString()}`);
  grd.addColorStop(0.56, `#${bot.getHexString()}`);
  grd.addColorStop(1, '#0b0d12');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (dusk > 0.15) {
    const sg = g.createRadialGradient(W * 0.5, H * 0.54, 0, W * 0.5, H * 0.54, W * 0.42);
    sg.addColorStop(0, `rgba(255,180,90,${0.55 * dusk})`);
    sg.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
  }
  // cloud band
  const rng = new RNG(9);
  for (let i = 0; i < 40; i++) {
    const y = H * (0.2 + rng.next() * 0.3);
    g.fillStyle = `rgba(255,255,255,${0.02 + rng.next() * 0.05 * (0.3 + day)})`;
    g.beginPath();
    g.ellipse(rng.next() * W, y, 60 + rng.next() * 160, 8 + rng.next() * 22, 0, 0, 6.28);
    g.fill();
  }
  return c;
}

export function getPalmTrunk() {
  return cached('trunk', () => {
    const W = 128, H = 512, rng = new RNG(77);
    const { c, g } = canvas2d(W, H);
    g.fillStyle = '#6b5a44'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 22) {
      g.fillStyle = `rgba(${60 + rng.next() * 30},${48 + rng.next() * 24},${34 + rng.next() * 18},0.85)`;
      g.beginPath(); g.ellipse(W / 2, y, W / 2, 9, 0, 0, 6.28); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + 10, W, 4);
    }
    grain(g, W, H, 14, rng);
    return toTex(c);
  });
}

export function disposeTextures() { cache.clear(); }
