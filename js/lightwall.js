// lightwall.js — the light-sound wall at the bottom of the page.
// A bloom light field driven entirely by the analyser, ikeda/matrix palette
// (black · green · white). Three additive layers over a feedback trail:
//   · light nodes: radial blooms across the width, each fed by a frequency slice,
//     breathing on the mids, flaring white when hot
//   · spectral columns: crisp quantized data blocks (kept — the signature look)
//   · kick pulse: full-frame flash + an expanding bloom ring on low-band onsets
// The persistence trail (a translucent black fill each frame) is what turns the
// additive draws into glow.

export class LightWall {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.g = canvas.getContext('2d');
    this.freq = null;
    this.low = 0; this.mid = 0; this.high = 0;
    this.lowAvg = 0.08;
    this.flash = 0;
    this.ring = 0; this.ringX = 0.5;
    this.cool = 0;
    this.prev = 0;
    this.phase = 0;
    this.nodes = [];
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
    const count = Math.max(7, Math.min(18, Math.floor(this.canvas.width / (74 * dpr))));
    this.nodes = Array.from({ length: count }, (_, i) => ({
      x: (i + 0.5) / count,
      seed: i * 1.7,
      v: 0,          // smoothed intensity
    }));
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
    this.low = Math.max(nl, this.low * 0.85);
    this.mid = Math.max(mn ? m / mn / 255 : 0, this.mid * 0.9);
    this.high = Math.max(hn ? h / hn / 255 : 0, this.high * 0.9);
    if (this.cool <= 0 && nl > 0.22 && nl > this.lowAvg * 1.35) {
      this.flash = 1;
      this.ring = 1;
      this.ringX = 0.2 + Math.random() * 0.6;
      this.cool = 0.09;
    }
    this.lowAvg = this.lowAvg * 0.97 + nl * 0.03;
  }

  // sample a frequency bin for a node at normalized position p (bass at left)
  _nodeBand(p) {
    if (!this.freq) return 0;
    const bin = Math.floor(Math.pow(p, 1.7) * this.freq.length * 0.55) + 1;
    return this.freq[Math.min(bin, this.freq.length - 1)] / 255;
  }

  draw(step) {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = this.dpr;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, this.prev ? now - this.prev : 0.016);
    this.prev = now;
    this.cool -= dt;
    this.phase += dt;

    this._bands();

    // persistence trail — this is the bloom
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(0, 0, W, H);

    // ---- additive light ----
    g.globalCompositeOperation = 'lighter';
    const cy = H * 0.56;

    for (const n of this.nodes) {
      const band = this._nodeBand(n.x);
      n.v += (band - n.v) * 0.35;
      const breath = 0.82 + 0.18 * Math.sin(this.phase * 1.7 + n.seed);
      const energy = Math.min(1, n.v * 1.15 * breath + this.low * 0.25);
      if (energy < 0.03) continue;
      const x = n.x * W;
      const rad = (0.1 + energy * 0.75) * H;
      const hot = Math.min(1, energy * energy * 1.4);
      const grn = 200 + hot * 55;
      const rb = Math.round(hot * 235);
      const a = 0.10 + energy * 0.5;
      const grad = g.createRadialGradient(x, cy, 0, x, cy, rad);
      grad.addColorStop(0, `rgba(${rb},${grn},${90 + rb * 0.6},${a})`);
      grad.addColorStop(0.4, `rgba(0,255,65,${a * 0.35})`);
      grad.addColorStop(1, 'rgba(0,40,15,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, cy - rad, rad * 2, rad * 2);
    }

    // kick bloom ring
    if (this.ring > 0.02) {
      const x = this.ringX * W;
      const r = (1 - this.ring) * H * 1.4 + H * 0.05;
      g.strokeStyle = `rgba(255,255,255,${0.5 * this.ring})`;
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.stroke();
      this.ring *= Math.pow(0.004, dt);
    }
    // full-frame flash on kick
    if (this.flash > 0.02) {
      g.fillStyle = `rgba(255,255,255,${0.10 * this.flash})`;
      g.fillRect(0, 0, W, H);
      this.flash *= Math.pow(0.0016, dt);
    }

    // ---- crisp data overlay ----
    g.globalCompositeOperation = 'source-over';

    if (step >= 0) {
      g.fillStyle = 'rgba(0,255,65,0.05)';
      g.fillRect(step * W / 16, 0, W / 16, H);
    }

    if (this.freq) {
      const cols = Math.max(16, Math.floor(W / (12 * dpr)));
      const cw = W / cols;
      const block = 4 * dpr, gap = 2 * dpr;
      for (let c = 0; c < cols; c++) {
        const bin = Math.floor(Math.pow(c / cols, 1.7) * this.freq.length * 0.7);
        const v = this.freq[bin] / 255;
        const blocks = Math.round(v * v * (H * 0.7) / (block + gap));
        for (let b = 0; b < blocks; b++) {
          const y = H - (b + 1) * (block + gap);
          g.fillStyle = b === blocks - 1 ? '#eafff0' : (b % 4 === 3 ? '#1c5230' : '#0e2417');
          g.fillRect(c * cw + gap / 2, y, Math.max(1, cw - gap), block);
        }
      }
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
    g.textAlign = 'right';
    g.fillText('WEAVER — BY ARNI', W - 6 * dpr, H - rf - 5 * dpr);
    g.textAlign = 'left';
  }
}
