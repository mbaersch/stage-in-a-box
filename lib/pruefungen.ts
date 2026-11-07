/**
 * Prüfungen, die in einer bestehenden Journey mitlaufen (stageOptionen.pruefungen):
 *
 * - Durchgängigkeit: Kommen Wert, Währung, Transaktions-ID und Artikel eines dataLayer-Events
 *   unverändert bei den Diensten an (GA4, Google Ads, Meta, Microsoft Ads)?
 * - Cookies: Welche Cookies werden wann gesetzt (vor oder nach der Consent-Entscheidung), von
 *   wem (Skript oder HTTP), mit welcher Domain und Laufzeit? Werte werden nie protokolliert.
 *
 * Ausgewertet am Testende bzw. im Baseline-Vergleich (lib/baseline.ts). Anleitung:
 * docs/anleitung/varianten.md, „Prüfungen“.
 */
import type { BrowserContext } from '@playwright/test';

export interface Pruefungen {
  /**
   * true = ['purchase']; oder Liste der Events; oder mit Ausnahmen der Form 'Dienst:feld'
   * (z. B. 'Google Ads:value', wenn Ads bewusst einen anderen Wert bekommt; 'Meta:items' bei anderem ID-Schema).
   */
  durchgaengigkeit?: boolean | string[] | { ereignisse?: string[]; ausnahmen?: string[] };
  /** Cookies mit Zeitpunkt, Herkunft, Domain und Laufzeit protokollieren (cookies.json, Baseline). */
  cookies?: boolean;
}

/* ------------------------------------------------------------------ */
/* Durchgängigkeit                                                    */
/* ------------------------------------------------------------------ */

interface Werte {
  value?: number;
  currency?: string;
  transaction_id?: string;
  items?: string[];
}

export interface DurchgaengigkeitsBefund {
  stufe: 'rot' | 'info';
  ereignis: string;
  dienst: string;
  text: string;
}

interface Push { zeit: number; daten: any }
interface Anfrage { zeit: number; dienst: string; pfad: string; parameter: Record<string, string>; body?: string }

/** Meta-Standard-Events zu GA4-Namen */
const META_EVENTS: Record<string, string> = {
  purchase: 'Purchase', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', generate_lead: 'Lead',
  view_item: 'ViewContent', add_payment_info: 'AddPaymentInfo', sign_up: 'CompleteRegistration', add_to_wishlist: 'AddToWishlist',
};

const zahl = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

function werteAusPush(daten: any): Werte {
  const e = daten?.ecommerce && typeof daten.ecommerce === 'object' ? daten.ecommerce : daten ?? {};
  const items = Array.isArray(e.items) ? e.items.map((i: any) => String(i?.item_id ?? i?.id ?? '')).filter(Boolean) : undefined;
  return {
    value: zahl(e.value),
    currency: e.currency ? String(e.currency) : undefined,
    transaction_id: e.transaction_id !== undefined ? String(e.transaction_id) : undefined,
    items: items?.length ? items : undefined,
  };
}

