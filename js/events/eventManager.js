import { EVENTS, getEventCategory, updateSyncInfo } from "../api.js";
import { glostarLookupLabel, jumpToGloStar } from "../glostar/glostar.js";
import { formatIssLat, formatIssLon, globeZoomRaus, globeZoomReset, mountGlobe, pruneGlobes, updateIssReadouts } from "../iss/issManager.js";
import { renderIssPass } from "../iss/issPassView.js";
import { currentLang } from "../main.js";
import { deliverEventIcs, googleCalendarUrl } from "./calendarExport.js";
import { FEED_I18N, SVG_ICONS, TRANSLATIONS, cleanFeedText, extractFeedFacts, localizeRegions, translateFeedTitle } from "../translations.js";
export let tzOffsetHours = 2; 
export function eventState(ev, now = Date.now()){
  if(ev.isPermanentLive) return "live";
  const start = ev.startMs;
  if(!Number.isFinite(start)) return "upcoming";
  if(now < start) return "upcoming";
  const end = ev.endMs;
  if(Number.isFinite(end) && now < end) return "live";
  return "passed";
}


export function sortEventsAutomatically() {
  EVENTS.sort((a, b) => {
    if (a.isPermanentLive) return -1;
    if (b.isPermanentLive) return 1;
    // Ungueltige Daten wandern ans Ende, statt die Sortierung zu zerstoeren.
    const av = Number.isFinite(a.startMs) ? a.startMs : Infinity;
    const bv = Number.isFinite(b.startMs) ? b.startMs : Infinity;
    return av - bv;
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Echtes NASA-ISS-Modell (glTF). Die Datei ist gross, deshalb werden sowohl das
// Viewer-Skript als auch das Modell erst geladen, wenn die ISS-Detailseite
// wirklich offen ist - alle anderen Seiten bleiben dadurch leicht. Das Skript
// kommt von einem CDN, die Modelldatei liegt im Repo (CORS bei NASA erlaubt nur
// die eigene Domain, ein direkter Zugriff aus der App waere blockiert).
const MODEL_VIEWER_VERSION = "4.3.1";
let modelViewerLaden = null;
function ladeModelViewer(){
  if(modelViewerLaden) return modelViewerLaden;
  modelViewerLaden = new Promise((fertig, fehler) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = `https://cdn.jsdelivr.net/npm/@google/model-viewer@${MODEL_VIEWER_VERSION}/dist/model-viewer.min.js`;
    s.onload = fertig;
    s.onerror = () => { modelViewerLaden = null; fehler(new Error("model-viewer")); };
    document.head.appendChild(s);
  });
  return modelViewerLaden;
}

/* --------------------------------------------------------------------------
   Datum: eine Stelle im Code entscheidet, wie jedes Datum einer Quelle
   gelesen wird. Kein Event darf nur wegen eines unbekannten Datumsformats
   verloren gehen oder die App zum Absturz bringen.
   -------------------------------------------------------------------------- */
export function getLocalizedApiText(item) {
  const rawTitle = cleanFeedText(item?.title || item?.name || "Space event");
  const itemType = String(item?.type || item?.category || "").toLowerCase();
  const t = TRANSLATIONS[currentLang];

  // These internally generated records contain language-neutral metadata.
  // Build their visible title from the currently selected language every time,
  // so switching DE/EN/ES never leaves a stale translated string behind.
  if(itemType === "close-approach") {
    const objectName = cleanFeedText(item?.fullname || item?.name || "Near-Earth Object");
    const title = currentLang === "de" ? `Asteroiden-Vorbeiflug: ${objectName}` : currentLang === "es" ? `Sobrevuelo de asteroide: ${objectName}` : `Asteroid flyby: ${objectName}`;
    return {title: escapeHtml(title), desc: escapeHtml(t.desc_close_approach)};
  }
  if(itemType === "space-weather") {
    const kp = Number(item?.kp);
    const title = currentLang === "de" ? "Prognose: Geomagnetischer Sturm" : currentLang === "es" ? "Pronóstico: Tormenta Geomagnética" : "Forecast: Geomagnetic Storm";
    const suffix = Number.isFinite(kp) ? ` · Kp ${kp.toFixed(1)}` : "";
    return {title: escapeHtml(title + suffix), desc: escapeHtml(t.desc_geomagnetic_forecast)};
  }
  const lower = rawTitle.toLowerCase();
  const category = getEventCategory(item);

  let descKey = "desc_generic";
  if (category === "moon") {
    if (lower.includes("new moon")) descKey = "desc_new_moon";
    else if (lower.includes("supermoon")) descKey = "desc_supermoon";
    else if (lower.includes("full moon")) descKey = "desc_full_moon";
    else descKey = "desc_quarter_moon";
  } else if (category === "eclipse") descKey = "desc_eclipse";
  else if (category === "occultation") descKey = "desc_occultation";
  else if (category === "meteor") descKey = "desc_meteor";
  else if (category === "comet") descKey = "desc_comet";
  else if (category === "mission") descKey = "desc_mission";
  else if (category === "deep-sky") descKey = "desc_deep_sky";
  else if (category === "equinox") descKey = "desc_equinox";
  else if (category === "solstice") descKey = "desc_solstice";
  else if (category === "launch") descKey = "desc_launch";
  else if (category === "planet" && lower.includes("conjunction")) descKey = "desc_conjunction";

  // Vollstaendige Satzmuster statt Einzelwoerter - siehe FEED_I18N oben.
  const translatedTitle = translateFeedTitle(rawTitle, currentLang);

  // Der englische Fliesstext bleibt als Original erhalten, die Messdaten
  // werden herausgeloest und in der gewaehlten Sprache beschriftet.
  const sourceText = String(item?.description || "").trim();
  const facts = extractFeedFacts(sourceText);
  if(facts.visibleFrom) facts.visibleFrom = localizeRegions(facts.visibleFrom, currentLang);

  return {
    title: escapeHtml(translatedTitle),
    desc: escapeHtml(t[descKey] || t.desc_generic),
    sourceText,
    facts
  };
}

/* --------------------------------------------------------------------------
   DATENQUELLEN
   Bestehende Quellen bleiben erhalten. Jede wird einzeln geladen und
   geprueft: faellt eine aus, laufen die anderen weiter.
   -------------------------------------------------------------------------- */

// Kategorienamen laut Space-Calendar-Feed. Die zuvor verwendeten Namen
// ("eclipses", "planetary-events", "rocket-launches", "space-history") sind
// ungueltig und liefern 0 Ereignisse - deshalb sind sie hier korrigiert.
export function changeOffset(val){
  tzOffsetHours += val;
  if(tzOffsetHours > 14) tzOffsetHours = 14;
  if(tzOffsetHours < -12) tzOffsetHours = -12;
  document.getElementById('tzDisplay').textContent = `UTC${tzOffsetHours>=0?'+':''}${tzOffsetHours}`;
  renderAll();
  updateSyncInfo();
}

export function fmtTime(d){
  if(!(d instanceof Date) || !Number.isFinite(d.getTime())) return "--";
  const adjusted = new Date(d.getTime() + tzOffsetHours * 3600000);
  return new Intl.DateTimeFormat(currentLang === 'es' ? 'es-ES' : currentLang === 'en' ? 'en-US' : 'de-DE',{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(adjusted) + ` (UTC${tzOffsetHours>=0?'+':''}${tzOffsetHours})`;
}

// Ganztaegige Ereignisse bekommen nur das Datum - eine Uhrzeit waere erfunden.
export function fmtDate(d){
  if(!(d instanceof Date) || !Number.isFinite(d.getTime())) return "--";
  const adjusted = new Date(d.getTime() + tzOffsetHours * 3600000);
  return new Intl.DateTimeFormat(currentLang === 'es' ? 'es-ES' : currentLang === 'en' ? 'en-US' : 'de-DE',{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric"}).format(adjusted);
}

export function fmtEventTime(ev){
  if(!ev) return "--";
  if(ev.isPermanentLive) return TRANSLATIONS[currentLang].live_tracking;
  // Ein defekter Zeitstempel darf die ganze Liste nicht mit einem
  // RangeError abwuergen - der Datensatz wird uebersprungen.
  if(!Number.isFinite(ev.startMs)) return "--";
  return ev.allDay ? fmtDate(new Date(ev.startMs)) : fmtTime(new Date(ev.startMs));
}

export function fmtClock(d){
  const shifted = new Date(d.getTime() + tzOffsetHours * 3600000);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

export function pad(n){ return String(n).padStart(2,"0"); }

export function updateUtcClock(){
  const now = new Date();
  const adjusted = new Date(now.getTime() + tzOffsetHours * 3600000);
  const h = pad(adjusted.getUTCHours());
  const m = pad(adjusted.getUTCMinutes());
  const s = pad(adjusted.getUTCSeconds());
  const clockEl = document.getElementById('utcClock');
  if(clockEl) clockEl.textContent = `${h}:${m}:${s}`;
}
setInterval(updateUtcClock, 1000);
updateUtcClock();

export function timing(ev){
  if(ev.isPermanentLive){
    const startMs = new Date("1998-11-20T06:40:00Z").getTime();
    const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const days = Math.floor(diff / 86400);
    const hrs = Math.floor((diff % 86400) / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    return {state:"live", main:`T+${days}d ${pad(hrs)}:${pad(mins)}`, sub:`${pad(diff % 60)}s · ${TRANSLATIONS[currentLang].active}`};
  }

  // Status, Countdown und Anzeigename kommen aus den normalisierten
  // Zeitdaten. Kategorie und Quelle muessen nie manuell gepflegt werden.
  const start = Number(ev.startMs);
  const end = Number.isFinite(ev.endMs) ? ev.endMs : start + ((ev.duration || 1/60) * 3600000);
  const now = Date.now();
  if(!Number.isFinite(start)) return {state:"upcoming", main:"T-??", sub:TRANSLATIONS[currentLang].countdown};

  if(now < start){
    const s = Math.floor((start - now) / 1000);
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if(days > 0) return {state:"upcoming", main:`T-${days}d ${pad(hrs)}h`, sub:`${pad(mins)}:${pad(secs)}`};
    return {state:"upcoming", main:`T-${pad(hrs)}:${pad(mins)}`, sub:`${pad(secs)}s · ${TRANSLATIONS[currentLang].countdown}`};
  }

  if(now < end){
    const liveDiff = Math.floor((now - start) / 1000);
    const lHrs = Math.floor(liveDiff / 3600);
    const lMins = Math.floor((liveDiff % 3600) / 60);
    const lSecs = liveDiff % 60;
    return {state:"live", main:`T+${pad(lHrs)}:${pad(lMins)}`, sub:`${pad(lSecs)}s · ${TRANSLATIONS[currentLang].active}`};
  }

  return {state:"passed", main:TRANSLATIONS[currentLang].passed, sub:fmtEventTime(ev)};
}

// Sichtbarer Name eines Events - bei COSMOS-internen Records aus den
// Uebersetzungen, bei Feed-Daten aus der uebersetzten Quelle.
export function eventTitle(ev){
  if(!ev) return "";
  const t = TRANSLATIONS[currentLang];
  if(ev.nameKey) return t[ev.nameKey] || ev.nameKey;
  return getLocalizedApiText(ev.rawItem).title;
}

export function eventKindLabel(ev){
  const t = TRANSLATIONS[currentLang];
  return ev.kindKey ? (t[ev.kindKey] || t.cat_space_cal) : t.cat_space_cal;
}

// Suchindex: Originaltitel, uebersetzter Titel, Kategorie und Quellen.
export function eventSearchText(ev){
  if(!ev) return "";
  const t = TRANSLATIONS[currentLang];
  const raw = cleanFeedText(ev.rawItem?.title || ev.rawTitle || "");
  return [raw, eventTitle(ev).replace(/&[a-z]+;/gi, " "), eventKindLabel(ev), (ev.sources || []).join(" ")]
    .join(" ").toLowerCase();
}

export function matchesFilter(ev, filterText){
  const needle = String(filterText || "").trim().toLowerCase();
  if(!needle) return true;
  return eventSearchText(ev).includes(needle);
}

// GloStar-Eintrag zu einer ID. Ereignisse, ISS-Detail und die Glossar-
// Eintraege selbst benutzen alle dieselbe Liste - deshalb laeuft jeder
// Verweis ueber diese eine Stelle.
export function openDetail(eventId, viewPrefix){
  const e = EVENTS.find(item => item.id === eventId);
  if(!e) return;
  const mainEl = document.getElementById(`${viewPrefix}-main`);
  const detailEl = document.getElementById(`${viewPrefix}-detail`);
  mainEl.style.display = "none";
  detailEl.classList.add("active");
  detailEl.dataset.openId = eventId;
  
  const t = TRANSLATIONS[currentLang];
  const glostarId = e["glostarId"];
  const glostarBtn = glostarId
    ? `<button class="glostar-link-btn" onclick="jumpToGloStar('${escapeHtml(glostarId)}')">↗ ${escapeHtml(glostarLookupLabel(glostarId))}</button>`
    : '';

  let eventName = "";
  let eventDesc = "";
  if(e.nameKey) {
    eventName = t[e.nameKey];
    eventDesc = t[e.descKey];
  } else {
    const loc = getLocalizedApiText(e.rawItem);
    eventName = loc.title;
    eventDesc = loc.desc;
  }

  const eventKind = eventKindLabel(e);
  const eventTiming = timing(e);
  const eventStatus = e.meta?.forecast ? t.forecast : (eventTiming.state === "live" ? t.active : eventTiming.state === "passed" ? t.passed : t.planned);

  if(e.isPermanentLive){
    detailEl.innerHTML = `
      <div class="detail-backbar"><button class="back-btn" onclick="closeDetail('${viewPrefix}')">← ${t.back}</button></div>
      <!-- Echtes NASA-3D-Modell der Station ueber der Karte. Erst hier wird der
           vergleichsweise grosse Viewer geladen (siehe ladeModelViewer). -->
      <div class="iss-model">
        <model-viewer src="assets/iss/ISS_stationary.glb"
          alt="${t.iss_model_alt}"
          camera-controls auto-rotate auto-rotate-delay="1500" rotation-per-second="14deg"
          shadow-intensity="1" exposure="1" reveal="auto"></model-viewer>
      </div>
      <div class="globe-container">
        <canvas id="globeCanvasDetail" width="400" height="320"></canvas>
        <div class="globe-status" id="globeIssStatus"><strong>ISS</strong> -- / --</div>
        <!-- Zoom-Knoepfe rechts oben. Das Canvas liegt absolut ueber dem
             Container und faengt sonst jeden Klick ab, deshalb braucht der
             Block einen z-index und einen eigenen pointer-events-Wert. -->
        <div class="globe-zoom">
          <button type="button" class="globe-zoom-btn" id="globeZoomIn"
            aria-label="${t.globe_zoom_in}">+</button>
          <button type="button" class="globe-zoom-btn" id="globeZoomOut"
            aria-label="${t.globe_zoom_out}">&minus;</button>
          <button type="button" class="globe-zoom-btn" id="globeZoomReset"
            aria-label="${t.globe_zoom_reset}">&#8634;</button>
        </div>
        <div class="globe-hint" id="globeZoomHint">${t.globe_zoom_hint}</div>
      </div>
      <div class="eyebrow">${eventKind}</div>
      <h1 style="margin-bottom:10px">${eventName}</h1>

      <!-- Laendersuche direkt unter der Kugel: man schaut auf die Station und
           will wissen, ob sie ueber das eigene Land kommt. Zwei Zeilen
           Ergebnis, mehr braucht es dafuer nicht. -->
      <div class="iss-block">
        <div class="iss-combo" id="issCombo">
          <div class="iss-select-row">
            <input type="text" class="iss-search" id="issCountryInput"
              placeholder="${t.iss_pick}" aria-label="${t.iss_pick}"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              role="combobox" aria-expanded="false" aria-controls="issCountryList">
            <!-- Leeres Land wieder abwaehlen: loest Auswahl, Ergebnis und die
                 rote Umrandung auf der Kugel in einem Schritt. -->
            <button type="button" class="iss-clear" id="issCountryClear"
              aria-label="${t.iss_clear}" hidden>&times;</button>
          </div>
          <div class="iss-list" id="issCountryList" role="listbox" hidden></div>
        </div>
        <div class="iss-result" id="issResult"></div>
      </div>

      <div class="detail-grid">
        <div class="detail-card"><label>${t.lat}</label><val id="detailLat">${formatIssLat()}</val></div>
        <div class="detail-card"><label>${t.lon}</label><val id="detailLon">${formatIssLon()}</val></div>
        <div class="detail-card"><label>${t.altitude}</label><val id="detailAlt">--</val></div>
        <!-- Live-Geschwindigkeit der Station, im selben Takt wie Position und
             Hoehe (alle 5 s) aktualisiert. -->
        <div class="detail-card"><label>${t.velocity}</label><val id="detailSpeed">--</val></div>
        <div class="detail-card" style="grid-column:1 / -1"><label>${t.status}</label><val>${eventStatus}</val></div>
      </div>
      <p style="color:var(--muted);margin-top:15px;line-height:1.5">${eventDesc}</p>
      ${renderSourceBlock(e)}
      ${glostarBtn}
    `;
    // Etwas kleiner als die volle Hoehe: am Kugelrand schwebt die Station
    // 6,6 % ausserhalb und waere sonst vom Rahmen abgeschnitten.
    mountGlobe("globeCanvasDetail", "globeIssStatus", {radiusFactor: 0.45, autoRotate: true});
    // Viewer-Skript erst jetzt nachladen; das Modell selbst laedt das Element
    // anhand seines src-Attributs.
    ladeModelViewer().catch(() => {});
    // Die Zoom-Knoepfe arbeiten direkt auf dem Globus-Zustand. addEventListener
    // statt onclick, damit die Funktionen nicht auch noch ans Fenster gehaengt
    // werden muessen.
    document.getElementById("globeZoomIn")?.addEventListener("click", () => globeZoomRaus("globeCanvasDetail", 1.6));
    document.getElementById("globeZoomOut")?.addEventListener("click", () => globeZoomRaus("globeCanvasDetail", 1 / 1.6));
    document.getElementById("globeZoomReset")?.addEventListener("click", () => globeZoomReset("globeCanvasDetail"));
    updateIssReadouts();
    renderIssPass();
    return;
  }

  const endLabel = e.allDay
    ? `${t.until} ${fmtDate(new Date(e.endMs))}`
    : `${t.until} ${fmtTime(new Date(e.endMs))}`;

  // Kalender-Knopf. Dauerhafte Eintraege ohne Ende (ISS live) bekommen bewusst
  // keinen, weil ein unendlicher Termin in keinem Kalender sinnvoll ist.
  const kalenderBlock = Number.isFinite(e.startMs) && Number.isFinite(e.endMs)
    ? `<div class="calendar-block">
         <button class="calendar-btn" onclick="addEventToCalendar('${escapeHtml(viewPrefix)}')">
           <span class="calendar-btn-icon">◷</span>
           <span class="calendar-btn-text"><b>${t.add_calendar}</b><small>${t.add_calendar_hint}</small></span>
         </button>
         <a class="calendar-btn calendar-btn-ghost" target="_blank" rel="noopener"
            href="${escapeHtml(googleCalendarUrl(e, eventName, eventDesc) || "#")}">
           <span class="calendar-btn-icon">G</span>
           <span class="calendar-btn-text"><b>${t.google_calendar}</b></span>
         </a>
       </div>`
    : "";

  detailEl.innerHTML = `
    <div class="detail-backbar"><button class="back-btn" onclick="closeDetail('${viewPrefix}')">← ${t.back}</button></div>
    <div class="eyebrow">${eventKind}</div>
    <h1 style="margin-bottom:10px">${eventName}</h1>
    <div class="detail-grid">
      <div class="detail-card"><label>${t.date_time}</label><val>${fmtEventTime(e)}</val></div>
      <div class="detail-card"><label>${t.type}</label><val>${eventKind}</val></div>
      <div class="detail-card"><label>${t.status}</label><val>${eventStatus}</val></div>
      <div class="detail-card"><label>${eventTiming.state === "passed" ? t.passed : t.until}</label><val>${endLabel}</val></div>
      ${e.meta?.distanceAu != null ? `<div class="detail-card"><label>${t.distance}</label><val>${Number(e.meta.distanceAu).toPrecision(3)} AU</val></div>` : ''}
      ${e.meta?.diameterKm != null ? `<div class="detail-card"><label>${t.diameter}</label><val>${Number(e.meta.diameterKm).toPrecision(3)} km</val></div>` : ''}
      ${e.meta?.kp != null ? `<div class="detail-card"><label>Kp</label><val>${Number(e.meta.kp).toFixed(1)}</val></div>` : ''}
    </div>
    <p style="color:var(--muted);margin-top:15px;line-height:1.5">${eventDesc}</p>
    ${renderSourceBlock(e)}
    ${glostarBtn}
    ${kalenderBlock}
  `;
}

// Legt den gerade geoeffneten Termin als .ics-Datei ab. Der Kalender des
// Geraets uebernimmt daraus Zeit UND Erinnerung - unabhaengig davon, ob
// COSMOS noch geoeffnet ist.
export async function addEventToCalendar(viewPrefix){
  const detailEl = document.getElementById(`${viewPrefix}-detail`);
  const ev = EVENTS.find(item => item.id === detailEl?.dataset.openId);
  if(!ev) return false;

  const t = TRANSLATIONS[currentLang];
  const titel = ev.nameKey ? t[ev.nameKey] : getLocalizedApiText(ev.rawItem).title;
  const beschreibung = ev.nameKey ? t[ev.descKey] : getLocalizedApiText(ev.rawItem).desc;
  const quelle = ev.sources?.length ? `Quelle: ${ev.sources.join(", ")}` : "";

  const ergebnis = await deliverEventIcs(ev, titel, [beschreibung, quelle].filter(Boolean).join("\n\n"));
  return ergebnis.ok;
}

// Welche Quelle liefert dieses Event? Wird direkt am Event angezeigt,
// damit sich jede Angabe zurueckverfolgen laesst.
// Messdaten aus dem englischen Fliesstext in der aktuellen Sprache zeigen.
export function renderFeedFacts(facts){
  if(!facts) return "";
  const l = FEED_I18N[currentLang]?.labels;
  if(!l) return "";
  const num = value => String(value).replace(/(\d)\.(\d)/g,
    (m, a, b) => currentLang === "de" ? `${a},${b}` : `${a}.${b}`);
  const rows = [];
  if(facts.moonDistances != null) rows.push([l.moonDistances, num(facts.moonDistances)]);
  if(facts.distanceKm != null) rows.push([l.distance, `${num(facts.distanceKm)} km`]);
  if(facts.diameterM != null) rows.push([l.diameter, `${num(facts.diameterM)} m`]);
  if(facts.magnitude != null) rows.push([l.magnitude, num(facts.magnitude)]);
  if(facts.velocity != null) rows.push([l.velocity, `${num(facts.velocity)} km/s`]);
  if(facts.visibleFrom) rows.push([l.visibleFrom, escapeHtml(facts.visibleFrom)]);
  if(!rows.length) return "";
  return `<div class="feed-facts">
    <div class="src-note-label">${l.facts}</div>
    <dl>${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
  </div>`;
}

export function renderSourceBlock(e){
  const t = TRANSLATIONS[currentLang];
  const sources = e.sources && e.sources.length ? e.sources : ["COSMOS"];
  const badges = sources.map(source => `<span class="badge">${t.source_label}: ${escapeHtml(source)}</span>`).join("");
  const link = e.sourceUrl
    ? `<div><a class="src-link" href="${escapeHtml(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t.source_open} ↗</a></div>`
    : "";
  const loc = e.rawItem ? getLocalizedApiText(e.rawItem) : null;
  const facts = renderFeedFacts(loc?.facts);
  // Der Fliesstext der Quelle ist englisch. Er wird deshalb nicht als
  // COSMOS-Text ausgegeben, sondern klar als Original gekennzeichnet -
  // die uebersetzten Begriffe und Messdaten stehen weiter oben.
  const original = e.description
    ? `<details class="src-original"><summary>${FEED_I18N[currentLang]?.labels?.original || t.source_text}</summary>
        <div class="src-note">${String(e.description)
          .split(/\n{2,}/)
          .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
          .join("")}</div></details>`
    : "";
  return `<div class="badge-row" style="margin-top:16px">${badges}</div>${link}${facts}${original}`;
}

export function resetDetail(viewPrefix){
  const detailEl = document.getElementById(`${viewPrefix}-detail`);
  if(!detailEl) return false;
  const mainEl = document.getElementById(`${viewPrefix}-main`);
  const wasOpen = detailEl.classList.contains("active");
  if(mainEl) mainEl.style.display = "block";
  detailEl.classList.remove("active");
  detailEl.innerHTML = "";
  delete detailEl.dataset.openId;
  // Die Alphabet-Leiste gehoert zur GloStar-Liste: beim Zurueckkehren wieder
  // einblenden, nachdem sie fuer die Detailseite ausgeblendet wurde.
  if(viewPrefix === "glostar"){
    const scrubber = document.getElementById("glostarScrubber");
    if(scrubber) scrubber.classList.remove("aus");
  }
  return wasOpen;
}

export function closeDetail(viewPrefix){
  resetDetail(viewPrefix);
  pruneGlobes();
}

export function renderLiveEvents(){
  const list = document.getElementById("liveEventList");
  const t = TRANSLATIONS[currentLang];

  // "Live" ergibt sich automatisch aus den Zeitdaten: die ISS ist dauerhaft
  // live, dazu jedes Kalender-Ereignis, dessen Zeitfenster gerade laeuft.
  const liveEvents = EVENTS.filter(e => eventState(e) === "live");

  if(liveEvents.length === 0){
    list.innerHTML = `<div class="empty" style="padding-top:8vh"><div class="title" style="font-size:16px">${t.no_live}</div><div style="color:var(--muted);font-size:12px;margin-top:6px">${t.no_live_sub}</div></div>`;
    return;
  }

  list.innerHTML = liveEvents.map((e)=>{
    const tm = timing(e);
    return `<article class="event live" data-event-id="${e.id}" onclick="openDetail('${e.id}', 'live-view')">
      <div class="icon">${SVG_ICONS[e.icon] || SVG_ICONS.star}</div>
      <div class="meta">
        <div class="name">${eventTitle(e)}</div>
        <div class="time">${fmtEventTime(e)}</div>
        <div class="badge-row"><span class="badge">${eventKindLabel(e)}</span><span class="badge">${t.active}</span></div>
      </div>
      <div class="count"><strong>${tm.main}</strong><small>${tm.sub}</small></div>
    </article>`;
  }).join("");
}

export function renderEvents(filterText = ""){
  const list = document.getElementById("eventList");
  const t = TRANSLATIONS[currentLang];

  // "Ereignisse" = alles, was noch nicht begonnen hat.
  const upcoming = EVENTS
    .filter(e => !e.isPermanentLive && eventState(e) === "upcoming" && matchesFilter(e, filterText))
    .sort((a, b) => a.startMs - b.startMs);

  document.getElementById("eventCount").textContent = upcoming.length + " " + t.total;

  if(upcoming.length === 0){
    list.innerHTML = `<div class="empty"><div class="title">${t.no_events}</div></div>`;
    return;
  }

  list.innerHTML = upcoming.map((e)=>{
    const tm = timing(e);
    const status = tm.state === "live" ? t.active : t.planned;
    const allDayBadge = e.allDay ? `<span class="badge">${t.all_day}</span>` : '';
    return `<article class="event" data-event-id="${e.id}" onclick="openDetail('${e.id}', 'events')">
      <div class="icon">${SVG_ICONS[e.icon] || SVG_ICONS.star}</div>
      <div class="meta">
        <div class="name">${eventTitle(e)}</div>
        <div class="time">${fmtEventTime(e)}</div>
        <div class="badge-row"><span class="badge">${eventKindLabel(e)}</span>${allDayBadge}<span class="badge">${status}</span></div>
      </div>
      <div class="count"><strong>${tm.main}</strong><small>${tm.sub}</small></div>
    </article>`;
  }).join("");
}

export function renderHistory(filterText = ""){
  const histList = document.getElementById("histList");
  const t = TRANSLATIONS[currentLang];

  // "Verlauf" = alles, was vorbei ist, neuestes zuerst.
  const past = EVENTS
    .filter(e => !e.isPermanentLive && eventState(e) === "passed" && matchesFilter(e, filterText))
    .sort((a, b) => b.startMs - a.startMs);

  if(past.length === 0){
    histList.innerHTML = `<div class="empty"><div class="title">${t.no_history}</div></div>`;
    return;
  }
  histList.innerHTML = past.map((e)=>{
    return `<article class="hist-card" data-event-id="${e.id}" onclick="openDetail('${e.id}', 'history')">
      <div class="hist-thumb">${SVG_ICONS[e.icon] || SVG_ICONS.star}</div>
      <div class="hist-meta">
        <div class="name">${eventTitle(e)}</div>
        <div class="time">${fmtEventTime(e)}</div>
        <div class="badge-row"><span class="badge">${t.cat_past}</span><span class="badge">${eventKindLabel(e)}</span></div>
      </div>
    </article>`;
  }).join("");
}

// Einmal fuer alle Ansichten. Wird nur aufgerufen, wenn sich wirklich
// etwas geaendert hat - nicht jede Sekunde.
export function renderAll(){
  renderLiveEvents();
  renderEvents(document.getElementById("searchEvents")?.value || "");
  renderHistory(document.getElementById("searchHistory")?.value || "");
  renderIssPass();
}

// Countdown laeuft sekundengenau, ohne die Liste neu aufzubauen.
export function tickCountdowns(){
  const now = Date.now();
  document.querySelectorAll("[data-event-id]").forEach(node => {
    const event = EVENTS.find(item => item.id === node.dataset.eventId);
    if(!event) return;
    const tm = timing(event);
    const strong = node.querySelector(".count strong");
    const small = node.querySelector(".count small");
    if(strong && strong.textContent !== tm.main) strong.textContent = tm.main;
    if(small && small.textContent !== tm.sub) small.textContent = tm.sub;
  });
  return now;
}
