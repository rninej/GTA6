// Keyboard / mouse input with edge detection and pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, left: false, right: false, wheel: 0 };
    this.pressed = new Set();
    this.released = new Set();
    this.locked = false;
    this.sensitivity = 1;
    this.enabled = true;
    this.onLockChange = null;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'F5', 'F11'].includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; });

    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.mouse.left = true; this.pressed.add(0); }
      if (e.button === 2) { this.mouse.right = true; this.pressed.add(2); }
      if (!this.locked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.released.add(0); }
      if (e.button === 2) { this.mouse.right = false; this.released.add(2); }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouse.dx += e.movementX * this.sensitivity;
        this.mouse.dy += e.movementY * this.sensitivity;
      }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressedKeys.has(code); }
  up(code) { return this.releasedKeys.has(code); }
  mouseDown(btn) { return btn === 0 ? this.mouse.left : this.mouse.right; }
  mouseHit(btn) { return this.pressed.has(btn); }
  mouseUp(btn) { return this.released.has(btn); }

  consumeLook() {
    const d = { x: this.mouse.dx, y: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouse.wheel = 0;
  }
}
