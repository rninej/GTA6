// Palma City — authored character and cloth texture atlas.
//
// One 1024 px canvas holds a 4 x 4 grid of 256 px cells. Each cell is a
// *detail* map, not a colour map: it is drawn in near-white greys so the
// per-part vertex colour still decides skin tone, fabric colour and paint
// shade, and the cell only contributes surface structure (pores, weave, twill,
// grain, strands, brushed metal). A matching height field is converted to a
// tangent-space normal with a Sobel filter, so every bump comes from real
// authored relief rather than a painted normal.
//
// Everything here is generated at runtime from code. No image, scan, model or
// texture from any other game or from any commercial asset pack is used; see
// CREDITS.md.
import * as THREE from 'three';
import { RNG, canvas2d, clamp } from '../core/utils.js';

const GRID = 4;
const CELL = 256;
const SIZE = GRID * CELL;

// Cell indices. Keep in sync with the painters below.
export const CT = {
  skin: 0,     // pores, mottling, fine creases
  cloth: 1,    // plain weave
  denim: 2,    // diagonal twill
  leather: 3,  // pebble grain (shoes, jackets, seats)
  hair: 4,     // strands
  eye: 5,      // radial iris fibres
  knit: 6,     // ribbed knit (hats, scarves, jumpers)
  metal: 7,    // brushed metal (buttons, buckles, zips)
  stubble: 8   // individual beard hairs over skin
};

let ATLAS = null;

function cellOrigin(tile) {
  return { x: (tile % GRID) * CELL, y: Math.floor(tile / GRID) * CELL };
}

/* ------------------------------ painters ------------------------------ */
// Each painter receives the colour context, the height context, the cell origin
// and a seeded RNG. Colour stays near-white; height is 128 +/- the relief.

function paintSkin(c, h, ox, oy, rng) {
  c.fillStyle = '#f3ece6';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);

  // broad blotches: capillaries and uneven pigmentation
  for (let i = 0; i < 70; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    const r = 8 + rng.next() * 34;
    const warm = rng.next() < 0.5;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? 'rgba(255,214,200,0.10)' : 'rgba(214,206,206,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();

    const hg = h.createRadialGradient(x, y, 0, x, y, r);
    hg.addColorStop(0, 'rgba(140,140,140,0.25)');
    hg.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = hg;
    h.beginPath(); h.arc(x, y, r, 0, 6.2832); h.fill();
  }

  // pores: the small dark openings that stop skin reading as plastic
  for (let i = 0; i < 5200; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    const a = 0.06 + rng.next() * 0.16;
    c.fillStyle = `rgba(196,176,166,${a})`;
    c.fillRect(x, y, 1, 1);
    h.fillStyle = 'rgba(96,96,96,0.55)';
    h.fillRect(x, y, 1, 1);
  }
  // fine crease lines (knuckle / forehead micro-relief)
  for (let i = 0; i < 90; i++) {
    const y = oy + rng.next() * CELL;
    const len = 6 + rng.next() * 26;
    const x = ox + rng.next() * CELL;
    c.strokeStyle = `rgba(205,190,182,${0.05 + rng.next() * 0.07})`;
    c.lineWidth = 0.7;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (rng.next() - 0.5) * 3); c.stroke();
  }
}

function paintCloth(c, h, ox, oy, rng) {
  c.fillStyle = '#efefef';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // plain weave: 3 px warp / 3 px weft cells alternating over and under
  const step = 3;
  for (let y = 0; y < CELL; y += step) {
    for (let x = 0; x < CELL; x += step) {
      const over = ((x / step) + (y / step)) % 2 === 0;
      const v = over ? 236 : 222;
      const n = (rng.next() - 0.5) * 10;
      c.fillStyle = `rgb(${clamp(v + n, 0, 255) | 0},${clamp(v + n, 0, 255) | 0},${clamp(v + n, 0, 255) | 0})`;
      c.fillRect(ox + x, oy + y, over ? step : step - 1, over ? step - 1 : step);
      const hv = over ? 168 : 96;
      h.fillStyle = `rgb(${hv},${hv},${hv})`;
      h.fillRect(ox + x, oy + y, over ? step : step - 1, over ? step - 1 : step);
    }
  }
  // slubs: thicker yarns that break the regularity
  for (let i = 0; i < 260; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    c.fillStyle = `rgba(255,255,255,${0.10 + rng.next() * 0.16})`;
    c.fillRect(x, y, 2 + rng.next() * 5, 1);
  }
}

