# PALMA CITY

An original open-world crime game for Windows on ARM — built to run natively on a
**Galaxy Book 4 Edge (Snapdragon X Plus)**.

Palma City is a Vice City–inspired coastal metropolis: 10×10 city blocks, a beach
and pier with a ferris wheel, four enterable interiors, a day/night cycle with a
moving sun, streetlights and neon, drivable traffic, pedestrians, a five-star
police system with cruisers, foot officers, gang shootouts and a helicopter, and
an eight-mission story campaign following Marisol Vega.

Everything — geometry, textures, cars, characters, sound and music — is generated
procedurally by the game engine. No third-party game art, audio or code is
included. It is an original work inspired by the genre, **not** a copy of
Grand Theft Auto VI, and it ships no Rockstar assets.

---

## Install (Galaxy Book 4 Edge / Windows 11 ARM64)

1. Download `Palma City-win32-arm64.zip` and extract it anywhere (for example
   `C:\Games\Palma City`). Keep the whole folder together — the `.exe` needs the
   files beside it.
2. Run **`Palma City.exe`**.
3. Windows SmartScreen will warn about an unknown publisher (the build is not
   code-signed). Click **More info → Run anyway**.
4. First launch takes a few seconds while the city is generated.

Uninstall by deleting the folder. Saves live in
`%APPDATA%\Palma City\palma-save.json`.

### Play in a browser (no install)

[Download the browser build](release/Palma%20City-browser.zip), extract the zip,
and open `index.html`. No account, installer or internet connection is needed.

### Requirements

| | |
|---|---|
| OS | Windows 11 (ARM64) |
| CPU | Snapdragon X Plus / X Elite (also runs on x64 with the x64 build) |
| GPU | Adreno integrated — Direct3D 11 |
| RAM | 8 GB+ |
| Disk | ~1 GB free |
| Display | 1280×720 or higher |

---

## Controls

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Sprint | `Shift` |
| Jump | `Space` |
| Look / aim camera | Mouse (click the window to capture the pointer) |
| Fire | Left mouse |
| Aim down sights | Right mouse |
| Reload | `R` |
| Enter / exit vehicle | `F` |
| Handbrake | `Space` (in a car) |
| Next / previous weapon | Mouse wheel or `1`–`4` |
| Radio station | `H` (horn while driving) |
| Map | `M` |
| Pause / menu | `Esc` |

---

## The campaign

Eight missions, roughly 40–60 minutes:

1. **SUNBURN** — steal the Sabre V8 from the docks.
2. **HEAT CHECK** — clear Club Sol and lose the cops.
3. **REPO RUN** — repossess a car from the marina.
4. **THE INFORMANT** — reach the snitch before the Salt Kings do.
5. **SALTWATER** — a deal on the pier goes wrong.
6. **HIGHWAY** — a chase up the coastal highway.
7. **BAD BLOOD** — settle the score with the gang.
8. **THE EXCHANGE** — the finale.

Mission markers are orange rings on the ground and on the radar. Walk into one to
start. Dying or failing restarts the mission from its first objective.

---

## Performance notes

The renderer draws roughly 250–350 draw calls at 1080p on Snapdragon X Plus by:

* merging every car into 7 meshes (paint, glass, trim, lights, 4 wheels),
* merging each pedestrian into 5 vertex-coloured meshes,
* instancing palms, streetlights and traffic signals,
* culling traffic beyond 190 m, pedestrians beyond 120 m and police beyond 220 m,
* spawning new traffic and pedestrians around the player instead of simulating
  the whole city.

If you are on a low-power profile, lower the resolution in **Settings →
Resolution** (the game renders at 0.75× and letterboxes to 16:9).

---

## Development

```bash
npm install          # dependencies
npm run dev          # hot-reloading browser build (development only)
npm run build        # production bundle into dist/
npm run package:arm64  # Windows ARM64 app into release/
npm run package:x64    # Windows x64 app
```

Source layout:

```
electron/       Electron main + preload (window, fullscreen, save paths)
src/config.js   tuning: city grid, weapons, vehicle specs
src/core/       RNG, math, AABB/ray helpers, input
src/world/      procedural textures, city generation, sky and time of day
src/entities/   humanoid rigs, player, vehicles, pedestrians, police
src/systems/    effects, combat, missions, HUD, audio, camera
src/main.js     boot, menus, settings, save/load, main loop
```
