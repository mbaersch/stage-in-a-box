# Wissen: Besonderheiten einzelner Dienste

Regeln für die Erkennung stehen in `STANDARD_DIENSTE` (`lib/stage.ts`), flüchtige Parameter sowie Timing- und Begleit-Requests in `lib/baseline.ts`. Hier steht, was man über einen Dienst wissen muss, um Tests und Befunde richtig einzuordnen.

## GA4

- `stage.tracking.erwarteGa4(en)` liefert alle Parameter eines Ereignisses (`en`, `gcs`, `ep.*`, `epn.*`, `pr1` …); mehrere Ereignisse in einem Request (Batching im Body) sind aufgelöst.
- `gcs`: `G100` = kein Consent, `G111` = voller Consent.
- `user_engagement` geht beim Verlassen einer Seite raus (Beacon bei `pagehide`), seine Anzahl hängt an der Verweildauer und am Tempo: im Baseline-Vergleich „(Timing)“. Ohne Proxy sieht Playwright diese Beacons nicht.

## Google Ads

- Conversions erzeugen Weiterleitungsketten, die nur mit echten Antworten entstehen (Modus `durchlassen`).
- Requests über `ccm` und `1p-conversion` (Cookie-Abgleich, Kopien) kommen mal und mal nicht: im Baseline-Vergleich „(Begleit)“.

## Meta

- **CSP-Sonderfall:** Große Events (z. B. Purchase mit vielen Produkten) sendet das Pixel nicht per Beacon, sondern als Formular-POST in ein iframe. Eine CSP ohne passende `form-action`/`frame-src` blockiert genau diese Events. Bei CSP-Tests mit Meta deshalb die Purchase-Events prüfen, nicht nur PageView.

## Microsoft Ads

- Sendet bei `pagehide`; ohne Proxy wie GA4 `user_engagement` nur über das NetLog sichtbar.

## Matomo / Piwik PRO

- Heartbeats (`ping`) hängen an der Verweildauer: im Baseline-Vergleich „(Timing)“.

## Clarity und andere Sitzungsaufzeichnungen

- Uploads mit schwankender Anzahl: im Baseline-Vergleich „(Begleit)“ oder als Rauschen mit `nichtProtokollieren: true`.

## Enhanced Conversions / gehashte Nutzerdaten

Aufzeichnung im Modus `full` mit Testdaten; prüfen, dass Requests die Daten nur gehasht enthalten. Parser für die Parameter der gängigen Dienste: `pii-lib/` im [Tracking Auditor](https://github.com/mbaersch/tracking-auditor). Gehashte Werte (`sha256_*`) bleiben bei gleichen Testdaten gleich und sind deshalb nicht flüchtig.
