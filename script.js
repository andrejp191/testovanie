"use strict";

const $ = (id) => document.getElementById(id);
const STATS_KEY = "quizStats.v1";

// ======================================================================
// Lokálne štatistiky (localStorage)
// Tvar: { [téma]: { [číslo otázky]: { streak, last: "ISO dátum", lastCorrect,
//                                      timesAnswered, timesCorrect } } }
// ======================================================================
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }
  catch { return {}; }
}
function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* plné úložisko – ignoruj */ }
}
function getStat(stats, theme, qid) {
  return (stats[theme] && stats[theme][qid]) || null;
}
function setStat(stats, theme, qid, correct) {
  stats[theme] = stats[theme] || {};
  const prev = stats[theme][qid];
  stats[theme][qid] = {
    streak: correct ? ((prev && prev.streak) || 0) + 1 : 0,
    last: new Date().toISOString(),
    lastCorrect: correct,
    timesAnswered: ((prev && prev.timesAnswered) || 0) + 1,
    timesCorrect: ((prev && prev.timesCorrect) || 0) + (correct ? 1 : 0),
  };
  saveStats(stats);
}

// Súhrn za celú tému: koľko otázok bolo položených a koľko z toho správne
// (súčet cez všetky otázky, počíta každý pokus, nielen posledný).
function themeTotals(theme) {
  const stats = loadStats();
  const byId = (stats[theme.name]) || {};
  let asked = 0, correct = 0;
  Object.keys(byId).forEach((qid) => {
    asked += byId[qid].timesAnswered || 0;
    correct += byId[qid].timesCorrect || 0;
  });
  return { asked, correct };
}

// ======================================================================
// STRATÉGIA VÝBERU OTÁZOK — dá sa neskôr jednoducho zmeniť/vymeniť.
//
// Otázka je "na rade" (eligible), keď:
//   - ešte nebola zodpovedaná, alebo posledná odpoveď bola nesprávna, alebo
//   - séria správnych odpovedí za sebou je N (>=1) a od poslednej odpovede
//     uplynulo viac než (N + 1) týždňov.
// Z otázok "na rade" sa uprednostnia tie s najnižšou sériou (najmenej
// zvládnuté); medzi rovnako prioritnými sa vyberá náhodne. Ak nie je na
// rade žiadna otázka, vyberie sa najdlhšie nezodpovedaná zo všetkých.
// ======================================================================
function weeksSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 7);
}

function isEligible(stat) {
  if (!stat || stat.lastCorrect === false || !stat.streak) return true;
  return weeksSince(stat.last) > stat.streak + 1;
}

function pickNextQuestionId(questionIds, theme, stats, excludeId) {
  const pool = questionIds.filter((id) => id !== excludeId);
  const withStat = pool.map((id) => ({ id, stat: getStat(stats, theme, id) }));
  const eligible = withStat.filter((x) => isEligible(x.stat));

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  if (eligible.length) {
    const minStreak = Math.min(...eligible.map((x) => (x.stat ? x.stat.streak : 0)));
    const top = eligible.filter((x) => (x.stat ? x.stat.streak : 0) === minStreak);
    return pickRandom(top).id;
  }
  // nič nie je "na rade" (všetko zvládnuté a nie je to ešte potrebné zopakovať) –
  // vyber najdlhšie nezodpovedanú otázku, aby sa dalo pokračovať
  const withDate = withStat.filter((x) => x.stat);
  if (withDate.length) {
    withDate.sort((a, b) => new Date(a.stat.last) - new Date(b.stat.last));
    return withDate[0].id;
  }
  return pickRandom(pool).id;
}

// ======================================================================
// Načítanie zoznamu tém a obsahu answers.txt
// ======================================================================
async function loadThemeList() {
  const res = await fetch("themes.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Chýba themes.json");
  const names = await res.json();
  if (!Array.isArray(names)) throw new Error("themes.json musí byť zoznam názvov");
  return names;
}

