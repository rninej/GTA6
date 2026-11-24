const path=require('node:path');
const { app, BrowserWindow }=require('electron');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:900,height:520,show:true,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=(b)=>win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`,true);
  try{
    const url=process.argv.find(a=>a.startsWith('--url='))?process.argv.find(a=>a.startsWith('--url=')).slice(6):'file://'+path.resolve('dist-browser/index.html');
    await win.loadURL(url);
    for(let i=0;i<240;i++){ if(await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(()=>false)) break; await sleep(500); }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.sky.setHour(12.5); return true;`).catch(()=>null);
    await sleep(3500);
    const out=await run(`
      const V3=g.scene.position.constructor;
      const AT=(${JSON.stringify(process.argv.find(a=>a.startsWith('--at='))?process.argv.find(a=>a.startsWith('--at=')).slice(5):'')}).split(',').map(Number);
      g.player.teleport(new V3(AT.length===2?AT[0]:g.player.spawn.x,0.24,AT.length===2?AT[1]:g.player.spawn.z)); g.cam.yaw=Math.atan2(-(AT[0]||0),-(AT[1]||0)); g.cam.snap(); g.cam.update(0.016,g);
      g.renderer.info.autoReset=false;
      const shoot=()=>{ g.camera.updateMatrixWorld(true); g.renderer.info.reset();
        g.renderer.render(g.scene,g.camera); const i=g.renderer.info.render;
        return {calls:i.calls,tris:i.triangles}; };
      const base=shoot();
      const groups=[];
      const add=(label,test)=>{ const list=[]; g.scene.traverse(o=>{ if(o.isMesh&&test(o)) list.push(o); }); groups.push({label,list}); };
      add('lamps', o=>/lantern/i.test((o.material&&o.material.name)||''));
      add('props-instanced', o=>o.isInstancedMesh && !/lantern/i.test((o.material&&o.material.name)||''));
      add('buildings', o=>g.city.buildingMeshes && g.city.buildingMeshes.indexOf(o)>=0);
      add('vehicles', o=>g.vehicles && g.vehicles.all && g.vehicles.all.some(v=>v.group && (v.group===o || v.group.getObjectById(o.id))));
      add('pedestrians', o=>o.isSkinnedMesh);
      add('huge>1M', o=>{ const t=o.geometry?(o.geometry.index?o.geometry.index.count/3:0):0; return t>1000000; });
      const res=[];
      for(const gr of groups){
        const vis=gr.list.map(o=>o.visible);
        gr.list.forEach(o=>o.visible=false);
        const m=shoot();
        gr.list.forEach((o,i)=>o.visible=vis[i]);
        res.push({label:gr.label,n:gr.list.length,calls:base.calls-m.calls,tris:base.tris-m.tris});
      }
      const big=[]; g.scene.traverse(o=>{ if(o.isMesh&&!o.isInstancedMesh){ const t=o.geometry?(o.geometry.index?o.geometry.index.count/3:0):0; if(t>1000000) big.push(o);} });
      const b0=big[0];
      const diag=b0?{groups:b0.geometry.groups.length, mats:Array.isArray(b0.material)?b0.material.length:1,
        inScene:g.scene.children.indexOf(b0)>=0, parentType:b0.parent&&b0.parent.type,
        parentChildren:b0.parent?b0.parent.children.filter(c=>c===b0).length:0,
        tris:Math.round(b0.geometry.index.count/3)}:null;
      const r1=shoot(); const r2=shoot(); const r3=shoot();
      return {base, groups:res, diag, repeats:[r1,r2,r3], autoReset:g.renderer.info.autoReset, shadow:g.renderer.shadowMap.enabled};
    `).catch(e=>({error:String(e).slice(0,300)}));
    console.log('ATTR '+JSON.stringify(out));
    app.exit(0);
  }catch(e){ console.log('ATTR-ERROR '+String(e).slice(0,300)); app.exit(1); }
});
