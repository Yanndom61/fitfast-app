/* FitFast — jeûne 17:7 */
(() => {
  "use strict";

  const STORAGE_KEY = "fitfast-v1";
  const GLASS_ML = 250;
  const VIEWS = ["home", "log", "progress", "settings"];

  const DEFAULTS = {
    windowStart: "11:30",
    windowEnd: "18:30",
    weightCurrent: null,
    weightGoal: null,
    waterGoalMl: 2000,
    notifMealStart: "11:30",
    notifWindowSoon: "18:00",
    notifFastStart: "19:00",
    waterRemindStart: "11:00",
    waterRemindEnd: "23:00",
    waterRemindEveryMin: 120,
    notifBilan: "00:30",
    notificationsEnabled: false,
  };

  const EMPTY_LOG = () => ({
    fastRespected: null,
    weight: null,
    waterMl: 0,
    ecarts: { biere: 0, grignotage: 0, autre: 0, note: "" },
    cigarettes: 0,
  });

  let state = loadState();
  let currentView = "home";
  let logDate = logDateForNow();
  let deferredPrompt = null;
  let toastTimer = 0;

  /* ---------- persistence ---------- */
  function defaultState() {
    return {
      settings: { ...DEFAULTS },
      logs: {},
      notifFired: {},
      installTipDismissed: false,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULTS, ...(parsed.settings || {}) },
        logs: parsed.logs && typeof parsed.logs === "object" ? parsed.logs : {},
        notifFired: parsed.notifFired && typeof parsed.notifFired === "object" ? parsed.notifFired : {},
        installTipDismissed: !!parsed.installTipDismissed,
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /* ---------- dates ---------- */
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function addDays(iso, n) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  function parseHM(hm) {
    const [h, m] = String(hm || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
    return { h, m };
  }

  function onDay(dayRef, hm) {
    const { h, m } = parseHM(hm);
    const d = new Date(dayRef);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function formatHM(hm) {
    const { h, m } = parseHM(hm);
    return `${h}h${m === 0 ? "" : pad(m)}`;
  }

  function formatLongDate(iso) {
    const d = parseISODate(iso);
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  function formatShortDate(iso) {
    const d = parseISODate(iso);
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  }

  function logDateForNow(now = new Date()) {
    if (now.getHours() < 5) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return toISODate(y);
    }
    return toISODate(now);
  }

  function intervalOnDay(dayRef, startHM, endHM) {
    const start = onDay(dayRef, startHM);
    let end = onDay(dayRef, endHM);
    if (end <= start) end = new Date(end.getTime() + 86400000);
    return { start, end };
  }

  function minutesOf(hm) {
    const { h, m } = parseHM(hm);
    return h * 60 + m;
  }

  /* ---------- fasting phase ---------- */
  function getPhase(now, settings) {
    const yestRef = new Date(now);
    yestRef.setDate(yestRef.getDate() - 1);
    const today = intervalOnDay(now, settings.windowStart, settings.windowEnd);
    const yest = intervalOnDay(yestRef, settings.windowStart, settings.windowEnd);

    const fastAfter = (windowEnd) => {
      let candidate = onDay(windowEnd, settings.notifFastStart);
      if (candidate < windowEnd) candidate = new Date(candidate.getTime() + 86400000);
      return candidate;
    };

    if (now >= today.start && now < today.end) {
      return { phase: "eat", until: today.end, nextLabel: "Fin du créneau dans", untilText: `Créneau ouvert jusqu’à ${formatHM(settings.windowEnd)}` };
    }
    if (now >= yest.start && now < yest.end) {
      return { phase: "eat", until: yest.end, nextLabel: "Fin du créneau dans", untilText: `Créneau ouvert jusqu’à ${formatHM(settings.windowEnd)}` };
    }
    if (now >= today.end && now < fastAfter(today.end)) {
      return { phase: "wrap", until: fastAfter(today.end), nextLabel: "Début du jeûne dans", untilText: `Termine ton repas avant ${formatHM(settings.notifFastStart)}` };
    }
    if (now >= yest.end && now < fastAfter(yest.end)) {
      return { phase: "wrap", until: fastAfter(yest.end), nextLabel: "Début du jeûne dans", untilText: `Termine ton repas avant ${formatHM(settings.notifFastStart)}` };
    }

    const nextStart = now < today.start ? today.start : intervalOnDay(new Date(now.getTime() + 86400000), settings.windowStart, settings.windowEnd).start;
    return { phase: "fast", until: nextStart, nextLabel: "Ouverture du créneau dans", untilText: `Réouverture à ${formatHM(settings.windowStart)}` };
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  function programLabel(settings) {
    const start = minutesOf(settings.windowStart);
    let end = minutesOf(settings.windowEnd);
    if (end <= start) end += 24 * 60;
    const eatHours = (end - start) / 60;
    const fastHours = 24 - eatHours;
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
    return `${fmt(fastHours)}:${fmt(eatHours)}`;
  }

  /* ---------- logs ---------- */
  function getLog(iso) {
    const existing = state.logs[iso];
    if (!existing) return EMPTY_LOG();
    return {
      fastRespected: existing.fastRespected ?? null,
      weight: existing.weight ?? null,
      waterMl: existing.waterMl || 0,
      ecarts: {
        biere: existing.ecarts?.biere || 0,
        grignotage: existing.ecarts?.grignotage || 0,
        autre: existing.ecarts?.autre || 0,
        note: existing.ecarts?.note || "",
      },
      cigarettes: existing.cigarettes || 0,
    };
  }

  function isLogEmpty(log) {
    return (
      log.fastRespected == null &&
      log.weight == null &&
      !log.waterMl &&
      !log.cigarettes &&
      !log.ecarts.biere &&
      !log.ecarts.grignotage &&
      !log.ecarts.autre &&
      !log.ecarts.note
    );
  }

  function putLog(iso, log) {
    if (isLogEmpty(log)) {
      delete state.logs[iso];
    } else {
      state.logs[iso] = log;
    }
    if (log.weight != null) state.settings.weightCurrent = log.weight;
    saveState();
  }

  function updateLog(mutator) {
    const log = getLog(logDate);
    mutator(log);
    putLog(logDate, log);
    renderLog();
    renderHome();
  }

  function ecartTotal(log) {
    return (log.ecarts.biere || 0) + (log.ecarts.grignotage || 0) + (log.ecarts.autre || 0);
  }

  function computeStreak(now = new Date()) {
    let cursor = toISODate(now);
    const todayLog = getLog(cursor);
    if (todayLog.fastRespected == null) cursor = addDays(cursor, -1);
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const log = state.logs[cursor];
      if (log && log.fastRespected === true) {
        streak += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  /* ---------- UI helpers ---------- */
  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  function showView(name, opts = {}) {
    if (!VIEWS.includes(name)) name = "home";
    currentView = name;
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.nav === name));
    if (name === "log") {
      if (opts.date) logDate = opts.date;
      renderLog();
    }
    if (name === "progress") renderProgress();
    if (name === "settings") renderSettings();
    if (name === "home") renderHome();
    if (!opts.silent) {
      const hash = name === "home" ? "#accueil" : name === "log" ? `#journal/${logDate}` : name === "progress" ? "#progres" : "#reglages";
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  }

  function parseHash() {
    const h = (location.hash || "").replace(/^#/, "");
    if (h.startsWith("journal")) {
      const parts = h.split("/");
      return { view: "log", date: /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ? parts[1] : logDate };
    }
    if (h === "progres") return { view: "progress" };
    if (h === "reglages") return { view: "settings" };
    return { view: "home" };
  }

  /* ---------- render: home ---------- */
  function renderHome() {
    const now = new Date();
    $("header-date").textContent = now.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const phase = getPhase(now, state.settings);
    const card = $("status-card");
    card.classList.remove("phase-fast", "phase-eat", "phase-wrap");
    card.classList.add(`phase-${phase.phase}`);
    const kicker = { fast: "En jeûne", eat: "Créneau repas ouvert", wrap: "Fin de créneau" };
    $("status-kicker").textContent = kicker[phase.phase];
    $("status-next-label").textContent = phase.nextLabel;
    $("countdown").textContent = formatCountdown(phase.until - now);
    $("status-until").textContent = phase.untilText;

    const today = getLog(toISODate(now));
    const waterGoal = state.settings.waterGoalMl || 2000;
    const glasses = Math.round((today.waterMl / GLASS_ML) * 10) / 10;
    const goalGlasses = Math.round(waterGoal / GLASS_ML);
    const fastLabel =
      today.fastRespected === true ? "Oui" : today.fastRespected === false ? "Non" : "Pas encore noté";
    const fastClass = today.fastRespected === true ? "ok" : today.fastRespected === false ? "bad" : "";
    const weight =
      today.weight != null
        ? `${formatNum(today.weight)} kg`
        : state.settings.weightCurrent != null
          ? `${formatNum(state.settings.weightCurrent)} kg`
          : "—";

    $("today-stats").innerHTML = `
      <div class="stat-pill ${fastClass}"><span class="k">Jeûne</span><span class="v">${fastLabel}</span></div>
      <div class="stat-pill"><span class="k">Poids</span><span class="v">${weight}</span></div>
      <div class="stat-pill"><span class="k">Eau</span><span class="v">${formatNum(today.waterMl / 1000)} L / ${formatNum(waterGoal / 1000)} L</span></div>
      <div class="stat-pill"><span class="k">Cigarettes · écarts</span><span class="v">${today.cigarettes} · ${ecartTotal(today)}</span></div>
    `;

    const ratio = programLabel(state.settings);
    const s = state.settings;
    $("plan-list").innerHTML = `
      <li>Programme <strong>${ratio}</strong> : ${formatHM(s.windowStart)}–${formatHM(s.windowEnd)} tous les jours.</li>
      <li>Arrêt de manger vers <strong>${formatHM(s.notifFastStart)}</strong>, jusqu’au lendemain ${formatHM(s.windowStart)}.</li>
      <li>Deux repas, calés sur le personnel à 11h30 et 18h30 les jours de travail.</li>
      <li>Le repas du soir est le plus copieux (protéines + légumes).</li>
      <li>Même créneau les lundis et mardis, même si tu te lèves plus tard ou sors le soir.</li>
    `;
  }

  function tickHome() {
    if (currentView === "home") {
      const now = new Date();
      const phase = getPhase(now, state.settings);
      $("countdown").textContent = formatCountdown(phase.until - now);
    }
  }

  /* ---------- render: log ---------- */
  function renderLog() {
    $("log-date").value = logDate;
    $("log-date-label").textContent = formatLongDate(logDate);
    const log = getLog(logDate);
    $("fast-yes").classList.toggle("active", log.fastRespected === true);
    $("fast-no").classList.toggle("active", log.fastRespected === false);
    $("log-weight").value = log.weight != null ? String(log.weight) : "";
    const goal = state.settings.waterGoalMl || 2000;
    const pct = Math.min(100, (log.waterMl / goal) * 100);
    $("water-bar").style.width = `${pct}%`;
    $("water-amount").textContent = `${formatNum(log.waterMl / 1000)} L  ·  ${Math.round(log.waterMl / GLASS_ML)} verre${Math.round(log.waterMl / GLASS_ML) > 1 ? "s" : ""}`;
    $("water-goal-label").textContent = `Objectif ${formatNum(goal / 1000)} L`;
    $("ecart-biere").textContent = log.ecarts.biere;
    $("ecart-grignotage").textContent = log.ecarts.grignotage;
    $("ecart-autre").textContent = log.ecarts.autre;
    $("ecart-note").value = log.ecarts.note || "";
    $("cig-count").textContent = log.cigarettes;
    $("autosave-msg").textContent = isLogEmpty(log) ? "Rien n’est encore noté pour ce jour" : "Enregistré sur ce téléphone";
  }

  /* ---------- render: progress ---------- */
  function renderProgress() {
    const streak = computeStreak();
    $("streak-value").textContent = String(streak);
    $("streak-unit").textContent = streak > 1 ? "jours d’affilée" : "jour d’affilée";
    $("streak-hint").textContent =
      streak === 0
        ? "Le prochain jeûne respecté lance ta série."
        : "Continue comme ça — chaque jour compte.";

    const weights = weightSeries();
    const goal = state.settings.weightGoal;
    const lastW = weights.length ? weights[weights.length - 1].weight : state.settings.weightCurrent;
    if (lastW != null && goal != null) {
      const diff = lastW - goal;
      const dir = diff > 0 ? `${formatNum(diff)} kg restants` : diff < 0 ? `Objectif dépassé de ${formatNum(-diff)} kg` : "Objectif atteint";
      $("weight-summary").textContent = `${formatNum(lastW)} kg  ·  but ${formatNum(goal)} kg  ·  ${dir}`;
    } else if (lastW != null) {
      $("weight-summary").textContent = `${formatNum(lastW)} kg  ·  ajoute un objectif dans les réglages`;
    } else {
      $("weight-summary").textContent = "Pas encore de poids saisi";
    }
    drawWeightChart($("weight-chart"), weights, goal);
    $("weight-empty").hidden = weights.length > 0;

    drawTrendsChart($("trends-chart"), lastNDays(7));
    renderHistory();
  }

  function weightSeries() {
    const rows = Object.keys(state.logs)
      .sort()
      .map((iso) => ({ iso, weight: state.logs[iso].weight }))
      .filter((r) => r.weight != null);
    return rows;
  }

  function lastNDays(n) {
    const today = toISODate(new Date());
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const iso = addDays(today, -i);
      out.push({ iso, log: getLog(iso) });
    }
    return out;
  }

  function drawWeightChart(canvas, series, goal) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 36, padR = 12, padT = 16, padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.fillStyle = "#1b2320";
    ctx.fillRect(0, 0, w, h);

    if (!series.length) return;

    const vals = series.map((s) => s.weight);
    if (goal != null) vals.push(goal);
    let min = Math.min(...vals) - 1;
    let max = Math.max(...vals) + 1;
    if (max <= min) max = min + 2;

    const xAt = (i) => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const yAt = (v) => padT + ((max - v) / (max - min)) * plotH;

    ctx.strokeStyle = "#2c3833";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#7d8a84";
    for (let g = 0; g < 4; g++) {
      const v = min + ((max - min) * g) / 3;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(formatNum(v), 4, y + 3);
    }

    if (goal != null) {
      const y = yAt(goal);
      ctx.strokeStyle = "#e8a04a";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    series.forEach((s, i) => {
      const x = xAt(i), y = yAt(s.weight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#6fbfb0";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    const lastX = xAt(series.length - 1);
    const lastY = yAt(series[series.length - 1].weight);
    ctx.lineTo(lastX, padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = "rgba(111, 191, 176, 0.15)";
    ctx.fill();

    series.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(s.weight), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#f3efe6";
      ctx.fill();
    });

    ctx.fillStyle = "#7d8a84";
    ctx.font = "10px sans-serif";
    if (series.length === 1) {
      ctx.fillText(formatShortDate(series[0].iso), xAt(0) - 20, h - 8);
    } else {
      ctx.fillText(formatShortDate(series[0].iso), padL, h - 8);
      const last = series[series.length - 1];
      const label = formatShortDate(last.iso);
      ctx.fillText(label, w - padR - ctx.measureText(label).width, h - 8);
    }
  }

  function drawTrendsChart(canvas, days) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = 230;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1b2320";
    ctx.fillRect(0, 0, w, h);

    const series = [
      { label: "Eau", color: "#6ba3c9", values: days.map((d) => d.log.waterMl / 1000), unit: "L", decimals: 1 },
      { label: "Cig.", color: "#c9846b", values: days.map((d) => d.log.cigarettes), unit: "", decimals: 0 },
      { label: "Écarts", color: "#d4a0c7", values: days.map((d) => ecartTotal(d.log)), unit: "", decimals: 0 },
    ];

    const padL = 52, padR = 12, padT = 8, padB = 24;
    const rowH = (h - padT - padB) / series.length;
    const plotW = w - padL - padR;
    const barGap = 6;
    const barW = Math.max(8, (plotW - barGap * (days.length - 1)) / days.length);

    series.forEach((s, row) => {
      const top = padT + row * rowH;
      const base = top + rowH - 16;
      const maxV = Math.max(1, ...s.values);
      ctx.fillStyle = "#7d8a84";
      ctx.font = "11px sans-serif";
      ctx.fillText(s.label, 6, top + rowH / 2);
      s.values.forEach((v, i) => {
        const x = padL + i * (barW + barGap);
        const bh = (v / maxV) * (rowH - 22);
        ctx.fillStyle = s.color;
        ctx.fillRect(x, base - bh, barW, Math.max(v > 0 ? 3 : 0, bh));
      });
    });

    ctx.fillStyle = "#7d8a84";
    ctx.font = "10px sans-serif";
    days.forEach((d, i) => {
      const x = padL + i * (barW + barGap);
      const label = parseISODate(d.iso).toLocaleDateString("fr-FR", { weekday: "narrow" });
      ctx.fillText(label, x + Math.max(0, barW / 2 - 3), h - 8);
    });
  }

  function renderHistory() {
    const keys = Object.keys(state.logs).sort().reverse().slice(0, 60);
    const root = $("history-list");
    if (!keys.length) {
      root.innerHTML = `<p class="muted">Aucun jour enregistré pour le moment.</p>`;
      return;
    }
    root.innerHTML = keys
      .map((iso) => {
        const log = getLog(iso);
        const badge =
          log.fastRespected === true
            ? `<span class="badge ok">Oui</span>`
            : log.fastRespected === false
              ? `<span class="badge bad">Non</span>`
              : `<span class="badge">—</span>`;
        const bits = [];
        if (log.weight != null) bits.push(`${formatNum(log.weight)} kg`);
        bits.push(`${formatNum(log.waterMl / 1000)} L`);
        bits.push(`${log.cigarettes} cig.`);
        if (ecartTotal(log)) bits.push(`${ecartTotal(log)} écart${ecartTotal(log) > 1 ? "s" : ""}`);
        return `<button type="button" class="history-item" data-open-day="${iso}">
          ${badge}
          <span><span class="day">${formatShortDate(iso)}</span><br><span class="meta">${bits.join(" · ")}</span></span>
          <span class="muted">›</span>
        </button>`;
      })
      .join("");
  }

  /* ---------- render: settings ---------- */
  function renderSettings() {
    const s = state.settings;
    $("set-weight-current").value = s.weightCurrent != null ? s.weightCurrent : "";
    $("set-weight-goal").value = s.weightGoal != null ? s.weightGoal : "";
    $("set-window-start").value = s.windowStart;
    $("set-window-end").value = s.windowEnd;
    $("set-notif-meal").value = s.notifMealStart;
    $("set-notif-soon").value = s.notifWindowSoon;
    $("set-notif-fast").value = s.notifFastStart;
    $("set-notif-bilan").value = s.notifBilan;
    $("set-water-from").value = s.waterRemindStart;
    $("set-water-to").value = s.waterRemindEnd;
    $("set-water-every").value = String(s.waterRemindEveryMin);
    $("set-water-goal").value = s.waterGoalMl;
    updateNotifStatus();
    $("clock-steps").innerHTML = clockSteps(s)
      .map((t) => `<li>${t}</li>`)
      .join("");
  }

  function readTimeInput(id, fallback) {
    const v = $(id).value;
    return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
  }

  function readNumber(id) {
    const v = $(id).value;
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function saveSettingsFromForm() {
    const s = state.settings;
    s.weightCurrent = readNumber("set-weight-current");
    s.weightGoal = readNumber("set-weight-goal");
    s.windowStart = readTimeInput("set-window-start", s.windowStart);
    s.windowEnd = readTimeInput("set-window-end", s.windowEnd);
    s.notifMealStart = readTimeInput("set-notif-meal", s.notifMealStart);
    s.notifWindowSoon = readTimeInput("set-notif-soon", s.notifWindowSoon);
    s.notifFastStart = readTimeInput("set-notif-fast", s.notifFastStart);
    s.notifBilan = readTimeInput("set-notif-bilan", s.notifBilan);
    s.waterRemindStart = readTimeInput("set-water-from", s.waterRemindStart);
    s.waterRemindEnd = readTimeInput("set-water-to", s.waterRemindEnd);
    s.waterRemindEveryMin = parseInt($("set-water-every").value, 10) || 120;
    const goal = readNumber("set-water-goal");
    if (goal && goal >= 250) s.waterGoalMl = Math.round(goal);
    saveState();
  }

  function formatNum(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return String(Math.round(n * 10) / 10).replace(".", ",");
  }

  /* ---------- notifications + calendar ---------- */
  function waterTimes(settings) {
    const start = minutesOf(settings.waterRemindStart);
    let end = minutesOf(settings.waterRemindEnd);
    const step = settings.waterRemindEveryMin || 120;
    if (end < start) end += 24 * 60;
    const times = [];
    for (let t = start; t <= end; t += step) {
      const m = ((t % (24 * 60)) + 24 * 60) % (24 * 60);
      times.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    }
    return times;
  }

  function mainNotifSpecs(settings) {
    return [
      {
        time: settings.notifMealStart,
        tag: "meal",
        title: "FitFast — créneau ouvert",
        body: `C’est l’heure : tu peux manger jusqu’à ${formatHM(settings.windowEnd)}. Bon appétit.`,
        url: "./#accueil",
      },
      {
        time: settings.notifWindowSoon,
        tag: "soon",
        title: "FitFast — le créneau se termine bientôt",
        body: `Plus que peu de temps : le créneau se termine à ${formatHM(settings.windowEnd)}. Fais de ce repas le plus copieux.`,
        url: "./#accueil",
      },
      {
        time: settings.notifFastStart,
        tag: "fast",
        title: "FitFast — le jeûne commence",
        body: `Plus rien à manger jusqu’à ${formatHM(settings.windowStart)}. Eau, café ou thé sans sucre uniquement.`,
        url: "./#accueil",
      },
      {
        time: settings.notifBilan,
        tag: "bilan",
        title: "FitFast — note ta journée",
        body: "Prends une minute pour indiquer ton jeûne, ton eau, tes écarts et tes cigarettes.",
        url: `./#journal/${logDateForNow()}`,
      },
    ];
  }

  function allNotifSpecs(settings) {
    const mains = mainNotifSpecs(settings);
    const taken = new Set(mains.map((n) => n.time));
    const waters = waterTimes(settings)
      .filter((t) => !taken.has(t))
      .map((time) => ({
        time,
        tag: `water-${time}`,
        title: "FitFast — bois un verre d’eau",
        body: "Un verre d’eau, et c’est noté dans le journal si tu veux.",
        url: "./#journal",
      }));
    return mains.concat(waters);
  }

  function clockSteps(settings) {
    const items = [
      `Ouvre l’appli <strong>Horloge</strong> puis l’onglet <strong>Alarme</strong>.`,
      `Ajoute une alarme à <strong>${formatHM(settings.notifMealStart)}</strong>, répéter tous les jours, nommée « FitFast — créneau repas ».`,
      `Ajoute une alarme à <strong>${formatHM(settings.notifWindowSoon)}</strong>, tous les jours, « FitFast — fin de créneau bientôt ».`,
      `Ajoute une alarme à <strong>${formatHM(settings.notifFastStart)}</strong>, tous les jours, « FitFast — début du jeûne ».`,
      `Ajoute une alarme à <strong>${formatHM(settings.notifBilan)}</strong>, tous les jours, « FitFast — noter ma journée ».`,
      `Pour l’eau, ajoute une alarme à chaque horaire : <strong>${waterTimes(settings).map(formatHM).join(", ")}</strong> (ou un rappel toutes les ${settings.waterRemindEveryMin / 60} h).`,
      `Laisse les alarmes sonner même en mode silencieux si tu ne veux pas les rater après le service.`,
    ];
    return items;
  }

  function icsEscape(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function icsStamp(d) {
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z"
    );
  }

  function buildICS(settings) {
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//FitFast//Jeune 17-7//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:FitFast rappels",
      "X-WR-TIMEZONE:Europe/Paris",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Paris",
      "X-LIC-LOCATION:Europe/Paris",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "TZNAME:CEST",
      "DTSTART:19700329T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "TZNAME:CET",
      "DTSTART:19701025T030000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    allNotifSpecs(settings).forEach((spec, i) => {
      const { h, m } = parseHM(spec.time);
      const uid = `fitfast-${spec.tag}-${i}@fitfast.app`;
      const stamp = icsStamp(now);
      const dt = `${startDay.getFullYear()}${pad(startDay.getMonth() + 1)}${pad(startDay.getDate())}T${pad(h)}${pad(m)}00`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Paris:${dt}`,
        `RRULE:FREQ=DAILY`,
        `SUMMARY:${icsEscape(spec.title)}`,
        `DESCRIPTION:${icsEscape(spec.body)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(spec.title)}`,
        "TRIGGER:-PT0M",
        "END:VALARM",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function downloadICS() {
    const ics = buildICS(state.settings);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fitfast-rappels.ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast("Fichier calendrier téléchargé");
  }

  async function ensureSW() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      return reg;
    } catch (err) {
      console.warn("SW register failed", err);
      return null;
    }
  }

  function updateNotifStatus() {
    const el = $("notif-status");
    if (!el) return;
    if (!("Notification" in window)) {
      el.textContent = "Ce navigateur ne gère pas les notifications web.";
      return;
    }
    const perm = Notification.permission;
    if (perm === "granted" && state.settings.notificationsEnabled) {
      el.textContent = "Notifications de l’appli activées. Elles partent si FitFast est ouvert. Pour l’appli fermée, utilise le calendrier ou l’horloge.";
    } else if (perm === "granted") {
      el.textContent = "Permission accordée. Appuie sur « Activer » pour lancer les rappels quand l’appli est ouverte.";
    } else if (perm === "denied") {
      el.textContent = "Notifications refusées. Tu peux les réactiver dans les paramètres de Chrome, ou utiliser Agenda / Horloge.";
    } else {
      el.textContent = "Pas encore activées.";
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      toast("Notifications web indisponibles sur ce navigateur");
      return;
    }
    const perm = await Notification.requestPermission();
    state.settings.notificationsEnabled = perm === "granted";
    saveState();
    updateNotifStatus();
    if (perm === "granted") {
      await showAppNotification({
        tag: "welcome",
        title: "FitFast est prêt",
        body: "Les rappels fonctionnent tant que l’appli est ouverte. Pense aussi à ajouter le calendrier.",
        url: "./#reglages",
      });
      toast("Notifications activées");
    } else {
      toast("Permission non accordée");
    }
  }

  async function showAppNotification(spec) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const payload = {
      type: "show-notification",
      title: spec.title,
      body: spec.body,
      tag: spec.tag || "fitfast",
      url: spec.url || "./",
    };
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) {
      reg.active.postMessage(payload);
      return;
    }
    try {
      await new Notification(spec.title, {
        body: spec.body,
        icon: "./icons/icon-192.png",
        tag: spec.tag || "fitfast",
      });
    } catch {
      /* ignore */
    }
  }

  function pruneFired(now) {
    const cutoff = now.getTime() - 2 * 86400000;
    Object.keys(state.notifFired).forEach((k) => {
      const ts = Date.parse(k.split("|")[0] || "");
      if (!Number.isFinite(ts) || ts < cutoff) delete state.notifFired[k];
    });
  }

  function tickNotifications(now = new Date()) {
    if (!state.settings.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dayKey = toISODate(now);
    let changed = false;
    allNotifSpecs(state.settings).forEach((spec) => {
      if (spec.time !== hm) return;
      const key = `${dayKey}|${spec.tag}`;
      if (state.notifFired[key]) return;
      state.notifFired[key] = true;
      changed = true;
      showAppNotification(spec);
    });
    if (changed) {
      pruneFired(now);
      saveState();
    }
  }

  /* ---------- export / import ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fitfast-sauvegarde-${toISODate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast("Sauvegarde téléchargée");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object") throw new Error("format");
        const settings = { ...DEFAULTS, ...(data.settings || {}) };
        const logs = data.logs && typeof data.logs === "object" ? data.logs : {};
        if (!confirm("Importer cette sauvegarde ? Les données actuelles de FitFast seront remplacées.")) return;
        state = {
          settings,
          logs,
          notifFired: {},
          installTipDismissed: !!data.installTipDismissed,
        };
        saveState();
        renderAll();
        toast("Sauvegarde importée");
      } catch {
        toast("Fichier illisible");
      }
    };
    reader.readAsText(file);
  }

  /* ---------- install banner ---------- */
  function setupInstall() {
    const banner = $("install-banner");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone || state.installTipDismissed) {
      banner.hidden = true;
      return;
    }
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      banner.hidden = false;
    });
    // Samsung / Chrome sometimes hide the event; show a manual tip after a delay if not installed.
    setTimeout(() => {
      if (!deferredPrompt && !state.installTipDismissed && !standalone) {
        banner.hidden = false;
        $("btn-install").textContent = "Voir comment";
      }
    }, 2500);
    $("btn-install").addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null;
        banner.hidden = true;
      } else {
        toast("Dans Chrome : menu ⋮ puis « Ajouter à l’écran d’accueil »");
      }
    });
    $("btn-install-dismiss").addEventListener("click", () => {
      state.installTipDismissed = true;
      saveState();
      banner.hidden = true;
    });
  }

  /* ---------- events ---------- */
  function bindEvents() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => showView(tab.dataset.nav));
    });

    $("btn-goto-log").addEventListener("click", () => {
      logDate = logDateForNow();
      showView("log", { date: logDate });
    });
    $("btn-quick-water").addEventListener("click", () => {
      const today = toISODate(new Date());
      const log = getLog(today);
      log.waterMl = Math.min(8000, log.waterMl + GLASS_ML);
      putLog(today, log);
      renderHome();
      toast("Un verre d’eau ajouté");
    });
    $("btn-tips").addEventListener("click", () => toggleAccordion("btn-tips", "tips-body"));
    $("btn-clock-help").addEventListener("click", () => toggleAccordion("btn-clock-help", "clock-help"));

    $("btn-day-prev").addEventListener("click", () => {
      logDate = addDays(logDate, -1);
      showView("log", { date: logDate });
    });
    $("btn-day-next").addEventListener("click", () => {
      logDate = addDays(logDate, 1);
      showView("log", { date: logDate });
    });
    $("btn-day-today").addEventListener("click", () => {
      logDate = logDateForNow();
      showView("log", { date: logDate });
    });
    $("log-date").addEventListener("change", () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test($("log-date").value)) {
        logDate = $("log-date").value;
        showView("log", { date: logDate });
      }
    });

    $("fast-yes").addEventListener("click", () =>
      updateLog((log) => {
        log.fastRespected = log.fastRespected === true ? null : true;
      })
    );
    $("fast-no").addEventListener("click", () =>
      updateLog((log) => {
        log.fastRespected = log.fastRespected === false ? null : false;
      })
    );
    $("log-weight").addEventListener("change", () => {
      updateLog((log) => {
        const n = parseFloat(String($("log-weight").value).replace(",", "."));
        log.weight = Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
      });
    });
    $("btn-water-minus").addEventListener("click", () =>
      updateLog((log) => {
        log.waterMl = Math.max(0, log.waterMl - GLASS_ML);
      })
    );
    $("btn-water-plus").addEventListener("click", () =>
      updateLog((log) => {
        log.waterMl = Math.min(8000, log.waterMl + GLASS_ML);
      })
    );
    $("btn-water-plus2").addEventListener("click", () =>
      updateLog((log) => {
        log.waterMl = Math.min(8000, log.waterMl + 500);
      })
    );

    document.querySelectorAll("[data-ecart]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.ecart;
        const delta = parseInt(btn.dataset.delta, 10);
        updateLog((log) => {
          log.ecarts[key] = Math.max(0, Math.min(20, (log.ecarts[key] || 0) + delta));
        });
      });
    });
    $("ecart-note").addEventListener("change", () =>
      updateLog((log) => {
        log.ecarts.note = $("ecart-note").value.trim();
      })
    );
    $("btn-cig-minus").addEventListener("click", () =>
      updateLog((log) => {
        log.cigarettes = Math.max(0, log.cigarettes - 1);
      })
    );
    $("btn-cig-plus").addEventListener("click", () =>
      updateLog((log) => {
        log.cigarettes = Math.min(99, log.cigarettes + 1);
      })
    );

    $("history-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-open-day]");
      if (!btn) return;
      showView("log", { date: btn.dataset.openDay });
    });

    [
      "set-weight-current",
      "set-weight-goal",
      "set-window-start",
      "set-window-end",
      "set-notif-meal",
      "set-notif-soon",
      "set-notif-fast",
      "set-notif-bilan",
      "set-water-from",
      "set-water-to",
      "set-water-every",
      "set-water-goal",
    ].forEach((id) => {
      $(id).addEventListener("change", () => {
        saveSettingsFromForm();
        renderSettings();
        renderHome();
        toast("Réglages enregistrés");
      });
    });

    $("btn-enable-notifs").addEventListener("click", () => enableNotifications());
    $("btn-test-notif").addEventListener("click", async () => {
      if (Notification.permission !== "granted") {
        await enableNotifications();
        if (Notification.permission !== "granted") return;
      }
      await showAppNotification({
        tag: "test",
        title: "FitFast — test",
        body: "Si tu vois ceci, les notifications marchent quand l’appli est ouverte.",
        url: "./#reglages",
      });
      toast("Notification de test envoyée");
    });
    $("btn-download-ics").addEventListener("click", downloadICS);
    $("btn-export").addEventListener("click", exportData);
    $("btn-import").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importData(file);
      e.target.value = "";
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("Effacer toutes les données de FitFast sur ce téléphone ? Cette action est définitive.")) return;
      state = defaultState();
      saveState();
      logDate = logDateForNow();
      renderAll();
      toast("Données effacées");
    });

    window.addEventListener("hashchange", () => {
      const parsed = parseHash();
      showView(parsed.view, { date: parsed.date, silent: true });
    });

    navigator.serviceWorker?.addEventListener("message", (event) => {
      if (event.data && event.data.type === "open" && event.data.url) {
        const url = event.data.url;
        const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
        if (hash) location.hash = hash;
      }
    });
  }

  function toggleAccordion(btnId, bodyId) {
    const btn = $(btnId);
    const body = $(bodyId);
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    body.hidden = open;
  }

  function renderAll() {
    renderHome();
    renderLog();
    if (currentView === "progress") renderProgress();
    if (currentView === "settings") renderSettings();
  }

  /* ---------- init ---------- */
  async function init() {
    const parsed = parseHash();
    if (parsed.date) logDate = parsed.date;
    bindEvents();
    setupInstall();
    showView(parsed.view, { date: parsed.date, silent: true });
    renderHome();
    setInterval(tickHome, 1000);
    setInterval(() => tickNotifications(new Date()), 15000);
    tickNotifications(new Date());
    await ensureSW();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
