// state.js — data model, genre presets, persistence.
// Step values: 0 = off, 1 = on, 2 = accent.

export const STEPS = 16;
export const STORAGE_KEY = 'weaver.state.v2';

export const BASS_MODES = ['ACD', 'DEP', 'RSE'];   // acid / deep-rumble / reese

export const TRACKS = [
  { id: 'kick',  label: 'BD', params: [['tune', 'TUN'], ['decay', 'DEC'], ['drive', 'DRV']] },
  { id: 'snare', label: 'SD', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'clap',  label: 'CP', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'chh',   label: 'CH', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'ohh',   label: 'OH', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'bass',  label: 'BS', params: [['cutoff', 'CUT'], ['res', 'RES'], ['decay', 'DEC']], notes: true, modes: true },
  { id: 'stab',  label: 'ST', params: [['chord', 'CHD'], ['cutoff', 'CUT'], ['decay', 'DEC']] },
  { id: 'nse',   label: 'NS', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'smp',   label: 'SP', params: [['tune', 'TUN'], ['ofs', 'OFS'], ['len', 'LEN'], ['decay', 'DEC']], slices: true },
];

const PARAM_DEFAULTS = {
  kick:  { tune: .45, decay: .5,  drive: .3 },
  snare: { tone: .5,  decay: .45 },
  clap:  { tone: .5,  decay: .5 },
  chh:   { tone: .5,  decay: .35 },
  ohh:   { tone: .5,  decay: .5 },
  bass:  { cutoff: .45, res: .5, decay: .4 },
  stab:  { chord: 0,  cutoff: .6, decay: .35 },
  nse:   { tone: .5,  decay: .6 },
  smp:   { tune: .5,  ofs: 0, len: 1, decay: .5 },
};

const LEVEL_DEFAULTS = { kick: .9, snare: .75, clap: .7, chh: .5, ohh: .45, bass: .8, stab: .55, nse: .4, smp: .8 };

function pat(s) {
  const out = new Array(STEPS).fill(0);
  for (let i = 0; i < STEPS && i < s.length; i++) out[i] = s[i] === 'X' ? 2 : s[i] === 'x' ? 1 : 0;
  return out;
}

export function defaultState() {
  const tracks = {};
  for (const t of TRACKS) {
    tracks[t.id] = {
      steps: new Array(STEPS).fill(0),
      notes: t.notes ? new Array(STEPS).fill(0) : undefined,
      slices: t.slices ? Array.from({ length: STEPS }, (_, i) => i) : undefined,
      mode: t.modes ? 0 : undefined,
      level: LEVEL_DEFAULTS[t.id],
      send: .15,
      mute: false,
      params: { ...PARAM_DEFAULTS[t.id] },
    };
  }
  return { v: 2, bpm: 124, swing: 50, master: .8, pump: .4, filter: 0, tracks };
}

