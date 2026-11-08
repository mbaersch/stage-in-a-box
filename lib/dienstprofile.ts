/**
 * Dienstprofile: was die Stage über einen Dienst wissen muss, an einer Stelle.
 *
 * - klickId: je Identifier (URL-Parameter der Landung, z. B. gclid): wo speichert der Dienst ihn
 *   (Cookie oder localStorage, Format egal), mit welchem Parameter sendet er ihn wieder
 *   (lib/bedingungen.ts). Ein leerer Eintrag heißt: gehört zum Dienst, Ablage unbekannt – dann zählt
 *   nur die Suche nach dem Wert.
 * - conversion: Woran ein Request zu einem Event erkannt wird und wo Wert, Währung, Transaktions-ID
 *   und Artikel darin stehen (Durchgängigkeit, lib/pruefungen.ts).
 *
 * Felder sind Parameternamen. Gesucht wird in URL-Parametern, Formular-Bodies und JSON-Bodies;
 * JSON wird dafür flach gemacht: { properties: { value: 1 } } → "properties.value".
 *
 * Hier nur, was belegt ist. Weitere Dienste (Snap, X …) erst eintragen, wenn Parameter, Ablage und
 * Request-Parameter an einer echten Website bestätigt sind; bis dahin findet die Suche nach dem Wert sie
 * trotzdem. Nur die Hauptablage eintragen, die der Tag selbst liest: Ist eine Ablage aus dem Profil da,
 * gilt die ID als gespeichert, Backups wie _gcl_ls würden ein fehlendes _gcl_aw verdecken.
 *
 * Projekte ergänzen oder überschreiben Profile mit stageOptionen.dienstProfile. Gleicher Name:
 * Felder überschreiben, Listen ersetzen, alles andere bleibt (klickId je Identifier, conversion je Feld). Was sich bewährt und für jede Website mit dem Dienst gilt, gehört hierher
 * und nach docs/wissen/dienste.md. Der Name muss zum Dienst der Regel passen (STANDARD_DIENSTE bzw.
 * eigene regeln), sonst werden die Requests nicht zugeordnet.
 */

export interface KlickIdEintrag {
  /** Ablage: Cookie-Namen oder "localStorage:<key>"; Vorhandensein genügt, Format egal */
  speicher?: string[];
  /** Parameter, mit denen der Dienst die Klick-ID in Requests sendet; Vorhandensein genügt */
  request?: string[];
}

/** Je Identifier, Schlüssel = URL-Parameter der Landung (eindeutig), z. B. { gclid: {…}, gbraid: {…} } */
export type KlickIdProfil = Record<string, KlickIdEintrag>;

export type Feld = string | string[];

export interface ConversionProfil {
  /** Event-Name im Request: Parameter und ggf. Übersetzung vom dataLayer-Namen (purchase → Purchase) */
  ereignis?: { parameter: string; werte?: Record<string, string> };
  /** Nur Requests, deren Pfad passt */
  pfad?: RegExp;
  /** Nur Requests, in denen diese Parameter vorkommen */
  pflicht?: string[];
  /** Felder; mehrere Namen = der erste vorhandene gilt. Fehlt ein Feld hier, wird es nicht geprüft. */
  value?: Feld;
  currency?: Feld;
  transaction_id?: Feld;
  /**
   * Artikel-IDs: ga4 = pr1, pr2 … (id-Segment); json = JSON-Array (als String in einem Parameter oder im
   * Body), bei Objekten mit schluessel als ID-Feld; liste = kommagetrennt.
   */
  items?: { parameter: string; format: 'ga4' | 'json' | 'liste'; schluessel?: string };
  /** Abweichende Artikel-IDs nur als Hinweis (Werbedienste nutzen oft Feed-IDs) */
  itemsNurHinweis?: boolean;
  /** Abweichender Wert nur als Hinweis (Werbedienste bekommen oft Netto, Marge o. Ä.; die Baseline sieht Änderungen) */
  valueNurHinweis?: boolean;
  /** Ein Request enthält mehrere Ereignisse, eines pro Body-Zeile (GA4) */
  zeilenweise?: boolean;
}

export interface DienstProfil {
  name: string;
  klickId?: KlickIdProfil;
  conversion?: ConversionProfil;
}

/** Meta-Standard-Events zu GA4-Namen */
const META_EVENTS: Record<string, string> = {
  purchase: 'Purchase', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', generate_lead: 'Lead',
  view_item: 'ViewContent', add_payment_info: 'AddPaymentInfo', sign_up: 'CompleteRegistration', add_to_wishlist: 'AddToWishlist',
};

