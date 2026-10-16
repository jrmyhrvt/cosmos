#!/usr/bin/env python3
"""Erzeugt die Weltkarten unter assets/world/ aus Natural Earth.

Quellen (nicht einchecken, sondern vorher nach /tmp holen):
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson

Der Globus zeichnet je nach Zoom eine andere Stufe (siehe WELT_*_ZOOM in
js/iss/issConstants.js), damit beim Drehen die Bildrate haelt:

  assets/world/laender-grob.json   0,5 Grad  Natural Earth 50m   ganze Kugel
  assets/world/laender-50m.json    0,08 Grad Natural Earth 50m   hineingezoomt
  assets/world/laender-fein.json   0,02 Grad Natural Earth 10m   tief hinein

Es geht darum, dem Globus Kuestenlinien zu geben, die man wirklich ablesen
kann, ohne dass der Browser fuer jedes Bild Hunderttausende Punkte durch die
Projektion schickt. Drei Eingriffe:

1. Pro Ring Douglas-Peucker mit der gewaehlten Toleranz. Kleine Inseln
   bekommen eine kleinere Toleranz als ihre eigene Ausdehnung, sonst
   verschwinden Monaco, Tuvalu oder die Marshall-Inseln ganz.
2. Runde auf drei Nachkommastellen.
3. Nur die Aussenringe behalten, als MultiPolygon ausgeben.

Dazu zwei Regeln, die nichtoptional sind - ohne die erste faellt die
Weltkugel schon bei einem einzigen Land mit weisser Kugel auf:

4. Die Laufrichtung jedes Rings bleibt die des Originals. Bei sehr flachen
   Ringen (einer Sandbank, einem Riff) kann das Vorzeichen der Flaeche durch
   Vereinfachen und Runden kippen. d3 deutet die Kugel dann umgekehrt und
   fuellt die Komplementflaeche: die ganze Erde wird weiss. Deshalb wird der
   Ring zurueckgedreht, sobald das Vorzeichen abweicht.
5. Ringe, die sich nach dem Vereinfachen selbst schneiden, werden feiner
   vereinfacht (Toleranz halbieren), bis sie in Ordnung sind. Die Kuesten von
   Norwegen, Kanada oder Indonesien sind so zerklueftet, dass Douglas-
   Peucker dort fast immer eine Kreuzung erzeugt.

Wichtig: Selbstschnitte werden NICHT durch den kompletten Originalring
ersetzt. Sie kosten sonst Tausende Punkte (Kanada: 26.000 statt 2.000) und
machen die Datei teuer, ohne dass es noetig waere - geprueft an allen 258
Laendern ueber mehrere Kugeldrehungen fuellt kein Land die Kugel, und
Wasserpunkte bleiben schwarz. Der letzte Parameter "ersetzen" schaltet das
alte Verhalten fuer Vergleichsmessungen wieder frei.

Aufruf:
  python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-50m.json
  python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-grob.json 0.5 0.05 0.2
  python3 tools/weltkarte.py /tmp/ne10m.geojson assets/world/laender-fein.json 0.02
"""

import json
import math
import sys

TOLERANZ = 0.08          # Grad, Douglas-Peucker fuer grosse Kuestenlinien
TOLERANZ_UNTEN = 0.00125  # Grad, darunter wird nicht weiter vereinfacht
                         # (die Runde auf drei Nachkommastellen ist ohnehin
                         #  grober als das: etwa 110 m)
RING_ANTEIL = 0.2        # Toleranz hoechstens so gross wie die Ringweite
RUNDE = 3                # Nachkommastellen
FELDER = ["NAME", "NAME_DE", "NAME_EN", "NAME_ES", "NAME_ALT", "ISO_A2", "ISO_A2_EH"]


def vereinfache(ring, tol):
    """Douglas-Peucker fuer einen geschlossenen Ring (ohne Doppelstartpunkt)."""
    if len(ring) < 3:
        return list(ring)
    x1, y1 = ring[0]
    x2, y2 = ring[-1]
    dx, dy = x2 - x1, y2 - y1
    laenge = math.hypot(dx, dy)
    bestes, stelle = -1.0, -1
    for i in range(1, len(ring) - 1):
        x, y = ring[i]
        if laenge == 0:
            abstand = math.hypot(x - x1, y - y1)
        else:
            abstand = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / laenge
        if abstand > bestes:
            bestes, stelle = abstand, i
    if bestes > tol:
        links = vereinfache(ring[:stelle + 1], tol)
        rechts = vereinfache(ring[stelle:], tol)
        return links[:-1] + rechts
    return [ring[0], ring[-1]]


