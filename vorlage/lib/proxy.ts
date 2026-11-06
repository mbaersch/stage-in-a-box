/**
 * Optionaler Proxy für die Stage (PROXY=ein).
 *
 * Ohne Proxy steuert und beobachtet die Stage Requests über Playwright. Das hat Lücken:
 * Beacons, die eine Seite beim Verlassen sendet (pagehide/visibilitychange, z. B. GA4
 * user_engagement oder Microsoft Ads), und Requests aus Service Workern sieht Playwright
 * nicht und kann sie nicht abfangen. Der Proxy sitzt dagegen im Netzwerk zwischen Browser
 * und Internet: Er sieht jeden Request mit Body, kann ihn beantworten, blockieren,
 * verzögern oder durchlassen und dabei Antworten verändern (CSP-Simulation).
 *
 * HTTPS wird aufgebrochen (MITM): Der Proxy erzeugt pro Host ein Zertifikat, signiert mit
 * einer eigenen CA. Alle Host-Zertifikate nutzen denselben Schlüssel; Chromium vertraut ihm
 * über --ignore-certificate-errors-spki-list (siehe proxyArgumente). Anders als mit
 * ignoreHTTPSErrors gelten die Zertifikate damit als gültig, Service Worker lassen sich
 * registrieren und HTTPS verhält sich wie bei echten Besuchern. Der Schlüssel liegt im
 * temporären Verzeichnis und wird wiederverwendet; er taugt nur für diesen Testbrowser.
 * Zwischen Browser und Proxy gilt HTTP/1.1 (kein HTTP/2, kein QUIC).
 * Nicht-TLS-Verbindungen über CONNECT (z. B. ws://) werden ungesehen durchgeleitet.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';

export type ProxyAktion = 'abfangen' | 'blockieren' | 'durchlassen';

export interface ProxyRequest {
  zeit: number;
  methode: string;
  url: string;
  /** sec-fetch-dest des Browsers: document, script, image, empty (fetch/XHR/Beacon) … */
  ziel: string;
  body?: string;
  aktion: ProxyAktion;
  status?: number;
  fehler?: string;
  /** Ziel einer Weiterleitung (Location-Header) */
  weiterleitungZu?: string;
  abgeschlossen: boolean;
}

export interface ProxyVerbindung {
  /** Entscheidet pro URL; ohne Rückgabe wird durchgelassen. */
  entscheide(url: string): { aktion: ProxyAktion; verzoegerungMs?: number } | undefined;
  /** Wird für jeden Request aufgerufen, bevor er bearbeitet wird; das Objekt wird danach weiter aktualisiert. */
  melde(r: ProxyRequest): void;
  /** CSP für Dokumente setzen */
  csp?: { wert: string; nurBerichten?: boolean; ersetzen?: boolean };
}

const MAX_BODY_TEXT = 64 * 1024;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Zertifikate                                                        */
/* ------------------------------------------------------------------ */

interface Zertifikate {
  caKey: forge.pki.rsa.PrivateKey;
  caCert: forge.pki.Certificate;
  caPem: string;
  blattKeyPem: string;
  blattPublic: forge.pki.rsa.PublicKey;
  kontexte: Map<string, tls.SecureContext>;
}
let zertifikate: Zertifikate | undefined;

function schluesselpaar() {
  // Native Schlüsselerzeugung ist um ein Vielfaches schneller als node-forge.
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const key = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  return { pem, key, pub: forge.pki.setRsaPublicKey(key.n, key.e) };
}

/**
 * Schlüssel für alle Host-Zertifikate: einmal erzeugt, dann aus dem temporären Verzeichnis
 * gelesen, damit die Browser-Startargumente (SPKI-Hash) schon beim Laden der Konfiguration
 * feststehen.
 */
function blattSchluesselPem(): string {
  const datei = path.join(os.tmpdir(), 'stage-in-a-box-proxy-schluessel.pem');
  if (fs.existsSync(datei)) return fs.readFileSync(datei, 'utf8');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  fs.writeFileSync(datei, pem, { mode: 0o600 });
  return pem;
}

/** Chromium-Startargumente, damit der Browser den Zertifikaten des Proxys vertraut. */
export function proxyArgumente(): string[] {
  const spki = crypto.createPublicKey(blattSchluesselPem()).export({ type: 'spki', format: 'der' });
  const hash = crypto.createHash('sha256').update(spki).digest('base64');
  return [`--ignore-certificate-errors-spki-list=${hash}`];
}

function seriennummer() {
  return '01' + crypto.randomBytes(15).toString('hex');
}

