// state.js — data model, genre presets, persistence.
// Step values: 0 = off, 1 = on, 2 = accent. Two bars of sixteenths = 32 steps.

export const STEPS = 32;
export const BAR = 16;                 // steps per musical bar
export const STORAGE_KEY = 'weaver.state.v3';
export const NOTE_LO = -24, NOTE_HI = 24;

// Tracks with `modes` carry alternate sound engines, switched by a button.
// `notes` tracks are tonal (per-step semitone offset from `root`, a MIDI note).
export const TRACKS = [
  { id: 'kick',  label: 'BD', modes: ['909', '808', 'HRD'], params: [['tune', 'TUN'], ['decay', 'DEC'], ['drive', 'DRV']] },
  { id: 'snare', label: 'SD', modes: ['CLS', 'RIM'], params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'clap',  label: 'CP', params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'chh',   label: 'CH', modes: ['MTL', 'NSE'], params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'ohh',   label: 'OH', modes: ['MTL', 'NSE'], params: [['tone', 'TON'], ['decay', 'DEC']] },
  { id: 'bass',  label: 'BS', modes: ['ACD', 'DEP', 'RSE'], params: [['cutoff', 'CUT'], ['res', 'RES'], ['decay', 'DEC']], notes: true, root: 33 },
  { id: 'lead',  label: 'LD', modes: ['SIN', 'TRI', 'SAW', 'SQR'], params: [['cutoff', 'CUT'], ['res', 'RES'], ['decay', 'DEC']], notes: true, root: 57 },
  { id: 'pluck', label: 'PL', modes: ['SIN', 'TRI', 'SAW', 'SQR'], params: [['cutoff', 'CUT'], ['res', 'RES'], ['decay', 'DEC']], notes: true, root: 69 },
  { id: 'stab',  label: 'ST', modes: ['STB', 'CRD', 'PAD'], params: [['chord', 'CHD'], ['cutoff', 'CUT'], ['decay', 'DEC']] },
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
  lead:  { cutoff: .55, res: .35, decay: .45 },
  pluck: { cutoff: .6,  res: .3,  decay: .25 },
  stab:  { chord: 0,  cutoff: .6, decay: .35 },
  nse:   { tone: .5,  decay: .6 },
  smp:   { tune: .5,  ofs: 0, len: 1, decay: .5 },
};

const LEVEL_DEFAULTS = {
  kick: .9, snare: .75, clap: .7, chh: .5, ohh: .45,
  bass: .8, lead: .55, pluck: .5, stab: .55, nse: .4, smp: .8,
};

// pattern strings tile to fill STEPS (a 16-char groove becomes two identical bars)
function pat(s) {
  const out = new Array(STEPS).fill(0);
  for (let i = 0; i < STEPS; i++) {
    const c = s[i % s.length];
    out[i] = c === 'X' ? 2 : c === 'x' ? 1 : 0;
  }
  return out;
}

// tile an array to length n (notes / slices given as one bar → two bars)
export function tile(arr, n = STEPS) {
  return Array.from({ length: n }, (_, i) => arr[i % arr.length]);
}

export function defaultState() {
  const tracks = {};
  for (const t of TRACKS) {
    tracks[t.id] = {
      steps: new Array(STEPS).fill(0),
      notes: t.notes ? new Array(STEPS).fill(0) : undefined,
      slices: t.slices ? Array.from({ length: STEPS }, (_, i) => i % BAR) : undefined,
      mode: t.modes ? 0 : undefined,
      level: LEVEL_DEFAULTS[t.id],
      send: .15,
      mute: false,
      params: { ...PARAM_DEFAULTS[t.id] },
    };
  }
  return { v: 3, bpm: 124, swing: 50, master: .8, pump: .4, filter: 0, autoBars: 32, tracks };
}

// pentatonic + minor scale offsets used by the preset melodies (A minor)
const _ = null; // rest marker readability in note arrays (rests are gated by steps)

