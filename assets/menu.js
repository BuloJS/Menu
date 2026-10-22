// Carte des tables : globe 3D (MapLibre), recherche OpenStreetMap (Photon), sauvegarde Supabase.
//
// Les lieux sont enregistrés dans la table user_data de Home, avec
// app = "menu" : aucune nouvelle table à créer, et la RLS existante les isole
// par utilisateur. Une copie locale sert de secours hors ligne.

import { loadData, saveData } from "./auth.js";

const APP = "menu";
const LOCAL_KEY = "menu:places:v1";
const EXTRA_KEY = "menu:countries:v1";
const DEPT_KEY = "menu:depts:v1";
const PHOTON = "https://photon.komoot.io/api/";

const CATS = { restaurant: "Restaurant", bar: "Bar", boite: "Boîte", ski: "⛷ Station de ski" };
// Valeur OSM `amenity` → catégorie de la carte
const AMENITY = {
  restaurant: "restaurant", cafe: "restaurant", fast_food: "restaurant", food_court: "restaurant", ice_cream: "restaurant",
  bar: "bar", pub: "bar", biergarten: "bar",
  nightclub: "boite", stripclub: "boite",
};

const $ = (s) => document.querySelector(s);
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let places = [];
let extra = [];   // pays ajoutés à la main, sans lieu : [{ cid, name }]
let depts = [];   // départements cochés à la main : codes ("01", "2A", "75"…)
let sel = null;
const active = { restaurant: true, bar: true, boite: true };
// Filtre par lieu (liste déroulante pays / ville)
let fCountry = "", fCity = "";
const inScope = (p) => (!fCountry || p.country === fCountry) && (!fCity || p.city === fCity);
const isShown = (p) => active[p.cat] && inScope(p);

// ---------------------------------------------------------------- carte --
// MapLibre GL : globe 3D + fond vectoriel sombre CARTO (données OpenStreetMap).
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const map = new maplibregl.Map({
  container: "map", style: STYLE_URL, center: [10, 30], zoom: 1.4, minZoom: 0.8, maxPitch: 60,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

let ready = false, globe = true, spin = !reduced, lastTouch = 0;
const PIN_LAYERS = ["dots", "ski"];
const colorOf = () => ["match", ["get", "cat"],
  "restaurant", css("--resto"), "bar", css("--bar"), "boite", css("--boite"), "ski", css("--ski"), "#8e8e93"];

// Pictogramme « sommet enneigé » des stations de ski (dessiné ici, pas de police d'icônes à charger)
function peakImage() {
  const n = 64, cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d");
  g.lineJoin = "round";
  g.beginPath(); g.moveTo(5, 52); g.lineTo(25, 14); g.lineTo(35, 31); g.lineTo(43, 21); g.lineTo(59, 52); g.closePath();
  g.lineWidth = 7; g.strokeStyle = "#0b0c0f"; g.stroke();
  g.fillStyle = css("--ski"); g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath(); g.moveTo(25, 14); g.lineTo(18.5, 27); g.lineTo(22.5, 24); g.lineTo(25.5, 29); g.lineTo(29, 24); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(43, 21); g.lineTo(38.5, 29.5); g.lineTo(43, 27.5); g.lineTo(47.5, 30); g.closePath(); g.fill();
  return g.getImageData(0, 0, n, n);
}

function setProjection(isGlobe) {
  globe = isGlobe;
  map.setProjection({ type: isGlobe ? "globe" : "mercator" });
  $("#proj").textContent = isGlobe ? "Carte plate" : "Globe 3D";
  $("#spin").hidden = !isGlobe;
}

map.on("style.load", () => {
  map.setProjection({ type: "globe" });
  try { map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] }); } catch {}
});

