/**
 * Stage in a Box – Testumgebung für Tracking-Setups auf Basis von Playwright.
 *
 * Stellt pro Test bereit:
 * - dataLayer-Protokoll: jeder Push (auch gtag()-Befehle) über alle Seitenwechsel hinweg
 * - Tracking-Protokoll: alle Requests an bekannte Dienste mit Status, Fehlern und
 *   Weiterleitungsketten; dazu alle angefragten Hosts
 * - Regeln: Dienste oder Scripts abfangen, blockieren, durchlassen oder verzögern
 *   (z. B. um Ladereihenfolgen von CMP und GTM zu simulieren)
 * - CSP-Simulation: eine geplante Content Security Policy testen, bevor sie live geht
 * - Baseline: Ist-Zustand speichern und spätere Läufe dagegen vergleichen (lib/baseline.ts)
 * - Tempo: Pausen zwischen den Schritten wie ein Mensch bzw. wie aufgezeichnet (lib/tempo.ts)
 * - NetLog-Abgleich: Requests beim Verlassen einer Seite, die Playwright nicht sieht (lib/netlog.ts)
 *
 * Verwendung in Tests:
 *   import { test, expect } from '../lib/stage';
 *   test('...', async ({ page, stage }) => { ... });
 *
 * Varianten pro describe-Block:
 *   test.use({ stageOptionen: { regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }] } });
 */
import { test as base, expect, type BrowserContext, type Page, type Route, type Request, type TestInfo } from '@playwright/test';
import { vergleicheMitBaseline, type BaselineOptionen } from './baseline';
import { pausenDauer, tempoAusUmgebung, type Tempo } from './tempo';
import { leseNetlog } from './netlog';

export type { Tempo } from './tempo';

/* ------------------------------------------------------------------ */
/* Typen                                                              */
/* ------------------------------------------------------------------ */

export type Modus = 'abfangen' | 'blockieren' | 'durchlassen';

export interface Regel {
  /** Name für Protokoll und Berichte, z. B. "GA4". */
  name: string;
  /** Wird gegen die vollständige Request-URL geprüft. */
  muster: RegExp;
  /**
   * abfangen: Request wird mit 204 beantwortet und verlässt den Browser nie.
   *   Folge-Requests (Weiterleitungen, von einem sGTM ausgelöste Pixel) entstehen dann nicht.
   * blockieren: Request wird abgebrochen (wie durch einen Adblocker).
   * durchlassen: Request wird echt gesendet.
   * Ohne Angabe gilt der Tracking-Modus (Option trackingModus bzw. TRACKING_MODUS).
   */
  modus?: Modus;
  /** Request um diese Zeit verzögern (Ladereihenfolgen simulieren). */
  verzoegerungMs?: number;
  /** Nur steuern, aber nicht als Tracking-Request protokollieren (z. B. Script-Downloads). */
  nichtProtokollieren?: boolean;
}

export interface StageOptionen {
  /** Zusätzliche Regeln; werden vor den Standarddiensten geprüft (erste passende Regel gilt). */
  regeln?: Regel[];
  /** Standardmodus für Tracking-Requests. Vorgabe: Umgebungsvariable TRACKING_MODUS oder 'abfangen'. */
  trackingModus?: Modus;
  /** Name des dataLayers. Vorgabe: 'dataLayer'. */
  dataLayerName?: string;
  /** Diese CSP wird als Response-Header aller Dokumente gesetzt. */
  csp?: string;
  /** 'ersetzen' (Vorgabe) entfernt die CSP der Seite, 'zusaetzlich' ergänzt sie (beide gelten). */
  cspModus?: 'ersetzen' | 'zusaetzlich';
  /** CSP nur melden statt durchsetzen (Content-Security-Policy-Report-Only). */
  cspNurBerichten?: boolean;
  /** Pausen zwischen den Schritten. Vorgabe: Umgebungsvariable TEMPO oder 'schnell'. */
  tempo?: Tempo;
}

export interface DataLayerEintrag {
  /** Laufende Nummer über alle Seiten des Tests. */
  nr: number;
  zeit: number;
  seitenUrl: string;
  /** Inhalt des Pushes. gtag()-Befehle erscheinen als Array, z. B. ['consent', 'update', {...}]. */
  daten: any;
}

