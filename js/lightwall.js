// lightwall.js — the light-sound wall at the bottom of the page.
// Three band-reactive layers on one canvas, ikeda/matrix vocabulary:
//   · spectral columns: quantized data blocks, white peak caps
//   · glyph rain: fall speed follows highs, density follows mids
//   · kick strobe: white scanline + frame flash on low-band onsets
// Everything derives from the analyser, so it locks to whatever is playing.

const GLYPHS = '01<>[]#+=:.·xX/\\|';

export class LightWall {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.g = canvas.getContext('2d');
    this.freq = null;
    this.low = 0; this.mid = 0; this.high = 0;
    this.lowAvg = 0.08;
    this.flash = 0;
    this.flashY = 0.5;
    this.cool = 0;
    this.streams = [];
    this.prev = 0;
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(2, Math.floor(r.height * dpr));
    this.dpr = dpr;
    const count = Math.max(6, Math.floor(this.canvas.width / (20 * dpr)));
    this.streams = Array.from({ length: count }, (_, i) => this._spawn(i, count, true));
  }

  _spawn(i, count, anywhere) {
    return {
      x: (i + 0.2 + Math.random() * 0.6) / count,
      y: anywhere ? Math.random() : -0.1 - Math.random() * 0.3,
      v: 0.35 + Math.random() * 0.9,
      chars: Array.from({ length: 7 }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]),
    };
  }

  _bands() {
    const an = this.engine.analyser;
    if (!an) return;
    if (!this.freq || this.freq.length !== an.frequencyBinCount) {
      this.freq = new Uint8Array(an.frequencyBinCount);
    }
    an.getByteFrequencyData(this.freq);
    const sr = this.engine.ctx.sampleRate;
    const hz = i => i * sr / 2 / this.freq.length;
    let l = 0, ln = 0, m = 0, mn = 0, h = 0, hn = 0;
    for (let i = 1; i < this.freq.length; i++) {
      const f = hz(i);
      if (f < 140) { l += this.freq[i]; ln++; }
      else if (f < 2000) { m += this.freq[i]; mn++; }
      else if (f < 11000) { h += this.freq[i]; hn++; }
      else break;
    }
    const nl = ln ? l / ln / 255 : 0;
    this.low = Math.max(nl, this.low * 0.86);
    this.mid = Math.max(mn ? m / mn / 255 : 0, this.mid * 0.9);
    this.high = Math.max(hn ? h / hn / 255 : 0, this.high * 0.9);
    // kick onset: low band jumps over its rolling average
    if (this.cool <= 0 && nl > 0.22 && nl > this.lowAvg * 1.35) {
      this.flash = 1;
      this.flashY = 0.15 + Math.random() * 0.7;
      this.cool = 0.09;
    }
    this.lowAvg = this.lowAvg * 0.97 + nl * 0.03;
  }

  draw(step) {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = this.dpr;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, this.prev ? now - this.prev : 0.016);
    this.prev = now;
    this.cool -= dt;

    this._bands();

    g.fillStyle = this.flash > 0.5 ? '#020a04' : '#000';
    g.fillRect(0, 0, W, H);

    // 16-step grid + current column
    g.strokeStyle = '#101010';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 16; i++) {
      const x = Math.round(i * W / 16) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, H);
    }
    g.stroke();
    if (step >= 0) {
      g.fillStyle = 'rgba(0,255,65,0.045)';
      g.fillRect(step * W / 16, 0, W / 16, H);
    }

    // spectral columns: quantized blocks
    if (this.freq) {
      const cols = Math.max(16, Math.floor(W / (12 * dpr)));
      const cw = W / cols;
      const block = 4 * dpr, gap = 2 * dpr;
      for (let c = 0; c < cols; c++) {
        const bin = Math.floor(Math.pow(c / cols, 1.7) * this.freq.length * 0.7);
        const v = this.freq[bin] / 255;
        const blocks = Math.round(v * v * (H * 0.85) / (block + gap));
        for (let b = 0; b < blocks; b++) {
          const y = H - (b + 1) * (block + gap);
          g.fillStyle = b === blocks - 1 ? '#c9d1c9' : (b % 4 === 3 ? '#1e4a2a' : '#12291a');
          g.fillRect(c * cw + gap / 2, y, Math.max(1, cw - gap), block);
        }
      }
    }

    // glyph rain: speed ∝ highs, density ∝ mids
    const fs = 10 * dpr;
    g.font = `${fs}px ui-monospace, Menlo, monospace`;
    const active = Math.ceil(this.streams.length * (0.12 + this.mid * 0.88));
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      if (i >= active) continue;
      s.y += (0.12 + this.high * 1.6) * s.v * dt;
      if (s.y * H > H + 8 * fs) {
        this.streams[i] = this._spawn(i, this.streams.length, false);
        continue;
      }
      const x = s.x * W;
      for (let k = 0; k < s.chars.length; k++) {
        const y = s.y * H - k * fs;
        if (y < -fs || y > H + fs) continue;
        if (k === 0) g.fillStyle = 'rgba(210,255,220,0.95)';
        else g.fillStyle = `rgba(0,255,65,${Math.max(0, 0.55 - k * 0.08)})`;
        if (Math.random() < 0.02) s.chars[k] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        g.fillText(s.chars[k], x, y);
      }
    }

    // kick strobe: scanline + frame
    if (this.flash > 0.02) {
      const y = Math.round(this.flashY * H) + 0.5;
      g.fillStyle = `rgba(255,255,255,${0.85 * this.flash})`;
      g.fillRect(0, y - dpr, W, 2 * dpr);
      g.strokeStyle = `rgba(0,255,65,${0.5 * this.flash})`;
      g.lineWidth = 2 * dpr;
      g.strokeRect(dpr, dpr, W - 2 * dpr, H - 2 * dpr);
      this.flash *= Math.pow(0.0018, dt);   // ~fully gone in .9s
    }

    // readouts
    const rf = 9 * dpr;
    g.font = `${rf}px ui-monospace, Menlo, monospace`;
    g.textBaseline = 'top';
    g.fillStyle = '#3f4a3f';
    g.fillText('LIGHT/SIG', 6 * dpr, 5 * dpr);
    g.fillText(
      `L ${this.low.toFixed(2)}  M ${this.mid.toFixed(2)}  H ${this.high.toFixed(2)}`,
      6 * dpr, H - rf - 5 * dpr,
    );
  }
}
