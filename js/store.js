// State, program definition and progression rules (StrongLifts-style linear progression).

const LS_KEY = 'five5x5.v1';

export const EXERCISES = {
  'box-squat':      { name: 'Box Squat',      sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell. Sit back onto the box, brief pause, stand up.', muscles: ['quads', 'glutes'], secondary: ['hamstrings', 'abs', 'back'] },
  'bench-press':    { name: 'Bench Press',    sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell, flat bench.', muscles: ['chest', 'triceps'], secondary: ['shoulders'] },
  'seated-row':     { name: 'Seated Row',     sets: 5, reps: 5,  start: 25, inc: 2.5, floor: 5,  note: 'Cable row, neutral grip.', muscles: ['back', 'biceps'], secondary: ['shoulders'] },
  'leg-curl':       { name: 'Leg Curl',       sets: 3, reps: 10, start: 20, inc: 2.5, floor: 5,  note: 'Machine, seated or lying.', muscles: ['hamstrings'], secondary: ['calves'] },
  'overhead-press': { name: 'Overhead Press', sets: 5, reps: 5,  start: 20, inc: 2.5, floor: 20, note: 'Barbell, standing.', muscles: ['shoulders', 'triceps'], secondary: ['abs'] },
  'leg-press':      { name: 'Leg Press',      sets: 5, reps: 5,  start: 40, inc: 5,   floor: 20, note: 'Machine. Feet mid-platform.', muscles: ['quads', 'glutes'], secondary: ['hamstrings'] },
  'lat-pulldown':   { name: 'Lat Pulldown',   sets: 3, reps: 8,  start: 25, inc: 2.5, floor: 5,  note: 'Cable, pull to upper chest.', muscles: ['back', 'biceps'], secondary: ['shoulders'] },
};

export const MUSCLES = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' },
  { id: 'abs', label: 'Abs' },
  { id: 'quads', label: 'Quads' },
  { id: 'hamstrings', label: 'Hamstrings' },
  { id: 'glutes', label: 'Glutes' },
  { id: 'calves', label: 'Calves' },
];

// Keyword rules for recognizing what an exercise trains.
// p = primary muscles (full credit), s = secondary/assisting (half credit).
// First matching rule wins; specific patterns come before generic ones.
const DETECT_RULES = [
  [/leg extension/, { p: ['quads'], s: [] }],
  [/leg curl|nordic|hamstring/, { p: ['hamstrings'], s: ['calves'] }],
  [/front squat|goblet/, { p: ['quads', 'glutes'], s: ['hamstrings', 'abs'] }],
  [/leg press|squat|lunge|hack|step.?up|pistol|split/, { p: ['quads', 'glutes'], s: ['hamstrings', 'abs'] }],
  [/hip thrust|glute|bridge|abduct/, { p: ['glutes'], s: ['hamstrings'] }],
  [/calf|calves/, { p: ['calves'], s: [] }],
  [/deadlift|rdl|romanian|good morning|back extension|hyperextension/, { p: ['hamstrings', 'glutes', 'back'], s: ['quads', 'abs'] }],
  [/bench|chest press|push.?up|dip|close.?grip/, { p: ['chest', 'triceps'], s: ['shoulders'] }],
  [/fly|flye|pec deck|cable cross/, { p: ['chest'], s: ['shoulders'] }],
  [/pullover/, { p: ['chest', 'back'], s: ['triceps'] }],
  [/pull.?up|chin/, { p: ['back', 'biceps'], s: ['shoulders', 'abs'] }],
  [/row|pulldown|pull.?down|lat /, { p: ['back', 'biceps'], s: ['shoulders'] }],
  [/face pull|rear delt|reverse fly/, { p: ['shoulders', 'back'], s: [] }],
  [/shoulder press|overhead press|ohp|military|arnold/, { p: ['shoulders', 'triceps'], s: ['abs'] }],
  [/lateral|side raise|front raise|shrug|delt/, { p: ['shoulders'], s: [] }],
  [/triceps|pushdown|push.?down|skull|kickback|french/, { p: ['triceps'], s: [] }],
  [/curl/, { p: ['biceps'], s: [] }],
  [/crunch|plank|sit.?up|leg raise|russian twist|ab |abs|core|hanging/, { p: ['abs'], s: [] }],
  [/press/, { p: ['chest', 'triceps'], s: ['shoulders'] }],
];

export function detectMuscles(name) {
  const n = ` ${name.toLowerCase().trim()} `;
  for (const [re, hit] of DETECT_RULES) {
    if (re.test(n)) return { p: [...hit.p], s: [...hit.s] };
  }
  return { p: [], s: [] };
}

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
    freeLog: [],            // [{ id, date, name, muscles: [], sets, reps, kg }]
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

export function addFreeEntry(state, entry) {
  state.freeLog.push({ id: Date.now(), date: Date.now(), ...entry });
  persist(state);
}

export function deleteFreeEntry(state, id) {
  state.freeLog = state.freeLog.filter((e) => e.id !== id);
  persist(state);
}

// Last-trained timestamp per muscle, combining the free log and 5x5 history.
// Secondary involvement counts as trained too.
export function muscleLastTrained(state) {
  const last = {};
  for (const e of state.freeLog) {
    for (const m of [...e.muscles, ...(e.secondary || [])]) last[m] = Math.max(last[m] || 0, e.date);
  }
  for (const h of state.history) {
    for (const e of h.exercises) {
      const def = EXERCISES[e.id];
      for (const m of [...(def?.muscles || []), ...(def?.secondary || [])]) last[m] = Math.max(last[m] || 0, h.date);
    }
  }
  return last;
}

// Effective sets per muscle since a timestamp (free log + 5x5 history).
// Primary muscles get full credit, secondary muscles half credit.
// A free-log entry without a sets value counts as 1 set.
export function setsPerMuscle(state, sinceTs) {
  const counts = {};
  for (const m of MUSCLES) counts[m.id] = 0;
  const add = (muscles, secondary, sets) => {
    for (const m of muscles) counts[m] = (counts[m] || 0) + sets;
    for (const m of secondary) counts[m] = (counts[m] || 0) + sets * 0.5;
  };
  for (const e of state.freeLog) {
    if (e.date >= sinceTs) add(e.muscles, e.secondary || [], e.sets || 1);
  }
  for (const h of state.history) {
    if (h.date < sinceTs) continue;
    for (const ex of h.exercises) {
      const def = EXERCISES[ex.id];
      add(def?.muscles || [], def?.secondary || [], ex.sets.length);
    }
  }
  return counts;
}

export function mondayOf(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

// Total sets performed per week for the last `weeks` weeks, oldest first.
export function weeklyVolume(state, weeks = 8) {
  const thisMonday = mondayOf(Date.now());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    out.push({ start: thisMonday - i * 7 * 86400000, sets: 0 });
  }
  const bucket = (ts) => out.find((w) => ts >= w.start && ts < w.start + 7 * 86400000);
  for (const e of state.freeLog) {
    const b = bucket(e.date);
    if (b) b.sets += e.sets || 1;
  }
  for (const h of state.history) {
    const b = bucket(h.date);
    if (b) for (const ex of h.exercises) b.sets += ex.sets.length;
  }
  return out;
}

export function tonnageSince(state, sinceTs) {
  let kg = 0;
  for (const h of state.history) {
    if (h.date < sinceTs) continue;
    for (const e of h.exercises) kg += e.weight * e.sets.reduce((a, b) => a + b, 0);
  }
  for (const e of state.freeLog) {
    if (e.date < sinceTs) continue;
    if (e.kg && e.reps) kg += e.kg * e.reps * (e.sets || 1);
  }
  return kg;
}

export function exerciseSeries(state, exId) {
  const pts = [];
  for (const h of state.history) {
    const e = h.exercises.find((x) => x.id === exId);
    if (e) pts.push({ date: h.date, weight: e.weight, success: e.success });
  }
  return pts;
}
