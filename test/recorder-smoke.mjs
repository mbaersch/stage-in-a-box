/**
 * Smoke-Test für den Recorder: bindet beide Build-Varianten in eine lokale Testseite ein,
 * spielt eine typische Journey durch und prüft die aufgezeichneten dataLayer-Messages.
 * Aufruf: sh build.sh && npm run test:recorder
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const lies = (datei) => fs.readFileSync(new URL(datei, import.meta.url), 'utf8');
const PAGE = lies('./page.html');
const STANDALONE = lies('../dist/recorder.js');
const GTM_TAG = lies('../dist/gtm-recorder-tag.html');
// Simuliert GTM: entfernt die <script>-Wrapper.
const GTM_SCRIPT = GTM_TAG.replaceAll('<script>', '').replaceAll('</script>', '\n');

async function journey(page) {
  await page.click('[data-testid="nav-products"]');
  await page.click('text=In den Warenkorb');
  await page.click('[aria-label="Menü öffnen"]');
  await page.click('[data-testid="accept-all"]');
  await page.click('#spa');
  await page.fill('#email', 'Max.Mustermann@example.de');
  await page.fill('input[name="phone"]', '+49 170 1234567');
  await page.fill('input[name="pw"]', 'geheim');
  await page.fill('input[name="cc"]', '4111111111111111');
  await page.selectOption('select[name="shipping"]', 'exp');
  await page.check('#nl');
  await page.press('#email', 'Enter');
}

async function aufgezeichnet(page) {
  const raw = await page.evaluate(() => window.dataLayer || []);
  return { entries: raw.filter((m) => '__rec' in m).map((m) => m.__rec), raw };
}

/** Ruft die URLs nacheinander im selben Tab auf; mit spielen=true läuft auf der ersten Seite die Journey. */
async function lauf(initScript, urls, spielen = false) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('http://test.local/**', (r) => r.fulfill({ body: PAGE, contentType: 'text/html' }));
    await page.addInitScript(initScript);
    const seiten = [];
    for (const [i, url] of urls.entries()) {
      await page.goto(url);
      if (spielen && i === 0) await journey(page);
      seiten.push(await aufgezeichnet(page));
    }
    return seiten;
  } finally {
    await browser.close();
  }
}

const fehler = [];
const pruefe = (bedingung, text) => { if (!bedingung) fehler.push(text); };
const feld = (entries, pred) => entries.find((e) => e.type === 'change' && pred(e.element))?.field;

// 0) GTM ersetzt {{…}} überall, auch in Kommentaren
pruefe(!/\{\{[^}]*\}\}/.test(GTM_TAG), 'keine GTM-Variablen im Tag');

// 1) Eigenständige Variante, maskiert
const [{ entries, raw }] = await lauf(STANDALONE, ['http://test.local/start'], true);
const types = entries.map((e) => e.type);
pruefe(types[0] === 'init', 'erster Eintrag ist init');
pruefe(types.includes('route'), 'pushState-Route-Change erfasst');
pruefe(types.includes('submit'), 'Submit erfasst');
pruefe(types.includes('key'), 'Enter erfasst');
pruefe(entries.every((e, i) => e.seq === i + 1), 'seq lückenlos');

const clicks = entries.filter((e) => e.type === 'click');
const cart = clicks.find((c) => c.element.name === 'In den Warenkorb');
pruefe(cart?.element.tag === 'button', 'Klick auf <span> wird zum <button> aufgelöst');
pruefe(cart?.element.selectors.some((s) => s.kind === 'idGenerated'), 'generierte ID markiert');
pruefe(cart?.element.roleNameUnique === true, 'Rolle + Name „In den Warenkorb“ eindeutig');
const produkte = clicks.find((c) => c.element.name === 'Produkte');
pruefe(produkte?.element.roleNameUnique === false, 'Rolle + Name „Produkte“ mehrdeutig (auch in „Alle Produkte“)');
const shadow = clicks.find((c) => c.element.name === 'Alle akzeptieren');
pruefe(shadow?.element.shadowHosts?.length, 'Shadow-DOM-Host erfasst');
pruefe(shadow?.element.selectors[0].unique, 'Test-Attribut im Shadow Root eindeutig');

const email = feld(entries, (el) => el.autocomplete === 'email');
pruefe(email?.value === 'Xxx.Xxxxxxxxxx@xxxxxxx.xx', `maskierte E-Mail behält Format: ${email?.value}`);
pruefe(feld(entries, (el) => el.type === 'password')?.value === '[redacted]', 'Passwort immer unkenntlich');
pruefe(feld(entries, (el) => el.autocomplete === 'cc-number')?.value === '[redacted]', 'Kartennummer immer unkenntlich');
pruefe(feld(entries, (el) => el.tag === 'select')?.selected[0].value === 'exp', 'Select-Wert im Klartext');
const phone = entries.find((e) => e.type === 'change' && e.element.type === 'tel');
pruefe(phone?.element.name === 'Telefon', 'umschließendes Label als Accessible Name');

pruefe(raw.every((m) => !('event' in m)), 'Recorder-Messages ohne event-Key');
pruefe(raw.every((m) => m._clear === true), 'Recorder-Messages mit _clear');

// 2) GTM-Variante, per Parameter im Modus full aktiviert
const [{ entries: voll }] = await lauf(GTM_SCRIPT, ['http://test.local/start?x=1&sib_rec=full'], true);
pruefe(feld(voll, (el) => el.autocomplete === 'email')?.value === 'Max.Mustermann@example.de', 'Modus full erfasst Klartext');
pruefe(feld(voll, (el) => el.type === 'password')?.value === '[redacted]', 'Passwort auch im Modus full unkenntlich');

// 3) GTM-Variante ohne Parameter -> keine Aufzeichnung
const [{ entries: aus }] = await lauf(GTM_SCRIPT, ['http://test.local/start'], true);
pruefe(aus.length === 0, 'ohne Parameter keine Aufzeichnung');

// 4) Aktivierung gilt über Seitenwechsel im Tab, bis ?sib_rec=aus
const seiten = (await lauf(GTM_SCRIPT, [
  'http://test.local/start?sib_rec',
  'http://test.local/seite2',
  'http://test.local/seite3?sib_rec=aus',
  'http://test.local/seite4',
])).map((s) => s.entries);
pruefe(seiten[0][0]?.type === 'init', '?sib_rec ohne Wert aktiviert');
pruefe(seiten[0][0]?.valueMode === 'masked', 'ohne Wert gilt die Vorgabe masked');
pruefe(seiten[1][0]?.type === 'init', 'Folgeseite ohne Parameter zeichnet weiter auf');
pruefe(seiten[2].length === 0 && seiten[3].length === 0, '?sib_rec=aus beendet die Aufzeichnung');

console.log(`${entries.length} Einträge aufgezeichnet, Typen: ${[...new Set(types)].sort().join(', ')}`);
if (fehler.length) {
  console.log(`FEHLGESCHLAGEN:\n- ${fehler.join('\n- ')}`);
  process.exit(1);
}
console.log('alle Prüfungen bestanden');
