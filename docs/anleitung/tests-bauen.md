# Phase 2: Tests bauen

Voraussetzung: `auftrag.md` mit **Status: bestätigt**. Ergebnis: Tests, stabil bis vor die Conversion, dann ein vollständiger Lauf, und ein Abschlussbericht mit dem Angebot, die Baseline zu ziehen ([`baseline.md`](baseline.md)).

## Zuerst: Was geht wirklich raus?

Ein Request, der zu fehlen scheint, fehlt nicht unbedingt; er kann über einen eigenen Pfad und in eigenem Format rausgehen (Hintergrund: [`../wissen/eigene-formate.md`](../wissen/eigene-formate.md)). Deshalb, bevor Erwartungen entstehen:

1. Die Journey als Gerüst-Test (nur Navigation, keine Erwartungen, mit `stage.conversionPunkt()`) mit `CONVERSION=aus` laufen lassen, am besten mit `PROXY=ein`.
2. In `projects/<name>/test-results/<test>/` die Dateien `hosts.json` (mit dem Auslöser des ersten Requests je Host: Skript oder HTML der Seite), `tracking-treffer.json` und `weitere-requests.json` ansehen. Tracking-Kandidaten ohne Regel (POST an Pfade auf der eigenen oder einer Subdomain, auffällige Parameter, Base64-Bodies) mit dem Tag-Assistant-Export abgleichen: Welcher Tag feuerte zur selben Zeit?
3. Für erkannte Formate eigene `regeln` anlegen und im Auftrag unter „Hinweise“ festhalten. Was nur diese Website betrifft, zusätzlich in `projekt.md`.

## Aktionen ableiten

**Conversion-Punkt:** Direkt vor der Aktion, die die Conversion auslöst (Kauf, Absenden), steht `await stage.conversionPunkt();`. Alles, was ohne Conversion feststeht (Consent, Requests bis dahin), wird davor geprüft. Mit `CONVERSION=aus` endet der Test dort und gilt als übersprungen. Beim Einrichten und Stabilisieren immer mit `CONVERSION=aus` arbeiten; vollständige Läufe nur gezielt und nur, wenn der Auftrag echte Conversions erlaubt. Im Bericht nennen, wie viele vollständige Läufe es gab.

**Ausgangspunkt** sind die „Vorgeschlagenen Playwright-Schritte“ aus der Zeitleiste. Sie sind schon bereinigt (Fokus-Klicks, Script-Klicks, doppelte Submits entfernt) und enthalten die aufgezeichneten Pausen. Prüfe sie, ergänze Warte-Bedingungen nach Navigationen (`toHaveURL`) und gliedere sie in `test.step`s.

**Locator-Wahl** – das Script wählt in dieser Reihenfolge, jeweils nur bei in der Aufzeichnung geprüfter Eindeutigkeit; halte Dich bei Änderungen daran:

1. Test-Attribut (`kind: "testAttr"`) → `page.getByTestId()` bzw. `page.locator('[data-qa="…"]')`
2. `id` (nicht `idGenerated`), dann `name`
3. Rolle + Name → `page.getByRole('button', { name: '…' })`
4. `aria-label`, `href`
5. `cssPath` nur als letzte Möglichkeit, mit Kommentar warum

Generierte IDs (`idGenerated`) nie verwenden. Texte mit Preisen, Datumsangaben oder Zählern nicht als exakten Namen, sondern als RegExp oder gar nicht. Rolle + Name ist nicht auf Eindeutigkeit geprüft: Bei Formularen mit wiederholten Feldern (Rechnungs- und Lieferadresse) eher `id`/`name` nehmen.

Kommt ein Name mehrfach vor, den umgebenden Container eingrenzen (z. B. `page.locator('.woocommerce-message').getByRole('link', …)`) statt `.first()` oder `filter({ visible: true })`: Elemente weit außerhalb des Bildschirms (ausgeklappte Menüs, Mini-Warenkörbe) gelten für Playwright als sichtbar.

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
- Kein Recorder-Klick, aber ein `consent update` im dataLayer: Es gilt, was im Auftrag unter „Consent-Banner“ steht (CMP-Name oder Selektoren und nötige Schritte, z. B. Scrollen, bis der Banner erscheint). Ursachen, Selektoren aus der CMP-Bibliothek und iframe-Banner: [`../wissen/cmp.md`](../wissen/cmp.md).
- Jeder Test startet in einem frischen Browser-Kontext ohne Cookies, der Banner erscheint also immer.

**GTM-Vorschau:** Steht im Auftrag, dass getestet wird, was nur in einer GTM-Vorschau läuft: [`gtm-vorschau.md`](gtm-vorschau.md).

**Prüfungen:** Was im Auftrag unter „Prüfungen“ angekreuzt ist (Durchgängigkeit, Cookies), kommt als `stageOptionen.pruefungen` in den Test der Journey: [`varianten.md`](varianten.md), „Prüfungen“.

**Bedingungen:** Was im Auftrag unter „Bedingungen“ angekreuzt ist (Landung über eine Anzeige, wiederkehrender Besucher, Mobilgerät …), wird mit `stageOptionen` zu einer Variante derselben Journey, kein eigener Ablauf: [`varianten.md`](varianten.md), „Bedingungen für eine Journey“.

**Iframes:** Zahlungsfelder und manche CMPs liegen in Cross-Origin-iframes; der Recorder sieht dort nichts. Wenn der Auftrag diesen Teil abdeckt, mit `frameLocator` arbeiten und Selektoren mit dem Menschen klären. Sonst den Test vor diesem Schritt enden lassen und das im Bericht erwähnen.

## Tempo

