// Laendersuche fuer den naechsten direkten ISS-Ueberflug.
//
// Diese Datei beschaeftigt sich mit der Geometrie der Laender: Polygone,
// Suchbegriffe, Trefferpruefung. Die Bahnberechnung liegt in sgp4.js - dort
// steht, warum eine Kreisbahn hier nicht genuegt und wie genau die Rechnung
// nachgemessen wurde. Beides ist bewusst getrennt: so laesst sich die
// Laendersuche einzeln laden und pruefen, ohne dass Globus, Sternkarte und
// Kalender mitstarten.

import {
  findeNaechstenUeberflug, holeTLE, positionNach, positionJetzt,
  minutenSeitEpoche, tleAlterStunden, letzterTleFehler, tleKommtAusNotfall
} from "./sgp4.js";

const SEKUNDEN_PRO_TAG = 86400;
const KM_PRO_GRAD = 111.32;

// ---------------------------------------------------------------- Punkt-in-Flaeche
function punktInRing(x, y, ring){
  let drinnen = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if(((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)){
      drinnen = !drinnen;
    }
  }
  return drinnen;
}

// Ein Land ist Polygon oder MultiPolygon. Bei MultiPolygon muss nur EIN Teil
// enthalten sein - sonst faellt man durch die Luecken zwischen den Inseln.
function punktInLand(lon, lat, polys){
  for(const ring of polys || []){
    if(!ring.length) continue;
    if(punktInRing(lon, lat, ring)) return true;
  }
  return false;
}

// Laender am Datumswechsel (Kiribati, Fidschi, Tuvalu, ...) liegen auf beiden
// Seiten von 180 Grad. Summiert man die Rohgrade, kommt der Mittelpunkt bei
// Kiribati bei -29 Grad statt bei 176 Grad heraus - mitten im Indischen Ozean.
// Deshalb alle Grade auf eine gemeinsame, ueber den ersten Stützpunkt
// entrollte Spanne bringen. Das Ergebnis darf dabei knapp ueber 180 Grad
// liegen (z. B. 172 bis 181); die Winkelfunktionen periodisieren das von selbst.
function lonSpanne(polys){
  let ref = null, min = Infinity, max = -Infinity, sum = 0, n = 0;
  for(const ring of polys || []){
    for(const [lo] of ring){
      if(ref === null) ref = lo;
      const v = lo + 360 * Math.round((ref - lo) / 360);
      if(v < min) min = v;
      if(v > max) max = v;
      sum += v;
      n++;
    }
  }
  if(!n) return {min: 180, max: -180, mittel: 0};
  return {min, max, mittel: sum / n};
}

function bbox(polys){
  let minLat = 90, maxLat = -90;
  for(const ring of polys || []){
    for(const [, la] of ring){
      if(la < minLat) minLat = la;
      if(la > maxLat) maxLat = la;
    }
  }
  const sp = lonSpanne(polys);
  return {minLon: sp.min, maxLon: sp.max, minLat, maxLat};
}

export { punktInLand, bbox };

// ---------------------------------------------------------------- Ueberflug suchen
//
// Oeffentliche Fassung: holt die TLE, wenn sie noch nicht da ist, und rechnet
// dann. Deshalb ist sie async - die Bahnberechnung selbst ist schnell, das
// Nachladen der Bahndaten braucht eine Runde durchs Netz.
//
// Wichtig: sie unterscheidet drei Faelle, die frueher alle als dasselbe null
// ankamen und damit eine falsche Antwort erzeugten:
//   ok:false              -> Bahndaten nicht verfuegbar (Netz/TLE-Anbieter)
//   ok:true, ueberflug:null -> Bahndaten da, aber im Zeitraum kein Ueberflug
//   ok:true, ueberflug     -> der gesuchte Ueberflug
//
// "Kein Ueberflug" ist eine Aussage ueber die Bahn. Sie darf nie ausfallen,
// nur weil eine Anfrage an den TLE-Anbieter gescheitert ist.
export async function ueberflugSuchen(land, opt = {}){
  const rec = await holeTLE();
  if(!rec){
    return {
      ok: false,
      grund: "keine-bahndaten",
      fehler: letzterTleFehler()
    };
  }

  const ueberflug = findeNaechstenUeberflug(land, rec, opt);
  if(ueberflug){
    return {ok: true, ueberflug, tleAlterStunden: tleAlterStunden(), notfall: tleKommtAusNotfall()};
  }

  // Kein Treffer - aber wie knapp war es? Diese Angabe unterscheidet
  // "fliegt in 45 Tagen nicht darueber" von "war 2 km daneben".
  return {
    ok: true,
    ueberflug: null,
    annaeherung: naechsteAnnaeherung(land, rec, opt),
    tleAlterStunden: tleAlterStunden(),
    notfall: tleKommtAusNotfall()
  };
}

