/**
 * Offene Sitzung: Die Website öffnet sich im sichtbaren Browser, mit allen Anpassungen unten und allen
 * Extensions aus erweiterungen/. Start: npm run sitzung -- projects/<name>. Ende: Browser schließen.
 * Mit SITZUNG_VORSCHAU_LINK in .env verbindet sich vorher der Tag Assistant mit dem GTM-Workspace.
 */
import { sitzung } from '../../../lib/stage';

sitzung.use({ stageOptionen: {
  // Wie ein echter Besuch: Requests gehen raus. 'abfangen' protokolliert nur, gesendet wird nichts.
  trackingModus: 'durchlassen',

  // Beispiele, Details in AGENTS.md („Varianten“). Läuft im Browser: keine Variablen aus dieser Datei.
  // dataLayerAnpassen: (e) => { if (e?.event === 'consent_ready') e.youtube = e.statistics === true; },
  // anpassungen: [{ muster: /\/skript\.js/, anpassen: (js) => js.replace('alt', 'neu') }],
  // regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }],
  // csp: "default-src 'self'; script-src 'self' https://www.googletagmanager.com",
} });

sitzung('Sitzung @sitzung', async ({ page, stage }) => {
  const seite = process.env.SITZUNG_VORSCHAU_LINK ? await stage.vorschauStarten(page) : page;
  if (seite === page) await page.goto('/');
  await stage.offenHalten(seite);
});