export const PRESETS = {
  house: {
    bpm: 124, swing: 57, pump: .45,
    tracks: {
      kick:  { steps: pat('X...x...X...x...'), params: { tune: .45, decay: .45, drive: .35 }, level: .9, send: .15 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .5, decay: .5 }, level: .65, send: .3 },
      chh:   { steps: pat('xx.xxx.xxx.xxx.x'), mode: 1, params: { tone: .55, decay: .3 }, level: .42 },
      ohh:   { steps: pat('..X...X...X...X.'), params: { tone: .5, decay: .45 }, level: .5, send: .1 },
      bass:  { steps: pat('..x...x...x...x.'), notes: tile([0,0,0,0,0,0,0,0,0,0,0,0,0,0,-2,0]), mode: 0,
               params: { cutoff: .5, res: .3, decay: .5 }, level: .8 },
      // a real 2-bar lead line (32 steps) — this is where "development" lives
      lead:  { steps: pat('x..x..x...x..x..x..x..x.x..x.x...'), mode: 1,
               notes: [12,_,_,7,_,_,3,_,_,_,7,_,_,0,_,_,12,_,_,7,_,_,3,_,_,5,_,_,7,_,_,_].map(v => v ?? 0),
               params: { cutoff: .55, res: .3, decay: .3 }, level: .5, send: .3 },
      stab:  { steps: pat('...x......x.....'), params: { chord: 0, cutoff: .6, decay: .35 }, level: .5, send: .5 },
    },
  },
  deep: {
    bpm: 127, swing: 55, pump: .6,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), mode: 1, params: { tune: .32, decay: .55, drive: .42 }, level: .95, send: .82 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .35, decay: .5 }, level: .34, send: .55 },
      chh:   { steps: pat('..x...x...x...x.'), mode: 1, params: { tone: .4, decay: .3 }, level: .34 },
      ohh:   { steps: pat('......x.......x.'), mode: 1, params: { tone: .45, decay: .5 }, level: .26, send: .3 },
      nse:   { steps: pat('x.x.x.x.x.x.x.x.'), params: { tone: .5, decay: .04 }, level: .12 },
      // rolling, moving deep sub — the DEP engine + high send builds the rumble
      bass:  { steps: pat('.xx..x...xx..x..'), notes: tile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, 0]), mode: 1,
               params: { cutoff: .3, res: .55, decay: .5 }, level: .9, send: .35 },
      // evolving dub pad (Am7) — one long chord per bar, drenched in reverb
      stab:  { steps: pat('X...............'), mode: 2, params: { chord: 0, cutoff: .42, decay: .8 }, level: .42, send: .8 },
      // sparse hypnotic motif
      lead:  { steps: pat('........x...............x.......'), mode: 0,
               notes: [_, _, _, _, _, _, _, _, 12, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 10, _, _, _, _, _, _, _].map(v => v ?? 0),
               params: { cutoff: .48, res: .3, decay: .45 }, level: .32, send: .55 },
    },
  },
  techno: {
    bpm: 132, swing: 52, pump: .4,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), params: { tune: .35, decay: .42, drive: .55 }, level: .95, send: .5 },
      clap:  { steps: pat('....x.......x...'), params: { tone: .35, decay: .4 }, level: .5, send: .35 },
      chh:   { steps: pat('x.X.x.X.x.X.x.X.'), params: { tone: .62, decay: .25 }, level: .45 },
      bass:  { steps: pat('.xxx.xxx.xxx.xxx'), notes: tile([0]), mode: 1,
               params: { cutoff: .3, res: .55, decay: .25 }, level: .75, send: .2 },
      lead:  { steps: pat('..............x...............x.'), mode: 2,
               notes: tile([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),
               params: { cutoff: .4, res: .5, decay: .4 }, level: .4, send: .6 },
      stab:  { steps: pat('..........x.....'), mode: 1, params: { chord: 1, cutoff: .45, decay: .4 }, level: .45, send: .7 },
      nse:   { steps: pat('............x...'), params: { tone: .6, decay: .8 }, level: .22, send: .5 },
    },
  },
  edm: {
    bpm: 128, swing: 50, pump: .7,
    tracks: {
      kick:  { steps: pat('X...X...X...X...'), params: { tune: .5, decay: .6, drive: .45 }, level: .95, send: .2 },
      clap:  { steps: pat('....X.......X...'), params: { tone: .55, decay: .55 }, level: .8, send: .35 },
      chh:   { steps: pat('x.x.x.x.x.x.x.x.'), params: { tone: .5, decay: .3 }, level: .4 },
      ohh:   { steps: pat('..x...x...x...x.'), params: { tone: .5, decay: .4 }, level: .45 },
      bass:  { steps: pat('..x...x...x...x.'), notes: tile([0]), mode: 0,
               params: { cutoff: .6, res: .35, decay: .6 }, level: .85 },
      lead:  { steps: pat('x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.'), mode: 2,
               notes: [0,_,3,_,7,_,3,_,0,_,3,_,10,_,7,_,0,_,3,_,7,_,3,_,12,_,10,_,7,_,3,_].map(v => v ?? 0),
               params: { cutoff: .65, res: .3, decay: .3 }, level: .5, send: .35 },
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
      bass:  { steps: pat('x.........x..x..'), notes: tile([0,0,0,0,0,0,0,0,0,0,-2,0,0,-4,0,0]), mode: 2,
               params: { cutoff: .35, res: .5, decay: .85 }, level: .85 },
      lead:  { steps: pat('..x.....x.....x...x.....x.......'), mode: 1,
               notes: [_,_,12,_,_,_,_,_,10,_,_,_,_,_,7,_,_,_,12,_,_,_,_,_,15,_,_,_,_,_,_,_].map(v => v ?? 0),
               params: { cutoff: .5, res: .3, decay: .35 }, level: .42, send: .4 },
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
    if (over.steps) tr.steps = tile(over.steps.slice(), STEPS);
    if (over.notes) tr.notes = tile(over.notes.slice(), STEPS);
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
// Per-track probability of a hit at each position (within-bar), so RND stays musical.
function maskOf(shape) { return Array.from({ length: STEPS }, (_, i) => shape(i % BAR, i)); }

const RND_MASKS = {
  kick:  maskOf(b => b % 4 === 0 ? .85 : b % 4 === 2 ? .15 : .05),
  snare: maskOf(b => (b === 4 || b === 12) ? .55 : .06),
  clap:  maskOf(b => (b === 4 || b === 12) ? .6 : .03),
  chh:   maskOf(b => b % 2 === 0 ? .6 : .3),
  ohh:   maskOf(b => b % 4 === 2 ? .5 : .04),
  bass:  maskOf(b => b % 4 === 2 ? .5 : .22),
  lead:  maskOf(b => b % 4 === 0 ? .3 : .12),
  pluck: maskOf(b => b % 2 === 1 ? .22 : .08),
  stab:  maskOf(() => .1),
  nse:   maskOf(() => .04),
};
const PENT = [-12, -7, -5, -2, 0, 3, 5, 7, 10, 12, 15];   // A minor pentatonic-ish

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
// v4 wire format: compact binary → base64url, prefixed "w4." (32-step).
// Legacy "w3." (16-step) and v1/v2 JSON links up-convert (bar tiled to 2 bars).

const q = v => Math.max(0, Math.min(100, Math.round(v * 100)));

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(state) {
  const b = [4,
    Math.round(state.bpm) - 60,
    Math.round(state.swing) - 50,
    q(state.master), q(state.pump),
    Math.round((state.filter + 1) * 100),
    state.autoBars || 32,
  ];
  for (const t of TRACKS) {
    const tr = state.tracks[t.id];
    for (let k = 0; k < STEPS / 4; k++) {          // 8 bytes, 4 steps each
      let v = 0;
      for (let i = 0; i < 4; i++) v |= (tr.steps[k * 4 + i] & 3) << (i * 2);
      b.push(v);
    }
    b.push((tr.mute ? 1 : 0) | ((tr.mode || 0) << 1));
    b.push(q(tr.level), q(tr.send));
    for (const [key] of t.params) b.push(q(tr.params[key]));
    if (t.notes) for (let i = 0; i < STEPS; i++) b.push(tr.notes[i] - NOTE_LO);
    if (t.slices) for (let i = 0; i < STEPS; i++) b.push(tr.slices[i] & 15);
  }
  return 'w4.' + b64urlEncode(b);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo)); }

