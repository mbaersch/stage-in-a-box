/**
 * Prüfungen, die in einer bestehenden Journey mitlaufen (stageOptionen.pruefungen):
 *
 * - Durchgängigkeit: Kommen Wert, Währung, Transaktions-ID und Artikel eines dataLayer-Events
 *   unverändert bei den Diensten an? Wo die Werte stehen, sagen die Dienstprofile (lib/dienstprofile.ts);
 *   für Dienste ohne Profil werden die Werte nur gesucht (Hinweise).
 * - Cookies: Welche Cookies werden wann gesetzt (vor oder nach der Consent-Entscheidung), von
 *   wem (Skript oder HTTP), mit welcher Domain und Laufzeit? Werte werden nie protokolliert.
 *
 * Ausgewertet am Testende bzw. im Baseline-Vergleich (lib/baseline.ts). Anleitung:
 * docs/anleitung/varianten.md, „Prüfungen“.
 */
import type { BrowserContext } from '@playwright/test';
import { DIENST_PROFILE, feldWert, felder, type ConversionProfil, type DienstProfil } from './dienstprofile';

export interface Pruefungen {
  /**
   * true = ['purchase']; oder Liste der Events; oder mit Ausnahmen der Form 'Dienst:feld'
   * (z. B. 'Google Ads:value', wenn Ads bewusst einen anderen Wert bekommt; 'Meta:items' bei anderem ID-Schema).
   */
  durchgaengigkeit?: boolean | string[] | {
    ereignisse?: string[]; ausnahmen?: string[];
    /**
     * Regeln, deren Requests an den Server-Container gehen (für die Prüfung der Event-ID zur Deduplizierung).
     * GA4-Requests an eine eigene Domain gelten immer als solche.
     */
    serverDienste?: string[];
  };
  /** Cookies mit Zeitpunkt, Herkunft, Domain und Laufzeit protokollieren (cookies.json, Baseline). */
  cookies?: boolean;
  /**
   * Diese Dienste müssen in ihrem ersten Request nach stage.landen() alle UTM-Paare der Landung
   * tragen (z. B. ['GA4']). Braucht stageOptionen.landung mit utm.
   */
  utm?: string[];
  /**
   * GA4-Requests gegen die Erfassungsgrenzen von GA4 prüfen: zu lange Event- und Parameternamen, zu viele
   * Parameter und zu große Requests sind rot, überlange Werte ein Hinweis. '360' für Properties mit 360.
   */
  ga4Grenzen?: boolean | '360';
}

/* ------------------------------------------------------------------ */
/* Durchgängigkeit                                                    */
/* ------------------------------------------------------------------ */

interface Werte {
  value?: number;
  currency?: string;
  transaction_id?: string;
  items?: string[];
  event_id?: string;
}

export interface DurchgaengigkeitsBefund {
  stufe: 'rot' | 'info';
  ereignis: string;
  dienst: string;
  text: string;
}

interface Push { zeit: number; daten: any }
interface Anfrage { zeit: number; dienst: string; host?: string; pfad: string; parameter: Record<string, string>; body?: string; url?: string }

/** Hosts von Google selbst; GA4-Requests an andere Hosts gehen an einen Server-Container */
const GOOGLE_HOST = /(^|\.)(google-analytics\.com|analytics\.google\.com|google\.com|doubleclick\.net)(:\d+)?$/;

/** Wert als eigenständiges Token in einem Feld (nicht als Teil einer längeren ID) */
function enthaeltToken(feld: string, wert: string) {
  const w = wert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return feld === wert || new RegExp(`(^|[^A-Za-z0-9_-])${w}($|[^A-Za-z0-9_-])`).test(feld);
}

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

