/** Durchgängigkeit, Artikel über die Journey, Cookie-Helfer (lib/pruefungen.ts). */
import { test, expect } from '@playwright/test';
import {
  cookieMuster, ereignisseAus, istLoeschung, pruefeArtikelVerlauf, pruefeDurchgaengigkeit, pruefeGa4Grenzen,
} from '../../lib/pruefungen';

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
  expect(ereignisseAus(true)).toEqual({ ereignisse: ['purchase'], ausnahmen: [], serverDienste: [] });
  expect(ereignisseAus(['generate_lead'])).toEqual({ ereignisse: ['generate_lead'], ausnahmen: [], serverDienste: [] });
  expect(ereignisseAus({ ausnahmen: ['Meta:items'], serverDienste: ['sGTM'] }))
    .toEqual({ ereignisse: ['purchase'], ausnahmen: ['Meta:items'], serverDienste: ['sGTM'] });
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

test.describe('Event-ID zur Deduplizierung', () => {
  const push = kauf({ value: 10, currency: 'EUR', transaction_id: 'T-1' });
  const meta = (eid?: string) => ({
    zeit: 1100, dienst: 'Meta', host: 'www.facebook.com', pfad: '/tr/',
    parameter: { ev: 'Purchase', 'cd[value]': '10', 'cd[currency]': 'EUR', ...(eid ? { eid } : {}) },
  });
  const sgtm = (body: string) => ({ zeit: 1050, dienst: 'GA4', host: 'sgtm.shop.de', pfad: '/g/collect', parameter: { v: '2', cu: 'EUR' }, body });
  const texte = (befunde: { text: string }[]) => befunde.map((b) => b.text);

  test('ID des Pixels kommt beim Server-Container an', () => {
    const befunde = pruefeDurchgaengigkeit([push], [sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1&ep.event_id=E-9'), meta('E-9')], 'purchase');
    expect(rot(befunde)).toEqual([]);
    expect(texte(befunde)).toContain('event_id E-9 auch im Request an den Server-Container (ep.event_id)');
  });

  test('ID fehlt im Request an den Server-Container: rot', () => {
    const befunde = pruefeDurchgaengigkeit([push], [sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1&ep.event_id=ANDERE'), meta('E-9')], 'purchase');
    expect(rot(befunde)).toEqual(['event_id E-9 fehlt im Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen']);
  });

  test('ID nur als Teil einer längeren ID zählt nicht', () => {
    const befunde = pruefeDurchgaengigkeit([push], [sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1&ep.event_id=E-99'), meta('E-9')], 'purchase');
    expect(rot(befunde)).toHaveLength(1);
  });

  test('Pixel ohne ID: nur Hinweis', () => {
    const befunde = pruefeDurchgaengigkeit([push], [sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1'), meta()], 'purchase');
    expect(rot(befunde)).toEqual([]);
    expect(texte(befunde)).toContain('Pixel ohne event_id – keine Deduplizierung mit der Conversions API möglich');
  });

  test('ohne Server-Container: nichts zu prüfen', () => {
    const ga4Google = { ...sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1'), host: 'region1.google-analytics.com' };
    const befunde = pruefeDurchgaengigkeit([push], [ga4Google, meta('E-9')], 'purchase');
    expect(texte(befunde).filter((t) => t.includes('event_id'))).toEqual([]);
  });

  test('eigene Regel als Server-Container und Ausnahme', () => {
    const eigen = { zeit: 1050, dienst: 'Eigener sGTM', host: 'data.shop.de', pfad: '/e', parameter: { id: 'E-9' } };
    expect(rot(pruefeDurchgaengigkeit([push], [eigen, meta('E-9')], 'purchase', [], undefined, ['Eigener sGTM']))).toEqual([]);
    expect(rot(pruefeDurchgaengigkeit([push], [sgtm('en=purchase&epn.value=10&ep.transaction_id=T-1'), meta('E-9')], 'purchase', ['Meta:event_id']))).toEqual([]);
  });
});

test.describe('GA4-Grenzen', () => {
  const ga4 = (query: string, body?: string) => ({
    zeit: 0, dienst: 'GA4', host: 'region1.google-analytics.com', pfad: '/g/collect',
    url: `https://region1.google-analytics.com/g/collect?${query}`, parameter: Object.fromEntries(new URLSearchParams(query)), body,
  });
  const stufen = (befunde: { stufe: string; text: string }[]) => befunde.map((b) => `${b.stufe}: ${b.text}`);

  test('alles im Rahmen: kein Befund', () => {
    expect(pruefeGa4Grenzen([ga4('v=2&en=purchase&ep.art=a&epn.value=1&dl=https%3A%2F%2Fshop.de%2F')])).toEqual([]);
  });

  test('zu langer Eventname und Parametername: rot', () => {
    const name = 'x'.repeat(41);
    expect(stufen(pruefeGa4Grenzen([ga4(`v=2&en=${name}&ep.${name}=1`)]))).toEqual([
      `rot: Eventname mit 41 Zeichen über 40: GA4 verarbeitet das Event nicht`,
      `rot: Parametername ${name} mit 41 Zeichen über 40`,
    ]);
  });

  test('zu viele Parameter: rot, bei 360 erst über 100', () => {
    const viele = Array.from({ length: 26 }, (_, i) => `ep.p${i}=1`).join('&');
    expect(rot(pruefeGa4Grenzen([ga4(`v=2&en=kauf&${viele}`)]))).toEqual(['26 Parameter über 25: GA4 verarbeitet die übrigen nicht']);
    expect(rot(pruefeGa4Grenzen([ga4(`v=2&en=kauf&${viele}`)], '360'))).toEqual([]);
  });

  test('überlange Werte: nur Hinweis, Ausnahmen für Seitenfelder', () => {
    const befunde = pruefeGa4Grenzen([ga4(`v=2&en=kauf&ep.name=${'a'.repeat(101)}&dt=${'t'.repeat(301)}&dl=${'u'.repeat(900)}`)]);
    expect(stufen(befunde)).toEqual(['info: Wert von name mit 101 Zeichen über 100', 'info: page_title mit 301 Zeichen über 300']);
  });

  test('gebündelte Events im Body einzeln geprüft', () => {
    const befunde = pruefeGa4Grenzen([ga4('v=2', `en=page_view\nen=${'y'.repeat(45)}`)]);
    expect(rot(befunde)).toEqual(['Eventname mit 45 Zeichen über 40: GA4 verarbeitet das Event nicht']);
  });

  test('Größe des Requests: Hinweis nahe 16 KB, rot darüber', () => {
    const zeile = (n: number) => `en=e${n}&ep.text=${'z'.repeat(90)}`;
    const body = (anzahl: number) => Array.from({ length: anzahl }, (_, i) => zeile(i)).join('\n');
    expect(stufen(pruefeGa4Grenzen([ga4('v=2', body(140))])).some((t) => t.startsWith('info: Request mit'))).toBe(true);
    expect(rot(pruefeGa4Grenzen([ga4('v=2', body(180))]))[0]).toMatch(/über 16 KB/);
  });

  test('User Properties', () => {
    const befunde = pruefeGa4Grenzen([ga4(`v=2&en=kauf&up.${'k'.repeat(25)}=1&up.typ=${'w'.repeat(37)}`)]);
    expect(stufen(befunde)).toEqual([`rot: Name der User Property ${'k'.repeat(25)} mit 25 Zeichen über 24`, 'info: Wert der User Property typ mit 37 Zeichen über 36']);
  });
});
