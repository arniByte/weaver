// voices.js — 100% procedural synthesis. Every instrument is built from
// oscillators / noise / filters at trigger time; nodes free themselves on stop.
// All param values arrive normalized 0..1 and are mapped to physical ranges here.

const satCache = new Map();
function satCurve(k) {
  let c = satCache.get(k);
  if (!c) {
    const n = 1024;
    c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    satCache.set(k, c);
  }
  return c;
}

let noiseBuf = null;
export function noiseBuffer(ctx) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noiseSource(ctx) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.loopStart = Math.random() * 1.5; // decorrelate consecutive hits
  return src;
}

// ---------- drums ----------

// mode 0 '909': pitch-dropped sine + click + drive (current club standard)
// mode 1 '808': lower, slower drop, long clean sine tail, barely any click
// mode 2 'HRD': hard rave kick — violent pitch drop into heavy saturation
export function kick(ctx, out, t, p, vel, mode = 0) {
  const f0 = mode === 1 ? 28 + p.tune * 32 : 34 + p.tune * 40;
  const dec = mode === 1 ? 0.3 + p.decay * 1.1
            : mode === 2 ? 0.1 + p.decay * 0.35
            : 0.12 + p.decay * 0.55;
  const startMul = mode === 1 ? 2.5 : mode === 2 ? 10 : 6;
  const dropTime = mode === 1 ? 0.035 : mode === 2 ? 0.04 : 0.055;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0 * startMul, t);
  osc.frequency.exponentialRampToValueAtTime(f0, t + dropTime);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.0025);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  g.gain.linearRampToValueAtTime(0, t + dec + 0.02);
  const sh = ctx.createWaveShaper();
  const k = mode === 1 ? 1 + p.drive * 3 : mode === 2 ? 3 + p.drive * 22 : 1 + p.drive * 9;
  sh.curve = satCurve(k);
  sh.oversample = '2x';
  osc.connect(g).connect(sh).connect(out);

  if (mode !== 1) {
    // attack click: 8 ms of high-passed noise
    const nb = noiseSource(ctx);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = mode === 2 ? 900 : 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * (0.12 + p.drive * 0.25), t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    nb.connect(nf).connect(ng).connect(out);
    nb.start(t); nb.stop(t + 0.03);
  }

  osc.start(t); osc.stop(t + dec + 0.05);
}

// mode 1 'RIM': rimshot — two resonant pings + a 5 ms noise snap
function rim(ctx, out, t, p, vel) {
  const f1 = 900 + p.tone * 900;
  const dec = 0.025 + p.decay * 0.06;
  for (const [f, gv] of [[f1, 0.6], [f1 * 2.6, 0.35]]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(vel * gv, t + 0.001);
    og.gain.exponentialRampToValueAtTime(0.001, t + dec);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + dec + 0.02);
  }
  const nb = noiseSource(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
  nb.connect(bp).connect(ng).connect(out);
  nb.start(t); nb.stop(t + 0.02);
}

export function snare(ctx, out, t, p, vel, mode = 0) {
  if (mode === 1) return rim(ctx, out, t, p, vel);
  const dec = 0.09 + p.decay * 0.28;
  // tonal body
  const body = ctx.createOscillator();
  body.type = 'triangle';
  const bf = 150 + p.tone * 120;
  body.frequency.setValueAtTime(bf * 2, t);
  body.frequency.exponentialRampToValueAtTime(bf, t + 0.03);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(vel * 0.55, t + 0.002);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  body.connect(bg).connect(out);
  // noise rattle
  const nb = noiseSource(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1600 + p.tone * 3500;
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(vel * 0.8, t + 0.001);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dec);
  nb.connect(hp).connect(bp).connect(ng).connect(out);

  body.start(t); body.stop(t + 0.15);
  nb.start(t); nb.stop(t + dec + 0.02);
}

