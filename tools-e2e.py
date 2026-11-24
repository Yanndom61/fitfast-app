#!/usr/bin/env python3
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = Path(os.environ["FITFAST_SHOTS"]) if os.environ.get("FITFAST_SHOTS") else Path("/tmp/fitfast-e2e-shots")
BASE = os.environ.get("FITFAST_URL", "http://127.0.0.1:4173/")
CHROME = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome-stable")

def iso(d: date) -> str:
    return d.isoformat()

today = date.today()
logs = {}
for i in range(6, -1, -1):
    d = today - timedelta(days=i)
    logs[iso(d)] = {
        "fastRespected": False if i == 1 else True,
        "weight": round(84.2 - (6 - i) * 0.3, 1),
        "waterMl": 1500 if i == 0 else 1750 + (i % 3) * 250,
        "ecarts": {
            "biere": 2 if i == 1 else (1 if i == 3 else 0),
            "grignotage": 1 if i == 2 else 0,
            "autre": 0,
            "note": "bière fin de service" if i == 1 else "",
        },
        "cigarettes": 8 + (i % 4),
    }

sample_state = {
    "settings": {
        "windowStart": "11:30",
        "windowEnd": "18:30",
        "weightCurrent": 82.4,
        "weightGoal": 75,
        "waterGoalMl": 2000,
        "notifMealStart": "11:30",
        "notifWindowSoon": "18:00",
        "notifFastStart": "19:00",
        "waterRemindStart": "11:00",
        "waterRemindEnd": "23:00",
        "waterRemindEveryMin": 120,
        "notifBilan": "00:30",
        "notificationsEnabled": False,
    },
    "logs": logs,
    "notifFired": {},
    "installTipDismissed": True,
}

passed, failed, errors = [], [], []

def check(name, cond, extra=""):
    if cond:
        passed.append(name)
    else:
        msg = name + ((" — " + extra) if extra else "")
        failed.append(msg)
        errors.append(msg)

SHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=CHROME,
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    context = browser.new_context(
        viewport={"width": 360, "height": 800},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        locale="fr-FR",
        timezone_id="Europe/Paris",
        user_agent="Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    )
    page = context.new_page()
    page.on("pageerror", lambda err: errors.append("pageerror: " + str(err)))
    page.on("console", lambda msg: errors.append("console.error: " + msg.text) if msg.type == "error" else None)

    def hide_banner():
        page.evaluate("() => { const el = document.getElementById('install-banner'); if (el) el.hidden = true; }")

    page.goto(BASE, wait_until="networkidle")
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    hide_banner()

    home_text = page.locator("#view-home").inner_text()
    check("home has status", bool(__import__("re").search(r"En jeûne|Créneau repas ouvert|Fin de créneau", home_text, __import__("re").I)), home_text[:200])
    cd = page.locator("#countdown").inner_text().strip()
    check("home has countdown", bool(__import__("re").fullmatch(r"\d{2}:\d{2}:\d{2}", cd)), cd)
    check("home has plan 17:7", "17:7" in home_text)
    check("home mentions 11h30", "11h30" in home_text)
    check("french UI", "Ton programme" in home_text or "Aujourd" in home_text)
    page.screenshot(path=str(SHOTS / "accueil.png"), full_page=False)

    page.click("#btn-tips")
    page.wait_for_timeout(200)
    check("tips accordion opens", page.locator("#tips-body").is_visible())
    page.screenshot(path=str(SHOTS / "accueil-conseils.png"), full_page=False)

    page.click('.tab[data-nav="log"]')
    page.wait_for_timeout(300)
    check("journal view visible", page.locator("#view-log").is_visible())
    page.click("#fast-yes")
    page.fill("#log-weight", "82.5")
    page.locator("#log-weight").blur()
    page.click("#btn-water-plus")
    page.click("#btn-water-plus")
    page.click("#btn-water-plus2")
    page.click('button[data-ecart="biere"][data-delta="1"]')
    page.click("#btn-cig-plus")
    page.click("#btn-cig-plus")
    page.click("#btn-cig-plus")
    page.wait_for_timeout(200)
    check("fast yes active", page.locator("#fast-yes").evaluate("el => el.classList.contains('active')"))
    check("cigarettes is 3", page.locator("#cig-count").inner_text().strip() == "3")
    check("beer is 1", page.locator("#ecart-biere").inner_text().strip() == "1")
    water_text = page.locator("#water-amount").inner_text()
    check("water increased", "1" in water_text, water_text)
    page.screenshot(path=str(SHOTS / "journal.png"), full_page=False)

    page.reload(wait_until="networkidle")
    hide_banner()
    page.click('.tab[data-nav="log"]')
    page.wait_for_timeout(300)
    check("persisted cigarettes", page.locator("#cig-count").inner_text().strip() == "3")
    check("persisted fast", page.locator("#fast-yes").evaluate("el => el.classList.contains('active')"))

    page.click('.tab[data-nav="settings"]')
    page.wait_for_timeout(300)
    check("settings visible", page.locator("#view-settings").is_visible())
    check("default window start", page.locator("#set-window-start").input_value() == "11:30")
    check("default window end", page.locator("#set-window-end").input_value() == "18:30")
    check("default bilan 00:30", page.locator("#set-notif-bilan").input_value() == "00:30")
    settings_text = page.locator("#view-settings").inner_text()
    check("honest notif limits", "ne peut pas réveiller le téléphone de façon fiable" in settings_text)
    page.screenshot(path=str(SHOTS / "reglages.png"), full_page=False)

    page.click("#btn-clock-help")
    page.wait_for_timeout(200)
    check("clock steps visible", page.locator("#clock-help").is_visible())
    steps = page.locator("#clock-steps").inner_text()
    check("clock mentions 11h30", "11h30" in steps)
    check("clock mentions 00h30", "0h30" in steps)

    with page.expect_download() as dlinfo:
        page.click("#btn-download-ics")
    download = dlinfo.value
    ics_path = Path("/tmp/fitfast-rappels.ics")
    download.save_as(str(ics_path))
    ics = ics_path.read_text(encoding="utf-8")
    check("ics is calendar", "BEGIN:VCALENDAR" in ics)
    check("ics has daily rrule", "RRULE:FREQ=DAILY" in ics)
    check("ics has meal event", "créneau" in ics.lower() or "creneau" in ics.lower())
    check("ics has water event", "eau" in ics.lower())
    check("ics has timezone", "Europe/Paris" in ics)

    page.evaluate("(s) => localStorage.setItem('fitfast-v1', JSON.stringify(s))", sample_state)
    page.reload(wait_until="networkidle")
    hide_banner()
    page.click('.tab[data-nav="progress"]')
    page.wait_for_timeout(400)
    prog = page.locator("#view-progress").inner_text()
    check("progress view visible", page.locator("#view-progress").is_visible())
    check("streak shown", "série de jeûnes" in prog.lower() or "jeûnes respectés" in prog.lower())
    check("weight goal mentioned", "75" in prog or "but" in prog)
    check("history has items", page.locator(".history-item").count() >= 6)
    page.screenshot(path=str(SHOTS / "progres.png"), full_page=False)

    manifest = page.evaluate("async () => (await fetch('./manifest.json')).json()")
    check("manifest display standalone", manifest.get("display") == "standalone")
    check("manifest lang fr", manifest.get("lang") == "fr")
    check("manifest has icons", isinstance(manifest.get("icons"), list) and len(manifest["icons"]) >= 2)

    sw_ready = page.evaluate(
        """async () => {
            if (!('serviceWorker' in navigator)) return false;
            const r = await navigator.serviceWorker.ready;
            return !!r;
        }"""
    )
    check("service worker ready", sw_ready)

    page.goto(BASE + "#reglages", wait_until="networkidle")
    page.wait_for_timeout(200)
    check("hash opens settings", page.locator("#view-settings").is_visible())

    browser.close()

report = {
    "passed": len(passed),
    "failed": len(failed),
    "failedList": failed,
    "errors": errors,
}
print(json.dumps(report, indent=2, ensure_ascii=False))
sys.exit(1 if failed or errors else 0)
