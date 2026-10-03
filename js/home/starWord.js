// Formt das Wort "COSMOS" aus vielen einzelnen Sternen. Das Wort wird zunaechst
// unsichtbar auf ein Hilfs-Canvas gezeichnet; danach werden dessen Pixel
// abgetastet und an jeder gesetzten Stelle entsteht ein funkelnder Stern. So
// wirkt das Logo wie ein kleines Sternbild statt wie normaler Text.

const WORT = "COSMOS";
const SCHRIFT = '900 %px "SF Pro Display", -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
const SPERRUNG = "0.06em";
const FARBEN = [
  { rgb: [255, 255, 255], w: 70 },   // weiss, der Grossteil
  { rgb: [214, 232, 255], w: 16 },   // blaeulich, heisse Riesen
  { rgb: [255, 241, 216], w: 10 },   // gelblich
  { rgb: [255, 214, 186], w: 4 }     // orange, seltene Rote Riesen
];

let canvas = null;
let ctx = null;
let sterne = [];
let b = 0, h = 0, dpr = 1;
let laufend = false, raf = 0, start = 0;
let sichtbar = false;
const bilder = new Map();

// Ein Sternbild wird einmal gezeichnet und danach nur noch als Bild eingesetzt.
// Ein Verlauf je Stern und Bild wuerde die Bildrate ruinieren.
function sprite(rgb, gross){
  const schluessel = rgb.join(",") + (gross ? ":s" : "");
  if(bilder.has(schluessel)) return bilder.get(schluessel);
  const S = 64, m = S / 2;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(m, m, 0, m, m, m);
  const [r, gg, bb] = rgb;
  g.addColorStop(0,    `rgba(${r},${gg},${bb},1)`);
  g.addColorStop(0.10, `rgba(${r},${gg},${bb},${gross ? 0.9 : 0.6})`);
  g.addColorStop(0.32, `rgba(${r},${gg},${bb},0.13)`);
  g.addColorStop(1,    `rgba(${r},${gg},${bb},0)`);
  x.fillStyle = g;
  x.beginPath(); x.arc(m, m, m, 0, Math.PI * 2); x.fill();
  bilder.set(schluessel, c);
  return c;
}

function zufallsFarbe(){
  let x = Math.random() * 100;
  for(const f of FARBEN){ if((x -= f.w) <= 0) return f.rgb; }
  return FARBEN[0].rgb;
}

function setzeSchrift(c, groesse){
  c.font = SCHRIFT.replace("%", groesse);
  try{ c.letterSpacing = SPERRUNG; }catch{}
}

// Baut die Sternwolke neu auf: misst das Wort, zeichnet es auf ein Hilfs-Canvas
// und tastet die Pixel ab. Wird beim ersten Anzeigen und bei jeder
// Groessenaenderung aufgerufen.
function baue(){
  if(!canvas) return;
  const cssB = Math.max(1, canvas.clientWidth);
  const hilfe = document.createElement("canvas");
  const hx = hilfe.getContext("2d");

  setzeSchrift(hx, 100);
  const breite100 = hx.measureText(WORT).width || 1;
  const S = 100 * (cssB * 0.98) / breite100;
  setzeSchrift(hx, S);

  const masse = hx.measureText(WORT);
  const hoch = masse.actualBoundingBoxAscent || S * 0.72;
  const tief = masse.actualBoundingBoxDescent || S * 0.02;
  const rand = S * 0.28;                       // Platz fuer den Hof der Sterne
  const cssH = Math.ceil(hoch + tief + rand * 2);
  canvas.style.height = cssH + "px";

  dpr = Math.min(2, window.devicePixelRatio || 1);
  b = cssB; h = cssH;
  canvas.width = Math.round(b * dpr);
  canvas.height = Math.round(h * dpr);
  ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  hilfe.width = canvas.width;
  hilfe.height = canvas.height;
  hx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hx.clearRect(0, 0, b, h);
  hx.fillStyle = "#fff";
  setzeSchrift(hx, S);
  hx.textAlign = "center";
  hx.textBaseline = "alphabetic";
  hx.fillText(WORT, b / 2, rand + hoch);

  const daten = hx.getImageData(0, 0, hilfe.width, hilfe.height).data;
  const schritt = Math.max(3, Math.round(S / 32));
  const neue = [];
  for(let y = 0; y < hilfe.height; y += schritt){
    for(let x = 0; x < hilfe.width; x += schritt){
      if(daten[(y * hilfe.width + x) * 4 + 3] < 130) continue;
      const gross = Math.random() > 0.9;
      const groesse = gross ? 1.5 + Math.random() * 0.9 : 0.5 + Math.random() * 0.9;
      neue.push({
        x: (x + (Math.random() - 0.5) * schritt * 0.6) / dpr,
        y: (y + (Math.random() - 0.5) * schritt * 0.6) / dpr,
        bild: sprite(zufallsFarbe(), gross),
        halbe: groesse * (gross ? 3.4 : 2.1),
        alpha: 0.5 + Math.random() * 0.5,
        blink: 0.12 + Math.random() * 0.24,
        rate: 0.5 + Math.random() * 1.6,
        ph: Math.random() * Math.PI * 2
      });
    }
  }
  sterne = neue;
}

function zeichne(zeit){
  if(!laufend) return;
  raf = requestAnimationFrame(zeichne);
  if(document.hidden || !sichtbar) return;
  if(!start) start = zeit;
  const sek = (zeit - start) / 1000;
  ctx.clearRect(0, 0, b, h);
  for(const s of sterne){
    const funkeln = 1 + s.blink * Math.sin(sek * s.rate + s.ph);
    ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * funkeln));
    const g = s.halbe;
    ctx.drawImage(s.bild, s.x - g, s.y - g, g * 2, g * 2);
  }
  ctx.globalAlpha = 1;
}

function starte(){
  if(!canvas || laufend || !sichtbar || document.hidden) return;
  laufend = true;
  start = 0;
  raf = requestAnimationFrame(zeichne);
}

function stoppe(){
  laufend = false;
  if(raf) cancelAnimationFrame(raf);
  raf = 0;
}

export function setzeSternwortAktiv(wertig){
  sichtbar = !!wertig;
  if(sichtbar) starte(); else stoppe();
}

export function initSternwort(){
  canvas = document.getElementById("starWord");
  if(!canvas) return;
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(baue, 160);
  });
  document.addEventListener("visibilitychange", () => {
    if(document.hidden) stoppe(); else if(sichtbar) starte();
  });
  baue();
  if(document.getElementById("home")?.classList.contains("active")) setzeSternwortAktiv(true);
}
