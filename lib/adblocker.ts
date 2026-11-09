/**
 * Adblocker-Variante: Requests so blockieren, wie es ein Adblocker mit öffentlichen Filterlisten täte.
 *
 *   test.use({ stageOptionen: { adblocker: 'ublock' } });   // oder 'streng', oder eigene Listen
 *
 * Profile:
 * - ublock: die Listen, die uBlock Origin nach der Installation aktiv hat (ohne Malware-Listen,
 *   die für Tracking keine Rolle spielen). Quelle: assets/assets.json im Repo von uBlock Origin.
 * - streng: zusätzlich der Tracking-Schutz von AdGuard, der auch bekannte First-Party-Tracker kennt.
 *
 * Die Listen kommen nie ins Repo (Lizenzen GPL bzw. CC BY-SA). Sie werden beim ersten Lauf geladen und
 * in listen/ zwischengespeichert (gitignored), einen Tag lang wiederverwendet und dann neu geladen.
 * Die Filter-Engine ist @ghostery/adblocker (MPL 2.0, optionale Abhängigkeit). Ausgewertet werden nur
 * Netzwerkregeln; kosmetische Regeln und Scriptlets wirken hier nicht. Ersatzdateien (redirect=…) liefert
 * lib/adblocker-ersatz.ts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ersatzFuer, type Ersatz } from './adblocker-ersatz';

export type AdblockerProfil = 'ublock' | 'streng';

/**
 * Profilname oder eigene Zusammenstellung. listen: URLs oder Dateipfade (relativ zum Projektordner),
 * im Format von Adblock Plus/uBlock oder als hosts-Datei. regeln: einzelne Filterregeln.
 */
export type Adblocker = AdblockerProfil | { profil?: AdblockerProfil; listen?: string[]; regeln?: string[] };

export interface AdblockerListe {
  name: string;
  /** URL oder Datei, aus der die Liste stammt. */
  quelle: string;
  /** Stand laut Kopf der Liste (Last modified, TimeUpdated, Version) oder Ladezeitpunkt. */
  stand: string;
  /** Hinweis, wenn eine veraltete Kopie aus dem Zwischenspeicher genutzt wurde. */
  warnung?: string;
}

export interface AdblockerTreffer {
  zeit: number;
  url: string;
  host: string;
  /** Art des Requests (script, xhr, image, sub_frame, …). */
  typ: string;
  /** Filterregel, die gegriffen hat. */
  filter: string;
  /** Liste, aus der die Regel stammt. */
  liste?: string;
  /**
   * Regel mit redirect=…: Statt zu blockieren liefert der Blocker eine Ersatzdatei. nachgebildet: false heißt,
   * uBlock liefert dort eine Datei mit eigener Logik, die Stage nur eine leere Antwort (lib/adblocker-ersatz.ts).
   */
  ersatz?: { name: string; nachgebildet: boolean };
  /** Dienst laut Regeln der Stage, falls es ein Tracking-Request ist. */
  dienst?: string;
}

export interface AdblockerErgebnis {
  filter: string;
  liste?: string;
  /** Ersatzdatei statt Abbruch (Regel mit redirect=…). */
  ersatz?: Ersatz;
}

export interface AdblockerSetup {
  name: string;
  listen: AdblockerListe[];
  /**
   * Prüft einen Request. typ: Ressourcentyp von Playwright oder sec-fetch-dest; seite: URL der Seite bzw.
   * des Frames, von dem der Request ausgeht (für Regeln wie $third-party und $domain=).
   */
  pruefe(url: string, typ: string, seite: string): AdblockerErgebnis | undefined;
}

interface ListenQuelle {
  name: string;
  /** Erste URL ist die Originalquelle, die übrigen sind Spiegel derselben Datei. */
  urls: string[];
}

const UBO_CDN = ['https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main'];
const ubo = (name: string, datei: string, original: string): ListenQuelle => ({
  name, urls: [original, ...UBO_CDN.map((basis) => `${basis}/${datei}`)],
});

