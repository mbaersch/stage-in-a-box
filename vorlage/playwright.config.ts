import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import { SLOW_MO, tempoAusUmgebung } from './lib/tempo';
import { netlogArgumente } from './lib/netlog';
import { proxyArgumente } from './lib/proxy';

// Liest BASE_URL, TRACKING_MODUS, Testdaten usw. aus .env, falls vorhanden.
if (fs.existsSync('.env')) {
  process.loadEnvFile();
  // Leere Einträge ("TEMPO=") gelten als nicht gesetzt, damit Vorgaben und "?? test.skip(…)" greifen
  for (const [name, wert] of Object.entries(process.env)) if (wert === '') delete process.env[name];
  // Häufiger Fehler: Wert eingetragen, aber "#" davor stehen gelassen. Nur Namen ausgeben, nie Werte.
  const auskommentiert = [...fs.readFileSync('.env', 'utf8').matchAll(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=\s*\S/gm)]
    .map((m) => m[1]).filter((name) => process.env[name] === undefined);
  if (auskommentiert.length && !process.env.STAGE_ENV_GEWARNT) {
    process.env.STAGE_ENV_GEWARNT = '1';
    console.warn(`Achtung: In .env sind Variablen mit Wert auskommentiert und damit nicht gesetzt: ${auskommentiert.join(', ')}`);
  }
}

// Ohne BASE_URL laufen die Tests gegen die mitgelieferte Demo-Seite.
const DEMO_PORT = 4173;
const nutztDemo = !process.env.BASE_URL;

export default defineConfig({
  testDir: './tests',
  // Großzügig, weil Tempo "langsam" bzw. "aufzeichnung" echte Wartezeiten enthält
  timeout: 5 * 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${DEMO_PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    // Service Worker würden Requests am Routing vorbei senden.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // TEMPO verlangsamt jede Aktion etwas (siehe lib/tempo.ts)
    // NetLog erfasst Requests beim Verlassen einer Seite, die Playwright nicht sieht (lib/netlog.ts);
    // proxyArgumente lässt den Browser den Zertifikaten des optionalen Proxys vertrauen (lib/proxy.ts)
    launchOptions: { slowMo: SLOW_MO[tempoAusUmgebung()], args: [...netlogArgumente(), ...proxyArgumente()] },
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: nutztDemo
    ? { command: `node demo/server.mjs ${DEMO_PORT}`, port: DEMO_PORT, reuseExistingServer: true }
    : undefined,
});
