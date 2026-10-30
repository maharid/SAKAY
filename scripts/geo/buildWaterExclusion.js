// Builds the SEA layer of the service area (decision D-P3) from the OpenStreetMap coastline that fetchOsmWater.js saved, and writes the migration that loads it.
//
//   node scripts/geo/buildWaterExclusion.js <folder with coastline.json> <migration file to write>
//
// Why: the city boundary (OpenStreetMap relation 15077332) includes the sea off Calapan, so a pin in Calapan Bay was "inside the service area". The apps now also check that a
// pin is on a road, but a modified app could still send a point in the bay, and only the database can refuse that. This builds the sea as a polygon:
//   1. the coastline ways are joined into chains (land is on the LEFT of a coastline way, so the sea is on the right);
//   2. the long chain that crosses the area is moved MARGIN_M metres out to sea, so a seawall, a pier or a boat landing a few metres off the shore stays valid;
//   3. it is clipped to the box around the city, and closed along the box edges on the sea side (clockwise), giving the sea as one polygon;
//   4. the small closed coastline rings in the bay (port structures, islets) are land, so they are holes in it.
// Rivers are NOT part of it on purpose: a river polygon would also refuse the bridges over it. Rivers are kept off by the road rule in the apps (a pin more than 30 m from
// every road is refused). Checks at the end make the script fail rather than write a layer that removes land: every barangay point of the Calapan fixture must stay outside it.
//
// Data (c) OpenStreetMap contributors, ODbL 1.0.
const fs = require('fs');
const path = require('path');

const [DIR, OUT] = process.argv.slice(2);
if (!DIR || !OUT) { console.error('usage: node scripts/geo/buildWaterExclusion.js <osm folder> <migration file>'); process.exit(1); }

const MARGIN_M = 50;
// the box the sea polygon is closed along; the city boundary (lat 13.300 - 13.563, lng 121.098 - 121.383) lies well inside it
const BOX = { s: 13.28, n: 13.58, w: 121.08, e: 121.40 };
const M_PER_DEG_LAT = 110600;
const M_PER_DEG_LNG = 108200;            // at 13.4 degrees north

const osm = JSON.parse(fs.readFileSync(path.join(DIR, 'coastline.json'), 'utf8'));
const fetchedAt = osm.osm3s?.timestamp_osm_base || 'unknown';

// ---- 1. chains ------------------------------------------------------------------------------------------------------------------------------------------------------------
const ways = osm.elements.map((w) => ({ nodes: w.nodes, pts: w.geometry.map((g) => [g.lon, g.lat]) }));
const byStart = new Map();
const byEnd = new Map();
ways.forEach((w, i) => { byStart.set(w.nodes[0], i); byEnd.set(w.nodes[w.nodes.length - 1], i); });
const used = new Set();
const chains = [];
for (let i = 0; i < ways.length; i++) {
  if (used.has(i)) continue;
  let first = i;
  const seen = new Set([first]);
  while (byEnd.has(ways[first].nodes[0]) && !seen.has(byEnd.get(ways[first].nodes[0]))) { first = byEnd.get(ways[first].nodes[0]); seen.add(first); }
  const pts = [];
  let cur = first;
  const walked = new Set();
  while (cur !== undefined && !walked.has(cur)) {
    walked.add(cur); used.add(cur);
    pts.push(...(pts.length === 0 ? ways[cur].pts : ways[cur].pts.slice(1)));
    cur = byStart.get(ways[cur].nodes[ways[cur].nodes.length - 1]);
  }
  chains.push({ pts, closed: pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] });
}

const signedArea = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
const inBox = ([x, y]) => y >= BOX.s && y <= BOX.n && x >= BOX.w && x <= BOX.e;

const open = chains.filter((c) => !c.closed);
const rings = chains.filter((c) => c.closed);
// the chain that matters is the long open one that passes through the box
const main = open.filter((c) => c.pts.some(inBox)).sort((a, b) => b.pts.length - a.pts.length)[0];
if (!main) throw new Error('no open coastline chain crosses the box');
console.log(`coastline: ${chains.length} chains; main chain ${main.pts.length} points; ${rings.length} closed rings`);

// ---- 2. move the chain out to sea ---------------------------------------------------------------------------------------------------------------------------------------
const toM = ([x, y]) => [x * M_PER_DEG_LNG, y * M_PER_DEG_LAT];
const offset = main.pts.map((p, i, a) => {
  const prev = a[Math.max(0, i - 1)];
  const next = a[Math.min(a.length - 1, i + 1)];
  const [px, py] = toM(prev);
  const [nx, ny] = toM(next);
  let dx = nx - px;
  let dy = ny - py;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  // the sea is on the RIGHT of the walking direction: the right-hand normal of (dx, dy) is (dy, -dx)
  return [p[0] + (dy * MARGIN_M) / M_PER_DEG_LNG, p[1] + (-dx * MARGIN_M) / M_PER_DEG_LAT];
});

