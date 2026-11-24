// Palma City — entry point and game loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { CFG, HALF, WORLD_EDGE, BEACH_END } from './config.js';
import { Input } from './core/input.js';
import { clamp, rand } from './core/utils.js';
import { City } from './world/city.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/weather.js';
import { setAnisotropy } from './world/textures.js';
import { loadPhotoTextures, setPhotoAnisotropy } from './world/photos.js';
import { loadModels } from './world/models.js';
import { setSurfaceAnisotropy } from './world/surface.js';
import { Player } from './entities/player.js';
import { VehicleManager } from './entities/vehicles.js';
import { PedestrianManager } from './entities/pedestrians.js';
import { Police } from './entities/police.js';
import { Combat } from './systems/combat.js';
import { MissionSystem } from './systems/missions.js';
import { HUD } from './systems/hud.js';
import { Living } from './systems/living.js';
import { InteriorLife } from './systems/interior-life.js';
import { Transit } from './systems/transit.js';
import { AudioEngine } from './systems/audio.js';
import { GameCamera } from './systems/camera.js';
import { Effects } from './systems/effects.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'palma_city_save_v1';
const SETTINGS_KEY = 'palma_city_settings_v1';

const game = {
  scene: null, camera: null, renderer: null, clock: { last: 0, start() { this.last = performance.now(); }, getDelta() { const n = performance.now(); const d = (n - this.last) / 1000; this.last = n; return d; } },
  paused: true, started: false, cutscene: false, mapOpen: false, loading: true,
  wanted: 0, interior: null, deathTimer: 0, godMode: false, now: 0,
  settings: {
    quality: 'high', renderScale: 100, fov: 78, sensitivity: 100, volume: 80,
    cinematic: false, showFps: false
  }
};

// Deterministic verification hook: ?seed=N reproduces the traffic, pedestrian
// and player variants. It is installed after the city is generated, so the
// street layout stays fixed while the moving population is swept.
const __seedParam = new URLSearchParams(location.search).get('seed');

window.__PALMA__ = game;