map.on("load", () => {
  // pays visités : teinte douce sous les noms du fond de carte
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addSource("visited", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "visited-fill", type: "fill", source: "visited", paint: { "fill-color": countryColor, "fill-opacity": 0.32 } }, firstSymbol);
  map.addLayer({ id: "visited-line", type: "line", source: "visited", paint: { "line-color": countryColor, "line-opacity": 0.85, "line-width": 1.2 } }, firstSymbol);
  loadWorld();
  map.addSource("depts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "dept-fill", type: "fill", source: "depts", filter: ["==", ["get", "v"], 1], paint: { "fill-color": countryColor, "fill-opacity": 0.55 } }, firstSymbol);
  map.addLayer({ id: "dept-line", type: "line", source: "depts", paint: {
    "line-color": "#ffffff", "line-opacity": 0.22, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 8, 0.9] } }, firstSymbol);
  loadDepts();
  map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("trips", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // halo lumineux, point, anneau de sélection, anneau qui pulse
  map.addLayer({ id: "glow", type: "circle", source: "places", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 15, 16, 24],
    "circle-color": colorOf(), "circle-opacity": 0.28, "circle-blur": 0.9 } });
  map.addLayer({ id: "trip-glow", type: "line", source: "trips", layout: { "line-cap": "round", "line-join": "round" }, paint: {
    "line-color": ["get", "c"], "line-width": 7, "line-opacity": 0.22, "line-blur": 5 } }, "glow");
  map.addLayer({ id: "trip-line", type: "line", source: "trips", layout: { "line-cap": "round", "line-join": "round" }, paint: {
    "line-color": ["get", "c"], "line-opacity": 0.95,
    "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 10, 2.6, 16, 4] } }, "glow");
  map.addLayer({ id: "dots", type: "circle", source: "places", filter: ["!=", ["get", "cat"], "ski"], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 10, 7, 16, 10],
    "circle-color": colorOf(), "circle-stroke-color": "#0b0c0f", "circle-stroke-width": 1.5 } });
  map.addImage("peak", peakImage(), { pixelRatio: 2 });
  map.addLayer({ id: "ski", type: "symbol", source: "places", filter: ["==", ["get", "cat"], "ski"], layout: {
    "icon-image": "peak", "icon-allow-overlap": true, "icon-ignore-placement": true,
    "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 10, 0.75, 16, 1] } });
  map.addLayer({ id: "sel", type: "circle", source: "places", filter: ["==", ["get", "sel"], 1], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 11, 16, 15],
    "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
  map.addLayer({ id: "pulse", type: "circle", source: "places", filter: ["==", ["get", "sel"], 1], paint: {
    "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-stroke-opacity": 0 } });

  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "tip" });
  for (const layerId of PIN_LAYERS) {
    map.on("mousemove", layerId, (e) => {
      map.getCanvas().style.cursor = "pointer";
      tip.setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.name).addTo(map);
    });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; tip.remove(); });
    map.on("click", layerId, (e) => select(e.features[0].properties.id, false));
  }
  const deptTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "tip" });
  map.on("mousemove", (e) => {
    if (!(deptsOn && deptEdit && deptFeats) || map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS }).length) { deptTip.remove(); return; }
    const d = deptOf(e.lngLat.lng, e.lngLat.lat, false);
    if (!d) { deptTip.remove(); return; }
    map.getCanvas().style.cursor = "pointer";
    deptTip.setLngLat(e.lngLat).setText(`${d.code} · ${d.nom}${checkedDepts().has(d.code) ? " ✓" : ""}`).addTo(map);
  });
  map.on("click", (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS }).length) return;
    if (deptsOn && deptEdit && deptFeats) { toggleDeptAt(e.lngLat.lng, e.lngLat.lat); return; }
    sel = null; render();
  });

  ready = true;
  render();
  fitAll();
});

// ---- pays visités : on retrouve le pays de chaque lieu à partir de ses coordonnées
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
let world = null, worldLoading = null, visitedKey = "", visitedCount = null;
const countryCache = new Map();
const COUNTRY_COLORS = [
  ["#5e5ce6", "Indigo"], ["#0a84ff", "Bleu"], ["#30d158", "Vert"],
  ["#ffd60a", "Or"], ["#ff6b6b", "Corail"], ["#e5e5ea", "Blanc"],
];
let countryColor = COUNTRY_COLORS[0][0];
try {
  const saved = localStorage.getItem("menu:countryColor");
  if (COUNTRY_COLORS.some(([c]) => c === saved)) countryColor = saved;
} catch {}
let countriesOn = true;
try { countriesOn = localStorage.getItem("menu:countries") !== "0"; } catch {}

function bboxOf(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (a) => typeof a[0] === "number"
    ? (x0 = Math.min(x0, a[0]), x1 = Math.max(x1, a[0]), y0 = Math.min(y0, a[1]), y1 = Math.max(y1, a[1]))
    : a.forEach(walk);
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));
const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
function nearKm(x, y, g) {
  let best = Infinity;
  const k = Math.cos((y * Math.PI) / 180);
  for (const poly of polysOf(g)) for (const [px, py] of poly[0]) {
    const d = Math.hypot((px - x) * k, py - y) * 111;
    if (d < best) best = d;
  }
  return best;
}
function countryOf(p) {
  const key = p.lon + "," + p.lat;
  if (countryCache.has(key)) return countryCache.get(key);
  let hit = null;
  for (const c of world) {
    const [x0, y0, x1, y1] = c.box;
    if (p.lon < x0 || p.lon > x1 || p.lat < y0 || p.lat > y1) continue;
    if (polysOf(c.f.geometry).some((poly) => inPoly(p.lon, p.lat, poly))) { hit = c.f; break; }
  }
  if (!hit) {   // point côtier tombé en mer à cette échelle : pays le plus proche à moins de 60 km
    let best = 60;
    for (const c of world) {
      if (p.lon < c.box[0] - 1 || p.lon > c.box[2] + 1 || p.lat < c.box[1] - 1 || p.lat > c.box[3] + 1) continue;
      const d = nearKm(p.lon, p.lat, c.f.geometry);
      if (d < best) { best = d; hit = c.f; }
    }
  }
  countryCache.set(key, hit);
  return hit;
}
// Le Royaume-Uni (826) est remplacé par ses quatre nations (Natural Earth, subunits 50 m)
const UK_NATIONS = "assets/uk-nations.json";
const UK_IDS = ["826-ENG", "826-SCT", "826-WLS", "826-NIR"];
// Relations OpenStreetMap renvoyées par la recherche → polygone
const UK_BY_OSM = { 62149: "826", 58447: "826-ENG", 58446: "826-SCT", 58437: "826-WLS", 156393: "826-NIR" };

