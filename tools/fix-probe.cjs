// Palma City — probe the four reported problems: giant humans, one model for
// everything, cars driving backwards, and not being able to get in.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 450, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const fatal = [];
  win.webContents.on('console-message', (e, level, message) => {
    const t = typeof message === 'string' ? message : e && e.message;
    const l = typeof level === 'number' ? level : (e && e.level) || 0;
    if (t && l >= 3) fatal.push(String(t).slice(0, 160));
  });
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  const runSafe = (b) => run(b).catch((e) => ({ __err: String(e && e.message ? e.message : e).slice(0, 160) }));
  try {
    await win.loadURL('file://' + path.resolve('dist-browser/index.html'));
    for (let i = 0; i < 200; i++) {
      if (await run('return !!(g && g.player && !g.loading)').catch(() => false)) break;
      await sleep(500);
    }
    await run(`const b = document.querySelector('#title button[data-action="new"]'); if (b) b.click();
      g.cutscene = false; g.started = true; g.paused = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      g.sky.setHour(12.5); return true;`).catch((e) => { console.log('STEP cutscene ' + e.message); return false; });
    await sleep(2000);

    await run(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message).slice(0, 200))); return true;`).catch(() => false);
    const heights = await runSafe(`
      const v = new (g.player.pos.constructor)();
      const span = (root) => { let lo=1e9, hi=-1e9; root.traverse(o => { if (o.isBone) { o.getWorldPosition(v); lo=Math.min(lo,v.y); hi=Math.max(hi,v.y); } }); return +(hi-lo).toFixed(2); };
      const ped = (g.peds.list||[]).find(x=>x.rig&&x.rig.glb);
      return {
        player: g.player.rig.glb ? span(g.player.rig.glb.root) : null,
        ped: ped ? span(ped.rig.glb.root) : null,
        playerFeetY: g.player.rig.glb ? +g.player.pos.y.toFixed(2) : null
      };`);

    const variants = await runSafe(`
      const cars = {};
      try {
        for (const v of g.vehicles.all) {
          if (!v.glb) continue;
          const id = (v.glb.entry && v.glb.entry.id) || 'unknown';
          cars[id] = cars[id] || { n: 0, wheels: v.glb.wheels ? v.glb.wheels.length : -1, grouped: !!v.glb.groupedWheels };
          cars[id].n++;
        }
      } catch (e) { return { __err: 'cars:' + e.message }; }
      const humans = {};
      for (const p of (g.peds.list||[])) if (p.rig && p.rig.glb) { const id = (p.rig.glb.entry && p.rig.glb.entry.id) || 'unknown'; humans[id] = (humans[id]||0)+1; }
      return { cars, humans };`);

    // can the player actually get into a car?
    const enter = await runSafe(`
      const v = g.vehicles.all.find((x) => x.glb && !x.driver && !x.dead);
      if (!v) return { noParkedCar: true };
      g.player.pos.x = v.pos.x + 2.0;
      g.player.pos.z = v.pos.z + 2.0;
      window.__enterTest = v.id;
      return { id: v.id, dist: +Math.hypot(v.pos.x - g.player.pos.x, v.pos.z - g.player.pos.z).toFixed(2) };`);
    await sleep(1200);
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f' });
    await sleep(2500);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f' });
    await sleep(1500);
    const after = await runSafe(`
      const p = g.player;
      return { inVehicle: !!p.inVehicle, vehicle: p.vehicle ? p.vehicle.id : null, paused: !!g.paused };`);
    // if the 1 fps frame missed the key edge, prove the enter path itself works
    const directEnter = await runSafe(`
      const p = g.player;
      if (p.inVehicle) return { already: true };
      const near = g.vehicles.nearest(p.pos, 5.6);
      if (!near) return { noNear: true };
      p.enterVehicle(near);
      return { inVehicle: !!p.inVehicle, vehicle: p.vehicle ? p.vehicle.id : null, driver: near.driver };`);

    const errs = await run('return (window.__errs || []).slice(0, 4);').catch(() => []);
    const summary = { heights, variants, enter, after, directEnter, fatal: fatal.slice(0, 2), pageErrors: errs };
    fs.writeFileSync(path.resolve('tools/.last-fix-probe.json'), JSON.stringify(summary, null, 1));
    console.log('FIX-PROBE ' + JSON.stringify(summary));
    app.exit(0);
  } catch (e) {
    console.log('FIX-PROBE-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    app.exit(1);
  }
});
