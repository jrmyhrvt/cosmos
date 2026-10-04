// Laendersuche fuer den naechsten direkten ISS-Ueberflug.
//
// Diese Datei enthaelt nur Daten und Formvorgaben, keine Anzeigelogik und
// keinen Zugriff auf die App. Sie laesst sich deshalb einzeln laden und
// pruefen, ohne dass dafuer der Globus, die Sternkarte oder das Kalendermodul
// mitstarten muessen - genau das war vorher der Grund, warum sich dieser
// Bereich schwer testen liess.

// Kennwerte der ISS-Bahn. Sie stehen hier fest, statt aus dem Live-Modul
// importiert zu werden: sie sind slower Natur und aendern sich nicht, und so
// bleibt diese Datei unabhaengig vom Rest der App.
export const ISS_ORBIT = {
  inclination: 51.64,      // Grad, aus der TLE
  altitudeKm: 420,         // nur als Startwert, die API liefert den echten Wert
  mu: 398600.4418,          // Gravitationsparameter der Erde, km^3/s^2
  earthRadiusKm: 6378.137  // Aequatorradius, wie in satellite.js
};

export function formatIssLat(v){
  return Number.isFinite(v) ? `${v.toFixed(2)}°` : "--";
}

export function formatIssLon(v){
  return Number.isFinite(v) ? `${v.toFixed(2)}°` : "--";
}

// Weltkarte fuer Globus und Laendersuche - bewusst eine einzige Datei fuer
// beides. Quelle ist Natural Earth 50m (Natural-Earth-Vektor von nvkelso),
// gerundet auf drei Nachkommastellen und pro Ring vereinfacht: grosse
// Kuestenlinien bis auf 0,08 Grad (rund 9 km), kleine Inseln unveraendert,
// sonst verschwaenden Monaco, Tuvalu oder die Malediven ganz. Das Original
// wiegt 3 MB mit rund 140 Feldern je Land; diese Datei 0,52 MB und damit auch
// gzip-komprimiert noch rund 185 KB. Bei 0,02 Grad waere die Karte noch
// schaerfer, kostet aber auf dem Globus rund ein Drittel Bildrate - die
// grossen Kuestenlinien sind hier der beste Kompromiss.
//
// Wichtig ist die Ringlaufrichtung: d3 fuellt mit der Nonzero-Regel, ein
// verdrehtes (eingeschlossenes) Ring zeigt deshalb die ganze Kugel. Der
// Generator tools/weltkarte.py haelt die Laufrichtung der Natural-Earth-
// Ringe fest und ersetzt Ringe, die sich beim Vereinfachen selbst schneiden.
//
// Der Globus nutzte vorher 110m: das ist zwar kleiner, laesst Daenemark, Italien,
// Portugal oder Grossbritannien aber nur als Klumpen erkennen - genau die
// Kuesten, an denen man die ISS-Ueberfluge ablesen will.
export const WELTKARTE_URL = "assets/world/laender-50m.json";
