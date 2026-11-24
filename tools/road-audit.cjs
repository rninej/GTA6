// Palma City — deterministic road-marking audit.
// Enumerates flat road/marking surfaces, finds coplanar XZ-overlapping pairs at
// near-identical heights (z-fighting), and checks the UV stride of the road
// tile and the crosswalk decals.
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')) ? process.argv.find((a) => a.startsWith('--url=')).slice(6) : 'file://' + path.resolve('dist-browser/index.html');
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.paused=false; g.sky.setHour(12.5); return true;`).catch(() => null);
    await sleep(2000);

    const out = await run(`
      const flats = [];
      g.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const b = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        const m = o.matrixWorld;
        const corners = [];
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const v = new g.scene.position.constructor(x, y, z).applyMatrix4(m);
          corners.push(v);
        }
        const minY = Math.min(...corners.map((v) => v.y));
        const maxY = Math.max(...corners.map((v) => v.y));
        if (maxY - minY > 0.05) return;
        // Marking layers only: the ground plane sits at y=0 and is not a decal.
        if (maxY < 0.005 || maxY > 0.08) return;
        const minX = Math.min(...corners.map((v) => v.x)), maxX = Math.max(...corners.map((v) => v.x));
        const minZ = Math.min(...corners.map((v) => v.z)), maxZ = Math.max(...corners.map((v) => v.z));
        const area = (maxX - minX) * (maxZ - minZ);
        if (area < 1) return;
        const uv = o.geometry.attributes.uv;
        let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
        if (uv) for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          if (u < uMin) uMin = u; if (u > uMax) uMax = u;
          if (v < vMin) vMin = v; if (v > vMax) vMax = v;
        }
        flats.push({
          name: o.name || '(unnamed)', mat: (o.material && o.material.name) || '',
          y: +maxY.toFixed(4), minX: +minX.toFixed(1), maxX: +maxX.toFixed(1),
          minZ: +minZ.toFixed(1), maxZ: +maxZ.toFixed(1), area: +area.toFixed(1),
          uSpan: uv ? +(uMax - uMin).toFixed(3) : null,
          vSpan: uv ? +(vMax - vMin).toFixed(3) : null,
          repeat: o.material && o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null
        });
      });

      // coplanar XZ overlap at near-identical height
      const TOL = 0.004;
      const pairs = [];
      for (let i = 0; i < flats.length; i++) {
        for (let j = i + 1; j < flats.length; j++) {
          const a = flats[i], b = flats[j];
          if (Math.abs(a.y - b.y) > TOL) continue;
          const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
          if (ox <= 0 || oz <= 0 || ox * oz < 1) continue;
          pairs.push({ a: a.name, b: b.name, yA: a.y, yB: b.y, overlap: +(ox * oz).toFixed(1) });
        }
      }
      const levels = {};
      for (const f of flats) { const k = f.y.toFixed(3); levels[k] = (levels[k] || 0) + 1; }
      // A fractional UV stride on a marking tile (e.g. 0.5) stretches the
      // painted stripes. Marking materials must repeat 1:1 with their quad.
      // Only the painted crosswalk layer is a marking tile: it must repeat 1:1
      // with its quad. The intersection pads deliberately carry the asphalt
      // texture at its physical 6 m tiling, which is not a marking stride.
      const badUv = flats.filter((f) => f.y > 0.02 && f.repeat && (Math.abs(f.repeat[0] - 1) > 0.001 || Math.abs(f.repeat[1] - 1) > 0.001));
      return {
        flats: flats.length, pairs, levels, badUv: badUv.slice(0, 6),
        samples: flats.slice(0, 8), passed: pairs.length === 0 && badUv.length === 0
      };
    `).catch((e) => ({ error: String(e && e.message ? e.message : e).slice(0, 300) }));
    console.log('ROADAUDIT ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('ROADAUDIT-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
