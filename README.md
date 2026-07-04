# WEAVER

Minimal browser groovebox / DJ sketchpad. Black field, micro type, one bar of
sixteen steps — house, deep techno, techno, edm, dnb.

Everything you hear is synthesized live in the Web Audio API. No samples,
no dependencies, no build step. Load your own audio onto the SP track and
re-sequence it in 16 slices.

## Run

Open `index.html` from any static server (modules require http):

```
python3 -m http.server 8000
```

or deploy the repo root to Vercel / any static host as-is.

## Use

- **▶ / space** — run · **AUTO / a** — self-mixing DJ set
- **click** a cell — toggle step; **shift+click** — accent (louder, brighter)
- **BS row** — drag a cell vertically (or wheel) to set pitch; **mode button**
  switches the bass engine: ACD acid · DEP deep-techno rumble · RSE reese
- **SP row** — LOAD (or drop an audio file anywhere): your track sliced into
  16 pieces; drag a cell to pick the slice; TUN/OFS/LEN/DEC shape it
- **BD SD CP CH OH BS ST NS SP** — kick, snare, clap, closed/open hat
  (with choke), bass, chord stab, noise sweep, sampler
- **1–5** — presets: HOUSE 124 · DEEP 127 · TECHNO 132 · EDM 128 · DNB 174
- **FLT** — master DJ filter: left = lowpass, right = highpass, double-click
  to reset · **PMP** — sidechain pump · **OUT** — master
- **CLR / RND** — clear or generate a constrained-random pattern
- **URL** — copy a link that encodes the whole state

State autosaves to localStorage; a shared URL overrides it.

## AUTO mode

A bar-clock state machine that mixes the set like a club DJ: phrase-locked
micro-variations (4/8/16 bars), element-by-element genre morphs with the
kick+bass swapped last and atomically (one groove owns the low end at all
times), tempo bends inside the 4/4 family, and kickless-break + halftime-snare
bridges into and out of 174 BPM dnb.

## Engine

- lookahead scheduler (25 ms tick / 100 ms horizon) — sample-accurate timing
- drum hits pre-rendered per parameter set in an OfflineAudioContext and
  replayed as buffers — low CPU, no crackle on phones
- per-track channels → sidechain duck bus → DJ filter → glue compressor →
  limiter → tanh soft clip
- kick FX send feeds a rumble bus (long reverb → 32–170 Hz band → saturation,
  ducked) — the classic deep-techno rumble bed
- tempo-synced dotted-eighth ping-pong delay + procedural convolution reverb
- open hats choked by closed hats; bass and sampler are true mono lines
