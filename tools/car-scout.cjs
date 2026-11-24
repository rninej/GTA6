// Download licence-clear car models + metadata from Poly Pizza.
const fs = require('node:fs');
const path = require('node:path');
const OUT = process.argv[2] || '/tmp/pp';
const queries = process.argv.slice(3).length ? process.argv.slice(3) : [
  'bmw', 'porsche', 'lamborghini', 'mercedes', 'audi', 'mazda', 'subaru',
  'nissan', 'toyota', 'ferrari', 'police car', 'pickup truck', 'sedan', 'suv'
];
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(u, { headers: UA });
    if (r.ok) return r.text();
    if (r.status === 429) { await sleep(2500 * (i + 1)); continue; }
    throw new Error(r.status + ' ' + u);
  }
  throw new Error('429 ' + u);
};
const grab = (html, k) => {
  const i = html.indexOf(`"${k}":`);
  if (i < 0) return null;
  const rest = html.slice(i + k.length + 3);
  if (rest[0] === '"') {
    let s = '', esc = false;
    for (let j = 1; j < rest.length; j++) {
      const c = rest[j];
      if (esc) { s += c; esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') break;
      s += c;
    }
    return s;
  }
  const n = rest.match(/^-?\d+(?:\.\d+)?/);
  return n ? Number(n[0]) : null;
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const seen = new Set(), rows = [];
  for (const q of queries) {
    let html;
    try { html = await get('https://poly.pizza/search/' + encodeURIComponent(q)); }
    catch (e) { console.log('search ERR', q, e.message); continue; }
    const re = /<a href="\/m\/([A-Za-z0-9_-]+)"><div class="MuiCardMedia-root" title="([^"]*)"/g;
    const cards = [];
    let m;
    while ((m = re.exec(html))) cards.push({ id: m[1], title: m[2] });
    console.log(q, 'cards', cards.length);
    for (const c of cards.slice(0, 12)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      let page;
      try { page = await get('https://poly.pizza/m/' + c.id); } catch (e) { console.log(' meta ERR', c.id, e.message); continue; }
      await sleep(400);
      const ci = page.indexOf('"Creator":{');
      const author = ((ci > 0 ? page.slice(ci, ci + 400) : '').match(/"Username":"([^"]*)"/) || [])[1] || null;
      const row = {
        id: c.id, title: grab(page, 'Title') || c.title, tris: grab(page, 'Tris'),
        licence: grab(page, 'Licence'), author,
        resource: grab(page, 'ResourceID'), category: grab(page, 'Category'),
        date: grab(page, 'UploadDate'),
        url: 'https://poly.pizza/m/' + c.id
      };
      if (!row.resource || !row.licence) continue;
      if (!/CC0|CC-BY/.test(row.licence)) continue;
      row.glb = `https://static.poly.pizza/${row.resource}.glb`;
      rows.push(row);
    }
  }
  rows.sort((a, b) => (b.tris || 0) - (a.tris || 0));
  fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(rows, null, 1));
  for (const r of rows) console.log([r.tris, r.licence, r.author, '|', r.title, '|', r.id].join(' '));
  console.log('TOTAL', rows.length);
})();
