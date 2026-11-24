// Render every shop once, in order, with the interior cache evicting.
// Catches per-interior texture growth that a small repeated soak would miss.
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
      const frame=()=>{g.tick(0.016);g.input.endFrame();g.renderer.render(g.scene,g.camera);};
      const snap=()=>({tex:g.renderer.info.memory.textures,geo:g.renderer.info.memory.geometries,cache:g.interiorLife.cached.length,actors:g.interiorLife.cached.reduce((n,it)=>n+(it.actors||[]).length,0)});
      const shops=g.city.interiors.filter(i=>i.shop);
      const samples=[]; let maxTex=0, maxGeo=0;
      for(let i=0;i<shops.length;i++){
        g.enterInterior(shops[i]); await wait(170); frame();
        g.exitInterior(); await wait(170); frame();
        const s=snap(); maxTex=Math.max(maxTex,s.tex); maxGeo=Math.max(maxGeo,s.geo);
        if(i%20===19) samples.push({i:i+1,...s});
      }
      return {shops:shops.length,start:83,end:snap(),maxTex,maxGeo,samples,allHidden:g.city.interiors.every(it=>!it.group.visible),stranded:g.city.interiors.reduce((n,it)=>n+(it.actors||[]).filter(a=>a.mesh.parent!==it.group).length,0),errors:[]};
    })()`, true);
    console.log('TEX-ALL-SHOPS ' + JSON.stringify(out));
  } catch (e) { console.log('TEX-ALL-SHOPS_ERR ' + (e.stack || e)); }
  app.quit();
});
