#!/usr/bin/env node
/**
 * Wertet eine Aufzeichnung aus und erzeugt zwei Dateien neben der Eingabe:
 *
 *   <name>.zeitleiste.md   – lesbare Zeitleiste pro Seite: Aktionen, Events, Consent,
 *                            gefeuerte Tags, Google-Requests; dazu ein Vorschlag für den
 *                            Auftrag und vorgeschlagene Playwright-Schritte
 *   <name>.analyse.json    – dieselben Daten strukturiert, für Agents und Scripts
 *
 * Eingaben:
 *   - Tag-Assistant-Export (JSON) mit Recorder-Messages (__rec)
 *   - Konsolen-Mitschnitt des eigenständigen Recorders (Zeilen „[rec] {…}“)
 *
 * Aufruf: npm run analyse -- projects/<name>/aufzeichnungen/kauf.json [--testdaten]
 *
 * --testdaten übernimmt die Eingaben einer Aufzeichnung im Modus "full" nach
 * projects/<name>/testdaten.aufzeichnung.env (Werte aus .env haben dort Vorrang).
 *
 * Exporte können über 100 MB groß sein; das npm-Script setzt deshalb mehr Speicher.
 * Das Format des Tag-Assistant-Exports ist nicht dokumentiert. Dieses Script stützt sich
 * auf data.containers[].messages, tagsFired, pageSummaries und hitInfo (Stand: Version 2).
 */
import fs from 'node:fs';
import path from 'node:path';

const KONVERSIONEN = ['purchase', 'generate_lead', 'sign_up', 'submit_lead_form', 'form_submit', 'contact', 'subscribe', 'add_payment_info', 'begin_checkout', 'add_to_cart'];
const AUTOCOMPLETE_ENV = {
  'given-name': 'TEST_VORNAME', 'family-name': 'TEST_NACHNAME', name: 'TEST_NAME', email: 'TEST_EMAIL',
  tel: 'TEST_TELEFON', 'tel-national': 'TEST_TELEFON', 'street-address': 'TEST_STRASSE', 'address-line1': 'TEST_STRASSE',
  'address-line2': 'TEST_ADRESSZUSATZ', 'postal-code': 'TEST_PLZ', 'address-level2': 'TEST_ORT',
  'address-level1': 'TEST_BUNDESLAND', 'country-name': 'TEST_LAND', organization: 'TEST_FIRMA',
  username: 'TEST_LOGIN_EMAIL', 'current-password': 'TEST_LOGIN_PASSWORT', 'new-password': 'TEST_LOGIN_PASSWORT',
  bday: 'TEST_GEBURTSDATUM',
};
const TEXTFELD = /^(text|email|tel|password|number|search|url|date|)$/;

/* ------------------------------------------------------------------ */
/* Einlesen                                                           */
/* ------------------------------------------------------------------ */

function lies(datei) {
  const roh = fs.readFileSync(datei, 'utf8');
  try {
    const json = JSON.parse(roh);
    if (json?.data?.containers) return ausTagAssistant(json);
  } catch { /* kein JSON – Konsolen-Mitschnitt? */ }
  return ausKonsole(roh);
}

function ohneDebugParameter(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('gtm_debug');
    u.searchParams.delete('sib_rec');
    return u.href;
  } catch {
    return url;
  }
}

function parameterListe(liste) {
  return Object.fromEntries((liste ?? []).map((p) => [p.name, p.value]));
}