// Un pays est découpé en « unités » : son territoire principal (avec les îles proches, Corse ou
// Baléares par exemple) et, à part, chaque groupe d'îles ou de terres éloigné (DOM-TOM, Canaries,
// Açores, Hawaï, Alaska…). Une unité éloignée n'est colorée que si on y a un lieu.
const JOIN_KM = 100;
const areaOf = (b) => (b[2] - b[0]) * (b[3] - b[1]);
function gapKm(a, b) {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]), dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  const lat = (((a[1] + a[3] + b[1] + b[3]) / 4) * Math.PI) / 180;
  return Math.hypot(dx * Math.cos(lat), dy) * 111;
}
function buildUnits(feats) {
  const units = [];
  for (const f of feats) {
    const polys = polysOf(f.geometry).map((c) => ({ c, box: bboxOf({ coordinates: c }) }));
    const par = polys.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      if (gapKm(polys[i].box, polys[j].box) <= JOIN_KM) par[find(i)] = find(j);
    }
    const groups = new Map();
    polys.forEach((pl, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(pl); });
    const list = [...groups.values()].map((g) => {
      const big = g.reduce((a, b) => (areaOf(a.box) >= areaOf(b.box) ? a : b));
      const box = g.reduce((u, pl) => [Math.min(u[0], pl.box[0]), Math.min(u[1], pl.box[1]), Math.max(u[2], pl.box[2]), Math.max(u[3], pl.box[3])], [180, 90, -180, -90]);
      return { g, big, box };
    }).sort((a, b) => areaOf(b.big.box) - areaOf(a.big.box));
    list.forEach((u, k) => {
      const id = k === 0 ? String(f.id)
        : `${f.id}@${((u.big.box[0] + u.big.box[2]) / 2).toFixed(1)},${((u.big.box[1] + u.big.box[3]) / 2).toFixed(1)}`;
      units.push({ f: { id, properties: f.properties, geometry: { type: "MultiPolygon", coordinates: u.g.map((x) => x.c) } }, box: u.box });
    });
  }
  return units;
}

function loadWorld() {
  if (worldLoading || typeof topojson === "undefined") return;
  worldLoading = Promise.all([
    fetch(WORLD_URL).then((r) => r.json()),
    fetch(UK_NATIONS).then((r) => r.json()).catch(() => null),
  ]).then(([t, uk]) => {
    let feats = topojson.feature(t, t.objects.countries).features.filter((f) => f.geometry);
    if (uk?.features?.length) feats = feats.filter((f) => String(f.id) !== "826").concat(uk.features);
    world = buildUnits(feats);
    deptCache.clear(); drawDepts();
    drawCountries(); renderList(); renderDeptPanel();
  }).catch(() => { worldLoading = null; });   // hors ligne : pas de teinte, le reste fonctionne
}
function drawCountries() {
  if (!ready || !world) return;
  const seen = new Map();
  for (const p of places) { const f = countryOf(p); if (f) seen.set(f.id, f); }
  for (const e of extra) {
    for (const id of e.cid === "826" ? UK_IDS : [e.cid]) {
      const c = world.find((w) => String(w.f.id) === id);
      if (c) seen.set(c.f.id, c.f);
    }
  }
  visitedCount = seen.size;
  map.setLayoutProperty("visited-fill", "visibility", countriesOn ? "visible" : "none");
  map.setLayoutProperty("visited-line", "visibility", countriesOn ? "visible" : "none");
  const hideFrance = deptsOn && !!deptFeats;   // la France est alors colorée département par département
  const key = [...seen.keys()].sort().join(",") + (hideFrance ? "|d" : "");
  if (key === visitedKey) return;
  visitedKey = key;
  map.getSource("visited").setData({
    type: "FeatureCollection",
    features: [...seen.values()].filter((f) => !(hideFrance && String(f.id) === "250")),
  });
}

// ---- départements de la France métropolitaine (gregoiredavid/france-geojson, version simplifiée)
const DEPT_URL = "assets/departements.json";
let deptFeats = null, deptKey = "";
let deptsOn = true, deptEdit = false;
try { deptsOn = localStorage.getItem("menu:depts") !== "0"; } catch {}
const deptCache = new Map();

function loadDepts() {
  fetch(DEPT_URL).then((r) => r.json()).then((d) => {
    deptFeats = d.features.map((f) => ({ f, code: f.properties.code, nom: f.properties.nom, box: bboxOf(f.geometry) }));
    drawDepts(); drawCountries(); renderDeptPanel();
  }).catch(() => {});
}
// Un point au-delà de la frontière (Ardennes belges, Luxembourg, Suisse…) ne doit jamais tomber dans un département.
function insideForeign(lon, lat) {
  if (!world) return false;
  for (const c of world) {
    if (String(c.f.id).startsWith("250")) continue;
    const [x0, y0, x1, y1] = c.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (polysOf(c.f.geometry).some((poly) => inPoly(lon, lat, poly))) return true;
  }
  return false;
}
// near = true : tolère un point côtier tombé en mer (lieux enregistrés). Pour un clic sur la carte, near = false.
function deptOf(lon, lat, near = true) {
  if (!deptFeats) return null;
  const key = lon.toFixed(4) + "," + lat.toFixed(4) + (near ? "n" : "");
  if (deptCache.has(key)) return deptCache.get(key);
  let hit = null;
  for (const d of deptFeats) {
    const [x0, y0, x1, y1] = d.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (polysOf(d.f.geometry).some((poly) => inPoly(lon, lat, poly))) { hit = d; break; }
  }
  if (!hit && near && lon > -6 && lon < 10 && lat > 41 && lat < 52 && !insideForeign(lon, lat)) {
    let best = 8;   // km
    for (const d of deptFeats) {
      if (lon < d.box[0] - 0.2 || lon > d.box[2] + 0.2 || lat < d.box[1] - 0.2 || lat > d.box[3] + 0.2) continue;
      const k = nearKm(lon, lat, d.f.geometry);
      if (k < best) { best = k; hit = d; }
    }
  }
  deptCache.set(key, hit);
  return hit;
}
const autoDepts = () => new Set(places.map((p) => deptOf(p.lon, p.lat)?.code).filter(Boolean));
const checkedDepts = () => new Set([...autoDepts(), ...depts]);

