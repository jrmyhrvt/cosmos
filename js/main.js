import { EVENTS, fetchSpaceCalendarFeed, lastSyncAt, loadEventCache, updateSyncInfo } from "./api.js";
import { addEventToCalendar, changeOffset, closeDetail, eventState, openDetail, renderAll, renderEvents, renderHistory, resetDetail, sortEventsAutomatically, tickCountdowns, tzOffsetHours } from "./events/eventManager.js";
import { GLOSTAR_DATA, jumpToGloStar, openGloStarDetail, renderGloStar } from "./glostar/glostar.js";
import { berechneSternwort } from "./home/starWord.js";
import { pruneGlobes } from "./iss/issManager.js";
import { issPassSprache } from "./iss/issPassView.js";
import { TRANSLATIONS } from "./translations.js";
export let currentLang = 'de';
export function setLanguage(lang) {
  currentLang = lang;
  // Sprachattribut mitfuehren: davon haengt die richtige Silbentrennung ab
  // (lange Komposita im Glossar brechen sonst in der falschen Sprache).
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach(btn => {
    if(btn.dataset.lang === lang) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if(TRANSLATIONS[lang][key]) {
      el.innerHTML = TRANSLATIONS[lang][key];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if(TRANSLATIONS[lang][key]) {
      el.placeholder = TRANSLATIONS[lang][key];
    }
  });

  renderAll();
  // Die Detailseite der ISS wird bei setLanguage nicht neu aufgebaut, das
  // Laenderergebnis darunter aber schon - sonst bliebe der Landesname in der
  // alten Sprache stehen.
  issPassSprache();
  renderGloStar(document.getElementById('searchGloStar').value);
  updateSyncInfo();

  document.querySelectorAll('.detail-page.active').forEach(d => {
    const prefix = d.id.replace('-detail','');
    if(d.dataset.openId){
      if(prefix === 'glostar') openGloStarDetail(GLOSTAR_DATA.findIndex(g => g.id === d.dataset.openId));
      else openDetail(d.dataset.openId, prefix);
    }
  });
}
export const STERN_FARBEN = [
  {rgb:"255,255,255", w:68},   // weiss, der Grossteil
  {rgb:"214,232,255", w:17},   // blaeulich, heisse Riesen
  {rgb:"255,241,216", w:11},   // gelblich
  {rgb:"255,214,186", w:4}     // orange, seltene Rote Riesen
];

// Ein Sternbild wird einmal gezeichnet und danach nur noch als Bild
// eingesetzt. Ein Verlauf je Stern und Bild wuerde die Bildrate ruinieren.
export const sternBilder = new Map();
export function sternBild(farbe, strahlen){
  const schluessel = farbe + (strahlen ? ":s" : "");
  if(sternBilder.has(schluessel)) return sternBilder.get(schluessel);
  const S = 64, m = S / 2;
  const bild = document.createElement("canvas");
  bild.width = bild.height = S;
  const x = bild.getContext("2d");
  const schein = x.createRadialGradient(m, m, 0, m, m, m);
  schein.addColorStop(0,    `rgba(${farbe},1)`);
  schein.addColorStop(0.1,  `rgba(${farbe},${strahlen ? 0.9 : 0.62})`);
  schein.addColorStop(0.3,  `rgba(${farbe},0.14)`);
  schein.addColorStop(1,    `rgba(${farbe},0)`);
  x.fillStyle = schein;
  x.beginPath();
  x.arc(m, m, m, 0, Math.PI * 2);
  x.fill();
  if(strahlen){
    // Vier Lichtstrahlen, wie sie eine Linse oder die Luft erzeugt. Den
    // Farbverlauf erst NACH dem Verschieben anlegen und in lokalen
    // Koordinaten: Verlaeufe werden beim Zeichnen von der aktuellen
    // Transformation miterfasst. Ein vorher angelegter Verlauf rutscht dadurch
    // um die halbe Bildbreite und die Strahlen leuchteten nach rechts und
    // unten staerker als nach links und oben. In lokalen Koordinaten sitzt die
    // helle Mitte in jeder der beiden Achsen genau auf dem Stern.
    for(let i = 0; i < 2; i++){
      x.save();
      x.translate(m, m);
      x.rotate(i * Math.PI / 2);
      const kante = x.createLinearGradient(-m, 0, m, 0);
      kante.addColorStop(0,   "rgba(255,255,255,0)");
      kante.addColorStop(0.5, "rgba(255,255,255,.85)");
      kante.addColorStop(1,   "rgba(255,255,255,0)");
      x.fillStyle = kante;
      x.beginPath();
      x.moveTo(-m, 0); x.lineTo(0, -2.6); x.lineTo(m, 0); x.lineTo(0, 2.6);
      x.closePath();
      x.fill();
      x.restore();
    }
  }
  sternBilder.set(schluessel, bild);
  return bild;
}

export function sternFarbe(){
  let r = Math.random() * 100;
  for(const f of STERN_FARBEN){ if((r -= f.w) <= 0) return f.rgb; }
  return STERN_FARBEN[0].rgb;
}

// Schicht 0: weiter weg, ein einzelner Punkt. Schicht 1: mittel, kleiner
// Halo. Schicht 2: nahe, mit duennen Lichtstrahlen. Die Verteilung ist stark
// auf kleine Sterne gewichtet - ein Himmel aus lauter dicken Lichtern sieht
// aus wie eine Lichterkette und nicht wie der Weltraum.
export function neuerStern(farbe, schicht, tiefe, x, y){
  const w = Math.random();
  const s = {
    x: x !== undefined ? x : Math.random() * sternB,
    y: y !== undefined ? y : Math.random() * sternH,
    tiefe,
    ph: Math.random() * Math.PI * 2,
    rate: 0.35 + Math.random() * 1.5,          // Funkeln
    blink: 0.05 + Math.random() * 0.13,
    geschwindigkeit: 0.015 + tiefe * 0.16,    // Naeher treibt schneller
    bild: null, halbeGroesse: 0
  };
  if(schicht === 0){
    s.size = 0.35 + w * 0.7;
    s.alpha = 0.08 + w * 0.34;
  } else if(schicht === 1){
    s.size = 0.7 + w * 0.5;
    s.alpha = 0.3 + w * 0.28;
    s.bild = sternBild(farbe, false);
    s.halbeGroesse = s.size * 1.9;
  } else {
    s.size = 1.2 + w * 0.7;
    s.alpha = 0.55 + w * 0.3;
    s.bild = sternBild(farbe, true);
    s.halbeGroesse = s.size * 4.2;
  }
  return s;
}

// Dichte an die Bildflaeche binden: ein grosser Bildschirm soll mehr Sterne
// bekommen, nicht dieselben paar hundert wie ein Telefon.
export function sternZielzahl(flaeche){
  return Math.max(700, Math.min(4600, Math.round(flaeche / 400)));
}

export function sternFuellen(b, h){
  const ziel = sternZielzahl(b * h);
  const w = Math.random();
  const schicht = w < 0.92 ? 0 : (w < 0.98 ? 1 : 2);
  const tiefe = schicht === 0 ? 0.1 + Math.random() * 0.22
              : schicht === 1 ? 0.42 + Math.random() * 0.38
              : 0.95 + Math.random() * 0.4;
  return neuerStern(sternFarbe(), schicht, tiefe);
}

export const starCanvas = document.getElementById('stars');
export const starCtx = starCanvas.getContext('2d');
export let sterne = [];
// Eigener, zusaetzlicher Sternvorrat nur fuer das Wort "COSMOS". Die normalen
// Hintergrundsterne bleiben davon unberuehrt, damit der Sternenhimmel in allen
// Ansichten gleich schoen und gleichmaessig bleibt.
export let wortSterne = [];
export let sternB = 0, sternH = 0, sternDpr = 1;
export let pointerX = window.innerWidth / 2;
export let pointerY = window.innerHeight / 2;
export let parallaxX = 0;
export let parallaxY = 0;

// Wie weit der Hintergrund dem Cursor folgt. Vorher 0,04 - damit wanderte der
// naechste Stern nur 28 Pixel. Der Wert ist mit der Bildbreite gekoppelt, damit
// ein grosser Monitor genauso stark reagiert wie ein kleiner, und die Schichten
// spreizen weit auseinander: der ferne Hintergrund bleibt fast stehen, der
// nahe Schwebt deutlich mit.
export const STERN_PARALLAX = 0.15;

export function resizeStars(){
  const b = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if(b === sternB && h === sternH && dpr === sternDpr) return;
  if(sternB > 0 && b > 0 && h > 0){
    // Bestehende Sterne proportional verschieben, statt neu zu wuerfeln,
    // und die Zahl an die neue Flaeche anpassen.
    const fx = b / sternB, fy = h / sternH;
    for(const s of sterne){ s.x = (s.x * fx) % b; s.y = (s.y * fy) % h; }
    for(const s of wortSterne){ s.x = (s.x * fx) % b; s.y = (s.y * fy) % h; }
  }
  sternB = b; sternH = h; sternDpr = dpr;
  // Auf dem Retina-Display sonst wuerden die Sterne weichgezeichnet.
  starCanvas.width = Math.round(b * dpr);
  starCanvas.height = Math.round(h * dpr);
  starCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ziel = sternZielzahl(b * h);
  while(sterne.length < ziel) sterne.push(sternFuellen(b, h));
  if(sterne.length > ziel) sterne.length = ziel;
}
let formResizeTimer = 0;
window.addEventListener('resize', () => {
  resizeStars();
  if(!sternFormAktiv) return;
  clearTimeout(formResizeTimer);
  formResizeTimer = setTimeout(starteSternFormung, 180);
});
resizeStars();

/* --- Sternenwort: zusaetzliche Sterne formen "COSMOS" --------------------
   Auf dem Startfenster fliegt ein eigener Vorrat zusaetzlicher Sterne zu den
   berechneten Positionen des Wortes, bleibt dort schweben und funkeln. Der
   normale Sternenhimmel bleibt davon unberuehrt und ist in jeder Ansicht
   gleich dicht. In anderen Ansichten loest sich die Formation wieder und die
   Wort-Sterne blenden sanft als normale Sterne zurueck.
   ------------------------------------------------------------------------ */
let sternFormAktiv = false;
let wortMitte = null;       // Zentrum des Wortes (fuer das Wegfliegen)
let wortHalb = null;        // halbe Ausdehnung des Wortes
const WORT_HELL = 2.5;      // Helligkeitsfaktor der Sterne, die das Wort bilden
const WORT_GROESSE = 1.35;  // Groessenfaktor der Sterne, die das Wort bilden
const WORT_LOESE_MS = 650;  // Dauer des Uebergangs zurueck zum Sternenhimmel
// Steilheit der Anflugkurve: erst sanft los, sichtbar beschleunigen und kurz
// vor dem Wort kraeftig abbremsen. 2 = weich, hoeher = staerkerer Effekt.
const WORT_WEG_EXP = 4;
// Anflugkurve fuer jeden Wort-Stern. In der ersten Haelfte nimmt die
// Geschwindigkeit zu (beschleunigen), in der zweiten wieder ab. Wegen des
// hohen Exponenten kriechen die Sterne am Ende nur noch und schweben so ins
// Wort, statt hart anzukommen.
function wortWeg(t){
  if(t < 0.5) return Math.pow(2 * t, WORT_WEG_EXP) / 2;
  return 1 - Math.pow(2 - 2 * t, WORT_WEG_EXP) / 2;
}

function setzeSternForm(aktiv){
  if(aktiv === sternFormAktiv) return;
  if(aktiv) starteSternFormung(); else beendeSternFormung();
}

function starteSternFormung(){
  const platz = document.getElementById("starWord");
  if(!platz) return;
  // Die tatsaechliche Breite des Platzes verwenden (statt window.innerWidth),
  // damit das Wort auf Handy und Mac exakt in den verfuegbaren Raum passt.
  const breite = platz.getBoundingClientRect().width || window.innerWidth;
  // Auf flachen Fenstern bleibt oben/unten Platz fuer Titel und Untertitel
  // sowie fuer die Tableiste, damit das Wort nicht unten abgeschnitten wird.
  const maxHoehe = Math.max(120, window.innerHeight - 320);
  const info = berechneSternwort(breite, maxHoehe);
  platz.style.height = info.hoehe + "px";
  const r = platz.getBoundingClientRect();
  if(!r.width) return;
  const ziele = info.punkte.map(p => ({ x: r.left + p.x, y: r.top + p.y }));

  // Zentrum und Ausdehnung des Wortes merken, damit sich die Sterne beim
  // Verlassen in alle Richtungen vom Wortzentrum wegbewegen.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for(const p of ziele){
    if(p.x < minX) minX = p.x;
    if(p.x > maxX) maxX = p.x;
    if(p.y < minY) minY = p.y;
    if(p.y > maxY) maxY = p.y;
  }
  if(ziele.length){
    wortMitte = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    wortHalb = { w: Math.max(1, (maxX - minX) / 2), h: Math.max(1, (maxY - minY) / 2) };
  }

  // Falls noetig zusaetzliche Wort-Sterne erzeugen. Sie kommen aus einem
  // eigenen Vorrat, damit der Hintergrund nicht geleert wird.
  while(wortSterne.length < ziele.length) wortSterne.push(sternFuellen(sternB, sternH));

  // Alte Zuordnungen loesen und die Sterne neu mischen, damit das Wort bei
  // jedem Aufbau anders aussieht. Die Startpunkte liegen zufaellig ueber den
  // ganzen Bildschirm, damit die Sterne von ueberall hereinfliegen.
  for(const s of wortSterne){ delete s.form; delete s.frei; }
  const kandidaten = wortSterne.slice();
  for(let i = kandidaten.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    const t = kandidaten[i]; kandidaten[i] = kandidaten[j]; kandidaten[j] = t;
  }
  const jetzt = performance.now();
  const n = Math.min(ziele.length, kandidaten.length);
  for(let i = 0; i < n; i++){
    const s = kandidaten[i];
    const sx = Math.random() * sternB;
    const sy = Math.random() * sternH;
    s.form = {
      sx, sy, ex: ziele[i].x, ey: ziele[i].y,
      t0: jetzt + Math.random() * 900,
      dauer: 900 + Math.random() * 1000,
      amp: 0.6 + Math.random() * 1.6,
      rate: 0.5 + Math.random() * 1.2,
      ph: Math.random() * Math.PI * 2
    };
    s.lastX = sx; s.lastY = sy;
  }
  sternFormAktiv = true;
}