/** Artikel-IDs aus einem Request je nach Format des Dienstes. */
function items(f: Record<string, string>, def: NonNullable<ConversionProfil['items']>): string[] | undefined {
  if (def.format === 'ga4') {
    // pr1=id123~nmName~… (GA4); ohne id-Segment kein Eintrag
    const re = new RegExp(`^${def.parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    const ids = Object.keys(f).filter((k) => re.test(k)).sort((a, b) => Number(a.match(re)![1]) - Number(b.match(re)![1]))
      .map((k) => f[k].split('~').find((s) => s.startsWith('id'))?.slice(2)).filter((x): x is string => !!x);
    return ids.length ? ids : undefined;
  }
  if (def.format === 'json') {
    const id = (x: any) => String(def.schluessel && x && typeof x === 'object' ? x[def.schluessel] : x);
    const roh = f[def.parameter];
    if (roh !== undefined) {
      try { const a = JSON.parse(roh); return (Array.isArray(a) ? a : [a]).map(id); } catch { return roh.split(',').map((x) => x.trim()); }
    }
    // Schon flach gemachtes JSON-Array im Body: parameter.0(.schluessel), parameter.1(.schluessel) …
    const muster = new RegExp(`^${def.parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)${def.schluessel ? `\\.${def.schluessel}` : ''}$`);
    const ids = Object.keys(f).filter((k) => muster.test(k))
      .sort((a, b) => Number(a.match(muster)![1]) - Number(b.match(muster)![1])).map((k) => f[k]);
    return ids.length ? ids : undefined;
  }
  const roh = f[def.parameter];
  return roh ? roh.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
}

/** Werte, die ein Request für das Ereignis trägt; undefined = Request gehört nicht zu diesem Ereignis. */
function werteAusRequest(ereignis: string, a: Anfrage, f: Record<string, string>, c: ConversionProfil): Werte | undefined {
  if (c.pfad && !c.pfad.test(a.pfad)) return undefined;
  if (c.pflicht?.some((p) => f[p] === undefined)) return undefined;
  if (c.ereignis && f[c.ereignis.parameter] !== (c.ereignis.werte?.[ereignis] ?? ereignis)) return undefined;
  return {
    value: zahl(feldWert(f, c.value)),
    currency: feldWert(f, c.currency),
    transaction_id: feldWert(f, c.transaction_id),
    items: c.items ? items(f, c.items) : undefined,
    event_id: feldWert(f, c.event_id),
  };
}

/** Darstellungen einer Zahl, wie sie in Requests vorkommen: 119.9, 119.90, 11990 (Cent) */
function zahlFormen(v: number) {
  return new Set([String(v), v.toFixed(2), String(Math.round(v * 100))]);
}

/** Ohne Profil: Wo tauchen die Werte des Pushes in den Requests eines Dienstes auf? Nur Hinweise. */
function suche(soll: Werte, anfragen: Anfrage[]): { feld: keyof Werte; gefunden: string[] }[] {
  const out: { feld: keyof Werte; gefunden: string[] }[] = [];
  const pruefe = (feld: keyof Werte, passt: (wert: string) => boolean) => {
    const gefunden = new Set<string>();
    for (const a of anfragen) for (const [k, w] of Object.entries(felder(a.parameter, a.body))) if (passt(w)) gefunden.add(k);
    out.push({ feld, gefunden: [...gefunden] });
  };
  if (soll.transaction_id) {
    // Kurze IDs stecken sonst als Teilstring in Seiten-URLs (/order-received/253/) und Zufallswerten
    const tid = soll.transaction_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alsToken = new RegExp(`(^|[^A-Za-z0-9])${tid}($|[^A-Za-z0-9])`);
    // URLs herausschneiden statt das Feld zu verwerfen: eingebettetes JSON kann URL und echte ID enthalten
    const ohneUrls = (w: string) => w.replace(/(https?:)?\/\/[^\s"'<>,}\]]*/g, ' ').replace(/^\/\S*$/, '');
    pruefe('transaction_id', (w) => w === soll.transaction_id || alsToken.test(ohneUrls(w)));
  }
  if (soll.value !== undefined) { const formen = zahlFormen(soll.value); pruefe('value', (w) => formen.has(w.trim())); }
  return out;
}

export function pruefeDurchgaengigkeit(
  pushes: Push[], anfragen: Anfrage[], ereignis: string, ausnahmen: string[] = [], profile: DienstProfil[] = DIENST_PROFILE,
  serverDienste: string[] = [],
): DurchgaengigkeitsBefund[] {
  const befunde: DurchgaengigkeitsBefund[] = [];
  const conversion = new Map(profile.filter((p) => p.conversion).map((p) => [p.name, p.conversion!]));
  const anServer = (a: Anfrage) => serverDienste.includes(a.dienst) || (a.dienst === 'GA4' && !!a.host && !GOOGLE_HOST.test(a.host));
  const serverImLauf = anfragen.some(anServer);
  pushes.forEach((push, i) => {
    const soll = werteAusPush(push.daten);
    const bis = pushes[i + 1]?.zeit ?? Infinity;
    const nr = pushes.length > 1 ? ` #${i + 1}` : '';
    const danach = anfragen.filter((a) => a.zeit >= push.zeit - 500 && a.zeit < bis);
    const gefunden = new Set<string>();
    // Nachweis je Dienst: welche Felder tatsächlich verglichen wurden
    const verglichen = new Map<string, Set<string>>();
    // Event-IDs zur Deduplizierung je Dienst; Dienste mit event_id im Profil, deren Request keine trug
    const eventIds = new Map<string, Set<string>>();
    const ohneEventId = new Set<string>();
    for (const a of danach) {
      const c = conversion.get(a.dienst);
      if (!c) continue;
      const zeilen = c.zeilenweise && a.body ? a.body.split(/\r?\n/).filter(Boolean) : [a.body];
      for (const zeile of zeilen) {
        const f = felder(a.parameter, zeile);
        const ist = werteAusRequest(ereignis, a, f, c);
        if (!ist) continue;
        gefunden.add(a.dienst);
        if (!verglichen.has(a.dienst)) verglichen.set(a.dienst, new Set());
        for (const feld of ['value', 'currency', 'transaction_id', 'items'] as const) {
          if (soll[feld] === undefined || !c[feld]) continue;
          verglichen.get(a.dienst)!.add(ausnahmen.includes(`${a.dienst}:${feld}`) ? `${feld} (Ausnahme)` : feld);
        }
        if (c.event_id && !anServer(a)) {
          if (ist.event_id) {
            if (!eventIds.has(a.dienst)) eventIds.set(a.dienst, new Set());
            eventIds.get(a.dienst)!.add(ist.event_id);
          } else {
            ohneEventId.add(a.dienst);
          }
        }
        const melde = (feld: keyof Werte, stufe: 'rot' | 'info', text: string) => {
          if (ausnahmen.includes(`${a.dienst}:${feld}`)) return;
          befunde.push({ stufe, ereignis: ereignis + nr, dienst: a.dienst, text });
        };
        if (soll.value !== undefined && c.value) {
          const stufe = c.valueNurHinweis ? 'info' : 'rot';
          if (ist.value === undefined) melde('value', stufe, `value fehlt (dataLayer: ${soll.value})`);
          else if (Math.abs(ist.value - soll.value) > 0.005) melde('value', stufe, `value ${ist.value} statt ${soll.value}`);
        }
        if (soll.currency !== undefined && c.currency) {
          if (ist.currency === undefined) melde('currency', 'rot', `currency fehlt (dataLayer: ${soll.currency})`);
          else if (ist.currency.toUpperCase() !== soll.currency.toUpperCase()) melde('currency', 'rot', `currency ${ist.currency} statt ${soll.currency}`);
        }
        if (soll.transaction_id !== undefined && c.transaction_id) {
          if (ist.transaction_id === undefined) melde('transaction_id', 'rot', `transaction_id fehlt (dataLayer: ${soll.transaction_id})`);
          else if (ist.transaction_id !== soll.transaction_id) melde('transaction_id', 'rot', `transaction_id ${ist.transaction_id} statt ${soll.transaction_id}`);
        }
        if (soll.items && c.items) {
          const stufe = c.itemsNurHinweis ? 'info' : 'rot';
          if (!ist.items) melde('items', stufe, `Artikel fehlen (dataLayer: ${soll.items.join(', ')})`);
          else if ([...ist.items].sort().join('|') !== [...soll.items].sort().join('|')) {
            melde('items', stufe, `Artikel ${ist.items.join(', ')} statt ${soll.items.join(', ')}`);
          }
        }
      }
    }
    // Deduplizierung: Die Event-ID eines Pixels muss im Request an den Server-Container ankommen, sonst kann
    // der Server sie nicht an die Conversions API weitergeben. Ohne Server-Container gibt es nichts zu prüfen.
    const server = danach.filter(anServer);
    if (serverImLauf) {
      for (const [d, ids] of eventIds) {
        if (ausnahmen.includes(`${d}:event_id`)) continue;
        for (const id of ids) {
          verglichen.get(d)?.add('event_id');
          const wo = new Set<string>();
          for (const s of server) {
            const zeilen = s.body ? s.body.split(/\r?\n/).filter(Boolean) : [undefined];
            for (const zeile of zeilen) for (const [k, w] of Object.entries(felder(s.parameter, zeile))) if (enthaeltToken(w, id)) wo.add(k);
          }
          if (!server.length) {
            befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: `event_id ${id}: nach dem Push kein Request an den Server-Container` });
          } else if (wo.size) {
            befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: `event_id ${id} auch im Request an den Server-Container (${[...wo].join(', ')})` });
          } else {
            befunde.push({
              stufe: 'rot', ereignis: ereignis + nr, dienst: d,
              text: `event_id ${id} fehlt im Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen`,
            });
          }
        }
      }
      for (const d of ohneEventId) {
        if (eventIds.has(d) || ausnahmen.includes(`${d}:event_id`)) continue;
        befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: 'Pixel ohne event_id – keine Deduplizierung mit der Conversions API möglich' });
      }
    }
    for (const [d, liste] of verglichen) {
      befunde.push({
        stufe: 'info', ereignis: ereignis + nr, dienst: d,
        text: liste.size ? `verglichen: ${[...liste].join(', ')}` : 'verglichen: nichts – der Push enthält keine Werte, die das Profil des Dienstes kennt',
      });
    }
    // Dienste mit Profil, die nach dem Push gesendet, aber das Ereignis nicht erkennbar übertragen haben
    for (const d of new Set(danach.map((a) => a.dienst))) {
      if (conversion.has(d) && !gefunden.has(d)) {
        befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: 'kein Request mit diesem Ereignis nach dem Push' });
      }
    }
    // Sonst bliebe ein Push, nach dem gar nichts mehr gesendet wurde (z. B. Test zu früh beendet), ohne Befund
    for (const d of new Set(anfragen.map((a) => a.dienst))) {
      if (conversion.has(d) && !danach.some((a) => a.dienst === d)) {
        befunde.push({ stufe: 'info', ereignis: ereignis + nr, dienst: d, text: 'nach dem Push gar kein Request dieses Dienstes' });
      }
    }
    // Dienste ohne Profil: Werte suchen, nur Hinweise (Grundlage für ein neues Profil)
    for (const d of new Set(danach.map((a) => a.dienst).filter((x) => !conversion.has(x)))) {
      for (const { feld, gefunden: wo } of suche(soll, danach.filter((a) => a.dienst === d))) {
        befunde.push({
          stufe: 'info', ereignis: ereignis + nr, dienst: d,
          text: wo.length ? `${feld} (${feld === 'value' ? soll.value : soll.transaction_id}) gefunden in: ${wo.join(', ')} – kein Profil, nicht geprüft`
            : `${feld} in keinem Request gefunden – kein Profil`,
        });
      }
    }
  });
  // Mehrfachkopien (z. B. 1p-conversion) erzeugen gleiche Befunde: einmal reicht
  const gesehen = new Set<string>();
  return befunde.filter((b) => { const k = JSON.stringify(b); if (gesehen.has(k)) return false; gesehen.add(k); return true; });
}