// ---- 3. clip to the box (Liang-Barsky per segment) and close along the sea side --------------------------------------------------------------------------------
function clipSegment(a, b) {
  let t0 = 0; let t1 = 1;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const tests = [[-dx, a[0] - BOX.w], [dx, BOX.e - a[0]], [-dy, a[1] - BOX.s], [dy, BOX.n - a[1]]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}
const pieces = [];
let piece = [];
for (let i = 0; i + 1 < offset.length; i++) {
  const seg = clipSegment(offset[i], offset[i + 1]);
  if (!seg) { if (piece.length) { pieces.push(piece); piece = []; } continue; }
  if (piece.length === 0) piece.push(seg[0]);
  piece.push(seg[1]);
  if (seg[1][0] !== offset[i + 1][0] || seg[1][1] !== offset[i + 1][1]) { pieces.push(piece); piece = []; }   // the chain left the box here
}
if (piece.length) pieces.push(piece);
const chosen = pieces.sort((a, b) => b.length - a.length)[0];
const entry = chosen[0];
const exit = chosen[chosen.length - 1];

// where a point on the box edge lies along the perimeter, clockwise from the south-west corner (west edge north, north edge east, east edge south, south edge west)
const H = BOX.n - BOX.s; const W = BOX.e - BOX.w;
const EPS = 1e-9;
function perimeterT([x, y]) {
  if (Math.abs(x - BOX.w) < EPS) return y - BOX.s;
  if (Math.abs(y - BOX.n) < EPS) return H + (x - BOX.w);
  if (Math.abs(x - BOX.e) < EPS) return H + W + (BOX.n - y);
  if (Math.abs(y - BOX.s) < EPS) return 2 * H + W + (BOX.e - x);
  throw new Error(`point ${x},${y} is not on the box edge`);
}
const corners = [[BOX.w, BOX.n, H], [BOX.e, BOX.n, H + W], [BOX.e, BOX.s, 2 * H + W], [BOX.w, BOX.s, 2 * H + 2 * W]];
const total = 2 * H + 2 * W;
const tExit = perimeterT(exit);
const tEntry = perimeterT(entry);
// clockwise from the exit to the entry: every corner whose perimeter position lies between them (wrapping past the south-west corner when needed)
const between = [];
const span = ((tEntry - tExit) % total + total) % total;
for (const [x, y, t] of corners) {
  const d = (((t - tExit) % total) + total) % total;
  if (d > 0 && d < span) between.push({ d, p: [x, y] });
}
between.sort((a, b) => a.d - b.d);
const sea = [...chosen, ...between.map((b) => b.p), entry];

// ---- 4. the small closed coastline rings in the box are land: holes -----------------------------------------------------------------------------------------------------
const holes = rings.filter((r) => r.pts.some(inBox) && signedArea(r.pts) > 0).map((r) => r.pts);   // counter-clockwise = land inside

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const polygon = { type: 'Polygon', coordinates: [sea, ...holes].map((ring) => ring.map(([x, y]) => [round5(x), round5(y)])) };

// ---- 5. checks: this layer must never remove land ----------------------------------------------------------------------------------------------------------------------
const ringContains = (ring, [x, y]) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const inSea = (lat, lng) => ringContains(polygon.coordinates[0], [lng, lat]) && !polygon.coordinates.slice(1).some((h) => ringContains(h, [lng, lat]));

const PLACES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db-tests', 'fixtures', 'calapan-places.json'), 'utf8')).places;
const wet = PLACES.filter((p) => inSea(p.lat, p.lng));
if (wet.length) throw new Error('these places of Calapan would be refused as "sea": ' + wet.map((p) => p.name).join(', '));
const MUST_BE_LAND = { 'City Hall': [13.4117, 121.1803], 'the road at the Calapan port': [13.42834, 121.196528] };
for (const [name, [lat, lng]] of Object.entries(MUST_BE_LAND)) if (inSea(lat, lng)) throw new Error(`${name} is inside the sea layer`);
const MUST_BE_SEA = { 'bay off the port': [13.45, 121.19], 'bay north-east of the port': [13.47, 121.17], 'open water east': [13.43, 121.205] };
for (const [name, [lat, lng]] of Object.entries(MUST_BE_SEA)) if (!inSea(lat, lng)) throw new Error(`${name} is not inside the sea layer`);
const points = polygon.coordinates.reduce((n, r) => n + r.length, 0);
console.log(`sea polygon: outer ring ${polygon.coordinates[0].length} points, ${holes.length} holes, ${points} points in all; ${PLACES.length} places of Calapan all stay on land`);

// ---- 6. the migration ------------------------------------------------------------------------------------------------------------------------------------------------------
const source = `OpenStreetMap natural=coastline ways around Calapan (Overpass, data of ${fetchedAt}), joined into the sea polygon off the city and moved ${MARGIN_M} m seaward so seawalls and piers stay valid; ${holes.length} closed coastline rings (port structures, islets) are holes. (c) OpenStreetMap contributors, ODbL 1.0. Built by scripts/geo/buildWaterExclusion.js.`;
const sql = `-- ============================================================================
-- THE SEA IS NOT IN THE SERVICE AREA (panel comment, decision D-P3)
-- ============================================================================
-- The panel: pins must not land on rivers or the sea. The city boundary (OpenStreetMap relation 15077332) includes Calapan Bay, so a pin in the bay was "inside the service area".
-- The apps now also refuse a pin that is not on a road (OpenStreetMap routing data, 30 m), but a modified app could still send a point in the bay: only the database can refuse
-- that. This adds the sea as a layer of the service area:
--
--   service_area_water       ONE row: the sea off the city as a GeoJSON Polygon (the coastline moved ${MARGIN_M} m out to sea, so a seawall or a pier a few metres off the shore
--                            is still valid; closed coastline rings in the bay, such as port structures, are holes). Readable by signed-in users (the apps repeat the
--                            test with the same polygon so a pin is refused at once and not at booking time); nobody can change it from an app.
--   service_area_contains()  now also answers FALSE for a point in that polygon, for every service-area row (the city, or a pilot circle)
--
-- Rivers are not in the layer on purpose: a river polygon would also refuse the bridges over it. They are kept off by the apps' road rule. Built from the data of
-- ${fetchedAt} by scripts/geo/buildWaterExclusion.js (which refuses to write a layer that would put any of the 62 barangays of Calapan in the sea). Forward-only. Safe to run twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_area_water (
    water_id   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (water_id = 1),
    geojson    JSONB NOT NULL CHECK (geojson ->> 'type' = 'Polygon'),
    source     TEXT NOT NULL,
    margin_m   INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.service_area_water ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_area_water_select ON public.service_area_water;
CREATE POLICY service_area_water_select ON public.service_area_water FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.service_area_water FROM PUBLIC, anon;
GRANT SELECT ON public.service_area_water TO authenticated;
GRANT ALL ON public.service_area_water TO service_role;

INSERT INTO public.service_area_water (water_id, geojson, source, margin_m)
VALUES (1,
        $geo$${JSON.stringify(polygon)}$geo$::jsonb,
        '${source.replace(/'/g, "''")}',
        ${MARGIN_M})
ON CONFLICT (water_id) DO UPDATE
   SET geojson = EXCLUDED.geojson, source = EXCLUDED.source, margin_m = EXCLUDED.margin_m, updated_at = CURRENT_TIMESTAMP;

-- The one question, now with the sea left out: is this point inside the service area in this row?
CREATE OR REPLACE FUNCTION public.service_area_contains(p_config public.service_area_config, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $f$
DECLARE
    v_water JSONB;
BEGIN
    IF p_config.config_id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
        RETURN FALSE;
    END IF;
    -- cheap test first: nothing beyond radius_km of the centre is inside (for a polygon row the radius is its circumscribed circle)
    IF public.calculate_haversine_distance_km(p_config.center_latitude, p_config.center_longitude, p_lat, p_lng) > p_config.radius_km THEN
        RETURN FALSE;
    END IF;
    IF p_config.boundary_geojson IS NOT NULL
       AND NOT public.geojson_contains_point(p_config.boundary_geojson, p_lat, p_lng) THEN
        RETURN FALSE;
    END IF;
    -- the sea is not part of the service area (panel comment D-P3)
    SELECT w.geojson INTO v_water FROM public.service_area_water w WHERE w.water_id = 1;
    IF v_water IS NOT NULL AND public.geojson_contains_point(v_water, p_lat, p_lng) THEN
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.service_area_contains(public.service_area_config, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_area_contains(public.service_area_config, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

DO $$
BEGIN
    IF (SELECT count(*) FROM public.service_area_water) <> 1 THEN
        RAISE EXCEPTION 'service_area_water must hold exactly one row';
    END IF;
    IF has_function_privilege('authenticated', 'public.service_area_contains(public.service_area_config, double precision, double precision)', 'EXECUTE') THEN
        RAISE EXCEPTION 'service_area_contains must stay internal';
    END IF;
END $$;
`;
if (/[^\x00-\x7F]/.test(sql)) throw new Error('non-ASCII in the migration');
fs.writeFileSync(OUT, sql, 'utf8');
console.log(`written ${OUT} (${Math.round(sql.length / 1024)} KB)`);
