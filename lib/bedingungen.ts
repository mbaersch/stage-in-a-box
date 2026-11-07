/**
 * Bedingungen für eine Journey, die man auf der echten Website nicht ohne Weiteres bekommt:
 * Landung über eine Anzeige (Klick-IDs), gedrosseltes Netz und CPU, Gerät und Browser-Kennung.
 * Eingeschaltet über stageOptionen, ausgewertet in lib/stage.ts. Anleitung: docs/anleitung/varianten.md.
 */
import { devices, type BrowserContext, type Page } from '@playwright/test';

/* ------------------------------------------------------------------ */
/* Landung über eine Anzeige                                          */
/* ------------------------------------------------------------------ */

/** URL-Parameter, mit denen Werbenetzwerke Klicks kennzeichnen. */
export const KLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid', 'epik'] as const;
export type KlickId = (typeof KLICK_IDS)[number];

export interface Landung {
  /** Diese Klick-IDs mit erkennbaren Testwerten (TEST-sib-…) an die Startadresse hängen. */
  klickIds?: KlickId[];
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
  /** Wo der Wert im Browser gespeichert ist, z. B. "Cookie _gcl_aw (.example.de)". */
  gespeichert: string[];
  /** Tracking-Requests, die den Wert enthalten (URL oder Body). */
  requests: { nr: number; dienst: string; ereignis: string; zeit: number }[];
}

interface TrefferLike {
  nr: number; dienst: string; url: string; body?: string; zeit: number; pfad: string; parameter: Record<string, string>;
}

const dekodiert = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

/** Sucht jeden Klick-ID-Wert in Cookies, localStorage der offenen Seiten und allen Tracking-Requests. */
export async function klickIdBefunde(
  context: BrowserContext, werte: Record<string, string>, treffer: TrefferLike[],
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
  return Object.entries(werte).filter(([id]) => (KLICK_IDS as readonly string[]).includes(id)).map(([id, wert]) => {
    const gespeichert = [
      ...cookies.filter((c) => dekodiert(c.value).includes(wert)).map((c) => `Cookie ${c.name} (${c.domain})`),
      ...speicher.filter((s) => dekodiert(s.wert).includes(wert)).map((s) => `localStorage ${s.key} (${s.herkunft})`),
    ];
    const requests = treffer
      .filter((t) => dekodiert(t.url).includes(wert) || (t.body ? dekodiert(t.body).includes(wert) : false))
      .map((t) => ({
        nr: t.nr, dienst: t.dienst, zeit: t.zeit,
        ereignis: t.parameter.en ?? t.parameter.ev ?? t.parameter.event ?? t.parameter.label ?? t.pfad,
      }));
    return { id, wert, gespeichert: [...new Set(gespeichert)], requests };
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

/**
 * Entfernt die Client Hints, wenn die Kennung zu einem Browser ohne Client Hints gehört (Safari,
 * Firefox): Marken leer statt "Chromium", navigator.userAgentData undefined. Chromium sendet den
 * Header Sec-CH-UA dann leer statt gar nicht – Skripte sehen keine Chromium-Marken mehr.
 */
export async function clientHintsEntfernen(context: BrowserContext, ua: string) {
  if (hatClientHints(ua)) return;
  const leer = { brands: [], fullVersionList: [], platform: '', platformVersion: '', architecture: '', model: '', mobile: /Mobile|iPhone|Android/.test(ua) };
  const anwenden = async (seite: Page) => {
    try {
      const cdp = await context.newCDPSession(seite);
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, userAgentMetadata: leer });
    } catch { /* Seite schon geschlossen */ }
  };
  for (const p of context.pages()) await anwenden(p);
  context.on('page', (p) => { void anwenden(p); });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true }));
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
