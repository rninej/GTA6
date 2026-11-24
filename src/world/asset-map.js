// Asset URL resolution.
//
// The Electron build ships its textures as real files next to the bundle, so
// this default is an identity function: the URL is used exactly as written.
//
// The browser build swaps this module for a generated one (see
// vite.browser.config.js) in which every texture is baked in as a data: URL.
// That is what lets index.html be opened straight from disk: a file:// page
// cannot feed file:// images into WebGL without tainting the canvas, but a
// data: URL is same-origin and needs no request at all.

export const INLINE_ASSETS = null;

export function assetUrl(url) {
  return url;
}
