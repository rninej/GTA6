#!/usr/bin/env node
// Palma City — run the scripted play driver against the packaged app.
//
//   node tools/smoke-input.mjs [path/to/app.asar]
//
// Spawns the Electron runtime with the packaged asar, hands the main process the
// driver module through PALMA_DRIVER, streams the transcript and exits with the
// child's exit code (0 = every step of the scripted play-through passed).
//
// On this Linux VM the Windows ARM64 binary cannot execute, so the *packaged asar*
// (the same JavaScript bundle that ships in release/Palma City-win32-arm64) is run
// under the local Electron with the software GL stack. The asar, not the native
// binary, is what the harness proves.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const asar = path.resolve(process.argv[2] || path.join(root, 'release', 'Palma City-win32-arm64', 'resources', 'app.asar'));
const driver = path.join(here, 'smoke-driver.cjs');
const report = path.join(root, 'release', 'harness-report.json');
const logFile = path.join(root, 'release', 'harness.log');

if (!fs.existsSync(asar)) {
  console.error(`no packaged asar at ${asar} — run "npm run package:arm64" first`);
  process.exit(2);
}
if (!fs.existsSync(driver)) {
  console.error(`missing driver at ${driver}`);
  process.exit(2);
}

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
if (!fs.existsSync(electron)) {
  console.error(`no local Electron runtime at ${electron} — run "npm install" first`);
  process.exit(2);
}

// The bundled Electron here needs the local sysroot's shared libraries.
const sysroot = '/tmp/sysroot2/usr/lib/x86_64-linux-gnu:/tmp/sysroot2/lib/x86_64-linux-gnu:/tmp/sysroot2/usr/lib';
const ld = process.env.LD_LIBRARY_PATH || (fs.existsSync('/tmp/sysroot2') ? sysroot : '');

const args = [
  asar,
  '--no-sandbox',
  '--ozone-platform=headless',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required'
];

console.log(`[run] asar     ${asar}`);
console.log(`[run] electron ${electron}`);
console.log(`[run] report   ${report}`);
console.log(`[run] log      ${logFile}`);

fs.mkdirSync(path.dirname(logFile), { recursive: true });
try { fs.unlinkSync(report); } catch {}

const child = spawn(electron, args, {
  cwd: root,
  env: {
    ...process.env,
    ...(ld ? { LD_LIBRARY_PATH: ld } : {}),
    PALMA_DRIVER: driver,
    PALMA_DRIVER_OUT: report
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const out = fs.createWriteStream(logFile, { flags: 'w' });
const forward = (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  out.write(text);
};
child.stdout.on('data', forward);
child.stderr.on('data', forward);

const killTimer = setTimeout(() => {
  console.error('[run] still running after 40 minutes — killing');
  child.kill('SIGKILL');
}, 40 * 60 * 1000);

child.on('exit', (code, signal) => {
  clearTimeout(killTimer);
  out.end();
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(report, 'utf8')); } catch {}
  if (summary) {
    const passed = summary.results.filter((r) => r.ok).length;
    console.log(`\n[run] ${passed}/${summary.results.length} steps passed, ${summary.failures} failed, ${summary.console.length} renderer console messages`);
    for (const r of summary.results) if (!r.ok) console.log(`[run] FAILED: ${r.name} — ${r.error}`);
  }
  console.log(`[run] electron exited code=${code} signal=${signal}`);
  process.exit(code === null ? 1 : code);
});
