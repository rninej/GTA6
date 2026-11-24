// Palma City — wanted system, police response, hostiles, helicopter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHuman, HumanRig, disposeHuman } from './humanoid.js';
import { MODELS, instanceHeli } from '../world/models.js';
import { rand, clamp, dampAngle, resolveCircleAabb, rayAabb, TAU, pick } from '../core/utils.js';

const COP_SHIRTS = [0x1b2a44, 0x16233a];
const GANG_SHIRTS = [0x1a1a1e, 0x2a1a2a, 0x203020, 0x2a2020];

export class Agent {
  constructor(game, opts = {}) {
    this.game = game;
    this.faction = opts.faction || 'gang';
    const isCop = this.faction === 'cop';
    const model = buildHuman({
      shirt: isCop ? pick(COP_SHIRTS) : pick(GANG_SHIRTS),
      pants: isCop ? 0x101827 : 0x22262e,
      skin: pick([0xe8c39e, 0xd4a373, 0xb87a52, 0x8d5524, 0x6b4226]),
      hair: 0x161210,
      shoes: 0x0d0d10,
      height: rand(0.98, 1.08),
      hat: isCop ? 0x101827 : null
    }, true);
    this.model = model;
    // Cops get the tactical model, gangs get street clothes. Before this the
    // rig attached a random human from the whole pool, so patrol officers could
    // spawn as a robot or a chef.
    this.rig = new HumanRig(model, {
      humanPool: isCop ? ['soldier'] : ['hoodieteen', 'businessman', 'constructionworker']
    });
    this.mesh = model.group;
    this.pos = this.mesh.position;
    this.pos.set(opts.x || 0, opts.y || 0.22, opts.z || 0);
    this.heading = opts.heading || 0;
    this.mesh.rotation.y = this.heading;
    this.weaponKey = isCop ? 'pistol' : pick(['pistol', 'smg']);
    this.rig.attachGun(this.weaponKey);
    this.health = isCop ? 110 : 90;
    this.dead = false;
    this.deadTimer = 0;
    this.speed = 0;
    this.fireTimer = rand(0.6, 1.6);
    this.aimTimer = 0;
    this.state = 'idle';
    this.radius = 0.42;
    this.homeX = this.pos.x;
    this.homeZ = this.pos.z;
    this.accuracy = isCop ? 0.42 : 0.5;
    game.scene.add(this.mesh);
  }

  takeDamage(n, from) {
    if (this.dead) return;
    this.health -= n;
    this.game.effects.blood(this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)));
    if (this.health <= 0) this.die(from);
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 22;
    this.rig.die();
    this.rig.detachGun();
    this.game.audio.play('bodyFall');
    if (this.faction === 'cop') this.game.police.addWanted(1, true);
    else this.game.missions.onKill(this);
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    disposeHuman(this.mesh);
  }

  hasLineOfSight(target) {
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const dir = new THREE.Vector3(target.x - eye.x, (target.y + 1.1) - eye.y, target.z - eye.z);
    const dist = dir.length();
    dir.normalize();
    for (const c of this.game.city.queryColliders(this.pos.x, this.pos.z, 60)) {
      const t = rayAabb(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, c, dist);
      if (t > 0 && t < dist - 0.5) return false;
    }
    return true;
  }

  update(dt, game) {
    if (this.dead) {
      this.deadTimer -= dt;
      this.rig.update(dt, {});
      if (this.deadTimer <= 0) { this.dispose(); this.removed = true; }
      return;
    }
    const target = game.player;
    const desc = game.police && game.police.description;
    const weak = desc && !desc.face && !desc.clothes;
    const search = weak && game.police.lastKnown ? game.police.lastKnown : null;
    const tpos = search ? { x: search.x, y: 0, z: search.z } : target.pos;
    const dx = tpos.x - this.pos.x, dz = tpos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const hostile = this.faction === 'gang' || game.wanted > 0;
    const stopDist = this.faction === 'cop' ? 13 : 9;

    if (!hostile) {
      // cops idle when nobody is wanted
      this.state = 'idle';
      this.speed = 0;
      this.rig.update(dt, { speed: 0 });
      return;
    }

    if (dist > stopDist) {
      const want = Math.atan2(dx, dz);
      this.heading = dampAngle(this.heading, want, 8, dt);
      this.speed = dist > 26 ? 5.6 : 4.2;
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
      this.pos.x = nx; this.pos.z = nz;
      for (const c of game.city.queryColliders(this.pos.x, this.pos.z, 1.5)) resolveCircleAabb(this.pos, this.radius, c);
      this.state = 'chase';
    } else {
      this.speed = 0;
      this.state = 'aim';
      const want = Math.atan2(dx, dz);
      this.heading = dampAngle(this.heading, want, 12, dt);
    }

    this.pos.y = game.city.getGroundHeight(this.pos.x, this.pos.z);
    this.mesh.rotation.y = this.heading;

    this.aimTimer += dt;
    this.rig.update(dt, { speed: this.speed, aiming: true, sprint: this.speed > 5 });

    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < 46 && this.aimTimer > 0.5) {
      const los = !search && this.hasLineOfSight(tpos);
      if (los) {
        this.fireTimer = this.weaponKey === 'smg' ? rand(0.22, 0.5) : rand(0.7, 1.35);
        this.rig.fire();
        game.combat.npcShoot(this, tpos, dist);
      } else {
        this.fireTimer = 0.4;
      }
    }
  }
}