function drawDepts() {
  if (!ready || !deptFeats) return;
  const on = checkedDepts();
  const vis = deptsOn ? "visible" : "none";
  map.setLayoutProperty("dept-fill", "visibility", vis);
  map.setLayoutProperty("dept-line", "visibility", vis);
  const key = [...on].sort().join(",");
  if (key === deptKey) return;
  deptKey = key;
  map.getSource("depts").setData({
    type: "FeatureCollection",
    features: deptFeats.map((d) => ({ type: "Feature", geometry: d.f.geometry, properties: { code: d.code, v: on.has(d.code) ? 1 : 0 } })),
  });
}
function toggleDept(code) {
  if (autoDepts().has(code)) return;   // déjà coché par un lieu : on le retire en retirant le lieu
  depts = depts.includes(code) ? depts.filter((c) => c !== code) : [...depts, code];
  persist(); drawDepts(); renderDeptPanel();
}
function toggleDeptAt(lon, lat) {
  const d = deptOf(lon, lat, false);
  if (!d) return;
  if (autoDepts().has(d.code)) { setStatus(`${d.nom} est déjà coché par un lieu.`); return; }
  toggleDept(d.code);
}
function renderDeptPanel() {
  const box = $("#deptbox");
  if (!deptFeats) return;
  const auto = autoDepts(), on = checkedDepts();
  $("#deptcount").textContent = `${on.size} / ${deptFeats.length}`;
  if (!box.open) return;
  const list = $("#deptlist"), top = list.scrollTop;
  const t = norm($("#deptq").value || "");
  list.replaceChildren();
  for (const d of deptFeats.filter((x) => !t || norm(x.code + " " + x.nom).includes(t))
      .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))) {
    const row = document.createElement("label"); row.className = "dept";
    const cb = document.createElement("input"); cb.type = "checkbox";
    cb.checked = on.has(d.code); cb.disabled = auto.has(d.code);
    cb.onchange = () => toggleDept(d.code);
    const name = document.createElement("span"); name.textContent = `${d.code} · ${d.nom}`;
    row.append(cb, name);
    if (auto.has(d.code)) { const m = document.createElement("small"); m.textContent = "via un lieu"; row.append(m); }
    list.append(row);
  }
  list.scrollTop = top;
}
$("#deptbox").ontoggle = renderDeptPanel;
$("#deptq").oninput = renderDeptPanel;

// ---- trips : des lieux visités à des jours consécutifs sont reliés dans l'ordre
const DAY = 864e5;
const TRIP_COLORS = ["#64d2ff", "#bf5af2", "#ffd60a", "#ff6b6b", "#32d74b", "#ff9f0a"];
const dayNum = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null;
};
const fmtDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
function computeTrips(list) {
  const dated = list.map((p, i) => ({ p, i, d: dayNum(p.date) })).filter((x) => x.d !== null)
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const groups = []; let cur = [];
  for (const x of dated) {
    if (cur.length && x.d - cur[cur.length - 1].d > 1) { groups.push(cur); cur = []; }
    cur.push(x);
  }
  if (cur.length) groups.push(cur);
  return groups.filter((g) => g.length >= 2).map((g, k) => ({
    places: g.map((x) => x.p), from: g[0].p.date, to: g[g.length - 1].p.date, color: TRIP_COLORS[k % TRIP_COLORS.length],
  }));
}
// Arc de grand cercle entre deux points [lon, lat] : droit sur le globe, courbe sur la carte plate
function arc(a, b) {
  const r = Math.PI / 180, p1 = a[1] * r, p2 = b[1] * r, l1 = a[0] * r, l2 = b[0] * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-6) return [a];
  if (Math.sin(d) < 1e-9) return [a, b];
  const n = Math.max(2, Math.ceil(d / (2 * r))), pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([Math.atan2(y, x) / r, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return pts;
}
function tripLine(t) {
  const path = [];
  for (let i = 0; i < t.places.length - 1; i++) {
    const seg = arc([t.places[i].lon, t.places[i].lat], [t.places[i + 1].lon, t.places[i + 1].lat]);
    path.push(...(i ? seg.slice(1) : seg));
  }
  // évite le saut à l'antiméridien : chaque point reste à moins de 180° du précédent
  for (let i = 1; i < path.length; i++) {
    while (path[i][0] - path[i - 1][0] > 180) path[i][0] -= 360;
    while (path[i][0] - path[i - 1][0] < -180) path[i][0] += 360;
  }
  return path;
}
let tripsOn = true;
try { tripsOn = localStorage.getItem("menu:trips") !== "0"; } catch {}
const visiblePlaces = () => places.filter(isShown);
const tripOf = (p) => computeTrips(visiblePlaces()).find((t) => t.places.includes(p));

function drawMarkers() {
  if (!ready) return;
  drawCountries();
  map.getSource("trips").setData({
    type: "FeatureCollection",
    features: !tripsOn ? [] : computeTrips(visiblePlaces()).map((t) => ({
      type: "Feature", geometry: { type: "LineString", coordinates: tripLine(t) }, properties: { c: t.color, from: t.from, to: t.to },
    })),
  });
  map.getSource("places").setData({
    type: "FeatureCollection",
    features: places.filter(isShown).map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, cat: p.cat, sel: p.id === sel ? 1 : 0 },
    })),
  });
}

