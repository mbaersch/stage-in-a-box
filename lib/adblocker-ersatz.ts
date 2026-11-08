/**
 * Ersatzantworten für Regeln mit redirect=<name> (lib/adblocker.ts).
 *
 * uBlock Origin blockiert manche Requests nicht, sondern liefert eine eigene Datei aus: meist einen
 * Platzhalter (leeres Skript, transparentes Bild, leeres JSON), für wenige Tracking-Skripte einen Ersatz
 * mit Logik. Nachgebildet sind hier die Platzhalter und der Ersatz für Google (analytics.js, gtm.js,
 * gtag/js), als eigener Code nach dem Verhalten, nicht übernommen. Für alle anderen Namen gibt es eine leere
 * Antwort mit passendem Typ; adblocker.json zeigt sie mit nachgebildet: false.
 */
import zlib from 'node:zlib';

export interface Ersatz {
  /** Name der Ersatzdatei aus der Regel, nach Auflösung von Aliasnamen. */
  name: string;
  contentType: string;
  body: Buffer;
  /** false: uBlock liefert hier eine Datei mit eigener Logik, die Stage nur eine leere Antwort. */
  nachgebildet: boolean;
}

/**
 * Google-Ersatz (bei uBlock Origin für analytics.js, gtm.js und gtag/js). Eigene Umsetzung nach dem
 * beobachtbaren Verhalten, damit Seiten, die auf Google warten, weiterlaufen wie bei Blocker-Nutzern:
 * 1. Anti-Flicker: dataLayer.hide.end() gibt die Seite sofort frei.
 * 2. eventCallback: läuft für jeden Eintrag einmal, für vorhandene sofort, für neue beim push.
 *    Der dataLayer selbst bleibt unverändert.
 * 3. Universal Analytics: ga() ruft Callbacks (hitCallback, Funktion als letztes Argument) direkt auf;
 *    Aufrufe aus der Warteschlange ga.q werden nachgeholt. Tracker-Objekte tun nichts.
 * Läuft im Browser als Inhalt des ersetzten Skripts.
 */
function googleErsatz() {
  const w = window as any;
  const leer = () => undefined;
  const erledigt = new WeakSet<object>();

  const dl = w.dataLayer;
  if (dl?.hide?.end instanceof Function) {
    const ende = dl.hide.end;
    dl.hide.end = leer;
    ende();
  }
  const callbackAusloesen = (eintrag: any) => {
    if (!(eintrag?.eventCallback instanceof Function) || erledigt.has(eintrag)) return;
    erledigt.add(eintrag);
    setTimeout(() => { try { eintrag.eventCallback(); } catch { /* Fehler der Seite */ } }, 0);
  };
  if (Array.isArray(dl)) {
    dl.forEach(callbackAusloesen);
    const pushVorher = dl.push;
    dl.push = (...eintraege: any[]) => {
      eintraege.forEach(callbackAusloesen);
      return pushVorher.apply(dl, eintraege);
    };
  }

  const gaName = w.GoogleAnalyticsObject ?? 'ga';
  const nachzuholen: any[][] = Array.isArray(w[gaName]?.q) ? w[gaName].q.slice() : [];
  const ohneWirkung = { get: leer, set: leer, send: leer };
  const ga = Object.assign((...argumente: any[]) => {
    const letztes = argumente.at(-1);
    const stelle = argumente.indexOf('hitCallback');
    const callback = letztes?.hitCallback instanceof Function ? letztes.hitCallback
      : letztes instanceof Function ? () => letztes(ohneWirkung)
      : stelle >= 0 && argumente[stelle + 1] instanceof Function ? argumente[stelle + 1] : undefined;
    try { callback?.(); } catch { /* Fehler der Seite */ }
  }, {
    loaded: true, create: () => ohneWirkung, getByName: () => ohneWirkung, getAll: () => [ohneWirkung], remove: leer,
  });
  w[gaName] = ga;
  nachzuholen.forEach((aufruf) => ga(...aufruf));
}

const GOOGLE_ERSATZ = `(${googleErsatz.toString()})();`;