export class Police {
  constructor(game) {
    this.game = game;
    this.agents = [];
    this.spawnTimer = 3;
    this.crimeTimer = 0;
    this.copExitTimer = 0;
    this.maxAgents = 12;
    // What the police actually know about you (GTA 6 style). A crime needs a
    // witness; a weak description makes units search instead of chase.
    this.description = { face: false, clothes: false, vehicle: null };
    this.lastKnown = null;
    this.witnessCount = 0;
    this.buildHeli();
  }

  buildHeli() {
    const g = new THREE.Group();
    this.heliModel = null;
    const entry = MODELS.helicopters && MODELS.helicopters[0];
    if (entry) {
      try {
        const inst = instanceHeli(entry);
        g.add(inst.root);
        this.heliModel = inst;
      } catch (err) {
        MODELS.errors.push('heli-instance:' + (err && err.message ? err.message : err));
      }
    }
    if (!this.heliModel) {
      // Procedural fallback only: a low-poly downloaded body is used above when
      // available, so the normal path is one body draw call.
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 5.2),
        new THREE.MeshStandardMaterial({ color: 0x10141c, metalness: 0.5, roughness: 0.4 }));
      g.add(body);
      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x0a1a22, metalness: 0.8, roughness: 0.1 }));
      cockpit.position.set(0, 0.35, 2.1);
      g.add(cockpit);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.4),
        new THREE.MeshStandardMaterial({ color: 0x10141c, metalness: 0.5, roughness: 0.4 }));
      boom.position.set(0, 0.2, -4.4);
      g.add(boom);
    }

    // The downloaded helicopter is a single static body; the spinning rotors
    // are one merged blade mesh each, so the whole aircraft stays at 3 calls.
    const box = new THREE.Box3().setFromObject(g);
    const top = box.max.y;
    const span = Math.max(3.6, box.max.x - box.min.x);
    const bladeGeos = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.BoxGeometry(0.22, 0.05, span * 1.35);
      b.rotateY((i / 4) * Math.PI * 2);
      bladeGeos.push(b);
    }
    const rotor = new THREE.Mesh(mergeGeometries(bladeGeos, false),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }));
    bladeGeos.forEach((b) => b.dispose());
    rotor.position.y = top + 0.18;
    g.add(rotor);
    this.heliRotor = rotor;

    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22 }));
    tailRotor.position.set(0.3, top * 0.35, box.min.z + 0.2);
    g.add(tailRotor);
    this.heliTail = tailRotor;

    const spot = new THREE.SpotLight(0xdfe9ff, 0, 130, 0.32, 0.5, 1.2);
    spot.position.set(0, -1, 1.5);
    g.add(spot);
    spot.target.position.set(0, -40, 8);
    g.add(spot.target);
    this.heliLight = spot;

    g.visible = false;
    this.game.scene.add(g);
    this.heli = g;
    this.heliAngle = 0;
  }

  addWanted(n, silent = false) {
    const g = this.game;
    if (g.godMode) return;
    const prev = g.wanted;
    g.wanted = clamp(g.wanted + n, 0, 5);
    this.crimeTimer = 26 + g.wanted * 6;
    if (g.wanted !== prev) {
      if (!silent) g.audio.play('wanted');
      if (g.wanted === 1) g.hud.toast('POLICE ALERTED', 'bad');
      if (g.wanted >= 3) g.hud.toast('POLICE RESPONSE ESCALATING', 'bad');
      g.hud.updateWanted();
    }
  }

  // Report a crime. Returns false when nobody saw it happen.
  reportCrime(kind, pos, opts = {}) {
    const g = this.game;
    if (g.godMode) return false;
    let witness = 0, close = false, copWitness = 0;
    for (const p of g.peds.list) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < 34) { witness++; if (d < 20) close = true; p.alarm = Math.max(p.alarm, 5); }
    }
    for (const a of this.agents) {
      if (a.faction !== 'cop' || a.dead) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d < 55) { witness++; copWitness++; close = true; }
    }
    // Store clerks and alarms always count as a witness even when no street
    // ped is within range (interiors sit away from the ped grid).
    if (opts.forceWitness) { witness = Math.max(witness, 1); close = true; }
    if (kind === 'alarm') witness = Math.max(witness, 1);
    this.witnessCount = witness;
    if (!witness) {
      if (g.hud) g.hud.toast('NO WITNESSES', '');
      return false;
    }
    const p = g.player;
    this.description.face = this.description.face || (close && !p.masked);
    this.description.clothes = this.description.clothes || close;
    this.description.vehicle = p.inVehicle && p.vehicle ? p.vehicle.id : this.description.vehicle;
    this.lastKnown = { x: pos.x, z: pos.z };
    // Escalation that matches the crime instead of every report adding a star:
    // a gunshot in a quiet street alerts the police once, a witnessed homicide
    // is one star (two when it happens right in front of people), and the rest
    // is a single step. Repeated pellet hits are de-duplicated in combat.js.
    if (kind === 'gunshot') {
      if (g.wanted === 0) this.addWanted(1);
    } else if (kind === 'homicide') {
      this.addWanted(copWitness ? 2 : 1);
    } else {
      this.addWanted(1);
    }
    if (g.hud) g.hud.updateWanted();
    return true;
  }

  clearWanted() {
    this.game.wanted = 0;
    this.crimeTimer = 0;
    this.game.hud.updateWanted();
    for (const a of this.agents) if (a.faction === 'cop' && !a.dead) { a.removed = true; a.dispose(); }
    this.agents = this.agents.filter((a) => a.faction !== 'cop');
    for (const v of this.game.vehicles.all) {
      if (v.driver === 'cop') { v.remove(); }
    }
    this.heli.visible = false;
  }

  spawnCop(pos) {
    const a = new Agent(this.game, {
      faction: 'cop',
      x: pos.x + rand(-2, 2), z: pos.z + rand(-2, 2), heading: rand(0, TAU)
    });
    this.agents.push(a);
    return a;
  }

  spawnGang(x, z, count = 4) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = new Agent(this.game, {
        faction: 'gang', x: x + rand(-6, 6), z: z + rand(-6, 6), heading: rand(0, TAU)
      });
      a.accuracy = 0.35;
      this.agents.push(a);
      out.push(a);
    }
    return out;
  }

  update(dt, game) {
    // agents
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      a.update(dt, game);
      if (a.removed) this.agents.splice(i, 1);
    }

    if (game.wanted <= 0) {
      this.heli.visible = false;
      this.heliLight.intensity = 0;
      return;
    }

    this.crimeTimer -= dt;
    this.spawnTimer -= dt;
    // evasion: once no officer is within sight the heat bleeds off much faster,
    // so a clean getaway actually clears the wanted level in a reasonable time
    {
      let near = false;
      for (const a of this.agents) {
        if (a.faction === 'cop' && !a.dead && Math.hypot(a.pos.x - game.player.pos.x, a.pos.z - game.player.pos.z) < 55) { near = true; break; }
      }
      if (!near) this.crimeTimer -= dt * 3.5;
    }
    const p = game.player.pos;

    const copCars = game.vehicles.all.filter((v) => v.driver === 'cop' && !v.dead).length;
    const wanted = game.wanted;

    if (this.spawnTimer <= 0 && copCars < Math.min(6, Math.ceil(wanted * 1.2))) {
      this.spawnTimer = Math.max(2.2, 7 - wanted);
      game.vehicles.spawnPolice(p, wanted);
    }

    // cops bail out of cruisers near the player
    this.copExitTimer -= dt;
    if (this.copExitTimer <= 0) {
      this.copExitTimer = 1.2;
      for (const v of game.vehicles.all) {
        if (v.driver !== 'cop' || v.dead) continue;
        const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
        if (d < 26 && Math.abs(v.speed) < 6) {
          const cops = this.agents.filter((a) => a.faction === 'cop' && !a.dead).length;
          if (cops < this.maxAgents) {
            v.driver = null;
            v.aiMode = 'parked';
            v.brake = 1;
            this.spawnCop(v.pos.clone().add(new THREE.Vector3(2, 0, 0)));
            this.spawnCop(v.pos.clone().add(new THREE.Vector3(-2, 0, 0)));
            game.audio.play('carDoor');
          }
        }
      }
    }

    // helicopter at 4+
    if (wanted >= 4) {
      this.heli.visible = true;
      this.heliAngle += dt * 0.32;
      const r = 52;
      const x = p.x + Math.cos(this.heliAngle) * r;
      const z = p.z + Math.sin(this.heliAngle) * r;
      const y = 42 + Math.sin(this.heliAngle * 1.7) * 3;
      this.heli.position.set(x, y, z);
      this.heli.lookAt(p.x, p.y, p.z);
      this.heliRotor.rotation.y += dt * 28;
      this.heliTail.rotation.x += dt * 40;
      this.heliLight.intensity = 900;
      this.heliLight.target.position.set(0, -60, 6);
      if (Math.random() < dt * 0.35) game.audio.play('heli', 0.5);
    } else {
      this.heli.visible = false;
      this.heliLight.intensity = 0;
    }

    // lose the cops
    if (this.crimeTimer <= 0) {
      let seen = false;
      for (const a of this.agents) {
        if (a.faction !== 'cop' || a.dead) continue;
        if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 55) { seen = true; break; }
      }
      if (!seen) {
        game.wanted = Math.max(0, game.wanted - 1);
        this.crimeTimer = 11;
        game.hud.updateWanted();
        if (game.wanted === 0) {
          game.hud.toast('YOU LOST THE COPS', 'good');
          this.clearWanted();
        }
      } else {
        this.crimeTimer = 10;
      }
    }
  }
}
