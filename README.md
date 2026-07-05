# WEAVER

by arni · [weaver-vert.vercel.app](https://weaver-vert.vercel.app/)

Minimal browser groovebox + DJ tool. Black field, micro type, one bar of
sixteen steps — house, deep techno, techno, edm, dnb.

Everything the machine makes is synthesized live in the Web Audio API. No
samples, no dependencies, no build step. Load your own tracks to slice them on
the SP sequencer row **and** to play/auto-mix them whole on the DJ decks.

## Run

Open `index.html` from any static server (modules require http):

```
python3 -m http.server 8000
```

or deploy the repo root to Vercel / any static host as-is.

## Use

- **▶ / space** — run · **AUTO / a** — self-mixing DJ set · **NNBR** — bars
  per groove before AUTO changes the track (16/32/48/64)
- **click** a cell — toggle step; **shift+click** — accent (louder, brighter)
- **sound engines** (mode button per track): BD 909/808/HRD · SD CLS/RIM ·
  CH+OH MTL/NSE · BS ACD/DEP/RSE
- **BS row** — drag a cell vertically (or wheel) to set pitch
- **SP row + SMP POOL** — load any number of your own audio files (button or
  drag&drop); each is sliced into 16 pieces, drag a cell to pick the slice,
  TUN/OFS/LEN/DEC shape it; in AUTO mode the pool is rotated into the set
  as sliced textures automatically
- **BD SD CP CH OH BS ST NS SP** — kick, snare, clap, closed/open hat
  (with choke), bass, chord stab, noise sweep, sampler
- **1–5** — presets: HOUSE 124 · DEEP 127 · TECHNO 132 · EDM 128 · DNB 174
- **FLT** — master DJ filter: left = lowpass, right = highpass, double-click
  to reset · **PMP** — sidechain pump · **OUT** — master
- **CLR / RND** — clear or generate a constrained-random pattern
- **URL** — copy a short link (~170 chars, compact binary encoding) with the
  whole state

State autosaves to localStorage; a shared URL overrides it.

## DJ decks — play & auto-mix whole tracks

Load your tracks into the **SMP POOL**, then:

- **▶ on a pool chip** — spin that whole track on a deck (full playback, not sliced)
- **AUTOMIX** — auto-mix the entire pool like a DJ: tracks play back to back and
  crossfade near each other's end with an equal-power volume blend + a bass
  EQ-swap (outgoing bass out first, incoming bass in — the two never share the
  low end). **XFD** sets the crossfade length (4/8/16 s); **STOP** clears the decks.

Decks run through a glue compressor + limiter but skip the sequencer's sidechain
and DJ filter, so you can jam the drum machine over your own tracks.

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
- DJ decks: buffer playback → highpass → bass-shelf EQ → gain → glue/limiter,
  equal-power + EQ-swap crossfades for auto-mixing
- bottom light wall: additive bloom field driven by three analyser bands +
  kick onsets, over a persistence trail
