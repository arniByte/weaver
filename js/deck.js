// deck.js — full-track playback + auto-mixing over the sample pool.
//
// Two decks (A/B) each play a whole loaded track through:
//   source → highpass(dc) → lowShelf(bass EQ) → gain → engine.deckBus
// AUTOMIX plays the pool in sequence and performs a real DJ crossfade near the
// end of each track: equal-power volume fade + a bass EQ-swap (outgoing bass
// out first, incoming bass in) so the two never mud the low end together.

const N = 64;
const CURVE_IN = new Float32Array(N);   // volume 0 → 0.9 (equal power)
const CURVE_OUT = new Float32Array(N);  // volume 0.9 → 0
const LOW_IN = new Float32Array(N);     // bass shelf -26 → 0 dB
const LOW_OUT = new Float32Array(N);    // bass shelf 0 → -26 dB
for (let i = 0; i < N; i++) {
  const x = i / (N - 1);
  CURVE_IN[i] = Math.sin(x * Math.PI / 2) * 0.9;
  CURVE_OUT[i] = Math.cos(x * Math.PI / 2) * 0.9;
  LOW_IN[i] = -26 + 26 * x;
  LOW_OUT[i] = -26 * x;
}

export class DeckPlayer {
  constructor(engine) {
    this.engine = engine;
    this.decks = null;
    this.active = 0;
    this.automix = false;
    this.playlist = -1;
    this.xfade = 8;              // seconds
    this._xfadeEnd = 0;
    this.onChange = null;        // ui refresh
  }

  _init() {
    if (this.decks) return;
    this.engine.init();
    const ctx = this.engine.ctx;
    const make = () => {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 22;
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 170; low.gain.value = 0;
      const gain = ctx.createGain(); gain.gain.value = 0;
      hp.connect(low).connect(gain).connect(this.engine.deckBus);
      return { hp, low, gain, src: null, name: '', idx: -1, startAt: 0, dur: 0, playing: false };
    };
    this.decks = [make(), make()];
  }

  _load(deck, idx, when) {
    const ctx = this.engine.ctx;
    const s = this.engine.samples[idx];
    if (deck.src) { try { deck.src.onended = null; deck.src.stop(); } catch { /* already stopped */ } }
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.connect(deck.hp);
    deck.src = src;
    deck.name = s.name; deck.idx = idx;
    deck.startAt = when; deck.dur = s.buffer.duration; deck.playing = true;
    src.onended = () => { if (deck.src === src) deck.playing = false; };
    src.start(when, 0);
  }

  _stop(deck, fade = 0.05) {
    if (!deck.src) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setTargetAtTime(0, now, fade);
    deck.low.gain.cancelScheduledValues(now);
    try { deck.src.stop(now + fade * 5 + 0.05); } catch { /* already stopped */ }
    deck.playing = false;
  }

  stopAll(fade = 0.05) {
    if (!this.decks) return;
    for (const d of this.decks) this._stop(d, fade);
    this._xfadeEnd = 0;
  }

  // Chip ▶ : play this track fully now (toggles off if it is the one playing).
  playFull(idx) {
    this._init();
    const ctx = this.engine.ctx; ctx.resume();
    if (!this.engine.samples[idx]) return;
    this.automix = false;
    const cur = this.decks[this.active];
    if (cur.playing && cur.idx === idx) { this.stopAll(0.04); this._notify(); return; }
    this.stopAll(0.04);
    this.active = 0;
    const d = this.decks[0];
    const now = ctx.currentTime + 0.02;
    this._load(d, idx, now);
    this.engine.activeSample = idx;
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(0, now);
    d.gain.gain.linearRampToValueAtTime(0.9, now + 0.04);
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
    this.stopAll(0.3);
    this._notify();
  }

  _fadeIn(deck, idx) {
    const now = this.engine.ctx.currentTime + 0.02;
    this._load(deck, idx, now);
    this.engine.activeSample = idx;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(0, now);
    deck.gain.gain.linearRampToValueAtTime(0.9, now + 1.0);   // 1 s ease-in
    deck.low.gain.cancelScheduledValues(now);
    deck.low.gain.setValueAtTime(0, now);
    this.playlist = idx;
  }

  _beginCrossfade() {
    const pool = this.engine.samples;
    if (pool.length < 1) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    const from = this.decks[this.active];
    const to = this.decks[this.active ^ 1];
    const nextIdx = (from.idx + 1) % pool.length;
    const rem = from.startAt + from.dur - now;
    const xf = Math.max(1, Math.min(this.xfade, rem - 0.05, pool[nextIdx].buffer.duration * 0.4));

    this._load(to, nextIdx, now);
    this.engine.activeSample = nextIdx;
    to.gain.gain.cancelScheduledValues(now);
    to.gain.gain.setValueCurveAtTime(CURVE_IN, now, xf);
    to.low.gain.cancelScheduledValues(now);
    to.low.gain.setValueCurveAtTime(LOW_IN, now, xf);

    from.gain.gain.cancelScheduledValues(now);
    from.gain.gain.setValueCurveAtTime(CURVE_OUT, now, xf);
    from.low.gain.cancelScheduledValues(now);
    from.low.gain.setValueCurveAtTime(LOW_OUT, now, xf);
    try { from.src.stop(now + xf + 0.05); } catch { /* already stopped */ }
    from.playing = false;   // `to` is the deck that matters now

    this.active ^= 1;
    this.playlist = nextIdx;
    this._xfadeEnd = now + xf;
    this._notify();
  }

  // called each animation frame
  update() {
    if (!this.decks) return;
    const ctx = this.engine.ctx, now = ctx.currentTime;
    for (const d of this.decks) if (d.playing && now >= d.startAt + d.dur - 0.02) d.playing = false;
    if (!this.automix) return;
    if (!this.engine.samples.length) { this.automix = false; this._notify(); return; }
    if (now < this._xfadeEnd) return;
    const cur = this.decks[this.active];
    if (cur.playing) {
      if (cur.startAt + cur.dur - now <= this.xfade + 0.05) this._beginCrossfade();
    } else {
      this._fadeIn(this.decks[this.active], (this.playlist + 1) % this.engine.samples.length);
      this._notify();
    }
  }

  cycleXfade() {
    const opts = [4, 8, 16];
    this.xfade = opts[(opts.indexOf(this.xfade) + 1) % opts.length];
    this._notify();
    return this.xfade;
  }

  info() {
    const now = this.engine.ctx ? this.engine.ctx.currentTime : 0;
    const decks = (this.decks || [{}, {}]).map(d => ({
      name: d.name || '',
      idx: d.idx ?? -1,
      playing: !!d.playing,
      dur: d.dur || 0,
      pos: d.playing ? Math.min(d.dur, now - d.startAt) : 0,
    }));
    return { decks, active: this.active, automix: this.automix, xfade: this.xfade };
  }

  _notify() { if (this.onChange) this.onChange(); }
}
