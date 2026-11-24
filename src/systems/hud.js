// Palma City — HUD: radar, map, vitals, wanted stars, notifications, speedometer.
import * as THREE from 'three';
import { CFG, HALF, WORLD_EDGE, BEACH_END, DISTRICTS } from '../config.js';
import { formatMoney, clamp, lerp } from '../core/utils.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.mini = $('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.big = $('bigmap');
    this.bigCtx = this.big.getContext('2d');
    this.speedo = $('speedo-canvas');
    this.speedoCtx = this.speedo.getContext('2d');
    this.toastEl = $('toasts');
    this.subEl = $('subtitles');
    this.bannerEl = $('banner');
    this.objTitle = $('obj-title');
    this.objText = $('obj-text');
    this.objKicker = $('obj-kicker');
    this.starsEl = $('stars');
    this.moneyEl = $('money-value');
    this.healthFill = $('health-fill');
    this.armorFill = $('armor-fill');
    this.weaponName = $('weapon-name');
    this.ammoEl = $('ammo');
    this.speedoWrap = $('speedo');
    this.gearEl = $('gear');
    this.districtEl = $('district');
    this.streetEl = $('street');
    this.clockEl = $('clock');
    this.interactEl = $('interact');
    this.interactText = this.interactEl.querySelector('span');
    this.crosshair = $('crosshair');
    this.hitmarkerEl = $('hitmarker');
    this.flashEl = $('damage-flash');
    this.radioEl = $('radio');
    this.radioStation = $('radio-station');
    this.radioTrack = $('radio-track');
    this.busEl = $('bus-hud');
    this.busLineEl = $('bus-line');
    this.busStopEl = $('bus-stop');
    this.busSubEl = $('bus-next');
    this.letterbox = $('letterbox');
    this.fpsEl = $('fps');

    for (let i = 0; i < 5; i++) {
      const s = document.createElement('i');
      this.starsEl.appendChild(s);
    }
    this.stars = [...this.starsEl.children];

    this.subTimer = 0;
    this.bannerTimer = 0;
    this.flashTimer = 0;
    this.hitTimer = 0;
    this.radioTimer = 0;
    this.mapTimer = 0;
    this.speedoVisible = false;
    this.bigMapBuilt = false;
    this.districtName = '';
    this.streetName = '';
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.drawnSpeed = 0;
    this.updateWanted();
    this.updateWeapon();
  }

  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  setObjective(kicker, title, text) {
    this.objKicker.textContent = kicker || 'MISSION';
    this.objTitle.textContent = title || '';
    this.objText.textContent = text || '';
    $('objective').style.opacity = title ? 1 : 0;
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.toastEl.appendChild(d);
    setTimeout(() => d.classList.add('out'), 3600);
    setTimeout(() => d.remove(), 4000);
    while (this.toastEl.children.length > 5) this.toastEl.firstChild.remove();
  }

  subtitle(speaker, text, dur = 4) {
    this.subEl.innerHTML = `<span class="speaker">${speaker}</span><span class="line">${text}</span>`;
    this.subTimer = dur;
  }

  clearSubtitle() {
    this.subEl.innerHTML = '';
    this.subTimer = 0;
  }

  banner(kicker, title, dur = 3.2) {
    $('banner-kicker').textContent = kicker;
    $('banner-title').textContent = title;
    this.bannerEl.classList.add('on');
    this.bannerTimer = dur;
  }

  showInteract(show, text, key) {
    this.interactEl.classList.toggle('hidden', !show);
    if (show && text) this.interactText.textContent = text;
    if (show) {
      const k = this.interactEl.querySelector('kbd');
      if (k) k.textContent = key || 'F';
    }
  }

  updateWanted() {
    const w = this.game.wanted || 0;
    const d = this.game.police && this.game.police.description;
    // Hollow stars = police are looking but have no description of you yet.
    const unknown = w > 0 && d && !d.face && !d.clothes;
    this.stars.forEach((s, i) => {
      s.classList.toggle('on', i < w);
      s.classList.toggle('flash', i < w && w >= 3);
      s.classList.toggle('hollow', i < w && unknown);
    });
  }

  updateWeapon() {
    const p = this.game.player;
    if (!p) return;
    const def = p.weapon ? p.weapon.toUpperCase() : 'FISTS';
    this.weaponName.textContent = def === 'SMG' ? 'MICRO SMG' : def;
    const a = p.ammo;
    this.ammoEl.innerHTML = `<b>${a.mag}</b><span>/ ${a.reserve}</span>`;
  }

  damageFlash() {
    this.flashEl.classList.add('on');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.flashEl.classList.remove('on'), 110);
  }

  hitmarker() {
    this.hitmarkerEl.classList.remove('on');
    void this.hitmarkerEl.offsetWidth;
    this.hitmarkerEl.classList.add('on');
  }

  setLetterbox(on) {
    this.letterbox.classList.toggle('on', on);
  }

  showRadio(station, track) {
    this.radioStation.textContent = station;
    this.radioTrack.textContent = track;
    this.radioEl.classList.add('on');
    this.radioTimer = 4;
  }

  showBus(line, nextStop, sub, last) {
    this.busLineEl.textContent = line;
    this.busStopEl.textContent = last ? `LAST STOP · ${nextStop}` : `NEXT · ${nextStop}`;
    this.busSubEl.textContent = sub || '';
    this.busEl.classList.remove('hidden');
  }

  hideBus() {
    this.busEl.classList.add('hidden');
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    if (!p) return;

    // vitals
    this.healthFill.style.width = clamp(p.health / p.maxHealth, 0, 1) * 100 + '%';
    this.armorFill.style.width = clamp(p.armor / 100, 0, 1) * 100 + '%';
    this.moneyEl.textContent = formatMoney(p.money);

    // clock + location
    this.clockEl.textContent = game.sky.clock;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.2;
      const d = game.city.getDistrict(p.pos.x, p.pos.z);
      if (d !== this.districtName) { this.districtName = d; this.districtEl.textContent = d; }
      const st = game.city.getStreetName(p.pos.x, p.pos.z);
      if (st !== this.streetName) { this.streetName = st; this.streetEl.textContent = st; }
    } else this.mapTimer -= dt;

    // crosshair
    const showCross = p.aiming && !p.inVehicle;
    this.crosshair.classList.toggle('on', showCross);

    // speedometer
    const inCar = p.inVehicle && p.vehicle;
    this.speedoWrap.classList.toggle('on', !!inCar);
    if (inCar) {
      const kmh = Math.abs(p.vehicle.speed) * 3.6;
      this.drawnSpeed = lerp(this.drawnSpeed, kmh, 1 - Math.exp(-8 * dt));
      this.drawSpeedo(this.drawnSpeed, p.vehicle.speed < -0.5 ? 'R' : 'D');
    } else this.drawnSpeed = 0;

    // timers
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subEl.innerHTML = '';
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('on');
    }
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.classList.remove('on');
    }

    // fps
    this.fpsAccum += dt; this.fpsFrames++;
    if (this.fpsAccum > 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsEl.textContent = fps + ' FPS';
      this.fpsAccum = 0; this.fpsFrames = 0;
    }

    this.drawMinimap();
    if (game.mapOpen) this.drawBigMap();
  }

  /* ------------------------------- radar ------------------------------- */
  drawMinimap() {
    const game = this.game;
    const p = game.player;
    const city = game.city;
    const ctx = this.miniCtx;
    const S = 440, c = S / 2;
    const zoom = 1.5;
    const rot = p.heading + Math.PI;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, 0, S, S);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    ctx.translate(c, c);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    ctx.translate(-p.pos.x, -p.pos.z);

    // ocean + sand
    ctx.fillStyle = '#0a2230';
    ctx.fillRect(-2400, BEACH_END - 8, 4800, 1400);
    ctx.fillStyle = '#3a3324';
    ctx.fillRect(-WORLD_EDGE, WORLD_EDGE, WORLD_EDGE * 2, CFG.BEACH);
    // blocks
    ctx.fillStyle = '#151b22';
    for (const b of city.blocks) {
      ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    }
    // park blocks green
    ctx.fillStyle = '#16241c';
    for (const b of city.blocks) if (b.type === 'park') ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);

    // roads
    ctx.strokeStyle = '#2c3540';
    ctx.lineWidth = CFG.ROAD;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const x of city.roadsX) { ctx.moveTo(x, -WORLD_EDGE); ctx.lineTo(x, WORLD_EDGE); }
    for (const z of city.roadsZ) { ctx.moveTo(-WORLD_EDGE, z); ctx.lineTo(WORLD_EDGE, z); }
    ctx.stroke();
    ctx.strokeStyle = '#3d4956';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const x of city.roadsX) { ctx.moveTo(x, -WORLD_EDGE); ctx.lineTo(x, WORLD_EDGE); }
    for (const z of city.roadsZ) { ctx.moveTo(-WORLD_EDGE, z); ctx.lineTo(WORLD_EDGE, z); }
    ctx.stroke();

    // pier
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(-94, WORLD_EDGE + CFG.BEACH - 6, 9, 110);

    ctx.restore();

    // blips
    const toScreen = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      return [c + (dx * cos - dz * sin) * zoom, c + (dx * sin + dz * cos) * zoom];
    };

    const blip = (wx, wz, color, size = 7, ring = false) => {
      const [x, y] = toScreen(wx, wz);
      if (x < -20 || x > S + 20 || y < -20 || y > S + 20) return;
      ctx.fillStyle = color;
      if (ring) {
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, size + 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    };

    // police
    for (const v of game.vehicles.all) {
      if (v.driver === 'cop' && !v.dead) blip(v.pos.x, v.pos.z, '#4a9bff', 5);
    }
    for (const a of game.police.agents) {
      if (a.faction === 'cop' && !a.dead) blip(a.pos.x, a.pos.z, '#4a9bff', 4);
    }
    // mission marker
    const m = game.missions.markerPos;
    if (m) blip(m.x, m.z, '#ffb43d', 8, true);
    // waypoint
    if (game.waypoint) blip(game.waypoint.x, game.waypoint.z, '#ffd447', 6);

    // player arrow
    ctx.save();
    ctx.translate(c, c);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7.5, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();

    // north marker
    ctx.save();
    ctx.translate(c, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, 0);
    ctx.restore();
  }

  /* ------------------------------- big map ------------------------------- */
  buildBigMap() {
    const S = 1400;
    const off = document.createElement('canvas');
    off.width = S; off.height = S;
    const g = off.getContext('2d');
    const city = this.game.city;
    const worldMin = -WORLD_EDGE - 70, worldMax = BEACH_END + 40;
    const span = worldMax - worldMin;
    const sc = S / span;
    const tx = (x) => (x - worldMin) * sc;
    const tz = (z) => (z - worldMin) * sc;

    g.fillStyle = '#08131a'; g.fillRect(0, 0, S, S);
    // ocean
    g.fillStyle = '#0b2b3c';
    g.fillRect(0, tz(BEACH_END - 6), S, S - tz(BEACH_END - 6));
    // sand
    g.fillStyle = '#3a3428';
    g.fillRect(tx(-WORLD_EDGE), tz(WORLD_EDGE), WORLD_EDGE * 2 * sc, CFG.BEACH * sc);

    // blocks
    for (const b of city.blocks) {
      g.fillStyle = b.type === 'park' ? '#16281c' : '#151d25';
      g.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }
    // roads
    g.strokeStyle = '#2f3a45';
    g.lineWidth = CFG.ROAD * sc;
    g.beginPath();
    for (const x of city.roadsX) { g.moveTo(tx(x), tz(-WORLD_EDGE)); g.lineTo(tx(x), tz(WORLD_EDGE)); }
    for (const z of city.roadsZ) { g.moveTo(tx(-WORLD_EDGE), tz(z)); g.lineTo(tx(WORLD_EDGE), tz(z)); }
    g.stroke();

    // district labels
    g.font = '700 22px Bahnschrift, Arial';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.textAlign = 'center';
    const labels = [
      ['DOWNTOWN', 0, 0], ['PALMA BEACH', 0, WORLD_EDGE - 40],
      ['CORAL HEIGHTS', PITCH3(), 0], ['THE DOCKS', -PITCH3(), -120],
      ['SUNSET STRIP', 0, -PITCH3()], ['LITTLE SANTO', -PITCH3(), PITCH3() * 0.6],
      ['MARINA DISTRICT', PITCH3() * 0.6, PITCH3() * 0.6]
    ];
    for (const [name, x, z] of labels) {
      g.fillText(name, tx(x), tz(z));
    }
    function PITCH3() { return (CFG.BLOCK + CFG.ROAD) * 3; }

    // pier
    g.fillStyle = '#3d2f20';
    g.fillRect(tx(-94), tz(WORLD_EDGE + CFG.BEACH - 6), 9 * sc, 110 * sc);
    // ferris wheel dot
    g.fillStyle = '#ff3d7f';
    g.beginPath(); g.arc(tx(-90), tz(WORLD_EDGE + CFG.BEACH + 68), 6, 0, 6.283); g.fill();

    this.bigStatic = off;
    this.bigMapBuilt = true;
  }

  drawBigMap() {
    if (!this.bigMapBuilt) this.buildBigMap();
    const S = 1400;
    const g = this.bigCtx;
    const worldMin = -WORLD_EDGE - 70;
    const span = (BEACH_END + 40) - worldMin;
    const sc = S / span;
    const tx = (x) => (x - worldMin) * sc;
    const tz = (z) => (z - worldMin) * sc;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.bigStatic, 0, 0);
    const game = this.game;
    const p = game.player;

    for (const it of game.city.interiors) {
      g.fillStyle = '#22e0ff';
      g.beginPath(); g.arc(tx(it.entry.x), tz(it.entry.z), 7, 0, 6.283); g.fill();
    }
    for (const v of game.vehicles.all) {
      if (v.driver === 'cop' && !v.dead) {
        g.fillStyle = '#4a9bff';
        g.beginPath(); g.arc(tx(v.pos.x), tz(v.pos.z), 6, 0, 6.283); g.fill();
      }
    }
    const m = game.missions.markerPos;
    if (m) {
      g.fillStyle = '#ffb43d';
      g.beginPath(); g.arc(tx(m.x), tz(m.z), 11, 0, 6.283); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    // player
    g.save();
    g.translate(tx(p.pos.x), tz(p.pos.z));
    g.rotate(-p.heading + Math.PI);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill();
    g.restore();
  }

  /* ------------------------------- speedo ------------------------------- */
  drawSpeedo(kmh, gear) {
    const g = this.speedoCtx;
    const S = 260, c = S / 2, r = 104;
    g.clearRect(0, 0, S, S);
    const start = Math.PI * 0.78, end = Math.PI * 2.24;
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.arc(c, c, r, start, end); g.stroke();
    const t = clamp(kmh / 260, 0, 1);
    const grd = g.createLinearGradient(0, 0, S, S);
    grd.addColorStop(0, '#22e0ff');
    grd.addColorStop(1, '#ff3d7f');
    g.strokeStyle = grd;
    g.beginPath(); g.arc(c, c, r, start, start + (end - start) * t); g.stroke();

    // ticks
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = start + ((end - start) * i) / 10;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (r - 14), c + Math.sin(a) * (r - 14));
      g.lineTo(c + Math.cos(a) * (r - 22), c + Math.sin(a) * (r - 22));
      g.stroke();
    }
    // needle
    const a = start + (end - start) * t;
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * (r - 30), c + Math.sin(a) * (r - 30));
    g.stroke();
    g.fillStyle = '#ff3d7f';
    g.beginPath(); g.arc(c, c, 5, 0, 6.283); g.fill();

    g.fillStyle = '#fff';
    g.font = '800 46px Bahnschrift, Arial';
    g.textAlign = 'center';
    g.fillText(Math.round(kmh), c, c + 44);
    g.font = '600 14px Bahnschrift, Arial';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText('KM/H', c, c + 66);
    this.gearEl.textContent = gear;

    // fuel + engine gauges, drawn only while driving
    const v = this.game.player && this.game.player.vehicle;
    if (v) {
      const bw = 150, bx = c - bw / 2, by = c + 86;
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(bx, by, bw, 6);
      g.fillStyle = v.fuel < 0.15 ? '#ff3d5a' : '#22e0ff';
      g.fillRect(bx, by, bw * clamp(v.fuel, 0, 1), 6);
      g.font = '600 11px Bahnschrift, Arial';
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.textAlign = 'left';
      g.fillText('FUEL', bx, by - 4);
      g.textAlign = 'right';
      g.fillStyle = v.engineHealth < 0.4 ? '#ff8a5c' : 'rgba(255,255,255,0.55)';
      g.fillText(`ENG ${Math.round(v.engineHealth * 100)}%`, bx + bw, by - 4);
      g.textAlign = 'center';
    }
  }
}
