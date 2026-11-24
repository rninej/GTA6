import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

// Browser build: one classic (non-module) script that carries every runtime
// asset inside itself, so index.html can be double-clicked and opened straight
// from disk (file://) without a web server.
//
// A file:// page cannot hand file:// images to WebGL: the canvas would be
// tainted and every texture upload would fail. So each file under public/ is
// baked in as a data: URL, and src/world/photos.js resolves its texture paths
// through the generated assetUrl(). The Electron build keeps the real files and
// its own identity resolver (src/world/asset-map.js).

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary'
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function inlinePublicAssets(publicDir) {
  const VIRTUAL = 'virtual:palma-inline-assets';
  const RESOLVED = '\0' + VIRTUAL;

  return {
    name: 'palma-inline-assets',
    enforce: 'pre',

    resolveId(source) {
      if (source === VIRTUAL) return RESOLVED;
      // only the browser build swaps the resolver; the Electron build never
      // loads this config, so its files stay on disk
      if (source === './asset-map.js' || source.endsWith('/asset-map.js')) return RESOLVED;
      return null;
    },

    load(id) {
      if (id !== RESOLVED) return null;

      let files = [];
      try {
        files = walk(publicDir);
      } catch {
        files = [];
      }

      const map = {};
      let bytes = 0;
      for (const file of files) {
        const key = relative(publicDir, file).split('\\').join('/');
        const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
        const buf = readFileSync(file);
        bytes += buf.length;
        map[key] = `data:${mime};base64,${buf.toString('base64')}`;
      }

      console.log(
        `[inline-assets] ${files.length} file(s), ${(bytes / 1048576).toFixed(1)} MB baked in as data URLs`
      );

      return `export const INLINE_ASSETS = ${JSON.stringify(map)};
export function assetUrl(url) {
  if (!url) return url;
  const key = String(url)
    .replace(/^(\\.\\/|\\/)+/, '')
    .split('?')[0]
    .split('#')[0];
  return Object.prototype.hasOwnProperty.call(INLINE_ASSETS, key) ? INLINE_ASSETS[key] : url;
}`;
    }
  };
}

export default defineConfig({
  base: './',
  // everything under public/ is inlined, so nothing is copied out as files
  publicDir: false,
  plugins: [inlinePublicAssets('public')],
  build: {
    target: 'es2020',
    outDir: 'dist-browser',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    chunkSizeWarningLimit: 40000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
