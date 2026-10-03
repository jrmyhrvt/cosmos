import { currentLang } from "../main.js";
import { TRANSLATIONS } from "../translations.js";
export let currentIssLat = null;
export let currentIssLon = null;
export let currentIssAlt = null;
export let currentIssVelocity = null;
export let globeRotation = 0;
export let isDraggingGlobe = false;
export let prevMouseX = 0;
export function formatIssLat(){
  return Number.isFinite(currentIssLat) ? `${currentIssLat.toFixed(2)}°` : "--";
}
export function formatIssLon(){
  return Number.isFinite(currentIssLon) ? `${currentIssLon.toFixed(2)}°` : "--";
}

// Alle Anzeigen der ISS-Position aktualisieren (nur die Live-Detailseite).
export function updateIssReadouts(){
  const latEl = document.getElementById("detailLat");
  const lonEl = document.getElementById("detailLon");
  const altEl = document.getElementById("detailAlt");
  const speedEl = document.getElementById("detailSpeed");
  if(latEl) latEl.textContent = formatIssLat();
  if(lonEl) lonEl.textContent = formatIssLon();
  if(altEl) altEl.textContent = Number.isFinite(currentIssAlt) ? `${Math.round(currentIssAlt)} km` : "--";
  // wheretheiss.at liefert die Bahngeschwindigkeit in km/h (rund 27.600).
  // In der Sprache des Nutzers mit Tausenderpunkt.
  if(speedEl) speedEl.textContent = Number.isFinite(currentIssVelocity)
    ? `${Math.round(currentIssVelocity).toLocaleString(currentLang)} km/h`
    : "--";

  const status = `<strong>ISS</strong> ${formatIssLat()} / ${formatIssLon()}` +
    (Number.isFinite(currentIssAlt) ? ` · ${Math.round(currentIssAlt)} km` : "");
  ["globeIssStatus"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.innerHTML = status;
  });
}

export let issErrorLogged = false;
export async function fetchISS(){
  if(document.hidden) return;
  try{
    const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {cache:"no-cache"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const lat = parseFloat(data.latitude);
    const lon = parseFloat(data.longitude);
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("ungegueltige Koordinaten");
    // Vorhandene Position bleibt erhalten, bis eine neue echte da ist.
    currentIssLat = lat;
    currentIssLon = lon;
    if(data.altitude !== undefined) currentIssAlt = parseFloat(data.altitude);
    if(data.velocity !== undefined) currentIssVelocity = parseFloat(data.velocity);
    issErrorLogged = false;
    updateIssReadouts();
  }catch(err){
    if(!issErrorLogged){
      console.warn("[COSMOS] ✗ ISS-Position (Wheretheiss.at) nicht erreichbar:", err?.message || err);
      issErrorLogged = true;
    }
  }
}
setInterval(fetchISS, 5000);
document.addEventListener("visibilitychange", () => { if(!document.hidden) fetchISS(); });
fetchISS();

/* --- GloStar / Erdglobus --------------------------------------------------
   Ein Globus, zwei Verwendungen: Live-Detail der ISS und GloStar.
   weisse Landflaechen auf schwarzem Grund, ISS-Bahn und Live-Position.
   -------------------------------------------------------------------------- */
export let globeWorldData = null;
export let globeWorldPromise = null;
export let globeAnimationId = null;
export const globes = new Map();

// Reale Bahndaten der ISS: Inklination und mittlere Hoehe werden fuer die
// Bodenspur verwendet, der Ankerpunkt ist die aktuelle echte Position.
export const ISS_ORBIT = {inclination: 51.64, altitudeKm: 420, mu: 398600.4418, earthRadiusKm: 6371};

// Das gerade im Auswahlfeld gewaehlte Land. Der Zustand liegt hier und nicht
// im DOM: die ISS-Detailseite wird bei jedem Sprachwechsel und jedem Zurueck
// komplett neu aufgebaut. Waere die Auswahl an das Canvas-Element gebunden,
// waere sie nach dem naechsten Aufbau weg, obwohl sie im Auswahlfeld noch
// dasteht.
let globeLand = null;

export function globeAktuellesLand(){
  return globeLand;
}

// Waehlt das Land, das auf der Kugel rot umrandet wird, und dreht den Globus
// darauf. Ohne das Drehen waere die Umrandung bei einem Land auf der
// Rueckseite unsichtbar und man haelt die Funktion fuer kaputt.
export function setGlobeLand(land){
  globeLand = land || null;
  for(const instance of globes.values()){
    if(!instance.showIss) continue;
    instance.landZentrum = !!globeLand;
    instance.userMoved = false;
    if(globeLand && globeLand.mitte){
      instance.viewLon = globeLand.mitte.lon;
      instance.viewLat = globeLand.mitte.lat;
    }
  }
}

export async function loadGlobeWorld(){
  if(globeWorldData) return globeWorldData;
  if(!globeWorldPromise){
    const url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
    globeWorldPromise = fetch(url, {cache:"force-cache"})
      .then(response => {
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        globeWorldData = data;
        globeWorldPromise = null;
        return data;
      })
      .catch(err => {
        globeWorldPromise = null;
        console.warn("[COSMOS] ✗ Weltkarte (Natural Earth) nicht erreichbar:", err?.message || err);
        throw err;
      });
  }
  return globeWorldPromise;
}

// Bodenspur der ISS aus der aktuellen Position: Breitengrad folgt der
// Inklination, Laengsgrad sinkt mit der Erdrotation.
// fromTurns/toTurns waehlen den Abschnitt der Bahn:
//   -1 bis 0 = die zuletzt geflogene Umrundung, 0 bis 1 = die naechste.
// Negative Werte laufen in der Zeit zurueck, das erzeugt denselben Kreislauf
// nur in Gegenrichtung - Breite und Laengsgrad bleiben damit korrekt.
export function issGroundTrack(lat, lon, fromTurns = 0, toTurns = 1, samples = 320){
  const r = ISS_ORBIT.earthRadiusKm + (Number.isFinite(currentIssAlt) ? currentIssAlt : ISS_ORBIT.altitudeKm);
  const n = Math.sqrt(ISS_ORBIT.mu / (r * r * r));           // mittlere Bewegung [rad/s]
  const omegaEarth = 7.2921159e-5;                            // Erdrotation [rad/s]
  const inc = ISS_ORBIT.inclination * Math.PI / 180;
  const sinU0 = Math.sin(lat * Math.PI / 180) / Math.sin(inc);
  const u0 = Math.asin(Math.max(-1, Math.min(1, sinU0)));
  //atan2 liefert Bogenmass. Die folgenden Rechnungen mischen sonst Grad
  // (die ISS-Länge aus der TLE) mit Bogenmass - die Bahn schwingt dann nur
  // ein paar Grad hin und her statt um die halbe Erde zu laufen.
  const lonAt = u => Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) * 180 / Math.PI;
  const lon0 = lonAt(u0);
  const points = [];
  for(let i = 0; i <= samples; i++){
    const u = u0 + (fromTurns + (i / samples) * (toTurns - fromTurns)) * 2 * Math.PI;
    const phi = Math.asin(Math.sin(inc) * Math.sin(u)) * 180 / Math.PI;
    const lambda = lon + (lonAt(u) - lon0) - omegaEarth * ((u - u0) / n) * 180 / Math.PI;
    points.push([((lambda + 540) % 360) - 180, phi]);
  }
  return points;
}