export function clap(ctx, out, t, p, vel) {
  const tail = 0.1 + p.decay * 0.35;
  const nb = noiseSource(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1000 + p.tone * 1200;
  bp.Q.value = 1.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  // three pre-echoes, then the main burst with a long tail — classic 909 clap
  for (let i = 0; i < 3; i++) {
    const ts = t + i * 0.011;
    g.gain.linearRampToValueAtTime(vel * 0.75, ts + 0.001);
    g.gain.exponentialRampToValueAtTime(vel * 0.2, ts + 0.010);
  }
  const tm = t + 0.033;
  g.gain.linearRampToValueAtTime(vel, tm + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, tm + tail);
  nb.connect(bp).connect(g).connect(out);
  nb.start(t); nb.stop(tm + tail + 0.02);
}

// 808-style metallic hat: six detuned square partials.
// mode 1 'NSE': filtered-noise hat — softer, the classic house flavour.
const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function hat(ctx, out, t, p, vel, open, mode = 0) {
  const dec = open ? 0.18 + p.decay * 0.5 : 0.02 + p.decay * 0.09;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * (mode === 1 ? 0.5 : 0.6), t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  g.gain.linearRampToValueAtTime(0, t + dec + 0.01);
  const stop = t + dec + 0.03;

  if (mode === 1) {
    const nb = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800 + p.tone * 3800;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000 + p.tone * 3000;
    bp.Q.value = 0.7;
    nb.connect(hp).connect(bp).connect(g).connect(out);
    nb.start(t); nb.stop(stop);
    return g;
  }

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 9500 + p.tone * 3500;
  bp.Q.value = 1.1;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500 + p.tone * 1500;
  const scale = 0.92 + p.tone * 0.22;
  for (const f of HAT_FREQS) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f * scale;
    o.connect(bp);
    o.start(t); o.stop(stop);
  }
  bp.connect(hp).connect(g).connect(out);
  return g; // returned so the engine can choke open hats
}

// ---------- synths ----------

const ROOT_BASS = 55;   // A1

// mode 0 ACD: resonant acid saw+sub · 1 DEP: saturated deep-techno sub ·
// 2 RSE: detuned reese. Returns the amp gain so the engine can run a mono choke.
export function bass(ctx, out, t, p, vel, note, stepDur, mode = 0) {
  const f = ROOT_BASS * Math.pow(2, note / 12);
  if (mode === 1) return bassDeep(ctx, out, t, p, vel, f, stepDur);
  if (mode === 2) return bassReese(ctx, out, t, p, vel, f, stepDur);

  const gate = stepDur * (0.55 + p.decay * 2.2);
  const rel = 0.04;

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  saw.detune.value = (Math.random() * 2 - 1) * 6;      // analog drift
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f;
  const subG = ctx.createGain();
  subG.gain.value = 0.5;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 60 * Math.pow(2, p.cutoff * 6) * (1 + (Math.random() * 2 - 1) * 0.04);  // 60..3840 Hz + jitter
  const accent = vel > 0.9;
  const peak = Math.min(fc * (accent ? 3.2 : 2.1) + f * 2, 9000);
  lp.frequency.setValueAtTime(peak, t);
  lp.frequency.setTargetAtTime(fc, t, 0.06 + p.decay * 0.14);
  lp.Q.value = p.res * (accent ? 22 : 17);             // dB (lowpass Q is in dB)

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.62, t + 0.004);
  g.gain.setValueAtTime(vel * 0.62, t + gate);
  g.gain.exponentialRampToValueAtTime(0.001, t + gate + rel);
  g.gain.linearRampToValueAtTime(0, t + gate + rel + 0.01);

  saw.connect(lp);
  sub.connect(subG).connect(lp);
  lp.connect(g).connect(out);
  const stop = t + gate + rel + 0.02;
  saw.start(t); saw.stop(stop);
  sub.start(t); sub.stop(stop);
  return g; // engine chokes the previous note → true mono acid line
}

