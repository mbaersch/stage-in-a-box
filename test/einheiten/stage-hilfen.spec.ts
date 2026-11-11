/** Kleine Helfer der Stage und Baseline-Vergleich (lib/stage.ts, lib/baseline.ts). */
import { test, expect } from '../../lib/playwright';
import { mitParameter, vorschauParameter, trefferTeile, bekannteTreffer, STANDARD_DIENSTE } from '../../lib/stage';
import { vergleiche, bodyParameter, ohneTestzeit, anfragenAus, type Baseline } from '../../lib/baseline';

test('trefferTeile: getunnelter Request wird dekodiert, Host bleibt', () => {
  const kodiert = Buffer.from('/g/collect?v=2&tid=G-1&en=page_view').toString('base64');
  const regel = { dekodieren: (url: string) => Buffer.from(new URL(url).searchParams.get('x')!, 'base64').toString('utf8') };
  const url = `https://sgtm.a.de/tunnel?x=${encodeURIComponent(kodiert)}`;
  expect(trefferTeile(url, regel)).toEqual({ host: 'sgtm.a.de', pfad: '/g/collect', parameter: { v: '2', tid: 'G-1', en: 'page_view' } });
  expect(trefferTeile(url, { dekodieren: () => undefined }).pfad).toBe('/tunnel');
  expect(trefferTeile(url, { dekodieren: () => { throw new Error('kaputt'); } }).pfad).toBe('/tunnel');
  expect(trefferTeile(url).parameter).toEqual({ x: kodiert });
});

test('bodyParameter: Formular, multipart, Base64 und JSON', () => {
  expect(bodyParameter('en=page_view&tid=G-1')).toEqual({ en: 'page_view', tid: 'G-1' });
  const multipart = '------B1\r\nContent-Disposition: form-data; name="id"\r\n\r\n123\r\n'
    + '------B1\r\nContent-Disposition: form-data; name="ev"\r\n\r\nLead\r\n------B1--\r\n';
  expect(bodyParameter(multipart)).toEqual({ id: '123', ev: 'Lead' });
  expect(bodyParameter('H4sIAAAAAAAACkWQza7TMBSEXyU6a5s4zo9b765EuYooCNGqG4TQiX3cWHHcELsgdLlvxo4XQ1FsByNzjdz5gk==')).toEqual({});
  expect(bodyParameter('{"a":1}')).toEqual({});
});

test('ohneTestzeit: nur die Zeit im Testwert der Landung', () => {
  expect(ohneTestzeit('https://a.de/?gclid=TEST-sib-gclid-1794312089881&x=1'))
    .toBe('https://a.de/?gclid=TEST-sib-gclid-‹zeit›&x=1');
  expect(ohneTestzeit('TEST-sib-msclkid-1794312089881-1')).toBe('TEST-sib-msclkid-‹zeit›-1');
  expect(ohneTestzeit(42)).toBe(42);
});

test('mitParameter: setzt, ersetzt, behält Kodierung und Hash', () => {
  expect(mitParameter('https://a.de/g/collect', 'tt', 'intern')).toBe('https://a.de/g/collect?tt=intern');
  expect(mitParameter('https://a.de/g/collect?v=2&tt=alt&dl=https%3A%2F%2Fs.de', 'tt', 'neu'))
    .toBe('https://a.de/g/collect?v=2&dl=https%3A%2F%2Fs.de&tt=neu');
  expect(mitParameter('https://a.de/p?x=1#teil', 'tt', 'a b')).toBe('https://a.de/p?x=1&tt=a%20b#teil');
});

test('vorschauParameter: Werte auch hinter #', () => {
  expect(vorschauParameter('https://tagassistant.google.com/#/?id=GTM-ABC&gtm_auth=xyz&gtm_preview=env-5'))
    .toEqual({ id: 'GTM-ABC', auth: 'xyz', env: 'env-5' });
  expect(vorschauParameter(undefined)).toBeUndefined();
  expect(() => vorschauParameter('https://tagassistant.google.com/#/?id=GTM-ABC')).toThrow(/gtm_auth/);
});

