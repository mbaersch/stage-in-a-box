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

/** live: Playwright meldet Beacons beim Seitenwechsel oft als abgebrochen; ob sie ankamen, klärt erst der NetLog-Abgleich am Ende. */
export function trefferZeile(t: Treffer, live = false): string {
  const p = t.parameter ?? {};
  const ausBody = (t.body ?? '').split(/\r?\n/).map((z) => new URLSearchParams(z).get('en')).filter(Boolean);
  const ereignis = p.en ?? (ausBody.length ? ausBody.join(' + ') : undefined) ?? p.ev ?? p.event ?? p.event_name ?? p.label ?? p.cat ?? t.pfad;
  const konto = p.tid ?? p.id ?? p.pid ?? p.ti ?? p.src;
  return [ereignis, konto, p.gcs && `gcs=${p.gcs}`, MODUS[t.modus], !(live && t.fehler === 'net::ERR_ABORTED') && t.fehler, t.adblocker && `Adblocker: ${t.adblocker}`]
    .filter(Boolean).join(' · ');
}

/**
 * DevTools-Einstellungen für das Profil der Abnahme (Preferences → devtools.preferences, Werte als JSON-Strings):
 * Konsole vorne, nur Zeilen mit "stage", Log bleibt bei Seitenwechseln stehen. Namen aus einem Versuch mit Chromium.
 */
export const DEVTOOLS_EINSTELLUNGEN = {
  'panel-selected-tab': '"console"',
  'console.text-filter': '"stage"',
  'preserve-console-log': 'true',
};

export interface BannerZustand { schritte: string[]; pauseBis?: number; ende?: boolean; dl: number; tr: number }
export interface BannerInhalt { phase: string; detail: string; stats: string; fertig: boolean }

export function bannerInhalt(z: BannerZustand, jetzt: number): BannerInhalt {
  const stats = `dataLayer ${z.dl} · Hits ${z.tr}`;
  if (z.ende) return { phase: 'Abnahme beendet', detail: 'Protokoll in der Konsole aufklappbar. Browser schließen, um zu beenden.', stats, fertig: true };
  const rest = z.pauseBis ? Math.ceil((z.pauseBis - jetzt) / 1000) : 0;
  const detail = [z.schritte.slice(1).join(' › '), rest > 0 && `nächste Aktion in ${rest} s`].filter(Boolean).join(' · ');
  return { phase: z.schritte[0] ?? 'Start', detail, stats, fertig: false };
}

