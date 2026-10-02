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

import { loadCountries, ueberflugSuchen, sucheLaender } from "./issPass.js";
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

function feldEl(){ return document.getElementById("issCountryInput"); }
function listeEl(){ return document.getElementById("issCountryList"); }

function listeSchliessen(){
  const box = listeEl();
  if(!box) return;
  box.hidden = true;
  const feld = feldEl();
  if(feld) feld.setAttribute("aria-expanded", "false");
}

// Treffer unter das Suchfeld schreiben. Gesucht wird in allen mitgefuehrten
// Namen, "Aegypten", "Ägypten" und "Egypt" finden also dasselbe Land.
function listeZeichnen(begriff){
  const box = listeEl();
  if(!box || !laender) return;
  const t = TRANSLATIONS[currentLang];
  const treffer = sucheLaender(laender, begriff, 60);

  if(!treffer.length){
    box.innerHTML = `<div class="iss-list-empty">${escapeHtml(t.iss_no_match)}</div>`;
  }else{
    box.innerHTML = treffer.map(l => {
      const gewaehlt = gewaehltesLand && gewaehltesLand.name === l.name;
      return `<button type="button" class="iss-item" role="option"
        data-name="${escapeHtml(l.name)}" aria-selected="${gewaehlt ? "true" : "false"}"
      >${escapeHtml(anzeigeName(l))}</button>`;
    }).join("");
  }
  box.hidden = false;
  const feld = feldEl();
  if(feld) feld.setAttribute("aria-expanded", "true");
}

// Auf dem iPad (und in der installierten Web-App) laesst ein blosses blur()
// die Bildschirmtastatur oft stehen. Kurz schreibgeschuetzt und explizit
// unfokussiert ist der Weg, der sie zuverlaessig schliesst.
function tastaturSchliessen(feld){
  if(!feld) return;
  const warReadonly = feld.readOnly;
  feld.readOnly = true;
  feld.blur();
  if(!warReadonly) setTimeout(() => { feld.readOnly = false; }, 160);
}

// Ein Land aus der Trefferliste uebernehmen. Im Feld steht danach der
// Anzeigename, gerechnet wird mit dem stabilen deutschen Namen.
function waehlen(land){
  gewaehltesLand = land;
  const feld = feldEl();
  if(feld) feld.value = anzeigeName(land);
  tastaturSchliessen(feld);
  listeSchliessen();
  suchen(land);
}

// Das Feld wird nur neu beschriftet, nie geleert: beim Sprachwechsel soll die
// getroffene Auswahl stehen bleiben. Der Zustand liegt in gewaehltesLand.
function auswahlZeichnen(){
  const feld = feldEl();
  if(!feld) return;
  const t = TRANSLATIONS[currentLang];

  if(laenderFehler){
    feld.disabled = true;
    feld.placeholder = t.iss_no_countries;
    feld.value = "";
    return;
  }
  if(!laender){
    feld.disabled = true;
    feld.placeholder = t.iss_searching;
    return;
  }
  feld.disabled = false;
  feld.placeholder = t.iss_pick;
  feld.value = gewaehltesLand ? anzeigeName(gewaehltesLand) : "";
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
  const feld = feldEl();
  if(feld){ feld.value = ""; feld.disabled = false; }
  listeSchliessen();
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
  const feld = feldEl();
  if(!feld) return;
  const box = listeEl();

  // Tippen filtert die Laenderliste. Gerechnet wird erst, wenn ein Land
  // wirklich angetippt wurde - nicht schon bei jedem Buchstaben.
  if(!feld.dataset.issLaeuft){
    feld.dataset.issLaeuft = "1";
    feld.addEventListener("input", () => {
      const begriff = feld.value.trim();
      if(!begriff){ listeSchliessen(); return; }
      listeZeichnen(begriff);
    });
    // Beim Fokus den bereits gewaehlten Namen markieren, damit Tippen ihn
    // ersetzt statt anzuhaengen ("Deutschland" + "D" waere sonst Unsinn).
    feld.addEventListener("focus", () => {
      if(gewaehltesLand) feld.select();
    });
    // Verlaesst man das Feld ohne neue Auswahl, steht wieder der gewaehlte
    // Name darin. Das Feld ist eine Suche, keine freie Eingabe.
    feld.addEventListener("blur", () => {
      setTimeout(() => {
        if(document.activeElement === feld) return;
        listeSchliessen();
        feld.value = gewaehltesLand ? anzeigeName(gewaehltesLand) : "";
      }, 120);
    });
  }

  if(box && !box.dataset.issLaeuft){
    box.dataset.issLaeuft = "1";
    // pointerdown statt click: das laeuft vor dem blur des Feldes, sonst
    // waere die Liste beim Antippen schon eingeklappt. Bewusst KEIN
    // preventDefault: so darf das Feld von selbst den Fokus verlieren, was
    // iOS als Signal zum Einklappen der Tastatur nimmt.
    box.addEventListener("pointerdown", (e) => {
      const item = e.target.closest(".iss-item");
      if(!item) return;
      const land = laender?.find(l => l.name === item.dataset.name);
      if(land) waehlen(land);
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
  auswahlZeichnen();
  ergebnisZeichnen();
  kreuzZeichnen();
}
