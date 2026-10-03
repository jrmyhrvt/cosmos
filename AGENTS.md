# AGENTS.md — Arbeits- und Speicherablauf

Verbindliche Anweisungen für jede Arbeitseinheit („Runde") am COSMOS-Projekt.
Kurzfassung der Dokumentpflicht: **Am Ende jeder Runde wird `PROJEKT.md` aktualisiert
und mit einem Commit gespeichert.** Es gibt keinen anderen Zustandsspeicher — wer die
Runde beendet, schreibt den Stand in `PROJEKT.md`.

- Projekt: COSMOS (statische Web-App, kein Build, kein npm).
- Repo: `/Users/dario/github/cosmos`, Branch `main`, Remote `origin`.
- Live: https://jrmyhrvt.github.io/cosmos/
- Projektstand: siehe [PROJEKT.md](./PROJEKT.md)

---

## 1. Speicherablauf jeder Runde (verbindlich, in dieser Reihenfolge)

### Schritt 0 — Kontext laden
- `PROJEKT.md` lesen: Ziele, offene Todos, letzten Changelog-Eintrag.
- Prüfen, ob das aktuelle Ziel zu einem offenen Todo gehört.

### Schritt 1 — Arbeiten
- Nur im Repo `/Users/dario/github/cosmos` ändern. Den älteren Klon unter
  `/Users/dario/Documents/Default Project/cosmos` **nicht** anfassen.

### Schritt 2 — Verifizieren
- **Kein** `node`/`npm`/`deno`/`bun` vorhanden.
- Syntaxprüfung per JavaScriptCore:
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`
  (Export-/Importzeilen vorher entfernen: `sed 's/^export //'`, `s/^import .*//`).
- Funktionsprüfung per CDP-Harness im Ordner
  `/var/folders/lj/944tz8d94qvd3h4s_ysq7s340000gn/T/opencode/sc/`:
  `cdp_nc.run_nc(url, wait_ms, expression, await_promise)` lädt cachefrei.
- Regel: **keine JS-Fehler** in der Konsole, betroffene Funktion nachweislich aktiv
  (z. B. Pixel-/DOM-Messung). Headless-Rendering ist Software-Rendering — FPS sind
  dort **nicht** aussagekräftig.

### Schritt 3 — Committen und pushen
- `git status` und `git diff` prüfen, nur gewollte Dateien stagen.
- Nachricht im Repo-Stil: deutsch, ohne Umlaute, kurz, ein Thema pro Commit.
- `git push origin main`.

### Schritt 4 — Live prüfen (Pages-Deploy ~10–70 s)
- Lokalen und ausgelieferten Hash vergleichen, mit Cache-Buster:
  `curl -s "https://jrmyhrvt.github.io/cosmos/<datei>?cb=$(date +%s%N)" | shasum -a 256`
  gegen `shasum -a 256 <datei>`. Wiederholen, bis identisch.

### Schritt 5 — PROJEKT.md aktualisieren (der eigentliche „Speicher")
- **Fortschritt:** Erledigtes nach `Erledigt` verschieben, Laufendes unter `In Arbeit`.
- **Entscheidungen:** neue Zeile mit Datum, Entscheidung, Begründung.
- **Todos:** Erledigtes abhaken, Neues ergänzen.
- **Changelog:** neue Zeile oben, Format `Datum | Commit | Änderung`.
- Zielsetzung (`Aktuelles Ziel`) an den neuen Stand anpassen.

### Schritt 6 — Doku mit speichern
- `PROJEKT.md` committen (entweder mit dem Feature-Commit oder als eigener
  `docs:`-Commit) und pushen.

### Schritt 7 — Abnahme
- Bei sichtbaren Änderungen (UI, Animation, Farbe) den Nutzer um **visuelle Abnahme**
  bitten. Es gibt keinen Bild-Input für den Agenten; Verifikation ist geometrisch bzw.
  pixelweise und ersetzt die Sichtprüfung auf echtem Apple-Gerät nicht.

**Definition of Done für eine Runde:** geändert → verifiziert (jsc und/oder CDP, keine
Fehler) → committet → gepusht → live byte-identisch → `PROJEKT.md` aktualisiert und
gespeichert.

---

## 2. Projektfakten

- Technik: reines HTML/CSS/JavaScript (ES-Module), kein Framework, kein Bundler.
- Einstieg: `index.html`, Logik unter `js/`, Stil in `css/cosmos.css`.
- Daten: `js/api.js` (Events, u. a. permanentes ISS-Live-Event `iss-live`),
  `js/translations.js` (Texte, `SVG_ICONS`, DE/EN/ES),
  `js/glostar/glostar.js` + `js/glostar/glostarDataSpace.js` (Lexikon),
  `js/iss/issManager.js` (Globus, Himmel, ISS-Bahn).
- Dev-Server lokal: `http://127.0.0.1:8901/index.html` (Repo), 8766 = ältere Kopie.
- Deploy: GitHub Pages aus Branch `main`.

## 3. Konventionen

- Sprache im Code und in Commits: **Deutsch, ASCII** (statt Umlauten `ae/oe/ue/ss`).
- Kommentare erklären das **Warum**, nicht das Was; vorhandenen Stil weiterführen.
- Keine Secrets, Keys oder Zugangsdaten committen.
- Keine Datei auf Verdacht umbenennen oder Struktur ändern.
- Kein Build-, Lint- oder Test-Skript vorhanden — es gilt der Ablauf aus Abschnitt 1.

## 4. Was der Nutzer tun muss

- Sichtprüfung auf iPad/Mac (der Agent sieht keine Bilder).
- Nach iOS-Caching App-Icon ggf. neu zum Home-Screen hinzufügen.
