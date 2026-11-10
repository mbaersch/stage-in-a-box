# Phase 3: Baseline ziehen und abgleichen

Die Baseline ist der nächste Schritt, sobald die festen Erwartungen bis vor die Conversion stabil sind und ein vollständiger Lauf grün ist. Den Baseline-Test baust Du in Phase 2 gleich mit. Gezogen wird sie nach Rückfrage, weil sie echte Requests und Conversions sendet; einen Test einzeln startest Du mit `-g "Baseline"`.

```ts
test.describe('Baseline', () => {
  test.use({ stageOptionen: { trackingModus: 'durchlassen' } });

  test('Kauf entspricht der Baseline', async ({ page, stage }) => {
    await journey(page, stage);
    await stage.vergleicheMitBaseline('Kauf', { fluechtigeKeys: ['cart_id'] });
  });
});
```

## Regeln

- **Immer Modus `durchlassen`.** Abgefangene Requests bekommen keine echte Antwort: Weiterleitungsketten (z. B. Google-Ads-Conversions) und von einem sGTM ausgelöste Folge-Requests fehlen dann. `vergleicheMitBaseline` bricht in anderen Modi ab.
- **Mit oder ohne Proxy** wie im Auftrag; mit Proxy entsteht eine eigene Datei `baselines/<journey>.proxy.json`.
- **Gleiches Tempo** für Baseline und Vergleich; sonst bricht der Vergleich ab. Welches Tempo, steht im Auftrag oder wird mit dem Menschen geklärt (`aufzeichnung` kommt echtem Verhalten am nächsten, dauert aber so lange wie die Aufzeichnung).
- Vor der Momentaufnahme verlässt `vergleicheMitBaseline` die letzte Seite, damit Requests beim Verlassen (z. B. `user_engagement`) enthalten sind. Ohne Proxy sieht Playwright solche Beacons nicht; die Stage holt sie aus dem NetLog des Browsers (Quelle `netlog`, ohne Body). Mit Proxy kommen sie vollständig (Quelle `proxy`).
- Der erste Lauf speichert `baselines/<journey>.json` im Projektordner, jeder weitere vergleicht dagegen. Der Bericht steht als `baseline-vergleich.md` im Report und in `test-results/`.
- Bei echten Käufen nur mit Testkonto bzw. Testprodukt laut Auftrag.

## Bewertung

- **Rot** (Test schlägt fehl): neuer Dienst, der in der Baseline nicht vorkam; Request fehlt, ist mehrfach da, blockiert oder gescheitert; Consent-Parameter (`gcs`, `gcd`, `npa`, `dma`) geändert; dataLayer-Event fehlt oder ist mehrfach da; Key fehlt, der vorher da war; jede Abweichung in `ecommerce`; Consent-Befehle geändert; neuer CSP-Verstoß (einer, der schon in der Baseline steht, etwa durch die CSP der Website selbst, ist nur ein Hinweis); mit `pruefungen.cookies` ein neues Cookie vor der Consent-Entscheidung.
- **Prüfungen mitlaufen lassen:** Steht im Auftrag unter „Prüfungen“ etwas, gehört `pruefungen` auch in die `stageOptionen` des Baseline-Tests (siehe [`varianten.md`](varianten.md)).
- **Info** (nur Bericht): neue Requests bekannter Dienste, neue Parameter; geänderte Parameterwerte; neue Events oder Keys außerhalb von `ecommerce`; geänderte Reihenfolge.
- **Neu im Netzwerk** (eigener Abschnitt): neue Domains und Requests ohne Regel. Immer prüfen, ob dahinter Tracking steckt; wenn ja, Regel anlegen (bei bekannten Diensten in `STANDARD_DIENSTE`), damit es abgefangen und als Dienst verglichen wird.
- Werte, die sich bei jedem Lauf ändern (aus dem Auftrag oder beim zweiten Lauf als „geändert“ sichtbar), als `fluechtigeKeys` bzw. `fluechtigeParameter` angeben. Gängige sind schon in `lib/baseline.ts` hinterlegt.

## Nach dem Ziehen abgleichen

Den Baseline-Test sofort ein zweites Mal laufen lassen und `baseline-vergleich.md` durchgehen. Ziel: kein Rot und nur Hinweise, die sich erklären lassen. Jede Abweichung einordnen:

