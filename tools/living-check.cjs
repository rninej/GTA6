// Palma City — probe for the living-world pass: phone, courier side job,
// store robberies + economy, safehouse evasion and sleep/save.
// Everything is driven through the real key handlers and frame update.
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 520, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = (b) => win.webContents.executeJavaScript(`(()=>{const g=window.__PALMA__;${b}})()`, true);
  try {
    const url = process.argv.find((a) => a.startsWith('--url=')) ? process.argv.find((a) => a.startsWith('--url=')).slice(6) : 'file://' + path.resolve('dist-browser/index.html');
    await win.loadURL(url);
    for (let i = 0; i < 240; i++) {
      if (await run(`return !!(g&&g.player&&!g.loading&&document.querySelector('#title button[data-action="new"]'));`).catch(() => false)) break;
      await sleep(500);
    }
    await run(`const b=document.querySelector('#title button[data-action="new"]'); if(b)b.click();
      g.cutscene=false; g.started=true; g.loading=false; g.paused=false; g.sky.setHour(12.5); return true;`).catch(() => null);
    await sleep(2500);

    const out = await win.webContents.executeJavaScript(`(async()=>{
      const g = window.__PALMA__;
      const V3 = g.scene.position.constructor;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(0.016); g.input.endFrame(); } };
      const keyDown = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      const press = (code, n = 2) => { keyDown(code); frame(n); keyUp(code); };
      const prompt = () => document.querySelector('#interact span').textContent;

      g.cutscene = false; g.paused = false;
      g.police.clearWanted(); g.wanted = 0;
      g.player.money = 1000; g.player.health = 100; g.player.armor = 50;
      Object.assign(g.living, { jobsDone: 0, jobsFailed: 0, robberies: 0, robberyRefusals: 0, sleeps: 0, refusals: 0, hideTimer: 0 });

      // ---------------- phone + courier ----------------
      press('KeyP', 2);
      const phoneOpen = g.living.phoneOpen && !document.getElementById('phone').classList.contains('hidden');
      g.living.phoneIdx = 1; g.living.renderPhone();
      press('Enter', 2);
      const jobStarted = !!g.living.job && g.living.job.timer > 80;
      const jobDist = g.living.job ? +Math.hypot(g.living.job.x - g.player.pos.x, g.living.job.z - g.player.pos.z).toFixed(1) : 0;
      const jobMarker = g.missions.markerPos ? { x: +g.missions.markerPos.x.toFixed(1), z: +g.missions.markerPos.z.toFixed(1) } : null;
      const moneyBeforeJob = g.player.money;

      // failure case: let the delivery expire
      g.living.job.timer = 0.2; frame(20);
      const jobFailed = !g.living.job && g.living.jobsFailed === 1 && g.player.money === moneyBeforeJob;

      // success case: start again and walk onto the drop
      g.living.startJob();
      const job2 = g.living.job ? { x: g.living.job.x, z: g.living.job.z } : null;
      g.player.teleport(new V3(job2.x, 0.24, job2.z));
      frame(3);
      const jobPaid = !g.living.job && g.living.jobsDone === 1 && g.player.money === moneyBeforeJob + 350;

      // phone taxi: refused with no destination, then DEX marks one and it runs
      g.missions.hideMarker();
      g.living.togglePhone(true); g.living.phoneIdx = 2; g.living.renderPhone();
      const moneyNoDest = g.player.money;
      press('Enter', 2); await wait(300);
      const taxiRefused = { spent: moneyNoDest - g.player.money, marker: g.missions.markerPos };
      g.living.togglePhone(true); g.living.phoneIdx = 0; g.living.renderPhone();
      press('Enter', 2);
      const dexMarker = g.missions.markerPos ? { x: +g.missions.markerPos.x.toFixed(1), z: +g.missions.markerPos.z.toFixed(1) } : null;
      g.living.togglePhone(true); g.living.phoneIdx = 2; g.living.renderPhone();
      const moneyPreTaxi = g.player.money;
      const posPreTaxi = { x: g.player.pos.x, z: g.player.pos.z };
      press('Enter', 2); await wait(1200); frame(3);
      const taxi = {
        spent: moneyPreTaxi - g.player.money,
        moved: +Math.hypot(g.player.pos.x - posPreTaxi.x, g.player.pos.z - posPreTaxi.z).toFixed(1),
        phoneClosed: !g.living.phoneOpen, dexMarker, refused: taxiRefused
      };

      // ---------------- robberies + economy ----------------
      const shops = g.city.interiors.filter((i) => i.shop);
      const openShop = shops.find((s) => !s.shop.closed);
      const closedShop = shops.find((s) => s.shop.closed);
      const enter = async (it) => {
        g.player.teleport(new V3(it.entry.x, 0.24, it.entry.z));
        g.cam.snap(); frame(2); press('KeyF', 2);
        await wait(1200); frame(2);
      };
      await enter(openShop);
      const enteredOpen = g.interior === openShop;
      g.player.pos.set(openShop.x, -140 + 0.02, openShop.z - 4.2); frame(2);
      const openPrompt = prompt();
      const moneyPreRob = g.player.money;
      press('KeyX', 2);
      const rob1 = {
        gained: g.player.money - moneyPreRob, wanted: g.wanted,
        face: g.police.description.face, clothes: g.police.description.clothes,
        cooldown: +openShop.shop.cooldown.toFixed(1)
      };
      // failure case: the same register is empty
      press('KeyX', 2);
      const robRepeat = { money: g.player.money, refusals: g.living.robberyRefusals, prompt: prompt() };

      // economy purchases
      g.player.health = 40;
      const moneyPreSnack = g.player.money;
      press('KeyB', 2);
      const snack = { health: g.player.health, spent: moneyPreSnack - g.player.money };
      const ammoPre = g.player.weapons.pistol.reserve;
      press('KeyN', 2);
      const ammo = { gained: g.player.weapons.pistol.reserve - ammoPre };

      g.exitInterior(); await wait(1200); frame(2);

      // masked robbery: the clerk reports the clothes but not the face
      press('KeyG', 2);
      const open2 = shops.find((s) => !s.shop.closed && s !== openShop);
      await enter(open2);
      g.player.pos.set(open2.x, -140 + 0.02, open2.z - 4.2); frame(2);
      const moneyPreRob2 = g.player.money;
      press('KeyX', 2);
      const robMasked = { gained: g.player.money - moneyPreRob2, wanted: g.wanted, face: g.police.description.face, masked: g.player.masked };
      g.exitInterior(); await wait(1200); frame(2);
      press('KeyG', 2);

      // failure case: closed shop has no register
      await enter(closedShop);
      g.player.pos.set(closedShop.x, -140 + 0.02, closedShop.z - 4.2); frame(2);
      const closedPrompt = prompt();
      const moneyPreClosed = g.player.money;
      press('KeyX', 2);
      const robClosed = { gained: g.player.money - moneyPreClosed, refusals: g.living.robberyRefusals, prompt: closedPrompt };
      g.exitInterior(); await wait(1200); frame(2);

      // ---------------- safehouse ----------------
      g.police.clearWanted(); g.wanted = 0;
      g.player.money = 777; g.player.health = 55;
      const sh = g.living.safehouse;
      await enter(sh);
      const inSafe = g.interior === sh;

      // evasion: 2 stars clear after lying low inside
      g.wanted = 2; g.police.crimeTimer = 40; g.living.hideTimer = 0;
      frame(120);
      const evasionBefore = { wanted: g.wanted, hideTimer: +g.living.hideTimer.toFixed(2) };
      frame(300);
      const evasion = { wanted: g.wanted, hideTimer: +g.living.hideTimer.toFixed(2), before: evasionBefore };

      // failure case: 4 stars will not clear and sleep is refused
      g.wanted = 4; g.police.crimeTimer = 60; g.living.hideTimer = 0;
      const hourPre = g.sky.hour;
      g.player.pos.set(sh.x - 2.4, -140 + 0.02, sh.z - 2.6); frame(2);
      press('KeyB', 2);
      const refusal = {
        wanted: g.wanted, hourDelta: +(g.sky.hour - hourPre).toFixed(3),
        sleeps: g.living.sleeps, refusals: g.living.refusals
      };

      // success: 2 stars, sleep saves, heals and clears
      g.wanted = 2;
      press('KeyB', 2);
      await wait(60);
      const saved = JSON.parse(localStorage.getItem('palma_city_save_v1') || 'null');
      const sleepRes = {
        wanted: g.wanted, hour: +g.sky.hour.toFixed(1), health: g.player.health,
        armor: g.player.armor, sleeps: g.living.sleeps,
        saveMoney: saved && saved.money, saveX: saved && +saved.x.toFixed(1),
        entryX: +sh.entry.x.toFixed(1), saveMasked: saved && saved.masked
      };
      g.exitInterior(); await wait(1200); frame(2);

      // death respawn lands at the safehouse door
      g.player.teleport(new V3(sh.entry.x + 70, 0.24, sh.entry.z + 45));
      const moneyPreDeath = g.player.money;
      g.onPlayerDeath(false);
      await wait(4300); frame(3);
      const respawn = {
        dist: +Math.hypot(g.player.pos.x - sh.entry.x, g.player.pos.z - sh.entry.z).toFixed(1),
        health: g.player.health, wanted: g.wanted, moneyLost: moneyPreDeath - g.player.money
      };

      return { phoneOpen, jobStarted, jobDist, jobMarker, jobFailed, jobPaid, taxi,
        enteredOpen, openPrompt, rob1, robRepeat, snack, ammo, robMasked, robClosed,
        inSafe, evasion, refusal, sleepRes, respawn };
    })()`, true);

    console.log('LIVING ' + JSON.stringify(out));
  } catch (e) {
    console.log('LIVING_ERROR ' + (e && e.stack ? e.stack : e));
  }
  app.quit();
});