def flaeche(ring):
    """Flaeche im Vorzeichenformat (positiv = gegen den Uhrzeiger)."""
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2


def kreuzt(p1, p2, p3, p4):
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return (v > 1e-12) - (v < -1e-12)
    return orient(p1, p2, p3) != orient(p1, p2, p4) and orient(p3, p4, p1) != orient(p3, p4, p2)


def schneidet_sich(ring):
    """True, wenn sich zwei Kanten des geschlossenen Rings kreuzen.

    Der Test ist doppelt verschachtelt, bei einem Ring mit 50.000 Kanten
    waeren das Milliarden Vergleiche. Ein Raster ueber die Kanten-Boxen
    sortiert die Kandidaten vor, geprueft wird aber exakt dasselbe wie
    vorher: nur Kantenpaare, deren Boxen sich ueberlappen, koennen sich
    schneiden.
    """
    n = len(ring) - 1                      # letzter Punkt ist der erste
    if n < 4:
        return False
    boxen = []
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        boxen.append((min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)))

    # Zellgroesse: so fein, dass eine Kante meist in wenigen Zellen liegt.
    lon_min = min(b[0] for b in boxen)
    lon_max = max(b[2] for b in boxen)
    lat_min = min(b[1] for b in boxen)
    lat_max = max(b[3] for b in boxen)
    zellen = 64
    dx = max((lon_max - lon_min) / zellen, 1e-9)
    dy = max((lat_max - lat_min) / zellen, 1e-9)

    raster = {}
    for i, (bx1, by1, bx2, by2) in enumerate(boxen):
        for cx in range(int((bx1 - lon_min) / dx), int((bx2 - lon_min) / dx) + 1):
            for cy in range(int((by1 - lat_min) / dy), int((by2 - lat_min) / dy) + 1):
                raster.setdefault((cx, cy), []).append(i)

    geprueft = set()
    for kandidaten in raster.values():
        if len(kandidaten) < 2:
            continue
        for a in range(len(kandidaten)):
            i = kandidaten[a]
            for b in range(a + 1, len(kandidaten)):
                j = kandidaten[b]
                if j <= i + 1 or (i == 0 and j == n - 1):
                    continue                    # Nachbarkanten duerfen sich nicht kreuzen
                if (i, j) in geprueft:
                    continue
                geprueft.add((i, j))
                if i + 1 >= j:
                    continue
                if kreuzt(ring[i], ring[i + 1], ring[j], ring[j + 1]):
                    return True
    return False


def bearbeite_ring(ring, meldung, toleranz=TOLERANZ, anteil=RING_ANTEIL, min_weite=0.0,
                   ersetzen=False):
    """Ein Aussenring: vereinfachen, runden, Laufrichtung und Form sichern."""
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    gerundet = [[round(p[0], RUNDE), round(p[1], RUNDE)] for p in ring]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    weite = max(max(lons) - min(lons), max(lats) - min(lats))
    if weite < min_weite:
        return None                                   # unter einem Pixel gross
    tol = min(toleranz, anteil * weite)

    # Regel 5: Selbstschnitte durch halbierte Toleranz bekämpfen, nicht durch
    # den kompletten Originalring. Sonst wächst ein einziger grosser Ring
    # (Kanada) wieder auf mehrere Tausend Punkte und die grobe Karte wird
    # teuer, obwohl sie grob sein sollte. Erst ganz unten greift der
    # Originalring - Richtigkeit ist wichtiger als Dateigroesse.
    while True:
        gekuerzt = vereinfache([(p[0], p[1]) for p in ring], tol)
        neu = [[round(x, RUNDE), round(y, RUNDE)] for x, y in gekuerzt]
        if len({(p[0], p[1]) for p in neu}) < 3:
            return None                               # nichts mehr zu sehen
        if not schneidet_sich(neu + [neu[0]]):
            break
        if tol <= TOLERANZ_UNTEN:
            if ersetzen:
                meldung("Selbstschnitt ersetzt")
                neu = gerundet
            else:
                meldung("Selbstschnitt behalten")
            break
        tol = max(tol / 2, TOLERANZ_UNTEN)
        meldung("Selbstschnitt vereinfacht")

    vorher = flaeche(gerundet)
    nachher = flaeche(neu)
    if vorher * nachher < 0:
        # Regel 4: das Vorzeichen darf nicht kippen.
        neu.reverse()
        meldung("Laufrichtung wiederhergestellt")
    neu.append(neu[0][:])
    return neu


