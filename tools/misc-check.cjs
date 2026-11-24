// Palma City — compact day/night + radio regression probe (real H key).
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 500, show: true,
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
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;return true;`);
    await sleep(2200);
    const out = await win.webContents.executeJavaScript(`(()=>{
      const g = window.__PALMA__;
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      g.cutscene = false; g.paused = false; g.player.exitVehicle(true);
      g.sky.setHour(6.5); frame(2);
      const dawn = { hour: +g.sky.hour.toFixed(1), clock: g.sky.clock };
      g.sky.setHour(22); frame(2);
      const night = { hour: +g.sky.hour.toFixed(1), clock: g.sky.clock, sunY: +g.sky.sunDir.y.toFixed(2) };
      const r0 = g.audio.radioStation;
      keyDown('KeyH'); frame(2); keyUp('KeyH');
      const r1 = g.audio.radioStation;
      return { dawn, night, radioBefore: r0, radioAfter: r1, radioAdvanced: r1 !== r0 };
    })()`, true);
    console.log('MISC ' + JSON.stringify(out));
  } catch (e) { console.log('MISC_ERR ' + (e.stack || e)); }
  app.quit();
});
