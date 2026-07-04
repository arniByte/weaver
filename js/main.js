// main.js — builds the sequencer UI and wires it to the engine.

import {
  TRACKS, STEPS, PRESET_ORDER, BASS_MODES, applyPreset, randomize,
  serialize, saveLocal, loadInitialState,
} from './state.js';
import { Engine } from './engine.js';
import { Viz } from './viz.js';
import { LightWall } from './lightwall.js';
import { AutoPilot } from './autopilot.js';

const state = loadInitialState();
const engine = new Engine(state);
const viz = new Viz(document.getElementById('viz'), engine, state);
const wall = new LightWall(document.getElementById('wall'), engine);

const $ = id => document.getElementById(id);
const grid = $('grid');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteLabel(offset) {
  const midi = 33 + offset; // A1 root
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

const pct = v => String(Math.round(v * 99)).padStart(2, '0');

// ---------- build grid ----------

const rows = {};   // id → { row, cells[], sliders[], muteBtn, modeBtn?, fname? }
const headerIdx = [];

function buildGrid() {
  grid.textContent = '';

  const head = div('track header');
  head.appendChild(div(''));
  const idxWrap = div('steps');
  for (let i = 0; i < STEPS; i++) {
    const d = div('idx' + (i % 4 === 0 ? ' beat' : ''));
    d.textContent = String(i + 1).padStart(2, '0');
    idxWrap.appendChild(d);
    headerIdx[i] = d;
  }
  head.appendChild(idxWrap);
  head.appendChild(div('hspacer'));
  grid.appendChild(head);

  for (const t of TRACKS) {
    const row = div('track');
    row.dataset.id = t.id;

    const label = document.createElement('button');
    label.className = 'tlabel';
    label.textContent = t.label;
    label.title = 'mute/unmute';
    label.addEventListener('click', () => toggleMute(t.id));
    row.appendChild(label);

    const stepsWrap = div('steps');
    const cells = [];
    for (let i = 0; i < STEPS; i++) {
      const c = div('cell');
      c.dataset.step = i;
      if (t.notes || t.slices) {
        const n = document.createElement('span');
        n.className = 'note';
        c.appendChild(n);
        bindLaneCell(c, t, i);
      } else {
        c.addEventListener('click', e => tapCell(t.id, i, e.shiftKey));
      }
      cells.push(c);
      stepsWrap.appendChild(c);
    }
    row.appendChild(stepsWrap);

    const ctrls = div('ctrls');
    const muteBtn = document.createElement('button');
    muteBtn.className = 'mute';
    muteBtn.textContent = 'M';
    muteBtn.title = 'mute';
    muteBtn.addEventListener('click', () => toggleMute(t.id));
    ctrls.appendChild(muteBtn);

    let modeBtn = null;
    if (t.modes) {
      modeBtn = document.createElement('button');
      modeBtn.className = 'mode';
      modeBtn.title = 'bass engine: acid / deep rumble / reese';
      modeBtn.addEventListener('click', () => {
        const tr = state.tracks[t.id];
        tr.mode = ((tr.mode || 0) + 1) % BASS_MODES.length;
        renderTrack(t.id);
        dirty();
      });
      ctrls.appendChild(modeBtn);
    }

    let fname = null;
    if (t.slices) {
      const loadBtn = document.createElement('button');
      loadBtn.className = 'load';
      loadBtn.textContent = 'LOAD';
      loadBtn.title = 'load your own audio (or drop a file anywhere)';
      loadBtn.addEventListener('click', () => $('file').click());
      ctrls.appendChild(loadBtn);
      fname = document.createElement('span');
      fname.className = 'fname';
      fname.textContent = 'NO FILE';
      ctrls.appendChild(fname);
    }

    const sliders = [];
    sliders.push(makeSlider(ctrls, 'LVL',
      () => state.tracks[t.id].level,
      v => { state.tracks[t.id].level = v; engine.applyMix(t.id); }));
    sliders.push(makeSlider(ctrls, 'FX',
      () => state.tracks[t.id].send,
      v => { state.tracks[t.id].send = v; engine.applyMix(t.id); }));
    for (const [key, lab] of t.params) {
      sliders.push(makeSlider(ctrls, lab,
        () => state.tracks[t.id].params[key],
        v => { state.tracks[t.id].params[key] = v; }));
    }
    row.appendChild(ctrls);

    grid.appendChild(row);
    rows[t.id] = { row, cells, sliders, muteBtn, modeBtn, fname };
  }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }

function makeSlider(parent, label, get, set) {
  const wrap = document.createElement('label');
  wrap.className = 'sl';
  wrap.append(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0; input.max = 1; input.step = 0.01;
  const out = document.createElement('output');
  input.addEventListener('input', () => {
    set(+input.value);
    out.textContent = pct(+input.value);
    dirty();
  });
  wrap.appendChild(input);
  wrap.appendChild(out);
  parent.appendChild(wrap);
  return { sync() { input.value = get(); out.textContent = pct(get()); } };
}

// ---------- cell interaction ----------

function tapCell(id, i, accent) {
  const steps = state.tracks[id].steps;
  if (accent) steps[i] = steps[i] === 2 ? 1 : 2;
  else steps[i] = steps[i] ? 0 : 1;
  renderCell(id, i);
  dirty();
}

// bass / sample cells: click toggles, vertical drag (or wheel) edits the lane value
function laneAccess(t) {
  return t.notes
    ? { get: (tr, i) => tr.notes[i], set: (tr, i, v) => { tr.notes[i] = v; }, lo: -12, hi: 12, step: 7 }
    : { get: (tr, i) => tr.slices[i], set: (tr, i, v) => { tr.slices[i] = v; }, lo: 0, hi: 15, step: 9 };
}

function bindLaneCell(cell, t, i) {
  const lane = laneAccess(t);
  cell.addEventListener('pointerdown', e => {
    e.preventDefault();
    const tr = state.tracks[t.id];
    const startY = e.clientY;
    const start = lane.get(tr, i);
    let dragged = false;
    cell.setPointerCapture(e.pointerId);

    const move = ev => {
      const dy = startY - ev.clientY;
      if (!dragged && Math.abs(dy) < 5) return;
      dragged = true;
      lane.set(tr, i, Math.max(lane.lo, Math.min(lane.hi, start + Math.round(dy / lane.step))));
      renderCell(t.id, i);
    };
    const up = ev => {
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', up);
      cell.removeEventListener('pointercancel', up);
      if (!dragged) tapCell(t.id, i, ev.shiftKey);
      else dirty();
    };
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', up);
    cell.addEventListener('pointercancel', up);
  });
  cell.addEventListener('wheel', e => {
    e.preventDefault();
    const tr = state.tracks[t.id];
    lane.set(tr, i, Math.max(lane.lo, Math.min(lane.hi, lane.get(tr, i) - Math.sign(e.deltaY))));
    renderCell(t.id, i);
    dirty();
  }, { passive: false });
}

// ---------- rendering ----------

function renderCell(id, i) {
  const tr = state.tracks[id];
  const c = rows[id].cells[i];
  const v = tr.steps[i];
  c.classList.toggle('on', v === 1);
  c.classList.toggle('acc', v === 2);
  if (tr.notes || tr.slices) {
    const n = c.querySelector('.note');
    n.textContent = v
      ? (tr.notes ? noteLabel(tr.notes[i]) : String(tr.slices[i] + 1).padStart(2, '0'))
      : '';
  }
}

function renderTrack(id) {
  const tr = state.tracks[id];
  const r = rows[id];
  for (let i = 0; i < STEPS; i++) renderCell(id, i);
  r.row.classList.toggle('muted', tr.mute);
  r.muteBtn.classList.toggle('active', tr.mute);
  for (const s of r.sliders) s.sync();
  if (r.modeBtn) r.modeBtn.textContent = BASS_MODES[tr.mode || 0];
  if (r.fname) r.fname.textContent = engine.sampleName || 'NO FILE';
}

const header = {};
function syncHeader() {
  header.bpm.sync(); header.swing.sync(); header.filter.sync();
  header.pump.sync(); header.master.sync();
}

function renderAll() {
  for (const t of TRACKS) renderTrack(t.id);
  syncHeader();
}

function toggleMute(id) {
  state.tracks[id].mute = !state.tracks[id].mute;
  engine.applyMix(id);
  renderTrack(id);
  dirty();
}

// ---------- header controls ----------

function headerSlider(id, get, set, fmt) {
  const input = $(id);
  const out = $(id + '-v');
  input.addEventListener('input', () => {
    set(+input.value);
    out.textContent = fmt(+input.value);
    dirty();
  });
  return { input, sync() { input.value = get(); out.textContent = fmt(get()); } };
}

header.bpm = headerSlider('bpm',
  () => state.bpm,
  v => { state.bpm = Math.round(v); engine.updateDelayTime(); },
  v => String(Math.round(v)));
header.swing = headerSlider('swing',
  () => state.swing,
  v => { state.swing = Math.round(v); },
  v => String(Math.round(v)));
header.filter = headerSlider('filter',
  () => state.filter,
  v => { state.filter = Math.abs(v) < 0.04 ? 0 : v; engine.setFilter(state.filter); },
  v => v < -0.04 ? 'LP' + pct(-v) : v > 0.04 ? 'HP' + pct(v) : '——');
header.pump = headerSlider('pump',
  () => state.pump,
  v => { state.pump = v; },
  pct);
header.master = headerSlider('master',
  () => state.master,
  v => { state.master = v; engine.setMaster(v); },
  pct);

$('filter').addEventListener('dblclick', () => {
  state.filter = 0;
  engine.setFilter(0);
  header.filter.sync();
  dirty();
});

// ---------- transport / auto ----------

const playBtn = $('play');

function setPlaying(on) {
  on ? engine.start() : engine.stop();
  playBtn.classList.toggle('active', engine.running);
  playBtn.innerHTML = engine.running ? '&#9632;' : '&#9654;';
}

playBtn.addEventListener('click', () => setPlaying(!engine.running));

const auto = new AutoPilot(state, engine, {
  refresh: renderAll,
  status: text => { $('autostat').textContent = text; },
});
let lastPreset = 'house';

function toggleAuto() {
  if (auto.on) {
    auto.disable();
    $('auto').classList.remove('active');
  } else {
    if (!engine.running) setPlaying(true);
    auto.enable(lastPreset);
    $('auto').classList.add('active');
  }
}
$('auto').addEventListener('click', toggleAuto);

document.addEventListener('keydown', e => {
  const isInput = e.target.tagName === 'INPUT';
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!engine.running);
    return;
  }
  if (isInput) return;
  if (e.key === 'a' || e.key === 'A') { toggleAuto(); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= PRESET_ORDER.length) loadPreset(PRESET_ORDER[n - 1]);
});

