#!/usr/bin/env python3
"""Erzeugt assets/world/laender-50m.json aus Natural Earth 50m.

Quelle (nicht einchecken, sondern vorher nach /tmp/ne50.geojson holen):
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

Es geht darum, dem Globus dieselben Kuestenlinien zu geben, die die
Laendersuche schon benutzt, ohne dass der Browser fuer jedes Bild 100.000
Punkte durch die Projektion schickt. Drei Eingriffe:

1. Pro Ring Douglas-Peucker mit 0,08 Grad (rund 9 km). Kleine Inseln
   bekommen eine kleinere Toleranz als ihre eigene Ausdehnung, sonst
   verschwinden Monaco, Tuvalu oder die Marshall-Inseln ganz.
2. Runde auf drei Nachkommastellen.
3. Nur die Aussenringe behalten, als MultiPolygon ausgeben.

Dazu zwei Regeln, die nichtoptional sind - ohne sie faellt die Weltkugel
schon bei einem einzigen Land mit weisser Kugel auf:

4. Die Laufrichtung jedes Rings bleibt die des Originals. Bei sehr flachen
   Ringen (einer Sandbank, einem Riff) kann das Vorzeichen der Flaeche durch
   Vereinfachen und Runden kippen. d3 deutet die Kugel dann umgekehrt und
   fuellt die Komplementflaeche: die ganze Erde wird weiss. Deshalb wird der
   Ring zurueckgedreht, sobald das Vorzeichen abweicht.
5. Ringe, die sich nach dem Vereinfachen selbst schneiden, werden ersetzt.
   Solche Ringe sind zwar selten, koennen aber dieselbe Fuellung umkehren.
   Der Originalring ist dann nur ein paar Punkte groesser.

Aufruf:
  python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-50m.json
"""

import json
import math
import sys

TOLERANZ = 0.08          # Grad, Douglas-Peucker fuer grosse Kuestenlinien
TOLERANZ_UNTEN = 0.004   # Grad, darunter wird nicht weiter vereinfacht
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
    """True, wenn sich zwei Kanten des geschlossenen Rings kreuzen."""
    n = len(ring) - 1                      # letzter Punkt ist der erste
    kanten = [(ring[i], ring[i + 1]) for i in range(n)]
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if kreuzt(kanten[i][0], kanten[i][1], kanten[j][0], kanten[j][1]):
                return True
    return False


def bearbeite_ring(ring, meldung, toleranz=TOLERANZ, anteil=RING_ANTEIL, min_weite=0.0):
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
            meldung("Selbstschnitt ersetzt")
            neu = gerundet
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
               anteil=RING_ANTEIL, min_weite=0.0):
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
            ring = bearbeite_ring(poly[0], zaehler, toleranz, anteil, min_weite)
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
    # Grobe Karte (nur fuer die ganze Kugel, muss beim Drehen schnell sein):
    #   python3 tools/weltkarte.py /tmp/ne50.geojson assets/world/laender-grob.json 0.5 0.05 0.2
    #   (Toleranz, Anteil der Ringweite als Grenze, Ringe unter 0,2 Grad raus)
    quelle = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ne50.geojson"
    ziel = sys.argv[2] if len(sys.argv) > 2 else "assets/world/laender-50m.json"
    toleranz = float(sys.argv[3]) if len(sys.argv) > 3 else TOLERANZ
    anteil = float(sys.argv[4]) if len(sys.argv) > 4 else RING_ANTEIL
    min_weite = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    verarbeite(quelle, ziel, print, toleranz, anteil, min_weite)