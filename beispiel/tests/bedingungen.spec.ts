/**
 * Beispiele für Bedingungen (lib/bedingungen.ts) gegen die Demo-Seite. Jede Bedingung wird über
 * stageOptionen für eine bestehende Journey eingeschaltet; hier jeweils eine kurze Journey dafür.
 */
import { test, expect } from '../../lib/stage';
import type { Page } from '@playwright/test';

async function zustimmen(page: Page) {
  await page.getByTestId('cmp-accept').click();
}

test.describe('Landung über eine Anzeige', () => {
  test.use({ stageOptionen: { landung: { klickIds: ['gclid'], utm: { source: 'google', medium: 'cpc' } } } });

  test('gclid wird gespeichert und mit der Conversion gesendet', async ({ page, stage }) => {
    const werte = await stage.landen(page);
    expect(werte.gclid).toMatch(/^TEST-sib-gclid-\d+$/);
    await zustimmen(page);
    await page.getByRole('link', { name: 'Angebot ansehen' }).click();
    const ab = stage.tracking.treffer.length; // nur Requests ab hier, nicht der page_view der Landung
    await page.getByTestId('cta-anfrage').click();
    const befund = await stage.erwarteKlickId('gclid', { dienst: 'GA4', ab });
    expect(befund.gespeichert.some((g) => g.startsWith('Cookie _gcl_aw'))).toBe(true);
  });
});

test.describe('UTM-Parameter', () => {
  // Separate Prüfung: Der erste Request von GA4 nach der Landung muss alle UTM-Paare tragen.
  test.use({ stageOptionen: { landung: { utm: { source: 'newsletter', medium: 'email', campaign: 'herbst' } }, pruefungen: { utm: ['GA4'] } } });

  test('kommen im ersten GA4-Request an', async ({ page, stage }) => {
    await stage.landen(page);
    const befund = await stage.erwarteUtm({ dienst: 'GA4' });
    expect(befund.ersterRequest.ereignis).toBe('page_view');
  });

  test('Abweichung wird erkannt: Seite entfernt die Parameter vor dem page_view', async ({ page, stage }) => {
    test.fail();
    // Simuliert eine Seite, die ihre URL "aufräumt", bevor das Tracking feuert
    await page.addInitScript(() => history.replaceState(null, '', location.pathname));
    await stage.landen(page);
    await stage.warteAufRuhe();
  });
});

test.describe.serial('Wiederkehrender Besucher', () => {
  test('erster Besuch: zustimmen und Zustand speichern', async ({ page, stage }) => {
    await page.goto('/');
    await zustimmen(page);
    await stage.dataLayer.erwarteConsent('update', { analytics_storage: 'granted' });
    await stage.zustandSpeichern('nach-zustimmung');
  });

  test.describe(() => {
    test.use({ stageOptionen: { startZustand: 'nach-zustimmung' } });

    test('zweiter Besuch: kein Banner, Consent sofort erteilt', async ({ page, stage }) => {
      await page.goto('/');
      await stage.dataLayer.erwarteConsent('update', { analytics_storage: 'granted' });
      await expect(page.getByTestId('cmp-accept')).toHaveCount(0);
      expect(stage.tracking.ga4('page_view')[0]?.gcs).toBe('G111');
    });
  });
});

test.describe('Uhr vorstellen', () => {
  test.use({ stageOptionen: { uhr: true } });

  test('Timer-Trigger nach 30 Sekunden, ohne zu warten', async ({ page, stage }) => {
    await page.goto('/');
    expect(stage.dataLayer.events('verweildauer_30s')).toHaveLength(0);
    await stage.zeitVorstellen('31s');
    await stage.dataLayer.erwarteEvent('verweildauer_30s');
  });
});

test.describe('Netz, CPU und Gerät', () => {
  test.use({ stageOptionen: { netz: '3g', cpu: 4, geraet: 'iPhone 15' } });

  test('Journey läuft auch langsam und mobil', async ({ page, stage }) => {
    await page.goto('/');
    expect(await page.evaluate(() => [screen.width, navigator.userAgent.includes('iPhone'), 'ontouchstart' in window]))
      .toEqual([393, true, true]);
    await zustimmen(page);
    await stage.dataLayer.erwarteConsent('update', { analytics_storage: 'granted' });
  });
});

test.describe('Browser-Kennung', () => {
  test.use({ stageOptionen: { userAgent: 'firefox' } });

  test('Firefox-Kennung ohne Chromium-Marken', async ({ page }) => {
    const anfrage = page.waitForRequest((r) => r.resourceType() === 'document');
    await page.goto('/');
    const headers = await (await anfrage).allHeaders();
    expect(headers['user-agent']).toContain('Firefox/');
    // Chromium sendet den Header leer statt gar nicht; Marken wie "Chromium" sind jedenfalls weg.
    expect(headers['sec-ch-ua'] ?? '').toBe('');
    expect(await page.evaluate(() => (navigator as any).userAgentData)).toBeUndefined();
  });
});

test('Standard-Kennung: Client Hints wie bei Chrome, ohne HeadlessChrome', async ({ page }) => {
  const anfrage = page.waitForRequest((r) => r.resourceType() === 'document');
  await page.goto('/');
  const headers = await (await anfrage).allHeaders();
  expect(headers['sec-ch-ua']).toContain('"Google Chrome"');
  expect(headers['sec-ch-ua']).not.toContain('Headless');
  expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
  expect(await page.evaluate(() => (navigator as any).userAgentData.platform)).toBe('Windows');
});

test.describe('Zurück-Navigation', () => {
  test.use({ stageOptionen: { bfcache: true } });

  test('aus dem bfcache: kein neuer page_view', async ({ page, stage }) => {
    await page.goto('/');
    await zustimmen(page);
    await page.getByRole('link', { name: 'Angebot ansehen' }).click();
    await expect(page).toHaveURL(/angebot/);
    await stage.warteAufRuhe();
    const vorher = stage.tracking.ga4('page_view').length;
    const ergebnis = await stage.zurueck(page);
    expect(ergebnis.ausBfcache).toBe(true);
    await stage.warteAufRuhe();
    // Die Demo misst page_view nur bei DOMContentLoaded: aus dem bfcache kommt keiner. Auf einer
    // echten Website ist genau das der Befund, den dieser Test sichtbar macht.
    expect(stage.tracking.ga4('page_view')).toHaveLength(vorher);
  });
});
