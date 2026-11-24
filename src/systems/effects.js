// Palma City — GPU particle pools, tracers, explosions, muzzle flashes.
import * as THREE from 'three';
import { rand } from '../core/utils.js';
import * as TEX from '../world/textures.js';

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: TEX.getParticle() } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying float vAlpha; varying vec3 vColor;
        void main(){
          vAlpha = aAlpha; vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (480.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex;
        varying float vAlpha; varying vec3 vColor;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, size, color, grav = 0, drag = 0.5) {
    if (this.count >= this.max) {
      // recycle oldest
      this.kill(0);
    }
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.baseSize[i] = size; this.size[i] = size;
    this.alpha[i] = 1;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
      this.col[i3 + k] = this.col[l3 + k];
    }
    this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last]; this.baseSize[i] = this.baseSize[last];
    this.alpha[i] = this.alpha[last]; this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
  }

  update(dt) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t;
      this.size[i] = this.baseSize[i] * (1 + (1 - t) * 1.4);
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.smokePool = new ParticlePool(scene, 1600, false);
    this.sparkPool = new ParticlePool(scene, 900, true);
    this.decals = [];
    this.decalIdx = 0;
    this.buildDecals();
    this.tracers = [];
    this.buildTracers();
    this.flashes = [];
    this.buildFlashes();
  }

  buildDecals() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.renderOrder = 1;
      this.scene.add(m);
      this.decals.push(m);
    }
  }

  buildTracers() {
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;
  }

  buildFlashes() {
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        map: TEX.getParticle(), color: 0xffd07a, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(1.2, 1.2, 1);
      s.visible = false;
      this.scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
    this.flashIdx = 0;
  }

  update(dt) {
    this.smokePool.update(dt);
    this.sparkPool.update(dt);
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.06) * 0.85;
        t.line.visible = t.life > 0;
      }
    }
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.sprite.material.opacity = Math.max(0, f.life / 0.05);
        f.sprite.visible = f.life > 0;
      }
    }
    for (const d of this.decals) {
      if (d.visible) {
        d.userData.life -= dt;
        if (d.userData.life < 0) d.visible = false;
      }
    }
  }

  smoke(pos, color = 0x888888, amount = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 2 * amount; i++) {
      this.smokePool.spawn(
        pos.x + rand(-0.2, 0.2), pos.y + rand(0, 0.3), pos.z + rand(-0.2, 0.2),
        rand(-0.6, 0.6), rand(0.4, 1.4), rand(-0.6, 0.6),
        rand(0.8, 2.0), rand(0.8, 1.8), c, -0.3, 1.2
      );
    }
  }

  sparks(pos, normal, color = 0xffc46a, n = 8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      this.sparkPool.spawn(
        pos.x, pos.y, pos.z,
        normal.x * rand(1, 5) + rand(-2.5, 2.5),
        normal.y * rand(1, 5) + rand(0.5, 4),
        normal.z * rand(1, 5) + rand(-2.5, 2.5),
        rand(0.15, 0.45), rand(0.06, 0.16), c, 9, 0.6
      );
    }
  }

  blood(pos) {
    const c = new THREE.Color(0x8a0a12);
    for (let i = 0; i < 10; i++) {
      this.smokePool.spawn(
        pos.x, pos.y, pos.z,
        rand(-2, 2), rand(0.2, 3), rand(-2, 2),
        rand(0.3, 0.7), rand(0.12, 0.3), c, 9, 1.5
      );
    }
  }

  explosion(pos, scale = 1) {
    const fire = new THREE.Color(0xffa03a);
    const smokeC = new THREE.Color(0x2a2724);
    for (let i = 0; i < 46 * scale; i++) {
      this.sparkPool.spawn(
        pos.x, pos.y, pos.z,
        rand(-9, 9) * scale, rand(-1, 11) * scale, rand(-9, 9) * scale,
        rand(0.25, 0.9), rand(0.3, 1.1) * scale, fire, 4, 0.8
      );
    }
    for (let i = 0; i < 40 * scale; i++) {
      this.smokePool.spawn(
        pos.x + rand(-1, 1), pos.y + rand(0, 1.4), pos.z + rand(-1, 1),
        rand(-3, 3), rand(1, 5), rand(-3, 3),
        rand(1.4, 3.4), rand(1.4, 3.2) * scale, smokeC, -0.5, 0.9
      );
    }
    const fl = this.flashes[this.flashIdx++ % this.flashes.length];
    fl.sprite.position.copy(pos);
    fl.sprite.scale.set(9 * scale, 9 * scale, 1);
    fl.sprite.visible = true;
    fl.sprite.material.opacity = 1;
    fl.life = 0.16;
    this.game.audio.play('explosion');
  }

  muzzle(pos, dir) {
    const fl = this.flashes[this.flashIdx++ % this.flashes.length];
    fl.sprite.position.copy(pos);
    fl.sprite.scale.set(0.55, 0.55, 1);
    fl.sprite.visible = true;
    fl.sprite.material.opacity = 1;
    fl.life = 0.045;
    for (let i = 0; i < 4; i++) {
      this.sparkPool.spawn(
        pos.x, pos.y, pos.z,
        dir.x * rand(3, 9) + rand(-1, 1),
        dir.y * rand(3, 9) + rand(-1, 1),
        dir.z * rand(3, 9) + rand(-1, 1),
        rand(0.05, 0.14), rand(0.08, 0.2), new THREE.Color(0xffd08a), 2, 1
      );
    }
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.life = 0.06;
  }

  decal(x, z, size, opacity = 0.45) {
    const d = this.decals[this.decalIdx++ % this.decals.length];
    d.position.set(x, 0.028, z);
    d.scale.set(size, 1, size);
    d.material.opacity = opacity;
    d.visible = true;
    d.userData.life = 12;
  }
}