function paintDenim(c, h, ox, oy, rng) {
  c.fillStyle = '#e9e9ea';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // 2/1 twill: diagonal ribs running down-left to up-right
  for (let d = -CELL; d < CELL * 2; d += 3) {
    c.strokeStyle = 'rgba(255,255,255,0.34)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(ox + d, oy + CELL);
    c.lineTo(ox + d + CELL, oy);
    c.stroke();
    c.strokeStyle = 'rgba(176,176,180,0.30)';
    c.beginPath();
    c.moveTo(ox + d + 1.6, oy + CELL);
    c.lineTo(ox + d + CELL + 1.6, oy);
    c.stroke();
  }
  for (let d = -CELL; d < CELL * 2; d += 3) {
    h.strokeStyle = 'rgba(196,196,196,0.55)';
    h.lineWidth = 1.4;
    h.beginPath(); h.moveTo(ox + d, oy + CELL); h.lineTo(ox + d + CELL, oy); h.stroke();
    h.strokeStyle = 'rgba(76,76,76,0.5)';
    h.beginPath(); h.moveTo(ox + d + 1.7, oy + CELL); h.lineTo(ox + d + CELL + 1.7, oy); h.stroke();
  }
  // indigo slub / wear flecks
  for (let i = 0; i < 900; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    c.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.20)' : 'rgba(150,155,165,0.14)';
    c.fillRect(x, y, 1, 1 + rng.next() * 3);
  }
}

function paintLeather(c, h, ox, oy, rng) {
  c.fillStyle = '#eeeceb';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // pebble grain: many small irregular cells with a lit top edge and a dark
  // bottom edge, which is what makes leather read as leather at close range
  for (let i = 0; i < 1500; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    const w = 2 + rng.next() * 5, hh = 2 + rng.next() * 4;
    c.fillStyle = `rgba(255,255,255,${0.10 + rng.next() * 0.18})`;
    c.fillRect(x, y, w, 1);
    c.fillStyle = `rgba(168,164,162,${0.12 + rng.next() * 0.2})`;
    c.fillRect(x, y + hh, w, 1);
    h.fillStyle = 'rgba(196,196,196,0.6)';
    h.fillRect(x, y, w, hh);
    h.fillStyle = 'rgba(70,70,70,0.5)';
    h.fillRect(x, y + hh, w, 1);
  }
}

function paintHair(c, h, ox, oy, rng) {
  c.fillStyle = '#ecebea';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(120,120,120)';
  h.fillRect(ox, oy, CELL, CELL);
  // strands: vertical with a slight wave, alternating light and dark so the
  // hair reads as many fibres instead of a smooth shell
  for (let i = 0; i < 1400; i++) {
    const x = ox + rng.next() * CELL;
    const y0 = oy + rng.next() * CELL;
    const len = 20 + rng.next() * 90;
    const amp = 0.6 + rng.next() * 2.4;
    const phase = rng.next() * 6.28;
    const light = rng.next() < 0.5;
    c.strokeStyle = light ? `rgba(255,255,255,${0.12 + rng.next() * 0.2})`
                          : `rgba(150,146,142,${0.10 + rng.next() * 0.2})`;
    c.lineWidth = 0.8 + rng.next() * 0.9;
    c.beginPath();
    for (let t = 0; t <= len; t += 6) {
      const px = x + Math.sin((t / len) * 3.1 + phase) * amp;
      if (t === 0) c.moveTo(px, y0 + t); else c.lineTo(px, y0 + t);
    }
    c.stroke();

    h.strokeStyle = light ? 'rgba(200,200,200,0.5)' : 'rgba(60,60,60,0.5)';
    h.lineWidth = 1.4;
    h.beginPath();
    for (let t = 0; t <= len; t += 6) {
      const px = x + Math.sin((t / len) * 3.1 + phase) * amp;
      if (t === 0) h.moveTo(px, y0 + t); else h.lineTo(px, y0 + t);
    }
    h.stroke();
  }
}

