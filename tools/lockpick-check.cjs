// Palma City — vehicle entry tier probe.
// Real F keys: locked parked car offers lockpick, success enters with the
// engine off, existing hotwire starts it, failure alarms/raises the normal
// police response, and the same car is retryable after the cooldown.
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')).slice(6);
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&g.transit&&!g.loading);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2500);
    const out = await win.webContents.executeJavaScript(`(()=>{
      const g = window.__PALMA__;
      const V3 = g.scene.position.constructor;
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const press = (code, n = 2) => { keyDown(code); frame(n); keyUp(code); };
      const prompt = () => document.getElementById('interact').querySelector('span').textContent;
      const place = (v) => {
        g.player.teleport(new V3(v.pos.x + 2.2, 0.24, v.pos.z));
        g.cam.snap(); g.cam.update(0.016, g); frame(2);
      };
      const lockpickSuccess = () => { press('KeyF', 2); frame(55); press('KeyF', 2); };

      g.cutscene = false; g.paused = false;
      g.police.clearWanted(); g.wanted = 0;

      const locked = g.vehicles.all.filter((v) => !v.driver && !v.dead && !v.keys && !v.isBus && v.type !== 'police');
      const car = locked[0];
      place(car);
      const lockedPrompt = prompt();
      press('KeyF', 2);   // start the lockpick, not plain entry
      const refused = {
        inVehicle: g.player.inVehicle, locked: !!car.locked,
        lockpickActive: !!g.player.lockpick, prompt: prompt()
      };

      // finish the timed check inside the window
      frame(56); press('KeyF', 2);
      const success = {
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === car,
        locked: !!car.locked, keys: !!car.keys, engineOn: car.engineOn,
        prompt: prompt(), lockpickSuccess: g.player.lockpickSuccess
      };

      // existing hotwire path from inside
      press('KeyF', 2);
      frame(115);
      const hotwire = {
        keys: !!car.keys, engineOn: car.engineOn, hotwireSuccess: g.player.hotwireSuccess,
        inVehicle: g.player.inVehicle
      };
      const p0 = car.pos.clone();
      keyDown('KeyW'); frame(30); keyUp('KeyW');
      const drive = {
        moved: +p0.distanceTo(car.pos).toFixed(2), speed: +car.speed.toFixed(2),
        inVehicle: g.player.inVehicle
      };
      press('KeyE', 2);

      // failure: press too early, car stays locked and the alarm calls the cops
      g.police.clearWanted(); g.wanted = 0;
      const car2 = locked.find((v) => v !== car);
      place(car2);
      press('KeyF', 2);   // start
      press('KeyF', 2);   // too early
      const failed = {
        inVehicle: g.player.inVehicle, onFoot: g.player.mesh.visible,
        locked: !!car2.locked, cooldown: +car2.lockCooldown.toFixed(2),
        alarm: +car2.alarm.toFixed(2), wanted: g.wanted,
        witnesses: g.police.witnessCount, failures: car2.lockpickFailures,
        prompt: prompt(), toast: document.getElementById('toasts').textContent
      };

      // the existing police path has been triggered; clear it so the retry is clean
      g.police.clearWanted(); g.wanted = 0;

      // retry the same car after the cooldown
      frame(400);
      const retryPrompt = prompt();
      lockpickSuccess();
      const retry = {
        cooldown: +car2.lockCooldown.toFixed(2), inVehicle: g.player.inVehicle,
        vehicle: g.player.vehicle === car2, keys: !!car2.keys, locked: !!car2.locked,
        prompt: prompt()
      };
      press('KeyE', 2);

      // an owned/unlocked (hotwired) car still opens instantly, engine running
      place(car);
      const ownedPrompt = prompt();
      press('KeyF', 2);
      const owned = {
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === car,
        engineOn: car.engineOn, keys: !!car.keys, lockpickActive: !!g.player.lockpick,
        prompt: prompt()
      };
      press('KeyE', 2);

      // the transit bus is not a lockpick target
      const t = g.transit, bus = t.bus;
      const busState = { isBus: !!bus.isBus, keys: !!bus.keys, locked: !!bus.locked, driver: bus.driver };

      return { lockedPrompt, refused, success, hotwire, drive, failed, retryPrompt, retry, ownedPrompt, owned, busState };
    })()`, true);
    console.log('LOCKPICK ' + JSON.stringify(out));
  } catch (e) { console.log('LOCKPICK_ERR ' + (e.stack || e)); }
  app.quit();
});
