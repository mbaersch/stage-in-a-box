# Wissen: Tracking über eigene Pfade und Formate

Ein Request, der zu fehlen scheint, fehlt nicht unbedingt. Er kann über einen Pfad auf der eigenen Domain und in einem ganz anderen Format rausgehen: serverseitiges Tagging mit eigenem Pfad, Custom Loader, getunnelte und kodierte Requests (z. B. bei Stape), umbenannte Parameter. Die Standardregeln in `lib/stage.ts` erkennen nur gängige Endpunkte. Vorgehen beim Prüfen: [`../anleitung/tests-bauen.md`](../anleitung/tests-bauen.md), „Zuerst: Was geht wirklich raus?“.

## Requests ohne Regel

Requests ohne Regel werden nur protokolliert (`weitere-requests.json`), nie abgefangen – auch nicht im Modus `abfangen`. Ein Tracking-Endpunkt ohne Regel geht also echt raus. `UNBEKANNTE=abfangen` fängt als Sicherheitsnetz alle Fetch-, XHR- und Beacon-Requests an fremde Domains ab (Dienst „Unbekannt“), kann aber Funktionen der Website stören.

## Stape Custom Loader

Typisches Muster: Script- und Tracking-Requests gehen an eine eigene Subdomain mit verschleiertem Pfad und einem einzigen Parameter, dessen Wert der Base64-kodierte Originalpfad ist, z. B. `https://stp.example.de/abcdef/239?0355ae1a=L2d0YWcvanM…` → `/gtag/js?id=G-…`.

Script-Downloads und Tracking teilen sich dann dieselbe URL-Form: Eine Regel darauf fängt im Modus `abfangen` auch die Scripts ab. Deshalb dekodieren und nur passende Pfade (z. B. `/g/collect`) als Tracking werten. Dekodier-Logik gehört in den Test des jeweiligen Projekts, nicht nach `lib/`.

Für die GTM-Vorschau braucht ein solcher Loader `vorschauLoader` (siehe [`../anleitung/gtm-vorschau.md`](../anleitung/gtm-vorschau.md)).

## Referenz

Der [Tracking Auditor](https://github.com/mbaersch/tracking-auditor) bringt `tracking-vendors.json` (Skripte und Endpunkte bekannter Dienste) und `lib/tracking-classify.js` mit Erkennung von First-Party-Collect-Endpunkten und Stape-Tunneln (`extractFirstPartyCollectMatches`, `extractStapeMatches`, `tryDecodeStapeTransport`). Nicht alles daraus übernehmen: Ziel ist nicht, jeden denkbaren Loader zu erkennen, sondern die Requests dieser einen Website richtig zuzuordnen.
