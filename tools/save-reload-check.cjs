// Palma City — probe that sleeps at the safehouse, reloads the page, continues
// from the title screen and checks the saved state came back.
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
    const boot = async () => {
      await win.loadURL(url);
      for (let i = 0; i < 240; i++) {
        if (await run(`return !!(g&&g.player&&!g.loading);`).catch(() => false)) break;
        await sleep(500);
      }
    };
    await boot();
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2200);

    const saved = await win.webContents.executeJavaScript(`(async()=>{
      const g=window.__PALMA__;
      const V3=g.scene.position.constructor;
      const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
      const frame=(n=1)=>{for(let i=0;i<n;i++){g.tick(0.016);g.input.endFrame();}};
      g.police.clearWanted(); g.wanted=0;
      g.player.money=777; g.player.health=55; g.player.armor=10;
      const sh=g.living.safehouse;
      g.player.teleport(new V3(sh.entry.x,0.24,sh.entry.z)); g.cam.snap(); frame(2);
      g.input.pressedKeys.add('KeyF'); frame(2);
      await wait(1500);
      g.player.pos.set(sh.x-2.4, -140+0.02, sh.z-2.6); frame(2);
      g.input.pressedKeys.add('KeyB'); frame(3);
      await wait(200);
      const s=JSON.parse(localStorage.getItem('palma_city_save_v1')||'null');
      return { inside:g.interior===sh, save:s && { money:s.money, x:+s.x.toFixed(1), z:+s.z.toFixed(1), hour:+s.hour.toFixed(1), health:s.health },
        entry:{ x:+sh.entry.x.toFixed(1), z:+sh.entry.z.toFixed(1) }, sleeps:g.living.sleeps };
    })()`, true);

    // Real page reload, then continue from the title with the real Enter key.
    await boot();
    const beforeContinue = await run(`return { started:g.started, loading:g.loading,
      titleVisible:!document.getElementById('title').classList.contains('hidden'),
      hasSave:!!localStorage.getItem('palma_city_save_v1') };`);
    await run(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',bubbles:true})); return true;`);
    await sleep(1800);
    const restored = await run(`const sh=g.living.safehouse; const p=g.player.pos;
      return { started:g.started, money:g.player.money, health:g.player.health, armor:g.player.armor,
        hour:+g.sky.hour.toFixed(1), interior:!!g.interior, wanted:g.wanted,
        distToEntry:+Math.hypot(p.x-sh.entry.x,p.z-sh.entry.z).toFixed(1),
        titleHidden:document.getElementById('title').classList.contains('hidden') };`);
    console.log('SAVE-RELOAD ' + JSON.stringify({ saved, beforeContinue, restored }));
  } catch (e) { console.log('SAVE-RELOAD_ERR ' + (e.stack || e)); }
  app.quit();
});