// presets
const presetBtns = {};
const presetBox = $('presets');
for (const name of PRESET_ORDER) {
  const b = document.createElement('button');
  b.textContent = name.toUpperCase();
  b.addEventListener('click', () => loadPreset(name));
  presetBox.appendChild(b);
  presetBtns[name] = b;
}

function loadPreset(name) {
  applyPreset(state, name);
  lastPreset = name;
  for (const t of TRACKS) engine.applyMix(t.id);
  engine.updateDelayTime();
  if (engine.drums) engine.primeDrums();
  if (auto.on) auto.enable(name);   // re-anchor the arc on the chosen genre
  renderAll();
  markPreset(name);
  dirty();
}

function markPreset(name) {
  for (const [k, b] of Object.entries(presetBtns)) b.classList.toggle('active', k === name);
}

// tools
$('clear').addEventListener('click', () => {
  for (const t of TRACKS) state.tracks[t.id].steps.fill(0);
  renderAll();
  markPreset(null);
  dirty();
});

$('random').addEventListener('click', () => {
  randomize(state);
  renderAll();
  markPreset(null);
  dirty();
});

$('share').addEventListener('click', async () => {
  const hash = serialize(state);
  history.replaceState(null, '', '#' + hash);
  const btn = $('share');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'COPIED';
  } catch {
    btn.textContent = 'IN URL';
  }
  setTimeout(() => { btn.textContent = 'URL'; }, 1200);
});