// Riadok: "1. a,c,b 6"  ->  {id:1, correct:Set{0,2,1}, total:6}
// "-" alebo prázdny zoznam písmen = žiadna možnosť nie je správna.
// Vráti aj zoznam problémov (zle rozpoznané riadky, duplicitné čísla),
// aby sa dalo ľahko zistiť, prečo je otázok menej, než má byť.
function parseAnswersTxt(text) {
  const out = new Map();
  const warnings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const m = l.match(/^(\d+)\.\s*([a-zA-Z,\s-]*?)\s+(\d+)\s*$/);
    if (!m) {
      warnings.push('Riadok ' + (i + 1) + ' sa nepodarilo rozpoznať: "' + l + '" ' +
        '(očakávaný tvar: "číslo. písmená celkový_počet", napr. "6. a,b 4").');
      return;
    }
    const id = Number(m[1]);
    const total = Number(m[3]);
    const letters = m[2].trim();
    const correct = new Set();
    if (letters && letters !== "-") {
      letters.split(",").forEach((tok) => {
        const t = tok.trim().toLowerCase();
        if (t) correct.add(t.charCodeAt(0) - 97);
      });
    }
    if (out.has(id)) {
      warnings.push("Číslo otázky " + id + " je v answers.txt viackrát — použil sa posledný výskyt, " +
        "predchádzajúci riadok bol zahodený.");
    }
    out.set(id, { id, correct, total });
  });
  return { map: out, warnings };
}

async function loadTheme(name) {
  const res = await fetch(`Themes/${encodeURIComponent(name)}/answers.txt`, { cache: "no-store" });
  if (!res.ok) throw new Error("Chýba answers.txt pre tému " + name);
  const { map, warnings } = parseAnswersTxt(await res.text());
  const questions = [...map.values()].sort((a, b) => a.id - b.id);

  // chýbajúce čísla v rade 1..najvyššie číslo – typický príznak vynechaného
  // alebo zle naformátovaného riadku
  if (questions.length) {
    const max = questions[questions.length - 1].id;
    const have = new Set(questions.map((q) => q.id));
    const missing = [];
    for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
    if (missing.length) {
      warnings.push("V rozsahu 1–" + max + " chýba v answers.txt číslo: " + missing.join(", ") + ".");
    }
  }

  if (warnings.length) {
    console.warn('Téma "' + name + '" — problémy v answers.txt:\n- ' + warnings.join("\n- "));
  }
  return { questions, warnings };
}

function loadQuestionContent(theme, id) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ type: "image", src: img.src });
    img.onerror = async () => {
      try {
        const res = await fetch(`Themes/${encodeURIComponent(theme)}/${id}.txt`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        resolve({ type: "text", text: await res.text() });
      } catch {
        resolve({ type: "missing" });
      }
    };
    img.src = `Themes/${encodeURIComponent(theme)}/${id}.png`;
  });
}

// ======================================================================
// Stav aplikácie a obrazovky
// ======================================================================
let themes = [];           // [{name, questions, total, mastered}]
let activeTheme = null;    // {name, questions} – celá téma (pre domovskú štatistiku)
let activeQuestions = [];  // aktuálne testovaná podmnožina (všetky, alebo zvolený rozsah)
let currentQ = null;       // {id, correct, total}
let answered = false;
let sessionAnswered = 0;   // počet zodpovedaných otázok v tejto session (od otvorenia témy)
let sessionCorrect = 0;    // z toho správne

function renderProgress() {
  const q = currentQ ? "Otázka č. " + currentQ.id : "";
  const s = "Séria: " + sessionCorrect + "/" + sessionAnswered + " správne";
  $("quiz-progress").textContent = q ? q + " — " + s : s;
}

function letter(i) { return String.fromCharCode(97 + i); }

function showHome() {
  $("view-quiz").hidden = true;
  $("view-home").hidden = false;
  $("masthead-sub").textContent = "";
  refreshHomeStats();
}

function showQuiz() {
  $("view-home").hidden = true;
  $("view-quiz").hidden = false;
}

// ---------- domovská stránka ----------
function masteredCount(theme) {
  const stats = loadStats();
  return theme.questions.filter((q) => {
    const s = getStat(stats, theme.name, q.id);
    return s && s.lastCorrect;
  }).length;
}