export interface Treffer {
  nr: number;
  zeit: number;
  dienst: string;
  /** Modus, mit dem der Request behandelt wurde. */
  modus: Modus;
  methode: string;
  url: string;
  host: string;
  pfad: string;
  ressourcentyp: string;
  /** Query-Parameter der URL. */
  parameter: Record<string, string>;
  /** Roh-Body (POST), falls vorhanden. */
  body?: string;
  /** HTTP-Status, sobald eine Antwort vorliegt (abgefangene Requests: 204). */
  status?: number;
  /** Fehlertext, wenn der Request scheiterte (blockiert, abgebrochen, Netzwerkfehler). */
  fehler?: string;
  /** URL des Requests, der hierher weitergeleitet hat. */
  umleitungVon?: string;
  /** false, solange der Request noch läuft. */
  abgeschlossen: boolean;
  /** browser: von Playwright erfasst; netlog: nur im Netzwerkprotokoll (z. B. Beacon beim Verlassen). */
  quelle: 'browser' | 'netlog';
  /** true: im Modus abfangen/blockieren trotzdem echt gesendet (am Routing vorbei). */
  entwischt?: boolean;
}

/**
 * Ein einzelnes GA4-Ereignis mit allen Parametern (en, gcs, ep.*, epn.*, …) und dem
 * zugehörigen Treffer. Ein Treffer kann mehrere Ereignisse enthalten (Batching im Body).
 */
export interface Ga4Ereignis {
  en: string;
  treffer: Treffer;
  [parameter: string]: any;
}

export interface CspVerstoss {
  zeit: number;
  seitenUrl: string;
  direktive: string;
  blockiert: string;
  quelle?: string;
}

/* ------------------------------------------------------------------ */
/* Bekannte Dienste                                                   */
/* ------------------------------------------------------------------ */

/**
 * Endpunkte gängiger Dienste, an die Messdaten gehen. Script-Downloads gehören nicht
 * hierher. Weitere Endpunkte: tracking-vendors.json im Repo
 * https://github.com/mbaersch/tracking-auditor
 */
export const STANDARD_DIENSTE: Regel[] = [
  // Pfad statt Host, damit auch serverseitiges Tagging auf eigener Domain erfasst wird
  { name: 'GA4', muster: /\/g\/collect(\?|$)/ },
  { name: 'GA4 Measurement Protocol', muster: /google-analytics\.com\/mp\/collect/ },
  { name: 'Google Ads', muster: /googleadservices\.com\/pagead\/conversion|googleads\.g\.doubleclick\.net\/pagead\/(viewthroughconversion|conversion)|google\.[a-z.]+\/pagead\/(1p-)?(conversion|user-list)|\/ccm\/collect/ },
  { name: 'Floodlight', muster: /fls\.doubleclick\.net\/activity|ad\.doubleclick\.net\/activity/ },
  { name: 'Meta', muster: /facebook\.com\/tr([/?]|$)/ },
  { name: 'Microsoft Ads', muster: /bat\.bing\.(com|net)\/action/ },
  { name: 'LinkedIn', muster: /px\.ads\.linkedin\.com\/(collect|wa)/ },
  { name: 'TikTok', muster: /analytics\.tiktok\.com\/api\/v\d\/(pixel|track)/ },
  { name: 'Pinterest', muster: /ct\.pinterest\.com\/(v3|user)/ },
];

/* ------------------------------------------------------------------ */
/* Protokolle                                                         */
/* ------------------------------------------------------------------ */

export class DataLayerProtokoll {
  readonly eintraege: DataLayerEintrag[] = [];

  /** Alle Pushes mit diesem event-Namen (ohne Name: alle mit event-Key). */
  events(name?: string): DataLayerEintrag[] {
    return this.eintraege.filter((e) => e.daten && typeof e.daten === 'object' && !Array.isArray(e.daten)
      && 'event' in e.daten && (name === undefined || e.daten.event === name));
  }

  /** gtag()-Befehle, z. B. befehle('consent') oder befehle('event'). */
  befehle(art?: string): DataLayerEintrag[] {
    return this.eintraege.filter((e) => Array.isArray(e.daten) && (art === undefined || e.daten[0] === art));
  }

  /** Consent-Befehle ('default' oder 'update'). */
  consent(art?: 'default' | 'update'): DataLayerEintrag[] {
    return this.befehle('consent').filter((e) => art === undefined || e.daten[1] === art);
  }

