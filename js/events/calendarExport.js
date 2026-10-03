/* Kalender-Export fuer COSMOS.
 *
 * Wichtig und in der Sache nicht Aenderbares: Eine Webseite darf nicht
 * selbst in den Kalender des Geraets schreiben. Das blockieren die Browser
 * aus Sicherheitsgruenden, sonst koennte jede beliebige Seite Termine erfinden.
 *
 * Der Weg, der funktioniert, ist der Standard der Kalenderwelt: die Datei
 * iCalendar (.ics, RFC 5545). Der Kalender des Geraets uebernimmt daraus den
 * Termin und die Erinnerung - auch offline, auch wenn COSMOS laengst nicht
 * mehr geoeffnet ist.
 *
 * Google Calendar ignoriert Erinnerungen in importierten .ics-Dateien. Deshalb
 * gibt es zusaetzlich einen Google-Link; dort setzt Google seine eigene
 * Erinnerung selbst.
 */

// Fliesstext in eine ICS-Zeilenangabe: Komma, Semikolon und Backslash sind
// Trennzeichen und muessen mit einem Backslash escaped werden.
function icsText(value){
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// Zeitstempel als UTC, Format YYYYMMDDTHHMMSSZ. Pflicht fuer DTSTAMP.
function icsZeit(ms){
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Zeitstempel in der lokalen Zeit des Geraets, OHNE Z-Suffix ("floating").
// iOS ordnet eine solche Zeit der Geraete-Zeitzone zu und legt den Termin an.
// Ein UTC-Wert (mit Z) liess den Termin auf Apple-Geraeten beim Antippen von
// "Hinzufuegen" wirkungslos - der Kalender zeigte die Vorschau, tat aber
// nichts. Ganztags war davon nicht betroffen, weil dort nur ein Datum steht.
function icsZeitLokal(ms){
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Nur Datum, Format YYYYMMDD - fuer ganztaegige Ereignisse.
function icsDatum(ms){
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

// Der Standard erlaubt hoechstens 75 Byte je Zeile. Laengere Zeilen werden an
// einer Wortgrenze umgebrochen und mit einem Leerzeichen fortgesetzt - ohne das
// lehnen manche Kalender die ganze Datei ab.
function icsZeileBricht(text){
  const zeilen = [];
  let rest = text;
  while (rest.length > 74) {
    let schnitt = 74;
    const treffer = rest.lastIndexOf(" ", 74);
    if (treffer > 40) schnitt = treffer;
    zeilen.push(rest.slice(0, schnitt));
    rest = " " + rest.slice(schnitt);
  }
  zeilen.push(rest);
  return zeilen.join("\r\n");
}

// Wie lange vor dem Ereignis erinnert werden soll.
export const KALENDER_VORWAHRUNG = 30; // Minuten

// Baut den Termin. Die Angaben kommen direkt aus dem Ereignis, damit Datum und
// Uhrzeit garantiert der Anzeige entsprechen - in UTC, damit der Kalender des
// Geraets daraus die lokale Zeit macht. Bei falschen Zonen liegen Termine sonst
// stundenweise daneben.
export function buildEventIcs(ev, titel, beschreibung, quelleUrl){
  const startMs = Number(ev.startMs);
  if(!Number.isFinite(startMs)) return null;

  const ganztag = !!ev.allDay;
  const end = Number.isFinite(ev.endMs) && ev.endMs > startMs
    ? ev.endMs
    : startMs + (Number(ev.duration) || 1) * 3600000;

  // Bei einem Dauereintrag ohne Ende (ISS live) waere ein unendlicher Termin
  // unbrauchbar. Solche Eintraege bekommen gar keine Kalenderdatei.
  if(!Number.isFinite(end)) return null;

  const uid = `${String(ev.id).replace(/[^\w.@-]/g, "-")}@cosmos`;

  // Die Beschreibung genau einmal schreiben. Zwei DESCRIPTION-Zeilen waeren
  // undefiniertes Verhalten - die meisten Kalender nimmen nur die erste und
  // zeigen die Quellenangabe gar nicht.
  const vollText = quelleUrl ? `${beschreibung}\n\nQuelle: ${quelleUrl}` : beschreibung;

  // Kopf der Datei. Ganztag behaelt METHOD/X-WR-CALNAME wie bisher (dieser
  // Weg funktioniert auf Apple-Geraeten). Fuer zeitgebundene Einzeltermine
  // werden die beiden Abo-Felder bewusst weggelassen: sie kennzeichnen einen
  // ganzen Kalender, nicht einen einzelnen Termin, und stoerten iOS beim
  // Hinzufuegen.
  const kopf = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//COSMOS//Astronomie//DE",
    "CALSCALE:GREGORIAN",
  ];
  if(ganztag) kopf.push("METHOD:PUBLISH", "X-WR-CALNAME:COSMOS");

  const zeilen = [
    ...kopf,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsZeit(Date.now())}`,
    ganztag ? `DTSTART;VALUE=DATE:${icsDatum(startMs)}`
            : `DTSTART:${icsZeitLokal(startMs)}`,
    ganztag ? `DTEND;VALUE=DATE:${icsDatum(end)}`
            : `DTEND:${icsZeitLokal(end)}`,
    `SUMMARY:${icsText(titel)}`,
    `DESCRIPTION:${icsText(vollText)}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "SEQUENCE:0",
  ];

  if(quelleUrl) zeilen.push(`URL:${icsText(quelleUrl)}`);

  // Ganztagestermine erinnert man am Vortag, Zeittermine eine halbe Stunde
  // vorher. Ohne diesen Block steht der Termin ohne Erinnerung im Kalender.
  const vorlauf = ganztag ? "-P1D" : `-PT${KALENDER_VORWAHRUNG}M`;
  zeilen.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `TRIGGER:${vorlauf}`,
    `DESCRIPTION:${icsText(titel)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );

  return zeilen.map(icsZeileBricht).join("\r\n");
}

function icsDateiname(ev, titel){
  const d = new Date(Number(ev.startMs));
  const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `COSMOS-${tag}-${titel}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) + ".ics";
}

// Der MIME-Typ ist auf Apple-Geraeten entscheidend und darf KEIN charset
// tragen. Mit "text/calendar;charset=utf-8" (oder einem Byte-Order-Mark am
// Dateianfang) erkennt iOS die Datei nicht als Kalendereintrag.
const ICS_MIME = "text/calendar";

// Erkennt iPhone und iPad - auch das iPad im Desktop-Modus, das sich sonst
// als Mac ausgibt (MacIntel mit Touch-Punkten).
function istApfelMobil(){
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
}

// Auf iPhone und iPad fuehrt genau ein Weg zum nativen Kalender-Fenster:
// Man oeffnet die .ics wie eine Webseite, statt sie herunterzuladen. Safari
// gibt eine Ressource vom Typ text/calendar dann an die Kalender-App weiter,
// die ihr Fenster mit "Hinzufuegen" zeigt - Datum, Titel und Erinnerung kommen
// direkt aus den Angaben der App. Der Teilen-Dialog ist ein anderer Weg und
// wird hier bewusst nicht mehr benutzt.
//
// Ohne "download"-Attribut wandert der Browser weiter, statt still zu
// speichern. Das ist derselbe Mechanismus wie ein gewoehnlicher .ics-Link.
function oeffneImKalender(inhalt){
  const blob = new Blob([inhalt], { type: ICS_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_self";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Adresse erst spaet freigeben, sonst bricht Safari die Uebergabe ab.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function deliverEventIcs(ev, titel, beschreibung){
  const inhalt = buildEventIcs(ev, titel, beschreibung);
  if(!inhalt) return { ok: false, grund: "kein Datum" };

  // iPhone/iPad: natives Kalender-Fenster.
  if(istApfelMobil()){
    oeffneImKalender(inhalt);
    return { ok: true, weg: "kalender" };
  }

  // Windows, Android, Mac-Desktop: die Datei oeffnet der Nutzer anschliessend
  // in seinem Kalender. Bewusst ohne BOM und ohne charset - siehe oben.
  const name = icsDateiname(ev, titel);
  const blob = new Blob([inhalt], { type: ICS_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, weg: "download" };
}

// Google-Calendar-Link. Google setzt dort seine eigene Erinnerung, weil es
// die aus der .ics-Datei verwirft. Datum und Zeit kommen als lokale Zeit ohne
// Sekunden, weil Google sonst gerundete Werte anzeigt.
export function googleCalendarUrl(ev, titel, beschreibung){
  const startMs = Number(ev.startMs);
  if(!Number.isFinite(startMs)) return null;
  const pad = n => String(n).padStart(2, "0");
  // Sekunden mitschreiben: ohne sie rundet Google auf die Minute, dann zeigt
  // der Google-Termin bis zu 59 Sekunden ein anderes Datum als die .ics-Datei.
  const lokal = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const end = Number.isFinite(ev.endMs) && ev.endMs > startMs
    ? new Date(ev.endMs)
    : new Date(startMs + (Number(ev.duration) || 1) * 3600000);

  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: titel,
    dates: `${lokal(new Date(startMs))}/${lokal(end)}`,
    details: beschreibung,
    sprop: "website"
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}