// Playwright liegt global (NODE_PATH). ESM-Imports ignorieren NODE_PATH, deshalb hier per require laden;
// nicht auf `import … from 'playwright/test'` zurückstellen. Typen für tsc: werkzeuge/pruefen.mjs.
import { createRequire } from 'node:module';

const pw: typeof import('playwright/test') = createRequire(import.meta.url)('playwright/test');

export const { test, expect, defineConfig, devices } = pw;
export type * from 'playwright/test';