function ausTagAssistant(json) {
  const container = json.data.containers;
  // Primärer Container: GTM-Container mit den meisten Messages
  const primaer = [...container].filter((c) => c.messages?.length)
    .sort((a, b) => (b.product === 'GTM') - (a.product === 'GTM') || b.messages.length - a.messages.length)[0];
  if (!primaer) throw new Error('Export enthält keine Messages.');

  // Tag-Typen und Recorder-Tag erkennen
  const tagTypen = {};
  const ausgeblendeteTags = new Set();
  for (const t of primaer.messages[0]?.tagInfo ?? []) {
    tagTypen[t.name] = t.type;
    if (JSON.stringify(t.params ?? []).includes('__recConfig')) ausgeblendeteTags.add(t.name);
  }
  const istInternerTag = (name) => name.startsWith('_') || ausgeblendeteTags.has(name);

  // Gefeuerte Tags pro Message-Index
  const tagsProIndex = new Map();
  for (const [name, eintraege] of Object.entries(primaer.tagsFired ?? {})) {
    if (istInternerTag(name)) continue;
    for (const e of eintraege) {
      const k = String(e.index);
      if (!tagsProIndex.has(k)) tagsProIndex.set(k, []);
      tagsProIndex.get(k).push(name);
    }
  }

  // Google-Requests aus allen Containern, Zuordnung über Seite + eventId
  const requestsProSchluessel = new Map();
  const gesehen = new Set();
  for (const c of container) {
    for (const m of c.messages ?? []) {
      for (const d of m.data ?? []) {
        for (const h of d.hitInfo ?? []) {
          const parameter = parameterListe(h.parameters);
          const id = JSON.stringify([h.baseUrl, parameter]);
          if (gesehen.has(id)) continue;
          gesehen.add(id);
          const k = `${m.groupId}|${m.eventId}`;
          if (!requestsProSchluessel.has(k)) requestsProSchluessel.set(k, []);
          requestsProSchluessel.get(k).push({
            dienst: h.subtitle || h.title || '?',
            titel: h.title,
            url: h.baseUrl,
            tag: d.originatingEntity?.nameInOriginContainer,
            container: c.publicId,
            parameter,
          });
        }
      }
    }
  }

  const seitenInfo = primaer.pageSummaries ?? {};
  const seiten = [];
  const seitenNachGruppe = new Map();
  const eintraege = [];
  const nachrichten = [...primaer.messages].sort((a, b) => Number(a.index) - Number(b.index));
  for (const m of nachrichten) {
    if (!seitenNachGruppe.has(m.groupId)) {
      const s = seitenInfo[m.groupId] ?? {};
      const seite = { nr: seiten.length + 1, url: ohneDebugParameter(s.href ?? ''), titel: s.title ?? '' };
      seiten.push(seite);
      seitenNachGruppe.set(m.groupId, seite);
    }
    const seite = seitenNachGruppe.get(m.groupId).nr;
    const msg = m.message;
    const tags = tagsProIndex.get(String(m.index)) ?? [];
    const requests = requestsProSchluessel.get(`${m.groupId}|${m.eventId}`) ?? [];
    requestsProSchluessel.delete(`${m.groupId}|${m.eventId}`);

    if (msg && typeof msg === 'object' && msg.__rec) {
      eintraege.push({ art: 'aktion', seite, rec: msg.__rec });
      continue;
    }
    const name = m.eventName ?? null;
    const consent = (m.consentData?.consentList ?? []).map((c) => `${c.type}=${c.status}`);
    if (name?.startsWith('gtag.consent.')) {
      eintraege.push({ art: 'consent', seite, befehl: name.replace('gtag.consent.', ''), stand: consent, tags, requests });
      continue;
    }
    eintraege.push({
      art: 'event', seite, name: name ?? '(Message)', titel: m.title, eventId: m.eventId,
      daten: msg && typeof msg === 'object' ? msg : null, consent, tags, requests,
    });
  }
  // Requests ohne passende Message (z. B. aus anderen Containern) ans Seitenende hängen
  for (const [k, liste] of requestsProSchluessel) {
    const seite = seitenNachGruppe.get(k.split('|')[0])?.nr ?? seiten.length;
    eintraege.push({ art: 'event', seite, name: '(ohne zugeordnete Message)', titel: '', daten: null, consent: [], tags: [], requests: liste });
  }

  return {
    quelle: 'Tag Assistant',
    name: json.name,
    aufgezeichnet: json.timestamp ? new Date(json.timestamp).toISOString() : undefined,
    startUrl: ohneDebugParameter(json.data.domainDetails?.startUrl ?? seiten[0]?.url ?? ''),
    container: container.map((c) => `${c.publicId}${c.tagName ? ` (${c.tagName})` : ''}${c.messages?.length ? '' : ' – nicht debugbar'}`),
    tagTypen: Object.fromEntries(Object.entries(tagTypen).filter(([n]) => !istInternerTag(n))),
    seiten,
    eintraege,
  };
}

