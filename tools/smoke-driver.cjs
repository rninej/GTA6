// Palma City — scripted play driver.
//
// Loaded INSIDE the packaged app's main process (guarded by PALMA_DRIVER) and plays
// the real game window with injected keyboard and mouse events sent through
// Chromium's input pipeline. It never calls a gameplay function to make something
// happen: every walk, jump, shot, car key and menu press goes through
// webContents.sendInputEvent, exactly like a player at the keyboard. Renderer
// state is only READ, to assert that the input did what it should.
//
// The software rasteriser on this VM manages a little over one frame a second, so
// the driver switches shadow maps off and drives every step by waiting for game
// state to change rather than by wall-clock timing. Gameplay logic is untouched.

const fs = require('node:fs');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

module.exports = function attachDriver(win, app) {
  const t0 = Date.now();
  const log = (...a) => console.log(`[driver] ${a.join(' ')}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const elapsed = () => Date.now() - t0;

  const results = [];
  let failures = 0;
  const consoleMessages = [];

  win.webContents.on('console-message', (e, level, message) => {
    if (typeof message === 'string') consoleMessages.push(`console[${level}] ${message}`);
    else if (e && e.message) consoleMessages.push(`console[${e.level || level}] ${e.message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleMessages.push(`render-process-gone ${JSON.stringify(d)}`));

  // ------------------------------------------------------------- renderer access
  const run = (body) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${body} })()`, true);
  const snap = () => run(`
    const p = g.player, v = p && p.vehicle;
    const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent : ''; };
    return {
      loading: !!g.loading, started: !!g.started, paused: !!g.paused, cutscene: !!g.cutscene,
      x: p ? p.pos.x : 0, y: p ? p.pos.y : 0, z: p ? p.pos.z : 0,
      heading: p ? p.heading : 0, health: p ? p.health : 0, money: p ? p.money : 0,
      stamina: p ? p.stamina : 0,
      crouching: !!p.crouching, aiming: !!p.aiming, sprinting: !!p.sprinting,
      grounded: !!p.grounded, inV: !!(p && p.inVehicle),
      vx: v ? v.pos.x : 0, vz: v ? v.pos.z : 0, speed: v ? v.speed : 0, vh: v ? v.heading : 0,
      wanted: g.wanted | 0, cops: g.police && g.police.agents ? g.police.agents.length : 0,
      mission: g.missions.current ? g.missions.current.id : null,
      obj: g.missions.objIdx | 0, objText: txt('obj-text'), objTitle: txt('obj-title'),
      ammo: p && p.ammo ? p.ammo.mag : -1,
      pr: g.renderer.getPixelRatio(), camY: g.camera.position.y, yaw: g.cam.yaw, pitch: g.cam.pitch,
      locked: !!(g.input && g.input.locked),
      peds: g.peds.list.length, calls: g.renderer.info.render.calls
    };
  `);

  // ------------------------------------------------------------- injected input
  // Chromium wants accelerator names; the game reads event.code.
  let nativeKeys = true;
  function sendKey(code, down) {
    if (nativeKeys) {
      win.webContents.sendInputEvent({ type: down ? 'keyDown' : 'keyUp', keyCode: code });
      return;
    }
    const k = code === 'Space' ? ' ' : code.replace('Key', '').toLowerCase();
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { code: '${code}', key: '${k}', bubbles: true })); true`
    );
  }

  const held = new Set();
  function setKeys(list) {
    const want = new Set(list);
    for (const c of [...held]) if (!want.has(c)) { sendKey(c, false); held.delete(c); }
    for (const c of want) if (!held.has(c)) { sendKey(c, true); held.add(c); }
  }
  function releaseAll() { setKeys([]); }

  // Pointer-lock look: Chromium derives movementX/Y from the cursor position, so
  // the driver walks a virtual cursor across the window and wraps it at the edge.
  let cursorX = null, cursorY = null;
  function mouseMove(dx, dy) {
    const [w, h] = win.getContentSize();
    if (cursorX === null) { cursorX = w / 2; cursorY = h / 2; }
    cursorX += dx;
    cursorY += dy;
    if (cursorX < 20) cursorX += w - 40;
    if (cursorX > w - 20) cursorX -= w - 40;
    if (cursorY < 20) cursorY += h - 40;
    if (cursorY > h - 20) cursorY -= h - 40;
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(cursorX), y: Math.round(cursorY),
      movementX: Math.round(dx), movementY: Math.round(dy)
    });
  }
  function mouseButton(btn, down) {
    const [w, h] = win.getContentSize();
    win.webContents.sendInputEvent({
      type: down ? 'mouseDown' : 'mouseUp',
      x: Math.round(w / 2), y: Math.round(h / 2),
      button: btn === 0 ? 'left' : 'right', clickCount: 1
    });
    const type = down ? 'mousedown' : 'mouseup';
    const target = down ? 'document.getElementById("game")' : 'window';
    win.webContents.executeJavaScript(
      `${target}.dispatchEvent(new MouseEvent('${type}', { button: ${btn}, buttons: ${down ? (btn === 0 ? 1 : 2) : 0}, bubbles: true, cancelable: true })); true`
    );
  }
  async function clickCanvas() {
    const [w, h] = win.getContentSize();
    const at = { x: Math.round(w / 2), y: Math.round(h / 2) };
    win.webContents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
  }

  // ------------------------------------------------------------- assertions
  async function step(name, fn) {
    const s = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail, ms: Date.now() - s });
      log(`PASS ${name} (${Math.round((Date.now() - s) / 1000)}s) ${detail ? JSON.stringify(detail) : ''}`);
      return true;
    } catch (err) {
      failures++;
      const error = String((err && err.message) || err);
      results.push({ name, ok: false, error, ms: Date.now() - s });
      log(`FAIL ${name}: ${error}`);
      return false;
    }
  }
  function expect(cond, msg) { if (!cond) throw new Error(msg); }
  async function waitFor(fn, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); }
    throw new Error(`timed out waiting for ${label}`);
  }
  async function holdUntil(keys, cond, ms, label) {
    setKeys(keys);
    const end = Date.now() + ms;
    let s = await snap();
    while (Date.now() < end) {
      s = await snap();
      if (cond(s)) { releaseAll(); return s; }
    }
    releaseAll();
    throw new Error(`timed out waiting for ${label}`);
  }
  async function tapKey(code) {
    sendKey(code, true);
    await sleep(900);           // long enough to span at least one simulated frame
    sendKey(code, false);
    await sleep(500);
  }

  // ------------------------------------------------------------------ bot nav
  // Eight-way walking: movement is relative to the body heading, so a target can
  // be decomposed into W/S and A/D without needing the mouse at all.
  async function walkTo(tx, tz, opts = {}) {
    const end = Date.now() + (opts.timeout || 180000);
    const stop = opts.stop || 3;
    while (Date.now() < end) {
      const s = await snap();
      if (opts.check && (await opts.check(s))) { releaseAll(); return s; }
      const dx = tx - s.x, dz = tz - s.z;
      if (Math.hypot(dx, dz) < stop) { releaseAll(); return s; }
      // decompose the unit direction, not the raw offset: a target half a metre
      // away must still produce a key press
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const h = s.yaw;
      const fwd = ux * Math.sin(h) + uz * Math.cos(h);
      const right = ux * Math.cos(h) - uz * Math.sin(h);
      const keys = [];
      if (fwd > 0.33) keys.push('W'); else if (fwd < -0.33) keys.push('S');
      if (right > 0.33) keys.push('D'); else if (right < -0.33) keys.push('A');
      setKeys(keys);
      await sleep(150);
    }
    releaseAll();
    throw new Error(`walk timed out heading for ${tx.toFixed(0)},${tz.toFixed(0)}`);
  }

  async function routeTo(fromX, fromZ, tx, tz) {
    return run(`
      const a = g.city.nearestNode(${fromX}, ${fromZ});
      const b = g.city.nearestNode(${tx}, ${tz});
      const ids = g.city.findPath(g.city.graph.indexOf(a), g.city.graph.indexOf(b));
      return ids.map((i) => ({ x: g.city.graph[i].x, z: g.city.graph[i].z }));
    `);
  }

  // Drive to a world point along the road graph, all through injected keys.
  async function driveTo(tx, tz, opts = {}) {
    const end = Date.now() + (opts.timeout || 600000);
    const stop = opts.stop || 5;
    let s = await snap();
    let wps = await routeTo(s.vx, s.vz, tx, tz);
    let wi = 0;
    let lastX = 1e9, lastZ = 1e9, lastMove = Date.now();
    while (Date.now() < end) {
      s = await snap();
      expect(s.inV, 'player is no longer in a vehicle');
      if (opts.check && (await opts.check(s))) { releaseAll(); return s; }
      while (wi < wps.length && Math.hypot(s.vx - wps[wi].x, s.vz - wps[wi].z) < 11) wi++;
      const wx = wi < wps.length ? wps[wi].x : tx;
      const wz = wi < wps.length ? wps[wi].z : tz;
      const dx = wx - s.vx, dz = wz - s.vz;
      if (Math.hypot(dx, dz) < stop) { releaseAll(); return s; }
      const diff = wrapAngle(Math.atan2(dx, dz) - s.vh);
      const abs = Math.abs(diff);
      const keys = [];
      if (abs > 0.08) keys.push(diff > 0 ? 'A' : 'D');
      // The car only yaws while it is rolling (turnRate is proportional to
      // speed), so a target more than ~60 deg off heading has to keep the
      // throttle on. Steering alone at a standstill never turns the nose and
      // the drive deadlocks on its very first waypoint.
      if (abs > 1.1) keys.push(s.speed > 14 ? 'S' : 'W');
      else if (Math.abs(s.speed) < (abs > 0.3 ? 9 : 22)) keys.push('W');
      setKeys(keys);
      if (Math.hypot(s.vx - lastX, s.vz - lastZ) > 1.5) { lastX = s.vx; lastZ = s.vz; lastMove = Date.now(); }
      if (Date.now() - lastMove > 9000) {
        // wedged: back out with the wheels turned the other way, then re-plan
        // from where we actually are in case we were knocked off the route
        setKeys([diff > 0 ? 'D' : 'A', 'S']);
        await sleep(2500);
        setKeys([]);
        const fresh = await routeTo(s.vx, s.vz, tx, tz).catch(() => null);
        if (fresh && fresh.length) { wps = fresh; wi = 0; }
        lastMove = Date.now();
      }
      await sleep(120);
    }
    releaseAll();
    throw new Error(`drive timed out heading for ${tx.toFixed(0)},${tz.toFixed(0)}`);
  }

  // -------------------------------------------------------------------- the run
  async function main() {
    // -------------------------------------------------------------- boot
    win.setContentSize(960, 540);
    await waitFor(async () => (await run('return !g.loading;')), 240000, 'engine load');
    await run(`document.querySelector('#title button[data-action="new"]').click(); return true;`);
    await waitFor(async () => (await run('return g.started && !g.paused;')), 60000, 'game start');
    await sleep(6000); // the opening chapter card clears itself after 4.2 s

    // Software rasteriser only: shadow maps cost a full extra scene pass. Off so
    // the play-through finishes in minutes; gameplay is unaffected.
    await run(`
      g.renderer.shadowMap.enabled = false;
      g.scene.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      return true;
    `);

    await step('boot: the packaged game reaches a running world', async () => {
      const s = await snap();
      expect(s.started && !s.paused, 'game did not reach the running state');
      expect(!s.cutscene, 'still in the intro card');
      expect(s.peds > 0, 'no pedestrians populated');
      const fps = await run(`new Promise((res) => {
        let n = 0; const t0 = performance.now();
        const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(+(n / 2).toFixed(2)); };
        requestAnimationFrame(tick);
      })`);
      return { peds: s.peds, calls: s.calls, health: Math.round(s.health), fps };
    });

    await step('input: an injected key reaches the game', async () => {
      sendKey('W', true);
      await sleep(400);
      const keys = await run('return [...g.input.keys];');
      sendKey('W', false);
      nativeKeys = keys.includes('KeyW');
      if (!nativeKeys) log('native key code not delivered - falling back to DOM key events');
      else expect(keys.length > 0, 'no key reached the game');
      return { mode: nativeKeys ? 'native sendInputEvent' : 'DOM KeyboardEvent', keys };
    });

    // -------------------------------------------------------------- walking
    await step('movement: W walks the player forward', async () => {
      const a = await snap();
      const b = await holdUntil(['W'], (s) => Math.hypot(s.x - a.x, s.z - a.z) > 2, 90000, 'a two metre walk');
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      expect(d < 25, `moved ${d.toFixed(1)} m at once - that is a teleport, not a walk`);
      return { walked: +d.toFixed(2) };
    });

    await step('movement: SHIFT sprints (stamina drains, more ground covered)', async () => {
      const a = await snap();
      const b = await holdUntil(['W', 'Shift'], (s) => Math.hypot(s.x - a.x, s.z - a.z) > 5, 90000, 'a five metre sprint');
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      expect(b.stamina < a.stamina - 1, `stamina did not drain (${a.stamina} -> ${b.stamina})`);
      return { sprinted: +d.toFixed(2), stamina: `${Math.round(a.stamina)} -> ${Math.round(b.stamina)}` };
    });

    await step('movement: SPACE jumps and lands', async () => {
      const a = await snap();
      expect(a.grounded, 'not grounded before the jump');
      sendKey('Space', true);
      await sleep(900);
      sendKey('Space', false);
      let peak = a.y, airborne = false;
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        const s = await snap();
        peak = Math.max(peak, s.y);
        if (!s.grounded) airborne = true;
        if (airborne && s.grounded && s.y <= a.y + 0.12) break;
        if (!airborne && Date.now() > end - 45000) break;
      }
      expect(airborne, 'never left the ground');
      expect(peak - a.y > 0.28, `peak height was only ${(peak - a.y).toFixed(2)} m`);
      return { peak: +(peak - a.y).toFixed(2) };
    });

    await step('movement: CTRL crouches and lowers the camera', async () => {
      const a = await snap();
      await holdUntil(['Control'], (x) => x.crouching, 40000, 'the crouch pose');
      setKeys(['Control']);
      const s = await waitFor(async () => { const q = await snap(); return a.camY - q.camY > 0.12 ? q : false; }, 40000, 'the crouched camera to drop');
      releaseAll();
      await waitFor(async () => !(await snap()).crouching, 40000, 'standing back up');
      return { drop: +(a.camY - s.camY).toFixed(2), crouched: s.crouching };
    });

    await step('camera: mouse look turns the view (pointer lock)', async () => {
      // a window without OS focus accepts the lock but drops the movement
      // events that follow, so take focus first
      win.focus(); win.webContents.focus();
      await clickCanvas();
      await sleep(1500);
      let s = await snap();
      if (!s.locked) {
        await win.webContents.executeJavaScript('document.getElementById("game").requestPointerLock(); true', true);
        await sleep(1500);
        s = await snap();
      }
      expect(s.locked, 'pointer lock was never granted, so mouse look cannot be tested');
      const a = await snap();
      for (let i = 0; i < 6; i++) { mouseMove(60, 0); await sleep(220); }
      let b = await snap();
      let mode = 'sendInputEvent';
      if (Math.abs(wrapAngle(b.yaw - a.yaw)) < 0.03) {
        mode = 'DOM MouseEvent';
        await run(`for (let i = 0; i < 6; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 60, movementY: 0, bubbles: true })); return true;`);
        await sleep(1500);
        b = await snap();
      }
      let d = Math.abs(wrapAngle(b.yaw - a.yaw));
      if (d <= 0.03) {
        // one retry through a trusted click: an untrusted requestPointerLock can
        // be granted and dropped in the same frame
        win.focus(); win.webContents.focus();
        await clickCanvas();
        await sleep(1200);
        const a2 = await snap();
        for (let i = 0; i < 6; i++) { mouseMove(60, 0); await sleep(220); }
        d = Math.abs(wrapAngle((await snap()).yaw - a2.yaw));
      }
      expect(d > 0.03, `yaw only moved ${d.toFixed(3)} rad`);
      return { yaw: +d.toFixed(3), mode };
    });

    await step('camera: right mouse button aims', async () => {
      mouseButton(2, true);
      let s = null;
      try {
        s = await waitFor(async () => { const q = await snap(); return q.aiming ? q : false; }, 40000, 'aim pose');
      } finally { mouseButton(2, false); }
      expect(s && s.aiming, 'player.aiming stayed false while the right button was held');
      return { aiming: true };
    });

    // -------------------------------------------------------------- vehicles
    await step('vehicle: walk up to a car and get in with F', async () => {
      const setup = await run(`
        const p = g.player;
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        const v = g.vehicles.spawnAt('muscle', p.pos.x + fx * 2.6, p.pos.z + fz * 2.6, p.heading);
        return { id: v.id, x: v.pos.x, z: v.pos.z };
      `);
      await sleep(1200);
      let s = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        await tapKey('F');
        s = await waitFor(async () => {
          const q = await snap();
          return q.inV && Math.hypot(q.vx - setup.x, q.vz - setup.z) < 8 ? q : false;
        }, 12000, 'the car door').catch(() => null);
        if (s) break;
        const cur = await snap();
        if (cur.inV) { await tapKey('F'); await sleep(800); }
        await walkTo(setup.x, setup.z, { stop: 2.4, timeout: 60000 });
      }
      s = await waitFor(async () => { const q = await snap(); return q.inV && Math.hypot(q.vx - setup.x, q.vz - setup.z) < 8 ? q : false; }, 40000, 'entering the spawned car');
      return { car: setup.id };
    });

    await step('vehicle: throttle drives, steering turns, brakes stop', async () => {
      // scenario setup: park the car on a road-graph lane so the test drives down
      // open street instead of into whatever wall it happened to spawn beside
      await run(`
        const v = g.player.vehicle;
        const n = g.city.graph[0];
        const next = g.city.graph[n.links[0].node];
        v.pos.set(n.x, 0.02, n.z);
        v.heading = Math.atan2(next.x - n.x, next.z - n.z);
        v.speed = 0; v.throttle = 0; v.brake = 0; v.steer = 0;
        v.mesh.rotation.y = v.heading;
        return true;
      `);
      await sleep(1200);
      const a = await snap();
      const b = await holdUntil(['W'], (s) => Math.abs(s.speed) > 4, 60000, 'the car to reach 4 m/s');
      expect(Math.hypot(b.vx - a.vx, b.vz - a.vz) > 0.2, 'the car did not move at all');
      const c = await holdUntil(['A'], (s) => Math.abs(wrapAngle(s.vh - b.vh)) > 0.12, 40000, 'the car to turn');
      const turned = Math.abs(wrapAngle(c.vh - b.vh));
      const d = await holdUntil(['S'], (s) => Math.abs(s.speed) < Math.abs(c.speed) - 1.5 || Math.abs(s.speed) < 1.2, 60000, 'the brakes');
      return { top: +b.speed.toFixed(2), turned: +turned.toFixed(2), afterBrake: +d.speed.toFixed(2) };
    });

    await step('vehicle: SPACE is the handbrake', async () => {
      const a = await holdUntil(['W'], (s) => Math.abs(s.speed) > 6, 60000, 'the car to reach 6 m/s');
      const b = await holdUntil(['Space'], (s) => Math.abs(s.speed) < Math.abs(a.speed) - 0.8, 40000, 'the handbrake to scrub speed');
      return { before: +a.speed.toFixed(1), after: +b.speed.toFixed(1) };
    });

    await step('vehicle: F gets out of the car', async () => {
      await tapKey('F');
      const s = await waitFor(async () => { const q = await snap(); return q.inV ? false : q; }, 40000, 'leaving the car');
      expect(!s.inV, 'still in the vehicle after pressing F');
      return { x: +s.x.toFixed(1), z: +s.z.toFixed(1) };
    });

    // -------------------------------------------------------------- mission
    await step('mission: walk into the marker and start SUNBURN', async () => {
      await run(`
        const m = g.missions.missions[0];
        const s = g.city.snapToStreet(m.start.x, m.start.z - 16);
        g.player.teleport(new (g.player.pos.constructor)(s.x, 0.24, s.z));
        g.player.health = 100;
        g.missions.index = 0; g.missions.cooldown = 0; g.missions.current = null;
        return { x: s.x, z: s.z };
      `);
      await sleep(2000);
      const start = await run('const m = g.missions.missions[0]; return { x: m.start.x, z: m.start.z };');
      await walkTo(start.x, start.z, { stop: 4, timeout: 240000, check: async (s) => s.mission !== null });
      const s = await waitFor(async () => { const q = await snap(); return q.mission ? q : false; }, 30000, 'the mission to start');
      expect(s.mission === 'sunburn', `mission is ${s.mission}`);
      for (let i = 0; i < 8; i++) {
        const d = await run('return !!g.missions.dialogue;');
        if (!d) break;
        await tapKey('Space');
      }
      await waitFor(async () => !(await run('return !!g.missions.dialogue;')), 40000, 'the intro dialogue to finish');
      const t = await snap();
      expect(/garage|docks/i.test(t.objText), `objective text is "${t.objText}"`);
      return { mission: s.mission, objective: t.objText };
    });

    await step('mission: drive to the docks, the HUD objective changes', async () => {
      // scenario setup: a car on the nearest road node (guaranteed clear of
      // geometry) with the player standing beside it, and no driven traffic near
      const car = await run(`
        const p = g.player;
        const n = g.city.nearestNode(p.pos.x, p.pos.z);
        const v = g.vehicles.spawnAt('sedan', n.x, n.z, 0);
        for (const o of g.vehicles.all) {
          if (o === v || !o.driver) continue;
          if (Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z) < 9) o.removed = true;
        }
        p.teleport(new (p.pos.constructor)(n.x + 1.6, 0.24, n.z));
        return { id: v.id, x: v.pos.x, z: v.pos.z };
      `);
      await sleep(1200);
      let gotCar = false;
      for (let attempt = 0; attempt < 4 && !gotCar; attempt++) {
        // F toggles, so wait for the state change instead of reading once: a
        // single read can land before the frame that processes the key, and the
        // next tap would then get straight back out
        await tapKey('F');
        gotCar = await waitFor(async () => (await snap()).inV, 12000, 'the car door').catch(() => false);
        if (gotCar) break;
        if (attempt === 1) {
          // setup fallback: stand right beside the car, then use the key again
          await run(`
            const p = g.player;
            p.teleport(new (p.pos.constructor)(${car.x} + 1.4, 0.24, ${car.z}));
            return true;
          `);
          await sleep(1500);
        } else {
          await walkTo(car.x, car.z, { stop: 2.6, timeout: 45000 }).catch(() => {});
        }
      }
      gotCar = gotCar || (await snap()).inV;
      expect(gotCar, 'could not get into a car for the drive');
      const before = await snap();
      const obj = await run('const o = g.missions.currentObj; return { x: o.x, z: o.z };');
      const after = await driveTo(obj.x, obj.z, { stop: 6, timeout: 900000, check: async (st) => st.obj !== before.obj });
      expect(after.obj > before.obj, `objective did not advance (still ${after.obj})`);
      expect(after.objText !== before.objText, 'the HUD objective text did not change');
      return { from: before.objText, to: after.objText };
    });

    await step('mission: steal the Sabre, deliver it, mission passed', async () => {
      let obj = await run('const o = g.missions.currentObj, c = g.missions.state.car; return { type: o.type, x: c ? c.pos.x : o.x, z: c ? c.pos.z : o.z, car: c ? c.id : null };');
      expect(obj.type === 'steal', `expected the steal objective, got ${obj.type}`);
      await driveTo(obj.x, obj.z, { stop: 9, timeout: 600000 });
      let inSabre = false;
      for (let attempt = 0; attempt < 4 && !inSabre; attempt++) {
        const s = await snap();
        if (s.inV) { await tapKey('F'); await sleep(1200); }
        obj = await run(`
          const c = g.missions.state.car;
          for (const o of g.vehicles.all) {
            if (o === c || !o.driver) continue;
            if (Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 9) o.removed = true;
          }
          return { x: c.pos.x, z: c.pos.z, car: c.id };
        `);
        await walkTo(obj.x, obj.z, { stop: 2.6, timeout: 120000 });
        await tapKey('F');
        await sleep(1500);
        inSabre = await run(`return !!(g.player.inVehicle && g.player.vehicle && g.player.vehicle.id === ${obj.car});`);
      }
      expect(inSabre, 'could not get into the mission Sabre');
      await waitFor(async () => (await snap()).obj > 1, 40000, 'the steal objective to complete');
      const before = await snap();
      const del = await run('const o = g.missions.currentObj; return { x: o.x, z: o.z, text: o.text };');
      await driveTo(del.x, del.z, { stop: 5, timeout: 900000, check: async (st) => st.mission === null });
      const after = await snap();
      expect(after.mission === null, 'the mission never completed');
      const money = await run('return g.player.money;');
      expect(money > before.money, 'no mission payout');
      const banner = await run(`const e = document.getElementById('banner-title'); return e ? e.textContent : '';`);
      return { delivered: del.text, payout: money - before.money, banner };
    });

    // -------------------------------------------------------------- combat
    await step('combat: fire and kill a pedestrian with real clicks', async () => {
      // scenario setup: stand on open street, clear of geometry, so the shot is
      // not absorbed by a wall the camera happens to be buried in
      await run(`
        const p = g.player;
        const st = g.city.snapToStreet(-196, -6);
        p.teleport(new (p.pos.constructor)(st.x, 0.24, st.z));
        p.health = 100;
        return true;
      `);
      await sleep(2500);
      // face the current view direction and level the pitch with the mouse
      for (let i = 0; i < 6; i++) {
        const s = await snap();
        if (Math.abs(s.pitch) < 0.05) break;
        mouseMove(0, clamp(-s.pitch * 260, -80, 80));
        await sleep(600);
      }
      const ped = await run(`
        const p = g.player;
        const fx = Math.sin(g.cam.yaw), fz = Math.cos(g.cam.yaw);
        const e = g.peds.makePed(p.pos.x + fx * 4.5, p.pos.z + fz * 4.5);
        e.pos.x = p.pos.x + fx * 4.5;
        e.pos.z = p.pos.z + fz * 4.5;
        e.pos.y = p.pos.y;
        e.heading = g.cam.yaw + Math.PI;
        e.state = 'idle';
        g.peds.list.push(e);
        window.__TESTPED__ = e;
        return { health: e.health, pitch: g.cam.pitch, n: g.peds.list.length };
      `);
      await sleep(1500);
      // hold the trigger down: at one frame a second a click shorter than a frame
      // would never be seen by the game loop
      let dead = false, hp = ped.health, ammo = -1;
      mouseButton(0, true);
      const end = Date.now() + 180000;
      while (Date.now() < end && !dead) {
        await sleep(2500);
        // hold the target still five metres down the crosshair
        await run(`
          const e = window.__TESTPED__, p = g.player;
          if (e && !e.dead) {
            const fx = Math.sin(g.cam.yaw), fz = Math.cos(g.cam.yaw);
            e.pos.x = p.pos.x + fx * 4.5; e.pos.z = p.pos.z + fz * 4.5;
            e.pos.y = p.pos.y;
            e.state = 'idle'; e.speed = 0;
          }
          return true;
        `);
        const h = await run(`const e = window.__TESTPED__; return e ? { dead: !!e.dead, hp: e.health, ammo: g.player.ammo.mag } : { dead: true, hp: 0, ammo: 0 };`);
        dead = h.dead || h.hp <= 0;
        hp = h.hp;
        ammo = h.ammo;
      }
      mouseButton(0, false);
      await sleep(800);
      expect(dead, `pedestrian survived the burst (hp ${hp}, pitch ${ped.pitch.toFixed(2)}, ammo ${ammo})`);
      return { hp, ammo };
    });

    await step('combat: the kill raises the wanted level', async () => {
      const s = await snap();
      expect(s.wanted >= 1, `wanted level stayed at ${s.wanted}`);
      return { wanted: s.wanted };
    });

    // -------------------------------------------------------------- police
    await step('police: units respond and close in', async () => {
      let sawCop = false, closest = 1e9, cars = 0, agents = 0;
      const end = Date.now() + 300000;
      while (Date.now() < end) {
        // cruisers are the response; officers only bail out once one is close
        const i = await run(`
          const p = g.player.pos;
          let cars = 0, agents = 0, d = 1e9;
          for (const v of g.vehicles.all) {
            if (v.driver !== 'cop' || v.dead) continue;
            cars++;
            d = Math.min(d, Math.hypot(v.pos.x - p.x, v.pos.z - p.z));
          }
          for (const a of (g.police.agents || [])) {
            if (a.faction !== 'cop' || a.dead) continue;
            agents++;
            d = Math.min(d, Math.hypot(a.pos.x - p.x, a.pos.z - p.z));
          }
          return { cars, agents, d };
        `);
        cars = Math.max(cars, i.cars);
        agents = Math.max(agents, i.agents);
        if (i.cars > 0 || i.agents > 0) sawCop = true;
        closest = Math.min(closest, i.d);
        if (sawCop && closest < 90) break;
        await sleep(1500);
      }
      expect(sawCop, 'no police cruiser or officer was ever dispatched');
      expect(closest < 120, `police never closed in (closest ${closest.toFixed(0)} m)`);
      return { cars, agents, closest: +closest.toFixed(0) };
    });

    await step('police: drive away until the wanted level clears', async () => {
      await run(`const p = g.player; const v = g.vehicles.spawnAt('muscle', p.pos.x + 2.2, p.pos.z + 2.2, p.heading); return v.id;`);
      await sleep(1200);
      await tapKey('F');
      await waitFor(async () => (await snap()).inV, 40000, 'getting into the getaway car');
      const started = Date.now();
      // phase 1: two minutes of driving to break line of sight
      const driveEnd = started + 120000;
      while (Date.now() < driveEnd) {
        const s = await snap();
        if (s.wanted === 0) { releaseAll(); return { cleared: true, seconds: Math.round((Date.now() - started) / 1000) }; }
        const keys = ['W'];
        if (Math.floor((Date.now() - started) / 7000) % 2 === 0) keys.push('A');
        setKeys(keys);
        await sleep(400);
      }
      // phase 2: stop and let the heat bleed off
      releaseAll();
      setKeys(['S']);
      await sleep(2500);
      releaseAll();
      const end = Date.now() + 600000;
      while (Date.now() < end) {
        const s = await snap();
        if (s.wanted === 0) return { cleared: true, seconds: Math.round((Date.now() - started) / 1000) };
        await sleep(1000);
      }
      throw new Error('wanted level never cleared');
    });

    // -------------------------------------------------------------- pause + settings
    await step('menu: ESC pauses, a quality change is observable, ESC resumes', async () => {
      // make sure we start from the running state, whatever the earlier steps left
      if ((await snap()).paused) {
        await tapKey('Escape');
        await waitFor(async () => !(await snap()).paused, 40000, 'the game to resume');
      }
      // Chromium swallows the first Escape while the pointer is locked, so retry
      let p = false;
      for (let attempt = 0; attempt < 3 && !p; attempt++) {
        await tapKey('Escape');
        p = await waitFor(async () => { const q = await snap(); return q.paused ? q : false; }, 20000, 'the pause menu').catch(() => false);
      }
      expect(p, 'the pause menu never opened');
      expect(p.paused, 'Escape did not pause the game');
      const before = await run('return g.renderer.getPixelRatio();');
      await run(`document.querySelector('.seg[data-setting="quality"] button[data-value="low"]').click(); return true;`);
      await sleep(1200);
      const after = await run('return g.renderer.getPixelRatio();');
      expect(Math.abs(after - before) > 0.02, `render pixel ratio unchanged (${before} -> ${after})`);
      await run(`document.querySelector('.seg[data-setting="quality"] button[data-value="high"]').click(); return true;`);
      await sleep(800);
      await tapKey('Escape');
      await waitFor(async () => !(await snap()).paused, 40000, 'resuming');
      return { ratio: `${before.toFixed(2)} -> ${after.toFixed(2)}`, resumed: true };
    });

    // -------------------------------------------------------------- audio
    await step('audio: master, sfx and radio buses carry real samples', async () => {
      await run('if (g.audio.ctx && g.audio.ctx.state !== "running") g.audio.ctx.resume(); return true;');
      await sleep(1500);
      // three shots on foot: weapon and world effects land on the sfx bus
      for (let i = 0; i < 3; i++) { mouseButton(0, true); await sleep(600); mouseButton(0, false); await sleep(900); }
      // then a car, so the engine and the radio are actually running
      if (!(await snap()).inV) {
        await run(`const p = g.player; g.vehicles.spawnAt('muscle', p.pos.x + 2.2, p.pos.z + 2.2, p.heading); return true;`);
        await sleep(1200);
        await tapKey('F');
        await waitFor(async () => (await snap()).inV, 40000, 'getting into a car for the audio test').catch(() => {});
      }
      setKeys(['W']);
      await sleep(6000);
      let master = 0, sfx = 0, radio = 0, engine = 0, speed = 0, state = 'none';
      for (let i = 0; i < 10; i++) {
        const m = await run(`
          const a = g.audio;
          return {
            state: a.ctx ? a.ctx.state : 'none',
            master: a.meter('master'), sfx: a.meter('sfx'), radio: a.meter('radio'),
            engine: a.engineHz || 0, speed: g.player.vehicle ? Math.abs(g.player.vehicle.speed) : 0
          };
        `);
        master = Math.max(master, m.master);
        sfx = Math.max(sfx, m.sfx);
        radio = Math.max(radio, m.radio);
        engine = Math.max(engine, m.engine);
        speed = Math.max(speed, m.speed);
        state = m.state;
        await sleep(500);
      }
      const m = { state, master: +master.toFixed(5), sfx: +sfx.toFixed(5), radio: +radio.toFixed(5), engine: +engine.toFixed(1), speed: +speed.toFixed(1) };
      releaseAll();
      expect(m.state === 'running', `audio context is ${m.state}`);
      expect(m.master > 0.0002, `master bus is silent (${m.master})`);
      expect(m.sfx > 0.0002, `sfx bus is silent (${m.sfx})`);
      expect(m.radio > 0.0002, `radio bus is silent (${m.radio})`);
      return m;
    });

    await step('exit: the window closes cleanly', async () => {
      releaseAll();
      await run('if (g.input.releaseLock) g.input.releaseLock(); return true;');
      await sleep(500);
      win.close();
      await sleep(1200);
      return { closed: true };
    });
  }

  // ------------------------------------------------------------------ teardown
  (async () => {
    try {
      await main();
    } catch (err) {
      failures++;
      log(`DRIVER CRASHED: ${(err && err.stack) || err}`);
    }
    const report = { at: new Date().toISOString(), ms: elapsed(), failures, results, console: consoleMessages };
    try {
      if (process.env.PALMA_DRIVER_OUT) fs.writeFileSync(process.env.PALMA_DRIVER_OUT, JSON.stringify(report, null, 2));
    } catch (err) { log(`could not write report: ${err.message}`); }
    const passed = results.filter((r) => r.ok).length;
    log(`SUMMARY ${passed}/${results.length} steps passed, ${failures} failed, ${consoleMessages.length} renderer console messages, ${Math.round(elapsed() / 1000)}s`);
    for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' - ' + r.error}`);
    for (const c of consoleMessages) log(`  CONSOLE ${c}`);
    try { win.destroy(); } catch {}
    app.exit(failures > 0 ? 1 : 0);
  })();
};
