// Berechnet, wo sich die Sterne des Hintergrunds sammeln muessen, um das Wort
// "COSMOS" zu bilden. Das Wort wird zunaechst unsichtbar auf ein Hilfs-Canvas
// gezeichnet; danach werden dessen Pixel abgetastet und jeder gesetzte Punkt
// wird zu einem Ziel, zu dem ein Stern aus dem Sternenfeld hinfliegt.

const WORT = "COSMOS";
const SCHRIFT = '900 %px "SF Pro Display", -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
const SPERRUNG = "0.06em";

function setzeSchrift(c, groesse){
  c.font = SCHRIFT.replace("%", groesse);
  try{ c.letterSpacing = SPERRUNG; }catch{}
}

// breite: verfuegbare Breite in CSS-Pixeln. Liefert die noetige Hoehe und die
// Zielpunkte in lokalen Koordinaten (links oben = 0,0).
export function berechneSternwort(breite){
  const b = Math.max(1, breite);
  const hilfe = document.createElement("canvas");
  const hx = hilfe.getContext("2d");

  setzeSchrift(hx, 100);
  const breite100 = hx.measureText(WORT).width || 1;
  const S = 100 * (b * 0.94) / breite100;
  setzeSchrift(hx, S);

  const masse = hx.measureText(WORT);
  const hoch = masse.actualBoundingBoxAscent || S * 0.72;
  const tief = masse.actualBoundingBoxDescent || S * 0.02;
  const rand = S * 0.22;
  const hoehe = Math.ceil(hoch + tief + rand * 2);

  hilfe.width = Math.round(b);
  hilfe.height = hoehe;
  hx.fillStyle = "#fff";
  setzeSchrift(hx, S);
  hx.textAlign = "center";
  hx.textBaseline = "alphabetic";
  hx.fillText(WORT, b / 2, rand + hoch);

  const daten = hx.getImageData(0, 0, hilfe.width, hilfe.height).data;
  const schritt = Math.max(4, Math.round(S / 30));
  const punkte = [];
  for(let y = 0; y < hilfe.height; y += schritt){
    for(let x = 0; x < hilfe.width; x += schritt){
      if(daten[(y * hilfe.width + x) * 4 + 3] > 120){
        punkte.push({
          x: x + (Math.random() - 0.5) * schritt * 0.5,
          y: y + (Math.random() - 0.5) * schritt * 0.5
        });
      }
    }
  }
  return { hoehe, punkte };
}
