# Varianten, Bedingungen und Anpassungen

Gilt für Varianten in Tests und für Anpassungen in Sitzungen ([`staging.md`](staging.md)). In Tests nur bauen, was der Auftrag verlangt. Varianten laufen über `test.use` in eigenen `describe`-Blöcken, im Modus `abfangen`; in Sitzungen stehen dieselben Optionen in `sitzung.use(…)`.

## Beispiele

```ts
// Dienst blockiert (Adblocker): Seite und Conversion-Event müssen trotzdem funktionieren
test.use({ stageOptionen: { regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }] } });

// Ladereihenfolge: GTM 3 s verzögern, Script echt laden, nicht als Tracking-Request zählen
test.use({ stageOptionen: { regeln: [
  { name: 'GTM-Script', muster: /googletagmanager\.com\/gtm\.js/, modus: 'durchlassen', verzoegerungMs: 3000, nichtProtokollieren: true },
] } });

// Geplante CSP testen; Verstöße stehen in stage.cspVerstoesse
test.use({ stageOptionen: { csp: "default-src 'self'; script-src 'self' https://www.googletagmanager.com" } });

// Geplante Änderung an der Website vorwegnehmen: neuer Loader im HTML, Bugfix in einem Skript der Seite
test.use({ stageOptionen: { anpassungen: [
  { muster: /^https:\/\/www\.example\.de\/[^.]*$/, anpassen: (html) => html.replace(/<script>[^<]*googletagmanager\.com\/gtm\.js[^<]*<\/script>/, NEUER_LOADER) },
  { muster: /\/consent-bridge\.js/, anpassen: (js) => js.replace(FEHLERHAFTE_ZEILE, KORRIGIERTE_ZEILE) },
] } });
```

Verzögerungen und CSP-Simulation fangen Requests im Browser ab. Weiterleitungsketten von Beacons können dabei verloren gehen – solche Varianten nicht mit Baseline-Vergleichen kombinieren.

## Optionen im Einzelnen

