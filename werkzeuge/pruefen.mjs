// TypeScript-Prüfung (npm run pruefen). tsc kennt NODE_PATH nicht: Eine temporäre tsconfig erweitert die
// des Projekts um einen Pfad auf das global installierte Playwright.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let playwright;
try {
  playwright = path.dirname(require.resolve('playwright/package.json'));
} catch {
  console.error('Playwright nicht gefunden: global installieren und NODE_PATH auf `npm root -g` setzen.');
  process.exit(1);
}

const config = path.join(os.tmpdir(), `stage-tsconfig-${process.pid}.json`);
fs.writeFileSync(config, JSON.stringify({
  extends: path.join(WURZEL, 'tsconfig.json'),
  compilerOptions: {
    // Ohne absolute typeRoots sucht tsc @types neben der temporären Datei
    typeRoots: [path.join(WURZEL, 'node_modules', '@types')],
    paths: { 'playwright/test': [path.join(playwright, 'test')] },
  },
}));

try {
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const lauf = spawnSync(process.execPath, [tsc, '-p', config, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = lauf.status ?? 1;
} finally {
  fs.rmSync(config, { force: true });
}
