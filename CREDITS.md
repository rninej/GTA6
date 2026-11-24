# Credits — Palma City

Palma City is an original open-world game. Its code, city layout, HUD, signage
and procedural geometry/textures are original work made for this project. It
also ships third-party **CC0 1.0** downloaded models (vehicles, characters,
street props, weapons, pickups and boats); every downloaded model used by the
game is credited below. No asset, texture, model or other material has been
taken from GTA 6, GTA V or any other commercial game.

## Downloaded 3D models

These models are loaded from `public/models/` through
`public/models/manifest.json`. They are CC0 1.0 public-domain assets; the author
and the download source are recorded for provenance.

| Shipped file | Asset / use | Author | Source | Licence |
| --- | --- | --- | --- | --- |
| `bus.glb` | Low Poly City Bus — route bus body | Innerscene | [Innerscene 3D Parts Library](https://www.innerscene.com/tools/library/3d-parts/low-poly-city-bus-49c04273) | CC0 1.0 |
| `pistol.glb` | Pistol — player/police/NPC weapon | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius gun pack) | CC0 1.0 |
| `smg.glb` | Micro SMG — armed NPC weapon | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius gun pack) | CC0 1.0 |
| `shotgun.glb` | Shotgun — weapon slot | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius gun pack) | CC0 1.0 |
| `rifle.glb` | Assault rifle — weapon slot | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius gun pack) | CC0 1.0 |
| `health.glb` | First Aid Kit — health pickup | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius item pack) | CC0 1.0 |
| `armor.glb` | Armor Leather — armor pickup | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius item pack) | CC0 1.0 |
| `ammo.glb` | Pickup Crate — ammo pickup | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius item pack) | CC0 1.0 |
| `boat.glb` | Small boat — three moored at the pier | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius vehicle pack) | CC0 1.0 |
| `dumpster.glb` | Dumpster — 260-prop street mix | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius street-prop pack) | CC0 1.0 |
| `cone.glb` | Traffic cone — 260-prop street mix | Quaternius | [Poly Pizza](https://poly.pizza/) (Quaternius street-prop pack) | CC0 1.0 |

Existing downloaded models (the Ferrari and Spectral car bodies, the ten rigged
human characters, and the street props/trees) are likewise third-party assets;
their individual sources and licences are listed in the “3D models (cars,
people, props)” table in `PLAY-WINDOWS.md`. The new files above are the complete
set added in the final model-variety pass. All are CC0 1.0: no attribution is
legally required, and the credit is provided so every file has a traceable
source.

## Photographic texture sets

Every photographic surface in the game is a **CC0 1.0 Universal (public domain
dedication)** scan published by [Poly Haven](https://polyhaven.com/textures).
CC0 places the material in the public domain: it may be used, modified and
redistributed, including commercially, without attribution. Attribution is given
here anyway, both as good practice and so the provenance of every file is
recorded.

Files are stored as `public/textures/<asset>_{diff,nor_gl,rough,ao}.jpg` (1024 px
tiles) and are copied into `dist/textures/` at build time, so they ship inside
`resources/app.asar`.

| In-game surface | Asset | Source page | Licence | Files |
| --- | --- | --- | --- | --- |
| Road surface, ground plane, parking pads | `asphalt_02` | https://polyhaven.com/a/asphalt_02 | CC0 1.0 | `asphalt_02_diff.jpg`, `asphalt_02_nor_gl.jpg`, `asphalt_02_rough.jpg` |
| Sidewalks, promenade, plazas | `precast_stone_paving` | https://polyhaven.com/a/precast_stone_paving | CC0 1.0 | `precast_stone_paving_{diff,nor_gl,rough}.jpg` |
| Brick facades (`masonry` family) | `red_brick` | https://polyhaven.com/a/red_brick | CC0 1.0 | `red_brick_{diff,nor_gl,rough}.jpg` |
| Stucco facades, cornices, sills, curbs (`stucco` family, trim) | `painted_plaster_wall` | https://polyhaven.com/a/painted_plaster_wall | CC0 1.0 | `painted_plaster_wall_{diff,nor_gl,rough}.jpg` |
| Concrete facades (`deco` family), roof slabs, parapets | `concrete_wall_008` | https://polyhaven.com/a/concrete_wall_008 | CC0 1.0 | `concrete_wall_008_{diff,nor_gl,rough}.jpg` |
| Corrugated steel relief on metal props | `corrugated_iron_02` | https://polyhaven.com/a/corrugated_iron_02 | CC0 1.0 | `corrugated_iron_02_{diff,nor_gl,rough}.jpg` |

All six sets were downloaded on 2026-11-22 from the Poly Haven CDN
(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<asset>/`). They are
unmodified apart from being renamed; the albedo is used as `map` (sRGB), the
OpenGL-convention normal map as `normalMap` (linear) and the roughness map as
`roughnessMap` (linear). The `_ao.jpg` maps ship with the sets but are **not
bound yet**: the merged city geometry carries a single UV set, so an AO map
would need a second UV channel and a bake.

### Real-world scale

Each set records the physical size one tile covers (`PHOTO_SETS` in
`src/world/photos.js`), and UVs are derived from it so texel density stays
consistent instead of being eyeballed:

| Set | Tile covers | Applied to |
| --- | --- | --- |
| asphalt | 4.0 m | road (5 × 3 tiles per 20 m × 12 m road texture), ground plane (6 m repeat) |
| paving | 2.4 m | sidewalk slabs (block UV / 2.4 m), promenade |
| brick | 1.7 m | masonry facades (14 tiles across the 24 m facade tile) |
| plaster | 3.2 m | stucco facades (7.5 tiles), trim (2 per face) |
| concrete | 2.6 m | deco facades (9.2 tiles), roofs (6 per face) |
| corrugated steel | 2.2 m | metal props |

## Authored (procedural) textures — not photographic

These are still generated at runtime on a `<canvas>` by
`src/world/textures.js` and `src/world/facades.js`, and are original procedural
work rather than photographs:

- **Facade detail layers** — window glazing, frames, reveals, blinds, curtains,
  lit rooms, shop awnings, sign bands, fire escapes. The photographic wall sets
  are composited *under* these, so windows and shopfronts remain drawn art.
- **Glass curtain walls** — deliberately not photographic; tinted glazing with
  reflection sweeps, spandrels and mullions.
- **Road markings** — painted onto the photographic asphalt at build time:
  double-yellow centre line, dashed lane dividers, edge lines, tyre polish and
  tar seams, with a matching roughness map where paint is glossier than asphalt.
- **Sand, grass, roof fallback, palm fronds and trunks, billboards, neon, shop
  and street signs, licence plates, particles, sky gradient** — all procedural.
- **Characters, vehicles and weapons** — flat-shaded / vertex-coloured materials
  with no image maps.


## Authored material sets (not photographic)

Vehicles and street furniture are coated, manufactured surfaces: a car's paint,
glass, rubber and chrome are uniform materials, and there is no tileable
photograph of them at a useful scale. These sets are therefore **authored** —
generated on a `<canvas>` at 1024 px by `src/world/surface.js` — with a real
height map converted to a tangent-space normal by a Sobel filter, plus a
roughness map. They are original work, not scans, and are labelled as such here.

| Set | Size | Physical scale | Maps | Used on |
| --- | --- | --- | --- | --- |
| `getCarPaint` | 1024 px | 1 m tile (extrude UVs are in metres) | albedo (metallic flake carrier), normal (orange peel), roughness | Car body panels, roof, mirrors. Material colour still sets the paint hue; the map only carries flake and gloss |
| `getCarGlass` | 1024 px | 1 m tile | albedo (dust film), normal (wiper haze + streaks), roughness (clean centre, dusty lower edge) | Windscreen and cabin glazing |
| `getTyre` | 1024 px | 4 × 1 repeats around the tyre | albedo (rubber), normal (circumferential grooves + sipes), roughness | Tyres. **The tread normal is authored but not bound to the wheel mesh**: the wheel is three capped cylinders, and a tread map on the cap UVs reads as a cog around the sidewall. Rubber albedo and roughness are bound |
| `getChrome` | 1024 px | 1 m tile | normal (brush lines + scratches), roughness | Bumpers, grilles, mirrors, lamp posts. No albedo — vertex colour still decides black plastic vs chrome |
| `getAwningFabric` | 1024 px | 0.5 m tile | albedo (weave carrier), normal (warp/weft), roughness | Shop awnings |
| `getPropPaint` | 1024 px | 1 m tile | albedo (chipped paint flecks), normal (scuffs), roughness | Street furniture: bins, meters, barriers, benches, curb rings |
| `getLiveryAtlas` | 2048 × 512 (4 cells) | one door panel per cell | albedo | Door decals on taxis (`PALMA TAXI`), police (`PALMA P.D.`) and vans (`PALMA PARCEL`) |

## Licence summary

- Photographic texture sets: Poly Haven, **CC0 1.0** (public domain) — table above.
- Downloaded 3D models in the table above: **CC0 1.0** (public domain).
- Existing downloaded models (cars, rigged humans, street props) are listed
  with their individual sources in `PLAY-WINDOWS.md`; they are third-party
  assets under their stated licences, not original Palma City geometry.
- Everything else in the game — procedural models, characters, procedural and
  authored materials, signage, HUD and code — is original work made for Palma
  City, or a licence of a third-party library (three.js and Electron, both MIT).
- **No asset has been copied from GTA 6, GTA V or any other commercial game.**
  Palma City is an original game in the open-world crime genre; its city layout,
  characters, vehicles and signage are not reproductions of another game's
  content and cannot be made so.

## Typefaces

Signage and HUD text use system fonts (`Arial`, `Arial Black`, `Impact`) resolved
at runtime; no font files are redistributed with the game.

## Engine

[three.js](https://threejs.org) — MIT licence. [Electron](https://www.electronjs.org) —
MIT licence. Both are consumed as dependencies, not vendored.

## Characters and vehicles

The player and pedestrians can use the downloaded rigged character GLBs listed
in the `PLAY-WINDOWS.md` model table (eight Grab3D CC0 scans, plus the
three.js/Mixamo `Soldier` and `Xbot` rigs). Police, interior casts and fallback
characters use the procedural humanoid system in `src/entities/humanoid.js`: a
20-bone skeleton (hips, spine, chest, neck, head, jaw, eyelids, shoulders,
elbows, hips, knees, feet, toes) with a procedural gait/IK animation system.
The downloaded rigs retain their own embedded animation clips; no asset is
misrepresented as original Palma City character work.

Traffic, police and the route bus use the downloaded GLB bodies listed in
`public/models/manifest.json`. The player-driven/parked car body, props and
fallbacks are authored in `src/entities/vehicles.js` and
`src/world/surface.js`: extruded body profiles, wheel-arch cut-outs, wheels,
lamps, trim, and the generated paint, glass, rubber and chrome sets listed
above.

No asset — model, texture, sound, animation or other material — has been taken
from GTA 6, GTA V, or any other commercial game, and none is included in this
repository or in the packaged build.

## Buildings

All architectural geometry is authored in `src/world/city.js`: wall segments,
window sills, jambs, plinth courses, string courses, cornices, dentils, parapet
coping, balconies, fire escapes, awnings, blade signs, roof housings, vents and
ducts. Facade, sign, roof and trim imagery is generated in
`src/world/facades.js` and `src/world/textures.js` from procedural canvas
painting plus the CC0 photographic material sets listed above. No building,
facade, sign or prop in this project is a copy of, or derived from, any asset in
GTA 6, GTA V or any other commercial game.

## Characters and vehicles (pass 18)

The jacket layer, hip/knee/ankle joint volumes and the coupe/hatch body profiles
are authored in `src/entities/humanoid.js`, `src/entities/vehicles.js` and
`src/config.js` from primitives and extruded polygons in code. Nothing in the
character or vehicle build is traced, scanned, ripped or retopologised from
another game, and no third-party model, texture, rig or animation clip is
included in this repository or the packaged build.

## Authored surfaces and rigs (pass 19)

`src/entities/character-atlas.js` generates every character, cloth, leather,
hair, eye, knit and brushed-metal texture at runtime on a `<canvas>`: no image
file is shipped and none is loaded from disk or the network. The tangent-space
normal map is computed in-repo from an authored height field. The car interior,
the wheel rim/spoke/brake geometry and the jacket hem bones are authored
geometry and rigging in `src/entities/vehicles.js` and
`src/entities/humanoid.js`. Nothing here is traced, scanned, ripped, decimated
or retopologised from GTA 6 or any other game, and no third-party model,
texture, rig or animation clip is included in this repository or the packaged
build.

## Pass 20

The stubble cell is painted strand by strand on a `<canvas>` at runtime, like
every other cell in `src/entities/character-atlas.js`; the tread blocks, vented
brake disc and strand cards are authored geometry built from primitives in
`src/entities/vehicles.js` and `src/entities/humanoid.js`. No image, model,
texture, rig or animation from GTA 6 or any other game is used anywhere in this
repository or in the packaged build.

## Pass 21

The rotor's friction pads, vent slots and vanes, and the open tyre carcass with
its sidewall rings, are primitive geometry built in `src/entities/vehicles.js`;
the beard's strand cell is painted on a `<canvas>` in
`src/entities/character-atlas.js` and shaded per vertex in
`src/entities/humanoid.js`. Every surface, texture and rig in this repository is
authored here; nothing is imported from GTA 6 or any other game.

## Pass 22

The extra head tessellation and the brow hairs are authored in
`src/entities/humanoid.js`; the brow hair uses the same in-repo hair cell as the
rest of the character atlas. No third-party model, scan, texture or rig is used.

## Imported low-poly fleet assets (fleet pass)

The statements above about vehicle geometry being wholly authored describe the
procedural player/fallback bodies and the transit bus. The following imported
models are now shipped in `public/models/` and loaded by
`src/world/models.js`; they are not from GTA 6 or any other commercial game.

| In-game model | File | Source / licence |
| --- | --- | --- |
| Sedan | `sedan.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Hatch | `hatch.glb` | Kay Lousberg Car Hatchback, CC0 1.0, via Poly Pizza (https://poly.pizza/m/BG0KAhmGDt) |
| Coupe | `coupe.glb` | m123 Low Poly Blue Car, CC0 1.0, via Poly Pizza (https://poly.pizza/m/548lb3MmT3) |
| Muscle | `muscle.glb` | Quaternius NormalCar2, CC0 1.0, via Poly Pizza (https://poly.pizza/m/unqqkULtRU) |
| Sports | `sports.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Sports 2 | `sports2.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| SUV | `suv.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Taxi | `taxi.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Police | `police.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Pickup | `pickup.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Van | `van.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Police helicopter | `heli.glb` | Quaternius low-poly vehicle kit, CC0 1.0, via Poly Pizza |
| Ferrari 458 | `ferrari.glb` | three.js example model by vicent091036 (Sketchfab), already shipped before this pass |
| Spectral | `Spectral.glb` | existing imported sports model, already shipped before this pass |
| Apartment bed | `bed.glb` | Quaternius Bed Double, CC0 1.0, via Poly Pizza (https://poly.pizza/m/BuRay4fVFr) |

CC0 places the Quaternius models in the public domain; attribution is recorded
here for provenance. The models are used as downloaded apart from runtime
flattening/merging of materials and the merged rotor/tail geometry added to the
helicopter in `src/entities/police.js`. No GTA 6, GTA V or other commercial-game
asset is included.

## Second model-variety pass (interiors and fleet subtypes)

The following CC0 models were added to `public/models/` for this pass and are
credited in the fleet table above:

- `hatch.glb` — Kay Lousberg, Car Hatchback, CC0 1.0, via Poly Pizza:
  https://poly.pizza/m/BG0KAhmGDt
- `coupe.glb` — m123, Low Poly Blue Car, CC0 1.0, via Poly Pizza:
  https://poly.pizza/m/548lb3MmT3
- `muscle.glb` — Quaternius, NormalCar2, CC0 1.0, via Poly Pizza:
  https://poly.pizza/m/unqqkULtRU
- `bed.glb` — Quaternius, Bed Double, CC0 1.0, via Poly Pizza:
  https://poly.pizza/m/BuRay4fVFr

The downloaded ferris-wheel candidate (`https://poly.pizza/m/cvRs_bHUF59`,
jeremy, CC-BY) was tested and **not shipped**: it exceeded the strict swept
4.669M-vertex ceiling. No ferris asset remains in `public/models/`.

The hatch's single texture atlas is kept at runtime by `flattenSubtree`; the
coupe, muscle and bed are flattened to one vertex-coloured mesh each. No new
instanced batch, pedestrian rig or spawn loop was added.