Zwischen den Schritten steht `await stage.denkpause(<ms>)` mit dem aufgezeichneten Abstand. Wie lange tatsächlich gewartet wird, bestimmt `TEMPO` (in `.env` oder als Umgebungsvariable): `schnell` (Vorgabe, keine Pausen), `mittel`, `langsam` oder `aufzeichnung` (Pausen wie aufgezeichnet). Zeitabhängige Requests wie GA4 `user_engagement`, Timer- oder Scroll-Trigger hängen davon ab. Die Pausen also immer im Code lassen, auch wenn sie bei `schnell` nichts tun.

## Zwei Arten von Tests

1. **Feste Erwartungen** (Modus `abfangen`, nichts geht raus): prüfen gezielt, was im Auftrag steht. Hier laufen auch die Varianten ([`varianten.md`](varianten.md)).
2. **Baseline-Vergleich** (Modus `durchlassen`, echte Requests): nur wenn der Auftrag eine Baseline will. Den Test baust Du in Phase 2 gleich mit, gezogen wird die Baseline in Phase 3 ([`baseline.md`](baseline.md)).

Beide nutzen dieselbe `journey()`-Funktion. Vorbild für beides: `beispiel/tests/beispiel-demo.spec.ts`.

## Feste Erwartungen

- **Welche Events zählen:** die im Auftrag genannten, dazu alle Events, die in der Aufzeichnung direkt auf eine Aktion folgen (Ecommerce-Events, Conversion, Consent).
- **Exakt prüfen:** Event-Namen, feste Parameter (Item-IDs eines festen Testprodukts, Währung), Consent-Werte.
- **Nur Format prüfen:** Transaktions-IDs, Zeitstempel, Zufallswerte (`toMatch(/…/)`, `typeof`).
- **Reihenfolge:** Mit `const ab = stage.dataLayer.eintraege.length` vor einer Aktion und `erwarteEvent(name, { ab })` nur Events nach dieser Aktion prüfen.
- **Requests:** `stage.tracking.erwarteGa4('purchase')` liefert alle Parameter (`en`, `gcs`, `ep.*`, `epn.*`, `pr1` …). Für andere Dienste `stage.tracking.erwarteTreffer('Meta', { passt: … })`. Parameter einzelner Dienste: [`../wissen/dienste.md`](../wissen/dienste.md).

**Der Ist-Zustand ist nicht automatisch der Soll-Zustand.** Erwartungen, die nur aus der Aufzeichnung stammen und nicht im bestätigten Auftrag stehen, listest Du im Bericht auf. Auffälligkeiten (Event doppelt, Request mit `G111` vor Consent, fehlende Parameter) nicht in Erwartungen gießen, sondern melden.

## Struktur

- Eine Datei pro Journey in `projects/<name>/tests/`, z. B. `kauf.spec.ts`.
- Immer `import { test, expect } from '../../../lib/stage';` – nie direkt aus `@playwright/test`, sonst fehlt die Stage.
- Journey als Funktion `journey(page, stage, …)` mit `test.step` pro Abschnitt (deutsche Namen).
- Kein `waitForTimeout`. Warten über `expect(…)`, `toHaveURL`, `erwarteEvent`, `erwarteGa4`.
- Projektspezifisches (Regeln, Dekodier-Logik, Helfer) bleibt im Projektordner, z. B. `tests/hilfen.ts`. Neue Dienste als `regeln` in den Tests ergänzen.

## Stabilisieren

- Bei Fehlern zuerst die Protokolle (`dataLayer.json`, `tracking-treffer.json`, `hosts.json`, `weitere-requests.json`, `csp-verstoesse.json`, `baseline-vergleich.md`) in `projects/<name>/test-results/<test>/` ansehen, dann Trace und Screenshot. Die Dateien liegen auch bei grünen Tests dort; für eine Auswertung ist kein neuer Lauf nötig.
- Fehlt ein erwarteter Request, zuerst in `weitere-requests.json` nachsehen, ob er über einen eigenen Pfad oder ein anderes Format rausging. Feuert ein Tag laut Tag Assistant ohne Request: [`../wissen/gtm.md`](../wissen/gtm.md).
- Neue Tests zuerst mit `TEMPO=schnell` stabil bekommen, dann im gewünschten Tempo laufen lassen.
- Testfehler (Locator, Timing) beheben. Website- oder Tracking-Fehler **nicht wegtesten**: Erwartungen nicht aufweichen, damit es grün wird, sondern melden.
- Tests mit festen Erwartungen mindestens dreimal hintereinander grün laufen lassen (`--repeat-each=3`). Baseline-Tests senden echte Requests: dort reichen zwei Läufe.
- Tracking vor Consent, obwohl niemand geklickt hat: zuerst prüfen, ob die CMP den Testbrowser als Bot behandelt ([`../wissen/cmp.md`](../wissen/cmp.md)).

## Abschlussbericht (Ende Phase 2)

Kurz und konkret:

1. Welche Tests es gibt und wie man sie startet.
2. Welche Erwartungen aus dem Auftrag stammen und welche Du aus dem Ist-Zustand übernommen hast (zur Bestätigung).
3. Baseline: bereit zum Ziehen (Angebot an den Menschen) bzw. angelegt, mit welchem Tempo, mit oder ohne Proxy, welche Werte als flüchtig markiert sind und warum.
4. Eigene Regeln für Requests über eigene Pfade oder Formate, falls nötig.
5. Auffälligkeiten im Tracking (mögliche Fehler der Website).
6. Was nicht abgedeckt ist und warum (iframe, Bot-Schutz, fehlende Testdaten).
7. Offene Fragen und noch fehlende Einträge in `.env`.
8. Was Du in `projekt.md` festgehalten hast, und Vorschläge für `docs/wissen/`, `docs/anleitung/`, `lib/` oder `werkzeuge/`, die allen Projekten helfen würden.
