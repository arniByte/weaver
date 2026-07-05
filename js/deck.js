// deck.js — full-track playback + a pro auto-DJ over the sample pool.
//
// Two decks (A/B) each play a whole loaded track through:
//   source → highpass(dc) → lowShelf(bass EQ) → gain → engine.deckBus
//
// AUTOMIX mixes the pool the way a real DJ does:
//   · BEATMATCH  — every track is analyzed (analyze.js) for tempo, and played
//     at playbackRate = mixTempo/trackTempo (folded to a sane octave) so all
//     decks share one tempo. The mix tempo is the app's BPM slider.
//   · PHRASE-ALIGN — the incoming track is cued from its detected downbeat and
//     started exactly on the outgoing deck's next bar, so the beats line up.
//   · LEVEL-MATCH — each deck is trimmed toward a common loudness (RMS), so
//     there are no volume jumps between tracks.
//   · EQ-SWAP    — a beat-synced crossfade: equal-power volume blend plus a bass
//     shelf swap (outgoing bass out first, incoming bass in) so two low ends
//     never fight.

const MIX_RMS = 0.16;      // common loudness target for level-matching
const N = 64;
const V_IN = new Float32Array(N), V_OUT = new Float32Array(N);
const LOW_IN = new Float32Array(N), LOW_OUT = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const x = i / (N - 1);
  V_IN[i] = Math.sin(x * Math.PI / 2);
  V_OUT[i] = Math.cos(x * Math.PI / 2);
  LOW_IN[i] = -26 + 26 * x;
  LOW_OUT[i] = -26 * x;
}
const scaled = (curve, k) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = curve[i] * k; return a; };

export class DeckPlayer {
  constructor(engine) {
    this.engine = engine;
    this.decks = null;
    this.active = 0;
    this.automix = false;
    this.playlist = -1;
    this.xfadeBars = 8;
    this.maxBars = 32;         // don't solo a track longer than this before mixing
    this._busy = 0;            // real time until which a scheduled move is in flight
    this.onChange = null;
  }

  _init() {
    if (this.decks) return;
    this.engine.init();
    const ctx = this.engine.ctx;
    const make = () => {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 22;
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 180; low.gain.value = 0;
      const gain = ctx.createGain(); gain.gain.value = 0;
      hp.connect(low).connect(gain).connect(this.engine.deckBus);
      return {
        hp, low, gain, src: null, name: '', idx: -1,
        rate: 1, beatDur: 0.5, trim: 1, startAt: 0, endAt: 0, dur: 0, bpm: 0, playing: false,
      };
    };
    this.decks = [make(), make()];
  }

  get mixTempo() { return this.engine.state.bpm; }

  _prep(idx, sync) {
    const s = this.engine.samples[idx];
    // guard every derived value: a failed/absent analysis must never hang or NaN
    const bpm = (Number.isFinite(s.bpm) && s.bpm > 20) ? s.bpm : (this.mixTempo || 124);
    let rate = sync ? this.mixTempo / bpm : 1;
    if (!Number.isFinite(rate) || rate <= 0) rate = 1;
    for (let i = 0; i < 4 && rate > 1.5; i++) rate /= 2;    // keep pitch shift sane (bounded)
    for (let i = 0; i < 4 && rate < 0.68; i++) rate *= 2;
    const beatDur = 60 / (bpm * rate) || 0.5;
    const rms = Number.isFinite(s.rms) && s.rms > 0 ? s.rms : MIX_RMS;
    const trim = Math.max(0.35, Math.min(2.2, MIX_RMS / rms));
    const off = Number.isFinite(s.beatOffset) ? s.beatOffset : 0;
    const offset = sync ? Math.max(0, Math.min(off, s.buffer.duration * 0.5)) : 0;
    return { s, bpm, rate, beatDur, trim, offset };
  }

  _load(deck, idx, when, sync) {
    const ctx = this.engine.ctx;
    const { s, bpm, rate, beatDur, trim, offset } = this._prep(idx, sync);
    if (deck.src) { try { deck.src.onended = null; deck.src.stop(); } catch { /* stopped */ } }
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    src.connect(deck.hp);
    deck.src = src;
    deck.name = s.name; deck.idx = idx; deck.bpm = Math.round(bpm * rate);
    deck.rate = rate; deck.beatDur = beatDur; deck.trim = trim;
    deck.startAt = when;                       // real time the cued downbeat is heard
    deck.dur = (s.buffer.duration - offset) / rate;
    deck.endAt = when + deck.dur;
    deck.playing = true;
    src.onended = () => { if (deck.src === src) deck.playing = false; };
    src.start(when, offset);
    return deck;
  }

  _stop(deck, fade = 0.05) {
    if (!deck.src) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setTargetAtTime(0, now, fade);
    deck.low.gain.cancelScheduledValues(now);
    try { deck.src.stop(now + fade * 5 + 0.05); } catch { /* stopped */ }
    deck.playing = false;
  }

  stopAll(fade = 0.05) {
    if (!this.decks) return;
    for (const d of this.decks) this._stop(d, fade);
    this._busy = 0;
  }

