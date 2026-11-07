// Recorder-Einstellungen für den eigenständigen Einsatz. Vor dem Einbinden anpassen.
window.__recConfig = window.__recConfig || {
  enabled: true,
  values: 'masked', // 'masked' | 'full'
  console: true
};
/*
 * Interaction Recorder
 *
 * Zeichnet Nutzerinteraktionen (Klicks, Formularänderungen, Submits,
 * Tastendrücke, Route Changes) als einfache Messages im dataLayer auf. Eine
 * Aufzeichnung mit dem Google Tag Assistant enthält dadurch Klickpfad und
 * Tracking-Events in einem Export. Daraus lässt sich ein abspielbarer
 * Playwright-Test ableiten.
 *
 * Grundsätze:
 * - GTM nicht beeinflussen: Messages haben keinen "event"-Key, GTM wertet
 *   für sie also keine Trigger aus. "_clear" verhindert, dass das
 *   Recorder-Objekt rekursiv ins GTM-Datenmodell gemergt wird.
 * - Die Seite nie kaputt machen: jeder Handler läuft in try/catch.
 * - Nur ES5, damit GTM den Code in Custom-HTML-Tags akzeptiert.
 *
 * Konfiguration (optional), vor diesem Script setzen:
 *   window.__recConfig = {
 *     enabled: true,          // false = nichts tun
 *     param: 'sib_rec',       // nur aktiv nach Aufruf mit ?sib_rec=masked|full, bis ?sib_rec=aus
 *     values: 'masked',       // 'masked' | 'full' – Erfassung von Texteingaben
 *     console: false,         // jeden Eintrag zusätzlich in die Konsole schreiben
 *     dataLayerName: 'dataLayer',
 *     key: '__rec'            // dataLayer-Key für Recorder-Messages
 *   };
 *
 * Passwörter, versteckte Felder, Einmalcodes und Kartenfelder werden
 * unabhängig von "values" immer unkenntlich gemacht.
 */