/**
 * Artikel über die ganze Journey (alle dataLayer-Pushes mit ecommerce.items): Behält ein Artikel seine ID
 * von view_item bis purchase? Wechselnde IDs sind rot. Felder, die erst später im Kaufprozess dazukommen
 * (z. B. item_category ab dem Checkout), sind üblich und nur ein Hinweis; Änderungen daran sieht die Baseline.
 */
export function pruefeArtikelVerlauf(pushes: Push[]): DurchgaengigkeitsBefund[] {
  const befunde: DurchgaengigkeitsBefund[] = [];
  const info = (text: string, stufe: 'rot' | 'info' = 'info') => befunde.push({ stufe, ereignis: 'Journey', dienst: 'dataLayer', text });
  const vorhanden = (v: unknown) => v !== undefined && v !== null && v !== '';
  // Je Artikel-ID: Events in Reihenfolge mit den belegten Feldern; je Name: die IDs
  const nachId = new Map<string, { ereignis: string; felder: Set<string> }[]>();
  const nachName = new Map<string, Map<string, Set<string>>>();
  const namenJeId = new Map<string, Set<string>>();
  for (const p of pushes) {
    const d = Array.isArray(p.daten) ? { event: p.daten[1], ecommerce: p.daten[2] } : p.daten;
    const e = d?.ecommerce && typeof d.ecommerce === 'object' ? d.ecommerce : d;
    if (!Array.isArray(e?.items) || typeof d?.event !== 'string') continue;
    for (const item of e.items) {
      const id = vorhanden(item?.item_id) ? String(item.item_id) : vorhanden(item?.id) ? String(item.id) : undefined;
      const name = vorhanden(item?.item_name) ? String(item.item_name) : vorhanden(item?.name) ? String(item.name) : undefined;
      if (name) {
        if (!nachName.has(name)) nachName.set(name, new Map());
        const ids = nachName.get(name)!;
        const k = id ?? '(ohne ID)';
        if (!ids.has(k)) ids.set(k, new Set());
        ids.get(k)!.add(d.event);
      }
      if (!id) continue;
      if (name) { if (!namenJeId.has(id)) namenJeId.set(id, new Set()); namenJeId.get(id)!.add(name); }
      if (!nachId.has(id)) nachId.set(id, []);
      const felder = new Set(Object.keys(item).filter((f) => vorhanden(item[f])));
      const liste = nachId.get(id)!;
      // Wiederholte Pushes desselben Events (Repeater, Reload) zählen einmal
      if (!liste.some((x) => x.ereignis === d.event)) liste.push({ ereignis: d.event, felder });
    }
  }
  for (const [name, ids] of nachName) {
    if (ids.size > 1) {
      info(`Artikel „${name}“ wechselt die ID: ${[...ids].map(([id, ev]) => `${id} (${[...ev].join(', ')})`).join(' / ')}`, 'rot');
    }
  }
  for (const [id, namen] of namenJeId) if (namen.size > 1) info(`Artikel ${id} wechselt den Namen: ${[...namen].join(' / ')}`);
  for (const [id, liste] of nachId) {
    const alle = new Set(liste.flatMap((x) => [...x.felder]));
    for (const feld of alle) {
      const fehlt = liste.filter((x) => !x.felder.has(feld)).map((x) => x.ereignis);
      if (!fehlt.length) continue;
      const ab = liste.findIndex((x) => x.felder.has(feld));
      const spaeterDa = liste.slice(ab).every((x) => x.felder.has(feld));
      info(spaeterDa
        ? `Artikel ${id}: ${feld} erst ab ${liste[ab].ereignis} (fehlt bei ${fehlt.join(', ')}) – üblich`
        : `Artikel ${id}: ${feld} fehlt bei ${fehlt.join(', ')}`);
    }
  }
  return befunde;
}

