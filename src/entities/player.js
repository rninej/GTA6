// Palma City — player character controller.
import * as THREE from 'three';
import { buildHuman, HumanRig } from './humanoid.js';
import { clamp, damp, dampAngle, lerp, angleDiff, resolveCircleAabb, TAU } from '../core/utils.js';
import { CFG, WORLD_EDGE, BEACH_END, WEAPONS } from '../config.js';

// Vehicle entry tier: wait for the tumblers, then press inside the window.
const LOCKPICK_WAIT = 0.9;
const LOCKPICK_WINDOW = 0.45;
const LOCKPICK_COOLDOWN = 6;
const ALARM_TIME = 8;

export class Player {
  constructor(game) {
    this.game = game;
    this.model = buildHuman({
      shirt: 0xe0457b, pants: 0x2b3a55, skin: 0xb87a52, hair: 0x1a1110,
      shoes: 0x1a1a1e, female: true, hairLong: true, height: 1.0
    }, true);
    // The player is the one always-on-screen skinned body. Use the lightest
    // downloaded variant so the third-person camera cannot spend 49k triangles
    // on the protagonist alone; pedestrians keep the full ten-model pool.
    this.rig = new HumanRig(this.model, { humanId: 'athlete' });
    this.mesh = this.model.group;
    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;
    this.mesh.rotation.y = this.heading;
    this.rig.attachGun('pistol');

    this.radius = 0.42;
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 50;
    this.money = 250;
    this.stamina = 100;

    this.inVehicle = false;
    this.vehicle = null;
    this.aiming = false;
    this.sprinting = false;
    this.crouching = false;
    this.grounded = true;
    this.vy = 0;
    this.stepTimer = 0;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.hitTimer = 0;
    this.dead = false;
    this.interior = null;
    this.masked = false;
    this.refuelHold = 0;
    this.hotwire = null;
    this.hotwireAborts = 0;
    this.hotwireSuccess = 0;
    this.carjack = null;
    this.lockpick = null;
    this.lockpickSuccess = 0;
    this.lockpickFails = 0;

    this.weaponOrder = ['pistol', 'smg', 'shotgun', 'rifle'];
    this.weapons = {
      pistol: { mag: 12, reserve: 96 },
      smg: { mag: 0, reserve: 0 },
      shotgun: { mag: 0, reserve: 0 },
      rifle: { mag: 0, reserve: 0 }
    };
    this.weapon = 'pistol';
    const s = game.city.snapToStreet(-200, -14);
    this.spawn = new THREE.Vector3(s.x, 0.24, s.z);

    game.scene.add(this.mesh);
    this.mesh.position.copy(this.spawn);
  }

  get def() { return WEAPONS[this.weapon]; }
  get ammo() { return this.weapons[this.weapon]; }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  giveWeapon(key, ammo = 30) {
    if (!this.weapons[key]) return;
    const w = this.weapons[key];
    if (w.reserve + w.mag <= 0) { w.mag = WEAPONS[key].mag; w.reserve = ammo; }
    else w.reserve += ammo;
    this.weapon = key;
    this.rig.attachGun(key);
    this.game.hud.toast(`${WEAPONS[key].name} ACQUIRED`, 'good');
    this.game.audio.play('pickup');
  }

  switchWeapon(i) {
    const key = this.weaponOrder[i];
    if (!key) return;
    if ((this.weapons[key].mag + this.weapons[key].reserve) <= 0) return;
    this.weapon = key;
    this.rig.attachGun(key);
    this.reloadTimer = 0;
    this.fireCooldown = 0.25;
    this.game.audio.play('click');
    this.game.hud.updateWeapon();
  }

  reload() {
    const w = this.ammo, def = this.def;
    if (!def.mag || this.reloadTimer > 0) return;
    if (w.mag >= def.mag || w.reserve <= 0) return;
    this.reloadTimer = def.reload;
    this.game.audio.play('reload');
  }

