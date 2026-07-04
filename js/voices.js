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

export function kick(ctx, out, t, p, vel) {
  const f0 = 34 + p.tune * 40;              // 34..74 Hz fundamental
  const dec = 0.12 + p.decay * 0.55;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0 * 6, t);
  osc.frequency.exponentialRampToValueAtTime(f0, t + 0.055);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.0025);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  g.gain.linearRampToValueAtTime(0, t + dec + 0.02);
  const sh = ctx.createWaveShaper();
  sh.curve = satCurve(1 + p.drive * 9);
  sh.oversample = '2x';
  osc.connect(g).connect(sh).connect(out);

  // attack click: 8 ms of high-passed noise
  const nb = noiseSource(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'highpass';
  nf.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * (0.12 + p.drive * 0.25), t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
  nb.connect(nf).connect(ng).connect(out);

  osc.start(t); osc.stop(t + dec + 0.05);
  nb.start(t); nb.stop(t + 0.03);
}

export function snare(ctx, out, t, p, vel) {
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

// 808-style metallic hat: six detuned square partials
const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function hat(ctx, out, t, p, vel, open) {
  const dec = open ? 0.18 + p.decay * 0.5 : 0.02 + p.decay * 0.09;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.6, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  g.gain.linearRampToValueAtTime(0, t + dec + 0.01);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 9500 + p.tone * 3500;
  bp.Q.value = 1.1;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500 + p.tone * 1500;
  const scale = 0.92 + p.tone * 0.22;
  const stop = t + dec + 0.03;
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

export function bass(ctx, out, t, p, vel, note, stepDur) {
  const f = ROOT_BASS * Math.pow(2, note / 12);
  const gate = stepDur * (0.55 + p.decay * 2.2);
  const rel = 0.04;

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f;
  const subG = ctx.createGain();
  subG.gain.value = 0.5;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 60 * Math.pow(2, p.cutoff * 6);           // 60..3840 Hz
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

const ROOT_STAB = 220;  // A3
const CHORDS = [
  [0, 3, 7, 10],     // Am7
  [-4, 0, 3, 7],     // Fmaj7
  [-7, -4, 0, 3],    // Dm7
  [-5, -2, 2, 5],    // Em7
];
export const CHORD_NAMES = ['Am7', 'Fma7', 'Dm7', 'Em7'];

export function stab(ctx, out, t, p, vel) {
  const chord = CHORDS[Math.min(3, Math.floor(p.chord * 4))];
  const dec = 0.1 + p.decay * 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const fc = 300 * Math.pow(2, p.cutoff * 4.2);        // 300..5514 Hz
  lp.frequency.setValueAtTime(Math.min(fc * 2, 11000), t);
  lp.frequency.setTargetAtTime(fc * 0.7, t + 0.01, 0.12);
  lp.Q.value = 4;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.4, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  g.gain.linearRampToValueAtTime(0, t + dec + 0.02);
  lp.connect(g).connect(out);

  const stop = t + dec + 0.03;
  for (const semi of chord) {
    for (const det of [-6, 6]) {                        // ± cents
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = ROOT_STAB * Math.pow(2, semi / 12);
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.14;
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
