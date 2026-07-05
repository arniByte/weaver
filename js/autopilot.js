// autopilot.js — self-mixing DJ. A bar-clock state machine that runs the set
// the way club DJs actually do it:
//   · phrase-locked: subtle tweak every 4 bars, audible every 8, structural every 16
//   · element-by-element morph: hats → fx/stab → snare/clap → (kick+bass LAST, atomically)
//   · THE BASS RULE: exactly one groove owns the low end at any moment; the
//     outgoing bass is eased down before the swap, never doubled
//   · a snare/clap roll builds the last bar before every drop
//   · tempo: bend ~1 BPM/bar inside the 4/4 family; to/from DnB via kickless
//     break + halftime snare trick (174 reads as 87 — no ramp needed)
//   · energy arc: deep start → build → peak → contrast → release
//   · user samples: rotated in and out of scenes as sliced textures

import { PRESETS, defaultState, randomize, tile, STEPS, BAR } from './state.js';

const ARC = ['deep', 'house', 'house', 'deep', 'techno', 'techno', 'edm', 'techno', 'dnb', 'dnb', 'house'];
const TRANS_BARS = 8;
// snare on beat 3 of every bar (steps 8 and 24) — the halftime feel
const HALFTIME = (() => { const a = new Array(STEPS).fill(0); for (let i = 8; i < STEPS; i += BAR) a[i] = 2; return a; })();