function bodyParameter(body?: string): Record<string, string> {
  if (!body || /^\s*[[{]/.test(body) || !body.includes('=')) return {};
  try { return Object.fromEntries(new URLSearchParams(body)); } catch { return {}; }
}

/** GA4-Artikel: pr1=id123~nmName~… */
function ga4Items(p: Record<string, string>): string[] | undefined {
  const ids = Object.keys(p).filter((k) => /^pr\d+$/.test(k)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
    .map((k) => p[k].split('~').find((s) => s.startsWith('id'))?.slice(2))
    .filter((x): x is string => !!x);
  return ids.length ? ids : undefined;
}

function metaItems(p: Record<string, string>): string[] | undefined {
  const roh = p['cd[content_ids]'];
  if (!roh) return undefined;
  try { const a = JSON.parse(roh); return Array.isArray(a) ? a.map(String) : [String(a)]; } catch { return roh.split(',').map((s) => s.trim()); }
}

/** Werte, die ein Request eines Dienstes für dieses Ereignis trägt; undefined = Request gehört nicht dazu. */
function werteAusRequest(ereignis: string, a: Anfrage, p: Record<string, string>): Werte | undefined {
  if (a.dienst === 'GA4') {
    if (p.en !== ereignis) return undefined;
    return { value: zahl(p['epn.value'] ?? p['ep.value']), currency: p.cu ?? p['ep.currency'], transaction_id: p['ep.transaction_id'], items: ga4Items(p) };
  }
  if (a.dienst === 'Google Ads') {
    if (!/\/(pagead\/)?(1p-)?conversion\//.test(a.pfad) || !p.label) return undefined;
    return { value: zahl(p.value), currency: p.currency_code, transaction_id: p.oid };
  }
  if (a.dienst === 'Meta') {
    if (p.ev !== (META_EVENTS[ereignis] ?? ereignis)) return undefined;
    return { value: zahl(p['cd[value]']), currency: p['cd[currency]'], transaction_id: p['cd[order_id]'], items: metaItems(p) };
  }
  if (a.dienst === 'Microsoft Ads') {
    if (p.gv === undefined && p.gc === undefined) return undefined;
    return { value: zahl(p.gv), currency: p.gc };
  }
  return undefined;
}

/** Felder, die im Request fehlen dürfen, ohne dass es ein Fehler ist (Dienst kennt sie nicht). */
const NICHT_UEBERTRAGEN: Record<string, (keyof Werte)[]> = {
  'Google Ads': ['items'],
  'Microsoft Ads': ['items', 'transaction_id'],
  Meta: ['transaction_id'],
};

/** Artikel-IDs: bei GA4 rot, bei Werbediensten nur Hinweis (oft bewusst anderes ID-Schema, z. B. Feed-IDs). */
const ITEMS_NUR_HINWEIS = new Set(['Google Ads', 'Meta', 'Microsoft Ads']);

export function pruefeDurchgaengigkeit(
  pushes: Push[], anfragen: Anfrage[], ereignis: string, ausnahmen: string[] = [],
): DurchgaengigkeitsBefund[] {
  const befunde: DurchgaengigkeitsBefund[] = [];
  const dienste = new Set(anfragen.map((a) => a.dienst));
  pushes.forEach((push, i) => {
    const soll = werteAusPush(push.daten);
    const bis = pushes[i + 1]?.zeit ?? Infinity;
    const nr = pushes.length > 1 ? ` #${i + 1}` : '';
    const gefunden = new Set<string>();
    for (const a of anfragen) {
      if (a.zeit < push.zeit - 500 || a.zeit >= bis) continue;
      const zeilen = a.dienst === 'GA4' && a.body ? a.body.split(/\r?\n/).filter(Boolean) : [null];
      for (const zeile of zeilen) {
        const p = { ...a.parameter, ...(zeile === null ? bodyParameter(a.body) : bodyParameter(zeile)) };
        const ist = werteAusRequest(ereignis, a, p);
        if (!ist) continue;
        gefunden.add(a.dienst);
        const melde = (feld: keyof Werte, stufe: 'rot' | 'info', text: string) => {
          if (ausnahmen.includes(`${a.dienst}:${feld}`)) return;
          befunde.push({ stufe, ereignis: ereignis + nr, dienst: a.dienst, text });
        };
        if (soll.value !== undefined) {
          if (ist.value === undefined) melde('value', 'rot', `value fehlt (dataLayer: ${soll.value})`);
          else if (Math.abs(ist.value - soll.value) > 0.005) melde('value', 'rot', `value ${ist.value} statt ${soll.value}`);
        }
        if (soll.currency !== undefined) {
          if (ist.currency === undefined) melde('currency', 'rot', `currency fehlt (dataLayer: ${soll.currency})`);
          else if (ist.currency.toUpperCase() !== soll.currency.toUpperCase()) melde('currency', 'rot', `currency ${ist.currency} statt ${soll.currency}`);
        }
        if (soll.transaction_id !== undefined && !(NICHT_UEBERTRAGEN[a.dienst] ?? []).includes('transaction_id')) {
          if (ist.transaction_id === undefined) melde('transaction_id', 'rot', `transaction_id fehlt (dataLayer: ${soll.transaction_id})`);
          else if (ist.transaction_id !== soll.transaction_id) melde('transaction_id', 'rot', `transaction_id ${ist.transaction_id} statt ${soll.transaction_id}`);
        }
        if (soll.items && !(NICHT_UEBERTRAGEN[a.dienst] ?? []).includes('items')) {
          const stufe = ITEMS_NUR_HINWEIS.has(a.dienst) ? 'info' : 'rot';
          if (!ist.items) melde('items', stufe, `Artikel fehlen (dataLayer: ${soll.items.join(', ')})`);
          else if ([...ist.items].sort().join('|') !== [...soll.items].sort().join('|')) {
            melde('items', stufe, `Artikel ${ist.items.join(', ')} statt ${soll.items.join(', ')}`);
          }
        }
      }
    }
    for (const d of dienste) {
      if (!gefunden.has(d) && ['GA4', 'Google Ads', 'Meta', 'Microsoft Ads'].includes(d)) {
        befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: 'kein passender Request nach dem Push gefunden' });
      }
    }
    if (!gefunden.size) befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: '–', text: 'kein Dienst hat das Ereignis gesendet' });
  });
  // Mehrfachkopien (z. B. 1p-conversion) erzeugen gleiche Befunde: einmal reicht
  const gesehen = new Set<string>();
  return befunde.filter((b) => { const k = JSON.stringify(b); if (gesehen.has(k)) return false; gesehen.add(k); return true; });
}

