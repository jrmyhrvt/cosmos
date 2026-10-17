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
| 2026-10-04 | `tools/weltkarte.py` als Generator der Weltkarte: **Ringlaufrichtung wie im Natural-Earth-Original erhalten** (bei Vorzeichenwechsel umdrehen) und Ringe, die sich beim Vereinfachen selbst schneiden, durch feinere Vereinfachung (Toleranz halbieren) statt durch den kompletten Originalring entschaerfen. | Nach dem Vereinfachen war die ganze Erde weiss: d3 fuellt mit der Nonzero-Regel, ein Ring mit falscher Laufrichtung zeichnet die Komplementflaeche (z. B. Marshall Islands). Alle Ringe auf CCW zu zwingen war noch schlechter, Natural Earth nutzt gemischte Laufrichtungen. |
| 2026-10-04 | Zwei Detailstufen aus derselben Quelle: **Vollansicht zeichnet `laender-grob.json`** (0,5 Grad, Ringe unter 0,2 Grad raus, 15.371 Punkte, 7,6 ms je Bild), **ab Zoom 1.6 die feine 50m-Karte** (0,08 Grad, 26.473 Punkte, 14,9 ms je Bild). Die Laendersuche nutzt weiter die feine Karte. | Die feine Karte kostet beim Drehen die halbe Bildrate (33 statt 60 fps), auf dem rund 300-Px-Globus der Vollansicht ist der Unterschied aber nicht zu sehen - beide Stufen ergeben fuer die sichtbare Halbkugel dieselbe Landflaeche (16 Prozent). Sobald hineingezoomt wird, zaehlen die Kuestenlinien, und dort filtert der Sichtkreis die feine Karte auf wenige Laender: Ziehen bleibt bei 60 fps (Zoom 2), bei Zoom 4 sind es 52 fps. |
| 2026-10-05 | Dritte Detailstufe: **ab Zoom 8 `laender-fein.json`** aus Natural Earth 10m (0,02 Grad, 258 Laender, 183.574 Punkte, 3,0 MB), erst dann per `fetch` nachgeladen. Beim Zeichnen wird zusaetzlich auf den sichtbaren Ausschnitt zugeschnitten (`sichtbaresFenster`/`clipRing`, Sutherland-Hodgman). Liegt ein Pol in der Sicht, faellt das Zuschneiden weg. | Bei Zoom 8+ liegen die Kuesten der 50m-Karte drei bis vier Pixel daneben, ab Zoom 12 sieht man die Stufen. Ohne Zuschneiden kostet die feine Karte ueber Mitteleuropa rund 410 ms je Bild, mit Zuschneiden 14 ms bei Zoom 8 und 6 ms bei Zoom 14 (vorher/nachher pixelweise verglichen: 0 Unterschiede). Ein Laengen-/Breiten-Rechteck ist am Pol unbrauchbar, weil die sichtbare Laenge dort ueber 180 Grad laeuft und ein Rechteck die hohen Breiten abschneidet (Island, Norwegen, England wurden schwarz). |
| 2026-10-03 | Das NASA-Modell wird **Overlay über dem Kugel-Canvas** und ersetzt dort das gezeichnete Modell (Position wie `issPoint`, Größe = `radius · ISS_MODELL_ANTEIL · Hüllkugel-Faktor`). Kein Notnagel, Laden sofort beim Öffnen der ISS-Seite. | Der Nutzer wollte das echte Modell *in der Weltkugel*, nicht als eigene Karte darüber — und nichts soll mehr zusätzlich gezeichnet werden. Ohne Positions-Rechnung hinge es als Bildschirm-Tafel in der Luft; die Größe folgt so dem Zoom. Der Hüllkugel-Faktor kommt aus `getBounds()`, weil `model-viewer` die Kamera auf die Hüllkugel, nicht auf die längste Kante legt. |
| 2026-10-17 | **Globus-Zoom bis 50** (`GLOBE_ZOOM_MIN`/`GLOBE_ZOOM_MAX`); ISS-Modellgröße jetzt `radius · zoom · ISS_MODELL_ANTEIL · Hüllkugel-Faktor` (der Zoom-Faktor fehlte). | Der Nutzer wollte deutlich näher an die Station heran. Die höhere Zoomgrenze und der mitwachsende Faktor lassen das Modell beim Hineinzoomen bis über den Bildschirm wachsen. |
| 2026-10-17 | **Freie Vollbild-Ansicht der Station** (neues `js/iss/issDetailView.js`, `model-viewer` mit `camera-controls`, Öffnen per Knopf auf der ISS-Seite; Zurück per Knopf, Esc und Wischgeste). | Vorbild war NASA Eyes: die Station soll frei umkreisbar und bis in jedes Detail zoombar sein. Auf dem Globus ist das Modell fest im Bild verankert und lässt sich nicht umkreisen. |
| 2026-10-17 | **Wischgeste nach links = eine Ebene zurück** (offene Detailseite bzw. 3D-Ansicht schließen, sonst Startansicht), kein Browser-`history.back()`. Wischen auf Kugel, Modell und Bedienelementen wird ignoriert. | COSMOS ist eine einzige Seite mit Tabs und eigenen Detailseiten – der Browser-Verlauf kennt diese Ebenen nicht, `history.back()` verließ die Seite statt zurückzugehen. |

---

## Todos

- [ ] ISS-Himmel visuell abnehmen: Dichte, Breite und Verlauf des Milchstraßen-Bandes.
- [ ] Echtes NASA-Modell **im Globus** visuell abnehmen: Größe, Helligkeit, Ausrichtung.
- [ ] ISS-Globus mit 50m-Kuestenlinien **visuell abnehmen**: Konturen, Bildrate beim Drehen auf dem iPad.
- [ ] Dritte Stufe (`laender-fein.json`, ab Zoom 8) auf dem iPad abnehmen: Konturen, einmaliger Nachlade-Ruckler, 60 fps.
- [ ] TLE-Frischepolitik festlegen und umsetzen.

---

## Changelog

Neueste Einträge oben. Format: `Datum | Commit | Änderung`.

| Datum      | Commit    | Änderung |
|------------|-----------|----------|
| 2026-10-17 | `216f0a0` | ISS: freie 3D-Ansicht der Station wie bei NASA Eyes – drehen und bis ins Detail zoomen, Zurück per Knopf, Esc und Wischgeste. |
| 2026-10-17 | `8f96cb0` | ISS: Globus-Zoom bis 50, Modell wächst mit dem Zoom; Wischgeste nach links geht eine Ebene zurück (in-app statt Browser-Verlauf). |
| 2026-10-05 | `40490b1` | ISS-Globus: dritte Detailstufe ab Zoom 8 aus Natural Earth 10m (0,02 Grad), sichtbares Fenster mit Clipping (Sutherland-Hodgman), Polschutz und feinere Länderumrandung aus 10m. |
| 2026-10-04 | `aa4bcdd` | ISS-Globus: grobe Detailstufe fuer die Vollansicht, feine 50m-Karte ab Zoom 1.6 - Ziehen wieder mit 60 fps. |
| 2026-10-04 | `d5311b7` | ISS-Globus: weisse Erde behoben (Ringlaufrichtung beim Vereinfachen). |
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
