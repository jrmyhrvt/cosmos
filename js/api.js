import { fmtClock, renderAll, sortEventsAutomatically } from "./events/eventManager.js";
import { currentLang } from "./main.js";
import { MONTH_INDEX, TRANSLATIONS, cleanFeedText, refineGlostarId } from "./translations.js";
export let lastUpdatedTime = "--:--:--";
export let EVENTS = [
  {id: "iss-live", nameKey: "iss_name", date: "1998-11-20T06:40:00Z", startMs: Date.parse("1998-11-20T06:40:00Z"), endMs: Infinity, icon: "satellite", duration: 999999, descKey: "iss_desc", glostarId: "iss", kindKey: "cat_live_space", statusKey: "active", isPermanentLive: true, liveOnly: true, sources:["Wheretheiss.at"], sourceKeys:["iss"], category:"live"}
];

// Laufende, gerade laufende Ereignisse bekommen automatisch den Status "live".
export const MIN_EVENT_MS = Date.UTC(1900,0,1);
export const MAX_EVENT_MS = Date.UTC(2200,0,1);

export function utcDate(y, mo, d, h, mi, s){
  if(!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if(mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo, d, h || 0, mi || 0, s || 0);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function parseCosmosDate(value){
  if(value === null || value === undefined || value === "") return null;
  if(value instanceof Date) return isNaN(value.getTime()) ? null : value;

  // Unix-Zeitstempel: Sekunden oder Millisekunden
  if(typeof value === "number"){
    if(!Number.isFinite(value)) return null;
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const raw = String(value).trim();
  if(!raw) return null;
  if(/^-?\d{9,13}$/.test(raw)) return parseCosmosDate(Number(raw));

  // 1) ISO 8601 mit Zonen-Angabe (Z oder +02:00)
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.test(raw)){
    const d = new Date(raw.replace(" ", "T"));
    if(!isNaN(d.getTime())) return d;
  }

  // 2) NASA/JPL CNEOS liefert z. B. "2026-Sep-27 21:15" (UTC).
  //    Das Format ist weder ISO 8601 noch RFC 2822 - new Date() liefert
  //    dafuer "Invalid Date" und wuerde das komplette JPL-Ergebnis verwerfen.
  let m = raw.match(/^(\d{4})-([A-Za-z]{3,9})[a-z]*-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){
    const mo = MONTH_INDEX[m[2].slice(0,3).toLowerCase()];
    if(mo !== undefined) return utcDate(+m[1], mo, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }

  // 3) "2026-09-27 21:15", "2026-09-27T21:15:00", "2026-09-27".
  //    Ohne Zonen-Angabe veröffentlichen die Quellen in UTC, deshalb wird
  //    hier bewusst nicht die lokale Browser-Zeitzone verwendet.
  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if(m) return utcDate(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));

  // 4) "Sep 27, 2026 21:15" und "27.09.2026 21:15"
  m = raw.match(/^([A-Za-z]{3,9})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:[T ](\d{1,2}):(\d{2}))?/);
  if(m){
    const mo = MONTH_INDEX[m[1].slice(0,3).toLowerCase()];
    if(mo !== undefined) return utcDate(+m[3], mo, +m[2], +(m[4]||0), +(m[5]||0), 0);
  }
  m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T ](\d{1,2}):(\d{2}))?/);
  if(m) return utcDate(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), 0);

  // 5) Letzte Moeglichkeit: der Standardparser (RFC 2822 und Co.)
  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// Moegliche Feldnamen fuer Start / Ende / Dauer - tolerant gegenueber
// unterschiedlichen Quellen und deren Versionen.
export const START_KEYS   = ["start","startDate","start_date","startTime","start_time","startsAt","date","datetime","dateTime","time_tag","timeTag","when","peak","eventDate","event_date"];
export const END_KEYS     = ["end","endDate","end_date","endTime","end_time","endsAt","finish","to"];
export const DURATION_H   = ["duration","duration_hours","durationHours","duration_h"];
export const DURATION_MIN = ["duration_minutes","durationMinutes","duration_m"];

