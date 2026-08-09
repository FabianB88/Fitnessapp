// State, program definition and progression rules (StrongLifts-style linear progression).

const LS_KEY = 'five5x5.v1';

export const EXERCISES = {
  'box-squat':      { name: 'Box Squat',      sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell. Sit back onto the box, brief pause, stand up.' },
  'bench-press':    { name: 'Bench Press',    sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell, flat bench.' },
  'seated-row':     { name: 'Seated Row',     sets: 5, reps: 5,  start: 25, inc: 2.5, floor: 5,  note: 'Cable row, neutral grip.' },
  'leg-curl':       { name: 'Leg Curl',       sets: 3, reps: 10, start: 20, inc: 2.5, floor: 5,  note: 'Machine, seated or lying.' },
  'overhead-press': { name: 'Overhead Press', sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell, standing.' },
  'leg-press':      { name: 'Leg Press',      sets: 5, reps: 5,  start: 40, inc: 5,   floor: 20, note: 'Machine. Feet mid-platform.' },
  'lat-pulldown':   { name: 'Lat Pulldown',   sets: 3, reps: 8,  start: 25, inc: 2.5, floor: 5,  note: 'Cable, pull to upper chest.' },
};

export const WORKOUTS = {
  A: ['box-squat', 'bench-press', 'seated-row', 'leg-curl'],
  B: ['box-squat', 'overhead-press', 'leg-press', 'lat-pulldown'],
};

export function defaultState() {
  const prog = {};
  for (const [id, ex] of Object.entries(EXERCISES)) {
    prog[id] = { weight: ex.start, fails: 0, inc: ex.inc };
  }
  return {
    version: 1,
    prog,
    history: [],
    next: 'A',
    active: null,           // { type, startedAt, sets: { exId: [n|null, ...] } }
    onboardDismissed: false,
    updatedAt: Date.now(),
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    // Merge in any exercises added after the user first saved state.
    const base = defaultState();
    s.prog = { ...base.prog, ...s.prog };
    return { ...base, ...s };
  } catch {
    return defaultState();
  }
}

export function persist(state, bump = true) {
  if (bump) state.updatedAt = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

export function roundStep(w, step = 2.5) {
  return Math.round(w / step) * step;
}

export function startWorkout(state) {
  const type = state.next;
  const sets = {};
  for (const id of WORKOUTS[type]) {
    sets[id] = Array(EXERCISES[id].sets).fill(null);
  }
  state.active = { type, startedAt: Date.now(), sets };
  persist(state);
}

// Tap logic: empty -> target reps -> target-1 -> ... -> 0 -> empty
export function tapSet(state, exId, setIdx) {
  const target = EXERCISES[exId].reps;
  const cur = state.active.sets[exId][setIdx];
  let next;
  if (cur === null) next = target;
  else if (cur === 0) next = null;
  else next = cur - 1;
  state.active.sets[exId][setIdx] = next;
  persist(state);
  return next;
}

// Apply StrongLifts rules and return a summary of what changed.
export function finishWorkout(state) {
  const { type, sets, startedAt } = state.active;
  const entry = { date: Date.now(), type, durationMin: Math.max(1, Math.round((Date.now() - startedAt) / 60000)), exercises: [] };
  const results = [];

  for (const id of WORKOUTS[type]) {
    const ex = EXERCISES[id];
    const p = state.prog[id];
    const done = sets[id].map((v) => (v === null ? 0 : v));
    const success = done.every((v) => v >= ex.reps);
    const oldWeight = p.weight;
    let action;

    if (success) {
      p.weight = roundStep(p.weight + p.inc);
      p.fails = 0;
      action = 'up';
    } else {
      p.fails += 1;
      if (p.fails >= 3) {
        p.weight = Math.max(ex.floor, roundStep(p.weight * 0.9));
        p.fails = 0;
        action = 'deload';
      } else {
        action = 'same';
      }
    }

    entry.exercises.push({ id, weight: oldWeight, sets: done, success });
    results.push({ id, name: ex.name, success, oldWeight, newWeight: p.weight, action, fails: p.fails });
  }

  state.history.push(entry);
  state.next = type === 'A' ? 'B' : 'A';
  state.active = null;
  persist(state);
  return results;
}

export function discardWorkout(state) {
  state.active = null;
  persist(state);
}

// ---- Derived stats ----

export function totalTonnage(state) {
  let kg = 0;
  for (const h of state.history) {
    for (const e of h.exercises) {
      kg += e.weight * e.sets.reduce((a, b) => a + b, 0);
    }
  }
  return kg;
}

export function workoutsThisWeek(state) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  return state.history.filter((h) => h.date >= monday).length;
}

export function exerciseSeries(state, exId) {
  const pts = [];
  for (const h of state.history) {
    const e = h.exercises.find((x) => x.id === exId);
    if (e) pts.push({ date: h.date, weight: e.weight, success: e.success });
  }
  return pts;
}
