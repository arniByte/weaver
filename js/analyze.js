// analyze.js — offline tempo / downbeat / loudness analysis of a loaded track,
// so the auto-DJ can beatmatch, phrase-align and level-match like a real DJ.
//
//   bpm        detected tempo (folded into a sane dance range)
//   beatOffset seconds to the first strong onset (the downbeat to cue from)
//   rms        loudness, used to trim decks to a common level
//   env/fps    the onset envelope (kept for optional beat-grid work)

export function analyzeBuffer(buffer) {
  const sr = buffer.sampleRate;
  const N = buffer.length;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  // onset envelope via per-frame RMS flux (positive energy differences)
  const hop = 512;
  const frames = Math.floor(N / hop);
  const env = new Float32Array(frames);
  const fps = sr / hop;
  let prev = 0, sumSq = 0;
  for (let f = 0; f < frames; f++) {
    const s = f * hop, end = Math.min(N, s + hop);
    let e = 0;
    for (let i = s; i < end; i++) {
      const v = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      e += v * v;
    }
    const rmsF = Math.sqrt(e / Math.max(1, end - s));
    env[f] = Math.max(0, rmsF - prev);
    prev = rmsF;
    sumSq += e;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, N));

  // autocorrelation of the (mean-removed) envelope over plausible beat lags
  let mean = 0;
  for (let i = 0; i < frames; i++) mean += env[i];
  mean /= Math.max(1, frames);
  const e2 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) e2[i] = env[i] - mean;

  const minBPM = 70, maxBPM = 180;
  const minLag = Math.max(2, Math.floor(fps * 60 / maxBPM));
  const maxLag = Math.min(frames - 1, Math.ceil(fps * 60 / minBPM));
  let best = -Infinity, bestLag = minLag;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += e2[i] * e2[i + lag];
    // mild bias toward the middle of the range to curb octave errors
    const biasBpm = fps * 60 / lag;
    const bias = 1 - Math.min(0.25, Math.abs(biasBpm - 125) / 500);
    ac[lag] = s * bias;
    if (ac[lag] > best) { best = ac[lag]; bestLag = lag; }
  }
  // parabolic interpolation around the peak for sub-frame precision
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) lag = bestLag - 0.5 * (c - a) / denom;
  }
  lag = Math.max(minLag, Math.min(maxLag, lag));   // keep in range after interp
  let bpm = fps * 60 / lag;
  if (!Number.isFinite(bpm) || bpm <= 0) bpm = 124;
  for (let i = 0; i < 4 && bpm < 90; i++) bpm *= 2;   // fold octaves (bounded)
  for (let i = 0; i < 4 && bpm > 170; i++) bpm /= 2;

  // downbeat: strongest onset within the first two beats
  const beatFrames = Math.max(1, Math.floor(fps * 60 / bpm));
  let bestOn = 0, onFrame = 0;
  for (let f = 0; f < Math.min(2 * beatFrames, frames); f++) {
    if (env[f] > bestOn) { bestOn = env[f]; onFrame = f; }
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    beatOffset: onFrame / fps,
    rms,
    fps,
    env,
  };
}
