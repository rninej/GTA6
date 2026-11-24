// Palma City — does the shipped bundle load the real models from its own files?
// Lean on purpose: no timed gameplay probes, just load + what is rendering.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const url = arg('url', 'file://' + path.resolve('dist-browser/index.html'));
const shot = arg('shot', 'screenshots/load-check.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 360, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const logs = []; const reqs = [];
  win.webContents.on('console-message', (e, level, message) => {
    const t = typeof message === 'string' ? message : e && e.message;
    const l = typeof level === 'number' ? level : (e && e.level) || 0;
    if (t) logs.push({ level: l, text: String(t).slice(0, 200) });
  });
  win.webContents.session.webRequest.onCompleted((d) => reqs.push({ url: String(d.url).slice(0, 120), status: d.statusCode }));
  win.webContents.session.webRequest.onErrorOccurred((d) => reqs.push({ url: String(d.url).slice(0, 120), error: String(d.error) }));
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  try {
    await win.loadURL(url);
    let ready = false;
    for (let i = 0; i < 200; i++) {
      ready = await run('return !!(g && g.player && !g.loading && window.__PALMA_MODELS__ && window.__PALMA_MODELS__.ready)').catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    await run(`const b = document.querySelector('#title button[data-action="new"]'); if (b) b.click();
      g.cutscene = false; g.started = true; g.paused = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      return true;`).catch(() => false);
    await sleep(2500);
    const info = await run(`
      const M = window.__PALMA_MODELS__;
      const vehicles = g.vehicles.all;
      const peds = g.peds.list || [];
      const wheeled = vehicles.find((v) => v.glb && v.glb.wheels && v.glb.wheels.length);
      const gunEntry = M.weapons.find((w) => w.id === g.player.weapon);
      const playerGun = g.player.rig && g.player.rig.gun;
      let busMeshes = 0;
      if (g.transit && g.transit.bus) g.transit.bus.parts.group.traverse((o) => { if (o.isMesh) busMeshes++; });
      const apartment = g.city.interiors.find((it) => it.kind === 'apartment');
      let bedMeshes = 0;
      if (apartment) apartment.group.traverse((o) => { if (o.name === 'downloaded-bed') bedMeshes++; });
      let ferrisMeshes = 0, ferrisTris = 0;
      if (g.city.ferris) g.city.ferris.traverse((o) => {
        if (o.name === 'downloaded-ferris') ferrisMeshes++;
        if (o.isMesh && o.geometry && o.geometry.index) ferrisTris += Math.round(o.geometry.index.count / 3);
      });
      let bedTris = 0;
      if (apartment) apartment.group.traverse((o) => {
        if (o.name === 'downloaded-bed' && o.geometry && o.geometry.index) bedTris += Math.round(o.geometry.index.count / 3);
      });
      g.player.giveWeapon('rifle', 30);
      const rifleEntry = M.weapons.find((w) => w.id === 'rifle');
      const rifleKey = g.player.rig && g.player.rig.gunKey;
      const rifleShared = !!(g.player.rig && g.player.rig.gun && rifleEntry &&
        g.player.rig.gun.geometry === rifleEntry.geometry);
      g.player.switchWeapon(0);
      const pistolRestored = !!(g.player.rig && g.player.rig.gunKey === 'pistol');
      return {
        loaded: M.loaded, attempted: M.attempted, errors: M.errors.slice(0, 5),
        carFallbacks: M.carFallbacks, humanFallbacks: M.humanFallbacks,
        vehiclesWithGlb: vehicles.filter((v) => v.glb).length, vehiclesTotal: vehicles.length,
        busHasGlb: !!(g.transit && g.transit.bus && g.transit.bus.glb),
        playerHasGlb: !!(g.player.rig && g.player.rig.glb),
        pedsWithGlb: peds.filter((p) => p.rig && p.rig.glb).length, peds: peds.length,
        wheels: wheeled ? wheeled.glb.wheels.length : 0,
        props: M.props.length, fixtures: M.fixtures.length, landmarks: M.landmarks.length,
        carEntries: M.cars.length, bedMeshes, bedTris, ferrisMeshes, ferrisTris, ferrisModel: !!(g.city && g.city.ferrisModel),
        weapons: M.weapons.length, pickups: M.pickups.length,
        playerWeapon: g.player.weapon, playerGunKey: g.player.rig && g.player.rig.gunKey,
        playerGunShared: !!(playerGun && gunEntry && playerGun.geometry === gunEntry.geometry),
        playerGunTris: playerGun && playerGun.geometry && playerGun.geometry.index ? Math.round(playerGun.geometry.index.count / 3) : 0,
        weaponTris: M.weapons.map((w) => w.geometry && w.geometry.index ? Math.round(w.geometry.index.count / 3) : 0),
        pickupCount: g.combat.pickups.length,
        pickupSingleMeshes: g.combat.pickups.filter((p) => p.group.children.length === 1).length,
        pickupTris: M.pickups.map((p) => p.geometry && p.geometry.index ? Math.round(p.geometry.index.count / 3) : 0),
        rifleKey, rifleShared, pistolRestored,
        smallPropTris: g.city && g.city.smallPropMesh && g.city.smallPropMesh.geometry.index
          ? Math.round(g.city.smallPropMesh.geometry.index.count / 3) : 0,
        busMeshes,
        smallProps: (g.city && g.city.smallPropCount) || 0,
        smallPropMesh: !!(g.city && g.city.smallPropMesh),
        boats: (g.city && g.city.boatCount) || 0,
        pierDeck: !!(g.city && g.city.pierDeck),
        lamps: (g.city && g.city.lampCount) || 0, propModels: (g.city && g.city.propModelCount) || 0, propKinds: (M.props||[]).map(p=>p.id).join('+'), tris: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls
      };`);
    try {
      win.show();
      const im = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(shot), im.toPNG());
    } catch (e) { console.log('LOAD-CHECK-SHOT-SKIPPED ' + String(e).slice(0, 80)); }
    const fatal = logs.filter((l) => l.level >= 3);
    const bad = reqs.filter((r) => r.error || (r.status && r.status >= 400));
    const summary = { ...info, errors: info.errors.length, fatal: fatal.length, badRequests: bad.length, ready };
    summary.passed = ready && info.loaded === info.attempted && info.errors.length === 0 &&
      info.carFallbacks === 0 && info.humanFallbacks === 0 &&
      info.vehiclesWithGlb === info.vehiclesTotal && info.vehiclesTotal > 0 && info.busHasGlb &&
      info.playerHasGlb && info.pedsWithGlb === info.peds &&
      info.loaded === 45 && info.props === 12 && info.fixtures === 1 && info.landmarks === 0 &&
      info.carEntries === 14 && info.bedMeshes === 1 && info.ferrisMeshes === 0 &&
      info.weapons === 4 && info.pickups === 3 &&
      info.playerGunKey === info.playerWeapon && info.playerGunShared && info.playerGunTris > 0 &&
      info.weaponTris.length === 4 && info.weaponTris.every((n) => n > 0) &&
      info.pickupCount === 15 && info.pickupSingleMeshes === 15 &&
      info.pickupTris.length === 3 && info.pickupTris.every((n) => n > 0) &&
      info.rifleKey === 'rifle' && info.rifleShared && info.pistolRestored &&
      info.busMeshes === 1 && info.smallPropTris > 0 &&
      info.smallProps === 260 && info.smallPropMesh && info.boats === 3 && info.pierDeck &&
      fatal.length === 0 && bad.length === 0;
    fs.writeFileSync(path.resolve('tools/.last-load-check.json'), JSON.stringify({ summary, logs: logs.slice(0, 15), reqs: reqs.slice(0, 10) }, null, 1));
    console.log('LOAD-CHECK ' + JSON.stringify(summary));
    app.exit(summary.passed ? 0 : 1);
  } catch (e) {
    console.log('LOAD-CHECK-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    app.exit(1);
  }
});
