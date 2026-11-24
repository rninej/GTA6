// Palma City — pedestrian population.
import * as THREE from 'three';
import { buildHuman, HumanRig } from './humanoid.js';
import { rand, pick, clamp, dampAngle, resolveCircleAabb, TAU } from '../core/utils.js';

const SHIRTS = [0xd94f6a, 0x3d7ec4, 0xe8e2d4, 0x2f3b45, 0xd9a441, 0x6cbf8f, 0x9a5ac4, 0xe07a3c,
  0xf2f2f2, 0x1f2a38, 0xc4b299, 0x4a7a5a, 0xb03a4a, 0x5a6a8a];
const PANTS = [0x2b3040, 0x3a4a5a, 0x1b1d24, 0x5a4a3a, 0x8a8a90, 0x2f4a3a];
const SKINS = [0xe8c39e, 0xd4a373, 0xb87a52, 0x8d5524, 0x6b4226, 0xf0d0b0];
const HAIRS = [0x1a1110, 0x3a2418, 0x6a4a2a, 0xd8c08a, 0x111111, 0x8a3a2a];
const JACKETS = [0x2f3b45, 0x6b3a2a, 0x3d5a80, 0x1f2a38, 0x8a8a7a, 0x4a2a3a,
  0x2f4a3a, 0xc9a227, 0x5a4a6a, 0x7a2a2a];

// Downloaded character models, split by role. 'xbot' is a robot and 'soldier'
// is a tactical unit, so neither belongs in the civilian crowd; the same pool
// is also what keeps every street looking like people rather than mannequins.
export const CIVILIAN_MODELS = [
  'businessman', 'chefwoman', 'elderlyman', 'athlete', 'doctor',
  'constructionworker', 'hoodieteen', 'farmerwoman'
];

