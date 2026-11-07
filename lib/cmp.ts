/**
 * Consent gezielt setzen statt über den Banner klicken, für Varianten wie „nur Dienst X“, „nur Kategorie Y“
 * oder Widerruf. Je CMP ein Satz Funktionen; bisher Usercentrics (Browser-API v4).
 */
import type { Page } from '@playwright/test';

export interface UcDienst { id: string; name: string; kategorie: string; zugestimmt: boolean }

/**
 * Usercentrics v4. UC_UI.acceptService() speichert in v4 nichts; dauerhaft wirkt nur
 * __ucCmp.updateServicesConsents() mit anschließendem saveConsents(). getServicesBaseInfo() liefert ein Promise.
 */
export const usercentrics = {
  async bereit(seite: Page, timeout = 20_000) {
    await seite.waitForFunction(() => (window as any).__ucCmp && (window as any).UC_UI?.getServicesBaseInfo, null, { timeout });
  },

  async dienste(seite: Page): Promise<UcDienst[]> {
    await usercentrics.bereit(seite);
    return seite.evaluate(async () => ((await (window as any).UC_UI.getServicesBaseInfo()) as any[])
      .map((d) => ({ id: d.id, name: d.name, kategorie: d.categorySlug, zugestimmt: !!d.consent?.status })));
  },

  /** Nur diesen Diensten (Name wie in der UC-Konfiguration) zustimmen, allen anderen außer „essential“ nicht. */
  async nurDienste(seite: Page, namen: string[]) {
    const dienste = await usercentrics.dienste(seite);
    const fehlen = namen.filter((n) => !dienste.some((d) => d.name === n));
    if (fehlen.length) throw new Error(`Usercentrics kennt diese Dienste nicht: ${fehlen.join(', ')}`);
    await usercentrics.setze(seite, dienste.filter((d) => d.kategorie !== 'essential')
      .map((d) => ({ id: d.id, consent: namen.includes(d.name) })));
  },

  /** Nur diesen Kategorien (categorySlug, z. B. functional, marketing) zustimmen. */
  async nurKategorien(seite: Page, kategorien: string[]) {
    const dienste = await usercentrics.dienste(seite);
    await usercentrics.setze(seite, dienste.filter((d) => d.kategorie !== 'essential')
      .map((d) => ({ id: d.id, consent: kategorien.includes(d.kategorie) })));
  },

  /** Alles ablehnen bzw. eine erteilte Zustimmung auf der Seite widerrufen. */
  async widerrufen(seite: Page) {
    await usercentrics.bereit(seite);
    await seite.evaluate(async () => {
      const uc = (window as any).__ucCmp;
      await uc.denyAllConsents();
      await uc.saveConsents();
    });
  },

  async setze(seite: Page, liste: { id: string; consent: boolean }[]) {
    await seite.evaluate(async (l) => {
      const uc = (window as any).__ucCmp;
      await uc.updateServicesConsents(l);
      await uc.saveConsents();
    }, liste);
  },
};
