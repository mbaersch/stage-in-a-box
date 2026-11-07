/**
 * Dienstprofile: was die Stage über einen Dienst wissen muss, an einer Stelle.
 *
 * - klickId: Mit welchem URL-Parameter kommt die Klick-ID, wo speichert der Dienst sie (Cookie oder
 *   localStorage, Format egal), mit welchem Parameter sendet er sie wieder (lib/bedingungen.ts).
 * - conversion: Woran ein Request zu einem Event erkannt wird und wo Wert, Währung, Transaktions-ID
 *   und Artikel darin stehen (Durchgängigkeit, lib/pruefungen.ts).
 *
 * Felder sind Parameternamen. Gesucht wird in URL-Parametern, Formular-Bodies und JSON-Bodies;
 * JSON wird dafür flach gemacht: { properties: { value: 1 } } → "properties.value".
 *
 * Hier nur, was belegt ist. Weitere Dienste (LinkedIn li_fat_id, TikTok ttclid …) erst eintragen, wenn
 * Parameter, Ablage und Request-Parameter an einer echten Website bestätigt sind; bis dahin findet die
 * Suche nach dem Wert sie trotzdem.
 *
 * Projekte ergänzen oder überschreiben Profile mit stageOptionen.dienstProfile (gleicher Name =
 * Felder überschreiben). Was sich bewährt und für jede Website mit dem Dienst gilt, gehört hierher
 * und nach docs/wissen/dienste.md. Der Name muss zum Dienst der Regel passen (STANDARD_DIENSTE bzw.
 * eigene regeln), sonst werden die Requests nicht zugeordnet.
 */

export interface KlickIdProfil {
  /** URL-Parameter der Landung, z. B. ['gclid', 'gbraid', 'wbraid'] */
  parameter: string[];
  /** Ablage: Cookie-Namen oder "localStorage:<key>"; Vorhandensein genügt, Format egal */
  speicher?: string[];
  /** Parameter, mit denen der Dienst die Klick-ID in Requests sendet; Vorhandensein genügt */
  request?: string[];
}

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
    klickId: { parameter: ['gclid', 'gbraid', 'wbraid'], speicher: ['_gcl_aw', '_gcl_gb'], request: ['gclaw', 'gclgb'] },
    conversion: {
      pfad: /\/(pagead\/)?(1p-)?conversion\//,
      pflicht: ['label'],
      value: 'value',
      currency: 'currency_code',
      transaction_id: 'oid',
    },
  },
  {
    name: 'Meta',
    klickId: { parameter: ['fbclid'], speicher: ['_fbc'], request: ['fbc'] },
    conversion: {
      ereignis: { parameter: 'ev', werte: META_EVENTS },
      value: 'cd[value]',
      currency: 'cd[currency]',
      items: { parameter: 'cd[content_ids]', format: 'json' },
      itemsNurHinweis: true,
    },
  },
  {
    name: 'Microsoft Ads',
    klickId: { parameter: ['msclkid'], speicher: ['_uetmsclkid'], request: ['msclkid'] },
    conversion: { pflicht: ['gv'], value: 'gv', currency: 'gc' },
  },
];

/** Zentrale Profile, ergänzt bzw. überschrieben durch die des Projekts (gleicher Name = zusammenführen). */
export function profileZusammenfuehren(eigene: DienstProfil[] = []): DienstProfil[] {
  const alle = new Map(DIENST_PROFILE.map((p) => [p.name, { ...p }]));
  for (const e of eigene) {
    const vorhanden = alle.get(e.name);
    alle.set(e.name, vorhanden
      ? { ...vorhanden, ...e, klickId: e.klickId ?? vorhanden.klickId, conversion: e.conversion ? { ...vorhanden.conversion, ...e.conversion } : vorhanden.conversion }
      : e);
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
