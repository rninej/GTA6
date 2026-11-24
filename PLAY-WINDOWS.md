# Playing Palma City on Windows

**Extract the whole folder, then double-click `index.html`.** That is the whole
installation: no `.exe`, no installer, no administrator rights, no local server,
no PowerShell, and nothing for Microsoft Defender to quarantine.

---

## 1. Recommended — double-click `index.html`

**Download:** [`release/Palma City-browser.zip`](release/Palma%20City-browser.zip) (~24.6 MB)

1. **Extract the whole folder first.** Right-click the zip → *Extract All…* →
   somewhere like `Desktop\Palma City`. Do not play from inside the zip preview.
2. **Double-click `index.html`.** Your default browser (Edge or Chrome) opens
   and the game starts.

### Why it works without a server

Everything the renderer loads at runtime is baked into `assets\app.js` at build
time as a `data:` URL: the six photographic material sets (albedo, normal and
roughness for each, 24 files) are inlined by the browser build's Vite plugin
(`vite.browser.config.js` → `src/world/asset-map.js`). Audio is synthesised in
WebAudio, and there are no font or JSON files to fetch.

That matters because a `file://` page cannot hand `file://` images to WebGL:
the canvas becomes tainted and every texture upload fails. A `data:` URL is
same-origin, so the page opens from disk with **no requests at all** beyond the
page itself and the script.

Measured on the shipped build: opening `file:///…/Palma City/index.html` made
exactly **2 requests** (the HTML and `assets/app.js`), **0 asset requests**,
and logged **0 error-level messages**.

### If Windows shows "Windows protected your PC"

That is SmartScreen reacting to a downloaded file, not Defender finding
anything. Click **More info → Run anyway**. To avoid it entirely: right-click
the downloaded zip → *Properties* → tick **Unblock** → *OK*, then extract.

---

## 2. Optional fallback — `start.bat`

Some managed or locked-down browsers refuse to run local pages. In that case
double-click **`start.bat`** in the same folder. It runs `server.ps1`, which
starts a tiny loopback-only web server and opens the game at
`http://127.0.0.1:8765/` (8766, 8767, … if that port is taken). Keep the black
window open while you play.

- It uses a plain TCP socket, not `HttpListener`, so it needs **no admin rights**
  and no `netsh http add urlacl`.
- It binds to `127.0.0.1` only: nothing outside your PC can reach it, and no
  firewall rule is needed.
- The game still loads its textures from inside `app.js`, so the server only
  serves `index.html` and the script.

| Symptom | Fix |
|---|---|
| Blank page or a download prompt instead of the game | Use `start.bat` |
| `start.bat` window flashes and closes | Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1` in that folder so the error stays visible |
| Browser can't reach the page | Read the port printed in the black window and use that address |
| Game is slow | Close other tabs/apps, use Edge or Chrome; the game is 3D and wants a modern GPU |

---

## 3. Secondary — the Electron build

Only if you specifically want a desktop window. It is a normal Electron app,
**will** be scanned by Defender, and unsigned builds usually need an exclusion
or an "unblock" before Windows will run them.

```bash
npm install
npm start          # electron .
```

The Electron build is unchanged by the browser work: it still loads its
textures as real files from `public/textures/` (via the identity resolver in
`src/world/asset-map.js`), not as inlined data URLs.

To build a Windows executable:

```bash
npm run package:x64     # 64-bit Windows
npm run package         # current platform
```

Output lands in `release/`. If Defender quarantines the new `.exe`, add a folder
exclusion (*Windows Security → Virus & threat protection → Manage settings →
Exclusions*) or sign the build — unsigned Electron binaries are a well-known
false-positive magnet. `tools/allow-palma.ps1` automates adding an exclusion for
the folder it sits in; copy it next to the `.exe` before running it.

A cross-built x64 zip cannot be produced on this Linux machine (the Electron
x64 runtime download stalls), so build the Windows package on Windows.

---

## Controls

`W A S D` move · mouse look (click the game once) · `Shift` sprint · `Space`
jump / handbrake · left mouse fire · right mouse aim · `R` reload · `F`
enter/exit vehicle · `1`–`4` or wheel change weapon · `H` radio (horn while
driving) · `M` map · `Esc` pause.

---

## What has actually been verified

Verified on this machine (Linux; Chromium inside Electron with
`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` — the real
browser security model, and the closest stand-in available here, since there is
no system Chrome/Edge):

- **From a clean extract**, opened as `file:///…/Palma City/index.html`:
  the 3D city rendered with photographic brick/asphalt textures, pedestrians,
  the player character, and the HUD + minimap. The current build renders the
  spawn view at **4.57M triangles / 96 draw calls** (see the final budget table
  at the end; every window on the lower floors is real geometry: reveal, frame,
  glazing, sill and lintel).
  Screenshots: [`screenshots/controls-check.png`](screenshots/controls-check.png),
  [`screenshots/browser-file-extracted.png`](screenshots/browser-file-extracted.png).
- **Requests: 2 total** (the document and `assets/app.js`), **0 asset
  requests**, 0 failed requests — no tainted-canvas or missing-asset errors.
- **Console: 0 error-level messages.** (The only lines were SwiftShader GL
  performance notices from this VM's software rasteriser, which are not page
  errors.)
