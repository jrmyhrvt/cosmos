# COSMOS — Projektstatus

Statische Web-App (iPad/Mac) mit Startfenster, Live-Events, History, GloStar-Lexikon
und ISS-Live-Globus. Kein Build, kein npm. Auslieferung über GitHub Pages.

- Live: https://jrmyhrvt.github.io/cosmos/
- Repo: `/Users/dario/github/cosmos` (Branch `main`)
- Verbindlicher Arbeitsablauf: siehe [AGENTS.md](./AGENTS.md)

---

## Ziele

### Produktziele
- Übersichtliche, ruhige Oberfläche für Weltraum-Ereignisse (live, geplant, Vergangenheit).
- GloStar: verständliches Lexikon mit Grafiken, Icons und Verlinkungen.
- ISS-Ansicht: echte Position, Länder-Überflug, ein Globus mit realistischer Anmutung.
- Läuft flüssig auf iPad und Mac, ohne Framework und ohne Build-Schritt.

### Aktuelles Ziel
- **ISS-Globus: realistischer Nachthimmel hinter der Erde** — schwache Sterne plus
  Milchstraße als dichtere Sternansammlung (kein gezeichneter Ring). Erste Fassung
  ist live; es fehlt die visuelle Abnahme durch den Nutzer.

---

## Fortschritt

### Erledigt
- GloStar-Lexikon auf **144 Einträge** erweitert (96 neu, DE/EN/ES, 5 neue Icons).
- GloStar-Suchfeld mit **X-Knopf** zum Leeren.
- Startfenster: Wort **COSMOS** aus Sternen, mit beschleunigendem Weg, Abbremsen und
  Hineinschweben.
- App-Icon als vierzackiger Funkel-Stern (Favicon, Apple-Touch-Icon, Manifest).
- ISS-Globus: **Sternenhimmel** hinter der Erde, drag-gekoppelt und schnell mitdrehend.
- ISS-Globus: **Milchstraße** als dichteres Sternband entlang eines geneigten
  Abschnitts der galaktischen Ebene.
- ISS-Globus: **echtes NASA-3D-Modell** (glTF, `model-viewer`) **ersetzt das
  gezeichnete Modell** — es liegt als Overlay über dem Kugel-Canvas, wandert mit
  der Station um die Erde und skaliert mit dem Kugelradius. Das gezeichnete
  Modell ist ersatzlos entfallen (kein Notnagel), das NASA-Modell lädt sofort
  beim Öffnen der ISS-Seite.
- Ganztägige Termine: Ersatzfenster **24 Stunden** statt 24 Minuten — im
  Kalender-Export (DTEND ist exklusiv) waren solche Termine dadurch unsichtbar.
- ISS-Fixes, Kalender-Export (floating), Sternstrahlen-Symmetrie.

### In Arbeit
- ISS-Hintergrundhimmel: Dichte, Breite und Lage des Milchstraßen-Bandes werden nach
  visueller Rückmeldung justiert.

### Offen / Ideen
- TLE-Frischepolitik: Warnung oder Abbruch bei veralteten ISS-Daten.

---

## Entscheidungen

| Datum      | Entscheidung | Begründung |
|------------|--------------|------------|
| 2026-10-03 | Milchstraße nicht als gezeichnete Linie/Ring, sondern als **dichtere Sternansammlung** entlang eines Band-Abschnitts. | Ein gezeichneter Großkreis wirkt wie ein geschlossener Ring; echte Milchstraße ist eine Sternverdichtung. |
| 2026-10-03 | Himmel nur in der **ISS-Ansicht** (`instance.showIss`), nicht auf dem GloStar-Globus. | Thematisch gehört der Sternenhimmel zur ISS-Live-Ansicht. |
| 2026-10-03 | Himmel dreht **nur beim Ziehen** (kein Auto-Rotate), Faktor `STERN_DREH = 3.5`. | „Extrem schnell" gewünscht; kein Springen beim automatischen Zentrieren auf ein Land. |
| 2026-10-03 | Himmelskörper als **Punkte auf einer Himmelskugel** (manuelle Orthographisch-Projektion, nur vordere Halbkugel). | Sterne müssen von der Erdscheibe verdeckt werden und beim Drehen korrekt wandern. |
| 2026-10-03 | NASA-3D-Modell nur in der **ISS-Detailansicht** (`model-viewer`), nicht im Globus; Skript und 44-MB-Modell werden erst dort geladen. | Der Globus bleibt leicht und dependency-frei; das schwere Modell landet nur auf einer Seite. NASA erlaubt per CORS nur die eigene Domain, daher liegt die `.glb` im Repo. |
| 2026-10-04 | Weltkarte fuer **Globus und Laendersuche aus einer Datei** (`assets/world/laender-50m.json`, Natural Earth 50m, pro Ring auf 0,08 Grad vereinfacht, kleine Inseln unveraendert). Davor: Globus 110m, Suche 50m aus dem Netz. | 110m liess Daenemark, Italien, Portugal oder Grossbritannien nur als Klumpen erkennen - genau die Kuesten, an denen man Ueberfluge ablesen will. Das Original (3 MB, ~140 Felder je Land) ist fuer jeden Frame zu teuer; 0,02 Grad kostet auf dem Globus ein Drittel Bildrate, 0,08 Grad ist der beste Kompromiss. |
| 2026-10-04 | Beim Zeichnen des Globus nur Laender nehmen, deren Huellkugel den sichtbaren Ausschnitt erreicht (`globeHuelle`, `sichtbarerSchnitt`, `imSichtkreis`; Fenster ueber die Leinwandecke, nicht ueber den Kugelradius). | Der Kugel-Canvas ist 1350x419 px, der Globus nur 188 px Radius: ab Zoom 2 fallen sonst fast alle Laender weg, ohne dass etwas zu sehen ist - beim Hineinzoomen kostet die Projektion sonst weiter Punkte fuer Laender ausserhalb des Bildes. |
| 2026-10-03 | Das NASA-Modell wird **Overlay über dem Kugel-Canvas** und ersetzt dort das gezeichnete Modell (Position wie `issPoint`, Größe = `radius · ISS_MODELL_ANTEIL · Hüllkugel-Faktor`). Kein Notnagel, Laden sofort beim Öffnen der ISS-Seite. | Der Nutzer wollte das echte Modell *in der Weltkugel*, nicht als eigene Karte darüber — und nichts soll mehr zusätzlich gezeichnet werden. Ohne Positions-Rechnung hinge es als Bildschirm-Tafel in der Luft; die Größe folgt so dem Zoom. Der Hüllkugel-Faktor kommt aus `getBounds()`, weil `model-viewer` die Kamera auf die Hüllkugel, nicht auf die längste Kante legt. |

