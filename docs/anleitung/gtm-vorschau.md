# Gegen eine GTM-Vorschau testen

Gilt für Tests (alle eines Auftrags), für Sitzungen und für den Container-Umbau. Den Link holt der Mensch in GTM über *Vorschau teilen* (mit `id`, `gtm_auth` und `gtm_preview`). Er ist teilbar und gibt keine Schreibrechte; Du trägst ihn selbst ein. Ein Tag-Assistant-Link mit nur `gtm_debug` startet keine Vorschau des Workspaces.

| Wo | Wirkung |
|---|---|
| Auftrag, Einstellungen: **GTM-Vorschau-Link** | **alle** Tests dieses Auftrags laden die Vorschau (Injection), auch die Aufnahme |
| `tests/sitzung.spec.ts`: `VORSCHAU_LINK` | nur die Sitzung startet damit den Tag Assistant |

Für eine Sitzung nie den Link im Auftrag empfehlen: Der schaltet die Vorschau für alle Tests des Auftrags ein, auch für Baseline-Vergleiche. Alte Projekte: `GTM_VORSCHAU_LINK` bzw. `SITZUNG_VORSCHAU_LINK` in `.env` wirken weiter, wenn Auftrag bzw. Sitzungsdatei keinen Link nennen.

## Weg 1: Injection (Vorgabe)

Steht im Auftrag ein GTM-Vorschau-Link, hängt die Stage `gtm_auth`, `gtm_preview` und `gtm_cookies_win` an jedes Laden des Containers mit dieser ID, in allen Tests des Auftrags. Der Test braucht dafür nichts Besonderes.

- Eigener Loader ohne `id=GTM-…` in der URL (Stape u. a.): `stageOptionen: { vorschauLoader: /\/<pfad>\/<datei>\.js\?/ }`.
- Prüfen, dass die Vorschau wirklich geladen ist (z. B. ein Event oder Tag, das nur im Workspace existiert), bevor Erwartungen entstehen.
- **Grenze:** Ohne Tag Assistant ist *Debug Mode* `false` (siehe [`../wissen/gtm.md`](../wissen/gtm.md)). Hängen Tags an einem Blocker wie „Nicht-Live-Umgebung und nicht Debug Mode“, feuern sie nicht. Dann Weg 2.

## Weg 2: über den Tag Assistant

Die Journey beginnt mit `const website = await stage.vorschauStarten(page)` und läuft danach im Tab `website` weiter, nicht in `page`. Ohne Link als Argument nimmt `vorschauStarten` den GTM-Vorschau-Link des Auftrags; die Sitzung übergibt ihren `VORSCHAU_LINK`.

- Im frischen Browser erscheint der Dialog „Verbinden“; `vorschauStarten` klickt `#domain-start-button` und wartet auf den neuen Tab. Der Tab mit dem Tag Assistant bleibt offen, sonst endet die Vorschau.
- Eigener dataLayer und eigene GA4-Requests des Tag Assistant werden nicht protokolliert (`WERKZEUG_SEITEN` in `lib/stage.ts`).
- Auf der ersten Seite nicht weiternavigieren, bevor dort `gtm.dom` kam (z. B. auf ein Event danach warten). Sonst kommt die Debug-Verbindung nicht zustande, und alles, was nur im Debug Mode feuert, bleibt stumm.
- Große Container sind im Debug Mode sehr langsam (Sekunden bis `gtm.dom`, ausgelasteter Hauptthread). Dann `--workers=1`, auf jeder Seite auf ein Event nach `gtm.dom` warten und großzügige Timeouts setzen. Kommt Playwrights Prüfung vor dem Klick (ruhige Animation-Frames) unter der Last nicht durch: `scrollIntoViewIfNeeded()`, dann `click({ force: true })`, und die Wirkung über URL oder dataLayer prüfen.
