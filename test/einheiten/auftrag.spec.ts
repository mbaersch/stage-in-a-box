/** Einstellungen aus Aufträgen (lib/auftrag.ts). */
import { test, expect } from '../../lib/playwright';
import { leseEinstellungen, auftragsName, waehleHauptauftrag } from '../../lib/auftrag';

const vorlage = `# Auftrag

**Status:** Entwurf

## Einstellungen

<!-- Kommentar über mehrere
Zeilen -->

- **Startadresse:** https://www.example.de/shop <!-- Pflicht -->
- **GTM-Vorschau-Link:** "https://tagassistant.google.com/?id=GTM-ABC&gtm_auth=x&gtm_preview=env-3#/"
- **Tempo:** <!-- schnell / mittel -->
- **Proxy:** ja
- **Tracking-Modus:**

## Website

- **Startadresse:** https://falsch.example.de/
`;

test('leseEinstellungen: nur der Abschnitt Einstellungen, Kommentare und leere Werte entfallen', () => {
  expect(leseEinstellungen(vorlage)).toEqual({
    startadresse: 'https://www.example.de/shop',
    vorschauLink: 'https://tagassistant.google.com/?id=GTM-ABC&gtm_auth=x&gtm_preview=env-3#/',
    umgebung: { PROXY: 'ja' },
  });
});

test('leseEinstellungen: Links in Markdown-Schreibweise', () => {
  expect(leseEinstellungen('## Einstellungen\n- **Startadresse:** <https://a.de/>').startadresse).toBe('https://a.de/');
  expect(leseEinstellungen('## Einstellungen\n- **Startadresse:** [Shop](https://a.de/x)').startadresse).toBe('https://a.de/x');
});

test('leseEinstellungen: unbekannte Zeile ist ein Fehler, ohne Abschnitt gibt es nichts', () => {
  expect(() => leseEinstellungen('## Einstellungen\n- **Tempoo:** schnell')).toThrow(/Tempoo/);
  expect(leseEinstellungen('# Auftrag\n- **Startadresse:** https://a.de/')).toEqual({ umgebung: {} });
});

test('auftragsName: auftrag.md ohne Namen, auftrag-<name>.md mit', () => {
  expect(auftragsName('auftrag.md')).toBe('');
  expect(auftragsName('auftrag-b2b.md')).toBe('b2b');
  expect(auftragsName('auftrag-employee-programme.md')).toBe('employee-programme');
  expect(auftragsName('projekt.md')).toBeUndefined();
  expect(auftragsName('auftrag-.md')).toBeUndefined();
});

test('waehleHauptauftrag: gewählt, sonst auftrag.md, sonst der einzige', () => {
  expect(waehleHauptauftrag(['', 'b2b'], 'b2b')).toBe('b2b');
  expect(waehleHauptauftrag(['', 'b2b'])).toBe('');
  expect(waehleHauptauftrag(['b2b'])).toBe('b2b');
  expect(waehleHauptauftrag(['b2b', 'b2c'])).toBeUndefined();
  expect(waehleHauptauftrag([])).toBeUndefined();
  expect(() => waehleHauptauftrag(['b2b'], 'b2c')).toThrow(/b2c/);
});
