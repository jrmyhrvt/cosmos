/* --------------------------------------------------------------------------
   ISS-ÜBERFLÜGE - Ansicht
   Land suchen, Überflug berechnen, Ergebnis anzeigen.

   Die Rechnung steckt in issPass.js, diese Datei ist nur die Oberfläche.
   Zwei Dinge sind hier bewusst getrennt von den Ereignislisten:

   1. Die Suche ist asynchron und darf scheitern. "Keine Bahndaten" ist
      etwas voellig anderes als "kein Ueberflug" - im ersten Fall darf
      NICHT stehen, die ISS fliege in 45 Tagen nicht darueber.

   2. Die Berechnung braucht je nach Land unterschiedlich lange. Vatikanstadt
      braucht gut eine Sekunde, Kiribati dreissig. Ein eingefrorener Button
      waere eine tote Oberflaeche, deshalb wird gearbeitet und der alte
      Auftrag verworfen, wenn ein neuer kommt.
   -------------------------------------------------------------------------- */

import { loadCountries, sucheLaender, ueberflugSuchen } from "./issPass.js";
import { TRANSLATIONS } from "../translations.js";
import { currentLang } from "../main.js";
import { escapeHtml, fmtDate, fmtClock, tzOffsetHours } from "../events/eventManager.js";

// Wie viele Wochen sucht die Suche. Kleinstaat trifft man selten, aber
// "selten" heisst nicht "nie" - 45 Tage sind das, was die Suche zuverlaessig
// beantworten kann.
const MAX_TAGE = 45;

let laender = null;
let laenderFehler = null;
let gewaehltesLand = null;
let laufendeSuche = null;   // Zaehler, damit alte Antworten verworfen werden
let letzteAntwort = null;

// ------------------------------------------------------------------ Hilfen

function gradZuText(lat, lon){
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns} / ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function alterText(stunden){
  if(stunden == null || !Number.isFinite(stunden)) return "";
  if(stunden < 1.5) return "weniger als 2 Stunden";
  if(stunden < 48) return `${Math.round(stunden)} Stunden`;
  return `${Math.round(stunden / 24)} Tagen`;
}

