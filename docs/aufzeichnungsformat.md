# Aufzeichnungsformat des Recorders

Der Recorder schreibt jede Interaktion als Message in den dataLayer:

```js
{ _clear: true, __rec: { v: 1, type: 'click', seq: 4, pageId: 'k3j9x2ab', ts: 1793994279389, t: 120, url: '…', … } }
```

- **Kein `event`-Key:** GTM wertet für diese Messages keine Trigger aus. Der Tag Assistant zeigt sie als „Message“.
- **`_clear: true`:** verhindert, dass das Objekt rekursiv ins GTM-Datenmodell gemergt wird.
- Im eigenständigen Betrieb mit `console: true` erscheint jeder Eintrag zusätzlich als Konsolenzeile `[rec] {…}`.

## Gemeinsame Felder

| Feld | Bedeutung |
|---|---|
| `v` | Formatversion |
| `type` | `init`, `click`, `change`, `submit`, `key`, `route` |
| `seq` | laufende Nummer innerhalb einer Seite |
| `pageId` | Zufalls-ID, wechselt bei jedem vollständigen Seitenaufruf |
| `ts` | Zeitstempel (ms seit 1970) |
| `t` | ms seit Navigationsstart der Seite |
| `url` | aktuelle URL |
| `frame` | `true`, wenn der Recorder in einem iframe läuft |

## Typen

| `type` | Zusätzliche Felder |
|---|---|
| `init` | `title`, `referrer`, `readyState`, `viewport` (`w`, `h`, `dpr`), `lang`, `userAgent`, `valueMode` |
| `click` | `element`, `button`, `modifiers`, `isTrusted`, ggf. `clickedNode` (tatsächlich getroffener Knoten, wenn `element` ein umschließendes Element ist) |
| `change` | `element`, `field`, `isTrusted` |
| `submit` | `form`, `fields` (Liste mit `name`, `id`, `type`, `autocomplete`, `field`), ggf. `submitter` |
| `key` | `key` (`Enter` oder `Escape`), `element` |
| `route` | `kind` (`pushState`, `replaceState`, `popstate`, `hashchange`), `from`, `to`, `title` |

## `element`

| Feld | Bedeutung |
|---|---|
| `tag` | Tag-Name |
| `role` | explizite oder implizite ARIA-Rolle |
| `name` | angenäherter Accessible Name (aria-label, Label, Text, alt, title) |
| `text` | sichtbarer Text, gekürzt auf 80 Zeichen |
| `selectors` | Kandidaten, nach Robustheit sortiert: `{ kind, selector, unique }` |
| `type`, `autocomplete` | Attribute von Formularfeldern |
| `href`, `target`, `opensNewTab`, `download` | bei Links |
| `ariaExpanded` | Zustand bei Menüs/Akkordeons zum Zeitpunkt des Klicks |
| `shadowHosts` | Kette der Shadow-Hosts (äußerster zuerst), jeweils mit `selectors` |
| `form` | umgebendes Formular: `id`, `name`, `action`, `method`, `selectors` |

Bei Klicks wird das nächstgelegene interaktive Element gemeldet, also der `<button>` statt des `<span>` oder `<svg>` darin.

### Selektor-Arten (`kind`)

In dieser Reihenfolge:

1. `testAttr` – `data-testid`, `data-test-id`, `data-test`, `data-qa`, `data-cy`, `data-e2e`, `data-track`, `data-tracking`
2. `id` – bzw. `idGenerated`, wenn die ID nach Laufzeit-Erzeugung aussieht (nicht verwenden)
3. `name`
4. `ariaLabel`
5. `href` (nur Links)
6. `cssPath` – immer vorhanden, als letzte Möglichkeit

`unique` bezieht sich auf das eigene Dokument bzw. den eigenen Shadow Root.

## `field`

| Feldart | Inhalt |
|---|---|
| Checkbox, Radio | `checked`, `value` |
| Select | `selected`: Liste aus `value`, `text` |
| Datei | `files` (Anzahl) |
| Text, E-Mail, Telefon … | `value`, `length`, `mode` |
| Passwort, versteckt, Einmalcode, Kartendaten | `value: "[redacted]"`, `length` |

Im Modus `masked` werden Buchstaben zu `x`/`X` und Ziffern zu `0`, alles andere bleibt: `Max.Mustermann@example.de` → `Xxx.Xxxxxxxxxx@xxxxxxx.xx`. Im Modus `full` steht der echte Wert.

## Konfiguration

Vor dem Recorder-Script setzen:

```js
window.__recConfig = {
  enabled: true,          // false = nichts tun
  values: 'masked',       // 'masked' | 'full'
  console: false,         // jeden Eintrag zusätzlich in die Konsole schreiben
  dataLayerName: 'dataLayer',
  key: '__rec'
};
```

## Bekannte Grenzen

- Cross-Origin-iframes (Zahlungsfelder, manche CMPs) sind nicht einsehbar.
- Geschlossene Shadow Roots sind nicht erreichbar.
- Interaktionen vor dem Laden des GTM-Containers fehlen.
- Hover-Interaktionen (Menüs, die nur bei Mouseover öffnen) werden nicht erfasst.
