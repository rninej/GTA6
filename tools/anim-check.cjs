// Palma City — animation-direction probe.
// For every sampled pedestrian, steps its walk clip through several phases and
// checks, in the character's own frame, that the planted foot travels toward
// -Z (a forward walk) and that the clip has no net root displacement.
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
    await sleep(2500);

    const out = await run(`
      const V3 = g.scene.position.constructor;
      const frame = () => { g.tick(0.016); g.input.endFrame(); };
      for (let i = 0; i < 200; i++) frame();

      const peds = g.peds.list.filter((p) => p.rig && p.rig.glb && p.rig.glb.byRole && p.rig.glb.byRole.walk);
      const results = [];
      for (const p of peds.slice(0, 34)) {
        const glb = p.rig.glb;
        const action = glb.byRole.walk;
        const clip = action.getClip();
        const dur = clip.duration || 1;
        const mixer = glb.mixer;
        const saved = mixer.time;
        const prevAction = glb.current && glb.current();
        // Force the walk clip for the measurement: otherwise an idle pedestrian
        // samples a static pose and every foot looks planted.
        mixer.stopAllAction();
        action.reset();
        action.setEffectiveWeight(1);
        action.play();
        // bones we can use as feet
        const toes = [], feet = [];
        glb.root.traverse((o) => {
          if (!o.isBone) return;
          const n = (o.name || '').toLowerCase();
          if (n.indexOf('toe') >= 0) toes.push(o);
          else if (n.indexOf('foot') >= 0 || n.indexOf('ankle') >= 0) feet.push(o);
        });
        // Rigs without foot bones (the stylised meshes) are measured through
        // CPU-skinned vertices: take the lowest vertex cluster each phase.
        // Rigs without foot bones (hashed Gobkit joints, 7-bone leg rigs) are
        // measured from the lowest vertices of every mesh in the rig: skinned
        // meshes through CPU skinning, rigid parts through their world matrix.
        const skinned = [], plain = [];
        glb.root.traverse((o) => {
          if (o.isSkinnedMesh && o.skeleton) skinned.push(o);
          else if (o.isMesh && o.geometry && o.geometry.attributes.position) plain.push(o);
        });
        if (!toes.length && !feet.length && !skinned.length && !plain.length) { results.push({ model: glb.entry.id, bones: 0 }); continue; }
        const tmpV = new V3();
        const sampleVerts = (t) => {
          mixer.setTime(t);
          glb.root.updateMatrixWorld(true);
          const pts = [];
          for (const sm of skinned) {
            if (sm.skeleton && sm.skeleton.update) sm.skeleton.update();
            const pos = sm.geometry.attributes.position;
            const step = Math.max(1, Math.floor(pos.count / 220));
            for (let i = 0; i < pos.count; i += step) {
              sm.applyBoneTransform(i, tmpV);
              sm.localToWorld(tmpV);
              pts.push(p.mesh.worldToLocal(tmpV.clone()));
            }
          }
          for (const m of plain) {
            const pos = m.geometry.attributes.position;
            const step = Math.max(1, Math.floor(pos.count / 220));
            for (let i = 0; i < pos.count; i += step) {
              tmpV.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
              pts.push(p.mesh.worldToLocal(tmpV.clone()));
            }
          }
          pts.sort((a, b) => a.y - b.y);
          const low = pts.slice(0, Math.min(30, pts.length));
          return [{ z: low.reduce((s2, v) => s2 + v.z, 0) / low.length, y: low[0].y }];
        };
        const sample = (t) => {
          if (!toes.length && !feet.length) return sampleVerts(t);
          mixer.setTime(t);
          glb.root.updateMatrixWorld(true);
          const list = (toes.length ? toes : feet).map((b) => {
            const w = b.getWorldPosition(new V3());
            const l = p.mesh.worldToLocal(w.clone());
            return { z: l.z, y: l.y };
          });
          return list;
        };
        const N = 24;
        const rows = [];
        for (let i = 0; i < N; i++) {
          const t = (i / N) * dur;
          const s = sample(t);
          // planted foot = lowest one this phase
          let lo = 0;
          for (let k = 1; k < s.length; k++) if (s[k].y < s[lo].y) lo = k;
          rows.push({ t: +t.toFixed(3), foot: lo, z: +s[lo].z.toFixed(3), y: +s[lo].y.toFixed(3) });
        }
        // stance: all phases where a given foot is the planted (lowest) one; the
        // planted foot must travel toward -Z over that stance.
        let bestDz = 0, bestRun = null;
        const footIds = [...new Set(rows.map((r) => r.foot))];
        for (const f of footIds) {
          const st = rows.filter((r) => r.foot === f);
          if (st.length < 2) continue;
          const dz = st[st.length - 1].z - st[0].z;
          if (dz < bestDz) { bestDz = dz; bestRun = { foot: f, dz: +dz.toFixed(3), t0: st[0].t, t1: st[st.length - 1].t, samples: st.length }; }
        }
        const zs = rows.map((r) => r.z);
        const stride = Math.max(...zs) - Math.min(...zs);
        // root motion: hips/pelvis local Z at start vs end
        let rootBone = null;
        if (!toes.length && !feet.length) rootBone = null;
        glb.root.traverse((o) => { if (o.isBone && !rootBone && /hip|pelvis|root/i.test(o.name || '')) rootBone = o; });
        let rootDrift = null;
        if (rootBone) {
          const a = sample(0); const b = sample(dur * 0.999);
          const wa = rootBone.getWorldPosition(new V3());
          const la = p.mesh.worldToLocal(wa.clone());
          mixer.setTime(dur * 0.999); glb.root.updateMatrixWorld(true);
          const wb = rootBone.getWorldPosition(new V3());
          const lb = p.mesh.worldToLocal(wb.clone());
          rootDrift = +Math.hypot(lb.x - la.x, lb.z - la.z).toFixed(3);
        }
        mixer.setTime(saved);
        mixer.stopAllAction();
        if (prevAction) { prevAction.reset().play(); }
        results.push({
          model: glb.entry.id, clip: clip.name, dur: +dur.toFixed(2),
          modelFront: glb.modelFront === null ? null : +glb.modelFront.toFixed(3),
          flipped: !!glb.flipped,
          clipForward: bestDz < -0.005 ? 1 : (bestDz > 0.005 ? -1 : 0),
          timeScale: action.timeScale, paused: action.paused,
          footDz: bestDz, stride: +stride.toFixed(3), run: bestRun, rootDrift,
          stancePass: Math.abs(bestDz) >= 0.2,
          forwardWalk: bestDz < -0.005,
          phases: rows.slice(0, 4)
        });
      }
      const reversed = results.filter((r) => r.bones === 0 ? false : !r.forwardWalk);
      const stanceFail = results.filter((r) => !r.bones && !r.stancePass);
      const byModel = {};
      for (const r of results) {
        const k = r.model;
        if (!byModel[k]) byModel[k] = { n: 0, forward: 0, minDz: 0, rootDrift: 0 };
        byModel[k].n++;
        if (r.forwardWalk) byModel[k].forward++;
        if (r.footDz < byModel[k].minDz) byModel[k].minDz = r.footDz;
        if (r.rootDrift !== null && r.rootDrift > byModel[k].rootDrift) byModel[k].rootDrift = r.rootDrift;
      }
      return { sampled: results.length, reversed: reversed.length, stanceFail: stanceFail.length, results, byModel };
    `).catch((e) => ({ error: String(e && e.stack ? e.stack : e).slice(0, 400) }));
    console.log('ANIM ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('ANIM-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
