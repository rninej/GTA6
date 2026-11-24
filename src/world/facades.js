// Palma City — high-resolution procedural facade library.
// Four material families (glass curtain wall, punched masonry, stucco with
// shutters, deco ribbing) drawn at 1024 px over a 24 m tile, with per-window
// variation (blinds, curtains, lit rooms, dirty glass) and a height map used by
// a parallax shader so windows read as recessed openings instead of decals.
import * as THREE from 'three';
import { RNG, canvas2d, clamp } from '../core/utils.js';
import { photoMaterial, photoMetres } from './photos.js';

export const FACADE_TILE = 24;      // metres covered by one texture tile
const S = 1024;                     // colour map resolution
const HS = 512;                     // height + emissive resolution
const BAYS = 6;
const FLOORS = 8;
const CW = S / BAYS;
const CH = S / FLOORS;

let ANISO = 8;
export function setFacadeAnisotropy(v) { ANISO = v; }

const cache = new Map();

function mkTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const g255 = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

function noise(g, w, h, rng, amount) {
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

function streaks(g, x, y, w, len, rng, alpha = 0.12) {
  const grd = g.createLinearGradient(0, y, 0, y + len);
  grd.addColorStop(0, `rgba(28,26,22,${alpha})`);
  grd.addColorStop(0.6, `rgba(28,26,22,${alpha * 0.45})`);
  grd.addColorStop(1, 'rgba(28,26,22,0)');
  g.fillStyle = grd;
  g.fillRect(x, y, w, len);
}

/* ------------------------------ palettes ------------------------------ */
const PAL = {
  glass: [
    { wall: '#2b4652', mullion: '#5d7f8c', spandrel: '#1b2c34', glass: [26, 54, 66], interior: '#0a1418', accent: '#78a6b8' },
    { wall: '#35505c', mullion: '#6d8f9b', spandrel: '#20333b', glass: [30, 62, 74], interior: '#0c1619', accent: '#8ab6c6' },
    { wall: '#26424d', mullion: '#557787', spandrel: '#17272f', glass: [22, 48, 62], interior: '#091215', accent: '#6f9cae' },
    { wall: '#3b5560', mullion: '#7a9aa6', spandrel: '#24373f', glass: [34, 68, 78], interior: '#0d181b', accent: '#96c2d2' }
  ],
  masonry: [
    { wall: '#8e5a44', mortar: '#c8bba8', trim: '#e3d9c6', glass: [30, 44, 50], interior: '#120d0b', accent: '#5d3a2c' },
    { wall: '#a3765c', mortar: '#d8cbb6', trim: '#efe6d4', glass: [34, 48, 52], interior: '#141010', accent: '#6d4a38' },
    { wall: '#7d4e3c', mortar: '#c2b6a2', trim: '#ded3c0', glass: [28, 42, 48], interior: '#100c0a', accent: '#54342a' },
    { wall: '#b08668', mortar: '#e2d6c2', trim: '#f4ecdc', glass: [36, 50, 54], interior: '#161212', accent: '#78543e' }
  ],
  // Near-white walls: the per-building pastel tint in city.js supplies the
  // colour, so a beige base would muddy every coral and mint front.
  stucco: [
    { wall: '#f4eee4', trim: '#fffaf2', glass: [32, 52, 58], interior: '#0f1113', accent: '#7a8a63', shutter: '#8aa79a' },
    { wall: '#f2e9dd', trim: '#fffdf7', glass: [30, 50, 56], interior: '#121011', accent: '#a2694a', shutter: '#6d8f9e' },
    { wall: '#f6f1e9', trim: '#ffffff', glass: [34, 54, 60], interior: '#101214', accent: '#8a6a86', shutter: '#b98a6a' },
    { wall: '#f0ece6', trim: '#fffbf4', glass: [28, 48, 54], interior: '#111315', accent: '#5f7f8a', shutter: '#7f9a6a' }
  ],
  deco: [
    { wall: '#f8f1e8', trim: '#fffaf2', glass: [28, 60, 72], interior: '#0d1416', accent: '#e6a29a', rib: '#fff6ea' },
    { wall: '#eef4f1', trim: '#ffffff', glass: [26, 56, 66], interior: '#0c1315', accent: '#8fc9c1', rib: '#f2faf7' },
    { wall: '#f7efe6', trim: '#fff8ee', glass: [30, 58, 70], interior: '#0d1214', accent: '#c9a0d8', rib: '#fdf2e6' },
    { wall: '#f1f3ee', trim: '#ffffff', glass: [24, 54, 64], interior: '#0b1214', accent: '#e8c46a', rib: '#f6fbf4' }
  ]
};

// each family is dressed with a real CC0 wall scan; the glass curtain wall keeps
// its own tinted glazing instead of a photograph
const WALL_PHOTO = { masonry: 'brick', stucco: 'plaster', deco: 'concrete', glass: null };

const STYLE_MAP = {
  glass: 'glass', deco: 'deco', stucco: 'stucco', hotel: 'stucco',
  brick: 'masonry', concrete: 'masonry', shopfront: 'stucco'
};

/* --------------------------- window painting --------------------------- */
// kind: 'grid' | 'punched' | 'shutter' | 'ribbed'
function paintWindow(g, eg, hg, x, y, w, h, rng, p, kind, floor) {
  // ---- interior volume (what you see through the glass) ----
  const ig = g.createLinearGradient(0, y, 0, y + h);
  ig.addColorStop(0, p.interior);
  ig.addColorStop(0.55, '#1a1a1a');
  ig.addColorStop(1, '#0d0d0d');
  g.fillStyle = ig;
  g.fillRect(x, y, w, h);

  // room light
  const lit = rng.next() < (floor === 0 ? 0.28 : 0.36);
  const warm = rng.next() < 0.72;
  if (lit) {
    const lc = warm ? [255, 206, 148] : [188, 222, 255];
    const lg = g.createRadialGradient(x + w * 0.5, y + h * 0.62, 2, x + w * 0.5, y + h * 0.62, w * 0.95);
    lg.addColorStop(0, `rgba(${lc[0]},${lc[1]},${lc[2]},0.92)`);
    lg.addColorStop(0.6, `rgba(${lc[0]},${lc[1]},${lc[2]},0.55)`);
    lg.addColorStop(1, `rgba(${lc[0]},${lc[1]},${lc[2]},0.12)`);
    g.fillStyle = lg;
    g.fillRect(x, y, w, h);
    // a silhouette: plant / furniture / person
    g.fillStyle = 'rgba(12,10,8,0.55)';
    const sh = rng.int(0, 2);
    if (sh === 0) g.fillRect(x + w * 0.12, y + h * 0.45, w * 0.16, h * 0.55);
    else if (sh === 1) {
      g.beginPath(); g.ellipse(x + w * 0.72, y + h * 0.72, w * 0.13, h * 0.3, 0, 0, 6.28); g.fill();
    } else g.fillRect(x + w * 0.55, y + h * 0.6, w * 0.3, h * 0.12);

    eg.fillStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},${warm ? 0.92 : 0.8})`;
    eg.fillRect(x, y, w, h);
    eg.fillStyle = 'rgba(0,0,0,0.45)';
    if (sh === 0) eg.fillRect(x + w * 0.12, y + h * 0.45, w * 0.16, h * 0.55);
  }

  // ---- glazing: reflection sweep + per-pane tint ----
  const tint = p.glass;
  const rg = g.createLinearGradient(x, y, x + w, y + h);
  const sky = 18 + rng.next() * 26;
  rg.addColorStop(0, `rgba(${tint[0] + sky},${tint[1] + sky + 8},${tint[2] + sky + 10},${0.30 + rng.next() * 0.18})`);
  rg.addColorStop(0.45, `rgba(${tint[0]},${tint[1]},${tint[2]},0.20)`);
  rg.addColorStop(1, `rgba(${tint[0] + 8},${tint[1] + 10},${tint[2] + 12},0.30)`);
  g.fillStyle = rg;
  g.fillRect(x, y, w, h);

  // Unlit panes at midday are mirrors, not holes: without this the interior
  // gradient showed through and every unlit window read as a black rectangle
  // punched in the wall, which is what made whole facades look wrong.
  if (!lit) {
    const refl = g.createLinearGradient(x, y, x, y + h);
    refl.addColorStop(0, `rgba(${150 + sky},${182 + sky},${200 + sky},0.5)`);
    refl.addColorStop(0.6, `rgba(${112 + sky},${140 + sky},${156 + sky},0.34)`);
    refl.addColorStop(1, `rgba(${74 + sky},${96 + sky},${110 + sky},0.2)`);
    g.fillStyle = refl;
    g.fillRect(x, y, w, h);
  }

  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  // reflection sweep: offsets and slope are randomised per window, otherwise
  // every pane shares one angle and the tile reads as a diagonal lattice
  g.fillStyle = `rgba(200,232,255,${0.05 + rng.next() * 0.05})`;
  const rTop = 0.1 + rng.next() * 0.45;
  const rBot = rTop + 0.25 + rng.next() * 0.3;
  const rSlope = (rng.next() - 0.5) * 0.5;
  const rW = 0.55 + rng.next() * 0.45;
  g.beginPath();
  g.moveTo(x, y + h * rTop);
  g.lineTo(x + w * rW, y + h * (rTop + rSlope));
  g.lineTo(x + w * rW, y + h * (rBot + rSlope));
  g.lineTo(x, y + h * rBot);
  g.fill();
  g.restore();

  // ---- treatments: blinds / curtains / bare / dirty ----
  const t = rng.next();
  if (t < 0.42) {
    const frac = 0.25 + rng.next() * 0.65;
    const bh = h * frac;
    const bc = 190 + rng.int(-24, 24);
    g.fillStyle = `rgba(${bc},${bc - 6},${bc - 18},0.88)`;
    g.fillRect(x, y, w, bh);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let sy = y + 3; sy < y + bh; sy += 5) g.fillRect(x, sy, w, 1.4);
    if (lit) { eg.fillStyle = 'rgba(255,214,164,0.22)'; eg.fillRect(x, y, w, bh); }
  } else if (t < 0.62) {
    const cc = rng.pick(['#8d5f52', '#5d6f7d', '#a8935f', '#6a5a74', '#7a7f6a']);
    g.fillStyle = cc;
    g.globalAlpha = 0.8;
    g.fillRect(x, y, w * (0.18 + rng.next() * 0.2), h);
    g.fillRect(x + w * (0.62 + rng.next() * 0.2), y, w * 0.3, h);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let sx = x + 4; sx < x + w; sx += 9) g.fillRect(sx, y, 1.2, h);
  } else if (t < 0.78) {
    // dirty glass
    g.fillStyle = `rgba(120,120,112,${0.10 + rng.next() * 0.14})`;
    g.fillRect(x, y, w, h);
    streaks(g, x + rng.next() * w * 0.6, y, w * 0.3, h * 1.6, rng, 0.16);
  }

  // ---- frame / reveal ----
  const fr = 3;
  g.strokeStyle = kind === 'ribbed' ? p.trim : (p.trim || '#e8e2d6');
  g.lineWidth = fr * 2;
  g.strokeRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x, y, w, 4);              // reveal shadow at the head
  g.fillRect(x, y, 4, h);              // and down the jamb
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.fillRect(x + 4, y + h - 4, w - 4, 3);

  // ---- height map: glass is deep, frame is flush ----
  hg.fillStyle = g255(kind === 'grid' ? 26 : 18);
  hg.fillRect(x, y, w, h);
  hg.fillStyle = g255(230);
  hg.fillRect(x, y, w, 5);
  hg.fillRect(x, y, 5, h);
  hg.fillRect(x, y + h - 5, w, 5);
  hg.fillRect(x + w - 5, y, 5, h);

  return { lit, warm };
}

function windowCells(cb, wr = 0.56, hr = 0.5) {
  for (let f = 0; f < FLOORS; f++) {
    for (let b = 0; b < BAYS; b++) {
      const w = CW * wr, h = CH * hr;
      cb(b * CW + (CW - w) / 2, f * CH + (CH - h) / 2, w, h, f, b);
    }
  }
}

/* ------------------------------ styles ------------------------------ */
function drawGlass(g, eg, hg, rng, p) {
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#2f4d59'); grd.addColorStop(0.5, p.wall); grd.addColorStop(1, '#16262d');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  // spandrels between floors
  for (let f = 0; f <= FLOORS; f++) {
    g.fillStyle = p.spandrel;
    g.fillRect(0, f * CH - 12, S, 24);
    g.fillStyle = p.accent; g.globalAlpha = 0.28;
    g.fillRect(0, f * CH - 2, S, 2);
    g.globalAlpha = 1;
    hg.fillStyle = g255(235); hg.fillRect(0, f * CH - 12, S, 24);
  }
  // mullions
  for (let b = 0; b <= BAYS; b++) {
    g.fillStyle = p.mullion; g.fillRect(b * CW - 4, 0, 8, S);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(b * CW + 3, 0, 2, S);
    hg.fillStyle = g255(240); hg.fillRect(b * CW - 4, 0, 8, S);
  }

  windowCells((x, y, w, h, f) => {
    paintWindow(g, eg, hg, x, y, w, h, rng, p, 'grid', f);
    // slim mullion through the pane
    g.fillStyle = 'rgba(70,96,106,0.5)';
    g.fillRect(x + w * 0.5 - 1.5, y, 3, h);
  }, 0.9, 0.74);

  // large diagonal glare across the whole facade
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gl = g.createLinearGradient(0, S, S, 0);
  gl.addColorStop(0.30, 'rgba(150,220,255,0)');
  gl.addColorStop(0.42, 'rgba(150,220,255,0.09)');
  gl.addColorStop(0.52, 'rgba(150,220,255,0)');
  g.fillStyle = gl; g.fillRect(0, 0, S, S);
  g.restore();
}

function drawMasonry(g, eg, hg, rng, p) {
  g.fillStyle = p.wall; g.fillRect(0, 0, S, S);
  hg.fillStyle = g255(250); hg.fillRect(0, 0, S, S);

  // brick courses
  const bh = 13, bw = 34;
  for (let y = 0; y < S; y += bh) {
    const off = (Math.floor(y / bh) % 2) * (bw / 2);
    for (let x = -bw; x < S; x += bw) {
      const v = rng.next();
      const r = 122 + v * 52, gg = 74 + v * 38, b = 58 + v * 30;
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
    }
  }
  // mortar wash
  g.fillStyle = 'rgba(206,196,180,0.10)'; g.fillRect(0, 0, S, S);

  windowCells((x, y, w, h, f) => {
    // stone surround
    g.fillStyle = p.trim;
    g.fillRect(x - 9, y - 9, w + 18, h + 18);
    hg.fillStyle = g255(225);
    hg.fillRect(x - 9, y - 9, w + 18, h + 18);

    paintWindow(g, eg, hg, x, y, w, h, rng, p, 'punched', f);

    // sash bars
    g.fillStyle = 'rgba(238,236,228,0.85)';
    g.fillRect(x, y + h * 0.5 - 2, w, 4);
    g.fillRect(x + w * 0.5 - 2, y, 4, h);

    // sill + lintel
    g.fillStyle = p.trim;
    g.fillRect(x - 13, y + h + 4, w + 26, 8);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x - 13, y + h + 12, w + 26, 4);
    g.fillStyle = p.trim;
    g.fillRect(x - 11, y - 16, w + 22, 8);

    // dirt streaking under the sill
    streaks(g, x + rng.next() * w * 0.5, y + h + 16, w * 0.35, 90 + rng.next() * 90, rng, 0.14);

    // occasional window AC unit
    if (rng.next() < 0.18) {
      g.fillStyle = '#8d9095';
      g.fillRect(x + w * 0.2, y + h - 16, w * 0.6, 18);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let k = 0; k < 4; k++) g.fillRect(x + w * 0.22, y + h - 13 + k * 4, w * 0.56, 1.5);
    }
  }, 0.44, 0.5);

  // fire escape shadows on some bays
  if (rng.next() < 0.5) {
    const bx = rng.int(1, BAYS - 2) * CW;
    g.fillStyle = 'rgba(20,20,22,0.30)';
    for (let f = 0; f < FLOORS; f++) g.fillRect(bx - 6, f * CH + CH * 0.2, CW + 12, 5);
    g.fillRect(bx - 6, 0, 4, S);
    g.fillRect(bx + CW + 2, 0, 4, S);
  }
  noise(g, S, S, rng, 14);
}

function drawStucco(g, eg, hg, rng, p) {
  g.fillStyle = p.wall; g.fillRect(0, 0, S, S);
  hg.fillStyle = g255(248); hg.fillRect(0, 0, S, S);
  noise(g, S, S, rng, 12);

  // floor banding
  for (let f = 0; f <= FLOORS; f++) {
    g.fillStyle = p.trim; g.globalAlpha = 0.55;
    g.fillRect(0, f * CH - 5, S, 9);
    g.globalAlpha = 1;
    hg.fillStyle = g255(238); hg.fillRect(0, f * CH - 5, S, 9);
  }

  windowCells((x, y, w, h, f) => {
    // reveal
    g.fillStyle = p.trim; g.fillRect(x - 8, y - 8, w + 16, h + 16);
    hg.fillStyle = g255(220); hg.fillRect(x - 8, y - 8, w + 16, h + 16);
    paintWindow(g, eg, hg, x, y, w, h, rng, p, 'shutter', f);

    // shutters
    const sw = w * 0.22;
    for (const side of [-1, 1]) {
      const sx = side < 0 ? x - sw - 4 : x + w + 4;
      g.fillStyle = p.shutter;
      g.fillRect(sx, y - 4, sw, h + 8);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (let k = 0; k < 12; k++) g.fillRect(sx + 2, y + 2 + k * (h / 12), sw - 4, 2);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(sx, y - 4, 2, h + 8);
      hg.fillStyle = g255(150); hg.fillRect(sx, y - 4, sw, h + 8);
    }

    // sill and a small balcony rail on upper floors
    g.fillStyle = p.trim; g.fillRect(x - 12, y + h + 5, w + 24, 7);
    if (f > 0 && rng.next() < 0.45) {
      const railY = y + h + 10;
      g.strokeStyle = 'rgba(40,40,44,0.7)'; g.lineWidth = 2;
      g.strokeRect(x - 14, railY, w + 28, 26);
      for (let k = 0; k <= 8; k++) {
        const rx = x - 14 + ((w + 28) / 8) * k;
        g.beginPath(); g.moveTo(rx, railY); g.lineTo(rx, railY + 26); g.stroke();
      }
      hg.fillStyle = g255(200); hg.fillRect(x - 14, railY, w + 28, 4);
    }
    streaks(g, x + rng.next() * w * 0.4, y + h + 12, w * 0.4, 70 + rng.next() * 80, rng, 0.1);
  }, 0.42, 0.5);
}

function drawDeco(g, eg, hg, rng, p) {
  g.fillStyle = p.wall; g.fillRect(0, 0, S, S);
  hg.fillStyle = g255(250); hg.fillRect(0, 0, S, S);

  // vertical ribbing
  for (let b = 0; b < BAYS; b++) {
    const x = b * CW;
    g.fillStyle = p.rib; g.fillRect(x + CW * 0.06, 0, CW * 0.06, S);
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + CW * 0.12, 0, CW * 0.03, S);
    hg.fillStyle = g255(245); hg.fillRect(x + CW * 0.06, 0, CW * 0.09, S);
  }
  // horizontal banding
  for (let f = 0; f <= FLOORS; f++) {
    g.fillStyle = p.trim; g.fillRect(0, f * CH - 4, S, 8);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, f * CH + 4, S, 3);
    hg.fillStyle = g255(236); hg.fillRect(0, f * CH - 4, S, 8);
  }

  windowCells((x, y, w, h, f) => {
    g.fillStyle = p.trim; g.fillRect(x - 7, y - 7, w + 14, h + 14);
    hg.fillStyle = g255(226); hg.fillRect(x - 7, y - 7, w + 14, h + 14);

    // rounded deco head
    g.save();
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x, y + h * 0.42);
    g.quadraticCurveTo(x + w / 2, y - h * 0.22, x + w, y + h * 0.42);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.clip();
    paintWindow(g, eg, hg, x, y, w, h, rng, p, 'ribbed', f);
    g.restore();

    // chrome eyebrow
    g.strokeStyle = p.accent; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x - 6, y + h * 0.44);
    g.quadraticCurveTo(x + w / 2, y - h * 0.26, x + w + 6, y + h * 0.44);
    g.stroke();

    g.fillStyle = p.trim; g.fillRect(x - 12, y + h + 5, w + 24, 7);
    streaks(g, x + rng.next() * w * 0.5, y + h + 12, w * 0.3, 80 + rng.next() * 70, rng, 0.09);
  }, 0.5, 0.5);
}

const DRAWERS = { glass: drawGlass, masonry: drawMasonry, stucco: drawStucco, deco: drawDeco };

/* ------------------------------ API ------------------------------ */
export function getFacade(style, variant) {
  const fam = STYLE_MAP[style] || 'stucco';
  const key = `facade2:${fam}:${variant}`;
  return cache.get(key) || (() => {
    const pal = PAL[fam][variant % PAL[fam].length];
    const rng = new RNG(4000 + variant * 977 + fam.length * 131 + fam.charCodeAt(0) * 7);
    const col = canvas2d(S, S);
    const emi = canvas2d(S, S);
    const hgt = canvas2d(S, S);
    emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);
    hgt.g.fillStyle = g255(255); hgt.g.fillRect(0, 0, S, S);
    DRAWERS[fam](col.g, emi.g, hgt.g, rng, pal);

    const emiSmall = canvas2d(HS, HS);
    emiSmall.g.drawImage(emi.c, 0, 0, HS, HS);
    const hgtSmall = canvas2d(HS, HS);
    hgtSmall.g.drawImage(hgt.c, 0, 0, HS, HS);

    const wallKey = WALL_PHOTO[fam] || null;
    const wallRepeat = wallKey ? FACADE_TILE / photoMetres(wallKey) : 1;
    const wall = wallKey ? photoMaterial(wallKey, wallRepeat, wallRepeat) : null;

    const out = {
      map: mkTex(col.c),
      emissiveMap: mkTex(emiSmall.c),
      heightMap: mkTex(hgtSmall.c, false),
      wallKey,
      wallRepeat,
      wallMap: wall ? wall.map : null,
      wallMean: wall ? wall.mean : null,
      normalMap: wall ? wall.normalMap : null,
      roughnessMap: wall ? wall.roughnessMap : null,
      metalness: fam === 'glass' ? 0.55 : 0.04,
      roughness: fam === 'glass' ? 0.18 : 0.86,
      palette: pal,
      family: fam
    };
    cache.set(key, out);
    return out;
  })();
}

/* --------------------------- sign atlas --------------------------- */
const SIGN_NAMES = [
  'CAFÉ CUBANO', 'SUNSET LIQUORS', 'PALMA PAWN', 'TATTOO', 'TIKI BAR', 'SURF SHACK',
  'CHECK CASHING', 'LA PALMA', 'CLUB SOL', 'BAIL BONDS', 'EL TIBURÓN', '24/7 MART',
  'MOTEL AZUL', 'DINER', 'PESCADERÍA', 'FLORIST', 'VINYL', 'BARBERÍA',
  'LAUNDROMAT', 'PHARMACY', 'LIQUOR', 'AUTO PARTS', 'NOODLE BAR', 'SUSHI',
  'PIZZA', 'GYM', 'NAILS', 'TACOS', 'HARDWARE', 'BOOKS', 'DONUTS', 'CIGARS'
];
const SIGN_COLORS = [
  ['#1a1030', '#ff3d7f'], ['#04121c', '#22e0ff'], ['#140d05', '#ffd447'],
  ['#0b1a12', '#7dff9e'], ['#1c0a06', '#ff8a3d'], ['#120018', '#ff5cf0'],
  ['#0a0a0a', '#ffffff'], ['#1a0505', '#ff4d4d']
];

export function getSignAtlas() {
  return cache.get('signAtlas') || (() => {
    const W = 2048, H = 1024, COLS = 8, ROWS = 4;
    const cw = W / COLS, ch = H / ROWS;
    const { c, g } = canvas2d(W, H);
    const rng = new RNG(9182);
    for (let i = 0; i < COLS * ROWS; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = col * cw, y = row * ch;
      const name = SIGN_NAMES[i % SIGN_NAMES.length];
      const [bg, fg] = SIGN_COLORS[i % SIGN_COLORS.length];
      g.fillStyle = bg; g.fillRect(x, y, cw, ch);
      // frame
      g.strokeStyle = fg; g.lineWidth = 6; g.globalAlpha = 0.85;
      g.strokeRect(x + 10, y + 10, cw - 20, ch - 20);
      g.globalAlpha = 1;
      // glow bar
      const grd = g.createLinearGradient(x, y, x, y + ch);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      grd.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = grd; g.fillRect(x, y, cw, ch);
      // text, auto-fit
      let fs = 92;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${fs}px Arial Black, Impact, sans-serif`;
      while (g.measureText(name).width > cw - 48 && fs > 26) {
        fs -= 4;
        g.font = `900 ${fs}px Arial Black, Impact, sans-serif`;
      }
      g.shadowColor = fg; g.shadowBlur = 26;
      g.fillStyle = fg;
      g.fillText(name, x + cw / 2, y + ch * 0.46);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.globalAlpha = 0.35;
      g.fillText(name, x + cw / 2, y + ch * 0.46);
      g.globalAlpha = 1;
      // small sub-line for variety
      if (i % 3 === 0) {
        g.font = '600 20px Arial, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillText(rng.pick(['OPEN LATE', 'EST. 1987', 'NO CHECKS', 'DELIVERY', 'SINCE 1974', 'CASH ONLY']), x + cw / 2, y + ch * 0.8);
      }
    }
    const out = { map: mkTex(c), cols: COLS, rows: ROWS };
    cache.set('signAtlas', out);
    return out;
  })();
}

