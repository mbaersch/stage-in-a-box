# Auftrag

**Status:** Entwurf
<!-- Erst wenn hier „bestätigt“ steht, baut der Agent Tests. -->

> Du kannst diese Datei selbst ausfüllen oder den Agent bitten, sie aus der Aufzeichnung
> vorzufüllen. Vorausgefüllte Angaben sind mit *(aus Aufzeichnung)* markiert. Prüfe und
> korrigiere sie, dann setze den Status auf **bestätigt**.
>
> Zugangsdaten und Testdaten gehören **nicht** in diese Datei, sondern in `.env`.
> Die füllst nur Du aus; der Agent nennt Dir die nötigen Variablennamen. Eingaben aus einer
> Aufzeichnung im Modus `full` kann das Analyse-Script auf Wunsch in `testdaten.aufzeichnung.env`
> übernehmen; `.env` hat Vorrang.

**Art:** <!-- Journey (aus einer Aufzeichnung) / Container-Umbau (vorher – nachher, Abschnitt unten ausfüllen) / beides. Für reines Staging im Browser ist dieser Auftrag nicht nötig: siehe tests/sitzung.spec.ts -->

## Website

- **Startadresse:** <!-- z. B. https://www.example.de/ – kommt auch als BASE_URL in .env -->
- **Umgebung:** <!-- Live / Staging / lokal -->
- **Zugang nötig?** <!-- Basic Auth (BASIC_AUTH_BENUTZER / BASIC_AUTH_PASSWORT in .env), IP-Freigabe … -->
- **GTM-Vorschau nötig?** <!-- nein (Live-Container) / ja: Vorschau-Link aus GTM („Vorschau teilen“) als GTM_VORSCHAU_LINK in .env -->
- **Consent-Banner:** <!-- Name der CMP oder Selektoren für Zustimmen/Ablehnen, dazu nötige Schritte bis zum Banner (z. B. erst nach Scrollen sichtbar). Pflicht, wenn GTM erst nach der Zustimmung lädt: Dann fehlt der Banner-Klick in der Aufzeichnung. -->

## Journey

- **Aufzeichnung:** <!-- Dateiname in aufzeichnungen/, z. B. kauf-mit-consent.json -->
- **Ablauf in Worten:** <!-- z. B. Startseite → Consent akzeptieren → Kategorie → Produkt → In den Warenkorb → Kasse → Kauf -->
- **Conversion-Aktion:** <!-- Welcher Klick bzw. welches Event ist das Ziel? z. B. purchase nach Klick auf „Zahlungspflichtig bestellen“ -->
- **Wo soll der Test enden?** <!-- z. B. auf der Danke-Seite / vor dem Absenden der Bestellung -->

## Erwartungen

<!-- Was muss passieren? Unvollständig ist okay – Abweichungen vom Ist-Zustand fängt zusätzlich die Baseline. -->

- **Wichtige Events:** <!-- z. B. view_item, add_to_cart, purchase mit transaction_id, value, currency, items -->
- **Tags bzw. Dienste, die feuern sollen:** <!-- z. B. GA4, Google Ads Conversion, Meta – und nach welcher Aktion -->
- **Was darf nicht passieren?** <!-- z. B. keine Marketing-Requests vor Consent, keine Klartext-E-Mail in Requests -->
- **Werte, die sich bei jedem Lauf ändern:** <!-- z. B. Bestellnummer, Warenkorb-ID – werden nur auf Vorhandensein geprüft -->

## Testkonto und Testdaten

- **Login nötig?** <!-- ja / nein. Wenn ja: Zugangsdaten in .env (TEST_LOGIN_EMAIL, TEST_LOGIN_PASSWORT) -->
- **Testkonto, dessen Bestellungen automatisch storniert werden?** <!-- ja / nein -->
- **Formulardaten:** <!-- Welche Felder braucht die Journey (Adresse, Telefon …)? Werte in .env -->
- **Eingaben aus der Aufzeichnung übernehmen?** <!-- ja (nur bei Aufzeichnung im Modus full) / nein -->
- **Testprodukt / Gutschein / Testzahlart:** <!-- für echte Käufe nötig -->
- **Echte Bestellung erlaubt?** <!-- ja (nur mit Testkonto/Testprodukt) / nein (Test endet vor dem Absenden) -->

## Baseline

- **Baseline anlegen?** <!-- ja / nein. Baseline-Läufe senden echte Requests an alle Dienste. -->
- **Testtraffic erkennbar bzw. gefiltert?** <!-- z. B. Testkonto, IP-Filter, interner Traffic-Parameter -->
- **Mit Proxy?** <!-- ja (empfohlen: sieht auch Beacons beim Verlassen und Service Worker) / nein -->
- **Tempo:** <!-- schnell / mittel / langsam / aufzeichnung (Pausen wie aufgezeichnet). Baseline und Vergleich laufen immer im selben Tempo. -->

## Container-Umbau

<!-- Nur bei Art „Container-Umbau“: Der Ist-Zustand wird vor dem Umbau als Baseline gespeichert, danach wird verglichen. -->

- **Was wird umgebaut?** <!-- z. B. Google-Tags auf Destinations, CMP-Wechsel, Aufräumen; Workspace-Name bzw. -Nummer -->
- **Vorher:** <!-- Live-Container (Vorgabe) oder eine bestimmte Vorschau -->
- **Nachher:** <!-- Vorschau des Workspaces (Link als GTM_VORSCHAU_LINK in .env) und/oder nach der Veröffentlichung -->
- **Seiten:** <!-- Seiten mit eigenen Triggern, z. B. /en, /kontakt, /danke -->
- **Auslöser:** <!-- Klicks und Events, die Tags auslösen: tel, mailto, PDF, CTAs (Text oder Klasse), dataLayer-Events wie formSubmission. Leer lassen: der Agent leitet sie aus dem Container ab (Container-Export oder Tag Manager API) und fragt nach. -->
- **Consent-Szenarien:** <!-- z. B. alle ablehnen, alle akzeptieren, je Dienst einzeln -->
- **Erwartete Unterschiede:** <!-- was sich durch den Umbau ändern darf, z. B. „gtag/js entfällt“, „ccm/collect gebündelt“ -->

## Varianten

<!-- Ankreuzen bzw. ergänzen; nur was angekreuzt ist, wird gebaut. Varianten senden nichts (Modus „abfangen“). -->

- [ ] Consent abgelehnt
- [ ] Nur einzelne Dienste bzw. Kategorien zugelassen: <!-- Namen wie in der CMP, z. B. „Google Ads“, „Microsoft Advertising“ – je einer pro Lauf -->
- [ ] Widerruf auf der Seite: <!-- danach darf nichts mehr feuern; bleiben Cookies stehen? -->
- [ ] CMP nicht erreichbar (Skript blockiert): <!-- was soll dann passieren? -->
- [ ] Zustimmen und sofort weiter (Klick auf Link direkt nach dem Banner)
- [ ] Einzelne Dienste blockiert (Adblocker): <!-- welche? -->
- [ ] Geplante CSP testen: <!-- Policy einfügen oder Datei nennen -->
- [ ] Ladereihenfolge (z. B. GTM oder CMP verzögert): <!-- was genau? -->
- [ ] Andere CMP-Konfiguration simulieren: <!-- was soll anders sein? -->
- [ ] Hashing / Enhanced Conversions prüfen (Aufzeichnung im Modus `full` nötig)
- [ ] Sonstiges:

## Hinweise

<!-- Alles, was der Agent wissen sollte: bekannte Fehler, A/B-Tests, Bot-Schutz, besondere Wartezeiten … -->
