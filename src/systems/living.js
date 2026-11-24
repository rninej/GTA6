// Palma City — living-world systems: phone, store robberies + economy,
// safehouse save/evasion/respawn and courier side jobs.
//
// Everything here is UI and game logic: no meshes are created, so the draw-call
// budget is untouched. The phone is DOM, shops reuse the restaurant interiors,
// the safehouse is the first apartment, and the courier job reuses the mission
// marker.
const CONTACTS = [
  { id: 'dex', name: 'DEX', tag: 'WORK' },
  { id: 'courier', name: 'COURIER', tag: 'SIDE JOB' },
  { id: 'taxi', name: 'TAXI', tag: 'TRANSPORT' },
  { id: 'safehouse', name: 'SAFEHOUSE', tag: 'PROPERTY' }
];

const $ = (id) => document.getElementById(id);

export class Living {
  constructor(game) {
    this.game = game;
    this.phoneOpen = false;
    this.phoneIdx = 0;
    this.phoneTimer = 0;
    this.job = null;
    this.jobsDone = 0;
    this.jobsFailed = 0;
    this.robberies = 0;
    this.robberyRefusals = 0;
    this.safehouse = null;
    this.sleeps = 0;
    this.refusals = 0;
    this.hideTimer = 0;
    this.inSafehouse = false;
    this.lastSleep = -999;

    this.phoneEl = $('phone');
    this.listEl = $('phone-list');
    this.detailEl = $('phone-detail');
    this.clockEl = $('phone-clock');
    this.moneyEl = $('phone-money');
    this.renderRows();

    this.tagPlaces();
  }

  /* ------------------------------ world tags ------------------------------ */
  tagPlaces() {
    const city = this.game.city;
    let apartment = false;
    city.interiors.forEach((it, i) => {
      if (it.kind === 'restaurant') {
        // Counter runs along the back wall of the restaurant kit.
        it.shop = { counter: { x: it.x, z: it.z - 4.4 }, closed: i % 5 === 4, cooldown: 0, looted: 0 };
      } else if (it.kind === 'apartment' && !apartment) {
        apartment = true;
        it.safehouse = true;
        this.safehouse = it;
      }
    });
    if (this.safehouse) {
      const e = this.safehouse.entry;
      this.game.hospitalSpawn = new (this.game.player.pos.constructor)(e.x, 0.24, e.z);
      this.game.safehouseSpawn = this.game.hospitalSpawn.clone();
    }
  }

