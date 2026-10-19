// Carte des tables : globe 3D (MapLibre), recherche OpenStreetMap (Photon), sauvegarde Supabase.
//
// Les lieux sont enregistrés dans la table user_data de Home, avec
// app = "menu" : aucune nouvelle table à créer, et la RLS existante les isole
// par utilisateur. Une copie locale sert de secours hors ligne.

import { loadData, saveData } from "./auth.js";

const APP = "menu";
const LOCAL_KEY = "menu:places:v1";
const PHOTON = "https://photon.komoot.io/api/";

const CATS = { restaurant: "Restaurant", bar: "Bar", boite: "Boîte" };
// Valeur OSM `amenity` → catégorie de la carte
const AMENITY = {
  restaurant: "restaurant", cafe: "restaurant", fast_food: "restaurant", food_court: "restaurant", ice_cream: "restaurant",
  bar: "bar", pub: "bar", biergarten: "bar",
  nightclub: "boite", stripclub: "boite",
};

const $ = (s) => document.querySelector(s);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let places = [];
let sel = null;
const active = { restaurant: true, bar: true, boite: true };

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
const colorOf = () => ["match", ["get", "cat"],
  "restaurant", css("--resto"), "bar", css("--bar"), "boite", css("--boite"), "#8e8e93"];

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
  map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // halo lumineux, point, anneau de sélection, anneau qui pulse
  map.addLayer({ id: "glow", type: "circle", source: "places", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 15, 16, 24],
    "circle-color": colorOf(), "circle-opacity": 0.28, "circle-blur": 0.9 } });
  map.addLayer({ id: "dots", type: "circle", source: "places", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 10, 7, 16, 10],
    "circle-color": colorOf(), "circle-stroke-color": "#0b0c0f", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "sel", type: "circle", source: "places", filter: ["==", ["get", "sel"], 1], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 11, 16, 15],
    "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
  map.addLayer({ id: "pulse", type: "circle", source: "places", filter: ["==", ["get", "sel"], 1], paint: {
    "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-stroke-opacity": 0 } });

  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "tip" });
  map.on("mousemove", "dots", (e) => {
    map.getCanvas().style.cursor = "pointer";
    tip.setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.name).addTo(map);
  });
  map.on("mouseleave", "dots", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
  map.on("click", "dots", (e) => select(e.features[0].properties.id, false));
  map.on("click", (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: ["dots"] }).length) { sel = null; render(); }
  });

  ready = true;
  render();
  fitAll();
});

function drawMarkers() {
  if (!ready) return;
  map.getSource("places").setData({
    type: "FeatureCollection",
    features: places.filter((p) => active[p.cat]).map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, cat: p.cat, sel: p.id === sel ? 1 : 0 },
    })),
  });
}

function fitAll() {
  if (!ready || !places.length) return;
  if (places.length === 1) return map.jumpTo({ center: [places[0].lon, places[0].lat], zoom: 12 });
  const b = new maplibregl.LngLatBounds();
  places.forEach((p) => b.extend([p.lon, p.lat]));
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
    b.append(dot, `${CATS[c]} · ${places.filter((p) => p.cat === c).length}`);
    b.onclick = () => { active[c] = !active[c]; render(); };
    box.append(b);
  }
}

function renderList() {
  const cities = new Set(places.map((p) => p.city).filter(Boolean)).size;
  const countries = new Set(places.map((p) => p.country).filter(Boolean)).size;
  const stats = $("#stats");
  stats.replaceChildren();
  for (const [n, label] of [[places.length, "lieux"], [cities, "villes"], [countries, "pays"]]) {
    const d = document.createElement("div");
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = label;
    d.append(b, s); stats.append(d);
  }

  const list = $("#list");
  list.replaceChildren();
  const shown = places.filter((p) => active[p.cat]);
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

  const form = document.createElement("div"); form.className = "form";
  const field = (label, el, id) => {
    const l = document.createElement("label"); l.htmlFor = id; l.append(label); el.id = id; l.append(el); return l;
  };

  const cat = document.createElement("select");
  for (const c in CATS) cat.add(new Option(CATS[c], c, false, c === p.cat));
  cat.onchange = () => { p.cat = cat.value; persist(); render(); };

  const date = document.createElement("input");
  date.type = "date"; date.value = p.date || "";
  date.onchange = () => { p.date = date.value; persist(); };

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
  box.append(h2, where, form);
}

function render() { renderLegend(); drawMarkers(); renderList(); renderSel(); }

function select(id, fly) {
  sel = id;
  const p = places.find((x) => x.id === id);
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
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(places)); } catch {}
  setStatus("Enregistrement…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await saveData(APP, { places }); setStatus("Synchronisé"); }
    catch (e) { setStatus("Non synchronisé : " + e.message, true); }
  }, 600);
}

function clean(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && CATS[p.cat])
    .map((p) => ({
      id: p.id, name: String(p.name || "Sans nom"), city: String(p.city || ""), country: String(p.country || ""),
      lat: p.lat, lon: p.lon, cat: p.cat, date: String(p.date || ""), rating: Number(p.rating) || 0, note: String(p.note || ""),
    }));
}

async function init() {
  try { places = clean(JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]")); } catch { places = []; }
  render();
  try {
    const remote = await loadData(APP);
    if (remote && Array.isArray(remote.places)) {
      places = clean(remote.places);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(places)); } catch {}
      render(); fitAll();
    } else if (places.length) {
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
  const cat = pr.osm_key === "amenity" ? AMENITY[pr.osm_value] || null : null;
  return {
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
  try {
    const res = await fetch(`${PHOTON}?${params}`, { signal: ctl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    results = (data.features || []).map(fromFeature).filter(Boolean);
    // Restaurants, bars et boîtes d'abord, sans changer l'ordre de pertinence à l'intérieur
    results.sort((a, b) => Number(!!b.cat) - Number(!!a.cat));
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
    const dot = document.createElement("span"); dot.className = "dot " + (r.cat || "");
    const txt = document.createElement("span"); txt.className = "txt";
    const n = document.createElement("span"); n.className = "n"; n.textContent = r.name;
    const c = document.createElement("span"); c.className = "c";
    const where = [r.street, r.city, r.country].filter(Boolean).join(", ");
    c.textContent = `${r.cat ? CATS[r.cat] : "Autre lieu"} · ${where}`;
    txt.append(n, c); li.append(dot, txt);
    li.onmousedown = (e) => { e.preventDefault(); pick(r); };
    sug.append(li);
  }
  sug.hidden = false; q.setAttribute("aria-expanded", "true");
}

function mark() { [...sug.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === idx))); }

function pick(r) {
  q.value = ""; hideSug();
  let p = places.find((x) => x.id === r.id);
  if (!p) {
    p = {
      id: r.id, name: r.name, city: r.city, country: r.country, lat: r.lat, lon: r.lon,
      cat: r.cat || "restaurant", date: "", rating: 0, note: "",
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
