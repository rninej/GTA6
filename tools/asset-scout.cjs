// Poly Pizza scraper: find licence-clear car models, record title/author/tris/licence.
const fs = require('node:fs');
const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
  'ferrari', 'lamborghini', 'porsche', 'bmw', 'mercedes', 'audi',
  'nissan', 'toyota', 'mustang', 'corvette', 'tesla', 'supercar',
  'police car', 'pickup truck', 'suv', 'sedan', 'sports car', 'hypercar'
];
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36' };
const get = async (u) => {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(r.status + ' ' + u);
  return r.text();
};
const cards = (html) => {
  const out = [];
  const re = /<a href="\/m\/([A-Za-z0-9_-]+)"><div class="MuiCardMedia-root" title="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], title: m[2] });
  return out;
};
const meta = (html) => {
  const grab = (k) => {
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
  const model = { title: grab('Title'), tris: grab('Tris'), licence: grab('Licence'), resource: grab('ResourceID'), date: grab('UploadDate') };
  const ci = html.indexOf('"Creator":{');
  const chunk = ci > 0 ? html.slice(ci, ci + 400) : '';
  model.author = (chunk.match(/"Username":"([^"]*)"/) || [])[1] || null;
  const ti = html.indexOf('"Tags":[');
  model.tags = ti > 0 ? (html.slice(ti, ti + 300).match(/"[^"]+"/g) || []).slice(1, 8) : [];
  return model;
};
(async () => {
  const found = new Map();
  for (const q of queries) {
    try {
      const html = await get('https://poly.pizza/search/' + encodeURIComponent(q));
      const cs = cards(html).slice(0, 24);
      for (const c of cs) if (!found.has(c.id)) found.set(c.id, { ...c, query: q });
      console.log(q, '->', cs.length);
    } catch (e) { console.log(q, 'ERR', e.message); }
  }
  const rows = [];
  for (const c of found.values()) {
    try {
      const html = await get('https://poly.pizza/m/' + c.id);
      const m = meta(html);
      rows.push({ id: c.id, query: c.query, ...m, url: 'https://poly.pizza/m/' + c.id, glb: m.resource ? `https://static.poly.pizza/${m.resource}.glb` : null });
    } catch (e) { console.log('meta ERR', c.id, e.message); }
    await new Promise((r) => setTimeout(r, 120));
  }
  rows.sort((a, b) => (b.tris || 0) - (a.tris || 0));
  fs.writeFileSync('/tmp/pp-cars.json', JSON.stringify(rows, null, 1));
  for (const r of rows.filter((r) => /car|ferrari|lambo|porsche|bmw|mercedes|audi|nissan|toyota|mustang|corvette|tesla|truck|suv|sedan|police|van|drive|vehicle|auto|race/i.test(r.title || '')).slice(0, 70)) {
    console.log([r.tris, r.licence, r.author, '|', r.title, '|', r.id].join(' '));
  }
  console.log('TOTAL', rows.length);
})();