function paintEye(c, h, ox, oy, rng) {
  // iris: radial fibres from the pupil out to the limbal ring
  c.fillStyle = '#f2f1ef';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  const cx = ox + CELL / 2, cy = oy + CELL / 2;
  for (let i = 0; i < 900; i++) {
    const a = rng.next() * 6.2832;
    const r0 = 18 + rng.next() * 10;
    const r1 = 84 + rng.next() * 26;
    c.strokeStyle = rng.next() < 0.55
      ? `rgba(255,255,255,${0.10 + rng.next() * 0.22})`
      : `rgba(150,146,140,${0.08 + rng.next() * 0.2})`;
    c.lineWidth = 0.7 + rng.next() * 1.1;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    c.stroke();
  }
  // collarette and limbal darkening
  const ring = c.createRadialGradient(cx, cy, 20, cx, cy, 110);
  ring.addColorStop(0, 'rgba(255,255,255,0)');
  ring.addColorStop(0.72, 'rgba(200,196,190,0.16)');
  ring.addColorStop(1, 'rgba(120,116,112,0.42)');
  c.fillStyle = ring;
  c.beginPath(); c.arc(cx, cy, 118, 0, 6.2832); c.fill();
}

function paintKnit(c, h, ox, oy, rng) {
  c.fillStyle = '#ededed';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // ribbed knit: vertical columns of interlocking V stitches
  for (let x = 0; x < CELL; x += 6) {
    for (let y = 0; y < CELL; y += 7) {
      const v = 216 + rng.next() * 26;
      c.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},0.85)`;
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(ox + x + 1, oy + y);
      c.lineTo(ox + x + 3.5, oy + y + 5);
      c.lineTo(ox + x + 6, oy + y);
      c.stroke();
      h.strokeStyle = 'rgba(210,210,210,0.6)';
      h.lineWidth = 3;
      h.beginPath();
      h.moveTo(ox + x + 1, oy + y);
      h.lineTo(ox + x + 3.5, oy + y + 5);
      h.lineTo(ox + x + 6, oy + y);
      h.stroke();
      h.strokeStyle = 'rgba(60,60,60,0.5)';
      h.lineWidth = 1;
      h.beginPath();
      h.moveTo(ox + x + 1, oy + y + 6);
      h.lineTo(ox + x + 3.5, oy + y + 7);
      h.lineTo(ox + x + 6, oy + y + 6);
      h.stroke();
    }
  }
}

// Beard stubble: individual short hairs over a skin-toned field. The base is
// near-white so the jaw's skin vertex colour still shows through, and the hairs
// are drawn one at a time with varying angle, length and darkness, so the result
// is per-strand variation rather than a flat mask.
function paintStubble(c, h, ox, oy, rng) {
  c.fillStyle = '#f4efe9';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // skin mottling under the hairs
  for (let i = 0; i < 40; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    const r = 6 + rng.next() * 18;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(226,196,180,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
  }
  // hairs: short strokes, density high but with gaps so skin shows through
  for (let i = 0; i < 4600; i++) {
    const x = ox + rng.next() * CELL;
    const y = oy + rng.next() * CELL;
    const len = 1.2 + rng.next() * 2.6;
    const a = rng.next() * 6.2832;
    const dark = 78 + rng.next() * 62;
    c.strokeStyle = `rgba(${dark},${dark * 0.84 | 0},${dark * 0.74 | 0},${0.16 + rng.next() * 0.3})`;
    c.lineWidth = 0.5 + rng.next() * 0.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
    h.strokeStyle = 'rgba(70,70,70,0.45)';
    h.lineWidth = 1;
    h.beginPath();
    h.moveTo(x, y);
    h.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    h.stroke();
  }
  // follicle pores
  for (let i = 0; i < 1400; i++) {
    const x = ox + rng.next() * CELL, y = oy + rng.next() * CELL;
    c.fillStyle = `rgba(120,96,84,${0.10 + rng.next() * 0.18})`;
    c.fillRect(x, y, 1, 1);
  }
}

function paintMetal(c, h, ox, oy, rng) {
  c.fillStyle = '#f0f0f0';
  c.fillRect(ox, oy, CELL, CELL);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(ox, oy, CELL, CELL);
  // brushed finish: long horizontal streaks of varying brightness
  for (let i = 0; i < 1200; i++) {
    const y = oy + rng.next() * CELL;
    const x = ox + rng.next() * CELL;
    const len = 20 + rng.next() * 200;
    const v = 200 + rng.next() * 55;
    c.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.08 + rng.next() * 0.2})`;
    c.lineWidth = 0.6 + rng.next() * 1.2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
    h.strokeStyle = rng.next() < 0.5 ? 'rgba(180,180,180,0.4)' : 'rgba(80,80,80,0.4)';
    h.lineWidth = 1;
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + len, y); h.stroke();
  }
}

