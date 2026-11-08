# Wissen: GTM und Google-Tag

## Debug Mode ohne Tag Assistant

Lädt der Container als Vorschau per Injection (`gtm_auth`, `gtm_preview`), ohne angeschlossenen Tag Assistant, ist die GTM-Variable *Debug Mode* `false`. Blocker wie „Nicht-Live-Umgebung und nicht Debug Mode“ greifen dann weiter. Ausweg: Vorschau über den Tag Assistant ([`../anleitung/gtm-vorschau.md`](../anleitung/gtm-vorschau.md)).

## Hüllen-Objekte aus Custom Templates

Pushes aus GTM-Custom-Templates liegen im dataLayer der Seite teils als Hüllen-Objekt `{ value: { event: … } }`. Die Stage packt sie aus; im Protokoll stehen sie wie normale Events. Wer `window.dataLayer` direkt liest, sieht die Hülle.

## Tag feuert, aber es kommt kein Request

Im Browser `google_tag_data.tidr` prüfen:

- `container[<ID>].state` 2 heißt registriert.
- Ziele in `pending` warten auf ein Google-Tag, das nie geladen bzw. registriert wurde (z. B. bei gemischtem Setup aus Google-Tag und Ereignis-Tags).
- `scriptSource` zeigt, woher ein Container geladen wurde.
- `Object.keys(google_tag_manager)` listet alle geladenen Container und Ziele.

Das ist ein Befund über die Website, kein Testfehler.

## Google Tag Gateway

Mit Gateway lädt `gtm.js` bzw. `gtag/js` von einem Pfad der eigenen Domain (z. B. `/<pfad>/gtm.js?id=…`), und Messdaten gehen ebenfalls dorthin. Beobachtet an einem Test-Gateway (Stand 08.11.2026):

- GA4: `/<pfad>/g/collect` (normale fetch-Requests).
- Google Ads: `/<pfad>/as/p/c/<Conversion-ID>/` (Kurzform von `pagead/conversion`, gleiche Parameter `label`, `value`, `currency_code`, `oid`), `/<pfad>/as/d/ccm/conversion/<ID>/` und `/<pfad>/d/ccm/form-data/<ID>` (Nutzerdaten für Enhanced Conversions). Parallel gehen weiterhin Requests direkt an `googleadservices.com`, `googleads.g.doubleclick.net` und `google.<tld>`.
- Das Gateway liefert jede Container- bzw. Tag-ID aus, nicht nur die in seiner Konfiguration; die Umleitung der Messdaten hing im Versuch nicht an der eingetragenen ID.
- Zusätzlich lädt ein Service Worker (`/<pfad>/_/service_worker/…/sw_iframe.html`, `sw.js`). Im Versuch liefen die Hits trotzdem als sichtbare fetch-Requests; ob sie in anderen Setups über den Worker gehen (dann nur über den Proxy sichtbar), ist offen.

Die Standardregeln für GA4 und Google Ads erkennen diese Pfade unabhängig vom Host.

## GTM-Datenmodell lesen

Was GTM aus einem Push gemacht hat, steht im Datenmodell: `google_tag_manager[<ID>].dataLayer.get('<key>')`. Nützlich, um eine dataLayer-Anpassung zu prüfen.