  /**
   * Wartet auf ein Event und liefert den ersten passenden Push ab Index "ab".
   * Mit "ab = protokoll.eintraege.length" vor einer Aktion lassen sich nur neue Events prüfen.
   */
  async erwarteEvent(name: string, optionen: { passt?: (daten: any) => boolean; ab?: number; timeout?: number } = {}) {
    const { passt = () => true, ab = 0, timeout = 10_000 } = optionen;
    let treffer: DataLayerEintrag | undefined;
    await expect.poll(() => {
      treffer = this.events(name).find((e) => e.nr >= ab && passt(e.daten));
      return !!treffer;
    }, { message: `dataLayer-Event "${name}" erwartet`, timeout }).toBe(true);
    return treffer!;
  }

  /** Wartet auf einen Consent-Befehl, dessen Einstellungen die erwarteten Werte enthalten. */
  async erwarteConsent(art: 'default' | 'update', erwartet: Record<string, string>, timeout = 10_000) {
    let treffer: DataLayerEintrag | undefined;
    await expect.poll(() => {
      treffer = this.consent(art).find((e) => Object.entries(erwartet).every(([k, v]) => e.daten[2]?.[k] === v));
      return !!treffer;
    }, { message: `consent ${art} mit ${JSON.stringify(erwartet)} erwartet`, timeout }).toBe(true);
    return treffer!;
  }
}

export class TrackingProtokoll {
  readonly treffer: Treffer[] = [];
  /** Alle Hosts, die während des Tests angefragt wurden (nicht nur Tracking). */
  readonly hosts = new Set<string>();

  von(dienst: string): Treffer[] {
    return this.treffer.filter((t) => t.dienst === dienst);
  }

  /** Requests, die gescheitert sind oder mit HTTP-Fehler beantwortet wurden. */
  fehlgeschlagen(): Treffer[] {
    return this.treffer.filter((t) => t.fehler || (t.status !== undefined && t.status >= 400));
  }

  /** Alle GA4-Ereignisse, Batches aufgelöst; Parameter aus URL und Body-Zeile zusammengeführt. */
  ga4(en?: string): Ga4Ereignis[] {
    const out: Ga4Ereignis[] = [];
    for (const t of this.von('GA4')) {
      const zeilen = t.body ? t.body.split(/\r?\n/).filter(Boolean) : [''];
      for (const zeile of zeilen) {
        const p = { ...t.parameter, ...Object.fromEntries(new URLSearchParams(zeile)), treffer: t } as Ga4Ereignis;
        if (en === undefined || p.en === en) out.push(p);
      }
    }
    return out;
  }

  /** Wartet auf ein GA4-Ereignis und liefert es. */
  async erwarteGa4(en: string, optionen: { passt?: (e: Ga4Ereignis) => boolean; timeout?: number } = {}) {
    const { passt = () => true, timeout = 10_000 } = optionen;
    let treffer: Ga4Ereignis | undefined;
    await expect.poll(() => {
      treffer = this.ga4(en).find(passt);
      return !!treffer;
    }, { message: `GA4-Ereignis "${en}" erwartet`, timeout }).toBe(true);
    return treffer!;
  }

  /** Wartet auf einen Treffer eines Dienstes. */
  async erwarteTreffer(dienst: string, optionen: { passt?: (t: Treffer) => boolean; timeout?: number } = {}) {
    const { passt = () => true, timeout = 10_000 } = optionen;
    let treffer: Treffer | undefined;
    await expect.poll(() => {
      treffer = this.von(dienst).find(passt);
      return !!treffer;
    }, { message: `Treffer an "${dienst}" erwartet`, timeout }).toBe(true);
    return treffer!;
  }
}

export class Stage {
  readonly dataLayer = new DataLayerProtokoll();
  readonly tracking = new TrackingProtokoll();
  readonly cspVerstoesse: CspVerstoss[] = [];

  private readonly start = Date.now();
  private readonly netlogUrls = new Map<string, number>();

  constructor(
    readonly modus: Modus,
    readonly tempo: Tempo,
    readonly testInfo: TestInfo,
    private readonly context: BrowserContext,
    private readonly regelFuer: (url: string) => Regel | undefined,
  ) {}

