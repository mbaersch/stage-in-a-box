# Gegen eine GTM-Vorschau testen

Gilt für Tests (alle eines Projekts), für Sitzungen und für den Container-Umbau. Den Link holt der Mensch in GTM über *Vorschau teilen* (mit `id`, `gtm_auth` und `gtm_preview`) und trägt ihn in Anführungszeichen in `.env` ein. Ein Tag-Assistant-Link mit nur `gtm_debug` startet keine Vorschau des Workspaces.

| Variable | Wirkung |
|---|---|
| `GTM_VORSCHAU_LINK` | **alle** Tests des Projekts laden die Vorschau (Injection) |
| `SITZUNG_VORSCHAU_LINK` | nur Sitzungen starten damit den Tag Assistant; alle übrigen Tests bleiben beim Live-Container |

Nie `GTM_VORSCHAU_LINK` für eine Sitzung empfehlen: Der schaltet die Vorschau für alle Tests des Projekts ein, auch für Baseline-Vergleiche. Nicht denselben Link in beide Variablen.

## Weg 1: Injection (Vorgabe)

Ist `GTM_VORSCHAU_LINK` gesetzt, hängt die Stage `gtm_auth`, `gtm_preview` und `gtm_cookies_win` an jedes Laden des Containers mit dieser ID, in allen Tests des Projekts. Der Test braucht dafür nichts Besonderes.

- Eigener Loader ohne `id=GTM-…` in der URL (Stape u. a.): `stageOptionen: { vorschauLoader: /\/<pfad>\/<datei>\.js\?/ }`.
- Prüfen, dass die Vorschau wirklich geladen ist (z. B. ein Event oder Tag, das nur im Workspace existiert), bevor Erwartungen entstehen.
- **Grenze:** Ohne Tag Assistant ist *Debug Mode* `false` (siehe [`../wissen/gtm.md`](../wissen/gtm.md)). Hängen Tags an einem Blocker wie „Nicht-Live-Umgebung und nicht Debug Mode“, feuern sie nicht. Dann Weg 2.

## Weg 2: über den Tag Assistant

Die Journey beginnt mit `const website = await stage.vorschauStarten(page)` und läuft danach im Tab `website` weiter, nicht in `page`. In `@sitzung`-Tests nimmt `vorschauStarten` den `SITZUNG_VORSCHAU_LINK`, sonst `GTM_VORSCHAU_LINK`.

- Im frischen Browser erscheint der Dialog „Verbinden“; `vorschauStarten` klickt `#domain-start-button` und wartet auf den neuen Tab. Der Tab mit dem Tag Assistant bleibt offen, sonst endet die Vorschau.
- Eigener dataLayer und eigene GA4-Requests des Tag Assistant werden nicht protokolliert (`WERKZEUG_SEITEN` in `lib/stage.ts`).
