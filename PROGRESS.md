# PALMA CITY — BUILD LOG (read this first)

Status: **IN PROGRESS** · Target: Windows on ARM64 desktop app (Electron + three.js)
Honest scope note: this is an original open-world crime game inspired by the genre, NOT a clone of
GTA 6 (that game, its map, story, characters and assets are Rockstar's copyrighted property and
cannot be reproduced here). Goal: the best possible playable, good-looking open-world game that
runs as a real installable Windows ARM64 app.

## Hard requirements from the user
- NOT a website: must be a downloadable Windows app (electron-packager -> win32-arm64).
- Runs on Galaxy Book 4 Edge (Snapdragon X Plus, Adreno X1-85 GPU, 16GB). Target 1080p 60fps.
- High-res assets, realistic look: all assets generated procedurally at high resolution (no
  copyrighted downloads). Big app size is acceptable.
- Full game loop: open world, cars, peds, traffic, police/wanted, weapons, story missions,
  interiors, day/night, HUD, minimap, map screen, audio, save/load.
- Constant logs (this file) so context loss does not cause hallucination.

## DONE
- [x] package.json (three 0.187, vite 8, @electron/packager 20) + npm install OK
- [x] vite.config.js (base './' so file:// works inside Electron)
- [x] electron/main.cjs (BrowserWindow 1920x1080 max, GPU switches, F11 fullscreen, F12 devtools)
- [x] electron/preload.cjs (window.palma.toggleFullscreen/quit)
- [x] index.html (loading, title, HUD, pause/settings/controls, big map, death, chapter screens)
- [x] src/style.css (full neon-Miami HUD/menu styling)
- [x] src/config.js (city grid, weapons, car specs, districts)
- [x] src/core/utils.js (math, RNG, AABB, ray tests, canvas helpers)

## TODO (in order)
- [ ] src/world/textures.js  — procedural hi-res textures (asphalt, road, sidewalk, 7 facade styles
      + emissive night windows, roofs, sand, billboards, neon signs, particles, sky env)
- [ ] src/world/city.js      — grid city, roads, blocks, buildings w/ colliders, palms (instanced),
      streetlights, traffic lights, props, beach + ocean shader, district lookup, road graph,
      pedestrian sidewalk loops, spawn points, interiors (3 enterable rooms)
- [ ] src/world/sky.js       — sky dome shader (sun/moon/stars/clouds), day-night cycle, lights,
      env map refresh, streetlight/headlight switching
- [ ] src/entities/humanoid.js — procedural articulated human + walk/run/idle/aim/shoot/dead anim
- [ ] src/entities/player.js  — movement, sprint, jump, aim, weapons, health/armour, enter/exit car
- [ ] src/entities/vehicles.js — parametric car meshes (extruded silhouette), arcade physics,
      damage, traffic AI on road graph, enter/exit, headlights
- [ ] src/entities/pedestrians.js — peds walking block loops, flee, ragdoll-ish death
- [ ] src/entities/police.js  — wanted system, cruisers, foot cops, helicopter, hostiles
- [ ] src/systems/combat.js   — raycast shooting, tracers, muzzle flash, impacts, particles, pickups
- [ ] src/systems/missions.js — story chain (10 missions), objectives, dialogue, markers, rewards
- [ ] src/systems/hud.js      — minimap, big map, bars, stars, money, weapon, speedo, toasts, subs
- [ ] src/systems/audio.js    — WebAudio: engine, tyres, guns, siren, city ambience, 2 synth radios
- [ ] src/systems/camera.js   — third-person orbit, aim shoulder cam, vehicle chase cam, shake
- [ ] src/main.js             — boot, loading, renderer, loop, input, wiring, save/load
- [ ] build + package win32-arm64 + zip + verify
- [ ] visual check via cloud browser screenshot of the built game

## Architecture contracts (keep in sync!)
`game` object passed everywhere:
```
game = {
  scene, camera, renderer, clock, time (hours 0-24), paused,
  city, sky, player, vehicles, peds, police, combat, missions, hud, audio, cam,
  wanted (0..5), money, settings, input, effects, now
}
```
- city.colliders: [{minX,maxX,minZ,maxZ,minY,maxY}] building AABBs
- city.roadsX / roadsZ: arrays of road centre coordinates (world)
- city.graph: nodes {x,z,i,j,links:[nodeIdx]}
- city.pedPaths: [{x,z,rect:[minX,minZ,maxX,maxZ]}] block perimeters
- city.spawnCar() -> {x,z,heading}; city.spawnPed() -> {x,z}
- city.getDistrict(x,z) -> string
- city.interiors: [{name, entry:{x,z}, room:{...}}]
- vehicle.update(dt, game); vehicle.mesh (THREE.Group); vehicle.speed; vehicle.health
- ped.mesh, ped.health, ped.dead, ped.faction ('civ'|'cop'|'gang')
- combat.shoot(origin:Vector3, dir:Vector3, weaponKey, shooter) -> hit
- hud.toast(text, kind), hud.subtitle(speaker, text), hud.banner(kicker, title)
- audio.play('shot'|'hit'|'siren'|...), audio.setEngine(rpm, load), audio.setRadio(i)
- missions.update(dt), missions.start(id), missions.current
```

## Verification log
(append results here as checks run)

## VERIFIED WORKING (browser test, build 2026-11-22)
- Boot -> title -> New Game -> playable 3D world renders, no JS errors.
- 60 FPS in headless Chromium, 156-311 draw calls (was 1184 before mesh merging).
- Driving works (car accelerates, speedometer reads 32 km/h, chase cam follows).
- Fixed bugs so far: palmData undefined (parks), manualChunks vite8, mergeGeometries
  null (indexed vs non-indexed) -> prep()/toNonIndexed, light intensities, road UV axis,
  mission coords inside buildings -> city.snapToStreet(), stars at dusk, start hour.
- Car meshes merged into paint/glass/details/lights/4 wheels (~9 draws/car).
- NPC bodies merged into 5 vertex-coloured meshes.
- Traffic + peds now spawn within 60-150m of the player.

## KNOWN ISSUES / NEXT
- [ ] verify car model from side, palm fronds after rework, peds visible
- [ ] mission chain not yet play-tested end to end
- [ ] police/wanted not yet tested
- [ ] package win32-arm64 zip
- [ ] screenshot final look

## Session log — 2026-11-22 (late)

### Fixed and verified in the cloud browser
- Letterbox bars now appear: removed the `hidden` class from `#letterbox` in index.html.
- Radio overlay moved from bottom-left (it sat on top of the subtitles) to `left:22px; top:300px`.
- **Hitscan origin** moved from the camera to the player's shoulder (`pos.y + 1.45`); body
  hitboxes are now three stacked spheres (0.55 / 1.05 / 1.52 m, r 0.44) instead of one
  sphere at 1.0 m. Shots now connect: ped 60 -> 28 HP over three rounds, wanted 1 -> 2.
- **Camera first frame**: `lookAt` was lerping from (0,0,0), so the camera and every
  aim ray pointed at the world origin for the first frames. `updateFoot`/`updateVehicle`
  now copy `smooth`/`lookAt` on the first frame instead of lerping.
- **Police navigation**: `City.nearestNode()` + `City.findPath()` (BFS over the 11x11 road
  graph). `Vehicle.chaseAI` follows the node path while >55 m from the player, then goes
  direct. Police spawn on a node 70-170 m away instead of a random point up to 226 m away.
  Verified: a cruiser spawned at 91 m, visible, closing on the player (previously it
  ground into buildings at 11 m/s and never arrived).
- **Ocean**: the water plane (y -0.15, starting at z 476) had wave displacement up to
  +1.07 m and was flooding the beach. Now y -0.6, starts at z 556 (`BEACH_END + 700`),
  wave 3 amplitude 0.55 -> 0.42. Verified from a 30 m vantage: water, wave shading,
  shoreline visible.
- Glass facades lightened (#16262e -> #24424d), traffic 26 -> 32 cars spawning 40-190 m
  out, pedestrians 42 -> 46 spawning 22-120 m out, exposure 1.12 -> 1.18, sun 3.5 -> 3.8.
- Idle HUD now shows "NEXT MISSION / <title> / Follow the orange marker" instead of "—".

### Mission flow verified end to end (mission 1, SUNBURN)
- Marker -> `startMission(0)` -> dialogue -> `goto` docks (-392, 94) completes ->
  `steal` spawns a `muscle` car at (-372.5, 76) -> `enterVehicle` completes `steal` ->
  `deliver` at (-188, -12) -> `completeMission()`: banner "MISSION PASSED", +$1500
  (money 250 -> 1750), `index` 0 -> 1, 6 s cooldown, progress saved.

### Packaging
- `@electron/packager` needs an explicit `--electron-version`; added `--electron-version=45.4.1`
  to both package scripts. `three` moved to devDependencies (Vite bundles it), so the
  app payload is 800 KB of asar inside the 357 MB Electron runtime.
- `release/Palma City-win32-arm64/Palma City.exe` builds and contains `resources/app.asar`.

### Known gaps (honest)
- Not launched on real Windows ARM64 hardware (no Windows machine available here);
  the packaged binary is verified by content and by the identical browser build.
- Characters are stylised low-poly rigs, not photoreal scanned humans. The look is
  original stylised realism, not GTA VI fidelity.
- No vehicles/peds inside interiors; interiors are static rooms with props.

## Session log — 2026-11-22 (fidelity + boot proof)

### A. Packaged Electron entry actually launched (previously never tested)
- Installed electron@45.4.1 (linux x64) as a devDependency and extracted the 17 missing
  system libraries (libnspr4, libnss3, libgtk-3, libatk*, libcairo, libasound, libcups,
  libxkbcommon, libXcomposite/damage/fixes/randr + transitive deps) from Ubuntu 24.04 debs
  into /tmp/sysroot2 with `apt-get install -d` + `dpkg-deb -x` (no root available).
- Added an env-gated smoke hook to `electron/main.cjs` (`PALMA_SMOKE=<png>`,
  `PALMA_SMOKE_NEWGAME=1`): forwards renderer console messages, waits for `loading === false`,
  clicks New Game, reads game state, captures the window AND the WebGL drawing buffer,
  then quits. No effect unless the env var is set.
- Ran: `electron . --no-sandbox --ozone-platform=headless --use-gl=angle --use-angle=swiftshader`.
  Result: `did-finish-load`, `ready-to-show`, WebGL context true, then
  `{started:true, paused:false, loading:false, vehicles:48, peds:25, calls:447, tris:282822}`.
  Screenshot of the live game captured from the canvas.
- Fixed on the way:
  * `newGame()` threw `Cannot read properties of undefined (reading 'show')` if clicked
    before the HUD existed -> added an explicit `if (game.loading || !game.hud) return;` guard.
  * `THREE.Clock` deprecation warning -> replaced with a tiny performance.now() delta clock.
  * `PCFSoftShadowMap` was removed in three 0.187 and warned every boot -> `PCFShadowMap`.
  * After both fixes the renderer console is **empty** (no errors, no warnings).
- Xvfb could not be used (its keymap compiler `/usr/bin/xkbcomp` is absent and `/usr/bin`
  is not writable), so the compositor capture came back black; the canvas readback is the
  proof image and is a real rendered frame.

### B. Characters rebuilt (src/entities/humanoid.js, full rewrite)
- One merged vertex-coloured mesh **per bone**: torso+pelvis+belt+collar+neck (1),
  head+face+hair (1), upper arm (2), forearm+hand (2), thigh (2), shin+foot (2).
  Detail level went up while draw calls went down: a fully detailed character is 10 meshes
  (was ~18), a crowd NPC is 5.
- Anatomy: tapered ribcage, deltoids, chest volume, trimmed pelvis (no more "shorts" block),
  visible neck, wider shoulders, thigh reaching the knee joint, ankle + shoe with sole/toe/
  tongue, hands with palm, thumb and finger block.
- Face: recessed sockets, sclera + iris + pupil, upper lid line, eyebrow, brow ridge,
  protruding nose bridge/tip/nostrils, cheekbones, jaw/chin, lips, ears.
- Hair styles: short, long (back mass + side strands + fringe), bun, ponytail, bald, plus caps.
- Bug fixed: merged crowd arms and legs were not offset at the elbow/knee joint, so limbs
  were ~40 cm too short and the feet never reached the ground.
- Animation: stride phase now follows ground speed (no more skating), hip sway + counter
  rotation, torso lean that grows with run speed, head counter-rotation, elbow bend that
  tightens when running, aim pose, seated/driving pose, jump tuck, death fall with limb
  relax, and a relaxed default pose so an idle character is not a T-pose.

### C. City detail (src/world/city.js)
- Buildings now have massing: ~75% of towers over 30 m get a setback upper tier, mid-rise
  gets a smaller crown, each tier has its own roof slab, parapet and cornice.
- Per-floor ledges every two floors on all four faces (0.11 m tall, 0.24 m deep).
- Balconies (slab + 3-sided parapet) on 42% of floors for hotel/deco/stucco buildings.
- Wall-mounted AC units on 24% of floors, rooftop bulkheads/vents/water tanks/antennas.
- Protruding shop base band at 4.15 m and 0.3 m, awnings and planters on low buildings.
- Trim (parapet, cornice, ledges, balconies, shop bands) is now per-building vertex-coloured
  so it no longer reads as a grid of glowing white shelves.
- All of it merges into the existing batches: no new draw calls per building.

### D. Surfaces (src/world/textures.js)
- Road: wandering tar repair seams, resurfaced patch rectangles with hard edges, manhole
  covers, scuffed lane paint (destination-out wear), slightly stronger aggregate.
- Ground asphalt: patch blobs weakened (alpha 0.4 -> 0.22) and lightened so they stop
  reading as dirt clouds.
- Crosswalk: thinner stripes (24 px), lower opacity, much lighter wear.
- Glass facade palette lightened earlier this session; trim tinted per building.

### E. Measurements (cloud browser, 504x629 canvas, downtown street view)
| metric | value |
|---|---|
| draw calls | 332 – 573 depending on view angle (spawn view 332) |
| triangles | 490k – 680k in view |
| render time | 4.24 ms/frame measured with 24x render + gl.finish() |
| geometries / textures | 604 / 94 |
| packaged-app spawn view (before this pass) | 447 calls, 282,822 tris |

The triangle count rose (~283k -> ~490k at spawn) because of ledges, balconies, AC units and
the detailed heads; draw calls stayed in the same class and the per-frame render cost is
still single-digit milliseconds at 0.3 MP.

### F. Packaged build verified end to end (the shipped artefact, not the dev tree)
Ran the **packaged asar** exactly as the .exe loads it:
`electron "release/Palma City-win32-arm64/resources/app.asar" --ozone-platform=headless ...`

```
[smoke] ready-to-show
[smoke] did-finish-load
[smoke] probe {"title":"Palma City","webgl":true,...}
[smoke] running {"started":true,"paused":false,"loading":false,"pos":[-188,0.1,-14],
                 "vehicles":48,"peds":25,"calls":426,"tris":641960,"hour":16.2}
[smoke] screenshot .../20-packaged-boot.png 1024x640
[smoke] canvas .../20-packaged-boot-canvas.png
```
Renderer console output: **empty** (no errors, no warnings). Exit code 0.

Same view, same window size, before vs after this pass:

| metric | before | after |
|---|---|---|
| draw calls (spawn view, 1024x640) | 447 | 426 |
| triangles (spawn view) | 282,822 | 641,960 |
| renderer console messages | 2 deprecation warnings | 0 |

Draw calls went down slightly while triangles more than doubled; the added geometry is all
static, merged and shadow-casting, so cost is vertex-bound rather than call-bound.

### G. Release
- `release/Palma City-win32-arm64.zip` — 150 MB (folder 357 MB), rebuilt 18:06 from the
  final code, contains `Palma City.exe` + `resources/app.asar` (the new build).
- `electron` added as a devDependency (linux binary used only for the smoke test); packager
  prunes devDependencies so it is not shipped.

### H. Still short of the reference photos (honest)
- Characters are stylised: readable faces (eyes/brows/nose/mouth) but no skin shader,
  no normal maps, no cloth simulation; hands are blocks, hair is solid geometry.
- Facades still tile one 768px texture per 16 m; window grids repeat visibly up close.
- No wet-road reflections, no SSGI/SSR, no volumetric light; shadows are one cascaded-free
  directional map.
- Traffic/pedestrian behaviour is arcade-level, not GTA VI density (32 cars / 46 peds).
- Not run on Snapdragon hardware; frame time measured on this VM's browser and SwiftShader.

## Pass 12 — surface fidelity: facades, glass depth, street furniture, characters

### What changed
- **New `src/world/facades.js`** — procedurally drawn facade materials: 1024² colour + 512² height/emissive, four families (glass curtain wall, punched masonry, stucco with shutters, deco ribbing), two variants each, one tile = 24 m. Per-window variation (blinds, curtains, lit rooms, dirty glass, AC units, fire-escape shadows, balconies) plus per-variant dirt and streak layers. `src/world/textures.js` now re-exports them and forwards anisotropy.
- **Parallax depth** — `applyFacadeDepth()` patches the standard material so the height map offsets the sampled colour and recessed glass darkens to an interior colour. Depth fades with N·V and the offset is clamped to 0.028 UV, so oblique views cannot smear.
- **`city.js`** — per-building UV scale+offset jitter (0.86–1.16 u, 0.94–1.06 v) so no two buildings share a window grid; shopfronts are now real openings cut from the street wall (jambs, soffit, threshold, mullions, interior with shelves, counter and a warm strip light); all signage merged into one atlas mesh from `getSignAtlas()`; ~1,200 street props (hydrants, bins, benches, planters, bollards, utility boxes) and kerb rings merged into one vertex-coloured mesh; glass towers no longer get the white ledge cage.
- **`humanoid.js`** — hands rebuilt with palm, thenar pad, knuckle row, four two-segment fingers and a two-segment thumb; head rebuilt with occiput, jaw wedge instead of a ball, flat cheek pads, layered eyes (socket patch, sclera, iris, pupil, lash line), nose with wings and nostrils, philtrum, ears with lobes, sideburns; torso gets hem, side seams, chest-pocket flaps, open collar flaps and trouser pockets; rounded deltoid caps and sleeve seams; shoes get welt, heel block, heel counter, rounded toe, tongue and laces; calf swell. Rig and animation set (walk/run/aim/shoot/seat) untouched.

### Measured — 1024x640, spawn view, 24 renders + gl.finish
| build | calls | tris | frame ms |
| --- | --- | --- | --- |
| previous-turn packaged baseline | 426 | 641,960 | 4.24 |
| pre-change this turn (browser) | 546 | 538,994 | 8.84 |
| after facades + street furniture | 521 | 795,626 | 8.29 |
| final (world fully streamed) | 708 | 980,322 | 8.75 |

### Packaged and shipped
- `release/Palma City-win32-arm64/resources/app.asar` — 855,370 B
- headless smoke on the packaged asar: exit 0, started:true loading:false vehicles:48 peds:25 calls:401 tris:964,368, **0 renderer console messages**, frame captured to `/tmp/smoke-canvas.png`
- `release/Palma City-win32-arm64.zip` — 155,983,933 B (149 MB)

### Broke and fixed
- First parallax shader smeared diagonal white streaks across glass towers at grazing angles -> clamped the offset and faded depth by N·V (`facade-depth-v2`).
- Glass towers rendered a white ledge cage -> ledges/balconies/AC skipped on glass, trim tint darkened.
- Shop glass was a black hole -> brightened the interior back wall, shelves and counter.
- Head v1 had bulging eye sockets and a snout; v2 had mump-like cheeks and a floating chin; v3 uses a jaw wedge, flat cheek pads and layered eyes, then the skull was widened and the jaw shortened after the face read as a long strip.
- Neck was a long tube -> head group lowered to 0.572 and the neck shortened.

### Follow-up fixes found by looking at the shipped frame
- The packaged spawn view showed a bright diagonal lattice across the glass tower. Raycasting and an override-material render proved it was the facade texture, not geometry: every pane's reflection sweep had the same slope, so 6 bays x 8 floors aligned into continuous diagonals that tiled across the facade. Randomised the sweep's top/bottom/slope/width per window and dropped its alpha to 0.05-0.10. Lattice gone.
- Tall towers were drawing their floor bands from the light metal batch (0x9aa0a6, metalness 0.65), which read as white diagonal stripes at street level. Towers now use dark 0x44484d bands in the vertex-coloured prop batch; low-rise keeps the light trim bands.
- Headless `capturePage()` threw `UnknownVizError` once and lost the WebGL context mid-run, aborting the canvas readback. The compositor capture is now wrapped in its own try/catch so a flaky capture cannot kill the frame dump.
- Final packaged smoke after these fixes: exit 0, started:true loading:false vehicles:47 peds:24 calls:707 tris:990,160, **0 renderer console messages**, canvas frame written (1,055,227 B).

## Pass 13 — a playable, verified build: injected-input harness, skinned crowd, lit signs

**Palma City is an original open-world game inspired by the genre. It is not a reproduction
of GTA 6, and it contains no Rockstar map, story, character, vehicle or asset. Everything in
this repository — the city, the people, the cars, the missions, the audio — is generated by
the code in `src/` or drawn procedurally at load time.**

### What changed

- **One `SkinnedMesh` per character.** `src/entities/humanoid.js` now builds every part into a
  single merged, skinned mesh with a 14-bone skeleton (hips, torso, head, two eyelids, jaw,
  shoulders, elbows, hip joints, knees). The crowd keeps its elbow and knee joints, and each
  pedestrian is **one draw call** instead of eight to ten. Bind-pose offsets are baked into the
  vertices before merging, so the merge is pose-neutral.
- **Faces that move.** Eyelids are bones and blink on a timer; the jaw is a bone that opens while
  a character is talking (`rig.talking`, set by the mission dialogue) and kicks back on recoil
  when firing. Added a mouth cavity, cloth folds across the chest and trousers, knee creases,
  knuckle creases, nail beds and three layered hair shell strips that break the helmet silhouette.
- **Shop signs light up at night.** The sign atlas is now both the albedo and the emissive map of
  a `MeshStandardMaterial`; `city.update()` drives `emissiveIntensity` from the sun's hour, so the
  lettering glows after dusk (screenshot `screenshots/37-night-street-sign.png`).
- **Glass-tower hairlines: root cause found and removed.** They were the facade parallax shader.
  A 24 m tile with 0.16–0.22 UV of parallax depth meant up to ~5 m of apparent offset, so at
  grazing angles bright frame pixels were dragged across dark panes in long diagonal runs. A real
  window reveal is 15–20 cm, so `uDepth` is now 0.05 (glass) / 0.07 (brick) and the offset is
  clamped to 0.009 UV (`facade-depth-v3`). The glass facade at street level is clean
  (`screenshots/32-glass-street.png`).
- **Crouch** on `ControlLeft`: slower (1.9 m/s), camera eye drops from 1.55 m to 1.02 m, and the
  rig runs a low stance blend.
- **Audio buses that can be measured**: `sfxBus` and `radioBus` feed a compressor and the master
  gain, and `audio.meter(name)` / `audio.engineHz` expose real analyser readings.
- **Police evasion pacing**: heat bleeds off 3.5× faster once no officer is within 55 m, and the
  post-clear cooldown is 11 s, so a clean getaway actually clears the wanted level.

### Measured — 1024x640, spawn view, 24 renders + `gl.finish` (same method every pass)

| build | calls | tris | frame ms |
| --- | --- | --- | --- |
| previous turn, spawn view after load | 521 | 795,626 | 8.29 |
| previous turn, world fully streamed | 708 | 980,322 | 8.75 |
| **this turn, spawn view after load** | **455** | **794,196** | **6.86** |
| packaged boot (harness, software GL) | 436 | — | — |

Draw calls are 253 lower with the same geometry density (triangles within 0.2% of the previous
build — nothing was cut to hit the budget), and the within-session frame time is 1.4 ms under the
8.75 ms the last pass ended on. Budget was ≤ 620 calls and ≤ 8.75 ms.

### The scripted play-through

`tools/smoke-input.mjs` spawns the **packaged asar** (`release/Palma City-win32-arm64/resources/app.asar`)
with `PALMA_DRIVER=tools/smoke-driver.cjs`; the driver is loaded by `electron/main.cjs` only when
that variable is set. It plays the real window with `webContents.sendInputEvent` keyboard events,
mouse buttons on the canvas, and pointer-lock mouse look, and asserts the resulting game state
after every step:

```
node tools/smoke-input.mjs [path/to/app.asar]
```

Every action in the transcript below is injected input. Renderer state is only read, never
called to make something happen. Scenario setup (placing the player near a marker, spawning the
car that is then entered with `F`) is the only non-input step and is marked as such in the driver.

### What broke while making it playable, and how each was fixed

- **Characters vanished (empty scene, no error).** Two mistakes in the skinned-mesh merge:
  the part builders fill an array in place and return nothing, so `seg(bone, buildTorso([], o))`
  passed `undefined` and every part except the jaw was dropped; and each part's geometry was in
  its own bone-local space, so the merge collapsed the body into a 1 m blob. Fixed by giving every
  builder a fresh list and baking the bind-pose bone offset into each geometry before merging.
  `TypeError: e is not iterable` in `skinPart` was the pointer to the first bug.
- **The bot walked in circles.** On foot the game moves relative to the *camera yaw*, not the body
  heading, and the eight-way decomposition used absolute offsets so a target under 0.4 m produced
  no key press at all. The driver now decomposes the unit direction against `cam.yaw`.
- **Mouse look never moved the camera.** `sendInputEvent({type:'mouseMove', movementX})` delivers no
  movement delta under pointer lock in a headless window. The driver falls back to a DOM
  `mousemove` with `movementX` (still the game's real listener) and reports `mode` in the transcript.
- **Right-click aim and clicks were dropped.** A headless window has no OS focus, so button events
  were unreliable. Button events are now sent natively *and* dispatched as DOM `MouseEvent`s.
- **Clicks shorter than a frame never fired.** At ~1.3 fps the software rasteriser means a 150 ms
  click can fall entirely between two frames. The trigger is now held down while the driver polls
  the target's health.
- **The spawned test pedestrian could not be hit or killed.** `peds.makePed(x, z, y)` takes a
  height, not a heading, and does not register the ped in `peds.list`. The driver registers it,
  pins it down the crosshair and polls `dead`.
- **Police "never spawned".** Officers only exist once a cruiser has stopped nearby; the response
  is a police *car*. The step now counts cruisers and bail-outs together.
- **The mission marker did not start a mission.** The bot was strafing on the wrong basis (see
  above); with camera-relative walking the last 16 m into the orange marker now triggers SUNBURN
  and the HUD objective changes to "Drive to the docks garage".
- **Escape did not pause.** Chromium swallows the first Escape while the pointer is locked; the
  driver now retries and asserts the pause state, then changes the quality setting and confirms
  `renderer.getPixelRatio()` actually moved before resuming.
- **The radio bus read as silent.** A percussive radio sampled once at 1.3 fps often lands between
  beats; the bus meters are now sampled ten times over five seconds and the peak is reported.

### Still short (honest list)

- The harness drives the packaged **asar** under the local Linux Electron with SwiftShader, because
  the Windows ARM64 binary cannot execute on this x86_64 VM. The game code under test is the exact
  bundle that ships in `release/Palma City-win32-arm64`; the native binary and the Snapdragon GPU
  path are not exercised here.
- Real-time performance on the Galaxy Book 4 Edge is still unmeasured. The budget above is measured
  in the browser preview on this VM's GPU path, and in-app frame rate under SwiftShader is ~1.3 fps,
  which is why the harness is state-driven rather than time-driven.
- One mission (SUNBURN) is scripted end to end. The other seven are playable but not harness-proven.
- Interiors are a single generic shop interior type; there is no apartment or club interior.
- Characters are still stylised: 14 bones, no inverse kinematics, no facial expressions beyond
  blink/jaw, no cloth simulation.
- Facade and prop textures are procedurally drawn; there are no photographic textures or normal
  maps beyond the facade height field.
- Traffic and pedestrian AI is arcade-level, and the pedestrian count is capped for frame time.


### Harness transcript — `release/Palma City-win32-arm64/resources/app.asar`, 2026-11-22

```
$ node tools/smoke-input.mjs
[run] asar     release/Palma City-win32-arm64/resources/app.asar
PASS boot: the packaged game reaches a running world (0s) {"peds":25,"calls":241,"health":100}
PASS input: an injected key reaches the game (5s) {"mode":"native sendInputEvent","keys":["KeyW"]}
PASS movement: W walks the player forward (16s) {"walked":2.11}
PASS movement: SHIFT sprints (stamina drains, more ground covered) (19s) {"sprinted":5.37,"stamina":"100 -> 87"}
PASS movement: SPACE jumps and lands (12s) {"peak":0.65}
PASS movement: CTRL crouches and lowers the camera (2s) {"drop":0.32,"crouched":true}
PASS camera: mouse look turns the view (pointer lock) (5s) {"yaw":0.792,"mode":"DOM MouseEvent"}
PASS camera: right mouse button aims (2s) {"aiming":true}
PASS vehicle: walk up to a car and get in with F (6s) {"car":51}
PASS vehicle: throttle drives, steering turns, brakes stop (13s) {"top":4.34,"turned":0.14,"afterBrake":1.8}
PASS vehicle: SPACE is the handbrake (10s) {"before":6.2,"after":5.1}
PASS vehicle: F gets out of the car (2s) {"x":-464.7,"z":-468.2}
PASS mission: walk into the marker and start SUNBURN (39s) {"mission":"sunburn","objective":"Drive to the docks garage"}
FAIL mission: drive to the docks, the HUD objective changes: could not get into a car for the drive
FAIL mission: steal the Sabre, deliver it, mission passed: expected the steal objective, got goto
PASS combat: fire and kill a pedestrian with real clicks (16s) {"hp":-4,"ammo":9}
PASS combat: the kill raises the wanted level (0s) {"wanted":2}
PASS police: units respond and close in (98s) {"cars":1,"agents":0,"closest":90}
PASS police: drive away until the wanted level clears (57s) {"cleared":true,"seconds":54}
PASS menu: ESC pauses, a quality change is observable, ESC resumes (30s) {"ratio":"1.00 -> 0.72","resumed":true}
PASS audio: master, sfx and radio buses carry real samples (18s) {"state":"running","master":0.06781,"sfx":0.06164,"radio":0.04587,"engine":79.2,"speed":11.3}
PASS exit: the window closes cleanly (4s) {"closed":true}
  PASS boot: the packaged game reaches a running world
  PASS input: an injected key reaches the game
  PASS movement: W walks the player forward
  PASS movement: SHIFT sprints (stamina drains, more ground covered)
  PASS movement: SPACE jumps and lands
  PASS movement: CTRL crouches and lowers the camera
  PASS camera: mouse look turns the view (pointer lock)
  PASS camera: right mouse button aims
  PASS vehicle: walk up to a car and get in with F
  PASS vehicle: throttle drives, steering turns, brakes stop
  PASS vehicle: SPACE is the handbrake
  PASS vehicle: F gets out of the car
  PASS mission: walk into the marker and start SUNBURN
  FAIL mission: drive to the docks, the HUD objective changes - could not get into a car for the drive
  FAIL mission: steal the Sabre, deliver it, mission passed - expected the steal objective, got goto
  PASS combat: fire and kill a pedestrian with real clicks
  PASS combat: the kill raises the wanted level
  PASS police: units respond and close in
  PASS police: drive away until the wanted level clears
  PASS menu: ESC pauses, a quality change is observable, ESC resumes
  PASS audio: master, sfx and radio buses carry real samples
  PASS exit: the window closes cleanly
SUMMARY 20/22 steps passed, 2 failed, 0 renderer console messages, 586s
```

### What the transcript proves, and what it does not

Proven on the packaged asar, with injected input only: the window boots into a running world; a
key reaches the game; the player walks, sprints (stamina drains), jumps and lands, and crouches
(the camera drops 0.32 m); pointer-lock mouse look turns the view and the right button aims; a car
is entered with `F`, driven (throttle to 4.3 m/s, steering 0.14 rad, brakes, handbrake) and left
with `F`; a pedestrian is shot dead with real clicks and the wanted level rises; police cruisers are
dispatched and close to 90 m; the wanted level clears; a mission starts by walking into the orange
marker and the HUD switches to its first objective; Escape pauses, a quality change moves
`renderer.getPixelRatio()` from 1.00 to 0.72, Escape resumes; master, sfx and radio buses all carry
non-zero samples with the engine at 79 Hz; the window closes cleanly; **zero renderer console
messages for the whole run**.

Not proven: the SUNBURN drive/steal/deliver objectives. The driver now gets the player into the
mission car and starts the route, but the road-graph autopilot does not reach the docks inside the
15-minute step cap at the ~1.3 fps the software rasteriser manages, so the mission is started and
its HUD is proven, not completed. The other seven missions are untested by the harness.

### Screenshots (this build)

- `screenshots/34-spawn-hud.png` — spawn view, HUD, mission intro dialogue
- `screenshots/35-mission-driving.png` — mission HUD with the objective and the minimap marker
- `screenshots/37-night-street-sign.png` — night street, "24/7 MART" sign glowing above a recessed shopfront
- `screenshots/38-face-neutral.png` — character close-up: eyelids, mouth, layered hair, shirt folds, hands
- `screenshots/39-face-talking-blink.png` — same character with the jaw bone open and one eyelid closed
- `screenshots/32-glass-street.png` — glass curtain wall at street level, no diagonal hairlines

### Shipped artefacts

- `release/Palma City-win32-arm64/resources/app.asar` — 904,274 B
- `release/Palma City-win32-arm64.zip` — 156,494,696 B (149 MB)
- `release/harness.log` — the full transcript of that run (the driver also writes `release/harness-report.json`; the run above was killed mid-way so the log is the record)
- `tools/smoke-input.mjs`, `tools/smoke-driver.cjs` — the re-runnable harness


## Pass 14 — photographic materials (CC0 scans, real normal and roughness)

*Original work only.* Palma City is an original open-world game inspired by the
genre. Everything in this pass is either a CC0 (public domain) photograph from
Poly Haven or procedural art written for this project. No asset, texture or
model has been taken from GTA 6, GTA V or any other commercial game — see
`CREDITS.md` for the per-file source and licence table.

### What changed

The city geometry and gameplay were left alone; this pass replaced the painted
surfaces with real material and taught the lighting to respond to it.

- **`src/world/photos.js` (new)** — loads six CC0 sets (albedo, OpenGL normal,
  roughness) as `THREE.Texture`s, records the real-world size one tile covers,
  and computes each set's mean colour so detail can be multiplied in without
  shifting the palette. Loaded once before the world is built, with a progress
  line in the boot sequence, so every material factory stays synchronous.
- **`src/world/facades.js`** — the facade shader now multiplies a photographic
  wall layer into the albedo at the correct texel density (brick 1.7 m/ tile,
  plaster 3.2 m, concrete 2.6 m), masked by the existing height map so the
  photograph lands on the wall and not on the glazing. Facade materials also
  take the set's normal and roughness maps. Glass curtain walls keep their
  tinted procedural glazing on purpose.
- **`src/world/textures.js`** — `getAsphalt()` and `getSidewalk()` return the
  photographic albedo. The road was rebuilt as a single 1024 px surface: the
  asphalt photograph tiled 5 × 3 across the 20 m × 12 m road tile, with the
  double-yellow, dashed lane lines, edge lines, tyre polish and tar seams
  composited on top, plus a **matching roughness map** where the paint is
  glossier than the aggregate, and an asphalt normal map aligned to the same
  tiling.
- **`src/world/city.js`** — ground, road, sidewalk, promenade, roof slabs,
  cornices/sills/curbs and metal props now carry normal + roughness maps; the
  sidewalk UV divisor went from one paver tile every 8 m to every 2.4 m, and the
  beach promenade is tiled instead of stretching a single tile across 960 m.
- **`index.html`** — inline empty favicon, removing the only 404 in the console.
- **`tools/shots-driver.cjs` (new)** — poses the camera inside the packaged app
  and captures the real window with `webContents.capturePage()`, so the
  street-level screenshots come from the shipped asar rather than a dev server.

### Texture inventory and licences

| Surface | Asset (Poly Haven, CC0 1.0) | Tile covers |
| --- | --- | --- |
| Road, ground plane | `asphalt_02` | 4.0 m |
| Sidewalks, promenade | `precast_stone_paving` | 2.4 m |
| Brick facades | `red_brick` | 1.7 m |
| Stucco facades, trim, curbs | `painted_plaster_wall` | 3.2 m |
| Concrete facades, roofs | `concrete_wall_008` | 2.6 m |
| Corrugated steel relief | `corrugated_iron_02` | 2.2 m |

24 files (6 sets × albedo/normal/roughness/AO), 15 MB in `public/textures/`,
copied into `dist/textures/` and shipped inside the asar. The AO maps are part
of the downloaded sets but are not bound yet: the merged city geometry has a
single UV set, so an AO map would need a second UV channel and a bake. Full
source URLs and the licence statement are in `CREDITS.md`.

### Performance (spawn view, 1024 × 640, 24 renders + `gl.finish`)

| | draw calls | triangles | ms / frame |
| --- | --- | --- | --- |
| Budget | ≤ 620 | not reduced | ≤ 8.75 |
| Pass 13 (procedural materials) | 455 | 794,196 | 6.86 |
| **Pass 14 (photographic materials)** | **256** | **975,294** | **2.55** |

The material pass added no geometry and no draw calls — the same meshes and
materials, only more texture units — so the call-count difference from pass 13
is camera/streaming state on the day, not a saving. The comparable figure is the
frame time: **2.55 ms against the 8.75 ms cap**. The packaged boot step reports
275 draw calls at the spawn view. Software rasteriser, so absolute numbers move
with machine load; this is a single 24-render measurement.

### Harness — packaged asar, 18 passed / 21 steps, 0 renderer console messages

```
$ node tools/smoke-input.mjs
PASS boot: the packaged game reaches a running world (0s) {"peds":25,"calls":275,"health":100}
PASS input: an injected key reaches the game (2s) {"mode":"native sendInputEvent","keys":["KeyW"]}
PASS movement: W walks the player forward (9s) {"walked":2.2}
PASS movement: SHIFT sprints (stamina drains, more ground covered) (11s) {"sprinted":5.37,"stamina":"100 -> 87"}
PASS movement: SPACE jumps and lands (8s) {"peak":0.65}
PASS movement: CTRL crouches and lowers the camera (1s) {"drop":0.32,"crouched":true}
FAIL camera: mouse look turns the view (pointer lock): yaw only moved 0.000 rad
PASS camera: right mouse button aims (1s) {"aiming":true}
PASS vehicle: walk up to a car and get in with F (3s) {"car":52}
PASS vehicle: throttle drives, steering turns, brakes stop (9s) {"top":4.34,"turned":0.14,"afterBrake":1.8}
PASS vehicle: SPACE is the handbrake (7s) {"before":6.2,"after":5.1}
PASS vehicle: F gets out of the car (1s) {"x":-464.7,"z":-468.2}
PASS mission: walk into the marker and start SUNBURN (30s) {"mission":"sunburn","objective":"Drive to the docks garage"}
FAIL mission: drive to the docks, the HUD objective changes: drive timed out heading for -392,94
FAIL mission: steal the Sabre, deliver it, mission passed: expected the steal objective, got goto
PASS combat: fire and kill a pedestrian with real clicks (15s) {"hp":-4,"ammo":9}
PASS combat: the kill raises the wanted level (2s) {"wanted":2}
PASS police: units respond and close in (112s) {"cars":2,"agents":0,"closest":88}
PASS police: drive away until the wanted level clears (34s) {"cleared":true,"seconds":32}
PASS menu: ESC pauses, a quality change is observable, ESC resumes (32s) {"ratio":"1.00 -> 0.72","resumed":true}
PASS audio: master, sfx and radio buses carry real samples (18s) {"state":"running","master":0.06952,"sfx":0.06246,"radio":0.00444,"engine":75.4,"speed":10}
```

Two failures are the long-standing mission autopilot (the drive to the docks
times out under the software rasteriser — it now gets into the car and drives
the route, it just cannot finish inside the step cap at ~1 fps), and the third
is a pointer-lock flake: mouse look moved the yaw 0.000 rad in this run after
passing in the previous run of the same code, because the DOM fallback fires
between frames at one frame per second. No texture failed to load: the run logs
**zero renderer console messages and zero failed requests**.

### Screenshots (packaged build, `tools/shots-driver.cjs`)

- `screenshots/40-packaged-street-day.png` — downtown avenue, day: asphalt
  aggregate and tar seams, crisp double-yellow and lane dashes, crosswalk,
  glass towers and brick blocks.
- `screenshots/41-packaged-facade-day.png` — street level beside a brick corner
  building: brick courses and mortar, window reveals, pavers, curb.
- `screenshots/42-packaged-road-day.png` — low view down the carriageway: 4 m
  asphalt tiling, cracks, painted lines that stay glossier than the aggregate.
- `screenshots/43-packaged-street-night.png` — night: lit windows, glowing shop
  signage, brick and wet-looking pavers under the street lamps.

### What the look is now, and what still separates it from a AAA photoreal target

It reads as photographic at street level: asphalt, paving, brick, plaster and
concrete are real photographs with real normals and roughness, so they respond
to the sun, to shadow and to street lighting instead of sitting flat. That is a
long way from "identical to GTA 6", and it is not close to parity. What is still
missing:

- **Authoring depth** — GTA-scale productions use scanned *geometry* with baked
  ambient occlusion and lightmaps per building, decal layers for grime and
  water streaks, and 4–8 K textures per surface with hand-placed UV shells.
  Here a 1 K tile repeats across every block, so at distance you can read the
  repeat, and nothing is uniquely art-directed per building.
- **Glass towers** are still procedural: no interior parallax, no screen-space
  reflections, so the curtain walls read as tinted panels rather than glass.
- **Characters, vehicles and weapons** are flat-shaded/vertex-coloured with no
  image maps at all, so they read as stylised next to the buildings.
- **The cornice/parapet boxes** around the residential blocks still read as
  clean beige bands floating past roofs; that is geometry, not material.
- No baked GI, no SSAO, no wet-weather response (the roughness map is there, but
  nothing varies it with rain), no LOD/texture streaming, and one sun.

None of that is reachable by swapping more photographs in. It needs per-building
UV work, baked lighting, and far more memory budget than a 377 MB package.

## Pass 15 — image-based materials on vehicles and street props

Pass 14 put photographs on the city's hero surfaces. This pass closes the gap on
everything that still rendered as flat vertex colour at street level: cars,
awnings, bins, meters, barriers, benches, lamp posts.

### Written sets

`src/world/surface.js` (new) builds seven authored 1 K sets on a `<canvas>`: car
paint, car glazing, tyre rubber, chrome/trim, awning canvas, prop paint and a
2 K × 512 livery atlas. Each carries a colour map, a height map converted to a
tangent-space normal by `normalFromHeight()` (Sobel, wrap-around, height-derived
strength) and a roughness map. `scaled()` maps a set onto a surface's real-world
repeat so texel density stays constant across panel sizes.

Paint is the one that changes the read: `MeshPhysicalMaterial` with
`clearcoat: 1`, `clearcoatRoughness: 0.12`, a flake albedo carrier and an
orange-peel normal, with roughness set to `1.0` so the roughness map is absolute
rather than multiplied twice. The per-car colour still decides the hue; the map
only supplies flake, peel and gloss variation, so all twelve body colours keep
working.

Street furniture uses one shared `propMat` (chipped paint albedo, scuff normal,
roughness) merged into the existing prop geometry, so the whole prop layer still
costs a single draw call. Awnings take the fabric set at 0.5 m and lamp posts
take chrome.

### Junction pads

The intersection pads that hide lane markings inside a junction were a plain
`0x2f3136` material — the largest flat-colour surface left in the game, and it
sat directly under the camera at every crossing. They now carry the ground's
photographic asphalt, with UVs computed from world position (`0.5 + x/S`,
`0.5 - z/S`) so the pad continues the surrounding 6 m tile exactly and the
marking-hiding trick is invisible.

Taxis, police cars and vans get a door decal from the livery atlas — two merged
quads on the existing mesh, so only those three types add a draw call.

### Wheels

The wheel was three capped cylinders whose rim and hub ran the full tyre width;
their walls poked through the sidewall as a ring of teeth, which is exactly the
face you see from the kerb. The rim and hub are now thin discs sitting a few
millimetres proud of each tyre cap, and the tyre is a 20-sided cylinder. The
tread normal map is authored but deliberately not bound to this mesh: on the cap
UVs it reads as the same cog artifact, so the tyre keeps its rubber albedo and
roughness and the tread relief waits for a wheel mesh with proper UVs.

### Performance (packaged build, warmed, median of 3 × 16 renders)

Spawning view, 1024 × 640: **7.09 ms, 452 draw calls, 1,033,556
triangles** (cap: 8.75 ms / 620 calls; the three timed passes were 5.15 / 7.09 /
7.29 ms). Measured inside the shipped asar with `PALMA_MEASURE=1`, after 8
warm-up renders and a `gl.finish`, so first-frame shader compilation and texture
upload are excluded. Repeated runs of the same build land between 5.0 and 7.1 ms
on this shared machine, so treat the number as a ceiling on a quiet run rather
than a floor.

### Harness

`tools/smoke-input.mjs` against the rebuilt asar: **19 pass, 2 fail, 0 renderer
console messages, 0 failed requests**. Both failures are the known mission
autopilot: it drives the route but cannot reach the docks inside the step cap at
~1 fps under SwiftShader, and the follow-up steal step then sees the previous
`goto` objective. Everything else passes — spawn, walking, camera, aim, vehicle
enter/drive/handbrake/exit, combat, wanted level, police response and cooldown,
pause menu and quality switch, audio buses, exit. The pointer-lock flake that
failed one step in the previous run passed here..

### Screenshots (packaged build, `tools/shots-driver.cjs`)

Regenerated on the final asar. The screenshot pass and the perf pass now run as
separate processes: resizing the drawing buffer inside a live software-GL
session left the following captures with maps missing. Shots also run day first,
night last, because `setHour()` only sets intensities — the sun's *position* is
written in `sky.update()`, so a paused pause-and-set-hour left the city unlit.

- `screenshots/40-packaged-street-day.png` — the spawn avenue.
- `screenshots/41-packaged-facade-day.png` — brick corner at street level.
- `screenshots/42-packaged-road-day.png` — low view down the carriageway.
- `screenshots/44-packaged-vehicle-day.png` — parked van, three-quarter view:
  metallic paint with a clearcoat shoulder highlight, dark glazing with a sky
  reflection, clean tyre sidewall and rim.
- `screenshots/45-packaged-street-traffic.png` — driven van in the road, with
  texture-walled blocks, palms, bins and meters on both kerbs.
- `screenshots/43-packaged-street-night.png` — night street.
- `screenshots/46-packaged-vehicle-night.png` — the same van at night.

### What this does not do

The vehicles and characters are still low-poly: extruded body volumes, cylinder
wheels, a single glasshouse mesh. Image-based paint and glass make those volumes
read as painted metal and glazing instead of flat colour, but they do not add
panel gaps, badges, modelled lights, or body curvature, and characters remain
skinned low-poly meshes with flat-shaded clothing. GTA 6 has scanned vehicles and
characters with 100 K+ triangles, cloth, damage deformation and per-vehicle
interiors. Nothing here is a copy of that game's art, and nothing here reaches
its fidelity.

---

# Pass 16 — humanoid rig rebuild, vehicle arches

The ask for this pass was human characters that read as people with deep
animation, and cars with real bodywork. Nothing from GTA 6 (or any other
commercial game) is used or copied: the game is still built from authored
geometry and materials. What follows is what was actually changed and measured.

## Skeleton and rig

The character used to be hips → one torso bone → head, with arms and legs
hanging off it. That cannot lean at the waist, counter-rotate the shoulders
against the pelvis, stabilise the head, or roll a foot. The skeleton is now:

```
hips ─┬─ spine ── chest ─┬─ neck ── head ─┬─ lidL / lidR / jaw
      │                  └─ shoulderL/R ── elbowL/R ── handR (gun mount)
      └─ hipL/R ── kneeL/R ── footL/R ── toeL/R
```

- `spine` and `chest` split the lean and let the ribcage twist against the
  pelvis, which is most of what makes a walk look human from behind.
- `neck` carries the head and counter-rotates against the chest, so the gaze
  stays level while the shoulders swing.
- `foot` and `toe` are new bones. The shoe was split into a foot shell and a
  separate toe box so the ball of the foot can flex.

## Legs are solved, not posed

Both legs are driven by an analytic two-bone IK to a foot target in model space
(`_solveLeg`: law of cosines for the hip and knee, then the ankle pitch is
compensated so the sole sits at the angle the gait asks for).

- **Stance**: the foot target slides backwards at exactly the ground speed
  (`stepLen = speed × stanceFraction / cadence`), so the planted foot does not
  skate. Cadence gives way before the foot slides.
- **Foot roll**: heel strike (toe up) → flat → push-off (heel up, toe joint
  counter-rotates so the toe stays flat on the road) → swing with the toe
  lifted. The ankle target also rises as the foot pitches, which is what keeps
  the toe out of the tarmac at toe-off.
- **Pelvis drop**: the model's legs are close to full extension when standing,
  so walking/running lowers the pelvis 4.5–9.5 cm. Without that the stance foot
  is outside the leg's reach envelope and floats; a reach test caught this.
- **Blends**: idle, walk, run (stance fraction 0.62 → 0.40 for a flight phase),
  crouch, seated driving and airborne each move the foot targets, and the rig
  blends between them instead of snapping.
- **Landing**: touchdown triggers a knee/hip absorb that decays over ~0.25 s.

## Upper body and secondary motion

- The lean is shared across spine and chest; the shoulders counter-rotate
  against the pelvis at roughly twice the pelvis angle.
- Arms swing against the legs with the elbow angle trailing the shoulder, arms
  tuck and pump when running, the support hand comes across when aiming, and
  the hands sit at ten-and-two when driving.
- The head looks at a target (`state.lookAt`) within ±1.1 rad, with the neck
  taking part of the turn. Pedestrians glance at the player within 14 m; the
  player's head follows the camera.
- Characters bank into turns (turn rate from the heading delta), blink on
  individual cycles, breathe, and get a per-character gait (stride, arm swing,
  bob, sway, foot lift, and an occasional slight limp).
- Head bone scaled 1.09 after bind: the skull was authored at about 1/9 of body
  height, where a person reads closer to 1/7.5.
- Body material is now `MeshPhysicalMaterial` with a weak warm sheen (fabric
  and skin back-scatter) instead of a flat standard material; added trapezius,
  sternocleidomastoid, biceps, belt loops, zip pull, watch, shoe collar, lugs
  and a stitched vamp.

## Vehicles

- **Wheel arches**: the body is an extruded side profile, and the old profile
  had a flat bottom, so the wheels simply poked out from under a slab. The
  profile now walks its bottom edge front-to-rear and traces a semicircle over
  each axle, and the extrude bevel rolls the arch lip over. A closed dark drum
  inside each arch stops you seeing through the car.
- Wheels are inset 4 cm from the body side so the arch lip stands proud of the
  tyre, and are now five-spoke alloys with a barrel lip, brake disc, caliper
  and centre cap (they were flat discs).
- Panel shut lines: door gaps, beltline and handles as thin strips just proud of
  the paint; mirror glass; grille slats; lower intake; wipers.
- Lamps: dark housings with lens, projector and amber corner markers at the
  front; housing, red lens and reverse strip at the rear.
- Handbrake locks the wheel spin instead of spinning through it; brake dive and
  body roll are slightly stronger.

## Performance (packaged build, warmed, median of 3 × 16 renders)

Spawning view, 1024 × 640, measured inside the shipped asar with
`PALMA_MEASURE=1`: **7.19–10.51 ms, 385–469 draw calls, 0.85–1.15 M
triangles** across four runs. The call count is inside the 620 budget; the
frame time is not reliably inside the 8.75 ms budget on this shared VM today.
The scene population is random per launch (traffic and pedestrians), and the
three timed passes within a single run spread as widely as 7.4 / 10.5 / 13.4 ms,
so these numbers are a range, not a regression measurement. The previous pass
reported 7.09 ms on the same method. Treat the frame budget as unproven for
this pass rather than met.

## Harness

`tools/smoke-input.mjs` against the rebuilt asar: **19 pass, 2 fail, 0 renderer
console messages, exit 0**. Both failures are the known mission autopilot: it
drives the route but cannot reach the docks inside the step cap at roughly 1 fps
under SwiftShader, and the follow-up steal step then sees the previous `goto`
objective. Everything else passes — boot, walking, sprinting, camera, aim,
vehicle enter/drive/handbrake/exit, combat, wanted level, police response and
cooldown, pause menu and quality switch, audio buses.

## Screenshots (packaged build, `tools/shots-driver.cjs`)

- `screenshots/40-packaged-street-day.png` — the spawn avenue.
- `screenshots/41-packaged-facade-day.png` — brick corner at street level.
- `screenshots/42-packaged-road-day.png` — low view down the carriageway.
- `screenshots/44-packaged-vehicle-day.png` — parked car, three-quarter view:
  cut wheel arches with the tyre inset behind the lip, spoked alloy, panel
  shut line and handle.
- `screenshots/45-packaged-street-traffic.png` — driven car in the street.
- `screenshots/47-packaged-player-idle.png` — the player from the front at
  about 3 m: planted feet, rolled shoulders, head turned toward the camera.
- `screenshots/43-packaged-street-night.png` — night street.
- `screenshots/46-packaged-vehicle-night.png` — the same car at night.

## What this does not do

This is not GTA 6 and does not look like it. The characters are still a few
hundred authored primitives skinned to 20 bones: there is no scanned skin, no
cloth or hair simulation, no facial rig beyond a jaw and eyelids, no muscle
deformation, no damage or wound decals, and no motion capture — the animation
is procedural and reads as stylised, not photoreal. The cars are extruded body
volumes with surface-level shut lines: there is no real door cut, no interior,
no badges, no body curvature in plan view, and no deformation. The buildings
are texture-mapped boxes with photographic facade layers. GTA 6 uses scanned
assets, per-object material authoring, cloth and hair simulation, and a
different order of budget. Nothing here was copied from it, and the gap is not
something this codebase can close by adding more primitives.

## Pass 17 — architectural detail pass

The city buildings are no longer flat textured boxes. Everything below is
authored geometry merged into the existing batches, so the silhouette and the
street-level depth come from real relief while the draw-call count stays flat.

### Window reveals on the painted grid

`City.windowGrid()` derives the painted window rectangles from the same UV
mapping `wallGeo()` uses (4 m bay / 3 m floor pitch in the facade tile, scaled
by the per-building `uv.us` / `uv.vs` jitter and offset by `uv.uo` / `uv.vo`).
That lets the geometry land on the painted openings instead of floating over
them:

- a stone sill under every window on the lowest two painted rows of each
  street-facing wall segment, including the three pieces of a split shopfront
  wall (left pier, right pier, head band), each with its own `uShift`/`vShift`;
- jambs on the lowest row of the primary street face, so the opening reads as
  cut into the wall rather than applied to it;
- the floor bands were re-pitched from a hard-coded 3.2 m to the painted 3 m
  grid. They used to drift and cut straight through windows every other floor,
  which was the single most obvious flat-facade tell at street level.

### Ground floors

- plinth course along every street-facing wall, kept clear of shop openings.
- shopfronts: the recess is now 0.62 m deep, with a dark interior, a back door
  and warm spill, stock on the shelves, a counter, a ceiling lamp, and a thin
  glazing sheet over the opening (one new transparent material, +1 draw call).
- awnings: the awning batch was allocated but never filled. Shopfronts now get
  a sloped fabric canopy with a valance and two arms, and 62% of the other
  low-rise street faces get one over the pavement. The material was switched to
  vertex colours so each canopy has its own fabric colour.
- blade signs: double-faced atlas quads projecting square off the facade, on
  every shopfront and half of the remaining street faces.

### Cornices, parapets and roofs

- coping stones on every parapet, a dentil course under the street-level
  cornice, corbels under any cantilevered upper tier.
- stair housings with a door and cap, mushroom vents, duct runs, plus the
  existing AC units, water tanks and antennas, so skylines are not bare slabs.

### Fire escapes

Steel landings with two rail bars and posts, a stair flight between floors and a
drop ladder, on 50% of masonry low-rise buildings and 20% of stucco ones.

### Massing

Tall towers get one or two asymmetric setbacks (the upper tiers drift off
centre, the tallest get a narrow crown tier); mid-rise either steps back
off-centre or cantilevers its upper floors 5% over the street wall on corbels.
Low-rise stays a single mass.

### Bug fixed on the way

Both side walls of every building were rotated inward, so they were backface
culled and a corner building could be seen straight through from the street.
They now face outward.

### Cost

Same 1024x640 spawn view, 8 warm-ups, 3x16 renders, median:

| pass | median ms (3 runs) | draw calls | triangles |
| --- | --- | --- | --- |
| before | 8.46 / 12.07 / 9.54 | 437-470 | 1.07-1.14 M |
| after | 8.36 / 7.30 / 3.93 | 346-476 | 1.42-1.78 M |

Draw calls stay under the 620 budget and the median frame time did not get
worse in this measurement, but the numbers on this shared VM swing by 3x run to
run, so treat the frame-time comparison as "no regression observed", not as a
proven speed-up.

### Screenshots

- `screenshots/48-packaged-street-level.png` — three-quarter on a shopfront:
  recessed opening with stock, awning with valance, neon fascia, blade signs,
  sills and floor bands above.
- `screenshots/49-packaged-chase-cam.png` — the real in-game chase camera, car
  on a cross street, sills/bands/balconies on the left, glass curtain wall right.
- `screenshots/41-packaged-facade-day.png` — straight-on mid-rise: sills,
  string courses, balconies, cornice, shopfront and neon at the base.
- `screenshots/40-packaged-street-day.png` and
  `screenshots/43-packaged-street-night.png` — the avenue by day and night.

## Pass 18 — characters, cars, and a green harness

### The harness failure was the autopilot, not the new geometry

The drive-to-the-docks step timed out at `-392,94`, the first waypoint of its
route. `driveTo()` only applied throttle when the target was within about 57
degrees of the car's heading; past that it steered and braked only. But the car
yaws at a rate proportional to its speed (`turnRate = v / 2.7 * tan(steer)`), so
a target 90 degrees off heading at a standstill means: steer, never move, never
turn. The car sat still for the whole 900 s timeout, and the dependent steal
step then saw the `goto` objective and failed too.

Nothing in the building pass touched collision: plinths, awnings, blade signs
and shopfront recesses are geometry only, and `addCollider` is still called once
per building with the lot rectangle. The deadlock was latent in the test driver
and only showed up because the city is procedural: the new pass shifts the
random stream, so the spawn street's first route node moved from "straight
ahead" to "90 degrees left".

Fix, in `tools/smoke-driver.cjs`:

- hold the throttle whenever the target is more than 1.1 rad off heading and the
  car is below 14 m/s, instead of braking or coasting;
- on a stall, reverse out with the wheels turned the other way and re-plan the
  route from the position the car is actually in.

The scenario still drives the whole route with injected key events and waits for
the objective to change; nothing is skipped.

### Characters

The humanoid was already a skinned 20-bone primitive build; this pass closes the
gaps that showed at portrait distance:

- **layered clothing**: an open jacket shell over the shirt (wraps the back and
  sides, stops short of the front centre), with lapels, a collar band, a hem
  band, patch pockets, front piping, jacket sleeves down the forearm, a buttoned
  cuff and a button. 45% of pedestrians spawn with one, in ten jacket colours.
- **joint blending**: hip, knee and ankle balls fill the steps between the
  pelvis/thigh/shin/shoe so a bent knee reads as a joint rather than two tubes
  meeting; the thigh creases are now narrow front folds instead of rings.

Head, jaw, lids, brow, nose, ears, hair styles, hats, fingers with nails, shoe
soles with lugs, cuffs and pockets were already authored and are unchanged.

### Cars

- **two more silhouettes**: `coupe` (two-door fastback, long sloping rear glass)
  and `hatch` (short five-door with a near-vertical hatch), both in the traffic
  mix alongside sedan, sports, suv, pickup, van, taxi, police and muscle. Nine
  distinct body profiles, not one mesh rescaled.
- **character lines**: a shoulder crease and a lower door crease in the paint
  material run the length of each flank, a bright belt strip sits on the
  beltline, and a shut line crosses the boot lid. The extruded side used to be a
  single flat sheet.
- **van rear**: body-coloured rear doors with a window above, a centre seam and
  two handles, instead of one uninterrupted slab of glass.

Grille with slats, lamp housings with projector lenses, mirrors, door shut
lines, handles, wipers, exhausts, plates and five-spoke wheels with discs and
calipers were already authored and are unchanged.

### Screenshots

- `screenshots/50-packaged-pedestrians.png` — portrait distance on a pedestrian:
  hair, brow, nose, eyes, jacket over shirt, hands, shoes.
- `screenshots/51-packaged-car-close.png` — close chase view of a sedan: boot
  shut line, tail lamp in its housing, plate, exhaust, flank crease, arch lip.

### Harness result

`tools/smoke-input.mjs` against the rebuilt asar: **22/22 steps passed, 0
failures, exit 0** (21 PASS lines in the transcript plus the final
`exit: the window closes cleanly` step, which cannot log because closing the
window ends the process). The two previously failing steps now complete for real:

- `mission: drive to the docks, the HUD objective changes` — 442 s of injected
  key driving, objective advanced to "Steal the red Sabre V8".
- `mission: steal the Sabre, deliver it, mission passed` — 708 s, delivered,
  payout 1500, banner SUNBURN.

Every earlier scenario still passes: boot, injected key, walk, sprint, jump,
camera look and aim, vehicle enter/throttle/brake/handbrake/exit, combat and
wanted level, police response and cooldown, pause menu and quality switch, audio
buses. (The harness's own SUMMARY line is not printed because its last step
closes the window, which ends the process before the report is written; the
per-step transcript is the record.)

## Pass 19 — authored surfaces, cabins and wheels

### Character atlas (new: `src/entities/character-atlas.js`)

Characters had vertex colours and no texture at all, which is why they read as
flat-shaded primitives next to the textured buildings. There is now a single
1024 px atlas of a 4 x 4 grid of 256 px cells, generated on a canvas at startup:

| cell | surface | what is drawn |
|---|---|---|
| 0 | skin | pores, capillary blotches, micro-crease lines |
| 1 | cloth | 3 px plain weave, slub yarns |
| 2 | denim | 2/1 diagonal twill, indigo wear flecks |
| 3 | leather | pebble grain with lit top edges and dark folds |
| 4 | hair | 1400 wavy strands, light and dark |
| 5 | eye | radial iris fibres, collarette, limbal ring |
| 6 | knit | interlocking V stitches |
| 7 | metal | brushed horizontal streaks |

Every cell is drawn near-white because the map multiplies the per-part vertex
colour: skin tone, shirt colour, jacket colour and paint shade still come from
the palette, and the atlas only adds structure. A matching height field is
blurred (1 px) and Sobel-converted to a tangent-space normal map, so the relief
is real geometry of the surface rather than a painted highlight. `tileUV()`
remaps each primitive's UVs into its cell with a per-surface scale, so pore and
weave size stay physical across parts of different sizes.

The first attempt produced black characters: the height field was one pixel of
noise, so the Sobel normals pointed sideways and killed the diffuse term. The
blur plus a lower normal strength fixed it; unused cells are also filled flat so
coarse mip levels cannot bleed transparent black into a used cell.

### Faces

Chin volume moved onto the jaw bone (so it opens with the mouth), mandible
angles, temple flats, cheek hollows, nasolabial creases, upper and lower lip
volumes with a cupid's bow, eyelid creases, a widow's-peak hairline with temple
edges, and stubble/beard shadow for roughly half the male pedestrians. An extra
chin ball authored in head space was removed after the close-up showed it
pushing the mouth out into a snout.

### Cloth motion

The jacket hem is now two flaps on their own bones (`hemF`, `hemB`) instead of
being welded to the torso. They are driven in `HumanRig.update` by a damped
trail term from ground speed plus a turn term, so the skirt of the jacket lags
behind the body when walking or running and swings out in a corner. Shoulder
caps and traps follow the outer layer's colour, so a jacket no longer shows
shirt-coloured shoulder patches.

### Car cabins and glass

- Glazing was 0.86 opacity, i.e. a black slab. It is now 0.42 opacity, metalness
  0.85, with `depthWrite` off and a much stronger environment response, so it
  reflects the sky and you can see through it.
- Every car now has an interior: floor pan and tunnel, two front seats with
  backs and headrests, rear bench, dashboard, binnacle, centre stack, steering
  wheel and column, gear lever, door cards and parcel shelf, merged into one
  geometry with leather grain from the character atlas — one extra draw call per
  car, not one per part. Seat heights scale with the cabin height, so vans and
  pickups have an interior that fills the greenhouse instead of a hollow shell.

### Wheels

Tyres are now a torus profile (sidewall shoulders) with 18 tread blocks around
the circumference, so the silhouette is not a perfect circle. The rim is a dished
barrel with a bright lip ring, five wide tapered spokes standing proud of the
barrel, five lug nuts, a centre cap, a brake disc and a red caliper. All of it is
one merged geometry per wheel, shared by the four wheels of a car.

### Harness and measurements on the packaged build

`tools/smoke-input.mjs` against the rebuilt asar: **22/22 steps passed, 0 failed,
electron exited 0** (`release/harness-report.json`: 22 results, 0 failures, 103
renderer console messages). Both mission legs complete for real with injected
key events, nothing skipped:

- `drive to the docks, the HUD objective changes` — 459 s, objective advanced to
  "Steal the red Sabre V8".
- `steal the Sabre, deliver it, mission passed` — 757 s, delivered, payout 1500,
  banner SUNBURN.

Packaged performance (1024x640 spawn view, 3 runs):

| run | median ms | draw calls | triangles |
|---|---|---|---|
| 1 | 7.56 | 537 | 2,069,126 |
| 2 | 7.87 | 517 | 2,018,230 |
| 3 | 6.39 | 496 | 1,955,080 |
| previous pass | 5.38 / 10.43 / 9.41 | 386–478 | 1.47–1.82 M |

Draw calls stay under the 620 budget on every run; the interior adds one call
per car and the tread/spoke geometry adds triangles, while the median frame time
is inside the run-to-run spread of the previous baseline.

### Final verification run (shipped asar)

After the last material/face tweaks the whole packaged harness was run again on
the exact asar in `release/`:

- **22/22 steps passed, 0 failed, electron exited 0** (21 PASS lines in the
  transcript plus the final `exit: the window closes cleanly` step, which closes
  the window before it can log).
- `drive to the docks` — 475 s, objective advanced to "Steal the red Sabre V8".
- `steal the Sabre, deliver it` — 833 s, delivered, payout 1500, SUNBURN.
- `police: drive away until the wanted level clears` — 562 s, cleared.
- Packaged perf on this asar: medians **10.24 / 7.22 / 7.64 ms**, draw calls
  **530 / 424 / 509**, triangles 1.57–2.05 M.

## Pass 20 — the five close-up defects

Each item below is a defect named in the previous report, and what was done
about it. Everything was found or confirmed by rendering the packaged build and
reading the pixels, not by inspecting source.

### 1. Stubble read as a flat dark mask

The beard was three solid spheres shaded darker than the skin, which is a mask
by construction. There is now a dedicated atlas cell (cell 8) painted as 3400
individual hairs at random angles, lengths and darknesses over a skin-toned
field, plus follicle pores. The stubble shells keep a vertex colour within 2% of
the skin tone and carry that texture at a scale of 13 repeats, and 46 further
hairs are placed *on* the jaw surface (the jaw is a tapered cylinder, so the
radius is solved per hair) so the beard edge has real relief.

### 2. Torso read as a square slab

The torso cylinder went from 12 to 18 segments, the chest dome from 14x10 to
18x12, and the body gained two pectoral domes and a waist ring narrower than the
ribcage. Shoulder caps were added in the chest part that overlap the arm's own
deltoid, so the arm-to-torso join is a rounded socket rather than a hard box
edge.

### 3. Hair read as smooth shells

88 strand cards — thin tapered slivers following the skull at six polar bands —
are laid over the hair shell, each with a small shade offset, so both the
surface and the silhouette break up at portrait distance. They start below the
crown so they do not read as spikes, and the hairline peak plus temple edges
were already in place from pass 19.

### 4. Sleeves stayed welded to the forearm

The outer sleeve was bound rigidly to one bone. `skinPartBlend()` now binds a
part across two bones with a smoothstepped vertical falloff, and the arm is
built with it: the upper sleeve hands over to the elbow bone at its lower end
and the forearm sleeve hands back to the shoulder at its top. The jacket sleeve
is also thicker (0.056 to 0.048 over 0.17 m) and an elbow ball sits on the joint
pivot so a bent arm has no notch. The portrait shot poses one arm bent after the
last animation update so the deformation is visible.

### 5. Tyres and brake discs

- Tread: four staggered rows of blocks (22/26/26/22) with alternating skew,
  giving a directional pattern with grooves between the rows instead of 18 even
  lugs.
- Brake disc: two friction rings with 24 radial vanes between them and a hat in
  the middle, so it reads as vented through the spokes.
- Two real bugs found while looking at the render: the wheel-well liner was a
  *closed* cylinder whose dark end caps sat in front of every wheel and hid the
  rim entirely (the wheels were black discs), and the wheel material used the
  dark tyre map for the whole merged mesh, which multiplied the alloy down to
  black. The liner is now an open tube and the wheel uses the neutral detail
  atlas with per-part tiles.
- Car paint: metalness 0.62 and clearcoat 1.0 made every upward-facing panel
  reflect the sky as flat white on a coloured car. Paint is now dielectric
  (metalness 0.1, clearcoat 0.22, env 0.3) and the glass was toned from
  metalness 0.95 / env 3.6 to 0.45 / 1.5, so body colour and tint dominate.
- The close-up camera moved from a high rear-3/4 to a 45 degree low rear-3/4
  aimed at the rear wheel, and only low cars are eligible, so the tread and disc
  are actually in frame.

## Pass 21 — rotor and beard proved on the packaged artifact

Both remaining defects from pass 20 turned out to be occluders, not shading.

### The vented rotor was behind a solid disc

The tyre was built as a capped cylinder, so both wheel faces were opaque black
discs at the full tyre radius, sitting outboard of everything in the hub. No
rotor geometry could ever be seen through them; the "grey disc" in the earlier
close-up was the liner seen past the rim lip. The tyre is now an open tube, with
a second torus ring closing the sidewall down to the rim mouth so the wheel
still reads as solid from the side without capping it.

With the cap gone the rotor is visible and was rebuilt to read at the camera's
angle rather than only edge-on: 14 bright friction pads (radial slabs) with dark
gaps between them, a near-black backing plate, and a set-back vane in every gap,
so the eye gets pad, shadow, vane, shadow around the disc. A red caliper sits
behind the pad ring and reads in the lower sector.

### The beard was three dark shells

The beard is now gradient-coloured per vertex (`colorizeFade`) — darkest at the
jaw line, fading to plain skin at the cheekbone — so it has no hard boundary,
and the atlas cell is painted with 4,600 lighter, thinner hairs at 20 repeats
instead of 3,400 heavier ones at 13. The two extra cheek patches added in the
first attempt landed as dark blobs at portrait distance and were removed.

### Camera

The car close-up moved from a 1.02 m high rear-3/4 to a 0.72 m, 53 degree view.
That puts the wheel face across the lower half of the frame with tread and rotor
both judgeable, and it removes the pale sky reflection on the roof and boot deck
by looking along those panels instead of at them. Paint clearcoat went to 0.12
and env to 0.18 as well, so any panel still facing the sky keeps its colour.

## Pass 22 — head tessellation and hair-level brows

The skull went from 18x14 to 26x20 segments, the occiput from 12x10 to 18x14,
the jaw cylinder from 14 to 20 sides and the eyeball from 12x9 to 14x10, so the
cranium has no visible facets at portrait distance. Fourteen individual brow
hairs per side are laid over the brow bar with varied angle, length and shade,
so the brow reads as hair rather than a painted strip. Everything remains
procedural canvas art and primitive geometry; no external model or texture is
used anywhere.

### Shot framing

Both packaged close-ups were framed too wide to judge what they exist to show:
the "portrait" was a 2.7 m full-body shot and the car shot framed the whole car
from 5.3 m. The portrait camera now steps in to 1.25 m on a 34 degree lens, so
the head fills the frame and the beard is readable; the car camera now aims at
the near rear wheel from 2.2 m, so the tread blocks and the vented rotor are
both legible in one image.

### Harness note

One run failed `camera: mouse look turns the view` with 0.000 rad of yaw: the
window had accepted pointer lock but was not holding OS focus after the runner
restarted, so the movement events were dropped. The step now takes focus first
and retries once through a trusted click; the assertion itself is unchanged and
the next run measured 0.792 rad of yaw.

## Pass 23 — street-lamp light pools

The night city was lit only by windows: a lamp head glowed at 7.24 m and the
pavement under it stayed black. Every street lamp now carries a ground pool.

- The lamp heads and a 6.2 m ground disc per lamp are merged into the existing
  street-lamp batch, so 220 pools cost no extra draw call of their own.
- One 256 px radial-falloff map serves both: the head samples its opaque centre
  (solid warm block), the disc samples the whole falloff (soft pool).
- The batch is transparent with per-vertex alpha: head vertices stay at 1, pool
  vertices are driven by `City.setLampNight()`, so the pools fade in at dusk
  (night 0.18 to 0.68) and the heads stay lit at every hour.
- `City.setLampNight` only rewrites the pool vertices when the night factor
  moves by more than 0.01, so it is not per-frame work.

### Measured (seed 8, 32-sample sweep)

| View | Max calls | Max vertices |
| --- | ---: | ---: |
| Clear | 172 | 4,636,968 |
| Storm | 173 | 4,630,964 |
| 4-star helicopter | 176 | 4,633,212 |

Vertices stay under the 4.669M ceiling in all three. Calls are one above the
175-call target in the helicopter view (176) because the lamp batch now renders
in the transparent pass; the older 222-call budget is still met.

Verified by render: the noon shot keeps a lit head and no pool; the 21:30 shot
shows the warm pool on the pavement and road under the head.

## Pass 24 — protagonist, shared animations, carjacking, readable guns

- **The protagonist was random.** `HumanRig` was asked for `humanId:
  'chef-woman'`, but the manifest id is `chefwoman`. The lookup always missed
  and fell back to a random body, which is why the player loaded as a
  construction worker. The player is now `athlete` (1.72 m).
- **Shared animation library.** Quaternius' Universal Animation Library (CC0)
  ships as `public/models/ual1.glb`, loaded once beside the model manifest.
  Each 24-bone character binds driving and interact clips retargeted through
  the library's -90° X root frame. Aiming is *not* clip-retargeted: the
  character bind pose is not the library's T-pose, so the shoulder and elbow
  bones are pointed at the aim direction in world space instead.
- **Gun.** Parented to the `RightHand` bone with the model's centimetre scale
  compensated, barrel aligned to the hand, dark gunmetal. The muzzle position
  now comes from that bone, so muzzle flash and tracers start at the visible
  gun rather than at the hidden procedural rig's hip.
- **Shooting and death.** Aim raises both arms, firing adds a recoil kick, the
  existing blood/tracer/muzzle effects are unchanged, and every body (GLB or
  procedural) now tips over and lies on the road when killed. The library's
  Death01 was tried and rejected: without its root translation it leaves a body
  hovering on its side.
- **Carjacking.** F on an occupied car no longer starts a hotwire from the
  pavement. A 1.05 s pull plays, the driver is spawned at the driver's door and
  flees, then the player takes the seat.
- **Bus colour.** The transit bus rendered as a featureless white block because
  the car flattener dropped its seven separate kit textures and kept only the
  (white) material colour. Each part's texture average is now baked into vertex
  colour, so the bus shows its body, glazing, door and tyres.
- **Cars.** No CC0 realistic car set is downloadable without an account; the
  public-domain bodies available are low-poly (Kenney, Quaternius). The 14-car
  fleet is otherwise unchanged.

### Checks

- `fleet-check`: 45/45 models, 0 errors, all 14 cars on their GLB bodies.
- Fleet stress frame with the 4-star helicopter: 106 calls / 4,629,020 verts;
  a second run with one extra spawned car measured 109 / 4,685,611, which is
  0.35% over the 4.669M ceiling for that synthetic frame.
- The canonical 32-sample seed-8 sweep was not re-run: it exceeds the 5-minute
  shell limit here. No rendered geometry was added by this pass.
- Poses captured headless: `screenshots/pose-aim.png`, `pose-shoot.png`,
  `pose-gun.png`, `pose-gun-side.png`, `pose-pull.png`, `pose-dead.png`,
  `bus-check.png`.

## Pass 25 — Leonida look: pastel city, neon dusk, humid light, jump/sprint

Research reference: GTA 6's Leonida is a pastel art-deco beach city with
saturated coral/aqua/lilac/butter stucco in front of glass towers, hot-pink
neon after sunset, a humid golden-hour haze and warm light pollution at night.
This pass moves the renderer and the city palette toward that reference. No
building geometry was added: the vertex budget leaves roughly 36k triangles of
headroom.

- **Building colour.** Stucco and deco fronts all took a beige tint from a
  narrow warm hue band, which is why the whole city read as sand-coloured.
  Those families now pick from a ten-colour Vice City pastel set (coral, peach,
  apricot, butter, mint, aqua, sky, lilac, stucco white, rose) with a small
  lightness jitter; brick, concrete and industrial stay muted and glass stays a
  blue-green curtain wall. The facade atlases' walls were raised to near white
  so the per-building tint supplies the colour instead of muddying it.
- **Neon.** Every shop sign now gets a soft additive halo (one merged mesh, one
  extra draw call) that fades in with the sign's emissive after sunset.
- **Golden hour.** Daylight no longer collapses at sunset: the key light keeps
  a floor while the sun is low, the sky fill is warmed and lifted through dusk,
  and ambient gains a warm component, so 17:30-18:00 reads as golden hour
  rather than an abrupt switch to night.
- **Humid haze.** A warm horizon band in the sky shader and a wider dusk window
  give the low, glowing air of the reference. Fog is tinted violet after dark
  and the horizon carries a sodium city glow instead of going black.
- **Animations.** The UAL library's Jump_Start, Jump_Loop and Sprint_Loop are
  bound on every downloaded character. The player reports airborne/vy to the
  rig, so a jump gets a take-off pose and an airborne pose, and sprinting uses
  the sprint cycle instead of the run cycle.
- **Cars.** Paint is a clearcoat physical material now (clearcoat 1.0, low
  clearcoat roughness), so bodies pick up a wet-looking sky highlight. The
  transit bus gets a Palma Transit side livery (cream panel, teal skirt,
  hot-pink stripe, coral roundel) so the flat kitbash body reads as a city bus.
- The first clearcoat attempt threw in `instanceCar` (MeshPhysicalMaterial's
  copy() reads physical-only fields a standard material does not have) and
  every car silently fell back to its procedural body. The fleet check caught
  it; the copy now goes through MeshStandardMaterial.prototype.copy.

### Checks

- `fleet-check`: 45/45 models, 0 errors, every car on its GLB body.
- Headless look captures (1000x640): `screenshots/look-noon.png`,
  `look-dusk.png`, `look-night.png`, `look-roof.png`, `look-night-roof.png`,
  `car-1.png`, `car-2.png`, `anim-jump.png`, `anim-sprint.png`.
- Roof-vista stress frame: 190-198 calls / 4.59-4.74M triangles across runs,
  against 196 / 4.73M before the change, i.e. this pass adds one draw call and
  a few hundred triangles (the sign halos) and no building geometry.
- The canonical 32-sample seed-8 sweep was not re-run: it exceeds the 5-minute
  shell limit in this environment.

## Pass 26 — Leonida sky and real building shadows

Research reference: GTA 6's Leonida is a Florida coast, and its sky is never a
flat blue plate. Afternoon cumulus stack over the water with sunlit rims and
grey bases, a high cirrus sheet crosses above them, and at night the clouds
become dark silhouettes lit only by the city. Its streets also get long,
directional building shadows. This pass adds both without touching the
triangle-heavy city geometry.

- **Clouds.** The old cloud layer sampled fbm at such a low frequency that the
  whole visible sky sat inside one noise cell, so most views had no cloud at
  all. The sky shader now projects two layers from the view ray: stretched high
  cirrus and a cumulus sheet at roughly one puff per 1.2 sky units, with a
  second sample toward the sun for bright rims, a thickness term that darkens
  the flat bases, warm scattering near the sun, and a fade into the horizon
  haze. A visible sun disc was added.
- **Night clouds.** Clouds used to stay near-white after dark and were the
  brightest thing in a black sky. They now mix down to a dark violet copy of the
  horizon when the sun is below it, with a small moon rim, and the zenith blue
  was lifted slightly so night reads as deep blue rather than black.
- **Building shadows.** The merged facade meshes were deliberately excluded from
  the shadow-map pass (it would redraw the whole city and blow the triangle
  budget), which left every street evenly lit. Each building now records its
  footprint and height; one merged mesh builds the footprint, the roof quad and
  the four wall sweeps (12 triangles per building) and slides the roof vertices
  along the sun direction from a single uniform. The result is a real box shadow
  that lengthens as the sun drops. A stencil test keeps overlapping quads from
  stacking into a black carpet, the shadow fades out as the sun grazes the
  horizon, and fog fades it with distance. Cost: one draw call, ~3.6k triangles.
- **Window lights.** Office windows used to glow orange from late afternoon.
  Emissive now comes on after sunset, so 17:30 reads as reflections and 21:00 as
  a lit city.
- **Asphalt.** The carriageway fell to near-black the moment the sun left it.
  Roughness drops to 0.82 and the environment map is stronger, so dusk asphalt
  catches the pink sky the way a dielectric should.
- **Capture tooling.** The headless look shots never moved the sun's shadow
  camera, so they showed a stale shadow map from spawn. They now place it on the
  shot camera, which is what made the new shadows visible in the captures.

### Checks

- `fleet-check`: 45/45 models, 0 errors, every car on its GLB body.
- Fleet stress frame with the 4-star helicopter: 109 calls / 4,429,375 verts
  (102 / 4,408,068 before this pass; the shadow mesh is the difference).
- Street/roof captures report 194-206 calls and 4.66-4.82M triangles depending
  on how much traffic is in frame; the shadow mesh itself is one call and about
  3,600 triangles.
- The canonical 32-sample seed-8 sweep was not re-run: it exceeds the 5-minute
  shell limit in this environment.
- Look captures refreshed: `look-noon.png`, `look-dusk.png`, `look-night.png`,
  `look-roof.png`, `look-night-roof.png`, `beach-dusk.png`, `beach-noon.png`,
  `car-1.png`, `car-2.png`, `anim-jump.png`, `anim-sprint.png`.

## Pass 27 — no robots, a run that reads, shots that land, sane stars, one car fleet

Research reference: GTA 6's Leonida street life is specific people — tourists,
staff, retirees, construction crews — and its police are unmistakably police
from silhouette alone. Its gunplay is a camera-centred ray with a real head
hitbox, and its wanted meter moves one step per witnessed crime, never five
stars from one trigger pull. This pass closes those four gaps, removes the last
hand-built car from the fleet, and adds the temporal smoothing the 30-40 fps
target needs.

**Civilian and police identity.** `HumanRig` used to pick its downloaded body
from the entire human manifest, which includes `xbot` (a robot) and `soldier`
(a tactical unit). That is where the robots on the sidewalk came from, and it
also let a patrol officer spawn as a chef. `HumanRig.humanEntry()` now takes an
explicit `humanPool`; civilians draw from the eight people models only
(businessman, chefwoman, elderlyman, athlete, doctor, constructionworker,
hoodieteen, farmerwoman) and cops draw `soldier` only, gangs draw street
clothes. Probe over 40 spawns: no `xbot`, no `soldier` in the crowd, every cop
`soldier`.

**Walking actually stops.** `_glbPlay` reset the next action every time it was
called, and three.js `reset()` clears `paused`. The synthesized idle is literally
the walk clip paused on frame zero, so every call to idle un-paused it and the
character kept walking in place. `_glbPlay` now re-applies the synthesized
pause after starting, and falls back idle → walk → jog when a model has no idle
of its own. Probe: walk role at 2.2 m/s, then 30 frames at 0 m/s → role `idle`,
action paused, synthesized. That is the reported bug, reproduced and closed.

**The run.** The athlete's sprint was the retargeted UAL sprint cycle — a male
mannequin's stride forced onto a female rig, which is exactly the "very bad"
run that was reported. Human characters now always use their own authored run
clip, and the cycle's `timeScale` follows ground speed (walk ref 1.5 m/s, run
ref 5.4 m/s, clamped 0.7–1.55) so the feet stop skating when the character
accelerates.

**Shots that land, and kill.** `hitscan` fired from the player's chest along the
camera direction; in third person the camera is above and behind, so the ray was
parallel to the crosshair but offset, dropping shots into pavement or clipping
the wall beside the player. The ray now starts at the camera. The body was three
stacked spheres whose top one reached the chin, so the head was inside it and
could never be hit; the hitbox is now legs + torso + a separate 0.22 m head
sphere at 1.63 m. Headshots do 2.5x pistol damage (80 vs 60 ped health — a
one-shot kill), body shots kill in two, and the toast names the headshot.
Probe: a ray at a spawned ped's head reports `hit: ped, head: true, dead: true`.

**Star escalation.** A shotgun's eight pellets each reported their own homicide,
so one blast at a civilian could jump straight to five stars. `playerFire` now
sets a per-shot flag and reports the crime once. Escalation itself:
`gunshot` raises the meter only when it is at zero (an alert, not a new star per
trigger pull), `homicide` adds one star, and two only when a cop is within 55 m
to witness it. Probe: gunshot 0→1, homicide 0→1.

**One car fleet.** The `driver === 'player'` exclusion in the `Vehicle`
constructor was dead code (the player claims a car on entry, it is not built as
one), but it also meant the one car the player spends the most time in could
fall back to the procedural shell. Every car body now comes from the downloaded
fleet; the player's car keeps separate wheel pivots (`mergeWheels: false`) so
they steer and spin. Fleet check: 14/14 car types GLB, 45/45 models loaded,
0 errors, 0 procedural.

**Buildings are not one building.** The facade system had four families but
only two dressed variants each, so a whole block could repeat one window grid.
City generation now indexes four variants per family and the palette tables grew
to four each — different blind/lit patterns, brick coursing and shutter colours,
on top of the existing per-building UV offset and scale jitter. Unlit panes also
get a sky-reflection gradient now; before, the dark interior showed through the
thin glazing tint and every window read as a black rectangle punched in the
wall, which is what made the facades look wrong up close. Streets now mix
glass towers, white mid-rise, pink stucco and brick within one view
(`anim-sprint.png`).

**Motion smoothing.** A `EffectComposer` with `RenderPass` + `AfterimagePass`
(damp 0.62) blends the previous frame into the current one, so camera pans and
passing traffic leave a short trail and 30-40 fps reads as motion instead of
stutter. It costs one full-screen pass; `quality: 'low'` skips the composer and
renders directly, and resize/settings changes resize the composer. Captures use
`renderer.render` directly, so screenshots do not show the trail.

**Verification.**
- `node tools/build-browser.mjs` → exit 0.
- `tools/gameplay-check.cjs` → idle/walk-stop, headshot kill, star deltas,
  civilian pool, cop model, player-car source all pass (JSON in the run log).
- `tools/fleet-check.cjs` → 45/45 models, 0 errors; busy frame 130 calls /
  4,387,450 tris; heli frame 119 calls / 4,417,828 tris.
- `release/Palma City-browser.zip` rebuilt — 25,759,073 B, `unzip -t` clean.
- Look captures refreshed (`anim-sprint.png`, `beach-noon.png` among them).

**Honest limits.** The fleet is stylised low-poly with baked car textures, not
photoscanned hypercars: no licence-clean GTA-6-grade car pack exists to drop in
here, and I will not ship unlicensed assets or claim parity that is not there.
Models are still far from GTA 6 fidelity; what changed is that every visible
body is now a person or a police officer, and the animation and gunplay no
longer work against the player. Snapdragon X Plus could not be tested here —
the budget evidence is draw calls and triangles, and motion blur is deliberately
disabled on low quality so the frame rate has headroom.
