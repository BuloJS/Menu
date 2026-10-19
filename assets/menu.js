// Carte des tables : recherche OpenStreetMap (Photon) + sauvegarde Supabase.
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
const map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([30, 10], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);

function drawMarkers() {
  layer.clearLayers();
  for (const p of places) {
    if (!active[p.cat]) continue;
    const isSel = p.id === sel;
    L.circleMarker([p.lat, p.lon], {
      radius: isSel ? 12 : 8,
      color: isSel ? "#fff" : "#1c1d21",
      weight: isSel ? 3 : 2,
      fillColor: css("--" + (p.cat === "restaurant" ? "resto" : p.cat)),
      fillOpacity: 1,
    })
      .bindTooltip(p.name, { direction: "top", offset: [0, -6] })
      .on("click", () => select(p.id, false))
      .addTo(layer);
  }
}

function fitAll() {
  if (!places.length) return;
  if (places.length === 1) return map.setView([places[0].lat, places[0].lon], 13);
  map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 13 });
}

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
  if (p) { active[p.cat] = true; if (fly) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 15)); }
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
  render(); fitAll();
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
  if (map.getZoom() >= 5) {
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
      cat: r.cat || "restaurant", date: new Date().toISOString().slice(0, 10), rating: 0, note: "",
    };
    places.push(p); persist();
  }
  select(p.id, false);
  map.flyTo([p.lat, p.lon], 16);
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
