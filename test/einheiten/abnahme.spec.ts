/** Lesbare Zeilen für den Abnahme-Lauf (lib/abnahme.ts). */
import { test, expect } from '../../lib/playwright';
import { dataLayerZeile, trefferZeile } from '../../lib/abnahme';
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
});
