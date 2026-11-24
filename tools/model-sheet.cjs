const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();

const models = process.argv.filter((a) => a.startsWith('--model=')).map((a) => {
  const [file, label] = a.slice(8).split('|');
  return { file, label: label || path.basename(file) };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320, height: 900, show: true, backgroundColor: '#20242a',
    webPreferences: { contextIsolation: false, sandbox: false, backgroundThrottling: false }
  });
  const q = encodeURIComponent(JSON.stringify(models));
  await win.loadURL('http://127.0.0.1:8099/tools/model-sheet.html?models=' + q);
  for (let i = 0; i < 120; i++) {
    const done = await win.webContents.executeJavaScript('!!window.__SHEET_DONE__').catch(() => false);
    if (done) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage();
  fs.mkdirSync('screenshots', { recursive: true });
  fs.writeFileSync('screenshots/cars-candidates.png', img.toPNG());
  console.log('SHEET screenshots/cars-candidates.png');
  app.quit();
});
