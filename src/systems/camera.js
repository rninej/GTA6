// Palma City — third person / chase camera with collision and shake.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, rayAabb, TAU } from '../core/utils.js';

export class GameCamera {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.yaw = Math.PI;
    this.pitch = -0.06;
    this.dist = 4.9;
    this.mode = 'foot';
    this.vehicleMode = 0;
    this.shakeAmt = 0;
    this.shakeTime = 0;
    this.recoil = 0;
    this.smooth = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.fovBase = 78;
    this.orbit = 0;
    this.inited = false;
    this.aimBlend = 0;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'vehicle') this.vehicleMode = 0;
  }

  cycleVehicleCam() {
    this.vehicleMode = (this.vehicleMode + 1) % 3;
  }

  addRecoil(n) { this.recoil += n; }
  shake(amount, time) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeTime = Math.max(this.shakeTime, time);
  }
  snap() { this.inited = false; }

  update(dt, game) {
    const input = game.input;
    const p = game.player;
    const look = input.consumeLook();
    const sens = 0.0022 * (input.sensitivity || 1);

    if (!game.paused && !game.cutscene) {
      // forward is (sin yaw, 0, cos yaw), so increasing yaw swings the view
      // toward +X, which is screen-LEFT. Subtracting makes the mouse turn the
      // view the way the hand moves.
      this.yaw -= look.x * sens;
      this.pitch = clamp(this.pitch - look.y * sens, -1.05, 0.85);
    }
    this.yaw = ((this.yaw % TAU) + TAU) % TAU;
    this.pitch = clamp(this.pitch - this.recoil, -1.05, 0.85);
    this.recoil = damp(this.recoil, 0, 9, dt);

    if (this.mode === 'vehicle' && p.inVehicle && p.vehicle) {
      this.updateVehicle(dt, game, p.vehicle, look);
    } else {
      this.updateFoot(dt, game, p, look);
    }

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmt * Math.max(0, this.shakeTime);
      this.camera.position.x += (Math.random() - 0.5) * a * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * a * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * a * 0.6;
      if (this.shakeTime <= 0) this.shakeAmt = 0;
    }
  }

  updateFoot(dt, game, p) {
    const aiming = p.aiming && !p.inVehicle;
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 10, dt);
    const baseDist = 4.9 - this.aimBlend * 2.4;
    const shoulder = this.aimBlend * 0.62;
    const targetDist = baseDist;
    this.dist = damp(this.dist, targetDist, 8, dt);

    const cy = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cy, Math.sin(this.pitch), Math.cos(this.yaw) * cy);
    // screen-right = forward x up = (-cos yaw, 0, sin yaw); the old (cos, 0,
    // -sin) pointed screen-left, which is why strafing was mirrored
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));

    const eye = p.crouching ? 1.02 : (p.aiming ? 1.62 : 1.55);
    const head = new THREE.Vector3(p.pos.x, p.pos.y + eye, p.pos.z);
    const desired = head.clone()
      .addScaledVector(this.forward, -this.dist)
      .addScaledVector(this.right, shoulder)
      .add(new THREE.Vector3(0, 0.28, 0));

    // wall collision
    const dir = desired.clone().sub(head);
    const len = dir.length();
    dir.normalize();
    let maxLen = len;
    for (const c of game.city.queryColliders(head.x, head.z, len + 2)) {
      const t = rayAabb(head.x, head.y, head.z, dir.x, dir.y, dir.z, c, len);
      if (t > 0.2 && t < maxLen) maxLen = t - 0.25;
    }
    const finalPos = head.clone().addScaledVector(dir, Math.max(0.6, maxLen));

    const lookPoint = head.clone()
      .addScaledVector(this.forward, 26)
      .addScaledVector(this.right, shoulder);
    if (!this.inited) {
      this.smooth.copy(finalPos);
      this.lookAt.copy(lookPoint);
      this.inited = true;
    } else {
      this.smooth.lerp(finalPos, 1 - Math.exp(-14 * dt));
      this.lookAt.lerp(lookPoint, 1 - Math.exp(-18 * dt));
    }
    this.camera.position.copy(this.smooth);
    this.camera.lookAt(this.lookAt);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const targetFov = this.fovBase - this.aimBlend * 14 + (speed > 5 ? 3 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 6, dt);
    this.camera.updateProjectionMatrix();
  }

  updateVehicle(dt, game, v, look) {
    const speed = Math.abs(v.speed);
    if (this.vehicleMode === 2) {
      // hood cam
      const f = v.forward;
      const pos = v.pos.clone().addScaledVector(f, 0.35).add(new THREE.Vector3(0, 1.42, 0));
      this.camera.position.copy(pos);
      const lookP = pos.clone().addScaledVector(f, 20);
      lookP.y += this.pitch * 6;
      this.camera.lookAt(lookP);
      this.camera.fov = damp(this.camera.fov, this.fovBase + speed * 0.22, 5, dt);
      this.camera.updateProjectionMatrix();
      return;
    }
    const dist = this.vehicleMode === 1 ? 11 : 7.2;
    const height = this.vehicleMode === 1 ? 5.2 : 2.9;
    this.orbit = damp(this.orbit, 0, 2.2, dt);
    if (!game.paused) this.orbit -= look.x * 0.004;
    this.orbit = clamp(this.orbit, -1.2, 1.2);

    const camYaw = v.heading + this.orbit;
    const f = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const target = v.pos.clone().add(new THREE.Vector3(0, 1.15, 0));
    const desired = target.clone().addScaledVector(f, -dist);
    desired.y = v.pos.y + height;

    const dir = desired.clone().sub(target);
    const len = dir.length();
    dir.normalize();
    let maxLen = len;
    for (const c of game.city.queryColliders(target.x, target.z, len + 2)) {
      const t = rayAabb(target.x, target.y, target.z, dir.x, dir.y, dir.z, c, len);
      if (t > 0.2 && t < maxLen) maxLen = t - 0.3;
    }
    const finalPos = target.clone().addScaledVector(dir, Math.max(1.4, maxLen));

    const lookP = v.pos.clone()
      .addScaledVector(v.forward, 7)
      .add(new THREE.Vector3(0, 1.25, 0));
    if (!this.inited) {
      this.smooth.copy(finalPos);
      this.lookAt.copy(lookP);
      this.inited = true;
    } else {
      this.smooth.lerp(finalPos, 1 - Math.exp(-9 * dt));
      this.lookAt.lerp(lookP, 1 - Math.exp(-14 * dt));
    }
    this.camera.position.copy(this.smooth);
    this.camera.lookAt(this.lookAt);

    const targetFov = this.fovBase + 2 + clamp(speed * 0.5, 0, 16);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}
