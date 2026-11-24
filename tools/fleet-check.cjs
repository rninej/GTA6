// Palma City — fleet variety / helicopter / lifecycle probe.
// Spawns every traffic type through the real vehicle factory, verifies which
// downloaded body each gets, brings in the 4-star helicopter, and checks that
// removed cars and evicted interior casts release their scene resources.
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')).slice(6);
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&!g.loading&&window.__PALMA_MODELS__&&window.__PALMA_MODELS__.ready);`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`document.querySelector('#title button[data-action="new"]').click();
      g.cutscene=false;g.started=true;g.paused=false;g.loading=false;g.sky.setHour(12);return true;`);
    await sleep(2500);
    const out = await win.webContents.executeJavaScript(`(()=>{
      const g=window.__PALMA__, M=window.__PALMA_MODELS__;
      const V3=g.scene.position.constructor;
      const frame=(n=1)=>{for(let i=0;i<n;i++){g.tick(0.016);g.input.endFrame();}};
      const before={calls:g.renderer.info.render.calls,tris:g.renderer.info.render.triangles,geos:g.renderer.info.memory.geometries,tex:g.renderer.info.memory.textures};
      const all=g.vehicles.all.map(v=>({type:v.type,driver:v.driver,glb:!!v.glb,id:v.glb&&v.glb.entry?v.glb.entry.id:null,wheels:v.glb?v.glb.wheels.length:null,proc:!!v.parts.procedural}));
      const byType={};
      for(const t of ['sedan','sports','suv','taxi','police','coupe','hatch','muscle','pickup','van','bus']){
        const v=g.vehicles.spawnAt(t,-188+t.length*2,-12,0,{driver:'ai'});
        let meshes=0; if(v.glb&&v.glb.root) v.glb.root.traverse(o=>{if(o.isMesh)meshes++;});
        byType[t]={glb:!!v.glb,id:v.glb&&v.glb.entry?v.glb.entry.id:null,wheels:v.glb?v.glb.wheels.length:null,meshes,proc:!!v.parts.procedural};
      }
      const transitBus=g.transit&&g.transit.bus?{glb:!!g.transit.bus.glb,id:g.transit.bus.glb&&g.transit.bus.glb.entry?g.transit.bus.glb.entry.id:null,wheels:g.transit.bus.glb?g.transit.bus.glb.wheels.length:null}:null;
      // Police is normally spawned by the wanted system; use the real path.
      g.police.clearWanted(); g.wanted=4; g.police.crimeTimer=60;
      const pc=g.vehicles.spawnPolice(g.player.pos,4);
      byType.policeSpawn={glb:!!pc.glb,id:pc.glb&&pc.glb.entry?pc.glb.entry.id:null};
      // Bring in the 4-star helicopter and render one frame with it visible.
      g.police.update(0.016,g); frame(2);
      const heli={visible:g.police.heli.visible,model:!!g.police.heliModel,
        modelChildren:g.police.heliModel?g.police.heliModel.root.children.length:0,
        rotor:!!g.police.heliRotor,tail:!!g.police.heliTail,light:!!g.police.heliLight,
        pos:{x:+g.police.heli.position.x.toFixed(1),y:+g.police.heli.position.y.toFixed(1),z:+g.police.heli.position.z.toFixed(1)}};
      g.renderer.render(g.scene,g.camera);
      const heliDraw={calls:g.renderer.info.render.calls,tris:g.renderer.info.render.triangles};
      // Remove a spawned car and confirm its per-instance GLB is released.
      const victim=g.vehicles.spawnAt('sedan',-300,-12,0,{driver:'ai'});
      const hadGlb=!!victim.glb; const oldGeos=g.renderer.info.memory.geometries;
      victim.remove(); frame(1);
      const removed={hadGlb,glbCleared:!victim.glb,removed:victim.removed,geosBefore:oldGeos,geosAfter:g.renderer.info.memory.geometries};
      // Cache eviction: visit 8 interiors, then report the working-set size.
      const shops=g.city.interiors.filter(i=>i.shop).slice(0,8);
      for(const it of shops){g.enterInterior(it);frame(1);g.exitInterior();frame(1);}
      const cache={visited:shops.length,limit:g.interiorLife.cached.length,built:g.interiorLife.built,
        allHidden:g.city.interiors.every(it=>!it.group.visible)};
      g.police.clearWanted();
      return {models:{cars:M.cars.map(c=>c.id),helicopters:M.helicopters.map(h=>h.id),props:M.props.map(p=>p.id),weapons:M.weapons.map(w=>w.id),pickups:M.pickups.map(p=>p.id),loaded:M.loaded,attempted:M.attempted,errors:M.errors},
        before,all,byType,transitBus,heli,heliDraw,removed,cache};
    })()`, true);
    console.log('FLEET ' + JSON.stringify(out));
  } catch (e) { console.log('FLEET_ERR ' + (e.stack || e)); }
  app.quit();
});