function beendeSternFormung(){
  if(!sternFormAktiv) return;
  const jetzt = performance.now();
  const cx = wortMitte ? wortMitte.x : sternB / 2;
  const cy = wortMitte ? wortMitte.y : sternH / 2;
  // Die flache Wortform auf einen Kreis umrechnen, damit die Sterne nicht nur
  // nach oben, sondern in alle Richtungen gleichzeitig wegfliegen.
  const hw = wortHalb ? wortHalb.w : 1;
  const hh = wortHalb ? wortHalb.h : 1;
  for(const s of wortSterne){
    if(!s.form) continue;
    // Jeder Stern fliegt vom Wortzentrum weg nach aussen und blendet dabei aus.
    // So loest sich "COSMOS" beim Ansichtswechsel in alle Richtungen auf, ohne
    // dass der normale Sternenhimmel mit Sternen ueberflutet wird.
    const dx = (s.lastX - cx) / hw, dy = (s.lastY - cy) / hh;
    const winkel = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.7;
    const tempo = 0.2 + Math.random() * 0.5;   // Pixel pro Millisekunde
    s.frei = {
      t0: jetzt,
      dauer: WORT_LOESE_MS * (0.7 + Math.random() * 0.7),
      x0: s.lastX, y0: s.lastY,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo
    };
    delete s.form;
  }
  sternFormAktiv = false;
}

