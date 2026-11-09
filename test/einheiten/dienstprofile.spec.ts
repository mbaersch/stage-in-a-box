/** Felder aus Requests lesen und Dienstprofile zusammenführen (lib/dienstprofile.ts). */
import { test, expect } from '../../lib/playwright';
import { DIENST_PROFILE, feldWert, felder, profileZusammenfuehren } from '../../lib/dienstprofile';

test.describe('felder', () => {
  test('URL-Parameter ohne Body', () => {
    expect(felder({ en: 'purchase' })).toEqual({ en: 'purchase' });
  });

  test('Formular-Body ergänzt die URL-Parameter', () => {
    expect(felder({ v: '2' }, 'en=purchase&epn.value=19.9')).toEqual({ v: '2', en: 'purchase', 'epn.value': '19.9' });
  });

  test('JSON-Body wird flach gemacht, Arrays mit Index', () => {
    const f = felder({}, JSON.stringify({ properties: { value: 5, contents: [{ content_id: 'A' }, { content_id: 'B' }] } }));
    expect(f['properties.value']).toBe('5');
    expect(f['properties.contents.1.content_id']).toBe('B');
  });

  test('multipart/form-data', () => {
    const body = [
      '------grenze', 'Content-Disposition: form-data; name="ev"', '', 'Purchase',
      '------grenze', 'Content-Disposition: form-data; name="cd[value]"', '', '42.5',
      '------grenze--',
    ].join('\r\n');
    const f = felder({}, body);
    expect(f.ev).toBe('Purchase');
    expect(f['cd[value]']).toBe('42.5');
  });

  test('Parameter mit JSON-Objekt werden zusätzlich flach gemacht', () => {
    const f = felder({ ed: JSON.stringify({ event_id: 'E-1', value: 5 }), tid: '1' });
    expect(f['ed.event_id']).toBe('E-1');
    expect(f.ed).toContain('event_id');
    expect(f.tid).toBe('1');
  });

  test('Text ohne Struktur bleibt außen vor', () => {
    expect(felder({ a: '1' }, 'nur text')).toEqual({ a: '1' });
  });
});

test('feldWert nimmt den ersten belegten Namen', () => {
  expect(feldWert({ 'ep.value': '', 'epn.value': '7' }, ['ep.value', 'epn.value'])).toBe('7');
  expect(feldWert({ a: '1' }, 'b')).toBeUndefined();
  expect(feldWert({ a: '1' })).toBeUndefined();
});

test.describe('profileZusammenfuehren', () => {
  const ads = (profile: ReturnType<typeof profileZusammenfuehren>) => profile.find((p) => p.name === 'Google Ads')!;

  test('ohne eigene Profile: die zentralen', () => {
    expect(profileZusammenfuehren().map((p) => p.name)).toEqual(DIENST_PROFILE.map((p) => p.name));
  });

  test('Klick-ID je Identifier: neuer Identifier ergänzt, bestehende bleiben', () => {
    const p = ads(profileZusammenfuehren([{ name: 'Google Ads', klickId: { neu_id: { speicher: ['_neu'] } } }]));
    expect(Object.keys(p.klickId!)).toEqual(['gclid', 'gbraid', 'wbraid', 'neu_id']);
  });

  test('Klick-ID: Felder überschreiben, Listen ersetzen', () => {
    const p = ads(profileZusammenfuehren([{ name: 'Google Ads', klickId: { gclid: { request: [] } } }]));
    expect(p.klickId!.gclid).toEqual({ speicher: ['_gcl_aw'], request: [] });
  });

  test('Conversion je Feld', () => {
    const p = ads(profileZusammenfuehren([{ name: 'Google Ads', conversion: { value: 'value_netto' } }]));
    expect(p.conversion!.value).toBe('value_netto');
    expect(p.conversion!.transaction_id).toBe('oid');
  });

  test('zentrale Profile bleiben unverändert', () => {
    profileZusammenfuehren([{ name: 'Google Ads', klickId: { gclid: { request: [] } }, conversion: { value: 'x' } }]);
    expect(DIENST_PROFILE.find((p) => p.name === 'Google Ads')!.klickId!.gclid.request).toEqual(['gclaw']);
    expect(DIENST_PROFILE.find((p) => p.name === 'Google Ads')!.conversion!.value).toBe('value');
  });

  test('unbekannter Dienst kommt dazu', () => {
    expect(profileZusammenfuehren([{ name: 'Eigener Dienst' }]).some((p) => p.name === 'Eigener Dienst')).toBe(true);
  });
});
