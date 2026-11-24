// Palma City — model facing + diversity probe.
// Drives the real frame path (g.tick + input.endFrame), then for every moving
// pedestrian and visible traffic car logs the model asset, yaw, velocity
// direction and the dot product between the model's visual forward and travel.
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
      g.cutscene=false; g.started=true; g.loading=false; g.paused=false;
      g.sky.setHour(12.5); return true;`).catch(() => null);
    await sleep(3000);

    const out = await run(`
      const frame = () => { g.tick(0.016); g.input.endFrame(); };
      // 5 seconds of real frames so walkers walk and cars drive a real distance
      for (let i = 0; i < 300; i++) frame();

      const V3 = g.scene.position.constructor;
      const dirOf = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
      const meshForward = (obj) => {
        obj.updateMatrixWorld(true);
        const v = new V3(0, 0, 1).applyQuaternion(obj.getWorldQuaternion(new g.scene.quaternion.constructor()));
        return dirOf(v.x, v.z);
      };
      const dot = (a, b) => +(a.x * b.x + a.z * b.z).toFixed(3);

      // ---- pedestrians: sample positions, advance one frame, use the delta ----
      const pedList = g.peds.list.filter((p) => p.rig && p.rig.glb && p.mesh.visible);
      const before = pedList.map((p) => ({ p, x: p.pos.x, z: p.pos.z }));
      frame();
      const peds = [];
      for (const b of before) {
        const p = b.p;
        const dx = p.pos.x - b.x, dz = p.pos.z - b.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.004) continue;                 // standing still
        const vel = dirOf(dx, dz);
        // Anatomical forward from the bind pose: toe bone rest positions minus
        // foot bone rest positions in mesh space. Using the rest pose instead
        // of the live animated pose makes the test independent of which foot
        // happens to be swinging when the sample is taken.
        const toes = [], feet = [];
        p.rig.glb.root.updateMatrixWorld(true);
        p.rig.glb.root.traverse((o) => {
          if (!o.isBone) return;
          const n = (o.name || '').toLowerCase();
          if (n.indexOf('toe') >= 0) toes.push(o);
          else if (n.indexOf('foot') >= 0 || n.indexOf('ankle') >= 0) feet.push(o);
        });
        const skel = (() => { let sk = null; p.rig.glb.root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton && !sk) sk = o.skeleton; }); return sk; })();
        let anat = null, dotAnat = null, anatRest = null;
        let anatErr = null;
        if (skel && toes.length && feet.length) try {
          const M4 = g.scene.matrix.constructor;
          const rest = (bone) => {
            const i = skel.bones.indexOf(bone);
            if (i < 0) return null;
            const m = new M4().copy(skel.boneInverses[i]).invert();
            return new V3().setFromMatrixPosition(m);
          };
          const avgRest = (list) => {
            const v = new V3(); let n = 0;
            for (const b of list) { const r = rest(b); if (r) { v.add(r); n++; } }
            return n ? v.multiplyScalar(1 / n) : null;
          };
          const tr = avgRest(toes), fr = avgRest(feet);
          let d = null;
          if (tr && fr) {
            d = tr.sub(fr);
            if (d.length() > 1.5) {
              // Bind matrices carry a non-unit scale (the soldier rig): the
              // rest vector is 9-11 m, so fall back to the live pose for that
              // rig instead of trusting unusable bind data.
              d = null;
            } else {
              d.applyQuaternion(p.mesh.getWorldQuaternion(new (g.scene.quaternion.constructor)()));
            }
          }
          if (!d) {
            const avgWorld = (list) => {
              const v = new V3();
              for (const o of list) v.add(o.getWorldPosition(new V3()));
              return v.multiplyScalar(1 / list.length);
            };
            d = avgWorld(toes).sub(avgWorld(feet));
            anatRest = { x: +d.x.toFixed(3), z: +d.z.toFixed(3), live: true };
          } else {
            anatRest = { x: +d.x.toFixed(3), z: +d.z.toFixed(3) };
          }
          anat = dirOf(d.x, d.z);
          dotAnat = dot(anat, vel);
        } catch (e) { anatErr = String(e && e.message ? e.message : e).slice(0, 120); }
        const mf = meshForward(p.mesh);
        peds.push({
          model: (p.rig.glb.entry && p.rig.glb.entry.id) || '?',
          yaw: +p.mesh.rotation.y.toFixed(3),
          vel: { x: +vel.x.toFixed(3), z: +vel.z.toFixed(3) },
          meshForward: { x: +mf.x.toFixed(3), z: +mf.z.toFixed(3) },
          dotMesh: dot(mf, vel),
          bones: { toes: toes.length, feet: feet.length },
          anatRest, anatErr,
          dotAnat,
          step: +dist.toFixed(3)
        });
      }

      // ---- traffic cars: velocity vs mesh forward ----
      const cars = [];
      for (const v of g.vehicles.all) {
        if (!v.mesh.visible || v.removed) continue;
        const speed = Math.hypot(v.velocity.x, v.velocity.z);
        if (speed < 0.5) continue;
        const vel = dirOf(v.velocity.x, v.velocity.z);
        const mf = meshForward(v.mesh);
        cars.push({
          model: v.proceduralBody ? ('procedural-' + v.type) : ((v.glb && v.glb.entry && v.glb.entry.id) || 'procedural'),
          type: v.type,
          yaw: +v.mesh.rotation.y.toFixed(3),
          speed: +v.speed.toFixed(2),
          vel: { x: +vel.x.toFixed(3), z: +vel.z.toFixed(3) },
          meshForward: { x: +mf.x.toFixed(3), z: +mf.z.toFixed(3) },
          dot: dot(mf, vel)
        });
      }

      // ---- car nose convention: front wheels vs mesh +Z on a car that kept them ----
      let noseCheck = null;
      const wheeled = g.vehicles.all.find((v) => v.glb && !v.proceduralBody && v.glb.wheels && v.glb.wheels.length >= 2);
      if (wheeled) {
        const w = wheeled.glb.wheels;
        const fw = w.filter((x) => x.front), rw = w.filter((x) => !x.front);
        if (fw.length && rw.length) {
          const avg = (list) => { const v = new V3(); for (const x of list) v.add(x.pivot.getWorldPosition(new V3())); return v.multiplyScalar(1 / list.length); };
          const a = avg(fw), b2 = avg(rw);
          const nose = dirOf(a.x - b2.x, a.z - b2.z);
          noseCheck = { car: wheeled.glb.entry.id, dotMeshVsNose: dot(meshForward(wheeled.mesh), nose), wheels: w.length };
        }
      }

      // ---- diversity actually rendered (visible + in list) ----
      // Diversity is measured across sampled scenes, not one lucky frame: stand
      // at up to 12 parking spots and union what is actually rendered there.
      const spotSets = [];
      const carIdSet = new Set(g.vehicles.all.filter((v) => v.mesh.visible)
        .map((v) => v.proceduralBody ? ('procedural-' + v.type) : (v.glb && v.glb.entry && v.glb.entry.id)));
      const humanIdSet = new Set(g.peds.list.filter((p) => p.rig && p.rig.glb && p.mesh.visible).map((p) => p.rig.glb.entry.id));
      const spots = (g.city.parking || []).slice(0, 12);
      for (const sp of spots) {
        g.player.exitVehicle(true);
        g.player.teleport(new V3(sp.x, 0.24, sp.z));
        g.cam.snap(); g.cam.update(0.016, g);
        frame(); frame();
        const cs = [...new Set(g.vehicles.all.filter((v) => v.mesh.visible)
          .map((v) => v.proceduralBody ? ('procedural-' + v.type) : (v.glb && v.glb.entry && v.glb.entry.id)))];
        const hs = [...new Set(g.peds.list.filter((p) => p.rig && p.rig.glb && p.mesh.visible).map((p) => p.rig.glb.entry.id))];
        cs.forEach((x) => carIdSet.add(x)); hs.forEach((x) => humanIdSet.add(x));
        spotSets.push({ x: +sp.x.toFixed(0), z: +sp.z.toFixed(0), cars: cs, humans: hs.length });
      }
      const carIds = [...carIdSet];
      const humanIds = [...humanIdSet];
      const carTypes = [...new Set(g.vehicles.all.map((v) => v.type))];
      let proceduralNose = null;
      const proc = g.vehicles.all.find((v) => v.proceduralBody && v.parts && v.parts.wheels && v.parts.wheels.length >= 2);
      if (proc) {
        const fw = proc.parts.wheels.filter((w) => w.front), rw = proc.parts.wheels.filter((w) => !w.front);
        if (fw.length && rw.length) {
          const avg2 = (list) => { const v = new V3(); for (const x of list) v.add((x.pivot || x.steer).getWorldPosition(new V3())); return v.multiplyScalar(1 / list.length); };
          const a2 = avg2(fw), b3 = avg2(rw);
          proceduralNose = { type: proc.type, dotMeshVsNose: dot(meshForward(proc.mesh), dirOf(a2.x - b3.x, a2.z - b3.z)) };
        }
      }
      const humanPool = (window.__PALMA_MODELS__ && window.__PALMA_MODELS__.humans || []).map((e) => e.id);
      const carFleet = {};
      for (const v of g.vehicles.all) {
        const k = v.proceduralBody ? ('procedural-' + v.type) : ((v.glb && v.glb.entry && v.glb.entry.id) || 'procedural');
        carFleet[k] = (carFleet[k] || 0) + 1;
      }
      const humanFleet = {};
      for (const p of g.peds.list) {
        if (!p.rig || !p.rig.glb) continue;
        const k = p.rig.glb.entry.id;
        humanFleet[k] = (humanFleet[k] || 0) + 1;
      }

      const min = (arr, k) => arr.length ? Math.min(...arr.map((r) => r[k])) : null;
      return {
        peds, cars, noseCheck, proceduralNose,
        minPedDotMesh: min(peds, 'dotMesh'), minPedDotAnat: min(peds.filter((p) => p.dotAnat !== null), 'dotAnat'),
        minCarDot: min(cars, 'dot'),
        diversity: { humansRendered: humanIds, humanPool, humanFleet, carModelsRendered: carIds, carFleet, carTypes, spotSets },
        counts: { pedsSampled: peds.length, carsSampled: cars.length },
        errors: (window.__PALMA_MODELS__ && window.__PALMA_MODELS__.errors || []).slice(0, 3),
        fallbacks: { car: window.__PALMA_MODELS__.carFallbacks, human: window.__PALMA_MODELS__.humanFallbacks }
      };
    `).catch((e) => ({ error: String(e && e.stack ? e.stack : e).slice(0, 400) }));
    console.log('FACING ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('FACING-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