function ausKonsole(roh) {
  const eintraege = [];
  const seiten = [];
  const seiteZuPageId = new Map();
  for (const zeile of roh.split(/\r?\n/)) {
    const i = zeile.indexOf('[rec] ');
    if (i < 0) continue;
    let rec;
    try { rec = JSON.parse(zeile.slice(i + 6)); } catch { continue; }
    if (!seiteZuPageId.has(rec.pageId)) {
      seiten.push({ nr: seiten.length + 1, url: ohneDebugParameter(rec.url ?? ''), titel: rec.title ?? '' });
      seiteZuPageId.set(rec.pageId, seiten.length);
    }
    eintraege.push({ art: 'aktion', seite: seiteZuPageId.get(rec.pageId), rec });
  }
  if (!eintraege.length) throw new Error('Weder Tag-Assistant-Export noch Recorder-Zeilen („[rec] {…}“) gefunden.');
  return { quelle: 'Konsole', startUrl: seiten[0]?.url, container: [], tagTypen: {}, seiten, eintraege };
}

/* ------------------------------------------------------------------ */
/* Aktionen → Playwright-Schritte                                     */
/* ------------------------------------------------------------------ */

const js = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function bereinigterName(name) {
  return String(name ?? '').replace(/\s*\*$/, '').replace(/\s*\((optional|erforderlich)\)$/i, '').trim();
}

/** Bester Locator aus den Recorder-Daten, als Playwright-Code. */
function locator(el) {
  const sel = el?.selectors ?? [];
  const eindeutig = (kind) => sel.find((s) => s.kind === kind && s.unique);
  const test = eindeutig('testAttr');
  if (test) {
    const m = test.selector.match(/^\[data-testid="(.*)"\]$/);
    return m ? `page.getByTestId(${js(m[1])})` : `page.locator(${js(test.selector)})`;
  }
  for (const kind of ['id', 'name']) {
    const s = eindeutig(kind);
    if (s) return `page.locator(${js(s.selector)})`;
  }
  const name = bereinigterName(el?.name);
  if (el?.role && name && name.length <= 60 && !/\d+[,.]\d{2}\s*€|€\s*\d/.test(name)) {
    return `page.getByRole(${js(el.role)}, { name: ${js(name)} })`;
  }
  for (const kind of ['ariaLabel', 'href']) {
    const s = eindeutig(kind);
    if (s) return `page.locator(${js(s.selector)})`;
  }
  const css = sel.find((s) => s.kind === 'cssPath');
  return css ? `page.locator(${js(css.selector)}) /* nur CSS-Pfad – fragil */` : '/* kein Selektor */';
}

