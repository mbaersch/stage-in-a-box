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

## Dienstprofile

Was die Stage über einen Dienst wissen muss, steht als Profil in `lib/dienstprofile.ts`: Klick-ID (URL-Parameter, Ablage, Parameter im Request) und Conversion (Erkennung des Events, Felder für Wert, Währung, Transaktion, Artikel). Die Tabellen hier geben den Stand der zentralen Profile wieder.

**Nur Belegtes eintragen.** Ein Dienst bekommt ein zentrales Profil erst, wenn Parameter, Ablage und Felder an einer echten Website bestätigt sind. Bis dahin: Profil im Projekt (`stageOptionen.dienstProfile`), und die Suche nach den Werten zeigt in `durchgaengigkeit.json` bzw. `klick-ids.json`, in welchem Feld sie stehen. Sobald ein Profil sich bewährt hat, mit Tabelle hier und Profil in `lib/` übernehmen.

### Conversion-Werte

| Dienst | Event | Wert | Währung | Transaktion | Artikel |
|---|---|---|---|---|---|
| GA4 | `en` | `epn.value` (`ep.value`) | `cu` | `ep.transaction_id` | `pr1`, `pr2` … (`id…~nm…`) |
| Google Ads | `/pagead/conversion/…` mit `label` | `value` | `currency_code` | `oid` | – |
| Meta | `ev` (z. B. `Purchase`) | `cd[value]` | `cd[currency]` | – | `cd[content_ids]` |
| Microsoft Ads | Request mit `gv` | `gv` | `gc` | – | – |

### Klick-IDs

Gespeichert und gesendet gilt die Klick-ID, wenn der Wert in Cookie bzw. Request steckt oder die Ablage bzw. der Parameter aus dem Profil vorhanden ist (das Format ist Sache des Dienstes):

| Parameter | Dienst | Ablage | Parameter im Request |
|---|---|---|---|
| `gclid` | Google Ads (Conversion Linker) | Cookie `_gcl_aw` | `gclaw` |
| `gbraid` | Google Ads (Conversion Linker) | Cookie `_gcl_gb` | `gclgb` |
| `wbraid` | Google Ads | nicht belegt – nur Suche nach dem Wert | nicht belegt |
| `fbclid` | Meta | Cookie `_fbc` (`fb.1.<Zeit>.<fbclid>`) | `fbc` |
| `msclkid` | Microsoft Ads | Cookie `_uetmsclkid` | `msclkid` |

Noch ohne zentrales Profil, weil nicht an einer Website bestätigt: Floodlight (`dclid`), LinkedIn (`li_fat_id`), TikTok (`ttclid`), X (`twclid`), Pinterest (`epik`).

Gespeichert wird meist erst mit Consent. Fehlt die ID in der Conversion, ist das ein Befund: Conversion Linker fehlt, feuert zu spät oder ohne Consent, oder die Landungsseite leitet um und verliert den Parameter.

## Enhanced Conversions / gehashte Nutzerdaten

Aufzeichnung im Modus `full` mit Testdaten; prüfen, dass Requests die Daten nur gehasht enthalten. Parser für die Parameter der gängigen Dienste: `pii-lib/` im [Tracking Auditor](https://github.com/mbaersch/tracking-auditor). Gehashte Werte (`sha256_*`) bleiben bei gleichen Testdaten gleich und sind deshalb nicht flüchtig.
