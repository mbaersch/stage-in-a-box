/** Durchgängigkeit, Artikel über die Journey, Cookie-Helfer (lib/pruefungen.ts). */
import { test, expect } from '@playwright/test';
import {
  cookieMuster, ereignisseAus, istLoeschung, pruefeArtikelVerlauf, pruefeDeduplizierung, pruefeDurchgaengigkeit, pruefeGa4Grenzen,
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
    expect(text).toBe('transaction_id (253) gefunden in: oid – nicht im Profil, nicht geprüft');
  });

  test('Push ohne Werte: Nachweis sagt, dass nichts verglichen wurde', () => {
    const befunde = pruefeDurchgaengigkeit([{ zeit: 1000, daten: { event: 'purchase' } }], [ga4('en=purchase')], 'purchase');
    expect(befunde.map((b) => b.text)).toEqual(['verglichen: nichts – Push und Profil des Dienstes haben keine gemeinsamen Werte']);
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

test.describe('Event-ID zur Deduplizierung', () => {
  const sgtm = (body: string) => ({ zeit: 0, dienst: 'GA4', host: 'sgtm.shop.de', pfad: '/g/collect', parameter: { v: '2' }, body });
  const meta = (ev: string, eid?: string) => ({
    zeit: 0, dienst: 'Meta', host: 'www.facebook.com', pfad: '/tr/', parameter: { ev, ...(eid ? { eid } : {}) },
  });
  const texte = (befunde: { text: string }[]) => befunde.map((b) => b.text);

  test('gilt für jedes Event, nicht nur Conversions', () => {
    const befunde = pruefeDeduplizierung([
      sgtm('en=page_view&ep.event_id=PV-1\nen=add_to_cart&ep.event_id=ATC-1'),
      meta('PageView', 'PV-1'), meta('AddToCart', 'ATC-2'),
    ]);
    expect(rot(befunde)).toEqual(['Event-ID ATC-2 in keinem Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen']);
    expect(befunde.find((b) => b.ereignis === 'PageView')!.text).toBe('Event-ID PV-1 auch im Request an den Server-Container (ep.event_id)');
  });

  test('ID nur als Teil einer längeren ID zählt nicht', () => {
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=E-99'), meta('Purchase', 'E-9')]))).toHaveLength(1);
  });

  test('ohne ID: Hinweis je Event mit Anzahl', () => {
    const befunde = pruefeDeduplizierung([sgtm('en=page_view'), meta('PageView'), meta('PageView')]);
    expect(rot(befunde)).toEqual([]);
    expect(texte(befunde)).toEqual(['2× ohne Event-ID – keine Deduplizierung möglich (gewollt, wenn das Event nicht auch über die Conversions API geht)']);
  });

  test('ohne Server-Container: nichts zu prüfen', () => {
    const google = { ...sgtm('en=page_view'), host: 'region1.google-analytics.com' };
    expect(texte(pruefeDeduplizierung([google, meta('Purchase', 'E-9')]))).toEqual(['kein Request an einen Server-Container – nichts zu deduplizieren']);
  });

  test('TikTok: event_id im JSON-Body, Pinterest: im JSON-Parameter ed', () => {
    const tiktok = { zeit: 0, dienst: 'TikTok', host: 'analytics.tiktok.com', pfad: '/api/v2/pixel', parameter: {},
      body: JSON.stringify({ event: 'CompletePayment', event_id: 'TT-1' }) };
    const pin = { zeit: 0, dienst: 'Pinterest', host: 'ct.pinterest.com', pfad: '/v3/', parameter: { event: 'checkout', ed: JSON.stringify({ event_id: 'P-1' }) } };
    const befunde = pruefeDeduplizierung([sgtm('en=purchase&ep.tt_id=TT-1'), tiktok, pin]);
    expect(befunde.find((b) => b.dienst === 'TikTok')!.text).toBe('Event-ID TT-1 auch im Request an den Server-Container (ep.tt_id)');
    expect(befunde.find((b) => b.dienst === 'Pinterest')!.stufe).toBe('rot');
  });

  test('Gegenrichtung: Server-IDs ohne Pixel je Event gesammelt, auch fb_event_id', () => {
    const befunde = pruefeDeduplizierung([
      sgtm('en=generate_lead&ep.fb_event_id=L-17\nen=scroll&ep.event_id=S-1\nen=scroll&ep.event_id=S-2'),
      meta('Lead'),
    ]);
    expect(rot(befunde)).toEqual([]);
    const gegen = befunde.filter((b) => b.art === 'server-ohne-pixel').map((b) => `${b.ereignis}: ${b.text}`);
    expect(gegen).toEqual([
      'generate_lead: 1× Event-ID in ep.fb_event_id ohne Pixel-Request mit dieser ID (L-17)',
      'scroll: 2× Event-ID in ep.event_id ohne Pixel-Request mit dieser ID (S-1, S-2)',
    ]);
    expect(befunde.some((b) => b.art === 'pixel-ohne-id' && b.ereignis === 'Lead')).toBe(true);
  });

  test('Gegenrichtung: ID mit Pixel-Gegenstück wird nicht gemeldet, eigene Feldnamen', () => {
    const befunde = pruefeDeduplizierung([sgtm('en=purchase&ep.dedup=E-9&ep.event_id=E-9'), meta('Purchase', 'E-9')], undefined, [], [], ['ep.dedup']);
    expect(befunde.filter((b) => b.art === 'server-ohne-pixel')).toEqual([]);
    const andere = pruefeDeduplizierung([sgtm('en=purchase&ep.dedup=X-1'), meta('Purchase', 'X-1')], undefined, [], [], ['ep.dedup']);
    expect(andere.filter((b) => b.art === 'server-ohne-pixel')).toEqual([]);
  });

  test('eigene Regel als Server-Container, Ausnahme je Dienst', () => {
    const eigen = { zeit: 0, dienst: 'Eigener sGTM', host: 'data.shop.de', pfad: '/e', parameter: { id: 'E-9' } };
    expect(rot(pruefeDeduplizierung([eigen, meta('Purchase', 'E-9')], undefined, ['Eigener sGTM']))).toEqual([]);
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase'), meta('Purchase', 'E-9')], undefined, [], ['Meta']))).toEqual([]);
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