export const DIENST_PROFILE: DienstProfil[] = [
  {
    name: 'GA4',
    conversion: {
      ereignis: { parameter: 'en' },
      zeilenweise: true,
      value: ['epn.value', 'ep.value'],
      currency: ['cu', 'ep.currency'],
      transaction_id: 'ep.transaction_id',
      items: { parameter: 'pr', format: 'ga4' },
    },
  },
  {
    name: 'Google Ads',
    klickId: {
      gclid: { speicher: ['_gcl_aw'], request: ['gclaw'] },
      // gbraid und wbraid gehen beide als gclgb raus, liegen aber in verschiedenen Cookies
      gbraid: { speicher: ['_gcl_ag'], request: ['gclgb'] },
      wbraid: { speicher: ['_gcl_gb'], request: ['gclgb'] },
    },
    conversion: {
      pfad: /\/(pagead\/)?(1p-)?conversion\/|\/as\/p\/c\//,
      pflicht: ['label'],
      valueNurHinweis: true,
      value: 'value',
      currency: 'currency_code',
      transaction_id: 'oid',
    },
  },
  {
    name: 'Meta',
    klickId: { fbclid: { speicher: ['_fbc'], request: ['fbc'] } },
    conversion: {
      ereignis: { parameter: 'ev', werte: META_EVENTS },
      value: 'cd[value]',
      currency: 'cd[currency]',
      items: { parameter: 'cd[content_ids]', format: 'json' },
      itemsNurHinweis: true,
      valueNurHinweis: true,
    },
  },
  {
    name: 'Microsoft Ads',
    // Kein request-Feld: UET sendet msclkid=N auch ohne Klick-ID; die echte findet die Suche nach dem Wert
    klickId: { msclkid: { speicher: ['_uetmsclkid'] } },
    conversion: { pflicht: ['gv'], value: 'gv', currency: 'gc', valueNurHinweis: true },
  },
  // Request-Parameter für dclid nicht belegt (kein Floodlight-Request beobachtet)
  { name: 'Floodlight', klickId: { dclid: { speicher: ['_gcl_dc'] } } },
  { name: 'LinkedIn', klickId: { li_fat_id: { speicher: ['li_fat_id'], request: ['li_fat_id'] } } },
  { name: 'Reddit', klickId: { rdt_cid: { speicher: ['_rdt_cid'], request: ['click_id'] } } },
  // Wert steckt im JSON-String pd, den jeder Request hat: kein request-Feld, nur Suche nach dem Wert
  { name: 'Pinterest', klickId: { epik: { speicher: ['_epik'] } } },
  { name: 'OpenAI Ads', klickId: { oppref: { speicher: ['__oppref'], request: ['oppref'] } } },
  // JSON-Body: Wert in context.ad.callback; Cookie ttclid lebt nur 1 Tag
  { name: 'TikTok', klickId: { ttclid: { speicher: ['ttclid'], request: ['context.ad.callback'] } } },
];

/**
 * Zentrale Profile, ergänzt bzw. überschrieben durch die des Projekts. Gleicher Name: Felder
 * überschreiben, Listen ersetzen (so lassen sich zentrale Einträge auch entfernen), alles andere
 * bleibt; klickId wird je Identifier zusammengeführt, conversion je Feld.
 */
export function profileZusammenfuehren(eigene: DienstProfil[] = []): DienstProfil[] {
  const alle = new Map(DIENST_PROFILE.map((p) => [p.name, { ...p }]));
  for (const e of eigene) {
    const v = alle.get(e.name);
    if (!v) {
      alle.set(e.name, e);
      continue;
    }
    const klickId: KlickIdProfil | undefined = v.klickId || e.klickId ? { ...v.klickId } : undefined;
    for (const [id, eintrag] of Object.entries(e.klickId ?? {})) klickId![id] = { ...klickId![id], ...eintrag };
    alle.set(e.name, {
      name: e.name,
      klickId,
      conversion: v.conversion || e.conversion ? { ...v.conversion, ...e.conversion } : undefined,
    });
  }
  return [...alle.values()];
}

/* ------------------------------------------------------------------ */
/* Felder lesen                                                       */
/* ------------------------------------------------------------------ */

function flach(obj: unknown, praefix = '', out: Record<string, string> = {}) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flach(v, praefix ? `${praefix}.${k}` : k, out);
  } else if (obj !== undefined && obj !== null) {
    out[praefix] = String(obj);
  }
  return out;
}

/** Alle Felder eines Requests: URL-Parameter, Formular-Body oder JSON-Body (flach). */
export function felder(parameter: Record<string, string>, body?: string): Record<string, string> {
  if (!body) return { ...parameter };
  const text = body.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const json = JSON.parse(text);
      // Arrays von Ereignissen (z. B. { data: [ … ] }) bleiben mit Index im Pfad
      return { ...parameter, ...flach(json) };
    } catch { /* kein JSON */ }
  }
  // Meta u. a. senden große Payloads per FormData (multipart); URLSearchParams würde daraus Unsinn machen
  const multipart = text.match(/^--([^\r\n]+)\r?\n/);
  if (multipart && /Content-Disposition: form-data/i.test(text)) {
    const out: Record<string, string> = { ...parameter };
    for (const teil of text.split(`--${multipart[1]}`)) {
      const m = teil.match(/Content-Disposition: form-data;\s*name="([^"]*)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n?$/i);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }
  if (text.includes('=')) {
    try { return { ...parameter, ...Object.fromEntries(new URLSearchParams(text)) }; } catch { /* ignorieren */ }
  }
  return { ...parameter };
}

export function feldWert(f: Record<string, string>, feld?: Feld): string | undefined {
  if (!feld) return undefined;
  for (const name of Array.isArray(feld) ? feld : [feld]) if (f[name] !== undefined && f[name] !== '') return f[name];
  return undefined;
}