export class PedestrianManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.max = 46;
    this.spawnTimer = 0;
    this.nearCount = 0;
  }

  makePed(x, z, y = 0.22) {
    const female = Math.random() < 0.5;
    const model = buildHuman({
      shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS),
      jacket: Math.random() < 0.45 ? pick(JACKETS) : null,
      stubble: !female && Math.random() < 0.55,
      shoes: 0x1a1a1e, female, hairLong: female && Math.random() < 0.7,
      height: rand(0.92, 1.06),
      hat: Math.random() < 0.14 ? pick([0x222222, 0xdddddd, 0x8a2a2a]) : null
    }, false);
    const rig = new HumanRig(model, { humanPool: CIVILIAN_MODELS });
    const p = {
      model, rig, mesh: model.group, pos: model.group.position,
      heading: rand(0, TAU), speed: 0, state: 'walk', health: 60,
      dead: false, deadTimer: 0, block: null, target: new THREE.Vector3(),
      alarm: 0, idle: rand(0, 3), faction: 'civ', radius: 0.4, alert: 0
    };
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = p.heading;
    this.game.scene.add(p.mesh);
    this.pickPath(p);
    return p;
  }

  pickPath(p) {
    const paths = this.game.city.pedPaths;
    const path = paths[Math.floor(Math.random() * paths.length)];
    p.block = path;
    const corners = [
      { x: path.x0, z: path.z0 }, { x: path.x1, z: path.z0 },
      { x: path.x1, z: path.z1 }, { x: path.x0, z: path.z1 }
    ];
    // nearest corner then a random adjacent one
    let ci = 0, bd = 1e9;
    corners.forEach((c, i) => {
      const d = (c.x - p.pos.x) ** 2 + (c.z - p.pos.z) ** 2;
      if (d < bd) { bd = d; ci = i; }
    });
    p.corner = ci;
    p.target.set(corners[(ci + (Math.random() < 0.5 ? 1 : 3)) % 4].x, 0, corners[(ci + (Math.random() < 0.5 ? 1 : 3)) % 4].z);
  }

  spawnOne() {
    const game = this.game;
    const pp = game.player.pos;
    const near = game.city.pedPaths.filter((path) => {
      const cx = (path.x0 + path.x1) / 2, cz = (path.z0 + path.z1) / 2;
      const d = Math.hypot(cx - pp.x, cz - pp.z);
      return d > 22 && d < 120;
    });
    const path = near.length ? near[Math.floor(Math.random() * near.length)]
      : game.city.pedPaths[Math.floor(Math.random() * game.city.pedPaths.length)];
    const side = Math.floor(Math.random() * 4);
    let x, z;
    if (side === 0) { x = path.x0 + Math.random() * (path.x1 - path.x0); z = path.z0; }
    else if (side === 1) { x = path.x1; z = path.z0 + Math.random() * (path.z1 - path.z0); }
    else if (side === 2) { x = path.x0 + Math.random() * (path.x1 - path.x0); z = path.z1; }
    else { x = path.x0; z = path.z0 + Math.random() * (path.z1 - path.z0); }
    const p = this.makePed(x, z, path.y);
    this.list.push(p);
    return p;
  }

  update(dt, game) {
    const playerPos = game.player.pos;
    this.nearCount = 0;
    // Same distance LOD as the traffic: skinned pedestrians are expensive per
    // draw and invisible past 90 m.
    const camP = game.camera.position;
    for (const p of this.list) {
      p.mesh.visible = Math.hypot(p.pos.x - camP.x, p.pos.z - camP.z) < 45;
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z);

      if (p.dead) {
        p.deadTimer -= dt;
        p.rig.update(dt, { speed: 0 });
        if (p.deadTimer <= 0) {
          game.scene.remove(p.mesh);
          this.list.splice(i, 1);
        }
        continue;
      }

      if (d > 110) {
        p.mesh.visible = false;
        continue;
      }
      // Keep the 45 m visibility LOD set above. Re-showing every pedestrian
      // inside 110 m was the actual cause of the random 4.7M sweeps: two
      // 16-49k-triangle GLB bodies at 85-90 m were being drawn even though the
      // camera LOD had already culled them.
      if (d < 90) this.nearCount++;

      // state
      p.alarm = Math.max(0, p.alarm - dt);
      const fleeing = p.alarm > 0;
      p.state = fleeing ? 'flee' : 'walk';

      if (d < 45) {
        const rdt = d < 55 ? dt : dt * 0.34;
        // people glance at you as you walk past; the rig clamps how far the
        // head can turn and blends it back out at the edge of the radius
        p.rig.update(rdt, { speed: p.speed, sprint: fleeing, lookAt: d < 14 ? playerPos : null });
      }

      if (fleeing) {
        const away = new THREE.Vector3(p.pos.x - playerPos.x, 0, p.pos.z - playerPos.z);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize();
        p.speed = 5.2;
        p.heading = dampAngle(p.heading, Math.atan2(away.x, away.z), 8, dt);
        p.pos.x += away.x * p.speed * dt;
        p.pos.z += away.z * p.speed * dt;
      } else {
        // walk to corner
        const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          const b = p.block;
          const corners = [
            { x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 },
            { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }
          ];
          p.corner = (p.corner + (Math.random() < 0.5 ? 1 : 3)) % 4;
          p.target.set(corners[p.corner].x, 0, corners[p.corner].z);
          p.speed = rand(1.1, 1.7);
        } else {
          const want = Math.atan2(dx, dz);
          p.heading = dampAngle(p.heading, want, 5, dt);
          p.speed = rand(1.1, 1.7);
          p.pos.x += Math.sin(p.heading) * p.speed * dt;
          p.pos.z += Math.cos(p.heading) * p.speed * dt;
        }
        // avoid player
        if (d < 1.4) {
          const away = new THREE.Vector3(p.pos.x - playerPos.x, 0, p.pos.z - playerPos.z).normalize();
          p.pos.x += away.x * (1.4 - d) * 0.6;
          p.pos.z += away.z * (1.4 - d) * 0.6;
        }
      }

      p.pos.y = game.city.getGroundHeight(p.pos.x, p.pos.z);
      p.mesh.rotation.y = p.heading;
    }

    // population control
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.35;
      const alive = this.list.filter((p) => !p.dead).length;
      if (alive < this.max) this.spawnOne();
      // cull far peds
      for (const p of this.list) {
        if (!p.dead && Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z) > 240) {
          this.game.scene.remove(p.mesh);
          this.list.splice(this.list.indexOf(p), 1);
        }
      }
    }
  }

  alarm(pos, radius = 38) {
    for (const p of this.list) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < radius) {
        p.alarm = rand(3, 7);
        if (Math.random() < 0.25) this.game.audio.play('scream', 0.5, d);
      }
    }
  }

  nearest(pos, maxDist = 3) {
    let best = null, bd = maxDist;
    for (const p of this.list) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
