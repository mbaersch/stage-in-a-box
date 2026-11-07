# Anweisungen für Agents: Tracking-Tests aus einer Aufzeichnung bauen

Du baust aus einer Aufzeichnung einer Website-Journey eine Playwright-Testsuite, die das Tracking-Setup prüft (dataLayer, Consent, Requests an Dienste). Die Testumgebung („Stage in a Box“) ist in `lib/` fertig vorhanden, Scripts in `werkzeuge/`. Deine Aufgabe ist die Übersetzung von Aufzeichnung und Auftrag in Tests – nicht der Bau neuer Infrastruktur.

## Aufbau: gemeinsame Umgebung, ein Ordner pro Projekt

Die Session läuft immer im Hauptordner. Testumgebung, Abhängigkeiten (`node_modules`) und diese Anleitung gibt es nur einmal; jede Website ist ein Projekt unter `projects/<name>/`:

| Datei / Ordner | Inhalt |
|---|---|
| `projekt.md` | Anweisungen und Erkenntnisse nur für dieses Projekt – **vor jeder Arbeit am Projekt lesen**, gilt zusätzlich zu dieser Datei |
| `auftrag.md` | Was der Mensch will: Journey, Conversion, Testkonto, Baseline, Varianten, Grenzen |
| `aufzeichnungen/` | Tag-Assistant-Exporte (`*.json`) oder Konsolen-Mitschnitte (`*.log`/`*.txt`, Zeilen `[rec] {...}`), daneben die Analysen |
| `tests/`, `baselines/` | Tests und gespeicherte Baselines des Projekts |
| `.env`, `.env.example` | Zugangsdaten und Testdaten (siehe unten) |
| `testdaten.aufzeichnung.env` | optional: Eingaben aus einer Aufzeichnung im Modus `full` |

- Neues Projekt: `npm run neu -- <name>` (kopiert `vorlage/`). Nicht von Hand aus einem anderen Projekt kopieren.
- Nennt der Mensch kein Projekt und gibt es mehrere, nachfragen.
- `projects/` ist nicht im Git des Repos. Nichts aus einem Projekt in Dateien außerhalb von `projects/` übernehmen (keine Domains, Selektoren, Testdaten).

**Erkenntnisse festhalten:** Was nur diese Website betrifft (CMP-Eigenheiten, eigene Request-Formate, Bot-Schutz, Stolperstellen), trägst Du in `projekt.md` ein. Was für alle Projekte gilt (Fehler in `lib/` oder im Analyse-Script, fehlende Anweisung hier), schlägst Du dem Menschen als Änderung an `AGENTS.md`, `lib/` oder `werkzeuge/` vor – allgemein formuliert, ohne Projektdaten.

Die Arbeit hat **zwei Phasen**. Zwischen beiden bestätigt der Mensch den Auftrag.

| Phase | Ergebnis | Endet mit |
|---|---|---|
| 1. Analyse | vorausgefüllte `auftrag.md`, ergänzte `.env.example` | Rückfrage an den Menschen |
| 2. Bau | Tests, ggf. Baseline, Bericht | Abschlussbericht |

Steht in `auftrag.md` **Status: bestätigt**, beginne direkt mit Phase 2. Sonst mit Phase 1. Pfade in dieser Anleitung ohne `projects/<name>/` davor beziehen sich auf den Projektordner, wenn es dort so eine Datei gibt (`auftrag.md`, `tests/`, `.env` …), sonst auf den Hauptordner (`lib/`, `werkzeuge/`, `docs/`, `beispiel/`).

## Umgang mit `.env` und Testdaten

