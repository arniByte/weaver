// autopilot.js — self-mixing DJ. A bar-clock state machine that runs the set
// the way club DJs actually do it:
//   · phrase-locked: subtle tweak every 4 bars, audible every 8, structural every 16
//   · element-by-element morph: hats → fx/stab → snare/clap → (kick+bass LAST, atomically)
//   · THE BASS RULE: exactly one groove owns the low end at any moment
//   · tempo: bend ≤1 BPM/bar inside 4/4 family; to/from DnB via kickless break
//     + halftime snare trick (174 reads as 87 — no ramp needed)
//   · energy arc: deep start → build → peak → contrast → release

import { PRESETS, defaultState, randomize } from './state.js';

const ARC = ['deep', 'house', 'house', 'deep', 'techno', 'techno', 'edm', 'techno', 'dnb', 'dnb', 'house'];
const PLAY_BARS = 32;         // two 16-bar grooves per scene
const TRANS_BARS = 8;         // 4/4 ↔ 4/4 morph
const HALFTIME = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]; // snare on beat 3 only

export class AutoPilot {
  constructor(state, engine, ui) {   // ui: { refresh(), status(text) }
    this.state = state;
    this.engine = engine;
    this.ui = ui;
    this.on = false;
    this._restores = [];
    this._lastFill = false;
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
    this._runRestores();
    this.state.filter = 0;
    this.engine.setFilter(0);
    this.ui.status('');
    this.ui.refresh();
  }

