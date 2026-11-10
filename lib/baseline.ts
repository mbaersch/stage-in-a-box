/**
 * Baseline: speichert den Ist-Zustand einer Journey und vergleicht spätere Läufe dagegen.
 *
 * Erfasst werden dataLayer-Events, Consent-Befehle, Tracking-Requests (inkl. Status,
 * Fehlern, Weiterleitungen), alle angefragten Hosts und CSP-Verstöße.
 *
 * Eine Baseline muss mit echten Requests entstehen (Modus "durchlassen"). Abgefangene
 * Requests bekommen keine echte Antwort, Weiterleitungsketten und von einem sGTM
 * ausgelöste Folge-Requests würden fehlen. Verglichen wird nur im selben Modus.
 *
 * Bewertung:
 *   rot (Test schlägt fehl)
 *     - Request fehlt, ist mehrfach vorhanden, wurde blockiert oder scheiterte
 *     - Consent-Parameter eines Requests geändert (gcs, gcd, …)
 *     - dataLayer-Event fehlt oder ist mehrfach vorhanden
 *     - Key fehlt, der in der Baseline vorhanden war
 *     - jede Abweichung innerhalb von "ecommerce"
 *     - Consent-Befehle im dataLayer geändert
 *     - CSP-Verstoß
 *   info (nur im Bericht)
 *     - neue Requests, neue Hosts, neue oder geänderte Request-Parameter
 *     - neue dataLayer-Events, neue Keys, geänderte Werte außerhalb von "ecommerce"
 *     - geänderte Reihenfolge der Events
 *     - neue oder weggefallene Requests ohne Regel (Fetch/XHR/Beacon, z. B. Tracking über eigene Pfade)
 *
 * Verglichen wird nur bei gleichem Modus, gleichem Tempo, mit bzw. ohne Proxy (siehe lib/tempo.ts). Vor der
 * Momentaufnahme wird die letzte Seite verlassen, damit Requests beim Verlassen enthalten sind.
 *
 * Ablage: baselines/<journey>.json, mit Proxy baselines/<journey>.proxy.json.
 * Neue Baseline: Datei löschen oder `npx playwright test --update-snapshots`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect } from './playwright';
import type { Modus, Stage, Treffer } from './stage';
import type { Tempo } from './tempo';
import { projektOrdner } from './auftrag';

export interface BaselineOptionen {
  /** Zusätzliche dataLayer-Keys, deren Werte sich bei jedem Lauf ändern (Name auf beliebiger Ebene). */
  fluechtigeKeys?: string[];
  /** Zusätzliche Request-Parameter, deren Werte sich bei jedem Lauf ändern. */
  fluechtigeParameter?: string[];
  /**
   * dataLayer-Events, die nicht in jedem Lauf zuverlässig kommen (z. B. ein Bot-Schutz, der mal lädt, mal nicht):
   * Fehlen, Mehrfach und geänderter Inhalt sind nur Hinweise, markiert mit „(optional)“.
   */
  optionaleEvents?: string[];
  /** Request-Parameter, deren Änderung den Test rot macht. Ersetzt die Vorgabe. */
  rotParameter?: string[];
  /** Ablageort relativ zum Projektordner. Vorgabe: baselines */
  verzeichnis?: string;
  /**
   * Vor der Momentaufnahme die letzte Seite verlassen (Vorgabe: true). Erst dabei senden
   * viele Tags ihre letzten Requests, z. B. GA4 user_engagement.
   */
  seiteVerlassen?: boolean;
}

/** dataLayer-Keys, die sich bei jedem Lauf ändern; werden nur auf Vorhandensein geprüft. */
export const FLUECHTIGE_KEYS = [
  'gtm.uniqueEventId', 'gtm.start', 'gtm.triggers', 'eventCallback', 'eventTimeout',
  'transaction_id', 'event_id', 'timestamp',
];

