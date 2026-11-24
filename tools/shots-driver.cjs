// Palma City — packaged-build screenshot and perf pass.
//
// Loaded INSIDE the packaged app's main process (guarded by PALMA_DRIVER), like
// tools/smoke-driver.cjs. It only poses the camera and captures the real window
// with webContents.capturePage(); every pixel comes from the shipped asar under
// the same software GL stack.
//
//   PALMA_DRIVER=tools/shots-driver.cjs electron ".../resources/app.asar"
//   PALMA_DRIVER=... PALMA_MEASURE=1 electron ".../resources/app.asar"   # perf only
//
// The two passes run as separate processes on purpose: changing the drawing
// buffer size inside a live session upsets the software compositor and the next
// captures come back with textures missing.

const fs = require('node:fs');
const path = require('node:path');

module.exports = function attachShots(win, app) {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'screenshots');
  const MEASURE_ONLY = !!process.env.PALMA_MEASURE;
  const log = (...a) => console.log('[shots]', a.join(' '));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (body) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${body} })()`, true);

  const waitFor = async (fn, timeout = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await run(`return (${fn})();`).catch(() => false);
      if (ok) return true;
      await sleep(750);
    }
    return false;
  };

  // 24 renders + gl.finish on the canonical spawn view at 1024 x 640, warmed up
  // so first-frame shader compilation and texture upload are not timed.
  const MEASURE = `
    g.paused = true;
    const prevRatio = g.renderer.getPixelRatio();
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(1024, 640, false);
    const c = g.camera;
    c.position.set(-188, 2.1, -22);
    c.lookAt(-188, 2.0, 60);
    c.updateMatrixWorld(true);
    const gl = g.renderer.getContext();
    for (let i = 0; i < 8; i++) g.renderer.render(g.scene, g.camera);
    gl.finish();
    const runs = [];
    let calls = 0, tris = 0;
    g.renderer.info.autoReset = false;
    for (let pass = 0; pass < 3; pass++) {
      g.renderer.info.reset();
      const t0 = performance.now();
      for (let i = 0; i < 16; i++) g.renderer.render(g.scene, g.camera);
      gl.finish();
      runs.push((performance.now() - t0) / 16);
      calls = g.renderer.info.render.calls / 16;
      tris = g.renderer.info.render.triangles / 16;
    }
    runs.sort((a, b) => a - b);
    g.renderer.info.autoReset = true;
    g.renderer.info.reset();
    g.renderer.setPixelRatio(prevRatio);
    return { ms: +runs[1].toFixed(2), runs: runs.map((r) => +r.toFixed(2)), calls: Math.round(calls), tris: Math.round(tris) };`;

  // The sun's *position* is only written in sky.update(), so at a fixed hour the
  // hour setter alone leaves the light below the horizon and the city goes black.
  const setHour = (h) => `g.sky.setHour(${h}); g.sky.update(0.0001, g); g.sky.refreshEnv(); g.city.update(0.016, g);`;

  const pose = (pos, look) => `
    g.paused = true;
    const c = g.camera;
    c.position.set(${pos[0]}, ${pos[1]}, ${pos[2]});
    c.lookAt(${look[0]}, ${look[1]}, ${look[2]});
    c.updateMatrixWorld(true);
    return true;`;

  // a parked car on the street (not one boxed in by a lot), 3/4 front view
  const VEHICLE = `
    g.paused = true;
    const p = g.player.pos;
    let best = null, bd = 1e9;
    for (const v of g.vehicles.all) {
      if (v.driver || v.removed || v.dead) continue;
      const node = g.city.nearestNode(v.pos.x, v.pos.z);
      if (Math.hypot(node.x - v.pos.x, node.z - v.pos.z) > 9) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) best = g.vehicles.all.find((v) => !v.driver) || g.vehicles.all[0];
    const h = best.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    const c = g.camera;
    c.position.set(best.pos.x + fx * 3.1 + rx * 3.3, 1.38, best.pos.z + fz * 3.1 + rz * 3.3);
    c.lookAt(best.pos.x, 0.78, best.pos.z);
    c.updateMatrixWorld(true);
    return { type: best.type, x: +best.pos.x.toFixed(1), z: +best.pos.z.toFixed(1) };`;

  // a driven car in the street, buildings and props behind it
  const TRAFFIC = `
    g.paused = true;
    const driven = g.vehicles.all.filter((v) => v.driver && !v.removed && !v.dead);
    const p = g.player.pos;
    driven.sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z));
    const t = driven[0] || g.vehicles.all[0];
    const h = t.heading;
    const c = g.camera;
    c.position.set(t.pos.x - Math.sin(h) * 9.5 - Math.cos(h) * 4.2, 2.1, t.pos.z - Math.cos(h) * 9.5 + Math.sin(h) * 4.2);
    c.lookAt(t.pos.x, 0.9, t.pos.z);
    c.updateMatrixWorld(true);
    return { type: t.type, x: +t.pos.x.toFixed(1), z: +t.pos.z.toFixed(1) };`;

  // the player character, close enough to judge face, hands, clothing and the
  // planted feet. `pose` steps the rig by hand because the game is paused.
  const PLAYER = (pose) => `
    g.paused = true;
    const pl = g.player;
    ${pose}
    const h = pl.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    const c = g.camera;
    c.position.set(pl.pos.x + fx * 2.5 + rx * 1.7, pl.pos.y + 1.42, pl.pos.z + fz * 2.5 + rz * 1.7);
    c.lookAt(pl.pos.x, pl.pos.y + 1.02, pl.pos.z);
    c.updateMatrixWorld(true);
    return { x: +pl.pos.x.toFixed(1), z: +pl.pos.z.toFixed(1) };`;

  const IDLE_POSE = `for (let i = 0; i < 60; i++) pl.rig.update(1 / 60, { speed: 0 });`;

  // street level, 3/4 on a low-rise shop row: window reveals, awnings, signage,
  // fire escapes and the plinth course, framed the way a pedestrian sees them
  const STREET_LEVEL = `
    g.paused = true;
    const p = g.player.pos;
    const shops = (g.city.shopFronts || []).slice().sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    // queryColliders returns whole grid cells, so test the AABBs ourselves
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    let best = null;
    for (const s of shops) {
      if (!s.street) continue;
      if (Math.hypot(s.x - p.x, s.z - p.z) > 320) continue;
      if (hit(s.x - 4.4, s.z + 8.4, 0.8)) continue;
      if (hit(s.x + 2.6, s.z + 8.4, 0.8)) continue;
      best = s; break;
    }
    if (!best) return false;
    const c2 = g.camera;
    c2.position.set(best.x - 4.4, 1.65, best.z + 8.4);
    c2.lookAt(best.x + 2.6, 3.6, best.z);
    c2.updateMatrixWorld(true);
    return { x: +best.x.toFixed(1), z: +best.z.toFixed(1), w: +best.w.toFixed(1) };`;

  // A north-south avenue runs along x = -94 (road -104..-84), so a camera on
  // that centreline always looks down an open street with facades both sides.
  const AVENUE = (z, y, dz) => pose([-94, y, z], [-94, y - 0.15, z + dz]);

  // straight-on view of a street-facing shopfront / mid-rise, from the road
  const FACADE_ON = `
    g.paused = true;
    const p = g.player.pos;
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    const shops = (g.city.shopFronts || []).filter((s) => s.street).sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    let best = null;
    for (const s of shops) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > 320) continue;
      if (hit(s.x, s.z + 15, 1.0)) continue;
      best = s; break;
    }
    if (!best) return false;
    const c2 = g.camera;
    c2.fov = 55; c2.updateProjectionMatrix();
    c2.position.set(best.x, 2.4, best.z + 15);
    c2.lookAt(best.x, 7.4, best.z);
    c2.updateMatrixWorld(true);
    return { x: +best.x.toFixed(1), z: +best.z.toFixed(1) };`;

  // straight-on debug frame of one low-rise facade, to judge sill / band
  // alignment against the painted openings
  const DEBUG_FACADE = `
    g.paused = true;
    const p = g.player.pos;
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    let best = null, bd = 1e9;
    for (const c of g.city.queryColliders(p.x, p.z, 280)) {
      if (c.maxY < 9 || c.maxY > 26) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (w < 12 || d < 12) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const sides = [
        { x: cx, z: c.maxZ + 12, lx: cx, lz: c.maxZ },
        { x: cx, z: c.minZ - 12, lx: cx, lz: c.minZ },
        { x: c.maxX + 12, z: cz, lx: c.maxX, lz: cz },
        { x: c.minX - 12, z: cz, lx: c.minX, lz: cz }
      ];
      const ok = sides.find((s) => !hit(s.x, s.z, 1.2));
      if (!ok) continue;
      const d2 = Math.hypot(cx - p.x, cz - p.z);
      if (d2 < bd) { bd = d2; best = { ...ok, h: +c.maxY.toFixed(1), w: +(c.maxX - c.minX).toFixed(1) }; }
    }
    if (!best) return false;
    const c2 = g.camera;
    c2.fov = 58; c2.updateProjectionMatrix();
    c2.position.set(best.x, 2.6, best.z);
    c2.lookAt(best.lx, 5.2, best.lz);
    c2.updateMatrixWorld(true);
    return best;`;

  // close street-level group of pedestrians: heads, hair, jackets, hands, shoes
  const PED_GROUP = `
    g.paused = true;
    const p = g.player.pos;
    // queryColliders returns whole grid cells, so test the AABBs ourselves
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    // prefer a pedestrian wearing a jacket and no hat: the portrait has to show
    // sleeve deformation and hair strands, not a beanie and bare arms
    const score = (e) => {
      const o = (e.model && e.model.opts) || {};
      return (o.jacket ? 0 : 1000) + (o.hat ? 400 : 0) + Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    };
    const near = g.peds.list
      .filter((e) => !e.dead)
      .sort((a, b) => score(a) - score(b))
      .slice(0, 8);
    if (!near.length) return false;
    for (const e of near) { e.state = 'idle'; e.speed = 0; e.alert = 0; }
    // Stand the camera 2.7 m in front of the ped, but only on a side that is
    // clear of buildings: a portrait taken from inside a wall is no portrait.
    let t = null, cx = 0, cz = 0, heading = 0;
    for (const e of near) {
      for (let i = 0; i < 12; i++) {
        const h = (i / 12) * Math.PI * 2;
        const x = e.pos.x + Math.sin(h) * 2.7;
        const z = e.pos.z + Math.cos(h) * 2.7;
        if (hit(x, z, 0.7)) continue;
        if (hit(x, z, 0.35)) continue;
        t = e; cx = x; cz = z;
        heading = Math.atan2(x - e.pos.x, z - e.pos.z);
        break;
      }
      if (t) break;
    }
    if (!t) return false;
    t.heading = heading;
    t.mesh.rotation.y = heading;
    for (let i = 0; i < 30; i++) t.rig.update(1 / 60, { speed: 0 });
    // pose one arm bent after the last update, so the shot shows the sleeve
    // deforming across the elbow instead of a rigid tube
    t.rig.p.shoulderR.rotation.x = -0.62;
    t.rig.p.shoulderR.rotation.z = 0.2;
    t.rig.p.elbowR.rotation.x = -1.62;
    t.mesh.updateMatrixWorld(true);
    // head-and-shoulders portrait. At 2.7 m a 42 degree lens still frames the
    // whole body, so the camera steps in along the same clear direction until
    // the head fills the upper half and the beard is judgeable.
    const dirx = (cx - t.pos.x) / 2.7, dirz = (cz - t.pos.z) / 2.7;
    const c2 = g.camera;
    c2.fov = 34; c2.updateProjectionMatrix();
    c2.position.set(t.pos.x + dirx * 1.45, 1.63, t.pos.z + dirz * 1.45);
    c2.lookAt(t.pos.x, 1.62, t.pos.z);
    c2.updateMatrixWorld(true);
    return { n: near.length, x: +t.pos.x.toFixed(1), z: +t.pos.z.toFixed(1) };`;

  // close chase view of a car: tail lamps, plate, boot seam, wheels, mirrors
  const CAR_CLOSE = `
    g.paused = true;
    const p = g.player.pos;
    // prefer a passenger car so the shot shows the flank creases and lamps
    // only low cars: a van or pickup has a tall boxy rear that says nothing
    // about panel detail, and the shot has to show the wheel face clearly
    const pref = ['coupe', 'sedan', 'muscle', 'hatch', 'sports', 'taxi', 'police'];
    let best = null, bd = 1e9;
    for (const v of g.vehicles.all) {
      if (v.removed || v.dead) continue;
      const sh = v.parts && v.parts.sh;
      if (!sh || sh.bed) continue;
      if (sh.cabin[1][1] > 1.55) continue;
      if (!pref.includes(v.type)) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return false;
    const h = best.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    // rear-three-quarter at 45 degrees, low enough to see the near rear wheel
    // face: the tread pattern and the vented disc both have to read here
    const bsh = (best.parts && best.parts.sh) || {};
    const ax = bsh.axle || 1.4;
    const hw = (bsh.w || 1.9) / 2;
    // aim at the near rear WHEEL, not the car centre: from 2 m out the centre
    // sits behind the flank and the body fills the frame
    const wx = best.pos.x - fx * ax + rx * hw;
    const wz = best.pos.z - fz * ax + rz * hw;
    const c2 = g.camera;
    c2.fov = 50; c2.updateProjectionMatrix();
    c2.position.set(wx + rx * 1.95 - fx * 1.5, 0.78, wz + rz * 1.95 - fz * 1.5);
    c2.lookAt(wx, 0.42, wz);
    c2.updateMatrixWorld(true);
    return { type: best.type, x: +best.pos.x.toFixed(1), z: +best.pos.z.toFixed(1), w: bsh.w, axle: ax };`;

  // the real in-game chase camera: player in a street-parked car, vehicle mode 0
  const CHASE = `
    g.paused = true;
    const p = g.player.pos;
    let best = null, bd = 1e9;
    for (const v of g.vehicles.all) {
      if (v.removed || v.dead) continue;
      if (!v.driver) continue;            // a car already on a road, mid-street
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return false;
    best.speed = 0;
    if (best.vel && best.vel.set) best.vel.set(0, 0, 0);
    best.setDriver(null);
    g.player.pos.copy(best.pos);
    g.player.enterVehicle(best);
    g.cam.setMode('vehicle');
    g.cam.vehicleMode = 0;
    g.cam.snap();
    for (let i = 0; i < 40; i++) g.cam.update(1 / 60, g);
    return { type: best.type, x: +best.pos.x.toFixed(1), z: +best.pos.z.toFixed(1) };`;

  // head-and-shoulders portrait from the front, to judge the face and neck
  const PLAYER_FACE = `
    g.paused = true;
    const pl = g.player;
    const h = pl.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    const c = g.camera;
    c.position.set(pl.pos.x + fx * 1.5 + rx * 0.55, pl.pos.y + 1.57, pl.pos.z + fz * 1.5 + rz * 0.55);
    c.lookAt(pl.pos.x, pl.pos.y + 1.5, pl.pos.z);
    c.updateMatrixWorld(true);
    for (let i = 0; i < 60; i++) pl.rig.update(1 / 60, { speed: 0, lookAt: c.position });
    return true;`;

  // day first, night last: the clock only ever moves once, in one direction
  // 3.3 m off a real shopfront wall: window frames, glazing, blinds, AC, meter
  const grabCanvas = () => run(`const c = g.renderer.domElement;
    g.renderer.render(g.scene, g.camera);
    return c.toDataURL('image/png');`);

  const FACADE_NEAR = `
    if (g.cam && g.cam.update) g.cam.update = () => {};
    const hudEl = document.getElementById('hud'); if (hudEl) hudEl.style.display = 'none';
    const p = g.player.pos;
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    const shops = (g.city.shopFronts || []).filter((s) => s.street).sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    let best = null;
    for (const s of shops) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > 300) continue;
      if (hit(s.x, s.z + 3.2, 0.9)) continue;
      best = s; break;
    }
    if (!best) return false;
    const c2 = g.camera;
    // the street is on whichever side the player stands on, so step out toward
    // the player instead of assuming the facade faces +z
    const ux = (p.x - best.x) / (Math.hypot(p.x - best.x, p.z - best.z) || 1);
    const uz = (p.z - best.z) / (Math.hypot(p.x - best.x, p.z - best.z) || 1);
    c2.fov = 34; c2.updateProjectionMatrix();
    c2.position.set(best.x, 2.6, best.z + 6.0);
    c2.lookAt(best.x, 4.6, best.z);
    c2.updateMatrixWorld(true);
    return { x: +best.x.toFixed(1), z: +best.z.toFixed(1), w: +best.w.toFixed(1) };`;

  // oblique pavement view: kerb, sidewalk joints, awnings, wall clutter
  const STREET_NEAR = `
    if (g.cam && g.cam.update) g.cam.update = () => {};
    const hudEl = document.getElementById('hud'); if (hudEl) hudEl.style.display = 'none';
    const p = g.player.pos;
    const hit = (x, z, pad) => g.city.queryColliders(x, z, pad).some((c) =>
      x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    const shops = (g.city.shopFronts || []).filter((s) => s.street).sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    let best = null;
    for (const s of shops) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > 300) continue;
      if (hit(s.x - 4.4, s.z + 4.6, 0.9)) continue;
      best = s; break;
    }
    if (!best) return false;
    const c2 = g.camera;
    const ux2 = (p.x - best.x) / (Math.hypot(p.x - best.x, p.z - best.z) || 1);
    const uz2 = (p.z - best.z) / (Math.hypot(p.x - best.x, p.z - best.z) || 1);
    const tx2 = -uz2, tz2 = ux2;
    c2.fov = 68; c2.updateProjectionMatrix();
    c2.position.set(best.x + ux2 * 4.2 + tx2 * 4.4, 1.62, best.z + uz2 * 4.2 + tz2 * 4.4);
    c2.lookAt(best.x + tx2 * -1.6, 1.35, best.z + tz2 * -1.6);
    c2.updateMatrixWorld(true);
    return { x: +best.x.toFixed(1), z: +best.z.toFixed(1) };`;

  // roof-level view across a parapet: tanks, AC plant, vents, bulkheads
  const ROOF_VIEW = `
    if (g.cam && g.cam.update) g.cam.update = () => {};
    const hudEl = document.getElementById('hud'); if (hudEl) hudEl.style.display = 'none';
    const p = g.player.pos;
    let best = null, bd = 1e9;
    for (const c of g.city.queryColliders(p.x, p.z, 260)) {
      if (c.maxY < 8 || c.maxY > 26) continue;
      if (c.maxX - c.minX < 10 || c.maxZ - c.minZ < 10) continue;
      const d = Math.hypot((c.minX + c.maxX) / 2 - p.x, (c.minZ + c.maxZ) / 2 - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    const cx = (best.minX + best.maxX) / 2, cz = (best.minZ + best.maxZ) / 2;
    const c2 = g.camera;
    c2.fov = 52; c2.updateProjectionMatrix();
    c2.position.set(cx + 7.5, best.maxY + 3.6, best.maxZ + 8.5);
    c2.lookAt(cx, best.maxY + 1.1, cz);
    c2.updateMatrixWorld(true);
    return { h: +best.maxY.toFixed(1), x: +cx.toFixed(1), z: +cz.toFixed(1) };`;

  const SHOTS = [
    { name: '40-packaged-street-day.png', setup: AVENUE(-60, 1.75, 150), wait: 3000 },
    { name: '41-packaged-facade-day.png', setup: FACADE_ON, wait: 3000 },
    { name: '42-packaged-road-day.png', setup: AVENUE(-30, 0.95, 120), wait: 3000 },
    { name: '44-packaged-vehicle-day.png', setup: VEHICLE, wait: 3200 },
    { name: '45-packaged-street-traffic.png', setup: TRAFFIC, wait: 3200 },
    { name: '48-packaged-street-level.png', setup: STREET_LEVEL, wait: 3200 },
    { name: '47-packaged-player-idle.png', setup: PLAYER(IDLE_POSE), wait: 2600 },
    { name: '50-packaged-pedestrians.png', setup: PED_GROUP, wait: 3000 },
    { name: '51-packaged-car-close.png', setup: CAR_CLOSE, wait: 3000 },
    { name: '52-packaged-facade-close.png', setup: FACADE_NEAR, wait: 3200, canvas: true },
    { name: '53-packaged-street-near.png', setup: STREET_NEAR, wait: 3200, canvas: true },
    { name: '54-packaged-rooftops.png', setup: ROOF_VIEW, wait: 3200, canvas: true },
    { name: '49-packaged-chase-cam.png', setup: CHASE, wait: 3200 },
    { name: '43-packaged-street-night.png', setup: setHour(21.6) + AVENUE(-60, 1.75, 150), wait: 3400 },
    { name: '46-packaged-vehicle-night.png', setup: setHour(21.6) + VEHICLE, wait: 3400 }
  ];

  const go = async () => {
    try {
      try { win.setContentSize(1280, 720); } catch {}
      await sleep(600);
      await run('window.dispatchEvent(new Event("resize")); return true;').catch(() => {});
      await sleep(600);
      log('waiting for the world');
      if (!(await waitFor('() => !g.loading && !!g.city && !!g.player'))) throw new Error('world never became ready');
      await run(`[...document.querySelectorAll('#title button')].forEach((b) => { if (b.textContent.trim() === 'NEW GAME') b.click(); }); return true;`);
      await sleep(3000);

      if (process.env.PALMA_ONE === 'car' || process.env.PALMA_ONE === 'ped') {
        const isCar = process.env.PALMA_ONE === 'car';
        if (!isCar) await waitFor('() => g.peds && g.peds.list.length > 2', 40000).catch(() => {});
        await run(`
          for (const id of ['hud', 'banner', 'subtitles', 'radio', 'help', 'interact']) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          }
          return true;`);
        const res = await run(isCar ? CAR_CLOSE : PED_GROUP).catch((e) => 'ERR ' + ((e && e.message) || e));
        log('debug ' + process.env.PALMA_ONE, JSON.stringify(res));
        await sleep(2500);
        await run('return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true))));');
        await sleep(400);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, isCar ? 'dbg-car.png' : 'dbg-ped.png'), img.toPNG());
        const atlas = await run('return (window.__palmaAtlas && window.__palmaAtlas.colorCanvas) ? window.__palmaAtlas.colorCanvas.toDataURL("image/png") : null;').catch(() => null);
        if (atlas && atlas.startsWith('data:image/png;base64,')) {
          fs.writeFileSync(path.join(outDir, 'dbg-atlas.png'), Buffer.from(atlas.slice(22), 'base64'));
        }
        app.exit(0);
        return;
      }

      if (process.env.PALMA_ONE === 'near' || process.env.PALMA_ONE === 'streetn' || process.env.PALMA_ONE === 'roof') {
        const which = process.env.PALMA_ONE;
        const setup = which === 'near' ? FACADE_NEAR : which === 'streetn' ? STREET_NEAR : ROOF_VIEW;
        const res = await run(setup).catch((e) => 'ERR ' + ((e && e.message) || e));
        log('debug ' + which, JSON.stringify(res));
        await sleep(2200);
        const cam = await run('const c=g.camera; return {x:+c.position.x.toFixed(2),y:+c.position.y.toFixed(2),z:+c.position.z.toFixed(2),fov:c.fov};').catch((e) => 'ERR ' + e.message);
        log('camera', JSON.stringify(cam));
        const url = await grabCanvas().catch((e) => 'ERR ' + e.message);
        if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) {
          fs.writeFileSync(path.join(outDir, 'dbg-' + which + '.png'), Buffer.from(url.slice(22), 'base64'));
        } else {
          log('grab failed', String(url).slice(0, 140));
        }
        app.exit(0);
        return;
      }

      if (process.env.PALMA_ONE === 'facade') {
        const res = await run(DEBUG_FACADE).catch((e) => 'ERR ' + ((e && e.message) || e));
        log('debug facade', JSON.stringify(res));
        await sleep(2500);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'dbg-facade.png'), img.toPNG());
        app.exit(0);
        return;
      }

      if (MEASURE_ONLY) {
        const perf = await run(MEASURE).catch((e) => ({ error: String(e) }));
        log('perf 1024x640 spawn view:', JSON.stringify(perf));
        app.exit(perf.error ? 3 : 0);
        return;
      }

      await run(`
        for (const id of ['hud', 'banner', 'subtitles', 'radio', 'help', 'interact']) {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }
        g.paused = true;
        return true;`);

      for (const s of SHOTS) {
        const res = await run(s.setup).catch((e) => 'ERR ' + ((e && e.message) || e));
        log('setup', s.name, JSON.stringify(res));
        await sleep(s.wait);
        // wait for the game loop to present the posed camera before capturing,
        // otherwise capturePage can hand back the previous shot's frame
        await run('return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true))));')
          .catch(() => {});
        await sleep(350);
        if (s.canvas) {
          const url = await grabCanvas().catch((e) => 'ERR ' + ((e && e.message) || e));
          if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) {
            fs.writeFileSync(path.join(outDir, s.name), Buffer.from(url.slice(22), 'base64'));
            log('wrote', s.name, 'canvas');
            continue;
          }
          log('canvas grab failed', s.name, String(url).slice(0, 100));
        }
        let img = null;
        for (let attempt = 0; attempt < 4 && !img; attempt++) {
          try {
            img = await win.webContents.capturePage();
          } catch (err) {
            log('capture retry', s.name, String((err && err.message) || err));
            await sleep(1500);
          }
        }
        if (!img) throw new Error(`capture failed for ${s.name}`);
        const size = img.getSize();
        fs.writeFileSync(path.join(outDir, s.name), img.toPNG());
        log('wrote', s.name, `${size.width}x${size.height}`);
      }
      log('done');
      app.exit(0);
    } catch (err) {
      log('FAILED', (err && err.stack) || err);
      app.exit(3);
    }
  };

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', go);
  else go();
};
