// Palma City — long-session soak probe.
// Repeated interior enter/exit and traffic spawn/despawn cycles, watching the
// working set instead of trusting a single frame.
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')).slice(6);
    const rounds = Math.max(1, Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=3').slice(9)) || 3);
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&!g.loading&&window.__PALMA_MODELS__&&window.__PALMA_MODELS__.ready);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2500);
    const out = await win.webContents.executeJavaScript(`(async()=>{
      const g=window.__PALMA__, M=window.__PALMA_MODELS__;
      const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
      const frame=(n=1)=>{for(let i=0;i<n;i++){g.tick(0.016);g.input.endFrame();}};
      const render=()=>{g.renderer.render(g.scene,g.camera);};
      const heap=()=>performance.memory?performance.memory.usedJSHeapSize:null;
      const shops=g.city.interiors.filter(i=>i.shop).slice(0,24);
      const start={geos:g.renderer.info.memory.geometries,tex:g.renderer.info.memory.textures,heap:heap(),calls:0};
      let maxGeos=start.geos, maxHeap=start.heap, cycles=0, errors=[];
      try {
        for(let round=0;round<${rounds};round++){
          for(const it of shops){
            g.enterInterior(it); await wait(260); frame(1); render();
            g.exitInterior(); await wait(260); frame(1); render();
            cycles++;
            maxGeos=Math.max(maxGeos,g.renderer.info.memory.geometries);
            const h=heap(); if(h) maxHeap=Math.max(maxHeap,h);
          }
        }
        for(let i=0;i<40;i++){
          const v=g.vehicles.spawnAt(['sedan','sports','suv','taxi','police'][i%5],-188+i*2,-12,0,{driver:'ai'});
          frame(1); render();
          v.remove();
          maxGeos=Math.max(maxGeos,g.renderer.info.memory.geometries);
        }
      } catch(e){ errors.push(String(e&&e.stack||e)); }
      g.police.clearWanted();
      const end={geos:g.renderer.info.memory.geometries,tex:g.renderer.info.memory.textures,heap:heap(),calls:g.renderer.info.render.calls};
      const cached=g.interiorLife.cached;
      return {cycles,start,end,maxGeos,maxHeap,
        cache:{limit:g.interiorLife.cached.length,cachedActors:cached.reduce((n,it)=>n+(it.actors||[]).length,0),
          built:g.interiorLife.built,allHidden:g.city.interiors.every(it=>!it.group.visible),
          stranded:g.city.interiors.reduce((n,it)=>n+(it.actors||[]).filter(a=>a.mesh.parent!==it.group).length,0)},
        models:{loaded:M.loaded,attempted:M.attempted,errors:M.errors.slice(0,5)},
        errors};
    })()`, true);
    console.log('SOAK ' + JSON.stringify(out));
  } catch (e) { console.log('SOAK_ERR ' + (e.stack || e)); }
  app.quit();
});