// Each preset: 1-bar genre-correct groove. Only listed fields override defaults.
export const PRESETS = {
  house: {
    bpm: 124, swing: 57, pump: .45,
    tracks: {
      kick:  { steps: pat('X...x...X...x...'), params: { tune: .45, decay: .45, drive: .35 }, level: .9, send: .15 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .5, decay: .5 }, level: .65, send: .3 },
      chh:   { steps: pat('xx.xxx.xxx.xxx.x'), params: { tone: .55, decay: .3 }, level: .42 },
      ohh:   { steps: pat('..X...X...X...X.'), params: { tone: .5, decay: .45 }, level: .5, send: .1 },
      bass:  { steps: pat('..x...x...x...x.'), notes: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,-2,0], mode: 0,
               params: { cutoff: .5, res: .3, decay: .5 }, level: .8 },
      stab:  { steps: pat('...x......x.....'), params: { chord: 0, cutoff: .6, decay: .35 }, level: .5, send: .5 },
    },
  },
  deep: {
    bpm: 127, swing: 56, pump: .55,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), params: { tune: .3, decay: .55, drive: .45 }, level: .95, send: .7 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .38, decay: .45 }, level: .42, send: .45 },
      chh:   { steps: pat('..x...x...x...x.'), params: { tone: .42, decay: .32 }, level: .38 },
      nse:   { steps: pat('x.x.x.x.x.x.x.x.'), params: { tone: .5, decay: .04 }, level: .14 },
      bass:  { steps: pat('.xx..xx..xx..xx.'), notes: new Array(STEPS).fill(0), mode: 1,
               params: { cutoff: .35, res: .5, decay: .45 }, level: .85, send: .3 },
      stab:  { steps: pat('..............x.'), params: { chord: .6, cutoff: .4, decay: .5 }, level: .4, send: .85 },
    },
  },
  techno: {
    bpm: 132, swing: 52, pump: .4,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), params: { tune: .35, decay: .42, drive: .55 }, level: .95, send: .5 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .35, decay: .4 }, level: .5, send: .35 },
      chh:   { steps: pat('x.X.x.X.x.X.x.X.'), params: { tone: .62, decay: .25 }, level: .45 },
      bass:  { steps: pat('.xxx.xxx.xxx.xxx'), notes: new Array(STEPS).fill(0), mode: 1,
               params: { cutoff: .3, res: .55, decay: .25 }, level: .75, send: .2 },
      stab:  { steps: pat('..........x.....'), params: { chord: 1, cutoff: .45, decay: .3 }, level: .45, send: .7 },
      nse:   { steps: pat('............x...'), params: { tone: .6, decay: .8 }, level: .22, send: .5 },
    },
  },
  edm: {
    bpm: 128, swing: 50, pump: .7,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), params: { tune: .5, decay: .6, drive: .45 }, level: .95 },
      clap:  { steps: pat('....X.......X...'), params: { tone: .55, decay: .55 }, level: .8, send: .35 },
      chh:   { steps: pat('x.x.x.x.x.x.x.x.'), params: { tone: .5, decay: .3 }, level: .4 },
      ohh:   { steps: pat('..x...x...x...x.'), params: { tone: .5, decay: .4 }, level: .45 },
      bass:  { steps: pat('..x...x...x...x.'), notes: new Array(STEPS).fill(0), mode: 0,
               params: { cutoff: .6, res: .35, decay: .6 }, level: .85 },
      stab:  { steps: pat('x...x...x...x...'), params: { chord: .34, cutoff: .7, decay: .5 }, level: .55, send: .4 },
      nse:   { steps: pat('............x...'), params: { tone: .7, decay: .9 }, level: .28, send: .55 },
    },
  },
  dnb: {
    bpm: 174, swing: 53, pump: .15,
    tracks: {
      kick:  { steps: pat('X.........X.....'), params: { tune: .5, decay: .15, drive: .4 }, level: .9, send: .1 },
      snare: { steps: pat('....X.......X...'), params: { tone: .6, decay: .5 }, level: .85, send: .2 },
      chh:   { steps: pat('x.x.x.x.xx.x.x.x'), params: { tone: .6, decay: .3 }, level: .4 },
      ohh:   { steps: pat('......x.......x.'), params: { tone: .5, decay: .35 }, level: .3 },
      bass:  { steps: pat('x.........x..x..'), notes: [0,0,0,0,0,0,0,0,0,0,-2,0,0,-4,0,0], mode: 2,
               params: { cutoff: .35, res: .5, decay: .85 }, level: .85 },
      nse:   { steps: pat('........x.......'), params: { tone: .4, decay: .7 }, level: .2, send: .6 },
    },
  },
};

export const PRESET_ORDER = ['house', 'deep', 'techno', 'edm', 'dnb'];

// Mutates `state` in place (shared reference is held by engine/ui).
export function applyPreset(state, name) {
  const p = PRESETS[name];
  if (!p) return;
  const fresh = defaultState();
  for (const [id, over] of Object.entries(p.tracks)) {
    const tr = fresh.tracks[id];
    if (over.steps) tr.steps = over.steps.slice();
    if (over.notes) tr.notes = over.notes.slice();
    if (over.mode !== undefined) tr.mode = over.mode;
    if (over.params) tr.params = { ...tr.params, ...over.params };
    if (over.level !== undefined) tr.level = over.level;
    if (over.send !== undefined) tr.send = over.send;
  }
  // the sample track belongs to the user, presets never touch it
  fresh.tracks.smp = state.tracks.smp;
  state.bpm = p.bpm; state.swing = p.swing; state.pump = p.pump;
  state.tracks = fresh.tracks;
}

