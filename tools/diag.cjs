const path=require('node:path');
const { app, BrowserWindow }=require('electron');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:640,height:360,show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=(b)=>win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`,true);
  try{
    await win.loadURL('file://'+path.resolve('dist-browser/index.html'));
    for(let i=0;i<200;i++){ if(await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(()=>false)) break; await sleep(500); }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.sky.setHour(12.5); return true;`).catch(()=>null);
    await sleep(4000);
    const out = await run(`
      const r={}; const T=(k,fn)=>{ try{ r[k]=fn(); }catch(e){ r[k]='ERR '+e.message; } };
      const V3=g.scene.position.constructor;
      T('car',()=>{
        const v=g.vehicles.all.find(x=>x.glb&&x.glb.entry&&!(''+x.glb.entry.name).toLowerCase().includes('spectral'))||g.vehicles.all[0];
        if(!v||!v.glb) return 'no car';
        const root=v.glb.root, tmp=new V3(); let minZ=1e9,maxZ=-1e9;
        root.updateMatrixWorld(true);
        root.traverse(o=>{ if(!o.isMesh||!o.geometry) return; const p=o.geometry.attributes.position; for(let i=0;i<p.count;i+=7){ tmp.fromBufferAttribute(p,i); o.localToWorld(tmp); if(tmp.z<minZ)minZ=tmp.z; if(tmp.z>maxZ)maxZ=tmp.z; } });
        let hLow=0,nLow=0,hHigh=0,nHigh=0;
        root.traverse(o=>{ if(!o.isMesh||!o.geometry) return; const p=o.geometry.attributes.position; for(let i=0;i<p.count;i+=5){ tmp.fromBufferAttribute(p,i); o.localToWorld(tmp); if(tmp.z>maxZ-0.6){hHigh+=tmp.y;nHigh++;} else if(tmp.z<minZ+0.6){hLow+=tmp.y;nLow++;} } });
        return {minZ:+minZ.toFixed(2),maxZ:+maxZ.toFixed(2),hLow:+(hLow/Math.max(1,nLow)).toFixed(2),hHigh:+(hHigh/Math.max(1,nHigh)).toFixed(2)};
      });
      T('enter',()=>{
        const pl=g.player; const parked=g.vehicles.all.filter(x=>!x.driver&&!x.removed);
        const res={parked:parked.length};
        if(parked.length){ const t=parked[0]; pl.teleport(t.pos.clone().add(new V3(2.0,0,0)));
          const near=g.vehicles.nearest(pl.pos,5.6); res.near=!!near; res.nearDriver=near?near.driver:null;
          if(near){ pl.enterVehicle(near); res.entered=pl.inVehicle; if(pl.inVehicle) pl.exitVehicle(true); } }
        const ai=g.vehicles.all.find(x=>x.driver==='ai');
        if(ai){ pl.teleport(ai.pos.clone().add(new V3(2.0,0,0)));
          const n2=g.vehicles.nearest(pl.pos,5.6); res.aiNear=!!n2; res.aiDriver=n2?n2.driver:null;
          if(n2){ pl.enterVehicle(n2); res.enteredAI=pl.inVehicle; if(pl.inVehicle) pl.exitVehicle(true); } }
        return res;
      });
      T('shoot',()=>{
        const pl=g.player; const w=pl.weapon;
        const before=pl.weapons[w].mag; g.combat.playerFire(); const after=pl.weapons[w].mag;
        const c=document.querySelector('canvas');
        c.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));
        const mouseSeen=g.input.mouse.left;
        window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
        return {weapon:w,before,after,cooldown:+(pl.fireCooldown||0).toFixed(2),mouseSeen,
          all:Object.fromEntries(Object.entries(pl.weapons).map(([k,x])=>[k,x.mag+'/'+x.reserve]))};
      });
      T('wheels',()=>{
        const v=g.vehicles.all.find(x=>x.glb&&x.glb.wheels&&x.glb.wheels.length);
        if(!v) return 'none';
        const front=v.glb.wheels.filter(w=>w.front);
        const p=new V3(); const zs=front.map(w=>{ w.pivot.getWorldPosition(p); v.glb.root.worldToLocal(p); return +p.z.toFixed(2); });
        return {entry:v.glb.entry&&v.glb.entry.name, frontZ:zs, rootYaw:+v.glb.root.rotation.y.toFixed(2)};
      });
      T('peds',()=>{
        if(g.peds.list && g.peds.list.length===0 && typeof g.peds.spawnOne==='function'){ for(let i=0;i<8;i++){ try{ g.peds.spawnOne(); }catch(e){} } }
        const all=[]; if(g.peds.list) for(const p of g.peds.list) all.push(p);
        const ids={};
        for(const p of all){ const e=p.glb&&p.glb.entry; if(e) ids[e.id]=(ids[e.id]||0)+1; }
        const p=all.find(x=>x.glb&&x.glb.root)||(g.player.glb?g.player:null);
        let facing=null;
        if(p){ const root=p.glb.root; root.updateMatrixWorld(true);
          const toes=[],feet=[]; root.traverse(o=>{ if(!o.isBone) return; const n=(o.name||'').toLowerCase();
            if(n.indexOf('toe')>=0) toes.push(o); else if(n.indexOf('foot')>=0||n.indexOf('ankle')>=0) feet.push(o); });
          const q=new V3(); const avg=l=>{ let z=0; for(const b of l){ b.getWorldPosition(q); root.worldToLocal(q); z+=q.z; } return z/l.length; };
          if(toes.length&&feet.length) facing={toe:+(avg(toes)-avg(feet)).toFixed(3), holder:root.name};
        }
        return {kinds:ids, distinct:Object.keys(ids).length, facing, playing:!!(p&&p.glb&&p.glb.current&&p.glb.current())};
      });
      T('interiors',()=>({count:(g.city.interiors||[]).length,names:(g.city.interiors||[]).slice(0,6).map(i=>i.name),fn:typeof g.enterInterior}));
      T('perf',()=>{ g.renderer.render(g.scene,g.camera); const ri=g.renderer.info.render;
        return {calls:ri.calls,tris:ri.triangles,lamps:g.city.lampCount||0,props:g.city.propModelCount||0,cars:g.vehicles.all.length}; });
      return r;
    `).catch(e=>({error:String(e).slice(0,300)}));
    console.log('DIAG '+JSON.stringify(out));
    app.exit(0);
  }catch(e){ console.log('DIAG error '+String(e).slice(0,300)); app.exit(1); }
});