function zertifikateHolen(): Zertifikate {
  if (zertifikate) return zertifikate;
  const ca = schluesselpaar();
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = ca.pub;
  caCert.serialNumber = seriennummer();
  caCert.validity.notBefore = new Date(Date.now() - 86_400_000);
  caCert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const name = [{ name: 'commonName', value: 'Stage in a Box Test-CA' }];
  caCert.setSubject(name);
  caCert.setIssuer(name);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  caCert.sign(ca.key, forge.md.sha256.create());
  // Ein Schlüssel für alle Host-Zertifikate; ihm vertraut der Browser per SPKI-Hash.
  const blattPem = blattSchluesselPem();
  const blattKey = forge.pki.privateKeyFromPem(blattPem) as forge.pki.rsa.PrivateKey;
  const blatt = { pem: blattPem, pub: forge.pki.setRsaPublicKey(blattKey.n, blattKey.e) };
  zertifikate = {
    caKey: ca.key, caCert, caPem: forge.pki.certificateToPem(caCert),
    blattKeyPem: blatt.pem, blattPublic: blatt.pub, kontexte: new Map(),
  };
  return zertifikate;
}

function kontextFuer(host: string): tls.SecureContext {
  const z = zertifikateHolen();
  const vorhanden = z.kontexte.get(host);
  if (vorhanden) return vorhanden;
  const cert = forge.pki.createCertificate();
  cert.publicKey = z.blattPublic;
  cert.serialNumber = seriennummer();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(z.caCert.subject.attributes);
  const altName = net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host };
  cert.setExtensions([{ name: 'subjectAltName', altNames: [altName] }]);
  cert.sign(z.caKey, forge.md.sha256.create());
  const kontext = tls.createSecureContext({ key: z.blattKeyPem, cert: forge.pki.certificateToPem(cert) + z.caPem });
  z.kontexte.set(host, kontext);
  return kontext;
}

/* ------------------------------------------------------------------ */
/* Proxy                                                              */
/* ------------------------------------------------------------------ */

export class StageProxy {
  private verbindung: ProxyVerbindung = { entscheide: () => undefined, melde: () => {} };
  private readonly server: http.Server;
  private readonly mitm: https.Server;
  private readonly sockets = new Set<net.Socket>();
  url = '';

  /**
   * @param zertifikatFehlerIgnorieren Zertifikate der Zielserver nicht prüfen (z. B. Staging mit
   *   selbst signiertem Zertifikat). Sonst lehnt der Proxy ungültige Zertifikate ab, wie es ein
   *   normaler Browser täte – der Testbrowser selbst sieht nur die Zertifikate des Proxys.
   */
  constructor(private readonly zertifikatFehlerIgnorieren = false) {
    this.mitm = https.createServer({
      SNICallback: (servername, cb) => {
        try { cb(null, kontextFuer(servername)); } catch (e) { cb(e as Error); }
      },
    }, (req, res) => this.bearbeite(req, res, 'https'));
    this.server = http.createServer((req, res) => this.bearbeite(req, res, 'http'));
    this.server.on('connect', (req, socket, kopf) => this.tunnel(req, socket as net.Socket, kopf));
    this.server.on('upgrade', (req, socket, kopf) => this.upgrade(req, socket as net.Socket, kopf, 'http'));
    this.mitm.on('upgrade', (req, socket, kopf) => this.upgrade(req, socket as net.Socket, kopf, 'https'));
    this.server.on('connection', (s) => this.merke(s));
  }

  /** Verbindet den Proxy mit der Stage des aktuellen Tests. */
  verbinde(v: ProxyVerbindung) {
    this.verbindung = v;
  }

  async start() {
    zertifikateHolen();
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
    this.mitm.close();
  }

  private merke(s: net.Socket) {
    this.sockets.add(s);
    s.on('close', () => this.sockets.delete(s));
  }

  /** CONNECT: TLS wird aufgebrochen, alles andere unverändert durchgeleitet. */
  private tunnel(req: http.IncomingMessage, socket: net.Socket, kopf: Buffer) {
    this.merke(socket);
    socket.on('error', () => socket.destroy());
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const weiter = (erstes: Buffer) => {
      if (erstes[0] === 0x16) { // TLS-Handshake
        // Das bereits gelesene erste Paket muss vor den Rest. TLS direkt auf dem Socket würde
        // es übergehen, weil es dessen Handle liest; über einen JS-Stream bleibt es erhalten.
        const eingang = new PassThrough();
        eingang.write(erstes);
        socket.pipe(eingang);
        const verbindung = Duplex.from({ readable: eingang, writable: socket });
        socket.on('close', () => verbindung.destroy());
        this.mitm.emit('connection', verbindung);
        return;
      }
      const [host, port] = String(req.url).split(':');
      const ziel = net.connect(Number(port) || 80, host, () => {
        ziel.write(erstes);
        socket.pipe(ziel).pipe(socket);
      });
      ziel.on('error', () => socket.destroy());
    };
    if (kopf.length) weiter(kopf);
    else socket.once('data', weiter);
  }