function fitAll() {
  const list = places.filter(inScope);
  if (!ready || !list.length) return;
  if (list.length === 1) return map.jumpTo({ center: [list[0].lon, list[0].lat], zoom: 12 });
  const b = new maplibregl.LngLatBounds();
  list.forEach((p) => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 60, maxZoom: 12, duration: reduced ? 0 : 1800 });
}

function flyTo(p, zoom) {
  lastTouch = performance.now();
  if (reduced) return map.jumpTo({ center: [p.lon, p.lat], zoom });
  map.flyTo({ center: [p.lon, p.lat], zoom, curve: 1.6, speed: 0.9, essential: true });
}

// Rotation lente du globe quand on ne touche à rien
["mousedown", "touchstart", "wheel", "keydown"].forEach((ev) =>
  map.getCanvas().addEventListener(ev, () => { lastTouch = performance.now(); }, { passive: true }));
function frame(t) {
  if (ready && globe && spin && !document.hidden && map.getZoom() < 3.2 && !map.isMoving() && t - lastTouch > 5000) {
    const c = map.getCenter();
    map.jumpTo({ center: [((c.lng - 0.08 + 540) % 360) - 180, c.lat] });
  }
  // anneau qui pulse autour du lieu sélectionné
  if (ready && map.getLayer("pulse")) {
    const k = reduced ? 0.4 : (t % 1600) / 1600;
    map.setPaintProperty("pulse", "circle-radius", 10 + k * 18);
    map.setPaintProperty("pulse", "circle-stroke-opacity", 0.8 * (1 - k));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const swatches = $("#swatches");
function paintCountries() {
  if (!ready) return;
  map.setPaintProperty("visited-fill", "fill-color", countryColor);
  map.setPaintProperty("visited-line", "line-color", countryColor);
  map.setPaintProperty("dept-fill", "fill-color", countryColor);
}
function renderSwatches() {
  swatches.replaceChildren();
  swatches.hidden = !countriesOn;
  for (const [c, name] of COUNTRY_COLORS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch"; b.style.background = c;
    b.title = name; b.setAttribute("aria-label", "Couleur des pays : " + name);
    b.setAttribute("aria-pressed", String(c === countryColor));
    b.onclick = () => {
      countryColor = c;
      try { localStorage.setItem("menu:countryColor", c); } catch {}
      paintCountries(); renderSwatches();
    };
    swatches.append(b);
  }
}
const deptBtn = $("#deptbtn"), editBtn = $("#deptedit");
function syncDeptBtns() {
  deptBtn.textContent = deptsOn ? "Départements : oui" : "Départements : non";
  deptBtn.setAttribute("aria-pressed", String(deptsOn));
  editBtn.hidden = !deptsOn;
  editBtn.textContent = deptEdit ? "Cocher sur la carte : oui" : "Cocher sur la carte : non";
  editBtn.setAttribute("aria-pressed", String(deptEdit));
  if (ready) map.getCanvas().style.cursor = "";
}
deptBtn.onclick = () => {
  deptsOn = !deptsOn;
  if (!deptsOn) deptEdit = false;
  try { localStorage.setItem("menu:depts", deptsOn ? "1" : "0"); } catch {}
  syncDeptBtns(); drawDepts(); drawCountries();
};
editBtn.onclick = () => { deptEdit = !deptEdit; syncDeptBtns(); };
syncDeptBtns();
const countryBtn = $("#countries");
const syncCountryBtn = () => {
  countryBtn.textContent = countriesOn ? "Pays : oui" : "Pays : non";
  countryBtn.setAttribute("aria-pressed", String(countriesOn));
};
countryBtn.onclick = () => {
  countriesOn = !countriesOn;
  try { localStorage.setItem("menu:countries", countriesOn ? "1" : "0"); } catch {}
  syncCountryBtn(); renderSwatches(); drawCountries();
};
syncCountryBtn(); renderSwatches();
const tripBtn = $("#trips");
const syncTripBtn = () => {
  tripBtn.textContent = tripsOn ? "Trips : oui" : "Trips : non";
  tripBtn.setAttribute("aria-pressed", String(tripsOn));
};
tripBtn.onclick = () => {
  tripsOn = !tripsOn;
  try { localStorage.setItem("menu:trips", tripsOn ? "1" : "0"); } catch {}
  syncTripBtn(); drawMarkers(); renderSel();
};
syncTripBtn();
$("#proj").onclick = () => setProjection(!globe);
$("#spin").onclick = () => {
  spin = !spin; lastTouch = 0;
  $("#spin").setAttribute("aria-pressed", String(spin));
  $("#spin").textContent = spin ? "Rotation : oui" : "Rotation : non";
};
$("#spin").textContent = spin ? "Rotation : oui" : "Rotation : non";
$("#spin").setAttribute("aria-pressed", String(spin));

// ------------------------------------------------------------ affichage --
function renderLegend() {
  const box = $("#legend");
  box.replaceChildren();
  for (const c in CATS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.setAttribute("aria-pressed", String(active[c]));
    const dot = document.createElement("span");
    dot.className = "dot " + c;
    b.append(dot, `${CATS[c]} · ${places.filter((p) => inScope(p) && p.cat === c).length}`);
    b.onclick = () => { active[c] = !active[c]; render(); };
    box.append(b);
  }
}

function renderList() {
  const cities = new Set(places.map((p) => p.city).filter(Boolean)).size;
  const countries = visitedCount ?? new Set(places.map((p) => p.country).filter(Boolean)).size;
  const stats = $("#stats");
  stats.replaceChildren();
  for (const [n, label] of [[places.length, "lieux"], [cities, "villes"], [countries, "pays"], [computeTrips(places).length, "trips"]]) {
    const d = document.createElement("div");
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = label;
    d.append(b, s); stats.append(d);
  }

  const list = $("#list");
  list.replaceChildren();
  const shown = places.filter(isShown);
  if (!places.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Aucun lieu pour l'instant. Cherchez un nom en haut de la page pour ajouter le premier.";
    list.append(p);
    return;
  }
  for (const p of [...shown].reverse()) {
    const r = document.createElement("div");
    r.className = "row" + (p.id === sel ? " sel" : "");
    r.tabIndex = 0;
    const dot = document.createElement("span"); dot.className = "dot " + p.cat;
    const t = document.createElement("span"); t.className = "t"; t.textContent = p.name;
    const sm = document.createElement("small"); sm.textContent = p.city || p.country || "";
    r.append(dot, t, sm);
    r.onclick = () => select(p.id, true);
    r.onkeydown = (e) => { if (e.key === "Enter") select(p.id, true); };
    list.append(r);
  }
}

function renderSel() {
  const box = $("#sel");
  box.replaceChildren();
  const p = places.find((x) => x.id === sel);
  if (!p) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = "Cliquez sur un point de la carte ou de la liste pour ouvrir sa fiche.";
    box.append(h);
    return;
  }
  const h2 = document.createElement("h2"); h2.textContent = p.name;
  const where = document.createElement("p"); where.className = "where";
  where.textContent = [p.city, p.country].filter(Boolean).join(", ");

  const trip = tripsOn ? tripOf(p) : null;
  const info = document.createElement("p"); info.className = "trip-info";
  if (trip) {
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = trip.color;
    const n = trip.places.length;
    info.append(dot, `Trip du ${fmtDay(trip.from)} au ${fmtDay(trip.to)} · ${n} lieux`);
  } else if (!p.date) {
    info.textContent = "Ajoutez une date : les lieux visités à des jours consécutifs sont reliés en trip.";
  }
  const form = document.createElement("div"); form.className = "form";
  const field = (label, el, id) => {
    const l = document.createElement("label"); l.htmlFor = id; l.append(label); el.id = id; l.append(el); return l;
  };

  const cat = document.createElement("select");
  for (const c in CATS) cat.add(new Option(CATS[c], c, false, c === p.cat));
  cat.onchange = () => { p.cat = cat.value; persist(); render(); };

  const date = document.createElement("input");
  date.type = "date"; date.value = p.date || "";
  date.onchange = () => { p.date = date.value; p.dateSet = !!date.value; persist(); render(); };

  const rating = document.createElement("select");
  rating.add(new Option("Pas de note", "0", false, !p.rating));
  for (let i = 1; i <= 5; i++) rating.add(new Option("★".repeat(i), String(i), false, p.rating === i));
  rating.onchange = () => { p.rating = Number(rating.value); persist(); };

  const note = document.createElement("textarea");
  note.value = p.note || ""; note.maxLength = 1000;
  note.oninput = () => { p.note = note.value; persist(); };

  const actions = document.createElement("div"); actions.className = "actions";
  const rm = document.createElement("button");
  rm.className = "btn danger"; rm.textContent = "Retirer de la carte";
  rm.onclick = () => {
    if (rm.dataset.sure !== "1") { rm.dataset.sure = "1"; rm.textContent = "Confirmer le retrait"; return; }
    places = places.filter((x) => x.id !== p.id); sel = null; persist(); render();
  };
  const osm = document.createElement("a");
  osm.className = "btn"; osm.textContent = "Voir sur OpenStreetMap"; osm.target = "_blank"; osm.rel = "noopener";
  osm.href = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;
  osm.style.textDecoration = "none";
  actions.append(rm, osm);

  form.append(field("Catégorie", cat, "f-cat"), field("Date de la visite", date, "f-date"),
              field("Note", rating, "f-rating"), field("Commentaire", note, "f-note"), actions);
  box.append(h2, where, ...(info.childNodes.length ? [info] : []), form);
}

function renderFilters() {
  const bar = $("#filters"), selC = $("#f-country"), selV = $("#f-city");
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const countries = uniq(places.map((p) => p.country));
  if (fCountry && !countries.includes(fCountry)) fCountry = "";
  const cities = uniq(places.filter((p) => !fCountry || p.country === fCountry).map((p) => p.city));
  if (fCity && !cities.includes(fCity)) fCity = "";
  const fill = (el, all, values, current) => {
    el.replaceChildren(new Option(all, ""), ...values.map((v) => new Option(v, v)));
    el.value = current;
  };
  fill(selC, "Tous les pays", countries, fCountry);
  fill(selV, "Toutes les villes", cities, fCity);
  bar.hidden = places.length < 2;
}
$("#f-country").onchange = (e) => { fCountry = e.target.value; fCity = ""; render(); fitAll(); };
$("#f-city").onchange = (e) => { fCity = e.target.value; render(); fitAll(); };

function renderExtras() {
  const box = $("#extras");
  box.replaceChildren();
  box.hidden = !extra.length;
  for (const e of extra) {
    const chip = document.createElement("span"); chip.className = "tag";
    const label = document.createElement("span"); label.textContent = e.name;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Retirer ce pays"; x.setAttribute("aria-label", "Retirer " + e.name);
    x.onclick = () => { extra = extra.filter((y) => y.cid !== e.cid); persist(); render(); };
    chip.append(label, x); box.append(chip);
  }
}

function render() { drawDepts(); renderDeptPanel(); renderExtras(); renderFilters(); renderLegend(); drawMarkers(); renderList(); renderSel(); }

function select(id, fly) {
  sel = id;
  const p = places.find((x) => x.id === id);
  if (p && !inScope(p)) { fCountry = ""; fCity = ""; }
  if (p) { active[p.cat] = true; if (fly) flyTo(p, Math.max(map.getZoom(), 15)); }
  render();
}

// ---------------------------------------------------------- sauvegarde --
function setStatus(text, isError = false) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("err", isError);
}

