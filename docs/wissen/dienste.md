# Wissen: Besonderheiten einzelner Dienste

Regeln für die Erkennung stehen in `STANDARD_DIENSTE` (`lib/stage.ts`), flüchtige Parameter sowie Timing- und Begleit-Requests in `lib/baseline.ts`. Hier steht, was man über einen Dienst wissen muss, um Tests und Befunde richtig einzuordnen. Abgleich mit den Schwesterprojekten (Auditor, Extensions): [`abgleich/README.md`](https://github.com/mbaersch/tracking-auditor/blob/master/abgleich/README.md) im tracking-auditor.

## GA4

- `stage.tracking.erwarteGa4(en)` liefert alle Parameter eines Ereignisses (`en`, `gcs`, `ep.*`, `epn.*`, `pr1` …); mehrere Ereignisse in einem Request (Batching im Body) sind aufgelöst.
- `gcs`: `G100` = kein Consent, `G111` = voller Consent.
- UTM-Parameter speichert GA4 nicht im Browser; die Kampagne wird aus `dl` (und `dr`) des ersten Requests einer Sitzung ermittelt. Fehlen die UTMs dort, ist die Zuordnung verloren.
- **CSP:** Je nach Setup sendet GA4 an `region1.google-analytics.com` oder `region1.analytics.google.com` (dazu `/measurement/conversion` per fetch und Bild); eine Policy braucht beide Domains. `*.google.com` deckt `analytics.google.com` mit ab. Der Begleit-Request `stats.g.doubleclick.net/g/collect` hängt an `*.doubleclick.net`. Blockiert die CSP die Endpunkte, weicht gtag nicht auf einen anderen Weg aus (an einer Website geprüft).
- Mit Google Signals sendet GA4 zusätzlich an `www.google.<tld>/ads/ga-audiences` und `<region>.analytics.google.com/g/s/collect`. Die Regel „GA4 Begleit“ steuert beide, protokolliert sie aber nicht (beobachtet in Audits, nicht an einem Stage-Projekt).
- `user_engagement` geht beim Verlassen einer Seite raus (Beacon bei `pagehide`), seine Anzahl hängt an der Verweildauer und am Tempo: im Baseline-Vergleich „(Timing)“. Ohne Proxy sieht Playwright diese Beacons nicht.
- Über einen sGTM tragen GA4-Requests zusätzlich `sst.rnd` (Zufall) und `sst.tft` (Zeitstempel), dazu `evnid` und `_is_sw`; alle je Lauf neu, in der Baseline flüchtig.

## Google Ads

- Conversions erzeugen Weiterleitungsketten, die nur mit echten Antworten entstehen (Modus `durchlassen`).
- Requests über `ccm` und `1p-conversion` (Cookie-Abgleich, Kopien) kommen mal und mal nicht: im Baseline-Vergleich „(Begleit)“.

## Meta

- **CSP-Sonderfall:** Große Events (z. B. Purchase mit vielen Produkten) sendet das Pixel nicht per Beacon, sondern als Formular-POST in ein iframe. Eine CSP ohne passende `form-action`/`frame-src` blockiert genau diese Events. Bei CSP-Tests mit Meta deshalb die Purchase-Events prüfen, nicht nur PageView.
- Das Stape-Tag (`stape-gtm-…` im Parameter `a`) sendet als `multipart/form-data`; die Baseline zerlegt das in einzelne Parameter. Je Lauf neu: `fbp`, `fbc`, `fbcs` (enthalten Zeitstempel), `plt`, die Experiment-Zuteilungen `expv2[n]` und `ss` (ausgelesener Seitentext, z. B. wechselnde Brotkrumen; als Name zu allgemein für die zentrale Liste, im Projekt als `fluechtigeParameter`).

## LinkedIn

- `/wa/` sendet einen Base64-Body (gzip), keine Formular-Parameter; `time` und `pageLoadId` in `/collect` sind je Lauf neu.

## Microsoft Ads

- Sendet bei `pagehide`; ohne Proxy wie GA4 `user_engagement` nur über das NetLog sichtbar.

## Matomo / Piwik PRO

- Heartbeats (`ping`) hängen an der Verweildauer: im Baseline-Vergleich „(Timing)“.

## Clarity und andere Sitzungsaufzeichnungen

- Uploads mit schwankender Anzahl: im Baseline-Vergleich „(Begleit)“ oder als Rauschen mit `nichtProtokollieren: true`.

## Dienstprofile

Was die Stage über einen Dienst wissen muss, steht als Profil in `lib/dienstprofile.ts`: Klick-ID (URL-Parameter, Ablage, Parameter im Request) und Conversion (Erkennung des Events, Felder für Wert, Währung, Transaktion, Artikel). Die Tabellen hier geben den Stand der zentralen Profile wieder.

**Nur Belegtes eintragen.** Ein Dienst bekommt ein zentrales Profil erst, wenn Parameter, Ablage und Felder an einer echten Website bestätigt sind. Bis dahin: Profil im Projekt (`stageOptionen.dienstProfile`), und die Suche nach den Werten zeigt in `durchgaengigkeit.json` bzw. `landung.json`, in welchem Feld sie stehen. Sobald ein Profil sich bewährt hat, mit Tabelle hier und Profil in `lib/` übernehmen.

### Conversion-Werte

| Dienst | Event | Wert | Währung | Transaktion | Artikel |
|---|---|---|---|---|---|
| GA4 | `en` | `epn.value` (`ep.value`) | `cu` | `ep.transaction_id` | `pr1`, `pr2` … (`id…~nm…`) |
| Google Ads | `/pagead/conversion/…` (auch `ccm/conversion`, Gateway `as/p/c`) mit `label` | `value` | `currency_code` | `oid` | – |
| Meta | `ev` (z. B. `Purchase`) | `cd[value]` | `cd[currency]` | – | `cd[content_ids]` |
| Microsoft Ads | Request mit `gv` | `gv` | `gc` | – | – |

Ohne Profil, Felder an echten Requests belegt (11/2026); der Event-Name für einen Kauf ist bei TikTok und Reddit noch nicht beobachtet, deshalb noch kein Profil:

| Dienst | Event | Wert | Währung | Transaktion | Artikel |
|---|---|---|---|---|---|
| TikTok | `event` im JSON-Body | `properties.value` | `properties.currency` | `properties.order_id` | `properties.contents[].content_id` |
| Reddit | `event` | `m.valueDecimal` (`m.value` leer) | `m.currency` | `m.transactionId`, `m.orderId` (beide leer beobachtet) | `m.products` |
| OpenAI Ads | `type` je Element von `events`, Kauf: `order_created` | `data.amount` **in Cent** (99,95 € = `9995`) | `data.currency` | – | `data.contents[].id` |

Microsoft Ads trägt im Request keinen Event-Namen, der zum dataLayer passt (`ea`/`el` frei im Tag wählbar). Die Durchgängigkeit ordnet deshalb jeden Request mit `gv` im Zeitfenster einem Push zu, auch eine Lead-Conversion, die nach dem Kauf feuert. Abhilfe wie bei Google Ads: nur beim passenden Event prüfen oder `ausnahmen`.

### Event-ID zur Deduplizierung

Schicken Pixel und Conversions API (meist über den Server-Container) dasselbe Event, zählt der Dienst es nur einmal, wenn beide dieselbe Event-ID tragen. Die Prüfung `deduplizierung` sucht jede ID aus einem Pixel-Request in den Requests an den Server-Container und meldet IDs, die ein Pixel mehrfach verwendet (Profil `deduplizierung`: Feld der ID, Feld des Event-Namens für den Bericht, Feld der Pixel-ID). Am Server-Container ist das Feld nicht genormt; üblich sind `ep.event_id` oder je Plattform `ep.fb_event_id` u. Ä.

| Dienst | Event-ID im Pixel-Request | Event-Name | Pixel-ID | Stand |
|---|---|---|---|---|
| Meta | `eid` (im `fbq`-Aufruf `eventID`) | `ev`; `SubscribedButtonClick` (automatisches Event) zählt nicht | `id` | im Profil |
| TikTok | `event_id` im JSON-Body, leer ohne Angabe der Seite | `event`; `EnrichAM` (Advanced Matching nachgereicht) zählt nicht | `context.pixel.code` | im Profil |
| Pinterest | `event_id` im JSON-Parameter `ed` | `event`; `init` (Laden des Pixels) zählt nicht | `tid` | im Profil |
| Reddit | `m.transactionId`, wenn vorhanden (hat laut Reddit Vorrang), sonst `m.conversionId`; die Reddit-Vorlage im GTM sendet beide als SHA-256 des exakten Werts, der Pixel bei direktem `rdt('track', …)` im Klartext; verglichen wird deshalb auch mit dem Hash der Werte am Server | `event` | `id` | im Profil, belegt 11/2026 |
| Snap | `cdid` (client_deduplication_id); ohne Angabe der Seite erzeugt das Pixel eine eigene mit `@-` davor, die gilt als „ohne ID der Seite“ | `ev` | `pid` | im Profil, belegt 11/2026 |
| OpenAI Ads | `id` je Element des JSON-Arrays `events` (Profil `liste`); SDK-eigene Events (`openai::…`, `oai::…`) mit UUID v4 zählen nicht | `type` je Element | `pid` | im Profil, belegt 11/2026 |
| LinkedIn | `eventId` an `/collect`, beim Seitenaufruf und bei Conversions (dann mit `conversionId`) | – (Bericht: Pfad) | `pid` | im Profil, belegt 11/2026. `/wa/` (Website-Signale, Body gzip + Base64) zählt nicht |
| Microsoft Ads | `eventId` laut Doku (UET und Conversions API, CAPI noch Beta) | `evt=custom` mit `ea`/`el` | `ti` | offen: Mit `eventId` im UET-Tag des GTM stand im Request (`evt=custom`) kein solches Feld (11/2026); kein Profil |

Am Server-Container kam die ID im Test als `evnid` am GA4-Request bzw. `event_id` im Body des Stape Data Tag an (`serverIdFelder` je nach Setup). Requests ohne Event-Namen (Sync, Telemetrie, automatisch erfasste Interaktionen wie TikTok `/pixel/act`, Snap-POSTs an `/p`, Pinterest `/user/`) zählen nicht als Event. Belegt sind die Angaben „11/2026“ an Requests einer WooCommerce-Testseite mit Pixeln aus dem GTM.

Quelle für TikTok, Pinterest, Reddit, Snap und OpenAI: die Parser der [Tracking Auditor Extension](https://github.com/mbaersch/tracking-auditor-extension) (Kopie in `pii-lib/` des Tracking Auditors).

Wie die ID zum Server-Container gelangt, ist nicht genormt; üblich ist ein Parameter am GA4-Tag (`ep.event_id`), teils je Plattform eine eigene. Gesucht wird deshalb in allen Feldern der Requests an den Server-Container. Offene Felder an einer echten Website ablesen, dann Profil und Tabelle ergänzen.

### Klick-IDs

Gespeichert und gesendet gilt die Klick-ID, wenn der Wert in Cookie bzw. einem eigenen Feld des Requests steckt (Seiten-URL und Referrer zählen nicht) oder die Ablage bzw. der Parameter aus dem Profil vorhanden ist (das Format ist Sache des Dienstes):

| Parameter | Dienst | Ablage | Parameter im Request |
|---|---|---|---|
| `gclid` | Google Ads (Conversion Linker) | Cookie `_gcl_aw` | `gclaw` |
| `gbraid` | Google Ads (Conversion Linker) | Cookie `_gcl_ag` (`2.1.k<gbraid>$i<Zeit>`) | `gclgb` |
| `wbraid` | Google Ads (Conversion Linker) | Cookie `_gcl_gb` (`GCL.<Zeit>.<wbraid>`) | `gclgb` (an Conversions zusätzlich `gacgb`) |
| `dclid` | Floodlight / DoubleClick | Cookie `_gcl_dc` | nicht belegt (gesehen: `dclid` an `ccm/collect` auf der Landungsseite) |
| `fbclid` | Meta | Cookie `_fbc` (`fb.1.<Zeit>.<fbclid>`) | `fbc` |
| `msclkid` | Microsoft Ads | Cookie `_uetmsclkid` | `msclkid` (kommt als `N` auch ohne Klick-ID – nur Suche nach dem Wert) |
| `ttclid` | TikTok | Cookie `ttclid` (`<ttclid>.<Zeit>`, 1 Tag) | `context.ad.callback` (JSON-Body) |
| `li_fat_id` | LinkedIn | Cookie `li_fat_id` (30 Tage) | `li_fat_id` |
| `rdt_cid` | Reddit | Cookie `_rdt_cid` | `click_id` |
| `epik` | Pinterest | Cookie `_epik` (365 Tage) | im JSON-String `pd`, den jeder Request hat – nur Suche nach dem Wert |
| `oppref` | OpenAI Ads | Cookie `__oppref` (30 Tage) | `oppref` |

Ins Profil gehört nur die Hauptablage, die der Tag selbst liest. Nebenablagen (`_gcl_ls` im localStorage, `GCL_AW_P` auf googleadservices.com, `_gac_*`, `multiFbc`, sessionStorage `tt_adInfo`) findet die Suche nach dem Wert; stünden sie im Profil, fiele eine fehlende Hauptablage nicht auf.

Ohne zentrales Profil: Snap (`ScCid`, `scid`, `sccid` wurden an zwei Websites weder gespeichert noch gesendet; `u_sclid` im Snap-Request ist eine eigene UUID des Pixels, die auch ohne Klick-ID kommt), X (`twclid`), Awin (`awc`, Cookie `aw_m_<Merchant-ID>` – findet die Suche nach dem Wert; an einer Website mit Awin-MasterTag wurde ein Testwert nicht gespeichert, Ursache nicht geklärt).

Landet eine Testseite mit `gclid` und `gbraid`/`wbraid` zugleich, speichert der Conversion Linker nur `gclid`. Diese IDs deshalb in getrennten Landungen prüfen.

Gespeichert wird meist erst mit Consent. Fehlt die ID in der Conversion, ist das ein Befund: Conversion Linker fehlt, feuert zu spät oder ohne Consent, oder die Landungsseite leitet um und verliert den Parameter.

## Enhanced Conversions / gehashte Nutzerdaten

Aufzeichnung im Modus `full` mit Testdaten; prüfen, dass Requests die Daten nur gehasht enthalten. Parser für die Parameter der gängigen Dienste: `pii-lib/` im [Tracking Auditor](https://github.com/mbaersch/tracking-auditor). Gehashte Werte (`sha256_*`) bleiben bei gleichen Testdaten gleich und sind deshalb nicht flüchtig.
