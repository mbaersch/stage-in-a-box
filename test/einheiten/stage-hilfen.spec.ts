/** Kleine Helfer der Stage und Baseline-Vergleich (lib/stage.ts, lib/baseline.ts). */
import { test, expect } from '../../lib/playwright';
import { mitParameter, vorschauParameter } from '../../lib/stage';
import { vergleiche, type Baseline } from '../../lib/baseline';

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

  test('Request fehlt: rot', () => {
    const lauf = basis();
    lauf.anfragen = [];
    expect(rot(basis(), lauf).length).toBeGreaterThan(0);
  });
});
