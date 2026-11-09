# Varianten, Bedingungen, Prüfungen und Anpassungen

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

Verzögerungen, CSP-Simulation und Adblocker fangen Requests im Browser ab. Weiterleitungsketten von Beacons können dabei verloren gehen – solche Varianten nicht mit Baseline-Vergleichen kombinieren.

## Optionen im Einzelnen

- **Anpassungen** (HTML, Skripte): Ändert eine Anpassung nichts (Muster passt nicht mehr, z. B. nach einem Update der Website), bekommt der Test die Anmerkung „Achtung“, und die URL steht in `stage.anpassungenOhneWirkung`. Mit Proxy setzt die Stage `ignoreHTTPSErrors`, weil Playwright die Antwort dann über den Proxy holt; Zertifikatsfehler der Website fallen in diesen Tests nicht auf.
- **dataLayer-Pushes ändern** (geplante Änderung an CMP oder Website, z. B. ein neuer Consent-Key): `stageOptionen: { dataLayerAnpassen: (e) => { if (e?.event === 'consent_ready') e.consentInfo.youtube = e.consentInfo.statistics === true; } }`. Greift vor GTM, auch nachdem GTM `push` ersetzt hat; das Protokoll zeigt den geänderten Push. Die Funktion läuft im Browser und darf keine Variablen aus der Testdatei verwenden. Die konkrete Regel gehört in den Projektordner, nicht nach `lib/`.
- **dataLayer vorbelegen** (z. B. andere CMP-Konfiguration simulieren): `page.addInitScript(() => { window.dataLayer = window.dataLayer || []; window.dataLayer.push(…); })` – läuft vor allen Scripts der Seite.
- **CSP-Inventar:** Jeder Test legt `csp-inventar.json` ab: alle Ressourcen nach Direktive, Herkunft und Kontext (Seite, iframe, Service Worker) und einen Vorschlag für die Policy der Seite (`vorschlag`). Grundlage für eine neue CSP: einen vollständigen Lauf mit allen Consent-Zuständen und Zahlarten machen, dann den Vorschlag prüfen und die Policy als Variante `csp` testen. iframes und Service Worker fallen nicht unter die CSP der Seite. Dienstspezifische Fallstricke: [`../wissen/dienste.md`](../wissen/dienste.md).
- **Weitere Dienste:** Endpunkte aus `tracking-vendors.json` im [Tracking Auditor](https://github.com/mbaersch/tracking-auditor) als Regel ergänzen.

## Adblocker mit Filterlisten

Statt einzelner Regeln blockiert `adblocker` alles, was ein Blocker mit öffentlichen Filterlisten blockieren würde. Code: `lib/adblocker.ts`, Beispiel: `beispiel/tests/beispiel-demo.spec.ts`.

```ts
test.use({ stageOptionen: { adblocker: 'ublock' } });   // Standardlisten von uBlock Origin
test.use({ stageOptionen: { adblocker: 'streng' } });   // zusätzlich AdGuard Tracking Protection
test.use({ stageOptionen: { adblocker: { profil: 'ublock', listen: ['filter/eigene.txt'], regeln: ['||example.com/pixel^'] } } });
```

Ohne Änderung an den Tests: `ADBLOCKER=ublock npm test -- projects/<name>` (oder in `.env`).

| Profil | Listen | Steht für |
|---|---|---|
| `ublock` | uBlock filters (Ads, Privacy, Unbreak, Quick fixes), EasyList, EasyPrivacy, Peter Lowe | uBlock Origin nach der Installation, ohne die Malware-Listen |
| `streng` | dazu AdGuard Tracking Protection | Nutzer mit schärferem Tracking-Schutz; kennt auch First-Party-Tracker |

- Die Listen werden beim ersten Lauf geladen und einen Tag lang in `listen/` im Hauptordner zwischengespeichert (nicht im Git, fremde Lizenzen). Ist eine Quelle nicht erreichbar, nimmt die Stage einen Spiegel, sonst die alte Kopie mit Anmerkung „Achtung“. Ohne Netz und ohne Kopie bricht der Test mit Meldung ab.
- Ergebnis in `adblocker.json`: Listen mit Stand, jeder blockierte Request mit Regel und Liste, Dienste blockiert bzw. durchgekommen. Der Test bekommt die Anmerkung „Adblocker“ mit der Zusammenfassung; in `tracking-treffer.json` trägt jeder blockierte Treffer die Regel im Feld `adblocker`. Im Test: `stage.adblocker.blockiert`.
- Kombinierbar mit allem außer Baseline-Vergleichen (bricht mit Meldung ab). Im Modus `abfangen` sieht man, was ein Blocker durchließe, ohne dass es gesendet wird.
- Typische Fragen: Kommt die Conversion bei Blocker-Nutzern noch an (sGTM auf eigener Domain, eigener Pfad)? Funktioniert die Seite, wenn GTM oder die CMP blockiert ist? Bleibt der Kauf möglich?
- **Ersatzdateien:** Regeln mit `redirect=…` blockieren nicht, sondern liefern eine Ersatzdatei. Die Stage bildet die Platzhalter nach (leeres Skript, transparentes GIF/PNG, leeres JSON, Text, HTML, CSS) und den Ersatz für Google (`gtm.js`, `gtag/js`, `analytics.js`): Anti-Flicker wird freigegeben, jeder `eventCallback` im dataLayer läuft, `ga()` ruft `hitCallback` auf. Seiten, die vor einer Weiterleitung auf den Callback warten, laufen also weiter wie bei Blocker-Nutzern. Andere Ersatzdateien mit eigener Logik (z. B. für Werbe-Skripte oder einzelne Analyse-Dienste) gibt es nur als leere Antwort; der Test bekommt dann die Anmerkung „Achtung“, `adblocker.json` zeigt sie mit `ersatz.nachgebildet: false`. Code: `lib/adblocker-ersatz.ts`.
- Grenzen: Es wirken nur Netzwerkregeln, keine kosmetischen Regeln und Scriptlets. Die Engine ist die von Ghostery (`@ghostery/adblocker`), kompatibel zu uBlock, aber nicht identisch. Was im Browser fest eingebaut ist (Safari ITP, Firefox-Tracking-Schutz, Brave Shields), bildet das nicht nach.
- Beacons beim Verlassen einer Seite sieht die Route ohne Proxy nicht; die Stage prüft sie nachträglich gegen die Listen (`nachtraeglich` in `adblocker.json`), sie gelten dann als blockiert.

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

- **Klick-IDs** bekommen Testwerte der Form `TEST-sib-<id>-<Zeit>`. `stage.klickIds()` sucht sie in Cookies, localStorage und den Feldern aller Tracking-Requests (ohne Seiten-URL und Referrer, die tragen sie auf der Landungsseite überall) und wertet die Dienstprofile aus: Ist die Ablage aus dem Profil vorhanden bzw. der Klick-ID-Parameter im Request des Dienstes, zählt das auch dann, wenn der Dienst den Wert in eigenem Format speichert. Ergebnis am Testende in `landung.json`. Stand der Profile: [`../wissen/dienste.md`](../wissen/dienste.md).
- **Uhr:** Betrifft die Uhr der Seite (Timer, `Date`). Cookie-Laufzeiten verwaltet der Browser selbst; deren Ablauf lässt sich so nicht testen. Sitzungsende bei GA4 funktioniert, weil es auf Zeitstempeln in Cookie-Werten beruht. Manche Timer der Seite laufen mit installierter Uhr erst beim Vorspulen (z. B. GTM-Scrolltiefe); ihre Events landen dann in der neuen Sitzung. Eine Sitzung muss nicht mit `page_view` beginnen, deshalb `_ss` am ersten Event der neuen `sid` prüfen, nicht am `page_view`.
- **Gerät und Kennung:** Die Engine bleibt Chromium. Die Client Hints (`Sec-CH-UA`, `navigator.userAgentData`) passt die Stage immer an die Kennung an: Bei Chrome-Kennungen stehen dort Marken und Plattform wie bei Google Chrome statt „HeadlessChrome“ (sonst ein Bot-Signal; abschaltbar mit `automationVerbergen: false`). Für Safari und Firefox werden die Client Hints entfernt (Marken leer, `navigator.userAgentData` undefiniert). Der Header `Sec-CH-UA` kommt dann leer statt gar nicht – Skripte, die exakt darauf prüfen, sehen den Unterschied. Mobile Layouts brauchen ein `<meta name="viewport">` der Seite, sonst rendert sie 980 px breit.
- **bfcache:** Startet einen eigenen Browser (vollständiges Chromium statt Headless-Shell), weil Playwright den bfcache sonst abschaltet. Nach `zurueck` nicht auf `load` warten: Aus dem bfcache kommt keiner.

## Prüfungen, die in einer Journey mitlaufen

Ebenfalls keine eigenen Tests: `stageOptionen.pruefungen` schaltet zusätzliche Auswertungen für eine bestehende Journey ein (z. B. den Testkauf), angekreuzt im Auftrag unter „Prüfungen“. Code: `lib/pruefungen.ts`, Beispiele: `beispiel/tests/pruefungen.spec.ts`.

```ts
test.use({ stageOptionen: { pruefungen: {
  durchgaengigkeit: ['purchase'],   // oder true (= purchase), oder { ereignisse, ausnahmen: ['Google Ads:value'] }
  deduplizierung: true,             // oder { serverDienste: ['Eigener sGTM'], ausnahmen: ['Snap'] }
  cookies: true,
  utm: ['GA4'],                     // braucht landung mit utm und stage.landen()
  ga4Grenzen: true,                 // oder '360'
} } });
```

**Durchgängigkeit:** Am Testende wird für jedes genannte Event geprüft, ob Wert, Währung, Transaktions-ID und Artikel-IDs aus dem dataLayer-Push in den Requests nach dem Push ankommen. Wo die Werte stehen, sagen die Dienstprofile (`lib/dienstprofile.ts`, zentral für GA4, Google Ads, Meta, Microsoft Ads).

- Rot (nur Dienste mit Profil): Währung oder Transaktions-ID weichen ab oder fehlen; Wert, außer das Profil sagt `valueNurHinweis` (Google Ads, Meta, Microsoft Ads: dort steht oft gewollt Netto, Marge o. Ä.; Änderungen fängt die Baseline); Artikel-IDs, außer das Profil sagt `itemsNurHinweis` (Werbedienste mit Feed-IDs).
- Hinweis: Dienst mit Profil ohne passenden Request nach dem Push, oder ganz ohne Request nach dem Push (Test endete zu früh, Tag feuert nicht).
- Nachweis: Je Dienst und Event steht in `durchgaengigkeit.json`, welche Felder tatsächlich verglichen wurden („verglichen: value, currency, transaction_id“). So ist sichtbar, was die Prüfung abdeckt; fehlende Felder sind oft eine bewusste Entscheidung im Setup und kein Fehler.
- Conversions ohne Event-Namen im Request (Google Ads) ordnet die Prüfung jedem Push im Zeitfenster zu. Feuern sie auch bei frühen Events (z. B. Conversion-Manager mit `value: 0` bei `add_to_cart`), Google Ads nur beim `purchase` prüfen: `stage.pruefeDurchgaengigkeit('add_to_cart', ['Google Ads:value'])` für die übrigen Events.
- **Artikel über die Journey** (läuft mit, sobald `durchgaengigkeit` an ist; dienst `dataLayer`, ereignis `Journey`): Rot, wenn ein Artikel (gleicher `item_name`) zwischen den Events die ID wechselt. Hinweis, wenn Felder wie `item_category` erst später im Kaufprozess dazukommen – üblich; ändert sich das, meldet es die Baseline (jede Abweichung in `ecommerce` ist dort rot).
- **Dienste ohne Profil für Wert und Transaktions-ID** (z. B. TikTok, Pinterest, eigene sGTM-Formate): Die Prüfung sucht Wert und Transaktions-ID in allen Feldern ihrer Requests, auch in JSON-Bodies, und meldet als Hinweis, wo sie stehen („gefunden in: properties.order_id“) oder dass sie fehlen. Daraus ein Profil fürs Projekt ableiten:

```ts
test.use({ stageOptionen: {
  pruefungen: { durchgaengigkeit: ['purchase'] },
  dienstProfile: [{ name: 'TikTok', conversion: {        // Name wie in der Regel des Dienstes
    ereignis: { parameter: 'event', werte: { purchase: 'CompletePayment' } },
    value: 'properties.value', currency: 'properties.currency', transaction_id: 'properties.order_id',
    items: { parameter: 'properties.contents', format: 'json', schluessel: 'content_id' },
  } }],
} });
```

Felder sind Parameternamen; JSON-Bodies werden flach gemacht (`properties.value`).

**Zusammenführen mit den zentralen Profilen** (gleicher Name): Felder überschreiben, Listen ersetzen, alles andere bleibt. `klickId` wird je Identifier zusammengeführt, `conversion` je Feld. Beispiele:

```ts
dienstProfile: [
  { name: 'Google Ads', klickId: { wbraid: { speicher: ['…'], request: ['…'] } } },  // ergänzt wbraid, gclid und gbraid bleiben
  { name: 'Google Ads', conversion: { value: 'value_netto' } },                     // nur value anders
  { name: 'Meta', klickId: { fbclid: { request: [] } } },                           // Request-Parameter entfernt, Ablage bleibt
]
```

Ein Identifier ohne Angaben (`wbraid: {}`) gehört zum Dienst, Ablage und Parameter sind aber unbekannt; dann zählt nur die Suche nach dem Wert. Bewährt sich ein Profil, als Vorschlag für `lib/dienstprofile.ts` und `docs/wissen/dienste.md` melden – nur mit belegten Fakten.
- Bewusste Unterschiede (z. B. Ads bekommt den Nettowert) als `ausnahmen: ['Google Ads:value']` eintragen und im Bericht begründen.
- Läuft nur, wenn der Test bis zum Ende kommt – mit `CONVERSION=aus` also nicht. Ergebnis in `durchgaengigkeit.json`; `stage.pruefeDurchgaengigkeit(event)` auch für eigene Aufrufe.

**Event-ID zur Deduplizierung:** Schicken Pixel und Conversions API (über den Server-Container) dasselbe Event, zählt der Dienst es nur einmal, wenn beide dieselbe Event-ID tragen. Geprüft wird jeder Request der Dienste mit Profil im ganzen Lauf, nicht nur Conversions: Jede ID, die ein Pixel sendet, muss in irgendeinem Feld eines Requests an den Server-Container stehen, sonst kann der Server sie nicht an die Conversions API geben (rot). Als Server-Container gelten GA4-Requests an eine eigene Domain und Regeln aus `serverDienste`. Requests ohne ID sind ein Hinweis mit Anzahl je Event, denn ohne Conversions API für dieses Event ist das gewollt; ohne Server-Container im Lauf wird nichts geprüft. Ergebnis in `deduplizierung.json`. Felder je Dienst: [`../wissen/dienste.md`](../wissen/dienste.md).

**GA4-Erfassungsgrenzen:** Prüft jedes GA4-Event in den Requests (auch gebündelte) gegen die Grenzen von Google, die GA4 ohne Fehlermeldung durchsetzt. Rot: Eventname über 40 Zeichen, mehr als 25 eigene Parameter (`ep.`/`epn.`; mit `'360'`: 100), Parametername über 40, Name einer User Property über 24 Zeichen, Request über 16 KB (GA4 verwirft dann alle Events darin). Hinweis: Werte über 100 Zeichen, `page_location` über 1.000, `page_title` über 300, `page_referrer` über 420 (360: je 500), Werte von User Properties über 36, Requests ab 80 % der 16 KB. Ergebnis in `ga4-grenzen.json`. Code: `GA4_GRENZEN` in `lib/pruefungen.ts`.

**UTM-Parameter:** UTMs werden nicht gespeichert, sondern aus der URL des ersten Requests gelesen (GA4 über `dl`). Geprüft wird deshalb, ob der erste Request jedes genannten Dienstes nach `stage.landen()` alle UTM-Paare enthält – rot, wenn nicht. Typische Ursachen: Weiterleitung schneidet Parameter ab, SPA räumt die URL per `replaceState` auf, Reload nach der Consent-Entscheidung, `page_view` erst nach Zustimmung auf veränderter URL. Einzeln: `await stage.erwarteUtm({ dienst: 'GA4' })`. Ergebnis für alle Dienste in `landung.json` (dort auch die Klick-IDs). Was eine Website selbst mit UTMs macht (eigene Cookies, Formularfelder fürs CRM), ist Sache des Projekts.

**Cookies:** Protokolliert jedes Setzen (per Skript oder `Set-Cookie`), nie die Werte. `stage.cookies()` bzw. `cookies.json` liefern je Cookie-Muster (`_ga_<ID>` statt Kennung): zuerst gesetzt vor oder nach der Consent-Entscheidung (erster `consent update` im dataLayer), Quelle, Domain, Laufzeit am Ende.

- In der Baseline: ein Cookie, das neu **vor** der Consent-Entscheidung gesetzt wird, ist rot; sonst Hinweis.
- Ohne `consent update` im dataLayer (manche CMPs melden nur über ihre eigene API) steht „ohne Entscheidung“; die Rot-Regel greift dann nicht. Das im Bericht erwähnen.

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

**Test-Traffic kennzeichnen:** Echte Requests (Baseline, Sitzungen) landen in den Daten von GA4. Der Proxy kann jeden GA4-Request kennzeichnen, benannt wie die Felder in GA4:

| Option | `.env` | Im Request | Datenfilter in GA4 |
|---|---|---|---|
| `trafficType: '<wert>'` | `TRAFFIC_TYPE=<wert>` | `tt=<wert>` | „Interner Traffic“ mit genau diesem Wert |
| `debugMode: true` | `DEBUG_MODE=ein` | `_dbg=1` | „Entwickler-Traffic“; Events erscheinen außerdem in der DebugView |

- Welcher Wert und welche Kennzeichnung passen, hängt davon ab, welche Filter in der Property existieren und welchen Status sie haben: Erst ein **aktiver** Filter schließt Daten aus. Im Status „Testing“ (so steht der vorkonfigurierte Filter für `internal` ab Werk) werden die Daten nur markiert, aber weiter berichtet. Keine Vorgabe annehmen, sondern im Auftrag klären; beides lässt sich kombinieren.
- Nur mit Proxy (sonst bricht der Test mit Meldung ab), damit auch Beacons beim Verlassen einer Seite gekennzeichnet sind. Vorhandene Werte der Seite werden ersetzt. Der Test bekommt die Anmerkung „Test-Traffic“. Baseline und Vergleich mit derselben Einstellung laufen lassen, sonst meldet der Vergleich die Parameter als Hinweis.
- Andere Regeln mitnehmen (z. B. eigene Pfade): `kennzeichnenDienste: ['GA4', 'GA4 (sGTM)']`.
- Ein Server-Container reicht `tt` und `_dbg` wie andere Parameter weiter. Zu prüfen ist nur, ob er sie selbst liest oder verändert (Transformationen, Tags, die auf traffic_type oder debug_mode reagieren); dann im Bericht nennen.
- Werbedienste und andere Analyse-Tools kennzeichnet das nicht. Wer dort Testdaten vermeiden will, sperrt deren Requests per Regel; Filter in Tools wie Matomo hängen an deren eigenen Regeln (z. B. IP).

**Grenze ohne Proxy:** Beacons, die eine Seite beim Verlassen sendet, laufen in Chromium am Routing vorbei und gehen im Modus `abfangen` trotzdem raus. Die Stage erkennt das über das NetLog, markiert sie in `tracking-treffer.json` mit `entwischt: true` und setzt am Test die Anmerkung „Achtung“. Im Bericht erwähnen, wenn das vorkommt, und den Proxy empfehlen.

## Requests ohne Regel

Requests ohne Regel werden nie abgefangen, auch nicht im Modus `abfangen`; ein Tracking-Endpunkt ohne Regel geht also echt raus. `UNBEKANNTE=abfangen` fängt als Sicherheitsnetz alle Fetch-, XHR- und Beacon-Requests an fremde Domains ab (Dienst „Unbekannt“), kann aber Funktionen der Website stören. Hintergrund: [`../wissen/eigene-formate.md`](../wissen/eigene-formate.md).