/* --------------------------- height → normal --------------------------- */
// Sobel gradient over a wrapping height map (OpenGL convention, +Y up).
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

function toTex(canvas, srgb, aniso) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------- atlas ------------------------------- */
export function characterAtlas(aniso = 8) {
  if (ATLAS) return ATLAS;
  const col = canvas2d(SIZE, SIZE);
  const hgt = canvas2d(SIZE, SIZE);
  const painters = [
    paintSkin, paintCloth, paintDenim, paintLeather,
    paintHair, paintEye, paintKnit, paintMetal, paintStubble
  ];
  // unused cells are filled flat, so coarse mip levels cannot bleed transparent
  // black from an empty cell into a used one and darken a whole surface
  col.g.fillStyle = '#ececec';
  col.g.fillRect(0, 0, SIZE, SIZE);
  hgt.g.fillStyle = 'rgb(128,128,128)';
  hgt.g.fillRect(0, 0, SIZE, SIZE);
  painters.forEach((fn, i) => {
    const o = cellOrigin(i);
    fn(col.g, hgt.g, o.x, o.y, new RNG(9001 + i * 137));
  });

  // Blur the height field before the Sobel: the pores and weave are one pixel
  // wide, and a 1 px gradient field produces normals that point sideways and
  // kill the diffuse term. A 1 px blur keeps the relief and the light.
  const smooth = canvas2d(SIZE, SIZE);
  smooth.g.filter = 'blur(1.1px)';
  smooth.g.drawImage(hgt.c, 0, 0);
  smooth.g.filter = 'none';

  ATLAS = {
    map: toTex(col.c, true, aniso),
    normalMap: toTex(normalFromHeight(smooth.c, 0.45), false, aniso),
    colorCanvas: col.c,
    heightCanvas: smooth.c,
    grid: GRID,
    cell: CELL
  };
  if (typeof window !== 'undefined') window.__palmaAtlas = ATLAS;
  return ATLAS;
}

// Remap a geometry's UVs into one atlas cell. `scale` tiles the pattern inside
// the cell (2 = the detail repeats twice per face), which keeps pores and
// weave at a consistent physical size regardless of the primitive's size.
const INSET = 0.006;
export function tileUV(geo, tile, scale = 1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  const g = GRID;
  const col = tile % g, row = Math.floor(tile / g);
  const span = 1 / g - INSET * 2;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i) * scale;
    let v = uv.getY(i) * scale;
    u -= Math.floor(u); v -= Math.floor(v);
    uv.setXY(i, (col / g) + INSET + u * span, (row / g) + INSET + v * span);
  }
  uv.needsUpdate = true;
  return geo;
}

export function setAnisotropy(v) {
  if (ATLAS) { ATLAS.map.anisotropy = v; ATLAS.normalMap.anisotropy = v; }
}
