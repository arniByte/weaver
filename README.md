# WEAVER

Minimal browser groovebox / DJ sketchpad. Black field, micro type, one bar of
sixteen steps — house, techno, edm, dnb.

Everything you hear is synthesized live in the Web Audio API. No samples,
no dependencies, no build step.

## Run

Open `index.html` from any static server (modules require http):

```
python3 -m http.server 8000
```

or deploy the repo root to Vercel / any static host as-is.

## Use

- **▶ / space** — run
- **click** a cell — toggle step; **shift+click** — accent (louder, brighter)
- **BS row** — drag a cell vertically (or mouse-wheel) to set pitch
- **BD SD CP CH OH BS ST NS** — kick, snare, clap, closed/open hat
  (with choke), acid bass, chord stab, noise sweep
- **1–4** — genre presets: HOUSE 124 · TECHNO 132 · EDM 128 · DNB 174
- **per track** — level, FX send (ping-pong delay + reverb), mute,
  synthesis params (tune / decay / drive / cutoff / resonance / chord)
- **BPM · SWG** — tempo and MPC-style swing, **PMP** — sidechain pump,
  **OUT** — master
- **CLR / RND** — clear or generate a constrained-random pattern
- **URL** — copy a link that encodes the whole state

State autosaves to localStorage; a shared URL overrides it.

## Engine

- lookahead scheduler (25 ms tick / 100 ms horizon) — sample-accurate timing
- per-track channels → sidechain duck bus → glue compressor → limiter
- tempo-synced dotted-eighth ping-pong delay + procedural convolution reverb
- open hats choked by closed hats; bass is a true mono line