---

## Todos

- [ ] ISS-Himmel visuell abnehmen: Dichte, Breite und Verlauf des Milchstraßen-Bandes.
- [ ] Echtes NASA-Modell **im Globus** visuell abnehmen: Größe, Helligkeit, Ausrichtung.
- [ ] ISS-Globus mit 50m-Kuestenlinien **visuell abnehmen**: Konturen, Bildrate beim Drehen auf dem iPad.
- [ ] TLE-Frischepolitik festlegen und umsetzen.

---

## Changelog

Neueste Einträge oben. Format: `Datum | Commit | Änderung`.

| Datum      | Commit    | Änderung |
|------------|-----------|----------|
| 2026-10-04 | `d542c66` | ISS-Globus: Natural Earth 50m statt 110m, lokal als eine Datei fuer Globus und Laendersuche; Sichtkreis-Filter beim Zeichnen. |
| 2026-10-03 | `59d8890` | ISS-Globus: gezeichnetes 3D-Modell entfernt, NASA-Modell lädt sofort. |
| 2026-10-03 | `0468bf1` | NASA-3D-Modell ersetzt das gezeichnete Modell im Globus (Overlay, laden ab Zoom 2.2). |
| 2026-10-03 | `7a73e3f` | Ganztägige Termine: Ersatzfenster 24 Stunden statt 24 Minuten. |
| 2026-10-03 | `0b399d7` | ISS-Detailseite: echtes NASA-3D-Modell der Station (glTF, model-viewer). |
| 2026-10-03 | `39ac700` | ISS-Globus: Milchstraße als dichteres Sternband statt Ring. |
| 2026-10-03 | `88845fc` | ISS-Globus: Milchstraßen-Nebelband hinter der Erde (Ring-Fassung, ersetzt). |
| 2026-10-03 | `cf07332` | ISS-Globus: schwacher Sternenhimmel hinter der Erde. |
| 2026-10-03 | `79ba9cd` | Startfenster: Wort-Sterne beschleunigen sichtbar und schweben gebremst in COSMOS. |
| 2026-10-03 | `62993e1` | GloStar: X-Knopf rechts im Suchfeld löscht die Eingabe. |
| 2026-10-03 | `18cd1a0` | GloStar: Lexikon auf 144 Einträge erweitert (96 neu, DE/EN/ES, 5 neue Icons). |
| 2026-10-03 | `76d0cd6` | App-Icon: vierzackiger Funkel-Stern statt fünfzackigem Stern. |
| 2026-10-03 | `1c2db14` | App-Icon: weißer Stern auf Schwarz als Favicon, Apple-Touch-Icon und Manifest. |
| 2026-10-03 | `95c26d0` | Startfenster: COSMOS-Sterne fliegen vom Wortzentrum in alle Richtungen weg. |
| 2026-10-03 | `6706eae` | Startfenster: COSMOS-Sterne fliegen beim Ansichtswechsel nach außen weg. |
| 2026-10-03 | `1f8bb78` | Startfenster: COSMOS bildet sich aus eigenem Sternvorrat, Hintergrund bleibt erhalten. |
| 2026-10-03 | `d1b5539` | Startfenster: Wort heller und im Vordergrund, sanfter Übergang, responsiv. |
| 2026-10-03 | `711c76e` | Startfenster: Wort COSMOS dichter und heller aus mehr Sternen. |
| 2026-10-03 | `63a2202` | Startfenster: Hintergrundsterne fliegen zusammen und bilden COSMOS. |
| 2026-10-03 | `e1fa1ec` | Startfenster: Wort COSMOS aus vielen einzelnen Sternen. |
