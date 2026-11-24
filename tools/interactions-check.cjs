// Palma City — real-input probe for car entry/exit and gun aim/fire.
// Everything goes through DOM events on the game's own listeners and through the
// same frame update the game loop runs (tick + input.endFrame). No direct
// enterVehicle/exitVehicle/playerFire calls.
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
      g.cutscene=false; g.started=true; g.loading=false; g.paused=false;
      g.sky.setHour(12.5); return true;`).catch(() => null);
    await sleep(3000);

    const out = await run(`
      const V3 = g.scene.position.constructor;
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const pressKey = (code, frames = 2) => { keyDown(code); frame(frames); keyUp(code); };
      // Parked cars are locked: timed lockpick, then the existing 1.8 s hotwire.
      const enterCar = (v) => {
        if (v.keys) { pressKey('KeyF', 3); return; }
        pressKey('KeyF', 2); frame(55); pressKey('KeyF', 2);
        frame(2); pressKey('KeyF', 2); frame(115);
      };
      const canvas = g.renderer.domElement;
      const mouseDown = (button) => canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
      const mouseUp = (button) => window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));

      // ---- car entry / drive / exit, two different cars ----
      const parked = g.vehicles.all.filter((v) => !v.driver && !v.removed);
      // Prefer cars with clear road ahead: a parked car facing a wall would be
      // driven into it by the test and the crash (not the game) would fail it.
      const clearAhead = (v) => {
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        for (const d of [6, 11, 16]) {
          const x = v.pos.x + fx * d, z = v.pos.z + fz * d;
          if (g.city.queryColliders(x, z, 0.9).length) return false;
        }
        return true;
      };
      const carResults = [];
      const chosen = [];
      for (const v of parked.filter(clearAhead)) {
        if (chosen.length >= 2) break;
        if (chosen.length && chosen[0].type === v.type) continue;
        chosen.push(v);
      }
      for (const v of parked) {
        if (chosen.length >= 2) break;
        if (!chosen.includes(v)) chosen.push(v);
      }
      for (const v of chosen) {
        g.player.exitVehicle(true);
        g.player.teleport(new V3(v.pos.x + 2.2, 0.24, v.pos.z));
        g.cam.snap(); g.cam.update(0.016, g);
        frame();   // one frame on foot: proximity prompt + F handled here
        const before = {
          carId: v.id, carType: v.type, driver: v.driver,
          inVehicle: g.player.inVehicle, prompt: g.hud.interactText || null
        };
        const hudBefore = g.hud.interact && g.hud.interact.textContent;
        enterCar(v);   // lockpick, then the existing 1.8 s hotwire
        const after = {
          inVehicle: g.player.inVehicle,
          attachedId: g.player.vehicle && g.player.vehicle.id,
          attachedIsCar: g.player.vehicle === v,
          driver: v.driver,
          playerMeshVisible: g.player.mesh.visible,
          camMode: g.cam.mode,
          playerMeshAtCar: g.player.mesh.position.distanceTo(v.mesh.position) < 0.6
        };
        // drive: hold W through real key events
        const p0 = v.pos.clone();
        keyDown('KeyW');
        for (let i = 0; i < 24; i++) frame();
        keyUp('KeyW');
        const drove = {
          speed: +v.speed.toFixed(2),
          movedM: +p0.distanceTo(v.pos).toFixed(2),
          playerFollows: g.player.mesh.position.distanceTo(v.mesh.position) < 0.6,
          stillInVehicle: g.player.inVehicle
        };
        // exit with the real F key
        pressKey('KeyF', 3);
        const outState = {
          inVehicle: g.player.inVehicle,
          playerMeshVisible: g.player.mesh.visible,
          distanceFromCar: +g.player.pos.distanceTo(v.pos).toFixed(2),
          carDriver: v.driver,
          carVisible: v.mesh.visible,
          carAlive: !v.removed,
          camMode: g.cam.mode,
          onFoot: !g.player.inVehicle && g.player.mesh.visible && g.player.pos.distanceTo(v.pos) > 0.6,
          dead: !!g.player.dead, health: +g.player.health.toFixed(0)
        };
        carResults.push({ before, hudBefore, after, drove, out: outState });
      }

      // ---- shooting: real mousedown on the canvas, aimed at a car ahead ----
      g.player.exitVehicle(true);
      g.police.clearWanted(); g.wanted = 0;   // entry tests may have been witnessed
      g.player.teleport(new V3(g.player.spawn.x, 0.24, g.player.spawn.z));
      // a target 9 m down +Z (the direction yaw 0 points)
      const target = g.vehicles.spawnAt('sedan', g.player.spawn.x, g.player.spawn.z + 9, 0);
      target.mesh.visible = true;
      g.cam.yaw = 0; g.cam.pitch = 0; g.cam.snap(); g.cam.update(0.016, g);
      frame();

      // observe the real effect calls without replacing behaviour
      let tracerCalls = 0, muzzleCalls = 0, lastHit = null;
      const t0 = g.effects.tracer.bind(g.effects);
      g.effects.tracer = function (a, b) { tracerCalls++; lastHit = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) }; return t0(a, b); };
      const m0 = g.effects.muzzle.bind(g.effects);
      g.effects.muzzle = function (p, d) { muzzleCalls++; return m0(p, d); };

      const ammo0 = g.player.ammo.mag;
      const want0 = g.wanted;
      mouseDown(0);
      frame();                       // the game loop's shooting branch runs here
      const shotCtx = { inVehicle: g.player.inVehicle, dead: !!g.player.dead, paused: !!g.paused, mapOpen: !!g.mapOpen, cooldown0: +g.player.fireCooldown.toFixed(3), ammo0: g.player.ammo.mag };
      const shot1 = {
        ammoBefore: ammo0, ammoAfter: g.player.ammo.mag,
        tracers: tracerCalls, muzzleFlashes: muzzleCalls,
        cooldown: +g.player.fireCooldown.toFixed(3),
        wantedBefore: want0, wantedAfter: g.wanted,
        hitPoint: lastHit,
        hitNearTarget: lastHit ? Math.abs(lastHit.z - (g.player.spawn.z + 9)) < 2.2 : false,
        flashVisible: g.effects.flashes.some((f) => f.sprite.visible)
      };
      // holding the button must not bypass the fire rate
      frame();
      const held = { ammoAfterHold: g.player.ammo.mag, tracers: tracerCalls };
      mouseUp(0);
      // let the cooldown expire, then fire again
      for (let i = 0; i < 20; i++) frame();
      mouseDown(0); frame(); mouseUp(0);
      const shot2 = { ammoAfterSecond: g.player.ammo.mag, tracers: tracerCalls, muzzleFlashes: muzzleCalls };

      // aim down sights with the real right mouse button
      mouseDown(2); frame();
      const aim = { aiming: g.player.aiming };
      mouseUp(2); frame();
      const aimOff = { aiming: g.player.aiming };

      return { cars: carResults, shotCtx, shot: shot1, held, shot2, aim, aimOff,
        density: { cars: g.vehicles.all.length, peds: g.peds.list.length },
        errors: (window.__PALMA_MODELS__ && window.__PALMA_MODELS__.errors || []).slice(0, 3) };
    `).catch((e) => ({ error: String(e && e.stack ? e.stack : e).slice(0, 400) }));
    console.log('INTERACT ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('INTERACT-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
