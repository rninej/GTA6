// Palma City — sky dome, sun/moon, day-night cycle, environment reflections.
import * as THREE from 'three';
import { clamp, lerp, smooth, timeString } from '../core/utils.js';
import * as TEX from './textures.js';

export class Sky {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.hour = 16.2;
    this.dayLength = 42 * 60;      // real seconds for a full 24h day
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.moonDir = new THREE.Vector3();
    this.sunColor = new THREE.Color(1, 0.95, 0.85);
    this.horizonColor = new THREE.Color(0.6, 0.75, 0.9);
    this.topColor = new THREE.Color(0.2, 0.45, 0.8);
    this.night = 0;
    this.envTimer = 0;
    this.envTex = null;
    // weather modulation applied on top of the day/night cycle
    this.weatherDim = 1;
    this.fogBoost = 0;
    this.build();
    this.setHour(this.hour);
  }

  build() {
    const geo = new THREE.SphereGeometry(4000, 32, 20);
    this.uniforms = {
      uTop: { value: this.topColor },
      uHorizon: { value: this.horizonColor },
      uGround: { value: new THREE.Color(0.16, 0.14, 0.12) },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor },
      uNight: { value: 0 },
      uTime: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uGround, uSunColor, uSunDir, uMoonDir;
        uniform float uNight, uTime;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x),
                     mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a*vnoise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, -0.2);
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.48));
          if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h * 5.0, 0.0, 1.0));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * pow(sd, 1400.0) * 26.0;
          col += uSunColor * pow(sd, 26.0) * 0.42;
          // humid Florida haze: a warm band hugging the horizon, stronger the
          // lower the view direction, so long streets fade into golden air
          float haze = exp(-max(h, 0.0) * 9.0);
          col = mix(col, uHorizon * 1.08 + vec3(0.05, 0.025, 0.02), haze * 0.3);
          // city glow: a warm sodium band over the rooftops after dark, the way
          // a real beach city never has a black horizon
          col += vec3(0.34, 0.18, 0.11) * exp(-max(h, 0.0) * 12.0) * uNight * 0.6;
          col += uSunColor * pow(sd, 5.0) * 0.06;
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.82, 0.87, 1.0) * pow(md, 2600.0) * 9.0 * uNight;
          col += vec3(0.34, 0.42, 0.62) * pow(md, 60.0) * 0.22 * uNight;
          if (uNight > 0.02 && d.y > 0.03) {
            vec2 sp = d.xz / max(d.y, 0.05) * 42.0;
            float s = hash(floor(sp));
            float tw = 0.55 + 0.45 * sin(uTime * 1.7 + s * 41.0);
            col += vec3(1.0) * step(0.9975, s) * smoothstep(0.25, 0.75, uNight) * tw * smoothstep(0.05, 0.3, d.y) * 1.5;
          }
          // ---- clouds --------------------------------------------------
          // Florida afternoon: a thin high cirrus sheet under tall cumulus
          // stacks with bright sunlit rims and flat grey bases. The layers are
          // projected from the view ray, so they slide correctly as the camera
          // turns instead of sitting still on the dome.
          if (d.y > 0.004) {
            float up = max(d.y, 0.05);
            // after dark the clouds must go dark too: they are lit only by the
            // moon and the city glow, never brighter than the horizon behind
            float dayL = smoothstep(-0.05, 0.2, uSunDir.y);
            // high cirrus, stretched along the wind
            vec2 hcuv = d.xz / up * 2.3 + vec2(uTime * 0.0055, uTime * 0.0016);
            float cir = fbm(vec2(hcuv.x * 0.38, hcuv.y * 2.2) + 17.0);
            float cirrus = smoothstep(0.55, 0.78, cir) * smoothstep(0.01, 0.12, d.y) * 0.5;
            vec3 cirCol = vec3(0.97, 0.98, 1.0) * (0.82 + 0.35 * max(sd, 0.0)) * mix(0.2, 1.0, dayL);
            col = mix(col, cirCol, cirrus);

            // cumulus: broad bodies with a broken edge
            vec2 cuv = d.xz / up * 1.55 + vec2(uTime * 0.0026, uTime * 0.0011);
            float base = fbm(cuv * 0.8);
            float billow = fbm(cuv * 2.15 + 4.3);
            float shape = base * 0.64 + billow * 0.36;
            float mask = smoothstep(0.44, 0.60, shape) * smoothstep(0.012, 0.09, d.y);
            // sun-side rim: the same field sampled a little toward the sun
            vec2 sOff = normalize(uSunDir.xz + vec2(0.0001, 0.0)) * 0.09;
            float litShape = fbm((cuv + sOff) * 0.8) * 0.64 + fbm((cuv + sOff) * 2.15 + 4.3) * 0.36;
            float rim = clamp((shape - litShape) * 4.5 + 0.5, 0.0, 1.0);
            float thick = smoothstep(0.50, 0.84, shape);
            vec3 cloudCol = mix(vec3(0.78, 0.82, 0.90), vec3(1.14, 1.10, 1.04), rim);
            cloudCol *= 1.0 - thick * 0.32;
            cloudCol = mix(cloudCol, uSunColor * 1.45, pow(sd, 5.0) * 0.7);
            cloudCol = mix(uHorizon * 0.55, cloudCol, dayL);
            cloudCol += vec3(0.16, 0.19, 0.28) * pow(md, 10.0) * uNight;
            // distant cloud melts into the horizon haze
            cloudCol = mix(uHorizon * 1.02, cloudCol, smoothstep(0.0, 0.17, d.y));
            col = mix(col, cloudCol, mask * 0.97);
          }
          // visible sun disc
          col += uSunColor * smoothstep(0.99987, 0.99995, sd) * 2.6;
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.scene.add(this.dome);

    // key light
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.camera.left = -55;
    this.sun.shadow.camera.right = 55;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x4a4030, 0.55);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.16);
    this.scene.add(this.ambient);

    // street lamp / window glow point lights around the player (cheap fake fill)
    this.fill = new THREE.PointLight(0xffb066, 0, 34, 2);
    this.scene.add(this.fill);
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    const t = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(t), Math.sin(t), 0.28).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    const el = this.sunDir.y;
    // Golden hour should still be bright: keep a floor of daylight while the
    // sun is on the horizon instead of falling off a cliff at sunset.
    const day = clamp(el * 2.6 + 0.22, 0, 1);
    const dusk = Math.exp(-Math.pow((el - 0.02) / 0.22, 2));
    this.night = 1 - clamp((el + 0.08) * 3.2, 0, 1);

    this.sunColor.setRGB(1, 0.9, 0.78).lerp(new THREE.Color(1, 0.48, 0.3), dusk * 0.9);
    this.sunColor.multiplyScalar(lerp(0.3, 1, day));

    const topDay = new THREE.Color(0.2, 0.48, 0.84);
    const topDusk = new THREE.Color(0.34, 0.23, 0.5);
    const topNight = new THREE.Color(0.028, 0.045, 0.105);
    this.topColor.copy(topNight).lerp(topDusk, clamp(dusk * 1.4, 0, 1)).lerp(topDay, day * 0.92);

    const horDay = new THREE.Color(0.68, 0.8, 0.92);
    const horDusk = new THREE.Color(1.0, 0.46, 0.44);
    const horNight = new THREE.Color(0.1, 0.075, 0.14);
    this.horizonColor.copy(horNight).lerp(horDusk, clamp(dusk, 0, 1)).lerp(horDay, day * 0.85);

    // weather: desaturate the sky towards a grey overcast and thicken the fog
    if (this.weatherDim < 0.999) {
      const grey = new THREE.Color(0.34, 0.37, 0.41);
      const k = (1 - this.weatherDim) * 0.72;
      this.topColor.lerp(grey, k);
      this.horizonColor.lerp(grey, k);
    }
    this.uniforms.uNight.value = this.night;
    this.uniforms.uSunColor.value.copy(this.sunColor);
    this.uniforms.uTop.value.copy(this.topColor);
    this.uniforms.uHorizon.value.copy(this.horizonColor);

    // lights
    this.sun.intensity = (3.8 * day + 0.05) * this.weatherDim;
    this.sun.color.copy(this.sunColor);
    this.hemi.intensity = (lerp(0.16, 0.72, day) + dusk * 0.26) * (0.7 + 0.3 * this.weatherDim);
    this.hemi.color.copy(this.topColor).lerp(new THREE.Color(0xffffff), 0.4)
      .lerp(new THREE.Color(1.0, 0.66, 0.58), dusk * 0.55);
    this.hemi.groundColor.setRGB(0.16 + day * 0.12 + dusk * 0.12, 0.14 + day * 0.1 + dusk * 0.05, 0.11 + day * 0.08);
    this.ambient.intensity = lerp(0.1, 0.2, day) + dusk * 0.16;
    this.ambient.color.setRGB(1, 1 - dusk * 0.12, 1 - dusk * 0.24);
    this.fill.intensity = this.night * 55;

    // fog
    const fogColor = this.horizonColor.clone().lerp(this.topColor, 0.35);
    // night air over a neon city is never neutral grey: tint the haze violet
    fogColor.lerp(new THREE.Color(0.17, 0.09, 0.17), this.night * 0.55);
    if (!this.scene.fog) this.scene.fog = new THREE.FogExp2(fogColor, 0.0016);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = lerp(0.0020, 0.00095, day) + this.fogBoost;

    if (this.game && this.game.city) {
      const cm = this.game.city;
      if (cm.streetLampMat) {
        cm.streetLampMat.color.setRGB(
          lerp(0.32, 1.0, this.night), lerp(0.3, 0.88, this.night), lerp(0.28, 0.66, this.night)
        );
        // Fade the ground pools in as the sun goes down; the lamp heads stay
        // solid at every hour.
        if (cm.setLampNight) cm.setLampNight(this.night);
      }
      // Office lights come on after sunset, not while the sun is still up:
      // at 17:30 the windows should read as reflections, not orange panels.
      const litK = smooth(clamp((this.night - 0.34) / 0.5, 0, 1));
      for (const m of cm.buildingMeshes) {
        m.material.emissiveIntensity = litK * 1.45;
      }
    }
  }

  update(dt, game) {
    this.hour = (this.hour + (dt / this.dayLength) * 24) % 24;
    this.setHour(this.hour);
    this.uniforms.uTime.value += dt;

    const cam = game.camera;
    this.dome.position.copy(cam.position);
    this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 190);
    this.sun.target.position.copy(cam.position);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(
      game.player.mesh.position.x, 2.4, game.player.mesh.position.z
    );

    // refresh reflection environment a few times per minute
    this.envTimer += dt;
    if (this.envTimer > 2.5) {
      this.envTimer = 0;
      this.refreshEnv();
    }
  }

  refreshEnv() {
    const canvas = TEX.getSkyEnvCanvas(this.hour, this.sunDir.y);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.envTex) this.envTex.dispose();
    this.envTex = tex;
    this.scene.environment = tex;
    this.scene.environmentIntensity = lerp(0.2, 1.0, clamp(this.sunDir.y * 2, 0, 1));
  }

  get clock() { return timeString(this.hour); }
}
