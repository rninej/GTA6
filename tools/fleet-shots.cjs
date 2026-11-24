// Palma City — fleet look checks: one 3/4 view per vehicle class plus a lineup.
// Run through electron like the other capture tools.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 640, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  try {
    await win.loadURL('file://' + path.resolve('dist-browser/index.html'));
    for (let i = 0; i < 240; i++) {
      const ok = await run(`return !!(g && g.player && !g.loading && document.querySelector('#title button[data-action="new"]'));`).catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    await run(`const b = document.querySelector('#title button[data-action="new"]'); if (b) b.click(); return true;`).catch(() => false);
    await run(`g.cutscene = false; g.started = true; g.paused = false; g.loading = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      g.player.pos.set(-188, 0.02, -120);
      g.player.mesh.visible = false;
      g.sky.setHour(13.2);
      if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
      // park the moving population so it does not wander into the lineup
      if (g.vehicles && g.vehicles.all) for (const v of g.vehicles.all.slice()) { try { v.remove(); } catch (e) {} }
      g.vehicles.maxTraffic = 0;
      window.__shot = (file, spawn, camOff, lookY) => {
        try {
          const v = g.vehicles.spawnAt(spawn.type, spawn.x, spawn.z, spawn.heading, Object.assign({ driver: null }, spawn.opts || {}));
          v.mesh.updateMatrixWorld(true);
          const c = v.mesh.position;
          const cam = g.cam.camera, rr = g.renderer;
          rr.setPixelRatio(1); rr.setSize(1000, 640, false);
          cam.aspect = 1000 / 640; cam.updateProjectionMatrix();
          g.cam.update = () => {};
          cam.position.set(c.x + camOff[0], camOff[1], c.z + camOff[2]);
          cam.lookAt(c.x, lookY, c.z);
          const s = g.sky;
          s.sun.position.copy(cam.position).addScaledVector(s.sunDir, 190);
          s.sun.target.position.copy(cam.position); s.sun.target.updateMatrixWorld();
          s.sun.shadow.needsUpdate = true;
          rr.render(g.scene, cam); rr.render(g.scene, cam);
          const du = rr.domElement.toDataURL('image/png');
          const bb = new THREE.Box3().setFromObject(v.mesh);
          const sg = v.mesh.getObjectByName('destination');
          const sp = sg ? sg.getWorldPosition(new THREE.Vector3()).sub(c) : null;
          const info = { calls: rr.info.render.calls, tris: rr.info.render.triangles,
            glb: !!v.glb, parts: v.parts && v.parts.procedural ? 'procedural' : 'glb', du,
            dim: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map((n) => +n.toFixed(2)),
            sign: sp ? sp.toArray().map((n) => +n.toFixed(2)) : null };
          v.remove();
          return info;
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }
      };
      window.__lineup = (file, list, cam) => {
        try {
          const made = [];
          for (const s of list) made.push(g.vehicles.spawnAt(s.type, s.x, s.z, s.heading, Object.assign({ driver: null }, s.opts || {})));
          for (const v of made) v.mesh.updateMatrixWorld(true);
          const rr = g.renderer; rr.setPixelRatio(1); rr.setSize(1000, 640, false);
          const cam2 = g.cam.camera; cam2.aspect = 1000 / 640; cam2.updateProjectionMatrix();
          g.cam.update = () => {};
          cam2.position.set(cam[0], cam[1], cam[2]);
          cam2.lookAt(cam[3], cam[4], cam[5]);
          const s = g.sky;
          s.sun.position.copy(cam2.position).addScaledVector(s.sunDir, 190);
          s.sun.target.position.copy(cam2.position); s.sun.target.updateMatrixWorld();
          s.sun.shadow.needsUpdate = true;
          rr.render(g.scene, cam2); rr.render(g.scene, cam2);
          const du = rr.domElement.toDataURL('image/png');
          const info = { calls: rr.info.render.calls, tris: rr.info.render.triangles, du };
          for (const v of made) v.remove();
          return info;
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }
      };
      return true;`);

    const shots = [
      ['bus', { type: 'bus', x: -188, z: -60, heading: Math.PI / 2 }, [6.2, 2.9, 7.0], 1.35],
      ['bus-front', { type: 'bus', x: -188, z: -60, heading: Math.PI / 2 }, [-7.6, 2.6, 5.4], 1.4],
      ['bus-endA', { type: 'bus', x: -188, z: -60, heading: Math.PI / 2 }, [0.2, 2.4, 9.5], 1.4],
      ['bus-endB', { type: 'bus', x: -188, z: -60, heading: Math.PI / 2 }, [0.2, 2.4, -9.5], 1.4],
      ['police', { type: 'police', x: -188, z: -60, heading: Math.PI / 2 }, [4.4, 1.9, 5.0], 0.8],
      ['van', { type: 'van', x: -188, z: -60, heading: Math.PI / 2 }, [4.8, 2.2, 5.4], 0.95],
      ['sedan', { type: 'sedan', x: -188, z: -60, heading: Math.PI / 2 }, [4.2, 1.9, 4.8], 0.8],
      ['sports', { type: 'sports', x: -188, z: -60, heading: Math.PI / 2 }, [4.2, 1.8, 4.6], 0.72],
      ['suv', { type: 'suv', x: -188, z: -60, heading: Math.PI / 2 }, [4.6, 2.1, 5.2], 0.9],
      ['taxi', { type: 'taxi', x: -188, z: -60, heading: Math.PI / 2 }, [4.2, 1.9, 4.8], 0.8],
      ['pickup', { type: 'pickup', x: -188, z: -60, heading: Math.PI / 2 }, [4.8, 2.2, 5.4], 0.95],
      ['sedan-proc', { type: 'sedan', x: -188, z: -60, heading: Math.PI / 2, opts: { noGlb: true } }, [4.2, 1.9, 4.8], 0.8]
    ];
    const save = (r, file) => {
      if (!r || !r.du) { console.log('FLEETSHOT FAIL ' + file + ' ' + JSON.stringify(r).slice(0, 240)); return; }
      fs.writeFileSync(path.resolve(file), Buffer.from(r.du.split(',')[1], 'base64'));
      console.log('FLEETSHOT ' + file + ' calls=' + r.calls + ' tris=' + r.tris + ' parts=' + r.parts
        + (r.dim ? ' dim=' + JSON.stringify(r.dim) : '') + (r.sign ? ' sign=' + JSON.stringify(r.sign) : ''));
    };
    for (const [name, spawn, off, lookY] of shots) {
      const r = await run(`return window.__shot('fleet-${name}.png', ${JSON.stringify(spawn)}, ${JSON.stringify(off)}, ${lookY});`).catch((e) => ({ err: String(e).slice(0, 200) }));
      save(r, `screenshots/fleet-${name}.png`);
    }

    const lineup = [
      { type: 'bus', x: -188, z: -110, heading: Math.PI / 2 },
      { type: 'suv', x: -188, z: -101, heading: Math.PI / 2 },
      { type: 'sports', x: -188, z: -92, heading: Math.PI / 2 },
      { type: 'taxi', x: -188, z: -83, heading: Math.PI / 2 },
      { type: 'sedan', x: -188, z: -74, heading: Math.PI / 2 },
      { type: 'pickup', x: -188, z: -65, heading: Math.PI / 2 }
    ];
    const lr = await run(`return window.__lineup('fleet-lineup.png', ${JSON.stringify(lineup)}, [-158, 6.4, -87.5, -190, 1.2, -87.5]);`).catch((e) => ({ err: String(e).slice(0, 200) }));
    save(lr, 'screenshots/fleet-lineup.png');
    console.log('FLEET-DONE');
    app.exit(0);
  } catch (e) {
    console.log('FLEET-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    app.exit(1);
  }
});
