import { icons } from './icons.js';
import {
  EXERCISES, WORKOUTS, MUSCLES, loadState, persist, startWorkout, tapSet,
  finishWorkout, discardWorkout, totalTonnage, workoutsThisWeek, exerciseSeries,
  detectMuscles, addFreeEntry, deleteFreeEntry, muscleLastTrained,
  setsPerMuscle, weeklyVolume, tonnageSince, weekStreak, suggestStarts, roundStep,
} from './store.js';
import { getToken, setToken, fetchRemote, pushRemote } from './github.js';

const state = loadState();
let tab = 'home';
let progressEx = 'fullbody';
let rest = null;        // { since, hard }
let tickHandle = null;
let restTickHandle = null;
let pendingStarts = null;
let syncState = { status: getToken() ? 'idle' : 'off', msg: '' };

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const modalRoot = document.getElementById('modal-root');

// ---------- Helpers ----------

const fmtKg = (w) => (Number.isInteger(w) ? String(w) : w.toFixed(1).replace('.0', ''));
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- Sync ----------

async function sync(direction = 'auto') {
  if (!getToken()) { syncState = { status: 'off', msg: '' }; renderIf('settings'); return; }
  syncState = { status: 'busy', msg: 'Syncing…' }; renderIf('settings');
  try {
    const remote = await fetchRemote();
    if (remote && direction !== 'push' && (remote.updatedAt || 0) > state.updatedAt) {
      Object.assign(state, remote);
      persist(state, false);
    } else if (!remote || (remote.updatedAt || 0) < state.updatedAt) {
      await pushRemote(state);
    }
    syncState = { status: 'ok', msg: `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
  } catch (err) {
    syncState = { status: 'err', msg: err.message.includes('401') || err.message.includes('403') ? 'Token invalid or expired' : 'Sync failed — offline?' };
  }
  render();
}

// ---------- Rendering ----------

function render() {
  if (state.active) { renderWorkout(); tabbar.classList.add('hidden'); }
  else {
    tabbar.classList.remove('hidden');
    ({ home: renderHome, log: renderLog, history: renderHistory, progress: renderProgress, settings: renderSettings })[tab]();
  }
  renderTabs();
  renderRest();
}
function renderIf(name) { if (tab === name && !state.active) render(); }

function renderTabs() {
  const meta = { home: ['Train', icons.barbell], log: ['Log', icons.clipboard], history: ['History', icons.history], progress: ['Progress', icons.trendingUp], settings: ['Settings', icons.settings] };
  tabbar.querySelectorAll('.tab').forEach((btn) => {
    const t = btn.dataset.tab;
    btn.innerHTML = `${meta[t][1]}<span>${meta[t][0]}</span>`;
    btn.classList.toggle('active', t === tab);
  });
}

tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  tab = btn.dataset.tab;
  render();
});

// ---------- Home ----------

function weekStrip() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const trained = new Set([...state.history, ...state.freeLog].map((h) => new Date(h.date).toDateString()));
  let out = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const isToday = d.toDateString() === now.toDateString();
    const done = trained.has(d.toDateString());
    out += `<div class="day ${done ? 'done' : ''} ${isToday ? 'today' : ''}">
      <div class="dot">${done ? icons.check : ''}</div>${labels[i]}
    </div>`;
  }
  return `<div class="week">${out}</div>`;
}

function renderHome() {
  stopTick();
  const type = state.next;
  const rows = WORKOUTS[type].map((id) => {
    const ex = EXERCISES[id], p = state.prog[id];
    return `<div class="plan-row">
      <div><span class="name">${ex.name}</span><span class="scheme">${ex.sets}×${ex.reps}</span></div>
      <div class="kg num">${fmtKg(p.weight)} <small>kg</small></div>
    </div>`;
  }).join('');

  const tonnage = totalTonnage(state);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const onboard = !state.onboardDismissed && state.history.length === 0 ? `
    <div class="notice">${icons.info}
      <div>Weights start deliberately light so you can groove technique — they climb every workout. Adjust starting weights in <b>Settings</b> if needed.</div>
      <button class="dismiss" data-action="dismiss-onboard">${icons.x}</button>
    </div>` : '';

  view.innerHTML = `
    <div class="eyebrow">${today}</div>
    <h1>Time to train</h1>
    <div class="sub">${state.history.length ? `Last session ${fmtDate(state.history[state.history.length - 1].date)}` : 'Your first workout — let’s go.'}</div>
    ${weekStrip()}
    ${onboard}
    <div class="card hero-card">
      <div class="hero-top">
        <div class="monogram ${type.toLowerCase()}">${type}</div>
        <div>
          <div class="t">Workout ${type}</div>
          <div class="s">${WORKOUTS[type].length} exercises · ~45 min</div>
        </div>
      </div>
      <div class="plan">${rows}</div>
      <button class="btn btn-primary" data-action="start">Start workout ${icons.arrowRight}</button>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="v num">${weekStreak(state)}<small> wk</small></div><div class="l">Goal streak</div></div>
      <div class="stat"><div class="v num">${new Set([...state.history, ...state.freeLog].filter((x) => x.date >= mondayTs()).map((x) => new Date(x.date).toDateString())).size}<small>/${state.goal || 3}</small></div><div class="l">This week</div></div>
      <div class="stat"><div class="v num">${tonnage >= 1000 ? (tonnage / 1000).toFixed(1) : tonnage}<small> ${tonnage >= 1000 ? 't' : 'kg'}</small></div><div class="l">Total lifted</div></div>
    </div>`;
}

function mondayTs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
}

// ---------- Workout ----------

function renderWorkout() {
  const { type, sets, startedAt } = state.active;
  const allSets = Object.values(sets).flat();
  const doneSets = allSets.filter((v) => v !== null).length;
  const cards = WORKOUTS[type].map((id) => {
    const ex = EXERCISES[id], p = state.prog[id];
    const flags = [];
    if (p.fails === 2) flags.push('<span class="flag danger">3rd try — deload if missed</span>');
    else if (p.fails === 1) flags.push('<span class="flag warn">2nd attempt at this weight</span>');
    const circles = sets[id].map((v, i) => {
      const cls = v === null ? '' : v >= ex.reps ? 'full' : v === 0 ? 'zero' : 'partial';
      return `<button class="set-circle ${cls}" data-ex="${id}" data-set="${i}" aria-label="Set ${i + 1}">${v === null ? ex.reps : v}</button>`;
    }).join('');
    return `<div class="card ex-card">
      <div class="ex-top"><span class="ex-name">${ex.name}</span><span class="ex-target">${ex.sets}×${ex.reps}</span></div>
      <div class="ex-weight num">${fmtKg(p.weight)} <small>kg</small></div>
      ${ex.bar ? `<div class="plate-hint">${plateHint(p.weight)}</div>` : ''}
      ${flags.length ? `<div class="ex-flags">${flags.join('')}</div>` : ''}
      <div class="sets">${circles}</div>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="workout-head">
      <button class="back" data-action="back">${icons.chevronLeft} Workout ${type}</button>
      <span class="clock" id="wclock"></span>
    </div>
    <div class="wprogress">
      <div class="track"><div class="fill" style="width:${(doneSets / allSets.length) * 100}%"></div></div>
      <div class="label">${doneSets} of ${allSets.length} sets logged</div>
    </div>
    ${cards}
    <div class="finish-wrap">
      <button class="btn btn-primary" data-action="finish">${icons.check} Finish workout</button>
    </div>`;

  startTick(startedAt);
  renderRest();
}

// Which plates to load per side of a 20 kg bar.
function plateHint(weight) {
  if (weight <= 20) return 'Empty bar';
  let rem = (weight - 20) / 2;
  const out = [];
  for (const p of [25, 20, 15, 10, 5, 2.5, 1.25]) {
    while (rem >= p - 0.001) { out.push(fmtKg(p)); rem -= p; }
  }
  return `Per side: ${out.join(' + ')}`;
}

function startTick(startedAt) {
  stopTick();
  const update = () => {
    const el = document.getElementById('wclock');
    if (el) el.textContent = fmtClock(Math.floor((Date.now() - startedAt) / 1000));
    updateRestClock();
  };
  update();
  tickHandle = setInterval(update, 1000);
}
function stopTick() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }

function ensureRestTick() {
  if (restTickHandle) return;
  restTickHandle = setInterval(() => {
    if (!rest) { clearInterval(restTickHandle); restTickHandle = null; return; }
    updateRestClock();
  }, 1000);
}

function renderRest() {
  const slot = document.getElementById('rest-root');
  if (!slot) return;
  if (!rest) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="rest-bar" id="rest-bar">
      ${icons.timer}
      <div>
        <div class="t num" id="rest-clock">0:00</div>
        <div class="hint">${rest.hard ? 'Tough set — rest 3–5 min' : 'Rest 1½–3 min, then next set'}</div>
      </div>
      <button class="close" data-action="close-rest">${icons.x}</button>
    </div>`;
  updateRestClock();
}
function updateRestClock() {
  if (!rest) return;
  const el = document.getElementById('rest-clock');
  const bar = document.getElementById('rest-bar');
  if (!el) return;
  const sec = Math.floor((Date.now() - rest.since) / 1000);
  el.textContent = fmtClock(sec);
  const ready = sec >= (rest.hard ? 180 : 90);
  if (ready && bar && !bar.classList.contains('over')) {
    bar.classList.add('over');
    if (navigator.vibrate) navigator.vibrate(200);
  }
}

// ---------- Free log ----------

const draft = { name: '', overrides: {}, sets: '', reps: '', kg: '', note: '', editingId: null };

function resetDraft() {
  draft.name = ''; draft.overrides = {}; draft.sets = ''; draft.reps = '';
  draft.kg = ''; draft.note = ''; draft.editingId = null;
}

// Involvement level per muscle: 'p' (primary), 's' (secondary/half), or false.
function levelFor(id, auto) {
  if (draft.overrides[id] !== undefined) return draft.overrides[id];
  if (auto.p.includes(id)) return 'p';
  if (auto.s.includes(id)) return 's';
  return false;
}

function effectiveMuscles() {
  const auto = detectMuscles(draft.name);
  const eff = { p: [], s: [] };
  for (const m of MUSCLES) {
    const lvl = levelFor(m.id, auto);
    if (lvl === 'p') eff.p.push(m.id);
    else if (lvl === 's') eff.s.push(m.id);
  }
  return eff;
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function agoLabel(ts) {
  if (!ts) return '—';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
    new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDate(ts);
}

function chipRow() {
  const auto = detectMuscles(draft.name);
  return MUSCLES.map((m) => {
    const lvl = levelFor(m.id, auto);
    const cls = lvl === 'p' ? 'on' : lvl === 's' ? 'half' : '';
    return `<button class="m-chip ${cls}" data-muscle="${m.id}">${m.label}${lvl === 's' ? '<span class="half-mark">½</span>' : ''}</button>`;
  }).join('');
}

// Most recent entry per exercise name — powers autocomplete and prefill.
function knownExercises() {
  const map = new Map();
  for (const e of state.freeLog) {
    const key = e.name.trim().toLowerCase();
    if (!map.has(key) || map.get(key).date < e.date) map.set(key, e);
  }
  return map;
}

function lastTimeFor(name) {
  return knownExercises().get(name.trim().toLowerCase()) || null;
}

function suggestRow() {
  const q = draft.name.trim().toLowerCase();
  if (!q) return '';
  const matches = [...knownExercises().values()]
    .filter((e) => e.name.toLowerCase().includes(q) && e.name.toLowerCase() !== q)
    .sort((a, b) => b.date - a.date)
    .slice(0, 4);
  return matches.map((e) =>
    `<button class="suggest" data-suggest="${esc(e.name)}">${esc(e.name)}</button>`).join('');
}

function lastTimeHint(name) {
  const last = lastTimeFor(name);
  if (!last) return '';
  const meta = [last.sets && last.reps ? `${last.sets}×${last.reps}` : '', last.kg ? `${last.kg} kg` : ''].filter(Boolean).join(' · ');
  const base = meta ? `Last time: ${meta} (${agoLabel(last.date)})` : `Logged before (${agoLabel(last.date)})`;
  const tip = progressionHint(last);
  return tip ? `${base} — ${tip}` : base;
}

// Double progression: add a rep until ~12, then add weight and drop back to 8.
function progressionHint(last) {
  if (!last || draft.editingId) return '';
  if (last.sets && last.reps && last.kg) {
    if (last.reps < 12) return `today try ${last.sets}×${last.reps + 1} @ ${fmtKg(last.kg)} kg`;
    return `today try ${last.sets}×8 @ ${fmtKg(roundStep(last.kg + 2.5))} kg`;
  }
  if (last.kg) return `today try ${fmtKg(roundStep(last.kg + 2.5))} kg`;
  return '';
}

function detectHint() {
  const auto = detectMuscles(draft.name);
  if (!draft.name.trim()) return 'Type an exercise — trained muscles get selected automatically.';
  if (auto.p.length) {
    const label = (id) => MUSCLES.find((m) => m.id === id).label;
    const sec = auto.s.length ? ` · assisting: ${auto.s.map(label).join(', ')}` : '';
    return `Recognized: ${auto.p.map(label).join(', ')}${sec}`;
  }
  return 'Not recognized — tap muscles: once = trained, twice = half, again = off.';
}

function renderLog() {
  stopTick();
  const last = muscleLastTrained(state);
  const fCells = MUSCLES.map((m) => {
    const ts = last[m.id];
    const days = ts ? Math.floor((Date.now() - ts) / 86400000) : Infinity;
    const cls = days <= 2 ? 'fresh' : days <= 6 ? 'warm' : '';
    return `<div class="f-cell ${cls}"><span>${m.label}</span><span class="ago">${agoLabel(ts)}</span></div>`;
  }).join('');

  const recent = [...state.freeLog].sort((a, b) => b.date - a.date).slice(0, 40);
  const groups = [];
  for (const e of recent) {
    const label = dayLabel(e.date);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const entryCards = groups.map((g) => `
    <div class="card entry-day">
      <div class="h-title" style="margin-bottom:4px">${g.label}</div>
      ${g.items.map((e) => `
        <div class="entry-row">
          <div class="info" data-edit-entry="${e.id}" role="button">
            <div class="n">${esc(e.name)}</div>
            <div class="tags">${e.muscles.map((id) => `<span class="tag">${MUSCLES.find((m) => m.id === id)?.label || id}</span>`).join('')}${(e.secondary || []).map((id) => `<span class="tag half">${MUSCLES.find((m) => m.id === id)?.label || id} ½</span>`).join('')}</div>
            ${e.note ? `<div class="e-note">${esc(e.note)}</div>` : ''}
          </div>
          <span class="meta">${[e.sets && e.reps ? `${e.sets}×${e.reps}` : e.sets ? `${e.sets} sets` : '', e.kg ? `${e.kg} kg` : ''].filter(Boolean).join(' · ')}</span>
          <button class="del" data-del-entry="${e.id}">${icons.trash}</button>
        </div>`).join('')}
    </div>`).join('');

  view.innerHTML = `
    <div class="eyebrow">Freestyle</div>
    <h1>Quick log</h1>
    <div class="sub">Log any exercise — muscles are tracked automatically.</div>

    <div class="card mt16">
      ${draft.editingId ? '<div class="edit-banner">Editing entry</div>' : ''}
      <input type="text" id="log-name" placeholder="e.g. Biceps curl" value="${esc(draft.name)}" autocomplete="off" enterkeyhint="done">
      <div class="suggest-row" id="suggest-row">${suggestRow()}</div>
      <div class="detect-hint ${detectMuscles(draft.name).p.length ? 'found' : ''}" id="detect-hint">${detectHint()}</div>
      <div class="last-hint" id="last-hint">${lastTimeHint(draft.name)}</div>
      <div class="muscle-grid" id="chip-row">${chipRow()}</div>
      <div class="log-nums">
        <input type="number" id="log-sets" placeholder="Sets" inputmode="numeric" min="0" value="${esc(String(draft.sets))}">
        <input type="number" id="log-reps" placeholder="Reps" inputmode="numeric" min="0" value="${esc(String(draft.reps))}">
        <input type="number" id="log-kg" placeholder="kg" inputmode="decimal" min="0" step="0.5" value="${esc(String(draft.kg))}">
      </div>
      <input type="text" id="log-note" class="mt12" placeholder="Note (optional)" value="${esc(draft.note)}" autocomplete="off">
      <div class="log-date-row">
        <span class="log-date-label">${icons.calendar} Date</span>
        <input type="date" id="log-date" value="${draft.editingId ? new Date(state.freeLog.find((e) => e.id === draft.editingId)?.date || Date.now()).toLocaleDateString('en-CA') : todayISO()}" max="${todayISO()}">
      </div>
      <div class="btn-row mt16">
        ${draft.editingId
          ? `<button class="btn btn-ghost" data-action="log-cancel-edit">Cancel</button>
             <button class="btn btn-primary" data-action="log-add">Save changes</button>`
          : `<button class="btn btn-ghost" data-action="log-set-done">${icons.plus} Set done</button>
             <button class="btn btn-primary" data-action="log-add">Log exercise ${icons.arrowRight}</button>`}
      </div>
    </div>

    <div class="card bw-card">
      <div class="bw-row">
        <div>
          <div class="chart-title" style="padding:0 0 2px">Body weight</div>
          <div class="chart-sub" style="padding:0">${state.weights.length ? `${fmtKg(state.weights[state.weights.length - 1].kg)} kg · ${agoLabel(state.weights[state.weights.length - 1].date)}` : 'Not logged yet'}</div>
        </div>
        <div class="bw-inputs">
          <input type="number" id="bw-input" placeholder="kg" inputmode="decimal" min="0" step="0.1">
          <button class="btn btn-ghost bw-btn" data-action="bw-save">${icons.check}</button>
        </div>
      </div>
    </div>

    <div class="section-label">Muscles — last trained</div>
    <div class="card"><div class="f-grid">${fCells}</div></div>

    ${entryCards ? `<div class="section-label">Logged</div>${entryCards}` : `
      <div class="empty mt16">${icons.clipboard}<div>Nothing logged yet.<br>Your entries land here per day.</div></div>`}`;
}

function renderHistory() {
  stopTick();
  const cards = [];

  for (const h of state.history) {
    const rows = h.exercises.map((e) => {
      const ex = EXERCISES[e.id];
      const mark = e.success ? `<span class="ok">${icons.check}</span>` : `<span class="bad">${icons.x}</span>`;
      return `<div class="h-row">
        <span class="n">${ex.name}</span>
        <span class="w num">${fmtKg(e.weight)} kg</span>
        <span class="r num">${e.sets.join(' · ')} ${mark}</span>
      </div>`;
    }).join('');
    cards.push({ date: h.date, html: `<div class="card h-item">
      <div class="h-top">
        <div class="monogram ${h.type.toLowerCase()}">${h.type}</div>
        <div>
          <div class="h-title">Workout ${h.type}</div>
          <div class="h-date">${fmtDate(h.date)} · ${h.durationMin} min</div>
        </div>
      </div>
      <div class="h-rows">${rows}</div>
    </div>` });
  }

  // Freestyle entries grouped into one card per day
  const byDay = new Map();
  for (const e of state.freeLog) {
    const key = new Date(e.date).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  for (const items of byDay.values()) {
    items.sort((a, b) => a.date - b.date);
    const date = items[items.length - 1].date;
    const rows = items.map((e) => `<div class="h-row">
      <span class="n">${esc(e.name)}</span>
      <span class="w num">${e.kg ? `${fmtKg(e.kg)} kg` : ''}</span>
      <span class="r num">${e.sets && e.reps ? `${e.sets}×${e.reps}` : ''}</span>
    </div>`).join('');
    cards.push({ date, html: `<div class="card h-item">
      <div class="h-top">
        <div class="monogram f">F</div>
        <div>
          <div class="h-title">Freestyle</div>
          <div class="h-date">${fmtDate(date)} · ${items.length} exercise${items.length > 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="h-rows">${rows}</div>
    </div>` });
  }

  cards.sort((a, b) => b.date - a.date);
  view.innerHTML = `
    <div class="eyebrow">Log</div>
    <h1>History</h1>
    <div class="mt16">${cards.map((c) => c.html).join('') || `<div class="empty">${icons.calendar}<div>No workouts yet.<br>Your finished sessions land here.</div></div>`}</div>`;
}

// ---------- Progress ----------

function renderFullBody() {
  const cutoff = Date.now() - 7 * 86400000;
  const counts = setsPerMuscle(state, cutoff);
  const max = Math.max(6, ...Object.values(counts));
  const under = MUSCLES.filter((m) => (counts[m.id] || 0) === 0);

  const bars = MUSCLES.map((m) => {
    const n = counts[m.id] || 0;
    const cls = n === 0 ? 'zero' : n < 6 ? 'low' : 'good';
    return `<div class="vol-row" data-muscle-detail="${m.id}" role="button">
      <span class="vol-label">${m.label}</span>
      <div class="vol-track"><div class="vol-fill ${cls}" style="width:${Math.max(n / max * 100, n ? 6 : 0)}%"></div></div>
      <span class="vol-n num">${fmtKg(n)}</span>
    </div>`;
  }).join('');

  const weeks = weeklyVolume(state, 8);
  const wMax = Math.max(1, ...weeks.map((w) => w.sets));
  const wBars = weeks.map((w, i) => {
    const label = new Date(w.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `<div class="wk-col">
      <span class="wk-n num">${w.sets || ''}</span>
      <div class="wk-bar ${i === weeks.length - 1 ? 'now' : ''}" style="height:${Math.max((w.sets / wMax) * 100, w.sets ? 6 : 2)}%"></div>
      <span class="wk-label">${i === weeks.length - 1 ? 'now' : label}</span>
    </div>`;
  }).join('');

  const tw = tonnageSince(state, cutoff);
  let totalSets = 0;
  for (const e of state.freeLog) if (e.date >= cutoff) totalSets += e.sets || 1;
  for (const h of state.history) if (h.date >= cutoff) for (const ex of h.exercises) totalSets += ex.sets.length;
  const daysTrained = new Set([...state.history, ...state.freeLog].filter((x) => x.date >= cutoff).map((x) => new Date(x.date).toDateString())).size;

  return `
    ${under.length && under.length < MUSCLES.length ? `
      <div class="under-card">${icons.circleAlert}
        <div><b>Not trained in the last 7 days:</b> ${under.map((m) => m.label).join(', ')}</div>
      </div>` : ''}
    <div class="card">
      <div class="chart-title">Sets per muscle</div>
      <div class="chart-sub">Last 7 days — free log + 5×5, assists count half</div>
      <div class="vol-list">${bars}</div>
    </div>
    <div class="card">
      <div class="chart-title">Weekly volume</div>
      <div class="chart-sub">Total sets per calendar week — steady or climbing is what you want</div>
      <div class="wk-chart">${wBars}</div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="v num">${totalSets}</div><div class="l">Sets · 7 days</div></div>
      <div class="stat"><div class="v num">${daysTrained}</div><div class="l">Days trained · 7d</div></div>
      <div class="stat"><div class="v num">${tw >= 1000 ? (tw / 1000).toFixed(1) : Math.round(tw)}<small> ${tw >= 1000 ? 't' : 'kg'}</small></div><div class="l">Lifted · 7 days</div></div>
    </div>`;
}

// Unique freestyle exercises, most recently logged first.
function freeExercises() {
  const map = new Map();
  for (const e of state.freeLog) {
    const key = e.name.trim().toLowerCase();
    if (!map.has(key) || map.get(key).date < e.date) map.set(key, e);
  }
  return [...map.entries()].sort((a, b) => b[1].date - a[1].date).slice(0, 10);
}

function freeSeries(nameKey) {
  return state.freeLog
    .filter((e) => e.name.trim().toLowerCase() === nameKey && e.kg)
    .sort((a, b) => a.date - b.date)
    .map((e) => ({ date: e.date, weight: e.kg, success: true }));
}

function renderProgress() {
  stopTick();
  const chips = [`<button class="chip ${progressEx === 'fullbody' ? 'active' : ''}" data-ex-chip="fullbody">Full body</button>`]
    .concat(state.weights.length ? [`<button class="chip ${progressEx === 'bodyweight' ? 'active' : ''}" data-ex-chip="bodyweight">Body weight</button>`] : [])
    .concat(freeExercises().map(([key, e]) =>
      `<button class="chip ${progressEx === `free:${key}` ? 'active' : ''}" data-ex-chip="free:${esc(key)}">${esc(e.name)}</button>`))
    .concat(Object.entries(EXERCISES).map(([id, ex]) =>
      `<button class="chip ${id === progressEx ? 'active' : ''}" data-ex-chip="${id}">${ex.name}</button>`)).join('');

  const head = `
    <div class="eyebrow">Trend</div>
    <h1>Progress</h1>
    <div class="chips mt12">${chips}</div>`;

  if (progressEx === 'fullbody') {
    view.innerHTML = `${head}${renderFullBody()}`;
    return;
  }

  let series, title, statHtml;
  if (progressEx === 'bodyweight') {
    series = state.weights.map((w) => ({ date: w.date, weight: w.kg, success: true }));
    title = 'Body weight';
    const last = series[series.length - 1];
    const diff = series.length ? last.weight - series[0].weight : 0;
    statHtml = `
      <div class="stat"><div class="v num">${last ? fmtKg(last.weight) : '—'}<small> kg</small></div><div class="l">Current</div></div>
      <div class="stat"><div class="v num">${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.0', '')}<small> kg</small></div><div class="l">Since start</div></div>
      <div class="stat"><div class="v num">${series.length}</div><div class="l">Entries</div></div>`;
  } else if (progressEx.startsWith('free:')) {
    const key = progressEx.slice(5);
    series = freeSeries(key);
    const all = state.freeLog.filter((e) => e.name.trim().toLowerCase() === key);
    title = all.length ? all[all.length - 1].name : key;
    const last = series[series.length - 1];
    const gained = series.length ? last.weight - series[0].weight : 0;
    statHtml = `
      <div class="stat"><div class="v num">${last ? fmtKg(last.weight) : '—'}<small> kg</small></div><div class="l">Last logged</div></div>
      <div class="stat"><div class="v num">${gained >= 0 ? '+' : ''}${fmtKg(gained)}<small> kg</small></div><div class="l">Since start</div></div>
      <div class="stat"><div class="v num">${all.length}</div><div class="l">Times logged</div></div>`;
  } else {
    series = exerciseSeries(state, progressEx);
    title = EXERCISES[progressEx].name;
    const p = state.prog[progressEx];
    const gained = series.length ? p.weight - series[0].weight : 0;
    statHtml = `
      <div class="stat"><div class="v num">${fmtKg(p.weight)}<small> kg</small></div><div class="l">Next workout</div></div>
      <div class="stat"><div class="v num">${gained >= 0 ? '+' : ''}${fmtKg(gained)}<small> kg</small></div><div class="l">Since start</div></div>
      <div class="stat"><div class="v num">${series.length}</div><div class="l">Sessions</div></div>`;
  }

  view.innerHTML = `${head}
    <div class="card chart-card" style="position:relative">
      <div class="chart-title">${esc(title)}</div>
      <div class="chart-sub">Weight per session (kg)</div>
      ${series.length >= 2 ? buildChart(series) : `<div class="empty">${icons.trendingUp}<div>Log ${esc(title)} with a weight at least twice<br>to see a trend.</div></div>`}
    </div>
    <div class="stat-strip">${statHtml}</div>`;

  attachChartHover(series);
}

function buildChart(series) {
  const W = 420, H = 220, padL = 40, padR = 16, padT = 14, padB = 26;
  const ws = series.map((s) => s.weight);
  let lo = Math.min(...ws), hi = Math.max(...ws);
  if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5; }
  const span = hi - lo;
  lo -= span * 0.08; hi += span * 0.08;

  const x = (i) => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = (w) => padT + (1 - (w - lo) / (hi - lo)) * (H - padT - padB);

  // ~4 recessive horizontal gridlines with round-ish kg labels
  const step = Math.max(2.5, Math.ceil((hi - lo) / 4 / 2.5) * 2.5);
  let grid = '';
  for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) {
    grid += `<line x1="${padL}" y1="${y(g)}" x2="${W - padR}" y2="${y(g)}" stroke="#EBE9E3" stroke-width="1"/>
      <text x="${padL - 8}" y="${y(g) + 4}" text-anchor="end" font-size="11" fill="#9EA1A8" font-family="'Plus Jakarta Sans',sans-serif" font-weight="600">${fmtKg(g)}</text>`;
  }

  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.weight).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `${padL},${H - padB} ${line} ${x(series.length - 1).toFixed(1)},${H - padB}`;
  const dots = series.map((s, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(s.weight).toFixed(1)}" r="4" fill="${s.success ? '#17181A' : '#FFFFFF'}" stroke="${s.success ? '#FFFFFF' : '#D6453D'}" stroke-width="2" data-pt="${i}"/>`).join('');

  // sparse x labels: first, middle, last
  const li = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  const xlabels = [...new Set(li)].map((i) =>
    `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#9EA1A8" font-family="'Plus Jakarta Sans',sans-serif" font-weight="600">${new Date(series[i].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`).join('');

  const last = series[series.length - 1];
  const endLabel = `<text x="${x(series.length - 1) - 2}" y="${y(last.weight) - 12}" text-anchor="end" font-size="12" font-weight="800" fill="#17181A" font-family="'Plus Jakarta Sans',sans-serif">${fmtKg(last.weight)} kg</text>`;

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" id="chart">
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3A6B3F" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#3A6B3F" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${area}" fill="url(#areaFill)"/>
    <polyline points="${line}" fill="none" stroke="#17181A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${endLabel}${xlabels}
  </svg>`;
}

function attachChartHover(series) {
  const svg = document.getElementById('chart');
  if (!svg) return;
  const card = svg.closest('.chart-card');
  let tip = null;
  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(relX * (series.length - 1))));
    const s = series[i];
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; card.appendChild(tip); }
    tip.innerHTML = `${fmtKg(s.weight)} kg ${s.success ? '' : '· failed'}<div class="d">${fmtDate(s.date)}</div>`;
    const cardRect = card.getBoundingClientRect();
    const padL = 40, padR = 16, W = 420;
    const px = (padL + (i / Math.max(1, series.length - 1)) * (W - padL - padR)) / W * rect.width + (rect.left - cardRect.left);
    const dotY = rect.top - cardRect.top + rect.height * 0.35;
    tip.style.left = `${px}px`;
    tip.style.top = `${dotY}px`;
  };
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

// ---------- Settings ----------

function renderSettings() {
  stopTick();
  const rows = Object.entries(EXERCISES).map(([id, ex]) => {
    const p = state.prog[id];
    return `<div class="set-row">
      <div class="info"><div class="n">${ex.name}</div><div class="d">${ex.note || ''} +${fmtKg(p.inc)} kg per success</div></div>
      <div class="stepper">
        <button data-step="${id}|-1" aria-label="Decrease">${icons.minus}</button>
        <span class="val num">${fmtKg(p.weight)} <small>kg</small></span>
        <button data-step="${id}|1" aria-label="Increase">${icons.plus}</button>
      </div>
    </div>`;
  }).join('');

  const token = getToken();
  const statusIcon = { ok: icons.circleCheck, err: icons.circleAlert, busy: icons.refresh, idle: icons.refresh, off: icons.circleAlert }[syncState.status];
  const statusText = syncState.status === 'off' ? 'Not connected — data only on this device' : (syncState.msg || 'Ready');

  view.innerHTML = `
    <div class="eyebrow">Setup</div>
    <h1>Settings</h1>

    <div class="section-label">Training</div>
    <div class="card">
      <div class="set-row">
        <div class="info"><div class="n">Weekly goal</div><div class="d">Training days per week for your streak</div></div>
        <div class="stepper">
          <button data-goal-step="-1" aria-label="Decrease">${icons.minus}</button>
          <span class="val num">${state.goal || 3} <small>days</small></span>
          <button data-goal-step="1" aria-label="Increase">${icons.plus}</button>
        </div>
      </div>
      <button class="btn btn-ghost mt12" data-action="suggest-starts">${icons.barbell} Suggest 5×5 starting weights from my log</button>
    </div>

    <div class="section-label">Current weights</div>
    <div class="card">${rows}</div>

    <div class="section-label">GitHub sync</div>
    <div class="card">
      <div class="sub">Your log is saved as <b>data/log.json</b> in your own repo. No external services.</div>
      <div class="field-label">Fine-grained personal access token</div>
      <input type="password" id="token-input" placeholder="github_pat_…" value="${esc(token)}" autocomplete="off">
      <div class="sync-status ${syncState.status === 'ok' ? 'ok' : syncState.status === 'err' ? 'err' : ''}">${statusIcon} ${esc(statusText)}</div>
      <div class="mt12" style="display:flex; gap:10px;">
        <button class="btn btn-ghost" data-action="save-token">Save token</button>
        <button class="btn btn-ghost" data-action="sync-now" ${token ? '' : 'disabled'}>${icons.refresh} Sync now</button>
      </div>
      <div class="help-steps">
        <b>One-time setup:</b> GitHub → Settings → Developer settings →
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained tokens</a> →
        Only select repository <b>Fitnessapp</b> → Permissions → Contents: <b>Read and write</b> → Generate, then paste it here.
        The token never leaves your phone.
      </div>
    </div>

    <div class="section-label">Data</div>
    <div class="card">
      <button class="btn btn-ghost" data-action="export">${icons.download} Export backup (JSON)</button>
      <button class="btn btn-danger mt8" data-action="reset">Reset all data</button>
    </div>`;
}

// ---------- Modals ----------

function openModal(html) { modalRoot.innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`; }
function closeModal() { modalRoot.innerHTML = ''; }
modalRoot.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

function showMuscleDetail(muscleId) {
  const label = MUSCLES.find((m) => m.id === muscleId)?.label || muscleId;
  const cutoff = Date.now() - 21 * 86400000;
  const items = [];
  for (const e of state.freeLog) {
    if (e.date < cutoff) continue;
    if (e.muscles.includes(muscleId)) items.push({ name: e.name, date: e.date, sets: e.sets || 1, lvl: 'p' });
    else if ((e.secondary || []).includes(muscleId)) items.push({ name: e.name, date: e.date, sets: e.sets || 1, lvl: 's' });
  }
  for (const h of state.history) {
    if (h.date < cutoff) continue;
    for (const ex of h.exercises) {
      const def = EXERCISES[ex.id];
      if (def?.muscles.includes(muscleId)) items.push({ name: def.name, date: h.date, sets: ex.sets.length, lvl: 'p' });
      else if ((def?.secondary || []).includes(muscleId)) items.push({ name: def.name, date: h.date, sets: ex.sets.length, lvl: 's' });
    }
  }
  items.sort((a, b) => b.date - a.date);
  const rows = items.slice(0, 12).map((i) => `
    <div class="result-row same">
      <span class="n">${esc(i.name)}</span>
      <span class="tag ${i.lvl === 's' ? 'half' : ''}">${i.lvl === 's' ? '½' : 'full'}</span>
      <span class="delta num">${i.sets} sets · ${dayLabel(i.date)}</span>
    </div>`).join('');
  openModal(`
    <h2>${label} — last 3 weeks</h2>
    ${rows ? `<div class="result-rows">${rows}</div>` : `<div class="body">Nothing hit ${label.toLowerCase()} in the last 3 weeks.</div>`}
    <div class="actions"><button class="btn btn-primary" data-action="close-modal">Close</button></div>`);
}

function showFinishSummary(results) {
  const rows = results.map((r) => {
    const cls = r.action === 'up' ? 'up' : r.action === 'deload' ? 'down' : 'same';
    const icon = r.action === 'up' ? icons.arrowUpRight : r.action === 'deload' ? icons.arrowDownRight : icons.minus;
    const delta = r.action === 'up'
      ? `${fmtKg(r.oldWeight)} → ${fmtKg(r.newWeight)} kg`
      : r.action === 'deload'
        ? `Deload → ${fmtKg(r.newWeight)} kg`
        : `Stays ${fmtKg(r.oldWeight)} kg (try ${r.fails + 1}/3)`;
    return `<div class="result-row ${cls}">${icon}<span class="n">${r.name}</span><span class="delta num">${delta}</span></div>`;
  }).join('');
  openModal(`
    <h2>Workout done 💪</h2>
    <div class="result-rows">${rows}</div>
    <div class="actions"><button class="btn btn-primary" data-action="close-modal">Nice</button></div>`);
}

// ---------- Global click handling ----------

function refreshLogHints() {
  const hint = document.getElementById('detect-hint');
  const chips = document.getElementById('chip-row');
  const sug = document.getElementById('suggest-row');
  const lastH = document.getElementById('last-hint');
  if (hint) {
    hint.textContent = detectHint();
    hint.classList.toggle('found', detectMuscles(draft.name).p.length > 0);
  }
  if (chips) chips.innerHTML = chipRow();
  if (sug) sug.innerHTML = suggestRow();
  if (lastH) lastH.textContent = lastTimeHint(draft.name);
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'log-name') {
    draft.name = e.target.value;
    draft.overrides = {};
    refreshLogHints();
  } else if (e.target.id === 'log-sets') draft.sets = e.target.value;
  else if (e.target.id === 'log-reps') draft.reps = e.target.value;
  else if (e.target.id === 'log-kg') draft.kg = e.target.value;
  else if (e.target.id === 'log-note') draft.note = e.target.value;
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-ex], [data-ex-chip], [data-step], [data-muscle], [data-del-entry], [data-suggest], [data-edit-entry], [data-muscle-detail], [data-goal-step]');
  if (!el) return;

  if (el.dataset.editEntry) {
    const entry = state.freeLog.find((x) => x.id === Number(el.dataset.editEntry));
    if (entry) {
      draft.name = entry.name;
      draft.sets = entry.sets ?? '';
      draft.reps = entry.reps ?? '';
      draft.kg = entry.kg ?? '';
      draft.note = entry.note || '';
      draft.editingId = entry.id;
      draft.overrides = {};
      const auto = detectMuscles(entry.name);
      for (const m of MUSCLES) {
        const stored = entry.muscles.includes(m.id) ? 'p' : (entry.secondary || []).includes(m.id) ? 's' : false;
        const detected = auto.p.includes(m.id) ? 'p' : auto.s.includes(m.id) ? 's' : false;
        if (stored !== detected) draft.overrides[m.id] = stored;
      }
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  if (el.dataset.muscleDetail) {
    showMuscleDetail(el.dataset.muscleDetail);
    return;
  }

  if (el.dataset.goalStep) {
    state.goal = Math.min(7, Math.max(1, (state.goal || 3) + Number(el.dataset.goalStep)));
    persist(state);
    render();
    scheduleSync();
    return;
  }

  if (el.dataset.suggest !== undefined) {
    const last = lastTimeFor(el.dataset.suggest);
    draft.name = el.dataset.suggest;
    draft.overrides = {};
    if (last) {
      const auto = detectMuscles(draft.name);
      for (const m of MUSCLES) {
        const stored = last.muscles.includes(m.id) ? 'p' : (last.secondary || []).includes(m.id) ? 's' : false;
        const detected = auto.p.includes(m.id) ? 'p' : auto.s.includes(m.id) ? 's' : false;
        if (stored !== detected) draft.overrides[m.id] = stored;
      }
      const set = (id, key, v) => { draft[key] = v ?? ''; const i = document.getElementById(id); if (i && v != null) i.value = v; };
      set('log-sets', 'sets', last.sets); set('log-reps', 'reps', last.reps); set('log-kg', 'kg', last.kg);
    }
    const inp = document.getElementById('log-name');
    if (inp) inp.value = draft.name;
    refreshLogHints();
    return;
  }

  if (el.dataset.muscle) {
    const id = el.dataset.muscle;
    const lvl = levelFor(id, detectMuscles(draft.name));
    // cycle: primary -> half -> off -> primary
    draft.overrides[id] = lvl === 'p' ? 's' : lvl === 's' ? false : 'p';
    const chips = document.getElementById('chip-row');
    if (chips) chips.innerHTML = chipRow();
    return;
  }

  if (el.dataset.delEntry) {
    deleteFreeEntry(state, Number(el.dataset.delEntry));
    render();
    scheduleSync();
    return;
  }

  if (el.dataset.exChip) { progressEx = el.dataset.exChip; render(); return; }

  if (el.dataset.step) {
    const [id, dir] = el.dataset.step.split('|');
    const p = state.prog[id];
    p.weight = Math.max(EXERCISES[id].floor, p.weight + Number(dir) * 2.5);
    persist(state);
    render();
    scheduleSync();
    return;
  }

  if (el.dataset.ex !== undefined && el.dataset.set !== undefined) {
    const val = tapSet(state, el.dataset.ex, Number(el.dataset.set));
    if (val !== null) {
      rest = { since: Date.now(), hard: val < EXERCISES[el.dataset.ex].reps };
    }
    renderWorkout();
    return;
  }

  switch (el.dataset.action) {
    case 'start':
      startWorkout(state);
      rest = null;
      render();
      break;
    case 'back':
      openModal(`
        <h2>Leave workout?</h2>
        <div class="body">Your taps are saved — you can come back and continue, or discard this session entirely.</div>
        <div class="actions">
          <button class="btn btn-primary" data-action="close-modal">Keep training</button>
          <button class="btn btn-danger" data-action="discard">Discard workout</button>
        </div>`);
      break;
    case 'discard':
      discardWorkout(state);
      rest = null;
      closeModal();
      render();
      break;
    case 'finish': {
      const untouched = Object.values(state.active.sets).flat().every((v) => v === null);
      if (untouched) {
        openModal(`
          <h2>Nothing logged yet</h2>
          <div class="body">Tap the circles as you complete each set. A full circle means all reps done.</div>
          <div class="actions"><button class="btn btn-primary" data-action="close-modal">Got it</button></div>`);
        break;
      }
      const results = finishWorkout(state);
      rest = null;
      stopTick();
      render();
      showFinishSummary(results);
      sync('push');
      break;
    }
    case 'log-add': {
      const name = document.getElementById('log-name').value.trim();
      const eff = effectiveMuscles();
      if (!name) { document.getElementById('log-name').focus(); break; }
      if (!eff.p.length && !eff.s.length) {
        const hint = document.getElementById('detect-hint');
        if (hint) { hint.textContent = 'Select at least one muscle first.'; hint.classList.remove('found'); }
        break;
      }
      const num = (id) => { const v = document.getElementById(id).value; return v ? Number(v) : null; };
      const note = document.getElementById('log-note').value.trim() || null;
      const dv = document.getElementById('log-date').value;

      if (draft.editingId) {
        const entry = state.freeLog.find((x) => x.id === draft.editingId);
        if (entry) {
          Object.assign(entry, { name, muscles: eff.p, secondary: eff.s, sets: num('log-sets'), reps: num('log-reps'), kg: num('log-kg'), note });
          const origISO = new Date(entry.date).toLocaleDateString('en-CA');
          if (dv && dv !== origISO) entry.date = new Date(`${dv}T12:00:00`).getTime();
          persist(state);
        }
      } else {
        const date = dv && dv !== todayISO() ? new Date(`${dv}T12:00:00`).getTime() : Date.now();
        addFreeEntry(state, { name, muscles: eff.p, secondary: eff.s, date, sets: num('log-sets'), reps: num('log-reps'), kg: num('log-kg'), note });
      }
      resetDraft();
      render();
      scheduleSync();
      break;
    }
    case 'log-cancel-edit':
      resetDraft();
      render();
      break;
    case 'log-set-done': {
      const name = document.getElementById('log-name').value.trim();
      if (!name) { document.getElementById('log-name').focus(); break; }
      const eff = effectiveMuscles();
      if (!eff.p.length && !eff.s.length) {
        const hint = document.getElementById('detect-hint');
        if (hint) { hint.textContent = 'Select at least one muscle first.'; hint.classList.remove('found'); }
        break;
      }
      const num = (id) => { const v = document.getElementById(id).value; return v ? Number(v) : null; };
      const key = name.toLowerCase();
      const today = todayISO();
      const existing = state.freeLog.find((x) =>
        x.name.trim().toLowerCase() === key && new Date(x.date).toLocaleDateString('en-CA') === today);
      if (existing) {
        existing.sets = (existing.sets || 0) + 1;
        if (num('log-reps')) existing.reps = num('log-reps');
        if (num('log-kg')) existing.kg = num('log-kg');
        persist(state);
      } else {
        addFreeEntry(state, { name, muscles: eff.p, secondary: eff.s, date: Date.now(), sets: 1, reps: num('log-reps'), kg: num('log-kg'), note: null });
      }
      draft.sets = existing ? existing.sets : 1;
      rest = { since: Date.now(), hard: false };
      render();
      renderRest();
      ensureRestTick();
      scheduleSync();
      break;
    }
    case 'bw-save': {
      const v = Number(document.getElementById('bw-input').value);
      if (!v) break;
      state.weights.push({ date: Date.now(), kg: v });
      persist(state);
      render();
      scheduleSync();
      break;
    }
    case 'suggest-starts': {
      const rows = suggestStarts(state);
      if (!rows.length) {
        openModal(`
          <h2>Nothing to base it on yet</h2>
          <div class="body">Log some exercises with weights first (squat, bench, row, presses…) — then I can derive sensible 5×5 starting weights from them.</div>
          <div class="actions"><button class="btn btn-primary" data-action="close-modal">OK</button></div>`);
        break;
      }
      pendingStarts = rows;
      openModal(`
        <h2>Suggested starting weights</h2>
        <div class="body">About half of your best recent lift — 5×5 starts deliberately light and climbs every workout.</div>
        <div class="result-rows">${rows.map((r) => `
          <div class="result-row same">${icons.barbell}<span class="n">${r.name}</span>
          <span class="delta num">${fmtKg(r.current)} → ${fmtKg(r.suggested)} kg</span></div>`).join('')}</div>
        <div class="actions">
          <button class="btn btn-primary" data-action="apply-starts">Apply</button>
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
        </div>`);
      break;
    }
    case 'apply-starts': {
      for (const r of pendingStarts || []) {
        state.prog[r.id].weight = r.suggested;
        state.prog[r.id].fails = 0;
      }
      pendingStarts = null;
      persist(state);
      closeModal();
      render();
      scheduleSync();
      break;
    }
    case 'close-rest': rest = null; renderRest(); break;
    case 'close-modal': closeModal(); break;
    case 'dismiss-onboard': state.onboardDismissed = true; persist(state); render(); break;
    case 'save-token': {
      const val = document.getElementById('token-input').value.trim();
      setToken(val);
      syncState = { status: val ? 'idle' : 'off', msg: '' };
      if (val) sync();
      else render();
      break;
    }
    case 'sync-now': sync(); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `five-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case 'reset':
      openModal(`
        <h2>Reset everything?</h2>
        <div class="body">This wipes all workouts and weights on this device. If GitHub sync is on, the reset will also be pushed on the next sync.</div>
        <div class="actions">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-danger" data-action="reset-confirm">Yes, reset</button>
        </div>`);
      break;
    case 'reset-confirm': {
      localStorage.removeItem('five5x5.v1');
      location.reload();
      break;
    }
  }
});

let syncTimer = null;
function scheduleSync() {
  if (!getToken()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync('push'), 2500);
}

// ---------- Boot ----------

render();
if (getToken()) sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
