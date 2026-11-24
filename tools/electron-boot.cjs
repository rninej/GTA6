// Smoke test: the Electron build still boots and plays after the model work.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 360, show: true, backgroundColor: '#000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const fatal = [];
  win.webContents.on('console-message', (e, level, message) => {
    const t = typeof message === 'string' ? message : e && e.message;
    const l = typeof level === 'number' ? level : (e && e.level) || 0;
    if (t && l >= 3) fatal.push(String(t).slice(0, 160));
  });
  const run = (b) => win.webContents.executeJavaScript(`(() => { const g = window.__PALMA__; ${b} })()`, true);
  try {
    await win.loadURL('file://' + path.resolve('dist/index.html'));
    let up = false;
    for (let i = 0; i < 200; i++) {
      up = await run('return !!(g && g.player && !g.loading)').catch(() => false);
      if (up) break;
      await sleep(500);
    }
    await sleep(1500);
    const info = await run(`
      const M = window.__PALMA_MODELS__;
      return { player: !!g.player, vehicles: g.vehicles.all.length,
        models: M ? { loaded: M.loaded, attempted: M.attempted, errors: M.errors.length,
          carFallbacks: M.carFallbacks, humanFallbacks: M.humanFallbacks } : null };`).catch(() => null);
    const summary = { booted: up, ...(info || {}), fatal: fatal.length };
    fs.writeFileSync(path.resolve('tools/.last-electron-boot.json'), JSON.stringify({ summary, fatal }, null, 1));
    console.log('ELECTRON-BOOT ' + JSON.stringify(summary));
    app.exit(up && fatal.length === 0 ? 0 : 1);
  } catch (e) {
    console.log('ELECTRON-BOOT-ERROR ' + String(e).slice(0, 200));
    app.exit(1);
  }
});