const UBLOCK: ListenQuelle[] = [
  ubo('uBlock filters – Ads', 'filters/filters.min.txt', 'https://ublockorigin.github.io/uAssets/filters/filters.txt'),
  ubo('uBlock filters – Privacy', 'filters/privacy.min.txt', 'https://ublockorigin.github.io/uAssets/filters/privacy.txt'),
  ubo('uBlock filters – Unbreak', 'filters/unbreak.min.txt', 'https://ublockorigin.github.io/uAssets/filters/unbreak.txt'),
  ubo('uBlock filters – Quick fixes', 'filters/quick-fixes.min.txt', 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt'),
  ubo('EasyList', 'thirdparties/easylist.txt', 'https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt'),
  ubo('EasyPrivacy', 'thirdparties/easyprivacy.txt', 'https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt'),
  {
    name: 'Peter Lowe’s Ad and tracking server list',
    urls: [
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext',
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/pgl.yoyo.org/as/serverlist',
    ],
  },
];

const ADGUARD_TRACKING: ListenQuelle = {
  name: 'AdGuard Tracking Protection',
  urls: [
    'https://filters.adtidy.org/extension/ublock/filters/3.txt',
    'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/platforms/extension/ublock/filters/3.txt',
  ],
};

const PROFILE: Record<AdblockerProfil, ListenQuelle[]> = {
  ublock: UBLOCK,
  streng: [...UBLOCK, ADGUARD_TRACKING],
};

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZWISCHENSPEICHER = path.join(WURZEL, 'listen');
const MAX_ALTER_MS = 24 * 60 * 60 * 1000;

/** ADBLOCKER=ublock|streng in .env oder beim Aufruf; aus/leer: kein Adblocker. */
export function adblockerAusUmgebung(): Adblocker | undefined {
  const wert = process.env.ADBLOCKER?.trim().toLowerCase();
  if (!wert || wert === 'aus') return undefined;
  if (wert in PROFILE) return wert as AdblockerProfil;
  throw new Error(`ADBLOCKER="${process.env.ADBLOCKER}" unbekannt. Möglich: ${Object.keys(PROFILE).join(', ')}, aus`);
}

const hash = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

function schreibe(datei: string, inhalt: string | Uint8Array) {
  // Mehrere Worker laden parallel: erst in eine eigene Datei schreiben, dann umbenennen
  const tmp = `${datei}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, inhalt);
  fs.renameSync(tmp, datei);
}

export function standAusKopf(text: string): string | undefined {
  const kopf = text.slice(0, 3000);
  const m = kopf.match(/^!\s*(?:Last modified|TimeUpdated|Updated):\s*(.+)$/im) ?? kopf.match(/^!\s*Version:\s*(.+)$/im)
    ?? kopf.match(/^#\s*Last updated:\s*(.+)$/im);
  const wert = m?.[1].trim();
  return wert && !wert.includes('%') ? wert : undefined;
}

/** hosts-Zeilen ("0.0.0.0 domain", "127.0.0.1 domain") in Netzwerkregeln umsetzen. */
export function alsFilter(text: string): string {
  return text.replace(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+).*$/gm, (_, host: string) => (host === 'localhost' ? '' : `||${host}^`));
}

async function holen(url: string): Promise<string> {
  const antwort = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  const text = await antwort.text();
  if (text.trimStart().startsWith('<')) throw new Error('HTML statt Filterliste');
  return text;
}

async function ladeQuelle(q: ListenQuelle): Promise<{ text: string; liste: AdblockerListe }> {
  fs.mkdirSync(ZWISCHENSPEICHER, { recursive: true });
  const basis = path.join(ZWISCHENSPEICHER, hash(q.urls[0]));
  const datei = `${basis}.txt`;
  const meta = `${basis}.json`;
  const vorhanden = fs.existsSync(datei) && fs.existsSync(meta)
    ? JSON.parse(fs.readFileSync(meta, 'utf8')) as { quelle: string; geladen: number } : undefined;
  const ausSpeicher = (warnung?: string) => {
    const text = fs.readFileSync(datei, 'utf8');
    const stand = standAusKopf(text) ?? new Date(vorhanden!.geladen).toISOString();
    return { text, liste: { name: q.name, quelle: vorhanden!.quelle, stand, warnung } };
  };
  if (vorhanden && Date.now() - vorhanden.geladen < MAX_ALTER_MS) return ausSpeicher();

  const fehler: string[] = [];
  for (const url of q.urls) {
    try {
      const text = await holen(url);
      schreibe(datei, text);
      schreibe(meta, JSON.stringify({ name: q.name, quelle: url, geladen: Date.now() }, null, 2));
      return { text, liste: { name: q.name, quelle: url, stand: standAusKopf(text) ?? new Date().toISOString() } };
    } catch (e) {
      fehler.push(`${url}: ${(e as Error).message}`);
    }
  }
  if (vorhanden) {
    const tage = Math.floor((Date.now() - vorhanden.geladen) / MAX_ALTER_MS);
    return ausSpeicher(`nicht neu ladbar, Kopie von vor ${tage} Tag(en) genutzt`);
  }
  throw new Error(`Filterliste "${q.name}" nicht ladbar und nicht zwischengespeichert:\n  ${fehler.join('\n  ')}`);
}

async function ladeEigene(eintrag: string): Promise<{ text: string; liste: AdblockerListe }> {
  if (/^https?:\/\//.test(eintrag)) return ladeQuelle({ name: eintrag, urls: [eintrag] });
  const datei = path.resolve(process.env.STAGE_PROJEKT ?? process.cwd(), eintrag);
  if (!fs.existsSync(datei)) throw new Error(`Filterliste ${datei} nicht gefunden`);
  const text = fs.readFileSync(datei, 'utf8');
  return {
    text,
    liste: { name: path.basename(datei), quelle: path.relative(WURZEL, datei), stand: standAusKopf(text) ?? fs.statSync(datei).mtime.toISOString() },
  };
}

/** Engine je Listenstand einmal pro Prozess bauen; serialisiert in listen/ für die übrigen Worker. */
const engines = new Map<string, Promise<any>>();

/** Engines älter als zwei Tage löschen: Mit jedem neuen Listenstand entsteht eine neue (bis über 40 MB). */
function altEnginesLoeschen() {
  for (const name of fs.readdirSync(ZWISCHENSPEICHER).filter((n) => /^engine-.*\.bin$/.test(n))) {
    const datei = path.join(ZWISCHENSPEICHER, name);
    try {
      if (Date.now() - fs.statSync(datei).mtimeMs > 2 * MAX_ALTER_MS) fs.unlinkSync(datei);
    } catch { /* von einem anderen Worker gelöscht oder auf einer Freigabe gesperrt */ }
  }
}

async function ladeBibliothek(): Promise<any> {
  try {
    return await import('@ghostery/adblocker');
  } catch {
    throw new Error('Für stageOptionen.adblocker fehlt das Paket @ghostery/adblocker: npm install');
  }
}

export async function adblockerLaden(option: Adblocker): Promise<AdblockerSetup> {
  const o = typeof option === 'string' ? { profil: option } : option;
  if (o.profil && !(o.profil in PROFILE)) throw new Error(`Adblocker-Profil "${o.profil}" unbekannt. Möglich: ${Object.keys(PROFILE).join(', ')}`);
  const geladen = [
    ...await Promise.all((o.profil ? PROFILE[o.profil] : []).map(ladeQuelle)),
    ...await Promise.all((o.listen ?? []).map(ladeEigene)),
  ];
  const regeln = o.regeln ?? [];
  if (!geladen.length && !regeln.length) throw new Error('stageOptionen.adblocker: weder Profil noch Listen noch Regeln angegeben');

  const { FiltersEngine, Request, ENGINE_VERSION } = await ladeBibliothek();
  const schluessel = hash([ENGINE_VERSION, ...geladen.map((g) => hash(g.text)), ...regeln].join('\n'));
  if (!engines.has(schluessel)) {
    engines.set(schluessel, (async () => {
      const datei = path.join(ZWISCHENSPEICHER, `engine-${schluessel}.bin`);
      if (fs.existsSync(datei)) {
        try { return FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(datei))); } catch { /* andere Version: neu bauen */ }
      }
      const text = [...geladen.map((g) => alsFilter(g.text)), ...regeln].join('\n');
      const engine = FiltersEngine.parse(text, { loadCosmeticFilters: false, loadNetworkFilters: true, enableOptimizations: false, debug: true });
      fs.mkdirSync(ZWISCHENSPEICHER, { recursive: true });
      schreibe(datei, engine.serialize());
      altEnginesLoeschen();
      return engine;
    })());
  }
  const engine = await engines.get(schluessel)!;

  // Herkunft einer Regel: in welcher Liste steht die Zeile (hosts-Einträge über den Hostnamen)
  const herkunft = new Map<string, string | undefined>();
  const quellen = [
    ...geladen.map((g) => ({ name: g.liste.name, text: `\n${g.text.replace(/\r/g, '')}\n` })),
    { name: 'Regeln aus dem Test', text: `\n${regeln.join('\n')}\n` },
  ];
  const listeVon = (zeile: string) => {
    if (!herkunft.has(zeile)) {
      const host = zeile.match(/^\|\|([^/^$*]+)\^$/)?.[1];
      herkunft.set(zeile, quellen.find((q) => q.text.includes(`\n${zeile}\n`)
        || (host && new RegExp(`\\n(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1)\\s+${host.replace(/\./g, '\\.')}\\s`).test(q.text)))?.name);
    }
    return herkunft.get(zeile);
  };

  return {
    name: o.profil ? `${o.profil}${o.listen?.length || regeln.length ? ' + eigene' : ''}` : 'eigene Listen',
    listen: [
      ...geladen.map((g) => g.liste),
      ...(regeln.length ? [{ name: 'Regeln aus dem Test', quelle: 'stageOptionen.adblocker.regeln', stand: `${regeln.length} Regel(n)` }] : []),
    ],
    pruefe(url, typ, seite) {
      const ergebnis = engine.match(Request.fromRawDetails({ url, sourceUrl: seite, type: anfrageTyp(typ) }));
      if (!ergebnis.match) return undefined;
      const filter: string = ergebnis.filter?.rawLine ?? ergebnis.filter?.toString() ?? '(unbekannte Regel)';
      const liste = listeVon(filter);
      return ergebnis.redirect ? { filter, liste, ersatz: ersatzFuer(filter) } : { filter, liste };
    },
  };
}

/** Ressourcentypen von Playwright und sec-fetch-dest des Proxys auf die Typen der Filterlisten abbilden. */
function anfrageTyp(typ: string): string {
  switch (typ) {
    case 'iframe': case 'frame': case 'sub_frame': return 'sub_frame';
    case 'empty': case 'fetch': case 'xhr': return 'xhr';
    case 'style': case 'stylesheet': return 'stylesheet';
    case 'audio': case 'video': case 'track': case 'media': case 'texttrack': return 'media';
    case 'worker': case 'sharedworker': case 'serviceworker': case 'script': return 'script';
    case 'beacon': return 'ping';
    case 'image': case 'font': case 'ping': case 'websocket': return typ;
    default: return 'other';
  }
}