def verarbeite(quelle, ziel, meldung=lambda text: None, toleranz=TOLERANZ,
               anteil=RING_ANTEIL, min_weite=0.0, ersetzen=False):
    daten = json.load(open(quelle))
    laender = []
    ohne_ringe = 0
    ersetzt = 0
    gedreht = 0
    schaerfer = 0

    def zaehler(text):
        nonlocal ersetzt, gedreht, schaerfer
        if text.startswith("Selbstschnitt ersetzt"):
            ersetzt += 1
        elif text.startswith("Selbstschnitt vereinfacht"):
            schaerfer += 1
        else:
            gedreht += 1

    for land in daten["features"]:
        geom = land.get("geometry")
        if not geom:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        neu = []
        for poly in polys:
            ring = bearbeite_ring(poly[0], zaehler, toleranz, anteil, min_weite, ersetzen)
            if ring:
                neu.append([ring])
        if not neu:
            ohne_ringe += 1
            continue
        eig = land.get("properties") or {}
        laender.append({
            "type": "Feature",
            "properties": {k: eig[k] for k in FELDER if eig.get(k)},
            "geometry": {"type": "MultiPolygon", "coordinates": neu},
        })

    aus = {"type": "FeatureCollection", "features": laender}
    text = json.dumps(aus, separators=(",", ":"))
    open(ziel, "w").write(text)
    punkte = sum(len(r) for f in laender for poly in f["geometry"]["coordinates"] for r in poly)
    meldung(f"{len(laender)} Laender, {punkte} Punkte, {len(text)/1024:.0f} KB, "
            f"Toleranz {toleranz} Grad, Ringanteil {anteil}")
    meldung(f"{gedreht} Ringe mit gekipptem Vorzeichen zurueckgedreht, "
            f"{schaerfer} Ringe feiner vereinfacht, {ersetzt} Ringe wegen "
            f"Selbstschnitt ersetzt, {ohne_ringe} Laender ohne Flaeche")
    pruefe(aus, daten)
    return aus


def pruefe(aus, daten):
    """Gegenprobe: jeder Ring muss dieselbe Laufrichtung wie das Original haben."""
    alt = {}
    for land in daten["features"]:
        geom = land.get("geometry")
        if not geom:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in polys:
            ring = poly[0][:-1] if poly[0][0] == poly[0][-1] else poly[0]
            alt.setdefault(land["properties"].get("NAME"), []).append(flaeche(ring))

    falsch = []
    leer = []
    for land in aus["features"]:
        name = land["properties"].get("NAME")
        quellen = alt.get(name, [])
        for poly in land["geometry"]["coordinates"]:
            ring = poly[0][:-1]
            if len(ring) < 3:
                leer.append(name)
            vorzeichen = 1 if flaeche(ring) > 0 else -1
            if not any(vorzeichen * (1 if f > 0 else -1) > 0 for f in quellen):
                falsch.append(name)
    if falsch:
        raise SystemExit(f"FEHLER: Laufrichtung weicht ab bei {sorted(set(falsch))[:8]}")
    if leer:
        raise SystemExit(f"FEHLER: zu kurze Ringe bei {sorted(set(leer))[:8]}")
    print("Gegenprobe ok: Laufrichtungen und Ringlaengen passen zum Original")


if __name__ == "__main__":
    # Feine Karte (Globus beim Hineinzoomen):
    #   python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-50m.json
    # Weitere Stufen: Toleranz, Anteil der Ringweite, Mindestweite, Ersetzen
    #   python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-grob.json 0.5 0.05 0.2
    #   python3 tools/weltkarte.py /tmp/ne10m.geojson assets/world/laender-fein.json 0.02
    quelle = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ne50.geojson"
    ziel = sys.argv[2] if len(sys.argv) > 2 else "assets/world/laender-50m.json"
    toleranz = float(sys.argv[3]) if len(sys.argv) > 3 else TOLERANZ
    anteil = float(sys.argv[4]) if len(sys.argv) > 4 else RING_ANTEIL
    min_weite = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    ersetzen = (sys.argv[6] != "0") if len(sys.argv) > 6 else False
    verarbeite(quelle, ziel, print, toleranz, anteil, min_weite, ersetzen)