export { findeNaechstenUeberflug, holeTLE, positionNach, positionJetzt,
         minutenSeitEpoche, tleAlterStunden, letzterTleFehler, tleKommtAusNotfall };

/**
 * Wie weit liegt der naechste Bodenspur-Punkt vom Landesmittelpunkt entfernt?
 *
 * Hintergrund: Bei einem Kleinstaat ist die Antwort "kein Ueberflug in 45
 * Tagen" haeufig und meist nicht auf ein Rechenfehler zurueckzufuehren. Die
 * Bodenspur wandert pro Umlauf rund 23 Grad nach Westen und ueberspringt ein
 * Land von 0,13 Grad Breite dabei meist einfach. Ein solches Land ist in
 * 45 Tagen zwar 175-mal auf derselben Breite, aber an 175 verschiedenen
 * Laengen - die Chance auf genau das richtige Fenster ist gering.
 *
 * Diese Funktion findet den Punkt der Bodenspur, der dem Land am naechsten
 * kommt, und sagt, wie weit er danebenlag. Damit laesst sich unterscheiden:
 *   - "1,4 km daneben"  = die Bahn streift das Land praktisch, das Raster
 *                          war zu grob oder die Rundung zu ungenau
 *   - "210 km daneben"  = die ISS fliegt in 45 Tagen schlicht nicht darueber
 */
export function naechsteAnnaeherung(land, rec, opt = {}){
  if(!rec || !land?.bbox) return null;

  const start = opt.startMinuten ?? minutenSeitEpoche(rec);
  const maxMin = start + (opt.maxTage ?? 45) * 1440;
  // Fuer die Suche nach dem nahen Punkt genuegt ein grobes Raster von
  // 30 Sekunden: das sind gut 230 km Weg, ein Ueberflug dauert dagegen
  // nur wenige Sekunden. Fuer die Genauigkeit wird danach verfeinert.
  const schritt = opt.schrittMinuten ?? 0.5;

  let best = null;
  for(let m = start; m <= maxMin; m += schritt){
    const p = positionNach(rec, m);
    if(!p) continue;

    // Nur in derselben Breitenlage ist ein Vergleich sinnvoll: ein Punkt am
    // anderen Ende der Erde ist zwar nah an derselben Breite, aber nicht
    // ueber dem Land.
    if(p.lat < land.bbox.minLat - 1 || p.lat > land.bbox.maxLat + 1) continue;

    const dLat = (p.lat - land.mitte.lat) * KM_PRO_GRAD;
    const dLon = (p.lon - land.mitte.lon) * KM_PRO_GRAD * Math.cos(land.mitte.lat * Math.PI / 180);
    const abstandKm = Math.hypot(dLat, dLon);
    if(!best || abstandKm < best.abstandKm){
      best = {abstandKm, minuten: m, lat: p.lat, lon: p.lon};
    }
  }
  if(!best) return null;

  // Um den nahen Punkt herum feiner rechnen, sonst zeigt der Wert nur die
  // Genauigkeit des groben Rasters an.
  let fein = best;
  const eng = opt.fehler ?? 0.2;   // Grad, so weit um den Punkt herum suchen
  for(let m = best.minuten - schritt; m <= best.minuten + schritt; m += 0.01){
    const p = positionNach(rec, m);
    if(!p) continue;
    const dLat = (p.lat - land.mitte.lat) * KM_PRO_GRAD;
    const dLon = (p.lon - land.mitte.lon) * KM_PRO_GRAD * Math.cos(land.mitte.lat * Math.PI / 180);
    const abstandKm = Math.hypot(dLat, dLon);
    if(abstandKm < fein.abstandKm) fein = {abstandKm, minuten: m, lat: p.lat, lon: p.lon};
  }
  return {
    abstandKm: fein.abstandKm,
    zeitpunkt: Date.now() + fein.minuten * 60000,
    lat: fein.lat,
    lon: fein.lon
  };
}

// ---------------------------------------------------------------- Laender laden
let laenderCache = null;
let laenderPromise = null;

