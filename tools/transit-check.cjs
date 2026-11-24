// Palma City — public transport probe.
// Real F presses at a stop: refused fare, paid boarding, next-stop HUD across
// two stops, mid-route exit on foot, then a ride to the last stop.
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
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.033); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const press = (code, n = 2) => { keyDown(code); frame(n); keyUp(code); };
      const prompt = () => document.getElementById('interact').querySelector('span').textContent;
      const busHud = () => document.getElementById('bus-hud');
      const hudNext = () => document.getElementById('bus-stop').textContent;
      const hudSub = () => document.getElementById('bus-next').textContent;
      const toasts = () => document.getElementById('toasts').textContent;

      g.cutscene = false; g.paused = false;
      const t = g.transit;
      const bus = t.bus;
      const stops = t.stops;
      const fare = t.fare;
      const spawnDist = +Math.hypot(g.player.pos.x - bus.pos.x, g.player.pos.z - bus.pos.z).toFixed(1);
      const busVisible = bus.mesh.visible;
      const place = () => {
        g.player.teleport(new V3(bus.pos.x + 3, 0.24, bus.pos.z));
        g.cam.snap(); g.cam.update(0.016, g); frame(2);
      };
      place();
      const atStop = t.dwell > 0;
      const promptAtStop = prompt();

      // failure case: $2 wallet cannot cover the fare
      g.player.money = 2;
      press('KeyF', 2);
      const poor = {
        money: g.player.money, inVehicle: g.player.inVehicle, riding: t.riding,
        stillAtStop: t.dwell > 0, refused: /NOT ENOUGH/.test(toasts()),
        prompt: prompt()
      };

      // paid boarding
      g.player.money = 100;
      place();
      press('KeyF', 2);
      const boarded = {
        money: g.player.money, fareDeducted: 100 - g.player.money,
        inVehicle: g.player.inVehicle, vehicle: g.player.vehicle === bus,
        riding: t.riding, driver: bus.driver, type: bus.type, isBus: !!bus.isBus,
        hudShown: !busHud().classList.contains('hidden'),
        next: hudNext(), sub: hudSub()
      };

      // ride until the first two stops have passed
      let ticks = 0;
      while (t.stopIndex === 0 && ticks < 4000) { frame(1); ticks++; }
      frame(2);
      const followDist = () => +Math.hypot(g.player.pos.x - bus.pos.x, g.player.pos.z - bus.pos.z).toFixed(2);
      const first = { stopIndex: t.stopIndex, next: hudNext(), sub: hudSub(), dwell: t.dwell > 0, ticks, follows: followDist() };
      while (t.stopIndex === 1 && ticks < 8000) { frame(1); ticks++; }
      frame(2);
      const second = { stopIndex: t.stopIndex, next: hudNext(), sub: hudSub(), dwell: t.dwell > 0, ticks, follows: followDist() };

      // mid-route exit: on foot at the stop just reached, HUD cleared
      const exitStop = stops[t.stopIndex];
      press('KeyF', 2);
      const exited = {
        inVehicle: g.player.inVehicle, riding: t.riding,
        hudHidden: busHud().classList.contains('hidden'),
        onFoot: g.player.mesh.visible,
        distToStop: +Math.hypot(g.player.pos.x - exitStop.x, g.player.pos.z - exitStop.z).toFixed(2),
        atStopName: exitStop.name
      };

      // board again at the same stop and ride to the terminus
      place();
      g.player.money = 50;
      press('KeyF', 2);
      const reboarded = { money: g.player.money, riding: t.riding, next: hudNext() };
      let ticks2 = ticks;
      while (t.stopIndex !== stops.length - 1 && ticks2 < 6000) { frame(1); ticks2++; }
      const last = {
        stopIndex: t.stopIndex, next: hudNext(), sub: hudSub(), dwell: t.dwell > 0,
        lastStop: /LAST STOP/.test(hudNext()), ticks: ticks2,
        bus: { x: +bus.pos.x.toFixed(1), z: +bus.pos.z.toFixed(1), speed: +bus.speed.toFixed(2),
          heading: +bus.heading.toFixed(2), throttle: bus.throttle, brake: bus.brake,
          dead: bus.dead, health: bus.health, legTimer: +t.legTimer.toFixed(1), dwell: +t.dwell.toFixed(1),
          target: stops[t.targetIndex].name, targetX: stops[t.targetIndex].x, targetZ: stops[t.targetIndex].z }
      };
      press('KeyF', 2);
      const lastExit = {
        inVehicle: g.player.inVehicle, hudHidden: busHud().classList.contains('hidden'),
        distToStop: +Math.hypot(g.player.pos.x - stops[stops.length - 1].x,
          g.player.pos.z - stops[stops.length - 1].z).toFixed(2)
      };

      return {
        spawnDist, busVisible, atStop, promptAtStop, fare, poor, boarded, first, second, exited,
        reboarded, last, lastExit,
        stopNames: stops.map((s) => s.name)
      };
    })()`, true);
    console.log('TRANSIT ' + JSON.stringify(out));
  } catch (e) { console.log('TRANSIT_ERR ' + (e.stack || e)); }
  app.quit();
});
