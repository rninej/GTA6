// Palma City — interior NPC routines probe.
// Uses the real F door / F exit input to visit every shop interior, checks the
// clerk at its fixed counter spot, verifies the capped cast and containment,
// exercises an open-shop greeting/robbery/empty-register reaction and a
// closed-shift clerk, then repeats enter/exit cycles to prove no cast growth.
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
      if (await run(`return !!(g&&g.player&&!g.loading);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2500);
    const out = await win.webContents.executeJavaScript(`(async()=>{
      const g = window.__PALMA__;
      const V3 = g.scene.position.constructor;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const press = (code, n = 2) => { keyDown(code); frame(n); keyUp(code); };
      const prompt = () => document.getElementById('interact').querySelector('span').textContent;
      const subtitle = () => document.getElementById('subtitles').textContent;

      g.cutscene = false; g.paused = false;
      g.police.clearWanted(); g.wanted = 0;
      g.player.money = 500;

      const enter = async (it) => {
        g.player.teleport(new V3(it.entry.x, 0.24, it.entry.z));
        g.cam.snap(); frame(2); press('KeyF', 2);
        await wait(330); frame(2);
        return g.interior === it;
      };
      const leave = async (it) => {
        g.player.pos.set(it.x, (it.y || 0) + 0.02, it.z + it.d / 2 - 1.4);
        frame(2); press('KeyF', 2);
        await wait(330); frame(2);
        if (g.interior) { g.exitInterior(); await wait(330); frame(2); }
        return !g.interior;
      };

      const shops = g.city.interiors.filter((i) => i.shop);
      const stats = {
        totalShops: shops.length, entered: 0, clerk: 0, clerkAtCounter: 0,
        capped: 0, contained: 0, parented: 0, hiddenAfterExit: 0, stableCounts: 0,
        closedShops: 0, closedWithClerk: 0, openShops: 0, openWithAmbient: 0,
        actorMax: 0, actorTotal: 0, seatedMax: 0, failures: []
      };
      for (const it of shops) {
        const ok = await enter(it);
        if (ok) stats.entered++; else stats.failures.push('enter:' + it.name);
        const clerk = it.shop && it.shop.clerk;
        const actors = it.actors || [];
        const n = actors.length;
        const seated = actors.filter((a) => a.seated).length;
        const clerkSpot = clerk && Math.abs(clerk.mesh.position.x) < 0.01 &&
          Math.abs(clerk.mesh.position.z + 6.0) < 0.01;
        const within = actors.every((a) => Math.abs(a.mesh.position.x) <= it.w / 2 &&
          Math.abs(a.mesh.position.z) <= it.d / 2);
        const parented = actors.every((a) => a.mesh.parent === it.group);
        if (clerk) stats.clerk++;
        if (clerkSpot) stats.clerkAtCounter++;
        if (n <= g.interiorLife.maxActors) stats.capped++;
        if (within) stats.contained++;
        if (parented) stats.parented++;
        if (it.shop.closed) { stats.closedShops++; if (clerk) stats.closedWithClerk++; }
        else { stats.openShops++; if (n > 1) stats.openWithAmbient++; }
        stats.actorMax = Math.max(stats.actorMax, n);
        stats.actorTotal += n;
        stats.seatedMax = Math.max(stats.seatedMax, seated);
        if (!clerkSpot || !within || !parented || n < 1 || n > g.interiorLife.maxActors) {
          stats.failures.push('cast:' + it.name);
        }
        await leave(it);
        if (!it.group.visible) stats.hiddenAfterExit++;
        // The working set is capped: a shop may still hold its cast, or its
        // cache entry may have been evicted (actors null). Neither is growth.
        if ((it.actors || []).length === n || it.actors === null) stats.stableCounts++;
        else stats.failures.push('grow:' + it.name);
      }

      // Open-shop reaction: approach the counter, greet, rob, empty, re-enter.
      const open = shops.find((s) => !s.shop.closed);
      const closed = shops.find((s) => s.shop.closed);
      await enter(open);
      g.player.pos.set(open.x, open.y + 0.02, open.z - 4.2);
      frame(14);
      const clerk = open.shop.clerk;
      const dx = g.player.pos.x - (open.x + clerk.mesh.position.x);
      const dz = g.player.pos.z - (open.z + clerk.mesh.position.z);
      const wantFace = Math.atan2(dx, dz);
      const faceErr = Math.abs(Math.atan2(Math.sin(clerk.mesh.rotation.y - wantFace), Math.cos(clerk.mesh.rotation.y - wantFace)));
      const openReaction = {
        prompt: prompt(), line: clerk.line, subtitle: subtitle(), state: clerk.state,
        shift: clerk.shift, greeted: clerk.greeted, faceErr: +faceErr.toFixed(2),
        actors: (open.actors || []).length, seated: (open.actors || []).filter((a) => a.seated).length
      };
      const money0 = g.player.money;
      press('KeyX', 2);
      const rob = {
        gained: g.player.money - money0, wanted: g.wanted,
        state: clerk.state, line: clerk.line, subtitle: subtitle()
      };
      const money1 = g.player.money;
      press('KeyX', 2);
      const empty = {
        gained: g.player.money - money1, state: clerk.state, line: clerk.line,
        subtitle: subtitle(), prompt: prompt()
      };
      g.police.clearWanted(); g.wanted = 0;
      await leave(open);
      const hiddenAfterExit = !open.group.visible;
      await enter(open);
      const countAfterReentry = (open.actors || []).length;
      g.player.pos.set(open.x, open.y + 0.02, open.z - 4.2); frame(14);
      const reentry = { count: countAfterReentry, state: clerk.state, line: clerk.line, subtitle: subtitle() };
      await leave(open);

      // Closed shop: clerk is present but closed-shift and the register refuses.
      await enter(closed);
      g.player.pos.set(closed.x, closed.y + 0.02, closed.z - 4.2); frame(14);
      const closedClerk = closed.shop.clerk;
      const closedReaction = {
        prompt: prompt(), line: closedClerk && closedClerk.line, state: closedClerk && closedClerk.state,
        shift: closedClerk && closedClerk.shift, actors: (closed.actors || []).length,
        seated: (closed.actors || []).filter((a) => a.seated).length
      };
      const money2 = g.player.money;
      press('KeyX', 2);
      const closedRob = {
        gained: g.player.money - money2, refusals: g.living.robberyRefusals, prompt: prompt()
      };
      await leave(closed);

      // Repeated cycles: same cast, no stranded root meshes, group hidden.
      const cycleCounts = [];
      for (let i = 0; i < 4; i++) {
        await enter(open);
        cycleCounts.push((open.actors || []).length);
        await leave(open);
      }
      const strandedRoot = (open.actors || []).filter((a) => g.scene.children.includes(a.mesh)).length;
      const strandedParent = (open.actors || []).filter((a) => a.mesh.parent !== open.group).length;

      const sample = {};
      for (const kind of ['club', 'garage', 'apartment']) {
        const it = g.city.interiors.find((x) => x.kind === kind);
        await enter(it);
        sample[kind] = {
          inside: g.interior === it, actors: (it.actors || []).length,
          roles: (it.actors || []).map((a) => a.role),
          seated: (it.actors || []).filter((a) => a.seated).length,
          staff: kind === 'club' ? !!it.clubStaff : kind === 'garage' ? !!it.mechanic : null
        };
        await leave(it);
      }

      const allHidden = g.city.interiors.every((it) => !it.group.visible);
      const allParented = g.city.interiors.every((it) => (it.actors || []).every((a) => a.mesh.parent === it.group));
      const rootActors = g.city.interiors.reduce((n, it) => n + (it.actors || []).filter((a) => g.scene.children.includes(a.mesh)).length, 0);
      return {
        stats, openReaction, rob, empty, hiddenAfterExit, reentry,
        closedReaction, closedRob, cycleCounts, strandedRoot, strandedParent,
        sample, allHidden, allParented, rootActors,
        built: g.interiorLife.built, cap: g.interiorLife.maxActors,
        cacheLimit: g.interiorLife.cached.length
      };
    })()`, true);
    console.log('INTERIOR-ROUTINES ' + JSON.stringify(out));
  } catch (e) { console.log('INTERIOR-ROUTINES_ERR ' + (e.stack || e)); }
  app.quit();
});
