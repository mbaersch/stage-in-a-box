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

## GTM-Datenmodell lesen

Was GTM aus einem Push gemacht hat, steht im Datenmodell: `google_tag_manager[<ID>].dataLayer.get('<key>')`. Nützlich, um eine dataLayer-Anpassung zu prüfen.
