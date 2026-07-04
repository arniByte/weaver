// main.js — builds the sequencer UI and wires it to the engine.

import {
  TRACKS, STEPS, PRESET_ORDER, applyPreset, randomize,
  serialize, saveLocal, loadInitialState,
} from './state.js';
import { Engine } from './engine.js';
import { Viz } from './viz.js';

const state = loadInitialState();
const engine = new Engine(state);
const viz = new Viz(document.getElementById('viz'), engine, state);

const $ = id => document.getElementById(id);
const grid = $('grid');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteLabel(offset) {
  const midi = 33 + offset; // A1 root
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// ---------- build grid ----------

const rows = {};   // id → { row, cells[], notes[], sliders{}, muteBtn }
const headerIdx = [];

function buildGrid() {
  grid.textContent = '';

  const head = div('row header');
  head.appendChild(div(''));
  for (let i = 0; i < STEPS; i++) {
    const d = div('idx' + (i % 4 === 0 ? ' beat' : ''));
    d.textContent = String(i + 1).padStart(2, '0');
    head.appendChild(d);
    headerIdx[i] = d;
  }
  head.appendChild(div(''));
  grid.appendChild(head);

  for (const t of TRACKS) {
    const row = div('row');
    row.dataset.id = t.id;

    const label = document.createElement('button');
    label.className = 'tlabel';
    label.textContent = t.label;
    label.title = 'mute/unmute';
    label.addEventListener('click', () => toggleMute(t.id));
    row.appendChild(label);

    const cells = [];
    for (let i = 0; i < STEPS; i++) {
      const c = div('cell');
      c.dataset.step = i;
      if (t.notes) {
        const n = document.createElement('span');
        n.className = 'note';
        c.appendChild(n);
        bindBassCell(c, t.id, i);
      } else {
        c.addEventListener('click', e => tapCell(t.id, i, e.shiftKey));
      }
      cells.push(c);
      row.appendChild(c);
    }

    const ctrls = div('ctrls');
    const muteBtn = document.createElement('button');
    muteBtn.className = 'mute';
    muteBtn.textContent = 'M';
    muteBtn.title = 'mute';
    muteBtn.addEventListener('click', () => toggleMute(t.id));
    ctrls.appendChild(muteBtn);

    const sliders = {};
    sliders.level = addSlider(ctrls, 'LVL', v => { state.tracks[t.id].level = v; engine.applyMix(t.id); });
    sliders.send = addSlider(ctrls, 'FX', v => { state.tracks[t.id].send = v; engine.applyMix(t.id); });
    for (const [key, lab] of t.params) {
      sliders[key] = addSlider(ctrls, lab, v => { state.tracks[t.id].params[key] = v; });
    }
    row.appendChild(ctrls);

    grid.appendChild(row);
    rows[t.id] = { row, cells, sliders, muteBtn };
  }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }

function addSlider(parent, label, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'sl';
  wrap.append(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0; input.max = 1; input.step = 0.01;
  input.addEventListener('input', () => { onInput(+input.value); dirty(); });
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}

// ---------- cell interaction ----------

function tapCell(id, i, accent) {
  const steps = state.tracks[id].steps;
  if (accent) steps[i] = steps[i] === 2 ? 1 : 2;
  else steps[i] = steps[i] ? 0 : 1;
  renderCell(id, i);
  dirty();
}

// bass cells: click toggles, vertical drag edits pitch
function bindBassCell(cell, id, i) {
  cell.addEventListener('pointerdown', e => {
    e.preventDefault();
    const tr = state.tracks[id];
    const startY = e.clientY;
    const startNote = tr.notes[i];
    let dragged = false;
    cell.setPointerCapture(e.pointerId);

    const move = ev => {
      const dy = startY - ev.clientY;
      if (!dragged && Math.abs(dy) < 5) return;
      dragged = true;
      tr.notes[i] = Math.max(-12, Math.min(12, startNote + Math.round(dy / 7)));
      renderCell(id, i);
    };
    const up = ev => {
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', up);
      cell.removeEventListener('pointercancel', up);
      if (!dragged) tapCell(id, i, ev.shiftKey);
      else dirty();
    };
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', up);
    cell.addEventListener('pointercancel', up);
  });
  cell.addEventListener('wheel', e => {
    e.preventDefault();
    const tr = state.tracks[id];
    tr.notes[i] = Math.max(-12, Math.min(12, tr.notes[i] - Math.sign(e.deltaY)));
    renderCell(id, i);
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
  if (tr.notes) {
    const n = c.querySelector('.note');
    n.textContent = v ? noteLabel(tr.notes[i]) : '';
  }
}

function renderTrack(id) {
  const tr = state.tracks[id];
  const r = rows[id];
  for (let i = 0; i < STEPS; i++) renderCell(id, i);
  r.row.classList.toggle('muted', tr.mute);
  r.muteBtn.classList.toggle('active', tr.mute);
  r.sliders.level.value = tr.level;
  r.sliders.send.value = tr.send;
  for (const [key] of TRACKS.find(t => t.id === id).params) {
    r.sliders[key].value = tr.params[key];
  }
}

function renderAll() {
  for (const t of TRACKS) renderTrack(t.id);
  $('bpm').value = state.bpm;
  $('swing').value = state.swing;
  $('master').value = state.master;
  $('pump').value = state.pump;
}

function toggleMute(id) {
  state.tracks[id].mute = !state.tracks[id].mute;
  engine.applyMix(id);
  renderTrack(id);
  dirty();
}

// ---------- transport & header ----------

const playBtn = $('play');

function setPlaying(on) {
  on ? engine.start() : engine.stop();
  playBtn.classList.toggle('active', engine.running);
  playBtn.innerHTML = engine.running ? '&#9632;' : '&#9654;';
}

playBtn.addEventListener('click', () => setPlaying(!engine.running));

document.addEventListener('keydown', e => {
  const isInput = e.target.tagName === 'INPUT';
  if (e.code === 'Space' && !(isInput && e.target.type === 'number')) {
    e.preventDefault();
    setPlaying(!engine.running);
    return;
  }
  if (isInput) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= PRESET_ORDER.length) loadPreset(PRESET_ORDER[n - 1]);
});

function numInput(id, min, max, apply) {
  const el = $(id);
  el.addEventListener('input', () => {
    const v = Math.round(+el.value);
    if (v >= min && v <= max) { apply(v); dirty(); }
  });
  el.addEventListener('change', () => {
    let v = Math.round(+el.value);
    if (!Number.isFinite(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    el.value = v;
    apply(v);
    dirty();
  });
}
numInput('bpm', 60, 200, v => { state.bpm = v; engine.updateDelayTime(); });
numInput('swing', 50, 75, v => { state.swing = v; });

$('master').addEventListener('input', e => { state.master = +e.target.value; engine.setMaster(state.master); dirty(); });
$('pump').addEventListener('input', e => { state.pump = +e.target.value; dirty(); });

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
  for (const t of TRACKS) engine.applyMix(t.id);
  engine.updateDelayTime();
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

// ---------- autosave ----------

let saveTimer = null;
function dirty() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLocal(state), 400);
}

// ---------- playhead / render loop ----------

let prevPh = -1;
function frame() {
  viz.draw();
  const step = engine.currentStep();
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
requestAnimationFrame(frame);

window.__weaver = { engine, state };   // console / testing handle
