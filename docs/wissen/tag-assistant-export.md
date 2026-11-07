# Wissen: Tag-Assistant-Export

Das Format ist nicht dokumentiert. `werkzeuge/analysiere-aufzeichnung.mjs` stützt sich auf `data.containers[].messages`, `tagsFired`, `pageSummaries` und `hitInfo`.

**Enthalten:**

- dataLayer-Messages, auch die des Recorders (ohne `event`, als „Nachricht“ angezeigt)
- Consent-Stand pro Message
- gefeuerte Tags pro Message
- Requests von Google-Tags (GA4, Ads, Floodlight) mit allen Parametern

**Nicht enthalten:**

- Requests anderer Dienste (Meta, TikTok …) – nur, dass deren Tag gefeuert hat. In den Tests werden sie trotzdem vollständig erfasst.
- Klicks und Eingaben, außer der Recorder läuft mit oder passende Trigger im Container erfassen sie zufällig.

**Größe:** Ein Export eines Kaufprozesses ist oft über 100 MB groß. Nie roh in den Kontext laden, immer das Analyse-Script nutzen.
