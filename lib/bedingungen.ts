/**
 * Bedingungen für eine Journey, die man auf der echten Website nicht ohne Weiteres bekommt:
 * Landung über eine Anzeige (Klick-IDs), gedrosseltes Netz und CPU, Gerät und Browser-Kennung.
 * Eingeschaltet über stageOptionen, ausgewertet in lib/stage.ts. Anleitung: docs/anleitung/varianten.md.
 */
import { devices, type BrowserContext, type Page } from '@playwright/test';
import { DIENST_PROFILE, felder, type DienstProfil } from './dienstprofile';

/* ------------------------------------------------------------------ */
/* Landung über eine Anzeige                                          */
/* ------------------------------------------------------------------ */

/** URL-Parameter, mit denen Werbenetzwerke Klicks kennzeichnen. */
export const KLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid', 'epik'] as const;
export type KlickId = (typeof KLICK_IDS)[number];

export interface Landung {
  /**
   * Diese Klick-IDs mit erkennbaren Testwerten (TEST-sib-…) an die Startadresse hängen. Neben den
   * bekannten (KLICK_IDS) geht jeder Identifier, den ein Dienstprofil kennt.
   */
  klickIds?: (KlickId | (string & {}))[];
  /** UTM-Parameter, z. B. { source: 'google', medium: 'cpc' } – ohne "utm_" davor. */
  utm?: Record<string, string>;
  /** Weitere Parameter unverändert anhängen. */
  parameter?: Record<string, string>;
}

/** Parameter der Landung. Klick-IDs bekommen eindeutige, als Test erkennbare Werte. */
export function landungsParameter(landung: Landung, zeit = Date.now()): Record<string, string> {
  const p: Record<string, string> = {};
  for (const id of landung.klickIds ?? []) p[id] = `TEST-sib-${id}-${zeit}`;
  for (const [k, v] of Object.entries(landung.utm ?? {})) p[k.startsWith('utm_') ? k : `utm_${k}`] = v;
  Object.assign(p, landung.parameter ?? {});
  return p;
}

export interface KlickIdBefund {
  id: string;
  wert: string;
  /** Dienste, deren Profil diese Klick-ID kennt (lib/dienstprofile.ts) */
  dienste: string[];
  /**
   * Wo die Klick-ID gespeichert ist: Cookies bzw. localStorage, die den Wert enthalten, sowie die
   * Ablagen aus dem Profil, die vorhanden sind (Format des Dienstes egal).
   */
  gespeichert: string[];
  /** Tracking-Requests, die den Wert enthalten oder einen Klick-ID-Parameter aus dem Profil des Dienstes. */
  requests: { nr: number; dienst: string; ereignis: string; zeit: number; wie: string }[];
}

interface TrefferLike {
  nr: number; dienst: string; url: string; body?: string; zeit: number; pfad: string; parameter: Record<string, string>;
}

const dekodiert = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

/** Sucht jede Klick-ID in Cookies, localStorage der offenen Seiten und Tracking-Requests, dazu nach Profil. */
export async function klickIdBefunde(
  context: BrowserContext, werte: Record<string, string>, treffer: TrefferLike[], profile: DienstProfil[] = DIENST_PROFILE,
): Promise<KlickIdBefund[]> {
  const cookies = await context.cookies();
  const speicher: { key: string; wert: string; herkunft: string }[] = [];
  for (const seite of context.pages().filter((p: Page) => !p.isClosed())) {
    const eintraege = await seite.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''] as [string, string]))
      .catch(() => [] as [string, string][]);
    let herkunft = '';
    try { herkunft = new URL(seite.url()).host; } catch { /* about:blank */ }
    for (const [key, wert] of eintraege) speicher.push({ key, wert, herkunft });
  }
  const bekannt = new Set<string>([...KLICK_IDS, ...profile.flatMap((p) => Object.keys(p.klickId ?? {}))]);
  return Object.entries(werte).filter(([id]) => bekannt.has(id)).map(([id, wert]) => {
    const passendeProfile = profile.filter((p) => p.klickId?.[id]);
    const gespeichert = [
      ...cookies.filter((c) => dekodiert(c.value).includes(wert)).map((c) => `Cookie ${c.name} (${c.domain})`),
      ...speicher.filter((s) => dekodiert(s.wert).includes(wert)).map((s) => `localStorage ${s.key} (${s.herkunft})`),
    ];
    for (const p of passendeProfile) {
      for (const ablage of p.klickId![id].speicher ?? []) {
        if (ablage.startsWith('localStorage:')) {
          const key = ablage.slice('localStorage:'.length);
          for (const s of speicher.filter((x) => x.key === key)) gespeichert.push(`localStorage ${s.key} (${s.herkunft}, laut Profil ${p.name})`);
        } else {
          for (const c of cookies.filter((x) => x.name === ablage)) gespeichert.push(`Cookie ${c.name} (${c.domain}, laut Profil ${p.name})`);
        }
      }
    }
    const requests: KlickIdBefund['requests'] = [];
    for (const t of treffer) {
      const ereignis = t.parameter.en ?? t.parameter.ev ?? t.parameter.event ?? t.parameter.label ?? t.pfad;
      if (dekodiert(t.url).includes(wert) || (t.body ? dekodiert(t.body).includes(wert) : false)) {
        requests.push({ nr: t.nr, dienst: t.dienst, zeit: t.zeit, ereignis, wie: 'Wert enthalten' });
        continue;
      }
      const profil = passendeProfile.find((p) => p.name === t.dienst);
      const f = profil ? felder(t.parameter, t.body) : {};
      const param = profil?.klickId![id].request?.find((r) => f[r]);
      if (param) requests.push({ nr: t.nr, dienst: t.dienst, zeit: t.zeit, ereignis, wie: `Parameter ${param} (Profil)` });
    }
    // Ohne Duplikate: gleiche Ablage kann über Wert und Profil gefunden werden
    const ohneProfilZusatz = (g: string) => g.replace(/, laut Profil [^)]+\)$/, ')');
    const eindeutig = gespeichert.filter((g, i) => gespeichert.findIndex((x) => ohneProfilZusatz(x) === ohneProfilZusatz(g)) === i);
    return { id, wert, dienste: passendeProfile.map((p) => p.name), gespeichert: eindeutig, requests };
  });
}