function deserializeV4(str) {
  const b = b64urlDecode(str);
  let i = 0;
  const need = n => { if (i + n > b.length) throw new Error('short'); };
  need(7);
  if (b[i++] !== 4) return null;
  const base = defaultState();
  base.bpm = clamp(b[i++] + 60, 60, 200);
  base.swing = clamp(b[i++] + 50, 50, 75);
  base.master = clamp(b[i++] / 100, 0, 1);
  base.pump = clamp(b[i++] / 100, 0, 1);
  base.filter = clamp(b[i++] / 100 - 1, -1, 1);
  base.autoBars = clamp(b[i++], 8, 64);
  for (const t of TRACKS) {
    const tr = base.tracks[t.id];
    need(STEPS / 4);
    for (let k = 0; k < STEPS / 4; k++) {
      const v = b[i++];
      for (let s = 0; s < 4; s++) {
        const sv = (v >> (s * 2)) & 3;
        tr.steps[k * 4 + s] = sv === 3 ? 0 : sv;
      }
    }
    need(3 + t.params.length);
    const flags = b[i++];
    tr.mute = !!(flags & 1);
    if (t.modes) tr.mode = clamp(flags >> 1, 0, t.modes.length - 1);
    tr.level = clamp(b[i++] / 100, 0, 1);
    tr.send = clamp(b[i++] / 100, 0, 1);
    for (const [key] of t.params) tr.params[key] = clamp(b[i++] / 100, 0, 1);
    if (t.notes) { need(STEPS); for (let s = 0; s < STEPS; s++) tr.notes[s] = clamp(b[i++] + NOTE_LO, NOTE_LO, NOTE_HI); }
    if (t.slices) { need(STEPS); for (let s = 0; s < STEPS; s++) tr.slices[s] = clamp(b[i++], 0, 15); }
  }
  return base;
}

