const path=require('node:path');
const { app, BrowserWindow }=require('electron');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:900,height:520,show:true,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const run=(b)=>win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`,true);
  try{
    const url = process.argv.find(a=>a.startsWith('--url=')) ? process.argv.find(a=>a.startsWith('--url=')).slice(6) : 'file://'+path.resolve('dist-browser/index.html');
    await win.loadURL(url);
    for(let i=0;i<240;i++){ if(await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(()=>false)) break; await sleep(500); }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.sky.setHour(12.5); return true;`).catch(()=>null);
    await sleep(3000);

    // is the game loop actually running?
    const t0=await run(`return g.now||0;`).catch(()=>0);
    await sleep(700);
    const t1=await run(`return g.now||0;`).catch(()=>0);
    const loopAlive = t1 > t0;

    const out = await run(`
      const r={loop:${loopAlive}};
      const V3=g.scene.position.constructor;
      r.interiors=(g.city.interiors||[]).length;
      r.footprints=(g.city.footprints||[]).length;
      r.doorRings=g.city.doorRings?g.city.doorRings.count:0;
      r.kinds={}; for(const it of g.city.interiors) r.kinds[it.kind]=(r.kinds[it.kind]||0)+1;
      r.density={peds:g.peds.list?g.peds.list.length:0, cars:g.vehicles.all.length,
        props:g.city.propModelCount||0, lamps:g.city.lampCount||0};
      r.facade=g.city.facadeCounts||null;
      const seen={}; const samples=[];
      for(const it of g.city.interiors){ if(seen[it.kind]) continue; seen[it.kind]=1; samples.push(it); }
      r.samples=samples.map(it=>({name:it.name,kind:it.kind,
        meshes:(()=>{let n=0; it.group.traverse(o=>{ if(o.isMesh) n++; }); return n;})(),
        tris:(()=>{let n=0; it.group.traverse(o=>{ if(o.isMesh&&o.geometry&&o.geometry.index) n+=o.geometry.index.count/3; else if(o.isMesh&&o.geometry&&o.geometry.attributes.position) n+=o.geometry.attributes.position.count/3; }); return Math.round(n);})()
      }));
      return r;
    `).catch(e=>({error:String(e).slice(0,300)}));
    console.log('INT-DISCOVER '+JSON.stringify(out));

    // real door interaction, one building of each kind
    const names = (out.samples||[]).map(s=>s.name);
    const results=[];
    for(const name of names){
      const step = await run(`
        const it=g.city.interiors.find(x=>x.name===${JSON.stringify(name)});
        if(!it) return {name:${JSON.stringify(name)},error:'missing'};
        const V3=g.scene.position.constructor;
        g.player.exitVehicle(true);
        g.player.teleport(new V3(it.entry.x, 0.24, it.entry.z));
        g.input.pressedKeys.add('KeyF');
        g.player.update(0.016, g);
        return {name:it.name, entry:{x:+it.entry.x.toFixed(1),z:+it.entry.z.toFixed(1)}};
      `).catch(e=>({name,error:String(e).slice(0,120)}));
      await sleep(1100);
      const inside = await run(`
        const it=g.city.interiors.find(x=>x.name===${JSON.stringify(name)});
        const inIt=g.interior===it;
        let meshes=0; if(it) it.group.traverse(o=>{ if(o.isMesh) meshes++; });
        const p=g.player.pos;
        const nearDoor = it? Math.hypot(p.x-it.x, p.z-(it.z+it.d/2-1.4)) : 99;
        return {inside:inIt, visible:!!(it&&it.group.visible), meshes,
          pos:{x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1)}, nearDoor:+nearDoor.toFixed(2)};
      `).catch(e=>({error:String(e).slice(0,120)}));
      // exit through the real exit path: stand on the door marker, press F and
      // drive the same frame update the game loop uses (rAF does not run here).
      const exitRes = await run(`
        const it=g.city.interiors.find(x=>x.name===${JSON.stringify(name)});
        if(!it) return {ok:false,why:'missing'};
        if(g.interior!==it) return {ok:false,why:'not-inside'};
        g.player.pos.set(it.x, (it.y||0)+0.05, it.z+it.d/2-1.4);
        g.input.pressedKeys.add('KeyF');
        for(let i=0;i<4;i++) g.tick(0.016);
        return {ok:g.interior===null, still:!!g.interior};
      `).catch(e=>({ok:false,why:String(e).slice(0,120)}));
      await sleep(400);
      const exited = await run(`return g.interior===null;`).catch(()=>null);
      inside.viaKey = !!(exitRes && exitRes.ok) && exited === true;
      inside.exit = exitRes;
      results.push({...step, ...inside, exited});
    }
    console.log('INT-DOORS '+JSON.stringify(results));

    // per-view budget: move, let the loop render a frame, then read the counters
    const views = [
      ['spawn', `g.player.teleport(new V3(g.player.spawn.x, 0.24, g.player.spawn.z)); g.cam.snap();`],
      ['downtown', `const n=g.city.graph.find(q=>Math.abs(q.x)<260 && Math.abs(q.z)<260)||g.city.graph[0];
        g.player.teleport(new V3(n.x,0.24,n.z)); g.cam.snap();`],
      ['door', `const it=g.city.interiors[Math.floor(g.city.interiors.length/2)];
        g.player.teleport(new V3(it.entry.x,0.24,it.entry.z)); g.cam.snap();`],
      ['inside', `const it2=g.city.interiors[Math.floor(g.city.interiors.length/2)];
        g.enterInterior(it2);`]
    ];
    const perf = {};
    for (const [label, code] of views) {
      await run(`const V3=g.scene.position.constructor; ${code}
        g.cam.snap(); g.cam.update(0.016, g); return true;`).catch(()=>null);
      await sleep(900);
      const r = await run(`g.cam.update(0.016, g); g.camera.updateMatrixWorld(true);
        g.renderer.info.autoReset=false; g.renderer.info.reset(); g.renderer.render(g.scene,g.camera); const i=g.renderer.info.render;
        const c=g.camera.position;
        return {calls:i.calls, tris:i.triangles, cam:{x:+c.x.toFixed(0),y:+c.y.toFixed(0),z:+c.z.toFixed(0)}};`).catch(e=>({error:String(e).slice(0,120)}));
      perf[label] = r;
      if (label === 'inside') { await run(`if(g.exitInterior) g.exitInterior(); return true;`).catch(()=>null); await sleep(500); }
    }
    console.log('INT-PERF '+JSON.stringify(perf));
    app.exit(0);
  }catch(e){ console.log('INT-ERROR '+String(e).slice(0,300)); app.exit(1); }
});
