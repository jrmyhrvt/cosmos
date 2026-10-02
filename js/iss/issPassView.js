/* --------------------------------------------------------------------------
   ISS-LÄNDERÜBERFLUG
   Teil des Live-Fensters, kein eigener Tab. Auswahlfeld, Rechnung,
   Ergebnis.

   Die Rechnung steckt in issPass.js, diese Datei ist nur die Oberfläche.
   Zwei Dinge sind hier bewusst getrennt von den Ereignislisten:

   1. Die Suche ist asynchron und darf scheitern. "Keine Bahndaten" ist
      etwas voellig anderes als "kein Ueberflug" - im ersten Fall darf
      NICHT stehen, die ISS fliege in 45 Tagen nicht darueber.

   2. Die Berechnung braucht je nach Land unterschiedlich lange. Vatikanstadt
      braucht gut eine Sekunde, Kiribati dreissig. Deshalb wird gearbeitet
      und der alte Auftrag verworfen, wenn ein neuer kommt.
   -------------------------------------------------------------------------- */

import { loadCountries, ueberflugSuchen } from "./issPass.js";
import { setGlobeLand } from "./issManager.js";
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

function dauerText(sek){
  if(sek < 60) return `${sek.toFixed(1).replace(".", ",")} s`;
  const m = Math.floor(sek / 60);
  const s = Math.round(sek - m * 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// Die Bodenspur als kleines Bild: x nach Osten, y nach Norden. Weil die
// Karte dort gekappt ist, wird zusaetzlich der Aequator als Linie gezeigt -
// sonst sieht ein Ueberflug am suedlichen Rand wie einer in Mitteleuropa aus.
// ---------------------------------------------------------------- Auswahlfeld

// Der deutsche Name ist der Schluessel im Code, angezeigt wird aber der
// Name der gerade gewaehlten Sprache.
function anzeigeName(land){
  const lang = currentLang;
  const eigener = lang === "en" ? land.nameEn : lang === "es" ? land.nameEs : land.nameDe;
  return eigener || land.name;
}

// Das Auswahlfeld wird nur neu befuellt, wenn es noch leer ist. Sonst waere
// beim Sprachwechsel die gerade getroffene Auswahl wieder weg - das ist
// nervoes, wenn man zweimal dieselbe Sprache durchschaltet.
function auswahlZeichnen(){
  const feld = document.getElementById("issCountrySelect");
  if(!feld) return;
  const t = TRANSLATIONS[currentLang];

  // Beim Neuaufbau (Sprachwechsel) eine bereits gewaehlte Auswahl behalten.
  const gewaehlt = gewaehltesLand ? gewaehltesLand.name : feld.value;

  if(laenderFehler){
    feld.disabled = true;
    feld.innerHTML = `<option>${t.iss_no_countries}</option>`;
    return;
  }
  if(!laender){
    feld.disabled = true;
    feld.innerHTML = `<option>${t.iss_searching}</option>`;
    return;
  }

  // Ein echtes <select> statt einer Liste: der Browser bringt auf dem
  // Telefon das eigene Auswahlrad mit, in dem man scrollen und suchen kann.
  // Eine Liste aus 242 Buttons war auf dem kleinen Bildschirm nicht bedienbar.
  const sortiert = [...laender].sort((a, b) =>
    anzeigeName(a).localeCompare(anzeigeName(b), currentLang));

  feld.disabled = false;
  feld.innerHTML = `<option value="">${t.iss_pick}</option>` + sortiert.map(l =>
    `<option value="${escapeHtml(l.name)}">${escapeHtml(anzeigeName(l))}</option>`
  ).join("");

  if(gewaehlt) feld.value = gewaehlt;
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

  if(a.ueberflug){
    const u = a.ueberflug;
    const wann = new Date(u.zeitpunkt);
    const land = anzeigeName(gewaehltesLand || {name:""});
    // Nur zwei Zeilen. Wer hier nachschaut, will Zeitpunkt und Dauer wissen -
    // Höhe, Sichtbarkeit, Beobachtungspunkt und Bild sind Zusatz, die den
    // Platz unter der Kugel zerschiessen.
    box.innerHTML = `<div class="iss-lines">
      <div class="iss-line"><label>${t.iss_next_over} ${escapeHtml(land)}</label><val>${fmtClock(wann)} ${fmtDate(wann)}</val></div>
      <div class="iss-line"><label>${t.iss_duration_over} ${escapeHtml(land)}</label><val>${dauerText(u.dauerSek)}</val></div>
    </div>`;
    return;
  }

  // Kein Ueberflug. Abstand weggelassen: die Rechnung liefert ihn zwar, aber
  // "27 km vom Zentrum entfernt" ist eine Zahl ohne Nutzen - entweder sie
  // kommt drueber oder sie kommt nicht.
  box.innerHTML = `<div class="iss-none">${t.iss_result_none}</div>`;
}

function statusZeichnen(text){
  const box = document.getElementById("issResult");
  if(box) box.innerHTML = `<div class="iss-card"><div class="sub">${text}</div></div>`;
}

// Das Kreuz neben dem Auswahlfeld ist nur sichtbar, wenn wirklich ein Land
// gewaehlt ist. Es steht als Geschwister neben dem Feld statt darin: im Feld
// wuerde es mit dem Chevron kollidieren, der schon am rechten Rand sitzt.
function kreuzZeichnen(){
  const knopf = document.getElementById("issCountryClear");
  if(knopf) knopf.hidden = !gewaehltesLand;
}

// Auswahl und Ergebnis komplett zuruecksetzen. Das Kreuz ruft das auf, das
// leere Auswahlfeld ebenso - dadurch bleibt das Umranden der Kugel nicht
// zurueck, wenn niemand mehr ein Land gewaehlt hat.
function auswahlZuruecksetzen(){
  gewaehltesLand = null;
  letzteAntwort = null;
  laufendeSuche++;              // eine noch laufende Rechnung nicht mehr zeigen
  const feld = document.getElementById("issCountrySelect");
  if(feld) feld.value = "";
  ergebnisZeichnen();
  kreuzZeichnen();
  setGlobeLand(null);
}

// ------------------------------------------------------------------ Suche

async function suchen(land){
  if(!land) return;
  gewaehltesLand = land;
  // Das Land sofort auf der Kugel umranden, noch bevor die Rechnung fertig ist.
  // Wer hier gerade wartet, will sehen wo das Land ueberhaupt liegt.
  setGlobeLand(land);
  kreuzZeichnen();
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

// Das Auswahlfeld wird bei jedem Neuaufbau der Live-Liste neu erzeugt. Deshalb
// wird der Zuhoerer an das jeweils aktuelle Element gehaengt, statt einmalig
// beim ersten Mal - sonst waere er nach dem naechsten Rendern tot.
async function init(){
  const feld = document.getElementById("issCountrySelect");
  if(!feld) return;

  // "change" feuert, sobald wirklich ein anderes Land gewaehlt wurde - auf
  // Telefonen erst, wenn die Liste bestaetigt ist. Genau das Verhalten, das
  // man will: nicht schon bei jedem Vorbeiscrollen rechnen.
  if(!feld.dataset.issLaeuft){
    feld.dataset.issLaeuft = "1";
    feld.addEventListener("change", () => {
      const land = laender?.find(l => l.name === feld.value);
      if(land) suchen(land);
      // Zurueck auf "Land auswaehlen": keine Auswahl, kein Ergebnis, und die
      // Kugel zeigt keine rote Umrandung mehr.
      else auswahlZuruecksetzen();
    });
  }

  const knopf = document.getElementById("issCountryClear");
  if(knopf && !knopf.dataset.issLaeuft){
    knopf.dataset.issLaeuft = "1";
    knopf.addEventListener("click", auswahlZuruecksetzen);
  }

  if(!laenderGeladen){
    laenderGeladen = true;
    try{
      laender = await loadCountries();
    }catch(err){
      laenderFehler = err;
    }
  }
  auswahlZeichnen();
  ergebnisZeichnen();
  kreuzZeichnen();
  // Nach dem Neuaufbau ist der Globus eine neue Instanz. Das gewaehlte Land
  // lebt aber im Modulzustand weiter - ohne dieses Zuruecksetzen zeigte die
  // Kugel beim naechsten Oeffnen wieder die Station statt des Landes.
  if(gewaehltesLand) setGlobeLand(gewaehltesLand);
}

export function renderIssPass(){
  init();
}

// Sprachwechsel: neu uebersetzen, Berechnung nicht wiederholen.
export function issPassSprache(){
  const feld = document.getElementById("issCountrySelect");
  if(feld) auswahlZeichnen();
  ergebnisZeichnen();
  kreuzZeichnen();
}