- `.env` füllt ausschließlich der Mensch aus. Du schreibst sie nie, auch nicht teilweise, und gibst ihre Werte nie aus (auch nicht in Logs oder Berichten).
- `testdaten.aufzeichnung.env` schreibt nur das Analyse-Script (`--testdaten`), Du bearbeitest sie nicht und gibst ihre Werte nie aus. Die Tests laden zuerst `.env`, dann diese Datei; was in `.env` steht, hat Vorrang.
- Braucht ein Test Zugangs- oder Testdaten, ergänzt Du in `.env.example` den Variablennamen mit kurzem Kommentar und nennst ihn dem Menschen. Variablen stehen dort nicht auskommentiert und ohne Wert (`NAME=`); leere Einträge gelten als nicht gesetzt. Kommentare nur in eigenen Zeilen, damit niemand den Wert hinter ein `#` schreibt (`playwright.config.ts` warnt dann, ohne Werte zu nennen).
- Ob eine Variable gesetzt ist, nur mit einem Script prüfen, das ausschließlich Namen ausgibt (z. B. `gesetzt`/`FEHLT`), und beide Dateien berücksichtigen.
- `BASE_URL` ist Pflicht; ohne sie bricht jeder Testlauf des Projekts mit einer Meldung ab.
- Im Code nur `process.env.NAME`. Fehlt eine Variable, soll der Test mit klarer Meldung abbrechen:
  ```ts
  const passwort = process.env.TEST_LOGIN_PASSWORT ?? test.skip(true, 'TEST_LOGIN_PASSWORT in .env fehlt') as never;
  ```

---

## Phase 1: Analyse und Auftragsentwurf

### Aufzeichnung auswerten

```sh
npm run analyse -- projects/<name>/aufzeichnungen/<datei>
```

Pfade immer mit `/`, auch unter Windows (gilt ebenso für `npm test`, weil Playwright Pfade als RegExp liest).

Das Script erzeugt neben dem Export:

- `<datei>.zeitleiste.md` – **Deine Hauptquelle.** Vorschlag für den Auftrag (Startadresse, Seiten, vermutete Conversion, Events, Google-Requests, flüchtige Werte, Testdaten-Felder mit Variablennamen, Auffälligkeiten), Tags pro Event, vorgeschlagene Playwright-Schritte mit aufgezeichneten Pausen und die Zeitleiste pro Seite.
- `<datei>.analyse.json` – dieselben Daten strukturiert, falls Du Details brauchst (z. B. alle Parameter eines Google-Requests).

Den Roh-Export (oft über 100 MB) nicht in den Kontext laden. Nur wenn das Script scheitert: Struktur mit einem kurzen Script untersuchen (`data.containers[].messages`, `tagsFired`, `pageSummaries`, `hitInfo`) und den Fehler im Bericht nennen.

Was der Tag-Assistant-Export enthält und was nicht:

- dataLayer-Messages, Consent-Stand pro Message, gefeuerte Tags pro Message
- Requests nur von Google-Tags (GA4, Ads, Floodlight) mit allen Parametern
- **keine** Requests anderer Dienste (Meta, TikTok …) – nur, dass deren Tag gefeuert hat

### Requests über eigene Pfade und Formate

Ein Request, der zu fehlen scheint, fehlt nicht unbedingt. Er kann über einen Pfad auf der eigenen Domain und in einem ganz anderen Format rausgehen: serverseitiges Tagging mit eigenem Pfad, Custom Loader, getunnelte und kodierte Requests (z. B. bei Stape), umbenannte Parameter. Die Standardregeln in `lib/stage.ts` erkennen nur gängige Endpunkte.

Deshalb zu Beginn von Phase 2, bevor Erwartungen entstehen, einmal prüfen:

1. Die Journey als Gerüst-Test (nur Navigation, keine Erwartungen) laufen lassen, am besten mit `PROXY=ein`.
2. In den Anhängen `hosts.json` und `weitere-requests.json` nachsehen: Fetch-, XHR- und Beacon-Requests ohne passende Regel. Tracking-Kandidaten (POST an Pfade auf der eigenen oder einer Subdomain, auffällige Parameter, Base64-Bodies) mit dem Tag-Assistant-Export abgleichen: Welcher Tag feuerte zur selben Zeit?
3. Für erkannte Formate eigene `regeln` anlegen und im Auftrag unter „Hinweise“ festhalten.