// deep techno / deep house: a fat, living sub. A clean sine sub for weight, a
// detuned saw growl through a moving resonant lowpass for harmonics, tanh
// saturation for body, and a slow filter LFO so the note breathes. RES = drive.
// High FX send turns this into the classic reverb-rumble bed under the kick.
function bassDeep(ctx, out, t, p, vel, f, stepDur) {
  const gate = stepDur * (0.6 + p.decay * 2.6);
  const rel = 0.08;
  const stop = t + gate + rel + 0.03;
  const drift = () => (Math.random() * 2 - 1) * 6;   // analog cents

  // clean sub — weight (bypasses the growl filter)
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(f * 2.0, t);
  sub.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  const subG = ctx.createGain();
  subG.gain.value = 0.9;

  // growl — a detuned saw pair, saturated, through a moving lowpass
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 70 * Math.pow(2, p.cutoff * 4.6);        // 70..1700 Hz
  lp.frequency.value = fc;
  lp.Q.value = 3 + p.res * 6;

  // slow filter LFO for movement
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.15 + Math.random() * 0.2;
  const lfoG = ctx.createGain();
  lfoG.gain.value = fc * 0.4;
  lfo.connect(lfoG).connect(lp.frequency);

  const sh = ctx.createWaveShaper();
  sh.curve = satCurve(2 + p.res * 8);
  sh.oversample = '2x';
  const growlG = ctx.createGain();
  growlG.gain.value = 0.5;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.7, t + 0.006);
  g.gain.setValueAtTime(vel * 0.7, t + gate);
  g.gain.exponentialRampToValueAtTime(0.001, t + gate + rel);
  g.gain.linearRampToValueAtTime(0, t + gate + rel + 0.01);

  for (const det of [-6, 8]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det + drift();
    o.connect(sh);
    o.start(t); o.stop(stop);
  }
  sh.connect(lp).connect(growlG).connect(g);
  sub.connect(subG).connect(g);
  g.connect(out);

  sub.start(t); sub.stop(stop);
  lfo.start(t); lfo.stop(stop);
  return g;
}

// dnb reese: three saws, outer pair detuned (RES = width), sub sine underneath,
// slow-closing lowpass. Soft 8 ms attack so long notes swell instead of spit.
function bassReese(ctx, out, t, p, vel, f, stepDur) {
  const gate = stepDur * (0.6 + p.decay * 2.8);
  const rel = 0.09;
  const width = 8 + p.res * 35;                        // detune, cents

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 80 * Math.pow(2, p.cutoff * 5);           // 80..2560 Hz
  lp.frequency.setValueAtTime(Math.min(fc * 1.6, 6000), t);
  lp.frequency.setTargetAtTime(fc, t, 0.2);
  lp.Q.value = 3;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.55, t + 0.008);
  g.gain.setValueAtTime(vel * 0.55, t + gate);
  g.gain.exponentialRampToValueAtTime(0.001, t + gate + rel);
  g.gain.linearRampToValueAtTime(0, t + gate + rel + 0.01);

  const stop = t + gate + rel + 0.02;
  for (const det of [-width, 0, width]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    const og = ctx.createGain();
    og.gain.value = 0.22;
    o.connect(og).connect(lp);
    o.start(t); o.stop(stop);
  }
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f;
  const sg = ctx.createGain();
  sg.gain.value = 0.4;
  sub.connect(sg).connect(g);                          // sub bypasses the filter
  sub.start(t); sub.stop(stop);

  lp.connect(g).connect(out);
  return g;
}

// user sample, sliced into 16 equal parts of the [OFS, OFS+LEN] window.
// TUN = ±12 semitones playback rate. Returns gain for mono choke.
export function sample(ctx, out, t, p, vel, buffer, slice, stepDur) {
  const rate = Math.pow(2, (p.tune * 24 - 12) / 12);
  const winLen = Math.max(0.02, buffer.duration * (0.05 + p.len * 0.95));
  const winStart = Math.min(buffer.duration - winLen, buffer.duration * p.ofs);
  const offset = Math.max(0, winStart) + (slice / 16) * winLen;
  const gate = stepDur * (0.4 + p.decay * 3.6);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.setValueAtTime(vel, t + gate);
  g.gain.linearRampToValueAtTime(0, t + gate + 0.02);

  src.connect(g).connect(out);
  src.start(t, offset);
  src.stop(t + gate + 0.05);
  return g;
}

// melodic lead / pluck — tonal, note-per-step, 4 selectable waveforms.
// wave: 0 sine · 1 triangle · 2 saw · 3 square. `root` is the A note in Hz
// (lead A3 = 220, pluck A4 = 440). saw/square get a detuned pair for width and
// a resonant filter with a decay envelope so they read as a proper synth line.
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