// Curated slice patterns for the user-sample track (one bar, tiled to 2 bars).
const SP_PATTERNS = [
  { steps: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    slices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    slices: [0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14] },
  { steps: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    slices: [0, 0, 0, 3, 0, 0, 6, 0, 0, 0, 10, 0, 12, 0, 0, 15] },
  { steps: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    slices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
].map(p => ({ steps: tile(p.steps, STEPS), slices: tile(p.slices, STEPS) }));

export class AutoPilot {
  constructor(state, engine, ui) {   // ui: { refresh(), status(text) }
    this.state = state;
    this.engine = engine;
    this.ui = ui;
    this.on = false;
    this._restores = [];              // {bars, fn} — fn runs when bars hits 0
    this._lastFill = false;
    this._lastVar = -1;
    this._smpIdx = -1;
    this._smpOn = false;
  }

  enable(startGenre) {
    this.on = true;
    const i = ARC.indexOf(startGenre);
    this.arcPos = i >= 0 ? i : 0;
    this.phase = 'play';
    this.bar = 0;
    this.engine.onBar = () => this._tick();
    this.ui.status(this._label());
  }

  disable() {
    this.on = false;
    this.engine.onBar = null;
    for (const r of this._restores) r.fn();
    this._restores = [];
    if (this.phase !== 'play') {
      // mid-transition the machine holds kick/bass muted — never leave it that way
      for (const id of ['kick', 'bass']) {
        this.state.tracks[id].mute = false;
        this.engine.applyMix(id);
      }
      this.phase = 'play';
    }
    this.state.filter = 0;
    this.engine.setFilter(0);
    this.ui.status('');
    this.ui.refresh();
  }

  cur() { return ARC[this.arcPos % ARC.length]; }
  nxt() { return ARC[(this.arcPos + 1) % ARC.length]; }
  bars() { return Math.max(8, this.state.autoBars || 32); }

  _tick() {
    if (!this.on) return;
    this._runRestores();
    if (this.phase === 'play') this._playBar();
    else this._transBar();
    this.ui.status(this._label());
    this.ui.refresh();
  }

  _label() {
    const g = this.cur().toUpperCase();
    const sp = this._smpOn ? ' +SP' : '';
    if (this.phase === 'play') {
      return `AUTO ${g}${sp} ${String((this.bar % this.bars()) + 1).padStart(2, '0')}/${this.bars()}`;
    }
    const mode = this.phase === 'break' ? 'BREAK' : 'BLEND';
    return `AUTO ${g}→${this.nxt().toUpperCase()} ${mode} ${Math.min(this.bar + 1, 8)}/8${sp}`;
  }

  // run fn after n bars (restores 1-bar stunts and 2-bar risers alike)
  _after(bars, fn) { this._restores.push({ bars, fn }); }

  _runRestores() {
    const due = [];
    for (const r of this._restores) if (--r.bars <= 0) due.push(r);
    this._restores = this._restores.filter(r => r.bars > 0);
    for (const r of due) r.fn();
  }

  // ---------- PLAY: keep the loop alive ----------

  _playBar() {
    const b = this.bar++;
    if (b >= this.bars()) {
      this.bar = 0;
      const jump = Math.abs(PRESETS[this.cur()].bpm - PRESETS[this.nxt()].bpm);
      this.phase = jump > 10 ? 'break' : 'trans';
      return this._transBar();
    }

    if (b > 0 && b % 16 === 0) {
      this.state.filter = 0;
      this.engine.setFilter(0);
      this._maybeSample(0.45);
      if (Math.random() < 0.4) randomize(this.state, Math.random() < 0.5 ? 'chh' : 'ohh');
      return;
    }

    if ((b + 1) % 16 === 0) {
      // last bar of a 16-phrase: dropout or fill, all back on the 1
      const roll = Math.random();
      if (roll < 0.35) this._dropout();
      else if (roll < 0.6 && !this._lastFill) { this._fill(); this._lastFill = true; }
      else this._lastFill = false;
      return;
    }
    if ((b + 1) % 8 === 0) {
      if (Math.random() < 0.3 && !this._lastFill) { this._fill(); this._lastFill = true; }
      else this._lastFill = false;
      return;
    }

    if (b % 8 === 4) this._audibleVariation();
    else if (b % 4 === 2) this._subtleDrift();
  }

  _subtleDrift() {
    const s = this.state;
    s.filter = Math.max(-0.2, Math.min(0.2, (Math.random() - 0.5) * 0.24));
    this.engine.setFilter(s.filter);
    const bs = s.tracks.bass.params;
    bs.cutoff = Math.max(0.15, Math.min(0.85, bs.cutoff + (Math.random() - 0.5) * 0.1));
  }

  _audibleVariation() {
    const s = this.state;
    let pick;
    do { pick = Math.floor(Math.random() * 4); } while (pick === this._lastVar);
    this._lastVar = pick;
    if (pick === 0) {
      // toggle an offbeat open hat somewhere across the 2 bars
      const i = 2 + 4 * Math.floor(Math.random() * (STEPS / 4));
      s.tracks.ohh.steps[i] = s.tracks.ohh.steps[i] ? 0 : 1;
    } else if (pick === 1) {
      // delay throw on the lead / stab / clap for one bar
      const cand = ['lead', 'stab', 'clap'].filter(id => s.tracks[id] && s.tracks[id].steps.some(v => v));
      const id = cand[Math.floor(Math.random() * cand.length)] || 'clap';
      const prev = s.tracks[id].send;
      s.tracks[id].send = Math.min(1, prev + 0.35);
      this.engine.applyMix(id);
      this._after(1, () => { s.tracks[id].send = prev; this.engine.applyMix(id); });
    } else if (pick === 2) {
      // hat density: add/remove a 16th
      const i = 1 + 2 * Math.floor(Math.random() * (STEPS / 2));
      s.tracks.chh.steps[i] = s.tracks.chh.steps[i] ? 0 : 1;
    } else {
      this._subtleDrift();
    }
  }

  _dropout() {
    // everything but the kick out for exactly one bar; all back on the 1
    const s = this.state;
    for (const id of Object.keys(s.tracks)) {
      if (id === 'kick' || s.tracks[id].mute) continue;
      s.tracks[id].mute = true;
      this.engine.applyMix(id);
      this._after(1, () => { s.tracks[id].mute = false; this.engine.applyMix(id); });
    }
  }

  _fill() {
    // snare/clap roll over the last quarter of the 2-bar pattern (steps 24..31)
    const s = this.state;
    const id = this.cur() === 'dnb' ? 'snare' : (s.tracks.clap.steps.some(v => v) ? 'clap' : 'snare');
    const tr = s.tracks[id];
    const prevSteps = tr.steps.slice();
    const prevMute = tr.mute;
    tr.mute = false;
    const roll = tr.steps.slice();
    const tail = [0, 0, 1, 0, 1, 1, 2, 2];
    for (let i = 0; i < tail.length; i++) roll[STEPS - tail.length + i] = tail[i];
    tr.steps = roll;
    this.engine.applyMix(id);
    this._after(1, () => {
      // tr may have been replaced by an adopt; restore only if it's still ours
      if (s.tracks[id] === tr) { tr.steps = prevSteps; tr.mute = prevMute; }
      this.engine.applyMix(id);
    });
  }

  // ---------- user samples ----------

  _maybeSample(prob) {
    const pool = this.engine.samples;
    if (!pool || !pool.length) return;
    const s = this.state.tracks.smp;
    if (Math.random() < prob) {
      this._smpIdx = (this._smpIdx + 1) % pool.length;
      this.engine.activeSample = this._smpIdx;
      const pat = SP_PATTERNS[Math.floor(Math.random() * SP_PATTERNS.length)];
      s.steps = pat.steps.slice();
      s.slices = pat.slices.slice();
      s.params = { ...s.params, tune: 0.5, decay: 0.55 };
      s.level = 0.62;
      s.send = 0.18;
      s.mute = false;
      this._smpOn = true;
    } else {
      s.mute = true;
      this._smpOn = false;
    }
    this.engine.applyMix('smp');
  }

  // ---------- TRANSITIONS ----------

  _trackFrom(name, id) {
    const d = defaultState().tracks[id];
    const o = PRESETS[name].tracks[id];
    if (o) {
      if (o.steps) d.steps = o.steps.slice();
      if (o.notes) d.notes = o.notes.slice();
      if (o.mode !== undefined) d.mode = o.mode;
      if (o.params) d.params = { ...d.params, ...o.params };
      if (o.level !== undefined) d.level = o.level;
      if (o.send !== undefined) d.send = o.send;
    }
    return d;
  }

  _adopt(name, ids) {
    for (const id of ids) {
      this.state.tracks[id] = this._trackFrom(name, id);
      this.engine.applyMix(id);
    }
  }

  _riser() {
    const nse = this.state.tracks.nse;
    const prev = { steps: nse.steps.slice(), params: { ...nse.params }, level: nse.level, send: nse.send, mute: nse.mute };
    nse.mute = false;
    nse.steps = tile([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1], STEPS);
    nse.params = { tone: 0.65, decay: 0.85 };
    nse.level = 0.3;
    nse.send = 0.55;
    this.engine.applyMix('nse');
    this._after(2, () => {
      const cur = this.state.tracks.nse;
      if (cur === nse) Object.assign(nse, { steps: prev.steps, params: prev.params, level: prev.level, send: prev.send, mute: prev.mute });
      this.engine.applyMix('nse');
    });
  }

  _setBpm(v) {
    this.state.bpm = Math.round(v);
    this.engine.updateDelayTime();
  }

  _setFilter(v) {
    this.state.filter = v;
    this.engine.setFilter(v);
  }

  _finishTransition(B) {
    const t = PRESETS[B];
    this._adopt(B, ['kick', 'bass', 'snare', 'clap', 'chh', 'ohh', 'lead', 'pluck', 'stab', 'nse']); // the drop: full new groove
    this._setBpm(t.bpm);
    this.state.swing = t.swing;
    this.state.pump = t.pump;
    this._setFilter(0);
    this.engine.primeDrums();
    this.arcPos++;
    this.phase = 'play';
    this.bar = 1;                 // the drop bar is bar 1 of the new groove
    this._lastFill = false;
    this._maybeSample(0.35);
  }

  // standard 8-bar blend inside the 4/4 family: elements swap in DJ order,
  // BPM bends ~1 per bar, outgoing bass eases down, kick+bass swap LAST.
  _transBar() {
    if (this.phase === 'break') return this._breakBar();
    const b = this.bar++;
    const A = this.cur(), B = this.nxt();
    const from = PRESETS[A].bpm, to = PRESETS[B].bpm;
    this._setBpm(from + (to - from) * Math.min(1, (b + 1) / TRANS_BARS));
    this.state.swing = Math.round(PRESETS[A].swing + (PRESETS[B].swing - PRESETS[A].swing) * Math.min(1, (b + 1) / TRANS_BARS));

    if (b === 0) this._adopt(B, ['chh', 'ohh']);                  // percussion first
    else if (b === 2) this._adopt(B, ['stab', 'nse', 'lead', 'pluck']); // melodic identity
    else if (b === 4) this._adopt(B, ['snare', 'clap']);  // backbeat
    else if (b === 5) {
      this._setFilter(0.12);                              // thin the blend out…
      this.state.tracks.bass.level *= 0.8;                // …ease the old bass down
      this.engine.applyMix('bass');
    } else if (b === 6) {
      this._setFilter(0.25);
      this._riser();
      this.state.tracks.bass.level *= 0.8;
      this.engine.applyMix('bass');
    } else if (b === 7) {
      this._setFilter(0.38);
      this._fill();                                       // roll into the drop
    } else if (b >= TRANS_BARS) {
      this._finishTransition(B);                          // …snap open on the 1
    }
  }

  // big BPM jump (into/out of DnB): strip lows, retempo inside the kickless
  // break (no kick = no tempo anchor), halftime snare bridges the feel, drop.
  _breakBar() {
    const b = this.bar++;
    const A = this.cur(), B = this.nxt();
    const s = this.state;
    if (b === 0) {
      s.tracks.bass.mute = true;                          // bass rule: lows out first
      this.engine.applyMix('bass');
    } else if (b === 1) {
      this._setFilter(-0.2);
    } else if (b === 2) {
      s.tracks.kick.mute = true;
      this.engine.applyMix('kick');
      if (A === 'dnb') {                                  // leaving 174: halftime feel
        s.tracks.snare.mute = false;
        s.tracks.snare.steps = HALFTIME.slice();
        this.engine.applyMix('snare');
      }
      this._setFilter(-0.35);
    } else if (b === 3) {
      this._setFilter(-0.5);
    } else if (b === 4) {
      this._setBpm(PRESETS[B].bpm);                       // silent retempo
      this._adopt(B, ['chh', 'ohh', 'stab', 'lead', 'pluck']);
      if (B === 'dnb') {                                  // entering 174: halftime snare
        const sn = this._trackFrom(B, 'snare');
        sn.steps = HALFTIME.slice();
        s.tracks.snare = sn;
        this.engine.applyMix('snare');
      }
      this._setFilter(0.3);
    } else if (b === 6) {
      this._riser();
      this._setFilter(0.2);
    } else if (b === 7) {
      this._fill();                                       // roll into the drop
    } else if (b >= 8) {
      this._finishTransition(B);
    }
  }
}
