# Staging im Browser (offene Sitzung)

Der Mensch will die Website mit Anpassungen selbst bedienen, z. B. um im GTM etwas vorzubauen, das die Website noch nicht kann. Kein Auftrag nötig, keine Phasen. Bei Unklarheit (welcher Push, welcher Wert, welche Seite) kurz nachfragen.

## Sitzung

Jedes neue Projekt hat `tests/sitzung.spec.ts`. `npm run sitzung -- projects/<name>` öffnet damit die Website im sichtbaren Browser, mit den `stageOptionen` dieser Datei und allen Extensions aus `erweiterungen/`. Startadresse: `START` in der Datei, sonst die des Auftrags (bei mehreren `AUFTRAG=<name>`). Beides trägst Du selbst ein. Mit `VORSCHAU_LINK` in der Datei verbindet sich vorher der Tag Assistant (siehe [`gtm-vorschau.md`](gtm-vorschau.md)). Die Sitzung endet, wenn der Mensch den Browser schließt.

- Die Sitzung startest Du für den Menschen im Hintergrund (`npm run sitzung -- projects/<name>`); der Browser erscheint auf seinem Bildschirm. Ebenso die Aufnahme-Sitzung (`npm run aufnahme`, siehe [`aufzeichnung.md`](aufzeichnung.md)); sie schreibt beim Schließen eine Aufzeichnung.
- `trackingModus` ist in Sitzungen `durchlassen` (wie ein echter Besuch). `abfangen` nur auf Wunsch.
- Mehrere Sitzungen in einem Projekt: weitere `sitzung(…)`-Tests mit `@sitzung` im Titel, dann mit `-g` auswählen.

Aufbau eines Sitzungs-Tests: `sitzung(…)` statt `test(…)` (aus `lib/stage`), `@sitzung` im Titel, am Ende `await stage.offenHalten(seite)`. Der Mensch bedient dann den sichtbaren Browser selbst, mit allen Regeln und Anpassungen der Stage. Solche Tests laufen nur mit `npm run sitzung -- projects/<name>`, nie bei `npm test`.

## Anpassungen umsetzen

Wünsche des Menschen („in der Sitzung soll der CMP-Push zusätzlich … enthalten“, „Dienst X blockieren“, „neuen Loader einsetzen“) setzt Du als `stageOptionen` in `tests/sitzung.spec.ts` um: `dataLayerAnpassen`, `anpassungen`, `regeln`, `csp`. Details und Beispiele: [`varianten.md`](varianten.md). Längere Logik in `tests/hilfen.ts`.

Prüfe eine Anpassung vor der Übergabe ohne Sitzung: kurzer Test im Modus `abfangen` bis zu der Stelle, an der sie wirkt (z. B. `consent_ready` im dataLayer bzw. im GTM-Datenmodell `google_tag_manager[<ID>].dataLayer.get(…)`), danach löschen. Echte Formulare nicht absenden.

## sGTM-Vorschau

Soll in der Sitzung auch der Server-Container in seiner Vorschau laufen: In der sGTM-Vorschau unter „Requests manuell senden“ den Wert des Headers `X-Gtm-Server-Preview` kopieren und als `SITZUNG_SGTM_HEADER` in `.env` eintragen, den Host des Server-Containers als `SITZUNG_SGTM_HOST`. Die Stage setzt den Header dann nur in Sitzungen und nur für Requests an diesen Host. Was der Server-Container weitersendet, zeigt seine Vorschau.

## Extensions

`npm run erweiterung -- <Web-Store-ID | zip | ordner>` legt sie entpackt in `erweiterungen/` (nicht in Git). Benötigte Rechte (z. B. Host-Zugriff) erteilt der Mensch in der Sitzung selbst; das Profil ist bei jeder Sitzung frisch.
