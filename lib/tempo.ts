/**
 * Tempo der Tests: wie schnell ein Test durch die Journey geht.
 *
 * Manche Requests hängen von der Verweildauer ab (z. B. GA4 user_engagement mit
 * Engagement-Zeit, Timer-Trigger, Scroll- und Sichtbarkeits-Trigger). Ein Test, der in
 * Millisekunden durchklickt, löst sie nicht oder anders aus als ein Mensch.
 *
 *   schnell       keine Pausen (Vorgabe)
 *   mittel        1,5 s Pause zwischen den Schritten, leicht verlangsamte Aktionen
 *   langsam       4 s Pause zwischen den Schritten, deutlich verlangsamte Aktionen
 *   aufzeichnung  Pausen wie in der Aufzeichnung gemessen (höchstens 60 s)
 *
 * Einstellung über die Umgebungsvariable TEMPO (auch in .env) oder pro Test über
 * stageOptionen.tempo. Die Verlangsamung einzelner Aktionen (slowMo) gilt nur über TEMPO,
 * weil sie beim Browserstart festgelegt wird.
 */
export type Tempo = 'schnell' | 'mittel' | 'langsam' | 'aufzeichnung';

export const TEMPI: Tempo[] = ['schnell', 'mittel', 'langsam', 'aufzeichnung'];

export function tempoAusUmgebung(): Tempo {
  const wert = (process.env.TEMPO ?? 'schnell') as Tempo;
  if (!TEMPI.includes(wert)) {
    throw new Error(`TEMPO="${process.env.TEMPO}" ist ungültig. Erlaubt: ${TEMPI.join(', ')}`);
  }
  return wert;
}

/** Verzögerung jeder einzelnen Browser-Aktion in ms (Playwright slowMo). */
export const SLOW_MO: Record<Tempo, number> = { schnell: 0, mittel: 100, langsam: 300, aufzeichnung: 0 };

const FESTE_PAUSE: Record<Tempo, number> = { schnell: 0, mittel: 1500, langsam: 4000, aufzeichnung: 0 };
const MAX_AUFGEZEICHNET = 60_000;

/** Pause zwischen zwei Schritten. aufgezeichnetMs: gemessene Zeit aus der Aufzeichnung. */
export function pausenDauer(tempo: Tempo, aufgezeichnetMs?: number): number {
  if (tempo === 'aufzeichnung') return Math.min(Math.max(aufgezeichnetMs ?? 1500, 0), MAX_AUFGEZEICHNET);
  return FESTE_PAUSE[tempo];
}
