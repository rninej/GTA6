// Palma City — gameplay regression probe: idle animation, shot registration,
// wanted escalation, civilian/police model pools, player car source.
// Run through electron with --url=file://.../dist-browser/index.html
const path = require('node:path');
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
      if (await run(`return !!(g&&g.player&&!g.loading&&window.__PALMA_MODELS__&&window.__PALMA_MODELS__.ready);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(1500);

    const out = await run(`
      const res = {};
      const p = g.player;
      // ---- 1. idle animation must actually stop ----
      for (let i=0;i<8;i++) p.rig.update(1/60, { speed: 2.2 });
      const walkingRole = p.rig._glbRole;
      for (let i=0;i<30;i++) p.rig.update(1/60, { speed: 0 });
      res.idle = {
        walkingRole,
        role: p.rig._glbRole,
        paused: !!(p.rig._glbAction && p.rig._glbAction.paused),
        synthesized: !!(p.rig._glbAction && p.rig._glbAction.__pausedIdle)
      };

      // ---- 2. a shot on a spawned ped must kill it ----
      g.vehicles.maxTraffic = 0;
      for (const v of g.vehicles.all.slice()) { try { v.remove(); } catch(e){} }
      const made = g.peds.makePed(p.pos.x + 6, p.pos.z + 0.2, 0.22);
      g.peds.list.push(made);
      made.mesh.position.set(p.pos.x + 6, 0.22, p.pos.z);
      made.pos.copy(made.mesh.position);
      const origin = p.pos.clone(); origin.y = p.pos.y + 1.45;
      // aim at the head (1.63 m above the ped's feet)
      const target = made.pos.clone(); target.y = made.pos.y + 1.63;
      const dir = target.clone().sub(origin).normalize();
      const hit = g.combat.hitscan(origin, dir, 120, 'player');
      res.shot = { hit: hit.type, head: !!hit.head, dead: made.dead, health: made.health };

      // ---- 3. wanted escalation is a single step, not a jump ----
      g.wanted = 0; g.police.agents.length = 0;
      const before = g.wanted;
      g.police.reportCrime('gunshot', p.pos, { forceWitness: true });
      const afterGun = g.wanted;
      g.wanted = 0;
      g.police.reportCrime('homicide', p.pos, { forceWitness: true });
      res.wanted = { before, afterGun, afterHomicide: g.wanted };
      g.wanted = 0; g.police.clearWanted();

      // ---- 4. civilian pool must not include robots ----
      const ids = [];
      for (let i=0;i<40;i++) { const ped = g.peds.makePed(p.pos.x + 30 + i, p.pos.z + 40, 0.22); ids.push(ped.rig.glb && ped.rig.glb.entry ? ped.rig.glb.entry.id : 'none'); g.scene.remove(ped.mesh); }
      res.civPool = Array.from(new Set(ids));
      const cop = g.police.spawnCop(p.pos.clone());
      res.copModel = cop.rig.glb && cop.rig.glb.entry ? cop.rig.glb.entry.id : 'none';
      g.police.agents.length = 0;

      // ---- 5. the player's car comes from the downloaded fleet ----
      const car = g.vehicles.spawnAt('sedan', p.pos.x + 8, p.pos.z + 26, 0, { driver: 'player' });
      res.playerCar = { glb: !!car.glb, id: car.glb && car.glb.entry ? car.glb.entry.id : null, wheels: car.glb ? car.glb.wheels.length : -1 };
      car.remove();
      return res;
    `).catch((e) => ({ err: String(e && e.stack ? e.stack : e).slice(0, 400) }));
    console.log('GAMEPLAY ' + JSON.stringify(out));
  } catch (e) {
    console.log('GAMEPLAY_ERR ' + (e.stack || e));
  }
  app.quit();
});
