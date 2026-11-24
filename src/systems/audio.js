// Palma City — fully synthesised audio: engine, guns, sirens, city ambience and radio.
import { clamp, rand } from '../core/utils.js';

const TRACKS = [
  { station: 'NEON NIGHTS FM', track: 'Palm Static — "Afterglow"' },
  { station: 'NEON NIGHTS FM', track: 'Vice Driver — "Chrome Sunset"' },
  { station: 'PALMA BEATS', track: 'Calle 8 — "Sol y Sombra"' },
  { station: 'PALMA BEATS', track: 'Mala Suerte — "No Sleep"' }
];

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.volume = 0.8;
    this.ready = false;
    this.radioStation = 0;
    this.radioTrackIdx = 0;
    this.radioStep = 0;
    this.radioNext = 0;
    this.radioOn = false;
    this.lastShot = 0;
    this.sirenOn = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 8;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    // separate sfx and radio buses feeding the compressor, so each can be
    // metered and mixed independently
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.radioBus = this.ctx.createGain();
    this.radioBus.gain.value = 1;
    this.sfxBus.connect(comp);
    this.radioBus.connect(comp);
    this.bus = this.sfxBus;

    this.noiseBuf = this.makeNoise(2);
    this.buildEngine();
    this.buildTire();
    this.buildSiren();
    this.buildAmbience();
    this.buildRain();
    this.buildRadio();
    this.buildMeters();
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // Analyser taps used by the smoke harness and the F3 debug overlay to prove
  // each bus is actually producing samples.
  buildMeters() {
    const mk = (node) => {
      const a = this.ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
      node.connect(a);
      return a;
    };
    this.meters = { master: mk(this.master), sfx: mk(this.sfxBus), radio: mk(this.radioBus) };
    this._meterBuf = new Float32Array(2048);
  }

  meter(name) {
    const a = this.meters && this.meters[name];
    if (!a) return 0;
    a.getFloatTimeDomainData(this._meterBuf);
    let sum = 0;
    const b = this._meterBuf;
    for (let i = 0; i < b.length; i++) sum += b[i] * b[i];
    return Math.sqrt(sum / b.length);
  }

  get engineHz() { return this.engOsc1 ? this.engOsc1.frequency.value : 0; }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  makeNoise(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource(dur, loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    return src;
  }

  buildRain() {
    const src = this.noiseSource(2, true);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 0.35;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start();
    this.rainGain = g;
  }

  setRain(level) {
    if (!this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.3, this.ctx.currentTime, 0.7);
  }

  /* ----------------------------- one-shots ----------------------------- */
  play(name, vol = 1, dist = 0, variant) {
    if (!this.ready || this.volume <= 0) return;
    const t = this.ctx.currentTime;
    const att = clamp(1 - dist / 140, 0.03, 1) * vol;
    switch (name) {
      case 'shot': {
        if (t - this.lastShot < 0.02) return;
        this.lastShot = t;
        const src = this.noiseSource();
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(variant === 'shotgun' ? 1400 : 3600, t);
        f.frequency.exponentialRampToValueAtTime(300, t + 0.16);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.5 * att, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        src.connect(f); f.connect(g); g.connect(this.bus);
        src.start(t); src.stop(t + 0.22);
        this.tone(variant === 'rifle' ? 130 : 190, 40, 0.12, 0.16 * att, 'square');
        break;
      }
      case 'thunder': {
        const src = this.noiseSource();
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(240, t);
        f.frequency.exponentialRampToValueAtTime(55, t + 1.6);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.85 * att, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
        src.connect(f); f.connect(g); g.connect(this.sfxBus);
        src.start(t); src.stop(t + 1.9);
        break;
      }
      case 'explosion': {
        const src = this.noiseSource();
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(80, t + 1.2);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.75, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        src.connect(f); f.connect(g); g.connect(this.bus);
        src.start(t); src.stop(t + 1.5);
        this.tone(90, 26, 1.0, 0.35, 'sine');
        break;
      }
      case 'crash': {
        const src = this.noiseSource();
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.35 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        src.connect(f); f.connect(g); g.connect(this.bus);
        src.start(t); src.stop(t + 0.32);
        break;
      }
      case 'step': this.tone(0, 0, 0.05, 0, 'sine'); this.noiseHit(0.055, 0.09 * vol, 900, 'lowpass'); break;
      case 'jump': this.noiseHit(0.16, 0.07, 700, 'bandpass'); break;
      case 'click': this.tone(1400, 900, 0.03, 0.05, 'square'); break;
      case 'reload':
        this.tone(320, 240, 0.05, 0.07, 'square');
        setTimeout(() => this.ready && this.tone(520, 380, 0.05, 0.06, 'square'), 220);
        break;
      case 'pickup': this.tone(620, 980, 0.12, 0.1, 'sine'); setTimeout(() => this.ready && this.tone(980, 1240, 0.1, 0.08, 'sine'), 90); break;
      case 'hurt': this.tone(160, 60, 0.2, 0.16, 'sawtooth'); break;
      case 'bodyFall': this.noiseHit(0.22, 0.2, 420, 'lowpass'); this.tone(120, 40, 0.25, 0.1, 'sine'); break;
      case 'carDoor': this.noiseHit(0.12, 0.14, 700, 'lowpass'); this.tone(220, 140, 0.1, 0.06, 'square'); break;
      case 'wanted': this.tone(880, 880, 0.1, 0.08, 'square'); setTimeout(() => this.ready && this.tone(660, 660, 0.16, 0.08, 'square'), 130); break;
      case 'alarm': this.tone(880, 660, 0.16, 0.12 * att, 'square'); setTimeout(() => this.ready && this.tone(660, 880, 0.16, 0.1 * att, 'square'), 150); break;
      case 'scream': this.tone(720, 380, 0.5, 0.05 * att, 'sawtooth'); break;
      case 'heli': this.noiseHit(0.3, 0.06, 260, 'lowpass'); break;
      case 'ui': this.tone(560, 760, 0.05, 0.05, 'sine'); break;
      case 'fail': this.tone(420, 180, 0.6, 0.12, 'sawtooth'); break;
      case 'win': this.tone(523, 523, 0.14, 0.09, 'sine'); setTimeout(() => this.ready && this.tone(659, 659, 0.14, 0.09, 'sine'), 130); setTimeout(() => this.ready && this.tone(784, 784, 0.3, 0.09, 'sine'), 260); break;
      default: break;
    }
  }

  tone(f0, f1, dur, gain, type = 'sine') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noiseHit(dur, gain, freq, type) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* ----------------------------- loops ----------------------------- */
  buildEngine() {
    const t = this.ctx.currentTime;
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3;
    this.engFilter = lp;
    this.engOsc1 = this.ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc1.frequency.value = 60;
    this.engOsc2 = this.ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engOsc2.frequency.value = 90;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.4;
    this.engOsc1.connect(lp);
    this.engOsc2.connect(g2); g2.connect(lp);
    lp.connect(this.engGain);
    this.engGain.connect(this.bus);
    this.engOsc1.start(t); this.engOsc2.start(t);
  }

  buildTire() {
    const src = this.noiseSource(0, true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 5;
    this.tireGain = this.ctx.createGain();
    this.tireGain.gain.value = 0;
    src.connect(bp); bp.connect(this.tireGain); this.tireGain.connect(this.bus);
    src.start();
  }

  buildSiren() {
    const t = this.ctx.currentTime;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    osc.connect(lp); lp.connect(this.sirenGain);
    this.sirenGain.connect(this.bus);
    osc.start(t);
    this.sirenOsc = osc;
    // warble
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 1.8;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    lfo.start(t);
  }

  buildAmbience() {
    const src = this.noiseSource(0, true);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    src.connect(lp); lp.connect(g); g.connect(this.bus);
    src.start();
    this.ambGain = g;
  }

  buildRadio() {
    this.radioGain = this.ctx.createGain();
    this.radioGain.gain.value = 0;
    this.radioGain.connect(this.radioBus);
    this.radioNext = this.ctx.currentTime + 0.1;
    this.radioStep = 0;
  }

  horn() {
    if (!this.ready) return;
    this.tone(330, 330, 0.45, 0.12, 'square');
    setTimeout(() => this.ready && this.tone(415, 415, 0.45, 0.09, 'square'), 10);
  }

  setEngine(rpm, load, active) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const target = active ? 0.045 + load * 0.05 : 0;
    this.engGain.gain.setTargetAtTime(target, t, 0.12);
    if (!active) return;
    const f = 48 + rpm * 165;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.08);
    this.engOsc2.frequency.setTargetAtTime(f * 1.51, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 1800, t, 0.1);
  }

  setTire(slip) {
    if (!this.ready) return;
    this.tireGain.gain.setTargetAtTime(clamp(slip, 0, 1) * 0.12, this.ctx.currentTime, 0.08);
  }

  setSiren(on) {
    if (!this.ready) return;
    this.sirenOn = on;
    this.sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.3);
  }

  setRadio(i) {
    this.radioStation = i;
    this.radioOn = i > 0;
    if (!this.ready) return;
    this.radioGain.gain.setTargetAtTime(i > 0 ? 0.22 : 0, this.ctx.currentTime, 0.2);
    if (i > 0) {
      const tr = TRACKS[(i - 1) * 2 % TRACKS.length];
      this.game.hud.showRadio(tr.station, tr.track);
    }
  }

  nextStation() {
    const next = (this.radioStation + 1) % 3;
    this.setRadio(next);
    if (next === 0) this.game.hud.toast('RADIO OFF');
  }

  update(dt, game) {
    if (!this.ready) return;
    // engine
    const p = game.player;
    if (p.inVehicle && p.vehicle) {
      const v = p.vehicle;
      const rpm = clamp(Math.abs(v.speed) / v.spec.top, 0, 1);
      this.setEngine(rpm, v.throttle > 0 ? 1 : 0.3, true);
      const lat = Math.abs(v.velocity.x * v.right.x + v.velocity.z * v.right.z);
      this.setTire(lat > 3 ? clamp((lat - 3) / 12, 0, 1) : 0);
    } else {
      this.setEngine(0, 0, false);
      this.setTire(0);
    }
    // siren when police near
    let siren = false;
    for (const v of game.vehicles.all) {
      if (v.driver === 'cop' && !v.dead && Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) < 90) { siren = true; break; }
    }
    this.setSiren(siren);
    if (this.radioOn) this.scheduleRadio();
  }

  scheduleRadio() {
    const ctx = this.ctx;
    const bpm = this.radioStation === 1 ? 104 : 88;
    const stepDur = 60 / bpm / 4;
    while (this.radioNext < ctx.currentTime + 0.2) {
      this.scheduleStep(this.radioStep, this.radioNext);
      this.radioNext += stepDur;
      this.radioStep = (this.radioStep + 1) % 64;
    }
  }

  scheduleStep(step, time) {
    const ctx = this.ctx;
    const synth = this.radioStation === 1;
    const bar = Math.floor(step / 16) % 4;
    const roots = synth ? [110, 87.31, 130.81, 98] : [98, 116.54, 87.31, 130.81];
    const root = roots[bar];
    const s = step % 16;

    const note = (freq, dur, gain, type, dest = this.radioGain, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(dest);
      o.start(time); o.stop(time + dur + 0.02);
    };

    // drums
    if (s % 4 === 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, time);
      o.frequency.exponentialRampToValueAtTime(45, time + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
      o.connect(g); g.connect(this.radioGain);
      o.start(time); o.stop(time + 0.26);
    }
    if (s === 4 || s === 12) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      src.connect(f); f.connect(g); g.connect(this.radioGain);
      src.start(time); src.stop(time + 0.18);
    }
    if (s % 2 === 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      src.connect(f); f.connect(g); g.connect(this.radioGain);
      src.start(time); src.stop(time + 0.06);
    }

    // bass
    if (s % 2 === 0) note(root / 2, 0.22, 0.16, synth ? 'sawtooth' : 'triangle');
    // arpeggio
    if (synth) {
      const chord = [1, 1.19, 1.5, 2, 1.5, 1.19];
      const idx = s % chord.length;
      note(root * chord[idx] * 2, 0.14, 0.055, 'square', this.radioGain, 4);
    } else {
      if (s === 3 || s === 7 || s === 11 || s === 14) note(root * 2, 0.3, 0.06, 'triangle');
    }
    // pad
    if (s === 0) {
      note(root, 1.8, 0.03, 'sawtooth');
      note(root * 1.5, 1.8, 0.025, 'sawtooth', this.radioGain, -6);
      note(root * 2, 1.8, 0.02, 'sawtooth', this.radioGain, 6);
    }
  }
}