export interface UtmBefund {
  dienst: string;
  /** Erster Request des Dienstes nach der Landung */
  ersterRequest: { nr: number; ereignis: string };
  /** UTM-Paare, die im ersten Request fehlen (leer = alles angekommen) */
  fehlend: string[];
  /** Spätere Requests des Dienstes, die alle UTM-Paare enthalten */
  spaeterEnthalten: number[];
}

/**
 * UTMs werden nicht gespeichert, sondern aus der URL des ersten Requests gelesen (z. B. GA4 über dl).
 * Geprüft wird deshalb je Dienst, ob sein erster Request nach der Landung alle UTM-Paare enthält –
 * in der URL, in einem Parameter wie dl oder im Body.
 */
export function utmBefunde(werte: Record<string, string>, treffer: TrefferLike[], ab: number): UtmBefund[] {
  const paare = Object.entries(werte).filter(([k]) => k.startsWith('utm_')).map(([k, v]) => `${k}=${v}`);
  if (!paare.length) return [];
  const text = (t: TrefferLike) => {
    const roh = `${t.url}\n${t.body ?? ''}`;
    return `${dekodiert(roh)}\n${dekodiert(dekodiert(roh))}`;
  };
  const fehlt = (t: TrefferLike) => paare.filter((p) => !text(t).includes(p));
  const nachDienst = new Map<string, TrefferLike[]>();
  for (const t of treffer.filter((x) => x.zeit >= ab).sort((a, b) => a.zeit - b.zeit)) {
    if (!nachDienst.has(t.dienst)) nachDienst.set(t.dienst, []);
    nachDienst.get(t.dienst)!.push(t);
  }
  return [...nachDienst].map(([dienst, liste]) => {
    const erster = liste[0];
    return {
      dienst,
      ersterRequest: { nr: erster.nr, ereignis: erster.parameter.en ?? erster.parameter.ev ?? erster.parameter.event ?? erster.pfad },
      fehlend: fehlt(erster),
      spaeterEnthalten: liste.slice(1).filter((t) => !fehlt(t).length).map((t) => t.nr),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Netz und CPU                                                       */
/* ------------------------------------------------------------------ */

/** Näherungen an die Profile der Chrome DevTools. */
export const NETZE = {
  'langsam-3g': { latenzMs: 2000, downloadKbit: 400, uploadKbit: 400 },
  '3g': { latenzMs: 563, downloadKbit: 1600, uploadKbit: 750 },
  '4g': { latenzMs: 170, downloadKbit: 9000, uploadKbit: 1500 },
} as const;

export type Netz = keyof typeof NETZE | { latenzMs: number; downloadKbit: number; uploadKbit: number };

/** Drosselt jede Seite des Kontexts (auch später geöffnete) per CDP, nur Chromium. */
export async function drossele(context: BrowserContext, optionen: { netz?: Netz; cpu?: number }) {
  if (!optionen.netz && !optionen.cpu) return;
  const netz = typeof optionen.netz === 'string' ? NETZE[optionen.netz] : optionen.netz;
  if (typeof optionen.netz === 'string' && !netz) throw new Error(`Unbekanntes Netz "${optionen.netz}". Erlaubt: ${Object.keys(NETZE).join(', ')}`);
  const anwenden = async (seite: Page) => {
    try {
      const cdp = await context.newCDPSession(seite);
      if (netz) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: netz.latenzMs,
          downloadThroughput: (netz.downloadKbit * 1000) / 8,
          uploadThroughput: (netz.uploadKbit * 1000) / 8,
        });
      }
      if (optionen.cpu && optionen.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: optionen.cpu });
    } catch { /* Seite schon geschlossen */ }
  };
  for (const p of context.pages()) await anwenden(p);
  context.on('page', (p) => { void anwenden(p); });
}

