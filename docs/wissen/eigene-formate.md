# Wissen: Tracking über eigene Pfade und Formate

Ein Request, der zu fehlen scheint, fehlt nicht unbedingt. Er kann über einen Pfad auf der eigenen Domain und in einem ganz anderen Format rausgehen: serverseitiges Tagging mit eigenem Pfad, Custom Loader, getunnelte und kodierte Requests (z. B. bei Stape), umbenannte Parameter. Die Standardregeln in `lib/stage.ts` erkennen nur gängige Endpunkte. Vorgehen beim Prüfen: [`../anleitung/tests-bauen.md`](../anleitung/tests-bauen.md), „Zuerst: Was geht wirklich raus?“.

## Requests ohne Regel

Requests ohne Regel werden nur protokolliert (`weitere-requests.json`), nie abgefangen – auch nicht im Modus `abfangen`. Ein Tracking-Endpunkt ohne Regel geht also echt raus. `UNBEKANNTE=abfangen` fängt als Sicherheitsnetz alle Fetch-, XHR- und Beacon-Requests an fremde Domains ab (Dienst „Unbekannt“), kann aber Funktionen der Website stören.

## Stape Custom Loader

Typisches Muster: Script- und Tracking-Requests gehen an eine eigene Subdomain mit verschleiertem Pfad und einem einzigen Parameter, dessen Wert der Base64-kodierte Originalpfad ist, z. B. `https://stp.example.de/abcdef/239?0355ae1a=L2d0YWcvanM…` → `/gtag/js?id=G-…`.

Script-Downloads und Tracking teilen sich dann dieselbe URL-Form: Eine Regel darauf fängt im Modus `abfangen` auch die Scripts ab. Deshalb dekodieren und nur passende Pfade (z. B. `/g/collect`) als Tracking werten. Dekodier-Logik gehört in den Test des jeweiligen Projekts, nicht nach `lib/`: als `dekodieren` an der Regel (liefert die Original-URL; Pfad und Parameter des Treffers kommen dann daraus, der Host bleibt). So sind auch Beacons beim Verlassen dekodiert, die erst während `vergleicheMitBaseline` eintreffen; ein Umschreiben der Treffer im Test käme für sie zu spät. Das Muster der Regel auf den Base64-Anfang des Pfads setzen (`/g/collect` → `L2cvY29sbGVjd`), damit Skript-Downloads über denselben Tunnel nicht als Tracking zählen.

Variante auf der Hauptdomain (Custom Loader v2, beobachtet 11/2026): Der Pfad ist ein Proxy-Pfad der Website (`CUSTOM_PROXY_PATH`, z. B. `/xyz`), der Server-Container liegt auf einer Subdomain. Das Skript am Anfang des Containers überschreibt `XMLHttpRequest.open`, `fetch`, `sendBeacon` und `Image.src` und schreibt Requests an den Server-Container um: im Modus `strict` nur die Pfade `/g/collect`, `/collect`, `/data` und `/anonymize/…`, zu `https://www.example.de/xyz/<präfix><kennung><suffix>?<param>=<Base64 von Pfad und Query>`. Daneben gibt es `…/xyz/fps/<Base64 von id=GTM-…&dn=…&sop=/xyz>/`, das Pfadschema des First-Party-Servings von Google (Tag Gateway). Erkennbar ist Stape an den Antwort-Headern (`x-stape-version`, `cache-status: stape`), am Request selbst nicht.

Adblocker: Die Base64-Kodierung macht den Hit für die Filterlisten unsichtbar. Derselbe GA4-Hit als `/xyz/g/collect?v=2…` (reiner Pfad-Proxy wie beim Tag Gateway) wird von EasyPrivacy blockiert (`/collect?v=`), getunnelt kommt er bei `ublock` und `streng` durch, ebenso Loader und `fps`-Pfad.

Für die GTM-Vorschau braucht ein solcher Loader `vorschauLoader` (siehe [`../anleitung/gtm-vorschau.md`](../anleitung/gtm-vorschau.md)).

## Eigene Pfade und Adblocker

Eine eigene Domain allein schützt nicht vor Adblockern; es kommt auf den Pfad an. Geprüft am 8. November 2026 mit den Listen der Profile `ublock` und `streng` (`lib/adblocker.ts`):

- `/g/collect?v=…` wird auf jedem Host blockiert, auch auf der eigenen Domain oder Subdomain (EasyPrivacy, Regel `/collect?v=`).
- `/gtm.js` wird auf jedem Pfad blockiert (EasyPrivacy, Regel `/gtm.js`), ebenso Skripte auf Subdomains, die mit `sgtm.` beginnen (`://sgtm.*.js?`).
- Bei `googletagmanager.com/gtm.js` und `/gtag/js` liefert uBlock ein Ersatzskript statt nichts (uBlock filters – Privacy, `redirect=googletagmanager_gtm.js`, bei uBlock ein Alias für den Ersatz von `analytics.js`): Anti-Flicker wird freigegeben und jeder `eventCallback` im dataLayer ausgeführt, der dataLayer selbst bleibt. Weiterleitungen nach einem Push mit `eventCallback` funktionieren für Blocker-Nutzer also; Tags feuern nicht.

Weitere Befunde an einem WooCommerce-Shop mit GTM4WP und Stape (9. November 2026, `ublock` und `streng` gleich):

- **GTM4WP:** EasyPrivacy blockiert die Skripte des Plugins auf der eigenen Domain (Regel `/gtm4wp-$script`). Events, die diese Skripte auslösen (`add_to_cart`, `add_payment_info`, Formular-Events), fehlen dann im dataLayer; Events, die die Seite selbst ausgibt (`view_item`, `view_cart`, `begin_checkout`), bleiben.
- **Stape Custom Loader:** Ein eigener Pfad für `gtm.js` auf eigener Subdomain kam durch, GTM lief also. Die Tags der Dienste scheiterten trotzdem an ihren Skripten bzw. Endpunkten, GA4 an den Server-Container an `/g/collect`.
- **Stape Data Tag:** Das Skript von `stapecdn.com` wird blockiert (EasyPrivacy, `||stapecdn.com^$third-party`).
- Requests eines Tags mit eigenem Pfad und eigenem Format (z. B. JSON Tag) an den Server-Container kamen durch.

Ob ein konkretes Setup durchkommt, zeigt die Variante `adblocker` (siehe [`../anleitung/varianten.md`](../anleitung/varianten.md)). Die Listen ändern sich täglich; die Befunde in `adblocker.json` nennen Regel, Liste und Stand.

## Referenz

Der [Tracking Auditor](https://github.com/mbaersch/tracking-auditor) bringt `tracking-vendors.json` (Skripte und Endpunkte bekannter Dienste) und `lib/tracking-classify.js` mit Erkennung von First-Party-Collect-Endpunkten und Stape-Tunneln (`extractFirstPartyCollectMatches`, `extractStapeMatches`, `tryDecodeStapeTransport`). Nicht alles daraus übernehmen: Ziel ist nicht, jeden denkbaren Loader zu erkennen, sondern die Requests dieser einen Website richtig zuzuordnen.