// d3.geoOrthographic() liefert auch fuer Punkte auf der Rueckseite
// Koordinaten zurueck - man muss also selbst pruefen, ob der Punkt ueber
// dem Horizont liegt. Sonst waere die ISS sichtbar, obwohl sie hinter der
// Erde steht.
// d3.geoOrthographic().rotate([r0, r1]) stellt den geografischen Punkt
// (-r0, -r1) in die Mitte der Kugel. Sichtbar ist ein Punkt, wenn er weniger
// als 90 Grad vom Blickzentrum entfernt liegt:
//     cos(lat)*cos(lat0)*cos(lon-lon0) + sin(lat)*sin(lat0) > 0
// Wichtig: lon0 und lat0 sind die NEGATIVEN Rotate-Werte. Mit denselben
// Werten wie fuer lat/lon ergab sich fuer den Punkt in der Kugelmitte
// -sin^2(lat) + cos^2(lat)*cos(2*lon), was ab Breitengrad 30 Grad
// dauerhaft negativ war - der rote ISS-Punkt verschwand dann ueber
// zwei Drittel der Bahn.
export function globePointVisibility(instance, lon, lat){
  const rot = instance.projection.rotate();
  const toRad = Math.PI / 180;
  const lon0 = -(rot[0] || 0);
  const lat0 = -(rot[1] || 0);
  return Math.cos(lat * toRad) * Math.cos(lat0 * toRad) * Math.cos((lon - lon0) * toRad)
       + Math.sin(lat * toRad) * Math.sin(lat0 * toRad);
}

// Sichtbarer Abstand der ISS-Bahn ueber der Erde, als Anteil am Radius.
// Der echte Wert waere 420 km / 6371 km = 6,6 % - auf dem Globus schwebt die
// Station damit weit ausserhalb der Kugel. Gewaehlt ist ein kleinerer Wert, der
// als Bruchteil des Radius angegeben wird: dadurch waechst der Abstand mit der
// Kugel mit und sieht auf jedem Bildschirm gleich aus.
export const ISS_RING_FACTOR = 1.03;

// Vergroesserung des 3D-Modells gegenueber der echten Groesse. Die ISS ist
// 0,0017 % des Erdradius und damit auf dem Globen unsichtbar. Mit diesem
// Wert misst sie rund 6 Grad Bogen: bei maximalem Zoom nimmt sie etwa zwei
// Drittel der Bildhoehe ein, davor ist sie ein kleiner Punkt. In der Szene
// verankert waechst sie mit dem Zoom mit, statt eine Pixelgroesse zu behalten.
export const ISS_MODELL_MASSSTAB = 0.0015;

export function globePointOnNearSide(instance, lon, lat){
  return globePointVisibility(instance, lon, lat) > 0;
}

/* --- Sterne hinter dem Globus ---------------------------------------------
   Die ISS-Ansicht bekommt einen leichten Sternenhimmel. Er liegt HINTER der
   Erde: gezeichnet wird er vor der Erdscheibe, die ihn sauber abdeckt - die
   Sterne scheinen also nie durch den Planeten. Beim Ziehen dreht sich der
   Himmel mit, und zwar deutlich schneller als die Erdoberflaeche, sodass das
   Drehen wie ein Blick in den Kosmos wirkt.
   -------------------------------------------------------------------------- */
const STERN_DICHTE = 60;     // ein Stern je so vielen CSS-Pixeln Karte
const STERN_DREH = 3.5;      // wie viel schneller der Himmel beim Ziehen mitdreht
const STERN_MAX = 4000;      // Obergrenze, damit schwache Geraete ruhig bleiben

// Milchstrasse: keine gezeichnete Linie, sondern eine dichtere Ansammlung von
// Sternen entlang der galaktischen Ebene. Wir sehen sie im Querschnitt, deshalb
// liegt das Band als geneigter Grosskreis am Himmel. Es ist nur ein Abschnitt
// davon - die Enden laufen aus, es schliesst sich nicht zu einem Ring.
const BAND_NEIGUNG = 62 * Math.PI / 180;   // Neigung des Bandes
const BAND_LON = 30 * Math.PI / 180;       // wo es den Himmel kreuzt
const BAND_ANTEIL = 0.66;                  // so viel der Sterne liegt im Band
const BAND_SPANNE = 2.05;                  // halbe Laenge des Abschnitts (rad)
const BAND_BREITE = 5 * Math.PI / 180;     // Streuung der Sterne um die Ebene

function zufallNormal(){
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Einen Punkt der Milchstrassen-Ebene (galaktische Laenge t, Breite b) in die
// Koordinaten des Sternenhimmels umrechnen. So drehen sich Band und Sterne
// spaeter mit derselben Bewegung.
function bandPunkt(t, b){
  const cb = Math.cos(b), sb = Math.sin(b);
  const x = cb * Math.cos(t);
  const y = cb * Math.sin(t) * Math.cos(BAND_NEIGUNG) - sb * Math.sin(BAND_NEIGUNG);
  const z = cb * Math.sin(t) * Math.sin(BAND_NEIGUNG) + sb * Math.cos(BAND_NEIGUNG);
  return [
    Math.atan2(y, x) * 180 / Math.PI + BAND_LON * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI
  ];
}

function neuerStern(instance, lon, lat, imBand){
  return {
    lon, lat,
    alpha: (imBand ? 0.14 : 0.16) + Math.random() * (imBand ? 0.42 : 0.5),
    groesse: ((imBand ? 0.6 : 0.7) + Math.random() * 1.4) * instance.dpr,
    blink: Math.random() * 0.35,
    rate: 0.4 + Math.random() * 1.6,
    ph: Math.random() * Math.PI * 2
  };
}

function sternHimmel(instance){
  const w = instance.width, h = instance.height;
  if(instance.himmel && instance.himmelW === w && instance.himmelH === h) return instance.himmel;
  const cssFlaeche = (instance.canvas.clientWidth || w) * (instance.canvas.clientHeight || h);
  const anzahl = Math.max(80, Math.min(STERN_MAX, Math.round(cssFlaeche / STERN_DICHTE)));
  const bandAnzahl = Math.round(anzahl * BAND_ANTEIL);
  const sterne = [];
  // Gleichmaessiger Sternenhimmel.
  for(let i = 0; i < anzahl - bandAnzahl; i++){
    sterne.push(neuerStern(instance,
      Math.random() * 360 - 180,
      // Arkussinus: sonst sammeln sich die Sterne an den Polen.
      Math.asin(Math.random() * 2 - 1) * 180 / Math.PI, false));
  }
  // Milchstrasse: ein Abschnitt des Bandes, zur Mitte hin dichter, die Enden
  // laufen aus. In der Breite streuen die Sterne gaussfoermig um die Ebene.
  for(let i = 0; i < bandAnzahl; i++){
    // Dreieckig verteilt: die Mitte des Abschnitts wird am dichtesten.
    const u = (Math.random() + Math.random()) / 2;
    const t = (u * 2 - 1) * BAND_SPANNE;
    const b = zufallNormal() * BAND_BREITE * (0.75 + Math.random() * 0.5);
    const [lon, lat] = bandPunkt(t, b);
    sterne.push(neuerStern(instance, lon, lat, true));
  }
  instance.himmel = sterne;
  instance.himmelW = w;
  instance.himmelH = h;
  return sterne;
}


function zeichneHimmel(instance){
  const sterne = sternHimmel(instance);
  const {ctx, center, width, height} = instance;
  // Radius so gross, dass die sichtbare Halbkugel die ganze Leinwand fuellt,
  // auch die Ecken. Die Sterne stehen damit auf einer grossen Himmelskugel.
  const R = Math.hypot(width, height) / 2 * 1.06;
  const rad = Math.PI / 180;
  const lat0 = (instance.sternLat || 0) * rad;
  const sinLat0 = Math.sin(lat0), cosLat0 = Math.cos(lat0);
  const lon0 = instance.sternLon || 0;
  const sekunden = Date.now() / 1000;
  ctx.fillStyle = "#fff";
  for(const s of sterne){
    const dLon = (s.lon - lon0) * rad;
    const lat = s.lat * rad;
    const cosLat = Math.cos(lat);
    // z > 0: vor dem Betrachter. Sonst liegt der Stern hinter ihm.
    const z = sinLat0 * Math.sin(lat) + cosLat0 * cosLat * Math.cos(dLon);
    if(z <= 0) continue;
    const x3 = cosLat * Math.sin(dLon);
    const y3 = cosLat0 * Math.sin(lat) - sinLat0 * cosLat * Math.cos(dLon);
    const px = center[0] + x3 * R;
    const py = center[1] - y3 * R;
    const funkeln = 1 + s.blink * Math.sin(sekunden * s.rate + s.ph);
    // Am Horizont der Kugel weich ausblenden, damit kein harter Sternrand
    // entsteht, wenn ein Stern beim Drehen auftaucht oder verschwindet.
    const rand = Math.min(1, z / 0.2);
    ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * funkeln)) * rand;
    ctx.fillRect(px, py, s.groesse, s.groesse);
  }
  ctx.globalAlpha = 1;
}

