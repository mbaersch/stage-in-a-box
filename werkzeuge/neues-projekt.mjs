#!/usr/bin/env node
/**
 * Legt ein neues Testprojekt unter projects/<name> aus vorlage/ an.
 * Aufruf: npm run neu -- <name>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];

if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
  console.error('Aufruf: npm run neu -- <name>   (Buchstaben, Ziffern, Punkt, Binde- und Unterstrich)');
  process.exit(1);
}
const ziel = path.join(wurzel, 'projects', name);
if (fs.existsSync(ziel)) {
  console.error(`projects/${name} gibt es schon.`);
  process.exit(1);
}

fs.cpSync(path.join(wurzel, 'vorlage'), ziel, { recursive: true });
fs.mkdirSync(path.join(ziel, 'tests'), { recursive: true });
fs.mkdirSync(path.join(ziel, 'baselines'), { recursive: true });
fs.copyFileSync(path.join(ziel, '.env.example'), path.join(ziel, '.env'));
const projektMd = path.join(ziel, 'projekt.md');
fs.writeFileSync(projektMd, fs.readFileSync(projektMd, 'utf8').replace(/^# Projekt$/m, `# Projekt: ${name}`));

console.log(`projects/${name} angelegt. Zuerst BASE_URL in projects/${name}/.env eintragen, dann:`);
console.log('');
console.log('  Staging im Browser:');
console.log(`    npm run sitzung -- projects/${name}`);
console.log(`    Anpassungen beim Agent im Hauptordner bestellen, z. B. „Projekt ${name}: In der Sitzung soll …“`);
console.log('');
console.log('  Tracking-Tests aus einer Aufzeichnung:');
console.log(`    Tag-Assistant-Export nach projects/${name}/aufzeichnungen/ legen, dann den Agent starten:`);
console.log(`    „Projekt ${name}: Analysiere die Aufzeichnung und fülle den Auftrag vor.“`);