/** Request-Parameter, die sich bei jedem Lauf ändern (Client-, Session-, Zufalls- und Zeitwerte). */
export const FLUECHTIGE_PARAMETER = [
  // GA4
  'cid', 'sid', 'sct', 'seg', '_p', '_s', '_et', '_fv', '_ss', '_nsi', '_c', '_ee', '_z', '_gaz', 'tfd', 'gtm',
  'ep.transaction_id', 'ep.event_id', 'uaa', 'uab', 'uafvl', 'uamb', 'uam', 'uap', 'uapv', 'uaw', 'frm', 'pscdl',
  'rcb', 'tag_exp', 'ecid', 'epn.config_timing', 'epn.event_timing', 'evnid', '_is_sw',
  // GA4 über sGTM (Zufallswert, Zeitstempel)
  'sst.rnd', 'sst.tft',
  // Google Ads / Floodlight
  'rnd', 'random', 'ord', 'auid', 'gclid', 'gclaw', 'num', 'u_tz', 'u_his', 'u_h', 'u_w', 'u_ah', 'u_aw', 'u_cd',
  'bttype', 'fst', 'oid', 'transaction_id', 'gacid', 'cerd', 'crd', 'fsk', 'pscrd', 'tft', 'ecsid2', 'eoid', 'eitems', '_gsid',
  'rmt_tld', // folgt dem Host (Länderdomain ja/nein)
  'dc_random', 'auiddc', 'dc_pre', '_dc_ptd', '_dc_unique_id', '_dc_time',
  // Microsoft Ads (UET)
  'mid', 'vid', 'rn', 'lt',
  // Piwik PRO (Zeit-, Zufalls- und Besucherwerte; Timings t_* über FLUECHTIGE_MUSTER)
  'r', 'h', 'm', 's', '_id', '_idts', '_viewts', 'gt_ms', 'pv_id', 'cdt',
  // Meta und andere
  'ts', 'eid', 'it', 'coo', 'rqm', 'ec', 'o', 'timestamp', 'fbp', 'fbc', 'fbcs', 'plt',
  // LinkedIn Insight
  'time', 'pageLoadId', 'cb', 'eventId',
  // Reddit
  'uuid',
];

/** Wie FLUECHTIGE_PARAMETER, für Familien von Parametern. */
// expv2[n]: Experiment-Zuteilungen des Meta-Pixels, wechseln zwischen Läufen
export const FLUECHTIGE_MUSTER = [/^t_[a-z]{2}$/, /^expv2\[\d+\]$/];

/** Request-Parameter, deren Änderung als rot gilt: Consent-Signale. */
export const ROT_PARAMETER = ['gcs', 'gcd', 'npa', 'dma', 'dma_cps'];

/**
 * Begleit-Requests, geprüft gegen host + pfad: Cookie-Abgleich, Kopien über ccm und Weiterleitungs-Hops
 * bei Google, Uploads von Sitzungsaufzeichnungen (Clarity), deren Anzahl von der Verweildauer abhängt.
 * Abweichende Anzahl nur als Hinweis; Consent-Parameter bleiben rot.
 */
export const BEGLEIT_PFADE = [/\/ccm\//, /\/pagead\/1p-/, /\/rmkt\/collect/, /\/measurement\/1p-conversion/, /clarity\.ms\/collect/];

/**
 * Timing-abhängige Requests: Heartbeats von Matomo/Piwik PRO (ping, Piwik PRO z. B. ping=5) und GA4
 * user_engagement, das beim Verlassen nur nach genug Interaktionszeit kommt. Anzahl nur als Hinweis.
 */
const istTimingAbhaengig = (p: Record<string, string>) => p.ping !== undefined || p.en === 'user_engagement';

interface BaselineEvent { name: string; quelle: 'push' | 'gtag'; daten: Record<string, unknown> }

interface BaselineAnfrage {
  schluessel: string;
  dienst: string;
  methode: string;
  host: string;
  pfad: string;
  parameter: Record<string, string>;
  status?: number;
  fehler?: string;
  umleitung: boolean;
}

export interface Baseline {
  version: 1;
  journey: string;
  erstellt: string;
  modus: Modus;
  tempo: Tempo;
  /** Lauf über den Stage-Proxy (sieht mehr Requests als Playwright allein) */
  proxy?: boolean;
  baseUrl?: string;
  events: BaselineEvent[];
  consent: string[];
  anfragen: BaselineAnfrage[];
  hosts: string[];
  /** Je Host, was den ersten Request ausgelöst hat (siehe TrackingProtokoll.ausloeser) */
  ausloeser?: Record<string, string>;
  /** Cookies am Ende der Journey, als „Name (Domain)“ */
  cookies?: string[];
  /**
   * Nur mit stageOptionen.pruefungen.cookies: Cookies, die vor der Consent-Entscheidung gesetzt
   * wurden, als „Muster (Domain)“. Ein neues Cookie hier ist rot.
   */
  cookiesVorConsent?: string[];
  /** Requests ohne Regel (Fetch/XHR/Beacon), als „METHODE host/pfad“ mit # für Ziffernfolgen */
  weitere?: string[];
  cspVerstoesse: string[];
}

export interface Befund {
  stufe: 'rot' | 'info';
  /** "Neu im Netzwerk": neue Domains und Requests ohne Regel – mögliches neues Tracking, im Bericht eigener Abschnitt */
  bereich: 'dataLayer' | 'Consent' | 'Requests' | 'Hosts' | 'Cookies' | 'CSP' | 'Neu im Netzwerk';
  text: string;
}

/** Grobe Näherung an die registrierbare Domain (letzte zwei Labels). */
const GOOGLE_LAENDERDOMAIN = /(^|\.)google\.(com?\.)?[a-z]{2,3}$/;
const basisDomain = (host: string) => {
  const h = host.split(':')[0];
  // Google schickt denselben Request mal an google.com, mal an die Länderdomain (google.de, google.co.uk)
  return GOOGLE_LAENDERDOMAIN.test(h) ? 'google.*' : h.split('.').slice(-2).join('.');
};

/* ------------------------------------------------------------------ */
/* Momentaufnahme aus einem Lauf                                      */
/* ------------------------------------------------------------------ */

function sortiert(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortiert);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortiert((obj as any)[k])]));
  }
  return obj;
}