  finishReload() {
    const w = this.ammo, def = this.def;
    const need = def.mag - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take; w.reserve -= take;
    this.game.hud.updateWeapon();
  }

  consumeAmmo() {
    if (this.ammo.mag <= 0) return false;
    this.ammo.mag--;
    this.game.hud.updateWeapon();
    return true;
  }

  takeDamage(amount, source) {
    if (this.dead || this.game.godMode) return;
    if (this.hitTimer > 0.05 && source === 'bullet') amount *= 0.4;
    this.hitTimer = 0.22;
    if (this.armor > 0) {
      const absorb = Math.min(this.armor, amount * 0.62);
      this.armor -= absorb;
      amount -= absorb;
    }
    this.health -= amount;
    this.game.hud.damageFlash();
    this.game.audio.play('hurt');
    this.game.cam.shake(0.35, 0.18);
    if (this.health <= 0) { this.health = 0; this.die(); }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.rig.die();
    this.game.onPlayerDeath(false);
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
    this.game.hud.toast('HEALTH RESTORED', 'good');
  }

  addArmor(n) {
    this.armor = Math.min(100, this.armor + n);
    this.game.hud.toast('ARMOUR ACQUIRED', 'good');
  }

  addMoney(n) {
    this.money += n;
    this.game.hud.toast(`+$${n}`, 'money');
  }

  respawn() {
    this.dead = false;
    this.rig.dead = false;
    this.rig.deadT = 0;
    this.mesh.rotation.x = 0;
    this.health = 100;
    this.armor = 25;
    this.vel.set(0, 0, 0);
    this.exitVehicle(true);
    this.teleport(this.game.hospitalSpawn || new THREE.Vector3(-160, 0.24, -60));
  }

  teleport(v) {
    this.hotwire = null;
    this.lockpick = null;
    this.exitVehicle(true);
    this.pos.copy(v);
    this.mesh.visible = true;
    this.game.cam.snap();
  }

  enterVehicle(v) {
    if (!v) return;
    // A bus is boarded as a passenger: the route driver keeps the wheel.
    if (v.isBus) {
      this.hotwire = null;
      this.lockpick = null;
      this.inVehicle = true;
      this.vehicle = v;
      this.mesh.visible = false;
      v.rider = this;
      this.game.audio.play('carDoor');
      this.game.hud.showInteract(false);
      this.game.cam.setMode('vehicle');
      return;
    }
    // Any car on the street can be taken: parked, AI traffic or a police car.
    if (v.driver === 'player') return;
    // GTA 6-style descriptions: swapping cars makes the getaway vehicle unknown.
    const pol = this.game.police;
    if (pol && pol.description && pol.description.vehicle && pol.description.vehicle !== v.id) {
      pol.description.vehicle = null;
      pol.crimeTimer *= 0.6;
      this.game.hud.toast('VEHICLE SWITCHED — DESCRIPTION STALE', 'good');
      this.game.hud.updateWanted();
    }
    this.hotwire = null;
    this.lockpick = null;
    this.inVehicle = true;
    this.vehicle = v;
    this.mesh.visible = false;
    v.setDriver('player');
    this.game.audio.play('carDoor');
    this.game.hud.showInteract(false);
    this.game.cam.setMode('vehicle');
  }