/* ============================== BOOT ============================== */
async function boot() {
  loadSettings();
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: game.settings.quality !== 'low', powerPreference: 'high-performance', stencil: true
  });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Shadows were costing more triangles than the whole visible city: the sun's
  // shadow camera has to redraw every caster in range, and merged city meshes
  // cannot be partially culled. Off for the release build; the street still has
  // ambient occlusion baked into the facade textures and props.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  game.renderer = renderer;
  // motion smoothing / motion blur: keep a fraction of the previous frame so
  // fast camera pans and speeding cars leave a short trail
  if (game.settings.quality !== 'low') {
    try {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const after = new AfterimagePass(0.62);
      after.uniforms.damp.value = 0.62;
      composer.addPass(after);
      composer.setSize(window.innerWidth, window.innerHeight);
      game.composer = composer;
      game.afterimage = after;
    } catch (err) {
      console.warn('motion blur unavailable', err && err.message);
      game.composer = null;
    }
  }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  setAnisotropy(aniso);
  setPhotoAnisotropy(aniso);
  setSurfaceAnisotropy(aniso);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb6c9, 0.0016);
  game.scene = scene;

  const camera = new THREE.PerspectiveCamera(game.settings.fov, window.innerWidth / window.innerHeight, 0.25, 6200);
  camera.position.set(0, 4, 0);
  game.camera = camera;

  game.input = new Input(canvas);
  game.input.sensitivity = game.settings.sensitivity / 100;
  game.input.onLockChange = (locked) => {
    game.locked = locked;
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onGlobalKey);

  // photographic materials: CC0 albedo + normal + roughness sets, see CREDITS.md
  $('load-status').textContent = 'LOADING MATERIALS';
  await loadPhotoTextures((name, i, n) => {
    $('load-status').textContent = `LOADING MATERIALS · ${name.toUpperCase()}`;
    $('load-fill').style.width = (2 + (i / n) * 4) + '%';
  });
  await frame();

  // downloaded GLB models (cars, characters, props) — see public/models/manifest.json
  $('load-status').textContent = 'LOADING MODELS';
  await loadModels();
  await frame();

  await step('BUILDING SKY', 6);
  game.sky = new Sky(scene, game);

  await step('GENERATING PALMA CITY', 14);
  await frame();
  game.city = new City(scene, game);
  game.weather = new Weather(game);

  if (__seedParam) {
    let __s = (Number(__seedParam) >>> 0) || 1;
    Math.random = function seededRandom() {
      __s = (__s + 0x6D2B79F5) | 0;
      let t = Math.imul(__s ^ (__s >>> 15), 1 | __s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  await step('PLACING CHARACTERS', 56);
  await frame();
  game.player = new Player(game);
  game.player.money = 250;

  game.effects = new Effects(scene, game);
  game.vehicles = new VehicleManager(game);
  game.peds = new PedestrianManager(game);
  game.police = new Police(game);
  game.combat = new Combat(game);
  game.missions = new MissionSystem(game);
  game.hud = new HUD(game);
  game.audio = new AudioEngine(game);
  game.cam = new GameCamera(game);
  game.hospitalSpawn = new THREE.Vector3(-160, 0.24, -60);
  game.living = new Living(game);
  game.interiorLife = new InteriorLife(game);
  game.transit = new Transit(game);
  // Expose the save/flow entry points the mission system and the probes use.
  game.saveGame = saveGame;
  game.newGame = newGame;
  game.continueGame = continueGame;
  game.callTaxi = callTaxi;

  await step('SPAWNING TRAFFIC', 76);
  await frame();
  game.vehicles.spawnParked();
  for (let i = 0; i < 18; i++) game.vehicles.spawnTraffic();
  for (let i = 0; i < 24; i++) game.peds.spawnOne();

  await step('COMPILING SHADERS', 92);
  await frame();
  // Any material with transmission > 0 makes three.js render the entire scene a
  // second time into a transmission buffer, which doubled every triangle count
  // and draw call in the frame. The glazing here is ordinary transparency, so
  // clear transmission everywhere before the first real frame.
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.needsUpdate = true;
      }
    }
  });
  game.sky.refreshEnv();
  renderer.compile(scene, camera);

  await step('READY', 100);
  await frame();
  game.loading = false;
  showTitle();

  game.clock.start();
  animate();
}

function pixelRatio() {
  const base = Math.min(window.devicePixelRatio || 1, 1.5);
  return base * (game.settings.renderScale / 100) * (game.settings.quality === 'low' ? 0.72 : 1);
}

async function step(text, pct) {
  $('load-status').textContent = text;
  $('load-fill').style.width = pct + '%';
  await frame();
}
const frame = () => new Promise((r) => setTimeout(r, 16));

function onResize() {
  if (!game.renderer) return;
  game.renderer.setPixelRatio(pixelRatio());
  game.renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (game.composer) game.composer.setSize(window.innerWidth, window.innerHeight);
  game.camera.aspect = window.innerWidth / window.innerHeight;
  game.camera.updateProjectionMatrix();
}

/* ============================== TITLE / MENUS ============================== */
function showTitle() {
  $('loading').classList.add('hidden');
  $('title').classList.remove('hidden');
  const save = localStorage.getItem(SAVE_KEY);
  $('btn-continue').disabled = !save;
  $('btn-continue').style.opacity = save ? 1 : 0.35;
}

function newGame() {
  if (game.loading || !game.hud) return;
  $('title').classList.add('hidden');
  game.hud.show();
  game.started = true;
  game.paused = false;
  game.player.teleport(game.player.spawn.clone());
  game.player.money = 250;
  if (game.living) { game.living.togglePhone(false); game.living.job = null; }
  game.sky.setHour(16.2);
  game.input.requestLock();
  game.audio.init();
  game.audio.resume();
  game.audio.setRadio(1);
  showChapter('CHAPTER ONE', 'SUNBURN', 'PALMA BEACH · 18:36');
  setTimeout(() => { game.cutscene = false; }, 4200);
  game.cutscene = true;
  const start = game.city.snapToStreet(-198, -12);
  game.missions.setMarker(start.x, start.z);
  game.hud.banner('PALMA CITY', 'WELCOME BACK', 3.5);
  game.hud.toast('Head to the orange marker to start a mission');
  game.hud.toast('T · taxi ($100)   G · mask   P · phone');
  game.hud.toast('X · rob shops   B · sleep at safehouse');
  saveGame();
}

function continueGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return newGame();
  let data;
  try { data = JSON.parse(raw); } catch { return newGame(); }
  $('title').classList.add('hidden');
  game.hud.show();
  game.started = true;
  game.paused = false;
  game.input.requestLock();
  game.audio.init();
  game.audio.resume();
  game.audio.setRadio(1);
  game.player.money = data.money ?? 250;
  game.player.health = data.health ?? 100;
  game.player.armor = data.armor ?? 50;
  game.player.weapons = data.weapons || game.player.weapons;
  game.player.weapon = data.weapon || 'pistol';
  game.player.rig.attachGun(game.player.weapon);
  game.player.masked = !!data.masked;
  game.interior = null;
  if (game.living) game.living.togglePhone(false);
  game.wanted = data.wanted || 0;
  game.missions.index = data.missionIndex || 0;
  game.missions.cooldown = 1;
  game.sky.setHour(data.hour ?? 16.2);
  game.player.teleport(new THREE.Vector3(data.x ?? game.player.spawn.x, 0.24, data.z ?? game.player.spawn.z));
  game.player.heading = data.heading || 0;
  game.hud.updateWanted();
  game.hud.updateWeapon();
  game.hud.toast('SAVE LOADED', 'good');
}

function saveGame() {
  if (!game.started || !game.player) return false;
  const p = game.player;
  // Sleeping saves from inside the safehouse; store the street door, not the
  // interior room, or the next load would drop the player into the void.
  const inside = game.interior;
  const data = {
    money: p.money, health: p.health, armor: p.armor,
    x: inside ? inside.entry.x : p.pos.x,
    z: inside ? inside.entry.z : p.pos.z,
    heading: inside ? inside.entry.heading : p.heading,
    weapons: p.weapons, weapon: p.weapon, masked: p.masked,
    missionIndex: game.missions.index, wanted: game.wanted,
    hour: game.sky.hour, ts: Date.now()
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    game.hud.toast('GAME SAVED', 'good');
    return true;
  } catch { return false; }
}

function pauseGame(on) {
  game.paused = on;
  $('menu').classList.toggle('hidden', !on);
  if (on) {
    game.input.releaseLock();
    showMenuPanel('main');
  } else {
    game.input.requestLock();
  }
}

function showMenuPanel(which) {
  $('menu-main').classList.toggle('hidden', which !== 'main');
  $('menu-settings').classList.toggle('hidden', which !== 'settings');
  $('menu-controls').classList.toggle('hidden', which !== 'controls');
  if (which === 'settings') syncSettingsUI();
}

function showChapter(kicker, title, sub) {
  $('chapter-kicker').textContent = kicker;
  $('chapter-title').textContent = title;
  $('chapter-sub').textContent = sub;
  $('chapter').classList.remove('hidden');
  setTimeout(() => $('chapter').classList.add('hidden'), 3600);
}