/* --------------------- parallax depth shader --------------------- */
let WHITE = null;
function whiteTex() {
  if (!WHITE) {
    WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    WHITE.needsUpdate = true;
  }
  return WHITE;
}

export function applyFacadeDepth(mat, fac) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeight = { value: fac.heightMap };
    shader.uniforms.uWall = { value: fac.wallMap || whiteTex() };
    shader.uniforms.uWallRepeat = { value: fac.wallRepeat || 1 };
    shader.uniforms.uWallMean = { value: fac.wallMean || new THREE.Color(0.5, 0.5, 0.5) };
    shader.uniforms.uWallAmt = { value: fac.wallMap ? 1 : 0 };
    shader.uniforms.uDepth = { value: fac.family === 'glass' ? 0.05 : 0.07 };
    shader.uniforms.uInterior = { value: new THREE.Color(0x06090b) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uHeight;
        uniform float uDepth;
        uniform vec3 uInterior;
        uniform sampler2D uWall;
        uniform float uWallRepeat;
        uniform vec3 uWallMean;
        uniform float uWallAmt;`)
      .replace('#include <map_fragment>', `
        vec2 fUv = vMapUv;
        vec3 fV = normalize(-vViewPosition);
        vec3 fN = normalize(vNormal);
        vec3 fdp1 = dFdx(-vViewPosition);
        vec3 fdp2 = dFdy(-vViewPosition);
        vec2 fduv1 = dFdx(fUv);
        vec2 fduv2 = dFdy(fUv);
        vec3 fT = cross(fdp2, fN) * fduv1.x + cross(fN, fdp1) * fduv2.x;
        vec3 fB = cross(fdp2, fN) * fduv1.y + cross(fN, fdp1) * fduv2.y;
        vec3 fVt = vec3(dot(fV, fT), dot(fV, fB), dot(fV, fN));
        fVt = normalize(fVt);
        float h0 = texture2D(uHeight, fUv).r;
        // parallax strength falls off at grazing angles, and the offset is
        // clamped, so oblique views cannot smear the facade into streaks
        float facing = smoothstep(0.12, 0.55, abs(fVt.z));
        vec2 off = fVt.xy * (uDepth * facing) * (1.0 - h0);
        float om = length(off);
        if (om > 0.009) off *= 0.009 / om;
        vec2 uv1 = fUv - off;
        float h1 = texture2D(uHeight, uv1).r;
        vec2 uv2 = fUv - off * (0.65 + 0.35 * (1.0 - h1));
        vec4 sampledDiffuseColor = texture2D(map, uv2);
        diffuseColor *= sampledDiffuseColor;
        // real wall material on top of the painted facade: the photograph is
        // normalised by its own mean so it adds surface texture without
        // shifting the palette, and the height map keeps it off the glazing
        if (uWallAmt > 0.5) {
          vec3 wallC = texture2D(uWall, fUv * uWallRepeat).rgb;
          wallC /= max(uWallMean, vec3(0.03));
          float wallMask = smoothstep(0.70, 0.90, h0);
          diffuseColor.rgb *= mix(vec3(1.0), wallC, wallMask * 0.92);
        }
        float deep = smoothstep(0.55, 0.02, h1);
        diffuseColor.rgb = mix(diffuseColor.rgb, uInterior, deep * 0.55);
      `);
  };
  mat.customProgramCacheKey = () => 'facade-depth-v4';
}
