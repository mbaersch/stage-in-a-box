/**
 * Beispiele für Prüfungen, die in einer Journey mitlaufen (lib/pruefungen.ts): Durchgängigkeit der
 * Conversion-Werte vom dataLayer zu den Diensten, GA4-Erfassungsgrenzen und Cookies mit Zeitpunkt zur
 * Consent-Entscheidung.
 */
import { test, expect } from '../../lib/stage';
import type { Page } from '../../lib/playwright';

async function leadJourney(page: Page, zustimmung = true) {
  await page.goto('/');
  await page.getByTestId(zustimmung ? 'cmp-accept' : 'cmp-deny').click();
  await page.getByRole('link', { name: 'Angebot ansehen' }).click();
  await page.getByTestId('cta-anfrage').click();
  await expect(page.getByText('Danke für Deine Anfrage!')).toBeVisible();
}

test.describe('GA4-Erfassungsgrenzen', () => {
  // Läuft am Testende automatisch; rot bei zu langen Namen, zu vielen Parametern oder Requests über 16 KB
  test.use({ stageOptionen: { pruefungen: { ga4Grenzen: true } } });

  test('Events der Journey liegen im Rahmen', async ({ page }) => {
    await leadJourney(page);
  });
});

test.describe('Durchgängigkeit', () => {
  // Läuft am Testende automatisch; rot bei Abweichung, Details in durchgaengigkeit.json
  test.use({ stageOptionen: { pruefungen: { durchgaengigkeit: ['generate_lead'] } } });

  test('Wert und Währung kommen bei GA4 an', async ({ page, stage }) => {
    await leadJourney(page);
    const befunde = await stage.pruefeDurchgaengigkeit('generate_lead');
    expect(befunde.filter((b) => b.stufe === 'rot')).toEqual([]);
  });

  test.describe(() => {
    // Simuliert einen Fehler: Der dataLayer meldet einen anderen Wert, als GA4 bekommt.
    test.use({ stageOptionen: {
      pruefungen: { durchgaengigkeit: ['generate_lead'] },
      dataLayerAnpassen: (e) => { if (e?.event === 'generate_lead') e.value = 99; },
    } });

    test('Abweichung wird erkannt: value im dataLayer ≠ value im Request', async ({ page, stage }) => {
      test.fail();
      await leadJourney(page);
      void stage;
    });
  });
});

test.describe('Cookies', () => {
  test.use({ stageOptionen: { pruefungen: { cookies: true } } });

  test('mit Zustimmung: Analyse-Cookie erst danach', async ({ page, stage }) => {
    await leadJourney(page);
    const cookies = await stage.cookies();
    const sitzung = cookies.find((c) => c.muster === 'demo_sitzung');
    const analyse = cookies.find((c) => c.muster === '_demo_analytics');
    expect(sitzung?.zuerstGesetzt).toBe('vor Consent');
    expect(analyse).toMatchObject({ zuerstGesetzt: 'nach Consent', quellen: ['skript'], laufzeit: '≤ 13 Monate', amEnde: true });
  });

  test('mit Ablehnung: kein Analyse-Cookie', async ({ page, stage }) => {
    await leadJourney(page, false);
    expect((await stage.cookies()).map((c) => c.muster)).not.toContain('_demo_analytics');
  });
});
