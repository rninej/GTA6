// Palma City — vehicle theft probe after the lockpick tier.
// Real F keys: lockpick a parked car, abort/restart the existing hotwire,
// unwitnessed vs witnessed theft, and a keyed car that still opens instantly.
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
      if (await run(`return !!(g&&g.player&&!g.loading);`).catch(() => false)) break;
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

      g.cutscene = false; g.paused = false;
      g.police.clearWanted(); g.wanted = 0;
      // Unwitnessed cases first: temporarily empty the ped list so nobody can
      // see the theft (moving them is undone by the ped repath logic).
      const stash = g.peds.list.splice(0);
      const pedMax = g.peds.max;
      g.peds.max = 0;

      const cars = g.vehicles.all.filter((v) => !v.driver && !v.dead && !v.keys && !v.isBus && v.type !== 'police');
      const place = (v) => {
        g.player.teleport(new V3(v.pos.x + 2.2, 0.24, v.pos.z));
        g.cam.snap(); g.cam.update(0.016, g); frame(2);
      };
      const lockpick = () => { press('KeyF', 2); frame(56); press('KeyF', 2); };

      const car = cars[0];
      place(car);
      const promptBefore = prompt();
      press('KeyF', 2);
      const started = { inVehicle: g.player.inVehicle, lockpick: !!g.player.lockpick, locked: !!car.locked };
      frame(56); press('KeyF', 2);
      const opened = {
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === car,
        keys: !!car.keys, locked: !!car.locked, engineOn: car.engineOn,
        prompt: prompt()
      };

      // failure case: second F cancels the hotwire inside the car
      press('KeyF', 2);
      frame(20);
      press('KeyF', 2);
      const aborted = {
        inVehicle: g.player.inVehicle, hotwire: !!g.player.hotwire,
        aborts: g.player.hotwireAborts, keys: !!car.keys, prompt: prompt()
      };

      // unwitnessed theft completes with no wanted level
      press('KeyF', 2);
      frame(120);
      const noWitness = {
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === car, keys: !!car.keys,
        engineOn: car.engineOn, wanted: g.wanted, descVehicle: g.police.description.vehicle,
        witnesses: g.police.witnessCount, success: g.player.hotwireSuccess
      };
      press('KeyE', 2);
      const exited = { inVehicle: g.player.inVehicle, visible: g.player.mesh.visible };

      // restore pedestrians and clear the first theft's police response
      g.peds.max = pedMax;
      g.peds.list.push(...stash);
      g.police.clearWanted(); g.wanted = 0;

      // witnessed theft: one ped next to a different locked car
      const car2 = cars.find((v) => v !== car && !v.keys);
      const ped = g.peds.list.find((p) => !p.dead);
      ped.pos.set(car2.pos.x + 7, 0.2, car2.pos.z);
      ped.alarm = 0;
      place(car2);
      lockpick();
      press('KeyF', 2);
      frame(120);
      const witnessed = {
        inVehicle: g.player.inVehicle, wanted: g.wanted,
        descVehicle: g.police.description.vehicle, carId: car2.id,
        face: !!g.police.description.face, clothes: !!g.police.description.clothes,
        witnesses: g.police.witnessCount, keys: !!car2.keys
      };
      press('KeyE', 2);

      // keyed (already hotwired) car still opens instantly
      place(car);
      const legitPrompt = prompt();
      press('KeyF', 2);
      const legit = {
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === car,
        prompt: legitPrompt, engineOn: car.engineOn
      };
      press('KeyE', 2);
      const legitExit = { inVehicle: g.player.inVehicle, visible: g.player.mesh.visible };

      return {
        promptBefore, started, opened, aborted, noWitness, exited,
        witnessed, legitPrompt, legit, legitExit,
        hotwireSuccess: g.player.hotwireSuccess, hotwireAborts: g.player.hotwireAborts
      };
    })()`, true);
    console.log('THEFT ' + JSON.stringify(out));
  } catch (e) { console.log('THEFT_ERR ' + (e.stack || e)); }
  app.quit();
});
