import { icons } from './icons.js';
import {
  EXERCISES, WORKOUTS, loadState, persist, startWorkout, tapSet,
  finishWorkout, discardWorkout, totalTonnage, workoutsThisWeek, exerciseSeries,
} from './store.js';
import { getToken, setToken, fetchRemote, pushRemote } from './github.js';

const state = loadState();
let tab = 'home';
let progressEx = 'box-squat';
let rest = null;        // { since, hard }
let tickHandle = null;
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
    ({ home: renderHome, history: renderHistory, progress: renderProgress, settings: renderSettings })[tab]();
  }
  renderTabs();
}
function renderIf(name) { if (tab === name && !state.active) render(); }

function renderTabs() {
  const meta = { home: ['Train', icons.barbell], history: ['History', icons.history], progress: ['Progress', icons.trendingUp], settings: ['Settings', icons.settings] };
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
  const trained = new Set(state.history.map((h) => new Date(h.date).toDateString()));
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
      <div class="stat"><div class="v num">${state.history.length}</div><div class="l">Workouts</div></div>
      <div class="stat"><div class="v num">${workoutsThisWeek(state)}<small>/3</small></div><div class="l">This week</div></div>
      <div class="stat"><div class="v num">${tonnage >= 1000 ? (tonnage / 1000).toFixed(1) : tonnage}<small> ${tonnage >= 1000 ? 't' : 'kg'}</small></div><div class="l">Total lifted</div></div>
    </div>`;
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
    </div>
    <div id="rest-slot"></div>`;

  startTick(startedAt);
  renderRest();
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

function renderRest() {
  const slot = document.getElementById('rest-slot');
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

// ---------- History ----------

function renderHistory() {
  stopTick();
  const items = [...state.history].reverse().map((h) => {
    const rows = h.exercises.map((e) => {
      const ex = EXERCISES[e.id];
      const mark = e.success ? `<span class="ok">${icons.check}</span>` : `<span class="bad">${icons.x}</span>`;
      return `<div class="h-row">
        <span class="n">${ex.name}</span>
        <span class="w num">${fmtKg(e.weight)} kg</span>
        <span class="r num">${e.sets.join(' · ')} ${mark}</span>
      </div>`;
    }).join('');
    return `<div class="card h-item">
      <div class="h-top">
        <div class="monogram ${h.type.toLowerCase()}">${h.type}</div>
        <div>
          <div class="h-title">Workout ${h.type}</div>
          <div class="h-date">${fmtDate(h.date)} · ${h.durationMin} min</div>
        </div>
      </div>
      <div class="h-rows">${rows}</div>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="eyebrow">Log</div>
    <h1>History</h1>
    <div class="mt16">${items || `<div class="empty">${icons.calendar}<div>No workouts yet.<br>Your finished sessions land here.</div></div>`}</div>`;
}

// ---------- Progress ----------

function renderProgress() {
  stopTick();
  const chips = Object.entries(EXERCISES).map(([id, ex]) =>
    `<button class="chip ${id === progressEx ? 'active' : ''}" data-ex-chip="${id}">${ex.name}</button>`).join('');

  const series = exerciseSeries(state, progressEx);
  const ex = EXERCISES[progressEx];
  const p = state.prog[progressEx];
  const gained = series.length ? p.weight - series[0].weight : 0;

  view.innerHTML = `
    <div class="eyebrow">Trend</div>
    <h1>Progress</h1>
    <div class="chips mt12">${chips}</div>
    <div class="card chart-card" style="position:relative">
      <div class="chart-title">${ex.name}</div>
      <div class="chart-sub">Working weight per session (kg)</div>
      ${series.length >= 2 ? buildChart(series) : `<div class="empty">${icons.trendingUp}<div>Do at least two workouts with<br>${ex.name} to see a trend.</div></div>`}
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="v num">${fmtKg(p.weight)}<small> kg</small></div><div class="l">Next workout</div></div>
      <div class="stat"><div class="v num">${gained >= 0 ? '+' : ''}${fmtKg(gained)}<small> kg</small></div><div class="l">Since start</div></div>
      <div class="stat"><div class="v num">${series.length}</div><div class="l">Sessions</div></div>
    </div>`;

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

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-ex], [data-ex-chip], [data-step]');
  if (!el) return;

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