export function ereignisseAus(option: Pruefungen['durchgaengigkeit']): { ereignisse: string[]; ausnahmen: string[] } {
  if (!option) return { ereignisse: [], ausnahmen: [] };
  if (option === true) return { ereignisse: ['purchase'], ausnahmen: [] };
  if (Array.isArray(option)) return { ereignisse: option, ausnahmen: [] };
  return { ereignisse: option.ereignisse ?? ['purchase'], ausnahmen: option.ausnahmen ?? [] };
}

/* ------------------------------------------------------------------ */
/* Cookies                                                            */
/* ------------------------------------------------------------------ */

export interface CookieEreignis {
  zeit: number;
  name: string;
  quelle: 'skript' | 'http';
  /** Host der Seite (Skript) bzw. der Antwort (HTTP) */
  host: string;
  /** Attribute ohne Wert, z. B. "domain=.example.de; max-age=7776000" */
  attribute: string;
  /** true, wenn das Cookie gelöscht wird (max-age=0 bzw. expires in der Vergangenheit) */
  loeschen?: boolean;
}

export interface CookieEintrag {
  muster: string;
  namen: string[];
  domain: string;
  zuerstGesetzt: 'vor Consent' | 'nach Consent' | 'ohne Entscheidung' | 'unbekannt';
  quellen: string[];
  laufzeit: string;
  amEnde: boolean;
}

/** Fasst Namen mit Kennungen zusammen: _ga_ABC123 → _ga_<ID>, lange Ziffern/Hex → # */
export function cookieMuster(name: string) {
  return name.replace(/^(_ga_|_gcl_|_uet)[A-Z0-9]{6,}$/i, '$1<ID>').replace(/[0-9a-f]{12,}/gi, '#').replace(/\d{4,}/g, '#');
}

function laufzeit(expires: number) {
  if (expires < 0) return 'Sitzung';
  const tage = (expires * 1000 - Date.now()) / 86_400_000;
  if (tage < 1) return '< 1 Tag';
  if (tage <= 31) return '≤ 1 Monat';
  if (tage <= 92) return '≤ 3 Monate';
  if (tage <= 400) return '≤ 13 Monate';
  return '> 13 Monate';
}