- **Anpassungen** (HTML, Skripte): Ändert eine Anpassung nichts (Muster passt nicht mehr, z. B. nach einem Update der Website), bekommt der Test die Anmerkung „Achtung“, und die URL steht in `stage.anpassungenOhneWirkung`. Mit Proxy setzt die Stage `ignoreHTTPSErrors`, weil Playwright die Antwort dann über den Proxy holt; Zertifikatsfehler der Website fallen in diesen Tests nicht auf.
- **dataLayer-Pushes ändern** (geplante Änderung an CMP oder Website, z. B. ein neuer Consent-Key): `stageOptionen: { dataLayerAnpassen: (e) => { if (e?.event === 'consent_ready') e.consentInfo.youtube = e.consentInfo.statistics === true; } }`. Greift vor GTM, auch nachdem GTM `push` ersetzt hat; das Protokoll zeigt den geänderten Push. Die Funktion läuft im Browser und darf keine Variablen aus der Testdatei verwenden. Die konkrete Regel gehört in den Projektordner, nicht nach `lib/`.
- **dataLayer vorbelegen** (z. B. andere CMP-Konfiguration simulieren): `page.addInitScript(() => { window.dataLayer = window.dataLayer || []; window.dataLayer.push(…); })` – läuft vor allen Scripts der Seite.
- **CSP-Inventar:** Jeder Test legt `csp-inventar.json` ab: alle Ressourcen nach Direktive, Herkunft und Kontext (Seite, iframe, Service Worker) und einen Vorschlag für die Policy der Seite (`vorschlag`). Grundlage für eine neue CSP: einen vollständigen Lauf mit allen Consent-Zuständen und Zahlarten machen, dann den Vorschlag prüfen und die Policy als Variante `csp` testen. iframes und Service Worker fallen nicht unter die CSP der Seite. Dienstspezifische Fallstricke: [`../wissen/dienste.md`](../wissen/dienste.md).
- **Weitere Dienste:** Endpunkte aus `tracking-vendors.json` im [Tracking Auditor](https://github.com/mbaersch/tracking-auditor) als Regel ergänzen.

## Bedingungen für eine Journey

Bedingungen sind keine eigenen Tests, sondern Zusätze für eine bestehende Journey (z. B. den Testkauf), angekreuzt im Auftrag unter „Bedingungen“. Code: `lib/bedingungen.ts`, Beispiele: `beispiel/tests/bedingungen.spec.ts`.

| Bedingung | Option | Im Test |
|---|---|---|
| Landung über eine Anzeige | `landung: { klickIds: ['gclid', 'fbclid'], utm: { source: 'google', medium: 'cpc' } }` | Statt `page.goto` die Journey mit `await stage.landen(page, '/pfad')` beginnen. Prüfen mit `await stage.erwarteKlickId('gclid', { dienst: 'Google Ads', ab })`; `ab = stage.tracking.treffer.length` vor der Conversion, sonst zählt schon der Request der Landungsseite. |
| Wiederkehrender Besucher | erster Test: `await stage.zustandSpeichern('nach-kauf')`; zweiter: `startZustand: 'nach-kauf'` | Beide in einem `test.describe.serial`. Gespeichert werden Cookies und localStorage (nicht sessionStorage) unter `zustaende/` im Projekt. |
| Zeit vorspulen | `uhr: true` | `await stage.zeitVorstellen('31m')` springt vor und löst fällige Timer aus. |
| Netz und CPU | `netz: 'langsam-3g' \| '3g' \| '4g'`, `cpu: 4` | Drosselt alle Seiten des Tests. |
| Mobilgerät | `geraet: 'iPhone 15'` | Maße, Touch und Kennung aus der Geräteliste von Playwright. |
| Browser-Kennung | `userAgent: 'safari-ios' \| 'safari-mac' \| 'firefox' \| '<eigener String>'` | Geht vor `geraet`. |
| Zurück-Navigation | `bfcache: true` | `const r = await stage.zurueck(page)`; `r.ausBfcache` sagt, ob die Seite aus dem Cache kam. Danach prüfen, ob ein `page_view` kam bzw. kommen sollte. |

- **Klick-IDs** bekommen Testwerte der Form `TEST-sib-<id>-<Zeit>`. `stage.klickIds()` sucht sie in Cookies, localStorage und allen Tracking-Requests; am Testende liegt das Ergebnis als `klick-ids.json` bei. Wo die Dienste sie üblicherweise speichern: [`../wissen/dienste.md`](../wissen/dienste.md).
- **Uhr:** Betrifft die Uhr der Seite (Timer, `Date`). Cookie-Laufzeiten verwaltet der Browser selbst; deren Ablauf lässt sich so nicht testen. Sitzungsende bei GA4 funktioniert, weil es auf Zeitstempeln in Cookie-Werten beruht.
- **Gerät und Kennung:** Die Engine bleibt Chromium. Für Safari und Firefox werden die Client Hints entfernt (Marken leer, `navigator.userAgentData` undefiniert). Der Header `Sec-CH-UA` kommt dann leer statt gar nicht – Skripte, die exakt darauf prüfen, sehen den Unterschied. Mobile Layouts brauchen ein `<meta name="viewport">` der Seite, sonst rendert sie 980 px breit.
- **bfcache:** Startet einen eigenen Browser (vollständiges Chromium statt Headless-Shell), weil Playwright den bfcache sonst abschaltet. Nach `zurueck` nicht auf `load` warten: Aus dem bfcache kommt keiner.

## Consent-Varianten

Über die API der CMP statt über Klicks, damit jede Variante genau einen Zustand herstellt (`lib/cmp.ts`, bisher Usercentrics):

```ts
import { usercentrics } from '../../../lib/cmp';
await usercentrics.nurDienste(page, ['Google Ads']);       // Namen wie in der UC-Konfiguration
await usercentrics.nurKategorien(page, ['functional']);
await usercentrics.widerrufen(page);                        // danach: stage.zustand() für Cookies und Storage
```

- Danach meist neu laden: Viele Setups (Consent-Gates, GTM-Blocker) werten den Consent erst beim nächsten Seitenaufruf aus. Ob es schon auf derselben Seite wirkt, ist selbst ein Befund.
- `usercentrics.dienste(page)` zeigt die Dienstnamen der CMP. Mit den Consent-Keys im Container abgleichen: Ein Tippfehler im Dienstnamen blockiert einen Tag dauerhaft.
- Andere CMP: Funktionen nach demselben Muster in `lib/cmp.ts` ergänzen, sobald sie an einer echten Website erprobt sind. Bis dahin über den Banner klicken oder den Consent-Zustand vorgeben: CMP-Cookie per `page.context().addCookies()` oder localStorage per `page.addInitScript()` setzen. Den Speicherort der CMP vorher per DevTools ermitteln.
- „CMP nicht erreichbar“: die Skripte der CMP per Regel mit `modus: 'blockieren'` sperren.
- Widerruf: Requests nach dem Zeitpunkt des Widerrufs dürfen nicht kommen. `stage.zustand()` vorher und nachher zeigt, ob Cookies und Storage bleiben.

Was über einzelne CMPs bekannt ist: [`../wissen/cmp.md`](../wissen/cmp.md).

## Proxy

Mit `PROXY=ein` (in `.env`) oder `stageOptionen: { proxy: true }` laufen alle Requests des Testbrowsers über einen lokalen Proxy (`lib/proxy.ts`). Der Proxy sieht und steuert alles im Netzwerk:

- Beacons beim Verlassen einer Seite (GA4 `user_engagement`, Microsoft Ads u. a.) werden erfasst, mit Body, und im Modus `abfangen` wirklich abgefangen.
- Service Worker sind erlaubt wie bei echten Besuchern; ihre Requests sind sichtbar.
- Regeln greifen auch für Pfade auf der eigenen Domain (sGTM).

Die Testumgebung ist ohne Proxy einfacher, mit Proxy vollständiger. Was der Auftrag sagt, gilt. Bei Staging-Servern mit ungültigem Zertifikat `stageOptionen: { zertifikatFehlerIgnorieren: true }` setzen.

**Grenze ohne Proxy:** Beacons, die eine Seite beim Verlassen sendet, laufen in Chromium am Routing vorbei und gehen im Modus `abfangen` trotzdem raus. Die Stage erkennt das über das NetLog, markiert sie in `tracking-treffer.json` mit `entwischt: true` und setzt am Test die Anmerkung „Achtung“. Im Bericht erwähnen, wenn das vorkommt, und den Proxy empfehlen.

## Requests ohne Regel

Requests ohne Regel werden nie abgefangen, auch nicht im Modus `abfangen`; ein Tracking-Endpunkt ohne Regel geht also echt raus. `UNBEKANNTE=abfangen` fängt als Sicherheitsnetz alle Fetch-, XHR- und Beacon-Requests an fremde Domains ab (Dienst „Unbekannt“), kann aber Funktionen der Website stören. Hintergrund: [`../wissen/eigene-formate.md`](../wissen/eigene-formate.md).
