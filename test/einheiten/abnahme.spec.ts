/** Lesbare Zeilen für den Abnahme-Lauf (lib/abnahme.ts). */
import { test, expect } from '../../lib/playwright';
import { AbnahmeProtokoll, bannerInhalt, dataLayerZeile, trefferZeile } from '../../lib/abnahme';
import type { Treffer } from '../../lib/stage';

const treffer = (t: Partial<Treffer>): Treffer => ({
  nr: 0, zeit: 0, dienst: 'GA4', modus: 'durchlassen', methode: 'POST', url: '', host: 'region1.google-analytics.com',
  pfad: '/g/collect', parameter: {}, ...t,
} as Treffer);

test('dataLayerZeile: Event, gtag-Befehl, Push ohne Event, Recorder-Eintrag', () => {
  expect(dataLayerZeile({ daten: { event: 'add_to_cart', ecommerce: { value: 1 } } } as any))
    .toEqual({ titel: 'add_to_cart', daten: { ecommerce: { value: 1 } } });
  expect(dataLayerZeile({ daten: ['consent', 'update', { ad_storage: 'granted' }] } as any))
    .toEqual({ titel: 'gtag consent update', daten: { ad_storage: 'granted' } });
  expect(dataLayerZeile({ daten: { ecommerce: null } } as any)).toEqual({ titel: '(Push ohne event)', daten: { ecommerce: null } });
  expect(dataLayerZeile({ daten: { __rec: { type: 'click' } } } as any)).toBeUndefined();
});

test('trefferZeile: Ereignis, Konto, Consent und Modus; gebündelte GA4-Events aus dem Body', () => {
  expect(trefferZeile(treffer({ parameter: { en: 'add_to_cart', tid: 'G-1', gcs: 'G111' } }))).toBe('add_to_cart · G-1 · gcs=G111');
  expect(trefferZeile(treffer({ parameter: { tid: 'G-1' }, body: 'en=scroll&ep.x=1\nen=view_item' }))).toBe('scroll + view_item · G-1');
  expect(trefferZeile(treffer({ dienst: 'Floodlight', modus: 'abfangen', pfad: '/activity', parameter: { cat: 'kat0', src: '123' } })))
    .toBe('kat0 · 123 · abgefangen');
  const beacon = treffer({ parameter: { en: 'scroll' }, fehler: 'net::ERR_ABORTED' });
  expect(trefferZeile(beacon, true)).toBe('scroll');
  expect(trefferZeile(beacon)).toBe('scroll · net::ERR_ABORTED');
});

test('bannerInhalt: Step als Phase, Unterschritte und Countdown, Zähler, Ende', () => {
  const z = { schritte: ['Warenkorb', 'Klick'], dl: 3, tr: 5 };
  expect(bannerInhalt({ ...z, pauseBis: 10_400 }, 8_000))
    .toEqual({ phase: 'Warenkorb', detail: 'Klick · nächste Aktion in 3 s', stats: 'dataLayer 3 · Hits 5', fertig: false });
  expect(bannerInhalt({ ...z, pauseBis: 7_000 }, 8_000).detail).toBe('Klick');
  expect(bannerInhalt({ schritte: [], dl: 0, tr: 0 }, 0).phase).toBe('Start');
  expect(bannerInhalt({ ...z, ende: true }, 0)).toMatchObject({ phase: 'Abnahme beendet', fertig: true });
});

test('Banner im Browser: sichtbar, für Selektoren der Tests unsichtbar; Kreis am Klickpunkt', async ({ page, context }) => {
  const abnahme = new AbnahmeProtokoll(context, { dataLayer: { eintraege: [] }, tracking: { treffer: [] } });
  await abnahme.start();
  await page.goto('data:text/html,<button style="margin-top:200px">Warenkorb</button>');
  abnahme.schrittBeginnt('Warenkorb');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('stage-abnahme'))).toBe(true);
  await expect(page.getByText('Warenkorb')).toHaveCount(1);
  await page.getByRole('button', { name: 'Warenkorb' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('div[aria-hidden]').length)).toBe(1);
  await page.screenshot({ path: test.info().outputPath('banner.png') });
  await abnahme.stop();
});
