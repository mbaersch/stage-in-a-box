/** Filter-Engine mit eigenen Regeln, Listenformate und Ersatzdateien (lib/adblocker.ts, lib/adblocker-ersatz.ts). Ohne Netz. */
import { test, expect } from '../../lib/playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adblockerLaden, alsFilter, standAusKopf } from '../../lib/adblocker';
import { ersatzFuer, ersatzName } from '../../lib/adblocker-ersatz';

const SEITE = 'https://www.shop.de/kasse';

test.describe('Engine mit eigenen Regeln', () => {
  test('Pfadregel greift auch auf der eigenen Domain, Ausnahme hebt sie auf', async () => {
    const b = await adblockerLaden({ regeln: ['/g/collect?', '@@||www.shop.de/g/collect?erlaubt'] });
    expect(b.pruefe('https://www.shop.de/g/collect?v=2', 'ping', SEITE)?.filter).toBe('/g/collect?');
    expect(b.pruefe('https://www.shop.de/g/collect?erlaubt=1', 'ping', SEITE)).toBeUndefined();
    expect(b.pruefe('https://www.shop.de/warenkorb', 'xhr', SEITE)).toBeUndefined();
  });

  test('$third-party unterscheidet nach der Seite', async () => {
    const b = await adblockerLaden({ regeln: ['||tracker.example^$third-party'] });
    expect(b.pruefe('https://tracker.example/p', 'image', SEITE)).toBeDefined();
    expect(b.pruefe('https://tracker.example/p', 'image', 'https://tracker.example/')).toBeUndefined();
  });

  test('Typen: Regel nur für Skripte greift nicht bei Bildern', async () => {
    const b = await adblockerLaden({ regeln: ['||cdn.example/a.js$script'] });
    expect(b.pruefe('https://cdn.example/a.js', 'script', SEITE)).toBeDefined();
    expect(b.pruefe('https://cdn.example/a.js', 'image', SEITE)).toBeUndefined();
  });

  test('hosts-Datei als eigene Liste, Herkunft der Regel', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-liste-'));
    const datei = path.join(ordner, 'hosts.txt');
    fs.writeFileSync(datei, '# Last updated: heute\n0.0.0.0 ads.example\n127.0.0.1 localhost\n');
    const b = await adblockerLaden({ listen: [datei] });
    const r = b.pruefe('https://ads.example/x', 'script', SEITE);
    expect(r).toEqual({ filter: '||ads.example^', liste: 'hosts.txt' });
    expect(b.listen[0].stand).toBe('heute');
  });

  test('redirect-Regel liefert Ersatz', async () => {
    const b = await adblockerLaden({ regeln: ['||googletagmanager.com/gtm.js$script,redirect=googletagmanager_gtm.js:5'] });
    const r = b.pruefe('https://www.googletagmanager.com/gtm.js?id=GTM-X', 'script', SEITE);
    expect(r?.ersatz?.name).toBe('google-analytics_analytics.js');
    expect(r?.ersatz?.nachgebildet).toBe(true);
  });

  test('ohne Profil, Listen und Regeln: Fehler', async () => {
    await expect(adblockerLaden({})).rejects.toThrow(/weder Profil/);
  });
});

test('alsFilter: hosts-Zeilen werden Netzwerkregeln, localhost nicht', () => {
  expect(alsFilter('0.0.0.0 a.example\n127.0.0.1 b.example # Kommentar\n127.0.0.1 localhost\n||c.example^')).toBe(
    '||a.example^\n||b.example^\n\n||c.example^',
  );
});

test('standAusKopf', () => {
  expect(standAusKopf('[Adblock Plus]\n! Last modified: Sun, 08 Nov 2026 13:52:37 +0000\n')).toBe('Sun, 08 Nov 2026 13:52:37 +0000');
  expect(standAusKopf('! TimeUpdated: 2026-11-08T16:07:30+00:00')).toBe('2026-11-08T16:07:30+00:00');
  expect(standAusKopf('! Last modified: %timestamp%')).toBeUndefined();
});

test.describe('Ersatzdateien', () => {
  test('Name aus der Regel, Priorität abgeschnitten', () => {
    expect(ersatzName('||x.com/a.js$script,redirect=noopjs:5')).toBe('noopjs');
    expect(ersatzName('||x.com/a.js$redirect-rule=1x1.gif,image')).toBe('1x1.gif');
    expect(ersatzName('||x.com/a.js$script')).toBeUndefined();
  });

  test('Aliasnamen und Typen', () => {
    expect(ersatzFuer('||x$redirect=noopjs')).toMatchObject({ name: 'noop.js', contentType: 'application/javascript', nachgebildet: true });
    expect(ersatzFuer('||x$redirect=noopjson').body.toString()).toBe('{}');
    const gif = ersatzFuer('||x$redirect=1x1-transparent.gif');
    expect(gif.contentType).toBe('image/gif');
    expect(gif.body.subarray(0, 6).toString()).toBe('GIF89a');
  });

  test('PNG in der richtigen Größe', () => {
    const png = ersatzFuer('||x$redirect=32x32.png').body;
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([32, 32]);
  });

  test('unbekannte Ersatzdatei: leer, nicht nachgebildet, Typ nach Endung', () => {
    expect(ersatzFuer('||x$redirect=fingerprint2.js')).toMatchObject({ name: 'fingerprint2.js', nachgebildet: false, contentType: 'application/javascript' });
    expect(ersatzFuer('||x$redirect=noopmp3-0.1s').contentType).toBe('audio/mpeg');
  });
});