window.addEventListener('mousemove', (e) => {
  pointerX = e.clientX;
  pointerY = e.clientY;
});
window.addEventListener('touchmove', (e) => {
  if(e.touches && e.touches.length > 0){
    pointerX = e.touches[0].clientX;
    pointerY = e.touches[0].clientY;
  }
}, { passive: true });

export function drawStarsFixed(zeit){
  const b = sternB, h = sternH;
  starCtx.clearRect(0, 0, b, h);
  const sekunden = zeit / 1000;

  const targetX = (pointerX - b / 2) * STERN_PARALLAX;
  const targetY = (pointerY - h / 2) * STERN_PARALLAX;
  parallaxX += (targetX - parallaxX) * 0.08;
  parallaxY += (targetY - parallaxY) * 0.08;

  // Normalen Sternenhimmel zeichnen. Dieser Vorrat bleibt immer vollstaendig,
  // egal welche Ansicht gerade aktiv ist.
  const zeichneNormal = (s) => {
    s.y -= s.geschwindigkeit;
    if(s.y < 0) s.y += h;
    // Der Rest wird gekappt, sonst springen die Sterne am Rand, sobald die
    // Parallaxe groesser als die Bildbreite wird.
    const drawX = (((s.x - parallaxX * s.tiefe) % b) + b) % b;
    const drawY = (((s.y - parallaxY * s.tiefe) % h) + h) % h;
    const funkeln = 1 + s.blink * Math.sin(sekunden * s.rate + s.ph);
    starCtx.globalAlpha = Math.max(0, Math.min(1, s.alpha * funkeln));
    if(s.bild){
      const g = s.halbeGroesse;
      starCtx.drawImage(s.bild, drawX - g, drawY - g, g * 2, g * 2);
    } else {
      starCtx.fillStyle = "#fff";
      starCtx.fillRect(drawX, drawY, s.size, s.size);
    }
  };
  for(const s of sterne) zeichneNormal(s);

  // Wort-Sterne danach zeichnen. Sie existieren nur fuer das Wort: auf dem
  // Startfenster bilden sie "COSMOS", ansonsten blenden sie nach dem Wechsel
  // sanft aus. Der normale Sternenhimmel bleibt davon unberuehrt.
  for(const s of wortSterne){
    if(sternFormAktiv && s.form){
      const f = s.form;
      const roh = (zeit - f.t0) / f.dauer;
      const t = roh <= 0 ? 0 : roh >= 1 ? 1 : roh;
      const e = wortWeg(t);                     // beschleunigen, dann weich abbremsen
      let x = f.sx + (f.ex - f.sx) * e;
      let y = f.sy + (f.ey - f.sy) * e;
      // Kurz vor dem Wort setzt ein sanftes Schweben ein, das in die dauerhafte
      // Bewegung uebergeht. So gleiten die Sterne in die Buchstaben, statt hart
      // anzukommen.
      const schwebeRoh = (t - 0.6) / 0.4;
      const schwebe = schwebeRoh <= 0 ? 0 : schwebeRoh >= 1 ? 1 : schwebeRoh * schwebeRoh * (3 - 2 * schwebeRoh);
      x += Math.sin(sekunden * f.rate + f.ph) * f.amp * schwebe;
      y += Math.cos(sekunden * f.rate * 0.85 + f.ph) * f.amp * schwebe;
      s.lastX = x; s.lastY = y;
      const funkeln = 1 + s.blink * Math.sin(sekunden * s.rate + s.ph);
      starCtx.globalAlpha = Math.max(0, Math.min(1, s.alpha * funkeln * WORT_HELL));
      if(s.bild){
        const g = s.halbeGroesse * WORT_GROESSE;
        starCtx.drawImage(s.bild, x - g, y - g, g * 2, g * 2);
      } else {
        starCtx.fillStyle = "#fff";
        starCtx.fillRect(x, y, s.size * WORT_GROESSE, s.size * WORT_GROESSE);
      }
      continue;
    }
    if(s.frei){
      const dt = zeit - s.frei.t0;
      const p = Math.min(1, dt / s.frei.dauer);
      if(p >= 1){
        delete s.frei;
        continue;
      }
      // Nach aussen wegfliegen und dabei weich ausblenden.
      const x = s.frei.x0 + s.frei.vx * dt;
      const y = s.frei.y0 + s.frei.vy * dt;
      const funkeln = 1 + s.blink * Math.sin(sekunden * s.rate + s.ph);
      const groesse = 1 + (WORT_GROESSE - 1) * (1 - p);
      starCtx.globalAlpha = Math.max(0, Math.min(1, s.alpha * funkeln * WORT_HELL * (1 - p)));
      if(s.bild){
        const g = s.halbeGroesse * groesse;
        starCtx.drawImage(s.bild, x - g, y - g, g * 2, g * 2);
      } else {
        starCtx.fillStyle = "#fff";
        starCtx.fillRect(x, y, s.size * groesse, s.size * groesse);
      }
    }
  }
  starCtx.globalAlpha = 1;
  requestAnimationFrame(drawStarsFixed);
}
requestAnimationFrame(drawStarsFixed);

