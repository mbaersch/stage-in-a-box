# Wissen: CMPs und Consent-Banner

Fakten, die für jede Website mit der jeweiligen CMP gelten. Was nur eine Website betrifft (deren Konfiguration, Dienstnamen, Selektoren), gehört in `projekt.md` des Projekts.

## Banner, die der Recorder nicht sieht

Kein Recorder-Klick, aber ein `consent update` im dataLayer hat zwei mögliche Ursachen:

- **GTM lädt erst nach der Zustimmung.** Dann läuft auch der Recorder erst danach. Beim Ablehnen entstehen womöglich gar keine Tracking-Requests und kein dataLayer-Eintrag; die Variante „Consent abgelehnt“ prüft dann genau das: nichts darf feuern.
- **Der Banner liegt in einem iframe oder geschlossenen Shadow DOM.** Bei iframe-Bannern `page.frameLocator(…)` verwenden. Offene Shadow Roots durchdringen Playwright-Locators ohnehin.

In beiden Fällen braucht der Test eine Angabe im Auftrag unter „Consent-Banner“: CMP-Name oder Selektoren und nötige Schritte (z. B. Scrollen, bis der Banner erscheint).

## CMP-Bibliothek

Selektoren für über 120 CMPs stehen im Repo [mbaersch/tracking-auditor](https://github.com/mbaersch/tracking-auditor), Datei `cmp-library.json`: `accept`, `reject`, ggf. `rejectSteps` (zweistufiges Ablehnen), `detect` (Container zum Erkennen) und `shadowDom`.

## Bot-Erkennung

Manche CMPs erteilen einem erkannten Bot selbst Consent. Das sieht aus wie Tracking vor Consent, obwohl niemand geklickt hat. Die Stage verbirgt deshalb `navigator.webdriver`, das Automation-Flag und die Marke „HeadlessChrome“ in den Client Hints; abschalten nur mit `stageOptionen: { automationVerbergen: false }`.

## Usercentrics

- Behandelt erkannte Bots als zustimmend (`isBot`). Siehe „Bot-Erkennung“.
- API-Zugriff für Consent-Varianten in `lib/cmp.ts` (`nurDienste`, `nurKategorien`, `widerrufen`, `dienste`), Anwendung in [`../anleitung/varianten.md`](../anleitung/varianten.md).
- Die Dienstnamen der CMP müssen exakt zu den Consent-Keys im Container passen. Ein Tippfehler im Dienstnamen blockiert einen Tag dauerhaft; `usercentrics.dienste(page)` zeigt die Namen zum Abgleich.
