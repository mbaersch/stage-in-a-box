/**
 * Offene Sitzung: Die Website öffnet sich im sichtbaren Browser, mit allen Anpassungen unten und allen
 * Extensions aus erweiterungen/. Start: npm run sitzung -- projects/<name>. Ende: Browser schließen.
 * Startadresse aus dem Auftrag (bei mehreren: AUFTRAG=<name> vor dem Befehl) oder aus START unten.
 */
import { sitzung } from '../../../lib/stage';

// Leer: Startadresse des Auftrags. Sonst eine volle Adresse.
const START = '';
// Link aus GTM „Vorschau teilen“: Vorher verbindet sich der Tag Assistant mit dem Workspace. Leer: Live-Container.
const VORSCHAU_LINK = '';

sitzung.use({
  ...(START ? { baseURL: START } : {}),
  stageOptionen: {
    // Wie ein echter Besuch: Requests gehen raus. 'abfangen' protokolliert nur, gesendet wird nichts.
    trackingModus: 'durchlassen',

    // Beispiele, Details in docs/anleitung/varianten.md. Läuft im Browser: keine Variablen aus dieser Datei.
    // dataLayerAnpassen: (e) => { if (e?.event === 'consent_ready') e.youtube = e.statistics === true; },
    // anpassungen: [{ muster: /\/skript\.js/, anpassen: (js) => js.replace('alt', 'neu') }],
    // regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }],
    // csp: "default-src 'self'; script-src 'self' https://www.googletagmanager.com",
  },
});

sitzung('Sitzung @sitzung', async ({ page, stage, baseURL }) => {
  const link = VORSCHAU_LINK || process.env.SITZUNG_VORSCHAU_LINK;
  const seite = link ? await stage.vorschauStarten(page, link) : page;
  if (seite === page) await page.goto(baseURL!);
  await stage.offenHalten(seite);
});
