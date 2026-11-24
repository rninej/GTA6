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
      g.player.teleport(new V3(g.player.spawn.x,0.24,g.player.spawn.z)); g.cam.snap(); g.cam.update(0.016,g);
      g.camera.updateMatrixWorld(true);
      g.renderer.info.autoReset=false; g.renderer.info.reset();
      g.renderer.render(g.scene,g.camera);
      const info=g.renderer.info.render;
      const rows=[];
      g.scene.traverse(o=>{
        if(!o.isMesh||!o.visible) return;
        const geo=o.geometry; if(!geo) return;
        let t=geo.index?geo.index.count/3:(geo.attributes.position?geo.attributes.position.count/3:0);
        if(o.isInstancedMesh) t*=o.count; if(t<1) t=geo.attributes.position?geo.attributes.position.count/3:0;
        const mat=o.material&&o.material.name||'';
        rows.push({name:o.name||'', inst:o.isInstancedMesh?o.count:1, tris:Math.round(t),
          parent:(o.parent&&o.parent.name)||'', mat});
      });
      rows.sort((a,b)=>b.tris-a.tris);
      const total=rows.reduce((s,r)=>s+r.tris,0);
      const cat={};
      for(const r of rows){
        const n=(r.name+' '+r.parent+' '+r.mat).toLowerCase();
        let k='other';
        if(n.includes('lantern')||n.includes('lamp')) k='lamps';
        else if(r.inst>1) k='instanced-props';
        else if(n.includes('car')||n.includes('wheel')||n.includes('body')) k='cars';
        else if(n.includes('human')||n.includes('soldier')||n.includes('xbot')) k='people';
        else if(n.includes('facade')||n.includes('building')||n.includes('window')||n.includes('glass')||n.includes('trim')) k='facades';
        cat[k]=(cat[k]||0)+r.tris;
      }
      return {render:{calls:info.calls,tris:info.triangles}, sceneTotal:total, cat,
        top:rows.slice(0,18).map(r=>({n:r.name.slice(0,26),inst:r.inst,tris:r.tris,mat:r.mat.slice(0,18),p:r.parent.slice(0,20)})),
        ident:(()=>{
          const out=[]; const list=[];
          g.scene.traverse(o=>{ if(o.isMesh&&o.visible&&!o.isInstancedMesh){ const t=o.geometry?(o.geometry.index?o.geometry.index.count/3:0):0; if(t>200000) list.push(o); } });
          for(const o of list.slice(0,6)){
            o.geometry.computeBoundingBox(); const b=o.geometry.boundingBox;
            out.push({tris:Math.round(o.geometry.index.count/3),
              size:[+(b.max.x-b.min.x).toFixed(0),+(b.max.y-b.min.y).toFixed(0),+(b.max.z-b.min.z).toFixed(0)],
              color:o.material&&o.material.color?o.material.color.getHexString():'',
              mat:o.material&&o.material.type,
              isProp:g.city.propMesh===o, isSidewalk:g.city.sidewalkMesh===o,
              isSign:g.city.signMeshes&&g.city.signMeshes.indexOf(o)>=0,
              isBuild:g.city.buildingMeshes&&g.city.buildingMeshes.indexOf(o)>=0});
          }
          return out;
        })()};
    `).catch(e=>({error:String(e).slice(0,300)}));
    console.log('PROF '+JSON.stringify(out));
    app.exit(0);
  }catch(e){ console.log('PROF-ERROR '+String(e).slice(0,300)); app.exit(1); }
});