// old 16-step binary — decode into a bar, then tile to two bars
function deserializeV3(str) {
  const b = b64urlDecode(str);
  let i = 0;
  const OLD = 16;
  const need = n => { if (i + n > b.length) throw new Error('short'); };
  need(7);
  if (b[i++] !== 3) return null;
  const base = defaultState();
  base.bpm = clamp(b[i++] + 60, 60, 200);
  base.swing = clamp(b[i++] + 50, 50, 75);
  base.master = clamp(b[i++] / 100, 0, 1);
  base.pump = clamp(b[i++] / 100, 0, 1);
  base.filter = clamp(b[i++] / 100 - 1, -1, 1);
  base.autoBars = clamp(b[i++], 8, 64);
  const OLD_TRACKS = ['kick', 'snare', 'clap', 'chh', 'ohh', 'bass', 'stab', 'nse', 'smp'];
  const byId = Object.fromEntries(TRACKS.map(t => [t.id, t]));
  for (const id of OLD_TRACKS) {
    const t = byId[id]; if (!t) continue;
    const tr = base.tracks[id];
    const steps = new Array(OLD).fill(0);
    need(OLD / 4);
    for (let k = 0; k < OLD / 4; k++) {
      const v = b[i++];
      for (let s = 0; s < 4; s++) { const sv = (v >> (s * 2)) & 3; steps[k * 4 + s] = sv === 3 ? 0 : sv; }
    }
    tr.steps = tile(steps, STEPS);
    need(3 + t.params.length);
    const flags = b[i++];
    tr.mute = !!(flags & 1);
    if (t.modes) tr.mode = clamp(flags >> 1, 0, t.modes.length - 1);
    tr.level = clamp(b[i++] / 100, 0, 1);
    tr.send = clamp(b[i++] / 100, 0, 1);
    for (const [key] of t.params) tr.params[key] = clamp(b[i++] / 100, 0, 1);
    if (t.notes) { const n = []; need(OLD); for (let s = 0; s < OLD; s++) n.push(clamp(b[i++] - 12, NOTE_LO, NOTE_HI)); tr.notes = tile(n, STEPS); }
    if (t.slices) { const n = []; need(OLD); for (let s = 0; s < OLD; s++) n.push(clamp(b[i++], 0, 15)); tr.slices = tile(n, STEPS); }
  }
  return base;
}

function deserializeLegacy(str) {
  const obj = JSON.parse(decodeURIComponent(atob(str)));
  if (!obj || (obj.v !== 1 && obj.v !== 2) || !obj.tracks) return null;
  const base = defaultState();
  base.bpm = clamp(+obj.bpm || 124, 60, 200);
  base.swing = clamp(+obj.swing || 50, 50, 75);
  if (typeof obj.master === 'number') base.master = clamp(obj.master, 0, 1);
  if (typeof obj.pump === 'number') base.pump = clamp(obj.pump, 0, 1);
  if (typeof obj.filter === 'number') base.filter = clamp(obj.filter, -1, 1);
  if (typeof obj.autoBars === 'number') base.autoBars = clamp(Math.round(obj.autoBars), 8, 64);
  for (const t of TRACKS) {
    const src = obj.tracks[t.id];
    if (!src) continue;
    const dst = base.tracks[t.id];
    if (Array.isArray(src.steps)) dst.steps = tile(src.steps.map(v => [0, 1, 2].includes(v) ? v : 0), STEPS);
    if (t.notes && Array.isArray(src.notes)) dst.notes = tile(src.notes.map(v => clamp(Math.round(v || 0), NOTE_LO, NOTE_HI)), STEPS);
    if (t.slices && Array.isArray(src.slices)) dst.slices = tile(src.slices.map(v => clamp(Math.round(v || 0), 0, 15)), STEPS);
    if (t.modes && typeof src.mode === 'number') dst.mode = clamp(Math.round(src.mode), 0, t.modes.length - 1);
    if (typeof src.level === 'number') dst.level = clamp(src.level, 0, 1);
    if (typeof src.send === 'number') dst.send = clamp(src.send, 0, 1);
    dst.mute = !!src.mute;
    if (src.params) for (const k of Object.keys(dst.params)) if (typeof src.params[k] === 'number') dst.params[k] = clamp(src.params[k], 0, 1);
  }
  return base;
}

export function deserialize(str) {
  try {
    if (str.startsWith('w4.')) return deserializeV4(str.slice(3));
    if (str.startsWith('w3.')) return deserializeV3(str.slice(3));
    return deserializeLegacy(str);
  } catch {
    return null;
  }
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
      || localStorage.getItem('weaver.state.v2')
      || localStorage.getItem('weaver.state.v1');
    if (stored) {
      const s = deserialize(stored);
      if (s) return s;
    }
  } catch { /* private mode */ }
  const s = defaultState();
  applyPreset(s, 'house');
  return s;
}
