// engine.js — AudioContext graph + lookahead sequencer.
//
// Routing:  voice → trackIn → levelGain ─→ duckBus ─→ comp → limiter → master → analyser → out
//                                └─→ sendGain ─→ fxIn ─→ ping-pong delay ┐
//                                              └─→ convolver reverb ────┴→ duckBus
// The kick bypasses duckBus (it drives the sidechain pump instead).

import { TRACKS, STEPS } from './state.js';
import * as V from './voices.js';

const LOOKAHEAD_MS = 25;        // scheduler tick
const SCHEDULE_AHEAD = 0.1;     // seconds of audio scheduled in advance

export class Engine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.running = false;
    this._timer = null;
    this._step = 0;
    this._nextTime = 0;
    this._queue = [];           // {step, time} for UI playhead sync
    this._lastStep = 0;
    this._openHats = [];
    this._lastBass = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = ctx.createGain();
    this.master.gain.value = this.state.master * this.state.master;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    this.duck = ctx.createGain();   // sidechain pump bus
    this.duck.gain.value = 1;

    this.duck.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // ---- fx bus: ping-pong delay + procedural reverb ----
    this.fxIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 260;

    this.dL = ctx.createDelay(2);
    this.dR = ctx.createDelay(2);
    const lpL = ctx.createBiquadFilter();
    lpL.type = 'lowpass'; lpL.frequency.value = 5200;
    const fbL = ctx.createGain(); fbL.gain.value = 0.38;
    const fbR = ctx.createGain(); fbR.gain.value = 0.38;
    const panL = ctx.createStereoPanner(); panL.pan.value = -0.72;
    const panR = ctx.createStereoPanner(); panR.pan.value = 0.72;
    const fxOut = ctx.createGain(); fxOut.gain.value = 0.8;

    this.fxIn.connect(hp).connect(this.dL);
    this.dL.connect(panL).connect(fxOut);
    this.dL.connect(lpL).connect(fbL).connect(this.dR);
    this.dR.connect(panR).connect(fxOut);
    this.dR.connect(fbR).connect(this.dL);
    fxOut.connect(this.duck);

    const conv = ctx.createConvolver();
    conv.buffer = this._impulse(1.7);
    const convG = ctx.createGain();
    convG.gain.value = 0.35;
    this.fxIn.connect(conv).connect(convG).connect(this.duck);

    this.updateDelayTime();

    // ---- per-track channels ----
    this.trackIn = {};
    this.levelG = {};
    this.sendG = {};
    for (const t of TRACKS) {
      const inp = ctx.createGain();
      const lvl = ctx.createGain();
      const snd = ctx.createGain();
      inp.connect(lvl);
      lvl.connect(t.id === 'kick' ? this.comp : this.duck);
      lvl.connect(snd).connect(this.fxIn);
      this.trackIn[t.id] = inp;
      this.levelG[t.id] = lvl;
      this.sendG[t.id] = snd;
      this.applyMix(t.id);
    }
  }

  _impulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
      }
    }
    return buf;
  }

  applyMix(id) {
    if (!this.ctx) return;
    const tr = this.state.tracks[id];
    const now = this.ctx.currentTime;
    const lvl = tr.mute ? 0 : tr.level * tr.level;
    this.levelG[id].gain.setTargetAtTime(lvl, now, 0.012);
    this.sendG[id].gain.setTargetAtTime(tr.send * tr.send, now, 0.012);
  }

  setMaster(v) {
    if (this.ctx) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.012);
  }

  updateDelayTime() {
    if (!this.ctx) return;
    const beat = 60 / this.state.bpm;
    const dotted8 = beat * 0.75;
    const now = this.ctx.currentTime;
    this.dL.delayTime.setTargetAtTime(dotted8, now, 0.08);
    this.dR.delayTime.setTargetAtTime(dotted8, now, 0.08);
  }

  // ---------- transport ----------

  start() {
    this.init();
    this.ctx.resume();
    if (this.running) return;
    this.running = true;
    this._step = 0;
    this._queue = [];
    this._lastStep = 0;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  stop() {
    this.running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._queue = [];
  }

  toggle() { this.running ? this.stop() : this.start(); }

  _tick() {
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this._nextTime < horizon) {
      const s = this.state;
      const sixteenth = 60 / s.bpm / 4;
      let t = this._nextTime;
      if (this._step % 2 === 1) t += sixteenth * (s.swing - 50) / 50; // MPC-style swing on odd 16ths
      this._schedule(this._step, t, sixteenth);
      this._queue.push({ step: this._step, time: t });
      this._step = (this._step + 1) % STEPS;
      this._nextTime += sixteenth;
    }
  }

  _schedule(step, t, sixteenth) {
    const ctx = this.ctx;
    const s = this.state;
    for (const trk of TRACKS) {
      const tr = s.tracks[trk.id];
      const v = tr.steps[step];
      if (!v || tr.mute) continue;
      const vel = v === 2 ? 1 : 0.72;
      const out = this.trackIn[trk.id];
      const p = tr.params;
      switch (trk.id) {
        case 'kick':
          V.kick(ctx, out, t, p, vel);
          this._duck(t);
          break;
        case 'snare': V.snare(ctx, out, t, p, vel); break;
        case 'clap':  V.clap(ctx, out, t, p, vel); break;
        case 'chh':
          this._chokeOpenHats(t);
          V.hat(ctx, out, t, p, vel, false);
          break;
        case 'ohh': {
          this._chokeOpenHats(t);
          const g = V.hat(ctx, out, t, p, vel, true);
          this._openHats.push(g);
          if (this._openHats.length > 4) this._openHats.shift();
          break;
        }
        case 'bass': {
          if (this._lastBass) this._chokeGain(this._lastBass, t);
          this._lastBass = V.bass(ctx, out, t, p, vel, tr.notes[step], sixteenth);
          break;
        }
        case 'stab': V.stab(ctx, out, t, p, vel); break;
        case 'nse':  V.sweep(ctx, out, t, p, vel); break;
      }
    }
  }

  _chokeGain(g, t) {
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.006);
  }

  _chokeOpenHats(t) {
    for (const g of this._openHats) this._chokeGain(g, t);
    this._openHats.length = 0;
  }

  _duck(t) {
    const depth = this.state.pump * 0.6;
    if (depth <= 0.001) return;
    const g = this.duck.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.012);
    g.setTargetAtTime(1, t + 0.09, 0.11);
  }

  // step currently sounding (for playhead / viz), derived from the schedule queue
  currentStep() {
    if (!this.running || !this.ctx) return -1;
    const now = this.ctx.currentTime;
    while (this._queue.length > 1 && this._queue[1].time <= now) this._queue.shift();
    if (this._queue.length && this._queue[0].time <= now) this._lastStep = this._queue[0].step;
    return this._lastStep;
  }
}