(function () {
  'use strict';

  var VERSION = 1;
  var cfg = window.__recConfig || {};
  if (cfg.enabled === false || cfg.enabled === 'false') return;
  var VALUE_MODE = cfg.values === 'full' ? 'full' : 'masked';

  // Der Parameter steht nur in der ersten URL; sessionStorage trägt die Aktivierung
  // über Seitenwechsel im selben Tab weiter.
  if (cfg.param) {
    var STORE_KEY = '__rec_' + cfg.param;
    var match = new RegExp('[?&]' + cfg.param + '(?:=([^&#]*))?(?:[&#]|$)').exec(location.search);
    var stored = null;
    try { stored = window.sessionStorage.getItem(STORE_KEY); } catch (e) {}
    if (match) {
      var requested = decodeURIComponent(match[1] || '').toLowerCase();
      if (requested === 'aus' || requested === 'off') {
        try { window.sessionStorage.removeItem(STORE_KEY); } catch (e) {}
        return;
      }
      stored = requested === 'full' || requested === 'masked' ? requested : VALUE_MODE;
      try { window.sessionStorage.setItem(STORE_KEY, stored); } catch (e) {}
    }
    if (!stored) return;
    VALUE_MODE = stored === 'full' ? 'full' : 'masked';
  }

  if (window.__recActive) return; // Schutz vor doppelter Einbindung (z. B. GTM-Tag + Override)
  window.__recActive = true;

  var DL_NAME = cfg.dataLayerName || 'dataLayer';
  var KEY = cfg.key || '__rec';
  var LOG = cfg.console === true;
  var TEXT_MAX = 80;
  var MAX_FORM_FIELDS = 50;
  var TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-e2e', 'data-track', 'data-tracking'];
  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,option,' +
    '[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],' +
    '[role="radio"],[role="option"],[role="switch"],[role="combobox"],[onclick],[tabindex]';

  var seq = 0;
  var pageId = Math.random().toString(36).slice(2, 10);
  var lastUrl = location.href;

  /* ---------- Hilfsfunktionen ---------- */

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_ -￿-]/g, function (c) { return '\\' + c; });
  }

  function attrValue(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cleanText(s) {
    if (!s) return '';
    s = String(s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) + '…' : s;
  }

  function isElement(n) {
    return n && n.nodeType === 1;
  }

  // IDs mit langen Zahlen oder Hash-artigen Teilen werden meist pro Rendering
  // neu erzeugt und taugen deshalb nicht als Selektor.
  function looksGenerated(id) {
    return /\d{4,}|[a-f0-9]{8,}|^:r|^(ember|react|radix|mui|headlessui|rc_|uid|id-)/i.test(id);
  }

  function rootOf(el) {
    return el.getRootNode ? el.getRootNode() : document;
  }

  function countMatches(root, selector) {
    try { return root.querySelectorAll(selector).length; } catch (e) { return -1; }
  }

  function labelText(el) {
    var t = '';
    try {
      if (el.labels && el.labels.length) t = el.labels[0].innerText || el.labels[0].textContent;
      if (!t && el.id) {
        var l = rootOf(el).querySelector('label[for="' + attrValue(el.id) + '"]');
        if (l) t = l.innerText || l.textContent;
      }
      if (!t) {
        var wrap = el.closest && el.closest('label');
        if (wrap) t = wrap.innerText || wrap.textContent;
      }
    } catch (e) { /* ignorieren */ }
    return cleanText(t);
  }

  function implicitRole(el) {
    var explicit = el.getAttribute('role');
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'option') return 'option';
    if (tag === 'input') {
      if (/^(submit|button|reset|image)$/.test(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      if (/^(email|tel|text|url|number|)$/.test(type)) return 'textbox';
    }
    return '';
  }

  // Näherung an den Accessible Name; reicht als Hinweis für getByRole().
  function accessibleName(el) {
    var n = el.getAttribute('aria-label');
    if (n) return cleanText(n);
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var parts = lb.split(/\s+/), out = [];
      for (var i = 0; i < parts.length; i++) {
        var ref = rootOf(el).getElementById ? rootOf(el).getElementById(parts[i]) : document.getElementById(parts[i]);
        if (ref) out.push(ref.textContent);
      }
      if (out.length) return cleanText(out.join(' '));
    }
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      var l = labelText(el);
      if (l) return l;
      if (/^(submit|button|reset)$/i.test(el.type || '')) return cleanText(el.value);
      return cleanText(el.getAttribute('placeholder') || el.getAttribute('title') || '');
    }
    var txt = cleanText(el.innerText || el.textContent);
    if (txt) return txt;
    var img = el.querySelector && el.querySelector('img[alt]');
    if (img) return cleanText(img.getAttribute('alt'));
    return cleanText(el.getAttribute('title') || '');
  }

  function cssPath(el) {
    var parts = [];
    var root = rootOf(el);
    var node = el;
    while (isElement(node) && node !== root) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') {
        parts.unshift(tag);
      } else if (node.id && !looksGenerated(node.id)) {
        parts.unshift('#' + cssEscape(node.id));
        if (countMatches(root, parts.join(' > ')) === 1) return parts.join(' > ');
      } else {
        var idx = 1, sib = node;
        while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
        parts.unshift(tag + ':nth-of-type(' + idx + ')');
      }
      if (parts.length > 1 && countMatches(root, parts.join(' > ')) === 1) return parts.join(' > ');
      node = node.parentNode;
    }
    return parts.join(' > ');
  }

  // Selektor-Kandidaten, nach Robustheit sortiert. "unique" bezieht sich auf
  // das eigene Dokument bzw. den eigenen Shadow Root (Playwright-CSS
  // durchdringt offene Shadow DOMs).
  function selectorCandidates(el) {
    var out = [];
    var root = rootOf(el);
    var tag = el.tagName.toLowerCase();

    function add(kind, selector) {
      out.push({ kind: kind, selector: selector, unique: countMatches(root, selector) === 1 });
    }

    for (var i = 0; i < TEST_ATTRS.length; i++) {
      var v = el.getAttribute(TEST_ATTRS[i]);
      if (v) add('testAttr', '[' + TEST_ATTRS[i] + '="' + attrValue(v) + '"]');
    }
    if (el.id) add(looksGenerated(el.id) ? 'idGenerated' : 'id', '#' + cssEscape(el.id));
    var name = el.getAttribute('name');
    if (name) add('name', tag + '[name="' + attrValue(name) + '"]');
    var aria = el.getAttribute('aria-label');
    if (aria) add('ariaLabel', tag + '[aria-label="' + attrValue(aria) + '"]');
    if (tag === 'a' && el.getAttribute('href')) add('href', 'a[href="' + attrValue(el.getAttribute('href')) + '"]');
    add('cssPath', cssPath(el));
    return out;
  }

  // Erhält Format und Länge: Buchstaben -> x/X, Ziffern -> 0, Rest bleibt.
  function maskValue(v) {
    return String(v).replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/g, function (c) {
      return c === c.toUpperCase() && c !== c.toLowerCase() ? 'X' : 'x';
    }).replace(/[0-9]/g, '0');
  }

  function isSensitive(el) {
    var type = (el.getAttribute('type') || '').toLowerCase();
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return type === 'password' || type === 'hidden' || /(^|\s)cc-|one-time-code|new-password|current-password/.test(ac);
  }

  function fieldValue(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return { checked: !!el.checked, value: el.value };
    if (tag === 'select') {
      var opts = [];
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].selected) opts.push({ value: el.options[i].value, text: cleanText(el.options[i].text) });
      }
      return { selected: opts };
    }
    if (type === 'file') return { files: el.files ? el.files.length : 0 };
    var raw = el.value == null ? '' : String(el.value);
    if (isSensitive(el)) return { value: '[redacted]', length: raw.length };
    return { value: VALUE_MODE === 'full' ? raw : maskValue(raw), length: raw.length, mode: VALUE_MODE };
  }

  function shadowHosts(el) {
    var hosts = [];
    var root = rootOf(el);
    while (root && root.host) {
      hosts.unshift(describeBasic(root.host));
      root = rootOf(root.host);
    }
    return hosts;
  }

  function describeBasic(el) {
    return {
      tag: el.tagName.toLowerCase(),
      selectors: selectorCandidates(el)
    };
  }

  // Wie getByRole() mit Name: Teilstring ohne Groß-/Kleinschreibung, nur sichtbare Elemente.
  var MAX_ROLE_SCAN = 3000;
  function roleNameUnique(el, role, name) {
    if (!role || !name) return undefined;
    var all = rootOf(el).querySelectorAll(INTERACTIVE);
    if (all.length > MAX_ROLE_SCAN) return undefined;
    var needle = name.toLowerCase(), count = 0;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c !== el && (!c.getClientRects().length || implicitRole(c) !== role)) continue;
      if (accessibleName(c).toLowerCase().indexOf(needle) >= 0 && ++count > 1) return false;
    }
    return true;
  }

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var role = implicitRole(el);
    var name = accessibleName(el);
    var d = {
      tag: tag,
      role: role,
      name: name,
      text: cleanText(el.innerText || el.textContent),
      selectors: selectorCandidates(el)
    };
    var unique = roleNameUnique(el, role, name);
    if (unique !== undefined) d.roleNameUnique = unique;
    var type = el.getAttribute('type');
    if (type) d.type = type;
    var ac = el.getAttribute('autocomplete');
    if (ac) d.autocomplete = ac;
    if (tag === 'a') {
      d.href = el.href;
      if (el.target) d.target = el.target;
      if (el.target === '_blank') d.opensNewTab = true;
      if (el.hasAttribute('download')) d.download = true;
    }
    var expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) d.ariaExpanded = expanded;
    var hosts = shadowHosts(el);
    if (hosts.length) d.shadowHosts = hosts;
    var form = el.form || (el.closest && el.closest('form'));
    if (form) d.form = formInfo(form);
    return d;
  }

  function formInfo(form) {
    return {
      id: form.id || undefined,
      name: form.getAttribute('name') || undefined,
      action: form.getAttribute('action') || undefined,
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      selectors: selectorCandidates(form)
    };
  }

  function eventTarget(e) {
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) if (isElement(path[i])) return { el: path[i], path: path };
    return { el: isElement(e.target) ? e.target : null, path: path };
  }

  // Das nächstgelegene Element, mit dem der Nutzer vermutlich interagieren
  // wollte, z. B. der <button> um ein angeklicktes <span> oder <svg>.
  function interactiveFrom(path, fallback) {
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (!isElement(n)) continue;
      try { if (n.matches(INTERACTIVE)) return n; } catch (e) { /* ignorieren */ }
    }
    return fallback && fallback.closest ? (fallback.closest(INTERACTIVE) || fallback) : fallback;
  }

  /* ---------- Ausgabe ---------- */

  function emit(type, data) {
    try {
      var entry = {
        v: VERSION,
        type: type,
        seq: ++seq,
        pageId: pageId,
        ts: Date.now(),
        t: Math.round(window.performance && performance.now ? performance.now() : 0),
        url: location.href
      };
      if (window !== window.top) entry.frame = true;
      for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) entry[k] = data[k];
      var msg = { _clear: true };
      msg[KEY] = entry;
      var dl = window[DL_NAME] = window[DL_NAME] || [];
      dl.push(msg);
      if (LOG && window.console) console.log('[rec]', JSON.stringify(entry));
    } catch (e) {
      if (LOG && window.console) console.warn('[rec] emit fehlgeschlagen', e);
    }
  }

  function safe(fn) {
    return function (e) {
      try { fn(e); } catch (err) { if (LOG && window.console) console.warn('[rec] Handler fehlgeschlagen', err); }
    };
  }

  /* ---------- Erfassung ---------- */

  emit('init', {
    title: document.title,
    referrer: document.referrer,
    readyState: document.readyState,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    // documentElement kann null sein, wenn vor dem Parsen eingebunden (z. B. per Init-Script)
    lang: (document.documentElement && document.documentElement.lang) || navigator.language,
    userAgent: navigator.userAgent,
    valueMode: VALUE_MODE
  });

  document.addEventListener('click', safe(function (e) {
    var t = eventTarget(e);
    if (!t.el) return;
    var target = interactiveFrom(t.path, t.el);
    var data = {
      button: e.button,
      modifiers: { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey },
      isTrusted: e.isTrusted,
      element: describe(target)
    };
    if (target !== t.el) data.clickedNode = { tag: t.el.tagName.toLowerCase(), text: cleanText(t.el.textContent) };
    emit('click', data);
  }), true);

  document.addEventListener('change', safe(function (e) {
    var t = eventTarget(e);
    if (!t.el || !/^(input|select|textarea)$/i.test(t.el.tagName)) return;
    var data = { element: describe(t.el), field: fieldValue(t.el), isTrusted: e.isTrusted };
    emit('change', data);
  }), true);

  document.addEventListener('submit', safe(function (e) {
    var form = eventTarget(e).el;
    if (!form || form.tagName.toLowerCase() !== 'form') return;
    var fields = [];
    var els = form.elements || [];
    for (var i = 0; i < els.length && fields.length < MAX_FORM_FIELDS; i++) {
      var f = els[i];
      if (!f.name && !f.id) continue;
      if (/^(button|submit|reset|fieldset)$/i.test(f.type || f.tagName)) continue;
      fields.push({
        name: f.name || undefined,
        id: f.id || undefined,
        type: f.type || f.tagName.toLowerCase(),
        autocomplete: f.getAttribute('autocomplete') || undefined,
        field: fieldValue(f)
      });
    }
    var data = { form: formInfo(form), fields: fields };
    if (e.submitter) data.submitter = describe(e.submitter);
    emit('submit', data);
  }), true);

  document.addEventListener('keydown', safe(function (e) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    var t = eventTarget(e);
    if (!t.el) return;
    emit('key', { key: e.key, element: describe(t.el) });
  }), true);

  function onRoute(kind) {
    var to = location.href;
    if (to === lastUrl) return;
    emit('route', { kind: kind, from: lastUrl, to: to, title: document.title });
    lastUrl = to;
  }

  function wrapHistory(method) {
    var orig = history[method];
    if (typeof orig !== 'function') return;
    history[method] = function () {
      var result = orig.apply(this, arguments);
      try { onRoute(method); } catch (e) { /* ignorieren */ }
      return result;
    };
  }
  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', safe(function () { onRoute('popstate'); }));
  window.addEventListener('hashchange', safe(function () { onRoute('hashchange'); }));
})();
