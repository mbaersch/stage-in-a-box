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
import type { BrowserContext } from './playwright';
import { createHash } from 'node:crypto';
import { DIENST_PROFILE, feldWert, felder, type ConversionProfil, type DienstProfil, type Feld } from './dienstprofile';

export interface Pruefungen {
  /**
   * true = ['purchase']; oder Liste der Events; oder mit Ausnahmen der Form 'Dienst:feld'
   * (z. B. 'Google Ads:value', wenn Ads bewusst einen anderen Wert bekommt; 'Meta:items' bei anderem ID-Schema).
   */
  durchgaengigkeit?: boolean | string[] | { ereignisse?: string[]; ausnahmen?: string[] };
  /** Cookies mit Zeitpunkt, Herkunft, Domain und Laufzeit protokollieren (cookies.json, Baseline). */
  cookies?: boolean;
  /**
   * Diese Dienste müssen in ihrem ersten Request nach stage.landen() alle UTM-Paare der Landung
   * tragen (z. B. ['GA4']). Braucht stageOptionen.landung mit utm.
   */
  utm?: string[];
  /**
   * GA4-Requests gegen die Erfassungsgrenzen von GA4 prüfen: zu lange Event- und Parameternamen, zu viele
   * Parameter sind rot, überlange Werte und Requests über 16 KB ein Hinweis. '360' für Properties mit 360.
   */
  ga4Grenzen?: boolean | '360';
  /**
   * Event-ID zur Deduplizierung für alle Events (siehe pruefeDeduplizierung). serverDienste: weitere Regeln,
   * deren Requests an den Server-Container gehen; ga4Server: false, wenn GA4 auf der eigenen Domain kein
   * Server-Container ist (z. B. Google Tag Gateway; am Request nicht unterscheidbar, Vorgabe: true);
   * ausnahmen: Dienstnamen; serverIdFelder: Feld je Dienst, in dem der Server-Request dessen ID trägt,
   * z. B. { Meta: 'ep.fb_event_id' } – dann werden auch IDs am Server ohne passendes Pixel gemeldet.
   */
  deduplizierung?: boolean | {
    serverDienste?: string[]; ga4Server?: boolean; ausnahmen?: string[]; serverIdFelder?: Record<string, string | string[]>;
  };
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
  /** Nur Deduplizierung: Art des Hinweises (für die Anmerkung „Achtung“) */
  art?: 'pixel-ohne-id' | 'server-ohne-pixel' | 'id-mehrfach';
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
  if (c.ereignis) {
    const erwartet = [c.ereignis.werte?.[ereignis] ?? ereignis].flat().map((n) => n.toLowerCase());
    if (!erwartet.includes(String(f[c.ereignis.parameter] ?? '').toLowerCase())) return undefined;
  }
  return {
    value: zahl(feldWert(f, c.value)),
    currency: feldWert(f, c.currency),
    transaction_id: feldWert(f, c.transaction_id),
    items: c.items ? items(f, c.items) : undefined,
  };
}

