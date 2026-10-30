// One-off data fetch for the water layer of the service area (decision D-P3): the OpenStreetMap coastline, water polygons and rivers around Calapan City, saved as
// plain Overpass JSON. It is NOT part of the build or of the apps; buildWaterExclusion.js reads what this writes.
//
//   node scripts/geo/fetchOsmWater.js <output folder>
//
// The data are OpenStreetMap's (ODbL, (c) OpenStreetMap contributors). Overpass is a shared free service: the script identifies itself, asks for one thing at a time
// and waits and retries when the server says it is busy.
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/geo/fetchOsmWater.js <output folder>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// the bounding box of the city boundary stored in the database, with a little room
const BBOX = '13.28,121.08,13.58,121.40';
const UA = 'SAKAY-capstone/1.0 (Calapan City tricycle booking; one-off water layer)';
const URL = 'https://overpass-api.de/api/interpreter';

const QUERIES = {
  coastline: `[out:json][timeout:120];way["natural"="coastline"](${BBOX});out geom;`,
  waterPolygons: `[out:json][timeout:120];(way["natural"="water"](${BBOX});way["waterway"="riverbank"](${BBOX});relation["natural"="water"](${BBOX});relation["waterway"="riverbank"](${BBOX}););out geom;`,
  riverLines: `[out:json][timeout:120];way["waterway"~"^(river|canal)$"](${BBOX});out geom;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchQuery(name, query) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    const text = await res.text();
    if (res.ok && text.trim().startsWith('{')) {
      const json = JSON.parse(text);
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(json));
      console.log(`${name}: ${json.elements.length} elements`);
      return;
    }
    const wait = 10000 * attempt;
    console.log(`${name}: attempt ${attempt} got HTTP ${res.status}; waiting ${wait / 1000} s`);
    await sleep(wait);
  }
  throw new Error(`${name}: gave up`);
}

(async () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    await fetchQuery(name, query);
    await sleep(3000);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
