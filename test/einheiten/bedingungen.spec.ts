/** Landung, UTM-Prüfung und Browser-Kennung (lib/bedingungen.ts). */
import { test, expect } from '../../lib/playwright';
import { hatClientHints, landungsParameter, passendeClientHints, userAgentAus, utmBefunde, USER_AGENTS } from '../../lib/bedingungen';

test('landungsParameter: Testwerte für Klick-IDs, utm_-Präfix ergänzt', () => {
  expect(landungsParameter({ klickIds: ['gclid'], utm: { source: 'google', utm_medium: 'cpc' }, parameter: { x: '1' } }, 42)).toEqual({
    gclid: 'TEST-sib-gclid-42', utm_source: 'google', utm_medium: 'cpc', x: '1',
  });
});

test.describe('utmBefunde', () => {
  const werte = { utm_source: 'newsletter', utm_medium: 'email' };
  const t = (nr: number, zeit: number, url: string, dienst = 'GA4') => ({
    nr, zeit, dienst, url, pfad: '/g/collect', parameter: { en: nr === 0 ? 'page_view' : 'scroll' },
  });
  const dl = (query: string) => `https://region1.google-analytics.com/g/collect?dl=${encodeURIComponent(`https://shop.de/${query}`)}`;

  test('erster Request trägt alle Paare', () => {
    const [b] = utmBefunde(werte, [t(0, 10, dl('?utm_source=newsletter&utm_medium=email'))], 0, 'shop.de');
    expect(b.fehlend).toEqual([]);
  });

  test('fehlende Paare im ersten Request, später vorhanden', () => {
    const [b] = utmBefunde(werte, [t(0, 10, dl('')), t(1, 20, dl('?utm_source=newsletter&utm_medium=email'))], 0, 'shop.de');
    expect(b.fehlend).toEqual(['utm_source=newsletter', 'utm_medium=email']);
    expect(b.spaeterEnthalten).toEqual([1]);
  });

  test('Requests ohne Seitenbezug zählen nicht als erster', () => {
    const ohneSeite = t(0, 5, 'https://stats.g.doubleclick.net/g/collect?v=2');
    const [b] = utmBefunde(werte, [ohneSeite, t(1, 10, dl('?utm_source=newsletter&utm_medium=email'))], 0, 'shop.de');
    expect(b.ersterRequest.nr).toBe(1);
    expect(b.fehlend).toEqual([]);
  });

  test('Requests vor der Landung zählen nicht', () => {
    expect(utmBefunde(werte, [t(0, 5, dl(''))], 10, 'shop.de')).toEqual([]);
  });
});

test.describe('Browser-Kennung', () => {
  test('Kurznamen und eigene Strings', () => {
    expect(userAgentAus('firefox')).toBe(USER_AGENTS.firefox);
    expect(userAgentAus('Eigener/1.0')).toBe('Eigener/1.0');
  });

  test('Client Hints nur für Chromium-Kennungen', () => {
    expect(hatClientHints(USER_AGENTS['safari-ios'])).toBe(false);
    expect(hatClientHints('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe(true);
  });

  test('passende Client Hints: Marken wie Chrome, Plattform aus dem String', () => {
    const h = passendeClientHints('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Mobile Safari/537.36');
    expect(h.platform).toBe('Android');
    expect(h.mobile).toBe(true);
    expect(h.model).toBe('Pixel 8');
    expect(h.brands.map((b) => b.brand)).toContain('Google Chrome');
    expect(h.brands.find((b) => b.brand === 'Google Chrome')!.version).toBe('141');
    expect(h.fullVersion).toBe('141.0.7390.54');
  });
});