// ---------- smajlík podľa percenta zvládnutia ----------
// Farba sa plynulo stupňuje od čiernej (0 %) po zelenú (100 %),
// tvar úst/očí sa mení podľa pásma: do 50 % smutný, 50–90 % neutrálny,
// 91–95 % usmiaty, nad 95 % smejúci sa.
function moodColor(pct) {
  const t = Math.max(0, Math.min(1, pct / 100));
  const lo = [17, 17, 17];     // takmer čierna
  const hi = [43, 110, 78];    // --primary (zelená)
  const c = lo.map((v, i) => Math.round(v + (hi[i] - v) * t));
  return "rgb(" + c.join(",") + ")";
}

// Pásma nálady podľa percenta:
//  0–30 %  plačúci · 31–60 % smutný · 61–90 % neutrálny
//  91–95 % usmiaty · 96–100 % smejúci sa
function moodSvg(pct) {
  const color = moodColor(pct);
  let eyes = '<circle cx="9" cy="10.5" r="1.6" fill="#fff"/><circle cx="19" cy="10.5" r="1.6" fill="#fff"/>';
  let mouth;
  let extra = "";
  if (pct <= 30) {
    mouth = '<path d="M8.5 20.5 Q14 16 19.5 20.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
    extra = '<path d="M8 13 Q7.3 16.5 8.3 18.5 Q9.3 16.5 8 13 Z" fill="#7ec8f2"/>' +
            '<path d="M20 13 Q20.7 16.5 19.7 18.5 Q18.7 16.5 20 13 Z" fill="#7ec8f2"/>';
  } else if (pct <= 60) {
    mouth = '<path d="M8.5 20 Q14 16.5 19.5 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
  } else if (pct <= 90) {
    mouth = '<line x1="9" y1="18" x2="19" y2="18" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
  } else if (pct <= 95) {
    mouth = '<path d="M8 16 Q14 21 20 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
  } else {
    eyes = '<path d="M7 9.5 Q9 7.5 11 9.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
           '<path d="M17 9.5 Q19 7.5 21 9.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';
    mouth = '<path d="M7.5 15 Q14 23.5 20.5 15 Q14 18.5 7.5 15 Z" fill="#fff"/>';
  }
  return '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">' +
    '<circle cx="14" cy="14" r="13" fill="' + color + '"/>' + eyes + mouth + extra + '</svg>';
}

function updateThemeCard(card, theme) {
  const done = masteredCount(theme);
  const total = theme.questions.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  card.querySelector(".frac").textContent = done + " / " + total + " naposledy správne";
  card.querySelector(".bar-fill").style.width = (total ? (done / total) * 100 : 0) + "%";
  card.querySelector(".mood-icon").innerHTML = moodSvg(pct);
  card.querySelector(".mood-pct").textContent = pct + " %";

  const t = themeTotals(theme);
  card.querySelector(".theme-asked").textContent =
    t.asked ? "Položených " + t.asked + ", správne " + t.correct + "×" : "Zatiaľ netestované";
}

function refreshHomeStats() {
  document.querySelectorAll(".theme-card").forEach((card) => {
    const name = card.dataset.theme;
    const theme = themes.find((t) => t.name === name);
    if (!theme) return;
    updateThemeCard(card, theme);
  });
}

function renderHome() {
  const grid = $("theme-grid");
  grid.replaceChildren();
  themes.forEach((theme) => {
    const card = document.createElement("div");
    card.className = "theme-card";
    card.dataset.theme = theme.name;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "theme-open";
    open.innerHTML =
      '<div class="theme-head"><h2></h2><div class="mood"><span class="mood-icon"></span>' +
      '<span class="mood-pct"></span></div></div>' +
      '<p class="frac"></p><div class="bar"><div class="bar-fill"></div></div>' +
      '<p class="theme-asked muted"></p>';
    open.querySelector("h2").textContent = theme.name;
    open.addEventListener("click", () => openTheme(theme.name));
    card.appendChild(open);
    updateThemeCard(card, theme);

    if (theme.warnings && theme.warnings.length) {
      const det = document.createElement("details");
      det.className = "theme-warn";
      const sum = document.createElement("summary");
      sum.textContent = "⚠ " + theme.warnings.length +
        (theme.warnings.length === 1 ? " problém v answers.txt" : " problémy v answers.txt");
      det.appendChild(sum);
      const ul = document.createElement("ul");
      theme.warnings.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        ul.appendChild(li);
      });
      det.appendChild(ul);
      card.appendChild(det);
    }
    grid.appendChild(card);
  });
  $("home-status").hidden = true;
  grid.hidden = false;
}