  cur() { return ARC[this.arcPos % ARC.length]; }
  nxt() { return ARC[(this.arcPos + 1) % ARC.length]; }

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
    if (this.phase === 'play') return `AUTO ${g} ${String((this.bar % PLAY_BARS) + 1).padStart(2, '0')}/${PLAY_BARS}`;
    const mode = this.phase === 'break' ? 'BREAK' : 'BLEND';
    return `AUTO ${g}→${this.nxt().toUpperCase()} ${mode} ${this.bar + 1}/${this._transLen()}`;
  }

  _transLen() { return this.phase === 'break' ? 8 : TRANS_BARS; }

  // ---------- PLAY: keep the loop alive ----------

  _playBar() {
    const b = this.bar++;
    if (b >= PLAY_BARS) {
      this.bar = 0;
      const jump = Math.abs(PRESETS[this.cur()].bpm - PRESETS[this.nxt()].bpm);
      this.phase = jump > 10 ? 'break' : 'trans';
      return this._tick2();
    }
    const p16 = b % 16;

    if (p16 === 15) {
      // last bar of the phrase: fill or dropout (never two fills in a row)
      const roll = Math.random();
      if (roll < 0.3 && !this._lastFill) { this._fill(); this._lastFill = true; }
      else if (roll < 0.55) { this._dropout(); this._lastFill = false; }
      else this._lastFill = false;
      return;
    }

    if (b === 16 && Math.random() < 0.4) {
      // switch-up 16 bars in: re-roll one hat lane, constrained
      randomize(this.state, Math.random() < 0.5 ? 'chh' : 'ohh');
    }

    if (p16 % 8 === 4) this._audibleVariation();
    else if (p16 % 4 === 0 && p16 !== 0) this._subtleDrift();
    else if (p16 === 0) {
      this.state.filter = 0;
      this.engine.setFilter(0);
    }
  }

  _tick2() {  // re-enter after a phase change without waiting a bar
    if (this.phase === 'play') this._playBar();
    else this._transBar();
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
    const pick = Math.random();
    if (pick < 0.35) {
      // toggle an offbeat open hat
      const i = [2, 6, 10, 14][Math.floor(Math.random() * 4)];
      s.tracks.ohh.steps[i] = s.tracks.ohh.steps[i] ? 0 : 1;
    } else if (pick < 0.6) {
      // delay throw on the stab (or clap) for one bar
      const id = s.tracks.stab.steps.some(v => v) ? 'stab' : 'clap';
      const prev = s.tracks[id].send;
      s.tracks[id].send = Math.min(1, prev + 0.35);
      this.engine.applyMix(id);
      this._restores.push(() => { s.tracks[id].send = prev; this.engine.applyMix(id); });
    } else if (pick < 0.8) {
      // hat density: add/remove a 16th
      const i = [1, 3, 5, 7, 9, 11, 13, 15][Math.floor(Math.random() * 8)];
      s.tracks.chh.steps[i] = s.tracks.chh.steps[i] ? 0 : 1;
    } else {
      this._subtleDrift();
    }
  }

  _dropout() {
    // everything but the kick out for exactly one bar; all back on the 1
    const s = this.state;
    for (const id of Object.keys(s.tracks)) {
      if (id === 'kick' || id === 'smp' || s.tracks[id].mute) continue;
      s.tracks[id].mute = true;
      this.engine.applyMix(id);
      this._restores.push(() => { s.tracks[id].mute = false; this.engine.applyMix(id); });
    }
  }

  _fill() {
    // snare/clap roll over the back half of the bar
    const s = this.state;
    const id = this.cur() === 'dnb' ? 'snare' : (s.tracks.clap.steps.some(v => v) ? 'clap' : 'snare');
    const tr = s.tracks[id];
    const prev = tr.steps.slice();
    const prevMute = tr.mute;
    tr.mute = false;
    tr.steps = prev.slice(0, 8).concat([0, 0, 1, 0, 1, 1, 2, 2]);
    this.engine.applyMix(id);
    this._restores.push(() => { tr.steps = prev; tr.mute = prevMute; this.engine.applyMix(id); });
  }

  _runRestores() {
    for (const fn of this._restores) fn();
    this._restores = [];
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
    nse.steps = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1];
    nse.params = { tone: 0.65, decay: 0.85 };
    nse.level = 0.3;
    nse.send = 0.55;
    this.engine.applyMix('nse');
    this._restores.push(() => {
      Object.assign(nse, { steps: prev.steps, params: prev.params, level: prev.level, send: prev.send, mute: prev.mute });
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
    this._adopt(B, ['kick', 'bass', 'snare', 'clap', 'chh', 'ohh', 'stab', 'nse']); // the drop: full new groove
    this._setBpm(t.bpm);
    this.state.swing = t.swing;
    this.state.pump = t.pump;
    this._setFilter(0);
    this.engine.primeDrums();
    this.arcPos++;
    this.phase = 'play';
    this.bar = 1;                 // the drop bar is bar 1 of the new groove
    this._lastFill = false;
  }

  // standard 8-bar blend inside the 4/4 family: elements swap in DJ order,
  // BPM bends ~1 per bar, kick+bass swap LAST on the boundary.
  _transBar() {
    if (this.phase === 'break') return this._breakBar();
    const b = this.bar++;
    const A = this.cur(), B = this.nxt();
    const from = PRESETS[A].bpm, to = PRESETS[B].bpm;
    this._setBpm(from + (to - from) * Math.min(1, (b + 1) / TRANS_BARS));
    this.state.swing = Math.round(PRESETS[A].swing + (PRESETS[B].swing - PRESETS[A].swing) * (b + 1) / TRANS_BARS);

    if (b === 0) this._adopt(B, ['chh', 'ohh']);          // percussion first
    else if (b === 2) this._adopt(B, ['stab', 'nse']);    // melodic identity
    else if (b === 4) this._adopt(B, ['snare', 'clap']);  // backbeat
    else if (b === 5) this._setFilter(0.12);              // thin the blend out…
    else if (b === 6) { this._setFilter(0.25); this._riser(); }
    else if (b === 7) this._setFilter(0.38);
    else if (b >= TRANS_BARS) this._finishTransition(B);  // …snap open on the 1
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
      this._adopt(B, ['chh', 'ohh', 'stab']);
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
    } else if (b >= 8) {
      this._finishTransition(B);
    }
  }
}