export function drawGlobeFrame(instance, world){
  let issPoint = null;
  const {ctx, width, height, center, radius} = instance;
  const projection = instance.projection;

  ctx.clearRect(0, 0, width, height);

  // Leichter Sternenhimmel hinter der Erde (nur ISS-Ansicht). Er wird vor der
  // Erdscheibe gezeichnet und von ihr verdeckt - so scheint kein Stern durch
  // den Planeten. Die Milchstrasse steckt als dichteres Sternband darin.
  if(instance.showIss) zeichneHimmel(instance);

  // Zieht einen projizierten Punkt vom Kugelmittelpunkt aus nach aussen auf
  // den schwebenden Ring. Bahn und Station werden beide damit behandelt, damit
  // sie auf gleicher Hoehe liegen.
  const schweben = pt => pt && [
    center[0] + (pt[0] - center[0]) * ISS_RING_FACTOR,
    center[1] + (pt[1] - center[1]) * ISS_RING_FACTOR
  ];

  // Wie weit die Kugel wirklich reicht. Die Projektion skaliert beim Zoom
  // bereits mit, aber gezeichnet wurde bisher immer im festen Radius - damit
  // blieb ein starrer Kreis stehen und nur der Inhalt darin wurde groesser.
  // Das ist eine Lupe. Hier waechst die Kugel selbst mit, laesst am Ende den
  // Rand aus dem Bild heraus und man ist drin, so wie beim Hineinzoomen in
  // eine Karte.
  const kugel = radius * instance.zoom;

  // Schwarzer Ozean
  ctx.beginPath();
  ctx.arc(center[0], center[1], kugel, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();

  // Reale Natural-Earth-Landflaechen
  ctx.save();
  ctx.beginPath();
  ctx.arc(center[0], center[1], kugel, 0, Math.PI * 2);
  ctx.clip();
  // clip() laesst den Begrenzungskreis im aktuellen Pfad liegen. Ohne dieses
  // beginPath() wuerde der Landfuellung auch der Kreis gefuellt und die
  // Kugel erschiene komplett weiss.
  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = instance.px(.35);
  instance.path(world);
  ctx.fill();
  ctx.stroke();

  // Das im Auswahlfeld gewaehlte Land rot umranden. Es wird innerhalb desselben
  // Kugel-Clips gezeichnet, dadurch schneidet der Clip die Rueckseite von
  // selbst weg - man sieht also nur die Haelfte des Landes, die gerade
  // wirklich vorne liegt, statt einer flach ueber die Kugel gelegten Linie.
  if(globeLand?.polys?.length){
    for(const ring of globeLand.polys){
      ctx.beginPath();
      for(let i = 0; i < ring.length; i++){
        const pt = projection(ring[i]);
        if(!pt){ ctx.moveTo(0, 0); continue; }
        if(i === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      }
      ctx.strokeStyle = "rgba(255,59,48,.95)";
      ctx.lineWidth = instance.px(1.8);
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  ctx.restore();

  // ISS-Bahn. Sie liegt nicht auf der Landflaeche, sondern schwebt als Ring
  // knapp darueber - deshalb wird sie nach dem Kugel-Clip gezeichnet, sonst
  // wuerde sie am Rand von der Kugel abgeschnitten. GloStar zeigt den Globus
  // ohne ISS: dort gehoert sie thematisch nicht hin.
  if(instance.showIss && Number.isFinite(currentIssLat) && Number.isFinite(currentIssLon)){
    // Sehr dichte Abtastung: an den Polen wechselt die Laenge schnell, und
    // mit zu wenigen Punkten bricht die Bahn dort in sichtbare Zacken aus.
    const SAMPLES = 900;

    // Die Bahn wird in zusammenhaengende Stuecke zerlegt, getrennt an der
    // Stelle, wo sie ueber den Horizont in die Rueckseite laeuft. Jedes Stueck
    // wird einzeln gezeichnet - so sitzen die Enden genau am Rand und ragen
    // nicht ueber die Kugel hinaus, wo sie als spitze Haken auffaellen.
    const trackStuecke = track => {
      const stuecke = [];
      let offen = null;
      for(const point of track){
        const vorn = globePointVisibility(instance, point[0], point[1]) > 0;
        const projected = schweben(projection(point));
        if(!projected){ offen = null; continue; }
        if(!offen || offen.vorn !== vorn){ offen = {vorn, punkte: []}; stuecke.push(offen); }
        offen.punkte.push(projected);
      }
      return stuecke.filter(stueck => stueck.punkte.length > 1);
    };

    // Nur die Stuecke vor dem Horizont werden gezeichnet. Was hinter der Kugel
    // liegt, bleibt unsichtbar - so scheint die Bahn nicht durch die Erde
    // hindurch. Beim Weiterdrehen taucht sie von selbst wieder auf.
    const strokeTrack = (track, stil, strich) => {
      for(const stueck of trackStuecke(track)){
        if(!stueck.vorn) continue;
        ctx.beginPath();
        ctx.moveTo(stueck.punkte[0][0], stueck.punkte[0][1]);
        for(let i = 1; i < stueck.punkte.length; i++) ctx.lineTo(stueck.punkte[i][0], stueck.punkte[i][1]);
        ctx.strokeStyle = stil;
        ctx.lineWidth = instance.px(1.3);
        ctx.setLineDash(strich);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    const pastTrack = issGroundTrack(currentIssLat, currentIssLon, -1, 0, SAMPLES);
    const nextTrack = issGroundTrack(currentIssLat, currentIssLon, 0, 1, SAMPLES);
    // Die Bahn ist durchgehend rot - das ganze Rohr, das die ISS abfliegt.
    // Der rote Punkt der Station sitzt auf dieser Linie, beides ist dieselbe
    // Sache. Die Zeitrichtung traegt allein die Strichform:
    // durchgezogen ist die zuletzt geflogene Umrundung, gestrichelt die naechste.
    strokeTrack(pastTrack, "rgba(255,59,48,.85)", []);
    strokeTrack(nextTrack, "rgba(255,59,48,.9)", [instance.px(4), instance.px(4)]);

    // Station und Bahn liegen beide auf dem schwebenden Ring, nicht auf der
    // Kugel. Deshalb laeuft die ISS buendig in ihrer Spur - so soll es sein.
    issPoint = schweben(projection([currentIssLon, currentIssLat]));

    // Ab diesem Zoom wird die Station als 3D-Modell gezeigt. Alles andere
    // bleibt liegen: der Globus, die Bahnen, die Beschriftung kommen nicht weg.
    if(issPoint && instance.zoom >= 3){
      // Das Modell steht senkrecht auf der Erdoberflaehe und zeigt in
      // Flugrichtung der Bahn - es fliegt also sichtbar die Bahn entlang.
      const track = issGroundTrack(currentIssLat, currentIssLon, 0, 0.02, 2);
      const to = track[1] || track[0];
      const rad = Math.PI / 180;
      const phi = currentIssLat * rad, lam = currentIssLon * rad;
      const hoch = [Math.cos(phi)*Math.cos(lam), Math.cos(phi)*Math.sin(lam), Math.sin(phi)];
      const richtungLaenge = [to[0], to[1], 0];
      const grad = d => d * rad;
      const dLat = grad((to[0] - currentIssLat));
      const dLon = grad((to[1] - currentIssLon)) * Math.cos(phi);
      const flug = [dLon, dLat, 0];
      const laengeF = Math.hypot(flug[0], flug[1]) || 1;
      flug[0] /= laengeF; flug[1] /= laengeF;
      // Senkrecht auf die Erde, aber in der Ebene der Bahnebene
      const quer = [hoch[1]*flug[2] - hoch[2]*flug[1],
                    hoch[2]*flug[0] - hoch[0]*flug[2],
                    hoch[0]*flug[1] - hoch[1]*flug[0]];
      const laengeQ = Math.hypot(quer[0], quer[1], quer[2]) || 1;
      quer[0] /= laengeQ; quer[1] /= laengeQ; quer[2] /= laengeQ;
      const senkrecht = [quer[1]*hoch[2] - quer[2]*hoch[1],
                         quer[2]*hoch[0] - quer[0]*hoch[2],
                         quer[0]*hoch[1] - quer[1]*hoch[0]];
      // Spalten der Matrix: x = Flugrichtung, y = quer, z = nach oben
      const richtung = [flug, quer, senkrecht];
      // Blickrichtung: von aussen in die Kugel, dort wo der Globus gerade
      // zeigt. Beim Drehen dreht sich das Modell dadurch mit.
      const phi0 = instance.viewLat * rad, lam0 = instance.viewLon * rad;
      const blick = [Math.cos(phi0)*Math.cos(lam0), Math.cos(phi0)*Math.sin(lam0), Math.sin(phi0)];
      // Bei Zoom 3 blendet das Modell weich ein, ab Zoom 5 ist es voll da.
      const anteil = Math.max(0, Math.min(1, (instance.zoom - 3) / 2));
      // Bei starkem Zoom liegt die Station schnell ausserhalb des Bildes.
      // Dann wird gar nichts gezeichnet, statt 250 Flaechen ins Leere zu
      // zeichnen. Der Rand ist grosszuegig, weil das Modell breiter ist als
      // der Punkt selbst.
      const ausserhalb = !issPoint ||
        issPoint[0] < -instance.px(120) || issPoint[0] > instance.width + instance.px(120) ||
        issPoint[1] < -instance.px(120) || issPoint[1] > instance.height + instance.px(120);
      if(anteil > 0 && !ausserhalb &&
         globePointVisibility(instance, currentIssLon, currentIssLat) > 0){
        drawIssModel(ctx, instance, projection, center,
          {hoch, flug, quer, senkrecht}, Date.now() / 4200, anteil);
      }
    }
  }

  // Die Markierung wird nach dem Kugel-Clip gezeichnet, damit sie am Rand
  // nicht abgeschnitten wird.
  // Liegt die Station gerade hinter dem Horizont, wird die Markierung ganz
  // ausgeblendet - sie soll nicht durch die Erde scheinen.
  const issVorn = issPoint ? globePointVisibility(instance, currentIssLon, currentIssLat) > 0 : false;
  if(issPoint && issVorn){
    const alpha = 1;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 520);
    const fontSize = instance.px(10);

    // Die Station sitzt auf ihrer Bahn: der Punkt wandert denselben Weg wie
    // die Linie, nur um ISS_RING_FACTOR vom Kugelmittelpunkt nach aussen
    // geschoben. Deshalb sitzt er buendig in der Spur.
    const mx = issPoint[0];
    const my = issPoint[1];
    ctx.beginPath();
    ctx.arc(mx, my, instance.px(9 + pulse * 5), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,59,48,${(0.32 - pulse * 0.2) * alpha})`;
    ctx.fill();

    // dunkler Ring
    ctx.beginPath();
    ctx.arc(mx, my, instance.px(5.5), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.75 * alpha})`;
    ctx.fill();
    // heller Ring
    ctx.beginPath();
    ctx.arc(mx, my, instance.px(4.5), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = instance.px(1.6);
    ctx.stroke();
    // der rote Punkt selbst
    ctx.beginPath();
    ctx.arc(mx, my, instance.px(3.2), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,59,48,${alpha})`;
    ctx.fill();

    // Beschriftung nach aussen, mit dunklem Umriss, damit sie auf Land wie
    // ueber dem Ozean gleich gut lesbar bleibt.
    ctx.font = `700 ${fontSize}px -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif`;
    const toRight = mx >= center[0];
    const gap = instance.px(9);
    const lx = toRight ? mx + gap : mx - gap;
    const ly = Math.min(Math.max(my - instance.px(7), fontSize + instance.px(4)),
                        instance.height - instance.px(4));
    ctx.textAlign = toRight ? "left" : "right";
    ctx.lineWidth = instance.px(2.5);
    ctx.strokeStyle = `rgba(0,0,0,${0.85 * alpha})`;
    ctx.strokeText("ISS", lx, ly);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText("ISS", lx, ly);
  }

  // Weisser Kreisumriss
  ctx.beginPath();
  ctx.arc(center[0], center[1], kugel, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = instance.px(1.5);
  ctx.stroke();

}

// ---------------------------------------------------------------------------
// 3D-Modell der ISS
//
// Vollstaendig aus Code: eine Liste von Flaechen mit Punkten im lokalen
// Koordinatensystem der Station. x zeigt in Flugrichtung, y laeuft entlang
// des Trusses, z zeigt nach oben aus der Erde heraus. Keine externe Datei, kein
// weiterer Download - so bleibt die App eine einzige Datei.
export const ISS_TEILE = (() => {
  const teile = [];
  const quadrat = (a, b, c, d, farbe) => teile.push({punkte: [a, b, c, d], farbe});
  const dreieck = (a, b, c, farbe) => teile.push({punkte: [a, b, c], farbe});
  const quader = (x, y, z, dx, dy, dz, farbe) => {
    const p = (i, j, k) => [x + dx*i, y + dy*j, z + dz*k];
    quadrat(p(0,0,0), p(0,1,0), p(0,1,1), p(0,0,1), farbe);
    quadrat(p(1,0,0), p(1,0,1), p(1,1,1), p(1,1,0), farbe);
    quadrat(p(0,0,0), p(0,0,1), p(1,0,1), p(1,0,0), farbe);
    quadrat(p(0,1,0), p(1,1,0), p(1,1,1), p(0,1,1), farbe);
    quadrat(p(0,0,1), p(0,1,1), p(1,1,1), p(1,0,1), farbe);
    quadrat(p(0,0,0), p(1,0,0), p(1,1,0), p(0,1,0), farbe);
  };
  const platte = (xa, xb, ya, yb, za, zb, farbe) =>
    quader(Math.min(xa, xb), Math.min(ya, yb), Math.min(za, zb),
           Math.abs(xb - xa), Math.abs(yb - ya), Math.abs(zb - za), farbe);

  // Kreuzprodukt zweier Kanten ab pts[0]
  const norm = pts => {
    const u = [pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]];
    const v = [pts[2][0]-pts[0][0], pts[2][1]-pts[0][1], pts[2][2]-pts[0][2]];
    return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  };
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  // Flaeche so ablegen, dass ihre Normale in Richtung ref zeigt. Nur so
  // stimmt die Rueckseiten-Kuerzung beim Zeichnen fuer jede Achse.
  const flaeche = (pts, farbe, ref) => {
    if(dot(norm(pts), ref) >= 0) quadrat(pts[0], pts[1], pts[2], pts[3], farbe);
    else quadrat(pts[0], pts[3], pts[2], pts[1], farbe);
  };
  const ecke = (pts, farbe, ref) => {
    if(dot(norm(pts), ref) >= 0) dreieck(pts[0], pts[1], pts[2], farbe);
    else dreieck(pts[0], pts[2], pts[1], farbe);
  };

  // Zylinder entlang x, y oder z, optional um "mitte" versetzt. Die echten
  // Module und Raumschiffe sind Roehren, keine Quader.
  const zylinder = (achse, a0, a1, r, farbe, seg = 14, mitte = [0, 0, 0]) => {
    const ai = achse === "x" ? 0 : achse === "y" ? 1 : 2;
    const P = (a, c, s) => {
      const p = achse === "x" ? [a, c, s] : achse === "y" ? [c, a, s] : [c, s, a];
      return [p[0] + mitte[0], p[1] + mitte[1], p[2] + mitte[2]];
    };
    for(let i = 0; i < seg; i++){
      const t0 = i / seg * Math.PI * 2, t1 = (i + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(t0) * r, s0 = Math.sin(t0) * r;
      const c1 = Math.cos(t1) * r, s1 = Math.sin(t1) * r;
      // Nach aussen zeigt die Flaeche, wenn ihre Normale vom Achs-Mittelpunkt
      // wegzeigt. Die Achskomponente wird dabei herausgerechnet.
      const m0 = Math.cos((t0 + t1) / 2), m1 = Math.sin((t0 + t1) / 2);
      const radial = achse === "x" ? [0, m0, m1] : achse === "y" ? [m0, 0, m1] : [m0, m1, 0];
      flaeche([P(a0,c0,s0), P(a0,c1,s1), P(a1,c1,s1), P(a1,c0,s0)], farbe, radial);
      if(i === 0){
        const laengs = [0, 0, 0]; laengs[ai] = -1;
        const laengs2 = [0, 0, 0]; laengs2[ai] = 1;
        for(let k = 0; k < seg; k++){
          const q0 = k / seg * Math.PI * 2, q1 = (k + 1) / seg * Math.PI * 2;
          ecke([P(a0,0,0), P(a0,Math.cos(q0)*r,Math.sin(q0)*r), P(a0,Math.cos(q1)*r,Math.sin(q1)*r)], farbe, laengs);
          ecke([P(a1,0,0), P(a1,Math.cos(q0)*r,Math.sin(q0)*r), P(a1,Math.cos(q1)*r,Math.sin(q1)*r)], farbe, laengs2);
        }
      }
    }
  };
  const rohr = (x0, x1, r, farbe, seg) => zylinder("x", x0, x1, r, farbe, seg);

  const grauTruss = [188, 196, 205];
  const weiss     = [216, 222, 229];
  const solar     = [24, 44, 90];
  const solarRahmen = [72, 96, 146];
  const radiator  = [234, 239, 245];
  const dunkel    = [120, 128, 138];
  const mli       = [191, 150, 62];
  const mliDunkel = [150, 112, 44];

  // Integrierter Truss (y-Achse). Echte Laenge 108 m, hier 90 Einheiten bei
  // 1,2 m je Einheit. Vier Laengsstreben plus Querrahmen - das offene
  // Gitterwerk, das die echte Station zeigt.
  const TH = 45, TX = 1.55, TZ = 1.45;
  for(const sx of [-1, 1]){
    for(const sz of [-1, 1]){
      quader(sx*TX - 0.28, -TH, sz*TZ - 0.28, 0.56, 2*TH, 0.56, grauTruss);
    }
  }
  for(let y = -TH; y <= TH; y += 5){
    quader(-TX - 0.22, y - 0.22, -TZ - 0.22, 2*TX + 0.44, 0.44, 2*TZ + 0.44, grauTruss);
  }

  // Druckmodule entlang der Flugrichtung. Aussendurchmesser ~4,2 m -> r 1,75.
  rohr(-21.5, -19.5, 1.5, dunkel, 12);   // Heckstutzen
  rohr(-19.5, -13, 1.9, mli, 14);        // Swesda, goldene Isolierung
  rohr(-13, -8, 1.75, weiss, 12);        // Sarja
  rohr(-8, -6, 2.05, weiss, 12);         // Unity (Knoten)
  rohr(-6, 4, 1.75, weiss, 14);          // Destiny (US-Labor)
  rohr(4, 6, 2.05, weiss, 12);           // Harmony (Knoten)
  rohr(6, 11.5, 1.75, weiss, 12);        // Tranquility / PMM
  rohr(11.5, 13.5, 1.5, dunkel, 10);     // PMA
  // Columbus (Steuerbord) und Kibo (Backbord) sitzen quer am Harmony-Knoten.
  zylinder("y", 2, 7.8, 1.75, weiss, 12, [5.2, 0, 0]);
  zylinder("y", -2, -11, 1.75, weiss, 12, [5.2, 0, 0]);
  // Cupola, der Beobachtungsdom zur Erde hin.
  zylinder("z", -1.8, -2.9, 1.15, weiss, 12, [-1, 0, 0]);
  zylinder("z", -2.9, -3.3, 0.62, dunkel, 12, [-1, 0, 0]);

  // Kuehler (weiss) in der Truss-Mitte.
  for(const sy of [-1, 1]){
    for(const sx of [-1, 1]){
      platte(sx*3, sx*15, sy*8 - 1.4, sy*8 + 1.4, -0.3, 0.3, radiator);
    }
  }

  // Acht Solarfluegel an vier Truss-Positionen, je Paar zwei Arme nach +/-x.
  // Echte Fluegel 36 m lang, 4,6 m breit -> 30 x 3,8 Einheiten.
  const WX = 27.5, WW = 3.8;
  for(const sy of [-1, 1]){
    for(const py of [16.5, 39]){
      const yc = sy * py;
      for(const sx of [-1, 1]){
        const xa = sx * 3, xb = sx * (3 + WX);
        platte(xa, xb, yc - WW/2, yc + WW/2, -0.35, 0.35, solar);
        platte(xa, xb, yc - WW/2 - 0.35, yc - WW/2, -0.42, 0.42, solarRahmen);
        platte(xa, xb, yc + WW/2, yc + WW/2 + 0.35, -0.42, 0.42, solarRahmen);
        platte(xa, xb, yc - 0.18, yc + 0.18, -0.4, 0.4, solarRahmen);
        for(let k = 1; k <= 5; k++){
          const xr = sx * (3 + WX * k / 6);
          platte(xr - 0.16, xr + 0.16, yc - WW/2, yc + WW/2, -0.4, 0.4, solarRahmen);
        }
        platte(sx*1.5, sx*3, yc - 0.6, yc + 0.6, -0.65, 0.65, dunkel);
      }
    }
  }

  // Angedockte Raumschiffe: Progress/Soyuz am russischen, Dragon am US-Ende.
  rohr(-27, -24, 1.25, dunkel, 12);
  rohr(-24, -22.5, 1.5, weiss, 12);
  rohr(13.5, 17, 1.25, dunkel, 12);
  rohr(17, 19.5, 1.55, weiss, 12);
  zylinder("x", 19.5, 20.6, 1.0, dunkel, 12);
  return teile;
})();

// Die Station wird als Teil der Szene gezeichnet, nicht als Aufkleber auf dem
// Bildschirm: jeder Eckpunkt bekommt eine Position auf der Erdkugel und laeuft
// durch dieselbe Projektion wie Land, Bahnen und Kugelrand. Dadurch waechst das
// Modell beim Zoomen von selbst mit, verkuenzt sich am Horizont wie alles
// andere und bleibt unverzerrt.
export function drawIssModel(ctx, instance, projection, center, basis, spin, alpha){
  const {hoch, flug, quer, senkrecht} = basis;
  const rad = Math.PI / 180;
  // Die echte ISS ist 109 m breit, die Erde 12 742 km - auf dem Globus waere
  // sie ein Punkt. Deshalb wird sie hier um ISS_MODELL_MASSSTAB vergroessert
  // dargestellt. Sie waechst aber mit dem Zoom mit und ist am Ende genauso
  // gross wie ein Objekt, dem man sich naehern wuerde.
  const M = ISS_MODELL_MASSSTAB;
  const flaechen = [];
  // Sonne von schräg oben links, dazu das Licht, das von der Erde unter der
  // Station reflektiert wird. Die Erde ist riesig und sehr hell - ohne diesen
  // zweiten Anteil bleiben die Unterseiten schwarz, obwohl sie in Wirklichkeit
  // blau aufleuchten.
  const licht = [-0.42, 0.5, 0.76];
  const erdLicht = [0.52, 0.64, 0.86];
  // Halbvektor fuer den Glanzpunkt. Die Kamera blickt von aussen auf die
  // Station, ihre Richtung ist also die Radiale hoch - dieselbe, auf der die
  // Station schwebt.
  for(const teil of ISS_TEILE){
    const c = Math.cos(spin), sn = Math.sin(spin);
    const ecken = teil.punkte.map(p => {
      const rx = p[0]*c - p[1]*sn, ry = p[0]*sn + p[1]*c, rz = p[2];
      // Lokale Achsen in die Erde drehen
      const wx = rx*flug[0] + ry*quer[0] + rz*senkrecht[0];
      const wy = rx*flug[1] + ry*quer[1] + rz*senkrecht[1];
      const wz = rx*flug[2] + ry*quer[2] + rz*senkrecht[2];
      // Station sitzt auf dem schwebenden Ring, wie ihre Bahn
      const X = hoch[0]*ISS_RING_FACTOR + wx*M;
      const Y = hoch[1]*ISS_RING_FACTOR + wy*M;
      const Z = hoch[2]*ISS_RING_FACTOR + wz*M;
      const laenge = Math.hypot(X, Y, Z);
      const lon = Math.atan2(Y, X) / rad;
      const lat = Math.asin(Z / laenge) / rad;
      const proj = projection([lon, lat]);
      if(!proj) return null;
      // Die Projection rechnet mit dem Einheitsradius, der Abstand zur Erde
      // kommt also als Skalierung vom Kugelmittelpunkt aus dazu.
      return [center[0] + (proj[0] - center[0]) * laenge,
              center[1] + (proj[1] - center[1]) * laenge,
              X, Y, Z];
    });
    if(ecken.some(e => !e)) continue;                 // Teil liegt hinten
    // Flaechennormale aus zwei Kanten im Erdkoordinatensystem
    const a = [ecken[1][2]-ecken[0][2], ecken[1][3]-ecken[0][3], ecken[1][4]-ecken[0][4]];
    const b = [ecken[2][2]-ecken[0][2], ecken[2][3]-ecken[0][3], ecken[2][4]-ecken[0][4]];
    let n = [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
    const laengeN = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0]/laengeN, n[1]/laengeN, n[2]/laengeN];

    // Rueckseiten weglassen. Das ist der groesste Gewinn an Schaerfe: ohne
    // diese Kuerzung liegen die hinteren Flaechen zwischen den vorderen und
    // faerben sie mit einem falschen Ton ein. Der Normalenvektor zeigt nach
    // aussen, die Kamera steht entlang hoch - ein Punkt ist also sichtbar,
    // wenn die Normale zur Kamera zeigt.
    const zurKamera = n[0]*hoch[0] + n[1]*hoch[1] + n[2]*hoch[2];
    if(zurKamera <= 0.02) continue;

    const sonne = Math.max(0, n[0]*licht[0] + n[1]*licht[1] + n[2]*licht[2]);
    const erde = Math.max(0, -(n[0]*hoch[0] + n[1]*hoch[1] + n[2]*hoch[2]));
    // Halbvektor Sonne/Blickrichtung fuer den Glanzpunkt
    const hx = licht[0] + hoch[0], hy = licht[1] + hoch[1], hz = licht[2] + hoch[2];
    const hl = Math.hypot(hx, hy, hz) || 1;
    const glanzFleck = Math.pow(Math.max(0, (n[0]*hx + n[1]*hy + n[2]*hz) / hl), 26);
    // Zusatzlicht am Rand: nimmt den Flaechen die harte Trennlinie zur
    // dahinterliegenden Flaeche und laesst die Station plastisch wirken.
    const rand = Math.pow(1 - zurKamera, 3) * 0.18;

    const tiefe = ecken.reduce((sum, e) => sum + e[2]*hoch[0] + e[3]*hoch[1] + e[4]*hoch[2], 0) / 4;
    // Grundhelligkeit bewusst hoch: die Station wirkte auf dem dunklen Globus
    // sonst zu duenn. Nur die Helligkeit, nicht die Farbwerte selbst.
    flaechen.push({ecken, farbe: teil.farbe, ton: 0.42 + 1.0*sonne + 0.5*erde,
                   erde, glanz: glanzFleck, rand, tiefe});
  }
  // Von hinten nach vorn zeichnen, sonst liegen die nahen Flaechen drunter
  flaechen.sort((a, b) => a.tiefe - b.tiefe);
  for(const f of flaechen){
    ctx.beginPath();
    ctx.moveTo(f.ecken[0][0], f.ecken[0][1]);
    for(let i = 1; i < f.ecken.length; i++) ctx.lineTo(f.ecken[i][0], f.ecken[i][1]);
    ctx.closePath();
    const [r, g, b] = f.farbe;
    // Grundton aus Sonne und Erdschein, der Erdschein leicht blaustichig.
    let R = r * (f.ton - f.erde * 0.22) + f.erde * 34;
    let G = g * (f.ton - f.erde * 0.12) + f.erde * 44;
    let B = b * (f.ton + f.erde * 0.10) + f.erde * 62;
    // Glanzpunkt und Randlicht kommen additiv dazu. Kraeftig, damit die
    // Station auf dem dunklen Globus hell glaenzt.
    R += 255 * f.glanz * 0.85 + 255 * f.rand * 0.6;
    G += 255 * f.glanz * 0.85 + 255 * f.rand * 0.6;
    B += 255 * f.glanz * 0.85 + 255 * f.rand * 0.65;
    // Ein weicher Weiss-Schein liegt als Schatten hinter jeder Flaeche.
    // Ueber den dunklen Meeren hebt er die Station sichtbar ab, ohne ihre
    // Farbe, Form oder Groesse zu veraendern.
    ctx.shadowColor = "rgba(255,255,255,.55)";
    ctx.shadowBlur = instance.px(4);
    ctx.fillStyle = `rgba(${Math.round(Math.max(0, Math.min(255, R)))},${Math.round(Math.max(0, Math.min(255, G)))},${Math.round(Math.max(0, Math.min(255, B)))},${alpha})`;
    ctx.fill();
    // Der Schein darf nicht auf der feinen Silhouettenkante liegen.
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    // Eine feine, dunkle Kante an den Silhouetten macht die Station auch auf
    // hellem Grund klar erkennbar. Innenkanten bleiben weg, sonst zerfaellt das
    // Gitterwerk in einem Gitter aus Linien.
    ctx.lineWidth = instance.px(0.6);
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(0,0,0,${0.34 * alpha})`;
    ctx.stroke();
  }
}

export function drawGlobeFallback(instance, message){
  const {ctx, width, height, center, radius} = instance;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, center[0], center[1]);
}

export function globeLoop(){
  globeAnimationId = null;
  for(const [canvasId, instance] of globes){
    const canvas = instance.canvas;
    const visible = canvas.isConnected && canvas.offsetParent !== null && !document.hidden;
    if(!visible) continue;

    if(instance.world){
      // GloStar rotiert frei. Der ISS-Globus bleibt stehen und richtet sich
      // nach der Station aus - eine automatisch drehende Karte schluckt den
      // Punkt immer wieder hinter dem Horizont und ist unlesbar.
      if(!instance.dragging && instance.autoRotate && !instance.showIss) instance.userRotation += 0.035;
      // Nur der ISS-Globus zentriert sich auf die Station, GloStar rotiert frei.
      // Wichtig: auf LÄNGE *und* BREITE zentrieren. Mit einem festen
      // Breitengrad stand der Punkt bis zu 31 Grad neben der Kugelmitte und
      // lief am Rand oder ueber Land - genau das war "schlecht sichtbar".
      const hasIss = instance.showIss
        && Number.isFinite(currentIssLon) && Number.isFinite(currentIssLat);
      if(hasIss){
        // Prioritaet hat das gewaehlte Land: der Globus schaut darauf, damit
        // die rote Umrandung sichtbar ist. Erst wenn kein Land gewaehlt ist,
        // folgt der Blick der Station.
        if(instance.landZentrum && globeLand?.mitte && !instance.userMoved){
          instance.viewLon = globeLand.mitte.lon;
          instance.viewLat = globeLand.mitte.lat;
        } else if(!instance.userMoved){
          // Solange der Nutzer die Kugel nicht selbst gedreht hat, schaut sie
          // auf die Station. Danach bleibt der Blick genau dort stehen, wo er
          // hingesdreht wurde - sonst kaeme das Drehen nicht ueberhaupt an.
          instance.viewLon = currentIssLon;
          instance.viewLat = currentIssLat;
        }
        instance.projection.rotate([-instance.viewLon, -instance.viewLat, 0]);
      } else {
        instance.projection.rotate([instance.userRotation, 8, 0]);
      }
      // Der Zoom steckt allein in der Projektionsskala: Drehen, Bahnen und
      // Landflaechen wachsen dadurch gemeinsam, ohne dass irgendetwas neu
      // gezeichnet oder ausgeblendet werden muss.
      instance.projection.scale(instance.radius * instance.zoom);
      drawGlobeFrame(instance, instance.world);
    } else {
      drawGlobeFallback(instance, "…");
    }
  }
  if(globes.size) globeAnimationId = requestAnimationFrame(globeLoop);
}

export function sizeGlobeCanvas(instance){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = instance.canvas.clientWidth || instance.canvas.width;
  const cssHeight = instance.canvas.clientHeight || instance.canvas.height;
  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);
  if(instance.canvas.width !== targetW || instance.canvas.height !== targetH){
    instance.canvas.width = targetW;
    instance.canvas.height = targetH;
  }
  instance.width = instance.canvas.width;
  instance.height = instance.canvas.height;
  // Die Zeichenbefehle des Canvas rechnen in Geraetepixeln, die Angaben der
  // Seite in CSS-Pixeln. Ohne dieses Verhaeltnis sieht ein 3-Punkt-Kreis auf
  // einem dpr-2-Handy halb so gross aus wie auf einem dpr-1-Mac. Mit px() wird
  // jede Groesse in CSS-Pixeln angegeben und ist damit auf beiden gleich.
  instance.dpr = dpr;
  instance.px = css => css * dpr;
  instance.center = [instance.width / 2, instance.height / 2];
  // Der Radius darf nie groesser als die kleinere Kante werden - sonst
  // schneidet der Rahmen die Kugel an, unabhaengig von dpr oder Fenstergroesse.
  const limit = Math.min(instance.width, instance.height) / 2;
  instance.radius = Math.max(8, Math.min(limit - 2 * dpr, limit * instance.radiusFactor * 2));
  instance.projection
    .translate(instance.center)
    .scale(instance.radius);
}

// Registriert einen Globus. Wird fuer die ISS-Detailseite und fuer GloStar
// benutzt - die Darstellung bleibt identisch.
export function mountGlobe(canvasId, statusId, options = {}){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  // Ohne D3 gibt es keinen Globus - das ist kein Grund fuer eine Endlosschleife
  // voller Fehler, deshalb wird die Kartenansicht dann schlicht ersetzt.
  if(typeof d3 === "undefined" || typeof d3.geoOrthographic !== "function"){
    const message = (TRANSLATIONS[currentLang] || {}).error_globe || "Globus nicht verfuegbar";
    const status = document.getElementById(statusId);
    if(status) status.textContent = message;
    else{
      const note = document.createElement("p");
      note.className = "globe-fallback";
      note.textContent = message;
      canvas.replaceWith(note);
    }
    return;
  }
  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  const existing = globes.get(canvasId);
  const instance = existing || {
    canvas,
    ctx,
    path: null,
    projection: d3.geoOrthographic().clipAngle(90),
    userRotation: 0,
    // Blickpunkt: geografischer Punkt in der Scheibenmitte. Beim ISS-Globus
    // steuert der Nutzer damit die Kugel frei, bis er sie selbst gedreht hat.
    // Zoomfaktor der Projektion. 1 = ganze Kugel, 14 = dicht herangezoomt.
    zoom: 1,
    viewLon: 0,
    viewLat: -8,
    // Ausrichtung des Sternenhimmels hinter der Erde. Wird nur beim Ziehen
    // veraendert, damit sich der Himmel beim Drehen mitbewegt.
    sternLon: 0,
    sternLat: 0,
    himmel: null,
    himmelW: 0,
    himmelH: 0,
    userMoved: false,
    dragging: false,
    lastX: 0,
    lastY: 0,
    world: null,
    width: 0,
    height: 0,
    center: [0, 0],
    radius: 0,
    dpr: 1,
    px: css => css
  };
  instance.canvas = canvas;
  instance.ctx = ctx;
  instance.statusId = statusId || null;
  instance.radiusFactor = options.radiusFactor ?? 0.34;
  instance.autoRotate = options.autoRotate !== false;
  // ISS-Marker und Bodenspur erscheinen nur auf dem ISS-Globus der Live-Seite.
  instance.showIss = options.showIss !== false;
  instance.path = d3.geoPath(instance.projection, ctx);
  globes.set(canvasId, instance);

  sizeGlobeCanvas(instance);

  // Beobachte den Container statt nur das Fenster: der Rahmen aendert seine
  // Groesse auch, wenn eine Detailseite aufgeht, eine Schrift nachlaedt oder
  // das Geraet gedreht wird. Ohne das bleibt der Radius auf einer alten
  // Fenstergroesse stehen und die Kugel wird angeschnitten.
  if(typeof ResizeObserver === "function" && !instance.observer){
    instance.observer = new ResizeObserver(() => sizeGlobeCanvas(instance));
    instance.observer.observe(canvas.parentElement || canvas);
  }

  const onDown = e => {
    // Zwei Finger gleichzeitig heisst Zoom, nicht Drehen.
    if(e.touches && e.touches.length > 1){ instance.dragging = false; return; }
    instance.dragging = true;
    const punkt = e.touches?.[0] || e;
    instance.lastX = punkt.clientX ?? 0;
    instance.lastY = punkt.clientY ?? 0;
    canvas.style.cursor = "grabbing";
  };
  // Wie viele Grad dreht ein Pixel? Das haengt am Zoom. Ohne Zoom ist ein
  // Grad auf der Karte etwa so breit wie ein Pixel, deshalb passt dort 0,35.
  // Beim Hineinzoomen wird ein Grad aber immer schmaler, eine feste
  // Empfindlichkeit schleudert die Kugel nur noch hin und her. Mit diesem
  // Wert folgt der Karteninhalt dem Finger genau so weit, wie man ihn
  // schiebt - wie beim Ziehen in Google Maps.
  const drehGrad = () => Math.max(0.012, 0.35 / instance.zoom);

  const onMove = e => {
    if(!instance.dragging) return;
    if(e.touches && e.touches.length > 1) return;      // Pinch laeuft
    // Selbst drehen heisst: die automatische Zentrierung auf das gewaehlte
    // Land endet. Sonst schaukte die Kugel nach dem Loslassen sofort wieder
    // zurueck und der Griff haette keine Wirkung.
    instance.landZentrum = false;
    const punkt = e.touches?.[0] || e;
    const x = punkt.clientX ?? 0;
    const y = punkt.clientY ?? 0;
    const dx = x - instance.lastX;
    const dy = y - instance.lastY;
    instance.lastX = x;
    instance.lastY = y;
    // Der ISS-Globus wird frei um die Mitte der Kugel gedreht, waagrecht wie
    // senkrecht. Bewegt wird der Punkt, der gerade in der Scheibenmitte
    // liegt - dadurch dreht sich die Erde unter dem Finger und die Bahn
    // bleibt als geschlossener Ring im Bild.
    if(instance.showIss){
      const f = drehGrad();
      instance.userMoved = true;
      instance.viewLon = ((instance.viewLon - dx * f) % 360 + 540) % 360 - 180;
      instance.viewLat = Math.max(-88, Math.min(88, instance.viewLat + dy * f));
      // Der Sternenhimmel dreht sich mit, aber deutlich schneller als die
      // Erdoberflaeche - das Ziehen fuehlt sich dadurch wie ein Blick in den
      // Kosmos an. Die Erde bleibt davor und deckt ihn weiterhin ab.
      instance.sternLon = ((instance.sternLon - dx * f * STERN_DREH) % 360 + 540) % 360 - 180;
      instance.sternLat = Math.max(-88, Math.min(88, instance.sternLat + dy * f * STERN_DREH));
    } else {
      instance.userRotation += dx * drehGrad();
    }
    if(e.cancelable && e.touches) e.preventDefault();
  };
  const onUp = () => { instance.dragging = false; instance.pinch = 0; canvas.style.cursor = "grab"; };

  // Zoom mit dem Mausrad. Ohne preventDefault wuerde die ganze Seite scrollen.
  const onWheel = e => {
    e.preventDefault();
    const faktor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
    instance.zoom = Math.max(1, Math.min(14, instance.zoom * faktor));
  };

  // Zwei-Finger-Zoom auf dem Touchscreen. Solange zwei Finger auf dem Glas
  // liegen, wird nicht gedreht - das wuerde die Bahn wild hin- und herspringen.
  const pinchAbstand = t => t.length < 2 ? 0
    : Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  canvas.addEventListener("wheel", onWheel, {passive: false});
  const onTouchStart = e => {
    if(e.touches.length === 2) instance.pinch = pinchAbstand(e.touches);
  };
  const onTouchMove = e => {
    if(e.touches.length !== 2) return;
    const jetzt = pinchAbstand(e.touches);
    if(instance.pinch > 0 && jetzt > 0){
      instance.zoom = Math.max(1, Math.min(14, instance.zoom * (jetzt / instance.pinch)));
    }
    instance.pinch = jetzt;
    if(e.cancelable) e.preventDefault();
  };
  const onTouchEnd = () => { if(instance.pinch) instance.pinch = 0; };
  canvas.addEventListener("touchstart", onTouchStart, {passive: true});
  canvas.addEventListener("touchmove", onTouchMove, {passive: false});
  canvas.addEventListener("touchend", onTouchEnd, {passive: true});

  // Doppelklick setzt den Zoom zurueck - der Weg zurueck muss immer leicht
  // zu finden sein, sonst ist man bei hohem Zoom eingeschlossen.
  const onDblClick = () => { instance.zoom = 1; instance.userMoved = false; instance.landZentrum = false; };
  canvas.addEventListener("dblclick", onDblClick);

  canvas.onmousedown = onDown;
  canvas.onmousemove = onMove;
  canvas.onmouseup = onUp;
  canvas.onmouseleave = onUp;
  canvas.ontouchstart = onDown;
  canvas.ontouchmove = onMove;
  canvas.ontouchend = onUp;
  canvas.style.cursor = "grab";

  loadGlobeWorld()
    .then(world => {
      if(!canvas.isConnected) return;
      instance.world = world;
    })
    .catch(() => {
      if(canvas.isConnected) drawGlobeFallback(instance, TRANSLATIONS[currentLang].error_globe);
    });

  if(!globeAnimationId) globeAnimationId = requestAnimationFrame(globeLoop);
}

// Zoom von aussen, also ueber die Buttons unter der Kugel. Zugriff ueber die
// Instanz, damit keine zusaetzliche Kopie des Zoomwerts im DOM entsteht -
// die Schleife liest ohnehin instance.zoom. Die Klemmung 1 bis 14 ist dieselbe
// wie beim Mausrad, sonst wuerden die Buttons die Kugel weiter hineinzoomen
// koennen als das Rad.
export function globeZoomRaus(canvasId, faktor = 1.35){
  const instance = globes.get(canvasId);
  if(!instance) return;
  instance.zoom = Math.max(1, Math.min(14, instance.zoom * faktor));
  // Mit hineinzoomen ist die automatische Zentrierung vorbei, sonst sprengt der
  // naechste Frame den Blick wieder auf das ganze Land zurueck.
  if(faktor > 1) instance.userMoved = true;
}

// Zurueck auf die ganze Kugel und wieder auf den Blickpunkt, den die Kugel
// sonst automatisch waehlt. Ohne userMoved = false bliebe die Kugel auf der
// Stelle stehen, auf der der Reset gerade ausgefuehrt wurde.
export function globeZoomReset(canvasId){
  const instance = globes.get(canvasId);
  if(!instance) return;
  instance.zoom = 1;
  instance.userMoved = false;
  instance.landZentrum = false;
}

// Beim Wechsel der Ansicht wird ein nicht mehr sichtbarer Globus abgeraeumt.
export function pruneGlobes(){
  for(const [canvasId, instance] of globes){
    if(!instance.canvas.isConnected || instance.canvas.offsetParent === null){
      if(instance.observer){ instance.observer.disconnect(); instance.observer = null; }
      globes.delete(canvasId);
    }
  }
}

window.addEventListener("resize", () => {
  for(const instance of globes.values()) sizeGlobeCanvas(instance);
});
document.addEventListener("visibilitychange", () => {
  if(!document.hidden) for(const instance of globes.values()) sizeGlobeCanvas(instance);
});

// ---- Sternenhimmel --------------------------------------------------------
// Drei Tiefenschichten uebereinander. Je naeher dem Betrachter, desto groesser
// und heller der Stern und desto weiter wandert er, wenn sich der Cursor
// bewegt. Diese Staffelung erzeugt Tiefe - ein einziger Haufen gleichartiger
// Punkte bleibt flach. Ausserdem ist die Zahl an die Bildflaeche gebunden,
// damit ein grosses Display nicht dieselbe Menge wie ein Handy bekommt.