let saveTimer = null;
function persist() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(places)); localStorage.setItem(EXTRA_KEY, JSON.stringify(extra)); localStorage.setItem(DEPT_KEY, JSON.stringify(depts)); } catch {}
  setStatus("Enregistrement…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await saveData(APP, { places, countries: extra, depts }); setStatus("Synchronisé"); }
    catch (e) { setStatus("Non synchronisé : " + e.message, true); }
  }, 600);
}

// Les premières versions pré-remplissaient la date de visite avec le jour de l'ajout
// (19 oct. 2026). Ces dates automatiques sont effacées tant que l'utilisateur ne les
// a pas choisies lui-même (p.dateSet).
const LEGACY_AUTO_DATE = "2026-10-19";
let clearedLegacy = false;

function legacyDate(p) {
  const auto = !p.dateSet && p.date === LEGACY_AUTO_DATE;
  if (auto) clearedLegacy = true;
  return auto;
}

// Anciennes entrées « Angleterre » & co enregistrées avec le Royaume-Uni entier (826) : on les rattache à leur nation.
const UK_NAMES = {
  angleterre: "826-ENG", england: "826-ENG", ecosse: "826-SCT", scotland: "826-SCT",
  "pays de galles": "826-WLS", galles: "826-WLS", wales: "826-WLS",
  "irlande du nord": "826-NIR", "northern ireland": "826-NIR",
};
let migratedExtra = false;
const cleanDepts = (list) => [...new Set((Array.isArray(list) ? list : []).filter((c) => typeof c === "string" && /^\d{2}$|^2[AB]$/.test(c)))];
const cleanExtra = (list) => (Array.isArray(list) ? list : [])
  .filter((e) => e && typeof e.cid === "string" && typeof e.name === "string")
  .map((e) => {
    const nation = e.cid === "826" ? UK_NAMES[norm(e.name)] : null;
    if (nation) migratedExtra = true;
    return { cid: nation || e.cid, name: e.name };
  });