  /**
   * Ergänzt Requests aus dem NetLog des Browsers, die Playwright nicht gesehen hat
   * (Beacons beim Verlassen einer Seite). Kann mehrfach aufgerufen werden.
   */
  netzwerkAbgleich() {
    const imNetz = new Map<string, number>();
    for (const r of leseNetlog(this.start, Date.now())) {
      const regel = this.regelFuer(r.url);
      if (!regel || regel.nichtProtokollieren) continue;
      const anzahl = (imNetz.get(r.url) ?? 0) + 1;
      imNetz.set(r.url, anzahl);
      // Requests, die Playwright mit echtem Netzwerkzugriff gesehen hat, nicht doppelt zählen
      const bekannt = this.tracking.treffer.filter((t) => t.url === r.url
        && (t.quelle === 'netlog' || (t.modus === 'durchlassen' && !t.fehler))).length;
      if (anzahl <= bekannt) continue;
      const modus = regel.modus ?? this.modus;
      this.tracking.treffer.push({
        nr: this.tracking.treffer.length,
        zeit: r.zeit,
        dienst: regel.name,
        modus: 'durchlassen',
        methode: r.methode ?? 'GET',
        url: r.url,
        ...zerlege(r.url),
        ressourcentyp: 'beacon',
        status: r.status,
        fehler: r.fehler,
        abgeschlossen: true,
        quelle: 'netlog',
        entwischt: modus !== 'durchlassen' || undefined,
      });
    }
  }

  /**
   * Pause zwischen zwei Schritten der Journey, je nach Tempo. Den aufgezeichneten Abstand
   * zum vorherigen Schritt übergeben (steht in der Zeitleiste der Analyse); er wird nur im
   * Tempo "aufzeichnung" verwendet.
   */
  async denkpause(aufgezeichnetMs?: number) {
    const ms = pausenDauer(this.tempo, aufgezeichnetMs);
    if (ms > 0) await pause(ms);
  }

  /**
   * Verlässt die aktuelle Seite wie ein Mensch, der den Tab schließt oder weitersurft.
   * Erst dabei senden viele Tags ihre letzten Requests (z. B. GA4 user_engagement).
   */
  async seiteVerlassen() {
    const seiten = this.context.pages().filter((p: Page) => !p.isClosed());
    const seite = seiten.at(-1);
    if (!seite || seite.url() === 'about:blank') return;
    await seite.goto('about:blank').catch(() => { /* Seite schon geschlossen */ });
  }

  /**
   * Wartet, bis keine Tracking-Requests mehr laufen und eine Weile keine neuen dazukommen.
   * Wichtig vor Auswertungen am Testende: Beacons nach dem letzten Klick sind sonst noch unterwegs.
   */
  async warteAufRuhe(ruheMs = 1500, maxMs = 15_000) {
    const start = Date.now();
    let letzteAnzahl = -1;
    let ruhigSeit = Date.now();
    while (Date.now() - start < maxMs) {
      const anzahl = this.tracking.treffer.length + this.dataLayer.eintraege.length;
      const laufend = this.tracking.treffer.some((t) => !t.abgeschlossen);
      if (anzahl !== letzteAnzahl || laufend) {
        letzteAnzahl = anzahl;
        ruhigSeit = Date.now();
      } else if (Date.now() - ruhigSeit >= ruheMs) {
        break;
      }
      await pause(100);
    }
    this.netzwerkAbgleich();
  }

  /**
   * Speichert beim ersten Lauf (oder mit --update-snapshots) eine Baseline unter
   * baselines/<name>.json und vergleicht spätere Läufe dagegen. Siehe lib/baseline.ts.
   */
  async vergleicheMitBaseline(name: string, optionen: BaselineOptionen = {}) {
    if (optionen.seiteVerlassen !== false) await this.seiteVerlassen();
    await this.warteAufRuhe();
    return vergleicheMitBaseline(this, name, optionen);
  }
}

/* ------------------------------------------------------------------ */
/* Einrichtung                                                        */
/* ------------------------------------------------------------------ */

/**
 * Läuft im Browser vor allen Scripts der Seite. Instrumentiert den dataLayer so,
 * dass jeder Push gemeldet wird, auch nachdem GTM push() ersetzt hat: GTM ruft die
 * vorherige push-Funktion weiterhin auf, die Kette bleibt also erhalten.
 */