export function synth(ctx, out, t, p, vel, note, stepDur, wave, root) {
  const f = root * Math.pow(2, note / 12);
  const type = WAVES[wave] || 'sine';
  const rich = wave >= 2;                              // saw / square
  const gate = stepDur * (0.35 + p.decay * 3.0);
  const rel = 0.05;
  const accent = vel > 0.9;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 140 * Math.pow(2, p.cutoff * 5.6);        // 140..6700 Hz
  lp.frequency.setValueAtTime(Math.min(fc * (accent ? 2.6 : 1.9) + f * 3, 13000), t);
  lp.frequency.setTargetAtTime(fc, t, 0.03 + p.decay * 0.22);
  lp.Q.value = p.res * (accent ? 18 : 13);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.006);
  g.gain.setValueAtTime(vel * 0.5, t + gate);
  g.gain.exponentialRampToValueAtTime(0.001, t + gate + rel);
  g.gain.linearRampToValueAtTime(0, t + gate + rel + 0.01);

  const stop = t + gate + rel + 0.02;
  const dets = rich ? [-7, 7] : [0];
  for (const d of dets) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = d + (Math.random() * 2 - 1) * 5;   // analog drift
    const og = ctx.createGain();
    og.gain.value = rich ? 0.5 : 0.85;
    o.connect(og).connect(lp);
    o.start(t); o.stop(stop);
  }
  lp.connect(g).connect(out);
  return g;   // engine chokes the previous note → mono melodic line
}

const ROOT_STAB = 220;  // A3
const CHORDS = [
  [0, 3, 7, 10],     // Am7
  [-4, 0, 3, 7],     // Fmaj7
  [-7, -4, 0, 3],    // Dm7
  [-5, -2, 2, 5],    // Em7
];
export const CHORD_NAMES = ['Am7', 'Fma7', 'Dm7', 'Em7'];

// mode 0 STB: short stab · 1 CRD: sustained dub chord · 2 PAD: long evolving pad.
// CRD/PAD soften the attack, widen the detune and open the filter slowly so the
// chord breathes — the atmospheric layer deep techno lives on (use a big FX send).
export function stab(ctx, out, t, p, vel, mode = 0, stepDur = 0.12) {
  const chord = CHORDS[Math.min(3, Math.floor(p.chord * 4))];
  const long = mode === 2;
  const sustained = mode >= 1;
  const dec = sustained
    ? stepDur * (long ? 6 + p.decay * 14 : 2 + p.decay * 6)
    : 0.1 + p.decay * 0.7;
  const atk = long ? 0.08 + p.decay * 0.4 : sustained ? 0.02 : 0.003;
  const spread = long ? 14 : sustained ? 9 : 6;
  const peak = vel * (long ? 0.34 : sustained ? 0.38 : 0.4);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 300 * Math.pow(2, p.cutoff * 4.2);        // 300..5514 Hz
  if (long) {                                          // slow filter open
    lp.frequency.setValueAtTime(fc * 0.4, t);
    lp.frequency.linearRampToValueAtTime(Math.min(fc * 1.4, 9000), t + dec * 0.7);
  } else {
    lp.frequency.setValueAtTime(Math.min(fc * 2, 11000), t);
    lp.frequency.setTargetAtTime(fc * 0.7, t + 0.01, 0.12);
  }
  lp.Q.value = long ? 2 : 4;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  if (sustained) {
    g.gain.setValueAtTime(peak, t + dec * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  } else {
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  }
  g.gain.linearRampToValueAtTime(0, t + dec + 0.03);
  lp.connect(g).connect(out);

  const stop = t + dec + 0.05;
  for (const semi of chord) {
    for (const det of [-spread, spread]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = ROOT_STAB * Math.pow(2, semi / 12);
      o.detune.value = det + (Math.random() * 2 - 1) * 4;
      const og = ctx.createGain();
      og.gain.value = long ? 0.1 : 0.14;
      o.connect(og).connect(lp);
      o.start(t); o.stop(stop);
    }
  }
}

export function sweep(ctx, out, t, p, vel) {
  const dur = 0.15 + p.decay * 1.4;
  const nb = noiseSource(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  const f0 = 350 * Math.pow(2, p.tone * 3.5);          // 350..3960 Hz start
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f0 * 5, t + dur);
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + dur * 0.55);
  g.gain.linearRampToValueAtTime(0, t + dur);
  nb.connect(bp).connect(g).connect(out);
  nb.start(t); nb.stop(t + dur + 0.02);
}
