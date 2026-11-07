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
 * - Optional Proxy (PROXY=ein): alle Requests im Netzwerk sehen und steuern, auch Beacons beim
 *   Verlassen einer Seite und Service Worker (lib/proxy.ts)
 *
 * Verwendung in Tests:
 *   import { test, expect } from '../../../lib/stage';   // aus projects/<name>/tests/
 *   test('...', async ({ page, stage }) => { ... });
 *
 * Varianten pro describe-Block:
 *   test.use({ stageOptionen: { regeln: [{ name: 'Meta', muster: /facebook\.com\/tr/, modus: 'blockieren' }] } });
 */
import { test as base, expect, type BrowserContext, type Page, type Route, type Request, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import { vergleicheMitBaseline, type BaselineOptionen } from './baseline';
import { pausenDauer, tempoAusUmgebung, type Tempo } from './tempo';
import { leseNetlog } from './netlog';
import { StageProxy, proxyAusUmgebung, type ProxyRequest } from './proxy';

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
  /** Requests über den Stage-Proxy führen. Vorgabe: Umgebungsvariable PROXY. */
  proxy?: boolean;
  /** Ungültige Zertifikate der Website akzeptieren (z. B. Staging mit selbst signiertem Zertifikat). */
  zertifikatFehlerIgnorieren?: boolean;
  /**
   * Fetch-, XHR- und Beacon-Requests ohne Regel an fremde Domains wie Tracking behandeln
   * (Dienst "Unbekannt", Tracking-Modus). Sicherheitsnetz gegen Endpunkte, die keine Regel kennt;
   * kann Funktionen der Website stören. Vorgabe: Umgebungsvariable UNBEKANNTE=abfangen.
   */
  unbekannteAbfangen?: boolean;
  /** navigator.webdriver verbergen, damit CMPs den Testbrowser nicht als Bot behandeln. Vorgabe: true. */
  automationVerbergen?: boolean;
  /**
   * GTM-Vorschau per Injection: Link aus GTM „Vorschau“/„Vorschau teilen“ (mit id, gtm_auth, gtm_preview).
   * Vorgabe: Umgebungsvariable GTM_VORSCHAU_LINK. Hängt die Vorschau-Parameter an jedes Laden des Containers.
   */
  vorschauLink?: string;
  /** Eigene Loader ohne id=GTM-… in der URL (z. B. Stape /<pfad>/<datei>.js?<kodiert>), die ebenfalls die Vorschau laden sollen. */
  vorschauLoader?: RegExp;
  /**
   * Antworten der Website vor dem Browser verändern, z. B. einen geplanten Loader ins HTML setzen oder ein
   * fehlerhaftes Skript der Seite patchen. Bleibt eine Antwort unverändert, steht ihre URL in
   * stage.anpassungenOhneWirkung (meist: Muster im Text passt nicht mehr).
   */
  anpassungen?: { muster: RegExp; anpassen: (text: string, url: string) => string }[];
  /**
   * Jeden dataLayer-Push verändern, bevor GTM ihn sieht (z. B. einen Key im Push der CMP ergänzen).
   * Ändert den Eintrag direkt oder gibt einen Ersatz zurück. Läuft im Browser: nur eigener Code,
   * keine Variablen aus dem Test.
   */
  dataLayerAnpassen?: (eintrag: any) => any;
}

/** Liest id, gtm_auth und gtm_preview aus einem Vorschau-Link; die Parameter stehen dort teils im Hash. */
export function vorschauParameter(link?: string, variable = 'GTM_VORSCHAU_LINK') {
  if (!link) return undefined;
  const wert = (name: string) => link.match(new RegExp(`[?&#/]${name}=([^&#]+)`))?.[1];
  const id = wert('id'), auth = wert('gtm_auth'), env = wert('gtm_preview');
  if (!id || !auth || !env) {
    throw new Error(`${variable} braucht id, gtm_auth und gtm_preview (Link aus GTM „Vorschau teilen“). `
      + 'Enthält der Link ein #, muss er in .env in Anführungszeichen stehen, sonst wird er dort abgeschnitten.');
  }
  return { id: decodeURIComponent(id), auth: decodeURIComponent(auth), env: decodeURIComponent(env) };
}

/** CONVERSION=aus: Tests enden an stage.conversionPunkt(), z. B. solange sie eingerichtet werden. */
export function conversionAus(): boolean {
  return /^(aus|nein|0|false|off|no)$/i.test(process.env.CONVERSION ?? '');
}

function unbekannteAusUmgebung(): boolean {
  return /^(abfangen|ein|an|ja|1|true|on|yes)$/i.test(process.env.UNBEKANNTE ?? '');
}

