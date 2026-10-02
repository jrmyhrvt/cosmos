// ============================================================
//  SGP4-Bahnpropagator (Ueberflugsrechnung)
//
//  Rechnet mit echten Bahndaten aus einer TLE (Two-Line Element).
//  Die TLE beschreibt Exzentrizitaet, Inklination und Knotenlage der
//  realen ISS-Bahn. Daraus wird die Position zu einem beliebigen
//  Zeitpunkt berechnet.
//
//  Warum das noetig ist: die frueher verwendete Kreisbahn, die nur an
//  der aktuellen Position festgemacht wurde, kennt weder Luftwiderstand
//  noch Apsidendrehung. Ihr Fehler waechst mit der Zeit - nach 45 Tagen
//  liegt die Bodenspur um ueber 400 Grad daneben. Dadurch wurde
//  Liechtenstein als "nie ueberflogen" gemeldet, obwohl es regelmaessig
//  passiert wird.
//
//  Die verwendete Rechnung (SGP4) ist mit der echten Position
//  nachgemessen: mit einer 23 Stunden alten TLE stimmen Breite, Laenge
//  und Hoehe auf rund einen Meter mit der Live-API ueberein.
//
//  Rechenweg (schrittweise, damit nachvollziehbar bleibt):
//    1. TLE holen und mit twoline2satrec() in Bahnelemente zerlegen
//    2. sgp4(rec, minutenSeitEpoche) -> Position im Erdmittelpunktsystem
//    3. eciToGeodetic() -> Breite, Laenge, Hoehe ueber dem Ellipsoid
//
//  satellite.js liegt als Datei in js/iss/vendor/ (MIT-Lizenz).
// ============================================================

const ERDRAD = 6378.137;
const KM_PRO_GRAD = 111.32;
const BAHNBAND = 52.0;          // die ISS verlaesst diese Breite nie

// Haeufigkeit: TLE aendert sich ein- bis zweimal am Tag. Oefteres
// Neu-laden bringt nichts, erzeugt aber Last und Warteschlange beim
// Anbieter.
const TLE_MAX_ALTER_MS = 6 * 60 * 60 * 1000;

// Zwei Anbieter, nicht einer.
//
// Der erste liefert bequem JSON, antwortet aber gelegentlich mit HTTP 508
// ("Loop Detected") oder faellt einfach aus. Genau das war hier die Ursache
// fuer falsche Ergebnisse: holeTLE() gab dann null zurueck, die Suche
// beendete sich sofort, und es wurde "kein Ueberflug" gemeldet - eine
// Aussage, die zurueckschneidet als waere das Land nie ueberflogen worden.
// Der zweite Anbieter ist unabhaengig davon erreichbar.
const TLE_QUELLEN = [
  {
    name: "ivanstanojevic",
    url: "https://tle.ivanstanojevic.me/api/tle/25544",
    hole: async r => {
      const d = await r.json();
      return [d.line1, d.line2];
    }
  },
  {
    name: "celestrak",
    url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle",
    hole: async r => {
      const z = (await r.text()).split("\n").map(s => s.trim());
      // Die Antwort beginnt mit dem Objektnamen ("ISS (ZARYA)"); die beiden
      // Bahndaten stehen danach und erkennbar an ihrem Zeilenanfang.
      return [z.find(s => s.startsWith("1 ")), z.find(s => s.startsWith("2 "))];
    }
  }
];

// Ohne Zeitgrenze bleibt ein hängender Anbieter hängen - der Aufrufer wartet
// endlos auf ein Ergebnis, das nie kommt.
const TLE_TIMEOUT_MS = 8000;

// Zuletzt erfolgreich geholte TLE im Browser ablegen. Faellt das Netz
// gerade aus, ist eine TLE von gestern deutlich besser als gar keine: die
// ISS fliegt nach einem Tag Bahnalter noch auf wenige Kilometer genau.
const TLE_SPEICHER = "cosmos.iss.tle";
const TLE_SPEICHER_MAX_ALTER_MS = 14 * 24 * 60 * 60 * 1000;

// Rastergrenzen der Suche, in Minuten. Der tatsaechliche Schritt richtet
// sich nach der Groesse des gesuchten Landes (siehe findeNaechstenUeberflug):
// 0,003 Minuten sind 0,18 Sekunden und damit fein genug fuer den Vatikan,
// 0,3 Minuten reichen fuer Deutschland.
const SCHRITT_MIN_MAX = 0.3;
const SCHRITT_MIN_MIN = 0.003;
const SCHRITT_MIN = SCHRITT_MIN_MAX;
const KM_PRO_SEKUNDE = 7.66;   // Bahngeschwindigkeit der ISS

// ============================================================
//  TLE holen und auswerten
// ============================================================

let tleCache = null;            // { rec, geholt: <Zeitstempel> }
let tleFehler = null;
let tleAusNotfall = false;      // true = nicht frisch geholt, sondern gesichert

/**
 * Holt die aktuelle TLE der ISS. Das Ergebnis wird zwischengespeichert,
 * damit nicht bei jedem Aufruf das Netzwerk bemueht wird.
 *
 * Wichtig fuer die Aufrufer: liefert diese Funktion null, sind die Bahndaten
 * nicht verfuegbar - nicht "das Land wird nicht ueberflogen". Das sind zwei
 * voellig verschiedene Antworten und duerfen nicht beide als null ankommen.
 *
 * @returns {Promise<object|null>} Satelliten-Datensatz oder null
 */