/** Init-Skript: meldet jedes Setzen per document.cookie bzw. cookieStore, ohne den Wert. */
export function cookieBeobachter() {
  const melde = (window as any).__stageCookie as (v: string) => void;
  const proto = Document.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, 'cookie');
  if (d?.set && d.get) {
    Object.defineProperty(proto, 'cookie', {
      configurable: true,
      get() { return d.get!.call(this); },
      set(v) {
        try {
          const text = String(v);
          const [paar, ...attr] = text.split(';');
          const name = paar.split('=')[0].trim();
          melde(JSON.stringify({ name, attribute: attr.map((a) => a.trim()).join('; '), host: location.host }));
        } catch { /* nie die Seite stören */ }
        d.set!.call(this, v);
      },
    });
  }
  const cs = (window as any).cookieStore;
  if (cs?.set) {
    const orig = cs.set.bind(cs);
    cs.set = (a: any, b?: any) => {
      try {
        const o = typeof a === 'string' ? { name: a } : a ?? {};
        const attr = ['domain', 'path', 'expires', 'sameSite'].filter((k) => o[k] !== undefined).map((k) => `${k}=${o[k]}`).join('; ');
        melde(JSON.stringify({ name: o.name, attribute: attr, host: location.host }));
      } catch { /* ignorieren */ }
      return orig(a, b);
    };
  }
}

export function istLoeschung(attribute: string) {
  const a = attribute.toLowerCase();
  if (/max-age\s*=\s*(0|-\d+)\b/.test(a)) return true;
  const exp = a.match(/expires\s*=\s*([^;]+)/)?.[1];
  return !!exp && Date.parse(exp) < Date.now() - 1000;
}

/** Bericht je Cookie-Muster: wann zuerst gesetzt (relativ zur Consent-Entscheidung), Domain, Laufzeit am Ende. */
export async function cookieBericht(
  context: BrowserContext, ereignisse: CookieEreignis[], entscheidung: number | undefined,
): Promise<CookieEintrag[]> {
  const amEnde = await context.cookies().catch(() => []);
  const eintraege = new Map<string, CookieEintrag & { erste?: number }>();
  const hole = (name: string, domain: string) => {
    const k = `${cookieMuster(name)}|${domain}`;
    if (!eintraege.has(k)) {
      eintraege.set(k, { muster: cookieMuster(name), namen: [], domain, zuerstGesetzt: 'unbekannt', quellen: [], laufzeit: '–', amEnde: false });
    }
    const e = eintraege.get(k)!;
    if (!e.namen.includes(name)) e.namen.push(name);
    return e;
  };
  const basis = (host: string) => host.replace(/:\d+$/, '').split('.').slice(-2).join('.');
  for (const c of amEnde) {
    const e = hole(c.name, c.domain.replace(/^\./, ''));
    e.amEnde = true;
    e.laufzeit = laufzeit(c.expires);
  }
  for (const ev of ereignisse.filter((x) => !x.loeschen).sort((a, b) => a.zeit - b.zeit)) {
    const domainAttr = ev.attribute.match(/domain\s*=\s*\.?([^;\s]+)/i)?.[1];
    // Zuordnung zum Cookie am Ende über Name und Basis-Domain; sonst eigener Eintrag
    const passend = [...eintraege.values()].find((e) => e.namen.includes(ev.name)
      && basis(e.domain) === basis(domainAttr ?? ev.host));
    const e = passend ?? hole(ev.name, (domainAttr ?? ev.host).replace(/:\d+$/, ''));
    if (!e.quellen.includes(ev.quelle)) e.quellen.push(ev.quelle);
    if (e.erste === undefined) {
      e.erste = ev.zeit;
      e.zuerstGesetzt = entscheidung === undefined ? 'ohne Entscheidung' : ev.zeit < entscheidung ? 'vor Consent' : 'nach Consent';
    }
  }
  return [...eintraege.values()].map(({ erste: _e, ...rest }) => rest)
    .sort((a, b) => a.muster.localeCompare(b.muster) || a.domain.localeCompare(b.domain));
}
