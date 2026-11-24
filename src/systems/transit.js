// Palma City — public transport: one bus line looping named road stops.
// The bus is a normal Vehicle driven by the shared physics pipeline; this
// system only sets throttle/steer, manages dwell time, fares and the HUD.
import { clamp, angleDiff } from '../core/utils.js';

// One constant for the whole line: boarding costs exactly this much.
export const BUS_FARE = 3;
export const BUS_DWELL = 5;

// Every stop is an intersection on the existing road grid (roadsX/roadsZ),
// declared once here with its display name. Consecutive stops share an axis,
// so the bus drives straight along the road between them.
export const BUS_LINE = {
  id: 'line-1',
  name: 'LINE 1 · HARBOR LOOP',
  stops: [
    { name: 'CORAL HEIGHTS', x: -188, z: 0 },
    { name: 'CIVIC PLAZA', x: -188, z: 94 },
    { name: 'DOWNTOWN', x: -94, z: 94 },
    { name: 'CLUB SOL', x: 0, z: 94 },
    { name: 'MARINA', x: 0, z: 0 },
    { name: 'OCEAN DRIVE', x: -94, z: 0 }
  ]
};

export class Transit {
  constructor(game) {
    this.game = game;
    this.line = BUS_LINE;
    this.fare = BUS_FARE;
    this.stops = BUS_LINE.stops;
    this.stopIndex = 0;
    this.targetIndex = 1;
    this.dwell = BUS_DWELL;
    this.riding = false;
    this.hudTimer = 0;
    this.stuck = 0;
    this.legTimer = 0;
    this.bus = this.spawnBus();
  }

  spawnBus() {
    const s = this.stops[0];
    const n = this.stops[1];
    const heading = Math.atan2(n.x - s.x, n.z - s.z);
    const bus = this.game.vehicles.spawnAt('bus', s.x, s.z, heading, {
      driver: 'bus', isBus: true, keys: true, color: '#e8b21a'
    });
    bus.fuel = 1;
    bus.engineOn = true;
    bus.health = bus.maxHealth;
    if (bus.parts.interior) bus.parts.interior.visible = false;
    return bus;
  }

  // Called from Player.update while on foot: is a bus boarding right here?
  boardable(pos) {
    const bus = this.bus;
    if (!bus || bus.dead || this.riding || this.dwell <= 0) return null;
    if (Math.hypot(pos.x - bus.pos.x, pos.z - bus.pos.z) > 8) return null;
    return bus;
  }

  board(bus) {
    const game = this.game;
    const p = game.player;
    if (this.riding || p.inVehicle || !bus) return false;
    if (p.money < BUS_FARE) {
      game.hud.toast(`FARE $${BUS_FARE} — NOT ENOUGH CASH`, 'bad');
      game.audio.play('click');
      return false;
    }
    p.money -= BUS_FARE;
    this.riding = true;
    p.enterVehicle(bus);
    this.updateHud(true);
    game.hud.toast(`FARE $${BUS_FARE} · ${this.line.name}`, 'money');
    return true;
  }

  tryExit() {
    if (!this.riding) return false;
    if (this.dwell <= 0) {
      this.game.hud.toast('WAIT FOR THE NEXT STOP', 'bad');
      return false;
    }
    this.game.player.exitVehicle(true);
    return true;
  }

  // Player.exitVehicle calls this for the bus: place them on the corner at
  // the stop they just left and clear the route HUD.
  onExit() {
    this.riding = false;
    this.game.hud.hideBus();
    const s = this.stops[this.stopIndex];
    const p = this.game.player;
    const spots = [[3.2, 3.2], [-3.2, 3.2], [3.2, -3.2], [-3.2, -3.2]];
    let spot = spots[0];
    for (const [ox, oz] of spots) {
      const x = s.x + ox, z = s.z + oz;
      const blocked = this.game.city.queryColliders(x, z, 0.5).some((c) =>
        x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5);
      if (!blocked) { spot = [ox, oz]; break; }
    }
    p.pos.set(s.x + spot[0], 0.24, s.z + spot[1]);
    p.vel.set(0, 0, 0);
    p.mesh.position.copy(p.pos);
    this.game.cam.snap();
  }

