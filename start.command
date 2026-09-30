#!/bin/bash
# COSMOS lokal starten.
#
# Wichtig: index.html darf nicht per Doppelklick geoeffnet werden. Die Datei
# besteht jetzt aus ES-Modulen, und Browser blockieren das Laden von Modulen
# ueber "file://" aus Sicherheitsgruenden. Deshalb startet dieses Skript einen
# kleinen Webserver, der die Dateien aus diesem Ordner ausliefert.
#
# Verwendung: Doppelklick auf diese Datei (im Finder).
# Beenden:    im Terminalfenster "Strg + C" druecken.

cd "$(dirname "$0")" || exit 1

PORT=8765
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "COSMOS laeuft auf http://127.0.0.1:$PORT/"
echo "Dieses Fenster offen lassen. Beenden mit Strg + C."
echo

sleep 1
open "http://127.0.0.1:$PORT/index.html"

python3 -m http.server $PORT --bind 127.0.0.1
