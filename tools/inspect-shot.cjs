const fs=require('node:fs'), path=require('node:path');
const { app, BrowserWindow }=require('electron');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:900,height:520,show:true,backgroundColor:'#87b7d8',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=(b)=>win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`,true);
  try{
    await win.loadURL('file://'+path.resolve('dist-browser/index.html'));
    for(let i=0;i<200;i++){ if(await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(()=>false)) break; await sleep(500); }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.paused=true; g.sky.setHour(12.5);
      document.querySelectorAll('#title,#letterbox,#hud,.hud,#menu').forEach(e=>{if(e)e.style.display='none';}); return true;`).catch(()=>null);
    await sleep(5000);
    const shoot=async(cfg,name)=>{
      await run(`${cfg}
        g.renderer.render(g.scene,g.camera);`).catch(()=>null);
      for(let i=0;i<4;i++){
        await sleep(1200);
        const img=await win.webContents.capturePage().catch(()=>null);
        if(img){ const buf=img.toPNG(); if(buf.length>20000){ fs.writeFileSync(path.resolve('screenshots/'+name),buf); return name+' '+buf.length; } }
      }
      return name+' FAIL blank';
    };
    const car = await shoot(`
      const v=g.vehicles.all.find(v=>v.glb&&v.glb.entry&&!(''+v.glb.entry.name).toLowerCase().includes('spectral'))||g.vehicles.all[0];
      const h=v.heading||0, rx=Math.cos(h), rz=-Math.sin(h);
      g.camera.position.set(v.pos.x+rx*7, 1.6, v.pos.z+rz*7);
      g.camera.lookAt(v.pos.x, 0.7, v.pos.z); g.camera.updateMatrixWorld(true);
      `, 'inspect-car.png');
    const ped = await shoot(`
      const p=g.peds.list?g.peds.list[0]:null;
      const t=p?p.pos:{x:g.player.pos.x+3,z:g.player.pos.z};
      const h=p?p.heading:0, rx=Math.cos(h), rz=-Math.sin(h);
      g.camera.position.set(t.x+rx*4, 1.5, t.z+rz*4);
      g.camera.lookAt(t.x, 1.0, t.z); g.camera.updateMatrixWorld(true);
      `, 'inspect-ped.png');
    console.log('INSPECT '+car+' | '+ped);
    app.exit(0);
  }catch(e){ console.log('INSPECT error '+String(e).slice(0,300)); app.exit(1); }
});
