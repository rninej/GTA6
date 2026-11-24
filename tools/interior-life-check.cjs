// Palma City — inhabited interiors probe.
// Enters shops/venues through the real F door, checks the clerk behind the
// counter, robs the register (clerk reaction), hits the empty register, and
// confirms a closed shop keeps a closed-shift clerk but refuses the register.
const path = require('node:path');
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

      const shops = g.city.interiors.filter((i) => i.shop);
      const open = shops.find((s) => !s.shop.closed);
      const closed = shops.find((s) => s.shop.closed);
      const enter = async (it) => {
        g.player.teleport(new V3(it.entry.x, 0.24, it.entry.z));
        g.cam.snap(); frame(2); press('KeyF', 2);
        await wait(1200); frame(2);
      };

      await enter(open);
      const clerk = open.shop.clerk;
      const clerkInfo = {
        inside: g.interior === open,
        clerk: !!clerk,
        actors: (open.actors || []).length,
        seated: (open.actors || []).filter((a) => a.seated).length,
        maxActors: g.interiorLife.maxActors,
        localZ: clerk ? +clerk.mesh.position.z.toFixed(1) : null,
        state: clerk ? clerk.state : null,
        shift: clerk ? clerk.shift : null,
        greeting: subtitle()
      };

      g.player.pos.set(open.x, -140 + 0.02, open.z - 4.2); frame(2);
      const openPrompt = prompt();
      const money0 = g.player.money;
      press('KeyX', 2);
      const rob = {
        gained: g.player.money - money0, wanted: g.wanted,
        clerkState: clerk && clerk.state, line: clerk && clerk.line,
        subtitle: subtitle()
      };

      press('KeyX', 2);
      const empty = {
        gained: g.player.money - (money0 + rob.gained),
        clerkState: clerk && clerk.state, line: clerk && clerk.line,
        subtitle: subtitle(), prompt: prompt()
      };

      g.exitInterior(); await wait(1200); frame(2);
      const hiddenAfterExit = !open.group.visible;

      await enter(closed);
      const closedInfo = {
        inside: g.interior === closed, clerk: !!(closed.shop && closed.shop.clerk),
        actors: (closed.actors || []).length,
        state: closed.shop.clerk ? closed.shop.clerk.state : null,
        shift: closed.shop.clerk ? closed.shop.clerk.shift : null
      };
      g.player.pos.set(closed.x, -140 + 0.02, closed.z - 4.2); frame(2);
      const closedPrompt = prompt();
      const money1 = g.player.money;
      press('KeyX', 2);
      const closedRob = { gained: g.player.money - money1, refusals: g.living.robberyRefusals, prompt: closedPrompt };
      const closedLine = closed.shop.clerk ? closed.shop.clerk.line : null;
      g.exitInterior(); await wait(1200); frame(2);

      const club = g.city.interiors.find((i) => i.kind === 'club');
      await enter(club);
      const clubInfo = {
        inside: g.interior === club,
        bartender: !!club.clubStaff,
        actors: (club.actors || []).length
      };
      g.exitInterior(); await wait(1200); frame(2);

      return { clerkInfo, openPrompt, rob, empty, hiddenAfterExit, closedInfo, closedRob, closedLine, clubInfo };
    })()`, true);
    console.log('INTERIOR-LIFE ' + JSON.stringify(out));
  } catch (e) { console.log('INTERIOR-LIFE_ERR ' + (e.stack || e)); }
  app.quit();
});
