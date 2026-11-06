# Stage in a Box

**Tracking-Tests für Websites, ohne eigene Testumgebung und ohne selbst Tests zu programmieren: Du zeichnest einen Ablauf einmal auf, ein Coding-Agent baut daraus eine Testsuite.**

CMP, Consent Mode, GTM, serverseitiges Tagging, CSP – moderne Tracking-Setups bestehen aus vielen Teilen, die sauber zusammenspielen müssen. Nach jedem Deployment, jeder CMP-Änderung oder jedem neuen Tag per Hand durch den Kaufprozess zu klicken, reicht dafür nicht mehr. Automatisierte Tests scheitern bisher meist daran, dass sie jemand schreiben muss, der sowohl Tracking als auch Testautomatisierung versteht.

Dieses Repo verkürzt den Weg: Ein GTM-Tag zeichnet beim Durchklicken alles auf, was ein Agent für den Nachbau braucht. Ein Analyse-Script macht daraus eine lesbare Zeitleiste und einen Auftragsentwurf. Eine Vorlage liefert die fertige Testumgebung, eine Anleitung sagt dem Agent, wie aus allem Tests werden.

## Was Du davon hast

Ist die Journey einmal als Test angelegt, wird sie zur **Stage in a Box**. Du kannst sie unter beliebigen Bedingungen laufen lassen:

- **Gegen eine Baseline vergleichen:** Der erste Lauf speichert den Ist-Zustand – dataLayer, Consent, alle Requests an Tracking-Dienste inklusive Weiterleitungen. Jeder weitere Lauf meldet Abweichungen, etwa nach einem Deployment.
- **Requests prüfen, ohne dass sie gesendet werden.** Requests an GA4, Google Ads, Meta & Co. werden abgefangen und protokolliert. Das funktioniert auch auf Live-Seiten ohne Staging.
- **Dienste gezielt blockieren**, wie es ein Adblocker täte, und prüfen, ob Seite und Conversion-Tracking trotzdem funktionieren.
- **Consent-Varianten durchspielen**, ohne die CMP umzukonfigurieren.
- **Ladereihenfolgen simulieren**, etwa GTM oder CMP verzögert, um Race Conditions aufzudecken.
- **Eine geplante CSP testen**, bevor sie live geht, inklusive der Frage, ob sie im Kaufabschluss Tracking blockiert.
- **Im Tempo eines Menschen** oder exakt im Tempo der Aufzeichnung, damit auch zeitabhängige Requests wie `user_engagement` entstehen.

## So läuft es ab

```
 1. Recorder-Tag im GTM anlegen         (einmalig, 5 Minuten)
 2. Journey im Preview durchklicken      → Tag-Assistant-Export
 3. Agent: Analyse und Auftragsentwurf   → auftrag.md, Liste für .env
 4. Du: Auftrag prüfen, .env ausfüllen   → Status „bestätigt“
 5. Agent: Tests und Baseline bauen      → Testsuite
 6. Tests laufen lassen                  (jederzeit, mit Varianten)
```

Dein Beitrag ist die Aufzeichnung, ein prüfender Blick auf den Auftrag und das Eintragen der Testdaten. Den Rest erledigt der Agent.

## Voraussetzungen

