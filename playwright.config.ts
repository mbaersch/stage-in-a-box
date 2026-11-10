import { defineConfig, devices } from './lib/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOW_MO, tempoAusUmgebung } from './lib/tempo';
import { netlogArgumente } from './lib/netlog';
import { proxyArgumente } from './lib/proxy';
import { ladeAuftraege, waehleHauptauftrag, type Auftrag } from './lib/auftrag';

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

// Was vor dem Laden der .env schon gesetzt ist, kam von der Kommandozeile und geht den Einstellungen im Auftrag vor.
const VON_AUSSEN = new Set(Object.keys(process.env));

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

/**
 * Aufträge (auftrag.md, auftrag-<name>.md) mit Startadresse, Vorschau-Link und Schaltern. Tests zu auftrag-<name>.md
 * liegen in tests/<name>/ und bilden ein eigenes Playwright-Projekt; Sitzung, Aufnahme und übrige Tests in tests/
 * nutzen den Hauptauftrag (AUFTRAG=<name>, sonst auftrag.md, sonst den einzigen mit Startadresse).
 */
const AUFTRAEGE = istBeispiel ? [] : ladeAuftraege(PROJEKT);
const TESTS = path.join(PROJEKT, 'tests');
const gewaehlt = process.env.AUFTRAG ?? (() => {
  for (const arg of process.argv.slice(2)) {
    const name = arg.replace(/\\/g, '/').match(/(?:^|\/)tests\/([^/]+)/)?.[1];
    if (name && AUFTRAEGE.some((a) => a.name === name)) return (process.env.AUFTRAG = name);
  }
  return undefined;
})();
// Alte Projekte: BASE_URL und GTM_VORSCHAU_LINK aus .env, wenn der Auftrag keine nennt.
const startadresse = (a?: Auftrag) => a?.einstellungen.startadresse ?? process.env.BASE_URL;
const vorschauLink = (a?: Auftrag) => a?.einstellungen.vorschauLink ?? process.env.GTM_VORSCHAU_LINK;

// Ohne Wahl nur Aufträge mit Startadresse: Eine leere auftrag.md aus der Vorlage soll keinem benannten im Weg stehen.
const kandidaten = gewaehlt !== undefined ? AUFTRAEGE : AUFTRAEGE.filter((a) => startadresse(a));
const HAUPT = AUFTRAEGE.find((a) => a.name === waehleHauptauftrag(kandidaten.map((a) => a.name), gewaehlt));

// Schalter wirken über Umgebungsvariablen und damit für den ganzen Lauf: Bei mehreren Aufträgen müssen sie gleich sein.
const imLauf = gewaehlt !== undefined ? AUFTRAEGE.filter((a) => a.name === gewaehlt) : AUFTRAEGE;
const schalter: Record<string, { wert: string; datei: string }> = {};
for (const a of imLauf) {
  for (const [variable, wert] of Object.entries(a.einstellungen.umgebung)) {
    const bisher = schalter[variable];
    if (bisher && bisher.wert !== wert) {
      throw new Error(`${path.basename(bisher.datei)} und ${path.basename(a.datei)} setzen ${variable} verschieden. `
        + 'Aufträge einzeln laufen lassen: AUFTRAG=<name> vor dem Befehl oder Pfad projects/<projekt>/tests/<name>');
    }
    schalter[variable] = { wert, datei: a.datei };
  }
}
for (const [variable, { wert }] of Object.entries(schalter)) if (!VON_AUSSEN.has(variable)) process.env[variable] = wert;

const benannt = AUFTRAEGE.filter((a) => a.name && fs.existsSync(path.join(TESTS, a.name)));
for (const a of benannt) {
  if (!startadresse(a)) throw new Error(`Startadresse fehlt in ${path.relative(WURZEL, a.datei)} (Abschnitt Einstellungen)`);
}
if (!istBeispiel && !benannt.length && !startadresse(HAUPT)) {
  throw new Error(`Startadresse fehlt: im Auftrag unter Einstellungen eintragen (${path.relative(WURZEL, PROJEKT)}/auftrag-<name>.md)`);
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
  // Offene Sitzungen und Aufnahmen (stage.offenHalten) warten auf den Menschen; nur mit -g @sitzung bzw.
  // -g @aufnahme (npm run sitzung, npm run aufnahme).
  grepInvert: ((offen) => (offen.length ? new RegExp(offen.join('|')) : undefined))(
    ['@sitzung', '@aufnahme'].filter((t) => !process.argv.some((a) => a.includes(t)))),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(PROJEKT, 'playwright-report') }]],
  use: {
    baseURL: istBeispiel ? `http://localhost:${DEMO_PORT}` : startadresse(HAUPT),
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
      args: [...netlogArgumente(), ...proxyArgumente(), '--disable-blink-features=AutomationControlled',
        // Abnahme (npm run abnahme): DevTools offen, die Stage schreibt dataLayer und Requests in die Konsole
        ...(process.env.STAGE_ABNAHME ? ['--auto-open-devtools-for-tabs'] : [])],
    },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: benannt.map((a) => new RegExp(`[\\\\/]tests[\\\\/]${a.name.replace(/[.]/g, '\\.')}[\\\\/]`)),
      metadata: { projektOrdner: PROJEKT, auftrag: HAUPT?.name ?? '', vorschauLink: istBeispiel ? undefined : vorschauLink(HAUPT) },
      use: { ...devices['Desktop Chrome'] },
    },
    ...benannt.map((a) => ({
      name: a.name,
      testDir: path.join(TESTS, a.name),
      metadata: { projektOrdner: PROJEKT, auftrag: a.name, vorschauLink: vorschauLink(a) },
      use: { ...devices['Desktop Chrome'], baseURL: startadresse(a) },
    })),
    // Unit-Tests der reinen Funktionen in lib/ (ohne Browser), nur beim Lauf ohne Projekt
    ...(istBeispiel ? [{ name: 'einheiten', testDir: path.join(WURZEL, 'test', 'einheiten') }] : []),
  ],
  webServer: istBeispiel
    ? { command: `node beispiel/demo/server.mjs ${DEMO_PORT}`, cwd: WURZEL, port: DEMO_PORT, reuseExistingServer: true }
    : undefined,
});