  exitVehicle(force = false) {
    if (!this.inVehicle) return;
    const v = this.vehicle;
    this.hotwire = null;
    this.lockpick = null;
    this.inVehicle = false;
    this.vehicle = null;
    if (v) {
      if (v.isBus) v.rider = null; else v.setDriver(null);
      const right = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading));
      const p = v.mesh.position.clone();
      let target = p.clone().addScaledVector(right, -2.3);
      if (this.game.city.queryColliders(target.x, target.z, 0.5).some((c) =>
        target.x > c.minX - 0.5 && target.x < c.maxX + 0.5 && target.z > c.minZ - 0.5 && target.z < c.maxZ + 0.5)) {
        target = p.clone().addScaledVector(right, 2.3);
      }
      this.pos.set(target.x, v.mesh.position.y + 0.2, target.z);
      this.vel.copy(v.velocity).multiplyScalar(0.25);
      this.heading = v.heading;
    }
    this.mesh.visible = true;
    this.game.cam.setMode('foot');
    if (!force) this.game.audio.play('carDoor');
    this.health = Math.max(this.health, 1);
    if (v && v.isBus && this.game.transit) this.game.transit.onExit();
  }

  // An occupied car is not hotwired from the pavement: the player reaches in,
  // drags the driver out and takes the seat while they run off.
  startCarjack(v) {
    this.carjack = { vehicle: v, x: this.pos.x, z: this.pos.z, t: 0 };
    this.rig.pullT = 1.0;
    this.game.audio.play('click');
    this.game.hud.toast('PULLING THE DRIVER OUT…', '');
  }

  finishCarjack(v) {
    this.carjack = null;
    const side = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading));
    const door = v.mesh.position.clone().addScaledVector(side, -1.8);
    const peds = this.game.peds;
    if (peds && peds.list.length < peds.max) {
      const d = peds.makePed(door.x, door.z, Math.max(0.22, v.mesh.position.y + 0.1));
      d.heading = v.heading + Math.PI;
      d.alarm = 9;
      d.speed = 5.2;
      this.game.audio.play('bodyFall');
      this.game.hud.toast('DRIVER PULLED OUT', 'good');
    }
    v.driver = null;
    this.enterVehicle(v);
    this.game.police.reportCrime('vehicle theft', v.pos);
  }

  startHotwire(v, inside = false) {
    this.hotwire = { vehicle: v, x: this.pos.x, z: this.pos.z, t: 0, inside: !!inside };
    this.game.audio.play('click');
    this.game.hud.toast('HOTWIRING…', '');
  }

  abortHotwire(reason) {
    if (!this.hotwire) return;
    this.hotwire = null;
    this.hotwireAborts++;
    this.game.hud.toast(`HOTWIRE ABORTED${reason ? ' — ' + reason : ''}`, 'bad');
  }

  finishHotwire(v) {
    const inside = !!(this.hotwire && this.hotwire.inside);
    this.hotwire = null;
    this.hotwireSuccess++;
    v.keys = true;
    v.locked = false;
    v.engineOn = true;
    v.alarm = 0;
    if (!inside) this.enterVehicle(v);
    this.game.hud.toast('HOTWIRED — ENGINE RUNNING', 'good');
    // A witness reports the theft; with nobody watching it goes unnoticed.
    this.game.police.reportCrime('vehicle theft', v.pos);
  }

  startLockpick(v) {
    this.lockpick = { vehicle: v, x: this.pos.x, z: this.pos.z, t: 0 };
    this.game.audio.play('click');
    this.game.hud.toast('LOCKPICKING…', '');
  }

  abortLockpick(reason) {
    if (!this.lockpick) return;
    this.lockpick = null;
    this.game.hud.toast(`LOCKPICK ABORTED${reason ? ' — ' + reason : ''}`, 'bad');
  }

  failLockpick(v) {
    this.lockpick = null;
    this.lockpickFails++;
    v.lockpickFailures = (v.lockpickFailures || 0) + 1;
    v.lockCooldown = LOCKPICK_COOLDOWN;
    v.alarm = ALARM_TIME;
    v.engineOn = false;
    this.game.audio.play('alarm', 1, Math.hypot(this.pos.x - v.pos.x, this.pos.z - v.pos.z));
    this.game.hud.toast('LOCKPICK FAILED — ALARM', 'bad');
    // The existing alarm path counts as a witness and raises the normal police
    // response; no separate wanted/agent system is involved.
    this.game.police.reportCrime('alarm', v.pos);
  }

  finishLockpick(v) {
    this.lockpick = null;
    this.lockpickSuccess++;
    v.locked = false;
    v.lockCooldown = 0;
    v.alarm = 0;
    v.keys = false;
    v.engineOn = false;
    this.enterVehicle(v);
    this.game.hud.toast('DOOR OPEN — HOTWIRE TO START', 'good');
  }

  currentForward(out) { return this.forward(out); }

  update(dt, game) {
    const input = game.input;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.hitTimer = Math.max(0, this.hitTimer - dt);

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }

    if (this.inVehicle && this.vehicle) {
      this.mesh.position.copy(this.vehicle.mesh.position);
      this.heading = this.vehicle.heading;
      this.mesh.rotation.y = this.heading;
      this.rig.update(dt, { speed: 0, sitting: true });
      if (!this.vehicle.dead) {
        this.pos.y = this.vehicle.mesh.position.y;
      }
      if (this.vehicle.isBus) {
        if (input.hit('KeyF') || input.hit('KeyE')) game.transit.tryExit();
        return;
      }
      // Lockpicked cars sit inside with the engine off: the existing hotwire
      // timer is the only way to start them. E exits.
      if (!this.vehicle.keys) {
        const v = this.vehicle;
        const h = this.hotwire && this.hotwire.vehicle === v ? this.hotwire : null;
        if (h) {
          h.t += dt;
          if (input.hit('KeyF')) this.abortHotwire('CANCELLED');
          else if (h.t >= 1.8) this.finishHotwire(v);
          else game.hud.showInteract(true, `HOTWIRING · ${(1.8 - h.t).toFixed(1)}s`, 'F');
        } else {
          game.hud.showInteract(true, 'HOTWIRE · F', 'F');
          if (input.hit('KeyF')) this.startHotwire(v, true);
        }
        if (input.hit('KeyE')) this.exitVehicle();
        return;
      }
      // fuel / repair at a roadside station (hold F), exit with E
      const stations = game.city.fuelStations || [];
      let pump = null;
      for (const s of stations) {
        if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < 6) { pump = s; break; }
      }
      if (pump && Math.abs(this.vehicle.speed) < 2) {
        const need = 1 - this.vehicle.fuel;
        const repair = this.vehicle.engineHealth < 0.999;
        const busy = need > 0.01 || repair;
        game.hud.showInteract(true, busy ? 'HOLD F · REFUEL / REPAIR' : 'FULLY SERVICED');
        if (busy && input.down('KeyF')) {
          // Traffic can shove a parked car; hold it on the pump while servicing.
          this.vehicle.pos.set(pump.x, this.vehicle.pos.y, pump.z);
          this.vehicle.velocity.set(0, 0, 0);
          this.vehicle.speed = 0;
          this.refuelHold += dt;
          if (this.refuelHold > 0.8) {
            const cost = Math.min(this.money, Math.ceil(need * 40 + (repair ? 60 : 0)));
            this.money -= cost;
            this.vehicle.fuel = 1;
            this.vehicle.engineHealth = 1;
            this.vehicle.engineOn = true;
            this.refuelHold = 0;
            game.hud.toast(`REFUELLED · $${cost}`, 'money');
          }
        } else this.refuelHold = 0;
        if (input.hit('KeyE')) this.exitVehicle();
      } else if (input.hit('KeyF') || input.hit('KeyE')) this.exitVehicle();
      return;
    }

    // ---- on foot ----
    const yaw = game.cam.yaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // screen-right for a forward of (sin yaw, 0, cos yaw) is (-cos yaw, 0, sin yaw)
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

    let wx = 0, wz = 0;
    if (input.down('KeyW')) { wx += fwd.x; wz += fwd.z; }
    if (input.down('KeyS')) { wx -= fwd.x; wz -= fwd.z; }
    if (input.down('KeyD')) { wx += right.x; wz += right.z; }
    if (input.down('KeyA')) { wx -= right.x; wz -= right.z; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    const wantsSprint = input.down('ShiftLeft') && wl > 0 && this.stamina > 2 && !this.aiming;
    this.sprinting = wantsSprint;
    if (wantsSprint) this.stamina = Math.max(0, this.stamina - dt * 18);
    else this.stamina = Math.min(100, this.stamina + dt * 12);

    this.aiming = input.mouseDown(2) && !this.sprinting;
    // crouch: hold Ctrl. Slower, lower, and steadier when aiming.
    this.crouching = input.down('ControlLeft') && this.grounded && !this.sprinting;

    const maxSpeed = this.crouching ? 1.9 : (this.aiming ? 2.6 : (this.sprinting ? 8.0 : 4.6));
    const accel = this.grounded ? 26 : 8;
    const targetVx = wx * maxSpeed, targetVz = wz * maxSpeed;
    this.vel.x = damp(this.vel.x, targetVx, accel * 0.42, dt);
    this.vel.z = damp(this.vel.z, targetVz, accel * 0.42, dt);

    // Interiors sit on a separate grid far outside the world bounds. While
    // inside, skip the world clamp, ground height and building colliders or
    // the room (and its counter/bed) would be unreachable on live frames.
    const indoors = !!game.interior;
    if (!indoors) {
      // gravity & jump
      const ground = game.city.getGroundHeight(this.pos.x, this.pos.z);
      if (input.hit('Space') && this.grounded) {
        this.vy = 5.6;
        this.grounded = false;
        game.audio.play('jump');
      }
      this.vy -= 20 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.grounded = true; }

      // collision with buildings
      const cols = game.city.queryColliders(this.pos.x, this.pos.z, this.radius + 3);
      for (const c of cols) resolveCircleAabb(this.pos, this.radius, c);

      // avoid walking into the sea
      if (this.pos.z > BEACH_END - 6) { this.pos.z = BEACH_END - 6; }
      this.pos.x = clamp(this.pos.x, -WORLD_EDGE - 60, WORLD_EDGE + 60);
    } else {
      this.vy = 0;
      this.grounded = true;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    // facing
    let faceTarget = this.heading;
    if (this.aiming) faceTarget = yaw;
    else if (speed > 0.4) faceTarget = Math.atan2(this.vel.x, this.vel.z);
    this.heading = dampAngle(this.heading, faceTarget, this.aiming ? 22 : 12, dt);
    this.mesh.rotation.y = this.heading;

    // steps
    if (speed > 0.6 && this.grounded) {
      this.stepTimer -= dt * (this.sprinting ? 1.7 : 1);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        game.audio.play('step', this.sprinting ? 0.55 : 0.35);
      }
    }

    // the head follows where the camera is pointed, within a human neck range
    this._look = this._look || new THREE.Vector3();
    this._look.set(
      this.pos.x + Math.sin(yaw) * 8,
      this.pos.y + 1.5 + Math.sin(game.cam.pitch || 0) * 6,
      this.pos.z + Math.cos(yaw) * 8
    );
    this.rig.update(dt, {
      speed, aiming: this.aiming, sprint: this.sprinting, low: this.crouching,
      airborne: !this.grounded, vy: this.vy,
      lookAt: this._look, lean: this.aiming ? -0.05 : 0
    });

    // weapon controls
    if (input.hit('KeyR')) this.reload();
    if (input.hit('Digit1')) this.switchWeapon(0);
    if (input.hit('Digit2')) this.switchWeapon(1);
    if (input.hit('Digit3')) this.switchWeapon(2);
    if (input.hit('Digit4')) this.switchWeapon(3);

    // vehicle proximity prompt
    const near = game.vehicles.nearest(this.pos, 5.6);
    // Boarding a bus at a stop goes through the same F interaction path as a
    // car, but pays the line's fare and leaves the route driver in control.
    const bus = game.transit ? game.transit.boardable(this.pos) : null;
    // Parked cars have no driver; AI traffic has driver 'ai'. Both can be taken
    // over on foot. Cars with keys (mission vehicles, or one you already
    // hotwired) open instantly; everything else needs a hotwire.
    if (bus) {
      this.hotwire = null;
      game.hud.showInteract(true, `BOARD BUS · $${game.transit.fare}`, 'F');
      if (input.hit('KeyF')) game.transit.board(bus);
    } else if (near && (!near.driver || near.driver === 'ai')) {
      if (near.keys) {
        this.hotwire = null;
        this.lockpick = null;
        game.hud.showInteract(true, 'ENTER VEHICLE');
        if (input.hit('KeyF') || input.hit('KeyE')) this.enterVehicle(near);
      } else if (near.driver === null) {
        // Parked and locked: a timed lockpick is the only way in. A successful
        // lockpick opens the doors but leaves the engine off, so the existing
        // hotwire timer still has to be played from inside.
        if (near.lockCooldown > 0) {
          this.lockpick = null;
          game.hud.showInteract(true, `ALARMED · RETRY IN ${Math.ceil(near.lockCooldown)}s`);
        } else if (near.locked === false) {
          this.lockpick = null;
          game.hud.showInteract(true, 'ENTER VEHICLE');
          if (input.hit('KeyF') || input.hit('KeyE')) this.enterVehicle(near);
        } else if (this.lockpick && this.lockpick.vehicle === near) {
          const l = this.lockpick;
          const moved = Math.hypot(this.pos.x - l.x, this.pos.z - l.z);
          l.t += dt;
          if (moved > 0.75) this.abortLockpick('MOVED AWAY');
          else if (l.t < LOCKPICK_WAIT) {
            if (input.hit('KeyF')) this.failLockpick(near);
            else game.hud.showInteract(true, 'LOCKPICKING · WAIT…', 'F');
          } else if (l.t <= LOCKPICK_WAIT + LOCKPICK_WINDOW) {
            game.hud.showInteract(true, 'LOCKPICK · F NOW', 'F');
            if (input.hit('KeyF')) this.finishLockpick(near);
          } else this.failLockpick(near);
        } else {
          this.lockpick = null;
          game.hud.showInteract(true, 'LOCKPICK · F', 'F');
          if (input.hit('KeyF')) this.startLockpick(near);
        }
      } else if (!this.carjack || this.carjack.vehicle !== near) {
        // Somebody is sitting in this car. Reaching in and pulling them out is
        // the only way to take it — no hotwire while it is being driven.
        this.hotwire = null;
        game.hud.showInteract(true, 'PULL DRIVER OUT', 'F');
        if (input.hit('KeyF')) this.startCarjack(near);
      } else {
        const c = this.carjack;
        const moved = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
        c.t += dt;
        if (moved > 0.9) {
          this.carjack = null;
          this.rig.pullT = 0;
          game.hud.toast('CARJACK ABORTED — MOVED AWAY', 'bad');
        } else if (c.t >= 1.05) {
          this.finishCarjack(near);
        } else {
          game.hud.showInteract(true, 'PULLING DRIVER OUT…', 'F');
        }
      }
    } else {
      if (this.hotwire) this.abortHotwire('LEFT THE VEHICLE');
      if (this.lockpick) this.abortLockpick('LEFT THE VEHICLE');
      if (this.carjack) { this.carjack = null; this.rig.pullT = 0; }
      game.hud.showInteract(false);
    }

    // doors / interiors: choose the nearest door, not the first one in the
    // array, so adjacent/overlapping shopfronts stay individually reachable.
    let door = null, doorD = 2.2;
    for (const it of game.city.interiors) {
      if (!it.entry) continue;
      const d = Math.hypot(this.pos.x - it.entry.x, this.pos.z - it.entry.z);
      if (d < doorD) { door = it; doorD = d; }
    }
    if (door) {
      game.hud.showInteract(true, `ENTER ${door.name}`);
      if (input.hit('KeyF')) game.enterInterior(door);
    }

    if (!indoors && this.pos.y < -20) this.teleport(this.spawn.clone());
  }
}
