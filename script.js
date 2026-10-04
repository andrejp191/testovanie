"use strict";

const $ = (id) => document.getElementById(id);
const STATS_KEY = "quizStats.v1";

// ======================================================================
// Lokálne štatistiky (localStorage)
// Tvar: { [téma]: { [číslo otázky]: { streak, last: "ISO dátum", lastCorrect } } }
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
  };
  saveStats(stats);
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
function parseAnswersTxt(text) {
  const out = new Map();
  text.split(/\r?\n/).forEach((line) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const m = l.match(/^(\d+)\.\s*([a-zA-Z,\s-]*?)\s+(\d+)\s*$/);
    if (!m) return;
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
    out.set(id, { id, correct, total });
  });
  return out;
}

async function loadTheme(name) {
  const res = await fetch(`Themes/${encodeURIComponent(name)}/answers.txt`, { cache: "no-store" });
  if (!res.ok) throw new Error("Chýba answers.txt pre tému " + name);
  const map = parseAnswersTxt(await res.text());
  return [...map.values()].sort((a, b) => a.id - b.id);
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
let activeTheme = null;    // {name, questions}
let currentQ = null;       // {id, correct, total}
let answered = false;

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

function refreshHomeStats() {
  document.querySelectorAll(".theme-card").forEach((card) => {
    const name = card.dataset.theme;
    const theme = themes.find((t) => t.name === name);
    if (!theme) return;
    const done = masteredCount(theme);
    const total = theme.questions.length;
    card.querySelector(".frac").textContent = done + " / " + total + " naposledy správne";
    card.querySelector(".bar-fill").style.width = (total ? (done / total) * 100 : 0) + "%";
  });
}

function renderHome() {
  const grid = $("theme-grid");
  grid.replaceChildren();
  themes.forEach((theme) => {
    const total = theme.questions.length;
    const done = masteredCount(theme);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "theme-card";
    card.dataset.theme = theme.name;
    card.innerHTML =
      '<h2></h2><p class="frac"></p><div class="bar"><div class="bar-fill"></div></div>';
    card.querySelector("h2").textContent = theme.name;
    card.querySelector(".frac").textContent = done + " / " + total + " naposledy správne";
    card.querySelector(".bar-fill").style.width = (total ? (done / total) * 100 : 0) + "%";
    card.addEventListener("click", () => openTheme(theme.name));
    grid.appendChild(card);
  });
  $("home-status").hidden = true;
  grid.hidden = false;
}

async function openTheme(name) {
  const theme = themes.find((t) => t.name === name);
  activeTheme = theme;
  $("masthead-sub").textContent = "/ " + name;
  $("quiz-theme-name").textContent = name;
  showQuiz();
  if (!theme.questions.length) {
    $("card").hidden = true;
    $("quiz-empty").hidden = false;
    return;
  }
  $("card").hidden = false;
  $("quiz-empty").hidden = true;
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
  const ids = activeTheme.questions.map((q) => q.id);
  const prevId = currentQ ? currentQ.id : null;
  const id = pickNextQuestionId(ids, activeTheme.name, stats, prevId);
  currentQ = activeTheme.questions.find((q) => q.id === id);

  $("quiz-progress").textContent = "Otázka č. " + id;

  const content = await loadQuestionContent(activeTheme.name, id);
  $("frame").classList.remove("loading");
  if (content.type === "image") {
    $("q-img").src = content.src;
    $("q-img").hidden = false;
  } else if (content.type === "text") {
    $("q-text").textContent = content.text;
    $("q-text").hidden = false;
  } else {
    $("q-missing").hidden = false;
  }

  renderOptions(currentQ.total);
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

  $("send-btn").hidden = true;
  $("next-btn").hidden = false;
  $("next-btn").focus();
}

// ---------- udalosti ----------
$("send-btn").addEventListener("click", evaluate);
$("next-btn").addEventListener("click", nextQuestion);
$("back-btn").addEventListener("click", showHome);
$("home-link").addEventListener("click", (e) => { e.preventDefault(); showHome(); });

// ======================================================================
// Štart
// ======================================================================
async function init() {
  try {
    const names = await loadThemeList();
    const loaded = await Promise.all(names.map(async (name) => {
      try { return { name, questions: await loadTheme(name) }; }
      catch { return { name, questions: [], error: true }; }
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
