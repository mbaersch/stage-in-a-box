# Phase 1: Aufzeichnung analysieren und Auftrag vorausfüllen

Ergebnis: vorausgefüllte `auftrag.md`, ergänzte `.env.example`, Rückfrage an den Menschen. **In Phase 1 keine Tests schreiben.**

## Aufzeichnung auswerten

```sh
npm run analyse -- projects/<name>/aufzeichnungen/<datei>
```

Das Script erzeugt neben dem Export:

- `<datei>.zeitleiste.md` – **Deine Hauptquelle.** Vorschlag für den Auftrag (Startadresse, Seiten, vermutete Conversion, Events, Google-Requests, flüchtige Werte, Testdaten-Felder mit Variablennamen, Auffälligkeiten), Tags pro Event, vorgeschlagene Playwright-Schritte mit aufgezeichneten Pausen und die Zeitleiste pro Seite.
- `<datei>.analyse.json` – dieselben Daten strukturiert, falls Du Details brauchst (z. B. alle Parameter eines Google-Requests).

Den Roh-Export (oft über 100 MB) nicht in den Kontext laden. Nur wenn das Script scheitert: Struktur mit einem kurzen Script untersuchen (`data.containers[].messages`, `tagsFired`, `pageSummaries`, `hitInfo`) und den Fehler im Bericht nennen.

Was der Export enthält und was nicht: [`../wissen/tag-assistant-export.md`](../wissen/tag-assistant-export.md).

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

Vollständige Beschreibung: [`../aufzeichnungsformat.md`](../aufzeichnungsformat.md).

## Auftrag vorausfüllen

- Fülle in `auftrag.md` alle Felder, die sich aus der Zeitleiste ableiten lassen: Startadresse, Ablauf in Worten, vermutete Conversion, Events mit wichtigen Werten, Tags pro Aktion, Felder mit Testdaten, sich ändernde Werte. Übernimm die Auffälligkeiten unter „Hinweise“.
- Markiere alles Abgeleitete mit *(aus Aufzeichnung)*. Was der Mensch schon eingetragen hat, bleibt unverändert; Widersprüche zur Aufzeichnung notierst Du unter „Hinweise“.
- Fehlt etwas, das sich nicht ableiten lässt (echte Bestellung erlaubt? Baseline gewünscht?), lass das Feld leer.
- Ergänze `.env.example` um die nötigen Variablen (Login, Formularfelder mit `[redacted]` oder maskierten Werten).
- **Consent-Banner ohne Recorder-Klick** (die Zeitleiste nennt das unter „Auffälligkeiten“): Steht im Auftrag unter „Consent-Banner“ nichts, danach fragen. Hintergrund: [`../wissen/cmp.md`](../wissen/cmp.md).

## Eingaben aus der Aufzeichnung übernehmen

Steht in der Zeitleiste `Werte-Modus des Recorders: full`, enthält die Aufzeichnung die echten Eingaben des Testlaufs. Der Mensch kann sie direkt als Testdaten verwenden, statt sie in `.env` abzutippen:

- Steht im Auftrag unter „Eingaben aus der Aufzeichnung übernehmen?“ **ja**, rufe `npm run analyse -- projects/<name>/aufzeichnungen/<datei> --testdaten` auf.
- Ist das Feld leer, biete es in der Rückfrage an und führe es erst nach Zustimmung aus.
- Das Script schreibt `testdaten.aufzeichnung.env` und nennt nur Variablennamen: welche übernommen wurden und welche trotzdem in `.env` fehlen (Passwörter zeichnet der Recorder nie auf).
- Bei maskierten Aufzeichnungen nicht anbieten; das Script bricht dann ohnehin ab.

## Rückfrage

Beende Phase 1 mit einer kurzen Nachricht: was Du vorausgefüllt hast, welche Felder offen sind, welche Variablen in `.env` gebraucht werden (abzüglich der aus der Aufzeichnung übernommenen). Bitte darum, den Auftrag zu prüfen und den Status auf **bestätigt** zu setzen.
