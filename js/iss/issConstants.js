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