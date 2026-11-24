// Palma City — authored material sets for manufactured surfaces.
//
// Car paint, glazing, tyre rubber, chrome and painted street furniture are
// uniform manufactured coatings: there is no tileable photograph of them at a
// useful scale, so they are authored here at 1024 px instead of scanned. Every
// map in this file is original work generated on a <canvas>: a colour map, a
// height map converted to a tangent-space normal with a Sobel filter, and a
// roughness map. No commercial asset is involved — see CREDITS.md, which labels
// each set "authored" and each photographic set with its Poly Haven source.
import * as THREE from 'three';
import { RNG, canvas2d, clamp } from '../core/utils.js';

let ANISO = 8;
export function setSurfaceAnisotropy(v) { ANISO = v; }

const TILE = 1024;      // every authored set is 1024 x 1024
const cache = new Map();

// Repeat is part of the set's definition: the same texture object is shared by
// every material that uses it, so tiling is set once here and never mutated.
function scaled(set) {
  const [rx, ry] = set.scale || [1, 1];
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (set[k]) set[k].repeat.set(rx, ry);
  }
  return set;
}
const cached = (key, fn) => {
  let v = cache.get(key);
  if (!v) { v = fn(); cache.set(key, v); }
  return v;
};

function toTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/* ------------------------- height → normal ------------------------- */
// Sobel gradient over a wrapping height map, written as a tangent-space normal
// map (OpenGL convention, +Y up). This is a real conversion, not a painted
// normal: every bump in the normal comes from a height field.
function normalFromHeight(heightCanvas, strength = 1) {
  const S = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, S, S).data;
  const out = canvas2d(S, S);
  const img = out.g.createImageData(S, S);
  const d = img.data;
  const h = (x, y) => {
    const xx = x < 0 ? x + S : x >= S ? x - S : x;
    const yy = y < 0 ? y + S : y >= S ? y - S : y;
    return src[(yy * S + xx) * 4] / 255;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const tl = h(x - 1, y - 1), tc = h(x, y - 1), tr = h(x + 1, y - 1);
      const ml = h(x - 1, y), mr = h(x + 1, y);
      const bl = h(x - 1, y + 1), bc = h(x, y + 1), br = h(x + 1, y + 1);
      const dx = (tl + 2 * ml + bl) - (tr + 2 * mr + br);
      const dy = (tl + 2 * tc + tr) - (bl + 2 * bc + br);
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * S + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  out.g.putImageData(img, 0, 0);
  return out.c;
}

function grey(v) {
  const c = clamp(v | 0, 0, 255);
  return `rgb(${c},${c},${c})`;
}

function speckle(g, S, rng, count, light, dark, alpha = 0.5) {
  for (let i = 0; i < count; i++) {
    const up = rng.next() < 0.5;
    g.fillStyle = up ? `rgba(${light},${light},${light},${alpha})` : `rgba(${dark},${dark},${dark},${alpha})`;
    g.fillRect(rng.next() * S, rng.next() * S, 1, 1);
  }
}

/* ------------------------------ car paint ------------------------------ */
// Colour map is a near-white metallic flake carrier so the per-car body colour
// (material.color) still decides the paint colour; the flake, the orange-peel
// height and the roughness break-up do the rest.
export function getCarPaint() {
  return cached('carPaint', () => scaled((() => {
    const S = TILE, rng = new RNG(701);
    const col = canvas2d(S, S);
    col.g.fillStyle = '#f4f4f4';
    col.g.fillRect(0, 0, S, S);
    speckle(col.g, S, rng, 90000, 255, 150, 0.35);

    // orange peel: shallow, broad dimples in the clear coat
    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(128);
    hgt.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = rng.next() * S, y = rng.next() * S, r = 5 + rng.next() * 14;
      const grd = hgt.g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(255,255,255,${0.05 + rng.next() * 0.05})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      hgt.g.fillStyle = grd;
      hgt.g.beginPath(); hgt.g.arc(x, y, r, 0, 6.283); hgt.g.fill();
    }

    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(52);
    rgh.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 44 + rng.next() * 26;
      rgh.g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      rgh.g.beginPath();
      rgh.g.arc(rng.next() * S, rng.next() * S, 8 + rng.next() * 40, 0, 6.283);
      rgh.g.fill();
    }

    return {
      map: toTex(col.c, true),
      normalMap: toTex(normalFromHeight(hgt.c, 0.35), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [1, 1]
    };
  })()));
}

