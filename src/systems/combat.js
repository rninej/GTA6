// Palma City — hitscan combat, damage, pickups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../config.js';
import { MODELS } from '../world/models.js';
import { rayAabb, raySphere, rand, clamp } from '../core/utils.js';

const PICKUP_COLORS = { health: 0x3dff8a, armor: 0x3d9bff, ammo: 0xffd447 };

function paintGeometry(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.tmpV = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
    this.pickups = [];
    this.spawnPickups();
  }

  pickupGeometry(kind) {
    if (!this.pickupProtos) this.pickupProtos = new Map();
    if (this.pickupProtos.has(kind)) return this.pickupProtos.get(kind);
    const geos = [];
    const entry = (MODELS.pickups || []).find((p) => p.id === kind);
    if (entry && entry.geometry) {
      geos.push(entry.geometry.clone());
    } else {
      const box = new THREE.BoxGeometry(0.42, 0.42, 0.42);
      paintGeometry(box, PICKUP_COLORS[kind]);
      geos.push(box);
    }
    // The glowing ring used to be a second mesh and a second draw call. It is
    // now merged into the same vertex-coloured geometry as the model.
    const ring = new THREE.RingGeometry(0.6, 0.72, 24);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, -0.34, 0);
    paintGeometry(ring, PICKUP_COLORS[kind]);
    geos.push(ring);
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) merged.computeBoundingSphere();
    this.pickupProtos.set(kind, merged);
    return merged;
  }

  pickupMaterial(kind) {
    if (!this.pickupMats) this.pickupMats = new Map();
    let mat = this.pickupMats.get(kind);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.45, metalness: 0.2,
        emissive: PICKUP_COLORS[kind], emissiveIntensity: 0.35
      });
      this.pickupMats.set(kind, mat);
    }
    return mat;
  }

  spawnPickups() {
    const spots = [
      ['health', -196, -10], ['health', 22, 40], ['health', 176, 118], ['health', -88, 210],
      ['armor', -210, -22], ['armor', 44, 30], ['armor', 300, -120], ['armor', -320, -40],
      ['ammo', -186, -26], ['ammo', 60, 44], ['ammo', 208, 128], ['ammo', -376, 76],
      ['ammo', 120, -210], ['health', 240, -60], ['armor', -40, 300]
    ];
    for (const [kind, x, z] of spots) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(this.pickupGeometry(kind), this.pickupMaterial(kind));
      g.add(mesh);
      g.position.set(x, 0.85, z);
      this.game.scene.add(g);
      this.pickups.push({ kind, group: g, mesh, x, z, active: true, timer: 0 });
    }
  }

  update(dt) {
    const p = this.game.player;
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.timer -= dt;
        if (pk.timer <= 0) { pk.active = true; pk.group.visible = true; }
        continue;
      }
      pk.group.rotation.y += dt * 1.6;
      pk.group.position.y = 0.85 + Math.sin(performance.now() * 0.002 + pk.x) * 0.08;
      const d = Math.hypot(p.pos.x - pk.x, p.pos.z - pk.z);
      if (d < 1.5 && !p.inVehicle && !p.dead) {
        if (pk.kind === 'health') {
          if (p.health >= p.maxHealth) continue;
          p.heal(45);
        } else if (pk.kind === 'armor') {
          if (p.armor >= 100) continue;
          p.addArmor(50);
        } else {
          const w = p.weapons[p.weapon];
          w.reserve += 60;
          this.game.hud.toast('AMMO +60', 'good');
          this.game.hud.updateWeapon();
          this.game.audio.play('pickup');
        }
        pk.active = false;
        pk.group.visible = false;
        pk.timer = 45;
      }
    }
  }

  /* ----------------------------- player fire ----------------------------- */
  playerFire() {
    const game = this.game;
    const p = game.player;
    if (p.dead || p.inVehicle) return;
    const def = WEAPONS[p.weapon];
    if (p.reloadTimer > 0 || p.fireCooldown > 0) return;
    if (p.ammo.mag <= 0) {
      game.audio.play('click');
      p.fireCooldown = 0.3;
      p.reload();
      return;
    }
    p.consumeAmmo();
    p.fireCooldown = 60 / def.rpm;
    p.rig.fire();

    const cam = game.camera;
    // Fire from the camera, not the chest: in third person the camera sits above
    // and behind the character, and a chest-origin ray parallel to the view
    // dropped shots into the pavement or clipped the wall the player stood next
    // to, which is why hits sometimes did nothing.
    const origin = cam.position.clone();
    cam.getWorldDirection(this.tmpDir);
    // one crime report per trigger pull: a shotgun's eight pellets each killed
    // their own target and each reported a homicide, jumping straight to 5 stars
    this._crimeThisShot = false;
    const spread = def.spread * (p.aiming ? 0.35 : 1.0);
    const pellets = def.pellets || 1;
    const muzzle = new THREE.Vector3();
    p.rig.getMuzzle(muzzle);
    muzzle.y += 0.02;

    for (let i = 0; i < pellets; i++) {
      const dir = this.tmpDir.clone();
      dir.x += rand(-spread, spread);
      dir.y += rand(-spread, spread);
      dir.z += rand(-spread, spread);
      dir.normalize();
      const hit = this.hitscan(origin, dir, def.range, 'player');
      if (hit.type !== 'none') {
        const from = muzzle.clone();
        this.game.effects.tracer(from, hit.point);
      }
    }

    this.game.effects.muzzle(muzzle, this.tmpDir);
    this.game.audio.play('shot', 0.85, 0, p.weapon);
    game.cam.shake(def.kick * 0.35, 0.08);
    game.cam.addRecoil(def.kick * 0.012);
    game.peds.alarm(p.pos, 42);
    // A shot only raises the wanted level if somebody saw or heard it and the
    // police were called; otherwise it stays a private crime.
    if (!game.police.reportCrime('gunshot', p.pos)) {
      if (game.wanted > 0) game.police.crimeTimer = Math.max(game.police.crimeTimer, 12);
    }
  }

  hitscan(origin, dir, range, shooter) {
    const game = this.game;
    let best = { t: range, type: 'none', point: null, target: null };

    // world geometry
    const near = game.city.queryColliders(origin.x, origin.z, range * 0.5 + 8);
    const seen = new Set();
    for (const c of near) {
      if (seen.has(c)) continue;
      seen.add(c);
      const t = rayAabb(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c, best.t);
      if (t >= 0 && t < best.t) best = { t, type: 'wall', point: origin.clone().addScaledVector(dir, t), target: null };
    }

    // body hitbox: three stacked spheres plus a smaller head sphere, so a high
    // shot registers as a headshot instead of being swallowed by the torso
    const bodyHit = (pos, rad = 0.44) => {
      // legs and torso stop at chest height: a 1.3 m sphere reached up to the
      // chin, so the head sphere was always swallowed by the body and every hit
      // counted as a body shot
      let bt = -1, head = false;
      for (const h of [0.4, 1.0]) {
        const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, pos.x, pos.y + h, pos.z, rad);
        if (t > 0 && (bt < 0 || t < bt)) bt = t;
      }
      const ht = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, pos.x, pos.y + 1.63, pos.z, 0.22);
      if (ht > 0 && (bt < 0 || ht < bt)) { bt = ht; head = true; }
      return { t: bt, head };
    };

    if (shooter === 'player') {
      for (const ped of game.peds.list) {
        if (ped.dead) continue;
        const h = bodyHit(ped.pos, 0.44);
        if (h.t > 0 && h.t < best.t) best = { t: h.t, head: h.head, type: 'ped', point: origin.clone().addScaledVector(dir, h.t), target: ped };
      }
      for (const a of game.police.agents) {
        if (a.dead) continue;
        const h = bodyHit(a.pos, 0.44);
        if (h.t > 0 && h.t < best.t) best = { t: h.t, head: h.head, type: 'agent', point: origin.clone().addScaledVector(dir, h.t), target: a };
      }
    } else {
      const p = game.player;
      if (!p.inVehicle) {
        const h = bodyHit(p.pos, 0.44);
        if (h.t > 0 && h.t < best.t) best = { t: h.t, head: h.head, type: 'player', point: origin.clone().addScaledVector(dir, h.t), target: p };
      }
    }

    // vehicles
    for (const v of game.vehicles.all) {
      if (v.dead || v.removed) continue;
      if (shooter === 'player' && v.isPlayer) continue;
      const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, v.pos.x, v.pos.y + 0.8, v.pos.z, v.spec.length * 0.42);
      if (t > 0 && t < best.t) best = { t, type: 'vehicle', point: origin.clone().addScaledVector(dir, t), target: v };
    }

    if (best.type === 'none') return best;

    const def = WEAPONS[game.player.weapon];
    if (best.type === 'ped') {
      const ped = best.target;
      ped.health -= def.dmg * (best.head ? 2.5 : 1);
      this.game.effects.blood(best.point);
      this.game.hud.hitmarker();
      if (ped.health <= 0) {
        ped.dead = true;
        ped.deadTimer = 20;
        ped.rig.die();
        if (!this._crimeThisShot) {
          this._crimeThisShot = true;
          this.game.police.reportCrime('homicide', ped.pos);
        }
        this.game.audio.play('bodyFall');
        this.game.hud.toast(best.head ? 'CIVILIAN DOWN — HEADSHOT' : 'CIVILIAN DOWN', 'bad');
      } else {
        ped.alarm = 9;
      }
    } else if (best.type === 'agent') {
      best.target.takeDamage(def.dmg * (best.head ? 2.2 : 1));
      this.game.hud.hitmarker();
      this.game.effects.blood(best.point);
      if (best.target.dead) this.game.hud.toast('TARGET DOWN', 'good');
    } else if (best.type === 'vehicle') {
      best.target.damage(def.dmg * 3);
      this.game.effects.sparks(best.point, dir.clone().negate(), 0xffc46a, 5);
      this.game.hud.hitmarker();
    } else if (best.type === 'wall') {
      this.game.effects.sparks(best.point, dir.clone().negate(), 0xd8d0c0, 4);
    }
    return best;
  }

  npcShoot(agent, targetPos, dist) {
    const game = this.game;
    const origin = new THREE.Vector3(agent.pos.x, agent.pos.y + 1.35, agent.pos.z);
    const dir = new THREE.Vector3(targetPos.x - origin.x, targetPos.y + 1.0 - origin.y, targetPos.z - origin.z).normalize();
    const spread = 0.035 + dist * 0.0009;
    dir.x += rand(-spread, spread);
    dir.y += rand(-spread, spread);
    dir.z += rand(-spread, spread);
    dir.normalize();

    const muzzle = origin.clone().addScaledVector(dir, 0.5);
    game.effects.muzzle(muzzle, dir);
    game.audio.play('shot', 0.55, dist, agent.weaponKey);

    const hitChance = agent.accuracy * clamp(1 - dist / 85, 0.15, 1);
    if (Math.random() < hitChance) {
      const dmg = rand(6, 15);
      game.player.takeDamage(dmg, 'bullet');
      game.effects.blood(new THREE.Vector3(targetPos.x, targetPos.y + 1.1, targetPos.z));
      game.effects.tracer(muzzle, new THREE.Vector3(targetPos.x, targetPos.y + 1.1, targetPos.z));
    } else {
      const miss = new THREE.Vector3(
        targetPos.x + rand(-2.4, 2.4), targetPos.y + rand(0, 2), targetPos.z + rand(-2.4, 2.4)
      );
      game.effects.tracer(muzzle, miss);
      if (Math.random() < 0.4) game.effects.sparks(miss, new THREE.Vector3(0, 1, 0), 0xd8d0c0, 3);
    }
    game.cam.shake(0.06, 0.05);
  }
}
