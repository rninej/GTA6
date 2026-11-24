// Palma City — close-up checks of the shared animation library.
// Captures the player aiming, firing, dragging a driver out and a pedestrian
// dying, straight from the shipped bundle.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900, height: 700, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  try {
    await win.loadURL('file://' + path.resolve('dist-browser/index.html'));
    for (let i = 0; i < 240; i++) {
      const ok = await run(`return !!(g && g.player && !g.loading && document.querySelector('#title button[data-action="new"]'));`).catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    await run(`const b = document.querySelector('#title button[data-action="new"]'); if (b) b.click(); return true;`).catch(() => false);
    await run(`g.cutscene = false; g.started = true; g.paused = false; g.loading = false;
      const lb = document.getElementById('letterbox'); if (lb) lb.style.display = 'none';
      const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
      g.sky.setHour(12.5); return true;`);
    await sleep(1500);
    for (let i = 0; i < 60; i++) {
      const ok = await run(`return !!(g.player.rig && g.player.rig.glb);`).catch(() => false);
      if (ok) break;
      await sleep(500);
    }

    const renderShot = async (file, setup) => {
      const dataUrl = await run(`
        try {
          const g0 = window.__PALMA__;
          const cam = g0.cam.camera;
          ${setup}
          g0.cam.update = () => {};
          cam.position.set(cx, cy, cz);
          cam.lookAt(tx, ty, tz);
          const rr = g0.renderer;
          rr.setPixelRatio(1);
          rr.setSize(900, 700, false);
          cam.aspect = 900 / 700;
          cam.updateProjectionMatrix();
          rr.render(g0.scene, cam);
          rr.render(g0.scene, cam);
          const du = rr.domElement.toDataURL('image/png');
          return { du, len: du.length, w: rr.domElement.width, h: rr.domElement.height };
        } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 400) }; }`).catch((e) => ({ err: String(e).slice(0, 240) }));
      if (!dataUrl || typeof dataUrl.du !== 'string') { console.log('FAIL ' + file + ' ' + JSON.stringify(dataUrl)); return false; }
      console.log('LEN ' + file + ' ' + dataUrl.len + ' ' + dataUrl.w + 'x' + dataUrl.h);
      fs.writeFileSync(path.resolve(file), Buffer.from(dataUrl.du.split(',')[1], 'base64'));
      console.log('SHOT ' + file);
      return true;
    };

    const info = await run(`
      const p = g.player;
      // A new game can leave the player at the origin, which is inside a block.
      // Stand on the open road by the first pickup so the camera has room.
      p.pos.set(-186, 0.02, -6);
      p.heading = Math.PI * 0.5;
      p.mesh.rotation.y = p.heading;
      p.mesh.updateMatrixWorld(true);
      const r = p.rig;
      const out = { human: r.glb && r.glb.entry && r.glb.entry.id, hasUAL: !!(r.glb && r.glb.hasUAL),
        roles: r.glb ? Object.keys(r.glb.byRole) : [], gun: !!r.gun,
        gunParent: r.gun && r.gun.parent ? (r.gun.parent.name || r.gun.parent.type) : null,
        pos: [p.pos.x, p.pos.y, p.pos.z].map((v) => +v.toFixed(2)), heading: +p.heading.toFixed(2),
        visible: p.mesh.visible, inVehicle: !!p.inVehicle, interior: !!p.interior,
        camType: g.cam.camera && g.cam.camera.type, camPos: g.cam.camera ? [+g.cam.camera.position.x.toFixed(1), +g.cam.camera.position.y.toFixed(1), +g.cam.camera.position.z.toFixed(1)] : null,
        mode: g.cam.mode };
      return out;`).catch((e) => ({ err: String(e).slice(0, 200) }));
    console.log('INFO ' + JSON.stringify(info));

    const poseInfo = await run(`
      try {
        const p = g.player; const r = p.rig;
        const a = r.glb.byRole.aim;
        r._glbPlay('idle', 0.01);
        r.aiming = true;
        p.aiming = true;
        r.glb.mixer.update(0.6);
        r._aimArms();
        const hand = r.glb.root.getObjectByName('RightHand');
        const head = r.glb.root.getObjectByName('Head');
        const V = g.scene.position.constructor;
        const hw = hand ? hand.getWorldPosition(new V) : null;
        const hd = head ? head.getWorldPosition(new V) : null;
        const arm = r.glb.root.getObjectByName('RightArm');
        const la = r.glb.root.getObjectByName('LeftArm');
        let gunInfo = null;
        if (r.gun) {
          r.gun.geometry.computeBoundingBox();
          const V2 = g.scene.position.constructor;
          const bb = r.gun.geometry.boundingBox;
          const size = bb.getSize(new V2());
          const wq = r.gun.getWorldQuaternion(new r.gun.quaternion.constructor());
          const zd = new V2(0, 0, 1).applyQuaternion(wq);
          const ws2 = r.gun.getWorldScale(new V2());
          gunInfo = { size: [size.x, size.y, size.z].map((v) => +v.toFixed(3)),
            world: [zd.x, zd.y, zd.z].map((v) => +v.toFixed(2)), scale: +ws2.x.toFixed(4),
            pos: [r.gun.position.x, r.gun.position.y, r.gun.position.z].map((v) => +v.toFixed(2)) };
        }
        return { gunInfo, clip: a && a.getClip().name, dur: a && +a.getClip().duration.toFixed(2),
          tracks: a ? a.getClip().tracks.length : 0,
          armQ: arm ? [arm.quaternion.x, arm.quaternion.y, arm.quaternion.z, arm.quaternion.w].map((v) => +v.toFixed(3)) : null,
          larmQ: la ? [la.quaternion.x, la.quaternion.y, la.quaternion.z, la.quaternion.w].map((v) => +v.toFixed(3)) : null,
          running: a && a.isRunning(), weight: a && +a.getEffectiveWeight().toFixed(2),
          hand: hw ? [+hw.x.toFixed(2), +hw.y.toFixed(2), +hw.z.toFixed(2)] : null,
          head: hd ? [+hd.x.toFixed(2), +hd.y.toFixed(2), +hd.z.toFixed(2)] : null,
          playerY: +p.pos.y.toFixed(2), rootY: +r.glb.root.position.y.toFixed(2) };
      } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 300) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
    console.log('POSE ' + JSON.stringify(poseInfo));

    const frontCam = `
      const h = p.heading;
      const fx = Math.sin(h), fz = Math.cos(h);
      const cx = p.pos.x + fx * 3.0 + fz * 1.3, cy = p.pos.y + 1.5, cz = p.pos.z + fz * 3.0 - fx * 1.3;
      const tx = p.pos.x, ty = p.pos.y + 1.1, tz = p.pos.z;`;

    await renderShot('screenshots/pose-aim.png', `
      const p = g0.player; const r = p.rig;
      p.aiming = true;
      r._glbPlay('idle', 0.01);
      r.glb.mixer.update(0.5);
      r._aimArms();
      ${frontCam}`);

    await renderShot('screenshots/pose-shoot.png', `
      const p = g0.player; const r = p.rig;
      p.aiming = true;
      r._glbPlay('idle', 0.01);
      r.glb.mixer.update(0.3);
      r.recoil = 1;
      r._aimArms();
      ${frontCam}`);

    await renderShot('screenshots/pose-gun.png', `
      const p = g0.player; const r = p.rig;
      p.aiming = true;
      r._glbPlay('idle', 0.01);
      r.glb.mixer.update(0.5);
      r._aimArms();
      const hand = r.glb.root.getObjectByName('RightHand');
      const V = g0.scene.position.constructor;
      const hw = hand.getWorldPosition(new V());
      const h = p.heading, fx = Math.sin(h), fz = Math.cos(h);
      const cx = hw.x + fx * 0.75 + fz * 0.45, cy = hw.y + 0.1, cz = hw.z + fz * 0.75 - fx * 0.45;
      const tx = hw.x, ty = hw.y, tz = hw.z;`);

    await renderShot('screenshots/pose-gun-side.png', `
      const p = g0.player; const r = p.rig;
      p.aiming = true;
      r._glbPlay('idle', 0.01);
      r.glb.mixer.update(0.5);
      r._aimArms();
      const hand = r.glb.root.getObjectByName('RightHand');
      const V = g0.scene.position.constructor;
      const hw = hand.getWorldPosition(new V());
      const h = p.heading;
      const rx = Math.cos(h), rz = -Math.sin(h);
      const cx = hw.x + rx * 1.0, cy = hw.y + 0.05, cz = hw.z + rz * 1.0;
      const tx = hw.x, ty = hw.y, tz = hw.z;`);

    await renderShot('screenshots/pose-pull.png', `
      const p = g0.player; const r = p.rig;
      r._glbPlay('interact', 0.01, true);
      r.glb.mixer.update(0.5);
      ${frontCam}`);

    const deadInfo = await run(`
      try {
        const p = g.player;
        const h = p.heading;
        const fx = Math.sin(h), fz = Math.cos(h);
        const ped = g.peds.list.find((x) => x.rig && x.rig.glb && x.rig.glb.hasUAL && !x.dead);
        if (!ped) return { err: 'no glb ped' };
        ped.pos.set(p.pos.x + fx * 2.4, 0.22, p.pos.z + fz * 2.4);
        ped.heading = h + Math.PI;
        ped.mesh.rotation.y = ped.heading;
        ped.rig.dead = true; ped.rig.deadT = 0;
        for (let i = 0; i < 10; i++) ped.rig.update(0.1, { speed: 0 });
        window.__deadPed = ped;
        return { human: ped.rig.glb.entry.id, hasUAL: !!ped.rig.glb.hasUAL };
      } catch (e) { return { err: String(e && e.stack ? e.stack : e).slice(0, 400) }; }`).catch((e) => ({ err: String(e).slice(0, 200) }));
    console.log('DEAD ' + JSON.stringify(deadInfo));

    await renderShot('screenshots/pose-dead.png', `
      const p = g0.player;
      const ped = window.__deadPed;
      const h = p.heading;
      const fx = Math.sin(h), fz = Math.cos(h);
      const cx = p.pos.x + fx * 4.4 + Math.cos(h) * 1.6;
      const cy = p.pos.y + 1.7;
      const cz = p.pos.z + fz * 4.4 - Math.sin(h) * 1.6;
      const tx = ped.pos.x, ty = ped.pos.y + 0.5, tz = ped.pos.z;`);

    console.log('POSE-DONE');
    app.exit(0);
  } catch (e) {
    console.log('POSE-ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 400));
    app.exit(1);
  }
});
