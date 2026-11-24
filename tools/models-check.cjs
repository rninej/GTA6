// Palma City — downloaded-model verification.
//
// Loads the real browser bundle over file:// with Node disabled and measures,
// rather than eyeballing frames:
//   * how many manifest assets loaded, and whether any failed or fell back
//   * that cars and characters are actually using the GLB instances
//   * that skinned bones move between frames while walking (not a T-pose)
//   * that car wheel nodes spin and steer with the physics
//   * that look-right and strafe-right still hold
//   * that the facade window geometry is still in the scene
//
// usage: electron tools/models-check.cjs --url=file:///.../index.html

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const url = arg('url', 'file://' + path.resolve('dist-browser/index.html'));
const shot = arg('shot', 'screenshots/models-check.png');
const W = Number(arg('width', 640));
const H = Number(arg('height', 360));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();

const logs = [];
const requests = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });

  win.webContents.on('console-message', (e, level, message) => {
    const text = typeof message === 'string' ? message : e && e.message;
    const lvl = typeof level === 'number' ? level : (e && e.level) || 0;
    if (text) logs.push({ level: lvl, text: String(text).slice(0, 220) });
  });
  win.webContents.session.webRequest.onCompleted((d) => {
    requests.push({ url: String(d.url).slice(0, 140), status: d.statusCode });
  });
  win.webContents.session.webRequest.onErrorOccurred((d) => {
    requests.push({ url: String(d.url).slice(0, 140), error: String(d.error) });
  });

  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);

  const report = (obj) => {
    const abs = path.resolve('tools/.last-models-check.json');
    fs.writeFileSync(abs, JSON.stringify(obj, null, 1));
    console.log('MODELS-CHECK ' + JSON.stringify(obj.summary || {}));
  };

  try {
    win.setContentSize(W, H);
    await win.loadURL(url);

    for (let i = 0; i < 160; i++) {
      if (await run('return !!(g && g.player && !g.loading)').catch(() => false)) break;
      await sleep(500);
    }

    const clicked = await run(`const b = document.querySelector('#title button[data-action="new"]'); if (!b) return false; b.click(); return true;`).catch(() => false);
    await sleep(600);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: W >> 1, y: H >> 1, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: W >> 1, y: H >> 1, button: 'left', clickCount: 1 });

    // leave the intro flyover so everything below runs in actual gameplay
    await run(`
      g.cutscene = false; g.started = true; g.paused = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      return true;`);
    await sleep(1200);

    const waitFrames = async (delta, maxMs = 120000) => {
      const t0 = Date.now();
      const n0 = await run('return g.now').catch(() => 0);
      while (Date.now() - t0 < maxMs) {
        await sleep(400);
        const n1 = await run('return g.now').catch(() => n0);
        if (n1 - n0 >= delta) return true;
      }
      return false;
    };
    await waitFrames(0.15);

    // ---- manifest / loader -------------------------------------------------
    const models = await run(`
      const M = window.__PALMA_MODELS__ || null;
      if (!M) return { missing: true };
      return {
        attempted: M.attempted, loaded: M.loaded, errors: M.errors.slice(0, 6),
        cars: M.cars.length, humans: M.humans.length, props: M.props.length,
        carFallbacks: M.carFallbacks, humanFallbacks: M.humanFallbacks,
        manifestCars: (M.manifest && M.manifest.cars || []).length,
        manifestHumans: (M.manifest && M.manifest.humans || []).length
      };`);

    // ---- what the entities are actually rendering --------------------------
    const entity = await run(`
      const p = g.player;
      const withGlb = g.vehicles.all.filter((v) => v.glb).length;
      const total = g.vehicles.all.length;
      const peds = g.peds.list || [];
      const pedsWithGlb = peds.filter((e) => e.rig && e.rig.glb).length;
      const boneNames = [];
      if (p.rig && p.rig.glb) {
        p.rig.glb.root.traverse((o) => { if (o.isBone && boneNames.length < 40) boneNames.push(o.name); });
      }
      return {
        playerHasGlb: !!(p.rig && p.rig.glb),
        playerClips: p.rig && p.rig.glb ? Object.keys(p.rig.glb.actions) : [],
        vehiclesWithGlb: withGlb, vehiclesTotal: total,
        peds: peds.length, pedsWithGlb,
        bones: boneNames.length,
        tris: g.renderer.info.render.triangles,
        calls: g.renderer.info.render.calls
      };`);

    // ---- bones must move while walking -------------------------------------
    const sampleBone = () => run(`
      const rig = g.player.rig;
      if (!rig || !rig.glb) return null;
      let bone = null;
      rig.glb.root.traverse((o) => { if (!bone && o.isBone && /LeftFoot|LeftLeg|Hips/i.test(o.name)) bone = o; });
      if (!bone) return null;
      const v = new (bone.position.constructor)();
      bone.getWorldPosition(v);
      return { name: bone.name, x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4),
        clip: rig._glbRole, time: +rig.glb.mixer.time.toFixed(3) };
    `);

    const bone0 = await sampleBone();
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w' });
    await waitFrames(0.25);
    const bone1 = await sampleBone();
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w' });

    const boneMoved = !!(bone0 && bone1) &&
      (Math.abs(bone1.x - bone0.x) + Math.abs(bone1.y - bone0.y) + Math.abs(bone1.z - bone0.z) > 0.002);

    // ---- wheels: spin while moving, steer while turning ---------------------
    const spinProbe = () => run(`
      const cars = g.vehicles.all.filter((v) => v.glb && v.glb.wheels.length);
      const v = cars.find((c) => Math.abs(c.speed) > 1) || cars[0];
      if (!v) return null;
      const w = v.glb.wheels[0];
      return { id: v.id, spin: +w.wheel.rotation.x.toFixed(4), speed: +v.speed.toFixed(2), wheels: v.glb.wheels.length };`);
    const spin0 = await spinProbe();
    await waitFrames(0.2);
    const spin1 = await run(`
      const v = g.vehicles.all.find((c) => c.id === ${spin0 ? spin0.id : -1});
      if (!v || !v.glb) return null;
      const w = v.glb.wheels[0];
      return { spin: +w.wheel.rotation.x.toFixed(4), speed: +v.speed.toFixed(2) };`);
    const wheelSpun = !!(spin0 && spin1) && Math.abs(spin1.spin - spin0.spin) > 0.01;

    // steering: hand one GLB car to the player controls and press A, so the
    // chain is real input -> readPlayerInput -> physics.steerAngle -> wheel
    // pivot. Parked cars zero their steer each frame, which is why the first
    // attempt measured nothing.
    const steerSetup = await run(`
      const cars = g.vehicles.all.filter((v) => v.glb && v.glb.wheels.length && !v.dead);
      if (!cars.length) return null;
      const v = cars[0];
      window.__steerTest = v.id;
      v.driver = 'player';
      v.speed = 2;
      return { id: v.id };`);
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    await waitFrames(0.25);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a' });
    const steerAfter = await run(`
      const v = g.vehicles.all.find((c) => c.id === window.__steerTest);
      if (!v || !v.glb) return null;
      const w = v.glb.wheels.find((x) => x.front) || v.glb.wheels[0];
      const out = { steerAngle: +v.steerAngle.toFixed(4), pivot: +w.pivot.rotation.y.toFixed(4),
        inputSteer: +v.steer.toFixed(2) };
      v.driver = null; v.steer = 0;
      return out;`);
    const steerHit = steerSetup && steerAfter ? { ...steerSetup, ...steerAfter } : null;
    const wheelSteered = !!steerHit &&
      Math.abs(steerHit.steerAngle) > 0.02 &&
      Math.abs(steerHit.pivot - steerHit.steerAngle) < 0.002;

    // ---- controls must not have regressed ----------------------------------
    const readFwd = () => run(`const y = g.cam.yaw; return { yaw: y, fx: Math.sin(y), fz: Math.cos(y) };`);
    const lookBefore = await readFwd();
    await run(`window.dispatchEvent(new MouseEvent('mousemove', { movementX: 140, movementY: 0, bubbles: true })); true;`);
    await sleep(500);
    const lookAfter = await readFwd();
    const srX = -lookBefore.fz, srZ = lookBefore.fx;
    const turnedRight = (lookAfter.fx - lookBefore.fx) * srX + (lookAfter.fz - lookBefore.fz) * srZ > 0;

    const s0 = await run('return [+g.player.pos.x.toFixed(3), +g.player.pos.z.toFixed(3)];');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'd' });
    await waitFrames(0.2);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'd' });
    const s1 = await run('return [+g.player.pos.x.toFixed(3), +g.player.pos.z.toFixed(3)];');
    const strafeRight = (s1[0] - s0[0]) * srX + (s1[1] - s0[1]) * srZ > 0.05;

    // ---- facades still present ---------------------------------------------
    const facade = await run(`
      let trims = 0;
      g.scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.getAttribute && o.geometry.getAttribute('position') && o.geometry.getAttribute('position').count > 20000) trims++; });
      return { bigMeshes: trims, tris: g.renderer.info.render.triangles };`);


    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.resolve(shot), img.toPNG());

    const fatal = logs.filter((l) => l.level >= 3);
    const badReq = requests.filter((r) => r.error || (r.status && r.status >= 400));
    const textureReq = requests.filter((r) => /models?\//i.test(r.url));

    const summary = {
      assetsLoaded: models.loaded, assetsAttempted: models.attempted,
      modelErrors: (models.errors || []).length,
      carFallbacks: models.carFallbacks, humanFallbacks: models.humanFallbacks,
      vehiclesWithGlb: entity.vehiclesWithGlb, vehiclesTotal: entity.vehiclesTotal,
      playerHasGlb: entity.playerHasGlb, pedsWithGlb: entity.pedsWithGlb, peds: entity.peds,
      clips: (entity.playerClips || []).length,
      bones: entity.bones,
      boneMoved, clipWhileWalking: bone1 && bone1.clip,
      wheelSpun, wheelSteered, wheelSpin0: spin0 && spin0.spin, wheelSpin1: spin1 && spin1.spin,
      steerSeen: steerHit && steerHit.steerAngle, pivotSteer: steerHit && steerHit.pivot,
      turnedRight, strafeRight,
      tris: entity.tris, calls: entity.calls,
      fatal: fatal.length, badRequests: badReq.length, modelRequests: textureReq.length
    };
    summary.passed =
      summary.modelErrors === 0 &&
      summary.carFallbacks === 0 &&
      summary.humanFallbacks === 0 &&
      summary.vehiclesWithGlb === summary.vehiclesTotal && summary.vehiclesTotal > 0 &&
      summary.playerHasGlb && summary.pedsWithGlb > 0 &&
      summary.boneMoved && summary.wheelSpun && summary.wheelSteered &&
      summary.turnedRight && summary.strafeRight &&
      summary.fatal === 0 && summary.badRequests === 0;

    report({ summary, models, entity, bone0, bone1, spin0, spin1, steerHit, facade, logs: logs.slice(0, 20), requests: requests.slice(0, 10) });
    app.exit(summary.passed ? 0 : 1);
  } catch (err) {
    report({ summary: { error: String(err && err.stack ? err.stack : err) }, logs });
    app.exit(1);
  }
});