/** Grobe Näherung an die registrierbare Domain (letzte zwei Labels); für co.uk & Co. zu grob. */
function basisDomain(host: string): string {
  return host.split(':')[0].split('.').slice(-2).join('.');
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
  /**
   * browser: von Playwright erfasst; netlog: nur im Netzwerkprotokoll (z. B. Beacon beim
   * Verlassen); proxy: vom Stage-Proxy erfasst (sieht alles, auch Service Worker).
   */
  quelle: 'browser' | 'netlog' | 'proxy';
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

/** Fetch-, XHR- und Beacon-Requests, die keiner Regel zugeordnet sind (Kandidaten für eigene Formate). */
export interface WeitererRequest {
  zeit: number;
  methode: string;
  url: string;
  host: string;
  pfad: string;
  status?: number;
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
  // measurement/conversion: Conversion aus GA4 für Google Ads; ohne Regel ginge sie auch im Modus "abfangen" raus
  { name: 'Google Ads', muster: /googleadservices\.com\/(pagead|ccm)\/conversion|googleads\.g\.doubleclick\.net\/pagead\/(viewthroughconversion|conversion)|google\.[a-z.]+\/pagead\/(1p-)?(conversion|user-list)|google\.[a-z.]+\/rmkt\/collect|\/ccm\/(s\/)?collect|analytics\.google\.com\/measurement\/(1p-)?conversion/ },
  { name: 'Floodlight', muster: /fls\.doubleclick\.net\/activity|ad\.doubleclick\.net\/activity/ },
  { name: 'Meta', muster: /facebook\.com\/tr([/?]|$)/ },
  // Insights (Sitzungsdaten von UET) schwanken in Pfad und Anzahl: steuern, aber nicht protokollieren
  { name: 'Microsoft Ads Insights', muster: /bat\.bing\.(com|net)\/p\/insights/, nichtProtokollieren: true },
  { name: 'Microsoft Ads', muster: /bat\.bing\.(com|net)\/action/ },
  { name: 'Microsoft Clarity', muster: /clarity\.ms\/collect/ },
  { name: 'OpenAI Ads', muster: /bzr\.openai\.com\/v\d+\/sdk\/events/ },
  { name: 'Salesforce Pardot', muster: /pardot\.com\/analytics/ },
  { name: 'Criteo', muster: /criteo\.(com|net)\/.*event/ },
  { name: 'Piwik PRO', muster: /\/ppms\.php(\?|$)/ },
  { name: 'LinkedIn', muster: /px\.ads\.linkedin\.com\/(collect|wa)/ },
  { name: 'TikTok', muster: /analytics\.tiktok\.com\/api\/v\d\/(pixel|track)/ },
  { name: 'Pinterest', muster: /ct\.pinterest\.com\/(v3|user)/ },
];

/* ------------------------------------------------------------------ */
/* Protokolle                                                         */
/* ------------------------------------------------------------------ */

/**
 * Seiten von Debug-Werkzeugen (Referer/Origin bzw. Frame-URL). Deren eigener dataLayer und
 * eigene Tracking-Requests (der Tag Assistant misst sich z. B. selbst mit GA4) gehören nicht
 * zur getesteten Website und werden nicht protokolliert.
 */
export const WERKZEUG_SEITEN: RegExp[] = [/^https:\/\/tagassistant\.google\.com(\/|$)/];

const istWerkzeug = (url: string | undefined) => !!url && WERKZEUG_SEITEN.some((m) => m.test(url));

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
  /** Je Host, was dessen ersten Request ausgelöst hat (Skript-URLs aus dem Aufrufstapel bzw. „HTML der Seite“). */
  readonly ausloeser = new Map<string, string>();
  /**
   * Fetch-, XHR- und Beacon-Requests ohne passende Regel. Tracking über eigene Pfade oder
   * Formate (Custom Loader, getunnelte Requests) taucht hier auf, solange keine Regel passt.
   */
  readonly weitere: WeitererRequest[] = [];

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
  /** URLs von Requests der Debug-Werkzeuge; der NetLog-Abgleich darf sie nicht nachtragen. */
  readonly werkzeugUrls = new Set<string>();
  dataLayerName = 'dataLayer';
  /** URLs, auf die eine Anpassung passte, ohne etwas zu ändern (siehe StageOptionen.anpassungen). */
  readonly anpassungenOhneWirkung = new Set<string>();
  /** Alle Ressourcen nach CSP-Direktive, Host und Kontext (Seite, iframe, Service Worker), mit Anzahl. */
  readonly ressourcen = new Map<string, { direktive: string; host: string; origin: string; kontext: string; anzahl: number }>();

  /**
   * Was eine CSP der Seite erlauben müsste: je Direktive die Hosts, die im Lauf angefragt wurden (nur
   * Requests der Seite selbst; iframes und Service Worker haben eigene Policies). Dazu Verstöße gegen
   * die simulierte bzw. vorhandene Policy.
   */
  cspInventar(seitenHost = zerlege(String(this.testInfo.project.use.baseURL ?? '')).host) {
    const eintraege = [...this.ressourcen.values()].sort((a, b) =>
      a.kontext.localeCompare(b.kontext) || a.direktive.localeCompare(b.direktive) || a.host.localeCompare(b.host));
    const proDirektive = new Map<string, Set<string>>();
    for (const e of eintraege) {
      if (e.kontext !== 'Seite') continue;
      if (!proDirektive.has(e.direktive)) proDirektive.set(e.direktive, new Set());
      proDirektive.get(e.direktive)!.add(e.host === seitenHost ? "'self'" : e.origin);
    }
    const vorschlag = [...proDirektive].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, hosts]) => `${d} ${[...hosts].sort((a, b) => (a === "'self'" ? -1 : b === "'self'" ? 1 : a.localeCompare(b))).join(' ')}`).join('; ');
    return { eintraege, vorschlag, verstoesse: [...new Set(this.cspVerstoesse.map((v) => `${v.direktive}: ${v.blockiert}`))] };
  }

  constructor(
    readonly modus: Modus,
    readonly tempo: Tempo,
    readonly testInfo: TestInfo,
    private readonly context: BrowserContext,
    private readonly regelFuer: (url: string) => Regel | undefined,
    /** true: Requests laufen über den Stage-Proxy */
    readonly mitProxy = false,
  ) {}

  /**
   * Ergänzt Requests aus dem NetLog des Browsers, die Playwright nicht gesehen hat
   * (Beacons beim Verlassen einer Seite). Kann mehrfach aufgerufen werden.
   */
  netzwerkAbgleich() {
    if (this.mitProxy) return; // der Proxy sieht ohnehin alles
    const imNetz = new Map<string, number>();
    for (const r of leseNetlog(this.start, Date.now())) {
      const regel = this.regelFuer(r.url);
      if (!regel || regel.nichtProtokollieren || this.werkzeugUrls.has(r.url)) continue;
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
   * Optionaler Einstieg über die GTM-Vorschau im Tag Assistant (Link aus GTM „Vorschau“ bzw.
   * „Vorschau teilen“, enthält gtm_auth und gehört deshalb in .env). Klickt auf den Start-Button
   * und liefert den neuen Tab mit der Website; die Journey läuft dann in diesem Tab weiter.
   * Der Tab mit dem Tag Assistant muss offen bleiben, sonst endet die Vorschau.
   */
  async vorschauStarten(seite: Page, link = process.env.GTM_VORSCHAU_LINK, startKnopf = '#domain-start-button') {
    if (!link) throw new Error('Vorschau-Link fehlt (in .env eintragen)');
    vorschauParameter(link, 'Der Vorschau-Link');
    await seite.goto(link);
    const [website] = await Promise.all([
      this.context.waitForEvent('page', { timeout: 30_000 }),
      seite.locator(startKnopf).click(),
    ]);
    await website.waitForLoadState('domcontentloaded');
    return website;
  }

  /**
   * Hält den Browser zum eigenen Ausprobieren offen (Playwright Inspector), mit allen Regeln und
   * Anpassungen der Stage. Ohne Zeitlimit; nur mit --headed sinnvoll.
   */
  async offenHalten(seite: Page) {
    this.testInfo.setTimeout(0);
    await seite.pause();
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
   * Zustand im Browser: Cookies (Name und Domain), Keys in localStorage und sessionStorage der Seite,
   * geladene Google-Container. Z. B. vor und nach einem Widerruf vergleichen.
   */
  async zustand(seite?: Page) {
    const p = seite ?? this.context.pages().filter((x: Page) => !x.isClosed()).at(-1);
    const cookies = (await this.context.cookies()).map((c) => `${c.name} (${c.domain})`).sort();
    const leer = { localStorage: [] as string[], sessionStorage: [] as string[], container: [] as string[] };
    const imBrowser = p ? await p.evaluate(() => ({
      localStorage: Object.keys(localStorage).sort(),
      sessionStorage: Object.keys(sessionStorage).sort(),
      container: Object.keys((window as any).google_tag_manager ?? {}).filter((k) => /^(GTM|GT|G|AW|DC)-/.test(k)).sort(),
    })).catch(() => leer) : leer;
    return { cookies, ...imBrowser };
  }

  /**
   * Fügt einen Link ein und klickt ihn, um Klick-Trigger auszulösen, ohne ein passendes Element auf der
   * Seite zu brauchen (z. B. tel:, mailto:, PDF). Öffnet im neuen Tab, damit die Seite bleibt; der Tab wird geschlossen.
   */
  async linkKlicken(seite: Page, href: string, optionen: { text?: string; attribute?: Record<string, string> } = {}) {
    const neu: Page[] = [];
    const merke = (p: Page) => neu.push(p);
    this.context.on('page', merke);
    try {
      await seite.evaluate(({ href, text, attribute }) => {
        const a = document.createElement('a');
        a.setAttribute('href', href);
        a.target = '_blank';
        a.textContent = text;
        for (const [k, v] of Object.entries(attribute)) a.setAttribute(k, v);
        document.body.appendChild(a);
        a.click();
      }, { href, text: optionen.text ?? href, attribute: optionen.attribute ?? {} });
      await pause(1000);
    } finally {
      this.context.off('page', merke);
      for (const p of neu) await p.close().catch(() => { /* schon zu */ });
    }
  }

  /** Schreibt ein Objekt in den dataLayer der Seite, z. B. ein Event, das sonst ein Formular auslöst. */
  async dataLayerPush(seite: Page, daten: Record<string, unknown>) {
    await seite.evaluate(({ name, daten }) => {
      const w = window as any;
      (w[name] = w[name] || []).push(daten);
    }, { name: this.dataLayerName, daten });
  }

  /**
   * Direkt vor der Aktion aufrufen, die die Conversion auslöst (Kauf, Absenden). Mit CONVERSION=aus
   * endet der Test hier und gilt als übersprungen; alles davor ist geprüft, nichts wurde abgeschickt.
   */
  async conversionPunkt() {
    if (!conversionAus()) return;
    await this.warteAufRuhe();
    this.testInfo.skip(true, 'CONVERSION=aus: Lauf endet vor der Conversion');
  }

  /**
   * Speichert beim ersten Lauf (oder mit --update-snapshots) eine Baseline unter
   * baselines/<name>.json und vergleicht spätere Läufe dagegen. Siehe lib/baseline.ts.
   */
  async vergleicheMitBaseline(name: string, optionen: BaselineOptionen = {}) {
    // Erst die letzte Seite zu Ende arbeiten lassen: Tags auf einer Danke-Seite brauchen oft Sekunden,
    // sonst fehlen sie in manchen Läufen und der Vergleich schwankt.
    await this.warteAufRuhe(3000, 30_000);
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
function browserSetup({ dlName, werkzeugSeiten }: { dlName: string; werkzeugSeiten: string[] }) {
  if (window !== window.top) return; // nur Hauptframe
  if (werkzeugSeiten.some((m) => new RegExp(m).test(location.href))) return;
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

  // Custom Templates (createQueue) pushen in GTM-Vorschau u. a. Hüllen-Objekte einer internen
  // Klasse mit dem einzigen Key "value"; GTM verarbeitet den Inhalt als normale Message.
  const entpacke = (wert: any) => wert && typeof wert === 'object' && !Array.isArray(wert)
    && Object.getPrototypeOf(wert) !== Object.prototype && Object.keys(wert).length === 1
    && wert.value && typeof wert.value === 'object' ? wert.value : wert;

  const anpassen = (window as any).__stageDlAnpassen as ((e: any) => any) | undefined;
  const passeAn = (wert: any) => {
    if (!anpassen) return wert;
    const ziel = entpacke(wert);
    const ersatz = anpassen(ziel);
    if (ersatz === undefined || ersatz === ziel) return wert;
    if (ziel !== wert) { wert.value = ersatz; return wert; }
    return ersatz;
  };

  const instrumentiere = (arr: any) => {
    if (!Array.isArray(arr) || (arr as any).__stage) return;
    Object.defineProperty(arr, '__stage', { value: true });
    for (let i = 0; i < arr.length; i++) {
      arr[i] = passeAn(arr[i]);
      melde(serialisiere(entpacke(arr[i])), location.href);
    }
    if (!anpassen) {
      const vorher = arr.push;
      arr.push = function () {
        for (let i = 0; i < arguments.length; i++) melde(serialisiere(entpacke(arguments[i])), location.href);
        return vorher.apply(arr, arguments as any);
      };
      return;
    }
    // Mit Anpassung muss sie vor GTM greifen, auch nachdem GTM push() ersetzt hat: Wer push setzt,
    // landet in der Kette; ruft er die vorherige Funktion (= aussen) auf, geht es dort ein Glied tiefer.
    const kette: Function[] = [arr.push];
    let tiefe = 0;
    const aussen = function (this: any) {
      const args = Array.from(arguments);
      if (tiefe === 0) {
        for (let i = 0; i < args.length; i++) {
          args[i] = passeAn(args[i]);
          melde(serialisiere(entpacke(args[i])), location.href);
        }
      }
      const fn = kette[Math.max(kette.length - 1 - tiefe, 0)];
      tiefe++;
      try { return fn.apply(arr, args); } finally { tiefe--; }
    };
    Object.defineProperty(arr, 'push', {
      configurable: true,
      get: () => aussen,
      set: (fn) => { if (fn !== aussen) kette.push(fn); },
    });
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

function vonWerkzeug(request: Request) {
  if (istWerkzeug(request.url())) return true;
  try {
    if (istWerkzeug(request.frame().url())) return true;
  } catch { /* Service-Worker-Requests haben keinen Frame */ }
  return istWerkzeug(request.headers()['referer']);
}

/** Playwright-Ressourcentyp → CSP-Direktive (worker-src gilt für Skripte von Workern, hier nicht unterschieden). */
const CSP_DIREKTIVE: Record<string, string> = {
  script: 'script-src', stylesheet: 'style-src', image: 'img-src', font: 'font-src', media: 'media-src',
  manifest: 'manifest-src', xhr: 'connect-src', fetch: 'connect-src', eventsource: 'connect-src',
  websocket: 'connect-src', ping: 'connect-src', texttrack: 'media-src',
};

/**
 * Merkt sich je Host, was dessen ersten Request ausgelöst hat (CDP, nur Chromium): Skripte aus dem
 * Aufrufstapel bzw. das HTML der Seite. Beantwortet bei neuen Domains: lädt GTM sie oder die Seite selbst?
 */
async function erfasseAusloeser(context: BrowserContext, stage: Stage) {
  const kurz = (u: string) => { const t = zerlege(u); return t.host ? t.host + t.pfad : u; };
  const verbinde = async (seite: Page) => {
    try {
      const cdp = await context.newCDPSession(seite);
      await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', (e: any) => {
        const host = zerlege(e.request.url).host;
        if (!host || stage.tracking.ausloeser.has(host)) return;
        const skripte: string[] = [];
        for (let s = e.initiator?.stack; s; s = s.parent) for (const f of s.callFrames ?? []) if (f.url) skripte.push(kurz(f.url));
        const quelle = skripte.length ? [...new Set(skripte)].slice(0, 3).join(' ← ')
          : e.initiator?.type === 'parser' && e.initiator.url ? `HTML ${kurz(e.initiator.url)}`
          : e.initiator?.url ? kurz(e.initiator.url) : e.initiator?.type === 'other' ? 'Navigation' : e.initiator?.type ?? 'unbekannt';
        stage.tracking.ausloeser.set(host, quelle);
      });
    } catch { /* kein Chromium oder Seite schon geschlossen */ }
  };
  for (const p of context.pages()) await verbinde(p);
  context.on('page', (p) => { void verbinde(p); });
}

export async function richteStageEin(
  context: BrowserContext, testInfo: TestInfo, optionen: StageOptionen = {}, proxy?: StageProxy,
): Promise<Stage> {
  const modus: Modus = optionen.trackingModus
    ?? (process.env.TRACKING_MODUS as Modus | undefined)
    ?? 'abfangen';
  const regeln = [...(optionen.regeln ?? []), ...STANDARD_DIENSTE];
  const regelFuer = (url: string) => regeln.find((r) => r.muster.test(url));
  const stage = new Stage(modus, optionen.tempo ?? tempoAusUmgebung(), testInfo, context, regelFuer, !!proxy);
  stage.dataLayerName = optionen.dataLayerName ?? 'dataLayer';
  await erfasseAusloeser(context, stage);

  // Sicherheitsnetz: unbekannte Requests an fremde Domains wie Tracking behandeln
  const unbekannteAktiv = (optionen.unbekannteAbfangen ?? unbekannteAusUmgebung()) && modus !== 'durchlassen';
  const websiteBasis = basisDomain(zerlege(String(testInfo.project.use.baseURL ?? '')).host);
  const UNBEKANNT: Regel = { name: 'Unbekannt', muster: /$^/ };
  const istFremd = (url: string) => {
    const host = zerlege(url).host;
    return !!host && basisDomain(host) !== websiteBasis;
  };
  /** typ: Playwright-resourceType bzw. sec-fetch-dest des Proxys ("empty" = fetch/XHR/Beacon) */
  const regelMitTyp = (url: string, typ: string, herkunft?: string) => regelFuer(url)
    ?? (unbekannteAktiv && ['fetch', 'xhr', 'ping', 'empty'].includes(typ) && istFremd(url)
      && !istWerkzeug(herkunft) && !istWerkzeug(url) ? UNBEKANNT : undefined);

  await context.exposeFunction('__stageDataLayer', (daten: string, url: string) => {
    stage.dataLayer.eintraege.push({ nr: stage.dataLayer.eintraege.length, zeit: Date.now(), seitenUrl: url, daten: JSON.parse(daten) });
  });
  await context.exposeFunction('__stageCsp', (v: string) => {
    stage.cspVerstoesse.push({ zeit: Date.now(), ...JSON.parse(v) });
  });
  if (optionen.dataLayerAnpassen) {
    // Als Quelltext statt per eval: Init-Skripte laufen unabhängig von der CSP der Seite.
    let quelle = optionen.dataLayerAnpassen.toString();
    // Methoden-Kurzschreibweise (dataLayerAnpassen(e) { … }) ist allein kein gültiger Ausdruck.
    if (/^(async\s+)?[\w$]+\s*\(/.test(quelle) && !/^(async\s+)?function\b/.test(quelle)) quelle = 'function ' + quelle.replace(/^async\s+/, '');
    await context.addInitScript({ content: `window.__stageDlAnpassen = (${quelle});` });
  }
  await context.addInitScript(browserSetup, {
    dlName: optionen.dataLayerName ?? 'dataLayer',
    werkzeugSeiten: WERKZEUG_SEITEN.map((m) => m.source),
  });
  // CMPs wie Usercentrics erkennen Automatisierung (isBot) und erteilen dann selbst Consent:
  // sähe aus wie Tracking ohne Zustimmung. Gegenstück: Startargument in playwright.config.ts.
  if (optionen.automationVerbergen !== false) {
    await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  }

  // Vorschau zuerst registrieren: Playwright fragt später registrierte Routen zuerst, die übrigen
  // Routen reichen Container-Requests per fallback() bis hierher durch.
  const vorschau = vorschauParameter(optionen.vorschauLink ?? process.env.GTM_VORSCHAU_LINK);
  if (vorschau) {
    const istContainer = (url: URL) => url.searchParams.get('id') === vorschau.id || !!optionen.vorschauLoader?.test(url.href);
    await context.route(istContainer, async (route: Route) => {
      const url = new URL(route.request().url());
      url.searchParams.set('gtm_auth', vorschau.auth);
      url.searchParams.set('gtm_preview', vorschau.env);
      url.searchParams.set('gtm_cookies_win', 'x');
      await route.continue({ url: url.href }).catch(() => { /* Seite schon geschlossen */ });
    });
  }

  // CSP-Inventar: jede Ressource mit Direktive und Kontext, mit und ohne Proxy (Playwright sieht die Requests vor dem Proxy)
  context.on('request', (request) => {
    if (vonWerkzeug(request)) return;
    const { host } = zerlege(request.url());
    const origin = (() => { try { return new URL(request.url()).origin; } catch { return host; } })();
    if (!host) return;
    let direktive = CSP_DIREKTIVE[request.resourceType()] ?? 'connect-src';
    let kontext = 'Seite';
    if (request.serviceWorker()) {
      kontext = 'Service Worker';
    } else {
      try {
        const frame = request.frame();
        if (request.resourceType() === 'document') {
          if (!frame.parentFrame()) return; // Hauptdokument braucht keine Direktive
          direktive = 'frame-src';
        } else if (frame.parentFrame()) {
          kontext = `iframe ${zerlege(frame.url()).host || '(ohne URL)'}`;
        }
      } catch { kontext = 'unbekannt'; }
    }
    const k = `${kontext}|${direktive}|${host}`;
    const e = stage.ressourcen.get(k);
    if (e) e.anzahl++;
    else stage.ressourcen.set(k, { direktive, host, origin, kontext, anzahl: 1 });
  });

  // Antworten der Website verändern: Anpassungen (z. B. neuer Loader, gepatchtes Skript) und, ohne Proxy,
  // die CSP-Simulation. Eine gemeinsame Route, weil beide dieselben Dokumente anfassen können.
  const anpassungenFuer = (url: string) => (optionen.anpassungen ?? []).filter((a) => a.muster.test(url));
  const cspImBrowser = !proxy && !!optionen.csp;
  if (optionen.anpassungen?.length || cspImBrowser) {
    const betroffen = (url: URL) => anpassungenFuer(url.href).length > 0 || (cspImBrowser && !regelFuer(url.href));
    await context.route(betroffen, async (route: Route, request: Request) => {
      const anpassungen = anpassungenFuer(request.url());
      // Angepasste Dokumente holt route.fetch() nicht zwingend über den Proxy: CSP dann auch hier setzen
      const cspHier = !!optionen.csp && request.resourceType() === 'document' && (cspImBrowser || anpassungen.length > 0);
      if (!anpassungen.length && !cspHier) {
        await route.fallback();
        return;
      }
      const antwort = await route.fetch();
      const headers = { ...antwort.headers() };
      if (cspHier) {
        if ((optionen.cspModus ?? 'ersetzen') === 'ersetzen') {
          delete headers['content-security-policy'];
          delete headers['content-security-policy-report-only'];
        }
        const name = optionen.cspNurBerichten ? 'content-security-policy-report-only' : 'content-security-policy';
        headers[name] = headers[name] ? `${headers[name]}, ${optionen.csp}` : optionen.csp!;
      }
      if (!anpassungen.length) {
        await route.fulfill({ response: antwort, headers });
        return;
      }
      let text = await antwort.text();
      const vorher = text;
      for (const a of anpassungen) text = a.anpassen(text, request.url());
      if (text === vorher) stage.anpassungenOhneWirkung.add(request.url());
      delete headers['content-length'];
      await route.fulfill({ response: antwort, headers, body: text });
    });
  }

  if (proxy) {
    verbindeProxy(stage, proxy, regelMitTyp, modus, optionen);
    return stage;
  }

  // Protokoll über Events statt im Routing: so werden auch Weiterleitungsketten erfasst,
  // die das Routing nicht sieht, und Status bzw. Fehler jedes Requests.
  const offen = new Map<Request, Treffer>();
  context.on('request', (request) => {
    const url = request.url();
    if (vonWerkzeug(request)) {
      stage.werkzeugUrls.add(url);
      return;
    }
    const teile = zerlege(url);
    if (teile.host) stage.tracking.hosts.add(teile.host);
    const regel = regelMitTyp(url, request.resourceType());
    if (!regel && ['fetch', 'xhr', 'ping'].includes(request.resourceType())) {
      stage.tracking.weitere.push({ zeit: Date.now(), methode: request.method(), url, host: teile.host, pfad: teile.pfad });
    }
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
  // Der Typ des Requests ist erst im Handler bekannt; fremde Hosts deshalb erst dort entscheiden.
  const mussSteuern = (url: URL) => {
    const regel = regelFuer(url.href);
    if (!regel) return unbekannteAktiv && istFremd(url.href);
    return (regel.modus ?? modus) !== 'durchlassen' || !!regel.verzoegerungMs;
  };
  const steuerungNoetig = modus !== 'durchlassen'
    || (optionen.regeln ?? []).some((r) => (r.modus && r.modus !== 'durchlassen') || r.verzoegerungMs);
  if (steuerungNoetig) await context.route(mussSteuern, async (route: Route, request: Request) => {
    const regel = regelFuer(request.url())
      ?? (vonWerkzeug(request) ? undefined : regelMitTyp(request.url(), request.resourceType()));
    if (!regel) {
      await route.fallback().catch(() => { /* Seite schon geschlossen */ });
      return;
    }
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

  return stage;
}

/** Verbindet die Stage mit dem Proxy: Regeln, CSP und Protokoll laufen dann dort. */
function verbindeProxy(
  stage: Stage, proxy: StageProxy, regelFuer: (url: string, typ: string, herkunft?: string) => Regel | undefined,
  modus: Modus, optionen: StageOptionen,
) {
  proxy.verbinde({
    entscheide(url, ziel, herkunft) {
      const regel = regelFuer(url, ziel, herkunft);
      if (!regel) return undefined;
      return { aktion: regel.modus ?? modus, verzoegerungMs: regel.verzoegerungMs };
    },
    melde(r: ProxyRequest) {
      if (istWerkzeug(r.herkunft) || istWerkzeug(r.url)) return;
      const teile = zerlege(r.url);
      if (teile.host) stage.tracking.hosts.add(teile.host);
      const regel = regelFuer(r.url, r.ziel, r.herkunft);
      if (!regel) {
        if (r.ziel === 'empty' || r.ziel === '') {
          const weiterer: WeitererRequest = { zeit: r.zeit, methode: r.methode, url: r.url, host: teile.host, pfad: teile.pfad };
          stage.tracking.weitere.push(weiterer);
          Object.defineProperty(weiterer, 'status', { enumerable: true, get: () => r.status });
        }
        return;
      }
      if (regel.nichtProtokollieren) return;
      // Weiterleitungsziel des vorherigen Requests: dieser Request ist der Folge-Hop
      const vorher = [...stage.tracking.treffer].reverse().find((t) => t.quelle === 'proxy' && (t as any).__weiter === r.url);
      const treffer: Treffer = {
        nr: stage.tracking.treffer.length,
        zeit: r.zeit,
        dienst: regel.name,
        modus: r.aktion,
        methode: r.methode,
        url: r.url,
        ...teile,
        ressourcentyp: r.ziel || 'unbekannt',
        body: r.body,
        umleitungVon: vorher?.url,
        abgeschlossen: false,
        quelle: 'proxy',
      };
      // Status, Fehler und Abschluss live aus dem Proxy-Eintrag lesen
      Object.defineProperties(treffer, {
        status: { enumerable: true, get: () => r.status },
        fehler: { enumerable: true, get: () => r.fehler },
        abgeschlossen: { enumerable: true, get: () => r.abgeschlossen },
        __weiter: { enumerable: false, get: () => r.weiterleitungZu },
      });
      stage.tracking.treffer.push(treffer);
    },
    csp: optionen.csp
      ? { wert: optionen.csp, nurBerichten: optionen.cspNurBerichten, ersetzen: (optionen.cspModus ?? 'ersetzen') === 'ersetzen' }
      : undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Fixture                                                            */
/* ------------------------------------------------------------------ */

export const test = base.extend<{ stageOptionen: StageOptionen; stageProxy: StageProxy | undefined; stage: Stage }>({
  stageOptionen: [{}, { option: true }],

  // Proxy pro Test, nur wenn eingeschaltet (stageOptionen.proxy oder PROXY=ein)
  stageProxy: async ({ stageOptionen }, use) => {
    if (!(stageOptionen.proxy ?? proxyAusUmgebung())) {
      await use(undefined);
      return;
    }
    const proxy = await new StageProxy(!!stageOptionen.zertifikatFehlerIgnorieren).start();
    await use(proxy);
    await proxy.stop();
  },
  // Browser-Kontext über den Proxy führen; '<-loopback>' schickt auch localhost durch den Proxy
  proxy: async ({ proxy, stageProxy }, use) => {
    await use(stageProxy ? { server: stageProxy.url, bypass: '<-loopback>' } : proxy);
  },
  // Den Zertifikaten des Proxys vertraut der Browser über seine Startargumente (lib/proxy.ts),
  // ignoreHTTPSErrors ist dafür nicht nötig.
  // Ausnahme Anpassungen mit Proxy: route.fetch() läuft dann über den Proxy, und die Node-Seite von
  // Playwright kennt dessen Zertifikate nicht (sonst „self-signed certificate in certificate chain“).
  ignoreHTTPSErrors: async ({ ignoreHTTPSErrors, stageOptionen, stageProxy }, use) => {
    await use(ignoreHTTPSErrors || !!stageOptionen.zertifikatFehlerIgnorieren || (!!stageProxy && !!stageOptionen.anpassungen?.length));
  },
  // Mit Proxy sind Service Worker kein blinder Fleck mehr und dürfen laufen wie bei echten Besuchern
  serviceWorkers: async ({ serviceWorkers, stageProxy }, use) => {
    await use(stageProxy ? 'allow' : serviceWorkers);
  },

  stage: async ({ context, stageOptionen, stageProxy }, use, testInfo) => {
    const stage = await richteStageEin(context, testInfo, stageOptionen, stageProxy);
    await use(stage);
    stage.netzwerkAbgleich();
    const entwischt = stage.tracking.treffer.filter((t) => t.entwischt);
    if (entwischt.length) {
      testInfo.annotations.push({
        type: 'Achtung',
        description: `${entwischt.length} Tracking-Request(s) beim Verlassen einer Seite echt gesendet, obwohl Modus "${stage.modus}" (siehe tracking-treffer.json, entwischt: true)`,
      });
    }
    if (stage.anpassungenOhneWirkung.size) {
      testInfo.annotations.push({
        type: 'Achtung',
        description: `Anpassung ohne Wirkung (Muster im Inhalt nicht gefunden?): ${[...stage.anpassungenOhneWirkung].join(', ')}`,
      });
    }
    // Protokolle als Dateien in test-results/<test>/ (auch bei grünen Tests auswertbar, ohne
    // neuen Lauf) und als Anhang im Report.
    const ablegen = async (name: string, daten: unknown) => {
      const datei = testInfo.outputPath(name);
      fs.writeFileSync(datei, JSON.stringify(daten, null, 2));
      await testInfo.attach(name, { path: datei, contentType: 'application/json' });
    };
    await ablegen('dataLayer.json', stage.dataLayer.eintraege);
    await ablegen('tracking-treffer.json', stage.tracking.treffer);
    await ablegen('hosts.json', [...stage.tracking.hosts].sort().map((h) => ({ host: h, ausgeloestVon: stage.tracking.ausloeser.get(h) })));
    if (stage.tracking.weitere.length) await ablegen('weitere-requests.json', stage.tracking.weitere);
    if (stage.cspVerstoesse.length) await ablegen('csp-verstoesse.json', stage.cspVerstoesse);
    await ablegen('csp-inventar.json', stage.cspInventar());
  },
});

export { expect };
