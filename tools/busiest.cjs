// Palma City — busiest-view sweep: sample many street positions plus a rooftop
// vantage and report the worst triangle / draw-call frame found.
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    let url = process.argv.find((a) => a.startsWith('--url=')) ? process.argv.find((a) => a.startsWith('--url=')).slice(6) : 'file://' + path.resolve('dist-browser/index.html');
    const seedArg = process.argv.find((a) => a.startsWith('--seed='));
    if (seedArg) {
      const u = new URL(url);
      u.searchParams.set('seed', seedArg.slice(7));
      url = u.href;
    }
    const heliMode = process.argv.includes('--heli');
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) { if (await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(() => false)) break; await sleep(500); }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.sky.setHour(12.5); return true;`).catch(() => null);
    if (process.argv.includes('--storm')) {
      await run(`g.weather.setState('storm', true); g.weather.intensity = 1; g.weather.wet = 1; g.weather.apply(); return true;`);
    }
    if (heliMode) {
      await run(`g.wanted=4; g.police.crimeTimer=60; g.police.update(0.016,g); g.cam.pitch=0.5; return true;`);
    }
    if (process.argv.includes('--hide-pier')) {
      await run(`if(g.city.pierDeck)g.city.pierDeck.visible=false; return true;`);
    }
    const hideArg = process.argv.find((a) => a.startsWith('--hide='));
    if (hideArg) {
      await run(`for(const k of ${JSON.stringify(hideArg.slice(7).split(','))}){ if(g.city[k]) g.city[k].visible=false; } return true;`);
    }
    await sleep(3500);
    const out = await run(`
      const V3=g.scene.position.constructor;
      const heliMode=${heliMode};
      g.renderer.info.autoReset=false;
      const shoot=()=>{ g.camera.updateMatrixWorld(true); g.renderer.info.reset();
        g.renderer.render(g.scene,g.camera); const i=g.renderer.info.render;
        return {calls:i.calls,tris:i.triangles,storm:g.weather.state}; };
      const nodes=g.city.graph.slice();
      const picks=[];
      const stride=Math.max(1,Math.floor(nodes.length/26));
      for(let i=0;i<nodes.length;i+=stride) picks.push(nodes[i]);
      const rows=[];
      for(const n of picks){
        g.player.teleport(new V3(n.x,0.24,n.z));
        g.cam.snap(); g.cam.update(0.016,g);
        // look down the widest street: face the city centre
        g.cam.yaw=Math.atan2(-n.x,-n.z);
        if (heliMode) g.cam.pitch=0.5;
        g.cam.snap(); g.cam.update(0.016,g);
        g.tick(0.016);            // real frame: runs the distance LOD
        if (heliMode) {
          g.wanted=4; g.police.crimeTimer=60;
          g.police.update(0.016,g);
          if (g.police.heli) {
            g.police.heli.position.set(n.x+16,28,n.z+16);
            g.police.heli.visible=true;
          }
        }
        const carsVisible=g.vehicles.all.filter(v=>v.mesh.visible).length;
        const m=shoot();
        const hidden=[]; g.vehicles.all.forEach(v=>{ if(v.mesh.visible){ hidden.push(v); v.mesh.visible=false; } });
        const noCars=shoot();
        hidden.forEach(v=>v.mesh.visible=true);
        m.carsVisible=carsVisible; m.cars=hidden.length; m.callsNoCars=noCars.calls; m.trisNoCars=noCars.tris;
        if (heliMode) { m.heli=!!(g.police.heli&&g.police.heli.visible); m.wanted=g.wanted; }
        rows.push({x:Math.round(n.x),z:Math.round(n.z),...m});
      }
      // rooftop vantage across the whole grid
      g.player.teleport(new V3(0,90,0)); g.cam.snap(); g.cam.yaw=0; g.cam.snap(); g.cam.update(0.016,g); g.tick(0.016);
      rows.push({x:0,z:0,y:90,...shoot()});
      rows.sort((a,b)=>b.tris-a.tris);
      const maxCalls=rows.slice().sort((a,b)=>b.calls-a.calls)[0];
      const maxTris=rows[0];
      // who is actually drawing: visible mesh census at the worst view
      const w=rows[0];
      g.player.teleport(new V3(w.x,0.24,w.z)); g.cam.yaw=Math.atan2(-w.x,-w.z); g.cam.snap(); g.cam.update(0.016,g); g.tick(0.016);
      const byMat={}; let vis=0; const details=[]; const heavy=[];
      g.scene.traverse(o=>{
        if(!o.isMesh) return; let on=o.visible;
        for(let p=o.parent;p&&on;p=p.parent) on=p.visible;
        if(!on) return; vis++;
        const k=(o.isInstancedMesh?'I:':'')+((o.material&&o.material.name)||o.name||'?');
        byMat[k]=(byMat[k]||0)+1;
        const tri=o.geometry&&o.geometry.index?Math.round(o.geometry.index.count/3):0;
        if(k==='Material_0'||tri>15000) details.push({k,name:o.name,parent:o.parent&&(o.parent.name||o.parent.type),tri,pos:o.getWorldPosition(new V3()).toArray().map(n=>+n.toFixed(1))});
        heavy.push({k,name:o.name,parent:o.parent&&(o.parent.name||o.parent.type),tri,pos:o.getWorldPosition(new V3()).toArray().map(n=>+n.toFixed(1))});
      });
      heavy.sort((a,b)=>b.tri-a.tri);
      const census=Object.entries(byMat).sort((a,b)=>b[1]-a[1]).slice(0,12);
      const samples=[]; const byParent={};
      g.scene.traverse(o=>{
        if(!o.isMesh) return; let on=o.visible;
        for(let p=o.parent;p&&on;p=p.parent) on=p.visible;
        if(!on) return;
        if((o.material&&o.material.name)) return;
        const pn=(o.parent&&(o.parent.name||o.parent.type))||'?';
        byParent[pn]=(byParent[pn]||0)+1;
        if(samples.length<6){ const g2=o.geometry; samples.push({pn, tris: g2?(g2.index?Math.round(g2.index.count/3):0):0, inst:o.isInstancedMesh?o.count:0}); }
      });
      const carDetail=g.vehicles.all.filter(v=>v.mesh.visible).map(v=>{let tri=0,meshes=0;v.mesh.traverse(o=>{if(o.isMesh&&o.geometry){meshes++;tri+=o.geometry.index?Math.round(o.geometry.index.count/3):0;}});return {type:v.type,id:v.glb&&v.glb.entry?v.glb.entry.id:null,driver:v.driver,tri,meshes};});
      const pedDetail=g.peds.list.filter(p=>p.mesh.visible).map(p=>{let tri=0,meshes=0;p.mesh.traverse(o=>{if(o.isMesh&&o.geometry){meshes++;tri+=o.geometry.index?Math.round(o.geometry.index.count/3):0;}});return {glb:!!(p.rig&&p.rig.glb),id:p.rig&&p.rig.glb&&p.rig.glb.entry?p.rig.glb.entry.id:null,d:+Math.hypot(p.pos.x-g.camera.position.x,p.pos.z-g.camera.position.z).toFixed(1),tri,meshes};});
      g.player.teleport(new V3(-282,0.24,94)); g.cam.yaw=Math.atan2(282,-94); g.cam.snap(); g.cam.update(0.016,g); g.tick(0.016);
      const fixed=shoot(); const fixedHeavy=[];
      g.scene.traverse(o=>{
        if(!o.isMesh) return; let on=o.visible;
        for(let p=o.parent;p&&on;p=p.parent) on=p.visible;
        if(!on) return;
        const tri=o.geometry&&o.geometry.index?Math.round(o.geometry.index.count/3):0;
        fixedHeavy.push({k:(o.material&&o.material.name)||o.name||'?',name:o.name,parent:o.parent&&(o.parent.name||o.parent.type),tri});
      });
      fixedHeavy.sort((a,b)=>b.tri-a.tri);
      return {sampleCount:rows.length, maxCalls, maxTris, carDetail, pedDetail, worst:rows.slice(0,5), best:rows[rows.length-1], vis, census, byParent, samples, details, heavy:heavy.slice(0,12), fixed:{...fixed,heavy:fixedHeavy.slice(0,10)}};
    `).catch((e) => ({ error: String(e).slice(0, 300) }));
    console.log('BUSIEST ' + JSON.stringify(out));
    app.exit(0);
  } catch (e) { console.log('BUSIEST-ERROR ' + String(e).slice(0, 300)); app.exit(1); }
});