function clean(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && CATS[p.cat])
    .map((p) => ({
      id: p.id, name: String(p.name || "Sans nom"), city: String(p.city || ""), country: String(p.country || ""),
      lat: p.lat, lon: p.lon, cat: p.cat, date: legacyDate(p) ? "" : String(p.date || ""), dateSet: !!p.dateSet && !!p.date, rating: Number(p.rating) || 0, note: String(p.note || ""),
    }));
}

async function init() {
  try { places = clean(JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]")); } catch { places = []; }
  try { extra = cleanExtra(JSON.parse(localStorage.getItem(EXTRA_KEY) || "[]")); } catch { extra = []; }
  try { depts = cleanDepts(JSON.parse(localStorage.getItem(DEPT_KEY) || "[]")); } catch { depts = []; }
  render();
  try {
    const remote = await loadData(APP);
    if (remote && Array.isArray(remote.places)) {
      places = clean(remote.places);
      extra = cleanExtra(remote.countries);
      depts = cleanDepts(remote.depts);
      if (clearedLegacy || migratedExtra) persist();   // enregistre les nettoyages (dates automatiques, nations)
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(places)); localStorage.setItem(EXTRA_KEY, JSON.stringify(extra)); localStorage.setItem(DEPT_KEY, JSON.stringify(depts)); } catch {}
      render(); fitAll();
    } else if (places.length || extra.length || depts.length) {
      persist();
    }
    setStatus("Synchronisé");
  } catch (e) {
    setStatus("Hors ligne, copie locale affichée : " + e.message, true);
  }
}

// ------------------------------------------------------------ recherche --
const q = $("#q"), sug = $("#sug");
let results = [], idx = -1, timer = null, ctl = null;

function hideSug() { sug.hidden = true; q.setAttribute("aria-expanded", "false"); idx = -1; }

function fromFeature(f) {
  const pr = f.properties || {}, c = f.geometry?.coordinates;
  if (!pr.name || !Array.isArray(c)) return null;
  const street = [pr.street, pr.housenumber].filter(Boolean).join(" ");
  const city = pr.city || pr.town || pr.village || pr.district || pr.county || pr.state || "";
  let cat = null;
  if (pr.osm_key === "amenity") cat = AMENITY[pr.osm_value] || null;
  else if ((pr.osm_key === "landuse" && pr.osm_value === "winter_sports") || pr.osm_key === "aerialway" ||
           pr.osm_key === "piste:type" || (pr.osm_key === "sport" && /ski/.test(pr.osm_value || ""))) cat = "ski";
  // pays, ou région/état (Angleterre, Catalogne…) : on colore le pays qui la contient
  const isCountry = pr.type === "country" || pr.type === "state" ||
    (pr.osm_key === "place" && ["country", "state", "region"].includes(pr.osm_value));
  return {
    kind: isCountry ? "country" : "place",
    osmId: pr.osm_type === "R" ? pr.osm_id : null,
    id: `${pr.osm_type || "X"}${pr.osm_id ?? c.join(",")}`,
    name: pr.name, street, city, country: pr.country || "", lat: c[1], lon: c[0], cat,
  };
}