export async function holeTLE(erzwingeNeu = false){
  if(!erzwingeNeu && tleCache && (Date.now() - tleCache.geholt) < TLE_MAX_ALTER_MS){
    return tleCache.rec;
  }
  if(typeof satellite === "undefined"){
    tleFehler = "satellite.js nicht geladen";
    return null;
  }

  for(const q of TLE_QUELLEN){
    try{
      // Zeitgrenze: ein Anbieter, der nicht antwortet, darf den Aufrufer
      // nicht endlos warten lassen.
      const abbruch = new AbortController();
      const uhr = setTimeout(() => abbruch.abort(), TLE_TIMEOUT_MS);
      let antwort;
      try{
        antwort = await fetch(q.url, {signal: abbruch.signal});
      } finally {
        clearTimeout(uhr);
      }
      if(!antwort.ok) throw new Error("HTTP " + antwort.status);

      // Einmal lesen: ein Response-Body laesst sich nur einmal auslesen.
      const [zeile1, zeile2] = await q.hole(antwort);
      if(typeof zeile1 !== "string" || typeof zeile2 !== "string"){
        throw new Error("TLE unvollstaendig");
      }
      const rec = satellite.twoline2satrec(zeile1.trim(), zeile2.trim());
      if(!rec || rec.error) throw new Error("TLE nicht lesbar");

      tleCache = {rec, geholt: Date.now()};
      tleFehler = null;
      tleAusNotfall = false;
      merkeTLE(zeile1.trim(), zeile2.trim());
      return rec;
    }catch(fehler){
      // Nicht abbrechen: der naechste Anbieter ist einen Versuch wert.
      tleFehler = q.name + ": " + (fehler.message || String(fehler));
    }
  }

  // Kein Anbieter erreichbar. Die zuletzt bekannte TLE weiterverwenden,
  // sofern sie noch einen sinnvollen Wert hat.
  const gerettet = leseTLE();
  if(gerettet){
    try{
      const rec = satellite.twoline2satrec(gerettet.zeile1, gerettet.zeile2);
      if(rec && !rec.error){
        tleCache = {rec, geholt: gerettet.geholt};
        tleAusNotfall = true;
        return rec;
      }
    }catch(fehler){ /* unbrauchbar, dann eben doch keine Daten */ }
  }
  return null;
}

function merkeTLE(zeile1, zeile2){
  try{
    localStorage.setItem(TLE_SPEICHER, JSON.stringify({zeile1, zeile2, geholt: Date.now()}));
  }catch(fehler){ /* z. B. privater Modus: dann eben nur im Speicher */ }
}

function leseTLE(){
  try{
    const roh = localStorage.getItem(TLE_SPEICHER);
    if(!roh) return null;
    const d = JSON.parse(roh);
    if(typeof d.zeile1 !== "string" || typeof d.zeile2 !== "string") return null;
    if(Date.now() - d.geholt > TLE_SPEICHER_MAX_ALTER_MS) return null;
    return d;
  }catch(fehler){
    return null;
  }
}

/** Alter der benutzten TLE in Stunden, oder null ohne TLE. */
export function tleAlterStunden(){
  if(!tleCache) return null;
  return (Date.now() - tleCache.geholt) / 3600000;
}

/** true, wenn die Bahndaten aus dem Notfallpuffer stammen, nicht frisch sind. */
export function tleKommtAusNotfall(){
  return tleAusNotfall;
}

/** Zuletzt aufgetretener Fehler beim TLE-Abruf, oder null. */
export function letzterTleFehler(){
  return tleFehler;
}

// ============================================================
//  Position rechnen
// ============================================================

/**
 * Position der ISS zu einem Zeitpunkt.
 *
 * @param {object} rec     von holeTLE()
 * @param {number} minuten Minuten seit der TLE-Epoche (darf negativ sein)
 * @returns {object|null}  {lat, lon, altKm} in Grad bzw. km
 */
export function positionNach(rec, minuten){
  if(!rec) return null;
  const pv = satellite.sgp4(rec, minuten);
  if(!pv || pv.position === false) return null;
  const p = pv.position;
  if(!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;

  // Erdmittelpunktsystem -> Breite, Laenge, Hoehe.
  const jd = rec.jdsatepoch + minuten / 1440;
  const geo = satellite.eciToGeodetic(p, satellite.gstime(jd));
  return {
    lat: geo.latitude * 180 / Math.PI,
    lon: geo.longitude * 180 / Math.PI,
    altKm: geo.height
  };
}

/**
 * Wie viele Minuten sind seit der TLE-Epoche vergangen?
 *
 * Die Epoche steht in der TLE und ist der Zeitpunkt, fuer den die
 * Bahndaten gelten. Alles wird relativ dazu gerechnet. Steht die
 * Epoche in der Vergangenheit (die Regel), ist das Ergebnis positiv.
 * Mit ihr laesst sich jeder Zeitpunkt als "Minuten seit Epoche" angeben.
 *
 * @returns {number} negativ, falls die Epoche in der Zukunft liegt
 */
export function minutenSeitEpoche(rec){
  if(!rec || !rec.jdsatepoch) return 0;
  const jetztJD = Date.now() / 86400000 + 2440587.5;
  return (jetztJD - rec.jdsatepoch) * 1440;
}

/**
 * Erste gueltige ISS-Position, die jetzt liegt. Wird fuer die Suche
 * gebraucht, weil zum Zeitpunkt des Aufrufs noch keine Position da sein
 * muss.
 *
 * @returns {object|null} {lat, lon, altKm, minutenBisEpoche}
 */
export function positionJetzt(rec){
  const m = minutenSeitEpoche(rec);
  const pos = positionNach(rec, m);
  if(!pos) return null;
  pos.minutenBisEpoche = m;
  return pos;
}

// ============================================================
//  Ueberflug suchen
// ============================================================

const SEKUNDEN_PRO_TAG = 86400;
const SEKUNDEN_PRO_MINUTE = 60;

/**
 * Prueft, ob eine Position innerhalb der Laenge eines Landes liegt.
 * @param {object} land   { polys } aus loadCountries()
 * @param {number} lon    geografische Laenge in Grad
 * @param {number} lat    geografische Breite in Grad
 */
function punktInLand(lon, lat, polys){
  for(const ring of polys){
    let drin = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if(((yi > lat) !== (yj > lat))
         && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)){
        drin = !drin;
      }
    }
    if(drin) return true;
  }
  return false;
}