  private async bearbeite(req: http.IncomingMessage, res: http.ServerResponse, schema: 'http' | 'https') {
    const url = schema === 'https' ? `https://${req.headers.host}${req.url}` : String(req.url);
    const teile: Buffer[] = [];
    for await (const t of req) teile.push(t as Buffer);
    const body = Buffer.concat(teile);
    const entscheidung = this.verbindung.entscheide(url);
    const eintrag: ProxyRequest = {
      zeit: Date.now(),
      methode: req.method ?? 'GET',
      url,
      ziel: String(req.headers['sec-fetch-dest'] ?? ''),
      body: body.length ? (body.length <= MAX_BODY_TEXT ? body.toString('utf8') : `[${body.length} Bytes]`) : undefined,
      aktion: entscheidung?.aktion ?? 'durchlassen',
      abgeschlossen: false,
    };
    this.verbindung.melde(eintrag);
    if (entscheidung?.verzoegerungMs) await pause(entscheidung.verzoegerungMs);

    if (eintrag.aktion === 'abfangen') {
      eintrag.status = 204;
      eintrag.abgeschlossen = true;
      res.writeHead(204, { 'access-control-allow-origin': String(req.headers.origin ?? '*'), 'access-control-allow-credentials': 'true' }).end();
      return;
    }
    if (eintrag.aktion === 'blockieren') {
      eintrag.fehler = 'blockiert (Proxy)';
      eintrag.abgeschlossen = true;
      req.socket.destroy();
      return;
    }

    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const modul = url.startsWith('https:') ? https : http;
    const anfrage = modul.request(url, { method: req.method, headers, rejectUnauthorized: !this.zertifikatFehlerIgnorieren }, (antwort) => {
      eintrag.status = antwort.statusCode;
      if (antwort.headers.location) eintrag.weiterleitungZu = new URL(antwort.headers.location, url).href;
      const antwortHeaders = { ...antwort.headers };
      const csp = this.verbindung.csp;
      if (csp && eintrag.ziel === 'document') {
        if (csp.ersetzen !== false) {
          delete antwortHeaders['content-security-policy'];
          delete antwortHeaders['content-security-policy-report-only'];
        }
        const name = csp.nurBerichten ? 'content-security-policy-report-only' : 'content-security-policy';
        const bisher = antwortHeaders[name];
        antwortHeaders[name] = bisher ? `${bisher}, ${csp.wert}` : csp.wert;
      }
      res.writeHead(antwort.statusCode ?? 502, antwortHeaders);
      antwort.pipe(res);
      antwort.on('end', () => { eintrag.abgeschlossen = true; });
      antwort.on('error', (e) => { eintrag.fehler = e.message; eintrag.abgeschlossen = true; });
    });
    anfrage.on('error', (e) => {
      eintrag.fehler = e.message;
      eintrag.abgeschlossen = true;
      // Netzwerkfehler an den Browser weitergeben, statt eine Fehlerseite zu erfinden
      req.socket.destroy();
    });
    anfrage.end(body);
  }

  /** WebSockets und andere Upgrades unverändert durchreichen. */
  private upgrade(req: http.IncomingMessage, socket: net.Socket, kopf: Buffer, schema: 'http' | 'https') {
    const url = schema === 'https' ? `https://${req.headers.host}${req.url}` : String(req.url);
    const modul = schema === 'https' ? https : http;
    const anfrage = modul.request(url, { method: req.method, headers: req.headers, rejectUnauthorized: !this.zertifikatFehlerIgnorieren });
    anfrage.on('upgrade', (antwort, ziel, zielKopf) => {
      const zeilen = [`HTTP/1.1 ${antwort.statusCode} ${antwort.statusMessage}`];
      for (let i = 0; i < antwort.rawHeaders.length; i += 2) zeilen.push(`${antwort.rawHeaders[i]}: ${antwort.rawHeaders[i + 1]}`);
      socket.write(zeilen.join('\r\n') + '\r\n\r\n');
      if (zielKopf.length) socket.write(zielKopf);
      if (kopf.length) ziel.write(kopf);
      ziel.pipe(socket).pipe(ziel);
    });
    anfrage.on('error', () => socket.destroy());
    anfrage.end();
  }
}

/** PROXY=ein|ja|1|true schaltet den Proxy ein. */
export function proxyAusUmgebung(): boolean {
  return /^(ein|an|ja|1|true|on|yes)$/i.test(process.env.PROXY ?? '');
}