  /* -------------------------------- phone -------------------------------- */
  renderRows() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    CONTACTS.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'phone-row' + (i === this.phoneIdx ? ' on' : '');
      row.dataset.idx = String(i);
      row.innerHTML = `<b>${c.name}</b><small>${c.tag}</small>`;
      row.addEventListener('click', () => {
        this.phoneIdx = i;
        this.activate();
      });
      this.listEl.appendChild(row);
    });
  }

  renderPhone() {
    if (!this.phoneEl) return;
    this.renderRows();
    const g = this.game;
    const p = g.player;
    if (this.clockEl) this.clockEl.textContent = g.sky ? g.sky.clock : '';
    if (this.moneyEl) this.moneyEl.textContent = `$${p ? p.money : 0}`;
    const c = CONTACTS[this.phoneIdx];
    let text = '';
    if (c.id === 'dex') {
      text = g.missions.finished
        ? 'No work left. The city is yours.'
        : `Next job: ${g.missions.missionTitle}. Tap CALL to mark it on your map.`;
    } else if (c.id === 'courier') {
      text = this.job
        ? `Delivery running — ${Math.ceil(this.job.timer)}s left. $${this.job.reward} on drop-off.`
        : 'Courier shift: deliver a package across town. $350, 90 seconds.';
    } else if (c.id === 'taxi') {
      text = 'Cab to your current marker. $100, paid on pickup.';
    } else if (c.id === 'safehouse') {
      const e = this.safehouse ? this.safehouse.entry : null;
      const d = e ? Math.round(Math.hypot(p.pos.x - e.x, p.pos.z - e.z)) : 0;
      text = e ? `Your apartment. ${d} m away. Sleep to save, heal and respawn here.` : 'No property owned.';
    }
    if (this.detailEl) this.detailEl.textContent = text;
  }

  togglePhone(on = !this.phoneOpen) {
    this.phoneOpen = on;
    this.game.phoneOpen = on;
    if (this.phoneEl) this.phoneEl.classList.toggle('hidden', !on);
    if (on) { this.phoneTimer = 0; this.renderPhone(); }
  }

  // Returns true when the key was consumed by the phone.
  handleKey(code) {
    if (code === 'KeyP') { this.togglePhone(); return true; }
    if (!this.phoneOpen) return false;
    if (code === 'Escape') { this.togglePhone(false); return true; }
    if (code === 'ArrowUp') {
      this.phoneIdx = (this.phoneIdx + CONTACTS.length - 1) % CONTACTS.length;
      this.renderPhone();
      return true;
    }
    if (code === 'ArrowDown') {
      this.phoneIdx = (this.phoneIdx + 1) % CONTACTS.length;
      this.renderPhone();
      return true;
    }
    if (code === 'Enter' || code === 'Space') { this.activate(); return true; }
    if (code.startsWith('Digit')) {
      const i = +code.slice(5) - 1;
      if (i >= 0 && i < CONTACTS.length) { this.phoneIdx = i; this.activate(); return true; }
    }
    return false;
  }

  activate() {
    const g = this.game;
    const p = g.player;
    const c = CONTACTS[this.phoneIdx];
    this.togglePhone(false);
    if (!c) return;
    if (c.id === 'dex') {
      const m = g.missions.missions[g.missions.index];
      if (m) {
        g.missions.setMarker(m.start.x, m.start.z);
        g.hud.toast('DEX SENT THE ADDRESS', 'good');
      } else g.hud.toast('DEX: NOTHING LEFT TO DO', '');
    } else if (c.id === 'courier') {
      this.startJob();
    } else if (c.id === 'taxi') {
      if (g.interior) { g.hud.toast('STEP OUTSIDE TO CALL A CAB', 'bad'); return; }
      if (p.inVehicle) { g.hud.toast('NOT WHILE DRIVING', 'bad'); return; }
      g.callTaxi();
    } else if (c.id === 'safehouse') {
      if (!this.safehouse) return;
      const e = this.safehouse.entry;
      g.missions.setMarker(e.x, e.z, 0x7dff9e);
      g.hud.toast('SAFEHOUSE MARKED', 'good');
    }
  }

  /* ----------------------------- courier job ----------------------------- */
  startJob() {
    const g = this.game;
    if (this.job) { g.hud.toast('DELIVERY ALREADY RUNNING', 'bad'); return false; }
    if (g.missions.current) { g.hud.toast('FINISH THE MISSION FIRST', 'bad'); return false; }
    const p = g.player;
    let target = null;
    for (let i = 0; i < 40; i++) {
      const n = g.city.graph[Math.floor(Math.random() * g.city.graph.length)];
      const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (d > 130 && d < 340) { target = n; break; }
    }
    if (!target) target = g.city.nearestNode(p.pos.x + 200, p.pos.z + 120);
    this.job = { x: target.x, z: target.z, timer: 90, total: 90, reward: 350 };
    g.missions.setMarker(target.x, target.z, 0x7dff9e);
    g.hud.setObjective('SIDE JOB', 'COURIER DELIVERY', '$350 · 90s');
    g.hud.toast('COURIER JOB — $350 ON DELIVERY', 'money');
    return true;
  }

  finishJob(ok) {
    const g = this.game;
    const job = this.job;
    this.job = null;
    g.missions.hideMarker();
    if (ok) {
      g.player.addMoney(job.reward);
      this.jobsDone++;
      g.hud.banner('SIDE JOB', 'DELIVERED', 2.6);
      g.hud.toast('COURIER PAID', 'money');
    } else {
      this.jobsFailed++;
      g.hud.toast('COURIER JOB EXPIRED', 'bad');
    }
  }

  /* ------------------------------ robberies ------------------------------ */
  rob(shop, it) {
    const g = this.game;
    const p = g.player;
    if (shop.closed) {
      this.robberyRefusals++;
      g.hud.toast('SHUTTERS DOWN — NO REGISTER', 'bad');
      return false;
    }
    if (!shop.clerk) {
      this.robberyRefusals++;
      g.hud.toast('NO CLERK ON DUTY', 'bad');
      return false;
    }
    if (shop.cooldown > 0) {
      this.robberyRefusals++;
      g.hud.toast('REGISTER EMPTY', 'bad');
      if (g.interiorLife) g.interiorLife.react(it, 'empty');
      return false;
    }
    const loot = 90 + Math.floor(Math.random() * 150);
    p.money += loot;
    shop.cooldown = 120;
    shop.looted++;
    this.robberies++;
    // The clerk always sees the robbery; a mask hides the face, not the clothes.
    g.police.reportCrime('robbery', p.pos, { forceWitness: true });
    if (g.interiorLife) g.interiorLife.react(it, 'robbed');
    g.audio.play('wanted');
    g.hud.toast(`ROBBED ${it.name} · +$${loot}`, 'money');
    return true;
  }

  buySnack() {
    const g = this.game, p = g.player;
    if (p.money < 25) { g.hud.toast('SNACK NEEDS $25', 'bad'); return false; }
    p.money -= 25;
    p.health = Math.min(p.maxHealth, p.health + 40);
    g.hud.toast('SNACK · +40 HEALTH', 'good');
    return true;
  }

  buyAmmo() {
    const g = this.game, p = g.player;
    if (p.money < 80) { g.hud.toast('AMMO NEEDS $80', 'bad'); return false; }
    p.money -= 80;
    p.weapons.pistol.reserve += 24;
    g.hud.updateWeapon();
    g.hud.toast('PISTOL AMMO +24', 'good');
    return true;
  }

  updateShop(it) {
    const g = this.game, p = g.player, shop = it.shop;
    const d = Math.hypot(p.pos.x - shop.counter.x, p.pos.z - shop.counter.z);
    if (d > 2.4) return;
    if (shop.closed) {
      g.hud.showInteract(true, 'SHUTTERS DOWN', 'X');
    } else if (shop.cooldown > 0) {
      g.hud.showInteract(true, `REGISTER EMPTY · ${Math.ceil(shop.cooldown)}s`, 'X');
    } else {
      g.hud.showInteract(true, 'ROB REGISTER · B SNACK $25 · N AMMO $80', 'X');
    }
    if (g.input.hit('KeyX')) this.rob(shop, it);
    if (g.input.hit('KeyB')) this.buySnack();
    if (g.input.hit('KeyN')) this.buyAmmo();
  }

  /* ------------------------------ safehouse ------------------------------ */
  sleep() {
    const g = this.game;
    if (g.wanted >= 3) {
      this.refusals++;
      g.hud.toast('HEAT TOO HIGH — SHAKE THE COPS FIRST', 'bad');
      return false;
    }
    g.sky.setHour(8);
    g.player.health = g.player.maxHealth;
    g.player.armor = Math.max(g.player.armor, 50);
    if (g.wanted > 0) g.police.clearWanted();
    g.wanted = 0;
    g.hud.updateWanted();
    g.saveGame();
    this.sleeps++;
    g.hud.banner('SAFEHOUSE', 'SLEPT · 08:00', 2.6);
    g.hud.toast('GAME SAVED', 'good');
    return true;
  }

  updateSafehouse(it, dt) {
    const g = this.game, p = g.player;
    if (!this.inSafehouse) {
      this.inSafehouse = true;
      this.hideTimer = 0;
      if (g.wanted > 0 && g.wanted <= 2) g.hud.toast('SAFEHOUSE — KEEP YOUR HEAD DOWN', '');
    }
    // Lying low inside burns off a weak police response; a 3+ star response
    // knows where you live and will not clear.
    if (g.wanted > 0 && g.wanted <= 2) {
      this.hideTimer += dt;
      if (this.hideTimer > 6) {
        g.police.clearWanted();
        g.wanted = 0;
        g.hud.updateWanted();
        g.hud.toast('YOU LOST THE COPS', 'good');
        this.hideTimer = 0;
      }
    } else this.hideTimer = 0;

    const bx = it.x - 2.4, bz = it.z - 2.6;
    if (Math.hypot(p.pos.x - bx, p.pos.z - bz) < 2.6) {
      const hot = g.wanted >= 3;
      g.hud.showInteract(true, hot ? 'HEAT TOO HIGH TO SLEEP' : 'SLEEP & SAVE · 08:00', 'B');
      if (g.input.hit('KeyB')) this.sleep();
    }
  }

  /* -------------------------------- update -------------------------------- */
  update(dt) {
    const g = this.game;
    if (!g.player) return;
    if (this.phoneOpen) {
      this.phoneTimer -= dt;
      if (this.phoneTimer <= 0) { this.phoneTimer = 0.25; this.renderPhone(); }
    }

    if (this.job) {
      const p = g.player;
      this.job.timer -= dt;
      const d = Math.hypot(p.pos.x - this.job.x, p.pos.z - this.job.z);
      if (d < 7) this.finishJob(true);
      else if (this.job.timer <= 0) this.finishJob(false);
      else {
        g.missions.setMarker(this.job.x, this.job.z, 0x7dff9e);
        g.hud.setObjective('SIDE JOB', 'COURIER DELIVERY', `$${this.job.reward} · ${Math.ceil(this.job.timer)}s`);
      }
    }

    for (const it of g.city.interiors) {
      if (it.shop && it.shop.cooldown > 0) it.shop.cooldown = Math.max(0, it.shop.cooldown - dt);
    }

    const it = g.interior;
    if (it && it.shop) {
      this.inSafehouse = false;
      this.hideTimer = 0;
      this.updateShop(it);
    } else if (it && it === this.safehouse) {
      this.updateSafehouse(it, dt);
    } else {
      this.inSafehouse = false;
      this.hideTimer = 0;
    }
  }
}
