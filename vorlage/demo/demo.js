/*
 * Simuliert ein typisches Setup aus CMP, Consent Mode und GA4, ohne echte Dienste:
 * - Consent-Default "denied", CMP-Banner im Shadow DOM (wie bei vielen CMPs)
 * - Consent-Update über gtag('consent', 'update', ...)
 * - GA4-Treffer mit gcs-Parameter (G100 = abgelehnt, G111 = zugestimmt) an /g/collect auf
 *   dem Demo-Server, wie bei serverseitigem Tagging auf eigener Domain
 * - Conversion-Button pusht ein Event in den dataLayer und sendet einen Treffer; der
 *   Demo-Server antwortet darauf mit einer Weiterleitung auf /sgtm-pixel (Folge-Request)
 * - beim Verlassen jeder Seite ein user_engagement-Treffer (wie GA4), der nur entsteht,
 *   wenn die Seite wirklich verlassen wird
 * - window.__demoFehler = 'doppelt' (vor dem Laden gesetzt) pusht die Conversion zweimal,
 *   um zu zeigen, dass der Baseline-Vergleich das erkennt
 * Es geht nie etwas an echte Dienste.
 */
(function () {
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }

  var SPEICHER = 'demo_consent';
  var gespeichert = null;
  try { gespeichert = localStorage.getItem(SPEICHER); } catch (e) { /* ignorieren */ }

  gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  if (gespeichert) gtag('consent', 'update', consentWerte(gespeichert === 'ja'));

  function consentWerte(ja) {
    var w = ja ? 'granted' : 'denied';
    return { ad_storage: w, analytics_storage: w, ad_user_data: w, ad_personalization: w };
  }

  function gcs() {
    var stand = null;
    try { stand = localStorage.getItem(SPEICHER); } catch (e) { /* ignorieren */ }
    return stand === 'ja' ? 'G111' : 'G100';
  }

  function sendeGa4(en, parameter) {
    var q = 'v=2&tid=G-DEMO123&en=' + encodeURIComponent(en) + '&gcs=' + gcs() +
      '&dl=' + encodeURIComponent(location.href);
    for (var k in parameter) q += '&ep.' + k + '=' + encodeURIComponent(parameter[k]);
    navigator.sendBeacon(location.origin + '/g/collect?' + q);
  }

  function zeigeBanner() {
    var host = document.createElement('div');
    host.id = 'demo-cmp-root';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>.b{position:fixed;bottom:0;left:0;right:0;padding:16px;background:#222;color:#fff;font-family:sans-serif}' +
      'button{margin-right:8px;padding:8px 12px}</style>' +
      '<div class="b" role="dialog" aria-label="Cookie-Einstellungen">Wir verwenden Cookies. ' +
      '<button data-testid="cmp-accept">Alle akzeptieren</button>' +
      '<button data-testid="cmp-deny">Ablehnen</button></div>';
    function entscheide(ja) {
      try { localStorage.setItem(SPEICHER, ja ? 'ja' : 'nein'); } catch (e) { /* ignorieren */ }
      gtag('consent', 'update', consentWerte(ja));
      dataLayer.push({ event: 'cmp_entscheidung', cmp_status: ja ? 'akzeptiert' : 'abgelehnt' });
      host.remove();
    }
    root.querySelector('[data-testid="cmp-accept"]').addEventListener('click', function () { entscheide(true); });
    root.querySelector('[data-testid="cmp-deny"]').addEventListener('click', function () { entscheide(false); });
  }

  window.addEventListener('pagehide', function () { sendeGa4('user_engagement', {}); });

  document.addEventListener('DOMContentLoaded', function () {
    dataLayer.push({ event: 'seite_geladen', seitentyp: document.body.getAttribute('data-seitentyp') });
    sendeGa4('page_view', {});
    if (!gespeichert) zeigeBanner();

    var cta = document.querySelector('[data-testid="cta-anfrage"]');
    if (cta) {
      cta.addEventListener('click', function () {
        var id = 'L-' + Date.now();
        var lead = { event: 'generate_lead', lead_id: id, lead_typ: 'angebot', value: 50, currency: 'EUR' };
        dataLayer.push(lead);
        if (window.__demoFehler === 'doppelt') dataLayer.push(lead);
        sendeGa4('generate_lead', { lead_typ: 'angebot', value: 50, currency: 'EUR' });
        document.getElementById('bestaetigung').hidden = false;
      });
    }
  });
})();
