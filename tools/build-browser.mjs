// Browser build: vite build with the IIFE config, then strip the module
// attributes from index.html so the page also runs from a plain file:// open.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--config', 'vite.browser.config.js'], {
  cwd: root,
  stdio: 'inherit'
});

const indexPath = path.join(root, 'dist-browser', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const before = html;
// defer matters: the module tag was implicitly deferred, a plain script is not
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>');
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
if (html === before) {
  console.warn('[browser-build] index.html had no module script tag to rewrite');
}
fs.writeFileSync(indexPath, html);
console.log('[browser-build] dist-browser ready');

// The launcher files (start.bat, server.ps1, README.txt) live in browser-kit so
// that a rebuild - which empties dist-browser - can never delete them.
import { cpSync, existsSync, readdirSync } from 'node:fs';
const kit = 'browser-kit';
if (existsSync(kit)) {
  for (const f of readdirSync(kit)) cpSync(`${kit}/${f}`, `dist-browser/${f}`);
  console.log('[browser-build] launcher files copied from browser-kit');
}
