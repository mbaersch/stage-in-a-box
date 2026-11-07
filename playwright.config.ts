import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOW_MO, tempoAusUmgebung } from './lib/tempo';
import { netlogArgumente } from './lib/netlog';
import { proxyArgumente } from './lib/proxy';

const WURZEL = path.dirname(fileURLToPath(import.meta.url));
const BEISPIEL = path.join(WURZEL, 'beispiel');

/**
 * Projekt aus dem Pfad im Aufruf (npm test -- projects/<name>) oder aus PROJEKT=<name>;
 * ohne beides das Beispiel. Worker laden die Config ohne diese Argumente neu,
 * deshalb wird das Ergebnis in STAGE_PROJEKT weitergereicht.
 */
function projektVerzeichnis(): string {
  if (process.env.STAGE_PROJEKT) return process.env.STAGE_PROJEKT;
  const gefunden = new Set<string>();
  if (process.env.PROJEKT) gefunden.add(path.join(WURZEL, 'projects', process.env.PROJEKT));
  for (const arg of process.argv.slice(2)) {
    const treffer = arg.replace(/\\/g, '/').match(/(?:^|\/)projects\/([^/]+)/);
    if (treffer) gefunden.add(path.join(WURZEL, 'projects', treffer[1]));
  }
  if (gefunden.size > 1) throw new Error(`Nur ein Projekt pro Lauf: ${[...gefunden].map((p) => path.relative(WURZEL, p)).join(', ')}`);
  const verzeichnis = [...gefunden][0] ?? BEISPIEL;
  if (!fs.existsSync(path.join(verzeichnis, 'tests'))) throw new Error(`Kein Projekt mit Tests in ${path.relative(WURZEL, verzeichnis)}`);
  process.env.STAGE_PROJEKT = verzeichnis;
  return verzeichnis;
}

const PROJEKT = projektVerzeichnis();
const istBeispiel = PROJEKT === BEISPIEL;

function ladeEnv(datei: string) {
  if (!fs.existsSync(datei)) return;
  process.loadEnvFile(datei);
  // Leere Einträge ("TEMPO=") gelten als nicht gesetzt, damit Vorgaben und "?? test.skip(…)" greifen
  for (const [name, wert] of Object.entries(process.env)) if (wert === '') delete process.env[name];
}

// loadEnvFile überschreibt nichts: Werte aus .env gehen den aufgezeichneten Testdaten vor.
const envDatei = path.join(PROJEKT, '.env');
ladeEnv(envDatei);
ladeEnv(path.join(PROJEKT, 'testdaten.aufzeichnung.env'));

// Häufiger Fehler: Wert eingetragen, aber "#" davor stehen gelassen. Nur Namen ausgeben, nie Werte.
if (fs.existsSync(envDatei) && !process.env.STAGE_ENV_GEWARNT) {
  process.env.STAGE_ENV_GEWARNT = '1';
  const inhalt = fs.readFileSync(envDatei, 'utf8');
  const auskommentiert = [...inhalt.matchAll(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=\s*\S/gm)]
    .map((m) => m[1]).filter((name) => process.env[name] === undefined);
  if (auskommentiert.length) {
    console.warn(`Achtung: In .env sind Variablen mit Wert auskommentiert und damit nicht gesetzt: ${auskommentiert.join(', ')}`);
  }
  // loadEnvFile schneidet Werte ohne Anführungszeichen am "#" ab (z. B. Vorschau-Links von GTM).
  const abgeschnitten = [...inhalt.matchAll(/^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^"'`\s][^\r\n]*)\r?$/gm)]
    .filter((m) => m[2].includes('#')).map((m) => m[1]);
  if (abgeschnitten.length) {
    console.warn(`Achtung: In .env enthalten Werte ein "#" ohne Anführungszeichen und werden dort abgeschnitten: ${abgeschnitten.join(', ')}. Wert in "…" setzen.`);
  }
}

if (!istBeispiel && !process.env.BASE_URL) {
  throw new Error(`BASE_URL fehlt in ${path.relative(WURZEL, envDatei)}`);
}

// Das Beispiel läuft gegen die mitgelieferte Demo-Seite.
const DEMO_PORT = 4173;

// Basic Auth (z. B. Staging hinter .htaccess)
const httpCredentials = process.env.BASIC_AUTH_BENUTZER && process.env.BASIC_AUTH_PASSWORT
  ? { username: process.env.BASIC_AUTH_BENUTZER, password: process.env.BASIC_AUTH_PASSWORT }
  : undefined;

export default defineConfig({
  testDir: path.join(PROJEKT, 'tests'),
  outputDir: path.join(PROJEKT, 'test-results'),
  // Großzügig, weil Tempo "langsam" bzw. "aufzeichnung" echte Wartezeiten enthält
  timeout: 5 * 60_000,
  retries: process.env.CI ? 1 : 0,
  // Offene Sitzungen (stage.offenHalten) warten auf den Menschen; nur mit -g @sitzung (npm run sitzung).
  grepInvert: process.argv.some((a) => a.includes('@sitzung')) ? undefined : /@sitzung/,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(PROJEKT, 'playwright-report') }]],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${DEMO_PORT}`,
    httpCredentials,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    // Service Worker würden Requests am Routing vorbei senden.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // TEMPO verlangsamt jede Aktion etwas (siehe lib/tempo.ts)
    // NetLog erfasst Requests beim Verlassen einer Seite, die Playwright nicht sieht (lib/netlog.ts);
    // proxyArgumente lässt den Browser den Zertifikaten des optionalen Proxys vertrauen (lib/proxy.ts)
    // AutomationControlled aus: CMPs sollen den Testbrowser nicht als Bot erkennen (siehe lib/stage.ts)
    launchOptions: {
      slowMo: SLOW_MO[tempoAusUmgebung()],
      args: [...netlogArgumente(), ...proxyArgumente(), '--disable-blink-features=AutomationControlled'],
    },
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: istBeispiel
    ? { command: `node beispiel/demo/server.mjs ${DEMO_PORT}`, cwd: WURZEL, port: DEMO_PORT, reuseExistingServer: true }
    : undefined,
});
