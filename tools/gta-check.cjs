// Palma City — probe for the GTA-style systems added in this pass:
// weather, fuel/engine health + refuelling, witness-based policing, mask and taxi.
// Everything runs through the real frame update and DOM input listeners.
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
    await sleep(3000);

    const out = await win.webContents.executeJavaScript(`(async()=>{
      const g = window.__PALMA__;
      const V3 = g.scene.position.constructor;
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const pressKey = (code, frames = 2) => { keyDown(code); frame(frames); keyUp(code); };
      const enterCar = (v) => {
        if (v.keys) { pressKey('KeyF', 3); return; }
        pressKey('KeyF', 2); frame(55); pressKey('KeyF', 2);
        frame(2); pressKey('KeyF', 2); frame(115);
      };
      const canvas = g.renderer.domElement;
      const mouseDown = (button) => canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
      const mouseUp = (button) => window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
      const renderInfo = () => { g.renderer.render(g.scene, g.camera); return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }; };

      // ---------- weather ----------
      g.weather.setState('clear', true); g.weather.intensity = 0; g.weather.wet = 0; g.weather.apply(); frame(2);
      const clearView = renderInfo();
      const clearRoad = g.city.roadMat ? g.city.roadMat.roughness : null;
      g.weather.setState('storm', true); g.weather.intensity = 1; g.weather.wet = 1; g.weather.apply(); frame(2);
      const stormView = renderInfo();
      const weather = {
        clearCalls: clearView.calls, stormCalls: stormView.calls, callsDelta: stormView.calls - clearView.calls,
        rainVisible: g.weather.points.visible, intensity: g.weather.intensity, wet: g.city.wet,
        roadRoughClear: clearRoad, roadRoughWet: g.city.roadMat ? g.city.roadMat.roughness : null,
        skyDim: g.sky.weatherDim, fog: g.scene.fog.density
      };
      g.weather.setState('clear', true); g.weather.intensity = 0; g.weather.wet = 0; g.weather.apply(); frame(2);

      // ---------- fuel / engine ----------
      g.player.exitVehicle(true);
      const car = g.vehicles.all.find((v) => !v.driver && !v.dead && v.spec && v.type !== 'police');
      g.player.teleport(new V3(car.pos.x + 2.2, 0.24, car.pos.z));
      g.cam.snap(); g.cam.update(0.016, g); frame();
      enterCar(car);   // lockpick, then the existing 1.8 s hotwire
      const entered = g.player.inVehicle && g.player.vehicle === car;
      car.fuel = 0.5; car.engineHealth = 1; car.engineOn = true;
      keyDown('KeyW'); frame(60); keyUp('KeyW');
      const drove = { fuel: +car.fuel.toFixed(4), speed: +car.speed.toFixed(2), engineOn: car.engineOn };
      // stop cleanly, then check an empty tank cannot accelerate (no crash run)
      car.velocity.set(0, 0, 0); car.speed = 0; car.fuel = 0.0002;
      keyDown('KeyW'); frame(40);
      const speedAtCut = car.speed;
      frame(30); keyUp('KeyW');
      const empty = {
        fuel: +car.fuel.toFixed(4), engineOn: car.engineOn,
        speedAtCut: +speedAtCut.toFixed(2), speedAfter: +car.speed.toFixed(2)
      };

      // refuel at the first station
      if (!g.player.inVehicle) {
        g.player.teleport(new V3(car.pos.x + 2.2, 0.24, car.pos.z));
        g.cam.snap(); g.cam.update(0.016, g); frame();
        pressKey('KeyF', 3);
        frame(130);
      }
      const st = g.city.fuelStations[0];
      car.pos.set(st.x, car.pos.y, st.z); car.velocity.set(0, 0, 0); car.speed = 0;
      car.fuel = 0.3; car.engineHealth = 0.5; car.engineOn = false;
      g.player.money = 500;
      frame(2);
      const pumpDebug = {
        stations: (g.city.fuelStations || []).length,
        st: st ? { x: +st.x.toFixed(1), z: +st.z.toFixed(1) } : null,
        carPos: { x: +car.pos.x.toFixed(1), z: +car.pos.z.toFixed(1) },
        playerPos: { x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) },
        dist: +Math.hypot(g.player.pos.x - st.x, g.player.pos.z - st.z).toFixed(2),
        inVehicle: g.player.inVehicle, speed: +car.speed.toFixed(2),
        prompt: g.hud.interactText ? g.hud.interactText.textContent : null
      };
      keyDown('KeyF'); frame(4);
      const downF = g.input.down('KeyF');
      const holdA = g.player.refuelHold;
      frame(40);
      const holdB = g.player.refuelHold;
      const refuelState = g.refuelState ? { ...g.refuelState } : null;
      frame(36); keyUp('KeyF');
      const holdC = g.player.refuelHold;
      const sameCar = g.player.vehicle === car;
      const refuel = { fuel: +car.fuel.toFixed(3), engine: +car.engineHealth.toFixed(3), money: g.player.money, engineOn: car.engineOn, downF, holdA, holdB, holdC, sameCar, refuelState, pumpDebug };

      // ---------- witness-based police ----------
      g.police.clearWanted(); g.wanted = 0;   // the hotwire may have been witnessed
      g.player.dead = false; g.player.health = 100; g.player.rig.dead = false; g.player.rig.deadT = 0;
      g.player.exitVehicle(true);
      g.police.clearWanted(); g.wanted = 0;
      g.police.description = { face: false, clothes: false, vehicle: null };
      g.police.lastKnown = null;
      for (const p of g.peds.list) p.pos.z += 500;   // nobody around
      frame(2);
      g.player.fireCooldown = 0; g.player.weapons.pistol.mag = 12;
      mouseDown(0); frame(2); mouseUp(0); frame(2);
      const unwitnessed = { wanted: g.wanted, witnesses: g.police.witnessCount };

      const ped = g.peds.list.find((p) => !p.dead && p.rig && p.rig.glb);
      ped.pos.set(g.player.pos.x + 6, ped.pos.y, g.player.pos.z + 3);
      ped.alarm = 5;
      frame(2);
      g.player.fireCooldown = 0;
      mouseDown(0); frame(2); mouseUp(0); frame(3);
      const witnessed = {
        wanted: g.wanted, witnesses: g.police.witnessCount,
        face: g.police.description.face, clothes: g.police.description.clothes,
        hollowStars: document.querySelectorAll('#stars i.hollow').length
      };

      // distant witness: police know a crime happened but not who did it
      g.police.clearWanted(); g.wanted = 0;
      g.police.description = { face: false, clothes: false, vehicle: null };
      ped.pos.set(g.player.pos.x + 26, ped.pos.y, g.player.pos.z + 8);
      frame(2);
      g.player.fireCooldown = 0;
      mouseDown(0); frame(2); mouseUp(0); frame(3);
      const distant = {
        wanted: g.wanted, face: g.police.description.face, clothes: g.police.description.clothes,
        hollowStars: document.querySelectorAll('#stars i.hollow').length
      };

      pressKey('KeyG', 3);
      const masked = {
        masked: g.player.masked, face: g.police.description.face,
        hollowStars: document.querySelectorAll('#stars i.hollow').length
      };
      pressKey('KeyG', 3);

      // ---------- taxi fast travel ----------
      g.police.clearWanted(); g.wanted = 0; g.player.money = 500;
      const ms = g.city.snapToStreet(g.player.pos.x + 40, g.player.pos.z + 40);
      const mx = ms.x, mz = ms.z;
      g.missions.setMarker(mx, mz);
      const before = { x: g.player.pos.x, z: g.player.pos.z, money: g.player.money };
      keyDown('KeyT'); frame(2); keyUp('KeyT');
      await new Promise((r) => setTimeout(r, 500));
      frame(3);
      const taxi = {
        money: g.player.money,
        moved: +Math.hypot(g.player.pos.x - before.x, g.player.pos.z - before.z).toFixed(2),
        distToMarker: +Math.hypot(g.player.pos.x - mx, g.player.pos.z - mz).toFixed(2)
      };

      return {
        weather, fuel: { entered, drove, empty, refuel },
        police: { unwitnessed, witnessed, distant, masked }, taxi,
        errors: (window.__PALMA_MODELS__ && window.__PALMA_MODELS__.errors || []).slice(0, 3),
        bootError: g.bootError || null
      };
    })()`, true).catch((e) => ({ error: String(e && e.message ? e.message : e).slice(0, 400) }));
    console.log('GTA ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('GTA-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