export function switchView(target){
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tab = document.querySelector(`.tab[data-tab="${target}"]`);
  if(tab) tab.classList.add("active");
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const view = document.getElementById(target);
  if(view) view.classList.add("active");
  // Ein erneuter Tippen auf denselben Tab schliesst die Detailseite und
  // zeigt wieder die Grunduebersicht - genau wie der Zurueck-Knopf.
  resetDetail(target);
  pruneGlobes();
  renderAll();
  // Die Alphabet-Leiste liegt in <main> und gehoert nur zur GloStar-Ansicht.
  const scrubber = document.getElementById("glostarScrubber");
  if(scrubber) scrubber.classList.toggle("aus", target !== "glostar");
  // Das Sternen-Wort bildet sich nur auf dem Startfenster.
  setzeSternForm(target === "home");
  return view;
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchView(tab.dataset.tab));
});

document.getElementById('brandBtn').addEventListener('click', () => {
  switchView("home");
});

document.getElementById('searchEvents').addEventListener('input', e => renderEvents(e.target.value));
document.getElementById('searchHistory').addEventListener('input', e => renderHistory(e.target.value));
const gloSucheFeld = document.getElementById('searchGloStar');
const gloSucheLoeschen = document.getElementById('clearGloStar');
function aktualisiereGloStarLoeschen(){
  gloSucheLoeschen.classList.toggle('sichtbar', gloSucheFeld.value.length > 0);
}
gloSucheFeld.addEventListener('input', e => {
  renderGloStar(e.target.value);
  aktualisiereGloStarLoeschen();
});
gloSucheLoeschen.addEventListener('click', () => {
  gloSucheFeld.value = '';
  renderGloStar('');
  aktualisiereGloStarLoeschen();
  gloSucheFeld.focus();
});
aktualisiereGloStarLoeschen();