function onGlobalKey(e) {
  if (game.loading) return;
  if (e.code === 'Escape') {
    if (game.mapOpen) { toggleMap(false); return; }
    if (game.started) pauseGame(!game.paused);
    return;
  }
  if (e.code === 'Enter' && !$('title').classList.contains('hidden')) {
    if (localStorage.getItem(SAVE_KEY)) continueGame(); else newGame();
    return;
  }
  if (!game.started) return;
  if (game.living && game.living.phoneOpen && e.code === 'Escape') {
    game.living.togglePhone(false);
    return;
  }
  if (game.living && game.living.handleKey(e.code)) return;
  if (e.code === 'KeyM' && !game.paused) toggleMap(!game.mapOpen);
  if (e.code === 'KeyH' && !game.paused && !game.player.inVehicle) {
    game.audio.nextStation();
  }
  if (e.code === 'KeyG' && game.started && !game.paused) {
    game.player.masked = !game.player.masked;
    if (game.player.masked && game.police) game.police.description.face = false;
    game.hud.toast(game.player.masked ? 'MASK ON — FACE HIDDEN' : 'MASK OFF', 'good');
    game.hud.updateWanted();
  }
  if (e.code === 'KeyT' && game.started && !game.paused && !game.player.inVehicle && !game.interior) {
    callTaxi();
  }
  if (e.code === 'F5' && !game.paused) { e.preventDefault(); saveGame(); }
}

// GTA 6-style paid fast travel: a taxi takes you to the current mission marker.
function callTaxi() {
  const p = game.player;
  if (!game.missions.markerPos) { game.hud.toast('NO DESTINATION — MARK ONE FIRST', 'bad'); return; }
  if (p.money < 100) { game.hud.toast('TAXI NEEDS $100', 'bad'); return; }
  const m = game.missions.markerPos;
  p.money -= 100;
  fade(() => {
    const s = game.city.snapToStreet(m.x, m.z);
    p.teleport(new THREE.Vector3(s.x, 0.24, s.z));
    game.hud.toast('TAXI — $100', 'money');
  });
}

function toggleMap(on) {
  game.mapOpen = on;
  $('map-screen').classList.toggle('hidden', !on);
  if (on) { game.paused = true; game.input.releaseLock(); }
  else { game.paused = false; game.input.requestLock(); }
}

/* ============================== SETTINGS UI ============================== */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(game.settings, JSON.parse(raw));
  } catch { /* ignore */ }
}
function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.settings)); } catch { /* ignore */ }
}
function syncSettingsUI() {
  const s = game.settings;
  document.querySelectorAll('.seg[data-setting="quality"] button').forEach((b) => {
    b.classList.toggle('on', b.dataset.value === s.quality);
  });
  $('scale-range').value = s.renderScale;
  $('scale-val').textContent = s.renderScale + '%';
  $('fov-range').value = s.fov;
  $('fov-val').textContent = s.fov;
  $('sens-range').value = s.sensitivity;
  $('sens-val').textContent = (s.sensitivity / 100).toFixed(1);
  $('vol-range').value = s.volume;
  $('vol-val').textContent = s.volume + '%';
  $('blur-toggle').textContent = s.cinematic ? 'ON' : 'OFF';
  $('blur-toggle').classList.toggle('on', s.cinematic);
  $('fps-toggle').textContent = s.showFps ? 'ON' : 'OFF';
  $('fps-toggle').classList.toggle('on', s.showFps);
  $('fps').classList.toggle('hidden', !s.showFps);
  $('game').style.filter = s.cinematic ? 'contrast(1.08) saturate(1.14) brightness(1.02)' : '';
}
function applySettings() {
  persistSettings();
  if (game.renderer) {
    game.renderer.setPixelRatio(pixelRatio());
    game.renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (game.composer) game.composer.setSize(window.innerWidth, window.innerHeight);
  }
  if (game.cam) game.cam.fovBase = game.settings.fov;
  if (game.input) game.input.sensitivity = game.settings.sensitivity / 100;
  if (game.audio) game.audio.setVolume(game.settings.volume / 100);
  const q = game.settings.quality;
  if (game.sky) {
    const size = q === 'low' ? 1024 : q === 'medium' ? 1536 : 2048;
    if (game.sky.sun.shadow.mapSize.x !== size) {
      game.sky.sun.shadow.mapSize.set(size, size);
      if (game.sky.sun.shadow.map) { game.sky.sun.shadow.map.dispose(); game.sky.sun.shadow.map = null; }
    }
  }
  syncSettingsUI();
}

