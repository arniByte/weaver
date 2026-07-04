// viz.js — data-plot style visualization: live waveform over a dim spectrum,
// micro grid, playhead column, numeric readouts. Black field, 1px lines.

export class Viz {
  constructor(canvas, engine, state) {
    this.canvas = canvas;
    this.engine = engine;
    this.state = state;
    this.g = canvas.getContext('2d');
    this.wave = null;
    this.freq = null;
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
  }

  draw() {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = this.dpr;
    const an = this.engine.analyser;

    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // micro grid: 16 columns + center line
    g.strokeStyle = '#141414';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 16; i++) {
      const x = Math.round(i * W / 16) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, H);
    }
    g.stroke();
    g.strokeStyle = '#1e1e1e';
    g.beginPath();
    g.moveTo(0, Math.round(H / 2) + 0.5);
    g.lineTo(W, Math.round(H / 2) + 0.5);
    g.stroke();

    const step = this.engine.currentStep();

    if (an) {
      if (!this.wave || this.wave.length !== an.fftSize) {
        this.wave = new Float32Array(an.fftSize);
        this.freq = new Uint8Array(an.frequencyBinCount);
      }

      // spectrum: dim bars, log-ish emphasis on the low end
      an.getByteFrequencyData(this.freq);
      const bars = 96;
      const bw = W / bars;
      g.fillStyle = '#1c221c';
      for (let i = 0; i < bars; i++) {
        const bin = Math.floor(Math.pow(i / bars, 1.8) * (this.freq.length * 0.72));
        const v = this.freq[bin] / 255;
        const h = v * v * (H * 0.92);
        g.fillRect(Math.floor(i * bw) + 1, H - h, Math.max(1, Math.floor(bw) - 2), h);
      }

      // waveform: crisp white line
      an.getFloatTimeDomainData(this.wave);
      g.strokeStyle = '#e8e8e8';
      g.lineWidth = Math.max(1, dpr);
      g.beginPath();
      const n = this.wave.length;
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1) * W;
        const y = H / 2 - this.wave[i] * H * 0.46;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }

    // playhead column
    if (step >= 0) {
      const x0 = step * W / 16;
      g.fillStyle = 'rgba(0,255,65,0.05)';
      g.fillRect(x0, 0, W / 16, H);
      g.strokeStyle = '#00ff41';
      g.beginPath();
      const x = Math.round(x0) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, H);
      g.stroke();
    }

    // readouts
    const fs = 9 * dpr;
    g.font = `${fs}px ui-monospace, Menlo, monospace`;
    g.fillStyle = '#565656';
    g.textBaseline = 'top';
    g.fillText('SIG/WAVE', 6 * dpr, 5 * dpr);
    const sr = this.engine.ctx ? this.engine.ctx.sampleRate : 0;
    const info = `${this.state.bpm} BPM  SWG ${this.state.swing}  ${sr ? sr + ' HZ' : 'STANDBY'}`;
    g.textAlign = 'right';
    g.fillText(info, W - 6 * dpr, 5 * dpr);
    if (step >= 0) {
      g.fillStyle = '#00ff41';
      g.fillText(`STEP ${String(step + 1).padStart(2, '0')}/16`, W - 6 * dpr, H - fs - 5 * dpr);
    }
    g.textAlign = 'left';
  }
}
