/* --- ISS im Detail: freie 3D-Ansicht ------------------------------------
   Die Station auf dem Globus ist fest im Bild verankert und laesst sich
   nicht umkreisen. Diese Ansicht oeffnet das echte NASA-Modell als grosses,
   freies 3D-Objekt - so wie bei NASA Eyes: Ziehen dreht um die Station,
   Zwei-Finger oder Mausrad zoomt bis in jedes Detail hinein.
   -------------------------------------------------------------------------- */
import { TRANSLATIONS } from "../translations.js";

const MODEL_VIEWER_VERSION = "4.3.1";
const MODELL_PFAD = "assets/iss/ISS_stationary.glb";

let viewerLaden = null;
let overlay = null;
let viewer = null;

// model-viewer wird nur einmal geladen. Auf dem Globus steht dasselbe Skript
// schon - der eigene Aufruf prueft deshalb zuerst, ob das Element bereits
// definiert ist.
function ladeModelViewer(){
  if(window.customElements && window.customElements.get("model-viewer")) return Promise.resolve();
  if(viewerLaden) return viewerLaden;
  viewerLaden = new Promise((fertig, fehler) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = `https://cdn.jsdelivr.net/npm/@google/model-viewer@${MODEL_VIEWER_VERSION}/dist/model-viewer.min.js`;
    s.onload = fertig;
    s.onerror = () => { viewerLaden = null; fehler(new Error("model-viewer")); };
    document.head.appendChild(s);
  });
  return viewerLaden;
}

function t(){ return TRANSLATIONS[document.documentElement.lang || "de"]; }

function bauOverlay(){
  if(overlay) return;
  overlay = document.createElement("div");
  overlay.className = "iss-modell-overlay";
  overlay.id = "issModellOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="iss-modell-leiste">
      <button type="button" class="back-btn" id="issModellZurueck">&#8592; ${t().back}</button>
      <div class="iss-modell-titel"><strong>ISS</strong> &#8212; ${t().iss_detail_titel}</div>
    </div>
    <model-viewer class="iss-modell-viewer" id="issModellViewer"
      alt="${t().iss_model_alt}"
      src="${MODELL_PFAD}"
      camera-controls
      min-camera-orbit="auto auto 40%"
      max-camera-orbit="auto auto 150%"
      min-field-of-view="15deg"
      max-field-of-view="45deg"
      interpolation-decay="0.5"
      auto-rotate
      rotation-per-second="10deg"
      shadow-intensity="0"
      exposure="1.1"
      interaction-prompt="none"
      loading="eager"
      reveal="auto"></model-viewer>
    <div class="iss-modell-hinweis">${t().iss_detail_hint}</div>
  `;
  document.body.appendChild(overlay);
  viewer = overlay.querySelector("#issModellViewer");
  overlay.querySelector("#issModellZurueck").addEventListener("click", schliesseIssModell);
}

export function issModellOffen(){
  return !!(overlay && overlay.classList.contains("offen"));
}

export function oeffneIssModell(){
  if(issModellOffen()) return;
  ladeModelViewer()
    .then(() => {
      bauOverlay();
      overlay.classList.add("offen");
      document.body.classList.add("modell-offen");
      if(viewer){
        // Ansicht an den Anfang zuruecksetzen, damit jede Oeffnung am
        // gleichen Ausgangspunkt beginnt.
        viewer.setAttribute("camera-orbit", "30deg 75deg 100%");
        viewer.autoRotate = true;
      }
      overlay.querySelector("#issModellZurueck")?.focus();
    })
    .catch(() => {});
}

export function schliesseIssModell(){
  if(!overlay) return;
  overlay.classList.remove("offen");
  document.body.classList.remove("modell-offen");
  if(viewer) viewer.autoRotate = false;
}

// Esc schliesst die Ansicht, so wie jeder andere Dialog auch.
document.addEventListener("keydown", e => {
  if(e.key === "Escape") schliesseIssModell();
});

// Fuer onclick-Handler im HTML.
if(typeof window !== "undefined") window.oeffneIssModell = oeffneIssModell;