/* ------------------------------ glazing ------------------------------ */
// Dark tinted glass with wiper haze and a dust film along the lower edge.
export function getCarGlass() {
  return cached('carGlass', () => scaled((() => {
    const S = TILE, rng = new RNG(733);
    const col = canvas2d(S, S);
    col.g.fillStyle = '#f2f2f2';
    col.g.fillRect(0, 0, S, S);
    // dust settles towards the bottom edge of a pane
    const grd = col.g.createLinearGradient(0, S * 0.55, 0, S);
    grd.addColorStop(0, 'rgba(190,188,182,0)');
    grd.addColorStop(1, 'rgba(176,172,164,0.55)');
    col.g.fillStyle = grd;
    col.g.fillRect(0, S * 0.55, S, S * 0.45);
    speckle(col.g, S, rng, 12000, 205, 150, 0.25);

    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(128);
    hgt.g.fillRect(0, 0, S, S);
    // wiper smears: broad arcs of very low relief
    hgt.g.strokeStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 5; i++) {
      hgt.g.lineWidth = 26 + rng.next() * 30;
      hgt.g.beginPath();
      hgt.g.arc(S * 0.5, S * 1.15, S * 0.85 + i * 9, Math.PI * 1.15, Math.PI * 1.85);
      hgt.g.stroke();
    }
    hgt.g.strokeStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 120; i++) {
      hgt.g.lineWidth = 1 + rng.next() * 2;
      const x = rng.next() * S;
      hgt.g.beginPath(); hgt.g.moveTo(x, rng.next() * S * 0.4); hgt.g.lineTo(x + (rng.next() - 0.5) * 20, S); hgt.g.stroke();
    }

    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(16);
    rgh.g.fillRect(0, 0, S, S);
    const rg2 = rgh.g.createLinearGradient(0, S * 0.6, 0, S);
    rg2.addColorStop(0, 'rgba(120,120,120,0)');
    rg2.addColorStop(1, 'rgba(120,120,120,0.75)');
    rgh.g.fillStyle = rg2;
    rgh.g.fillRect(0, S * 0.6, S, S * 0.4);
    for (let i = 0; i < 40; i++) {
      rgh.g.fillStyle = `rgba(150,150,150,${0.08 + rng.next() * 0.12})`;
      rgh.g.beginPath();
      rgh.g.ellipse(rng.next() * S, rng.next() * S, 30 + rng.next() * 90, 12 + rng.next() * 40, rng.next() * 3, 0, 6.283);
      rgh.g.fill();
    }

    return {
      map: toTex(col.c, true),
      normalMap: toTex(normalFromHeight(hgt.c, 0.5), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [1, 1]
    };
  })()));
}

/* ------------------------------ tyre rubber ------------------------------ */
// Cylinder UVs run u = around the circumference and v = across the tread, so
// circumferential grooves are horizontal bands and the sipes are vertical.
export function getTyre() {
  return cached('tyre', () => scaled((() => {
    const S = TILE, rng = new RNG(757);
    const col = canvas2d(S, S);
    col.g.fillStyle = '#e6e6e6';
    col.g.fillRect(0, 0, S, S);
    speckle(col.g, S, rng, 26000, 255, 170, 0.2);

    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(190);
    hgt.g.fillRect(0, 0, S, S);
    // four circumferential grooves
    for (let i = 1; i <= 4; i++) {
      hgt.g.fillStyle = grey(40);
      hgt.g.fillRect(0, (S / 5) * i - 9, S, 18);
    }
    // lateral sipes, staggered block to block
    hgt.g.fillStyle = grey(70);
    for (let x = 0; x < S; x += 64) {
      const off = (Math.floor(x / 64) % 2) * 32;
      for (let b = 0; b < 5; b++) {
        hgt.g.fillRect(x + off, (S / 5) * b + 12, 10, S / 5 - 24);
      }
    }
    // shoulder wear
    for (let i = 0; i < 500; i++) {
      hgt.g.fillStyle = `rgba(255,255,255,${0.04 + rng.next() * 0.06})`;
      hgt.g.fillRect(rng.next() * S, rng.next() * S, 2 + rng.next() * 8, 2 + rng.next() * 4);
    }

    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(196);
    rgh.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 170 + rng.next() * 60;
      rgh.g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      rgh.g.beginPath();
      rgh.g.arc(rng.next() * S, rng.next() * S, 10 + rng.next() * 50, 0, 6.283);
      rgh.g.fill();
    }

    return {
      map: toTex(col.c, true),
      normalMap: toTex(normalFromHeight(hgt.c, 1.6), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [4, 1]
    };
  })()));
}

