// Palma City — street-level look checks at noon, dusk and night.
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
      g.player.pos.set(-188, 0.02, -60);
      g.player.heading = 0;
      g.player.mesh.rotation.y = 0;
      g.player.mesh.visible = false;
      // keep the sun's shadow camera on the shot camera so captures show the
      // same shadows the player sees instead of a stale map from spawn
      window.__sunFor = (cam) => { const s = g.sky; s.sun.position.copy(cam.position).addScaledVector(s.sunDir, 190); s.sun.target.position.copy(cam.position); s.sun.target.updateMatrixWorld(); s.sun.shadow.needsUpdate = true; };
      return true;`);
    await sleep(1200);

    const shot = async (file, hour, camY = 2.9, camZ = -76, lookY = 3.4, lookZ = 10) => {
      const du = await run(`
        try {
          const p = g.player;
          g.sky.setHour(${hour});
          if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
          if (g.city && g.city.update) g.city.update(0.016, g);
          p.pos.set(-188, 0.02, -60);
          p.heading = 0;
          p.mesh.rotation.y = 0;
          p.mesh.visible = false;
          const cam = g.cam.camera;
          const rr = g.renderer;
          rr.setPixelRatio(1);
          rr.setSize(1000, 640, false);
          cam.aspect = 1000 / 640;
          cam.updateProjectionMatrix();
          g.cam.update = () => {};
          cam.position.set(-188, ${camY}, ${camZ});
          cam.lookAt(-188, ${lookY}, ${lookZ});
          window.__sunFor(cam);
          rr.render(g.scene, cam);
          rr.render(g.scene, cam);
          return rr.domElement.toDataURL('image/png');
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
      if (typeof du !== 'string') { console.log('FAIL ' + file + ' ' + JSON.stringify(du)); return; }
      fs.writeFileSync(path.resolve(file), Buffer.from(du.split(',')[1], 'base64'));
      console.log('SHOT ' + file);
    };

    await shot('screenshots/look-noon.png', 12.5);
    await shot('screenshots/look-dusk.png', 17.8);
    await shot('screenshots/look-night.png', 21.5);
    await shot('screenshots/look-roof.png', 17.4, 34, -110, 0, 40);

    // beach: the ocean side of the map runs along +Z beyond the last road
    const beachShot = async (file, hour, cx, cy, cz, lx, ly, lz) => {
      const du = await run(`
        try {
          if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
          g.sky.setHour(${hour});
          if (g.city && g.city.update) g.city.update(0.016, g);
          const p = g.player;
          p.mesh.visible = false;
          p.pos.set(${cx}, 0.02, ${cz});
          const cam = g.cam.camera, rr = g.renderer;
          rr.setPixelRatio(1); rr.setSize(1000, 640, false);
          cam.aspect = 1000 / 640; cam.updateProjectionMatrix();
          g.cam.update = () => {};
          cam.position.set(${cx}, ${cy}, ${cz});
          cam.lookAt(${lx}, ${ly}, ${lz});
          window.__sunFor(cam);
          rr.render(g.scene, cam); rr.render(g.scene, cam);
          return rr.domElement.toDataURL('image/png');
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
      if (typeof du !== 'string') { console.log('FAIL ' + file + ' ' + JSON.stringify(du)); return; }
      fs.writeFileSync(path.resolve(file), Buffer.from(du.split(',')[1], 'base64'));
      console.log('SHOT ' + file);
    };

    await beachShot('screenshots/beach-dusk.png', 17.6, 220, 3.2, 506, -260, 3.5, 548);
    await beachShot('screenshots/beach-noon.png', 12.4, 20, 2.4, 500, 0, 1.2, 760);
    await shot('screenshots/look-night-roof.png', 21.5, 34, -110, 0, 40);
    const diag = await run(`const r = g.renderer; r.render(g.scene, g.cam.camera);
      return { calls: r.info.render.calls, tris: r.info.render.triangles,
        signs: (g.city.signMeshes || []).length,
        glow: g.city.signGlowMat ? g.city.signGlowMat.opacity : -1,
        buildings: (g.city.buildingMeshes || []).length };`).catch((e) => String(e));
    console.log('DIAG ' + JSON.stringify(diag));

    const poseShot = async (file, hour, stateSrc) => {
      const du = await run(`
        try {
          if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
          g.sky.setHour(${hour});
          const p = g.player;
          p.mesh.visible = true;
          if (g.city && g.city.update) g.city.update(0.016, g);
          p.pos.set(-188, 0.02, -60);
          p.heading = 0;
          p.mesh.rotation.y = 0;
          for (let i = 0; i < 18; i++) p.rig.update(1 / 60, ${stateSrc});
          const cam = g.cam.camera, rr = g.renderer;
          rr.setPixelRatio(1); rr.setSize(1000, 640, false);
          cam.aspect = 1000 / 640; cam.updateProjectionMatrix();
          g.cam.update = () => {};
          cam.position.set(-186.4, 1.9, -64.2);
          cam.lookAt(-188, 1.15, -60);
          window.__sunFor(cam);
          rr.render(g.scene, cam); rr.render(g.scene, cam);
          return rr.domElement.toDataURL('image/png');
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
      if (typeof du !== 'string') { console.log('FAIL ' + file + ' ' + JSON.stringify(du)); return; }
      fs.writeFileSync(path.resolve(file), Buffer.from(du.split(',')[1], 'base64'));
      console.log('SHOT ' + file);
    };

    const carShot = async (file, hour, camOff) => {
      const du = await run(`
        try {
          if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
          g.sky.setHour(${hour});
          let car = null;
          g.scene.traverse((o) => { if (!car && o.userData && o.userData.vehicle) car = o.userData.vehicle; });
          if (!car) return { err: 'no car' };
          if (g.city && g.city.update) g.city.update(0.016, g);
          const c = car.mesh.position;
          const cam = g.cam.camera, rr = g.renderer;
          rr.setPixelRatio(1); rr.setSize(1000, 640, false);
          cam.aspect = 1000 / 640; cam.updateProjectionMatrix();
          g.cam.update = () => {};
          cam.position.set(c.x + ${camOff[0]}, c.y + ${camOff[1]}, c.z + ${camOff[2]});
          cam.lookAt(c.x, c.y + 0.65, c.z);
          window.__sunFor(cam);
          rr.render(g.scene, cam); rr.render(g.scene, cam);
          return rr.domElement.toDataURL('image/png');
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
      if (typeof du !== 'string') { console.log('FAIL ' + file + ' ' + JSON.stringify(du)); return; }
      fs.writeFileSync(path.resolve(file), Buffer.from(du.split(',')[1], 'base64'));
      console.log('SHOT ' + file);
    };

    await carShot('screenshots/car-1.png', 16.4, [3.6, 1.5, 3.9]);
    await carShot('screenshots/car-2.png', 16.4, [-4.2, 1.7, -3.4]);

    await poseShot('screenshots/anim-jump.png', 16.6, `{ speed: 0, airborne: true, vy: 3.4, aiming: false }`);
    await poseShot('screenshots/anim-sprint.png', 16.6, `{ speed: 7.2, sprint: true, airborne: false, aiming: false }`);
    console.log('LOOK-DONE');
    app.exit(0);
  } catch (e) {
    console.log('LOOK-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    app.exit(1);
  }
});