function dauerText(sek){
  if(sek < 60) return `${sek.toFixed(1).replace(".", ",")} s`;
  const m = Math.floor(sek / 60);
  const s = Math.round(sek - m * 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// Die Bodenspur als kleines Bild: x nach Osten, y nach Norden. Weil die
// Karte dort gekappt ist, wird zusaetzlich der Aequator als Linie gezeigt -
// sonst sieht ein Ueberflug am suedlichen Rand wie einer in Mitteleuropa aus.
function spurBild(punkte){
  if(!punkte || punkte.length < 2) return "";
  const lats = punkte.map(p => p[0]);
  const lons = punkte.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  // Etwas Luft ringsum, damit die Linie nicht am Rahmen klebt.
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.35);
  const lonPad = Math.max((maxLon - minLon) * 0.15, 0.35);
  const unten = minLat - latPad, oben = maxLat + latPad;
  const links = minLon - lonPad, rechts = maxLon + lonPad;

  const W = 300, H = 110;
  const x = lon => ((lon - links) / (rechts - links)) * W;
  const y = lat => H - ((lat - unten) / (oben - unten)) * H;
  const clip = v => Math.max(0, Math.min(W, v));

  const pfad = punkte.map((p, i) =>
    `${i ? "L" : "M"}${clip(x(p[1])).toFixed(1)} ${y(p[0]).toFixed(1)}`).join(" ");
  const aequator = (unten <= 0 && oben >= 0)
    ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 4"/>`
    : "";

  return `<svg class="iss-trail" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${aequator}
    <path d="${pfad}" fill="none" stroke="#7fd4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${clip(x(punkte[0][1])).toFixed(1)}" cy="${y(punkte[0][0]).toFixed(1)}" r="3" fill="#7fd4ff"/>
  </svg>`;
}

// ------------------------------------------------------------------ Listen

// Der deutsche Name ist der Schluessel im Code, angezeigt wird aber der
// Name der gerade gewaehlten Sprache. Ohne Sprachnamen zeigte die Liste in
// Spanisch "Spanien", in Englisch ebenfalls - das war irritierend.
function anzeigeName(land){
  const lang = currentLang;
  const eigener = lang === "en" ? land.nameEn : lang === "es" ? land.nameEs : land.nameDe;
  return eigener || land.name;
}

function laenderZeichnen(begriff){
  const box = document.getElementById("issCountryList");
  if(!box) return;
  const t = TRANSLATIONS[currentLang];

  if(laenderFehler){
    box.innerHTML = `<div class="empty"><div class="title">${t.iss_no_countries}</div></div>`;
    return;
  }
  if(!laender){
    box.innerHTML = `<div class="iss-none">${t.iss_searching}</div>`;
    return;
  }

  const treffer = begriff
    ? sucheLaender(laender, begriff, 40)
    : laender.slice(0, 40);

  if(!treffer.length){
    box.innerHTML = `<div class="iss-none">${t.iss_no_match}</div>`;
    return;
  }

  box.innerHTML = treffer.map(l =>
    `<button class="iss-chip${gewaehltesLand && gewaehltesLand.name === l.name ? " on" : ""}"
             data-land="${escapeHtml(l.name)}">${escapeHtml(anzeigeName(l))}</button>`
  ).join("");
}

// ---------------------------------------------------------------- Ergebnis

function ergebnisZeichnen(){
  const box = document.getElementById("issResult");
  if(!box) return;
  const t = TRANSLATIONS[currentLang];
  box.innerHTML = "";
  if(!letzteAntwort) return;

  const a = letzteAntwort;

  // Keine Bahndaten. Das ist KEIN "kein Ueberflug" - der Unterschied ist
  // der ganze Sinn dieser Meldung.
  if(!a.ok){
    box.innerHTML = `<div class="iss-card">
      <div class="when" style="font-size:18px">${t.iss_tle_error}</div>
      <div class="sub">${escapeHtml(a.fehler || "")}</div>
    </div>`;
    return;
  }

  const alter = alterText(a.tleAlterStunden);
  const alterZeile = alter
    ? `<div class="iss-note${a.notfall ? " warn" : ""}">${a.notfall ? t.iss_tle_cached : t.iss_tle_old.replace("%s", alter)}</div>`
    : "";

  if(a.ueberflug){
    const u = a.ueberflug;
    const wann = new Date(u.zeitpunkt);
    const sichtbar = u.sichtbar;
    box.innerHTML = `<div class="iss-card">
      <div class="eyebrow">${t.iss_result_in}</div>
      <div class="when">${fmtClock(wann)}</div>
      <div class="sub">${fmtDate(wann)}${tzOffsetHours ? ` · UTC${tzOffsetHours >= 0 ? "+" : ""}${tzOffsetHours}` : ""}</div>
      <div class="iss-facts">
        <div><label>${t.iss_duration}</label><val>${dauerText(u.dauerSek)}</val></div>
        <div><label>${t.iss_maxheight}</label><val>${Math.round(u.maxHoehe)}°</val></div>
        <div><label>${t.iss_observer}</label><val style="font-size:12px">${gradZuText(u.beobachter.lat, u.beobachter.lon)}</val></div>
        <div><label>${sichtbar ? t.iss_visible : t.iss_not_visible}</label><val>${sichtbar ? "✓" : "—"}</val></div>
      </div>
      ${spurBild(u.punkte)}
      ${alterZeile}
      ${a.notfall ? `<div class="iss-note warn">${t.iss_bad_tle_hint}</div>` : ""}
    </div>`;
    return;
  }

  // Kein Ueberflug, aber wie nah dran?
  const ann = a.annaeherung;
  const annZeile = ann && Number.isFinite(ann.abstandKm)
    ? `<div class="sub" style="margin-top:8px">${t.iss_closest_sub.replace("%s", Math.round(ann.abstandKm))}</div>`
    : "";
  box.innerHTML = `<div class="iss-card">
    <div class="iss-none" style="padding:14px 0">
      <div class="big">${t.iss_result_none}</div>
      <div>${t.iss_result_none_sub}</div>
    </div>
    ${annZeile}
    ${alterZeile}
  </div>`;
}

function statusZeichnen(text){
  const box = document.getElementById("issResult");
  if(box) box.innerHTML = `<div class="iss-card"><div class="sub">${text}</div></div>`;
}

// ------------------------------------------------------------------ Suche

async function suchen(land){
  if(!land) return;
  gewaehltesLand = land;
  laenderZeichnen(document.getElementById("issCountrySearch")?.value || "");
  statusZeichnen(TRANSLATIONS[currentLang].iss_calculating);

  const nr = ++laufendeSuche;
  const antwort = await ueberflugSuchen(land, {maxTage: MAX_TAGE});
  // Zwischenzeitlich ein anderes Land gewaehlt: diese Antwort nicht zeigen.
  if(nr !== laufendeSuche) return;

  letzteAntwort = antwort;
  ergebnisZeichnen();
}

// -------------------------------------------------------------------- Start

let laenderGeladen = false;

async function init(){
  const feld = document.getElementById("issCountrySearch");
  if(!feld || laenderGeladen) return;
  laenderGeladen = true;

  feld.addEventListener("input", () => laenderZeichnen(feld.value));

  document.getElementById("issCountryList")?.addEventListener("click", e => {
    const chip = e.target.closest(".iss-chip");
    if(!chip) return;
    const land = laender?.find(l => l.name === chip.dataset.land);
    if(land) suchen(land);
  });

  try{
    laender = await loadCountries();
  }catch(err){
    laenderFehler = err;
  }
  if(gewaehltesLand) gewaehltesLand = laender?.find(l => l.name === gewaehltesLand.name) || null;
  laenderZeichnen(feld.value);
  ergebnisZeichnen();
}

export function renderIssPass(){
  init();
  laenderZeichnen(document.getElementById("issCountrySearch")?.value || "");
  ergebnisZeichnen();
}

// Sprachwechsel: neu uebersetzen, Berechnung nicht wiederholen.
export function issPassSprache(){
  laenderZeichnen(document.getElementById("issCountrySearch")?.value || "");
  ergebnisZeichnen();
}