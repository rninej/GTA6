// Palma City — deterministic clickbait chase screenshots from the browser build.
// Loads the static build over HTTP, starts a new game, poses a stolen car, a
// police pursuit and the 4-star helicopter, then captures three real renders.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const url = arg('url', 'http://127.0.0.1:3000/index.html');
const width = Number(arg('width', 1600));
const height = Number(arg('height', 900));
const outDir = path.resolve('screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width, height, show: true, backgroundColor: '#000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  const run = (body) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${body} })()`, true);
  // The headless compositor gives capturePage a 1x1 surface, so read the real
  // WebGL canvas back directly after each render instead.
  const shot = async (name) => {
    const data = await run(`
      g.paused = true;
      g.renderer.setPixelRatio(1);
      g.renderer.setSize(${width}, ${height}, false);
      g.camera.aspect = ${width} / ${height};
      g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene, g.camera);
      return g.renderer.domElement.toDataURL('image/png');
    `);
    const p = path.join(outDir, name);
    fs.writeFileSync(p, Buffer.from(String(data).split(',')[1], 'base64'));
    console.log('SHOT ' + name + ' ' + fs.statSync(p).size);
  };
  try {
    await win.loadURL(url);
    for (let i = 0; i < 180; i++) {
      if (await run(`return !!(g && g.player && !g.loading && document.querySelector('#title button[data-action="new"]'));`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`
      const b = document.querySelector('#title button[data-action="new"]');
      if (b) b.click();
      g.cutscene = false; g.started = true; g.paused = false; g.loading = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      g.sky.setHour(18.1); g.sky.update(0.0001, g); g.sky.refreshEnv();
      g.weather.setState('clear', true); g.weather.intensity = 0; g.weather.wet = 0; g.weather.apply();
      return true;
    `);
    await sleep(1800);
    const setup = await run(`
      const V3 = g.scene.position.constructor;
      // A long downtown block, so the chase has road and skyline behind it.
      const n = g.city.nearestNode(-188, -12) || g.city.graph[0];
      g.player.teleport(new V3(n.x, 0.24, n.z));
      const v = g.vehicles.spawnAt('coupe', n.x, n.z, 0, { driver: null });
      v.pos.set(n.x, 0.2, n.z); v.heading = 0; v.mesh.position.copy(v.pos);
      g.player.enterVehicle(v);
      v.speed = 0; v.velocity.set(0, 0, 0);
      // Police pursuit, placed behind the stolen car.
      g.wanted = 4; g.police.crimeTimer = 60; g.police.update(0.016, g);
      const cops = [];
      for (let i = 0; i < 2; i++) {
        const c = g.vehicles.spawnPolice(g.player.pos, 4);
        if (!c) continue;
        c.pos.set(n.x + (i ? 2.4 : -2.2), 0.2, n.z - 6.5 - i * 2.8);
        c.heading = 0; c.mesh.position.copy(c.pos); c.speed = 0; c.velocity.set(0, 0, 0);
        cops.push(c);
      }
      // Clear the parked traffic that can sit in front of the staged car.
      for (const o of g.vehicles.all) {
        if (o === v || cops.includes(o) || o.removed) continue;
        if (Math.hypot(o.pos.x - n.x, o.pos.z - n.z) < 24) o.remove();
      }
      // Four-star helicopter overhead, ahead of the car.
      g.police.crimeTimer = 60; g.police.update(0.016, g);
      if (g.police.heli) {
        g.police.heli.visible = true;
        g.police.heli.position.set(n.x + 5, 12, n.z - 20);
        g.police.heli.lookAt(n.x, 0, n.z);
        g.police.heliRotor.rotation.y = 0.7;
        if (g.police.heliModel && g.police.heliModel.root) g.police.heliModel.root.rotation.y = -0.5;
      }
      // The first mission's marker beam sits right in front of this block and
      // reads as a pale stripe across the sky at this hour; hide it.
      if (g.missions && g.missions.hideMarker) g.missions.hideMarker();
      g.player.vehicle.speed = 0;
      g.hud.updateWanted();
      return { x: n.x, z: n.z, car: v.type, glb: !!v.glb, kids: v.mesh.children.length, cops: cops.length, heli: !!(g.police.heli && g.police.heli.visible) };
    `);
    console.log('SETUP ' + JSON.stringify(setup));
    await sleep(1200);

    // Shot 1 (hero): rear-left three-quarter; stolen car right foreground,
    // cruiser behind it, helicopter in the open sky over the park.
    await run(`
      const p = g.player.pos; const c = g.camera;
      g.paused = true;
      if (g.police.heli) g.police.heli.position.set(p.x - 6, 12.5, p.z - 30);
      c.position.set(p.x - 4.4, 2.7, p.z + 5.6);
      c.lookAt(p.x + 1.0, 2.7, p.z - 14.0);
      c.updateMatrixWorld(true);
      g.renderer.render(g.scene, g.camera);
      return true;
    `);
    await shot('clickbait-chase-01.png');

    // Shot 2: straight chase from behind the stolen car, helicopter overhead.
    await run(`
      const p = g.player.pos; const c = g.camera;
      g.paused = true;
      if (g.police.heli) g.police.heli.position.set(p.x + 5, 12, p.z - 20);
      c.position.set(p.x + 6.2, 2.4, p.z + 7.2);
      c.lookAt(p.x, 2.2, p.z - 4.0);
      c.updateMatrixWorld(true);
      g.renderer.render(g.scene, g.camera);
      return true;
    `);
    await shot('clickbait-chase-02.png');

    // Shot 3: wide establishing angle over the whole block.
    await run(`
      const p = g.player.pos; const c = g.camera;
      g.paused = true;
      if (g.police.heli) g.police.heli.position.set(p.x + 5, 13, p.z - 24);
      c.position.set(p.x + 9.5, 6.4, p.z + 9.0);
      c.lookAt(p.x - 1.0, 1.6, p.z - 15.0);
      c.updateMatrixWorld(true);
      g.renderer.render(g.scene, g.camera);
      return true;
    `);
    await shot('clickbait-chase-03.png');
    app.exit(0);
  } catch (e) {
    console.log('SHOT-ERROR ' + String(e && e.stack || e).slice(0, 600));
    app.exit(1);
  }
});