function envName(el) {
  const ac = String(el?.autocomplete ?? '').split(/\s+/).pop();
  if (AUTOCOMPLETE_ENV[ac]) return AUTOCOMPLETE_ENV[ac];
  if (el?.type === 'password') return 'TEST_LOGIN_PASSWORT';
  if (el?.type === 'email') return 'TEST_EMAIL';
  const basis = (el?.selectors ?? []).find((s) => s.kind === 'name')?.selector.match(/name="(.*)"/)?.[1]
    ?? (el?.selectors ?? []).find((s) => s.kind === 'id')?.selector.replace(/^#/, '')
    ?? 'FELD';
  return 'TEST_' + basis.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
}

function selektorSchluessel(el) {
  return JSON.stringify((el?.selectors ?? []).map((s) => s.selector));
}

/**
 * Leitet aus den Recorder-Einträgen Playwright-Schritte ab und bereinigt dabei:
 * Fokus-Klicks vor Eingaben, Klicks von Scripts (isTrusted false), Submits nach Klick
 * auf den Absende-Button, Label-Klicks vor Checkbox-Änderungen.
 */
function schritte(eintraege) {
  const aktionen = eintraege.filter((e) => e.art === 'aktion');
  const out = [];
  const felder = new Map();
  // Zeitpunkt des letzten übernommenen Schritts bzw. des Seitenstarts; daraus die Pause
  // vor dem nächsten Schritt (für stage.denkpause im Tempo "aufzeichnung").
  let letzteZeit = null;
  const pauseSeit = (ts) => (letzteZeit !== null && ts ? Math.max(0, Math.round(ts - letzteZeit)) : undefined);
  const neu = (schritt, ts) => {
    if (!schritt.ueberspringen && !schritt.ergebnis) {
      schritt.pauseMs = pauseSeit(ts);
      if (ts) letzteZeit = ts;
    }
    out.push(schritt);
  };
  for (let i = 0; i < aktionen.length; i++) {
    const { rec, seite } = aktionen[i];
    const el = rec.element;
    const naechste = aktionen.slice(i + 1, i + 4).map((a) => a.rec);
    const hinweis = [];
    let code = null;

    if (rec.type === 'init') {
      letzteZeit = rec.ts ?? letzteZeit;
      continue;
    }
    if (rec.type === 'click') {
      const tag = el?.tag;
      const typ = String(el?.type ?? '').toLowerCase();
      const textfeld = (tag === 'input' && TEXTFELD.test(typ)) || tag === 'textarea';
      if (textfeld && naechste.some((n) => n.type === 'change' && selektorSchluessel(n.element) === selektorSchluessel(el))) {
        continue; // Fokus-Klick vor einer Eingabe
      }
      if (rec.isTrusted === false) {
        neu({ seite, ueberspringen: true, beschreibung: `Klick „${el?.name ?? el?.tag}“ von Script ausgelöst (isTrusted: false); falls im Test nötig: ${locator(el)}.click()`, code: null }, rec.ts);
        continue;
      }
      if ((typ === 'checkbox' || typ === 'radio') || tag === 'label') {
        const aenderung = naechste.find((n) => n.type === 'change' && (n.element?.type === 'checkbox' || n.element?.type === 'radio'));
        if (tag === 'label' && aenderung) continue; // Label-Klick, die Änderung folgt
        code = `await ${locator(el)}.check();`;
      } else {
        code = `await ${locator(el)}.click();`;
        if (el?.opensNewTab) hinweis.push('öffnet neuen Tab: page.context().waitForEvent(\'page\')');
      }
      if (el?.shadowHosts?.length) hinweis.push('im Shadow DOM');
      neu({ seite, beschreibung: `Klick: ${el?.role || el?.tag} „${el?.name ?? ''}“`, code, hinweis }, rec.ts);
      continue;
    }
    if (rec.type === 'change') {
      const typ = String(el?.type ?? '').toLowerCase();
      const f = rec.field ?? {};
      if (el?.tag === 'select') {
        const wert = f.selected?.[0]?.value;
        code = `await ${locator(el)}.selectOption(${js(wert ?? '')});`;
      } else if (typ === 'checkbox' || typ === 'radio') {
        if (out.at(-1)?.code?.endsWith('.check();')) continue; // schon durch den Klick abgedeckt
        code = `await ${locator(el)}.${f.checked === false ? 'uncheck' : 'check'}();`;
      } else {
        const env = envName(el);
        felder.set(env, {
          env, feld: bereinigterName(el?.name) || el?.tag, autocomplete: el?.autocomplete, typ: el?.type ?? el?.tag,
          aufgezeichnet: f.value, modus: f.mode ?? (f.value === '[redacted]' ? 'redacted' : undefined),
        });
        code = `await ${locator(el)}.fill(process.env.${env}!);`;
      }
      neu({ seite, beschreibung: `Eingabe: „${bereinigterName(el?.name) || el?.tag}“`, code, hinweis: [] }, rec.ts);
      continue;
    }
    if (rec.type === 'submit') {
      const vorher = out.at(-1);
      if (vorher && /click\(\);$/.test(vorher.code ?? '')) continue; // Folge des Klicks auf den Absende-Button
      neu({ seite, beschreibung: 'Formular abgesendet (ohne vorherigen Klick)', code: `await ${locator(rec.form)}.evaluate((f) => (f as HTMLFormElement).requestSubmit());`, hinweis: ['prüfen: per Enter oder Script abgesendet?'] }, rec.ts);
      continue;
    }
    if (rec.type === 'key') {
      neu({ seite, beschreibung: `Taste ${rec.key} in „${el?.name ?? el?.tag}“`, code: `await ${locator(el)}.press(${js(rec.key)});`, hinweis: [] }, rec.ts);
      continue;
    }
    if (rec.type === 'route') {
      neu({ seite, beschreibung: `URL-Wechsel (${rec.kind}) → ${rec.to}`, code: null, ergebnis: true, hinweis: [] });
    }
  }
  return { schritte: out, felder: [...felder.values()] };
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                         */
/* ------------------------------------------------------------------ */

function kurz(wert, max = 60) {
  const s = typeof wert === 'string' ? wert : JSON.stringify(wert);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function eventZusammenfassung(daten) {
  if (!daten) return '';
  const teile = [];
  const e = daten.ecommerce;
  if (e && typeof e === 'object') {
    const kopf = ['currency', 'value', 'transaction_id', 'shipping', 'tax', 'coupon', 'payment_type', 'shipping_tier']
      .filter((k) => e[k] !== undefined).map((k) => `${k}=${kurz(e[k], 30)}`);
    teile.push(...kopf);
    for (const it of (e.items ?? []).slice(0, 5)) {
      teile.push(`item ${it.item_id ?? '?'} „${kurz(it.item_name ?? '', 30)}“${it.item_category ? ` [${kurz(it.item_category, 20)}]` : ''} ×${it.quantity ?? 1} à ${it.price ?? '?'}`);
    }
    if ((e.items ?? []).length > 5) teile.push(`… ${e.items.length - 5} weitere Items`);
  }
  for (const [k, v] of Object.entries(daten)) {
    if (k === 'event' || k === 'ecommerce' || k.startsWith('gtm.')) continue;
    if (teile.length >= 10) break;
    teile.push(`${k}=${kurz(v, 50)}`);
  }
  return teile.join(' · ');
}

function requestZusammenfassung(r) {
  const p = r.parameter;
  const teile = [r.dienst];
  const name = p.en ?? p.ev ?? p.event ?? p.label;
  if (name) teile.push(name);
  if (p.tid) teile.push(p.tid);
  if (p.gcs) teile.push(`gcs=${p.gcs}`);
  if (r.tag) teile.push(`Tag „${r.tag}“`);
  return teile.join(' · ');
}

/** Pfade (a.b.0.c) aller primitiven Werte eines Objekts. */
function pfade(obj, praefix = '', out = {}) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) pfade(v, praefix ? `${praefix}.${k}` : k, out);
  } else {
    out[praefix] = obj;
  }
  return out;
}