test.describe('Baseline-Vergleich', () => {
  const basis = (): Baseline => ({
    version: 1, journey: 'kauf', erstellt: '', modus: 'durchlassen', tempo: 'schnell',
    events: [{ name: 'purchase', quelle: 'push', daten: { ecommerce: { value: 10, transaction_id: 'T-1' } } }],
    consent: [],
    anfragen: [{
      schluessel: 'GA4 · purchase · /g/collect · G-1', dienst: 'GA4', methode: 'POST', host: 'region1.google-analytics.com',
      pfad: '/g/collect', parameter: { en: 'purchase', tid: 'G-1', gcs: 'G111', cid: '1.1', 'epn.value': '10' }, status: 204, umleitung: false,
    }],
    hosts: ['region1.google-analytics.com'], cspVerstoesse: [],
  });
  const rot = (b: Baseline, l: Baseline) => vergleiche(b, l).filter((x) => x.stufe === 'rot').map((x) => x.text);

  test('gleicher Lauf, nur flüchtige Werte anders: kein Rot', () => {
    const lauf = basis();
    lauf.anfragen[0].parameter.cid = '2.2';
    (lauf.events[0].daten.ecommerce as any).transaction_id = 'T-2';
    expect(rot(basis(), lauf)).toEqual([]);
  });

  test('Gebündelte JSON-Events (OpenAI): je Event verglichen, andere Bündelung ist keine Abweichung', () => {
    const req = (ec: string, typen: string[]) => ({
      nr: 0, zeit: 0, dienst: 'OpenAI Ads', modus: 'durchlassen', methode: 'POST', url: '', host: 'bzr.openai.com',
      pfad: '/v1/sdk/events', parameter: { pid: 'P1', ec }, body: JSON.stringify({ events: typen.map((type) => ({ type, id: 'x' })) }),
    } as any);
    const mit = (anfragen: ReturnType<typeof anfragenAus>): Baseline => ({ ...basis(), anfragen });
    const b = mit(anfragenAus([req('3', ['openai::sdk_init', 'oai::diagnostic', 'page_viewed']), req('2', ['oai::diagnostic', 'items_added'])]));
    const l = mit(anfragenAus([req('3', ['openai::sdk_init', 'oai::diagnostic', 'page_viewed']), req('1', ['oai::diagnostic']), req('1', ['oai::diagnostic']), req('1', ['items_added'])]));
    expect(rot(b, l)).toEqual([]);
    expect(rot(b, mit(anfragenAus([req('2', ['openai::sdk_init', 'page_viewed'])])))).toEqual(['Request fehlt: OpenAI Ads · items_added · /v1/sdk/events · P1']);
  });

  test('Abfragen an Erweiterungen (Extension-IDs) in älteren Baselines: kein Befund', () => {
    const b = basis();
    b.hosts = [...b.hosts, 'abcdefghijklmnopabcdefghijklmnop'];
    b.weitere = ['GET abcdefghijklmnopabcdefghijklmnop/icon-16.png', 'POST api.example.com/x'];
    const l = basis();
    l.weitere = ['POST api.example.com/x'];
    expect(vergleiche(b, l).filter((x) => /abcdefgh/.test(x.text))).toEqual([]);
  });

  test('Microsoft UET: Ereignis aus ea/evt im Schlüssel, Consent-Pings schwanken nur als Hinweis', () => {
    const uet = (pfad: string, p: Record<string, string>) => ({
      schluessel: '', dienst: 'Microsoft Ads', methode: 'GET', host: 'bat.bing.com', pfad, umleitung: false, parameter: { ti: '1', ...p } as Record<string, string>,
    });
    const ping = uet('/actionp/0', { evt: 'consent', asc: 'G' });
    const b = { ...basis(), anfragen: [uet('/action/0', { evt: 'pageLoad' }), uet('/action/0', { evt: 'custom', ea: 'add_to_cart' }), ping, ping] };
    const l = { ...basis(), anfragen: [uet('/action/0', { evt: 'pageLoad' }), uet('/action/0', { evt: 'custom', ea: 'add_to_cart' }), ping, ping, ping, ping, ping] };
    expect(rot(b, l)).toEqual([]);
    const ohneAtc = { ...l, anfragen: l.anfragen.filter((a) => a.parameter.ea !== 'add_to_cart') };
    expect(rot(b, ohneAtc)).toEqual(['Request fehlt: Microsoft Ads · add_to_cart · /action/0 · 1']);
  });

  test('Consent-Parameter geändert: rot', () => {
    const lauf = basis();
    lauf.anfragen[0].parameter.gcs = 'G100';
    expect(rot(basis(), lauf)).toHaveLength(1);
  });

  test('Wert im ecommerce-Objekt geändert: rot', () => {
    const lauf = basis();
    (lauf.events[0].daten.ecommerce as any).value = 12;
    expect(rot(basis(), lauf)[0]).toContain('ecommerce.value');
  });

  test('CSP-Verstoß wie in der Baseline: Hinweis, neuer Verstoß: rot', () => {
    const b = basis();
    b.cspVerstoesse = ['style-src-attr: inline'];
    const lauf = basis();
    lauf.cspVerstoesse = ['style-src-attr: inline'];
    expect(rot(b, lauf)).toEqual([]);
    lauf.cspVerstoesse.push('script-src: https://neu.de/x.js');
    expect(rot(b, lauf)).toEqual(['CSP-Verstoß: script-src: https://neu.de/x.js']);
  });

  test('Testwerte der Landung mit anderer Zeit: kein Hinweis', () => {
    const b = basis();
    b.anfragen[0].parameter.dl = 'https://a.de/?gclid=TEST-sib-gclid-1794312089881';
    const lauf = basis();
    lauf.anfragen[0].parameter.dl = 'https://a.de/?gclid=TEST-sib-gclid-1794312118381';
    expect(vergleiche(b, lauf)).toEqual([]);
  });

  test('optionales Event fehlt oder ändert sich: nur Hinweis, andere Events bleiben rot', () => {
    const b = basis();
    b.events.push({ name: 'bot_pruefung', quelle: 'push', daten: { pruefung: 'x', ecommerce: { x: 1 } } });
    const ohne = basis();
    expect(rot(b, ohne)).toEqual(['Event fehlt: bot_pruefung']);
    const befunde = vergleiche(b, ohne, { optionaleEvents: ['bot_pruefung'] });
    expect(befunde.filter((x) => x.stufe === 'rot')).toEqual([]);
    expect(befunde.map((x) => x.text)).toContain('Event fehlt: bot_pruefung (optional)');
    const anders = basis();
    anders.events.push({ name: 'bot_pruefung', quelle: 'push', daten: { ecommerce: { x: 2 } } });
    expect(vergleiche(b, anders, { optionaleEvents: ['bot_pruefung'] }).filter((x) => x.stufe === 'rot')).toEqual([]);
    const ohneKauf = basis();
    ohneKauf.events = [];
    expect(vergleiche(basis(), ohneKauf, { optionaleEvents: ['bot_pruefung'] }).filter((x) => x.stufe === 'rot').map((x) => x.text))
      .toContain('Event fehlt: purchase');
  });

  test('Request fehlt: rot', () => {
    const lauf = basis();
    lauf.anfragen = [];
    expect(rot(basis(), lauf).length).toBeGreaterThan(0);
  });
});