export async function loadCountries(){
  if(laenderCache) return laenderCache;
  if(laenderPromise) return laenderPromise;

  // 50m statt 110m: bei 110m fehlen Liechtenstein, Monaco, San Marino und
  // weitere Kleinstaaten ganz - fuer "passiert ja seltener" waere genau das
  // die interessantesten Laender.
  const url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
  laenderPromise = fetch(url, {cache: "force-cache"})
    .then(r => {
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(geo => {
      const out = [];
      for(const f of geo.features || []){
        const g = f.geometry;
        if(!g) continue;
        // Die Daten bringen die Ländernamen in vielen Sprachen mit. Ohne
        // deutsches Feld wäre "Deutschland" nicht auffindbar - dabei ist
        // genau das der Name, den jemand hier eingibt.
        const name = f.properties?.NAME_DE || f.properties?.NAME || f.properties?.name;
        if(!name) continue;

        // Die aeusseren Ringe aller Teilstuecke einsammeln. Fuer die Trefferpruefung
        // reichen diese: ein Land gilt als ueberflogen, sobald die Bodenspur
        // einen der Ringe schneidet.
        const ringe = g.type === "Polygon"
          ? [g.coordinates[0]].filter(Boolean)
          : g.coordinates.map(poly => poly[0]).filter(Boolean);
        if(!ringe.length) continue;

        const box = bbox(ringe);
        if(box.minLon > box.maxLon) continue;

        // Mittelpunkt aus der Flaeche: gewichtetes Mittel aller Stuetzpunkte.
        // Reicht fuer die Hoehenberechnung und faellt bei unregelmaessigen
        // Laendern nicht sofort auf.
        let sy = 0, n = 0;
        for(const ring of ringe){
          for(const [, la] of ring){ sy += la; n++; }
        }
        if(!n) continue;
        const sp = lonSpanne(ringe);

        // Alle Namen mitfuehren, damit die Suche je nach Sprache und
        // Schreibweise greift: "Ägypten", "Aegypten", "Egypt", "Egipto".
        const namen = new Set();
        for(const k of ["NAME_DE", "NAME_EN", "NAME_ES", "NAME", "NAME_ALT"]){
          if(f.properties?.[k]) namen.add(f.properties[k]);
        }

        out.push({
          name,
          namen: [...namen],
          iso2: f.properties?.ISO_A2 || f.properties?.ISO_A2_EH || "",
          bbox: box,
          mitte: {lat: sy / n, lon: ((sp.mittel + 540) % 360) - 180},
          // ALLE Teilstuecke behalten, nicht nur den ersten. Japan besteht aus 34
          // Inseln, Norwegen aus 32 Teilen - mit nur einem Ring wuerde die
          // Bodenspur durch fast jedes Inselland hindurchfallen.
          polys: ringe
        });
      }
      out.sort((a, b) => a.name.localeCompare(b.name, "de"));
      // Aliasse nach Zeichen, damit die Suche nur einmal ueber alle Namen
      // eines Landes laeuft statt viermal.
      for(const l of out) l.alias = l.namen.map(n => normieren(n));
      laenderCache = out;
      laenderPromise = null;
      return out;
    })
    .catch(err => {
      laenderPromise = null;
      throw err;
    });

  return laenderPromise;
}

// Suchbegriffe vereinheitlichen, damit "Aegypten", "Ägypten" und "agypten"
// denselben Treffer ergeben. Uebrig bleibt die Kleinschreibung.
function normieren(s){
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Frei findbar nach Teil des Namens, in jeder mitgefuehrten Sprache.
export function sucheLaender(liste, begriff, grenze = 8){
  const ziel = normieren(begriff);
  if(!ziel) return liste.slice(0, grenze);
  const treffer = liste.filter(l =>
    l.alias.some(a => a.includes(ziel) || ziel.includes(a)) ||
    normieren(l.iso2) === ziel
  );
  // Exakter Treffer nach oben, damit "Japan" nicht hinten landet, nur weil
  // ein Laender mit aehnlichem Namen weiter oben steht.
  treffer.sort((a, b) => {
    const exaktA = a.alias.some(a2 => a2 === ziel) ? 0 : 1;
    const exaktB = b.alias.some(b2 => b2 === ziel) ? 0 : 1;
    if(exaktA !== exaktB) return exaktA - exaktB;
    return a.name.localeCompare(b.name, "de");
  });
  return treffer.slice(0, grenze);
}

export { SEKUNDEN_PRO_TAG };