export function ereignisseAus(option: Pruefungen['durchgaengigkeit']): { ereignisse: string[]; ausnahmen: string[]; serverDienste: string[] } {
  if (!option) return { ereignisse: [], ausnahmen: [], serverDienste: [] };
  if (option === true) return { ereignisse: ['purchase'], ausnahmen: [], serverDienste: [] };
  if (Array.isArray(option)) return { ereignisse: option, ausnahmen: [], serverDienste: [] };
  return { ereignisse: option.ereignisse ?? ['purchase'], ausnahmen: option.ausnahmen ?? [], serverDienste: option.serverDienste ?? [] };
}

/* ------------------------------------------------------------------ */
/* GA4-Erfassungsgrenzen                                              */
/* ------------------------------------------------------------------ */

/**
 * Grenzen laut Google ([GA4] Event collection limits, Google Analytics 360). Was darüber liegt, verarbeitet
 * GA4 nicht; Daten über 16 KB pro Request verwirft GA4 für den ganzen Request.
 */
export const GA4_GRENZEN = {
  standard: { eventName: 40, parameter: 25, parameterName: 40, wert: 100, dl: 1000, dt: 300, dr: 420, upName: 24, upWert: 36 },
  '360': { eventName: 40, parameter: 100, parameterName: 40, wert: 100, dl: 1000, dt: 500, dr: 500, upName: 24, upWert: 36 },
  requestBytes: 16 * 1024,
} as const;