function browserSetup(dlName: string) {
  if (window !== window.top) return; // nur Hauptframe
  const melde = (window as any).__stageDataLayer as (daten: string, url: string) => void;
  const meldeCsp = (window as any).__stageCsp as (v: string) => void;

  const serialisiere = (wert: any) => {
    try {
      return JSON.stringify(wert, function (_k, v) {
        if (v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Arguments]') return Array.from(v);
        if (typeof v === 'function') return '[Funktion]';
        if (typeof Element !== 'undefined' && v instanceof Element) return '[Element ' + v.tagName.toLowerCase() + ']';
        if (v === window) return '[Window]';
        return v;
      });
    } catch (e) {
      return JSON.stringify(String(wert));
    }
  };

  const instrumentiere = (arr: any) => {
    if (!Array.isArray(arr) || (arr as any).__stage) return;
    Object.defineProperty(arr, '__stage', { value: true });
    for (const vorhanden of arr) melde(serialisiere(vorhanden), location.href);
    const vorher = arr.push;
    arr.push = function () {
      for (let i = 0; i < arguments.length; i++) melde(serialisiere(arguments[i]), location.href);
      return vorher.apply(arr, arguments as any);
    };
  };

  // Auch "dataLayer = [...]" (Neuzuweisung) wird abgedeckt.
  let aktuell: any = (window as any)[dlName];
  if (aktuell === undefined) {
    aktuell = [];
  }
  instrumentiere(aktuell);
  Object.defineProperty(window, dlName, {
    configurable: true,
    get() { return aktuell; },
    set(neu) { aktuell = neu; instrumentiere(neu); },
  });

  document.addEventListener('securitypolicyviolation', (e) => {
    meldeCsp(JSON.stringify({
      seitenUrl: location.href,
      direktive: e.effectiveDirective || e.violatedDirective,
      blockiert: e.blockedURI,
      quelle: e.sourceFile || undefined,
    }));
  });
}