  snapStop(s) {
    const bus = this.bus;
    bus.pos.x = s.x;
    bus.pos.z = s.z;
    bus.velocity.set(0, 0, 0);
    bus.speed = 0;
    this.stuck = 0;
    this.legTimer = 0;
    this.arrive();
  }

  arrive() {
    this.stopIndex = this.targetIndex;
    this.targetIndex = (this.stopIndex + 1) % this.stops.length;
    this.dwell = BUS_DWELL;
    this.legTimer = 0;
    const bus = this.bus;
    bus.velocity.set(0, 0, 0);
    bus.speed = 0;
    if (this.riding) {
      const s = this.stops[this.stopIndex];
      this.game.hud.toast(`STOP · ${s.name}`, 'good');
      this.updateHud(true);
    }
  }

  depart() {
    this.legTimer = 0;
    if (this.riding) {
      const s = this.stops[this.targetIndex];
      this.game.hud.toast(`NEXT STOP · ${s.name}`, '');
    }
  }

  update(dt) {
    const bus = this.bus;
    if (!bus || bus.dead || bus.removed) return;
    // The line runs on a full tank; fares are the only cost modelled.
    bus.fuel = 1;
    bus.engineOn = true;
    // Distance LOD: the bus still runs its route off-screen, but it is not
    // drawn from across the city. Riders always see their own bus.
    const p = this.game.player;
    bus.mesh.visible = this.riding ||
      Math.hypot(p.pos.x - bus.pos.x, p.pos.z - bus.pos.z) < 190;

    if (this.dwell > 0) {
      this.dwell -= dt;
      bus.throttle = 0;
      bus.brake = 1;
      bus.velocity.set(0, 0, 0);
      bus.speed = 0;
      if (this.dwell <= 0) this.depart();
    } else {
      const s = this.stops[this.targetIndex];
      const dx = s.x - bus.pos.x;
      const dz = s.z - bus.pos.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      this.legTimer += dt;
      // A leg is ~94 m; if traffic pins or pushes the bus off the line for a
      // whole leg, pull it into the named stop rather than looping forever.
      if (this.legTimer > 24) { this.snapStop(s); return; }
      bus.steer = clamp(angleDiff(bus.heading, desired) * 2.2, -1, 1);
      // Ease down to the stop: v² = 2·a·s with a comfortable 7 m/s². Close in,
      // cap the approach speed hard so a missed braking point cannot turn into
      // an endless loop around the stop.
      let want = Math.min(11, Math.sqrt(2 * 7 * Math.max(0, dist - 2)));
      if (dist < 16) want = Math.min(want, Math.max(3, dist * 0.5));
      if (dist < 6) {
        // Pull into the stop: a short snap replaces the last few metres so the
        // bus always stops on the named intersection, even if traffic nudged it.
        this.snapStop(s);
        return;
      } else if (bus.speed < want - 0.5) {
        bus.throttle = 1; bus.brake = 0;
      } else if (bus.speed > want + 0.8) {
        bus.throttle = 0; bus.brake = 1;
      } else {
        bus.throttle = 0; bus.brake = 0;
      }
      // If something pins the bus short of the stop, snap it in after a moment.
      this.stuck = (dist < 14 && Math.abs(bus.speed) < 1.5) ? (this.stuck || 0) + dt : 0;
      if (this.stuck > 1.5) { this.snapStop(s); return; }
    }

    if (this.riding) {
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) { this.hudTimer = 0.2; this.updateHud(); }
    }
  }

  updateHud() {
    if (!this.riding) return;
    const at = this.stops[this.stopIndex];
    const next = this.stops[this.targetIndex];
    const last = this.dwell > 0
      ? this.stopIndex === this.stops.length - 1
      : this.targetIndex === this.stops.length - 1;
    const shown = this.dwell > 0 && last ? at : next;
    const bus = this.bus;
    const dist = Math.hypot(next.x - bus.pos.x, next.z - bus.pos.z);
    const eta = Math.max(1, Math.round(dist / 12));
    const sub = this.dwell > 0
      ? (last ? 'LOOP SERVICE · EXIT HERE' : `AT · ${at.name} · DOORS OPEN`)
      : `FROM · ${at.name} · ARRIVING IN ${eta}s`;
    this.game.hud.showBus(this.line.name, shown.name, sub, last);
  }
}