Typisches Muster eines Stape-Custom-Loaders: Script- und Tracking-Requests gehen an eine eigene Subdomain mit verschleiertem Pfad und einem einzigen Parameter, dessen Wert der Base64-kodierte Originalpfad ist, z. B. `https://stp.example.de/abcdef/239?0355ae1a=L2d0YWcvanM…` → `/gtag/js?id=G-…`. Script-Downloads und Tracking teilen sich dann dieselbe URL-Form: Eine Regel darauf fängt im Modus `abfangen` auch die Scripts ab. Deshalb dekodieren und nur passende Pfade (z. B. `/g/collect`) als Tracking werten. Dekodier-Logik gehört in den Test des jeweiligen Projekts, nicht nach `lib/`.

Tag feuert laut Tag Assistant, aber es kommt kein Request: Im Browser `google_tag_data.tidr` prüfen. `container[<ID>].state` 2 heißt registriert, Ziele in `pending` warten auf ein Google-Tag, das nie geladen bzw. registriert wurde (z. B. bei gemischtem Setup aus Google-Tag und Ereignis-Tags). `scriptSource` zeigt, woher ein Container geladen wurde; `Object.keys(google_tag_manager)` listet alle geladenen Container und Ziele. Das ist ein Befund über die Website, kein Testfehler.