function auswerten(a) {
  const events = a.eintraege.filter((e) => e.art === 'event');
  const relevant = (e) => (!e.name.startsWith('gtm.') && !e.name.startsWith('gtag.') && e.name !== '(Message)') || e.tags.length || e.requests.length;

  // Conversion vermuten
  const namen = events.map((e) => e.name);
  const conversion = KONVERSIONEN.find((k) => namen.includes(k));

  // Events in Reihenfolge des ersten Auftretens, mit Anzahl
  const zaehler = new Map();
  for (const e of events.filter((e) => !e.name.startsWith('gtm.') && !e.name.startsWith('gtag.') && e.name !== '(Message)' && !e.name.startsWith('('))) {
    zaehler.set(e.name, (zaehler.get(e.name) ?? 0) + 1);
  }

  // Tags pro Event
  const tagsProEvent = new Map();
  for (const e of [...events, ...a.eintraege.filter((x) => x.art === 'consent')]) {
    const n = e.art === 'consent' ? `consent ${e.befehl}` : e.name;
    for (const t of e.tags ?? []) {
      if (!tagsProEvent.has(n)) tagsProEvent.set(n, new Set());
      tagsProEvent.get(n).add(t);
    }
  }

  // Google-Requests zählen
  const requests = new Map();
  for (const e of a.eintraege) {
    for (const r of e.requests ?? []) {
      const k = `${r.dienst} · ${r.parameter.en ?? r.parameter.ev ?? r.titel ?? ''}`;
      requests.set(k, (requests.get(k) ?? 0) + 1);
    }
  }

  // Flüchtige Werte: Keys, deren Werte nach IDs, Zeitstempeln oder Zufall aussehen,
  // oder die sich zwischen Wiederholungen desselben Events unterscheiden und dabei so aussehen.
  const fluechtig = new Set();
  const nachName = new Map();
  const sprechenderKey = (k) => /(^|_)(id|hash|session\w*|timestamp|time|nonce|random\w*|uuid|token|key)$|transaction_id|order_id|random|session/i.test(k);
  // Zeitstempel (Sekunden/Millisekunden ab 2020) und lange Hex-Werte; gehashte Nutzerdaten
  // (sha256_*) bleiben bei gleichen Testdaten gleich und zählen deshalb nicht dazu.
  const zufaelligerWert = (v) => (typeof v === 'string' || typeof v === 'number')
    && (/^1[6-9]\d{8}(\d{3})?(\.\d+)?$/.test(String(v)) || /^[a-f0-9]{16,}$/i.test(String(v)));
  for (const e of events) {
    if (!e.daten || e.name.startsWith('gtm.')) continue;
    const p = pfade(e.daten);
    for (const [k, v] of Object.entries(p)) {
      const blatt = k.split('.').pop();
      if (k.startsWith('gtm.') || blatt.startsWith('gtm.') || /^item_id$|^sha256_/.test(blatt)) continue;
      if ((/transaction_id|order_id/i.test(blatt) && v !== '<NONE>') || zufaelligerWert(v)) fluechtig.add(blatt);
    }
    if (!nachName.has(e.name)) nachName.set(e.name, []);
    nachName.get(e.name).push(p);
  }
  for (const liste of nachName.values()) {
    if (liste.length < 2) continue;
    for (const k of Object.keys(liste[0])) {
      const blatt = k.split('.').pop();
      if (k.startsWith('gtm.') || blatt.startsWith('gtm.') || k.startsWith('ecommerce.')) continue;
      if (new Set(liste.map((p) => JSON.stringify(p[k]))).size > 1 && sprechenderKey(blatt)) fluechtig.add(blatt);
    }
  }

  // Auffälligkeiten
  const auffaellig = [];
  for (const s of a.seiten) {
    const proSeite = events.filter((e) => e.seite === s.nr && e.daten && !e.name.startsWith('gtm.') && !e.name.startsWith('('));
    const gesehen = new Map();
    for (const e of proSeite) {
      const { 'gtm.uniqueEventId': _, ...rest } = e.daten;
      const k = JSON.stringify(rest);
      if (gesehen.has(k)) auffaellig.push(`Seite ${s.nr}: Event „${e.name}“ mehrfach mit identischem Inhalt`);
      gesehen.set(k, true);
    }
  }
  const ersteSeite = a.eintraege.filter((e) => e.seite === 1);
  const update = ersteSeite.findIndex((e) => e.art === 'consent' && e.befehl === 'update');
  if (update >= 0) {
    const davor = ersteSeite.slice(0, update).filter((e) => e.art === 'aktion');
    if (!davor.some((e) => e.rec.type === 'click')) {
      auffaellig.push(davor.some((e) => e.rec.type === 'init')
        ? 'Consent-Entscheidung ohne aufgezeichneten Klick: Banner vermutlich in iframe oder geschlossenem Shadow DOM. CMP bzw. Selektoren für Zustimmen/Ablehnen klären.'
        : 'Consent-Entscheidung, bevor der Recorder lief: GTM lädt vermutlich erst nach der Zustimmung, der Banner-Klick fehlt in der Aufzeichnung. CMP bzw. Selektoren für Zustimmen/Ablehnen und nötige Schritte bis zum Banner (z. B. Scrollen) klären.');
    }
  }
  for (const e of a.eintraege) {
    for (const r of e.requests ?? []) {
      const vorConsent = e.consent?.some((c) => c.endsWith('=denied')) && /^G1[01]1$/.test(r.parameter.gcs ?? '') && r.parameter.gcs !== 'G100';
      if (vorConsent) auffaellig.push(`Seite ${e.seite}: ${requestZusammenfassung(r)} meldet Zustimmung, obwohl laut Tag Assistant noch „denied“ gilt`);
    }
  }

  const { schritte: liste, felder } = schritte(a.eintraege);
  return {
    conversion,
    events: [...zaehler].map(([name, anzahl]) => ({ name, anzahl })),
    tagsProEvent: Object.fromEntries([...tagsProEvent].map(([k, v]) => [k, [...v]])),
    requests: [...requests].map(([k, anzahl]) => ({ request: k, anzahl })),
    fluechtig: [...fluechtig].sort(),
    auffaellig: [...new Set(auffaellig)],
    schritte: liste,
    felder,
    relevant,
  };
}

