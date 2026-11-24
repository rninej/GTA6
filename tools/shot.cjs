// Deterministic street screenshot: real props + both car bodies, rendered once.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 620, show: true, backgroundColor: '#87b7d8',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (body) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${body} })()`, true);
  try {
    await win.loadURL('file://' + path.resolve('dist-browser/index.html'));
    for (let i = 0; i < 200; i++) {
      if (await run(`return !!(g && g.player && !g.loading && document.querySelector('#title button[data-action="new"]'));`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b) b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.paused=true; g.sky.setHour(12.5);
      document.querySelectorAll('#title,#letterbox,#hud,.hud,#menu').forEach(e=>{ if(e) e.style.display='none'; });
      return true;`).catch((e) => String(e));
    await sleep(6000);
    const info = await run(`
      const city=g.city, V=g.vehicles;
      const spots=city.propSpots;
      const mail=spots.find(s=>s.kind==='mailbox');
      if(!mail) return {error:'no mailbox'};
      let node=null,nd=1e9;
      for(const n of city.graph){ const d=Math.hypot(n.x-mail.x,n.z-mail.z); if(d<nd){nd=d;node=n;} }
      const link=node.links[0], next=city.graph[link.node];
      let dx=next.x-node.x, dz=next.z-node.z; const dl=Math.hypot(dx,dz)||1; dx/=dl; dz/=dl;
      const rx=dz, rz=-dx;
      // make sure both bodies exist as real traffic cars
      for(let i=0;i<14;i++){
        const isS=v=>!!(v.glb&&v.glb.entry&&(''+(v.glb.entry.name||v.glb.entry.file||'')).toLowerCase().includes('spectral'));
        const hasS=V.all.some(isS);
        const hasF=V.all.some(v=>v.glb&&!isS(v));
        if(hasS&&hasF) break;
        V.spawnAt('sedan', node.x+rx*2.6, node.z+rz*2.6, Math.atan2(dx,dz), {driver:null});
      }
      const spectral=V.all.find(isS);
      const ferrari=V.all.find(v=>v.glb&&!isS(v));
      const place=(v,ox,oz,h)=>{ if(!v) return; v.pos.set(ox,0.02,oz); v.mesh.position.copy(v.pos); v.heading=h; v.mesh.rotation.set(0,h,0); };
      place(ferrari, node.x+rx*2.4+dx*4, node.z+rz*2.4+dz*4, Math.atan2(dx,dz)+Math.PI);
      place(spectral, node.x-rx*2.4+dx*16, node.z-rz*2.4+dz*16, Math.atan2(dx,dz));
      const cam=g.camera;
      cam.position.set(mail.x+rx*3.4-dx*3.2, 1.7, mail.z+rz*3.4-dz*3.2);
      cam.lookAt(node.x+dx*6, 0.85, node.z+dz*6);
      cam.updateMatrixWorld(true);
      g.renderer.render(g.scene, cam);
      const r=g.renderer.info.render;
      return {mail:{x:mail.x,z:mail.z}, node:{x:node.x,z:node.z}, tris:r.triangles, calls:r.calls,
        spectral:!!spectral, ferrari:!!ferrari, props:spots.length};
    `).catch((e) => ({ error: String(e).slice(0, 300) }));
    console.log('SHOTINFO ' + JSON.stringify(info));
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await run(`g.renderer.render(g.scene,g.camera);
        return g.renderer.domElement.toDataURL('image/png');`).catch(() => null);
      if (typeof res === 'string' && res.length > 40000) {
        const buf = Buffer.from(res.split(',')[1], 'base64');
        fs.writeFileSync(path.resolve('screenshots/street-final.png'), buf);
        console.log('SHOT ok bytes=' + buf.length + ' attempt=' + attempt);
        app.exit(0); return;
      }
      console.log('SHOT blank len=' + (res ? String(res).length : 0));
      await sleep(3000);
    }
    console.log('SHOT failed'); app.exit(1);
  } catch (e) { console.log('SHOT error ' + String(e).slice(0, 300)); app.exit(1); }
});
