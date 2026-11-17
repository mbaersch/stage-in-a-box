/** CORS-Header für abgefangene Requests (lib/proxy.ts). */
import { test, expect } from '../../lib/playwright';
import { corsHeader } from '../../lib/proxy';

test('corsHeader: Preflight bekommt angefragte Methode und Header frei', () => {
  expect(corsHeader({
    origin: 'https://www.a.de',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  })).toEqual({
    'access-control-allow-origin': 'https://www.a.de',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
  });
});

test('corsHeader: ohne Origin Stern und keine Credentials', () => {
  expect(corsHeader({})).toEqual({ 'access-control-allow-origin': '*' });
});

test('corsHeader: Header als Liste (Node) und Private Network Access', () => {
  expect(corsHeader({ origin: ['https://www.a.de'], 'access-control-request-private-network': 'true' })).toEqual({
    'access-control-allow-origin': 'https://www.a.de',
    'access-control-allow-credentials': 'true',
    'access-control-allow-private-network': 'true',
  });
});