- **Flüchtiger Wert** (Zufall, Zeit, Sitzung, Client-ID): dienstübergreifend bekannte Parameter in `FLUECHTIGE_PARAMETER` bzw. `FLUECHTIGE_MUSTER` in `lib/baseline.ts`, nur hier vorkommende als `fluechtigeKeys`/`fluechtigeParameter` im Test.
- **Timing-abhängig** (GA4 `user_engagement`, Heartbeats wie `ping` bei Matomo/Piwik PRO): Anzahl hängt an der Verweildauer und wird immer so eingestuft (`istTimingAbhaengig` in `lib/baseline.ts`, im Bericht „(Timing)“). Weitere solche Requests dort ergänzen.
- **Begleit-Request** mit schwankender Anzahl (Cookie-Abgleich, Kopien, Weiterleitungs-Hops, Uploads von Sitzungsaufzeichnungen): Muster für host + pfad in `BEGLEIT_PFADE`, im Bericht „(Begleit)“.
- Bei beiden ist eine abweichende Anzahl nur ein Hinweis; Consent-Parameter bleiben rot.
- **Rauschen ohne Aussage** (Sitzungsaufzeichnung, eigene Statistik der Website mit Zeitstempel im Parameter): Regel mit `nichtProtokollieren: true` – wird weiter gesteuert, aber nicht verglichen.
- **Echte Unsicherheit** (Tag feuert mal, mal nicht): nicht wegfiltern, sondern melden; oft ein Timing-Problem der Website oder ein zu schnelles Tempo.
- **Event, das die Website nicht zuverlässig sendet** (z. B. ein Bot-Schutz, der nur in manchen Läufen lädt): nach Rücksprache mit dem Menschen in `optionaleEvents` eintragen. Fehlen, Mehrfach und geänderter Inhalt sind dann nur Hinweise mit „(optional)“; im Bericht nennen.

Neue dienstübergreifende Erkenntnisse (flüchtige Parameter, Begleit- oder Timing-Requests eines Dienstes) gehören in `lib/baseline.ts` und als Fakt nach [`../wissen/dienste.md`](../wissen/dienste.md).

Ändert sich dabei die Vergleichslogik oder was protokolliert wird, die Baseline neu ziehen (`npm run baseline:neu -- projects/<name> -g "Baseline"`) und erneut abgleichen. Die Logik lässt sich auch ohne neuen Lauf prüfen: Jeder Vergleichslauf legt seine Momentaufnahme als `momentaufnahme.json` in `test-results/<test>/` ab, `vergleiche()` aus `lib/baseline.ts` nimmt sie zusammen mit der Baseline-Datei.

Erst wenn der Abgleich sauber ist, gilt die Baseline als fertig. Im Bericht nennen, was als flüchtig, Begleit-Request oder Rauschen eingestuft wurde.

## Abnahme (optional)
Am Ende des Berichts die Abnahme anbieten: `npm run abnahme -- projects/<name>/tests/<auftrag>` spielt die Baseline-Tests im sichtbaren Browser mit offenen DevTools ab (ohne `-g`: alle Tests mit „Baseline“ im Namen). Die Stage schreibt dataLayer-Events und Tracking-Requests lesbar in die Konsole der Seite, ins Terminal und als `abnahme.log` an den Test (`lib/abnahme.ts`, aktiv mit `STAGE_ABNAHME`). Der Vergleich läuft wie immer mit, Requests gehen echt raus. Der Browser startet mit eigenem Profil: Konsole vorne, Filter `stage`, Keep log an (`DEVTOOLS_EINSTELLUNGEN`). Ein Banner oben im Viewport zeigt den laufenden `test.step` (die Tests brauchen dafür nichts), während `stage.denkpause` einen Countdown bis zur nächsten Aktion und die Zahl der dataLayer-Events und Hits; echte Klicks bekommen einen Kreis am Klickpunkt. Am Ende wartet sie, bis der Mensch den Browser schließt. Auf Wunsch startest Du sie im Hintergrund; der Browser erscheint beim Menschen.

**Baseline nie neu erzeugen, um einen roten Test grün zu machen.** `npm run baseline:neu -- projects/<name>` nur auf ausdrücklichen Wunsch des Menschen.