test('bekannteTreffer: als abgebrochen gemeldete, aber durchgelassene Requests zählen, abgefangene nicht', () => {
  const url = 'https://region1.google-analytics.com/g/collect?en=page_view';
  const treffer = [
    { url, quelle: 'browser', modus: 'durchlassen', fehler: 'net::ERR_ABORTED' },
    { url, quelle: 'browser', modus: 'durchlassen' },
    { url, quelle: 'browser', modus: 'abfangen', fehler: 'net::ERR_FAILED' },
    { url, quelle: 'browser', modus: 'durchlassen', fehler: 'net::ERR_CONNECTION_REFUSED' },
    { url, quelle: 'netlog', modus: 'durchlassen' },
    { url: 'https://andere.de/', quelle: 'browser', modus: 'durchlassen' },
  ];
  expect(bekannteTreffer(treffer, url)).toEqual([treffer[0], treffer[1], treffer[4]]);
});

test('trefferTeile: Floodlight-Parameter mit ";" im Pfad werden zerlegt', () => {
  const regel = STANDARD_DIENSTE.find((r) => r.name === 'Floodlight')!;
  const url = 'https://ad.doubleclick.net/activity;src=1234567;type=typ001;cat=kat0;ord=123;gcldc=TEST-1;~oref=https%3A%2F%2Fx.ch%2Fa%3Fb%3D1?';
  expect(trefferTeile(url, regel)).toEqual({
    host: 'ad.doubleclick.net', pfad: '/activity',
    parameter: { src: '1234567', type: 'typ001', cat: 'kat0', ord: '123', gcldc: 'TEST-1', '~oref': 'https://x.ch/a?b=1' },
  });
  const ccm = 'https://www.google.com/ccm/collect?tid=DC-1&en=page_view';
  expect(trefferTeile(ccm, regel)).toEqual(trefferTeile(ccm));
});
