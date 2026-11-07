#!/bin/sh
# Erzeugt beide Varianten aus src/recorder-core.js:
#   dist/gtm-recorder-tag.html  – Inhalt für ein benutzerdefiniertes HTML-Tag im GTM
#   dist/recorder.js            – eigenständig (DevTools Local Overrides, Extensions, Snippets)
set -e
cd "$(dirname "$0")"
mkdir -p dist

{
  echo '<script>'
  echo '  // Recorder-Einstellungen. Aufzeichnen nur nach Aufruf der Startseite mit'
  echo '  // ?sib_rec=masked oder ?sib_rec=full; gilt im selben Tab bis ?sib_rec=aus.'
  echo '  window.__recConfig = {'
  echo "    param: 'sib_rec',"
  echo "    values: 'masked', // Vorgabe für ?sib_rec ohne Wert: 'masked' | 'full'"
  echo '    console: false'
  echo '  };'
  echo '</script>'
  echo '<script>'
  cat src/recorder-core.js
  echo '</script>'
} > dist/gtm-recorder-tag.html

{
  echo '// Recorder-Einstellungen für den eigenständigen Einsatz. Vor dem Einbinden anpassen.'
  echo 'window.__recConfig = window.__recConfig || {'
  echo '  enabled: true,'
  echo "  values: 'masked', // 'masked' | 'full'"
  echo '  console: true'
  echo '};'
  cat src/recorder-core.js
} > dist/recorder.js

echo "dist/gtm-recorder-tag.html und dist/recorder.js erzeugt"