function wireUI() {
  document.querySelectorAll('#title button').forEach((b) => {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'new') newGame();
      else if (a === 'continue') continueGame();
      else if (a === 'settings') { $('menu').classList.remove('hidden'); showMenuPanel('settings'); }
      else if (a === 'controls') { $('menu').classList.remove('hidden'); showMenuPanel('controls'); }
      else if (a === 'quit') { if (window.palma) window.palma.quit(); else window.close(); }
    });
  });

  document.querySelectorAll('#menu button[data-action]').forEach((b) => {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'resume') { $('menu').classList.add('hidden'); pauseGame(false); }
      else if (a === 'save') { saveGame(); }
      else if (a === 'load') { $('menu').classList.add('hidden'); pauseGame(false); continueGame(); }
      else if (a === 'settings') showMenuPanel('settings');
      else if (a === 'controls') showMenuPanel('controls');
      else if (a === 'back') showMenuPanel('main');
      else if (a === 'quit-title') {
        saveGame();
        game.started = false; game.paused = true;
        $('menu').classList.add('hidden');
        game.hud.hide();
        showTitle();
        game.input.releaseLock();
      } else if (a === 'quit') {
        saveGame();
        if (window.palma) window.palma.quit(); else window.close();
      }
    });
  });

  document.querySelectorAll('.seg[data-setting="quality"] button').forEach((b) => {
    b.addEventListener('click', () => { game.settings.quality = b.dataset.value; applySettings(); });
  });
  $('scale-range').addEventListener('input', (e) => { game.settings.renderScale = +e.target.value; applySettings(); });
  $('fov-range').addEventListener('input', (e) => { game.settings.fov = +e.target.value; applySettings(); });
  $('sens-range').addEventListener('input', (e) => { game.settings.sensitivity = +e.target.value; applySettings(); });
  $('vol-range').addEventListener('input', (e) => { game.settings.volume = +e.target.value; applySettings(); });
  $('blur-toggle').addEventListener('click', () => { game.settings.cinematic = !game.settings.cinematic; applySettings(); });
  $('fps-toggle').addEventListener('click', () => { game.settings.showFps = !game.settings.showFps; applySettings(); });

  // audio unlock on first interaction
  const unlock = () => {
    if (!game.audio) return;
    game.audio.init();
    game.audio.resume();
    game.audio.setVolume(game.settings.volume / 100);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/* ============================== GAME FLOW ============================== */
game.onPlayerDeath = function (busted) {
  if (game.deathTimer > 0) return;
  game.deathTimer = 3.6;
  game.player.money = Math.max(0, Math.floor(game.player.money * 0.9));
  const fee = Math.floor(game.player.money * 0.1);
  $('death-text').textContent = busted ? 'BUSTED' : 'WASTED';
  $('death-sub').textContent = `Medical bills: $${fee}`;
  $('death').classList.remove('hidden');
  game.input.releaseLock();
  game.missions.onPlayerDeath();
  game.audio.play('fail');
  setTimeout(() => {
    $('death').classList.add('hidden');
    game.player.respawn();
    game.police.clearWanted();
    game.wanted = 0;
    game.hud.updateWanted();
    game.missions.restart();
    game.deathTimer = 0;
    game.input.requestLock();
  }, 3600);
};

game.onGameComplete = function () {
  showChapter('THE END', 'PALMA CITY', 'THANKS FOR PLAYING');
  game.hud.banner('STORY COMPLETE', 'PALMA CITY', 6);
  game.player.addMoney(50000);
};

game.enterInterior = function (it) {
  if (game.interior) return;
  game.interior = it;
  if (game.interiorLife) game.interiorLife.ensure(it);
  if (it.group) it.group.visible = true;
  fade(() => {
    game.player.exitVehicle(true);
    game.player.pos.set(it.x, (it.y || 0) + 0.05, it.z + it.d / 2 - 2.2);
    game.player.heading = Math.PI;
    game.player.mesh.rotation.y = Math.PI;
    game.cam.snap();
    game.hud.toast(`ENTERED ${it.name}`, 'good');
    if (it.kind === 'apartment') {
      game.player.heal(35);
      game.player.armor = Math.max(game.player.armor, 35);
    }
  });
};

game.exitInterior = function () {
  const it = game.interior;
  if (!it) return;
  game.interior = null;
  if (game.interiorLife) game.interiorLife.onExit(it);
  if (it.group) it.group.visible = false;
  fade(() => {
    game.player.pos.set(it.entry.x, 0.24, it.entry.z);
    game.player.heading = it.entry.heading;
    game.cam.snap();
  });
};

let fadeEl = null;
function fade(mid) {
  if (!fadeEl) {
    fadeEl = document.createElement('div');
    fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .22s;z-index:60;pointer-events:none';
    document.getElementById('game-root').appendChild(fadeEl);
  }
  fadeEl.style.opacity = '1';
  setTimeout(() => {
    if (mid) mid();
    fadeEl.style.opacity = '0';
  }, 240);
}

/* ============================== UPDATE ============================== */
function update(dt) {
  const p = game.player;
  game.now += dt;

  // interior handling
  if (game.interior) {
    const it = game.interior;
    p.pos.x = clamp(p.pos.x, it.x - it.w / 2 + 0.7, it.x + it.w / 2 - 0.7);
    p.pos.z = clamp(p.pos.z, it.z - it.d / 2 + 0.7, it.z + it.d / 2 - 0.7);
    p.pos.y = (it.y || 0) + 0.02;
    const doorX = it.x, doorZ = it.z + it.d / 2 - 1.4;
    if (Math.hypot(p.pos.x - doorX, p.pos.z - doorZ) < 2.2) {
      game.hud.showInteract(true, 'EXIT BUILDING');
      if (game.input.hit('KeyF')) game.exitInterior();
    } else game.hud.showInteract(false);
  }

  game.sky.update(dt, game);
  game.weather.update(dt, game);
  game.city.update(dt, game);
  p.update(dt, game);
  game.transit.update(dt);
  game.vehicles.update(dt, game);
  game.peds.update(dt, game);
  game.police.update(dt, game);
  game.combat.update(dt);
  game.missions.update(dt);
  game.living.update(dt);
  game.interiorLife.update(dt);
  game.effects.update(dt);
  game.cam.update(dt, game);

  // shooting
  if ((game.input.mouseDown(0) || game.input.pressed.has(0)) && !p.inVehicle &&
      !game.mapOpen && !game.paused && !p.dead && !game.phoneOpen) {
    game.combat.playerFire();
  }

  game.audio.update(dt, game);
  game.hud.update(dt);

  // audio engine
  if (p.inVehicle && p.vehicle) {
    const v = p.vehicle;
    game.audio.setEngine(clamp(Math.abs(v.speed) / v.spec.top, 0, 1), v.throttle > 0 ? 1 : 0.25, true);
  }
}

game.tick = update;   // headless probes drive the real frame update

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(game.clock.getDelta(), 0.05);
  if (!game.loading && game.started && !game.paused && !game.cutscene) {
    update(dt);
  } else if (!game.loading && game.started) {
    // keep visuals alive while paused / in cutscenes
    game.effects.update(Math.min(dt, 0.02));
    game.hud.update(Math.min(dt, 0.02));
    if (game.cutscene && game.cam) game.cam.update(Math.min(dt, 0.02), game);
    if (game.sky) game.sky.update(Math.min(dt, 0.02), game);
  }
  if (!game.loading) {
    // Temporal frame blend: a light afterimage pass makes 30-40 fps read as
    // smooth motion instead of a stutter, at the cost of one full-screen pass.
    // Low quality skips it so the Snapdragon X Plus can hold its frame rate.
    if (game.composer) game.composer.render();
    else game.renderer.render(game.scene, game.camera);
    game.input.endFrame();
  }
}

/* ============================== GO ============================== */
wireUI();
boot().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  game.bootError = err && err.stack ? err.stack : String(err);
  $('load-status').textContent = 'ERROR: ' + (err && err.message ? err.message : err);
});