/* ------------------------------ chrome / trim ------------------------------ */
// No colour map: the vertex colour still decides whether a part is black
// plastic, brushed steel or chrome. Relief and gloss variation only.
export function getChrome() {
  return cached('chrome', () => scaled((() => {
    const S = TILE, rng = new RNG(769);
    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(128);
    hgt.g.fillRect(0, 0, S, S);
    // fine brush lines
    for (let i = 0; i < 2600; i++) {
      hgt.g.strokeStyle = `rgba(255,255,255,${0.05 + rng.next() * 0.08})`;
      hgt.g.lineWidth = 1;
      const y = rng.next() * S, len = 40 + rng.next() * 380;
      const x = rng.next() * S;
      hgt.g.beginPath(); hgt.g.moveTo(x, y); hgt.g.lineTo(x + len, y + (rng.next() - 0.5) * 3); hgt.g.stroke();
    }
    // a few deeper scratches
    for (let i = 0; i < 60; i++) {
      hgt.g.strokeStyle = `rgba(0,0,0,${0.10 + rng.next() * 0.16})`;
      hgt.g.lineWidth = 1 + rng.next() * 1.5;
      const x = rng.next() * S, y = rng.next() * S;
      hgt.g.beginPath(); hgt.g.moveTo(x, y); hgt.g.lineTo(x + (rng.next() - 0.5) * 160, y + (rng.next() - 0.5) * 60); hgt.g.stroke();
    }

    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(44);
    rgh.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) {
      const v = 30 + rng.next() * 70;
      rgh.g.fillStyle = `rgba(${v},${v},${v},0.3)`;
      rgh.g.beginPath();
      rgh.g.ellipse(rng.next() * S, rng.next() * S, 6 + rng.next() * 40, 4 + rng.next() * 18, rng.next() * 3, 0, 6.283);
      rgh.g.fill();
    }

    return {
      normalMap: toTex(normalFromHeight(hgt.c, 0.6), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [1, 1]
    };
  })()));
}

/* ------------------------------ awning canvas ------------------------------ */
// Woven acrylic: the colour map is a near-white weave carrier so the awning
// colour from the material still shows through.
export function getAwningFabric() {
  return cached('awningFabric', () => scaled((() => {
    const S = TILE, rng = new RNG(791);
    const col = canvas2d(S, S);
    col.g.fillStyle = '#ededed';
    col.g.fillRect(0, 0, S, S);
    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(128);
    hgt.g.fillRect(0, 0, S, S);
    // warp and weft
    for (let i = 0; i < S; i += 6) {
      col.g.fillStyle = i % 12 === 0 ? 'rgba(255,255,255,0.30)' : 'rgba(206,206,206,0.30)';
      col.g.fillRect(i, 0, 3, S);
      col.g.fillRect(0, i, S, 3);
      hgt.g.fillStyle = i % 12 === 0 ? grey(168) : grey(94);
      hgt.g.fillRect(i, 0, 3, S);
      hgt.g.fillRect(0, i, S, 3);
    }
    for (let i = 0; i < 3000; i++) {
      hgt.g.fillStyle = `rgba(0,0,0,${0.05 + rng.next() * 0.08})`;
      hgt.g.fillRect(rng.next() * S, rng.next() * S, 2 + rng.next() * 6, 1 + rng.next() * 3);
    }
    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(200);
    rgh.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const v = 180 + rng.next() * 60;
      rgh.g.fillStyle = `rgba(${v},${v},${v},0.4)`;
      rgh.g.beginPath(); rgh.g.arc(rng.next() * S, rng.next() * S, 12 + rng.next() * 60, 0, 6.283); rgh.g.fill();
    }
    return {
      map: toTex(col.c, true),
      normalMap: toTex(normalFromHeight(hgt.c, 0.8), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [2, 2]
    };
  })()));
}

