// drumcache.js — drums are param-static per hit, so each (voice, params, velocity)
// combo is rendered ONCE in an OfflineAudioContext and then replayed as a buffer.
// One AudioBufferSourceNode per hit instead of a fresh 6-osc graph — this is what
// keeps low-end phones from crackling. Unknown combos fall back to live synthesis
// for the first hit while the render fills in.

import * as V from './voices.js';

const DUR = {
  kick:  p => 0.24 + p.decay * 0.55,
  snare: p => 0.28 + p.decay * 0.28,
  clap:  p => 0.25 + p.decay * 0.35,
  chh:   p => 0.10 + p.decay * 0.09,
  ohh:   p => 0.30 + p.decay * 0.50,
  nse:   p => 0.20 + p.decay * 1.40,
};

export const CACHED_DRUMS = Object.keys(DUR);

export class DrumCache {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.map = new Map();          // key → AudioBuffer | null (render pending)
  }

  _key(id, p, vel) {
    let k = id + '|' + vel;
    for (const q of Object.keys(p).sort()) k += '|' + Math.round(p[q] * 100);
    return k;
  }

  // Synchronous: returns a buffer or null (and kicks off the render if unknown).
  get(id, p, vel) {
    const k = this._key(id, p, vel);
    const e = this.map.get(k);
    if (e === undefined) {
      this._render(id, { ...p }, vel, k);
      return null;
    }
    return e;
  }

  prime(id, p) {
    this.get(id, p, 0.72);
    this.get(id, p, 1);
  }

  async _render(id, p, vel, k) {
    this.map.set(k, null);
    try {
      const dur = DUR[id](p) + 0.05;
      const oc = new OfflineAudioContext(1, Math.ceil(dur * this.sr), this.sr);
      const t = 0.005;
      switch (id) {
        case 'kick':  V.kick(oc, oc.destination, t, p, vel); break;
        case 'snare': V.snare(oc, oc.destination, t, p, vel); break;
        case 'clap':  V.clap(oc, oc.destination, t, p, vel); break;
        case 'chh':   V.hat(oc, oc.destination, t, p, vel, false); break;
        case 'ohh':   V.hat(oc, oc.destination, t, p, vel, true); break;
        case 'nse':   V.sweep(oc, oc.destination, t, p, vel); break;
      }
      const buf = await oc.startRendering();
      this.map.set(k, buf);
      while (this.map.size > 64) this.map.delete(this.map.keys().next().value);
    } catch {
      this.map.delete(k);           // render failed → stay on live synthesis
    }
  }
}
