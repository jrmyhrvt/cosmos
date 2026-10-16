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
// wiegt 3 MB mit rund 140 Feldern je Land; diese Datei 0,48 MB (26.473
// Punkte) und damit auch gzip-komprimiert noch rund 170 KB. Bei 0,02 Grad
// waere die Karte noch schaerfer, kostet aber auf dem Globus rund ein
// Drittel Bildrate - die grossen Kuestenlinien sind hier der beste
// Kompromiss.
//
// Wichtig ist die Ringlaufrichtung: d3 fuellt mit der Nonzero-Regel, ein
// verdrehtes (eingeschlossenes) Ring zeigt deshalb die ganze Kugel. Der
// Generator tools/weltkarte.py haelt die Laufrichtung der Natural-Earth-
// Ringe fest und vereinfacht bei Selbstschnitten nur feiner, statt den
// kompletten Originalring zu uebernehmen.
//
// Der Globus nutzte vorher 110m: das ist zwar kleiner, laesst Daenemark, Italien,
// Portugal oder Grossbritannien aber nur als Klumpen erkennen - genau die
// Kuesten, an denen man die ISS-Ueberfluge ablesen will.
export const WELTKARTE_URL = "assets/world/laender-50m.json";

// Grobe Detailstufe fuer die ganze Kugel, aus derselben Quelle mit 0,5 Grad
// und ohne Ringe unter 0,2 Grad (0,30 MB, 15.371 Punkte, gzip rund 100 KB).
// Sie kostet beim Drehen 7,6 ms je Bild statt 14,9 ms - und auf dem rund
// 300-Px-Globus der Vollansicht sind 0,5 Grad gegenueber 0,08 Grad nicht zu
// sehen: beide Stufen ergeben fuer die sichtbare Halbkugel dieselbe
// Landflaeche. Ab Zoom 1.6 zaehlen die Kuestenlinien, dann wird die feine
// Karte gezeichnet - dort macht der Sichtkreis-Filter sie wieder billig,
// weil nur wenige Laender im Bild liegen. Beim Drehen bleiben so 60 fps.
export const WELTKARTE_GROB_URL = "assets/world/laender-grob.json";
export const WELT_DETAIL_ZOOM = 1.6;

// Feinste Stufe fuer tiefes Hineinzoomen, aus Natural Earth 10m mit 0,02 Grad
// (3,0 MB, 183.574 Punkte, gzip rund 0,95 MB, 258 Laender mit deutschen
// Namen). Sie wird erst ab Zoom 8 geholt und erst dann gezeichnet: unterhalb
// davon ist die mittlere Stufe mit 0,08 Grad schneller und optisch praktisch
// gleich gut, denn 0,08 Grad sind bei Zoom 8 nur noch gut ein Pixel. Ab Zoom 8
// waeren es dagegen drei bis vier Pixel und damit sichtbar zu dick.
// Wichtig ist das Zuschneiden auf den sichtbaren Ausschnitt (clipRing in
// issManager.js): ueber Mitteleuropa gemessen kostet die feine Stufe ohne
// Zuschneiden mehrere hundert Millisekunden je Bild (rund 410 ms), mit
// Zuschneiden rund 14 ms bei Zoom 8 und 6 ms bei Zoom 14. Beim ersten Wechsel
// auf die feine Stufe stockt das Bild einmalig rund 130 ms (3 MB lesen und
// Hüllen berechnen), danach dreht es mit 56 bis 60 fps.
export const WELTKARTE_FEIN_URL = "assets/world/laender-fein.json";
export const WELT_FEIN_ZOOM = 8;
