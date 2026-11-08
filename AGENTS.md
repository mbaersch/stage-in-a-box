# Anweisungen für Agents

Die Umgebung („Stage in a Box“) in `lib/` verändert eine Website im Testbrowser (dataLayer, HTML, Skripte, Requests, CSP, GTM-Vorschau) und prüft das Tracking-Setup (dataLayer, Consent, Requests an Dienste). Scripts liegen in `werkzeuge/`. Deine Aufgabe ist die Übersetzung des Wunsches in Projektdateien – nicht der Bau neuer Infrastruktur.

Diese Datei enthält nur, was immer gilt, und den Wegweiser. Die Anleitungen zu den einzelnen Aufgaben liegen in `docs/anleitung/`, gesammeltes Wissen über CMPs, Dienste und Loader in `docs/wissen/`. Lies vor der Arbeit die Dateien, die zur Aufgabe gehören – nicht alle.

## Wegweiser

| Aufgabe | Lies |
|---|---|
| Website mit Anpassungen selbst bedienen lassen („in der Sitzung soll …“) | [`docs/anleitung/staging.md`](docs/anleitung/staging.md) |
| Aufzeichnung analysieren, Auftrag vorausfüllen (Phase 1) | [`docs/anleitung/aufzeichnung.md`](docs/anleitung/aufzeichnung.md) |
| Tests bauen und stabilisieren (Phase 2) | [`docs/anleitung/tests-bauen.md`](docs/anleitung/tests-bauen.md) |
| Baseline ziehen und abgleichen (Phase 3) | [`docs/anleitung/baseline.md`](docs/anleitung/baseline.md) |
| Varianten, Bedingungen, Prüfungen: Durchgängigkeit dataLayer → Dienste, Cookies, Dienste blockieren oder verzögern, CSP, Website anpassen, dataLayer ändern, Consent-Varianten, Proxy, Landung über Anzeige, wiederkehrender Besucher, Uhr, Netz, Gerät, Kennung, Zurück-Navigation | [`docs/anleitung/varianten.md`](docs/anleitung/varianten.md) |
| Tests oder Sitzung gegen eine GTM-Vorschau | [`docs/anleitung/gtm-vorschau.md`](docs/anleitung/gtm-vorschau.md) |
| Auftragsart Container-Umbau | [`docs/anleitung/container-umbau.md`](docs/anleitung/container-umbau.md) |

Wissen, bei Bedarf:

| Datei | Inhalt |
|---|---|
| [`docs/wissen/cmp.md`](docs/wissen/cmp.md) | Consent-Banner, die der Recorder nicht sieht, CMP-Bibliothek, Eigenheiten einzelner CMPs |
| [`docs/wissen/eigene-formate.md`](docs/wissen/eigene-formate.md) | Tracking über eigene Pfade und Formate (sGTM, Stape-Tunnel), Requests ohne Regel |
| [`docs/wissen/gtm.md`](docs/wissen/gtm.md) | GTM und Google-Tag: Debug Mode, Hüllen-Objekte, Tag feuert ohne Request, Google Tag Gateway |
| [`docs/wissen/dienste.md`](docs/wissen/dienste.md) | Besonderheiten einzelner Dienste (GA4, Google Ads, Meta, Enhanced Conversions) |
| [`docs/wissen/tag-assistant-export.md`](docs/wissen/tag-assistant-export.md) | Was ein Tag-Assistant-Export enthält und was nicht |
| [`docs/aufzeichnungsformat.md`](docs/aufzeichnungsformat.md) | Format der Recorder-Einträge (Referenz) |

## Zwei Arten von Arbeit

- **Staging im Browser:** Der Mensch will die Website mit Anpassungen selbst bedienen, z. B. um im GTM etwas vorzubauen, das die Website noch nicht kann. Keine Aufzeichnung, kein Auftrag, keine Phasen.
- **Tracking-Tests:** Du baust aus einer Aufzeichnung (oder für einen Container-Umbau) eine Playwright-Testsuite in drei Phasen. Zwischen Phase 1 und 2 bestätigt der Mensch den Auftrag.

| Phase | Ergebnis | Endet mit |
|---|---|---|
| 1. Analyse | vorausgefüllte `auftrag.md`, ergänzte `.env.example` | Rückfrage an den Menschen |
| 2. Bau | Tests, stabil bis vor die Conversion, dann ein vollständiger Lauf | Abschlussbericht mit Angebot, die Baseline zu ziehen |
| 3. Baseline | gespeicherter Ist-Zustand (zwei Läufe) | Bericht: flüchtige Werte, Ablage |

Steht in `auftrag.md` **Status: bestätigt**, beginne direkt mit Phase 2. Sonst mit Phase 1.

## Aufbau: gemeinsame Umgebung, ein Ordner pro Projekt

Die Session läuft immer im Hauptordner. Testumgebung, Abhängigkeiten (`node_modules`) und diese Anleitung gibt es nur einmal; jede Website ist ein Projekt unter `projects/<name>/`:

| Datei / Ordner | Inhalt |
|---|---|
| `projekt.md` | Anweisungen und Erkenntnisse nur für dieses Projekt – **vor jeder Arbeit am Projekt lesen**, gilt zusätzlich zu den Anleitungen |
| `auftrag.md` | Was der Mensch will: Journey, Conversion, Testkonto, Baseline, Varianten, Grenzen |
| `aufzeichnungen/` | Tag-Assistant-Exporte (`*.json`) oder Konsolen-Mitschnitte (`*.log`/`*.txt`, Zeilen `[rec] {...}`), daneben die Analysen |
| `tests/`, `baselines/` | Tests und gespeicherte Baselines des Projekts |
| `.env`, `.env.example` | Zugangsdaten und Testdaten (siehe unten) |
| `testdaten.aufzeichnung.env` | optional: Eingaben aus einer Aufzeichnung im Modus `full` |

- Neues Projekt: `npm run neu -- <name>` (kopiert `vorlage/`). Nicht von Hand aus einem anderen Projekt kopieren.
- Nennt der Mensch kein Projekt und gibt es mehrere, nachfragen.
- `projects/` ist nicht im Git des Repos. Nichts aus einem Projekt in Dateien außerhalb von `projects/` übernehmen (keine Domains, Selektoren, Testdaten).
- Pfade in den Anleitungen ohne `projects/<name>/` davor beziehen sich auf den Projektordner, wenn es dort so eine Datei gibt (`auftrag.md`, `tests/`, `.env` …), sonst auf den Hauptordner (`lib/`, `werkzeuge/`, `docs/`, `beispiel/`).

## Wissen festhalten

Damit das, was ein Projekt lehrt, beim nächsten zur Verfügung steht:

| Was | Wohin |
|---|---|
| Betrifft nur diese Website (CMP-Konfiguration, Selektoren, eigene Request-Formate, Bot-Schutz, Stolperstellen) | `projects/<name>/projekt.md` |
| Fakt über eine CMP, einen Dienst, einen Loader, GTM, ein Werkzeug – gilt für jede Website damit | `docs/wissen/` (passende Datei oder neue Datei, dann im Wegweiser eintragen); bei Diensten zusätzlich das Profil in `lib/dienstprofile.ts`, nur mit belegten Fakten |
| Ablauf oder Vorgehen bei einer Aufgabe | `docs/anleitung/` |
| Fehler oder fehlende Fähigkeit in Code | `lib/`, `werkzeuge/` |

Dienst-Wissen (Endpunkte, Request-Formate, Klick-IDs) teilt sich die Stage mit drei Schwesterprojekten. Wie sie abgeglichen werden und welches Projekt wofür Quelle ist: [`abgleich/README.md` im tracking-auditor](https://github.com/mbaersch/tracking-auditor/blob/master/abgleich/README.md). Nach Änderungen an `STANDARD_DIENSTE` oder `lib/dienstprofile.ts` dort `npm run abgleich` mit dem Pfad zu dieser Stage laufen lassen bzw. vorschlagen.

Änderungen außerhalb von `projects/` schlägst Du dem Menschen vor – allgemein formuliert, ohne Projektdaten (keine Domains, Konto-IDs, Selektoren, Testdaten).

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
- Basic Auth (Staging): `BASIC_AUTH_BENUTZER` und `BASIC_AUTH_PASSWORT` in `.env`, die Config setzt sie für alle Tests.

## Ausführen

Abhängigkeiten sind im Hauptordner einmal installiert (`npm install`, `npx playwright install chromium`); in Projektordnern nie `npm install` ausführen.

```sh
npm run pruefen                                     # TypeScript-Prüfung, alle Projekte
npm test -- projects/<name>                         # alle Tests des Projekts
npx playwright test projects/<name>/tests/kauf.spec.ts --headed   # eine Datei, sichtbar
npm run report -- projects/<name>/playwright-report
npm test                                            # ohne Projekt: das Beispiel
```

Das Projekt ergibt sich aus dem Pfad im Aufruf, alternativ aus `PROJEKT=<name>`. Report und `test-results/` liegen im Projektordner. Pfade immer mit `/`, auch unter Windows: Playwright liest sie als regulären Ausdruck.

## Gemeinsamer Code

- `lib/` gilt für alle Projekte. Nur ändern, wenn es nicht anders geht, im Bericht begründen und danach `npm test` (Beispiel) laufen lassen.
- Projektspezifisches (Regeln, Dekodier-Logik, Helfer) bleibt im Projektordner, z. B. `tests/hilfen.ts`.
- `beispiel/` nicht ändern. Es dient als Referenz und läuft bei `npm test` ohne Projekt.

## Grenzen und Sicherheit

- Echte Requests nur in Baseline-Tests und Sitzungen, Baseline nur, wenn der Auftrag eine will.
- Echte Käufe, Formular-Absendungen an echte Empfänger oder Kontoänderungen nur, wenn der Auftrag das ausdrücklich erlaubt (Testkonto, Testprodukt, Gutschein). Sonst den Test vor dem endgültigen Absenden beenden und nachfragen.
- Keine Zugangsdaten, Testadressen oder Exporte in Code, Berichten oder Commits.
- Bot-Schutz, Captchas, 3-D-Secure: nicht umgehen, sondern melden.