/** Banner oben im Viewport, nach dem Statusbalken des tracking-auditors. Geschlossenes Shadow DOM: Selektoren der Tests sehen den Text nicht. */
function bannerImBrowser(inhalt: BannerInhalt) {
  const w = window as unknown as { __stageBanner?: { host: HTMLElement; root: ShadowRoot } };
  let b = w.__stageBanner;
  if (!b || !b.host.isConnected) {
    const host = document.createElement('stage-abnahme');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483646;pointer-events:none;display:block';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .bar{display:flex;align-items:center;gap:10px;padding:7px 16px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color:#dbeafe;background:linear-gradient(135deg,#172554 0%,#1e3a8a 50%,#1d4ed8 100%);border-bottom:2px solid #3b82f6;box-shadow:0 2px 12px rgba(30,58,138,.5)}
      .bar.fertig{background:linear-gradient(135deg,#052e16 0%,#14532d 50%,#15803d 100%);border-bottom-color:#22c55e;color:#dcfce7}
      .spin{width:14px;height:14px;border:2px solid #1e40af;border-top-color:#60a5fa;border-radius:50%;animation:s .8s linear infinite;flex-shrink:0}
      .fertig .spin{animation:none;border-color:#22c55e}
      @keyframes s{to{transform:rotate(360deg)}}
      .phase{font-weight:700;white-space:nowrap}.detail{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
      .stats{font-size:11px;white-space:nowrap;opacity:.8}
    </style><div class="bar"><div class="spin"></div><div class="phase"></div><div class="detail"></div><div class="stats"></div></div>`;
    document.documentElement.appendChild(host);
    b = w.__stageBanner = { host, root };
  }
  const feld = (k: string) => b!.root.querySelector(`.${k}`)!;
  feld('bar').classList.toggle('fertig', inhalt.fertig);
  feld('phase').textContent = `[stage] ${inhalt.phase}`;
  feld('detail').textContent = inhalt.detail;
  feld('stats').textContent = inhalt.stats;
}

/** Kreis am Klickpunkt. Klicks, die sofort navigieren, sieht man nur kurz: die Seite verschwindet mit dem Kreis. */
function klickAnzeige() {
  addEventListener('pointerdown', (e) => {
    if (!e.isTrusted) return;
    const k = document.createElement('div');
    k.setAttribute('aria-hidden', 'true');
    k.style.cssText = `all:initial;position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;`
      + 'box-sizing:border-box;border:3px solid #f97316;background:rgba(249,115,22,.35);pointer-events:none;z-index:2147483647';
    document.documentElement.appendChild(k);
    k.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.8)', opacity: 0 }], { duration: 800, easing: 'ease-out' })
      .onfinish = () => k.remove();
  }, true);
}

interface Meldung { art: 'dl' | 'tr'; uhrzeit: string; kopf: string; text: string; daten: unknown; treffer?: Treffer }

const uhrzeit = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleTimeString('de-DE')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export class AbnahmeProtokoll {
  private dl = 0;
  private tr = 0;
  private timer?: ReturnType<typeof setInterval>;
  private laeuft = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly quelle: { dataLayer: { eintraege: DataLayerEintrag[] }; tracking: { treffer: Treffer[] } },
  ) {}

  private readonly schritte: string[] = [];
  private pauseBis?: number;
  private ende = false;

  async start() {
    await this.context.addInitScript(klickAnzeige);
    this.timer = setInterval(() => void this.weitergeben(), 300);
  }

  async stop() {
    clearInterval(this.timer);
    await this.weitergeben();
  }

  schrittBeginnt(titel: string) { this.schritte.push(titel); }
  schrittEndet() { this.schritte.pop(); }
  pause(ms: number) { this.pauseBis = Date.now() + ms; }

  private async banner() {
    const inhalt = bannerInhalt({
      schritte: this.schritte, pauseBis: this.pauseBis, ende: this.ende,
      dl: this.alle.filter((m) => m.art === 'dl').length, tr: this.alle.filter((m) => m.art === 'tr').length,
    }, Date.now());
    await Promise.all(this.context.pages().map((s) => s.evaluate(bannerImBrowser, inhalt).catch(() => { /* Seite lädt gerade */ })));
  }

  /**
   * Spielt das ganze Protokoll in die letzte Seite (nach dem Vergleich about:blank) und lässt den Browser offen, bis
   * der Mensch ihn schließt. Objekte aus vergangenen Seiten lassen sich in der Konsole nicht mehr aufklappen.
   */
  async offenHalten() {
    this.ende = true;
    await this.banner();
    await this.inKonsole(this.endstand, `[stage] Abnahme beendet: vollständiges Protokoll (${this.alle.length} Einträge), aufklappbar. Browser schließen, um zu beenden.`);
    const kontext = this.context;
    await new Promise<void>((fertig) => {
      const pruefe = () => { if (kontext.pages().every((p) => p.isClosed())) fertig(); };
      kontext.pages().forEach((p) => p.on('close', pruefe));
      kontext.on('page', (p) => p.on('close', pruefe));
      kontext.on('close', () => fertig());
      kontext.browser()?.on('disconnected', () => fertig());
      pruefe();
    });
  }

  private readonly alle: Meldung[] = [];

  /** Stand nach dem NetLog-Abgleich (nach stop()). */
  private get endstand(): Meldung[] {
    return this.alle.map((m) => (m.treffer ? { ...m, text: trefferZeile(m.treffer), daten: m.treffer.parameter } : m));
  }

  get zeilen(): string[] {
    return this.endstand.map((m) => `${m.uhrzeit} ${m.art === 'dl' ? '▶' : '◀'} ${m.kopf.padEnd(12)} ${m.text}`);
  }

  private async inKonsole(liste: Meldung[], gruppe?: string) {
    await Promise.all(this.context.pages().map((seite) => seite.evaluate(({ liste, gruppe }) => {
      if (gruppe) console.group(`%c${gruppe}`, 'font-weight:bold');
      for (const m of liste) {
        const farbe = m.art === 'dl' ? '#2563eb' : '#15803d';
        console.log(`%c[stage] ${m.uhrzeit}%c ${m.art === 'dl' ? '▶' : '◀'} ${m.kopf} %c${m.text}`, 'color:#888', `color:#fff;background:${farbe};padding:1px 5px;border-radius:3px`, 'font-weight:bold', m.daten);
      }
      if (gruppe) console.groupEnd();
    }, { liste, gruppe }).catch(() => { /* Seite geschlossen oder mitten im Laden */ })));
  }

  private async weitergeben() {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      const meldungen: Meldung[] = [];
      for (const e of this.quelle.dataLayer.eintraege.slice(this.dl)) {
        const z = dataLayerZeile(e);
        if (z) meldungen.push({ art: 'dl', uhrzeit: uhrzeit(e.zeit), kopf: 'dataLayer', text: z.titel, daten: z.daten });
      }
      this.dl = this.quelle.dataLayer.eintraege.length;
      for (const t of this.quelle.tracking.treffer.slice(this.tr)) {
        meldungen.push({ art: 'tr', uhrzeit: uhrzeit(t.zeit), kopf: t.dienst, text: trefferZeile(t, true), daten: t.parameter, treffer: t });
      }
      this.tr = this.quelle.tracking.treffer.length;
      this.alle.push(...meldungen);
      await this.banner();
      if (!meldungen.length) return;
      for (const m of meldungen) console.log(`${m.art === 'dl' ? '▶' : '◀'} ${m.kopf.padEnd(12)} ${m.text}`);
      await this.inKonsole(meldungen);
    } finally {
      this.laeuft = false;
    }
  }
}