/** Testwerte der Landung (TEST-sib-<id>-<Zeit>) unterscheiden sich je Lauf nur in der Zeit. */
export const ohneTestzeit = <T>(v: T): T =>
  (typeof v === 'string' ? v.replace(/(TEST-sib-[a-z_]+)-\d{10,}/gi, '$1-‹zeit›') as T : v);

export function bodyParameter(body?: string): Record<string, string> {
  if (!body) return {};
  // multipart/form-data (z. B. Meta über das Stape-Tag): Teile mit name="…"; die Boundary ist je Lauf neu
  const grenze = body.match(/^--([^\r\n]+)\r?\n/)?.[1];
  if (grenze) {
    const p: Record<string, string> = {};
    for (const teil of body.split(`--${grenze}`)) {
      const m = teil.match(/name="([^"]+)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n?$/);
      if (m) p[m[1]] = m[2];
    }
    return p;
  }
  // JSON und Binär-Bodies (z. B. komprimiert bei Clarity) sind keine Formular-Parameter
  if (/^\s*[[{]/.test(body) || !body.includes('=') || /[\x00-\x08\x0e-\x1f�]/.test(body)) return {};
  try {
    const p = Object.fromEntries(new URLSearchParams(body));
    // Base64 o. Ä. mit "=" am Ende (LinkedIn /wa/) ist kein Formular: Schlüssel wären der ganze Body
    return Object.keys(p).every((k) => /^[\w.\-[\]%]{1,64}$/.test(k)) ? p : {};
  } catch {
    return {};
  }
}

/** Name des Ereignisses in einem Request, unabhängig vom Dienst. */
function ereignisname(p: Record<string, string>, pfad: string): string {
  // e_a: Event-Aktion bei Matomo/Piwik PRO
  // cat: Aktivität bei Floodlight
  return p.en ?? p.ev ?? p.event ?? p.event_name ?? p.e_a ?? p.label ?? p.cat ?? pfad;
}

const BEGLEIT = '(Begleit) ';
const TIMING = '(Timing) ';
/** Gruppen, deren Anzahl schwanken darf: Abweichungen nur als Hinweis. */
const nurHinweis = (k: string) => k.startsWith(BEGLEIT) || k.startsWith(TIMING);

/**
 * Konto bzw. Property, an das ein Request geht: GA4/Google tid, UET ti, Piwik idsite, LinkedIn pid, Meta id,
 * sonst eine Konto-ID im Pfad (Google Ads /pagead/conversion/<id>/). Gehört in den Schlüssel, damit ein
 * Wechsel des Empfängers als fehlender bzw. neuer Request auffällt und nicht nur als geänderter Parameter.
 */
function konto(p: Record<string, string>, pfad: string): string {
  // src: Floodlight-Konfiguration
  return p.tid ?? p.ti ?? p.idsite ?? p.pid ?? p.id ?? p.src ?? pfad.match(/\/(\d{6,})(\/|$)/)?.[1] ?? '';
}

/** Vergleichsschlüssel: Dienst, Ereignis, Pfad (IDs als #) und Konto. Wird beim Vergleich neu
 * berechnet, damit ältere Baselines mit anderem Schlüssel vergleichbar bleiben. */
function schluessel(a: Pick<BaselineAnfrage, 'dienst' | 'parameter' | 'host' | 'pfad' | 'umleitung'>): string {
  const pfad = a.pfad.replace(/\d{3,}|[a-f0-9]{16,}/gi, '#');
  const art = istTimingAbhaengig(a.parameter) ? TIMING
    : a.umleitung || BEGLEIT_PFADE.some((m) => m.test(a.host + a.pfad)) ? BEGLEIT : '';
  const empfaenger = konto(a.parameter, a.pfad);
  return `${art}${a.dienst} · ${ereignisname(a.parameter, a.pfad)} · ${pfad}${empfaenger ? ` · ${empfaenger}` : ''}`;
}

function anfragenAus(treffer: Treffer[]): BaselineAnfrage[] {
  const out: BaselineAnfrage[] = [];
  for (const t of treffer) {
    const gemeinsam = {
      dienst: t.dienst, methode: t.methode, host: t.host, pfad: t.pfad,
      status: t.status, fehler: t.fehler, umleitung: !!t.umleitungVon,
    };
    // GA4 bündelt mehrere Ereignisse in einem Request: jede Body-Zeile ist ein Ereignis.
    const zeilen = t.dienst === 'GA4' && t.body ? t.body.split(/\r?\n/).filter(Boolean) : [null];
    for (const zeile of zeilen) {
      const parameter = { ...t.parameter, ...(zeile === null ? bodyParameter(t.body) : bodyParameter(zeile)) };
      out.push({ ...gemeinsam, parameter, schluessel: schluessel({ ...gemeinsam, parameter }) });
    }
  }
  return out;
}

export function momentaufnahme(stage: Stage, journey: string, cookies?: string[]): Baseline {
  const events: BaselineEvent[] = [];
  const consent: string[] = [];
  for (const e of stage.dataLayer.eintraege) {
    const d = e.daten;
    if (Array.isArray(d)) {
      if (d[0] === 'consent') consent.push(`${d[1]} ${JSON.stringify(sortiert(d[2] ?? {}))}`);
      else if (d[0] === 'event' && typeof d[1] === 'string') events.push({ name: d[1], quelle: 'gtag', daten: (d[2] ?? {}) as Record<string, unknown> });
    } else if (d && typeof d === 'object' && typeof d.event === 'string' && !d.event.startsWith('gtm.')) {
      const { event, ...rest } = d;
      events.push({ name: event, quelle: 'push', daten: rest });
    }
  }
  return {
    version: 1,
    journey,
    erstellt: new Date().toISOString(),
    modus: stage.modus,
    tempo: stage.tempo,
    proxy: stage.mitProxy,
    baseUrl: stage.testInfo.project.use.baseURL,
    events,
    consent,
    anfragen: anfragenAus(stage.tracking.treffer),
    hosts: [...stage.tracking.hosts].sort(),
    ausloeser: Object.fromEntries([...(stage.tracking.ausloeser ?? new Map())].sort()),
    cookies,
    cookiesVorConsent: stage.cookieEintraege
      ?.filter((c) => c.zuerstGesetzt === 'vor Consent').map((c) => `${c.muster} (${c.domain})`).sort(),
    weitere: stage.tracking.weitere.map((w) => `${w.methode} ${w.host}${w.pfad.replace(/\d{3,}|[a-f0-9]{16,}/gi, '#')}`),
    cspVerstoesse: [...new Set(stage.cspVerstoesse.map((v) => `${v.direktive}: ${v.blockiert}`))],
  };
}

/* ------------------------------------------------------------------ */
/* Vergleich                                                          */
/* ------------------------------------------------------------------ */

function gruppiere<T>(liste: T[], schluessel: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of liste) {
    const k = schluessel(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

/** Flacht ein Objekt zu Pfad → Wert ab; flüchtige Keys werden mit Platzhalter erfasst. */
function flach(obj: unknown, fluechtig: Set<string>, praefix = '', out: Record<string, unknown> = {}) {
  if (obj && typeof obj === 'object') {
    const eintraege = Array.isArray(obj) ? obj.map((v, i) => [String(i), v] as const) : Object.entries(obj);
    if (eintraege.length === 0) out[praefix] = Array.isArray(obj) ? '[]' : '{}';
    for (const [k, v] of eintraege) {
      const pfad = praefix ? `${praefix}.${k}` : k;
      if (fluechtig.has(k)) out[pfad] = '‹flüchtig›';
      else flach(v, fluechtig, pfad, out);
    }
  } else {
    out[praefix] = obj;
  }
  return out;
}

const zeige = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

function anzahlBefunde(
  bereich: Befund['bereich'], basis: Map<string, unknown[]>, lauf: Map<string, unknown[]>, art: string,
  optional: Set<string> = new Set(),
): Befund[] {
  const befunde: Befund[] = [];
  for (const [k, b] of basis) {
    const r = lauf.get(k)?.length ?? 0;
    const stufe = nurHinweis(k) || optional.has(k) ? 'info' : 'rot';
    const zusatz = optional.has(k) ? ' (optional)' : '';
    if (r === 0) befunde.push({ stufe, bereich, text: `${art} fehlt: ${k}${zusatz}` });
    else if (r < b.length) befunde.push({ stufe, bereich, text: `${art} fehlt teilweise: ${k} (${r} statt ${b.length})${zusatz}` });
    else if (r > b.length) befunde.push({ stufe, bereich, text: `${art} mehrfach: ${k} (${r} statt ${b.length})${zusatz}` });
  }
  for (const [k, r] of lauf) {
    if (!basis.has(k)) befunde.push({ stufe: 'info', bereich, text: `Neu: ${k} (${r.length}×)` });
  }
  return befunde;
}

export function vergleiche(basis: Baseline, lauf: Baseline, optionen: BaselineOptionen = {}): Befund[] {
  const befunde: Befund[] = [];
  const fluechtigeKeys = new Set([...FLUECHTIGE_KEYS, ...(optionen.fluechtigeKeys ?? [])]);
  const fluechtigeParameter = new Set([...FLUECHTIGE_PARAMETER, ...(optionen.fluechtigeParameter ?? [])]);
  const rotParameter = new Set(optionen.rotParameter ?? ROT_PARAMETER);
  const optional = new Set(optionen.optionaleEvents ?? []);

  // dataLayer-Events
  const evBasis = gruppiere(basis.events, (e) => e.name);
  const evLauf = gruppiere(lauf.events, (e) => e.name);
  befunde.push(...anzahlBefunde('dataLayer', evBasis, evLauf, 'Event', optional));
  for (const [name, liste] of evBasis) {
    const andere = evLauf.get(name) ?? [];
    const inhalt = befunde.length;
    for (let i = 0; i < Math.min(liste.length, andere.length); i++) {
      const nr = liste.length > 1 ? ` #${i + 1}` : '';
      const a = flach(liste[i].daten, fluechtigeKeys);
      const b = flach(andere[i].daten, fluechtigeKeys);
      for (const pfad of Object.keys(a)) {
        const ecommerce = pfad.startsWith('ecommerce.');
        if (!(pfad in b)) {
          befunde.push({ stufe: 'rot', bereich: 'dataLayer', text: `${name}${nr}: Key fehlt: ${pfad}` });
        } else if (JSON.stringify(ohneTestzeit(a[pfad])) !== JSON.stringify(ohneTestzeit(b[pfad]))) {
          befunde.push({
            stufe: ecommerce ? 'rot' : 'info', bereich: 'dataLayer',
            text: `${name}${nr}: ${pfad} geändert: ${zeige(a[pfad])} → ${zeige(b[pfad])}`,
          });
        }
      }
      for (const pfad of Object.keys(b)) {
        if (!(pfad in a)) {
          befunde.push({
            stufe: pfad.startsWith('ecommerce.') ? 'rot' : 'info', bereich: 'dataLayer',
            text: `${name}${nr}: neuer Key: ${pfad} = ${zeige(b[pfad])}`,
          });
        }
      }
    }
    if (optional.has(name)) for (const x of befunde.slice(inhalt)) { x.stufe = 'info'; x.text += ' (optional)'; }
  }
  const reihenfolge = (b: Baseline) => b.events.map((e) => e.name).filter((n) => evBasis.has(n) && evLauf.has(n));
  if (JSON.stringify(reihenfolge(basis)) !== JSON.stringify(reihenfolge(lauf))) {
    befunde.push({
      stufe: 'info', bereich: 'dataLayer',
      text: `Reihenfolge der Events geändert: ${reihenfolge(basis).join(' → ')} ⟶ ${reihenfolge(lauf).join(' → ')}`,
    });
  }

  // Consent-Befehle
  if (JSON.stringify(basis.consent) !== JSON.stringify(lauf.consent)) {
    befunde.push({
      stufe: 'rot', bereich: 'Consent',
      text: `Consent-Befehle geändert:\n  Baseline: ${basis.consent.join('\n            ') || '–'}\n  Jetzt:    ${lauf.consent.join('\n            ') || '–'}`,
    });
  }

  // Requests
  const rqBasis = gruppiere(basis.anfragen, schluessel);
  const rqLauf = gruppiere(lauf.anfragen, schluessel);
  befunde.push(...anzahlBefunde('Requests', rqBasis, rqLauf, 'Request'));
  const gescheitert = (a: BaselineAnfrage) => !!a.fehler || (a.status !== undefined && a.status >= 400);
  for (const [k, liste] of rqLauf) {
    const vorher = rqBasis.get(k) ?? [];
    liste.forEach((a, i) => {
      const nr = liste.length > 1 ? ` #${i + 1}` : '';
      const b = vorher[i];
      if (gescheitert(a) && (!b || !gescheitert(b))) {
        befunde.push({ stufe: 'rot', bereich: 'Requests', text: `${k}${nr}: blockiert/gescheitert (${a.fehler ?? `HTTP ${a.status}`})` });
      }
      if (!b) return;
      // Wechsel zwischen Hosts derselben Domain (z. B. Clarity: a.clarity.ms, o.clarity.ms) ist Lastverteilung
      if (basisDomain(a.host) !== basisDomain(b.host)) befunde.push({ stufe: 'info', bereich: 'Requests', text: `${k}${nr}: Host geändert: ${b.host} → ${a.host}` });
      // Flüchtige Parameter kommen und gehen auch (z. B. Timings, Sitzungs-IDs); Consent-Parameter nie flüchtig
      const fluechtig = (p: string) => !rotParameter.has(p) && (fluechtigeParameter.has(p) || FLUECHTIGE_MUSTER.some((m) => m.test(p)));
      for (const p of Object.keys(b.parameter)) {
        if (!(p in a.parameter)) {
          if (!fluechtig(p)) befunde.push({ stufe: rotParameter.has(p) ? 'rot' : 'info', bereich: 'Requests', text: `${k}${nr}: Parameter fehlt: ${p}` });
        } else if (!fluechtig(p) && ohneTestzeit(a.parameter[p]) !== ohneTestzeit(b.parameter[p])) {
          befunde.push({
            stufe: rotParameter.has(p) ? 'rot' : 'info', bereich: 'Requests',
            text: `${k}${nr}: ${p} geändert: ${zeige(b.parameter[p])} → ${zeige(a.parameter[p])}`,
          });
        }
      }
      for (const p of Object.keys(a.parameter)) {
        if (!(p in b.parameter) && !fluechtig(p)) befunde.push({ stufe: 'info', bereich: 'Requests', text: `${k}${nr}: neuer Parameter: ${p}` });
      }
    });
  }

  // Dienste, die in der Baseline gar nicht vorkamen (z. B. nach einem Rollback oder ein fremdes Tag)
  const diensteVorher = new Set(basis.anfragen.map((a) => a.dienst));
  for (const [dienst, liste] of gruppiere(lauf.anfragen, (a) => a.dienst)) {
    if (!diensteVorher.has(dienst)) befunde.push({ stufe: 'rot', bereich: 'Requests', text: `Neuer Dienst: ${dienst} (${liste.length} Request(s), in der Baseline nicht vorhanden)` });
  }

  // Hosts; Wechsel innerhalb derselben Domain (Lastverteilung, z. B. a.clarity.ms → p.clarity.ms) ist kein Befund
  const domainsVorher = new Set(basis.hosts.map(basisDomain));
  const domainsJetzt = new Set(lauf.hosts.map(basisDomain));
  for (const h of lauf.hosts) {
    const von = lauf.ausloeser?.[h];
    if (!domainsVorher.has(basisDomain(h))) befunde.push({ stufe: 'info', bereich: 'Neu im Netzwerk', text: `Neue Domain: ${h}${von ? ` (ausgelöst von: ${von})` : ''}` });
  }
  for (const h of basis.hosts) {
    if (!domainsJetzt.has(basisDomain(h))) befunde.push({ stufe: 'info', bereich: 'Hosts', text: `Domain nicht mehr angefragt: ${h}` });
  }

  // Requests ohne Regel: nur Hinweise, aber ein Grund, über eine neue Regel nachzudenken
  const weitereVorher = gruppiere(basis.weitere ?? [], (w) => w);
  const weitereJetzt = gruppiere(lauf.weitere ?? [], (w) => w);
  for (const [k, liste] of weitereJetzt) {
    if (!weitereVorher.has(k)) befunde.push({ stufe: 'info', bereich: 'Neu im Netzwerk', text: `Neuer Request ohne Regel: ${k} (${liste.length}×)` });
  }
  for (const [k] of weitereVorher) {
    if (!weitereJetzt.has(k)) befunde.push({ stufe: 'info', bereich: 'Requests', text: `Request ohne Regel nicht mehr vorhanden: ${k}` });
  }

  // Cookies (nur wenn beide Momentaufnahmen sie kennen; ältere Baselines haben keine)
  if (basis.cookies && lauf.cookies) {
    const vorher = new Set(basis.cookies), jetzt = new Set(lauf.cookies);
    for (const c of jetzt) if (!vorher.has(c)) befunde.push({ stufe: 'info', bereich: 'Neu im Netzwerk', text: `Neues Cookie: ${c}` });
    for (const c of vorher) if (!jetzt.has(c)) befunde.push({ stufe: 'info', bereich: 'Cookies', text: `Cookie nicht mehr gesetzt: ${c}` });
  }
  // Cookies vor der Consent-Entscheidung (nur wenn beide Läufe das Cookie-Protokoll hatten)
  if (basis.cookiesVorConsent && lauf.cookiesVorConsent) {
    const vorher = new Set(basis.cookiesVorConsent);
    for (const c of lauf.cookiesVorConsent) {
      if (!vorher.has(c)) befunde.push({ stufe: 'rot', bereich: 'Cookies', text: `Neues Cookie vor der Consent-Entscheidung: ${c}` });
    }
    const jetzt = new Set(lauf.cookiesVorConsent);
    for (const c of basis.cookiesVorConsent) {
      if (!jetzt.has(c)) befunde.push({ stufe: 'info', bereich: 'Cookies', text: `Cookie nicht mehr vor der Consent-Entscheidung gesetzt: ${c}` });
    }
  }

  // CSP: Verstöße, die schon die Baseline hatte (z. B. durch die CSP der Website selbst), sind kein neuer Fehler
  const cspVorher = new Set(basis.cspVerstoesse ?? []);
  for (const v of lauf.cspVerstoesse) {
    befunde.push(cspVorher.has(v)
      ? { stufe: 'info', bereich: 'CSP', text: `CSP-Verstoß wie in der Baseline: ${v}` }
      : { stufe: 'rot', bereich: 'CSP', text: `CSP-Verstoß: ${v}` });
  }

  return befunde;
}

/* ------------------------------------------------------------------ */
/* Bericht                                                            */
/* ------------------------------------------------------------------ */

export function bericht(basis: Baseline, lauf: Baseline, befunde: Befund[]): string {
  const rot = befunde.filter((b) => b.stufe === 'rot');
  const neuImNetz = befunde.filter((b) => b.stufe === 'info' && b.bereich === 'Neu im Netzwerk');
  const info = befunde.filter((b) => b.stufe === 'info' && b.bereich !== 'Neu im Netzwerk');
  const liste = (bs: Befund[]) => bs.map((b) => `- **${b.bereich}:** ${b.text.replace(/\n/g, '\n  ')}`).join('\n');
  return [
    `# Baseline-Vergleich: ${basis.journey}`,
    '',
    `Baseline vom ${basis.erstellt} · Lauf vom ${lauf.erstellt} · Modus ${lauf.modus} · Tempo ${lauf.tempo} · ${lauf.proxy ? 'mit' : 'ohne'} Proxy`,
    '',
    `**Ergebnis:** ${rot.length ? `${rot.length} kritische Abweichung(en)` : 'keine kritischen Abweichungen'}, ${info.length} Hinweis(e)`,
    '',
    '## Kritisch',
    '',
    rot.length ? liste(rot) : 'Keine.',
    '',
    ...(neuImNetz.length
      ? ['## Neu im Netzwerk', '', 'Neue Domains, Cookies und Requests ohne Regel: prüfen, ob hier neues Tracking dazugekommen ist.', '', liste(neuImNetz), '']
      : []),
    '## Hinweise',
    '',
    info.length ? liste(info) : 'Keine.',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Ablauf im Test                                                     */
/* ------------------------------------------------------------------ */

/** Läufe mit Proxy sehen mehr Requests und bekommen deshalb eine eigene Baseline-Datei. */
function dateiname(journey: string, mitProxy: boolean) {
  const basis = journey.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  return `${basis}${mitProxy ? '.proxy' : ''}.json`;
}

export async function vergleicheMitBaseline(stage: Stage, journey: string, optionen: BaselineOptionen = {}) {
  const { testInfo } = stage;
  // Baselines eines benannten Auftrags in baselines/<name>/, damit sich gleichnamige Journeys nicht überschreiben
  const projekt = projektOrdner(testInfo);
  const auftrag: string = testInfo.project.metadata?.auftrag ?? '';
  const datei = path.join(projekt, optionen.verzeichnis ?? path.join('baselines', auftrag), dateiname(journey, stage.mitProxy));
  if (stage.adblocker) {
    throw new Error(
      `Baseline "${journey}" nicht mit Adblocker (${stage.adblocker.name}): Er verändert, was gesendet wird. `
      + 'Adblocker-Varianten ohne Baseline-Vergleich laufen lassen (ADBLOCKER=aus bzw. stageOptionen.adblocker entfernen).',
    );
  }
  const lauf = momentaufnahme(stage, journey, (await stage.zustand()).cookies);
  const neu = !fs.existsSync(datei)
    || testInfo.config.updateSnapshots === 'all'
    || testInfo.config.updateSnapshots === 'changed';

  if (neu) {
    if (lauf.modus !== 'durchlassen') {
      throw new Error(
        `Baseline "${journey}" kann nur mit echten Requests entstehen (Modus "durchlassen", aktuell "${lauf.modus}"). `
        + 'Abgefangene Requests bekommen keine echte Antwort, Weiterleitungen und sGTM-Folge-Requests würden fehlen.',
      );
    }
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.writeFileSync(datei, JSON.stringify(lauf, null, 2) + '\n');
    testInfo.annotations.push({ type: 'Baseline', description: `neu gespeichert: ${path.relative(projekt, datei)}` });
    await testInfo.attach('baseline.json', { body: JSON.stringify(lauf, null, 2), contentType: 'application/json' });
    // Eine Baseline mit gescheiterten Requests oder CSP-Verstößen hält einen Fehlerzustand fest.
    const probleme = [
      ...lauf.anfragen.filter((a) => a.fehler || (a.status ?? 0) >= 400).map((a) => `${a.schluessel}: ${a.fehler ?? `HTTP ${a.status}`}`),
      ...lauf.cspVerstoesse.map((v) => `CSP: ${v}`),
    ];
    expect(probleme, 'Baseline gespeichert, enthält aber gescheiterte Requests oder CSP-Verstöße – bitte prüfen').toEqual([]);
    return { neu: true, befunde: [] as Befund[] };
  }

  const basis = JSON.parse(fs.readFileSync(datei, 'utf8')) as Baseline;
  if (basis.modus !== lauf.modus) {
    throw new Error(`Baseline "${journey}" wurde im Modus "${basis.modus}" erstellt, dieser Lauf nutzt "${lauf.modus}". Vergleich nur im selben Modus möglich.`);
  }
  if (!!basis.proxy !== !!lauf.proxy) {
    throw new Error(
      `Baseline "${journey}" wurde ${basis.proxy ? 'mit' : 'ohne'} Proxy erstellt, dieser Lauf ${lauf.proxy ? 'mit' : 'ohne'}. `
      + 'Mit Proxy werden mehr Requests sichtbar (Beacons beim Verlassen, Service Worker). PROXY anpassen oder Baseline neu erstellen.',
    );
  }
  // Ältere Baselines ohne Tempo gelten als "schnell".
  const basisTempo = basis.tempo ?? 'schnell';
  if (basisTempo !== lauf.tempo) {
    throw new Error(
      `Baseline "${journey}" wurde mit Tempo "${basisTempo}" erstellt, dieser Lauf nutzt "${lauf.tempo}". `
      + 'Zeitabhängige Requests (z. B. user_engagement) wären nicht vergleichbar. TEMPO anpassen oder Baseline neu erstellen.',
    );
  }
  const befunde = vergleiche(basis, lauf, optionen);
  const text = bericht(basis, lauf, befunde);
  // Als Datei in test-results/, damit der Bericht auch bei grünen Tests nachlesbar ist.
  const berichtDatei = testInfo.outputPath('baseline-vergleich.md');
  fs.writeFileSync(berichtDatei, text);
  await testInfo.attach('baseline-vergleich.md', { path: berichtDatei, contentType: 'text/markdown' });
  // Für Offline-Abgleiche mit vergleiche(), ohne erneut echte Requests zu senden.
  fs.writeFileSync(testInfo.outputPath('momentaufnahme.json'), JSON.stringify(lauf, null, 2) + '\n');
  const info = befunde.filter((b) => b.stufe === 'info').length;
  if (info) testInfo.annotations.push({ type: 'Baseline-Hinweise', description: `${info} Hinweis(e), siehe baseline-vergleich.md` });
  const rot = befunde.filter((b) => b.stufe === 'rot').map((b) => `${b.bereich}: ${b.text}`);
  expect(rot, `Kritische Abweichungen von der Baseline "${journey}" (Details: Anhang baseline-vergleich.md)`).toEqual([]);
  return { neu: false, befunde };
}
