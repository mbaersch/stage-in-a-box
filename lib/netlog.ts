/**
 * NetLog: Netzwerkprotokoll von Chromium auf Browser-Ebene.
 *
 * Warum: Requests, die eine Seite beim Verlassen sendet (Beacons in pagehide/visibilitychange,
 * z. B. GA4 user_engagement), sieht Playwright nicht – weder in Request-Events noch im
 * Routing. Sie gehen trotzdem raus, auch im Modus "abfangen". Das NetLog des Browsers
 * enthält sie. Die Stage gleicht es am Testende ab:
 *   - Modus "durchlassen": fehlende Requests werden ergänzt (Quelle "netlog").
 *   - Modus "abfangen"/"blockieren": solche Requests sind am Routing vorbei echt gesendet
 *     worden und werden als "entwischt" markiert.
 *
 * Jeder Worker-Prozess startet seinen Browser mit eigenem NetLog (Pfad über die Prozess-ID).
 * Chromium schreibt die Datei laufend; sie wird bis zur letzten vollständigen Zeile gelesen.
 * Request-Bodies enthält das NetLog nicht.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Pfad des NetLogs für den aktuellen Worker-Prozess; STAGE_NETLOG für einen zweiten Browser im selben Prozess. */
export function netlogPfad(): string {
  return process.env.STAGE_NETLOG ?? path.join(os.tmpdir(), `stage-in-a-box-netlog-${process.pid}.json`);
}

/** Startargumente für Chromium. */
export function netlogArgumente(): string[] {
  return [`--log-net-log=${netlogPfad()}`];
}

export interface NetlogRequest {
  zeit: number;
  url: string;
  methode?: string;
  status?: number;
  fehler?: string;
}

/** Liest alle Requests im Zeitfenster [von, bis] (Epoch-ms). Fehlt die Datei, leere Liste. */
export function leseNetlog(von: number, bis: number, pfad = netlogPfad()): NetlogRequest[] {
  if (!fs.existsSync(pfad)) return [];
  let roh = fs.readFileSync(pfad, 'utf8');
  // Laufende Datei: endet mitten im events-Array. Bis zur letzten vollständigen Zeile kürzen.
  if (!/\]\s*\}\s*$/.test(roh)) {
    roh = roh.slice(0, roh.lastIndexOf('\n')).replace(/,\s*$/, '') + ']}';
  }
  let json: any;
  try {
    json = JSON.parse(roh);
  } catch {
    return [];
  }
  const typ: Record<number, string> = {};
  for (const [name, nr] of Object.entries(json.constants?.logEventTypes ?? {})) typ[nr as number] = name;
  const versatz = Number(json.constants?.timeTickOffset ?? 0);

  // Pro Quelle (= Request inkl. Weiterleitungen) die Hops in Reihenfolge sammeln
  const hops = new Map<number, NetlogRequest[]>();
  for (const e of json.events ?? []) {
    const name = typ[e.type];
    const zeit = Number(e.time) + versatz;
    const id = e.source?.id;
    if (name === 'URL_REQUEST_START_JOB' && e.phase === 1 && e.params?.url) {
      if (zeit < von || zeit > bis) continue;
      if (!hops.has(id)) hops.set(id, []);
      hops.get(id)!.push({ zeit, url: e.params.url, methode: e.params.method });
      continue;
    }
    const aktuell = hops.get(id)?.at(-1);
    if (!aktuell) continue;
    if (name === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS') {
      const zeile = e.params?.headers?.[0] ?? '';
      const m = String(zeile).match(/^HTTP\/[\d.]+\s+(\d{3})/);
      if (m) aktuell.status = Number(m[1]);
    } else if ((name === 'REQUEST_ALIVE' || name === 'URL_REQUEST_START_JOB') && e.phase === 2 && e.params?.net_error < 0) {
      aktuell.fehler = `net_error ${e.params.net_error}`;
    }
  }
  return [...hops.values()].flat().sort((a, b) => a.zeit - b.zeit);
}
