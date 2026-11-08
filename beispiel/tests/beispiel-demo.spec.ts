/**
 * Beispiel: Einstieg → Consent geben → Seite wechseln → Conversion-Button.
 *
 * Läuft gegen die Demo-Seite (demo/) und zeigt das Muster, nach dem Tests aus einer
 * Aufzeichnung entstehen: jeder test.step entspricht einem Abschnitt der Journey,
 * Aktionen kommen aus den Recorder-Einträgen, Erwartungen aus den dataLayer-Events
 * und Treffern derselben Aufzeichnung.
 *
 * Zwei Arten von Tests:
 * - Feste Erwartungen (Modus "abfangen"): prüfen gezielt, was der Auftrag verlangt.
 * - Baseline-Vergleich (Modus "durchlassen"): vergleicht den kompletten Lauf mit einem
 *   gespeicherten Ist-Zustand (baselines/demo-lead-journey.json, mit Proxy .proxy.json).
 *
 * Für eine echte Website (BASE_URL gesetzt) werden diese Tests übersprungen.
 */
import { test, expect, type Stage } from '../../lib/stage';
import type { Page } from '@playwright/test';
import fs from 'node:fs';

test.skip(!!process.env.BASE_URL, 'Beispiel läuft nur gegen die Demo-Seite');

/** Die eigentliche Journey; von mehreren Tests mit unterschiedlichen Bedingungen genutzt. */
async function journey(page: Page, stage: Stage, consent: 'akzeptieren' | 'ablehnen') {
  await test.step('Einstieg', async () => {
    await page.goto('/');
    await stage.dataLayer.erwarteConsent('default', { analytics_storage: 'denied' });
  });

  await test.step(`Consent: ${consent}`, async () => {
    // Aufgezeichneter Abstand zum vorherigen Schritt; wirkt nur mit TEMPO=aufzeichnung
    await stage.denkpause(3200);
    // Recorder: click, element.name "Alle akzeptieren", shadowHosts [#demo-cmp-root],
    // selectors[0] = [data-testid="cmp-accept"] (unique) → getByTestId
    await page.getByTestId(consent === 'akzeptieren' ? 'cmp-accept' : 'cmp-deny').click();
    const wert = consent === 'akzeptieren' ? 'granted' : 'denied';
    await stage.dataLayer.erwarteConsent('update', { analytics_storage: wert, ad_storage: wert });
  });

  await test.step('Seite wechseln', async () => {
    // Recorder: click auf link "Angebot ansehen", danach neuer pageId mit init auf /angebot.html
    await stage.denkpause(5400);
    await page.getByRole('link', { name: 'Angebot ansehen' }).click();
    await expect(page).toHaveURL(/angebot\.html$/);
    await stage.dataLayer.erwarteEvent('seite_geladen', { passt: (d) => d.seitentyp === 'angebot' });
  });

  await test.step('Conversion auslösen', async () => {
    await stage.denkpause(4100);
    const ab = stage.dataLayer.eintraege.length;
    // Recorder: click mit clickedNode <span>, aufgelöst auf <button>, testAttr cta-anfrage
    await page.getByTestId('cta-anfrage').click();
    const lead = await stage.dataLayer.erwarteEvent('generate_lead', { ab });
    // Dynamische Werte nur im Format prüfen, feste Werte exakt
    expect(lead.daten).toMatchObject({ lead_typ: 'angebot', value: 50, currency: 'EUR' });
    expect(lead.daten.lead_id).toMatch(/^L-\d+$/);
    await expect(page.getByText('Danke für Deine Anfrage!')).toBeVisible();
  });
}

test.describe('Lead-Journey', () => {
  test('mit Zustimmung: Conversion wird mit vollem Consent gemessen', async ({ page, stage }) => {
    await journey(page, stage, 'akzeptieren');

    await test.step('Treffer prüfen', async () => {
      const lead = await stage.tracking.erwarteGa4('generate_lead');
      expect(lead.gcs).toBe('G111');
      expect(lead['ep.lead_typ']).toBe('angebot');
      // Erster page_view vor der Entscheidung ohne Consent, auf der Angebotsseite mit Consent
      const views = stage.tracking.ga4('page_view');
      expect(views.map((v) => v.gcs)).toEqual(['G100', 'G111']);
      // Nichts hat den Browser verlassen
      expect(stage.tracking.treffer.every((t) => t.modus === 'abfangen')).toBe(true);
    });
  });

  test('mit Ablehnung: Conversion nur ohne Consent', async ({ page, stage }) => {
    await journey(page, stage, 'ablehnen');
    const lead = await stage.tracking.erwarteGa4('generate_lead');
    expect(lead.gcs).toBe('G100');
  });
});

test.describe('Variante: GA4 blockiert (Adblocker)', () => {
  test.use({ stageOptionen: { trackingModus: 'blockieren' } });

  test('Seite und dataLayer funktionieren weiter', async ({ page, stage }) => {
    await journey(page, stage, 'akzeptieren');
    expect(stage.tracking.ga4('generate_lead')).toHaveLength(1);
    expect(stage.tracking.treffer.every((t) => t.modus === 'blockieren')).toBe(true);
  });
});

