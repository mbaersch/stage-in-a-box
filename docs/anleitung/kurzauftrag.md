# Kurzauftrag: Tests aus wenigen Angaben und einem Erkundungslauf

Der schnellste Einstieg in Tracking-Tests, ohne Aufzeichnung und ohne Trigger-Katalog. Der Mensch nennt im Chat nur das Nötigste, den Rest misst ein Erkundungslauf. Die Tests sind danach sofort da und werden später ausgebaut (Aufzeichnung, weitere Szenarien, mehr Erwartungen). Typischer Anlass: ein Umbau, der durch eine Baseline abgesichert werden soll.

## 1. Angaben aufnehmen

Aus dem Chat in `auftrag.md` übernehmen (Projekt vorher mit `npm run neu -- <name>` anlegen), **Art: Kurzauftrag**:

| Angabe | Beispiele | Wenn sie fehlt |
|---|---|---|
| Consent | Selektoren für Zustimmen und Ablehnen, oder nur der Name der CMP | nachfragen |
| Einstieg und Weg | „Einstieg auf Seite A, dann zur Danke-Seite B“; Klicks oder Formulare dazwischen | nachfragen |
| Conversion-Aktion | Selektor, oder der Text des Buttons („Jetzt anfragen“) | Weg endet auf der letzten Seite |
| Wünsche | „Tests zu Klick-IDs und CAPI-Event-IDs“, Vorschau-Link für den Umbau | aus der Messung vorschlagen |

- **Nur die CMP genannt:** Selektoren aus der CMP-Bibliothek des Tracking Auditors nehmen (`accept`, `reject`, ggf. `rejectSteps`, `shadowDom`), siehe [`../wissen/cmp.md`](../wissen/cmp.md). Im Erkundungslauf prüfen, ob sie auf dieser Website greifen.
- **Button per Text:** `page.getByRole('button', { name: 'Jetzt anfragen' })` bzw. `getByRole('link', …)`; ist der Text nicht eindeutig, auf den sichtbaren Bereich eingrenzen (`page.locator('main').getByRole(…)`) und im Bericht nennen.
- Zugangsdaten, Testdaten und `BASE_URL` gehören wie immer in `.env`, die der Mensch füllt.

## 2. Erkundungslauf

**Oder selbst durchgehen:** Will der Mensch den Weg lieber einmal selbst gehen, statt ihn zu beschreiben, startet er eine Aufnahme-Sitzung (`npm run aufnahme -- projects/<name>`, siehe [`aufzeichnung.md`](aufzeichnung.md)). Die Aufnahme ersetzt Angaben zum Weg und Erkundungslauf; weiter mit der Analyse der Aufnahme und Schritt 3. Requests gehen dabei echt raus.

Eine minimale Journey nach den Angaben (Tests bauen wie in [`tests-bauen.md`](tests-bauen.md), nur ohne feste Erwartungen), im Modus `abfangen`: Beim Erkunden geht nichts echt raus. Folge-Requests eines Server-Containers fehlen dabei; die kommen erst mit der Baseline.

Aus `tracking-treffer.json`, `hosts.json`, `weitere-requests.json` und `dataLayer.json` des Laufs festhalten:

- Dienste und Konten (Mess-IDs, Conversion-Labels, Pixel-IDs) je Schritt, Events und ihre wichtigsten Parameter
- Consent-Parameter vor und nach der Zustimmung (`gcs`, `gcd`), was vor der Entscheidung schon feuert
- Server-Container (GA4 an eine eigene Domain) ja oder nein; Pixel, die Event-IDs senden
- Requests an unbekannte Domains ohne Regel (eigene Pfade, Tunnel)

Greifen die Consent-Selektoren nicht oder hängt der Weg, das zuerst klären.

## 3. Auftrag aus der Messung

Den Auftrag mit dem Gemessenen füllen, markiert mit *(gemessen)*, und passend zur Messung vorschlagen:

| Gemessen | Vorschlag |
|---|---|
| Werbedienste mit Klick-IDs (Google Ads, Meta, Microsoft Ads …) | Bedingung „Landung über Anzeige“ mit deren Klick-IDs, je Klick-ID `stage.erwarteKlickId` |
| Server-Container und Pixel mit Event-ID | Prüfung `deduplizierung`; Dienste nur mit Pixel als `ausnahmen` |
| GA4 auf eigener Domain, aber kein sGTM (Google Tag Gateway) | `ga4Server: false`, nachfragen |
| Conversion mit Wert | Prüfung `durchgaengigkeit` |
| Zustimmen und Ablehnen bekannt | ein Test je Consent-Szenario; „ablehnen“ erwartet keine Marketing-Requests |

Wie die Bedingungen und Prüfungen aussehen: [`varianten.md`](varianten.md). Dann die Rückfrage: Auftrag zur Freigabe vorlegen, mit dem Gemessenen und den Vorschlägen. Erst nach **Status: bestätigt** weiter.

## 4. Baseline und A/A-Lauf

1. Baseline-Test bauen und ziehen wie in [`baseline.md`](baseline.md) (Modus `durchlassen`, echte Requests).
2. **A/A-Lauf:** sofort ein zweiter Lauf gegen das unveränderte Setup. Jede Abweichung ist hier Rauschen; einordnen wie unter „Nach dem Ziehen abgleichen“, bis kein Rot und nur erklärbare Hinweise bleiben.
3. Die freigegebenen Tests (Klick-IDs, Deduplizierung, Consent-Szenarien) ergänzen. Bedingungen und Prüfungen gehören in den Baseline-Test selbst, siehe [`container-umbau.md`](container-umbau.md), Schritt 3a.
4. Die ganze Suite noch einmal gegen die Baseline laufen lassen.

## 5. Umbau prüfen

Gibt es einen Vorschau-Link für den veränderten Stand: `GTM_VORSCHAU_LINK` in `.env`, dieselben Tests gegen die Vorschau, Abweichungen als erwartet oder unerwartet einordnen ([`container-umbau.md`](container-umbau.md), Schritte 5 und 6; Grenzen der Vorschau: [`gtm-vorschau.md`](gtm-vorschau.md)). Nach der Veröffentlichung dieselben Tests ohne Vorschau gegen live. Die Baseline erst danach und nur nach Freigabe neu ziehen.

## Bericht

- Was gemessen wurde und welche Vorschläge übernommen sind
- Ergebnis des A/A-Laufs: was als flüchtig, Begleit-Request oder Rauschen eingestuft wurde
- Was die Tests noch nicht abdecken und womit man sie ausbauen könnte (Aufzeichnung, weitere Wege, Varianten)