async function search(text) {
  ctl?.abort(); ctl = new AbortController();
  const params = new URLSearchParams({ q: text, limit: "10" });
  if (ready && map.getZoom() >= 5) {
    const c = map.getCenter();
    params.set("lat", c.lat.toFixed(3)); params.set("lon", c.lng.toFixed(3)); params.set("location_bias_scale", "0.4");
  }
  // 2e requête, limitée aux pays et régions : « Angleterre » ou « Japon » ressortent
  // même quand des restaurants du même nom les noient dans les 10 premiers résultats.
  const regionParams = new URLSearchParams({ q: text, limit: "3", lang: "default" });
  regionParams.append("layer", "country"); regionParams.append("layer", "state");
  const get = async (pr) => {
    const res = await fetch(`${PHOTON}?${pr}`, { signal: ctl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return (await res.json()).features || [];
  };
  try {
    const [main, regions] = await Promise.all([
      get(params),
      text.length >= 3 ? get(regionParams).catch((e) => { if (e.name === "AbortError") throw e; return []; }) : [],
    ]);
    const seen = new Set();
    results = [...regions, ...main].map(fromFeature).filter(Boolean)
      .filter((r) => !seen.has(r.id) && seen.add(r.id));
    // Pays dont le nom correspond exactement, puis restaurants/bars/boîtes, puis pays/régions, puis le reste.
    const t = norm(text);
    const rank = (r) => (r.kind === "country" && norm(r.name) === t ? 0 : r.cat ? 1 : r.kind === "country" ? 2 : 3);
    results.sort((a, b) => rank(a) - rank(b));
    showSug();
  } catch (e) {
    if (e.name === "AbortError") return;
    results = []; showSug("Recherche indisponible (" + e.message + "). Réessayez dans un instant.");
  }
}

function showSug(message) {
  sug.replaceChildren(); idx = -1;
  if (!results.length) {
    const li = document.createElement("li"); li.className = "none";
    li.textContent = message || "Aucun résultat. Ajoutez la ville pour préciser (ex. « Chez Paul Lyon »).";
    sug.append(li);
  }
  for (const r of results) {
    const li = document.createElement("li"); li.setAttribute("role", "option");
    const dot = document.createElement("span"); dot.className = "dot " + ($("#addcat").value || r.cat || "");
    const txt = document.createElement("span"); txt.className = "txt";
    const n = document.createElement("span"); n.className = "n"; n.textContent = r.name;
    const c = document.createElement("span"); c.className = "c";
    const where = [r.street, r.city, r.country].filter(Boolean).join(", ");
    const shown = $("#addcat").value || r.cat;
    c.textContent = r.kind === "country" ? "Pays ou région · colore le pays sur la carte, sans lieu"
      : `${shown ? CATS[shown] : "Autre lieu"} · ${where}`;
    txt.append(n, c); li.append(dot, txt);
    li.onmousedown = (e) => { e.preventDefault(); pick(r); };
    sug.append(li);
  }
  sug.hidden = false; q.setAttribute("aria-expanded", "true");
}

function mark() { [...sug.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === idx))); }

function pickCountry(r) {
  q.value = ""; hideSug();
  if (!world) { setStatus("Frontières pas encore chargées, réessayez dans un instant.", true); return; }
  const known = UK_BY_OSM[r.osmId];
  const f = known ? null : countryOf({ lon: r.lon, lat: r.lat });
  if (!known && !f) { setStatus("Pays introuvable sur la carte : " + r.name, true); return; }
  const cid = known || String(f.id);
  if (!extra.some((e) => e.cid === cid)) { extra.push({ cid, name: r.name }); persist(); }
  render();
  const b = world.find((w) => String(w.f.id) === (cid === "826" ? "826-ENG" : cid))?.box;
  if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 6, duration: reduced ? 0 : 1500 });
}

function pick(r) {
  if (r.kind === "country") return pickCountry(r);
  q.value = ""; hideSug();
  let p = places.find((x) => x.id === r.id);
  if (!p) {
    p = {
      id: r.id, name: r.name, city: r.city, country: r.country, lat: r.lat, lon: r.lon,
      cat: $("#addcat").value || r.cat || "restaurant", date: "", dateSet: false, rating: 0, note: "",
    };
    places.push(p); persist();
  }
  select(p.id, false);
  flyTo(p, 16);
}

q.addEventListener("input", () => {
  clearTimeout(timer);
  const t = q.value.trim();
  if (t.length < 2) { ctl?.abort(); hideSug(); return; }
  timer = setTimeout(() => search(t), 300);   // Photon: pas de requêtes à chaque touche
});
q.addEventListener("blur", () => setTimeout(hideSug, 120));
q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { idx = Math.min(idx + 1, results.length - 1); mark(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); mark(); e.preventDefault(); }
  else if (e.key === "Enter" && results.length && !sug.hidden) { pick(results[Math.max(idx, 0)]); e.preventDefault(); }
  else if (e.key === "Escape") hideSug();
});

init();
