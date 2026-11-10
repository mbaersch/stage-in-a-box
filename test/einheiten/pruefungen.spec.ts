/** Durchgängigkeit, Artikel über die Journey, Cookie-Helfer (lib/pruefungen.ts). */
import { test, expect } from '../../lib/playwright';
import { createHash } from 'node:crypto';
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

  test('Conversion ohne Wert und Währung (reine Zähl-Conversion): nur Hinweis', () => {
    const ads = { zeit: 1100, dienst: 'Google Ads', pfad: '/pagead/conversion/123/', parameter: { label: 'x', oid: 'T-1' } };
    const befunde = pruefeDurchgaengigkeit([push], [ads], 'purchase');
    expect(rot(befunde)).toEqual([]);
    expect(befunde.map((b) => b.text)).toContain('currency fehlt, value auch – Conversion ohne Wert (dataLayer: EUR)');
  });

  test('Wert ohne Währung bleibt rot', () => {
    const ads = { zeit: 1100, dienst: 'Google Ads', pfad: '/pagead/conversion/123/', parameter: { label: 'x', value: '119.9', oid: 'T-1' } };
    expect(rot(pruefeDurchgaengigkeit([push], [ads], 'purchase'))).toEqual(['currency fehlt (dataLayer: EUR)']);
  });

  test('Dienst ohne Profil: kurze Transaktions-ID nicht als Teil einer Seiten-URL', () => {
    const p = kauf({ value: 5, transaction_id: '253' });
    const fremd = { zeit: 1100, dienst: 'Eigen', pfad: '/t', parameter: { dl: 'https://shop.de/order-received/253/', oid: '253' } };
    const text = pruefeDurchgaengigkeit([p], [fremd], 'purchase').map((b) => b.text).find((t) => t.startsWith('transaction_id'));
    expect(text).toBe('transaction_id (253) gefunden in: oid – nicht im Profil, nicht geprüft');
  });

  test('Dienst ohne Profil: Wert mit Komma und in Cent gefunden', () => {
    const p = kauf({ value: 99.95, transaction_id: 'T-9' });
    const fremd = { zeit: 1100, dienst: 'Eigen', pfad: '/t', parameter: { 'm.valueDecimal': '99,95', amount: '9995' } };
    const text = pruefeDurchgaengigkeit([p], [fremd], 'purchase').map((b) => b.text).find((t) => t.startsWith('value'));
    expect(text).toBe('value (99.95) gefunden in: m.valueDecimal, amount – nicht im Profil, nicht geprüft');
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
  const meta = (ev: string, eid?: string, pixel = '111') => ({
    zeit: 0, dienst: 'Meta', host: 'www.facebook.com', pfad: '/tr/', parameter: { id: pixel, ev, ...(eid ? { eid } : {}) },
  });
  const texte = (befunde: { text: string }[]) => befunde.map((b) => b.text);
  const art = <T extends { art?: string }>(befunde: T[], a: string) => befunde.filter((b) => b.art === a);

  test('gilt für jedes Event, nicht nur Conversions', () => {
    const befunde = pruefeDeduplizierung([
      sgtm('en=page_view&ep.event_id=PV-1\nen=add_to_cart&ep.event_id=ATC-1'),
      meta('PageView', 'PV-1'), meta('AddToCart', 'ATC-2'),
    ]);
    expect(rot(befunde)).toEqual(['Event-ID ATC-2 in keinem Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen']);
    expect(befunde.find((b) => b.ereignis === 'PageView')!.text).toBe('Event-ID PV-1 auch im Request an den Server-Container (ep.event_id)');
  });

  test('ohne Zuordnung keine Meldung für IDs am Server ohne Pixel', () => {
    const befunde = pruefeDeduplizierung([sgtm('en=scroll&ep.event_id=S-1\nen=generate_lead&ep.event_id=L-1'), meta('Lead')]);
    expect(art(befunde, 'server-ohne-pixel')).toEqual([]);
    expect(texte(art(befunde, 'pixel-ohne-id'))).toEqual(['1× ohne Event-ID – keine Deduplizierung möglich (gewollt, wenn das Event nicht auch über die Conversions API geht)']);
  });

  test('mit Zuordnung: ID für Meta am Server ohne Meta-Pixel mit dieser ID', () => {
    const befunde = pruefeDeduplizierung(
      [sgtm('en=generate_lead&ep.fb_event_id=L-17\nen=purchase&ep.fb_event_id=P-1\nen=scroll&ep.event_id=S-1'), meta('Lead'), meta('Purchase', 'P-1')],
      undefined, [], [], { Meta: 'ep.fb_event_id' },
    );
    expect(texte(art(befunde, 'server-ohne-pixel'))).toEqual(['1× Event-ID für Meta am Server-Container (ep.fb_event_id) ohne Pixel-Request mit dieser ID (L-17)']);
  });

  test('ID nur als Teil einer längeren ID zählt nicht', () => {
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=E-99'), meta('Purchase', 'E-9')]))).toHaveLength(1);
  });

  test('dieselbe ID an verschiedenen Events bzw. mehrfach am selben Event', () => {
    const befunde = pruefeDeduplizierung([
      sgtm('en=x&ep.event_id=A-1&ep.b=B-1'),
      meta('PageView', 'A-1'), meta('AddToCart', 'A-1'), meta('Purchase', 'B-1'), meta('Purchase', 'B-1'),
    ]);
    // Nur dasselbe Event mehrfach bekommt „Achtung“; verschiedene Events mit einer ID je Push sind üblich
    expect(texte(art(befunde, 'id-mehrfach'))).toEqual([
      'Event-ID B-1 2× an Purchase – zählt beim Dienst nur einmal (doppelt gefeuert oder ID nicht je Event erzeugt)',
    ]);
    expect(texte(befunde)).toContain('Event-ID A-1 an verschiedenen Events (PageView, AddToCart) – gewollt bei einer ID je dataLayer-Push; nur ein Problem, wenn der Dienst allein nach der ID dedupliziert');
  });

  test('LinkedIn: eventId nur an /collect, Website-Signale an /wa/ zählen nicht', () => {
    const li = (pfad: string, parameter: Record<string, string>) => ({ zeit: 0, dienst: 'LinkedIn', host: 'px.ads.linkedin.com', pfad, parameter });
    const befunde = pruefeDeduplizierung([
      sgtm('en=generate_lead&evnid=E-19'),
      li('/collect', { pid: '1', conversionId: '9', eventId: 'E-19' }), li('/collect', { pid: '1', eventId: 'E-21' }), li('/wa/', { medium: 'fetch' }),
    ]);
    expect(rot(befunde)).toEqual(['Event-ID E-21 in keinem Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen']);
    expect(art(befunde, 'pixel-ohne-id')).toEqual([]);
  });

  test('mehrere Pixel einer Seite dürfen dieselbe ID tragen', () => {
    const befunde = pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=E-9'), meta('Purchase', 'E-9', '111'), meta('Purchase', 'E-9', '222')]);
    expect(art(befunde, 'id-mehrfach')).toEqual([]);
  });

  test('ohne Server-Container: Abgleich entfällt, doppelte IDs trotzdem', () => {
    const google = { ...sgtm('en=page_view'), host: 'region1.google-analytics.com' };
    const befunde = pruefeDeduplizierung([google, meta('Purchase', 'E-9'), meta('Purchase', 'E-9')]);
    expect(rot(befunde)).toEqual([]);
    expect(texte(befunde)[0]).toBe('kein Request an einen Server-Container – Abgleich mit dem Server entfällt');
    expect(art(befunde, 'id-mehrfach')).toHaveLength(1);
  });

  test('TikTok: event_id im JSON-Body, Pinterest: im JSON-Parameter ed', () => {
    const tiktok = { zeit: 0, dienst: 'TikTok', host: 'analytics.tiktok.com', pfad: '/api/v2/pixel', parameter: {},
      body: JSON.stringify({ event: 'CompletePayment', event_id: 'TT-1', context: { pixel: { code: 'C1' } } }) };
    const pin = { zeit: 0, dienst: 'Pinterest', host: 'ct.pinterest.com', pfad: '/v3/', parameter: { event: 'checkout', tid: '1', ed: JSON.stringify({ event_id: 'P-1' }) } };
    const befunde = pruefeDeduplizierung([sgtm('en=purchase&ep.tt_id=TT-1'), tiktok, pin]);
    expect(befunde.find((b) => b.dienst === 'TikTok')!.text).toBe('Event-ID TT-1 auch im Request an den Server-Container (ep.tt_id)');
    expect(befunde.find((b) => b.dienst === 'Pinterest')!.stufe).toBe('rot');
  });

  test('eigene Regel als Server-Container, Ausnahme je Dienst', () => {
    const eigen = { zeit: 0, dienst: 'Eigener sGTM', host: 'data.shop.de', pfad: '/e', parameter: { id: 'E-9' } };
    expect(rot(pruefeDeduplizierung([eigen, meta('Purchase', 'E-9')], undefined, ['Eigener sGTM']))).toEqual([]);
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase'), meta('Purchase', 'E-9')], undefined, [], ['Meta']))).toEqual([]);
  });

  test('ga4Server: false – GA4 auf eigener Domain (Google Tag Gateway) ist kein Server-Container', () => {
    const befunde = pruefeDeduplizierung([sgtm('en=purchase'), meta('Purchase', 'E-9')], undefined, [], [], {}, false);
    expect(rot(befunde)).toEqual([]);
    expect(texte(befunde)[0]).toBe('kein Request an einen Server-Container – Abgleich mit dem Server entfällt');
  });

  test('Requests ohne Event-Namen und technische Events zählen nicht', () => {
    const tiktok = (event?: string) => ({ zeit: 0, dienst: 'TikTok', host: 'analytics.tiktok.com', pfad: '/api/v2/pixel/act', parameter: {},
      body: JSON.stringify({ ...(event ? { event } : {}), event_id: '' }) });
    const pin = { zeit: 0, dienst: 'Pinterest', host: 'ct.pinterest.com', pfad: '/v3/', parameter: { event: 'init', tid: '1' } };
    const sync = { zeit: 0, dienst: 'Pinterest', host: 'ct.pinterest.com', pfad: '/user/', parameter: { tid: '1' } };
    const befunde = pruefeDeduplizierung([tiktok(), tiktok('EnrichAM'), tiktok('Pageview'), pin, sync]);
    expect(art(befunde, 'pixel-ohne-id').map((b) => `${b.dienst} ${b.ereignis}`)).toEqual(['TikTok Pageview']);
  });

  test('Snap: vom Pixel erzeugte cdid gilt als ohne ID der Seite', () => {
    const snap = (cdid: string) => ({ zeit: 0, dienst: 'Snap', host: 'tr.snapchat.com', pfad: '/p', parameter: { ev: 'PAGE_VIEW', pid: 'x', cdid } });
    const befunde = pruefeDeduplizierung([sgtm('en=page_view'), snap('@-744c739c'), snap('@-fb1b6d94')]);
    expect(rot(befunde)).toEqual([]);
    expect(texte(art(befunde, 'pixel-ohne-id'))[0]).toMatch(/^2× ohne Event-ID der Seite \(2× vom Pixel selbst erzeugt/);
  });

  test('OpenAI: mehrere Events je Request, Events des SDK zählen nicht', () => {
    const openai = { zeit: 0, dienst: 'OpenAI Ads', host: 'bzr.openai.com', pfad: '/v1/sdk/events', parameter: {},
      body: JSON.stringify({ pid: 'P1', events: [{ type: 'openai::sdk_init', id: 'u-1' }, { type: 'items_added', id: '1.2.30' }, { type: 'checkout_started', id: '1.2.31' }] }) };
    const befunde = pruefeDeduplizierung([sgtm('en=add_to_cart&ep.event_id=1.2.30'), openai]);
    expect(rot(befunde)).toEqual(['Event-ID 1.2.31 in keinem Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen']);
  });

  test('Reddit: conversionId als SHA-256 im Pixel, im Klartext am Server', () => {
    const reddit = { zeit: 0, dienst: 'Reddit', host: 'alb.reddit.com', pfad: '/rp', parameter: {},
      body: `id=a2_x&event=Purchase&m.conversionId=${createHash('sha256').update('ORDER-7').digest('hex')}` };
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=ORDER-7'), reddit]))).toEqual([]);
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=ORDER-8'), reddit]))).toHaveLength(1);
  });

  test('Reddit: Transaktions-ID hat Vorrang vor der Conversion-ID', () => {
    const h = (w: string) => createHash('sha256').update(w).digest('hex');
    const reddit = { zeit: 0, dienst: 'Reddit', host: 'alb.reddit.com', pfad: '/rp', parameter: {},
      body: `id=a2_x&event=Purchase&m.transactionId=${h('T-1')}&m.conversionId=${h('E-1')}` };
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.transaction_id=T-1'), reddit]))).toEqual([]);
    expect(rot(pruefeDeduplizierung([sgtm('en=purchase&ep.event_id=E-1'), reddit]))).toHaveLength(1);
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

  test('Nutzerdaten an den Server-Container (ep.user_data.*) zählen nicht als Parameter', () => {
    const nutzer = Array.from({ length: 30 }, (_, i) => `ep.user_data.address.0._tag_metadata.feld_${i}.mode=1`).join('&');
    expect(rot(pruefeGa4Grenzen([ga4(`v=2&en=kauf&${nutzer}`)]))).toEqual([]);
  });

  test('überlange Werte: nur Hinweis, Ausnahmen für Seitenfelder', () => {
    const befunde = pruefeGa4Grenzen([ga4(`v=2&en=kauf&ep.name=${'a'.repeat(101)}&dt=${'t'.repeat(301)}&dl=${'u'.repeat(900)}`)]);
    expect(stufen(befunde)).toEqual(['info: Wert von name mit 101 Zeichen über 100', 'info: page_title mit 301 Zeichen über 300']);
  });

  test('gebündelte Events im Body einzeln geprüft', () => {
    const befunde = pruefeGa4Grenzen([ga4('v=2', `en=page_view\nen=${'y'.repeat(45)}`)]);
    expect(rot(befunde)).toEqual(['Eventname mit 45 Zeichen über 40: GA4 verarbeitet das Event nicht']);
  });

  test('Größe des Requests: nur Hinweis über 16 KB (von Google nicht dokumentiert)', () => {
    const zeile = (n: number) => `en=e${n}&ep.text=${'z'.repeat(90)}`;
    const body = (anzahl: number) => Array.from({ length: anzahl }, (_, i) => zeile(i)).join('\n');
    expect(pruefeGa4Grenzen([ga4('v=2', body(140))])).toEqual([]);
    const gross = pruefeGa4Grenzen([ga4('v=2', body(180))]);
    expect(rot(gross)).toEqual([]);
    expect(stufen(gross)[0]).toMatch(/^info: Request mit .* über 16 KB/);
  });

  test('Länge URL-kodiert gezählt, bei 360 Werte bis 500', () => {
    // „ä“ zählt kodiert 6 Zeichen: 17 × 6 = 102 > 100
    expect(stufen(pruefeGa4Grenzen([ga4(`v=2&en=kauf&ep.name=${encodeURIComponent('ä'.repeat(17))}`)]))).toEqual(['info: Wert von name mit 102 Zeichen über 100']);
    expect(pruefeGa4Grenzen([ga4(`v=2&en=kauf&ep.name=${'a'.repeat(400)}`)], '360')).toEqual([]);
  });

  test('User Properties', () => {
    const befunde = pruefeGa4Grenzen([ga4(`v=2&en=kauf&up.${'k'.repeat(25)}=1&up.typ=${'w'.repeat(37)}`)]);
    expect(stufen(befunde)).toEqual([`rot: Name der User Property ${'k'.repeat(25)} mit 25 Zeichen über 24`, 'info: Wert der User Property typ mit 37 Zeichen über 36']);
  });
});
