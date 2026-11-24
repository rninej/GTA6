// Palma City — browser-build harness.
//
// Runs the game the way a browser does: a plain window with Node disabled
// (nodeIntegration:false, contextIsolation:true, sandbox:true) pointed at the
// static-server URL, so nothing Electron-specific can leak into the test.
//
// The software rasteriser on this VM manages roughly one frame per second, so
// every step waits for the game loop to advance (g.now) rather than for a
// wall-clock delay. Renderer state is only READ; input goes through Chromium's
// real input pipeline (sendInputEvent) or a DOM KeyboardEvent, exactly like a
// player at the keyboard.
//
// usage: electron tools/browser-test.cjs --url=http://127.0.0.1:8765/index.html
//          --shot=screenshots/browser-http.png [--width=960] [--height=540]

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const url = arg('url', 'http://127.0.0.1:8765/index.html');
const shot = arg('shot', 'screenshots/browser-http.png');
const wallShot = arg('wallshot', '');
const statsOnly = argv.includes('--stats');
const quick = argv.includes('--quick');
const wallOnly = argv.includes('--wall-only');
const step = (m) => console.log('STEP ' + m);
const width = Number(arg('width', 960));
const height = Number(arg('height', 540));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();

let failed = false;
const logs = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (e, level, message) => {
    const text = typeof message === 'string' ? message : e && e.message;
    const lvl = typeof level === 'number' ? level : (e && e.level) || 0;
    if (text) logs.push({ level: lvl, text: String(text).slice(0, 300) });
  });
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    failed = true;
    logs.push({ level: 3, text: `did-fail-load ${code} ${desc} ${failedUrl}` });
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    failed = true;
    logs.push({ level: 3, text: `render-process-gone ${JSON.stringify(d)}` });
  });

  const requests = [];
  try {
    win.webContents.session.webRequest.onCompleted((d) => {
      requests.push({ url: String(d.url).slice(0, 160), status: d.statusCode, type: d.resourceType });
    });
    win.webContents.session.webRequest.onErrorOccurred((d) => {
      requests.push({ url: String(d.url).slice(0, 160), error: String(d.error), type: d.resourceType });
    });
  } catch (e) {
    logs.push({ level: 3, text: 'could not attach webRequest listeners: ' + e.message });
  }

  const run = (body) =>
    win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${body} })()`, true);

  const out = (obj) => {
    const abs = path.resolve('tools/.last-browser-run.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(obj, null, 1));
    const brief = {
      passed: obj.passed,
      moved: obj.moved,
      tris: obj.state && obj.state.tris,
      calls: obj.state && obj.state.calls,
      hud: obj.state && obj.state.hudVisible,
      started: obj.state && obj.state.started,
      locked: obj.state && obj.state.locked,
      loop: obj.loop,
      walk: obj.walk,
      turnedRight: obj.look && obj.look.turnedRight,
      strafeRight: obj.strafe && obj.strafe.strafeRight,
      strafeDist: obj.strafe && obj.strafe.dist,
      fatal: obj.fatalCount,
      bad: obj.badGeo && obj.badGeo.length,
      reqs: obj.requestCount,
      assetReqs: obj.assetRequests,
      badReqs: obj.badRequests && obj.badRequests.length,
      error: obj.error,
    };
    console.log('BROWSER-TEST ' + JSON.stringify(brief));
  };

  try {
    win.setContentSize(width, height);
    await win.loadURL(url);

    // wait for the game object
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await run('return !!(g && g.player)').catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('window.__PALMA__ never appeared');

    // wait for the load sequence to finish (it is async, not frame driven)
    for (let i = 0; i < 120; i++) {
      const loading = await run('return !!g.loading').catch(() => true);
      if (!loading) break;
      await sleep(500);
    }

    // leave the title screen: this is the same click a player makes
    const clicked = await run(`const b = document.querySelector('#title button[data-action="new"]');
      if (!b) return false;
      b.click();
      return true;`).catch(() => false);

    // a trusted click on the canvas grants pointer lock, which the game wants
    await sleep(600);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: width >> 1, y: height >> 1, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: width >> 1, y: height >> 1, button: 'left', clickCount: 1 });

    // wait until the loop is actually running: g.now has to advance
    const waitFrames = async (delta, maxMs = 120000) => {
      const start = Date.now();
      const n0 = await run('return g.now').catch(() => 0);
      let n1 = n0;
      while (Date.now() - start < maxMs) {
        await sleep(400);
        n1 = await run('return g.now').catch(() => n0);
        if (n1 - n0 >= delta) return { ok: true, frames: n1 - n0 };
      }
      return { ok: false, frames: n1 - n0 };
    };

    step('loop');
    const loop = await waitFrames(0.2, 90000);

    const readPos = () =>
      run('return g && g.player ? [+g.player.pos.x.toFixed(2), +g.player.pos.z.toFixed(2)] : null;');
    const readNow = () => run('return g.now').catch(() => 0);

    const state = await run(`
      const hud = document.getElementById('hud');
      return {
        ready: true,
        started: !!g.started,
        paused: !!g.paused,
        loading: !!g.loading,
        locked: !!(g.input && g.input.locked),
        tris: g.renderer.info.render.triangles,
        calls: g.renderer.info.render.calls,
        canvas: [g.renderer.domElement.width, g.renderer.domElement.height],
        pos: g.player ? [+g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2), +g.player.pos.z.toFixed(2)] : null,
        hudVisible: !!hud && !hud.classList.contains('hidden'),
      };`);

    step('state');
    const before = state.pos;

    if (statsOnly) {
      const st = await run(`return {
        tris: g.renderer.info.render.triangles,
        calls: g.renderer.info.render.calls,
        geometries: g.renderer.info.memory.geometries,
        textures: g.renderer.info.memory.textures,
        hud: !document.getElementById('hud').classList.contains('hidden')
      };`);
      console.log('STATS ' + JSON.stringify(st));
      app.exit(0);
      return;
    }

    // ---- walk forward with W -------------------------------------------------
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w' });
    let held = await run(`return { keys: [...(g.input.keys || [])], down: g.input.down('KeyW') };`).catch(() => null);
    let keyMode = 'native';
    if (!held || !held.down) {
      // Chromium's synthetic key did not map to event.code; dispatch it directly
      keyMode = 'dom';
      await run(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); true;`);
      held = await run(`return { keys: [...(g.input.keys || [])], down: g.input.down('KeyW') };`).catch(() => null);
    }

    step('walk');
    const walk = wallOnly ? { ok: true, frames: 0 } : await waitFrames(0.2, 120000);
    const after = await readPos();
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w' });
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); true;`).catch(() => {});

    const moved = before && after ? Math.hypot(after[0] - before[0], after[1] - before[2]) : -1;

    step('look');
    // ---- look direction: mouse-right must turn the view right ---------------
    const readFwd = () => run(`const y = g.cam.yaw; return { yaw: y, fx: Math.sin(y), fz: Math.cos(y) };`);
    const lookBefore = wallOnly ? { yaw: 0, fx: 0, fz: 1 } : await readFwd();
    if (!wallOnly) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: (width >> 1) + 140, y: height >> 1 });
    await sleep(400);
    }
    let lookAfter = wallOnly ? lookBefore : await readFwd();
    let lookMode = 'native';
    if (Math.abs(lookAfter.yaw - lookBefore.yaw) < 1e-6) {
      lookMode = 'dom';
      await run(`window.dispatchEvent(new MouseEvent('mousemove', { movementX: 140, movementY: 0, bubbles: true })); true;`);
      await sleep(400);
      lookAfter = await readFwd();
    }
    // screen-right for a forward of (sin yaw, 0, cos yaw)
    const srX = -lookBefore.fz;
    const srZ = lookBefore.fx;
    const turnedRight = (lookAfter.fx - lookBefore.fx) * srX + (lookAfter.fz - lookBefore.fz) * srZ > 0;

    // ---- strafe: D must move the player toward screen-right ------------------
    const strafeBefore = await run('return [+g.player.pos.x.toFixed(3), +g.player.pos.z.toFixed(3)];');
    if (wallOnly) { step('wall-only: no strafe'); }
    if (quick) {
      step('quick: skipping strafe');
    }
    win.focus();
    win.webContents.focus();
    if (!wallOnly) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'd' });
    if (!wallOnly) await waitFrames(0.2, 90000);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'd' });
    const strafeAfter = await run('return [+g.player.pos.x.toFixed(3), +g.player.pos.z.toFixed(3)];');
    const sdx = strafeAfter[0] - strafeBefore[0];
    const sdz = strafeAfter[1] - strafeBefore[1];
    const strafeRight = sdx * srX + sdz * srZ > 0.05;
    const strafeDist = Math.hypot(sdx, sdz);

    step('wall');
    // ---- close-up of a facade: turn 90 degrees and walk into the wall --------
    let wallInfo = null;
    if (wallShot) {
      // face the nearest building-sized collider, not just "90 degrees"
      const target = await run(`
        const p = g.player.pos;
        let best = null;
        for (const c of g.city.queryColliders(p.x, p.z, 60)) {
          const w = c.x1 - c.x0, d = c.z1 - c.z0;
          if (w < 5 || d < 5) continue;
          const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
          const dist = Math.hypot(cx - p.x, cz - p.z);
          if (!best || dist < best.dist) best = { dist, yaw: Math.atan2(cx - p.x, cz - p.z) };
        }
        return best ? best.yaw : g.cam.yaw + Math.PI;`);
      for (let i = 0; i < 8; i++) {
        const cur = await run('return g.cam.yaw;');
        let delta = target - cur;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        if (Math.abs(delta) < 0.05) break;
        const px = Math.round(-delta / 0.0022);
        await run(`window.dispatchEvent(new MouseEvent('mousemove', { movementX: ${px}, movementY: 0, bubbles: true })); true;`);
        await sleep(500);
      }
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w' });
      await waitFrames(1.2, 120000);
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w' });
      await sleep(400);
      wallInfo = await run('return { yaw: g.cam.yaw, pos: [+g.player.pos.x.toFixed(1), +g.player.pos.z.toFixed(1)] };');
      const wallAbs = path.resolve(wallShot);
      fs.mkdirSync(path.dirname(wallAbs), { recursive: true });
      const wallImg = await win.webContents.capturePage();
      fs.writeFileSync(wallAbs, wallImg.toPNG());
    }

    step('scan');
    // ---- what is broken in the scene ----------------------------------------
    const badGeo = await run(`
      const bad = [];
      g.scene.traverse((o) => {
        if (!o.geometry || !o.geometry.getAttribute) return;
        const p = o.geometry.getAttribute('position');
        if (!p) return;
        for (let i = 0; i < p.count; i++) {
          if (!isFinite(p.getX(i)) || !isFinite(p.getY(i)) || !isFinite(p.getZ(i))) {
            const m = o.material || {};
            bad.push({
              geo: o.geometry.type,
              verts: p.count,
              mat: m.type,
              color: m.color ? m.color.getHexString() : null,
              vertexColors: !!m.vertexColors,
              parent: o.parent ? o.parent.type : null,
            });
            break;
          }
        }
      });
      return bad.slice(0, 10);`).catch((e) => ['ERR ' + e.message]);

    step('shot');
    // ---- screenshot of the running game -------------------------------------
    if (shot) {
      const abs = path.resolve(shot);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const img = await win.webContents.capturePage();
      fs.writeFileSync(abs, img.toPNG());
    }

    const fatal = logs.filter((l) => l.level >= 3);
    // A file:// page must make no texture requests and no network calls at all.
    // Over http:// the page's own document and script are http URLs, so only
    // texture requests count as asset loads there.
    const pageIsFile = String(url).startsWith('file:');
    const assetReqs = requests.filter(
      (r) => /textures?\//i.test(r.url) || (pageIsFile && /^https?:/i.test(r.url))
    );
    const badReqs = requests.filter((r) => r.error || (r.status && r.status >= 400));
    const ok =
      !failed &&
      state.tris > 100000 &&
      state.hudVisible &&
      state.started &&
      moved > 0.05 &&
      walk.ok &&
      turnedRight &&
      strafeRight &&
      fatal.length === 0 &&
      assetReqs.length === 0 &&
      badReqs.length === 0;

    out({
      url,
      clicked,
      keyMode,
      held,
      wall: wallInfo,
      look: { mode: lookMode, before: lookBefore.yaw, after: lookAfter.yaw, turnedRight },
      strafe: { dist: +strafeDist.toFixed(2), strafeRight },
      loop,
      walk,
      state,
      before,
      after,
      moved: +moved.toFixed(2),
      badGeo,
      fatalCount: fatal.length,
      requestCount: requests.length,
      requests: requests.slice(0, 12),
      assetRequests: assetReqs.length,
      badRequests: badReqs.map((r) => r.url + ' ' + (r.error || r.status)),
      passed: ok,
      logs: logs.slice(0, 25),
    });

    app.exit(ok ? 0 : 1);
  } catch (err) {
    out({ url, error: String(err && err.stack ? err.stack : err), logs: logs.slice(0, 25) });
    app.exit(1);
  }
});