async function openTheme(name) {
  const theme = themes.find((t) => t.name === name);
  activeTheme = theme;
  activeQuestions = theme.questions;
  sessionAnswered = 0;
  sessionCorrect = 0;
  $("masthead-sub").textContent = "/ " + name;
  $("quiz-theme-name").textContent = name;
  showQuiz();

  if (!theme.questions.length) {
    $("range-panel").hidden = true;
    $("card").hidden = true;
    $("quiz-empty").hidden = false;
    return;
  }

  initRangePanel(theme);
  $("card").hidden = false;
  $("quiz-empty").hidden = true;
  await nextQuestion();
}

// ---------- výber rozsahu otázok ----------
function themeIdBounds(theme) {
  const ids = theme.questions.map((q) => q.id);
  return { min: Math.min(...ids), max: Math.max(...ids) };
}

function initRangePanel(theme) {
  const { min, max } = themeIdBounds(theme);
  $("range-panel").hidden = false;
  $("range-from").min = min;
  $("range-from").max = max;
  $("range-from").value = min;
  $("range-to").min = min;
  $("range-to").max = max;
  $("range-to").value = max;
  setRangeStatus("Testujú sa všetky otázky (" + theme.questions.length + ").", false);
}

function setRangeStatus(text, warn) {
  const el = $("range-status");
  el.textContent = text;
  el.style.color = warn ? "var(--bad)" : "";
}

async function applyRange() {
  const from = Number($("range-from").value);
  const to = Number($("range-to").value);
  if (!from || !to || from > to) {
    setRangeStatus("Neplatný rozsah — „Od“ musí byť menšie alebo rovné „Do“.", true);
    return;
  }
  const filtered = activeTheme.questions.filter((q) => q.id >= from && q.id <= to);
  if (!filtered.length) {
    setRangeStatus("V rozsahu " + from + "–" + to + " nie sú žiadne otázky.", true);
    return;
  }
  activeQuestions = filtered;
  setRangeStatus("Testuje sa rozsah " + from + "–" + to + " (" + filtered.length + " otázok).", false);
  currentQ = null;
  await nextQuestion();
}

async function clearRange() {
  const { min, max } = themeIdBounds(activeTheme);
  $("range-from").value = min;
  $("range-to").value = max;
  activeQuestions = activeTheme.questions;
  setRangeStatus("Testujú sa všetky otázky (" + activeQuestions.length + ").", false);
  currentQ = null;
  await nextQuestion();
}

// ---------- kvíz ----------
async function nextQuestion() {
  answered = false;
  $("feedback").hidden = true;
  $("send-btn").hidden = false;
  $("send-btn").disabled = false;
  $("next-btn").hidden = true;
  $("options").className = "options";
  $("options").replaceChildren();
  $("q-img").hidden = true;
  $("q-text").hidden = true;
  $("q-missing").hidden = true;
  $("frame").classList.add("loading");

  const stats = loadStats();
  const ids = activeQuestions.map((q) => q.id);
  const prevId = currentQ ? currentQ.id : null;
  const id = pickNextQuestionId(ids, activeTheme.name, stats, prevId);
  currentQ = activeQuestions.find((q) => q.id === id);

  renderProgress();

  const content = await loadQuestionContent(activeTheme.name, id);
  $("frame").classList.remove("loading");
  if (content.type === "image") {
    $("q-img").src = content.src;
    $("q-img").hidden = false;
  } else if (content.type === "text") {
    const text = content.text.replace(/^\s+/, "");
    const hasNumber = new RegExp("^" + id + "\\s*[.):]").test(text);
    $("q-text").textContent = hasNumber ? text : id + ". " + text;
    $("q-text").hidden = false;
  } else {
    $("q-missing").hidden = false;
  }

  renderOptions(currentQ.total);
  renderQuestionStat(getStat(stats, activeTheme.name, id));
}

