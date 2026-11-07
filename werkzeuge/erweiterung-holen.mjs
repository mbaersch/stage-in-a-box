#!/usr/bin/env node
/**
 * Legt eine Browser-Extension entpackt unter erweiterungen/<name>/ ab; offene Sitzungen laden alle dort.
 * Aufruf: npm run erweiterung -- <Web-Store-ID | datei.zip | datei.crx | ordner> [name]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [quelle, nameArg] = process.argv.slice(2);
if (!quelle) {
  console.error('Aufruf: npm run erweiterung -- <Web-Store-ID | datei.zip | datei.crx | ordner> [name]');
  process.exit(1);
}

const istStoreId = /^[a-p]{32}$/.test(quelle);
let daten;
if (istStoreId) {
  // Inoffizielle, aber seit Jahren stabile Download-Adresse des Web Stores (liefert CRX3).
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3D${quelle}%26installsource%3Dondemand%26uc`;
  const antwort = await fetch(url);
  if (!antwort.ok) {
    console.error(`Download aus dem Web Store fehlgeschlagen (HTTP ${antwort.status}). ID prüfen oder ZIP/Ordner angeben.`);
    process.exit(1);
  }
  daten = Buffer.from(await antwort.arrayBuffer());
} else if (fs.existsSync(quelle) && fs.statSync(quelle).isDirectory()) {
  daten = null;
} else if (fs.existsSync(quelle)) {
  daten = fs.readFileSync(quelle);
} else {
  console.error(`Weder Web-Store-ID noch vorhandene Datei bzw. Ordner: ${quelle}`);
  process.exit(1);
}

/** CRX3: "Cr24", Version, Länge des Headers, dann ein normales ZIP. */
function ohneCrxHeader(buf) {
  if (buf.subarray(0, 4).toString('latin1') !== 'Cr24') return buf;
  const version = buf.readUInt32LE(4);
  if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error(`Unbekannte CRX-Version ${version}`);
}

/** ID einer Extension aus ihrem öffentlichen Schlüssel: SHA-256, erste 16 Bytes, Hex-Ziffern als a–p. */
function idAusSchluessel(schluessel) {
  return [...crypto.createHash('sha256').update(schluessel).digest().subarray(0, 16).toString('hex')]
    .map((z) => String.fromCharCode(97 + parseInt(z, 16))).join('');
}

/**
 * Öffentlicher Schlüssel aus dem CRX3-Header (Protobuf CrxFileHeader → AsymmetricKeyProof.public_key),
 * passend zur ID. Ohne "key" im Manifest leitet Chromium die ID aus dem Ordnerpfad ab; Websites wie
 * tagassistant.google.com sprechen ihre Extension aber über die Store-ID an.
 */
function crxSchluessel(buf, id) {
  if (buf.subarray(0, 4).toString('latin1') !== 'Cr24' || buf.readUInt32LE(4) !== 3) return undefined;
  const felder = (b) => {
    const liste = [];
    let pos = 0;
    const varint = () => { let wert = 0, faktor = 1, byte; do { byte = b[pos++]; wert += (byte & 0x7f) * faktor; faktor *= 128; } while (byte & 0x80); return wert; };
    while (pos < b.length) {
      const tag = varint();
      const typ = tag & 7;
      if (typ === 2) { const laenge = varint(); liste.push({ nr: Math.floor(tag / 8), wert: b.subarray(pos, pos + laenge) }); pos += laenge; }
      else if (typ === 0) varint();
      else if (typ === 5) pos += 4;
      else if (typ === 1) pos += 8;
      else break;
    }
    return liste;
  };
  const header = buf.subarray(12, 12 + buf.readUInt32LE(8));
  for (const beweis of felder(header).filter((f) => f.nr === 2 || f.nr === 3)) {
    const schluessel = felder(beweis.wert).find((f) => f.nr === 1)?.wert;
    if (schluessel && idAusSchluessel(schluessel) === id) return schluessel.toString('base64');
  }
  return undefined;
}

/** Minimaler ZIP-Entpacker (Methoden 0 und 8), damit keine Abhängigkeit nötig ist. */
function entpacke(zip, ziel) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Kein ZIP-Archiv');
  const anzahl = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < anzahl; i++) {
    const methode = zip.readUInt16LE(pos + 10);
    const groesse = zip.readUInt32LE(pos + 20);
    const nameLaenge = zip.readUInt16LE(pos + 28);
    const extraLaenge = zip.readUInt16LE(pos + 30);
    const kommentarLaenge = zip.readUInt16LE(pos + 32);
    const lokal = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLaenge).toString('utf8');
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
    const datei = path.resolve(ziel, name);
    if (!datei.startsWith(path.resolve(ziel) + path.sep)) throw new Error(`Unzulässiger Pfad im Archiv: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(datei, { recursive: true }); continue; }
    const start = lokal + 30 + zip.readUInt16LE(lokal + 26) + zip.readUInt16LE(lokal + 28);
    const roh = zip.subarray(start, start + groesse);
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    if (methode === 0) fs.writeFileSync(datei, roh);
    else if (methode === 8) fs.writeFileSync(datei, zlib.inflateRawSync(roh));
    else throw new Error(`Nicht unterstützte Kompression (${methode}) bei ${name}`);
  }
}

fs.mkdirSync(path.join(wurzel, 'erweiterungen'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(wurzel, 'erweiterungen', '.neu-'));
try {
  if (daten) entpacke(ohneCrxHeader(daten), tmp);
  else fs.cpSync(quelle, tmp, { recursive: true, filter: (q) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(q) });
  // ZIPs mit einem einzigen Oberordner: dessen Inhalt nehmen
  let inhalt = tmp;
  const eintraege = fs.readdirSync(tmp);
  if (!fs.existsSync(path.join(tmp, 'manifest.json')) && eintraege.length === 1) inhalt = path.join(tmp, eintraege[0]);
  const manifestDatei = path.join(inhalt, 'manifest.json');
  if (!fs.existsSync(manifestDatei)) throw new Error('Keine manifest.json gefunden');
  // Signatur des Web Stores; Chrome lehnt entpackte Extensions mit Namen ab "_" ab.
  fs.rmSync(path.join(inhalt, '_metadata'), { recursive: true, force: true });
  const manifest = JSON.parse(fs.readFileSync(manifestDatei, 'utf8').replace(/^﻿/, ''));
  let idHinweis = '';
  if (istStoreId && !manifest.key) {
    const schluessel = crxSchluessel(daten, quelle);
    if (schluessel) {
      manifest.key = schluessel;
      fs.writeFileSync(manifestDatei, JSON.stringify(manifest, null, 2));
      idHinweis = `, ID ${quelle} wie im Store`;
    } else {
      idHinweis = ', Achtung: Schlüssel nicht gefunden, ID weicht vom Store ab';
    }
  }
  const name = nameArg ?? (istStoreId ? quelle : String(manifest.name ?? 'erweiterung').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const ziel = path.join(wurzel, 'erweiterungen', name);
  fs.rmSync(ziel, { recursive: true, force: true });
  fs.renameSync(inhalt, ziel);
  console.log(`erweiterungen/${name}: ${manifest.name} ${manifest.version ?? ''} (Manifest V${manifest.manifest_version}${idHinweis})`);
  console.log('Offene Sitzungen (npm run sitzung) laden sie automatisch.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