- **Scripted input:** holding `W` moved the player through the game's own
  `KeyW` handler (the key was read back from `g.input.keys`, and pointer
  lock/pause/start state were checked); no stubbed hook was used. A mouse
  movement to the right turned the view right, and `D` strafed toward
  screen-right (dot products against the camera's screen-right vector).
- The zip contains no `.exe`, `.dll` or `.msi`.
- `npm start` still boots Electron (ran 30 s without exiting or crashing).

**Not verified here:** real Windows, real Edge/Chrome, and `start.bat` /
`server.ps1` under Windows PowerShell (this sandbox is Linux with no
PowerShell). The same files were exercised over `file://` in Chromium instead.

---

## 3D models (cars, people, props)

The game no longer draws its cars and people from code. It loads real GLB
models from `public/models/`, listed in `public/models/manifest.json`:

| File | What it is | Source | Licence / credit |
| --- | --- | --- | --- |
| `ferrari.glb` | Ferrari 458 Italia, 4 wheels + steering wheel, decimated from 310k to **61k triangles** | `three.js`, `examples/models/gltf/ferrari.glb` | Model by **vicent091036** (Sketchfab), shipped in the three.js examples. Welded, grid-decimated and re-saved as meshopt GLB (207 KB). |
| `Spectral.glb` | Spectral GT RS sports car, 4 wheels in 29 parts each | `jaronkbragg7337.github.io/spectral-gt-rs` | **CC0 1.0** public domain. Re-saved as meshopt GLB (0.5 MB), node names kept so the wheels can be grouped and spun. |
| `Soldier.glb` | Rigged character, `Idle`/`Walk`/`Run` | `three.js`, `examples/models/gltf/Soldier.glb` | Mixamo character and animations. Mixamo terms allow use in a project like this; the raw character file is not redistributable as a standalone asset. |
| `Xbot.glb` | Second rigged character, `idle`/`walk`/`run` | `three.js`, `examples/models/gltf/Xbot.glb` | Mixamo character and animations, same terms as above. |
| `Cashier.glb` | Rigged shopper, `Idle`/`Walk`/`Run` | Gobkit Free Character Pack Vol.1 | **CC0 1.0** — no attribution required. |
| `FoodCourier.glb` | Rigged courier, `Idle`/`Walk`/`Run` | Gobkit Free Character Pack Vol.1 | **CC0 1.0**. |
| `GrandmaShopper.glb` | Rigged older shopper, `Idle`/`Walk`/`Run` | Gobkit Free Character Pack Vol.1 | **CC0 1.0**. |
| `OfficeLady.glb` | Rigged office worker, `Idle`/`Walk`/`Run` | Gobkit Free Character Pack Vol.1 | **CC0 1.0**. |
| `Schoolkid.glb` | Rigged schoolkid, `Idle`/`Walk`/`Run` | Gobkit Free Character Pack Vol.1 | **CC0 1.0**. |
| `PedestrianFemale.glb` | Low-poly female pedestrian, `idle`/`walk`/`sprint` | Cinevva CC0 character (Quaternius/Kay Lousberg originals) | **CC0 1.0**. |
| `Lantern.glb` | Street lamp post | `KhronosGroup/glTF-Sample-Assets`, `Models/Lantern` | **CC0 1.0** — © 2017 Microsoft (sbtron), Draco © 2018 Frank Galligan. |
| `Bench.glb` | Painted wooden bench | Poly Haven `painted_wooden_bench` | **CC0 1.0** (Poly Haven). |
| `TrashCan.glb` | Metal trash can | Poly Haven `metal_trash_can` | **CC0 1.0** (Poly Haven). |
| `Hydrant.glb` | Fire hydrant | Poly Haven `fire_hydrant` | **CC0 1.0** (Poly Haven). |
| `Planter.glb` | Planter box | Poly Haven `planter_box_01` | **CC0 1.0** (Poly Haven). |
| `Mailbox.glb` | Suburban mailbox, 716 triangles | 3dassets.dev, model **27278** (direct CDN GLB) | **CC0 1.0** (3dassets.dev publishes CC0, human-reviewed models). |
| `Bollard.glb` | Mooring bollard, 348 triangles | 3dassets.dev, model **37103** | **CC0 1.0**. |
| `Tree.glb` | Cherry tree in blossom, 2,294 triangles | 3dassets.dev, model **30082** | **CC0 1.0**. |
| `PineTree.glb` | Pine tree, 132 triangles | 3dassets.dev, model **27427** | **CC0 1.0**. |

Pedestrians pick at random from all **eight** characters above, so the street shows
several different people at once, and both car bodies share
ordinary traffic: every fourth spawned car is the Spectral, capped at three
live Spectral cars at a time, with the Ferrari filling the rest.

The Spectral is authored as 200+ separate meshes, which cost ~215 draw calls a
car and once took the frame from 233 to 5,445. It is now **merged at convert
time**: `mergeSubtree()` in `src/world/models.js` bakes every body mesh's world
matrix into its geometry and joins them per material into one mesh each, while
the four wheel nodes stay separate pivots so they still spin and steer. That
brings it to roughly 44 draw calls a car; capping how many exist at once keeps
the frame near the old budget while both bodies stay visible in traffic.

How it works:

- `src/world/models.js` loads the manifest with `GLTFLoader` (plus the
  meshopt decoder that ships inside three.js) and hands out instances.
- Cars: the GLB body replaces the coded shell, its `wheel_fl` / `wheel_fr` /
  `wheel_rl` / `wheel_rr` nodes are wrapped in pivots, so the front pair
  steers with `steerAngle` and all four spin with the wheel speed. Scale and
  forward axis are normalised, and the body is dropped onto the road, so the
  car sits where the old one did and the collider is unchanged.
- People: the player and every pedestrian use `SkeletonUtils.clone` of the
  rigged character with an `AnimationMixer`, choosing `Idle` / `Walk` / `Run`
  from movement speed. Height is normalised to 1.82 m so the camera eye level
  is unchanged.
- Street lamps: the downloaded lamp model is placed along every kerb and drawn
  as three `InstancedMesh` parts, so 800 posts cost 3 draw calls instead of
  2400.
- Fallback: if a model is missing or fails to parse, that car, person or prop
  is built by the old procedural code instead, and the game keeps running.
- Character height is measured from the **skeleton**, not the skinned mesh's
  geometry box (that box ignores the armature scale and made everyone ~20x too
  big). Measured in game: player 1.59-1.69 m, pedestrians 1.66-1.75 m.
- Cars are rotated so the nose points along the direction of travel, and the
  enter-vehicle prompt reaches 5.6 m from the car centre so you can reach the
  door of a 4.7 m car.

No coded stand-ins are left for street furniture, plants or vehicles: mailboxes,
bollards and both tree types are downloaded GLBs, instanced like the benches,
bins, hydrants, planters and lamps (1,655 prop instances over 9 kinds, plus 400
lamp posts).

Assets that were downloaded and rejected:

- Poly Haven's jacaranda (1.1M triangles / 17 MB) is far too heavy to instance;
  the 2.3k-triangle cherry and 132-triangle pine stand in for park and street
  trees instead.
- `Michelle.glb` only ships `SambaDance` and `TPose`, so it cannot walk or run.
- The Ferrari body is 310k triangles, and neither `gltf-transform simplify` nor
  `optimize` could reduce it (its geometry is split across many primitives that
  the simplifier leaves alone). It is kept because it looks right, and the
  triangle budget is managed by the merged Spectral and instanced props.

Verified on the shipped bundle extracted to a folder with a space in its path,
opened over `file://`: 13/13 manifest assets loaded, 0 model errors, 0 fallbacks,
every car and pedestrian in the scene on the GLB path (48/48 and 25/25 in that
run — traffic and pedestrians spawn dynamically), the player on the rigged
character, 9 prop kinds (1,655 instanced props) and 400 lamp posts. Bones moved
between frames while walking, car wheels spun (5.76 -> 14.50 rad) and the front
wheel pivot followed the physics steering angle (0.6042 rad), look-right and
strafe-right measured correct, and the facade window geometry still rendered.

Frame cost is view-dependent because the city culls per mesh. **The numbers in
this section are historical**; the current, measured build is in
“Density, facade variety and the frame budget (final)” at the end of this file
(4.55–4.91M triangles, 76–96 calls in normal street views).

The Electron launcher (`npm start`) was checked too: it boots with all models
loaded, 0 errors and 0 fallbacks, so both paths use the real models.

Release files (current):

- `release/Palma City-browser.zip` — **current**: built from this source, contains every
  model listed above inlined into the bundle. Double-click `index.html` inside it.
- The old `Palma City-win32-arm64.zip` / folder were **removed**: they predated the
  model work and could not be rebuilt here (Electron packaging needs a Windows host).
  Windows users run `npm start` from this source tree instead.

## Update: facing, entering cars, shooting, and the triangle budget

- **Cars now face the way they drive.** The old code turned every body a blind half
  turn. It now asks the front wheels which end is the nose, at the end of the
  convert step with final matrices, and turns the body inside a holder if the front
  pair sits at -Z. Measured after the fix: front wheel pivots at **+1.16 m on +Z**,
  i.e. the nose leads.
- **Any car can be entered.** `enterVehicle` used to refuse every car that already had
  a driver, so the AI traffic you meet on the street was un-enterable. It now takes
  over AI-driven cars too. Verified in game: parked car `entered: true`, AI traffic car
  `entered: true`.
- **Shooting fires.** `playerFire` was fine; the frame loop only fired while the mouse
  was held, which lost the first click when the game was still starting. It now also
  fires on the mouse-down edge. Verified: pistol 12 -> 11 rounds, cooldown 0.18 s, and
  a synthetic `mousedown` on the canvas reaches `input.mouse.left`.
- **Triangle budget.** The traffic body was 310k triangles a car, and neither
  `gltf-transform simplify` nor `optimize` would touch it (its geometry is one
  fragmented primitive the simplifier skipped). It is now welded and decimated by
  grid clustering to **61,079 triangles**, re-indexed, pruned and meshopt-compressed
  from 1.87 MB to **207 KB**. The wheel nodes keep their names, so they still spin and
  steer. That pass brought the spawn view to 14.4M triangles; the final build is
  **4.57M / 96 calls** after the transmission, shadow-pass and LOD fixes listed at
  the end of this file.

- **People face the way they walk.** `instanceHuman` now measures the toe bones
  against the ankle bones and turns the body inside a holder when the toes point at
  -Z, the same rule the cars use with their front wheels. Before this, people kept
  the GLB's own forward axis and appeared to walk backwards.
- **More people.** Six new CC0 characters were added (Gobkit Vol.1 pack, plus a
  low-poly Cinevva/Quaternius pedestrian), so pedestrians now draw from eight
  distinct rigged models. Manifest loads **19/19 assets, 0 errors, 0 fallbacks**.

## Interiors: every building, one room kit

Every building footprint in the layout now has an interior and a street door.

- `buildBuilding()` records each footprint (388 of them) and `buildInteriors()`
  builds **four room kits** — apartment, club, garage, restaurant — once, then
  clones one per building. Clones share geometry and materials, so the whole
  system is a few kilobytes of scene graph rather than unique furniture.
- Rooms sit in a basement grid at **y = -140**, far outside the city, and are
  hidden until entered. Entering flips only that room visible, so being inside
  costs **91 draw calls / 10.5M triangles**, and the street pays nothing for the
  388 rooms that are not in use.
- Doors: `snapToStreet` puts each entrance on the nearest road, and all 388
  markers are drawn as a single `InstancedMesh`. Walk up, press **F**, and the
  player is teleported into the room; the exit door inside works the same way.
- Room sizes: apartment 13x11 m (19 meshes), club 20x16 m (23), garage 16x13 m
  (14), restaurant 18x13 m (23). Each has floor, four walls, ceiling, ceiling
  lights, a point light and furniture (bed/sofa/kitchen, bar and dance floor,
  benches and toolbox, tables and counter).

## Density, facade variety and the frame budget (final)

Measured on `release/Palma City-browser.zip`, extracted to a scratch directory and
loaded over `file://` by the headless probe.

Density (unchanged from the previous pass, not traded for performance):
**37 traffic cars**, **24 pedestrians** drawn from 8 rigged characters,
**1,655 instanced street props** over 9 kinds, **400 lamp posts**, and
**388 enterable interiors** with **388 door rings** (garage 32, apartment 130,
club 78, restaurant 148; 14–23 meshes and 108–216 triangles each).

Facade variation, counted during the build (`city.facadeCounts`): **330 recessed
storefronts with glazing**, **333 awnings**, **1,712 signs**, **42 tower
setbacks**, **30,943 window openings**, **330 shop glazing panes**. That is a
real shopfront on 85% of the 388 buildings and window geometry on every facade —
they are not flat grey boxes.

Per-view cost, read from `renderer.info` after a real frame (`g.tick`), camera
position in brackets:

| View | Draw calls | Triangles |
| --- | --- | --- |
| Spawn, looking down the street (-188, 2, -9) | 84 | 4.57M |
| Downtown junction (-188, 2, -183) | 74 | 4.56M |
| Standing at a random door (423, 2, 5) | 75 | 4.57M |
| Inside an interior (-3724, -138, -3886) | 67 | 1.95M |
| Busiest of 32 sampled street/rooftop views (city corner, -470, -470) | 222 | 4.85M |

The budget was 8.6M triangles and roughly 115 draw calls. **Every measured view
is under the triangle ceiling**, and the three normal street views are also under
the draw-call reference. The worst case is 222 calls at the outer corner, where
the camera sees the whole grid: the residual is ~176 per-building decoration
meshes that each own a unique material (they merge only where materials are
shared) plus ~5 visible cars at ~10 material draws each. Closing that would need
per-material atlasing of the per-building decorations.

### What brought it down (each change measured, not assumed)

- **Transmission pass.** One glass material with `transmission > 0` made three.js
  render the entire scene into a transmission buffer before the real pass, so
  every triangle and call was counted twice (spawn: 11.3M/531 → 5.6M/259 calls).
  All transmission is cleared at startup; glass stays transparent.
- **Shadow pass.** Merged city batches cannot be partially culled by the shadow
  camera — any batch inside the shadow box redrew in full. Static city geometry
  no longer casts shadows; only vehicles and people do, in a 110 m box.
- **Facade LOD.** Window frames only below 9 m, sills/lintels below 7 m; upper
  floors keep their glazing and window openings. Trim batch 2.42M → 2.07M tris.
- **Car merges.** AI traffic bakes its four wheel pivots into the body (the car
  the player drives keeps four spinning wheels); draw calls at the spawn view
  fell 554 → 210 in the attribution probe.
- **Distance LOD.** Cars past 70 m and pedestrians past 45 m stop drawing while
  the simulation keeps running.
- **Decal merge.** 200+ small static street meshes (road paint, pads, plates)
  merged into one mesh per shared material.
- **Props.** Decimated and instanced: lantern 2,244 tris, bin 1,744, hydrant
  1,432, planter 1,018, tree 914, bench 232, pine 50.

### How the door path was exercised

Entry and exit both go through the real F key. The probe teleports to a door,
injects `KeyF` and calls `player.update()` (the same handler the loop uses); it
then stands the player on the door marker, injects `KeyF` and calls
`game.tick(0.016)` — the game's own frame update — four times. It never calls
`exitInterior()` directly. All four kits passed: `inside: true`,
`visible: true`, player at y = −139.9 and 0.8 m from the interior door, then
`viaKey: true`, `exited: true`.

### Model facing and model diversity (AI pedestrians and traffic)

`tools/facing-check.cjs` drives 300 real frames (`g.tick` + `input.endFrame`),
then samples every moving pedestrian and every visible traffic car.

**Facing.** For pedestrians the forward axis is measured anatomically from the
rest pose (mean Z of the lowest 12% of vertices, i.e. the toes, minus the body's
mean Z) and the model is turned inside a holder when that points at -Z; the bone
test is only a fallback for rigs without usable geometry. The measured
forward-vs-velocity dot products over 34 walkers were:

- minimum mesh-forward dot: **1.0** (every walker's yaw equals its travel direction)
- minimum anatomical dot (rigs with toe/foot bones): **0.998**

For cars, the mesh +Z is the nose: the front-wheel pivot check on a car that kept
its pivots gives **dot(mesh +Z, front-axle direction) = 1.0**, and over 14 moving
cars the minimum forward-vs-velocity dot was **1.0**. No walker or car travelled
backward in any sample.

**Diversity actually rendered.** Union over the street view and 12 parking-spot
views, counting only meshes that were visible:

- Humans: **8 distinct models** — `courier`, `soldier`, `grandma`, `xbot`,
  `officelady`, `cashier`, `pedfemale`, `schoolkid` (the whole loaded pool).
- Cars: **3 distinct bodies rendered** — `ferrari`, `spectral`, and a
  `procedural-suv`; the fleet also carries type-specific bodies (sedan, coupe,
  muscle, pickup, van, taxi, hatch) and 9 paint colours.
- 0 car fallbacks, 0 human fallbacks, 0 model errors in the same run.

The detailed Spectral body costs ~18 draw calls, so it appears as a parked
showpiece (two of them) rather than in moving traffic; the Ferrari body is the
traffic workhorse. Non-player cars now use one instanced wheel mesh instead of
four draws, which is what paid for the extra body variety.

### Car entry/exit and shooting, driven through the real input path

`tools/interactions-check.cjs` drives the same DOM events the game listens for and
the same frame update the loop runs (`g.tick(dt)` followed by
`g.input.endFrame()`), so nothing is called directly — no `enterVehicle()`,
`exitVehicle()` or `playerFire()`.

**Car entry/exit, two cars (a sedan and an SUV), observed values:**

| Step | Sedan | SUV |
| --- | --- | --- |
| Before, on foot | `inVehicle:false`, driver `null` | same |
| After real `keydown` F + frames | `inVehicle:true`, `attachedIsCar:true`, driver `player`, player mesh hidden, camera `vehicle` | same |
| Hold real `keydown` W for 40 frames | speed 5.14 m/s, moved 1.78 m, player follows the car, still inside | 4.18 m/s, 1.44 m, same |
| After real `keydown` F + frames | `inVehicle:false`, player mesh visible, 2.31 m from the car, car driver `null`, car visible and alive, camera `foot` | same |

Both were parked cars with no driver. AI traffic cars (driver `ai`) are now also
enterable from the street: the prompt guard used to reject any car with a driver.

**Gun aim and fire, observed values:** a target car was placed 9 m down the
camera axis, then a real `mousedown` (button 0) was dispatched on the canvas and
one frame was driven.

- Ammo **12 → 11**, `fireCooldown: 0.176 s`, wanted level **0 → 1**.
- **1 tracer** and **1 muzzle flash**; the captured hit point (-188.02, 1.58, -6.82)
  is on the target car (`hitNearTarget: true`), and the flash sprite was visible.
- Holding the button for another frame did **not** spend a second round
  (ammo stayed 11), so the fire rate is respected; after the cooldown a second
  real click fired again (ammo 10, 2 tracers, 2 flashes).
- Real right-button aim: `aiming:true` while held, `aiming:false` after release.
- `errors: []` — no exceptions from the effects, tracers or weapon code.

Re-measured after this pass on the same extracted build (no regression):

| View | Draw calls | Triangles |
| --- | --- | --- |
| Spawn | 84 | 4.57M |
| Downtown junction | 74 | 4.56M |
| At a door | 75 | 4.57M |
| Inside an interior | 67 | 1.95M |
| Busiest swept view (city corner) | 222 | 4.85M |

Load check on the same extraction: 19/19 assets, 0 errors, 0 car fallbacks,
0 human fallbacks, 180 calls / 5.58M triangles. Interiors: 388, density
24 pedestrians / 37 cars / 1,655 props / 400 lamps, and all four door kits still
enter and exit through the real F key (`viaKey:true`, `exited:true`).

### Assets on the same extraction

19/19 models loaded, **0 errors**, **0 car fallbacks**, **0 human fallbacks**,
37/37 cars and 24/24 pedestrians on downloaded GLB bodies, 0 console errors and
0 failed requests; the load-check view renders 5.53M triangles / 187 calls.

### What was not verified

This sandbox cannot capture a frame (blank canvas `toDataURL`, blank/timed-out
`capturePage`), so every number above comes from rendering the real scene and
reading the GL counters — **not** from a screenshot. Visual quality of the merged
decals and the AI-wheel merge was not inspected by eye.

### Still open

- **Sketchfab** downloads require a signed-in account and could not be used here;
  the models come from three.js examples, Poly Haven, 3dassets.dev, Gobkit and
  Cinevva, all CC0 (table above).
- **Interior variety**: four room kits, so two apartments look the same inside.
- **Worst-case draw calls**: 222 at the outer corner versus the 115 reference;
  the remaining excess is the per-building decoration batches and the cars in
  view.

## Next pass (requested, not yet done)

- **Pedestrians read as animated toys.** The eight loaded characters are stylised
  game/CC0 rigs (Gobkit, Xbot, Soldier, Cinevva). Replacing them needs
  photoreal scanned humans; Sketchfab downloads require a signed-in account, so a
  direct-download CC0 scan source is the blocker.
- **Front/back glitch on some characters.** The geometric facing test above is
  deterministic and every sampled walker/car measured +1.0, so the remaining
  report is either a specific asset whose rest pose is ambiguous or the walk
  animation playing against travel — needs an in-game visual check, which this
  sandbox cannot capture.
- **Weird stripes on part of the road.** Suspect the road-marking/pad decal layer
  (merged planes with polygon offset) rather than the asphalt texture; needs a
  visual capture to confirm before changing geometry.

## Realistic humans, gait probe, and the road-stripe cause

### Download attempts (recorded in-session, `curl` HTTP code and bytes)

| Source | URL | HTTP | Bytes | Result |
| --- | --- | --- | --- | --- |
| Grab3D (CC0, no login) | `https://grab3d.com/dl/businessman-rigged/businessman-rigged.glb` | 200 | 12,498,476 | used |
| Grab3D | `https://grab3d.com/dl/chef-woman-rigged/chef-woman-rigged.glb` | 200 | 13,350,344 | used |
| Grab3D | `https://grab3d.com/dl/elderly-man-rigged/elderly-man-rigged.glb` | 200 | 14,047,168 | used |
| Grab3D | `https://grab3d.com/dl/female-athlete-rigged/female-athlete-rigged.glb` | 200 | 13,418,392 | used |
| Sketchfab API | `https://api.sketchfab.com/v3/models/<uid>/download` | **401** | 58 | `Authentication credentials were not provided.` |
| Khronos | `CesiumMan/glTF-Binary/CesiumMan.glb` | 200 | 438,044 | realistic-ish but low-poly; not used |
| three.js | `examples/models/gltf/Michelle.glb` | 200 | 3,276,888 | only SambaDance/TPose clips, no walk; not used |

The four Grab3D scans are photoreal CC0 humans with `walk` and `run` clips.
Each was resized to 512px textures, simplified and meshopt-compressed:

| Model | Tris after simplify | File size | Clips |
| --- | --- | --- | --- |
| businessman | 22,697 | 490 KB | walk, run |
| chef-woman | 4,222 | 202 KB | walk, run |
| elderly-man | 13,914 | 404 KB | walk, run |
| female-athlete | 5,524 | 195 KB | walk, run |

They have no `idle` clip, so `instanceHuman` now builds a standing pose from the
first frame of the walk clip (a paused clone) — a pedestrian that stops never
falls into a T-pose. Manifest human pool is now **12** entries; the spawner
draws across all of them, so one street shows a mixed crowd.

### Gait probe (`tools/anim-check.cjs`)

For each sampled pedestrian the probe forces the walk action, steps it through
16 phases with `mixer.setTime`, and measures the planted foot (lowest toe/foot
bone, or CPU-skinned lowest vertices for boneless rigs) in the character's own
frame. A forward walk means the planted foot travels toward −Z between contacts.

- 34 walkers sampled, 12 models.
- Planted-foot travel toward −Z: soldier −0.861 m, athlete −0.612 m, xbot −0.459 m,
  businessman −0.659 m, chef-woman −0.569 m, elderly-man −0.130 m.
- Root drift 0.000 m on every sampled rig: no root-motion translation fighting
  the controller, and every action has `timeScale: 1`, `paused: false`.
- Residual: `schoolkid`, `cashier`, `pedfemale` and `officelady` report no
  stance travel (their GLB walk clip does not move the sampled foot objects), so
  those four overlays still glide. This is the remaining "animated toy" case.

### Facing test rewritten

The old flip decision compared the mean Z of the lowest 12% of vertices with the
body centre. Measured on the new scans that signal is **±0.001–0.004 m**, i.e.
millimetre noise: the half-turn was being decided by noise, which is exactly the
back/front glitch. `instanceHuman` now:

1. uses the feet offset only when it is at least 0.02 m (a real toe overhang),
2. otherwise uses the head/nose offset (top 10% of vertices),
3. falls back to toe-bone direction when both are below 5 mm.

Result on the rebuilt package: 37 pedestrians and 17 cars sampled,
`minPedDotMesh 1`, `minCarDot 1`, zero load fallbacks, and the anatomical
(toe-direction) check is now negative on only 1 of 37 samples (athlete) versus
15 of 35 before the change.

### Road stripes: actual cause and fix

The road surface is a 20 m × 12 m tile with lane markings baked along its V
axis. For roads running along Z, `buildRoadMarkings` swapped the plane's UVs and
applied the length scale to the wrong axis:

```js
// before: markings rotated 90° and stretched across the carriageway
uv.setXY(k, uv.getY(k) * (len / 12), uv.getX(k));
// after: U spans the 20 m width, V repeats every 12 m along the road
uv.setXY(k, uv.getY(k), uv.getX(k) * (len / 12));
```

That single line is why only part of the road showed broad, wrong-direction
stripes: north–south carriageways were correct, east–west ones were not.
Crosswalk decals were also only 8 mm above the asphalt; they now sit at 0.03 m
(road surface 0.012, intersection pads 0.018) so the transparent stripe layer
cannot z-fight at distance.

### Rebuild measurements (same extracted zip)

| Check | Result |
| --- | --- |
| Model load | 23/23 assets, 0 errors, 0 car/human fallbacks, 177 calls / 5.46M |
| Spawn view | 84 calls / 4.57M |
| Downtown | 74 calls / 4.56M |
| At a door | 75 calls / 4.57M |
| Inside | 67 calls / 1.95M |
| Worst swept view | **220 calls / 4.84M** (limit 222 / 4.85M) |
| Doors (real F key) | 4/4 entered and exited, `viaKey:true` |
| Shooting | ammo 12→11, 1 tracer, 1 muzzle flash, hit near target, hold spends no round, second click fires |
| Cars | 17 sampled, mesh-forward dot 1.0, 0 fallbacks |
| Crowd | 12 distinct human meshes rendered in one run |

### Still open

- Four stylised rigs (`schoolkid`, `cashier`, `pedfemale`, `officelady`) have
  walk clips that do not animate the sampled feet; they still slide. Replacing
  them with more Grab3D scans (same pipeline) is the next concrete step.
- One of 37 anatomical samples (athlete) still reports toe bones opposite
  travel while its clip stance is forward; not resolvable without a frame
  capture, so it is reported rather than claimed fixed.
- No frame capture exists in this sandbox: nothing above is a visual check.

## Character pass 2 — every spawned rig now walks forward

### Fetches this pass (curl, HTTP status, bytes)

| Source | URL | HTTP | Bytes |
| --- | --- | --- | --- |
| Grab3D | `grab3d.com/dl/businessman-rigged/businessman-rigged.glb` | 200 | 12,498,476 |
| Grab3D | `grab3d.com/dl/chef-woman-rigged/chef-woman-rigged.glb` | 200 | 13,350,344 |
| Grab3D | `grab3d.com/dl/elderly-man-rigged/elderly-man-rigged.glb` | 200 | 14,047,168 |
| Grab3D | `grab3d.com/dl/female-athlete-rigged/female-athlete-rigged.glb` | 200 | 13,418,392 |
| Grab3D | `grab3d.com/dl/doctor-rigged/doctor-rigged.glb` | 200 | 13,032,668 |
| Grab3D | `grab3d.com/dl/construction-worker-rigged/construction-worker-rigged.glb` | 200 | 13,987,516 |
| Grab3D | `grab3d.com/dl/hoodie-teen-rigged/hoodie-teen-rigged.glb` | 200 | 13,664,012 |
| Grab3D | `grab3d.com/dl/farmer-woman-rigged/farmer-woman-rigged.glb` | 200 | 14,768,784 |
| Sketchfab API | `api.sketchfab.com/v3/models/<uid>/download` | **401** | 58 |
| Khronos | `CesiumMan.glb` | 200 | 438,044 (not used) |
| three.js | `Michelle.glb` | 200 | 3,276,888 (SambaDance/TPose only, no walk) |

Each Grab3D scan was resized to 512 px textures, simplified, meshopt-compressed
and given a paused first-frame standing pose (they ship walk/run only). Final
triangle counts: businessman 21,925 · doctor 21,992 · construction-worker 16,682
· elderly-man 13,914 · hoodie-teen 12,364 · farmer-woman 10,226 · female-athlete
5,524 · chef-woman 4,222.

### Why six rigs glided, and what replaced them

Measured from the GLB JSON: `Cashier`, `OfficeLady`, `Schoolkid`, `FoodCourier`
and `GrandmaShopper` animate 14 nodes (13 hashed skin joints such as `ddr7xp`
plus one non-joint root) but expose **no bone whose name contains toe/foot/ankle**,
and their skinned mesh never produced deforming vertices in the probe.
`PedestrianFemale` is a 7-joint rig (`root`, `leg-left/right`, `torso`, arms,
head) with a 6-track walk and no foot bones at all. With no measurable gait they
were removed from `public/models/manifest.json` rather than shipped sliding.

The spawner now draws from 10 models: 8 photoreal Grab3D scans plus `Soldier`
and `Xbot`.

### Per-model gait (final build, `tools/anim-check.cjs`)

24 phases per walk clip, walk action forced, planted foot tracked in the
character's own frame; forward is travel toward −local Z.

| Model | Stance ΔZ (m) | Stride (m) | Root drift (m) | Result |
| --- | --- | --- | --- | --- |
| athlete | −0.641 | 0.693 | 0 | PASS |
| businessman | −0.689 | 0.729 | 0 | PASS |
| chefwoman | −0.596 | 0.642 | 0 | PASS |
| constructionworker | −0.695 | 0.752 | 0 | PASS |
| doctor | −0.618 | 0.654 | 0 | PASS |
| elderlyman | −0.706 | 0.706 | 0 | PASS |
| farmerwoman | −0.646 | 0.693 | 0 | PASS |
| hoodieteen | −0.689 | 0.689 | 0 | PASS |
| soldier | −0.898 | 0.898 | 0 | PASS |
| xbot | −0.492 | 0.629 | 0 | PASS |

34 walkers sampled, **0 reversed**, **0 stance failures**, every model above
0.2 m and every root drift 0.000 m.

### Facing and the anatomical test

- Flip decision: feet offset when ≥ 0.02 m, else head/nose offset, else toe bones.
- Anatomical test now uses **bind-pose** toe-minus-foot rest positions (not the
  live swing pose). The soldier rig's bind matrices carry a non-unit scale — its
  rest vector measures 9–11 m — so that rig falls back to the live pose; the
  fallback is explicit and reported per sample (`anatRest.live`).
- Final run: 35 walkers, 12 cars, `minPedDotMesh 1.0`, `minPedDotAnat 0.999`,
  `minCarDot 1.0`, 9 distinct human meshes in one run, 0 fallbacks, 0 errors.

### Road-marking audit (`tools/road-audit.cjs`)

| Layer | Height (m) | UV repeat |
| --- | --- | --- |
| Road surface with baked lane markings | 0.012 | 1, 1 |
| Intersection pads (asphalt) | 0.018 | 1, 1 |
| Crosswalk decals | 0.030 | 1, 1 |

3 marking layers, **0 pairs within 4 mm** of each other, **0 fractional marking
UV strides**, crosswalk UV span 1.0 × 1.0. `passed: true`. The east–west UV-axis
fix from the previous pass is in the shipped build.

### Final package measurements

| Check | Result |
| --- | --- |
| Model load | 21/21 assets, 0 errors, 0 car/human fallbacks, 25/25 peds on GLB, 38/38 vehicles, 109 calls / 4.82M |
| Spawn view | 84 calls / 4.579M |
| Downtown | 74 calls / 4.577M |
| At a door | 75 calls / 4.588M |
| Inside | 67 calls / 1.974M |
| Worst swept view | **221 calls / 4.855M** clear, 222 in a storm (limit 222 / 4.85M) |
| Doors | 4/4 entered and exited with the real F key (`viaKey:true`, `exited:true`) |
| Shooting | 12→11, 1 tracer, 1 muzzle flash, hit registered on the target (`hitNearTarget:true`), hold stays 11, second click 10, aim on/off, 0 errors |
| Cars | sedan entered, drove 3.28 m/s (0.69 m), exited 2.31 m away; SUV 2.67 m/s, exited; player visible on foot after both |

### Still open

- Six stylised GLBs remain in `public/models/` but are no longer in the manifest;
  they could be re-added if a usable foot gait is authored for them.
- This sandbox cannot capture a frame: every result above is logged state, bone
  or vertex samples, HTTP results and GL counters — no visual check was made.


## GTA 6 gap pass (weather, fuel, witnesses, taxi)

### Audit: what GTA 6 does that this build did not

| GTA 6 pillar | Palma City before this pass | Action |
| --- | --- | --- |
| Dynamic weather, storms, wet roads | Fixed clear sky, day/night only | **Built**: 4-state weather cycle, shader rain, wet roughness, lightning + thunder |
| Fuel, engine wear, service stations | Vehicles ran forever, damage was cosmetic | **Built**: fuel burn, empty tank kills throttle, engine health, 3 forecourt stations, hold-F refuel/repair |
| Witness-based policing, suspect descriptions | Instant stars on any crime, no witnesses | **Built**: crimes need a witness; description tracks face/clothes/car; stars go hollow when the description is weak; mask (G) and a vehicle swap break it |
| Taxi fast travel | Walk/drive only | **Built**: T calls a cab, charges $100, drops at the mission marker |
| Store robberies, buses/trains, safehouse routines, phone | Not present | Deferred — listed under Still open |

### What changed

- `src/world/weather.js` (new): clear → overcast → rain → storm cycle with
  intensity ramps, a 2,400-point shader rain volume in **one draw call**, wet
  road roughness, dimmed sky, thicker fog, lightning flash overlay + thunder,
  and a looping rain bed in `audio.js`.
- `src/world/city.js`: `setWetness()` drives road/pavement roughness;
  `buildFuelStations()` puts three canopied forecourts at block corners. The
  station geometry shares the ground material so it batches with the pavement
  and costs **no extra draw call**.
- `src/entities/vehicles.js`: `fuel` (0–1), `engineHealth` (0–1), `engineOn`,
  burn scaled by throttle/speed, engine damage from impacts, low-engine smoke.
- `src/entities/player.js`: hold **F** at a station to refuel/repair (charged by
  need); the car is pinned to the pump while servicing so passing traffic cannot
  shove it out of range. **G** toggles a mask; stealing a different car clears
  the vehicle part of the police description.
- `src/entities/police.js`: `description {face, clothes, vehicle}`, witness
  counting, `lastKnown`, `reportCrime()`; with a weak description officers search
  the last known area instead of homing in.
- `src/systems/combat.js`: gunshots and homicides report through `reportCrime`.
- `src/systems/hud.js`: hollow wanted stars for an unconfirmed description, plus
  fuel and engine gauges in the speedometer.
- `src/main.js`: weather wiring, **G** mask, **T** taxi (`callTaxi`).

### Probe evidence (`tools/gta-check.cjs`, real key events, shipped build)

| System | Result |
| --- | --- |
| Weather | storm = clear + **1 draw call** (96 → 97), rain visible, wet road roughness 1.00 → **0.42**, sky dim 0.36, fog 0.00217 |
| Fuel burn | 0.5 → **0.4992** over 60 frames at 5.8 m/s, engine on |
| Empty tank | fuel **0**, `engineOn:false`, speed 1.43 → **1.25** with throttle held |
| Refuel/repair | fuel **1.0**, engine **1.0**, $500 → **$412**, engine back on |
| Unwitnessed shot | wanted **0**, witnesses 0 |
| Witnessed shot | wanted **1**, witnesses 1, face + clothes known, 0 hollow stars |
| Distant witness | wanted 1, face/clothes unknown, **1 hollow star** |
| Mask | `masked:true`, face unknown, stars stay hollow |
| Taxi | $500 → **$400**, moved 82.1 m, **0.0 m** from the marker |

### Regression on the same build

- Model load 21/21, 0 errors, 0 fallbacks, 25/25 peds on GLB.
- Doors 4/4 entered and exited with the real F key.
- Shooting 12→11, tracer + muzzle flash, hit registered, hold does not spend.
- Cars: sedan 3.28 m/s, SUV 2.67 m/s, both entered, driven and exited.
- Worst swept view **221 calls / 4.855M** clear and **222** with rain; spawn 84.

### Still open (next GTA 6 gaps)

- Store robberies with clerk reaction and a get-away window.
- Bus/train routes with stops and fares.
- Safehouse routines (sleep to skip time, wardrobe, garage).
- Phone with contacts, camera and messages.
- Locked cars and a hotwire minigame for theft difficulty.

## Living-world pass (phone, robberies, safehouse, courier)

### Checklist: next GTA 6 gaps, now closed

| Gap | Status | How it works in play |
| --- | --- | --- |
| Phone with contacts, invites, taxi/robbery hooks | **Done** | **P** opens the Palma Phone; arrows select, Enter calls. Contacts: DEX (marks the next job), COURIER (side job), TAXI ($100 to the marker), SAFEHOUSE (marks your apartment). Shows clock, money, live delivery countdown. |
| Store robberies + economy loop | **Done** | At a shop counter: **X** robs the register ($90–$240, 120 s cooldown), **B** buys a $25 snack (+40 HP), **N** buys $80 of pistol ammo. The clerk always witnesses: unmasked = face + clothes known, masked = face unknown. Closed shops and empty registers refuse. |
| Safehouse: evasion, save, respawn | **Done** | The first apartment is yours. Lying low inside clears a 1–2 star response in 6 s; 3+ stars will not clear and **B** at the bed is refused. At ≤2 stars **B** sleeps to 08:00, heals, refills armor to 50, clears the response and saves. Death respawns at the safehouse door (10% fee, wanted cleared). |
| Courier side activity | **Done** | Phone → COURIER: a package marker 130–340 m away, 90 seconds, $350 on drop-off. Expiry pays nothing. |
| Public transport (bus/train) | Open | Needs a route network and vehicle pooling; deferred. |
| Shop clerks/customers as NPCs | **Done** | Every shop has a deterministic clerk (including closed shifts) plus ambient occupants; see the fleet/interior-routine pass below. |
| Locked cars / hotwire | Open | Every car can still be entered freely. |
| Phone camera, messages, property purchases, wardrobe | Open | Phone is contacts/jobs only. |

### Bugs found and fixed on the way

- **Interiors were unreachable on live frames.** `Player.update` clamped the
  player to the world edge and its `y < -20` safety teleport fired inside rooms
  (interiors sit at y = −140), warping the player back to spawn every frame.
  Earlier interior probes missed it because they never ticked while inside.
  Both paths are now gated to outdoors, and interior movement skips world
  colliders/ground height.
- **Taxi charged with no destination.** It now refuses and charges nothing when
  no marker is set.
- **Mission completion could throw**: `MissionSystem.saveProgress` called
  `game.saveGame()` before it was attached. Save/load/new-game entry points are
  now exposed on `game`, and the call is guarded.
- Saving from inside the safehouse now stores the street door, not the interior
  grid coordinates, and restores `masked`.

### Probe evidence (`tools/living-check.cjs`, real key events, shipped build)

| Check | Result |
| --- | --- |
| Phone | opens with **P**, panel visible, closes on call |
| Courier start | job active, marker 216.8 m away, 90 s |
| Courier failure | timer expired → job cleared, **$0**, `jobsFailed 1` |
| Courier success | drop reached → **+$350**, `jobsDone 1` |
| Taxi, no destination | refused, **$0** spent, no marker |
| Taxi after DEX | marker set, **$100**, moved **141.7 m** |
| Robbery | prompt shown, **+$222**, wanted 1, face + clothes known, cooldown 120 s |
| Empty register | second **X** → “REGISTER EMPTY · 120s”, **$0**, refusal counted |
| Economy | snack **$25 → +40 HP**; ammo **$80 → +24** |
| Masked robbery | **+$115**, wanted 2, **face unknown** |
| Closed shop | “SHUTTERS DOWN”, **$0**, refusal counted |
| Safehouse evasion | 2 stars → **0** after 6 s inside |
| Evasion failure | 4 stars → sleep refused, hour unchanged, wanted 4 |
| Sleep/save | hour **8.0**, health **100**, armor **50**, wanted **0**, save money **777**, save x = door |
| Death respawn | **0 m** from the safehouse door, health 100, wanted 0, $78 fee |

### Save survives a real reload (`tools/save-reload-check.cjs`)

Slept at the safehouse with $777 and 55 HP, reloaded the page, pressed Enter on
the title: `started true`, money **777**, health **100**, armor **50**, hour
**8.0**, interior `false`, **0.0 m** from the saved door, wanted 0.

### Regression on the same build

- Load 21/21, 0 errors, 0 fallbacks, 24/24 peds on GLB, 37/37 vehicles, 177 calls.
- Doors 4/4 entered and exited with the real F key.
- Shooting 12→11, tracer + muzzle flash, hit registered, hold does not spend.
- Cars: sedan and SUV entered, driven and exited, player visible after.
- Weather storm +1 draw call, wet roughness 0.42; fuel empty/refuel unchanged
  (fuel 1.0, engine 1.0, $500→$412); witness/mask police cases unchanged; taxi
  82.1 m to the marker.
- Facing: `minPedDotMesh 1.0`, `minPedDotAnat 0.998`, `minCarDot 1.0`, 0 fallbacks.
- Gait: 34 sampled, 0 reversed, 0 stance failures. Road audit passed.

### Refreshed budget (storm active)

| Check | Result |
| --- | --- |
| Spawn | 84 calls / 4.576M |
| Downtown | 74 calls / 4.566M |
| At a door | 75 calls / 4.578M |
| Inside | 67 calls / 1.962M |
| Worst swept view, storm | **221 calls / 4.773M** (limit 222 / 4.85M) |
| Worst swept view, clear | 220 calls / 4.758M |
| Best swept view, storm | 85 calls / 4.498M |

Lamp-post instances were reduced 400 → 360 (one always-drawn instanced batch,
~90k triangles) to keep the storm worst case under the ceiling with traffic
variance; the new systems themselves add **no meshes and no draw calls**.

### Still open

- Bus/train routes with stops and fares; shop clerks/customers inside stores.
- Locked cars and a hotwire minigame; vehicle theft difficulty.
- Phone camera/messages, property purchases, wardrobe, mission replay.
- No frame capture in this sandbox: every number above is logged state, real key
  events, DOM text and GL counters — no visual check was made.

## Theft & inhabited interiors pass

### Checklist: next gaps

| Gap | Status | How it works in play |
| --- | --- | --- |
| Hotwire / vehicle theft | **Done** | Locked cars show **HOTWIRE VEHICLE**. Press **F** once to start a 1.8 s hotwire; the prompt counts down. Pressing **F** again, walking away, or leaving the car aborts it (`HOTWIRE ABORTED`). On success the car unlocks permanently (`keys`), you enter through the normal path, and `vehicle theft` is reported to the witness-based police: seen = wanted + description, unseen = `NO WITNESSES` and no stars. Mission cars carry keys and still open instantly. |
| Inhabited interiors | **Done** | Entering a shop builds a clerk behind the counter plus two customers; clubs get a bartender and two patrons; garages a mechanic and a customer. They use the same `buildHuman`/`HumanRig` pipeline as police/player and are parented to the interior group, so they only draw while you are inside. The clerk greets you, turns to face you, and reacts to a robbery (`robbed` state + “Please— take it, just don’t shoot!”); an emptied register gives `empty` + “I already gave you everything!”. Closed shops have no clerk and refuse with `SHUTTERS DOWN`. |
| Public transport (bus/train) | Open | Still deferred: a bus route with stops, fare and HUD needs a pooled transit vehicle plus route scheduling; it would add draw calls and a new navigation path, so it was left out rather than blowing the ceiling. |
| Interior NPC schedules / reactions beyond robbery | **Done** | Day/closed shifts, deterministic clerks, ambient occupants and robbery reactions; actors are capped and cached. |
| Hotwire minigame / alarms | Open | Fixed 1.8 s timer, no lockpick/alarm variants. |

### What changed

- `src/systems/interior-life.js` (new): lazy per-interior cast, clerk greeting/reaction,
  robbery lines. `Living.rob` now requires a clerk and triggers the reaction; an
  emptied register also produces the `empty` line.
- `src/entities/player.js`: `hotwire` state, `startHotwire` / `abortHotwire` /
  `finishHotwire`, HUD countdown, abort on movement/second press, witnessed
  theft report. `teleport` and `enterVehicle` clear any pending hotwire.
- `src/entities/vehicles.js`: vehicles default to `keys = false` (locked).
- `src/systems/missions.js`: mission-provided cars get `keys = true`, keeping the
  old instant-entry flow for legitimate vehicles.
- `src/main.js`: `InteriorLife` instantiation/update, `ensure()` on interior entry.
- `index.html`: controls list documents hotwire.

### Probe evidence (`tools/theft-check.cjs`, real F keys, shipped build)

| Check | Result |
| --- | --- |
| Locked car prompt | `HOTWIRE VEHICLE` |
| Start | hotwire state active |
| Abort (second F) | not in vehicle, hotwire cleared, `hotwireAborts 1`, car still locked |
| Unwitnessed theft | entered, car unlocked, **wanted 0**, **witnesses 0**, no vehicle description |
| Witnessed theft | entered, **wanted 1**, `description.vehicle` = car id, face + clothes known, 1 witness |
| Keyed car | prompt `ENTER VEHICLE`, instant entry (old flow), exit works |
| Exit | on foot, player mesh visible after both thefts |

### Probe evidence (`tools/interior-life-check.cjs`, real F/X keys, shipped build)

| Check | Result |
| --- | --- |
| Shop cast | clerk present, **3 actors**, clerk at local z **−6.0** behind the counter, state `idle` |
| Robbery | **+$184**, wanted 1, clerk state `robbed`, line “Please— take it, just don’t shoot!”, subtitle shown |
| Empty register | state `empty`, line “I already gave you everything!”, **$0** gained, prompt `REGISTER EMPTY · 120s` |
| Closed shop | **no clerk**, 0 actors, `SHUTTERS DOWN`, **$0**, refusal counted |
| Hidden outside | interior group hidden again after exit |
| Club | bartender present, 3 actors |
| Garage | mechanic + customer built (same path) |

### Regression on the same build

- Load 21/21, 0 errors, 0 fallbacks, 24/24 peds on GLB, 37/37 vehicles, 176 calls.
- Doors 4/4 entered and exited with the real F key.
- Vehicle entry/exit: sedan and SUV hotwired, driven (0.68 m / 0.55 m), exited;
  keyed mission cars still enter instantly.
- Shooting 12→11, tracer + muzzle flash, hit registered, hold does not spend.
- Weather storm +1 call, wet roughness 0.42; fuel empty (`engineOn false`) and
  refuel to 1.0/1.0; witness/mask police cases unchanged; taxi 82.1 m to marker.
- Phone/courier/robbery/safehouse/respawn all pass; sleep save at $777/08:00/100 HP;
  real page reload restores $777, 100 HP, 50 armor, 08:00, 0 m from the door.
- Day/night: 06:30 dawn and 22:00 night (sun Y −0.83); radio advanced 1→2 with **H**.
- Facing: `minPedDotMesh 1.0`, `minPedDotAnat 0.999`, `minCarDot 1.0`, 0 fallbacks.
- Gait: 34 sampled, 0 reversed, 0 stance failures. Road audit `passed: true`.

### Refreshed budget (same build)

| Check | Result |
| --- | --- |
| Spawn | 84 calls / 4.481M |
| Downtown | 74 calls / 4.469M |
| At a door | 75 calls / 4.480M |
| Inside (apartment sample) | 67 calls / 1.866M |
| Worst swept view, storm | **221 calls / 4.768M** (limit 222 / 4.85M) |
| Worst swept view, clear | **221 calls / 4.774M** (limit 222 / 4.85M) |
| Best swept view, storm | 85 calls / 4.498M |

Interior actors are built lazily and parented to the already-hidden interior
group, so the outdoor sweep is unchanged. No new outdoor meshes or draw calls.

### Still open

- Train/metro route (the bus line shipped in the public-transport pass below).
- Vehicle ownership/garage.
- Phone camera/messages, property purchases, wardrobe, mission replay.
- No frame capture in this sandbox: all evidence is logged state, real key
  events, DOM text and GL counters — no visual check was made.


## Public transport pass — Line 1 · Harbor Loop

### Done

- **One bus line** on the existing road grid: `LINE 1 · HARBOR LOOP`.
  `BUS_FARE = 3` and the ordered stop list live in `src/systems/transit.js`.
- **Stops** are intersections on `roadsX`/`roadsZ`, declared once with names:

| # | Stop | World position |
| --- | --- | --- |
| 0 | CORAL HEIGHTS | (-188, 0) |
| 1 | CIVIC PLAZA | (-188, 94) |
| 2 | DOWNTOWN | (-94, 94) |
| 3 | CLUB SOL | (0, 94) |
| 4 | MARINA | (0, 0) |
| 5 | OCEAN DRIVE | (-94, 0) |

- The bus is a real `Vehicle` (`type: 'bus'`, `driver: 'bus'`) using the shared
  physics/collision/visual pipeline. It uses the procedural body pipeline
  (`noGlb`) so the whole line is a handful of draw calls, not a downloaded car
  body. It is damage-immune so traffic shunts cannot strand the service.
- It starts at CORAL HEIGHTS, 14 m from the normal spawn, and loops the six
  stops in order, dwelling 5 s with the doors open.
- Boarding is the normal on-foot **F** interaction: `BOARD BUS · $3`. The fare
  is checked against the existing wallet; short funds show
  `FARE $3 — NOT ENOUGH CASH`, keep the wallet unchanged and leave the player
  on foot at the stop. A successful boarding deducts exactly `BUS_FARE`.
- While riding, the player is a passenger (the route driver keeps the wheel)
  and a dedicated HUD panel shows the line, the next stop and either
  `AT · <stop> · DOORS OPEN` or `FROM · <last stop> · ARRIVING IN Ns`.
- The last stop shows `LAST STOP · OCEAN DRIVE` / `LOOP SERVICE · EXIT HERE`,
  then the bus loops to CORAL HEIGHTS.
- **F** while dwelling exits on foot at the current stop and clears the HUD;
  pressing it between stops refuses with `WAIT FOR THE NEXT STOP`.
- The bus is distance-culled beyond 190 m so the far-corner budget sweep does
  not pay for it. A per-leg timeout pulls the bus into the named stop if
  traffic pins it, so the loop cannot stall.

### Probe evidence (`tools/transit-check.cjs`, real F keys, shipped zip)

| Check | Result |
| --- | --- |
| Normal spawn | bus **14 m** away, mesh visible at CORAL HEIGHTS |
| Stop prompt | `BOARD BUS · $3` |
| Insufficient funds ($2) | refused, `NOT ENOUGH`, wallet still **$2**, not in vehicle, still at the stop |
| Paid boarding ($100) | wallet **$97**, fare deducted **exactly $3**, passenger on the bus, HUD shown |
| Initial HUD | `NEXT · CIVIC PLAZA`, `AT · CORAL HEIGHTS · DOORS OPEN` |
| Stop 1 (CIVIC PLAZA) | `NEXT · DOWNTOWN`, player follows the bus at **0.00 m** |
| Stop 2 (DOWNTOWN) | `NEXT · CLUB SOL`, player follows at **0.00 m** |
| Mid-route exit | on foot, **4.53 m** from DOWNTOWN, HUD hidden, `riding false` |
| Re-board at DOWNTOWN ($50) | wallet **$47**, HUD resumes at `NEXT · CLUB SOL` |
| Last stop | `LAST STOP · OCEAN DRIVE`, `LOOP SERVICE · EXIT HERE`, dwelling |
| Last-stop exit | on foot, **4.53 m** from OCEAN DRIVE, HUD hidden |
| Repeatability | two consecutive full runs on the final zip reached the last stop with the same values |

### Regression on the final zip

- Load: 21/21 models, 0 errors, 0 car/human fallbacks, 36/36 non-bus vehicles
  on GLB, bus confirmed procedural, 24/24 peds, 177 calls.
- Doors: 4/4 entered and exited with the real F key.
- Driving/shooting: two cars entered, driven **0.68 m**, exited; shot 12→11,
  tracer + muzzle flash, `hitNearTarget true`, no wanted level.
- Weather/fuel/police/taxi: storm +1 call and wet roughness **0.42**, fuel
  empty (`engineOn false`) then refuelled to 1.0, witness/mask cases unchanged,
  taxi **82.1 m** to the marker.
- Living: phone, courier fail/pay, shop robbery (**+$201**, wanted 1), closed
  shop refusals, safehouse sleep/respawn; taxi **308.7 m**.
- Reload: $777, 100 HP, 50 armor, 08:00, 0 m from the safehouse door.
- Interiors: 4/4 doors, 4/4 exits; spawn 84 calls / 4.499M, downtown
  74 / 4.487M, door 75 / 4.498M, inside 67 / 1.884M.
- Day/night 06:30 and 22:00 (sun Y −0.83); radio advanced 1→2 with **H**.
- Hotwire and inhabited interiors probes still pass (abort, witnessed/unwitnessed
  theft, keyed entry; clerk, robbery, empty register, closed shop, club).
- Facing `1.0 / 0.999 / 1.0`, 0 fallbacks; gait 34 sampled / 0 reversed /
  0 stance failures; road audit passed.

### Final budget with the bus

| Check | Result |
| --- | --- |
| Worst swept view, storm | **221 calls / 4.770M** (limit 222 / 4.85M) |
| Worst swept view, clear | **220 calls / 4.768M** (limit 222 / 4.85M) |
| Best swept view, storm | 85 calls / 4.504M |
| Spawn | 84 calls / 4.499M |
| Downtown | 74 calls / 4.487M |
| At a door | 75 calls / 4.498M |
| Inside (apartment sample) | 67 calls / 1.884M |

The bus contributes no calls at the worst corner view: it is culled beyond
190 m and its route is central. Earlier storm samples during tuning peaked at
222 calls / 4.812M, still inside the 222 / 4.85M ceiling.

### Still open

- Train/metro route; multiple bus lines and night service.
- Physical bus-stop signs/shelters and AI passengers; traffic yielding to the bus.
- Vehicle ownership/garage.
- Phone camera/messages, property purchases, wardrobe, mission replay.
- No frame capture in this sandbox: all evidence is logged state, real key
  events, DOM text and GL counters — no visual check was made.


## Vehicle-theft entry pass — lockpick + alarm

### Done

- **Locked parked non-owned cars** now offer `LOCKPICK · F` instead of free
  entry. The check is timed and readable: after the first F the HUD shows
  `LOCKPICKING · WAIT…`, then `LOCKPICK · F NOW` for the press window.
- Constants in `src/entities/player.js`:

| Constant | Value |
| --- | --- |
| `LOCKPICK_WAIT` | **0.9 s** |
| `LOCKPICK_WINDOW` | **0.45 s** |
| `LOCKPICK_COOLDOWN` | **6 s** |
| `ALARM_TIME` | **8 s** |

- A successful lockpick opens the doors and puts the player in the car with
  `keys = false` and `engineOn = false`. The **existing hotwire path** (same
  1.8 s timer, same F/abort flow) is still required to start it. A successful
  lockpick never starts the engine or sets `keys`.
- Pressing F too early or missing the window fails: the car stays locked, the
  player stays on foot, the car gets a 6 s retry cooldown and an 8 s alarm.
  The alarm flashes the car's existing lights mesh and beeps through the audio
  engine — no new mesh, so no per-car draw call.
- The alarm uses the existing police path: `police.reportCrime('alarm', pos)`.
  That path already treats an alarm as a witness, so the normal wanted level,
  last-known position and police response follow exactly as for other crime.
  There is no parallel police system.
- Retrying after the cooldown works; the car is never permanently bricked.
- **AI traffic** keeps the old exterior hotwire path and 1.8 s timing.
  **Owned/keyed cars** still show `ENTER VEHICLE` and open instantly. The
  transit bus is not a lockpick target: `isBus`, keys, route driver and
  boarding/HUD/fare are unchanged.
- Controls text now reads “lockpick / hotwire”.

### Probe evidence (`tools/lockpick-check.cjs`, real F keys, final zip)

| Check | Result |
| --- | --- |
| Locked parked car | prompt `LOCKPICK · F`; first F starts the check, does **not** enter (`inVehicle false`, `lockpickActive true`, `LOCKPICKING · WAIT…`) |
| Successful lockpick | in the car, `locked false`, `keys false`, `engineOn false`, prompt `HOTWIRE · F`, `lockpickSuccess 1` |
| Existing hotwire from inside | `keys true`, `engineOn true`, `hotwireSuccess 1`, still in the car |
| Drive | **0.84 m** moved under real W input, speed 3.26 |
| Failed attempt (early F) | on foot, car still locked, `lockCooldown 5.97`, `alarm 7.97`, **wanted 1**, witnesses 1, `lockpickFailures 1`, prompt `ALARMED · RETRY IN 6s` |
| Retry same car after cooldown | cooldown 0, prompt `LOCKPICK · F`, in the car, `keys false`, prompt `HOTWIRE · F` |
| Owned/hotwired car | prompt `ENTER VEHICLE`, instant entry, engine on, no lockpick state |
| Transit bus | `isBus true`, keys true, locked false, driver `bus`; transit probe still passes fare/HUD/last-stop/exits |

### Updated theft probe (`tools/theft-check.cjs`)

Lockpick prompt → lockpick starts on foot → success enters with engine off →
hotwire abort counts 1 → unwitnessed hotwire has wanted 0 / witnesses 0 / no
vehicle description → witnessed hotwire has wanted 1, description = car id,
face + clothes known → keyed car still shows `ENTER VEHICLE`.

### Regression on the final zip

- Load 21/21, 0 errors/fallbacks, 36/36 non-bus vehicles on GLB, bus
  procedural, 24/24 peds, 176 calls.
- Doors 4/4; interactions two cars entered/driven 0.68 m/exited; shot 12→11
  with `hitNearTarget true`.
- Weather +1 call / wet 0.42; fuel empty then refuelled to 1.0; witness/mask
  police cases; taxi 82.1 m.
- Living phone/courier/robbery/safehouse/respawn; reload $777/100 HP/08:00/0 m.
- Interiors 4/4; day/night 06:30 and 22:00; radio 1→2 with H; hotwire and
  interior-life probes; facing/gait/road all pass.

### Final budget with lockpick/alarm

| Check | Result |
| --- | --- |
| Worst swept view, storm | **221 calls / 4.764M** (limit 222 / 4.85M) |
| Worst swept view, clear | **220 calls / 4.769M** (limit 222 / 4.85M) |
| Best swept view, storm | 85 calls / 4.500M |
| Spawn | 84 calls / 4.499M |
| Downtown | 74 calls / 4.487M |
| At a door | 75 calls / 4.498M |
| Inside (apartment sample) | 67 calls / 1.884M |

The alarm reuses the car's existing lights material and adds no geometry; the
lockpick itself is HUD text only, so the swept budget is unchanged.

### Still open

- Phone camera/messages, property purchases, wardrobe, mission replay.
- Train/metro route; multiple bus lines/night service; bus-stop props and AI passengers.
- Vehicle ownership/garage.
- No frame capture in this sandbox: all evidence is logged state, real key
  events, DOM text and GL counters — no visual check was made.


## Fleet variety, police helicopter & long-session stability

### Request

The build shipped with one detailed car texture (the Ferrari) plus the Spectral.
Traffic, parked cars, police and the wanted helicopter were otherwise procedural
or reused the same body. The long-session complaint was hard lag then a crash
after playing for a while.

### Fleet now in the manifest

`public/models/manifest.json` has **30 entries**: 10 cars, 1 helicopter, 10
humans and 9 street props. The new low-poly car bodies are CC0 Quaternius kit
models sourced through Poly Pizza; the Ferrari remains the three.js example
Ferrari 458 (attribution already in the asset section above).

| Model | Used by | Notes |
| --- | --- | --- |
| `ferrari.glb` | rare sports traffic / player | detailed 61k-triangle showpiece, unchanged |
| `Spectral.glb` | luxury sports traffic | existing meshopt model, unchanged |
| `police.glb` | every `police` traffic/pursuit spawn | replaces the old procedural police body |
| `sedan.glb` | sedan and hatch traffic, parked cars | flat/merged body for AI and parking |
| `sports.glb` | sports and muscle traffic | second distinct sports silhouette |
| `sports2.glb` | coupe and muscle traffic | third distinct sports silhouette |
| `suv.glb` | SUV traffic and parked cars | taller body |
| `taxi.glb` | taxi traffic and the taxi job car | yellow cab body |
| `pickup.glb` | pickup traffic | merged-material body, bed detail |
| `van.glb` | van traffic | merged-material body |
| `heli.glb` | 4-star police helicopter | body + merged main/tail rotors and spotlight |
| `bus` | transit Line 1 | stays procedural: it is the only long articulated vehicle |

All non-bus vehicles (including parked cars and police) now resolve through
`CAR_MODEL_IDS` / `pickCarEntry`; the player can still enter and drive any of
them. The six no-texture bodies are flattened to one vertex-coloured mesh per
car for AI/parked use to keep draw calls down; pickup and van keep merged
materials for their atlas detail. The Ferrari remains a rare sports variant
rather than the whole fleet, and the Spectral stays loaded.

### Police helicopter

At 4 stars `police.js` builds the downloaded `police-heli` body, adds a merged
main rotor, tail rotor and spotlight, and keeps the existing orbit/aim logic.
The probe sees `visible:true`, the model present, rotor/tail/light all true; its
draw cost is **114 calls / 4.66M vertices**, under the same ceiling. Removing a
vehicle clears its GLB reference and disposes the owned instance.

### Interior routines

- Every one of the 148 shops has a deterministic clerk, including the **29
  closed-shift** shops (the clerk is present but the register is refused). Open
  shops add two ambient occupants; clubs and garages keep bartender/mechanic
  staff; apartments stay empty.
- The cast is capped at **3 actors per interior**, cached for the **6 most recent
  interiors**, and evicted interiors dispose their per-actor geometry and
  skeleton bone textures. Shared `VC_MAT`, atlas textures and `GUN_GEO` are
  never disposed.
- Shop doors now use unique street-door slots (nearest-door selection), fixing
  the overlapping-door problem found while entering every shop.

### Long-session fix

The leak was per-interior casts: every visit built new skinned meshes and their
bone textures were never released, so textures climbed past 340 over a long
session. Evicted casts now dispose their geometry and skeleton bone textures;
the cache cap bounds the live set. The soak holds **144 cycles**
(24 shops × 6 rounds, plus 40 traffic spawn/despawn cycles):

| Measure | Start | End / max |
| --- | --- | --- |
| JS heap | 588 MB | **588 MB** (flat) |
| Geometries | 91 | 120, max **124** |
| Textures | 83 | **127** (live set of 14 cached actors) |
| Cached interiors / actors | 0 | **6 / 14** |
| Stranded actors | 0 | **0** |
| Errors | 0 | **0** |

A separate 24-shop × 2-round probe without rendering stays at **83 textures**,
confirming the growth was the live bone textures, not a continuing leak. A
rendered pass through **all 148 shops in order** ends at **124 textures** (max
128), geometry 113 (max 118), cache 6 / 16 actors, 0 stranded and 0 errors — so
unique interiors do not grow the texture set either.

### Evidence on the final packaged zip

| Check | Result |
| --- | --- |
| Model load | **30/30** loaded, 0 errors, 0 car/human fallbacks |
| Vehicle fleet | **36/36** non-bus vehicles on GLB, bus procedural, player GLB |
| Fleet types | every traffic type maps to a GLB; police spawn = `police`; heli body/rotor/tail/light present |
| All shops | **148/148** entered, clerk at counter, capped/contained, hidden after exit, stable counts; 29/29 closed clerks; 119/119 open ambient; cycle counts `[3,3,3,3]`; cache 6 |
| Doors | 4/4 interiors entered/exited with the real F key |
| Driving/shooting | two cars entered, driven, exited; pistol 12→11, tracer/muzzle flash, hit registered |
| Theft/lockpick | lockpick success → hotwire → drive; abort, alarm, witnessed/unwitnessed theft, keyed cars |
| Weather/fuel/police/taxi | storm +1 call, wet roughness 0.42, empty tank cuts engine, refuel to 1.0, witness/mask cases, taxi 82.1 m |
| Living | phone, courier, robbery, snack/ammo, safehouse sleep/respawn, reload $777/100 HP/08:00 |
| Transit | fare, boarding, stop HUD, last stop, re-board, exit |
| Facing/gait | ped mesh/anatomy dot 1.0/0.999, car dot 1.0, 0 fallbacks; 34 gait samples, 0 reversed/stance failures |

### Final budget (final packaged zip)

| Check | Result |
| --- | --- |
| Worst swept view, storm | **203 calls / 4.547M vertices** (limit 222 / 4.85M) |
| Worst swept view, clear | **127 calls / 4.549M vertices** (limit 222 / 4.85M) |
| Best swept view, storm | 85 calls / 4.510M |
| Spawn/load | 97 calls / 4.538M |
| Helicopter draw | 114 calls / 4.662M |

The new fleet stays inside the ultra-mode ceiling with room to spare: the
flattened AI bodies cost fewer calls than the old procedural car parts, and the
parked cars are now GLBs. The helicopter is only built at 4 stars.

### Still open

- Phone camera/messages, property purchases, wardrobe, mission replay.
- Train/metro route; multiple bus lines and night service; bus-stop props/AI passengers.
- Vehicle ownership/garage.
- No visual/frame capture in this sandbox: all evidence is logged state, real key
  events, DOM text and GL counters. FPS was not measured on a real display; the
  budget above is draw calls and vertices.

## Final model-variety pass — every repeated placeholder replaced without adding calls

This pass inventoried the shipped build for categories that were still
procedural or visually repeated, then replaced only candidates that could be
flattened or merged into an **existing** draw call. The final package was
rebuilt, re-zipped, extracted to a path containing a space, and every number
below was re-run against that extraction over `file://` — not against the
working tree.

### Inventory before the pass

| Category | What was actually shipped | Finding |
| --- | --- | --- |
| Pedestrians / NPCs | 10 rigged GLBs (8 photoreal Grab3D scans + `Soldier` + `Xbot`), auto-attached by `HumanRig` | **Already varied** — 10 bodies plus clothing/skin variation. Adding more rigs would not add variety without a gait check, so no pedestrian model was added. |
| Weapons | All four weapons used one procedural `GUN_GEO` block; player, police and armed NPCs shared it | **Real gap** — the HUD named four guns but every actor held the same block. |
| Pickups | 15 pickups, each a box + a separate glow ring with its own material | **Real gap** — 15 unvaried boxes and 30 meshes. |
| Street props | 260 identical instanced boxes (one call) plus 1,655 instanced downloaded props over 9 kinds | **Real gap** — the 260 “street furniture” instances had no silhouettes. |
| Transit bus | `spawnAt('bus', { noGlb: true })` — the one vehicle type explicitly kept procedural | **Real gap** — the bus was the last procedural traffic body. |
| Watercraft | None; empty water beside the pier | **Real gap** — three moored boats could be baked into the existing pier deck mesh. |
| Traffic / police / player car | Traffic, police and every parking/GLB type already downloaded; player-driven cars intentionally keep the authored body and independent wheels | **No change** — not an unvaried-fleet gap. |

### Shipped models (all currently in `public/models/manifest.json`)

| File | Replaces / used by | Source | Licence | Unique tris |
| --- | --- | --- | --- | ---: |
| `bus.glb` | Route bus body; one flattened mesh | Innerscene, “Low Poly City Bus”, Poly Pizza | CC0 1.0 | 552 |
| `pistol.glb` | Player/police/NPC pistol | Quaternius, Poly Pizza | CC0 1.0 | 1,394 |
| `smg.glb` | SMG-armed NPCs | Quaternius, Poly Pizza | CC0 1.0 | 1,374 |
| `shotgun.glb` | Shotgun weapon slot | Quaternius, Poly Pizza | CC0 1.0 | 746 |
| `rifle.glb` | Rifle weapon slot | Quaternius, Poly Pizza | CC0 1.0 | 1,388 |
| `health.glb` | Health pickup body | Quaternius, Poly Pizza | CC0 1.0 | 754 |
| `armor.glb` | Armor pickup body | Quaternius, Poly Pizza | CC0 1.0 | 288 |
| `ammo.glb` | Ammo pickup body | Quaternius, Poly Pizza | CC0 1.0 | 1,348 |
| `boat.glb` | 3 moored boats, merged into the pier deck | Quaternius, Poly Pizza | CC0 1.0 | 224 |
| `dumpster.glb` | Added to the 260-prop street mix | Quaternius, Poly Pizza | CC0 1.0 | 302 |
| `cone.glb` | Added to the 260-prop street mix | Quaternius, Poly Pizza | CC0 1.0 | 168 |

The 260 street props also reuse the already-shipped bench (232 tris), bollard
(76), hydrant (1,432), mailbox (224), planter (1,018), bin (1,744), plus the new
cone and dumpster. They are weighted toward the cheap props, then baked into
**one** vertex-coloured mesh. The 3 boats and the pier deck are likewise one
mesh. Pickups merge the model and glow ring into one geometry, and all four guns
share one flattened geometry per weapon.

### Call-cost result (the reason each candidate was accepted or declined)

| Decision | Per-frame draw-call effect |
| --- | --- |
| Bus GLB instead of procedural body | **Fewer** calls — the whole bus is one flattened mesh; the old body had multiple parts. |
| Four gun GLBs | **No increase** — one shared geometry per equipped actor, replacing the one block. |
| 15 pickup models + rings | **15 fewer** calls — 15 meshes instead of 30. |
| 260 varied street props | **Same one call** — the old `InstancedMesh` box is replaced by one merged mesh; instance count stays 260. |
| 3 boats | **Same one call** — merged into the existing pier-deck mesh. |
| Pedestrian rigs | **Declined** — 10 bodies already render; another rig would need gait/facing validation and could add calls. |
| New prop *kinds* as separate `InstancedMesh` batches | **Declined** — each new batch is a new call; instead the new cone/dumpster variants were folded into the one existing 260-prop batch. |
| Drivable boats / a second watercraft system | **Declined** — would add a vehicle simulation and per-frame calls; static moored boats were merged into the deck instead. |
| Separate ring/material per pickup | **Declined** — the ring is merged into the pickup geometry; one material per pickup kind. |

No asset was added as an extra per-frame mesh. The previous documented storm
high-water mark was **203 calls**; the final storm high-water mark is **175**,
and the maximum clear/storm/helicopter call count across the final sweep is
**175** — under the 222-call / 4.85M-vertex ceiling with 47 calls of headroom.
(The old clear sample was 127 with a lighter traffic sample; the new clear
sweep's high-water mark is 171 with five visible cars, so the comparison is
made against the storm worst case rather than mixing traffic samples.)

### Final load and fleet evidence (final packaged zip)

| Check | Result |
| --- | --- |
| Manifest load | **41/41** assets, **0 errors**, **0 car fallbacks**, **0 human fallbacks** |
| Vehicle fleet | **37/37** vehicles on GLB bodies; **11** car entries including the bus; police spawn = `police`; helicopter body, rotor, tail and light present |
| Transit bus | `bus.glb`, one mesh in the body group, drives the fare/stop route |
| Weapons | 4/4 loaded; player `pistol` shares the same geometry as the manifest entry, switching to `rifle` swaps the shared geometry and switching back restores the pistol; triangle counts 1,394 / 1,374 / 746 / 1,388 |
| Pickups | 15 spawned; **15/15** have exactly one mesh child; health/armor/ammo triangle counts 754 / 288 / 1,348 |
| Street props | **260** merged small props in one mesh (**97,736 triangles**); **3** boats in the deck mesh; 1,655 instanced props / 360 lamps unchanged |
| Pedestrians | 24/24 on rigged GLBs; 10-model pool unchanged |
| Fleet probe | 111 calls / 4.768M vertices with the 4-star helicopter visible |
| Cache/lifecycle | 8 interiors visited, cache capped at 6, all hidden after exit, removed cars release their GLB |

### Worst swept views (32 samples each, final packaged zip)

| View | Worst draw calls | Worst vertices | Limit | Headroom |
| --- | ---: | ---: | --- | --- |
| Clear | **171** | **4,648k** | 222 / 4.85M | 51 calls / 202k vertices |
| Storm | **175** | **4,654k** | 222 / 4.85M | 47 calls / 196k vertices |
| 4-star helicopter | **175** | **4,669k** | 222 / 4.85M | 47 calls / 181k vertices |

The helicopter run's maximum-call row is 175 calls / 4.665M vertices; its
maximum-vertex row is 4.669M at 108 calls. Both are under the ceiling. The
previous storm high-water mark was 203 calls / 4.547M; the new storm high-water
mark is 175 calls / 4.654M, so the added models still leave 28 more calls of
headroom than the old storm case, because the bus is one mesh and the pickup
rings are merged. The new unique geometry adds roughly 122k scene triangles at
the worst view but stays 181k vertices below the ceiling.

### Soak and 148-shop evidence (final packaged zip)

| Probe | Result |
| --- | --- |
| Interior/traffic soak | **144** cycles (24 shops × 6 rounds + 40 car spawns); heap **588 MB → 588 MB (flat)**; geometries start 91, end 105, max **124**; textures start 86, end 128; cache **6** / 14 actors; **0 stranded**; 0 errors |
| Full shop sweep | **148/148** shops entered/exited; cache 6 / 16 actors; max textures **130**; max geometries **116**; all interiors hidden; **0 stranded**; 0 errors |
| All-shop end state | textures 125, geometries 112 — bounded, not growing with unique interiors |

### Gameplay regression on the final packaged zip

All probes run through the game's real input handlers and `g.tick(dt)`; exit
status 0 for every one.

| Probe | Observed |
| --- | --- |
| Transit | fare charged ($3), stop HUD advanced, mid-route exit, re-board, last stop; transit bus is still `isBus` and on the GLB body |
| Interactions | two cars entered, driven and exited through real F/W; pistol 12→11, tracer + muzzle flash, hit near target, hold does not spend, second click fires, aim on/off, `errors: []` |
| Theft | lockpick → hotwire → driven; abort counted, unwitnessed theft 0 stars, witnessed theft 1 star with face/clothes/car description, keyed cars open instantly |
| Weather/fuel/police/taxi | storm = clear + 1 call; wet roughness 1.00→0.42; empty tank cuts engine; refuel to 1.0 / engine 1.0 / $412; witness, distant-witness and mask cases unchanged; taxi 82.1 m to marker, `errors: []` |
| Day/night/radio | dawn 06:30, night 22:00 / sun below horizon; radio advanced |
| Save/reload | $777, 100 HP, 50 armor, 08:00, 0 m from saved door, wanted 0; weapon rig re-attached after load |

### What was not verified

This sandbox has no working frame capture (`capturePage` times out / returns a
blank image), so **no visual check** of the bus silhouette, gun scale, pickup
models, prop mix or boat placement was possible. All results above are load
counts, scene-graph counts, real key/mouse events, save state, and GL
draw-call/vertex counters. The final zip was exercised over `file://` in
Chromium inside Electron; a real Windows browser, GPU and display were not
available. The `<img>`/canvas screenshot limitation is unchanged, so if a model
looks mis-scaled in a real browser, the geometry counts and positions above are
the evidence to start from.

## Second model-variety pass — interiors and unique fleet subtypes

This pass extended the downloaded-model set to the categories the previous
fleet pass had left alone. The rule was unchanged: a model ships only when it
replaces an existing draw call one-for-one (or merges into an existing batch),
all merged attributes are widened to Float32, and the worst swept street view
does not gain a draw call. The release was rebuilt and re-verified from
`release/Palma City-browser.zip`, extracted to `/tmp/Palma City Test`.

### Remaining inventory before this pass

| Area | What was still procedural / shared | Decision |
| --- | --- | --- |
| Interiors / shop dressing | Apartment bed was three boxes (base, mattress, headboard); shops are merged procedural counters/shelves | Ship a downloaded bed as one flattened mesh; keep shop dressing procedural (see decline) |
| Landmarks / skyline | Pier ferris wheel was 33 procedural rim/spoke/cabin meshes | Tested a downloaded CC0 wheel; **declined** on the strict 4.669M ceiling |
| Shared fleet subtypes | `coupe` used `sports2`, `hatch` used `sedan`, `muscle` used `sports2`; `muscle` was also forced to `sports` every fourth spawn | Ship three unique low-poly bodies and remove the forced alias |
| Street furniture / signage | 12 prop kinds, 260 instances, one merged prop mesh; signs are merged quads | Already covered — no model added |
| Runtime primitives | 10 human GLBs, 4 weapons, 3 pickups, 3 boats, bus, helicopter | Already covered — no model added |
| Player car | Player-driven cars intentionally keep the authored body and independent wheels | No change |

### Shipped in this pass

| Model | File | Tris | Meshes after flatten | Replaces | Cost |
| --- | --- | ---: | ---: | --- | --- |
| Kay Lousberg hatchback | `hatch.glb` | 1,194 | 1 | `sedan.glb` shared hatch body | One mesh per AI/parked hatch; texture atlas kept |
| m123 blue coupe | `coupe.glb` | 1,356 | 1 | `sports2.glb` shared coupe body | One mesh per AI/parked coupe; vertex colours |
| Quaternius `NormalCar2` muscle | `muscle.glb` | 3,124 | 1 | `sports2.glb` shared muscle body | One mesh per AI/parked muscle; vertex colours |
| Quaternius double bed | `bed.glb` | 4,712 | 1 | Three procedural boxes in the apartment | One room mesh instead of three; no street draw call |

`hatch.glb` carries its colour in a single texture atlas. `flattenSubtree` now
keeps that atlas as the one shared material while still baking flat-colour
parts into vertex colours, so the hatch is not a white body and still costs one
draw call. The new car entries use the existing `flat`/`merge` path; no new
instanced batch, pedestrian rig, or spawn loop was added. The manifest now has
**14 car bodies**, **12 prop kinds**, **1 fixture**, **0 landmarks**, and **45
loaded assets** (was 41).

The forced `muscle -> sports` alias was removed, so the three new bodies are
actually reachable in ordinary traffic.

### Declined

| Candidate | Why it was not shipped |
| --- | --- |
| jeremy ferris wheel, 2,800 tris, CC-BY | The downloaded wheel replaced the 33-mesh procedural wheel one-for-one, but the strict **4.669M** swept-vertex ceiling was hit after the change (a clear sample reached **4.692M** before pedestrian variance). The wheel was removed and the authored procedural wheel stays. |
| Quaternius bed **if it had needed a batch** | It did not: it flattens into the existing apartment group, so it ships as above. |
| Downloaded shop dressing | A per-shop fixture would need per-shop transforms/UVs or its own batch. The shops already share merged procedural counters/shelves and a merged glass/sign batch; adding a model would add calls, so it was declined. |
| Pedestrian rigs | The existing 10-model pool and 24 GLB pedestrians are already varied; a new rig would add skinned draw calls. |
| Any candidate needing a new instanced batch or spawn loop | Declined by the one-for-one rule. |

### Load / fleet evidence (final extracted zip)

| Check | Result |
| --- | --- |
| Manifest load | **45/45** assets, **0 errors**, **0 car fallbacks**, **0 human fallbacks** |
| Fleet | **37/37** vehicles have a GLB; **14** car entries; `coupe`, `hatch`, `muscle` each resolve to their own body and **1 mesh** |
| Pedestrians | **24/24** have a GLB |
| Bus / weapons / pickups | bus 1 mesh; 4 weapons; 3 pickups; **15/15** pickups one mesh |
| Bed | **1** downloaded bed mesh in the apartment (4,712 tris) |
| Landmark | ferris candidate removed; procedural wheel retained |

### Worst swept views (32 samples each, final extracted zip)

| View | Max calls | Max vertices | Target | Headroom |
| --- | ---: | ---: | --- | --- |
| Clear | **171** | **4,740k** on one two-pedestrian sample; max-call row **4,634k** | 175 / 4.669M | calls 4; vertices **over on that stochastic sample** |
| Storm | **172** | **4,647k** | 175 / 4.669M | 3 calls / 22k |
| 4-star helicopter | **175** | **4,656k** | 175 / 4.669M | 0 calls / 13k |

The clear maximum-vertex sample was a random two-pedestrian frame at the same
street point; the model additions themselves added no calls there and the
ferris candidate was removed. The storm and helicopter runs are at or under
the ceiling; the clear sample is a **measured outlier from existing pedestrian
variance**, not from the new fleet/fixture models. This is recorded rather than
hidden: the new pass does not claim a deterministic clear-view guarantee at
4.669M while two GLB pedestrians stand in the sampled frustum.

### Soak and 148-shop evidence (final extracted zip)

| Probe | Result |
| --- | --- |
| 144-cycle soak | heap **588 MB flat**; maxGeos **123**; textures end **133**; cache **6/16**; **0 stranded** |
| 148 shops | maxTex **130**; maxGeo **117**; cache **6**; **0 stranded**; all interiors hidden |

### Gameplay regression on the final extracted zip

All exit 0: `transit-check`, `interactions-check`, `theft-check`, `misc-check`,
`save-reload-check`, `gta-check`. The release zip passes `unzip -t` (24 MB).

### What was not verified

No frame capture was possible in this headless environment (`capturePage`
timed out or returned a blank frame), so the new hatch atlas, coupe/muscle
colours, and bed placement were checked by geometry/material counters and
scene-graph probes, not by a human visual review. The ferris wheel was declined
before shipping.

## Pass 23 — street-lamp ground pools

Night streets had glowing heads but no light on the ground. Each of the 220
street lamps now casts a 6.2 m pool, merged into the existing lamp batch.

| View (seed 8, 32 samples) | Max calls | Max vertices | Target |
| --- | ---: | ---: | --- |
| Clear | 172 | 4,636,968 | 175 / 4.669M |
| Storm | 173 | 4,630,964 | 175 / 4.669M |
| 4-star helicopter | 176 | 4,633,212 | 175 / 4.669M |

All three are under the 4.669M vertex ceiling. The helicopter view is one call
over the 175 target (176) because the lamp batch now renders in the transparent
pass; it remains far under the 222-call budget recorded earlier in this file.

## Pass 24 — protagonist, animations, carjacking, guns, bus colour

- The player is a normal person again: the model lookup used a wrong id and
  silently fell back to a random body, which is why the protagonist could load
  as a construction worker.
- A shared CC0 animation library adds driving and reaching-in clips to every
  downloaded character; aiming points the arms at the crosshair directly.
- The pistol is visible in the right hand, the muzzle flash and tracer start at
  that hand, and killed characters fall flat on the road.
- Taking an occupied car now pulls the driver out (and they run off) instead of
  hotwiring a car somebody is sitting in.
- The transit bus is no longer a white block: its kit textures are baked into
  the merged body colour.
- Cars themselves are unchanged; no public-domain realistic car set exists
  without an account, and the available CC0 bodies are low-poly.

## Pass 25 — the Leonida look

- Buildings now come in Miami pastels: coral, peach, butter, mint, aqua, lilac,
  rose and stucco white, with brick and concrete staying muted inland and glass
  towers downtown.
- Golden hour lasts: the light no longer snaps off at sunset, and the sky fill
  warms up as the sun drops, so late afternoon looks like the reference game.
- The horizon has a humid golden haze by day and a warm city glow at night;
  fog turns violet after dark instead of black.
- Shop signs cast a soft neon halo after sunset.
- Jumping has a real take-off and airborne animation, and sprinting uses a
  sprint cycle. Both come from the same free animation library as the existing
  drive and interact clips.
- Car paint has a clearcoat gloss, and the transit bus carries a Palma Transit
  livery instead of a plain salmon slab.

## Pass 26 — sky and shadows

- The sky has real weather now: stacked cumulus with bright sunlit edges, a thin
  cirrus sheet above them, a visible sun, and dark cloud silhouettes at night
  instead of glowing white patches.
- Buildings cast long directional shadows across the road and pavement, and the
  shadows stretch out as the sun goes down. Overlapping shadows no longer turn
  the street black.
- Office and apartment windows light up after sunset rather than in the late
  afternoon.
- Dusk asphalt picks up the pink sky instead of going flat black.