// Štatistika tejto konkrétnej otázky (koľkokrát bola doteraz testovaná
// a koľkokrát správne).
function renderQuestionStat(stat) {
  const el = $("q-stat");
  const n = (stat && stat.timesAnswered) || 0;
  if (!n) {
    el.textContent = "Táto otázka zatiaľ nebola testovaná.";
  } else {
    const c = (stat && stat.timesCorrect) || 0;
    el.textContent = "Táto otázka: testovaná " + n + "×, správne " + c + "×.";
  }
}

function renderOptions(total) {
  const list = $("options");
  list.replaceChildren();
  for (let i = 0; i < total; i++) {
    const li = document.createElement("li");
    li.className = "opt";
    li.innerHTML = '<input type="checkbox"><span class="letter"></span>';
    const cb = li.querySelector("input");
    cb.id = "opt-" + i;
    li.querySelector(".letter").textContent = letter(i).toUpperCase();
    li.addEventListener("click", (e) => {
      if (answered) return;
      if (e.target !== cb) cb.checked = !cb.checked;
    });
    list.appendChild(li);
  }
}

function evaluate() {
  if (answered || !currentQ) return;
  answered = true;

  const items = [...$("options").children];
  const selected = new Set();
  items.forEach((li, i) => { if (li.querySelector("input").checked) selected.add(i); });

  const correct = currentQ.correct;
  const same = selected.size === correct.size && [...selected].every((i) => correct.has(i));

  items.forEach((li, i) => {
    li.querySelector("input").disabled = true;
    const isCorrectOpt = correct.has(i);
    const isPicked = selected.has(i);
    if (isCorrectOpt) li.classList.add("right");
    else if (isPicked) li.classList.add("wrong");
  });
  $("options").classList.add("answered");

  const fb = $("feedback");
  fb.hidden = false;
  fb.className = "feedback " + (same ? "ok" : "bad");
  if (correct.size === 0) {
    fb.textContent = same ? "Správne — žiadna možnosť nie je správna." : "Nesprávne — žiadna možnosť nie je správna.";
  } else {
    const list = [...correct].sort((a, b) => a - b).map((i) => letter(i).toUpperCase()).join(", ");
    fb.textContent = (same ? "Správne. " : "Nesprávne. ") + "Správne možnosti: " + list + ".";
  }

  const stats = loadStats();
  setStat(stats, activeTheme.name, currentQ.id, same);
  renderQuestionStat(getStat(stats, activeTheme.name, currentQ.id));

  sessionAnswered++;
  if (same) sessionCorrect++;
  renderProgress();

  $("send-btn").hidden = true;
  $("next-btn").hidden = false;
  $("next-btn").focus();
}

// ---------- udalosti ----------
$("send-btn").addEventListener("click", evaluate);
$("next-btn").addEventListener("click", nextQuestion);
$("back-btn").addEventListener("click", showHome);
$("range-apply").addEventListener("click", applyRange);
$("range-clear").addEventListener("click", clearRange);
$("home-link").addEventListener("click", (e) => { e.preventDefault(); showHome(); });

// ======================================================================
// Štart
// ======================================================================
async function init() {
  try {
    const names = await loadThemeList();
    const loaded = await Promise.all(names.map(async (name) => {
      try {
        const { questions, warnings } = await loadTheme(name);
        return { name, questions, warnings };
      } catch (e) {
        return { name, questions: [], warnings: [], error: true, errorMessage: e.message };
      }
    }));
    themes = loaded;
    if (!themes.length) {
      $("home-status").textContent = "V themes.json nie je žiadna téma.";
      return;
    }
    renderHome();
  } catch (e) {
    $("home-status").textContent = "Nepodarilo sa načítať zoznam tém (" + e.message + ").";
  }
}

init();