// ---------- sample loading ----------

async function loadSampleFile(file) {
  if (!file) return;
  try {
    engine.init();
    const raw = await file.arrayBuffer();
    const buf = await engine.ctx.decodeAudioData(raw);
    engine.setSample(buf, file.name.toUpperCase().slice(0, 18));
    renderTrack('smp');
  } catch {
    engine.setSample(null, 'DECODE ERR');
    renderTrack('smp');
  }
}

$('file').addEventListener('change', e => loadSampleFile(e.target.files[0]));
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('audio/'));
  if (f) loadSampleFile(f);
});

// ---------- autosave ----------

let saveTimer = null;
function dirty() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLocal(state), 400);
}

// ---------- render loop ----------

let prevPh = -1;
function frame() {
  const step = engine.currentStep();
  viz.draw();
  wall.draw(step);
  if (step !== prevPh) {
    if (prevPh >= 0) {
      headerIdx[prevPh].classList.remove('ph');
      for (const t of TRACKS) rows[t.id].cells[prevPh].classList.remove('ph');
    }
    if (step >= 0) {
      headerIdx[step].classList.add('ph');
      for (const t of TRACKS) rows[t.id].cells[step].classList.add('ph');
    }
    prevPh = step;
  }
  requestAnimationFrame(frame);
}

// ---------- boot ----------

buildGrid();
renderAll();
saveLocal(state);   // persist whatever we booted from (incl. a shared URL)
requestAnimationFrame(frame);

window.__weaver = { engine, state, auto };   // console / testing handle