/* ------------------------------------------------------------------ */
/* Ausgabe                                                            */
/* ------------------------------------------------------------------ */

function markdown(a, z, dateiname) {
  const zeilen = [];
  const p = (s = '') => zeilen.push(s);
  p(`# Zeitleiste: ${a.name ?? dateiname}`);
  p();
  p(`Quelle: ${a.quelle} (\`${dateiname}\`)${a.aufgezeichnet ? ` · aufgezeichnet ${a.aufgezeichnet}` : ''}`);
  if (a.container.length) p(`Container: ${a.container.join(', ')}`);
  const modus = a.eintraege.find((e) => e.art === 'aktion' && e.rec.valueMode)?.rec.valueMode;
  if (modus) p(`Werte-Modus des Recorders: ${modus}`);
  p();

  p('## Vorschlag für den Auftrag');
  p();
  p(`- **Startadresse:** ${a.startUrl}`);
  p(`- **Seiten:** ${a.seiten.map((s) => `${s.nr}. ${s.titel || s.url}`).join(' → ')}`);
  p(`- **Conversion (vermutet):** ${z.conversion ?? '– nicht erkannt –'}`);
  if (z.events.length) p(`- **Events:** ${z.events.map((e) => `${e.name}${e.anzahl > 1 ? ` (${e.anzahl}×)` : ''}`).join(', ')}`);
  if (z.requests.length) p(`- **Google-Requests:** ${z.requests.map((r) => `${r.request}${r.anzahl > 1 ? ` (${r.anzahl}×)` : ''}`).join('; ')}`);
  if (z.fluechtig.length) p(`- **Werte, die sich bei jedem Lauf ändern (Kandidaten):** ${z.fluechtig.join(', ')}`);
  if (z.felder.length) {
    p(`- **Testdaten für \`.env\`:**${modus === 'full' ? ' (Klartext aufgezeichnet: mit `--testdaten` nach `testdaten.aufzeichnung.env` übernehmbar)' : ''}`);
    for (const f of z.felder) p(`  - \`${f.env}\` – ${f.feld}${f.autocomplete ? ` (autocomplete: ${f.autocomplete})` : ''}, aufgezeichnet: \`${f.aufgezeichnet ?? ''}\`${f.modus ? ` (${f.modus})` : ''}`);
  }
  if (z.auffaellig.length) {
    p('- **Auffälligkeiten:**');
    for (const x of z.auffaellig) p(`  - ${x}`);
  }
  p();

  const tagEintraege = Object.entries(z.tagsProEvent);
  if (tagEintraege.length) {
    p('## Tags pro Event');
    p();
    p('| Event | Tags |');
    p('|---|---|');
    for (const [ev, tags] of tagEintraege) p(`| ${ev} | ${tags.map((t) => `${t}${a.tagTypen[t] ? ` *(${a.tagTypen[t]})*` : ''}`).join('<br>')} |`);
    p();
  }

  p('## Vorgeschlagene Playwright-Schritte');
  p();
  p('Aus den Recorder-Einträgen abgeleitet und bereinigt (Fokus-Klicks, Script-Klicks und Submits nach Button-Klick entfernt). Vor dem Übernehmen prüfen.');
  p('`stage.denkpause(ms)` enthält den aufgezeichneten Abstand zum vorherigen Schritt; er wirkt nur mit TEMPO=aufzeichnung, sonst gilt die feste Pause des Tempos.');
  p();
  let seite = 0;
  p('```ts');
  try {
    const start = new URL(a.startUrl);
    p(`await page.goto(${js(start.pathname + start.search)}); // relativ zu BASE_URL=${start.origin}`);
  } catch { /* keine Startadresse */ }
  for (const s of z.schritte) {
    if (s.seite !== seite) {
      seite = s.seite;
      const info = a.seiten[seite - 1];
      p(`// Seite ${seite}: ${info?.titel ?? ''} – ${info?.url ?? ''}`);
    }
    const anm = [...(s.hinweis ?? [])];
    if (s.ueberspringen) p(`// übersprungen: ${s.beschreibung}`);
    else if (s.ergebnis) p(`// Ergebnis: ${s.beschreibung}`);
    else {
      if (s.pauseMs !== undefined) p(`await stage.denkpause(${s.pauseMs});`);
      p(`${s.code}${anm.length ? ` // ${anm.join('; ')}` : ''}`);
    }
  }
  p('```');
  p();

  p('## Zeitleiste');
  for (const s of a.seiten) {
    p();
    p(`### Seite ${s.nr}: ${s.titel}`);
    p();
    p(s.url);
    p();
    for (const e of a.eintraege.filter((x) => x.seite === s.nr)) {
      if (e.art === 'aktion') {
        const r = e.rec;
        if (r.type === 'init') continue;
        const el = r.element ?? {};
        const was = { click: 'Klick', change: 'Eingabe', submit: 'Absenden', key: `Taste ${r.key}`, route: 'URL-Wechsel' }[r.type] ?? r.type;
        let text = `- **▶ ${was}**`;
        if (r.type === 'route') text += ` (${r.kind}) → ${r.to}`;
        else if (r.type === 'submit') text += ` Formular ${r.form?.id ? `#${r.form.id}` : r.form?.name ?? ''}${r.submitter ? ` über „${r.submitter.name}“` : ''}`;
        else text += `: ${el.role || el.tag} „${el.name ?? ''}“ → \`${locator(el)}\``;
        if (r.type === 'change' && r.field) text += ` = \`${kurz(r.field.value ?? r.field.selected?.[0]?.value ?? r.field.checked, 40)}\``;
        if (r.isTrusted === false) text += ' *(von Script ausgelöst)*';
        p(text);
        continue;
      }
      if (e.art === 'consent') {
        p(`- **Consent ${e.befehl}:** ${e.stand.join(', ')}`);
      } else {
        if (!z.relevant(e)) continue;
        const zus = eventZusammenfassung(e.daten);
        p(`- Event **${e.name}**${zus ? ` · ${zus}` : ''}`);
      }
      if (e.tags?.length) p(`  - Tags: ${e.tags.join(', ')}`);
      for (const r of e.requests ?? []) p(`  - Request: ${requestZusammenfassung(r)}`);
    }
  }
  p();
  return zeilen.join('\n');
}

/* ------------------------------------------------------------------ */
/* Start                                                              */
/* ------------------------------------------------------------------ */

/** Wert für eine .env-Zeile; Anführungszeichen, damit "#" und Leerzeichen erhalten bleiben. */
function envWert(wert) {
  const s = String(wert).replace(/\r?\n/g, ' ');
  for (const q of ["'", '"', '`']) if (!s.includes(q)) return `${q}${s}${q}`;
  return `'${s.replace(/'/g, '')}'`;
}

/**
 * Schreibt die Klartext-Eingaben nach <projekt>/testdaten.aufzeichnung.env. Variablen aus
 * früheren Aufzeichnungen bleiben erhalten, gleichnamige werden ersetzt. Gibt nur Namen aus.
 */
function schreibeTestdaten(datei, felder) {
  const projekt = path.dirname(path.dirname(path.resolve(datei)));
  const ziel = path.join(projekt, 'testdaten.aufzeichnung.env');
  const uebernommen = felder.filter((f) => f.modus === 'full' && f.aufgezeichnet && f.aufgezeichnet !== '[redacted]');
  const fehlen = felder.filter((f) => !uebernommen.includes(f)).map((f) => f.env);
  if (!uebernommen.length) {
    console.error('--testdaten: keine Klartext-Eingaben gefunden. Nur Aufzeichnungen mit ?sib_rec=full enthalten echte Werte.');
    return;
  }
  const werte = new Map();
  if (fs.existsSync(ziel)) {
    for (const zeile of fs.readFileSync(ziel, 'utf8').split(/\r?\n/)) {
      const m = zeile.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m) werte.set(m[1], m[2]);
    }
  }
  for (const f of uebernommen) werte.set(f.env, envWert(f.aufgezeichnet));
  const kopf = [
    '# Eingaben aus Aufzeichnungen im Modus "full", erzeugt von werkzeuge/analysiere-aufzeichnung.mjs.',
    '# Werte aus .env haben Vorrang. Nicht einchecken.',
  ];
  fs.writeFileSync(ziel, [...kopf, ...[...werte].map(([k, v]) => `${k}=${v}`), ''].join('\n'));
  console.log(`${path.relative(process.cwd(), ziel)}: ${uebernommen.map((f) => f.env).join(', ')} übernommen`);
  if (fehlen.length) console.log(`Ohne Klartext in der Aufzeichnung, bitte in .env eintragen: ${[...new Set(fehlen)].join(', ')}`);
}

const argumente = process.argv.slice(2);
const datei = argumente.find((a) => !a.startsWith('--'));
if (!datei) {
  console.error('Aufruf: npm run analyse -- projects/<name>/aufzeichnungen/<datei> [--testdaten]');
  process.exit(1);
}
const aufzeichnung = lies(datei);
const ergebnis = auswerten(aufzeichnung);
const basis = datei.replace(/\.(json|log|txt)$/i, '');
const { relevant, ...strukturiert } = ergebnis;
fs.writeFileSync(`${basis}.analyse.json`, JSON.stringify({ ...aufzeichnung, auswertung: strukturiert }, null, 2));
fs.writeFileSync(`${basis}.zeitleiste.md`, markdown(aufzeichnung, ergebnis, path.basename(datei)));
console.log(`${basis}.zeitleiste.md und ${basis}.analyse.json erzeugt`);
console.log(`${aufzeichnung.seiten.length} Seiten, ${ergebnis.schritte.length} Schritte, Conversion: ${ergebnis.conversion ?? 'nicht erkannt'}`);
if (argumente.includes('--testdaten')) schreibeTestdaten(datei, ergebnis.felder);
