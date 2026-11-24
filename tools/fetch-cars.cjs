// Download licence-cleared car GLBs into public/models/cars and write NOTICE data.
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(__dirname, '..', 'public', 'models', 'cars');
const CAT = process.argv[2] || '/tmp/pp/catalogue.json';
const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const want = [
  'a_HKCtYAv2W', '8zk4o6nALW', 'SnIoWlh7S2', 'RTwim9bhNd', '7bF7UVAoYRG',
  'c7vlPQ8dlt', '1uZKezeldGG', 'kVcKsd2dEk', 'e01OsIsKEt-', '4qjS9tFhsJg',
  '8-0nFArehjd', '3DtJTlxgO_U', 'erAyhpZ-N2h', 'fNV37KgzlMC', 'Jpar3f32mt',
  'ZEFWmOPSgh', 'Ebryot9iKM', 'etWba3RYzmi'
];
const rows = want.map((id) => cat.find((r) => r.id === id)).filter(Boolean);
console.log('found', rows.length, 'of', want.length);
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const out = [];
  for (const r of rows) {
    const name = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.glb';
    const dest = path.join(OUT, name);
    if (!fs.existsSync(dest)) {
      const res = await fetch(r.glb);
      if (!res.ok) { console.log('FAIL', r.title, res.status); continue; }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    out.push({ ...r, file: 'cars/' + name, bytes: fs.statSync(dest).size });
    console.log('ok', name, fs.statSync(dest).size, r.licence, r.author);
  }
  fs.writeFileSync('/tmp/pp/chosen.json', JSON.stringify(out, null, 1));
})();