/** Prüft GA4-Requests (auch gebündelte Events im Body) gegen die Erfassungsgrenzen. */
export function pruefeGa4Grenzen(anfragen: Anfrage[], variante: 'standard' | '360' = 'standard'): DurchgaengigkeitsBefund[] {
  const g = GA4_GRENZEN[variante];
  const befunde: DurchgaengigkeitsBefund[] = [];
  const melde = (stufe: 'rot' | 'info', ereignis: string, text: string) => befunde.push({ stufe, ereignis, dienst: 'GA4', text });
  for (const a of anfragen.filter((x) => x.dienst === 'GA4')) {
    const query = a.url?.includes('?') ? a.url.slice(a.url.indexOf('?') + 1) : '';
    const bytes = Buffer.byteLength(query) + Buffer.byteLength(a.body ?? '');
    const kb = (bytes / 1024).toFixed(1);
    if (bytes > GA4_GRENZEN.requestBytes) melde('rot', a.parameter.en ?? 'Request', `Request mit ${kb} KB über 16 KB: GA4 verwirft alle Events darin`);
    else if (bytes > GA4_GRENZEN.requestBytes * 0.8) melde('info', a.parameter.en ?? 'Request', `Request mit ${kb} KB nahe an der Grenze von 16 KB`);

    const zeilen = a.body ? a.body.split(/\r?\n/).filter(Boolean) : [undefined];
    for (const zeile of zeilen) {
      const f = { ...a.parameter, ...(zeile ? Object.fromEntries(new URLSearchParams(zeile)) : {}) };
      const en = f.en ?? '(ohne Namen)';
      if (en.length > g.eventName) melde('rot', en, `Eventname mit ${en.length} Zeichen über ${g.eventName}: GA4 verarbeitet das Event nicht`);
      const eigene = Object.keys(f).filter((k) => /^epn?\./.test(k));
      if (eigene.length > g.parameter) melde('rot', en, `${eigene.length} Parameter über ${g.parameter}: GA4 verarbeitet die übrigen nicht`);
      for (const k of eigene) {
        const name = k.replace(/^epn?\./, '');
        if (name.length > g.parameterName) melde('rot', en, `Parametername ${name} mit ${name.length} Zeichen über ${g.parameterName}`);
        if (k.startsWith('ep.') && f[k].length > g.wert) melde('info', en, `Wert von ${name} mit ${f[k].length} Zeichen über ${g.wert}`);
      }
      for (const [k, grenze, name] of [['dl', g.dl, 'page_location'], ['dt', g.dt, 'page_title'], ['dr', g.dr, 'page_referrer']] as const) {
        if (f[k] && f[k].length > grenze) melde('info', en, `${name} mit ${f[k].length} Zeichen über ${grenze}`);
      }
      for (const k of Object.keys(f).filter((x) => /^upn?\./.test(x))) {
        const name = k.replace(/^upn?\./, '');
        if (name.length > g.upName) melde('rot', en, `Name der User Property ${name} mit ${name.length} Zeichen über ${g.upName}`);
        if (k.startsWith('up.') && f[k].length > g.upWert) melde('info', en, `Wert der User Property ${name} mit ${f[k].length} Zeichen über ${g.upWert}`);
      }
    }
  }
  const gesehen = new Set<string>();
  return befunde.filter((b) => { const k = JSON.stringify(b); if (gesehen.has(k)) return false; gesehen.add(k); return true; });
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

/** Fasst Namen mit Kennungen zusammen: _ga_ABC123 → _ga_<ID>, lange Ziffern/Hex → #. Groß und mit Ziffer, sonst wird _uetmsclkid zu _uet<ID>. */
export function cookieMuster(name: string) {
  return name.replace(/^(_ga_|_gcl_|_uet)(?=[A-Z]*\d)[A-Z0-9]{6,}$/, '$1<ID>').replace(/[0-9a-f]{12,}/gi, '#').replace(/\d{4,}/g, '#');
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
