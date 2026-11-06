"""Smoke-Test für den Recorder: bindet beide Build-Varianten in eine lokale Testseite ein,
spielt eine typische Journey durch und prüft die aufgezeichneten dataLayer-Messages.

Aufruf: python3 test/run_test.py (vorher sh build.sh)
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "test" / "page.html").read_text()
STANDALONE = (ROOT / "dist" / "recorder.js").read_text()
GTM_TAG = (ROOT / "dist" / "gtm-recorder-tag.html").read_text()


def gtm_script(debug_mode, values="masked"):
    # Simuliert GTM: ersetzt die Variablenreferenz und entfernt die <script>-Wrapper.
    code = GTM_TAG.replace("{{Debug Mode}}", "true" if debug_mode else "false")
    code = code.replace("values: 'masked'", "values: '%s'" % values)
    return code.replace("<script>", "").replace("</script>", "\n")


def journey(page):
    page.click('[data-testid="nav-products"]')
    page.click("text=In den Warenkorb")
    page.click('[aria-label="Menü öffnen"]')
    page.click('[data-testid="accept-all"]')
    page.click("#spa")
    page.fill("#email", "Max.Mustermann@example.de")
    page.fill('input[name="phone"]', "+49 170 1234567")
    page.fill('input[name="pw"]', "geheim")
    page.fill('input[name="cc"]', "4111111111111111")
    page.select_option('select[name="shipping"]', "exp")
    page.check("#nl")
    page.press("#email", "Enter")


def open_page(p, init_script):
    browser = p.chromium.launch()
    page = browser.new_page()
    page.route("http://test.local/**", lambda r: r.fulfill(body=PAGE, content_type="text/html"))
    page.add_init_script(init_script)
    page.goto("http://test.local/start")
    return browser, page


def run(init_script):
    """Liefert (Recorder-Einträge, kompletter dataLayer)."""
    with sync_playwright() as p:
        browser, page = open_page(p, init_script)
        journey(page)
        raw = page.evaluate("window.dataLayer || []")
        browser.close()
    return [m["__rec"] for m in raw if "__rec" in m], raw


failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def change_field(entries, pred):
    return next(e["field"] for e in entries if e["type"] == "change" and pred(e["element"]))


# 0) GTM ersetzt {{…}} überall, auch in Kommentaren. Erlaubt ist nur die eine Stelle in der Konfiguration.
import re
check(re.findall(r"\{\{[^}]*\}\}", GTM_TAG) == ["{{Debug Mode}}"], "GTM-Variablen nur in der Konfiguration")

# 1) Eigenständige Variante, maskiert
entries, raw = run(STANDALONE)
types = [e["type"] for e in entries]
check(types[0] == "init", "erster Eintrag ist init")
check("route" in types, "pushState-Route-Change erfasst")
check("submit" in types, "Submit erfasst")
check("key" in types, "Enter erfasst")
check([e["seq"] for e in entries] == list(range(1, len(entries) + 1)), "seq lückenlos")

clicks = [e for e in entries if e["type"] == "click"]
cart = next(c for c in clicks if c["element"]["name"] == "In den Warenkorb")
check(cart["element"]["tag"] == "button", "Klick auf <span> wird zum <button> aufgelöst")
check(any(s["kind"] == "idGenerated" for s in cart["element"]["selectors"]), "generierte ID markiert")
shadow = next(c for c in clicks if c["element"]["name"] == "Alle akzeptieren")
check(shadow["element"].get("shadowHosts"), "Shadow-DOM-Host erfasst")
check(shadow["element"]["selectors"][0]["unique"], "Test-Attribut im Shadow Root eindeutig")

email = change_field(entries, lambda el: el.get("autocomplete") == "email")
check(email["value"] == "Xxx.Xxxxxxxxxx@xxxxxxx.xx", "maskierte E-Mail behält Format: %s" % email["value"])
check(change_field(entries, lambda el: el.get("type") == "password")["value"] == "[redacted]", "Passwort immer unkenntlich")
check(change_field(entries, lambda el: el.get("autocomplete") == "cc-number")["value"] == "[redacted]", "Kartennummer immer unkenntlich")
check(change_field(entries, lambda el: el["tag"] == "select")["selected"][0]["value"] == "exp", "Select-Wert im Klartext")
phone = next(e for e in entries if e["type"] == "change" and e["element"].get("type") == "tel")
check(phone["element"]["name"] == "Telefon", "umschließendes Label als Accessible Name")

check(all("event" not in m for m in raw), "Recorder-Messages ohne event-Key")
check(all(m.get("_clear") is True for m in raw), "Recorder-Messages mit _clear")

# 2) GTM-Variante, Debug Mode true, Werte vollständig
entries_full, _ = run(gtm_script(True, "full"))
check(change_field(entries_full, lambda el: el.get("autocomplete") == "email")["value"] == "Max.Mustermann@example.de",
      "Modus full erfasst Klartext")
check(change_field(entries_full, lambda el: el.get("type") == "password")["value"] == "[redacted]",
      "Passwort auch im Modus full unkenntlich")

# 3) GTM-Variante, Debug Mode false -> keine Aufzeichnung
entries_off, _ = run(gtm_script(False))
check(entries_off == [], "Debug Mode false zeichnet nichts auf")

(ROOT / "test" / "beispielausgabe.json").write_text(json.dumps(entries, indent=2, ensure_ascii=False))
print("%d Einträge aufgezeichnet, Typen: %s" % (len(entries), sorted(set(types))))
if failures:
    print("FEHLGESCHLAGEN:\n- " + "\n- ".join(failures))
    sys.exit(1)
print("alle Prüfungen bestanden")
