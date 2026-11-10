/**
 * Einstellungen aus den Aufträgen eines Projekts (auftrag.md, auftrag-<name>.md): Startadresse, Vorschau-Link und
 * Schalter wie Tempo oder Proxy. Unkritisch und deshalb nicht in .env; die Config liest sie bei jedem Lauf.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { TestInfo } from 'playwright/test';

/** Ordner des Projekts (bzw. des Beispiels), in dem der Test liegt. */
export function projektOrdner(testInfo: TestInfo): string {
  // Tests eines benannten Auftrags liegen in tests/<name>/; der Projektordner steht dann in den Metadaten.
  return testInfo.project.metadata?.projektOrdner ?? path.dirname(testInfo.project.testDir);
}

/** Zeile im Auftrag → Umgebungsvariable, die lib/ schon liest (Kommandozeile geht vor). */
const SCHALTER: Record<string, string> = {
  'tempo': 'TEMPO',
  'proxy': 'PROXY',
  'tracking-modus': 'TRACKING_MODUS',
  'conversion': 'CONVERSION',
  'adblocker': 'ADBLOCKER',
  'unbekannte requests': 'UNBEKANNTE',
  'traffic-type': 'TRAFFIC_TYPE',
  'debug-mode': 'DEBUG_MODE',
};

export interface Einstellungen {
  startadresse?: string;
  vorschauLink?: string;
  /** Schalter als Umgebungsvariablen, z. B. { TEMPO: 'langsam' } */
  umgebung: Record<string, string>;
}

export interface Auftrag {
  /** '' für auftrag.md, sonst <name> aus auftrag-<name>.md */
  name: string;
  datei: string;
  einstellungen: Einstellungen;
}

function bereinige(wert: string) {
  let w = wert.trim();
  w = w.match(/^\[[^\]]*\]\((.*)\)$/)?.[1] ?? w;
  w = w.match(/^<(.*)>$/)?.[1] ?? w;
  w = w.match(/^(["'`])(.*)\1$/)?.[2] ?? w;
  return w.trim();
}

/** Liest den Abschnitt „## Einstellungen“ (Zeilen `- **Name:** Wert`); HTML-Kommentare und leere Werte entfallen. */
export function leseEinstellungen(text: string, datei = 'Auftrag'): Einstellungen {
  const ergebnis: Einstellungen = { umgebung: {} };
  const ohneKommentare = text.replace(/<!--[\s\S]*?-->/g, '');
  const abschnitt = ohneKommentare.match(/^##[ \t]+Einstellungen[ \t]*\r?\n([\s\S]*?)(?=^##?[ \t]|(?![\s\S]))/m)?.[1];
  if (!abschnitt) return ergebnis;
  for (const m of abschnitt.matchAll(/^[ \t]*[-*][ \t]+\*\*([^*]+?):?\*\*:?[ \t]*(.*)$/gm)) {
    const name = m[1].trim().toLowerCase();
    const wert = bereinige(m[2]);
    if (name === 'startadresse') { if (wert) ergebnis.startadresse = wert; continue; }
    if (name === 'gtm-vorschau-link') { if (wert) ergebnis.vorschauLink = wert; continue; }
    const variable = SCHALTER[name];
    if (!variable) {
      throw new Error(`${datei}: Einstellung „${m[1].trim()}“ unbekannt. Möglich: Startadresse, GTM-Vorschau-Link, `
        + Object.keys(SCHALTER).map((s) => s[0].toUpperCase() + s.slice(1)).join(', '));
    }
    if (wert) ergebnis.umgebung[variable] = wert;
  }
  return ergebnis;
}

/** '' für auftrag.md, <name> für auftrag-<name>.md, sonst undefined. */
export function auftragsName(datei: string): string | undefined {
  if (datei === 'auftrag.md') return '';
  return datei.match(/^auftrag-([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/)?.[1];
}

/**
 * Auftrag, dessen Startadresse Sitzung, Aufnahme und übrige Tests in tests/ (außerhalb der Auftragsordner) bekommen:
 * der gewählte (AUFTRAG=<name>), sonst auftrag.md, sonst der einzige.
 */
export function waehleHauptauftrag(namen: string[], gewaehlt?: string): string | undefined {
  if (gewaehlt !== undefined) {
    if (!namen.includes(gewaehlt)) {
      throw new Error(`AUFTRAG=${gewaehlt}: auftrag-${gewaehlt}.md gibt es nicht. Vorhanden: ${namen.map((n) => (n ? `auftrag-${n}.md` : 'auftrag.md')).join(', ') || 'keiner'}`);
    }
    return gewaehlt;
  }
  if (namen.includes('')) return '';
  return namen.length === 1 ? namen[0] : undefined;
}

export function ladeAuftraege(projektOrdner: string): Auftrag[] {
  if (!fs.existsSync(projektOrdner)) return [];
  return fs.readdirSync(projektOrdner).sort().flatMap((datei) => {
    const name = auftragsName(datei);
    if (name === undefined) return [];
    const pfad = path.join(projektOrdner, datei);
    return [{ name, datei: pfad, einstellungen: leseEinstellungen(fs.readFileSync(pfad, 'utf8'), datei) }];
  });
}
