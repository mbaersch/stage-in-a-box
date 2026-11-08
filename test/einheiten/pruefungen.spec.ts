/** Durchgängigkeit, Artikel über die Journey, Cookie-Helfer (lib/pruefungen.ts). */
import { test, expect } from '@playwright/test';
import { cookieMuster, ereignisseAus, istLoeschung, pruefeArtikelVerlauf, pruefeDurchgaengigkeit } from '../../lib/pruefungen';

const kauf = (ecommerce: Record<string, unknown>) => ({ zeit: 1000, daten: { event: 'purchase', ecommerce } });
const ga4 = (body: string, zeit = 1100) => ({ zeit, dienst: 'GA4', pfad: '/g/collect', parameter: { v: '2', cu: 'EUR' }, body });
const rot = (befunde: { stufe: string; text: string }[]) => befunde.filter((b) => b.stufe === 'rot').map((b) => b.text);
/** Befunde ohne den Nachweis, was verglichen wurde */
const ohneNachweis = <T extends { text: string }>(befunde: T[]) => befunde.filter((b) => !b.text.startsWith('verglichen:'));

test.describe('pruefeDurchgaengigkeit', () => {
  const push = kauf({ value: 119.9, currency: 'EUR', transaction_id: 'T-1', items: [{ item_id: 'A' }, { item_id: 'B' }] });

  test('passende Werte: kein Befund', () => {
    const befunde = pruefeDurchgaengigkeit([push], [ga4('en=purchase&epn.value=119.9&ep.transaction_id=T-1&pr1=idA~nmX&pr2=idB~nmY')], 'purchase');
    expect(befunde).toEqual([{ stufe: 'info', ereignis: 'purchase', dienst: 'GA4', text: 'verglichen: value, currency, transaction_id, items' }]);
  });

  test('abweichender Wert und fehlende Artikel sind rot', () => {
    const befunde = pruefeDurchgaengigkeit([push], [ga4('en=purchase&epn.value=100&ep.transaction_id=T-1')], 'purchase');
    expect(rot(befunde)).toEqual(['value 100 statt 119.9', 'Artikel fehlen (dataLayer: A, B)']);
  });

  test('gebündelte Events: nur die Zeile mit dem Ereignis zählt', () => {
    const body = 'en=page_view\nen=purchase&epn.value=119.9&ep.transaction_id=T-1&pr1=idA&pr2=idB';
    expect(ohneNachweis(pruefeDurchgaengigkeit([push], [ga4(body)], 'purchase'))).toEqual([]);
  });

  test('Ausnahme unterdrückt den Befund', () => {
    const befunde = pruefeDurchgaengigkeit([push], [ga4('en=purchase&epn.value=1&ep.transaction_id=T-1&pr1=idA&pr2=idB')], 'purchase', ['GA4:value']);
    expect(ohneNachweis(befunde)).toEqual([]);
    expect(befunde[0].text).toBe('verglichen: value (Ausnahme), currency, transaction_id, items');
  });

  test('valueNurHinweis (Google Ads): abweichender Wert nur Hinweis', () => {
    const ads = { zeit: 1100, dienst: 'Google Ads', pfad: '/pagead/conversion/123/', parameter: { label: 'x', value: '99', currency_code: 'EUR', oid: 'T-1' } };
    const befunde = pruefeDurchgaengigkeit([push], [ads], 'purchase');
    expect(rot(befunde)).toEqual([]);
    expect(befunde.map((b) => b.text)).toContain('value 99 statt 119.9');
  });

  test('Dienst ohne Profil: kurze Transaktions-ID nicht als Teil einer Seiten-URL', () => {
    const p = kauf({ value: 5, transaction_id: '253' });
    const fremd = { zeit: 1100, dienst: 'Eigen', pfad: '/t', parameter: { dl: 'https://shop.de/order-received/253/', oid: '253' } };
    const text = pruefeDurchgaengigkeit([p], [fremd], 'purchase').map((b) => b.text).find((t) => t.startsWith('transaction_id'));
    expect(text).toBe('transaction_id (253) gefunden in: oid – kein Profil, nicht geprüft');
  });

  test('Push ohne Werte: Nachweis sagt, dass nichts verglichen wurde', () => {
    const befunde = pruefeDurchgaengigkeit([{ zeit: 1000, daten: { event: 'purchase' } }], [ga4('en=purchase')], 'purchase');
    expect(befunde.map((b) => b.text)).toEqual(['verglichen: nichts – der Push enthält keine Werte, die das Profil des Dienstes kennt']);
  });

  test('kein Request nach dem Push: Hinweis', () => {
    const befunde = pruefeDurchgaengigkeit([push], [ga4('en=page_view', 100)], 'purchase');
    expect(befunde).toEqual([{ stufe: 'info', ereignis: 'purchase', dienst: 'GA4', text: 'nach dem Push gar kein Request dieses Dienstes' }]);
  });
});

test.describe('pruefeArtikelVerlauf', () => {
  const p = (event: string, items: Record<string, unknown>[]) => ({ zeit: 0, daten: { event, ecommerce: { items } } });

  test('Artikel wechselt die ID: rot', () => {
    const befunde = pruefeArtikelVerlauf([p('view_item', [{ item_id: 'A', item_name: 'Schuh' }]), p('purchase', [{ item_id: 'A-42', item_name: 'Schuh' }])]);
    expect(rot(befunde)).toHaveLength(1);
  });

  test('Feld kommt später dazu: nur Hinweis „üblich“', () => {
    const befunde = pruefeArtikelVerlauf([
      p('view_item', [{ item_id: 'A', item_name: 'Schuh' }]),
      p('begin_checkout', [{ item_id: 'A', item_name: 'Schuh', item_category: 'Schuhe' }]),
    ]);
    expect(rot(befunde)).toEqual([]);
    expect(befunde[0].text).toContain('erst ab begin_checkout');
  });
});

test('ereignisseAus', () => {
  expect(ereignisseAus(true)).toEqual({ ereignisse: ['purchase'], ausnahmen: [] });
  expect(ereignisseAus(['generate_lead'])).toEqual({ ereignisse: ['generate_lead'], ausnahmen: [] });
  expect(ereignisseAus({ ausnahmen: ['Meta:items'] })).toEqual({ ereignisse: ['purchase'], ausnahmen: ['Meta:items'] });
  expect(ereignisseAus(undefined).ereignisse).toEqual([]);
});

test('cookieMuster fasst Kennungen zusammen', () => {
  expect(cookieMuster('_ga_AB12CD34')).toBe('_ga_<ID>');
  expect(cookieMuster('_uetmsclkid')).toBe('_uetmsclkid');
  expect(cookieMuster('sess_0123456789abcdef')).toBe('sess_#');
});

test('istLoeschung', () => {
  expect(istLoeschung('Path=/; Max-Age=0')).toBe(true);
  expect(istLoeschung('expires=Thu, 01 Jan 1970 00:00:00 GMT')).toBe(true);
  expect(istLoeschung('Max-Age=3600')).toBe(false);
});