/* ------------------------------ street furniture ------------------------------ */
// Painted metal for bins, boxes, meters, barriers: near-white colour carrier so
// the vertex colour still decides the paint, with chipped edges and scuffs.
export function getPropPaint() {
  return cached('propPaint', () => scaled((() => {
    const S = TILE, rng = new RNG(803);
    const col = canvas2d(S, S);
    col.g.fillStyle = '#eeeeee';
    col.g.fillRect(0, 0, S, S);
    // chipped paint reads as small dark flecks
    for (let i = 0; i < 900; i++) {
      col.g.fillStyle = `rgba(90,88,84,${0.2 + rng.next() * 0.5})`;
      const w = 2 + rng.next() * 9, h = 2 + rng.next() * 6;
      col.g.fillRect(rng.next() * S, rng.next() * S, w, h);
    }
    speckle(col.g, S, rng, 20000, 255, 190, 0.2);

    const hgt = canvas2d(S, S);
    hgt.g.fillStyle = grey(150);
    hgt.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1200; i++) {
      hgt.g.fillStyle = `rgba(0,0,0,${0.12 + rng.next() * 0.25})`;
      hgt.g.fillRect(rng.next() * S, rng.next() * S, 2 + rng.next() * 10, 2 + rng.next() * 6);
    }
    for (let i = 0; i < 400; i++) {
      hgt.g.strokeStyle = `rgba(255,255,255,${0.05 + rng.next() * 0.1})`;
      hgt.g.lineWidth = 1;
      const x = rng.next() * S, y = rng.next() * S;
      hgt.g.beginPath(); hgt.g.moveTo(x, y); hgt.g.lineTo(x + (rng.next() - 0.5) * 120, y + (rng.next() - 0.5) * 30); hgt.g.stroke();
    }

    const rgh = canvas2d(S, S);
    rgh.g.fillStyle = grey(150);
    rgh.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1200; i++) {
      const v = 90 + rng.next() * 140;
      rgh.g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      rgh.g.beginPath(); rgh.g.arc(rng.next() * S, rng.next() * S, 8 + rng.next() * 45, 0, 6.283); rgh.g.fill();
    }

    return {
      map: toTex(col.c, true),
      normalMap: toTex(normalFromHeight(hgt.c, 0.7), false),
      roughnessMap: toTex(rgh.c, false),
      scale: [1, 1]
    };
  })()));
}

/* ------------------------------ liveries ------------------------------ */
// Door decals for the commercial vehicles. Four cells in one 2048 x 512 atlas.
const LIVERY_CELLS = [
  { key: 'taxi', text: 'PALMA TAXI', sub: 'CITY LICENSED · 24H', bg: '#111111', fg: '#ffd447', border: '#ffd447' },
  { key: 'police', text: 'PALMA P.D.', sub: 'TO PROTECT AND SERVE', bg: '#0d1520', fg: '#eaf2ff', border: '#3f7fd8' },
  { key: 'van', text: 'PALMA PARCEL', sub: 'SAME DAY DELIVERY', bg: '#f2f0e8', fg: '#1d3f8a', border: '#1d3f8a' },
  { key: 'sports', text: 'VULCANO', sub: 'SPORT · PALMA', bg: '#101014', fg: '#ff2d55', border: '#ff2d55' }
];

export function getLiveryAtlas() {
  return cached('liveryAtlas', () => {
    const W = 2048, H = 512, CW = W / LIVERY_CELLS.length;
    const { c, g } = canvas2d(W, H);
    LIVERY_CELLS.forEach((cell, i) => {
      const x = i * CW;
      g.fillStyle = cell.bg;
      g.fillRect(x, 0, CW, H);
      g.strokeStyle = cell.border;
      g.lineWidth = 8;
      g.strokeRect(x + 12, 12, CW - 24, H - 24);
      g.fillStyle = cell.fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let fs = 108;
      g.font = `900 ${fs}px Arial Black, Impact, sans-serif`;
      while (g.measureText(cell.text).width > CW - 80 && fs > 36) {
        fs -= 6;
        g.font = `900 ${fs}px Arial Black, Impact, sans-serif`;
      }
      g.fillText(cell.text, x + CW / 2, H * 0.44);
      g.font = '700 34px Arial, sans-serif';
      g.fillStyle = cell.fg;
      g.globalAlpha = 0.85;
      g.fillText(cell.sub, x + CW / 2, H * 0.72);
      g.globalAlpha = 1;
    });
    return { map: toTex(c, true), count: LIVERY_CELLS.length, keys: LIVERY_CELLS.map((c2) => c2.key) };
  });
}
