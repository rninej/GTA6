const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 480, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')).slice(6);
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&!g.loading&&window.__PALMA_MODELS__&&window.__PALMA_MODELS__.ready);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2000);
    const out = await win.webContents.executeJavaScript(`(async()=>{
      const g=window.__PALMA__; const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
      const frame=(n=1)=>{for(let i=0;i<n;i++){g.tick(0.016);g.input.endFrame();}};
      const snap=()=>({tex:g.renderer.info.memory.textures,geo:g.renderer.info.memory.geometries,cache:g.interiorLife.cached.length,actors:g.interiorLife.cached.reduce((n,it)=>n+(it.actors||[]).length,0)});
      const shops=g.city.interiors.filter(i=>i.shop).slice(0,24);
      const first=[snap()];
      for(const it of shops){g.enterInterior(it);await wait(280);frame(1);g.exitInterior();await wait(280);frame(1);first.push(snap());}
      const second=[snap()];
      for(const it of shops){g.enterInterior(it);await wait(280);frame(1);g.exitInterior();await wait(280);frame(1);second.push(snap());}
      return {first,second};
    })()`, true);
    console.log('TEXDIAG2 ' + JSON.stringify(out));
  } catch (e) { console.log('TEXDIAG2_ERR ' + (e.stack || e)); }
  app.quit();
});
