// Palma City — inhabited interiors.
//
// Clerks, bartenders, mechanics and a couple of ambient occupants are built
// with the same buildHuman/HumanRig pipeline as the police and the player.
// They are parented to the interior group, which is only visible while you are
// inside, so the outdoor draw-call budget is unchanged. Actors are created
// lazily the first time an interior is entered and then cached on the interior
// object: repeated enter/exit cycles reuse the same cast instead of growing it.
import { buildHuman, HumanRig, disposeHuman } from '../entities/humanoid.js';
import { clamp, dampAngle } from '../core/utils.js';

export const INTERIOR_ACTOR_CAP = 3;
// Only keep a small working set of casts alive. The city has 388 interiors;
// caching a full cast for every one visited was the long-session memory creep.
export const INTERIOR_CACHE_LIMIT = 6;
const CLERK_REACT_RANGE = 3.2;
const CLERK_FACE_RANGE = 4.5;
const AMBIENT_FACE_RANGE = 3.5;
const EDGE_MARGIN = 0.3;

const CLERK_LOOKS = [
  { shirt: 0x2f6fb5, pants: 0x23262e, skin: 0xc08a63, hair: 0x241a14, female: false },
  { shirt: 0x9a3b4a, pants: 0x2b3040, skin: 0x8d5524, hair: 0x1a1110, female: true, hairLong: true },
  { shirt: 0xe0b84a, pants: 0x2a2a30, skin: 0xe8c39e, hair: 0x3a2a1a, female: false }
];
const CUSTOMER_LOOKS = [
  { shirt: 0x2f8f7a, pants: 0x2b3040, skin: 0xd4a373, hair: 0x1a1110, female: false },
  { shirt: 0x6a4a8a, pants: 0x1f2228, skin: 0xb87a52, hair: 0x241a14, female: true, hairLong: true },
  { shirt: 0xc06a2a, pants: 0x2a2a30, skin: 0x6b4226, hair: 0x111111, female: false },
  { shirt: 0x3a6a9a, pants: 0x23262e, skin: 0xe8c39e, hair: 0x4a3a2a, female: true }
];

export class InteriorLife {
  constructor(game) {
    this.game = game;
    this.built = 0;
    this.lines = 0;
    this.maxActors = INTERIOR_ACTOR_CAP;
    this.cached = [];
  }

  /* Stable look per interior, independent of the order interiors are entered. */
  look(it, list, salt) {
    const key = Math.abs(Math.round(it.x)) + it.name.length + salt;
    return list[key % list.length];
  }

  /* Build the cast for one interior the first time it is entered. */
  ensure(it) {
    if (it.actors) {
      this.touch(it);
      return it.actors;
    }
    const actors = [];
    const add = (role, x, z, heading, look, opts = {}) => {
      if (actors.length >= INTERIOR_ACTOR_CAP) return null;
      const n = actors.length;
      const model = buildHuman(Object.assign({ height: 0.96 + (n % 3) * 0.03 }, look), true);
      const rig = new HumanRig(model);
      const mesh = model.group;
      mesh.position.set(x, 0.02, z);
      mesh.rotation.y = heading;
      it.group.add(mesh);
      const a = {
        it, role, mesh, rig, state: 'idle', line: null, greeted: false, talkT: 0,
        seated: !!opts.seated, baseHeading: heading, home: { x, z }, lookAt: null,
        shift: null
      };
      actors.push(a);
      this.built++;
      return a;
    };

    if (it.kind === 'restaurant' && it.shop) {
      const closed = !!it.shop.closed;
      // Every shop gets a clerk, including a closed-shift clerk behind the
      // shutters. Closed shops still refuse the register in Living.rob().
      const clerk = add('clerk', 0, -6.0, 0, this.look(it, CLERK_LOOKS, 0));
      if (clerk) {
        clerk.shift = closed ? 'closed' : 'day';
        clerk.state = closed ? 'closed' : 'idle';
        it.shop.clerk = clerk;
        it.shop.shift = clerk.shift;
      }
      if (!closed) {
        // Counter runs along local z = -5.6; customers use the existing tables.
        add('customer', -4.6, 1.2, 2.4, this.look(it, CUSTOMER_LOOKS, 1), { seated: true });
        add('customer', 3.0, 3.0, -2.2, this.look(it, CUSTOMER_LOOKS, 2));
      }
    } else if (it.kind === 'club') {
      it.clubStaff = add('bartender', 0, -7.0, 0, this.look(it, CLERK_LOOKS, 1));
      if (it.clubStaff) it.clubStaff.shift = 'night';
      add('patron', -3.0, 2.5, 1.6, this.look(it, CUSTOMER_LOOKS, 2), { seated: true });
      add('patron', 4.0, 4.0, -1.2, this.look(it, CUSTOMER_LOOKS, 3));
    } else if (it.kind === 'garage') {
      it.mechanic = add('mechanic', -3.0, -4.0, 0.6, this.look(it, CUSTOMER_LOOKS, 2));
      if (it.mechanic) it.mechanic.shift = 'day';
      add('customer', 2.4, 1.0, -2.0, this.look(it, CUSTOMER_LOOKS, 0), { seated: true });
    }
    // Apartments (including the safehouse) intentionally stay private/empty.

    it.actors = actors;
    this.cached.push(it);
    this.trim();
    return actors;
  }