- Zugriff auf den GTM-Container der Website (Preview reicht; ohne GTM siehe [Ohne GTM](#ohne-gtm))
- [Node.js](https://nodejs.org/) ab Version 20.12
- Ein Coding-Agent, z. B. [Claude Code](https://claude.com/claude-code)

## 1. Recorder-Tag einrichten

1. Im GTM unter *Variablen → Integrierte Variablen konfigurieren* die Variable **Debug Mode** aktivieren.
2. Neues Tag vom Typ **Benutzerdefiniertes HTML** anlegen und den Inhalt von [`dist/gtm-recorder-tag.html`](dist/gtm-recorder-tag.html) einfügen.
3. Trigger: **Consent Initialization – All Pages**.
4. Speichern, **nicht veröffentlichen.** Das Tag wird nur im Preview gebraucht. Würde es versehentlich veröffentlicht, macht es außerhalb des Previews nichts.

Optional im Tag oben einstellen:

- `values: 'masked'` (Vorgabe): Eingaben in Formularen werden nur mit Format und Länge aufgezeichnet, z. B. `Xxx.Xxxxxxxxxx@xxxxxxx.xx`.
- `values: 'full'`: Eingaben im Klartext. Nötig, wenn Hashing oder Enhanced Conversions geprüft werden sollen. Dann nur mit Testdaten aufzeichnen.

Passwörter und Kartendaten werden in beiden Modi nie aufgezeichnet.

Das Tag schreibt seine Einträge als Messages ohne Event in den dataLayer. Der Tag Assistant zeigt sie als „Nachricht“. Für GTM selbst sind sie unsichtbar: Es werden keine Trigger ausgewertet, und kein vorhandenes Tag kann dadurch auslösen.

## 2. Journey aufzeichnen

1. **Frisch starten:** Cookies und Website-Daten der Seite löschen oder ein neues Inkognito-Fenster verwenden, damit der Consent-Banner erscheint.
2. **Preview starten** und die Website im Tag Assistant öffnen.
3. **Den Ablauf einmal vollständig durchklicken**, inklusive Consent-Banner, so wie ein normaler Besucher. Ohne Umwege, ohne Neuladen, ohne parallele Tabs. Dein Tempo wird mit aufgezeichnet und kann später nachgespielt werden.
4. Bei einem Kauf: nur mit Testkonto, Testprodukt, Gutschein oder Testzahlart, und nur wenn das abgesprochen ist.
5. Im Tag Assistant die Aufzeichnung **exportieren**.

Tipp: Lieber mehrere kurze Aufzeichnungen (z. B. „Consent akzeptieren + Kauf“ und „Consent ablehnen + Kauf“) als eine lange mit allem.

## 3. Testprojekt anlegen und Analyse starten

```sh
cp -r vorlage mein-shop-tests
cd mein-shop-tests
cp .env.example .env
npm install
npx playwright install chromium
```

Export nach `aufzeichnungen/` legen und den Agent im Projektordner starten, zum Beispiel mit:

> Lies AGENTS.md. Analysiere die Aufzeichnung in aufzeichnungen/ und fülle den Auftrag vor.

Der Agent ruft dafür `npm run analyse -- aufzeichnungen/<datei>` auf. Das Script erzeugt neben dem Export eine Zeitleiste (`.zeitleiste.md`) mit allem, was passiert ist: Aktionen, Events, Consent, gefeuerte Tags, Google-Requests, Auffälligkeiten und bereits fertige Playwright-Schritte. Du kannst die Zeitleiste auch selbst lesen; sie ist oft schon für sich ein guter Überblick über ein Setup.

## 4. Auftrag prüfen und `.env` ausfüllen

Der Agent füllt [`auftrag.md`](vorlage/auftrag.md) vor und markiert alles Abgeleitete mit *(aus Aufzeichnung)*. Du prüfst:

- Stimmt die **Conversion-Aktion**? Was muss passieren, was darf auf keinen Fall passieren?
- Gibt es ein **Testkonto**, dessen Bestellungen automatisch storniert werden? Ist ein echter Kauf erlaubt?
- Soll eine **Baseline** angelegt werden, und in welchem **Tempo**?
- Welche **Varianten** willst Du (Consent abgelehnt, Dienst blockiert, CSP …)?

Dann setzt Du oben den Status auf **bestätigt**.

**`.env` füllst nur Du aus.** Der Agent schreibt sie nie und gibt ihre Werte nicht aus. Er trägt die nötigen Variablennamen in `.env.example` ein (z. B. `TEST_LOGIN_EMAIL`, `TEST_LOGIN_PASSWORT`, `TEST_VORNAME`) und sagt Dir, was fehlt. Die Tests lesen die Werte zur Laufzeit.

## 5. Tests bauen lassen

> Der Auftrag ist bestätigt. Baue die Tests.

Der Agent baut die Tests, legt bei Bedarf die Baseline an und schließt mit einem Bericht: welche Tests es gibt, welche Erwartungen er aus dem Ist-Zustand übernommen hat (zur Bestätigung), Auffälligkeiten und offene Punkte.

Die Anweisungen für den Agent stehen in [`vorlage/AGENTS.md`](vorlage/AGENTS.md). Claude Code liest sie über `CLAUDE.md` automatisch ein, andere Agents über `AGENTS.md`.

## 6. Tests ausführen

```sh
npm test                                  # alle Tests, unsichtbar
npm run test:sichtbar                     # mit sichtbarem Browser
npm run report                            # HTML-Report öffnen
npm run baseline:neu                      # Baselines bewusst neu erstellen
TEMPO=aufzeichnung npm test               # im Tempo der Aufzeichnung
```

Unter Windows oder dauerhaft: `TEMPO` und `TRACKING_MODUS` in `.env` setzen.

Der Report enthält zu jedem Test den kompletten dataLayer, alle Tracking-Requests, die angefragten Hosts und ggf. CSP-Verstöße als Anhang. So lässt sich auch ohne erneutes Durchklicken nachvollziehen, was passiert ist.

### Baseline

Baseline-Tests laufen immer mit **echten Requests**. Nur dann entstehen Weiterleitungsketten (z. B. bei Google-Ads-Conversions) und Folge-Requests, die ein Server-Container auslöst. Plane deshalb ein, wie Testtraffic erkannt oder gefiltert wird (Testkonto, IP-Filter o. Ä.).

Der erste Lauf speichert `baselines/<journey>.json`. Jeder weitere vergleicht dagegen und legt einen Bericht `baseline-vergleich.md` in den Report.

| Rot – Test schlägt fehl | Nur Hinweis im Bericht |
|---|---|
| Request fehlt, ist mehrfach da, wurde blockiert oder scheiterte | neue Requests, neue Hosts |
| Consent-Parameter geändert (`gcs`, `gcd`, `npa`, `dma`) | neue oder geänderte Request-Parameter |
| dataLayer-Event fehlt oder ist mehrfach da | neue Events, neue Keys |
| Key fehlt, der in der Baseline vorhanden war | geänderte Werte außerhalb von `ecommerce` |
| jede Abweichung in `ecommerce` (z. B. `item_id`, `item_category`) | geänderte Reihenfolge der Events |
| Consent-Befehle geändert, CSP-Verstoß | |

Werte, die sich bei jedem Lauf ändern (Transaktions-IDs, Session-IDs, Zeitstempel), werden nur auf Vorhandensein geprüft. Gängige sind hinterlegt, weitere trägt der Agent ein.

Baseline und Vergleich laufen immer im selben **Tempo**. Am Ende verlässt der Test die letzte Seite, damit auch Requests beim Verlassen in der Baseline stehen.

### Tempo

| `TEMPO` | Verhalten |
|---|---|
| `schnell` (Vorgabe) | keine Pausen – für die Entwicklung und schnelle Prüfungen |
| `mittel` | 1,5 s zwischen den Schritten, leicht verlangsamte Aktionen |
| `langsam` | 4 s zwischen den Schritten, deutlich verlangsamte Aktionen |
| `aufzeichnung` | Pausen genau wie in der Aufzeichnung (höchstens 60 s pro Schritt) |

Manche Requests hängen von der Verweildauer ab, etwa GA4 `user_engagement`, Timer- oder Scroll-Trigger. Im Tempo `schnell` fehlen sie oder sehen anders aus.

### Ausprobieren ohne eigene Website

Die Vorlage bringt eine kleine Demo-Seite mit Consent-Banner, Seitenwechsel, Conversion-Button und einem simulierten Server-Container mit. Ohne `BASE_URL` laufen die Beispieltests dagegen:

```sh
cd vorlage && npm install && npx playwright install chromium && npm test
```

Für eine erste echte Aufzeichnung eignet sich [atomkraftwerke24.de](https://atomkraftwerke24.de/), ein WooCommerce-Demoshop, in dem Bestellungen nicht ausgeführt werden.

## Ohne GTM

[`dist/recorder.js`](dist/recorder.js) ist dieselbe Aufzeichnung als eigenständiges Script. Es kann per DevTools *Local Overrides*, als Snippet oder über eine Browser-Extension eingebunden werden, die Scripts in Seiten einspielt. Es schreibt jeden Eintrag zusätzlich in die Konsole. Mit aktiviertem *Preserve log* bleibt die Aufzeichnung über Seitenwechsel erhalten und lässt sich als Datei speichern. Das Analyse-Script liest auch diesen Mitschnitt; Events, Tags und Requests fehlen dann aber.

## Grenzen

- **Inhalte in fremden iframes** (Zahlungsfelder, manche Consent-Banner) kann der Recorder nicht sehen. Der Agent muss diese Schritte anders lösen oder fragt nach.
- **Requests anderer Dienste als Google** stehen nicht im Tag-Assistant-Export, nur dass ihr Tag gefeuert hat. In den Tests werden sie trotzdem vollständig erfasst.
- **Beacons beim Verlassen einer Seite** (z. B. `user_engagement`) laufen in Chromium am Abfangen vorbei. Im Modus „abfangen“ werden sie deshalb echt gesendet. Die Tests erkennen das und markieren sie als „entwischt“.
- **Hover-Menüs**, die sich nur bei Mouseover öffnen, werden nicht aufgezeichnet.
- **Bot-Schutz, Captchas und 3-D-Secure** können automatisierte Abläufe stoppen.
- **Serverseitiges Tagging:** Geprüft wird, was der Browser an den Server-Container schickt und was dieser im Browser auslöst, nicht was er serverseitig weitersendet.

## Datenschutz

- Im Modus `full` enthält der Export echte Eingaben. Nur mit Testdaten aufzeichnen.
- `aufzeichnungen/` und `.env` sind in der Vorlage von Git ausgeschlossen. Baselines werden eingecheckt; sie enthalten Request-Parameter und damit ggf. gehashte Testdaten.
- Tests mit festen Erwartungen senden keine Tracking-Daten (bis auf die oben genannten Beacons). Baseline-Tests senden echte Requests.

## Aufbau

```
dist/
  gtm-recorder-tag.html   Inhalt für das GTM-Tag
  recorder.js             eigenständige Variante (ohne GTM)
src/
  recorder-core.js        Quellcode des Recorders (hier ändern, dann build.sh)
vorlage/                  Testprojekt zum Kopieren
  AGENTS.md               Anweisungen für den Agent
  CLAUDE.md               bindet AGENTS.md für Claude Code ein
  auftrag.md              Auftrag (vom Agent vorausgefüllt, von Dir bestätigt)
  aufzeichnungen/         Ablage für Exporte und Analysen
  werkzeuge/              Analyse-Script für Aufzeichnungen
  lib/                    die Testumgebung: stage, baseline, tempo, netlog
  tests/                  Tests; enthält ein Beispiel gegen die Demo-Seite
  baselines/              gespeicherte Baselines (Beispiel: Demo-Seite)
  demo/                   Demo-Seite für das Beispiel
  docs/                   Aufzeichnungsformat
test/                     Smoke-Test für den Recorder
```

## Verwandtes Projekt

[Tracking Auditor](https://github.com/mbaersch/tracking-auditor) – automatisierte Audits von Tracking-Setups in verschiedenen Consent-Zuständen. Dessen CMP-Bibliothek (Selektoren für über 120 Consent-Banner) und Dienste-Datenbank nutzt der Agent in schwierigen Fällen.

## Entwicklung

```sh
sh build.sh                 # dist/ aus src/recorder-core.js erzeugen
python3 test/run_test.py    # Smoke-Test des Recorders (Python, Playwright)
cd vorlage && npm test      # Beispieltests der Vorlage gegen die Demo-Seite
```

Eigene Testprojekte am besten außerhalb dieses Repos anlegen. Liegen sie doch darin, verhindert die `.gitignore` im Hauptverzeichnis, dass sie eingecheckt werden: Sie lässt nur die bekannten Ordner und Dateien zu. So gelangen keine Aufzeichnungen oder Baselines aus eigenen Tests ins öffentliche Repo.

## Lizenz

[MIT](LICENSE) – Nutzung, Änderung und Weitergabe frei, auch kommerziell. Bedingung ist nur, dass der Lizenzhinweis erhalten bleibt.
