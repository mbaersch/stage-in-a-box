#!/usr/bin/env node
/**
 * Abnahme: Baseline-Test(s) sichtbar und mit offenen DevTools; die Stage schreibt dataLayer-Events und Requests
 * lesbar in die Konsole; der Browser bleibt offen, bis der Mensch ihn schließt. Aufruf: npm run abnahme -- projects/<name>/tests/<auftrag> [weitere Playwright-Argumente]
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (!args.some((a) => a.replace(/\/g, '/').includes('projects/'))) {
  console.error('Aufruf: npm run abnahme -- projects/<name>/tests/<auftrag>   (ohne -g: alle Tests mit "Baseline" im Namen)');
  process.exit(1);
}
const mitGrep = args.some((a) => a === '-g' || a.startsWith('--grep'));
const kind = spawn('playwright', ['test', '--headed', '--workers=1', ...(mitGrep ? [] : ['-g', 'Baseline']), ...args], {
  stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, STAGE_ABNAHME: 'offen' },
});
kind.on('exit', (code) => process.exit(code ?? 1));
