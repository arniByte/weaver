// engine.js — AudioContext graph + lookahead sequencer.
//
// Routing:
//   voice → trackIn → levelGain ─→ duckBus ──┐
//                       └→ sendGain → fxIn → delay/reverb → duckBus
//   kick:   levelGain → sum (unducked, drives the duck itself)
//           sendGain  → rumble bus (reverb → 32..170 Hz band → saturation → duck)
//   duckBus + kick → sum → DJ LP → DJ HP(26 Hz floor) → glue comp → limiter
//                  → soft clip → master → analyser → out
//
// Drum hits come from the pre-rendered DrumCache when available (cheap buffer
// playback — the mobile crackle fix); unknown param combos synthesize live once.

import { TRACKS, STEPS, BAR } from './state.js';
import * as V from './voices.js';
import { DrumCache, CACHED_DRUMS } from './drumcache.js';

const LOOKAHEAD_MS = 25;        // scheduler tick
const SCHEDULE_AHEAD = 0.1;     // seconds of audio scheduled in advance

export const IS_MOBILE = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);

const lerp = (a, b, x) => a + (b - a) * x;

export class Engine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.running = false;
    this.samples = [];           // user pool: {name, buffer}
    this.activeSample = -1;
    this.onBar = null;           // (barIndex, barTime) → autopilot hook
    this._timer = null;
    this._step = 0;
    this._bar = 0;
    this._nextTime = 0;
    this._queue = [];            // {step, time} for UI playhead sync
    this._lastStep = 0;
    this._openHats = [];
    this._lastBass = null;
    this._lastLead = null;
    this._lastPluck = null;
    this._lastSmp = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: IS_MOBILE ? 'playback' : 'interactive' });
    this.drums = new DrumCache(ctx.sampleRate);

    this.master = ctx.createGain();
    this.master.gain.value = this.state.master * this.state.master;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;

    // gentle tanh ceiling after the limiter: catches inter-sample peaks, adds
    // the harmonics that make subs read on phone speakers
    this.clip = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    const K = 1.4, norm = Math.tanh(K);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(K * x) / norm;
    }
    this.clip.curve = curve;
    this.clip.oversample = IS_MOBILE ? 'none' : '2x';

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    this.duck = ctx.createGain();   // sidechain pump bus
    this.sum = ctx.createGain();
    this.deckBus = ctx.createGain(); // full-track DJ decks feed here

    this.djLP = ctx.createBiquadFilter();
    this.djLP.type = 'lowpass';
    this.djLP.frequency.value = 19500;
    this.djLP.Q.value = 1.5;
    this.djHP = ctx.createBiquadFilter();
    this.djHP.type = 'highpass';
    this.djHP.frequency.value = 26;  // doubles as the master DC/rumble floor
    this.djHP.Q.value = 1;

    // gentle "air" high shelf so the whole mix reads brighter and more open
    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = 7000;
    this.air.gain.value = 3;

    this.duck.connect(this.sum);
    this.sum.connect(this.djLP);
    this.djLP.connect(this.djHP);
    this.djHP.connect(this.air);
    this.air.connect(this.comp);
    this.deckBus.connect(this.comp);   // decks skip the sequencer duck + DJ filter
    this.comp.connect(this.limiter);
    this.limiter.connect(this.clip);
    this.clip.connect(this.master);
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
    conv.buffer = this._impulse(IS_MOBILE ? 1.1 : 1.7, IS_MOBILE ? 1 : 2, 2.8);
    const convG = ctx.createGain();
    convG.gain.value = 0.35;
    this.fxIn.connect(conv).connect(convG).connect(this.duck);

    // ---- rumble bus (deep techno): kick send → long reverb → 32..170 Hz band
    // → saturation → ducked. The classic rumble bed lives here.
    this.rumbleIn = ctx.createGain();
    const rConv = ctx.createConvolver();
    rConv.buffer = this._impulse(IS_MOBILE ? 1.4 : 2.2, 1, 2.2);
    const rHP = ctx.createBiquadFilter();
    rHP.type = 'highpass'; rHP.frequency.value = 30;
    const rLP = ctx.createBiquadFilter();
    rLP.type = 'lowpass'; rLP.frequency.value = 190;
    rLP.Q.value = 0.9;
    const rSat = ctx.createWaveShaper();
    rSat.curve = curve;             // reuse the tanh curve
    const rG = ctx.createGain(); rG.gain.value = 2.1;   // fuller rumble bed
    this.rumbleIn.connect(rConv).connect(rHP).connect(rLP).connect(rSat).connect(rG).connect(this.duck);

    this.updateDelayTime();
    this.setFilter(this.state.filter);

    // ---- per-track channels ----
    this.trackIn = {};
    this.levelG = {};
    this.sendG = {};
    for (const t of TRACKS) {
      const inp = ctx.createGain();
      const lvl = ctx.createGain();
      const snd = ctx.createGain();
      inp.connect(lvl);
      lvl.connect(t.id === 'kick' ? this.sum : this.duck);
      lvl.connect(snd).connect(t.id === 'kick' ? this.rumbleIn : this.fxIn);
      this.trackIn[t.id] = inp;
      this.levelG[t.id] = lvl;
      this.sendG[t.id] = snd;
      this.applyMix(t.id);
    }
  }

  _impulse(seconds, channels, curvePow) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(channels, len, rate);
    for (let ch = 0; ch < channels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curvePow);
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

  // v ∈ [-1, 1]: negative sweeps the lowpass down (underwater), positive sweeps
  // the highpass up (thin out). 0 = neutral. Exponential — like a real DJ filter.
  setFilter(v) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    let lp = 19500, hp = 26;
    if (v < 0) lp = Math.exp(lerp(Math.log(19500), Math.log(150), -v));
    else if (v > 0) hp = Math.exp(lerp(Math.log(26), Math.log(2500), v));
    this.djLP.frequency.setTargetAtTime(lp, now, 0.05);
    this.djHP.frequency.setTargetAtTime(hp, now, 0.05);
  }

  addSample(buffer, name, analysis) {
    this.samples.push({ buffer, name, ...(analysis || {}) });
    this.activeSample = this.samples.length - 1;
    return this.activeSample;
  }

  get sample() { return this.samples[this.activeSample]?.buffer || null; }
  get sampleName() { return this.samples[this.activeSample]?.name || ''; }

  updateDelayTime() {
    if (!this.ctx) return;
    const dotted8 = (60 / this.state.bpm) * 0.75;
    const now = this.ctx.currentTime;
    this.dL.delayTime.setTargetAtTime(dotted8, now, 0.08);
    this.dR.delayTime.setTargetAtTime(dotted8, now, 0.08);
  }

  primeDrums() {
    if (!this.drums) return;
    for (const id of CACHED_DRUMS) {
      const tr = this.state.tracks[id];
      this.drums.prime(id, tr.params, tr.mode || 0);
    }
  }

  // ---------- transport ----------

  start() {
    this.init();
    this.ctx.resume();
    if (this.running) return;
    this.running = true;
    this.primeDrums();
    this._step = 0;
    this._bar = 0;
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
    if (this.ctx) this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  toggle() { this.running ? this.stop() : this.start(); }

  _tick() {
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this._nextTime < horizon) {
      const s = this.state;
      // fire the autopilot clock once per musical bar (16 steps), not per 2-bar loop
      if (this._step % BAR === 0 && this.onBar) this.onBar(this._bar++, this._nextTime);
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
      // per-hit velocity variation + a little timing push/pull so nothing is robotic
      const vel = (v === 2 ? 1 : 0.72) * (0.94 + Math.random() * 0.06);
      const out = this.trackIn[trk.id];
      const p = tr.params;
      const mode = tr.mode || 0;
      const jit = 0.86 + Math.random() * 0.28;                 // hats/perc velocity spread
      const micro = (Math.random() - 0.5) * 0.005;             // ±2.5 ms humanize
      switch (trk.id) {
        case 'kick':
          this._drum('kick', t, p, vel, mode);
          this._duck(t);
          break;
        case 'snare': this._drum('snare', t, p, vel, mode); break;
        case 'clap':  this._drum('clap', t + micro, p, vel); break;
        case 'nse':   this._drum('nse', t + micro, p, vel, 0, jit); break;
        case 'chh':
          this._chokeOpenHats(t);
          this._drum('chh', t + micro, p, vel, mode, jit);
          break;
        case 'ohh': {
          this._chokeOpenHats(t + micro);
          const g = this._drum('ohh', t + micro, p, vel, mode, jit);
          if (g) {
            this._openHats.push(g);
            if (this._openHats.length > 4) this._openHats.shift();
          }
          break;
        }
        case 'bass': {
          if (this._lastBass) this._chokeGain(this._lastBass, t);
          this._lastBass = V.bass(ctx, out, t, p, vel, tr.notes[step], sixteenth, tr.mode || 0);
          break;
        }
        case 'lead': {
          if (this._lastLead) this._chokeGain(this._lastLead, t);
          this._lastLead = V.synth(ctx, out, t, p, vel, tr.notes[step], sixteenth, tr.mode || 0, 220);
          break;
        }
        case 'pluck': {
          if (this._lastPluck) this._chokeGain(this._lastPluck, t);
          this._lastPluck = V.synth(ctx, out, t, p, vel, tr.notes[step], sixteenth, tr.mode || 0, 440);
          break;
        }
        case 'stab': V.stab(ctx, out, t, p, vel, tr.mode || 0, sixteenth); break;
        case 'smp': {
          if (!this.sample) break;
          if (this._lastSmp) this._chokeGain(this._lastSmp, t);
          this._lastSmp = V.sample(ctx, out, t, p, vel, this.sample, tr.slices[step], sixteenth);
          break;
        }
      }
    }
  }

  // Cached-buffer drum hit; falls back to live synthesis while a render is
  // pending. Returns a gain node for chokeable voices (open hat).
  _drum(id, t, p, vel, mode = 0, jitter = 1) {
    const ctx = this.ctx;
    const out = this.trackIn[id];
    const buf = this.drums.get(id, p, vel, mode);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // analog drift: a slightly different pitch every hit so cached buffers
      // never sound identical (tighter on the kick, looser on hats)
      const drift = id === 'kick' ? 0.006 : id === 'snare' ? 0.012 : id === 'nse' ? 0.03 : 0.02;
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * drift;
      const g = ctx.createGain();
      g.gain.value = jitter;
      src.connect(g).connect(out);
      src.start(t);
      return g;
    }
    switch (id) {
      case 'kick':  V.kick(ctx, out, t, p, vel, mode); return null;
      case 'snare': V.snare(ctx, out, t, p, vel, mode); return null;
      case 'clap':  V.clap(ctx, out, t, p, vel); return null;
      case 'nse':   V.sweep(ctx, out, t, p, vel * jitter); return null;
      case 'chh':   V.hat(ctx, out, t, p, vel * jitter, false, mode); return null;
      case 'ohh':   return V.hat(ctx, out, t, p, vel * jitter, true, mode);
    }
    return null;
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
    const depth = this.state.pump * 0.72;
    if (depth <= 0.001) return;
    const g = this.duck.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.012);   // ~5 ms dip, ~50 ms hold…
    g.setTargetAtTime(1, t + 0.06, 0.09);     // …recover in ~250-300 ms
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
