/**
 * Abnahme-Lauf (npm run abnahme): dataLayer-Events und Tracking-Requests laufend lesbar in die Konsole der
 * offenen Seiten und ins Terminal, am Ende als abnahme.log. Aktiv mit der Umgebungsvariable STAGE_ABNAHME.
 */
import type { BrowserContext } from 'playwright/test';
import type { DataLayerEintrag, Treffer } from './stage';

export function dataLayerZeile(e: Pick<DataLayerEintrag, 'daten'>): { titel: string; daten: unknown } | undefined {
  const d = e.daten;
  if (Array.isArray(d)) return { titel: `gtag ${d.slice(0, 2).map(String).join(' ')}`, daten: d[2] ?? {} };
  if (d && typeof d === 'object') {
    if (d.__rec) return undefined;
    if ('event' in d) {
      const { event, ...rest } = d;
      return { titel: String(event), daten: rest };
    }
  }
  return { titel: '(Push ohne event)', daten: d };
}

const MODUS: Record<string, string> = { abfangen: 'abgefangen', blockieren: 'blockiert' };

export function trefferZeile(t: Treffer): string {
  const p = t.parameter ?? {};
  const ausBody = (t.body ?? '').split(/\r?\n/).map((z) => new URLSearchParams(z).get('en')).filter(Boolean);
  const ereignis = p.en ?? (ausBody.length ? ausBody.join(' + ') : undefined) ?? p.ev ?? p.event ?? p.event_name ?? p.label ?? p.cat ?? t.pfad;
  const konto = p.tid ?? p.id ?? p.pid ?? p.ti ?? p.src;
  return [ereignis, konto, p.gcs && `gcs=${p.gcs}`, MODUS[t.modus], t.fehler, t.adblocker && `Adblocker: ${t.adblocker}`]
    .filter(Boolean).join(' · ');
}

interface Meldung { art: 'dl' | 'tr'; zeit: number; kopf: string; text: string; daten: unknown }

const uhrzeit = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleTimeString('de-DE')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export class AbnahmeProtokoll {
  readonly zeilen: string[] = [];
  private dl = 0;
  private tr = 0;
  private timer?: ReturnType<typeof setInterval>;
  private laeuft = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly quelle: { dataLayer: { eintraege: DataLayerEintrag[] }; tracking: { treffer: Treffer[] } },
  ) {}

  start() {
    this.timer = setInterval(() => void this.weitergeben(), 300);
  }

  async stop() {
    clearInterval(this.timer);
    await this.weitergeben();
  }

  private async weitergeben() {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      const meldungen: Meldung[] = [];
      for (const e of this.quelle.dataLayer.eintraege.slice(this.dl)) {
        const z = dataLayerZeile(e);
        if (z) meldungen.push({ art: 'dl', zeit: e.zeit, kopf: 'dataLayer', text: z.titel, daten: z.daten });
      }
      this.dl = this.quelle.dataLayer.eintraege.length;
      for (const t of this.quelle.tracking.treffer.slice(this.tr)) {
        meldungen.push({ art: 'tr', zeit: t.zeit, kopf: t.dienst, text: trefferZeile(t), daten: t.parameter });
      }
      this.tr = this.quelle.tracking.treffer.length;
      if (!meldungen.length) return;
      for (const m of meldungen) {
        const zeile = `${m.art === 'dl' ? '▶' : '◀'} ${m.kopf.padEnd(12)} ${m.text}`;
        this.zeilen.push(`${uhrzeit(m.zeit)} ${zeile}`);
        console.log(zeile);
      }
      // Die Konsole einer Seite leert sich beim Seitenwechsel, solange „Preserve log“ aus ist; abnahme.log hat alles.
      await Promise.all(this.context.pages().map((seite) => seite.evaluate((liste: Meldung[]) => {
        for (const m of liste) {
          const farbe = m.art === 'dl' ? '#2563eb' : '#15803d';
          console.log(`%c${m.art === 'dl' ? '▶' : '◀'} ${m.kopf}%c ${m.text}`, `color:#fff;background:${farbe};padding:1px 5px;border-radius:3px`, 'font-weight:bold', m.daten);
        }
      }, meldungen).catch(() => { /* Seite geschlossen oder mitten im Laden */ })));
    } finally {
      this.laeuft = false;
    }
  }
}
