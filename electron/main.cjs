// Palma City - Electron main process (Windows / macOS / Linux)
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Keep GPU acceleration on and request the discrete-class path where available.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win = null;

function workArea() {
  try {
    return screen.getPrimaryDisplay().workAreaSize;
  } catch (err) {
    return { width: 1600, height: 900 };
  }
}

function createWindow() {
  const { width, height } = workArea();
  win = new BrowserWindow({
    width: Math.min(1920, Math.round(width * 0.92)),
    height: Math.min(1080, Math.round(height * 0.92)),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#05060a',
    title: 'Palma City',
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (process.env.PALMA_SMOKE) attachSmoke(win);

  // Scripted play driver: tools/smoke-input.mjs runs the packaged asar with
  // PALMA_DRIVER pointing at tools/smoke-driver.cjs. Never loaded unless asked.
  if (process.env.PALMA_DRIVER) {
    try {
      require(path.resolve(process.env.PALMA_DRIVER))(win, app);
    } catch (err) {
      console.error('[driver] failed to load', (err && err.stack) || err);
      app.exit(2);
    }
  }

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // F11 fullscreen, F12 devtools (handy for the curious)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

// Headless boot check used by the build pipeline: PALMA_SMOKE=<png path> [PALMA_SMOKE_NEWGAME=1]
// It forwards renderer console output, drives the game to the running state, captures a
// frame and quits. Never runs unless the environment variable is set.
function attachSmoke(w) {
  const log = (...a) => console.log('[smoke]', ...a);
  w.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`console[${level}] ${message} (${sourceId}:${line})`);
  });
  w.webContents.on('did-fail-load', (_e, code, desc, url) => log('did-fail-load', code, desc, url));
  w.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
  w.webContents.on('did-finish-load', () => log('did-finish-load'));
  w.once('ready-to-show', () => log('ready-to-show'));

  setTimeout(async () => {
    try {
      const probe = await w.webContents.executeJavaScript(`(() => {
        const g = window.__PALMA__;
        return {
          title: document.title,
          webgl: !!(g && g.renderer && g.renderer.getContext()),
          loading: !!(g && g.loading),
          titleVisible: !!document.querySelector('#title:not(.hidden)'),
          calls: g && g.renderer ? g.renderer.info.render.calls : -1,
          tris: g && g.renderer ? g.renderer.info.render.triangles : -1
        };
      })()`);
      log('probe', JSON.stringify(probe));

      if (process.env.PALMA_SMOKE_NEWGAME) {
        for (let i = 0; i < 60; i++) {
          const ready = await w.webContents.executeJavaScript('!!(window.__PALMA__ && !window.__PALMA__.loading)');
          if (ready) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        await w.webContents.executeJavaScript(
          `document.querySelector('#title button[data-action="new"]').click(); true`
        );
        await new Promise((r) => setTimeout(r, 9000));
        const running = await w.webContents.executeJavaScript(`(() => {
          const g = window.__PALMA__;
          return {
            started: g.started, paused: g.paused, loading: g.loading,
            pos: g.player.pos.toArray().map((n) => +n.toFixed(1)),
            vehicles: g.vehicles.all.length, peds: g.peds.list.length,
            calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
            fps: g.fps || null, hour: +g.sky.hour.toFixed(2)
          };
        })()`);
        log('running', JSON.stringify(running));

        // frame cost: 24 explicit renders with a GPU sync, same method every build
        const perf = await w.webContents.executeJavaScript(`(() => {
          const g = window.__PALMA__;
          const gl = g.renderer.getContext();
          g.renderer.render(g.scene, g.camera); gl.finish();
          const t0 = performance.now();
          const N = 24;
          for (let i = 0; i < N; i++) g.renderer.render(g.scene, g.camera);
          gl.finish();
          const ms = (performance.now() - t0) / N;
          return {
            renderMs: +ms.toFixed(2),
            calls: g.renderer.info.render.calls,
            tris: g.renderer.info.render.triangles,
            geometries: g.renderer.info.memory.geometries,
            textures: g.renderer.info.memory.textures
          };
        })()`);
        log('perf', JSON.stringify(perf));
      }

      // The compositor capture is flaky under a headless software GL stack; a
      // failure here must not abort the canvas readback below.
      try {
        const img = await w.webContents.capturePage();
        const size = img.getSize();
        fs.writeFileSync(process.env.PALMA_SMOKE, img.toPNG());
        log('screenshot', process.env.PALMA_SMOKE, `${size.width}x${size.height}`);
      } catch (err) {
        log('screenshot-skipped', (err && err.message) || err);
      }

      // A compositor capture can come back blank under a headless display server,
      // so also read the drawing buffer straight out of the game canvas.
      const dataUrl = await w.webContents.executeJavaScript(`(() => {
        const g = window.__PALMA__;
        if (!g || !g.renderer) return null;
        g.renderer.render(g.scene, g.camera);
        return g.renderer.domElement.toDataURL('image/png');
      })()`);
      if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
        const out = process.env.PALMA_SMOKE.replace(/\.png$/, '-canvas.png');
        fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
        log('canvas', out);
      }
    } catch (err) {
      log('ERROR', (err && err.stack) || err);
    }
    app.quit();
  }, 7000);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('palma:fullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle('palma:quit', () => app.quit());