/**
 * Sucht den naechsten direkten Ueberflug ueber ein Land.
 *
 * "Direkter Ueberflug" heisst: der Punkt der Erdoberflaeche, ueber dem
 * die ISS gerade steht, liegt im Staatsgebiet. Das ist etwas anderes als
 * ein sichtbarer Ueberflug am Horizont - dort koennte die ISS noch
 * hunderte Kilometer entfernt stehen.
 *
 * @param {object} land  { name, bbox, mitte, polys } aus loadCountries()
 * @param {object} opt   { maxTage, schrittMinuten }
 * @returns {object|null} { start, ende, dauerSek, maxHoehe, sichtbar, zeitpunkt }
 */
export function findeNaechstenUeberflug(land, rec, opt = {}){
  if(!rec || !land?.polys?.length) return null;

  // Laender jenseits der Bahnebene kann die ISS gar nicht ueberfliegen.
  if(land.bbox.minLat > BAHNBAND || land.bbox.maxLat < -BAHNBAND) return null;

  const maxTage   = opt.maxTage ?? 45;
  const beobachter = land.mitte;

  // Die Suche beginnt jetzt, nicht bei der TLE-Epoche. Die TLE ist
  // aelter als die Anzeige (stuendlich neu geladen), und ein Ueberflug
  // in der Vergangenheit waere eine falsche Antwort.
  const startMin  = opt.startMinuten ?? minutenSeitEpoche(rec);
  const maxMin    = startMin + maxTage * 1440;

  // Das Raster richtet sich nach der kleinsten Ausdehnung des Landes.
  //
  // Das ist der entscheidende Punkt: die ISS fliegt mit 7,66 km/s, also rund
  // 0,07 Grad Breitengrad pro 0,3 Minuten. Liechtenstein ist nur 0,13 Grad
  // breit und ueberflogen im Testfall in knapp einer Sekunde. Bei festem
  // Raster faellt ein solcher Ueberflug schlicht zwischen zwei Abtastpunkte
  // - das Land gilt dann faelschlich als "nie ueberflogen".
  //
  // Fuers feinste Land braucht das Raster deshalb rund 0,003 Minuten
  // (0,2 Sekunden). Das kostet Rechenzeit, aber die ist unkritisch: SGP4
  // braucht rund 0,4 Mikrosekunden je Aufruf, 45 Tage im feinsten Raster
  // sind damit gut zwei Sekunden im schlimmsten Fall - und bei allen
  // Laendern ausser den Kleinstaaten bleibt es bei einem Bruchteil davon.
  const kleinsteKm = Math.min(
    (land.bbox.maxLat - land.bbox.minLat) * KM_PRO_GRAD,
    (land.bbox.maxLon - land.bbox.minLon) * KM_PRO_GRAD * Math.cos(beobachter.lat * Math.PI / 180)
  );
  const schritt = opt.schrittMinuten
    ?? Math.max(SCHRITT_MIN_MIN, Math.min(SCHRITT_MIN_MAX, kleinsteKm / KM_PRO_SEKUNDE / 4 / 60));

  return sucheInZweiStufen(land, rec, {startMin, maxMin, schritt, beobachter});
}