function zerlege(url: string): { host: string; pfad: string; parameter: Record<string, string> } {
  try {
    const u = new URL(url);
    return { host: u.host, pfad: u.pathname, parameter: Object.fromEntries(u.searchParams) };
  } catch {
    return { host: '', pfad: '', parameter: {} };
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function richteStageEin(context: BrowserContext, testInfo: TestInfo, optionen: StageOptionen = {}): Promise<Stage> {
  const modus: Modus = optionen.trackingModus
    ?? (process.env.TRACKING_MODUS as Modus | undefined)
    ?? 'abfangen';
  const regeln = [...(optionen.regeln ?? []), ...STANDARD_DIENSTE];
  const regelFuer = (url: string) => regeln.find((r) => r.muster.test(url));
  const stage = new Stage(modus, optionen.tempo ?? tempoAusUmgebung(), testInfo, context, regelFuer);

  await context.exposeFunction('__stageDataLayer', (daten: string, url: string) => {
    stage.dataLayer.eintraege.push({ nr: stage.dataLayer.eintraege.length, zeit: Date.now(), seitenUrl: url, daten: JSON.parse(daten) });
  });
  await context.exposeFunction('__stageCsp', (v: string) => {
    stage.cspVerstoesse.push({ zeit: Date.now(), ...JSON.parse(v) });
  });
  await context.addInitScript(browserSetup, optionen.dataLayerName ?? 'dataLayer');

  // Protokoll über Events statt im Routing: so werden auch Weiterleitungsketten erfasst,
  // die das Routing nicht sieht, und Status bzw. Fehler jedes Requests.
  const offen = new Map<Request, Treffer>();
  context.on('request', (request) => {
    const url = request.url();
    const teile = zerlege(url);
    if (teile.host) stage.tracking.hosts.add(teile.host);
    const regel = regelFuer(url);
    if (!regel || regel.nichtProtokollieren) return;
    const treffer: Treffer = {
      nr: stage.tracking.treffer.length,
      zeit: Date.now(),
      dienst: regel.name,
      modus: regel.modus ?? modus,
      methode: request.method(),
      url,
      ...teile,
      ressourcentyp: request.resourceType(),
      body: request.postData() ?? undefined,
      umleitungVon: request.redirectedFrom()?.url(),
      abgeschlossen: false,
      quelle: 'browser',
    };
    stage.tracking.treffer.push(treffer);
    offen.set(request, treffer);
  });
  context.on('requestfinished', async (request) => {
    const treffer = offen.get(request);
    if (!treffer) return;
    offen.delete(request);
    try {
      treffer.status = (await request.response())?.status();
    } catch { /* Antwort nicht mehr verfügbar */ }
    treffer.abgeschlossen = true;
  });
  context.on('requestfailed', (request) => {
    const treffer = offen.get(request);
    if (!treffer) return;
    offen.delete(request);
    treffer.fehler = request.failure()?.errorText ?? 'unbekannter Fehler';
    treffer.abgeschlossen = true;
  });
  // Weiterleitungen beenden den ursprünglichen Request ohne requestfinished.
  context.on('response', (response) => {
    const treffer = offen.get(response.request());
    if (treffer && response.status() >= 300 && response.status() < 400) {
      treffer.status = response.status();
      treffer.abgeschlossen = true;
      offen.delete(response.request());
    }
  });

  // Routing nur einrichten, wenn etwas verändert werden muss. Sobald irgendeine Route aktiv
  // ist, fängt Chromium alle Requests ab, und Beacons mit Weiterleitung verlieren dabei ihre
  // Folge-Requests. Ein reiner Lauf im Modus "durchlassen" (Baseline) bleibt deshalb
  // ohne Routing. Verzögerungen und CSP-Simulation brauchen Routing und können solche
  // Ketten verändern.
  const mussSteuern = (url: URL) => {
    const regel = regelFuer(url.href);
    return !!regel && ((regel.modus ?? modus) !== 'durchlassen' || !!regel.verzoegerungMs);
  };
  const steuerungNoetig = modus !== 'durchlassen'
    || (optionen.regeln ?? []).some((r) => (r.modus && r.modus !== 'durchlassen') || r.verzoegerungMs);
  if (steuerungNoetig) await context.route(mussSteuern, async (route: Route, request: Request) => {
    const regel = regelFuer(request.url())!;
    if (regel.verzoegerungMs) await pause(regel.verzoegerungMs);
    try {
      const m = regel.modus ?? modus;
      if (m === 'blockieren') await route.abort('blockedbyclient');
      else if (m === 'abfangen') await route.fulfill({ status: 204, body: '' });
      else await route.continue();
    } catch {
      // Seite wurde inzwischen geschlossen oder navigiert; Request ist ohnehin erledigt.
    }
  });

  // CSP für Dokumente setzen; Tracking-Requests sind nie betroffen.
  if (optionen.csp) {
    const csp = optionen.csp;
    await context.route((url: URL) => !regelFuer(url.href), async (route: Route, request: Request) => {
      if (request.resourceType() !== 'document') {
        await route.fallback();
        return;
      }
      const antwort = await route.fetch();
      const headers = { ...antwort.headers() };
      if ((optionen.cspModus ?? 'ersetzen') === 'ersetzen') {
        delete headers['content-security-policy'];
        delete headers['content-security-policy-report-only'];
      }
      const name = optionen.cspNurBerichten ? 'content-security-policy-report-only' : 'content-security-policy';
      headers[name] = headers[name] ? `${headers[name]}, ${csp}` : csp;
      await route.fulfill({ response: antwort, headers });
    });
  }

  return stage;
}

/* ------------------------------------------------------------------ */
/* Fixture                                                            */
/* ------------------------------------------------------------------ */

export const test = base.extend<{ stageOptionen: StageOptionen; stage: Stage }>({
  stageOptionen: [{}, { option: true }],
  stage: async ({ context, stageOptionen }, use, testInfo) => {
    const stage = await richteStageEin(context, testInfo, stageOptionen);
    await use(stage);
    stage.netzwerkAbgleich();
    const entwischt = stage.tracking.treffer.filter((t) => t.entwischt);
    if (entwischt.length) {
      testInfo.annotations.push({
        type: 'Achtung',
        description: `${entwischt.length} Tracking-Request(s) beim Verlassen einer Seite echt gesendet, obwohl Modus "${stage.modus}" (siehe tracking-treffer.json, entwischt: true)`,
      });
    }
    // Protokolle hängen am Test-Report und helfen bei der Analyse fehlgeschlagener Tests.
    const json = (v: unknown) => JSON.stringify(v, null, 2);
    await testInfo.attach('dataLayer.json', { body: json(stage.dataLayer.eintraege), contentType: 'application/json' });
    await testInfo.attach('tracking-treffer.json', { body: json(stage.tracking.treffer), contentType: 'application/json' });
    await testInfo.attach('hosts.json', { body: json([...stage.tracking.hosts].sort()), contentType: 'application/json' });
    if (stage.cspVerstoesse.length) {
      await testInfo.attach('csp-verstoesse.json', { body: json(stage.cspVerstoesse), contentType: 'application/json' });
    }
  },
});

export { expect };
