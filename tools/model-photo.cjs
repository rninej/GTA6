// Palma City — close-up captures of the downloaded car and human models.
// Loads the shipped bundle, leaves the intro, parks the camera next to the
// nearest GLB car then the nearest GLB pedestrian, and saves two PNGs.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const url = arg('url', 'file://' + path.resolve('dist-browser/index.html'));
const W = Number(arg('width', 800)), H = Number(arg('height', 450));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  try {
    win.setContentSize(W, H);
    await win.loadURL(url);
    // wait for the title screen itself, not just the load flag
    for (let i = 0; i < 220; i++) {
      const ok = await run(`return !!(g && g.player && !g.loading && document.querySelector('#title button[data-action="new"]'));`).catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    await sleep(1500);
    await run(`const b = document.querySelector('#title button[data-action="new"]'); if (b) b.click(); return true;`).catch(() => false);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: W >> 1, y: H >> 1, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: W >> 1, y: H >> 1, button: 'left', clickCount: 1 });
    await run(`g.cutscene = false; g.started = true; g.paused = false; g.loading = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      g.sky.setHour(12.5);
      return true;`);
    await sleep(1800);

    const waitFrames = async (delta, maxMs = 90000) => {
      const t0 = Date.now(); const n0 = await run('return g.now').catch(() => 0);
      while (Date.now() - t0 < maxMs) {
        await sleep(350);
        const n1 = await run('return g.now').catch(() => n0);
        if (n1 - n0 >= delta) return true;
      }
      return false;
    };

    const shoot = async (file, pick) => {
      const ok = await run(`
        const v = ${pick};
        if (!v) return null;
        const p = g.player;
        // stand in front of the subject, along its own heading, so the camera
        // is not shoved inside a wall behind it
        const h = typeof v.heading === 'number' ? v.heading : 0;
        p.pos.x = v.pos.x + Math.sin(h) * 3.6;
        p.pos.z = v.pos.z + Math.cos(h) * 3.6;
        g.cam.yaw = Math.atan2(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
        g.cam.pitch = -0.02;
        return { x: v.pos.x, z: v.pos.z };`).catch((e) => ({ err: String(e).slice(0, 120) }));
      await waitFrames(0.15);
      const im = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(file), im.toPNG());
      console.log('PHOTO ' + file + ' ' + JSON.stringify(ok));
    };

    await shoot('screenshots/model-car.png',
      `g.vehicles.all.filter((x) => x.glb).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0]`);

    // Deterministic capture: aim the camera, render one frame, read the canvas.
    // capturePage lags badly at ~1 fps and the follow-cam fights teleports.
    const renderShot = async (file, setup) => {
      const dataUrl = await run(`
        const g0 = window.__PALMA__;
        ${setup}
        g0.cam.update = () => {};
        cam.position.set(cx, cy, cz);
        cam.lookAt(tx, ty, tz);
        g0.renderer.render(g0.scene, cam);
        g0.renderer.render(g0.scene, cam);
        return g0.renderer.domElement.toDataURL('image/png');`).catch((e) => ({ err: String(e).slice(0, 160) }));
      if (typeof dataUrl !== 'string') { console.log('PHOTO-FAIL ' + file + ' ' + JSON.stringify(dataUrl)); return null; }
      fs.writeFileSync(path.resolve(file), Buffer.from(dataUrl.split(',')[1], 'base64'));
      return true;
    };

    // pedestrian standing on the open street side of a downloaded bench
    const pedInfo = await run(`
      const spots = (g.city && g.city.propSpots) || [];
      const bench = spots.find((s) => s.kind === 'bench') || spots[0];
      const ped = (g.peds.list || []).find((x) => x.rig && x.rig.glb);
      if (!bench || !ped) return null;
      const nx = Math.sin(bench.yaw), nz = Math.cos(bench.yaw);   // outward, toward the street
      // keep the player nearby: pedestrians far from the player are culled
      const p = g.player;
      p.pos.x = bench.x + nx * 6.5;
      p.pos.z = bench.z + nz * 6.5;
      ped.pos.x = bench.x + nx * 2.8;
      ped.pos.z = bench.z + nz * 2.8;
      ped.heading = Math.atan2(-nx, -nz);       // face the camera
      if (ped.rig.glb.play) ped.rig.glb.play('idle', 0);
      window.__photoBench = bench;
      window.__photoPed = { x: ped.pos.x, y: ped.pos.y, z: ped.pos.z, nx, nz };
      return { x: +ped.pos.x.toFixed(1), z: +ped.pos.z.toFixed(1), y: +ped.pos.y.toFixed(2) };`).catch((e) => ({ err: String(e).slice(0, 100) }));
    await waitFrames(0.15);
    await renderShot('screenshots/model-human.png', `
        const ped = window.__photoPed;
        const cam = g0.cam.camera;
        const cx = ped.x + ped.nx * 3.4, cy = ped.y + 1.55, cz = ped.z + ped.nz * 3.4;
        const tx = ped.x, ty = ped.y + 0.95, tz = ped.z;`);
    console.log('PHOTO screenshots/model-human.png ' + JSON.stringify(pedInfo));

    // the same bench from the street, so the downloaded prop is legible
    const propInfo = await run(`const b = window.__photoBench; return b ? { kind: b.kind, x: +b.x.toFixed(1), z: +b.z.toFixed(1) } : null;`).catch(() => null);
    await renderShot('screenshots/model-prop.png', `
        const b = window.__photoBench;
        const cam = g0.cam.camera;
        const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw);
        const cx = b.x + nx * 3.2, cy = 1.45, cz = b.z + nz * 3.2;
        const tx = b.x, ty = 0.55, tz = b.z;`);
    console.log('PHOTO screenshots/model-prop.png ' + JSON.stringify(propInfo));

    console.log('PHOTO-DONE');
    app.exit(0);
  } catch (e) {
    console.log('PHOTO-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    app.exit(1);
  }
});
