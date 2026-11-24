// Palma City — dynamic weather: clear / overcast / rain / storm.
// The rain field is a single shader-animated Points draw call, so weather costs
// one draw call and no per-frame CPU particle work. Wetness drives the road
// material's roughness, the sky dims through Sky.weatherDim, and storms fire
// lightning flashes with thunder.
import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';

const DURATION = { clear: [70, 130], overcast: [45, 80], rain: [60, 110], storm: [35, 60] };
const NEXT = {
  clear: ['overcast', 'overcast', 'clear'],
  overcast: ['rain', 'clear'],
  rain: ['storm', 'overcast'],
  storm: ['rain']
};
const TARGET = { clear: 0, overcast: 0.1, rain: 0.62, storm: 1 };
const DIM = { clear: 1, overcast: 0.74, rain: 0.52, storm: 0.36 };

export class Weather {
  constructor(game) {
    this.game = game;
    this.state = 'clear';
    this.intensity = 0;
    this.wet = 0;
    this.wind = new THREE.Vector2(0.35, 0.15);
    this.timer = 60;
    this.flash = 0;
    this.flashTimer = 0;
    this.nextBolt = 6;
    this.uniforms = null;
    this.buildRain();
    this.buildFlash();
    this.apply();
  }

  buildRain() {
    const N = 2400;
    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 70;
      pos[i * 3 + 1] = Math.random() * 55;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 70;
      spd[i] = 0.6 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0.72, 0.8, 0.92) }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        uniform float uTime, uIntensity;
        uniform vec2 uWind;
        uniform vec3 uCam;
        attribute float aSpeed;
        varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * (22.0 + aSpeed * 18.0), 55.0);
          p.x += uWind.x * (55.0 - p.y) * 0.05;
          p.z += uWind.y * (55.0 - p.y) * 0.05;
          vec4 mv = modelViewMatrix * vec4(p + vec3(uCam.x, 0.0, uCam.z), 1.0);
          gl_PointSize = clamp(210.0 / max(-mv.z, 1.0), 1.0, 3.4) * (0.55 + uIntensity);
          gl_Position = projectionMatrix * mv;
          vA = uIntensity;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.04, abs(c.x) * 2.0) * smoothstep(0.5, 0.08, abs(c.y) * 2.0);
          gl_FragColor = vec4(uColor, a * 0.6 * vA);
        }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.game.scene.add(this.points);
  }

  buildFlash() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:#dfe9ff;opacity:0;pointer-events:none;z-index:40;transition:opacity .08s';
    const root = document.getElementById('game-root') || document.body;
    root.appendChild(el);
    this.flashEl = el;
  }

  setState(state, silent = false) {
    if (!DIM[state]) return;
    this.state = state;
    const [a, b] = DURATION[state];
    this.timer = a + Math.random() * (b - a);
    if (!silent && this.game.started && this.game.hud) {
      const label = { clear: 'SKIES CLEARING', overcast: 'CLOUDING OVER', rain: 'RAIN MOVING IN', storm: 'STORM ROLLING IN' }[state];
      this.game.hud.toast(label, state === 'storm' ? 'bad' : '');
    }
  }

  apply() {
    const g = this.game;
    const dim = DIM[this.state];
    if (g.sky) {
      g.sky.weatherDim = dim;
      g.sky.fogBoost = (1 - dim) * 0.0016;
      g.sky.setHour(g.sky.hour);
    }
    if (g.city && g.city.setWetness) g.city.setWetness(this.wet);
    if (g.audio && g.audio.setRain) g.audio.setRain(this.intensity);
    if (this.uniforms) {
      this.uniforms.uIntensity.value = this.intensity;
      this.uniforms.uWind.value.copy(this.wind);
    }
    this.points.visible = this.intensity > 0.02;
  }

  update(dt, game) {
    this.timer -= dt;
    if (this.timer <= 0) {
      const opts = NEXT[this.state] || ['clear'];
      this.setState(opts[Math.floor(Math.random() * opts.length)]);
    }
    const target = TARGET[this.state];
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.5);
    // roads stay wet for a while after the rain eases
    const wetTarget = this.intensity > 0.15 ? this.intensity : 0;
    this.wet += (wetTarget - this.wet) * Math.min(1, dt * (wetTarget > this.wet ? 0.25 : 0.05));

    if (this.uniforms) {
      this.uniforms.uTime.value += dt;
      this.uniforms.uCam.value.copy(game.camera.position);
    }
    this.wind.set(
      0.25 + Math.sin(game.now * 0.07) * 0.25,
      0.1 + Math.cos(game.now * 0.05) * 0.18
    );

    // lightning: brief full-screen flash and a thunder crack
    if (this.state === 'storm') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 4 + Math.random() * 9;
        this.flash = 1;
        this.flashTimer = 0.18;
        game.audio.play('thunder', 0.9);
        game.cam.shake(0.25, 0.12);
      }
    }
    if (this.flash > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash = Math.max(0, this.flash - dt * 6);
      this.flashEl.style.opacity = (this.flash * 0.55).toFixed(3);
    } else if (this.flashEl.style.opacity !== '0') {
      this.flashEl.style.opacity = '0';
    }

    this.apply();
  }

  get isRaining() { return this.intensity > 0.25; }
}
