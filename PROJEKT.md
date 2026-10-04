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
- ISS-Detailseite: **echtes NASA-3D-Modell** der Station (glTF, `model-viewer`),
  über der Karte; das leichte Code-Modell bleibt im Globus.
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

---

## Todos

- [ ] ISS-Himmel visuell abnehmen: Dichte, Breite und Verlauf des Milchstraßen-Bandes.
- [ ] ISS-3D-Modell auf dem iPad visuell abnehmen (Ausrichtung, Helligkeit).
- [ ] TLE-Frischepolitik festlegen und umsetzen.

---

## Changelog

Neueste Einträge oben. Format: `Datum | Commit | Änderung`.

| Datum      | Commit    | Änderung |
|------------|-----------|----------|
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