/** Darstellungen einer Zahl, wie sie in Requests vorkommen: 119.9, 119.90, 11990 (Cent) */
function zahlFormen(v: number) {
  // Komma als Dezimaltrenner (laut Parser der Extension bei Reddit m.valueDecimal); Cent bei OpenAI
  return new Set([String(v), v.toFixed(2), v.toFixed(2).replace('.', ','), String(v).replace('.', ','), String(Math.round(v * 100))]);
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
): DurchgaengigkeitsBefund[] {
  const befunde: DurchgaengigkeitsBefund[] = [];
  const conversion = new Map(profile.filter((p) => p.conversion).map((p) => [p.name, p.conversion!]));
  pushes.forEach((push, i) => {
    const soll = werteAusPush(push.daten);
    const bis = pushes[i + 1]?.zeit ?? Infinity;
    const nr = pushes.length > 1 ? ` #${i + 1}` : '';
    const danach = anfragen.filter((a) => a.zeit >= push.zeit - 500 && a.zeit < bis);
    const gefunden = new Set<string>();
    // Nachweis je Dienst: welche Felder tatsächlich verglichen wurden
    const verglichen = new Map<string, Set<string>>();
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
          // Ohne Wert ist die Währung bedeutungslos: reine Zähl-Conversion, eine Entscheidung im Setup
          if (ist.currency === undefined && ist.value === undefined) melde('currency', 'info', `currency fehlt, value auch – Conversion ohne Wert (dataLayer: ${soll.currency})`);
          else if (ist.currency === undefined) melde('currency', 'rot', `currency fehlt (dataLayer: ${soll.currency})`);
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
    for (const [d, liste] of verglichen) {
      befunde.push({
        stufe: 'info', ereignis: ereignis + nr, dienst: d,
        text: liste.size ? `verglichen: ${[...liste].join(', ')}` : 'verglichen: nichts – Push und Profil des Dienstes haben keine gemeinsamen Werte',
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
    // Dienste ohne Profil für Wert und Transaktions-ID: Werte suchen, nur Hinweise (Grundlage für ein Profil)
    const ohneWerte = (x: string) => !conversion.get(x)?.value && !conversion.get(x)?.transaction_id;
    for (const d of new Set(danach.map((a) => a.dienst).filter(ohneWerte))) {
      for (const { feld, gefunden: wo } of suche(soll, danach.filter((a) => a.dienst === d))) {
        befunde.push({
          stufe: 'info', ereignis: ereignis + nr, dienst: d,
          text: wo.length ? `${feld} (${feld === 'value' ? soll.value : soll.transaction_id}) gefunden in: ${wo.join(', ')} – nicht im Profil, nicht geprüft`
            : `${feld} in keinem Request gefunden – nicht im Profil`,
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

export function ereignisseAus(option: Pruefungen['durchgaengigkeit']): { ereignisse: string[]; ausnahmen: string[] } {
  if (!option) return { ereignisse: [], ausnahmen: [] };
  if (option === true) return { ereignisse: ['purchase'], ausnahmen: [] };
  if (Array.isArray(option)) return { ereignisse: option, ausnahmen: [] };
  return { ereignisse: option.ereignisse ?? ['purchase'], ausnahmen: option.ausnahmen ?? [] };
}

/* ------------------------------------------------------------------ */
/* Event-ID zur Deduplizierung                                        */
/* ------------------------------------------------------------------ */

/**
 * Event-ID zur Deduplizierung, über alle Requests der Dienste mit Profil im ganzen Lauf (eine ID ist
 * eindeutig, deshalb kein Zeitfenster und keine Zuordnung einzelner Requests, die das Batching verhindert):
 * - rot: ID eines Pixels steht in keinem Request an den Server-Container
 * - Hinweis: Pixel-Requests ohne ID, je Event mit Anzahl
 * - Hinweis: dieselbe ID an mehreren Requests eines Pixels (verschiedene Events oder dasselbe mehrfach)
 * - Hinweis, nur mit Zuordnung serverIdFelder (Dienst → Feld am Server): ID am Server, die kein Pixel
 *   dieses Dienstes trägt
 * Ohne Server-Container im Lauf entfällt der Abgleich mit dem Server; doppelte IDs werden trotzdem geprüft.
 */
export function pruefeDeduplizierung(
  anfragen: Anfrage[], profile: DienstProfil[] = DIENST_PROFILE, serverDienste: string[] = [], ausnahmen: string[] = [],
  serverIdFelder: Record<string, Feld> = {}, ga4Server = true,
): DurchgaengigkeitsBefund[] {
  const anServer = (a: Anfrage) => serverDienste.includes(a.dienst)
    || (ga4Server && a.dienst === 'GA4' && !!a.host && !GOOGLE_HOST.test(a.host));
  const server = anfragen.filter(anServer);
  // Felder der Server-Requests je Event (GA4 bündelt Events zeilenweise im Body)
  const serverEvents = server.flatMap((s) => {
    const zeilen = s.body ? s.body.split(/\r?\n/).filter(Boolean) : [undefined];
    return zeilen.map((z) => { const f = felder(s.parameter, z); return { dienst: s.dienst, ereignis: f.en ?? s.pfad, f }; });
  });
  const dedup = new Map(profile.filter((p) => p.deduplizierung && !ausnahmen.includes(p.name)).map((p) => [p.name, p.deduplizierung!]));
  const befunde: DurchgaengigkeitsBefund[] = [];
  if (!server.length) {
    befunde.push({ stufe: 'info', ereignis: '–', dienst: '–', text: 'kein Request an einen Server-Container – Abgleich mit dem Server entfällt' });
  }

  // Pixel-Requests mit ID und Event, je Dienst und Konto (mehrere Pixel einer Seite dürfen dieselbe ID tragen)
  const pixel: { dienst: string; konto: string; ereignis: string; id?: string; automatisch?: boolean }[] = [];
  for (const a of anfragen) {
    const d = dedup.get(a.dienst);
    if (!d || anServer(a) || (d.pfad && !d.pfad.test(a.pfad))) continue;
    const f = felder(a.parameter, a.body);
    const konto = feldWert(f, d.konto) ?? '';
    // Mehrere Events je Request (JSON-Array im Body): id und ereignis gelten je Element
    let events = [f];
    if (d.liste) {
      try {
        const liste = JSON.parse(a.body ?? '')?.[d.liste];
        events = Array.isArray(liste) ? liste.map((e) => felder({}, JSON.stringify(e))) : [];
      } catch { events = []; }
    }
    for (const e of events) {
      const ereignis = feldWert(e, d.ereignis);
      if (d.ereignis && !ereignis) continue;
      if (ereignis && d.ignorieren?.test(ereignis)) continue;
      const id = feldWert(e, d.id);
      const automatisch = !!id && !!d.automatisch?.test(id);
      pixel.push({ dienst: a.dienst, konto, ereignis: ereignis ?? a.pfad, id: automatisch ? undefined : id, automatisch });
    }
  }
  // Manche Tag-Vorlagen senden die ID als SHA-256 (Reddit im GTM), der Server-Container bekommt sie im Klartext
  const hashes = new Map<string, string>();
  const sha256 = (w: string) => { if (!hashes.has(w)) hashes.set(w, createHash('sha256').update(w).digest('hex')); return hashes.get(w)!; };
  const istHash = (id: string) => /^[0-9a-f]{64}$/.test(id);
  // Exakter Hash, dazu normalisiert (trim, klein), falls ein Dienst IDs wie E-Mail-Adressen behandelt
  const hashePasst = (wert: string, id: string) => sha256(wert) === id || sha256(wert.trim().toLowerCase()) === id;
  const passt = (wert: string, id: string) => enthaeltToken(wert, id) || (istHash(id) && hashePasst(wert, id));

  // Pixel → Server
  const ohneId = new Map<string, { dienst: string; ereignis: string; anzahl: number; automatisch: number }>();
  for (const p of pixel) {
    if (!p.id) {
      const k = `${p.dienst}|${p.ereignis}`;
      const vorher = ohneId.get(k) ?? { dienst: p.dienst, ereignis: p.ereignis, anzahl: 0, automatisch: 0 };
      ohneId.set(k, { ...vorher, anzahl: vorher.anzahl + 1, automatisch: vorher.automatisch + (p.automatisch ? 1 : 0) });
      continue;
    }
    if (!server.length) continue;
    const wo = [...new Set(serverEvents.flatMap((e) => Object.entries(e.f).filter(([, w]) => passt(w, p.id!)).map(([k]) => k)))];
    befunde.push(wo.length
      ? { stufe: 'info', ereignis: p.ereignis, dienst: p.dienst, text: `Event-ID ${p.id} auch im Request an den Server-Container (${wo.join(', ')})` }
      : { stufe: 'rot', ereignis: p.ereignis, dienst: p.dienst, text: `Event-ID ${p.id} in keinem Request an den Server-Container – Deduplizierung mit der Conversions API kann nicht greifen` });
  }
  for (const { dienst, ereignis, anzahl, automatisch } of ohneId.values()) {
    befunde.push({
      stufe: 'info', ereignis, dienst, art: 'pixel-ohne-id',
      text: `${anzahl}× ohne Event-ID${automatisch ? ` der Seite (${automatisch}× vom Pixel selbst erzeugt, die kennt der Server nicht)` : ''}`
        + ' – keine Deduplizierung möglich (gewollt, wenn das Event nicht auch über die Conversions API geht)',
    });
  }

  // Dieselbe ID mehrfach bei einem Pixel: zählt beim Dienst nur einmal bzw. ist nicht je Event erzeugt
  const jeId = new Map<string, { dienst: string; id: string; ereignisse: string[] }>();
  for (const p of pixel.filter((x) => x.id)) {
    const k = `${p.dienst}|${p.konto}|${p.id}`;
    if (!jeId.has(k)) jeId.set(k, { dienst: p.dienst, id: p.id!, ereignisse: [] });
    jeId.get(k)!.ereignisse.push(p.ereignis);
  }
  for (const { dienst, id, ereignisse } of jeId.values()) {
    if (ereignisse.length < 2) continue;
    const namen = [...new Set(ereignisse)];
    // Verschiedene Events mit derselben ID: üblich bei einer ID je dataLayer-Push, deshalb ohne „Achtung“
    befunde.push(namen.length > 1
      ? { stufe: 'info', ereignis: namen.join(', '), dienst,
        text: `Event-ID ${id} an verschiedenen Events (${namen.join(', ')}) – gewollt bei einer ID je dataLayer-Push; nur ein Problem, wenn der Dienst allein nach der ID dedupliziert` }
      : { stufe: 'info', ereignis: namen[0], dienst, art: 'id-mehrfach',
        text: `Event-ID ${id} ${ereignisse.length}× an ${namen[0]} – zählt beim Dienst nur einmal (doppelt gefeuert oder ID nicht je Event erzeugt)` });
  }

  // Server → Pixel, nur mit Zuordnung: ID im Feld für diesen Dienst, die kein Pixel des Dienstes trägt
  for (const [dienst, feld] of Object.entries(serverIdFelder)) {
    const ids = new Set(pixel.filter((p) => p.dienst === dienst && p.id).map((p) => p.id!));
    const jeEvent = new Map<string, string[]>();
    for (const e of serverEvents) {
      const id = feldWert(e.f, feld);
      if (!id || ids.has(id) || ids.has(sha256(id)) || ids.has(sha256(id.trim().toLowerCase()))) continue;
      if (!jeEvent.has(e.ereignis)) jeEvent.set(e.ereignis, []);
      if (!jeEvent.get(e.ereignis)!.includes(id)) jeEvent.get(e.ereignis)!.push(id);
    }
    for (const [ereignis, liste] of jeEvent) {
      const beispiele = liste.slice(0, 3).join(', ') + (liste.length > 3 ? ' …' : '');
      befunde.push({
        stufe: 'info', ereignis, dienst, art: 'server-ohne-pixel',
        text: `${liste.length}× Event-ID für ${dienst} am Server-Container (${[feld].flat().join('/')}) ohne Pixel-Request mit dieser ID (${beispiele})`,
      });
    }
  }
  const gesehen = new Set<string>();
  return befunde.filter((b) => { const k = JSON.stringify(b); if (gesehen.has(k)) return false; gesehen.add(k); return true; });
}

/* ------------------------------------------------------------------ */
/* GA4-Erfassungsgrenzen                                              */
/* ------------------------------------------------------------------ */

/**
 * Grenzen laut Google (support.google.com/analytics/answer/9267744, für 360: answer/11202874). Was darüber
 * liegt, verarbeitet GA4 nicht. Gezählt wird die URL-kodierte Länge. requestBytes steht dort nicht, nur Hinweis.
 */
export const GA4_GRENZEN = {
  standard: { eventName: 40, parameter: 25, parameterName: 40, wert: 100, dl: 1000, dt: 300, dr: 420, upName: 24, upWert: 36 },
  '360': { eventName: 40, parameter: 100, parameterName: 40, wert: 500, dl: 1000, dt: 500, dr: 500, upName: 24, upWert: 36 },
  requestBytes: 16 * 1024,
} as const;

/** Prüft GA4-Requests (auch gebündelte Events im Body) gegen die Erfassungsgrenzen. */
export function pruefeGa4Grenzen(anfragen: Anfrage[], variante: 'standard' | '360' = 'standard'): DurchgaengigkeitsBefund[] {
  const g = GA4_GRENZEN[variante];
  const befunde: DurchgaengigkeitsBefund[] = [];
  const melde = (stufe: 'rot' | 'info', ereignis: string, text: string) => befunde.push({ stufe, ereignis, dienst: 'GA4', text });
  const len = (w: string) => encodeURIComponent(w).length;
  for (const a of anfragen.filter((x) => x.dienst === 'GA4')) {
    const query = a.url?.includes('?') ? a.url.slice(a.url.indexOf('?') + 1) : '';
    const bytes = Buffer.byteLength(query) + Buffer.byteLength(a.body ?? '');
    const kb = (bytes / 1024).toFixed(1);
    if (bytes > GA4_GRENZEN.requestBytes) {
      melde('info', a.parameter.en ?? 'Request', `Request mit ${kb} KB über 16 KB – von Google nicht dokumentiert, Verarbeitung im Bericht prüfen`);
    }

    const zeilen = a.body ? a.body.split(/\r?\n/).filter(Boolean) : [undefined];
    for (const zeile of zeilen) {
      const f = { ...a.parameter, ...(zeile ? Object.fromEntries(new URLSearchParams(zeile)) : {}) };
      const en = f.en ?? '(ohne Namen)';
      if (len(en) > g.eventName) melde('rot', en, `Eventname mit ${len(en)} Zeichen über ${g.eventName}: GA4 verarbeitet das Event nicht`);
      // ep.user_data.* bekommt nur ein Server-Container (Nutzerdaten für Enhanced Conversions), keine Event-Parameter
      const eigene = Object.keys(f).filter((k) => /^epn?\./.test(k) && !k.startsWith('ep.user_data.'));
      if (eigene.length > g.parameter) melde('rot', en, `${eigene.length} Parameter über ${g.parameter}: GA4 verarbeitet die übrigen nicht`);
      for (const k of eigene) {
        const name = k.replace(/^epn?\./, '');
        if (len(name) > g.parameterName) melde('rot', en, `Parametername ${name} mit ${len(name)} Zeichen über ${g.parameterName}`);
        if (k.startsWith('ep.') && len(f[k]) > g.wert) melde('info', en, `Wert von ${name} mit ${len(f[k])} Zeichen über ${g.wert}`);
      }
      for (const [k, grenze, name] of [['dl', g.dl, 'page_location'], ['dt', g.dt, 'page_title'], ['dr', g.dr, 'page_referrer']] as const) {
        if (f[k] && len(f[k]) > grenze) melde('info', en, `${name} mit ${len(f[k])} Zeichen über ${grenze}`);
      }
      for (const k of Object.keys(f).filter((x) => /^upn?\./.test(x))) {
        const name = k.replace(/^upn?\./, '');
        if (len(name) > g.upName) melde('rot', en, `Name der User Property ${name} mit ${len(name)} Zeichen über ${g.upName}`);
        if (k.startsWith('up.') && len(f[k]) > g.upWert) melde('info', en, `Wert der User Property ${name} mit ${len(f[k])} Zeichen über ${g.upWert}`);
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
