# Staging im Browser (offene Sitzung)

Der Mensch will die Website mit Anpassungen selbst bedienen, z. B. um im GTM etwas vorzubauen, das die Website noch nicht kann. Kein `auftrag.md`, keine Phasen. Bei Unklarheit (welcher Push, welcher Wert, welche Seite) kurz nachfragen.

## Sitzung

Jedes neue Projekt hat `tests/sitzung.spec.ts`. `npm run sitzung -- projects/<name>` öffnet damit die Website (`BASE_URL`) im sichtbaren Browser, mit den `stageOptionen` dieser Datei und allen Extensions aus `erweiterungen/`; mit `SITZUNG_VORSCHAU_LINK` in `.env` verbindet sich vorher der Tag Assistant (siehe [`gtm-vorschau.md`](gtm-vorschau.md)). Die Sitzung endet, wenn der Mensch den Browser schließt.

- Die Sitzung startest Du für den Menschen im Hintergrund (`npm run sitzung -- projects/<name>`); der Browser erscheint auf seinem Bildschirm.
- `trackingModus` ist in Sitzungen `durchlassen` (wie ein echter Besuch). `abfangen` nur auf Wunsch.
- Mehrere Sitzungen in einem Projekt: weitere `sitzung(…)`-Tests mit `@sitzung` im Titel, dann mit `-g` auswählen.

Aufbau eines Sitzungs-Tests: `sitzung(…)` statt `test(…)` (aus `lib/stage`), `@sitzung` im Titel, am Ende `await stage.offenHalten(seite)`. Der Mensch bedient dann den sichtbaren Browser selbst, mit allen Regeln und Anpassungen der Stage. Solche Tests laufen nur mit `npm run sitzung -- projects/<name>`, nie bei `npm test`.

## Anpassungen umsetzen

Wünsche des Menschen („in der Sitzung soll der CMP-Push zusätzlich … enthalten“, „Dienst X blockieren“, „neuen Loader einsetzen“) setzt Du als `stageOptionen` in `tests/sitzung.spec.ts` um: `dataLayerAnpassen`, `anpassungen`, `regeln`, `csp`. Details und Beispiele: [`varianten.md`](varianten.md). Längere Logik in `tests/hilfen.ts`.

Prüfe eine Anpassung vor der Übergabe ohne Sitzung: kurzer Test im Modus `abfangen` bis zu der Stelle, an der sie wirkt (z. B. `consent_ready` im dataLayer bzw. im GTM-Datenmodell `google_tag_manager[<ID>].dataLayer.get(…)`), danach löschen. Echte Formulare nicht absenden.

## Extensions

`npm run erweiterung -- <Web-Store-ID | zip | ordner>` legt sie entpackt in `erweiterungen/` (nicht in Git). Benötigte Rechte (z. B. Host-Zugriff) erteilt der Mensch in der Sitzung selbst; das Profil ist bei jeder Sitzung frisch.