Referenz dafür ist der [Tracking Auditor](https://github.com/mbaersch/tracking-auditor): `tracking-vendors.json` (Skripte und Endpunkte bekannter Dienste) und `lib/tracking-classify.js` mit Erkennung von First-Party-Collect-Endpunkten und Stape-Tunneln (`extractFirstPartyCollectMatches`, `extractStapeMatches`, `tryDecodeStapeTransport`). Nicht alles daraus übernehmen: Ziel ist nicht, jeden denkbaren Loader zu erkennen, sondern die Requests dieser einen Website richtig zuzuordnen.

Recorder-Einträge (Key `__rec`) haben diese wichtigsten Felder:

| Feld | Bedeutung |
|---|---|
| `type` | `init`, `click`, `change`, `submit`, `key`, `route` |
| `pageId` | wechselt bei jedem vollständigen Seitenaufruf |
| `seq` | Reihenfolge innerhalb einer Seite |
| `element.selectors` | Selektor-Kandidaten nach Robustheit, jeweils mit `unique` |
| `element.role`, `element.name` | Rolle und Accessible Name, für `getByRole()` |
| `element.shadowHosts` | Element liegt in (offenem) Shadow DOM |
| `field` | Wert bei `change`/`submit`, maskiert (`mode: "masked"`), im Klartext (`"full"`) oder `[redacted]` |
| `isTrusted` | `false` = vom Browser/Script ausgelöst, nicht vom Menschen |

Vollständige Beschreibung: `docs/aufzeichnungsformat.md`.


### Auftrag vorausfüllen

- Fülle in `auftrag.md` alle Felder, die sich aus der Zeitleiste ableiten lassen: Startadresse, Ablauf in Worten, vermutete Conversion, Events mit wichtigen Werten, Tags pro Aktion, Felder mit Testdaten, sich ändernde Werte. Übernimm die Auffälligkeiten unter „Hinweise“.
- Markiere alles Abgeleitete mit *(aus Aufzeichnung)*. Was der Mensch schon eingetragen hat, bleibt unverändert; Widersprüche zur Aufzeichnung notierst Du unter „Hinweise“.
- Fehlt etwas, das sich nicht ableiten lässt (echte Bestellung erlaubt? Baseline gewünscht?), lass das Feld leer.
- Ergänze `.env.example` um die nötigen Variablen (Login, Formularfelder mit `[redacted]` oder maskierten Werten).

### Eingaben aus der Aufzeichnung übernehmen

Steht in der Zeitleiste `Werte-Modus des Recorders: full`, enthält die Aufzeichnung die echten Eingaben des Testlaufs. Der Mensch kann sie direkt als Testdaten verwenden, statt sie in `.env` abzutippen:

- Steht im Auftrag unter „Eingaben aus der Aufzeichnung übernehmen?“ **ja**, rufe `npm run analyse -- projects/<name>/aufzeichnungen/<datei> --testdaten` auf.
- Ist das Feld leer, biete es in der Rückfrage an und führe es erst nach Zustimmung aus.
- Das Script schreibt `testdaten.aufzeichnung.env` und nennt nur Variablennamen: welche übernommen wurden und welche trotzdem in `.env` fehlen (Passwörter zeichnet der Recorder nie auf).
- Bei maskierten Aufzeichnungen nicht anbieten; das Script bricht dann ohnehin ab.

### Rückfrage

Beende Phase 1 mit einer kurzen Nachricht: was Du vorausgefüllt hast, welche Felder offen sind, welche Variablen in `.env` gebraucht werden (abzüglich der aus der Aufzeichnung übernommenen). Bitte darum, den Auftrag zu prüfen und den Status auf **bestätigt** zu setzen. **Schreibe in Phase 1 keine Tests.**

---

## Phase 2: Tests bauen

### Aktionen ableiten

**Ausgangspunkt** sind die „Vorgeschlagenen Playwright-Schritte“ aus der Zeitleiste. Sie sind schon bereinigt (Fokus-Klicks, Script-Klicks, doppelte Submits entfernt) und enthalten die aufgezeichneten Pausen. Prüfe sie, ergänze Warte-Bedingungen nach Navigationen (`toHaveURL`) und gliedere sie in `test.step`s.

**Locator-Wahl** – das Script wählt in dieser Reihenfolge, jeweils nur bei in der Aufzeichnung geprüfter Eindeutigkeit; halte Dich bei Änderungen daran:

1. Test-Attribut (`kind: "testAttr"`) → `page.getByTestId()` bzw. `page.locator('[data-qa="…"]')`
2. `id` (nicht `idGenerated`), dann `name`
3. Rolle + Name → `page.getByRole('button', { name: '…' })`
4. `aria-label`, `href`
5. `cssPath` nur als letzte Möglichkeit, mit Kommentar warum

Generierte IDs (`idGenerated`) nie verwenden. Texte mit Preisen, Datumsangaben oder Zählern nicht als exakten Namen, sondern als RegExp oder gar nicht. Rolle + Name ist nicht auf Eindeutigkeit geprüft: Bei Formularen mit wiederholten Feldern (Rechnungs- und Lieferadresse) eher `id`/`name` nehmen.

**Zuordnung:**

| Recorder | Playwright |
|---|---|
| `click` | `locator.click()` |
| `click` auf Link mit `opensNewTab` | `const [neu] = await Promise.all([page.context().waitForEvent('page'), locator.click()])` |
| `change` an Text-/E-Mail-/Telefonfeld | `locator.fill(wert)` |
| `change` an `select` | `locator.selectOption(value)` |
| `change` an Checkbox/Radio | `locator.check()` / `uncheck()` |
| `key` Enter | `locator.press('Enter')` |
| `route` | keine Aktion, sondern Ergebnis: `await expect(page).toHaveURL(…)` |
| neuer `pageId` mit `init` | Ergebnis einer Navigation: URL prüfen |

**Bereinigen:**

- Klick auf `label` + `change` an zugehöriger Checkbox → ein `check()`.
- `click` mit `isTrusted: false` direkt nach `key` Enter ist der implizite Submit → nicht nachspielen.
- `hashchange` nach Klick auf Anker-Link → Folge des Klicks.
- Doppelklicks, Fehlklicks, Umwege der aufzeichnenden Person weglassen, wenn sie für das Ziel keine Rolle spielen. Im Zweifel nachfragen.

**Werte:** Maskierte Werte zeigen nur Format und Länge, `[redacted]` gar nichts. Echte Werte immer über `process.env`. Auch Klartextwerte aus Aufzeichnungen im Modus `full` gehören nicht in Testcode, sondern als Variable in `.env.example` (Wert ggf. über `testdaten.aufzeichnung.env`).

**Login:** Ist im Auftrag ein Testkonto genannt, wird der Login ein eigener `test.step` mit Werten aus `TEST_LOGIN_EMAIL` und `TEST_LOGIN_PASSWORT` (bzw. den in `.env.example` ergänzten Namen).

**Consent-Banner:**

- Klick im offenen Shadow DOM: Playwright-Locators durchdringen offene Shadow Roots, `getByTestId`/CSS funktionieren direkt.
- Kein Recorder-Klick, aber ein `consent update` im dataLayer (die Zeitleiste nennt das unter „Auffälligkeiten“), hat zwei mögliche Ursachen: GTM und damit der Recorder laden erst nach der Zustimmung, oder der Banner liegt in einem iframe oder geschlossenen Shadow DOM. In beiden Fällen gilt, was im Auftrag unter „Consent-Banner“ steht: CMP-Name oder Selektoren und nötige Schritte (z. B. Scrollen, bis der Banner erscheint). Fehlt die Angabe, in Phase 1 danach fragen.
- Lädt GTM erst nach der Zustimmung, entstehen beim Ablehnen womöglich gar keine Tracking-Requests und kein dataLayer-Eintrag. Die Variante „Consent abgelehnt“ prüft dann genau das: nichts darf feuern. Prüfe die CMP-Bibliothek im Repo [mbaersch/tracking-auditor](https://github.com/mbaersch/tracking-auditor), Datei `cmp-library.json`: Dort stehen für über 120 CMPs `accept`, `reject`, ggf. `rejectSteps` (zweistufiges Ablehnen), `detect` (Container zum Erkennen) und `shadowDom`. Bei iframe-Bannern `page.frameLocator(…)` verwenden.
- Jeder Test startet in einem frischen Browser-Kontext ohne Cookies, der Banner erscheint also immer.

**GTM-Vorschau statt Live-Container:** Steht im Auftrag, dass getestet wird, was nur in einer GTM-Vorschau läuft (Workspace oder Umgebung), beginnt die Journey mit `const website = await stage.vorschauStarten(page)` und läuft danach im Tab `website` weiter, nicht in `page`.
- Der Link muss aus GTM kommen („Vorschau“ bzw. „Vorschau teilen“, mit `gtm_auth` und `gtm_preview`). Ein Tag-Assistant-Link mit nur `gtm_debug` startet keine Vorschau des Workspaces. Der Link gehört als `GTM_VORSCHAU_LINK` in `.env`.
- Im frischen Browser erscheint der Dialog „Verbinden“; `vorschauStarten` klickt `#domain-start-button` und wartet auf den neuen Tab. Der Tab mit dem Tag Assistant bleibt offen, sonst endet die Vorschau.
- Eigener dataLayer und eigene GA4-Requests des Tag Assistant werden nicht protokolliert (`WERKZEUG_SEITEN` in `lib/stage.ts`).
- Prüfen, dass die Vorschau wirklich geladen ist (z. B. ein Event, das nur im Workspace existiert), bevor Erwartungen entstehen.

**Iframes:** Zahlungsfelder und manche CMPs liegen in Cross-Origin-iframes; der Recorder sieht dort nichts. Wenn der Auftrag diesen Teil abdeckt, mit `frameLocator` arbeiten und Selektoren mit dem Menschen klären. Sonst den Test vor diesem Schritt enden lassen und das im Bericht erwähnen.

### Tempo

Zwischen den Schritten steht `await stage.denkpause(<ms>)` mit dem aufgezeichneten Abstand. Wie lange tatsächlich gewartet wird, bestimmt `TEMPO` (in `.env` oder als Umgebungsvariable): `schnell` (Vorgabe, keine Pausen), `mittel`, `langsam` oder `aufzeichnung` (Pausen wie aufgezeichnet). Zeitabhängige Requests wie GA4 `user_engagement`, Timer- oder Scroll-Trigger hängen davon ab. Die Pausen also immer im Code lassen, auch wenn sie bei `schnell` nichts tun.

### Zwei Arten von Tests

1. **Feste Erwartungen** (Modus `abfangen`, nichts geht raus): prüfen gezielt, was im Auftrag steht. Hier laufen auch die Varianten.
2. **Baseline-Vergleich** (Modus `durchlassen`, echte Requests): nur wenn der Auftrag eine Baseline will. Vergleicht den kompletten Lauf mit dem gespeicherten Ist-Zustand.

Beide nutzen dieselbe `journey()`-Funktion. Vorbild für beides: `beispiel/tests/beispiel-demo.spec.ts`.

### Feste Erwartungen

- **Welche Events zählen:** die im Auftrag genannten, dazu alle Events, die in der Aufzeichnung direkt auf eine Aktion folgen (Ecommerce-Events, Conversion, Consent).
- **Exakt prüfen:** Event-Namen, feste Parameter (Item-IDs eines festen Testprodukts, Währung), Consent-Werte.
- **Nur Format prüfen:** Transaktions-IDs, Zeitstempel, Zufallswerte (`toMatch(/…/)`, `typeof`).
- **Reihenfolge:** Mit `const ab = stage.dataLayer.eintraege.length` vor einer Aktion und `erwarteEvent(name, { ab })` nur Events nach dieser Aktion prüfen.
- **Requests:** `stage.tracking.erwarteGa4('purchase')` liefert alle Parameter (`en`, `gcs`, `ep.*`, `epn.*`, `pr1` …). `gcs`: `G100` = kein Consent, `G111` = voller Consent. Für andere Dienste `stage.tracking.erwarteTreffer('Meta', { passt: … })`.

**Der Ist-Zustand ist nicht automatisch der Soll-Zustand.** Erwartungen, die nur aus der Aufzeichnung stammen und nicht im bestätigten Auftrag stehen, listest Du im Bericht auf. Auffälligkeiten (Event doppelt, Request mit `G111` vor Consent, fehlende Parameter) nicht in Erwartungen gießen, sondern melden.

### Baseline

```ts
test.describe('Baseline', () => {
  test.use({ stageOptionen: { trackingModus: 'durchlassen' } });

  test('Kauf entspricht der Baseline', async ({ page, stage }) => {
    await journey(page, stage);
    await stage.vergleicheMitBaseline('Kauf', { fluechtigeKeys: ['cart_id'] });
  });
});
```

- **Immer Modus `durchlassen`.** Abgefangene Requests bekommen keine echte Antwort: Weiterleitungsketten (z. B. Google-Ads-Conversions) und von einem sGTM ausgelöste Folge-Requests fehlen dann. `vergleicheMitBaseline` bricht in anderen Modi ab.
- **Mit oder ohne Proxy** wie im Auftrag; mit Proxy entsteht eine eigene Datei `baselines/<journey>.proxy.json`.
- **Gleiches Tempo** für Baseline und Vergleich; sonst bricht der Vergleich ab. Welches Tempo, steht im Auftrag oder wird mit dem Menschen geklärt (`aufzeichnung` kommt echtem Verhalten am nächsten, dauert aber so lange wie die Aufzeichnung).
- Vor der Momentaufnahme verlässt `vergleicheMitBaseline` die letzte Seite, damit Requests beim Verlassen (z. B. `user_engagement`) enthalten sind. Ohne Proxy sieht Playwright solche Beacons nicht; die Stage holt sie aus dem NetLog des Browsers (Quelle `netlog`, ohne Body). Mit Proxy kommen sie vollständig (Quelle `proxy`).
- Der erste Lauf speichert `baselines/<journey>.json` im Projektordner, jeder weitere vergleicht dagegen. Der Bericht steht als `baseline-vergleich.md` im Report und in `test-results/`.
- **Rot** (Test schlägt fehl): Request fehlt, ist mehrfach da, blockiert oder gescheitert; Consent-Parameter (`gcs`, `gcd`, `npa`, `dma`) geändert; dataLayer-Event fehlt oder ist mehrfach da; Key fehlt, der vorher da war; jede Abweichung in `ecommerce`; Consent-Befehle geändert; CSP-Verstoß.
- **Info** (nur Bericht): neue Requests, Hosts, Parameter; geänderte Parameterwerte; neue Events oder Keys außerhalb von `ecommerce`; geänderte Reihenfolge.
- Werte, die sich bei jedem Lauf ändern (aus dem Auftrag oder beim zweiten Lauf als „geändert“ sichtbar), als `fluechtigeKeys` bzw. `fluechtigeParameter` angeben. Gängige sind schon in `lib/baseline.ts` hinterlegt.
- Nach dem Anlegen: Test **zweimal** laufen lassen. Der zweite Lauf zeigt, welche Werte flüchtig sind.
- **Baseline nie neu erzeugen, um einen roten Test grün zu machen.** `npm run baseline:neu -- projects/<name>` nur auf ausdrücklichen Wunsch des Menschen.
- Bei echten Käufen nur mit Testkonto bzw. Testprodukt laut Auftrag.

### Varianten

Nur bauen, was der Auftrag verlangt. Varianten laufen über `test.use` in eigenen `describe`-Blöcken, im Modus `abfangen`:

```ts
// Dienst blockiert (Adblocker): Seite und Conversion-Event müssen trotzdem funktionieren
test.use({ stageOptionen: { regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }] } });

// Ladereihenfolge: GTM 3 s verzögern, Script echt laden, nicht als Tracking-Request zählen
test.use({ stageOptionen: { regeln: [
  { name: 'GTM-Script', muster: /googletagmanager\.com\/gtm\.js/, modus: 'durchlassen', verzoegerungMs: 3000, nichtProtokollieren: true },
] } });

// Geplante CSP testen; Verstöße stehen in stage.cspVerstoesse
test.use({ stageOptionen: { csp: "default-src 'self'; script-src 'self' https://www.googletagmanager.com" } });
```

Verzögerungen und CSP-Simulation fangen Requests im Browser ab. Weiterleitungsketten von Beacons können dabei verloren gehen – solche Varianten nicht mit Baseline-Vergleichen kombinieren.

### Proxy

Mit `PROXY=ein` (in `.env`) oder `stageOptionen: { proxy: true }` laufen alle Requests des Testbrowsers über einen lokalen Proxy (`lib/proxy.ts`). Der Proxy sieht und steuert alles im Netzwerk:

- Beacons beim Verlassen einer Seite (GA4 `user_engagement`, Microsoft Ads u. a.) werden erfasst, mit Body, und im Modus `abfangen` wirklich abgefangen.
- Service Worker sind erlaubt wie bei echten Besuchern; ihre Requests sind sichtbar.
- Regeln greifen auch für Pfade auf der eigenen Domain (sGTM).

Die Testumgebung ist ohne Proxy einfacher, mit Proxy vollständiger. Was der Auftrag sagt, gilt. Bei Staging-Servern mit ungültigem Zertifikat `stageOptionen: { zertifikatFehlerIgnorieren: true }` setzen.

**Grenze ohne Proxy:** Beacons, die eine Seite beim Verlassen sendet, laufen in Chromium am Routing vorbei und gehen im Modus `abfangen` trotzdem raus. Die Stage erkennt das über das NetLog, markiert sie in `tracking-treffer.json` mit `entwischt: true` und setzt am Test die Anmerkung „Achtung“. Im Bericht erwähnen, wenn das vorkommt, und den Proxy empfehlen.

Weitere Möglichkeiten:

- **Consent-Zustand vorgeben** statt klicken: CMP-Cookie per `page.context().addCookies()` oder localStorage per `page.addInitScript()` setzen. Den Speicherort der CMP vorher per DevTools ermitteln.
- **dataLayer manipulieren** (z. B. andere CMP-Konfiguration simulieren): `page.addInitScript(() => { window.dataLayer = window.dataLayer || []; window.dataLayer.push(…); })` – läuft vor allen Scripts der Seite.
- **Weitere Dienste:** Endpunkte aus `tracking-vendors.json` im Tracking-Auditor-Repo als Regel ergänzen.
- **CSP-Sonderfall Meta:** Große Events (z. B. Purchase mit vielen Produkten) sendet das Pixel nicht per Beacon, sondern als Formular-POST in ein iframe. Eine CSP ohne passende `form-action`/`frame-src` blockiert genau diese Events. Bei CSP-Tests mit Meta deshalb die Purchase-Events prüfen, nicht nur PageView.
- **PII/Hashing (Enhanced Conversions):** Aufzeichnung im Modus `full` mit Testdaten; prüfen, dass Requests die Daten nur gehasht enthalten. Parser für die Parameter der gängigen Dienste: `pii-lib/` im Tracking-Auditor-Repo.

### Struktur

- Eine Datei pro Journey in `projects/<name>/tests/`, z. B. `kauf.spec.ts`.
- Immer `import { test, expect } from '../../../lib/stage';` – nie direkt aus `@playwright/test`, sonst fehlt die Stage.
- Journey als Funktion `journey(page, stage, …)` mit `test.step` pro Abschnitt (deutsche Namen).
- Kein `waitForTimeout`. Warten über `expect(…)`, `toHaveURL`, `erwarteEvent`, `erwarteGa4`.
- Projektspezifisches (Regeln, Dekodier-Logik, Helfer) bleibt im Projektordner, z. B. `tests/hilfen.ts`.
- `lib/` gilt für alle Projekte. Nur ändern, wenn es nicht anders geht, im Bericht begründen und danach `npm test` (Beispiel) laufen lassen. Neue Dienste als `regeln` in den Tests ergänzen.
- `beispiel/` nicht ändern. Es dient als Referenz und läuft bei `npm test` ohne Projekt.

### Ausführen und stabilisieren

Abhängigkeiten sind im Hauptordner einmal installiert (`npm install`, `npx playwright install chromium`); in Projektordnern nie `npm install` ausführen.

```sh
npm run pruefen                                     # TypeScript-Prüfung, alle Projekte
npm test -- projects/<name>                         # alle Tests des Projekts
npx playwright test projects/<name>/tests/kauf.spec.ts --headed   # eine Datei, sichtbar
npm run report -- projects/<name>/playwright-report
npm test                                            # ohne Projekt: das Beispiel
```

Das Projekt ergibt sich aus dem Pfad im Aufruf, alternativ aus `PROJEKT=<name>`. Report und `test-results/` liegen im Projektordner.

- Bei Fehlern zuerst die Anhänge (`dataLayer.json`, `tracking-treffer.json`, `hosts.json`, `weitere-requests.json`, `csp-verstoesse.json`, `baseline-vergleich.md`), Trace und Screenshot im Report ansehen.
- Fehlt ein erwarteter Request, zuerst in `weitere-requests.json` nachsehen, ob er über einen eigenen Pfad oder ein anderes Format rausging (siehe „Requests über eigene Pfade und Formate“).
- Pushes aus GTM-Custom-Templates liegen im dataLayer der Seite teils als Hüllen-Objekt `{ value: { event: … } }`. Die Stage packt sie aus; im Protokoll stehen sie wie normale Events. Wer `window.dataLayer` direkt liest, sieht die Hülle.
- Neue Tests zuerst mit `TEMPO=schnell` stabil bekommen, dann im gewünschten Tempo laufen lassen.
- Testfehler (Locator, Timing) beheben. Website- oder Tracking-Fehler **nicht wegtesten**: Erwartungen nicht aufweichen, damit es grün wird, sondern melden.
- Tests mit festen Erwartungen mindestens dreimal hintereinander grün laufen lassen (`--repeat-each=3`). Baseline-Tests senden echte Requests: dort reichen zwei Läufe.
- Bot-Schutz, Captchas, 3-D-Secure: nicht umgehen, sondern melden.

## Grenzen und Sicherheit

- Echte Requests nur in Baseline-Tests und nur, wenn der Auftrag eine Baseline will.
- Echte Käufe, Formular-Absendungen an echte Empfänger oder Kontoänderungen nur, wenn der Auftrag das ausdrücklich erlaubt (Testkonto, Testprodukt, Gutschein). Sonst den Test vor dem endgültigen Absenden beenden und nachfragen.
- Keine Zugangsdaten, Testadressen oder Exporte in Code, Berichten oder Commits.

## Abschlussbericht (Ende Phase 2)

Kurz und konkret:

1. Welche Tests es gibt und wie man sie startet.
2. Welche Erwartungen aus dem Auftrag stammen und welche Du aus dem Ist-Zustand übernommen hast (zur Bestätigung).
3. Baseline: angelegt ja/nein, mit welchem Tempo, mit oder ohne Proxy, welche Werte als flüchtig markiert sind und warum.
4. Eigene Regeln für Requests über eigene Pfade oder Formate, falls nötig.
5. Auffälligkeiten im Tracking (mögliche Fehler der Website).
6. Was nicht abgedeckt ist und warum (iframe, Bot-Schutz, fehlende Testdaten).
7. Offene Fragen und noch fehlende Einträge in `.env`.
8. Was Du in `projekt.md` festgehalten hast, und Vorschläge für `AGENTS.md`, `lib/` oder `werkzeuge/`, die allen Projekten helfen würden.
