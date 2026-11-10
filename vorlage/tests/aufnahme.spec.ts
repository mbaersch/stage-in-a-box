/**
 * Aufnahme: Die Website öffnet sich im sichtbaren Browser mit frischem Profil. Einmal durch den Prozess gehen,
 * dann den Browser schließen. Klicks, Eingaben, dataLayer und Tracking-Requests landen in
 * aufzeichnungen/aufnahme-<Zeit>.json; auswerten mit npm run analyse -- <datei>.
 * Start: npm run aufnahme -- projects/<name>. Startadresse und Vorschau-Link aus dem Auftrag
 * (bei mehreren: AUFTRAG=<name> vor dem Befehl).
 */
import { sitzung } from '../../../lib/stage';

sitzung.use({ stageOptionen: {
  // Wie ein echter Besuch: Requests gehen raus. Mit 'abfangen' wird nur protokolliert.
  trackingModus: 'durchlassen',
  // Texteingaben maskiert; { werte: 'full' } nimmt Klartext auf (für testdaten.aufzeichnung.env).
  aufnahme: true,
} });

sitzung('Aufnahme @aufnahme', async ({ page, stage, baseURL }) => {
  await page.goto(baseURL!);
  await stage.offenHalten(page);
});