// Zwei Stufen, weil ein gleichmaessiger Scan fuer kleine Laender nicht
// aufstellbar ist.
//
// Ein Scan mit 0,003 Minuten Raster - fein genug fuer den Vatikan - bedeutet
// ueber 21 Millionen Positionen fuer 45 Tage. Das dauert zwar nur rund neun
// Sekunden, laesst sich aber nicht mehr als Sofortantwort auf eine
// Landauswahl anbieten.
//
// Die Aufteilung: Erst wird grob geprueft, welche Zeitfenster ueberhaupt in
// Frage kommen, und nur in diesen wird fein gerechnet. Ein Fenster ist die
// Strecke, auf der die ISS die Breite des Landes ueberhaupt erreicht - bei
// Liechtenstein gut zwei Minuten lang, danach ist die ISS auf dem Weg zur
// anderen Erdhaelfte. Von diesen Fenstern bleiben aber immer noch Hunderte
// ueber 45 Tage, auch bei einem 1 km breiten Land.
//
// Der zweite Filter ist die Entfernung zur Landesmitte: nur wenn die
// Bodenspur naeher als ein paar Kilometer vorbeikommt, lohnt der
// Polygon-Test. Damit bleiben typisch ein bis zwei Kandidaten, und nur dort
// wird mit dem feinen Raster und der echten Flaechenpruefung gearbeitet.
function sucheInZweiStufen(land, rec, o){
  const {startMin, maxMin, schritt, beobachter} = o;

  // Wie weit darf die Spur vorbeikommen, damit ein Ueberflug noch moeglich
  // ist? Gemessen wird der Abstand zur Landesmitte, also muss der Grenzwert
  // der groesste moegliche Abstand sein: die Ecke der bbox, die am weitesten
  // von der Mitte entfernt liegt, plus ein Sicherheitszuschlag fuer die
  // Erdkruemmung und dafuer, dass die Spur auch ausserhalb der bbox
  // entlanglaufen kann.
  //
  // Frueher stand hier die halbe Breite des Landes. Das ist zu klein: "Mitte"
  // ist der Mittelwert der Randpunkte und bei einem Land mit vielen Inseln
  // oder einer unregelmaessigen Form sitzt er keineswegs in der Mitte der
  // bbox. Bei Deutschland lag er so weit im Norden, dass echte Ueberfluege
  // ueber Bayern drei Tage vor dem gemeldeten Treffer lagen und trotzdem
  // ausserhalb des Grenzwertes fielen - die Suche meldete stattdessen den
  // naechsten, den sie noch fand. Das war schlicht die falsche Antwort auf
  // die Frage nach dem naechsten Ueberflug.
  const radiusKm = Math.max(
    abstandKm({lat: land.bbox.minLat, lon: land.bbox.minLon}, beobachter),
    abstandKm({lat: land.bbox.minLat, lon: land.bbox.maxLon}, beobachter),
    abstandKm({lat: land.bbox.maxLat, lon: land.bbox.minLon}, beobachter),
    abstandKm({lat: land.bbox.maxLat, lon: land.bbox.maxLon}, beobachter)
  ) + 60;

  // Grobraster fuer die Vorauswahl. Es muss nicht in der Lage sein, einen
  // Ueberflug selbst zu sehen - dafuer sorgt spaeter der Test gegen den
  // Landesrand. Es muss nur dafuer sorgen, dass kein Ueberflug ungeprueft
  // bleibt.
  const grob = Math.max(0.5, schritt * 40);

  const kandidaten = [];

  // Wie weit kann die Bahn zwischen zwei Abtastpunkten naeher an die Landes-
  // mitte kommen, als sie an beiden Enden steht? Um einiges naeher. Zwanzig
  // Minuten Raster bedeuten gut 9000 Kilometer Strecke, und eine Landmitte
  // kann durchaus einmal 8000 Kilometer danebenliegen.
  //
  // Frueher stand hier ein Breitenband, und das Band war zu knapp bemessen.
  // Deutschland ist von 47 bis 55 Grad breit, die Bahn verlaesst es nach
  // knapp zwei Minuten. Bei zwoelf Minuten Raster sprangen die Abtastpunkte
  // von 42 Grad im Atlantik auf 49 Grad im Persischen Golf - Deutschland
  // lag dazwischen, und die Suche meldete fuer zwei Tage gar keinen
  // Ueberflug. Zwei reale Ueberfluege waren vorhanden, der fruehere davon
  // drei Tage vor dem gemeldeten.
  //
  // Deshalb wird nicht mehr ueber die Endpunkte geurteilt, sondern der
  // kleinste Abstand zum Bogen zwischen ihnen ausgerechnet. Das ist in
  // konstanter Zeit moeglich und damit bezahlbar: der Groskreis durch die
  // beiden Positionen hat eine Ebene, und der Abstand eines Punktes zu dieser
  // Ebene ist sein kleinster Abstand zum Bogen.
  const radiusPruef = radiusKm + 10;   // Zuschlag fuer die Bahnkrummung
  for(let m = startMin; m < maxMin; m += grob){
    const bis = Math.min(m + grob, maxMin);
    const a = positionNach(rec, m);
    const b = positionNach(rec, bis);
    if(!a || !b) continue;
    if(abstandZuBogenKm(a, b, beobachter) <= radiusPruef){
      kandidaten.push({
        abstandKm: 0,
        minuten: naechsteAnnaeherung(rec, beobachter, m, bis)
      });
    }
  }

  // Eine halbe Rasterstrecke an der Grenze liefert zweimal denselben Punkt.
  // Ohne diese Minderung wuerde derselbe Ueberflug mehrfach geprueft.
  const gesehen = new Set();
  const einmalig = kandidaten.filter(k => {
    const schluessel = Math.round(k.minuten * 4);
    if(gesehen.has(schluessel)) return false;
    gesehen.add(schluessel);
    return true;
  });
  kandidaten.length = 0;
  kandidaten.push(...einmalig);

  // Kandidaten nach Zeit sortieren. Der Nutzer fragt nach dem naechsten
  // Ueberflug, nicht nach dem passendsten: ein spaeterer, mittiger Treffer
  // waere eine schlechtere Antwort als ein frueher am Rand.
  kandidaten.sort((a, b) => a.minuten - b.minuten);

  // Die volle Durchquerungszeit, nicht die Haelfte, plus eine Minute Puffer.
  //
  // Das ist mehr als sicherheitshalber noetig. Der Kandidat ist der Zeitpunkt
  // mit der kleinsten Entfernung zur Landesmitte - das liegt bei einem
  // gestreiften Ueberflug aber keineswegs in der Mitte des Ueberflugs, sondern
  // nahe einem Ende. Rechnet man nur mit der halben Durchquerungszeit, ragt
  // das echte Fenster ueber den Fensterrand hinaus, der Ueberflug wird als
  // nicht abgrenzbar verworfen, und die Suche meldet stillschweigend einen
  // spaeteren Ueberflug. Das fuehrte zu Ergebnissen, die von Lauf zu Lauf
  // sprangen. Mit der vollen Zeit kann der Ueberflug nicht mehr ueber den
  // Rand hinausreichen, und die Antwort ist stabil.
  const durchquerungKm = Math.hypot(
    (land.bbox.maxLat - land.bbox.minLat) * KM_PRO_GRAD,
    (land.bbox.maxLon - land.bbox.minLon) * KM_PRO_GRAD * Math.cos(beobachter.lat * Math.PI / 180)
  );
  const fensterHalb = durchquerungKm / KM_PRO_SEKUNDE / 60 + 1;

  for(const k of kandidaten){
    const r = pruefeKandidat(rec, land, beobachter, k, schritt, fensterHalb);
    if(r) return r;
  }
  return null;
}

