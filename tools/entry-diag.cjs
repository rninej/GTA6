// Diagnostic: find shop entries that share a door neighbourhood.
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 360, show: true,
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
    await sleep(1000);
    const out = await run(`
      const shops=g.city.interiors.filter(i=>i.shop);
      const near=[];
      for(const it of shops){
        const others=g.city.interiors.filter(o=>o!==it&&Math.hypot(o.entry.x-it.entry.x,o.entry.z-it.entry.z)<2.2)
          .map(o=>o.name+'@'+o.entry.x.toFixed(1)+','+o.entry.z.toFixed(1));
        if(others.length) near.push({name:it.name,entry:[+it.entry.x.toFixed(1),+it.entry.z.toFixed(1)],others});
      }
      const dup={}; for(const it of g.city.interiors){const k=it.entry.x.toFixed(1)+','+it.entry.z.toFixed(1);(dup[k]||(dup[k]=[])).push(it);}
      const shared=Object.entries(dup).filter(([,v])=>v.length>1).map(([k,v])=>({k,v:v.map(it=>({name:it.name,kind:it.kind,b:{cx:+it.building.cx.toFixed(1),cz:+it.building.cz.toFixed(1),x0:+it.building.x0.toFixed(1),x1:+it.building.x1.toFixed(1),z0:+it.building.z0.toFixed(1),z1:+it.building.z1.toFixed(1)}}))}));
      return {shops:shops.length,near,shared};
    `, true);
    console.log('ENTRY-DIAG ' + JSON.stringify(out));
  } catch (e) { console.log('ENTRY-DIAG_ERR ' + (e.stack || e)); }
  app.quit();
});