  // Chip ▶ : play this whole track at natural pitch (toggles off if it's playing).
  playFull(idx) {
    this._init();
    const ctx = this.engine.ctx; ctx.resume();
    if (!this.engine.samples[idx]) return;
    this.automix = false;
    const cur = this.decks[this.active];
    if (cur.playing && cur.idx === idx) { this.stopAll(0.04); this._notify(); return; }
    this.stopAll(0.04);
    this.active = 0;
    const now = ctx.currentTime + 0.03;
    const d = this._load(this.decks[0], idx, now, false);
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(0, now);
    d.gain.gain.linearRampToValueAtTime(0.9 * d.trim, now + 0.04);
    d.low.gain.cancelScheduledValues(now);
    d.low.gain.setValueAtTime(0, now);
    this.playlist = idx;
    this._notify();
  }

  startAutomix() {
    this._init();
    const ctx = this.engine.ctx; ctx.resume();
    if (!this.engine.samples.length) return false;
    this.automix = true;
    if (!this.decks[0].playing && !this.decks[1].playing) {
      this.active = 0;
      this._fadeIn(this.decks[0], (this.playlist + 1) % this.engine.samples.length);
    }
    this._notify();
    return true;
  }

  stopAutomix() {
    this.automix = false;
    this.stopAll(0.4);
    this._notify();
  }

  _fadeIn(deck, idx) {
    const now = this.engine.ctx.currentTime + 0.06;
    const d = this._load(deck, idx, now, true);
    const fin = Math.min(2 * d.beatDur, d.dur * 0.3);
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(0, now);
    d.gain.gain.linearRampToValueAtTime(0.9 * d.trim, now + fin);
    d.low.gain.cancelScheduledValues(now);
    d.low.gain.setValueAtTime(0, now);
    this.playlist = idx;
    this._busy = now;
  }

  // next bar boundary of a deck at or after real time `t`
  _nextBar(deck, t) {
    const barDur = 4 * deck.beatDur;
    const k = Math.max(0, Math.ceil((t - deck.startAt) / barDur - 1e-6));
    return deck.startAt + k * barDur;
  }

  _beginCrossfade() {
    const pool = this.engine.samples;
    if (!pool.length) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    const from = this.decks[this.active];
    const to = this.decks[this.active ^ 1];
    const nextIdx = (from.idx + 1) % pool.length;

    const when = Math.max(now + 0.06, this._nextBar(from, now + 0.08));  // land on a bar
    const d = this._load(to, nextIdx, when, true);
    // crossfade length in real time, clamped to what both decks can sustain
    let xf = this.xfadeBars * 4 * from.beatDur;
    xf = Math.min(xf, from.endAt - when - 0.1, d.dur - 0.1);
    if (!(xf > 0.2)) xf = Math.max(0.2, Math.min(from.endAt - when - 0.05, 1));

    to.gain.gain.cancelScheduledValues(when);
    to.gain.gain.setValueAtTime(0, when);
    to.gain.gain.setValueCurveAtTime(scaled(V_IN, 0.9 * to.trim), when, xf);
    to.low.gain.cancelScheduledValues(when);
    to.low.gain.setValueCurveAtTime(LOW_IN, when, xf);

    from.gain.gain.cancelScheduledValues(when);
    from.gain.gain.setValueCurveAtTime(scaled(V_OUT, 0.9 * from.trim), when, xf);
    from.low.gain.cancelScheduledValues(when);
    from.low.gain.setValueCurveAtTime(LOW_OUT, when, xf);
    try { from.src.stop(when + xf + 0.05); } catch { /* stopped */ }
    from.playing = false;              // `to` is the deck that matters now

    this.active ^= 1;
    this.playlist = nextIdx;
    this._busy = when + xf;
    this._notify();
  }

  update() {
    if (!this.decks) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    let ended = false;
    for (const d of this.decks) if (d.playing && now >= d.endAt - 0.02) { d.playing = false; ended = true; }
    if (ended) this._notify();
    if (!this.automix) return;
    if (!this.engine.samples.length) { this.automix = false; this._notify(); return; }
    if (now < this._busy) return;
    const cur = this.decks[this.active];
    if (cur.playing) {
      const xfadeLen = this.xfadeBars * 4 * cur.beatDur;
      const soloEnd = cur.startAt + this.maxBars * 4 * cur.beatDur;
      const transitionAt = Math.min(cur.endAt - xfadeLen, soloEnd);
      if (now >= transitionAt) this._beginCrossfade();
    } else {
      this._fadeIn(this.decks[this.active], (this.playlist + 1) % this.engine.samples.length);
      this._notify();
    }
  }

  cycleXfade() {
    const opts = [4, 8, 16];
    this.xfadeBars = opts[(opts.indexOf(this.xfadeBars) + 1) % opts.length];
    this._notify();
    return this.xfadeBars;
  }

  info() {
    const now = this.engine.ctx ? this.engine.ctx.currentTime : 0;
    const decks = (this.decks || [{}, {}]).map(d => ({
      name: d.name || '',
      idx: d.idx ?? -1,
      bpm: d.bpm || 0,
      playing: !!d.playing,
      dur: d.dur || 0,
      pos: d.playing ? Math.max(0, Math.min(d.dur, now - d.startAt)) : 0,
    }));
    return { decks, active: this.active, automix: this.automix, xfadeBars: this.xfadeBars, tempo: this.mixTempo };
  }

  _notify() { if (this.onChange) this.onChange(); }
}