loadEventCache();
sortEventsAutomatically();
renderAll();
renderGloStar();
setzeSternForm(true);
fetchSpaceCalendarFeed();

/* --- Automatische Aktualisierung -----------------------------------------
   Kein Neuaufbau des HTML jede Sekunde: die Listen werden nur neu gezeichnet,
   wenn sich wirklich etwas aendert. Der Countdown laeuft sekundengenau
   direkt in den bestehenden Karten.
   -------------------------------------------------------------------------- */
export function viewSignature(){
  const now = Date.now();
  return [
    currentLang,
    tzOffsetHours,
    EVENTS.length,
    document.getElementById("searchEvents")?.value || "",
    document.getElementById("searchHistory")?.value || "",
    EVENTS.map(event => `${event.id}:${eventState(event, now)}`).join("|")
  ].join("~");
}

export let lastSignature = viewSignature();

setInterval(() => {
  if(document.hidden) return;
  tickCountdowns();
  const signature = viewSignature();
  if(signature !== lastSignature){
    lastSignature = signature;
    renderAll();
  }
}, 1000);

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const SYNC_STALE_MS = 10 * 60 * 1000;

// Regelmaessig nachladen, aber nur wenn COSMOS wirklich sichtbar ist.
setInterval(() => {
  if(!document.hidden) fetchSpaceCalendarFeed();
}, SYNC_INTERVAL_MS);

// Beim Zurueckkommen nur aktualisieren, wenn die Daten veraltet sind.
document.addEventListener("visibilitychange", () => {
  if(document.hidden) return;
  if(!lastSyncAt || Date.now() - lastSyncAt > SYNC_STALE_MS) fetchSpaceCalendarFeed();
});

/* --- onclick-Handler ------------------------------------------------------
   Bei <script type="module"> gibt es keinen globalen Scope mehr. Die
   Buttons im HTML rufen diese Funktionen aber per onclick="..." auf, also
   haengen wir sie bewusst wieder ans Fenster.
   -------------------------------------------------------------------------- */
// Nur was die HTML-Buttons mit onclick brauchen. Der Rest bleibt im Modul,
// damit keine zwei Module dieselbe globale Funktion doppelt vergeben.
Object.assign(window, {
  setLanguage, changeOffset, openDetail, closeDetail,
  openGloStarDetail, jumpToGloStar, addEventToCalendar
});