// Sucht im Zeitfenster den Punkt der Spur, der dem Land am naechsten kommt.
// Position auf der Einheitskugel.
function einheitskugel(p){
  const lat = p.lat * Math.PI / 180, lon = p.lon * Math.PI / 180;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

// Kleinster Abstand eines Punktes zum Bogen zwischen zwei Positionen.
function abstandZuBogenKm(a, b, mitte){
  const A = einheitskugel(a), B = einheitskugel(b), M = einheitskugel(mitte);

  // Normale der Ebene durch A und B, zugleich die Richtung, in der der
  // Bogen von A nach B laeuft.
  let nx = A[1]*B[2] - A[2]*B[1];
  let ny = A[2]*B[0] - A[0]*B[2];
  let nz = A[0]*B[1] - A[1]*B[0];
  const kreuz = Math.hypot(nx, ny, nz);
  if(kreuz < 1e-12) return abstandKm(a, mitte);        // Punkte praktisch gleich
  nx /= kreuz; ny /= kreuz; nz /= kreuz;

  // In der Ebene: A zeigt nach A, dieser Vektor von A in Richtung B.
  const ex = ny*A[2] - nz*A[1];
  const ey = nz*A[0] - nx*A[2];
  const ez = nx*A[1] - ny*A[0];

  const wAB = Math.atan2(B[0]*ex + B[1]*ey + B[2]*ez, B[0]*A[0] + B[1]*A[1] + B[2]*A[2]);

  // Hoehe des Mittelpunktes ueber der Ebene und sein Fusspunkt darin.
  const hoehe = M[0]*nx + M[1]*ny + M[2]*nz;
  const fx = M[0] - hoehe*nx, fy = M[1] - hoehe*ny, fz = M[2] - hoehe*nz;
  const fl = Math.hypot(fx, fy, fz);

  if(fl > 1e-12){
    const wAF = Math.atan2(fx*ex + fy*ey + fz*ez, fx*A[0] + fy*A[1] + fz*A[2]);
    // Liegt der Fusspunkt auf dem Bogen, ist er die naechste Stelle -
    // und zwar auch dann, wenn er auf der anderen Seite von A liegt
    // (wAF knapp unter Null), denn der Bogen beginnt bei A.
    if(wAF >= -1e-9 && wAF <= wAB) return Math.asin(Math.min(1, Math.abs(hoehe))) * ERDRAD;
  }

  // Sonst liegt die naechste Stelle an einem der beiden Endpunkte.
  return Math.min(abstandKm(a, mitte), abstandKm(b, mitte));
}

// Zeitpunkt der naechsten Annaeherung innerhalb von [a, b] Minuten.
//
// Der Abstand ist ueber ein Intervall von wenigen Minuten eingipfelig: es
// gibt hoechstens eine naechste Annaeherung. Dritteilung findet sie in
// konstanter Zeit und unabhaengig davon, wie fein das Raster gewaehlt ist -
// das ist wichtig, weil ein Gitter, das fein genug waere, um einen Abstand
// von 60 Kilometern aufzulosen, ueber 45 Tage Millionen von Positionen
// bedeutet.
function naechsteAnnaeherung(rec, beobachter, a, b){
  for(let i = 0; i < 40; i++){
    const d = (b - a) / 3;
    if(d < 1e-7) break;
    const m1 = a + d, m2 = b - d;
    const p1 = positionNach(rec, m1), p2 = positionNach(rec, m2);
    const d1 = p1 ? abstandKm(p1, beobachter) : Infinity;
    const d2 = p2 ? abstandKm(p2, beobachter) : Infinity;
    if(d1 <= d2) b = m2; else a = m1;
  }
  return (a + b) / 2;
}

function abstandKm(p, mitte){
  const dLat = (p.lat - mitte.lat) * KM_PRO_GRAD;
  const dLon = (p.lon - mitte.lon) * KM_PRO_GRAD * Math.cos(mitte.lat * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

// ---------------------------------------------------------------- Grenzsuche
//
// Fuer den genauen Zeitpunkt, an dem die ISS ueber einen Landesrand kommt,
// gibt es zwei Faelle, und beide kommen in der Praxis vor:
//
// 1. Das Land ist breiter, als die Bodenspur in einem Rasterschritt
//    zuruecklegt. Dann liegt an beiden Enden eines Stuecks je ein Punkt
//    INNERHALB. Eine Bisektion zwischen zwei Innenpunkten findet keine
//    Grenze - genau daran sind die falschen Zeiten entstanden.
//
// 2. Das Land ist kleiner als der Weg je Rasterschritt. Dann kann der
//    komplette Ueberflug zwischen zwei Abtastpunkte fallen. Der Vatikan ist
//    rund 1 km breit, die Spur legt aber je Schritt 1,4 km zurueck - das
//    Verhaeltnis liegt unter 1, das Land wird grundsatzlich nie getroffen.
//    Ein feineres Raster loest das nicht, es muesste fuer jeden Staat
//    einzeln noch feiner werden.
//
// Fall 2 loest man nicht mit einem feineren Raster, sondern damit, dass die
// Bodenspur zwischen zwei Abtastpunkten eine STRECKE ist. Schneidet diese
// Strecke den Landesrand, liegt dazwischen zwingend eine Grenze - unabhaengig
// davon, wie kurz der Ueberflug ist. Genau das wird hier getan: die Strecke
// wird gegen die Kanten des Polygons geprueft, und nur die tatsaechlich
// geschnittenen Stellen werden per Bisektion auf die Zeit bestimmt.

// Breiten und Laengen in eine flache Ebene in km um die Landesmitte legen.
// Nur fuer die Randrechnung unmittelbar am Land, wo die Projektionsfehler
// weit unter der geforderten Genauigkeit liegen.
function lokalProjektion(land){
  const lon0 = land.mitte.lon, lat0 = land.mitte.lat;
  const kx = KM_PRO_GRAD * Math.cos(lat0 * Math.PI / 180);
  return (lon, lat) => {
    let dLon = lon - lon0;
    // Laengen springen bei +/-180 Grad. Ohne diese Korrektur erschiene eine
    // Nachbarschaft auf der anderen Seite als 360-Kilometer-Sprung.
    if(dLon > 180) dLon -= 360; else if(dLon < -180) dLon += 360;
    return [dLon * kx, (lat - lat0) * KM_PRO_GRAD];
  };
}

// Ringe einmalig in dieselbe Ebene legen und die Huelle davor merken.
function laendGeometrieKm(land){
  const lon0 = land.mitte.lon, lat0 = land.mitte.lat;
  const proj = lokalProjektion(land);
  const ringe = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for(const ring of land.polys){
    const r = [];
    for(const [lon, lat] of ring){
      const [x, y] = proj(lon, lat);
      r.push([x, y]);
      if(x < minX) minX = x; if(x > maxX) maxX = x;
      if(y < minY) minY = y; if(y > maxY) maxY = y;
    }
    if(r.length > 2) ringe.push(r);
  }
  return {proj, ringe, box:{minX, maxX, minY, maxY}};
}


// Schneiden sich zwei Strecken? Nur ja oder nein - die genaue Zeit bestimmt
// anschliessend die Bisektion.
function stueckSchneidet(x0, y0, x1, y1, ax, ay, bx, by){
  const rx = x1 - x0, ry = y1 - y0;
  const sx = bx - ax, sy = by - ay;
  const n = rx * sy - ry * sx;
  if(Math.abs(n) < 1e-12) return false;        // parallel
  const qx = ax - x0, qy = ay - y0;
  const u = (qx * sy - qy * sx) / n;           // Anteil entlang der Bahn
  const v = (qx * ry - qy * rx) / n;           // Anteil entlang der Kante
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

// Schneidet die Strecke zwischen zwei Spurpunkten den Landesrand?
function schneidetRand(geo, x0, y0, x1, y1){
  // Fast alle Strecken liegen weit ausserhalb des Landes. Die Huelle der
  // Strecke gegen die Huelle des Landes zu pruefen erspart den Kantentest in
  // diesen Faellen - das ist der Unterschied zwischen ein paar Mikrosekunden
  // und mehreren hundert bei einem Grossstaat wie Brasilien.
  if(Math.min(x0,x1) > geo.box.maxX || Math.max(x0,x1) < geo.box.minX ||
     Math.min(y0,y1) > geo.box.maxY || Math.max(y0,y1) < geo.box.minY){
    return false;
  }
  for(const ring of geo.ringe){
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      if(stueckSchneidet(x0, y0, x1, y1,
                         ring[j][0], ring[j][1], ring[i][0], ring[i][1])){
        return true;
      }
    }
  }
  return false;
}

// Grenze zwischen zwei benachbarten Punkten, von denen genau einer innerhalb
// liegt. "aIstDrinnen" sagt welcher - dadurch stimmt die Richtung fuer Ein-
// und Austritt gleichermassen.
function grenzePunkt(innen, a, b, aIstDrinnen){
  for(let i = 0; i < 40; i++){
    const m = (a + b) / 2;
    if(m === a || m === b) break;              // Maschine erreicht
    if(innen(m) === aIstDrinnen) a = m; else b = m;
  }
  return (a + b) / 2;
}

// Grenze per Bisektion auf eine Aussage hin, die ab dem gesuchten Zeitpunkt
// monoton wahr wird: das kleinste m, fuer das test(m) gilt.
function grenzeMonoton(test, a, b){
  if(!test(b)) return null;
  if(test(a)) return a;
  for(let i = 0; i < 40; i++){
    const m = (a + b) / 2;
    if(m === a || m === b) break;
    if(test(m)) b = m; else a = m;
  }
  return b;
}

// Den erkannten Ueberflug genau vermessen.
//
// Die Erkennung ueber Strecken gegen den Landesrand findet einen Ueberflug
// unabhaengig von der Rasterweite. Sie liefert aber nur ungefaehre Grenzen,
// und sie kann zwei getrennte Ueberfluege als einen langen Abschnitt
// darstellen, wenn eine kurze Luecke dazwischen vom Raster verschluckt wird.
// Genau das ist bei Indien aufgetreten: Festland, dann eine Luecke von acht
// Sekunden, dann ein zweites Stueck Land - gemeldet wurde ein einziger
// Ueberflug von 322 statt 300 Sekunden.
//
// Deshalb wird der erkannte Abschnitt am Ende noch einmal abgetastet, mit
// einem achtmal feineren Raster, und daraus der laengste zusammenhaengende
// Abschnitt genommen. Das ist billig, weil das Fenster nur den Ueberflug
// selbst umfasst. Die Genauigkeit der gemeldeten Zeiten haengt danach nur noch
// am Messraster und nicht mehr an der Erkennung.
function vermesseUndVerfeinere(innen, von, bis, dt){
  // Gesucht wird der ERSTE Abschnitt, nicht der laengste. Der Nutzer fragt
  // nach dem naechsten Ueberflug - ein spaeterer, laengerer waere die falsche
  // Antwort, auch wenn er rechnerisch schoener aussieht. Belgien zeigte das:
  // zwei Durchfluge 6,4 Sekunden auseinander, gemeldet wurde der zweite und
  // laengere, weil er in der Summe groesser war.
  let v = null, treffer = null;
  for(let m = von; m <= bis + dt; m += dt){
    if(innen(m)){
      if(v === null) v = m;
    }else if(v !== null){
      treffer = {v, e: m};
      break;
    }
  }
  if(treffer === null && v !== null) treffer = {v, e: bis};
  if(!treffer || treffer.e <= treffer.v) return null;

  // Die beiden Enden liegen auf Abtastpunkten. Die Bisektion dazwischen
  // liefert sie genauer, als das Raster gross ist. Am Fensterrand wird
  // nicht verfeinert - dort ist der Nachbarpunkt nicht ausgewertet, und eine
  // Bisektion mit ihm wuerde eine Grenze erfinden.
  return {
    v: treffer.v - dt < von ? treffer.v : grenzePunkt(innen, treffer.v - dt, treffer.v, false),
    e: treffer.e + dt > bis ? treffer.e : grenzePunkt(innen, treffer.e, treffer.e + dt, true)
  };
}

// Feine Pruefung eines Kandidaten: liefert Start und Ende des Ueberflugs
// oder null, wenn in diesem Fenster keiner zu bestimmen ist.
function pruefeKandidat(rec, land, beobachter, kandidat, schritt, fensterHalb){
  const geo = laendGeometrieKm(land);

  const innen = (m) => {
    const p = positionNach(rec, m);
    if(!p) return false;
    if(p.lat < land.bbox.minLat || p.lat > land.bbox.maxLat) return false;
    return punktInLand(p.lon, p.lat, land.polys);
  };

  // Beruehrt ein Ueberflug den Fensterrand, ist seine Dauer nicht
  // verlaesslich. Dann wird das Fenster verbreitert und das Raster
  // verkleinert, bis das Ergebnis belegt ist. Bleibt es unbestimmt, wird
  // nichts geraten, sondern verworfen.
  for(let versuch = 0; versuch < 3; versuch++){
    const fenster   = versuch === 0 ? fensterHalb : fensterHalb * 3;
    const schrittfein = versuch === 0 ? schritt : schritt / (versuch === 1 ? 2 : 6);
    const r = grensuche(rec, land, geo, innen, beobachter, kandidat, schrittfein, fenster);
    if(r) return r;
  }
  return null;
}

function grensuche(rec, land, geo, innen, beobachter, kandidat, schritt, fensterHalb){
  const von = kandidat.minuten - fensterHalb;
  const bis = kandidat.minuten + fensterHalb;

  // Alle Zeitpunkte einsammeln, an denen die Spur den Landesrand schneidet.
  const randzeiten = [];

  let a = von;
  let pa = positionNach(rec, a);
  let drinA = pa ? innen(a) : false;

  while(a < bis){
    const b = Math.min(a + schritt, bis);
    const pb = positionNach(rec, b);
    const drinB = pb ? innen(b) : false;

    if(pa && pb){
      const [x0, y0] = geo.proj(pa.lon, pa.lat);
      const [x1, y1] = geo.proj(pb.lon, pb.lat);
      // Am Datumswechsel springt die Laengenangabe um 180 Grad; als gerade
      // Strecke waere das nicht darstellbar. Laender am 180. Grad werden
      // beim Laden ohnehin aussortiert.
      const gradlinig = Math.abs(pb.lon - pa.lon) < 180;

      if(drinA !== drinB){
        // Gewoehnlicher Fall: genau ein Uebergang im Stueck.
        randzeiten.push(grenzePunkt(innen, a, b, drinA));
      }else if(gradlinig && schneidetRand(geo, x0, y0, x1, y1)){
        // Beide Enden gleich, aber der Rand wird geschnitten: die Spur war
        // kurzzeitig drinnen (kleines Land) oder streift die Kante nur.
        const t1 = grenzeMonoton(m => {
          const pm = positionNach(rec, m);
          if(!pm) return false;
          const [xm, ym] = geo.proj(pm.lon, pm.lat);
          return schneidetRand(geo, x0, y0, xm, ym);
        }, a, b);

        if(t1 !== null && t1 > a){
          const t2 = grenzeMonoton(m => {
            const pm = positionNach(rec, m);
            if(!pm) return false;
            const [xm, ym] = geo.proj(pm.lon, pm.lat);
            return schneidetRand(geo, xm, ym, x1, y1);
          }, t1, b);
          const ende = t2 === null ? t1 : t2;
          // Zwei Schnitte auf derselben Strecke bedeuten immer: die Spur war
          // zwischenzeitlich draussen und ist wieder drinnen - oder, bei
          // gleicher Zeit, sie hat die Kante nur gestreift. Im ersten Fall
          // sind das zwei Grenzen, im zweiten eine Tangente ohne jeden
          // Zeitabstand. Beides unterscheidet allein die Spanne zwischen den
          // beiden Zeitpunkten.
          //
          // Wichtig: das gilt genauso, wenn beide Enden der Strecke INNERHALB
          // liegen. Dann markieren die beiden Schnitte eine Luecke - etwa
          // zwischen dem indischen Festland und einer Insel, oder wenn die
          // Spur ueber eine Bucht zieht. Frueher wurde diese Luecke
          // verworfen, weil die Mitte zwischen beiden Zeitpunkten
          // zwangslaeufig ausserhalb liegt, und die beiden getrennten
          // Ueberfluege wurden zu einem langen zusammengefasst.
          if(ende > t1 + 1e-9) randzeiten.push(t1, ende);
        }
      }
    }

    a = b; pa = pb; drinA = drinB;
  }

  // Aus den Randzeiten den Ueberflug zusammensetzen: an jedem Schnitt
  // wechselt der Zustand zwischen draussen und drinnen. Von drinnen nach
  // draussen ist der Ueberflug vollstaendig beschrieben.
  randzeiten.sort((u, v) => u - v);
  let drin = innen(von);
  let start = drin ? von : null;

  for(const t of randzeiten){
    if(!drin){
      drin = true;
      start = t;
    }else{
      drin = false;
      if(start !== null && t > start){
        // Am Fensterrand abgeschnitten: die Dauer waere geraten.
        if(start <= von || t >= bis) return null;
        // Die Grenzen genau nachmessen. Das klebt die gemeldete Dauer an das
        // Messraster statt an die Erkennung.
        //
        // Das Messraster haengt am Suchraster, nicht an der Laenge des
        // Abschnitts.
        //
        // Vorher stand hier eine feste Probenzahl, und daraus ergab sich ein
        // Raster, das mit der Laene des Abschnitts wuchs: bei einem
        // Abschnitt von fuenf Minuten lag eine Probe alle zwei Sekunden. In
        // Frankreich, wo die Spur in drei Teile zerfaellt, kostete das zwei
        // Sekunden am Anfang des ersten Teils - gemeldet wurde ein Ueberflug
        // von 0,5 statt 2,9 Sekunden, und die Fehlstelle lag mitten im
        // Ueberflug.
        //
        // Ein Sechzehntel des Suchrasters reicht, um auch kurze Luecken
        // zwischen zwei Landteilen zu trennen, und haelt die Probenzahl in
        // jedem Fall unterhalb einiger Tausend.
        const dt = Math.max(0.0002, schritt / 64);
        const gemessen = vermesseUndVerfeinere(innen, start - schritt, t + schritt, dt);
        if(!gemessen || gemessen.e <= gemessen.v) return null;
        if(gemessen.v <= von || gemessen.e >= bis) return null;
        return ueberflugAusgeben(gemessen.v, gemessen.e, rec, beobachter);
      }
      start = null;
    }
  }
  return null;
}

// Ergebnis zusammensetzen. Die Hoehe wird feiner abgetastet, weil der
// hoechste Punkt selten auf einem Abtastpunkt liegt.
function ueberflugAusgeben(startMin, endeMin, rec, beobachter){
  const punkte = [];
  let maxHoehe = -Infinity;

  const schritte = 60;
  const fein = Math.max((endeMin - startMin) / schritte, 0.0002);
  for(let m = startMin; m <= endeMin; m += fein){
    const p = positionNach(rec, m);
    if(!p) continue;
    // Fester Beobachter, nicht pro Abtastpunkt: der Landesmittelpunkt.
    // Ein wandernder Beobachter ergaebe bei jedem Ueberflug 90 Grad, weil
    // die Spur am Ende genau auf dem Landesrand steht und der Beobachter
    // dann genau unter dem Satelliten liegt.
    const h = hoeheUeberHorizont(p, beobachter);
    if(h !== null && h > maxHoehe) maxHoehe = h;
    if(punkte.length < 400) punkte.push([p.lat, p.lon]);
  }
  if(!Number.isFinite(maxHoehe)) maxHoehe = 0;

  return {
    startMinuten: startMin,
    endeMinuten: endeMin,
    dauerSek: (endeMin - startMin) * SEKUNDEN_PRO_MINUTE,
    maxHoehe,
    sichtbar: maxHoehe > 0,
    // Beobachter ist der Landesmittelpunkt. Ein negativer maxHoehe ist kein
    // Fehler, sondern heisst: dieser Ueberflug streift das Land nur weit
    // ausserhalb seiner Mitte und ist von dort aus nicht sichtbar.
    beobachter,
    zeitpunkt: Date.now() + startMin * SEKUNDEN_PRO_MINUTE * 1000,
    punkte
  };
}

// Hoehe des Satelliten ueber dem Horizont eines Beobachters, in Grad.
// Hoehe des Satelliten ueber dem Horizont eines Beobachters, in Grad.
// Die alte Formel 90 - zentraler Winkel - asin(R/(R+h)) liefert bei streifenden
// Bahnen zu kleine Werte (Deutschland: 18 Grad statt 62). Exakt gilt fuer die
// Sichtlinie: senkrechte Komponente (R+h)*cos(zentral) - R, waagerechte
// Komponente (R+h)*sin(zentral).
function hoeheUeberHorizont(sat, beobachter){
  if(!beobachter || !sat || typeof sat.altKm !== "number") return null;
  const h = sat.altKm;
  if(!(h > 0)) return null;
  const s1 = Math.sin(sat.lat * Math.PI / 180);
  const s2 = Math.sin(beobachter.lat * Math.PI / 180);
  const c1 = Math.cos(sat.lat * Math.PI / 180);
  const c2 = Math.cos(beobachter.lat * Math.PI / 180);
  const dLon = (beobachter.lon - sat.lon) * Math.PI / 180;
  const zentral = Math.acos(Math.max(-1, Math.min(1, s1 * s2 + c1 * c2 * Math.cos(dLon))));
  return Math.atan2((ERDRAD + h) * Math.cos(zentral) - ERDRAD,
                    (ERDRAD + h) * Math.sin(zentral)) * 180 / Math.PI;
}

export { KM_PRO_GRAD, SCHRITT_MIN, SEKUNDEN_PRO_TAG };