/** Transparentes PNG in beliebiger Größe (RGBA, alle Pixel durchsichtig). */
function transparentesPng(breite: number, hoehe: number): Buffer {
  const abschnitt = (typ: string, daten: Buffer) => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const typUndDaten = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
    const pruefsumme = Buffer.alloc(4);
    pruefsumme.writeUInt32BE(zlib.crc32(typUndDaten));
    return Buffer.concat([laenge, typUndDaten, pruefsumme]);
  };
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(breite, 0);
  kopf.writeUInt32BE(hoehe, 4);
  kopf.set([8, 6, 0, 0, 0], 8); // 8 Bit, RGBA
  const zeilen = Buffer.alloc(hoehe * (1 + breite * 4)); // je Zeile Filterbyte 0, dann Nullen
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    abschnitt('IHDR', kopf), abschnitt('IDAT', zlib.deflateSync(zeilen)), abschnitt('IEND', Buffer.alloc(0)),
  ]);
}

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const LEERES_HTML = '<!DOCTYPE html><title></title>';

/** Aliasnamen aus den Filterlisten auf den Namen der Datei bei uBlock Origin. */
const ALIASE: Record<string, string> = {
  'noopjs': 'noop.js', 'abp-resource:blank-js': 'noop.js',
  'nooptext': 'noop.txt',
  'noopjson': 'noop.json',
  'noopframe': 'noop.html', 'abp-resource:blank-html': 'noop.html',
  'noopcss': 'noop.css', 'abp-resource:blank-css': 'noop.css',
  '1x1-transparent.gif': '1x1.gif', 'abp-resource:1x1-transparent-gif': '1x1.gif',
  '2x2-transparent.png': '2x2.png', 'abp-resource:2x2-transparent-png': '2x2.png',
  '3x2-transparent.png': '3x2.png', 'abp-resource:3x2-transparent-png': '3x2.png',
  '32x32-transparent.png': '32x32.png', 'abp-resource:32x32-transparent-png': '32x32.png',
  'google-analytics.com/analytics.js': 'google-analytics_analytics.js',
  'googletagmanager_gtm.js': 'google-analytics_analytics.js',
  'googletagmanager.com/gtm.js': 'google-analytics_analytics.js',
};

const NACHGEBILDET: Record<string, () => Omit<Ersatz, 'name' | 'nachgebildet'>> = {
  'noop.js': () => ({ contentType: 'application/javascript', body: Buffer.alloc(0) }),
  'noop.txt': () => ({ contentType: 'text/plain', body: Buffer.alloc(0) }),
  'empty': () => ({ contentType: 'text/plain', body: Buffer.alloc(0) }),
  'noop.json': () => ({ contentType: 'application/json', body: Buffer.from('{}') }),
  'noop.html': () => ({ contentType: 'text/html', body: Buffer.from(LEERES_HTML) }),
  'noop.css': () => ({ contentType: 'text/css', body: Buffer.alloc(0) }),
  '1x1.gif': () => ({ contentType: 'image/gif', body: GIF_1X1 }),
  '2x2.png': () => ({ contentType: 'image/png', body: transparentesPng(2, 2) }),
  '3x2.png': () => ({ contentType: 'image/png', body: transparentesPng(3, 2) }),
  '32x32.png': () => ({ contentType: 'image/png', body: transparentesPng(32, 32) }),
  'google-analytics_analytics.js': () => ({ contentType: 'application/javascript', body: Buffer.from(GOOGLE_ERSATZ) }),
};

const TYP_NACH_ENDUNG: Record<string, string> = {
  js: 'application/javascript', json: 'application/json', html: 'text/html', css: 'text/css', txt: 'text/plain',
  xml: 'application/xml', gif: 'image/gif', png: 'image/png', mp3: 'audio/mpeg', mp4: 'video/mp4',
};

/** Name der Ersatzdatei aus einer Regel wie "||example.com/a.js$script,redirect=noop.js:5". */
export function ersatzName(regel: string): string | undefined {
  const optionen = regel.includes('$') ? regel.slice(regel.lastIndexOf('$') + 1) : '';
  const wert = optionen.split(',').map((o) => o.match(/^redirect(?:-rule)?=(.+)$/)?.[1]).find(Boolean);
  return wert?.replace(/:-?\d+$/, '');
}

export function ersatzFuer(regel: string): Ersatz {
  const roh = ersatzName(regel) ?? 'noop.txt';
  const name = ALIASE[roh] ?? roh;
  const bekannt = NACHGEBILDET[name];
  if (bekannt) return { name, nachgebildet: true, ...bekannt() };
  const endung = name.match(/\.([a-z0-9]+)$/)?.[1] ?? (name.includes('mp3') ? 'mp3' : name.includes('mp4') ? 'mp4' : 'txt');
  return { name, nachgebildet: false, contentType: TYP_NACH_ENDUNG[endung] ?? 'text/plain', body: Buffer.alloc(0) };
}
