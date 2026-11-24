// Palma City — story missions, objectives, dialogue and markers.
import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import * as TEX from '../world/textures.js';

const MISSIONS = [
  {
    id: 'sunburn',
    kicker: 'CHAPTER ONE · SUNBURN',
    title: 'SUNBURN',
    start: { x: -198, z: -12 },
    intro: [
      ['MARISOL', "Six years in the army and I come home to a debt with my brother's name on it."],
      ['DEX', "Relax, Mari. We take one car, we clear the paper. Nobody gets hurt."],
      ['MARISOL', "Nobody ever gets hurt until somebody does. Where's the car?"],
      ['DEX', "Docks garage. Red Sabre. Keys are in it. Try not to scratch the paint."]
    ],
    objectives: [
      { type: 'goto', x: -392, z: 84, radius: 7, text: 'Drive to the docks garage' },
      { type: 'steal', carType: 'muscle', x: -392, z: 74, text: 'Steal the red Sabre V8' },
      { type: 'deliver', x: -198, z: -12, radius: 8, text: 'Bring the car back to the safehouse' }
    ],
    reward: 1500
  },
  {
    id: 'heatcheck',
    kicker: 'CHAPTER TWO · HEAT CHECK',
    title: 'HEAT CHECK',
    start: { x: 30, z: 38 },
    intro: [
      ['DEX', "Club Sol. Best music in Palma, worst people."],
      ['MARISOL', "The Salt Kings run this block now?"],
      ['DEX', "They think they do. Look, we just need the ledger from the office—"],
      ['MARISOL', "Dex. Why is everybody reaching for their waistband?"],
      ['DEX', "Because we're about to have a very bad night."]
    ],
    objectives: [
      { type: 'goto', x: 30, z: 34, radius: 6, text: 'Get inside Club Sol' },
      { type: 'kill', count: 5, x: 30, z: 34, text: 'Take out the Salt Kings' },
      { type: 'escape', text: 'Lose the police' }
    ],
    reward: 2500
  },
  {
    id: 'reporun',
    kicker: 'CHAPTER THREE · REPO RUN',
    title: 'REPO RUN',
    start: { x: -376, z: 76 },
    intro: [
      ['DEX', "New business model: we repossess things for people who can't say no."],
      ['MARISOL', "That's not a business model, that's a threat with paperwork."],
      ['DEX', "Two cars. One garage. Don't get attached."]
    ],
    objectives: [
      { type: 'steal', carType: 'sports', x: 176, z: 118, text: 'Steal the Vulcano GT in Coral Heights' },
      { type: 'deliver', x: -376, z: 76, radius: 9, text: 'Deliver the Vulcano to the docks' },
      { type: 'steal', carType: 'suv', x: 208, z: 128, text: 'Steal the Mesa Grande' },
      { type: 'deliver', x: -376, z: 76, radius: 9, text: 'Deliver the Mesa to the docks' }
    ],
    reward: 3200
  },
  {
    id: 'informant',
    kicker: 'CHAPTER FOUR · THE INFORMANT',
    title: 'THE INFORMANT',
    start: { x: -90, z: 500 },
    intro: [
      ['DEX', "Guy on the pier says he knows who torched your brother's shop."],
      ['MARISOL', "And you believe a man who sells fake watches to tourists?"],
      ['DEX', "He's running. He's running!"],
      ['MARISOL', "Of course he is."]
    ],
    objectives: [
      { type: 'goto', x: -90, z: 486, radius: 7, text: 'Meet the informant on the pier' },
      { type: 'killtarget', x: -60, z: 520, text: 'Chase down the informant' },
      { type: 'escape', text: 'Lose the police' }
    ],
    reward: 4000
  },
  {
    id: 'saltwater',
    kicker: 'CHAPTER FIVE · SALTWATER',
    title: 'SALTWATER',
    start: { x: -420, z: -60 },
    intro: [
      ['MARISOL', "The ledger says the Salt Kings move product through this warehouse."],
      ['DEX', "Then we go in loud, take the ledger, and leave before the cops get a vote."],
      ['MARISOL', "Loud. Fine. I've been quiet for six years."]
    ],
    objectives: [
      { type: 'goto', x: -430, z: -80, radius: 8, text: 'Reach the warehouse' },
      { type: 'kill', count: 8, x: -430, z: -80, text: 'Clear out the Salt Kings' },
      { type: 'goto', x: -392, z: 84, radius: 8, text: 'Escape to the docks garage' }
    ],
    reward: 5000
  },
  {
    id: 'highway',
    kicker: 'CHAPTER SIX · HIGHWAY HEAT',
    title: 'HIGHWAY HEAT',
    start: { x: 0, z: 300 },
    intro: [
      ['DEX', "They put a name to the face. Your face. Every cop in Palma is looking for you."],
      ['MARISOL', "Then we give them something to chase."],
      ['DEX', "Get to the garage. Try not to die. That's the whole plan."]
    ],
    objectives: [
      { type: 'wanted', level: 3, text: 'Get the police on you' },
      { type: 'survive', seconds: 75, text: 'Survive the pursuit' },
      { type: 'goto', x: -392, z: 84, radius: 8, text: 'Reach the docks garage' }
    ],
    reward: 6500
  },
  {
    id: 'badblood',
    kicker: 'CHAPTER SEVEN · BAD BLOOD',
    title: 'BAD BLOOD',
    start: { x: 300, z: 200 },
    intro: [
      ['DEX', "The boss is at the marina. Big car, bigger ego."],
      ['MARISOL', "He killed my brother over eight thousand dollars."],
      ['DEX', "Mari—"],
      ['MARISOL', "I'm not here to talk, Dex."]
    ],
    objectives: [
      { type: 'goto', x: 300, z: 190, radius: 9, text: 'Reach the marina' },
      { type: 'kill', count: 10, x: 300, z: 190, text: 'Take down the Salt Kings boss crew' },
      { type: 'escape', text: 'Lose the police' }
    ],
    reward: 8000
  },
  {
    id: 'exchange',
    kicker: 'CHAPTER EIGHT · THE EXCHANGE',
    title: 'THE EXCHANGE',
    start: { x: -90, z: 470 },
    intro: [
      ['DEX', "Last one. The ledger buys us out of Palma forever."],
      ['MARISOL', "Nothing buys you out of this city. You just get far enough away to miss it."],
      ['DEX', "Then let's get far enough away."],
      ['MARISOL', "See you at the pier."]
    ],
    objectives: [
      { type: 'goto', x: -90, z: 500, radius: 10, text: 'Meet Dex at the pier' },
      { type: 'kill', count: 12, x: -90, z: 500, text: 'Hold the pier' },
      { type: 'goto', x: -90, z: 540, radius: 9, text: 'Reach the extraction point' }
    ],
    reward: 20000
  }
];

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.missions = MISSIONS;
    this.index = 0;
    this.current = null;
    this.currentObj = null;
    this.objIdx = 0;
    this.state = { timer: 0, count: 0, target: null, car: null };
    this.dialogue = null;
    this.markerPos = null;
    this.cooldown = 2;
    this.failed = false;
    this.finished = false;
    // keep every objective on drivable ground
    for (const m of this.missions) {
      if (m.start) {
        const s = game.city.snapToStreet(m.start.x, m.start.z);
        m.start.x = s.x; m.start.z = s.z;
      }
      for (const o of m.objectives) {
        if (o.x !== undefined) {
          const s = game.city.snapToStreet(o.x, o.z);
          o.x = s.x; o.z = s.z;
        }
      }
    }
    this.buildMarker();
  }

  buildMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb43d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 40, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb43d, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    beam.position.y = 20;
    g.add(beam);
    g.visible = false;
    this.game.scene.add(g);
    this.marker = g;
    this.markerRing = ring;
    this.markerBeam = beam;
  }

  setMarker(x, z, color = 0xffb43d) {
    this.markerPos = { x, z };
    this.marker.position.set(x, 0.06, z);
    this.marker.visible = true;
    this.markerRing.material.color.setHex(color);
    this.markerBeam.material.color.setHex(color);
  }

  hideMarker() {
    this.markerPos = null;
    this.marker.visible = false;
  }

  startMission(i) {
    const m = this.missions[i];
    if (!m) return;
    this.index = i;
    this.current = m;
    this.objIdx = 0;
    this.dialogue = null;
    this.failed = false;
    this.game.hud.setLetterbox(true);
    this.game.hud.banner(m.kicker, m.title, 4.5);
    this.game.hud.setObjective('MISSION', m.title, '');
    this.game.audio.play('win');
    this.playDialogue(m.intro, () => {
      this.game.hud.setLetterbox(false);
      this.setObjective(0);
    });
    this.setMarker(m.start.x, m.start.z);
  }

  playDialogue(lines, done) {
    this.dialogue = { lines, idx: 0, timer: 0, done, charTimer: 0 };
    this.showLine();
  }

  showLine() {
    const d = this.dialogue;
    if (!d) return;
    if (this.game.player && this.game.player.rig) this.game.player.rig.talking = true;
    const [speaker, text] = d.lines[d.idx];
    d.timer = 2.6 + text.length * 0.042;
    d.charTimer = 0;
    d.fullText = text;
    this.game.hud.subtitle(speaker, text, d.timer);
  }

  updateDialogue(dt) {
    const d = this.dialogue;
    if (!d) return;
    d.timer -= dt;
    if (d.timer <= 0 || this.game.input.hit('Space') || this.game.input.mouseHit(0)) {
      d.idx++;
      if (d.idx >= d.lines.length) {
        this.dialogue = null;
        if (this.game.player && this.game.player.rig) this.game.player.rig.talking = false;
        this.game.hud.clearSubtitle();
        if (d.done) d.done();
      } else this.showLine();
    }
  }

  setObjective(i) {
    this.objIdx = i;
    const m = this.current;
    if (!m) return;
    const obj = m.objectives[i];
    if (!obj) { this.completeMission(); return; }
    this.currentObj = obj;
    this.state.timer = 0;
    this.state.count = 0;
    this.state.target = null;

    this.game.hud.setObjective(m.title, obj.text || '', `Objective ${i + 1} / ${m.objectives.length}`);
    this.game.hud.setObjective('MISSION', m.title, obj.text || '');

    if (obj.type === 'goto' || obj.type === 'deliver') {
      this.setMarker(obj.x, obj.z, obj.type === 'deliver' ? 0x7dff9e : 0xffb43d);
    } else if (obj.type === 'steal') {
      const v = this.game.vehicles.spawnAt(obj.carType, obj.x + 3.5, obj.z + 2, Math.PI * 0.5);
      v.spawnGrace = 1.5;
      v.keys = true;   // mission car comes with the keys
      this.state.car = v;
      this.setMarker(v.pos.x, v.pos.z, 0x22e0ff);
    } else if (obj.type === 'kill') {
      const enemies = this.game.police.spawnGang(obj.x, obj.z, obj.count);
      this.state.enemies = enemies;
      this.setMarker(obj.x, obj.z, 0xff5470);
    } else if (obj.type === 'killtarget') {
      const a = this.game.police.spawnGang(obj.x, obj.z, 1)[0];
      a.accuracy = 0.2;
      this.state.target = a;
      this.setMarker(obj.x, obj.z, 0xff5470);
    } else if (obj.type === 'escape') {
      this.hideMarker();
      this.game.police.addWanted(2, true);
    } else if (obj.type === 'wanted') {
      this.game.police.addWanted(obj.level || 3);
      this.hideMarker();
    } else if (obj.type === 'survive') {
      this.hideMarker();
    }
  }

  onKill(agent) {
    if (!this.currentObj) return;
    if (this.currentObj.type === 'kill') this.state.count++;
    if (this.currentObj.type === 'killtarget' && agent === this.state.target) {
      this.state.count = 1;
    }
  }

  completeObjective() {
    this.game.audio.play('pickup');
    this.setObjective(this.objIdx + 1);
  }

  completeMission() {
    const m = this.current;
    if (!m) return;
    this.game.hud.banner('MISSION PASSED', m.title, 4);
    this.game.hud.setObjective('', '', '');
    this.game.player.addMoney(m.reward);
    this.game.audio.play('win');
    this.current = null;
    this.currentObj = null;
    this.hideMarker();
    this.index++;
    this.cooldown = 6;
    this.saveProgress();
    if (this.index >= this.missions.length) {
      this.finished = true;
      this.game.onGameComplete();
    }
  }

  fail(reason) {
    if (!this.current) return;
    this.failed = true;
    this.game.hud.banner('MISSION FAILED', reason || 'TRY AGAIN', 3.5);
    this.game.audio.play('fail');
    const idx = this.index;
    this.current = null;
    this.currentObj = null;
    this.dialogue = null;
    this.game.hud.setLetterbox(false);
    this.cooldown = 5;
    this.pendingRestart = idx;
  }

  onPlayerDeath() {
    if (this.current) this.fail('YOU DIED');
  }

  update(dt) {
    const game = this.game;
    if (this.marker.visible) {
      this.markerRing.rotation.z += dt * 0.7;
      const s = 1 + Math.sin(performance.now() * 0.003) * 0.06;
      this.markerRing.scale.set(s, s, s);
    }
    if (this.dialogue) { this.updateDialogue(dt); return; }

    this.cooldown = Math.max(0, this.cooldown - dt);

    if (!this.current) {
      if (this.finished || this.cooldown > 0) return;
      // A courier job owns the marker and objective until it is delivered.
      const side = game.living && game.living.job;
      const next = this.missions[this.index];
      if (!next) return;
      if (!side) {
        this.setMarker(next.start.x, next.start.z);
        game.hud.setObjective('NEXT MISSION', next.title, 'Follow the orange marker');
      }
      const d = Math.hypot(game.player.pos.x - next.start.x, game.player.pos.z - next.start.z);
      if (d < 8 && !side) this.startMission(this.index);
      return;
    }

    const obj = this.currentObj;
    if (!obj) return;
    const p = game.player;
    const dist = (x, z) => Math.hypot(p.pos.x - x, p.pos.z - z);

    switch (obj.type) {
      case 'goto': {
        const target = this.currentObj;
        if (dist(target.x, target.z) < (target.radius || 7)) this.completeObjective();
        break;
      }
      case 'deliver': {
        if (p.inVehicle && dist(obj.x, obj.z) < (obj.radius || 8)) this.completeObjective();
        else if (!p.inVehicle && dist(obj.x, obj.z) < (obj.radius || 8) * 1.6) {
          game.hud.setObjective(this.current.title, 'Get back in the vehicle', '');
        }
        break;
      }
      case 'steal': {
        if (p.inVehicle && p.vehicle === this.state.car) this.completeObjective();
        else if (this.state.car && !this.state.car.removed) {
          this.setMarker(this.state.car.pos.x, this.state.car.pos.z, 0x22e0ff);
        }
        break;
      }
      case 'kill': {
        const alive = (this.state.enemies || []).filter((a) => !a.dead);
        game.hud.setObjective(this.current.title, `${obj.text} — ${(this.state.enemies || []).length - alive.length}/${(this.state.enemies || []).length}`, '');
        if (alive.length === 0 && (this.state.enemies || []).length > 0) this.completeObjective();
        break;
      }
      case 'killtarget': {
        if (this.state.target && this.state.target.dead) this.completeObjective();
        else if (this.state.target) this.setMarker(this.state.target.pos.x, this.state.target.pos.z, 0xff5470);
        break;
      }
      case 'escape': {
        if (game.wanted === 0) this.completeObjective();
        break;
      }
      case 'wanted': {
        if (game.wanted >= (obj.level || 3)) this.completeObjective();
        break;
      }
      case 'survive': {
        this.state.timer += dt;
        const left = Math.max(0, obj.seconds - this.state.timer);
        game.hud.setObjective(this.current.title, `${obj.text} — ${Math.ceil(left)}s`, '');
        if (left <= 0) this.completeObjective();
        break;
      }
      default: break;
    }
  }

  saveProgress() {
    const game = this.game;
    if (typeof game.saveGame === 'function') game.saveGame();
  }

  restart() {
    if (this.pendingRestart !== undefined) {
      const i = this.pendingRestart;
      this.pendingRestart = undefined;
      this.index = i;
      this.cooldown = 0;
    }
  }

  get missionTitle() { return this.current ? this.current.title : (this.missions[this.index]?.title || ''); }
}