// ---------- constrained random ----------
// Per-track probability of a hit at each of the 16 positions, so RND stays musical.
function maskOf(shape) { return Array.from({ length: STEPS }, (_, i) => shape(i)); }

const RND_MASKS = {
  kick:  maskOf(i => i % 4 === 0 ? .85 : i % 4 === 2 ? .15 : .05),
  snare: maskOf(i => (i === 4 || i === 12) ? .55 : .06),
  clap:  maskOf(i => (i === 4 || i === 12) ? .6 : .03),
  chh:   maskOf(i => i % 2 === 0 ? .6 : .3),
  ohh:   maskOf(i => i % 4 === 2 ? .5 : .04),
  bass:  maskOf(i => i % 4 === 2 ? .5 : .22),
  stab:  maskOf(i => .12),
  nse:   maskOf(i => .04),
};
const PENT = [-12, -5, -2, 0, 3, 5, 7, 10, 12];      // A minor pentatonic offsets

export function randomize(state, only) {
  for (const t of TRACKS) {
    if (!RND_MASKS[t.id]) continue;                  // smp is never randomized
    if (only && t.id !== only) continue;
    const tr = state.tracks[t.id];
    const mask = RND_MASKS[t.id];
    tr.steps = mask.map(p => Math.random() < p ? (Math.random() < .2 ? 2 : 1) : 0);
    if (tr.notes) {
      tr.notes = tr.notes.map(() => PENT[Math.floor(Math.random() * PENT.length)]);
    }
  }
  if (!state.tracks.kick.steps.some(v => v)) state.tracks.kick.steps[0] = 2;
}

// ---------- persistence ----------

export function serialize(state) {
  return btoa(encodeURIComponent(JSON.stringify(state)));
}

export function deserialize(str) {
  try {
    const obj = JSON.parse(decodeURIComponent(atob(str)));
    if (!obj || (obj.v !== 1 && obj.v !== 2) || !obj.tracks) return null;
    // merge over defaults so missing fields never break the app
    const base = defaultState();
    base.bpm = clamp(+obj.bpm || 124, 60, 200);
    base.swing = clamp(+obj.swing || 50, 50, 75);
    if (typeof obj.master === 'number') base.master = clamp(obj.master, 0, 1);
    if (typeof obj.pump === 'number') base.pump = clamp(obj.pump, 0, 1);
    if (typeof obj.filter === 'number') base.filter = clamp(obj.filter, -1, 1);
    for (const t of TRACKS) {
      const src = obj.tracks[t.id];
      if (!src) continue;
      const dst = base.tracks[t.id];
      if (Array.isArray(src.steps)) dst.steps = normSteps(src.steps);
      if (t.notes && Array.isArray(src.notes)) dst.notes = normInts(src.notes, -12, 12);
      if (t.slices && Array.isArray(src.slices)) dst.slices = normInts(src.slices, 0, 15);
      if (t.modes && typeof src.mode === 'number') dst.mode = clamp(Math.round(src.mode), 0, BASS_MODES.length - 1);
      if (typeof src.level === 'number') dst.level = clamp(src.level, 0, 1);
      if (typeof src.send === 'number') dst.send = clamp(src.send, 0, 1);
      dst.mute = !!src.mute;
      if (src.params) {
        for (const k of Object.keys(dst.params)) {
          if (typeof src.params[k] === 'number') dst.params[k] = clamp(src.params[k], 0, 1);
        }
      }
    }
    return base;
  } catch {
    return null;
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo)); }
function normSteps(a) {
  return Array.from({ length: STEPS }, (_, i) => [0, 1, 2].includes(a[i]) ? a[i] : 0);
}
function normInts(a, lo, hi) {
  return Array.from({ length: STEPS }, (_, i) => clamp(Math.round(a[i] || 0), lo, hi));
}

export function saveLocal(state) {
  try { localStorage.setItem(STORAGE_KEY, serialize(state)); } catch { /* private mode */ }
}

export function loadInitialState() {
  const hash = location.hash.slice(1);
  if (hash) {
    const s = deserialize(hash);
    if (s) return s;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
      || localStorage.getItem('weaver.state.v1');   // migrate v1 saves
    if (stored) {
      const s = deserialize(stored);
      if (s) return s;
    }
  } catch { /* private mode */ }
  const s = defaultState();
  applyPreset(s, 'house');
  return s;
}
