// Minimaler statischer Server für die Demo-Seite (ohne Abhängigkeiten).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const verzeichnis = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] ?? 4173);
const typen = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pfad = url.pathname;

  // Simulierter Tracking-Endpunkt (wie GA4 über einen Server-Container auf eigener Domain).
  // Auf Conversions antwortet er mit einer Weiterleitung, wie es Ads-Conversions oder ein
  // sGTM tun können. Diese Folge-Requests entstehen nur mit echten Antworten.
  if (pfad === '/g/collect') {
    if (url.searchParams.get('en') === 'generate_lead') {
      res.writeHead(302, { location: '/sgtm-pixel?quelle=generate_lead' }).end();
    } else {
      res.writeHead(204).end();
    }
    return;
  }
  if (pfad === '/sgtm-pixel') {
    res.writeHead(204).end();
    return;
  }

  const datei = normalize(join(verzeichnis, pfad === '/' ? 'index.html' : pfad));
  if (!datei.startsWith(verzeichnis)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const inhalt = await readFile(datei);
    res.writeHead(200, { 'content-type': typen[extname(datei)] ?? 'application/octet-stream' }).end(inhalt);
  } catch {
    res.writeHead(404).end('nicht gefunden');
  }
}).listen(port, () => console.log(`Demo-Seite auf http://localhost:${port}`));