test.describe('Variante: Adblocker mit Filterregeln', () => {
  // Im Projekt meist adblocker: 'ublock' oder 'streng' (öffentliche Listen, werden geladen).
  // Hier eine eigene Regel, damit das Beispiel ohne Netz läuft: blockiert GA4-Pfade auch auf der eigenen Domain.
  test.use({ stageOptionen: { adblocker: { regeln: ['/g/collect?'] } } });

  test('Seite funktioniert, GA4 kommt nicht durch', async ({ page, stage }) => {
    await journey(page, stage, 'akzeptieren');
    expect(stage.tracking.ga4('generate_lead')).toHaveLength(1);
    expect(stage.tracking.treffer.every((t) => t.adblocker === '/g/collect?')).toBe(true);
    expect(stage.adblocker?.blockiert.every((b) => b.dienst === 'GA4')).toBe(true);
  });
});

test.describe('Variante: Adblocker mit Ersatzskript für GTM', () => {
  // uBlock blockiert gtm.js nicht, sondern liefert ein Ersatzskript: eventCallback und Anti-Flicker laufen weiter.
  test.use({ stageOptionen: { adblocker: { regeln: ['||googletagmanager.com/gtm.js$script,redirect=googletagmanager_gtm.js'] } } });

  test('eventCallback läuft, obwohl GTM fehlt', async ({ page, stage }) => {
    await page.goto('/');
    const ablauf = await page.evaluate(async () => {
      const w = window as any;
      const ereignisse: string[] = [];
      w.dataLayer.hide = { end: () => ereignisse.push('Seite freigegeben') };
      await new Promise((fertig) => {
        const s = document.createElement('script');
        s.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-DEMO';
        s.onload = fertig;
        document.head.append(s);
      });
      await new Promise((fertig) => w.dataLayer.push({ event: 'formular_gesendet', eventCallback: () => { ereignisse.push('weiter'); fertig(null); } }));
      return ereignisse;
    });
    expect(ablauf).toEqual(['Seite freigegeben', 'weiter']);
    expect(stage.adblocker?.blockiert[0].ersatz).toEqual({ name: 'google-analytics_analytics.js', nachgebildet: true });
    await stage.dataLayer.erwarteEvent('formular_gesendet');
  });
});

test.describe('Variante: geplante CSP ohne Freigabe für Tracking-Endpunkte', () => {
  test.use({ stageOptionen: { csp: "default-src 'self'; connect-src 'none'" } });

  test('CSP blockiert GA4-Treffer', async ({ page, stage }) => {
    await journey(page, stage, 'akzeptieren');
    await expect.poll(() => stage.cspVerstoesse.some((v) => v.blockiert.includes('/g/collect'))).toBe(true);
    expect(stage.tracking.ga4('generate_lead')).toHaveLength(0);
  });
});

test.describe('Baseline', () => {
  // Baselines entstehen und vergleichen immer mit echten Requests, sonst fehlen Folge-Requests.
  // Die Demo-Seite simuliert einen sGTM, der auf Conversions mit einer Weiterleitung antwortet.
  test.use({
    stageOptionen: {
      trackingModus: 'durchlassen',
      regeln: [{ name: 'sGTM-Pixel', muster: /\/sgtm-pixel/ }],
      // Laufen mit: Werte der Conversion kommen bei GA4 an; Cookies vor der Consent-Entscheidung in der Baseline
      pruefungen: { durchgaengigkeit: ['generate_lead'], cookies: true },
    },
  });

  test('Lead-Journey entspricht der Baseline', async ({ page, stage }) => {
    await journey(page, stage, 'akzeptieren');
    // Folge-Request aus der Weiterleitung ist nur mit echten Antworten vorhanden
    await stage.tracking.erwarteTreffer('sGTM-Pixel', { passt: (t) => !!t.umleitungVon });
    // lead_id ist bei jedem Lauf neu und wird nur auf Vorhandensein geprüft
    await stage.vergleicheMitBaseline('Demo Lead-Journey', { fluechtigeKeys: ['lead_id'] });
  });

  test('Abweichung wird erkannt: Conversion doppelt im dataLayer', async ({ page, stage }, testInfo) => {
    // Darf nie selbst eine Baseline schreiben, sonst würde der Fehlerzustand zum Soll.
    const datei = `../baselines/demo-lead-journey${stage.mitProxy ? '.proxy' : ''}.json`;
    const vorhanden = fs.existsSync(new URL(datei, import.meta.url));
    test.skip(!vorhanden || ['all', 'changed'].includes(testInfo.config.updateSnapshots), 'nur Vergleich gegen bestehende Baseline');
    // Erwartet rot: zeigt, dass der Vergleich doppelte Events meldet.
    test.fail();
    await page.addInitScript(() => { (window as any).__demoFehler = 'doppelt'; });
    await journey(page, stage, 'akzeptieren');
    await stage.vergleicheMitBaseline('Demo Lead-Journey', { fluechtigeKeys: ['lead_id'] });
  });

  test('Abweichung wird erkannt: neues Cookie vor der Consent-Entscheidung', async ({ page, stage }, testInfo) => {
    const datei = `../baselines/demo-lead-journey${stage.mitProxy ? '.proxy' : ''}.json`;
    const vorhanden = fs.existsSync(new URL(datei, import.meta.url));
    test.skip(!vorhanden || ['all', 'changed'].includes(testInfo.config.updateSnapshots), 'nur Vergleich gegen bestehende Baseline');
    // Erwartet rot: ein Tracker setzt schon vor der Zustimmung ein Cookie.
    test.fail();
    await page.addInitScript(() => { document.cookie = 'tracker_vor_consent=1; path=/; max-age=86400'; });
    await journey(page, stage, 'akzeptieren');
    await stage.vergleicheMitBaseline('Demo Lead-Journey', { fluechtigeKeys: ['lead_id'] });
  });
});