/* ------------------------------------------------------------------ */
/* Gerät und Browser-Kennung                                          */
/* ------------------------------------------------------------------ */

/**
 * Kurznamen für Browser-Kennungen anderer Browser. Der Testbrowser bleibt Chromium: Nur die Kennung
 * (navigator.userAgent, User-Agent-Header) ändert sich; Client Hints werden dazu passend entfernt.
 * Versionen bei Bedarf aktualisieren.
 */
export const USER_AGENTS = {
  'safari-ios': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'safari-mac': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
} as const;

export function userAgentAus(wert: string): string {
  return (USER_AGENTS as Record<string, string>)[wert] ?? wert;
}

/** Chromium-basierte Kennungen haben Client Hints; Safari und Firefox nicht. */
export function hatClientHints(ua: string): boolean {
  return /Chrome\/|Chromium\/|CriOS\//.test(ua);
}

/** Client Hints, die zu einer Chromium-Kennung passen (Plattform und Version aus dem String). */
export function passendeClientHints(ua: string) {
  const version = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/)?.[1] ?? '0.0.0.0';
  const haupt = version.split('.')[0];
  const plattform = /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'Chrome OS' : /Linux/.test(ua) ? 'Linux' : '';
  const plattformVersion = ua.match(/Android (\d+(?:\.\d+)*)/)?.[1] ?? (plattform === 'Windows' ? '10.0.0' : '');
  const marken = (v: string) => [
    { brand: 'Not)A;Brand', version: v === haupt ? '8' : '8.0.0.0' },
    { brand: 'Chromium', version: v },
    { brand: 'Google Chrome', version: v },
  ];
  return {
    brands: marken(haupt),
    fullVersionList: marken(version),
    fullVersion: version,
    platform: plattform,
    platformVersion: plattformVersion,
    architecture: /arm|aarch64/i.test(ua) ? 'arm' : plattform === 'Android' ? '' : 'x86',
    model: ua.match(/Android [^;]+; ([^)]+)\)/)?.[1] ?? '',
    mobile: /Mobile|Android/.test(ua) && !/Tablet/.test(ua),
    bitness: plattform === 'Android' ? '' : '64',
  };
}

/**
 * Stimmt die Client Hints auf die Kennung ab, per CDP für jede Seite des Kontexts:
 * - Chromium-Kennung: Marken wie bei Google Chrome statt "HeadlessChrome", Plattform aus dem String.
 *   Sonst verrät der Header Sec-CH-UA den Testbrowser, obwohl der User-Agent nach Chrome aussieht.
 * - Safari, Firefox: Marken leer, navigator.userAgentData undefiniert. Chromium sendet den Header
 *   Sec-CH-UA dann leer statt gar nicht.
 */
export async function clientHintsAnpassen(context: BrowserContext, ua: string) {
  const chromium = hatClientHints(ua);
  const metadaten = chromium ? passendeClientHints(ua)
    : { brands: [], fullVersionList: [], platform: '', platformVersion: '', architecture: '', model: '', mobile: /Mobile|iPhone|Android/.test(ua) };
  const anwenden = async (seite: Page) => {
    try {
      const cdp = await context.newCDPSession(seite);
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, userAgentMetadata: metadaten });
    } catch { /* Seite schon geschlossen */ }
  };
  for (const p of context.pages()) await anwenden(p);
  context.on('page', (p) => { void anwenden(p); });
  if (!chromium) {
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true }));
  }
}

/** Gerät aus der Liste von Playwright (z. B. "iPhone 15", "Pixel 7"). */
export function geraetAus(name: string) {
  const g = (devices as Record<string, (typeof devices)[string]>)[name];
  if (!g) {
    const aehnlich = Object.keys(devices).filter((n) => n.toLowerCase().includes(name.toLowerCase().split(' ')[0])).slice(0, 8);
    throw new Error(`Unbekanntes Gerät "${name}".${aehnlich.length ? ` Ähnlich: ${aehnlich.join(', ')}` : ''}`);
  }
  return g;
}