export function pickRaw(item, keys){
  if(!item || typeof item !== "object") return null;
  for(const key of keys){
    const value = item[key];
    if(value === undefined || value === null) continue;
    if(typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

export function isAllDayItem(item){
  const flag = item?.allDay ?? item?.all_day ?? item?.allday;
  return flag === true || String(flag).toLowerCase() === "true";
}

export function getItemStart(item) {
  return parseCosmosDate(pickRaw(item, START_KEYS));
}

export function getItemEnd(item, startDate) {
  // 1) Ausdrueckliches Enddatum - aber nur wenn es nach dem Start liegt.
  const endValue = pickRaw(item, END_KEYS);
  if(endValue !== null){
    const parsed = parseCosmosDate(endValue);
    if(parsed && (!startDate || parsed.getTime() > startDate.getTime())) return parsed;
  }

  // 2) Ausdrueckliche Dauer
  if(startDate){
    const hours = Number(pickRaw(item, DURATION_H));
    if(Number.isFinite(hours) && hours > 0) return new Date(startDate.getTime() + hours * 3600000);
    const minutes = Number(pickRaw(item, DURATION_MIN));
    if(Number.isFinite(minutes) && minutes > 0) return new Date(startDate.getTime() + minutes * 60000);
  }

  // 3) Ganztaegige Ereignisse dauern einen Tag. Astronomische
  //    Augenblicksereignisse bleiben kurz, statt kuenstlich aufgeblaeht
  //    zu werden - so erfindet COSMOS keine Ereignisdauer.
  if(startDate){
    const fallback = isAllDayItem(item) ? 24 * 3600000 : 60000;
    return new Date(startDate.getTime() + fallback);
  }
  return null;
}

export function getStableEventId(item) {
  const sourceId = pickRaw(item, ["id","uid","eventId","event_id","guid"]);
  if (sourceId !== null && String(sourceId).trim()) {
    return `sc-${String(sourceId).split("@")[0].trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 160)}`;
  }

  const title = String(item?.title || item?.name || "event").trim().toLowerCase();
  const start = String(pickRaw(item, START_KEYS) ?? "");
  return `sc-${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${start.replace(/[^0-9a-z]+/gi, '')}`.slice(0, 180);
}

// Die Quelle nennt ihre Kategorie selbst - das ist die verlaesslichste
// Information. Erst wenn sie fehlt, wird der Titel ausgewertet.
export const CATEGORY_BY_SOURCE = {
  "moon-phases":"moon",
  "meteor-showers":"meteor",
  "eclipses-solar":"eclipse",
  "eclipse":"eclipse",
  "eclipses-lunar":"eclipse",
  "solstices-equinoxes":"season",
  "season":"season",
  "oppositions":"planet",
  "elongations":"planet",
  "conjunctions":"planet",
  "alignments":"planet",
  "occultations":"occultation",
  "asteroids":"close-approach",
  "close-approach":"close-approach",
  "comets":"comet",
  "launches":"launch",
  "mission-milestones":"mission",
  "history":"history",
  "deep-sky":"deep-sky",
  "space-weather":"space-weather",
  "aurora":"aurora"
};

export function getEventCategory(item) {
  const title = String(item?.title || item?.name || "").toLowerCase();
  const rawCategory = Array.isArray(item?.categories)
    ? item.categories.join(" ")
    : String(item?.category || item?.type || "");
  const category = rawCategory.toLowerCase().trim();

  // 1) Kategorie der Quelle
  for(const token of category.split(/[\s,/]+/).filter(Boolean)){
    if(CATEGORY_BY_SOURCE[token]){
      const mapped = CATEGORY_BY_SOURCE[token];
      // Jahreszeiten unterscheidet der Titel, die Quelle sagt nur "season".
      if(mapped === "season"){
        if(title.includes("equinox")) return "equinox";
        if(title.includes("solstice")) return "solstice";
        return "generic";
      }
      return mapped;
    }
  }

  // 2) Rueckfall: Titel und Freitext
  const text = `${title} ${category}`;
  if (text.includes("history") || text.includes("anniversary") || text.includes("years ago")) return "history";
  if (text.includes("meteor")) return "meteor";
  if (text.includes("eclipse")) return "eclipse";
  if (text.includes("occultation")) return "occultation";
  if (text.includes("comet")) return "comet";
  if (text.includes("new moon") || text.includes("full moon") || text.includes("quarter") || text.includes("moon phase") || text.includes("supermoon")) return "moon";
  if (text.includes("equinox")) return "equinox";
  if (text.includes("solstice")) return "solstice";
  if (text.includes("launch") || text.includes("rocket") || text.includes("artemis") || text.includes("falcon") || text.includes("starship")) return "launch";
  if (text.includes("opposition") || text.includes("elongation") || text.includes("conjunction") || text.includes("alignment") || text.includes("planet") || text.includes("mercury") || text.includes("venus") || text.includes("mars") || text.includes("jupiter") || text.includes("saturn")) return "planet";
  if (text.includes("close approach") || text.includes("near-earth") || text.includes("asteroid flyby") || text.includes("earth flyby") || text.includes("erdvorbeiflug") || text.includes("nahvorbeiflug")) return "close-approach";
  if (text.includes("geomagnetic") || text.includes("kp index") || text.includes("solar storm") || text.includes("magnetic storm")) return "space-weather";
  if (text.includes("aurora")) return "aurora";
  return "generic";
}

export function getCategoryMeta(item) {
  const category = getEventCategory(item);
  const meta = {
    moon: {icon:"eclipse", glostarId:"moon-phase", key:"cat_moon"},
    occultation: {icon:"eclipse", glostarId:"verdeckung", key:"cat_occultation"},
    meteor: {icon:"meteor", glostarId:"meteorstrom", key:"cat_meteor"},
    eclipse: {icon:"eclipse", glostarId:"finsternis", key:"cat_eclipse"},
    launch: {icon:"rocket", glostarId:"rakete", key:"cat_launch"},
    planet: {icon:"planet", glostarId:"opposition", key:"cat_planet"},
    equinox: {icon:"planet", glostarId:"jahreszeiten", key:"cat_equinox"},
    solstice: {icon:"planet", glostarId:"jahreszeiten", key:"cat_solstice"},
    aurora: {icon:"star", glostarId:"aurora", key:"cat_aurora"},
    comet: {icon:"comet", glostarId:"comet", key:"cat_comet"},
    mission: {icon:"satellite", glostarId:"sonde", key:"cat_mission"},
    "deep-sky": {icon:"galaxy", glostarId:"deep-sky", key:"cat_deep_sky"},
    "close-approach": {icon:"asteroid", glostarId:"asteroid", key:"cat_close_approach"},
    "space-weather": {icon:"star", glostarId:"solar-wind", key:"cat_space_weather"},
    history: {icon:"star", glostarId:"sonde", key:"cat_history"},
    generic: {icon:"star", glostarId:"orbit", key:"cat_space_cal"}
  };
  return meta[category] || meta.generic;
}

/* --------------------------------------------------------------------------
   FACHWORT IM TITEL
   Die Kategorie allein reicht nicht: "Vollmond - Erdbeermond" ist keine
   Finsternis, und "Planetenkonjunktion" ist keine Opposition. Deshalb wird
   zuerst der Titel geprueft, erst danach greift der Wert der Kategorie.
   Der Button auf dem Detailblatt nennt danach genau das, was im Titel steht.
   -------------------------------------------------------------------------- */
export const SPACE_CALENDAR_CATEGORIES = [
  "moon-phases", "meteor-showers", "eclipses-solar", "eclipses-lunar",
  "solstices-equinoxes", "oppositions", "elongations", "conjunctions",
  "alignments", "occultations", "asteroids", "launches",
  "mission-milestones", "history", "deep-sky"
].join(",");

export const DATA_SOURCES = [
  {
    key: "space-calendar",
    label: "Space Calendar",
    url: `https://space-calendar.lukekorth.com/feed.json?c=${SPACE_CALENDAR_CATEGORIES}`,
    parse: parseSpaceCalendar
  },
  {
    key: "jpl-cad",
    label: "NASA/JPL CNEOS",
    url: "https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B365&dist-max=0.05&neo=true&fullname=true&diameter=true&limit=100&sort=date",
    parse: parseJplCad
  },
  {
    key: "noaa-kp",
    label: "NOAA SWPC",
    url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
    parse: parseNoaaKp
  }
];

export async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // "no-cache" = immer frisch pruefen, aber unveraenderte Antworten werden
    // nur mit 304 bestaetigt. Das spart Bandbreite und schont die APIs.
    const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --- Quelle 1: Space Calendar (ICS-JSON) --------------------------------- */
export function parseSpaceCalendar(payload) {
  const list = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(list)) throw new Error("unerwartete Antwort");

  return list.map(item => {
    if (!item || typeof item !== "object") return null;
    const title = cleanFeedText(item?.title || item?.name || "");
    // Ohne Titel gibt es nichts anzuzeigen - solche Eintraege werden
    // hier verworfen, damit die Fehlerliste nur echte Probleme meldet.
    if (!title) return null;
    const category = String(item?.category || "").toLowerCase().trim();
    const designation = extractObjectDesignation(title);
    const record = {
      uid: item?.uid || item?.id || "",
      title,
      description: String(item?.description || "").trim(),
      url: typeof item?.url === "string" ? item.url : "",
      category,
      startRaw: pickRaw(item, START_KEYS),
      endRaw: pickRaw(item, END_KEYS),
      allDay: isAllDayItem(item),
      designation,
      meta: {}
    };
    // Asteroiden- und Kometen-Vorbeifluege bekommen denselben Typ wie die
    // NASA/JPL-Eintraege. Dadurch werden beide Quellen zu einem Ereignis
    // zusammengefuehrt und in jeder Sprache gleich benannt.
    if (category === "asteroids" || category === "comets" || (designation && /close|flyby|vorbeiflug/i.test(title))) {
      record.type = "close-approach";
      record.fullname = designation;
    }
    return record;
  }).filter(Boolean);
}

/* --- Quelle 2: NASA/JPL CNEOS Close Approach ----------------------------- */
export function cleanObjectName(value) {
  return String(value ?? "").replace(/[()\[\]]/g, " ").replace(/\s+/g, " ").trim();
}

// Fuer die Anzeige: Klammern bleiben lesbar, nur Padding und
// Zeilenumbrueche werden entfernt.
export function cleanDisplayName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// "fullname" ist nur dann besser als "des", wenn es mehr als die nackte
// Nummer sagt: "524522 Zoozve (2002 VE68)" ja, "(2026 RN15)" nein.
export function isInformativeName(value) {
  const text = cleanDisplayName(value);
  if (!text || text.startsWith("(")) return false;
  return /[A-Za-z]{3,}/.test(text.replace(/\([^)]*\)/g, ""));
}

export function extractObjectDesignation(title) {
  const match = String(title || "").match(/\b(?:asteroid|asteroiden|asteroide|comet|komet)\s+([0-9]{4}\s?[A-Za-z]{1,3}\d*|\d{4,6})\b/i);
  return match ? match[1].replace(/\s+/g, " ").trim().toUpperCase() : "";
}

export function parseJplCad(payload) {
  if (!payload || !Array.isArray(payload.data) || !Array.isArray(payload.fields)) {
    throw new Error("unerwartete Antwort");
  }
  const idx = Object.fromEntries(payload.fields.map((field, i) => [String(field).toLowerCase(), i]));
  const cell = (row, key) => (idx[key] === undefined ? undefined : row[idx[key]]);

  return payload.data.map(row => {
    // "des" ist die kanonische JPL-Bezeichnung, "fullname" enthaelt oft den
    // echten Namen: aus "524522" wird "524522 Zoozve (2002 VE68)".
    // Fuer die Anzeige wird der informativere Name genutzt, fuer den
    // Abgleich mit anderen Quellen weiterhin die kanonische Bezeichnung.
    const des = cleanObjectName(cell(row, "des"));
    const fullname = cleanDisplayName(cell(row, "fullname"));
    const name = isInformativeName(fullname) ? fullname : (des || cleanObjectName(fullname));
    if (!name) return null;

    const distanceAu = Number(cell(row, "dist"));
    const diameterRaw = cell(row, "diameter");
    const diameterKm = diameterRaw === null || diameterRaw === undefined || diameterRaw === "" ? null : Number(diameterRaw);
    const vRel = Number(cell(row, "v_rel"));

    // Fuer den Abgleich mit anderen Quellen (Space Calendar) muss hier die
    // kanonische JPL-Kennung stehen, nicht der Anzeigename - sonst findet
    // die Zusammenfuehrung nummerierter Objekte nicht statt.
    const canonical = (des || name).toUpperCase();

    return {
      uid: `cad-${canonical}-${String(cell(row, "cd") ?? "")}`,
      title: name,
      description: "",
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(name)}`,
      category: "asteroids",
      type: "close-approach",
      designation: canonical,
      // "2026-Sep-27 21:15" wird von parseCosmosDate gelesen, nicht von new Date().
      startRaw: cell(row, "cd"),
      endRaw: null,
      allDay: false,
      meta: {
        designation: canonical,
        distanceAu: Number.isFinite(distanceAu) ? distanceAu : null,
        diameterKm: Number.isFinite(diameterKm) ? diameterKm : null,
        vRelKms: Number.isFinite(vRel) ? vRel : null
      }
    };
  }).filter(Boolean);
}

/* --- Quelle 3: NOAA Space Weather Prediction Center ---------------------- */
export function parseNoaaKp(payload) {
  if (!Array.isArray(payload)) throw new Error("unerwartete Antwort");

  let rows = [];
  if (payload.length && Array.isArray(payload[0])) {
    // Aelteres Format: [[Spaltennamen], [Werte], ...]
    const header = payload[0].map(value => String(value).toLowerCase());
    rows = payload.slice(1).map(row => ({
      time_tag: row[header.indexOf("time_tag")],
      kp: row[header.indexOf("kp")],
      observed: row[header.indexOf("observed")],
      noaa_scale: row[header.indexOf("noaa_scale")]
    }));
  } else if (payload.length && typeof payload[0] === "object" && payload[0] !== null) {
    // Aktuelles Format: ein Objekt pro Zeile
    rows = payload;
  } else {
    throw new Error("unbekanntes Format");
  }

  // Nur Prognosewerte mit erhoehtem Kp-Index werden zu Ereignissen.
  // Gemessene Kp-Werte der Vergangenheit sind keine Vorhersage.
  const slots = rows
    .map(row => ({
      time: parseCosmosDate(row?.time_tag ?? row?.timeTag ?? row?.date),
      kp: Number(row?.kp),
      scale: String(row?.noaa_scale ?? "").trim(),
      observed: String(row?.observed ?? "").toLowerCase().trim()
    }))
    .filter(slot => slot.time && Number.isFinite(slot.kp) && slot.kp >= 5 && slot.observed !== "observed")
    .sort((a, b) => a.time - b.time);

  // Aufeinanderfolgende 3-Stunden-Slots desselben Sturms werden zu einem
  // Ereignis zusammengefasst - so entstehen keine Dubletten.
  const storms = [];
  for (const slot of slots) {
    const last = storms[storms.length - 1];
    if (last && slot.time.getTime() - last.end.getTime() <= 6 * 3600000) {
      last.end = slot.time;
      last.kp = Math.max(last.kp, slot.kp);
      last.scale = last.scale || slot.scale;
    } else {
      storms.push({ start: slot.time, end: slot.time, kp: slot.kp, scale: slot.scale });
    }
  }

  return storms.map(storm => ({
    uid: `kp-${storm.start.toISOString()}`,
    title: "Geomagnetic Storm Forecast",
    description: "",
    url: "https://www.swpc.noaa.gov/products/planetary-k-index",
    category: "space-weather",
    type: "space-weather",
    startRaw: storm.start.toISOString(),
    endRaw: new Date(storm.end.getTime() + 3 * 3600000).toISOString(),
    allDay: false,
    kp: storm.kp,
    noaaScale: storm.scale,
    meta: { kp: storm.kp, scale: storm.scale, forecast: true }
  }));
}

/* --- Normalisierung + Validierung ---------------------------------------- */
export function buildEventId(sourceKey, record, startMs, taken) {
  const base = String(record.uid || record.title || "event")
    .split("@")[0]
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110) || "event";
  let id = `${sourceKey}-${base}`;
  let counter = 2;
  // "taken" gehoert zu genau einem Durchlauf. So kann eine ID weder beim
  // naechsten Sync noch nach einem Sprachwechsel verrutschen.
  while (taken.has(id)) id = `${sourceKey}-${base}-${startMs}-${counter++}`;
  taken.add(id);
  return id;
}

export function normalizeRecord(record, source, taken) {
  if (!record || typeof record !== "object") return { error: "kein Datensatz" };

  const title = cleanFeedText(record.title);
  if (!title) return { error: "kein Titel" };

  const start = parseCosmosDate(record.startRaw);
  if (!start) return { error: "kein verwertbares Datum", raw: record.startRaw };
  const startMs = start.getTime();
  if (startMs < MIN_EVENT_MS || startMs > MAX_EVENT_MS) {
    return { error: "Datum ausserhalb des gueltigen Bereichs", raw: record.startRaw };
  }

  // Ein Enddatum wird nur uebernommen, wenn es wirklich nach dem Start liegt.
  const parsedEnd = parseCosmosDate(record.endRaw);
  const endMs = parsedEnd && parsedEnd.getTime() > startMs
    ? parsedEnd.getTime()
    : startMs + (record.allDay ? 24 * 3600000 : 60000);

  const probe = { title, category: record.category, type: record.type };
  const category = getEventCategory(probe);
  const meta = getCategoryMeta(probe);

  const rawItem = {
    title,
    type: record.type || "",
    category: record.category || "",
    fullname: record.fullname || record.designation || "",
    kp: record.kp,
    noaaScale: record.noaaScale
  };

  return {
    event: {
      id: buildEventId(source.key, record, startMs, taken),
      rawItem,
      rawItems: [rawItem],
      rawTitle: title,
      description: record.description || "",
      // Ohne eigene Link-Adresse zeigt die Detailansicht auf die Quelle,
      // aus der das Ereignis stammt - so ist immer nachvollziehbar.
      sourceUrl: /^https?:\/\//i.test(record.url || "") ? record.url : (source.url || ""),
      sourceKeys: [source.key],
      sources: [source.label],
      designation: record.designation || "",
      category,
      date: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
      startMs,
      endMs,
      duration: Math.max(1 / 60, (endMs - startMs) / 3600000),
      allDay: !!record.allDay,
      meta: record.meta || {},
      icon: meta.icon,
      kindKey: meta.key,
      // Bracket-Zugriff: der Dot-Zugriff auf "glostarId" liefert in manchen
      // Browser-Builds (Edge 154) undefined, obwohl der Wert vorhanden ist.
      glostarId: refineGlostarId(title, meta["glostarId"]),
      statusKey: "planned"
    }
  };
}

export function collectEvents(records, source) {
  const accepted = [];
  const rejected = [];
  // Jeder Durchlauf bekommt einen eigenen Satz vergebener IDs.
  const taken = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const result = normalizeRecord(record, source, taken);
    if (result.error) rejected.push({ ...result, source: source.label, title: cleanFeedText(record?.title) });
    else accepted.push(result.event);
  }
  return { accepted, rejected };
}

/* --- Duplikatpruefung ----------------------------------------------------- */
export function titleFingerprint(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isSameEvent(a, b) {
  if (a.category !== b.category) return false;
  if (Math.abs(a.startMs - b.startMs) > 24 * 3600000) return false;
  // Gleicher Himmelskoerper heisst gleiches Ereignis - damit werden
  // Space-Calendar- und NASA/JPL-Eintraege zusammengefuehrt.
  if (a.designation && b.designation && a.designation === b.designation) return true;
  const fa = titleFingerprint(a.rawTitle);
  const fb = titleFingerprint(b.rawTitle);
  if (!fa || !fb) return false;
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}

export function mergeEvent(target, extra) {
  target.sources = Array.from(new Set([...(target.sources || []), ...(extra.sources || [])]));
  target.sourceKeys = Array.from(new Set([...(target.sourceKeys || []), ...(extra.sourceKeys || [])]));
  target.rawItems = [...(target.rawItems || []), ...(extra.rawItems || [])];
  if (extra.meta && Object.keys(extra.meta).length) target.meta = { ...(target.meta || {}), ...extra.meta };
  if (!target.description && extra.description) target.description = extra.description;
  if (!target.sourceUrl && extra.sourceUrl) target.sourceUrl = extra.sourceUrl;
  if (extra.endMs > target.endMs) {
    target.endMs = extra.endMs;
    target.endDate = new Date(extra.endMs).toISOString();
    target.duration = Math.max(1 / 60, (extra.endMs - target.startMs) / 3600000);
  }
  return target;
}

export function addEvent(list, event) {
  for (const existing of list) {
    if (existing.id === event.id || isSameEvent(existing, event)) {
      mergeEvent(existing, event);
      return "merged";
    }
  }
  list.push(event);
  return "added";
}

/* --- Offline-Cache -------------------------------------------------------- */
export const EVENT_CACHE_KEY = "cosmos.events.v1";

export function saveEventCache() {
  try {
    const events = EVENTS.filter(event => !event.isPermanentLive);
    localStorage.setItem(EVENT_CACHE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), events }));
  } catch (err) {
    console.warn("[COSMOS] Offline-Cache konnte nicht gespeichert werden:", err?.message || err);
  }
}

export function loadEventCache() {
  try {
    const raw = localStorage.getItem(EVENT_CACHE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) return 0;
    const events = parsed.events.filter(event => event && event.id && Number.isFinite(event.startMs));
    if (!events.length) return 0;
    EVENTS = [EVENTS.find(event => event.isPermanentLive), ...events].filter(Boolean);
    sortEventsAutomatically();
    console.info(`[COSMOS] Offline-Cache: ${events.length} Events (Stand ${new Date(parsed.savedAt || Date.now()).toISOString()})`);
    return events.length;
  } catch (err) {
    console.warn("[COSMOS] Offline-Cache unlesbar:", err?.message || err);
    return 0;
  }
}

/* --- Synchronisation ------------------------------------------------------ */
export let syncInFlight = false;
export let lastSyncAt = 0;
export let lastSyncReport = null;

export async function loadSource(source) {
  try {
    const payload = await fetchJson(source.url);
    const records = source.parse(payload);
    return { key: source.key, label: source.label, url: source.url, ok: true, records: Array.isArray(records) ? records : [] };
  } catch (err) {
    const message = err?.name === "AbortError" ? "Zeitüberschreitung" : (err?.message || String(err));
    return { key: source.key, label: source.label, url: source.url, ok: false, error: message, records: [] };
  }
}

export function logSyncReport(report) {
  console.groupCollapsed(`%c[COSMOS] Event-Sync ${new Date(lastSyncAt).toISOString()}`, "color:#fff;font-weight:700");
  report.results.forEach(result => {
    if (result.ok) console.log(`  ✓ ${result.label}: ${result.count} Events übernommen`);
    else console.warn(`  ✗ ${result.label}: fehlgeschlagen — ${result.error}`);
  });
  if (report.rejected.length) {
    const reasons = report.rejected.reduce((acc, item) => {
      acc[item.error] = (acc[item.error] || 0) + 1;
      return acc;
    }, {});
    console.warn(`  ! ${report.rejected.length} Einträge verworfen:`, reasons);
  }
  if (report.merged) console.log(`  = ${report.merged} Dubletten zusammengeführt`);
  if (report.reused) console.log(`  ↺ ${report.reused} Events aus ausgefallenen Quellen weiterverwendet`);
  console.groupEnd();
}

export function updateSyncInfo() {
  const el = document.getElementById("updateInfo");
  if (!el) return;
  const t = TRANSLATIONS[currentLang];
  const report = lastSyncReport;
  if (!report) {
    el.textContent = t.loading;
    return;
  }

  const total = EVENTS.filter(event => !event.isPermanentLive).length;
  if (!total) {
    el.textContent = t.error_feed;
    return;
  }

  const okCount = report.results.filter(result => result.ok).length;
  lastUpdatedTime = fmtClock(new Date(lastSyncAt));
  const parts = [`${t.updated} ${lastUpdatedTime}`, `${total} ${t.total}`, `${okCount}/${report.results.length} ${t.sources_ok}`];
  if (report.reused) parts.push(t.cache_used);
  el.textContent = parts.join(" · ");
  el.title = report.results
    .map(result => `${result.ok ? "✓" : "✗"} ${result.label}: ${result.ok ? `${result.count} Events` : result.error}`)
    .join("\n");
}

export async function fetchSpaceCalendarFeed() {
  if (syncInFlight) return;
  syncInFlight = true;

  try {
    const results = await Promise.all(DATA_SOURCES.map(loadSource));

    const previous = EVENTS.filter(event => !event.isPermanentLive);
    const fresh = [];
    const rejected = [];
    let merged = 0;

    for (const result of results) {
      const { accepted, rejected: invalid } = collectEvents(result.records, { key: result.key, label: result.label, url: result.url });
      rejected.push(...invalid);
      result.count = accepted.length;
      for (const event of accepted) {
        if (addEvent(fresh, event) === "merged") merged++;
      }
    }

    // Ausgefallene Quellen: bereits geladene Events weiterverwenden,
    // damit ein API-Ausfall keine Events aus der Liste loescht.
    const failedKeys = results.filter(result => !result.ok).map(result => result.key);
    let reused = 0;
    if (failedKeys.length) {
      for (const old of previous) {
        if (!(old.sourceKeys || []).some(key => failedKeys.includes(key))) continue;
        // Die ID des wiederverwendeten Events bleibt erhalten, damit offene
        // Detailseiten und der Cache weiterhin darauf zeigen.
        if (addEvent(fresh, old) === "added") reused++;
      }
    }

    EVENTS = [EVENTS.find(event => event.isPermanentLive), ...fresh].filter(Boolean);
    sortEventsAutomatically();

    lastSyncAt = Date.now();
    lastSyncReport = { results, rejected, total: fresh.length, merged, reused, ok: results.some(result => result.ok) };
    logSyncReport(lastSyncReport);
    updateSyncInfo();
    saveEventCache();
    renderAll();
  } catch (err) {
    // Sollte nie eintreten - aber ein Fehler hier darf die App nie anhalten.
    console.error("[COSMOS] Event-Sync unerwarteter Fehler:", err);
    updateSyncInfo();
  } finally {
    syncInFlight = false;
  }
}
