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
    for (let i = 0; i < 240; i++) { if (await run(`return !!(g&&g.player&&!g.loading);`).catch(() => false)) break; await sleep(500); }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12.5);return true;`);
    await sleep(3000);
    const out = await win.webContents.executeJavaScript(`(()=>{
      const g=window.__PALMA__;
      const V3=g.scene.position.constructor;
      g.player.teleport(new V3(-470,0.24,-470)); g.cam.yaw=Math.atan2(470,470); g.cam.snap(); g.cam.update(0.016,g); g.tick(0.016);
      g.renderer.render(g.scene,g.camera);
      const list=[];
      g.scene.traverse(o=>{
        if(!o.isMesh||!o.geometry) return;
        let on=o.visible; for(let p=o.parent;p&&on;p=p.parent) on=p.visible;
        if(!on) return;
        const geo=o.geometry; const tris=(geo.index?geo.index.count:geo.attributes.position.count)/3;
        list.push({n:o.name||'(none)', mat:(o.material&&(o.material.name||o.material.type))||'?', tris:Math.round(tris), inst:!!o.isInstancedMesh, count:o.isInstancedMesh?o.count:1});
      });
      list.sort((a,b)=>b.tris*(b.inst?b.count:1)-a.tris*(a.inst?a.count:1));
      return {calls:g.renderer.info.render.calls, tris:g.renderer.info.render.triangles, top:list.slice(0,15)};
    })()`, true);
    console.log('CENSUS ' + JSON.stringify(out));
  } catch (e) { console.log('CENSUS_ERR ' + (e.stack || e)); }
  app.quit();
});
