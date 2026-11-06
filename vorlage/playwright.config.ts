import { defineConfig, devices } from '@playwright/test';
import { SLOW_MO, tempoAusUmgebung } from './lib/tempo';
import { netlogArgumente } from './lib/netlog';
import { proxyArgumente } from './lib/proxy';

// Liest BASE_URL, TRACKING_MODUS, Testdaten usw. aus .env, falls vorhanden.
try {
  process.loadEnvFile();
} catch {
  // keine .env – Umgebungsvariablen bzw. Vorgaben gelten
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