  touch(it) {
    const i = this.cached.indexOf(it);
    if (i >= 0) this.cached.splice(i, 1);
    this.cached.push(it);
    this.trim();
  }

  trim() {
    while (this.cached.length > INTERIOR_CACHE_LIMIT) {
      const old = this.cached.shift();
      this.dispose(old);
    }
  }

  /* Remove a cast that has fallen out of the cache, including GPU buffers. */
  dispose(it) {
    if (!it || !it.actors) return;
    for (const a of it.actors) {
      disposeHuman(a.mesh);
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
    }
    it.actors = null;
    if (it.shop) it.shop.clerk = null;
    it.clubStaff = null;
    it.mechanic = null;
  }

  say(a, speaker, line, dur = 3.2) {
    a.line = line;
    a.talkT = dur;
    a.rig.talking = true;
    this.lines++;
    if (this.game.hud) this.game.hud.subtitle(speaker, line, dur);
  }

  staffLine(a) {
    if (a.state === 'closed') return "We're closed.";
    if (a.state === 'robbed') return 'Just take what you want.';
    if (a.state === 'empty') return "Register's empty.";
    if (a.role === 'bartender') return 'What can I get you?';
    if (a.role === 'mechanic') return 'Need a tune-up?';
    return 'Welcome in.';
  }

  // Clerk reaction used by the robbery system.
  react(it, kind) {
    const clerk = it && it.shop && it.shop.clerk;
    if (!clerk) return null;
    const line = kind === 'empty'
      ? 'I already gave you everything!'
      : "Please— take it, just don't shoot!";
    clerk.state = kind;
    clerk.greeted = true;
    this.say(clerk, 'CLERK', line, 3.2);
    return line;
  }

  /* Called by main.exitInterior: greetings are per-visit, the cast is not. */
  onExit(it) {
    if (!it || !it.actors) return;
    for (const a of it.actors) {
      a.greeted = false;
      a.talkT = 0;
      a.lookAt = null;
      a.rig.talking = false;
      a.mesh.rotation.y = a.baseHeading;
    }
  }

  update(dt) {
    const it = this.game.interior;
    if (!it || !it.actors) return;
    const p = this.game.player;
    const halfW = Math.max(0.5, it.w / 2 - EDGE_MARGIN);
    const halfD = Math.max(0.5, it.d / 2 - EDGE_MARGIN);
    for (const a of it.actors) {
      const wx = it.x + a.mesh.position.x;
      const wz = it.z + a.mesh.position.z;
      const dx = p.pos.x - wx;
      const dz = p.pos.z - wz;
      const d = Math.hypot(dx, dz);
      const staff = a.role === 'clerk' || a.role === 'bartender' || a.role === 'mechanic';
      const faceRange = staff ? CLERK_FACE_RANGE : AMBIENT_FACE_RANGE;
      const near = d < faceRange;

      // Head tracking uses interior-local coordinates, matching the actor's
      // local group position while it is parented to the interior kit.
      a.lookAt = near ? { x: p.pos.x - it.x, z: p.pos.z - it.z } : null;
      a.rig.update(dt, { speed: 0, sitting: a.seated, lookAt: a.lookAt });

      if (a.talkT > 0) {
        a.talkT -= dt;
        if (a.talkT <= 0) a.rig.talking = false;
      }

      if (staff) {
        if (!a.greeted && d < CLERK_REACT_RANGE) {
          a.greeted = true;
          const speaker = a.role === 'bartender' ? 'BARTENDER' : a.role === 'mechanic' ? 'MECHANIC' : 'CLERK';
          this.say(a, speaker, this.staffLine(a), 2.4);
        }
      }

      // Face the player when close, otherwise settle back to the fixed spot.
      const target = near ? Math.atan2(dx, dz) : a.baseHeading;
      a.mesh.rotation.y = dampAngle(a.mesh.rotation.y, target, near ? 8 : 3, dt);

      // Hard containment: the actor can never be pushed through a wall or
      // outside the interior even if a reaction changes its local position.
      a.mesh.position.x = clamp(a.mesh.position.x, -halfW, halfW);
      a.mesh.position.z = clamp(a.mesh.position.z, -halfD, halfD);
      a.mesh.position.y = 0.02;
    }
  }
}
