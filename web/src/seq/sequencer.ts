/*
 * LXR-02 Emu (unofficial) - step sequencer editor.
 *
 * Shows the playing pattern as a grid of the 7 tracks and, below it, a lane
 * for one value of the selected track's steps. The sound panel of the
 * selected track's voice goes to the right (see sound/editor.ts). It edits
 * the firmware's own pattern data (emu/seq_api.c), so the panel, the display
 * and the SD card see the same pattern; the grid in turn shows edits made on
 * the panel.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import type { LxrEmu, SeqEdit } from '../emu';
import { onLang, t, type Key } from '../i18n';
import {
  NUDGE_ZERO, PATTERNS, RETRIG, STEPS, TRACKS,
  blankStep, cloneStep, hasLock, lockWrite, noteName, patternName, sameStep, stepWrite,
  type SeqData, type Step,
} from './model';

const PAGE = 16;
const PAGES = STEPS / PAGE;
const BTN_START = 33;           // BUT_START_STOP, see BTN in main.ts
const PAR_BPM = 272;            // activeParameters index; 0 = EXT, 1 = MIDI clock
const BPM_MIN = 20;
const BPM_MAX = 255;
const KEEP_KEY = 'lxr02-emu-keep-edits';
const SIDE_KEY = 'lxr02-emu-sound-panel';

export const TRACK_NAMES = ['DRUM 1', 'DRUM 2', 'DRUM 3', 'SNARE', 'CYMBAL', 'HH CLOSED', 'HH OPEN'];
const ROW_NAMES = ['DRUM 1', 'DRUM 2', 'DRUM 3', 'SNARE', 'CYMBAL', 'HH CLS', 'HH OPN'];   // as on the panel
export const TRACK_COLORS = ['#ff7a45', '#ffa940', '#ffd25e', '#ff5d8f', '#b48cff', '#4fd1c5', '#63b3ed'];

type Lane = 'vel' | 'prob' | 'retrig' | 'nudge' | 'note';
const LANES: [Lane, Key][] = [
  ['vel', 'seqLaneVel'], ['prob', 'seqLaneProb'], ['retrig', 'seqLaneRetrig'],
  ['nudge', 'seqLaneNudge'], ['note', 'seqLaneNote'],
];

interface StepChange { track: number; step: number; before: Step; after: Step }
interface LengthChange { track: number; before: number; after: number }
interface UndoEntry {
  pattern: number;
  key: string;
  time: number;
  steps: Map<string, StepChange>;
  lengths: Map<number, LengthChange>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

function btn(cls: string, label: string | Node = ''): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

/** Tooltip and accessible name that follow the language. */
function hint(e: HTMLElement, key: Key, vars: Record<string, string | number> = {}, label = true) {
  onLang(() => {
    e.title = t(key, vars);
    if (label) e.setAttribute('aria-label', t(key, vars));
  });
}

/** Accessible name only, for areas where a tooltip would be in the way. */
function aria(e: HTMLElement, key: Key) {
  onLang(() => e.setAttribute('aria-label', t(key)));
}

function i18nText<E extends HTMLElement>(e: E, key: Key, vars: Record<string, string | number> = {}): E {
  onLang(() => { e.textContent = t(key, vars); });
  return e;
}

/** A setting kept in this browser; on unless switched off. */
function loadFlag(key: string): boolean {
  try { return localStorage.getItem(key) !== '0'; } catch { return true; }
}

function saveFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* not kept */ }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Value of a lane for a step, and the range. */
function laneGet(s: Step, lane: Lane): number {
  switch (lane) {
    case 'vel': return s.vel;
    case 'prob': return s.prob;
    case 'retrig': return s.retrig;
    case 'nudge': return s.nudge - NUDGE_ZERO;
    case 'note': return s.note;
  }
}
function laneSet(s: Step, lane: Lane, v: number) {
  switch (lane) {
    case 'vel': s.vel = clamp(v, 0, 127); break;
    case 'prob': s.prob = clamp(v, 0, 100); break;
    case 'retrig': s.retrig = clamp(v, 0, RETRIG.length - 1); break;
    case 'nudge': s.nudge = clamp(v, -7, 7) + NUDGE_ZERO; break;
    case 'note': s.note = clamp(v, 0, 127); break;
  }
}
const LANE_RANGE: Record<Lane, [number, number]> = {
  vel: [0, 127], prob: [0, 100], retrig: [0, RETRIG.length - 1], nudge: [-7, 7], note: [0, 127],
};
function laneDefault(lane: Lane): number {
  return laneGet(blankStep(), lane);
}
function laneLabel(s: Step, lane: Lane): string {
  switch (lane) {
    case 'vel': return String(s.vel);
    case 'prob': return `${s.prob}%`;
    case 'retrig': return s.retrig ? RETRIG[s.retrig] : '';
    case 'nudge': { const n = s.nudge - NUDGE_ZERO; return n ? (n > 0 ? `+${n}` : `−${-n}`) : ''; }
    case 'note': return noteName(s.note);
  }
}

interface Cell {
  root: HTMLDivElement;
  prob: HTMLSpanElement;
  rt: HTMLSpanElement;
  lock: HTMLSpanElement;
  nudge: HTMLSpanElement;
}

interface TrackRow {
  root: HTMLDivElement;
  name: HTMLButtonElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
  length: HTMLInputElement;
  more: HTMLButtonElement;
  cells: Cell[];
}

export class Sequencer {
  readonly root: HTMLElement;

  private data: SeqData | null = null;
  private ack = 0;                 // id of the last edit sent
  private live = false;
  private running = false;
  private heads: number[] = new Array(TRACKS).fill(0);
  private page = 0;
  private follow = true;
  private track = 0;               // selected track
  private sel = new Set<number>([0]); // selected steps of that track
  private anchor = 0;              // last clicked step, for keyboard moves
  private lane: Lane = 'vel';
  private keep = loadFlag(KEEP_KEY);
  private sideShown = loadFlag(SIDE_KEY);
  private solo = new Set<number>();
  private preSoloMutes: number | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private gesture: UndoEntry | null = null;
  private outSteps = new Map<string, number[]>();
  private outLocks = new Map<string, number[]>();
  private trackClip: { steps: Step[]; length: number } | null = null;
  private stepClip: [number, Step][] | null = null;
  private taps: number[] = [];

  /* toolbar */
  private playBtn = btn('seq-play');
  private bpmInput = el('input', 'seq-num seq-bpm');
  private bpmNote = el('span', 'seq-bpm-src');
  private swingInput = el('input', 'seq-swing');
  private swingValue = el('span', 'seq-value');
  private patBtn = btn('seq-pat');
  private patPending = el('span', 'seq-pending');
  private editedChip = el('span', 'seq-edited');
  private saveBtn = btn('seq-tool');
  private keepBox = el('input');
  private undoBtn = btn('seq-tool seq-icon', '↶');
  private redoBtn = btn('seq-tool seq-icon', '↷');
  private followBtn = btn('seq-tool seq-toggle');
  private sideBtn = btn('seq-tool seq-toggle');
  private barLabel = el('span', 'seq-bar-label');
  private overview = el('canvas', 'seq-overview');

  /* grid, lane */
  private rows: TrackRow[] = [];
  private grid = el('div', 'seq-grid');
  private laneTabs: HTMLButtonElement[] = [];
  private laneBars: { root: HTMLDivElement; bar: HTMLDivElement; label: HTMLSpanElement }[] = [];
  private laneArea = el('div', 'seq-lane-steps');
  private laneName = el('div', 'seq-lane-name');
  private pop: HTMLElement | null = null;

  /** Right of the grid: the sound panel goes here. */
  readonly side = el('aside', 'seq-side');
  /** The selected track changed. */
  onTrack: (track: number) => void = () => {};

  constructor(private emu: LxrEmu) {
    this.root = el('section', 'seq off');
    this.root.setAttribute('aria-label', 'Sequencer');
    this.root.append(this.buildToolbar(), el('div', 'seq-body', this.buildMain(), this.side));
    this.setSideShown(this.sideShown);
    this.emu.seqEdit({ keep: this.keep });
    this.bindKeys();
    onLang(() => this.render());
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target as Node)) this.closePop();
    });
  }

  /* ---- from the device ----------------------------------------------------- */

  setLive(on: boolean) {
    this.live = on;
    this.root.classList.toggle('off', !on);
    if (on) this.emu.seqView(255);
    this.render();
  }

  setData(d: SeqData, ack: number) {
    if (ack < this.ack) return;   // older than an edit in flight: the next one has it
    this.data = d;
    this.render();
  }

  setTransport(heads: number[], running: boolean) {
    const moved = running !== this.running || heads.some((h, i) => h !== this.heads[i]);
    if (!moved) return;
    this.heads = heads.slice();
    if (running !== this.running) {
      this.running = running;
      this.renderToolbar();
    }
    if (running && this.follow && this.data) {
      const len = this.data.lengths[this.track];
      const page = Math.floor((this.heads[this.track] % Math.max(1, len)) / PAGE);
      if (page !== this.page) { this.page = page; this.render(); return; }
    }
    this.renderHeads();
  }

  /* ---- layout -------------------------------------------------------------- */

  private buildToolbar(): HTMLElement {
    i18nText(this.playBtn, 'seqPlay');
    this.playBtn.addEventListener('click', () => {
      this.emu.button(BTN_START, true);
      setTimeout(() => this.emu.button(BTN_START, false), 60);
    });

    const bpm = this.bpmInput;
    bpm.type = 'number';
    bpm.min = String(BPM_MIN);
    bpm.max = String(BPM_MAX);
    bpm.step = '1';
    bpm.addEventListener('input', () => {
      const v = Math.round(Number(bpm.value));
      if (v >= BPM_MIN && v <= BPM_MAX) this.emu.setParam(PAR_BPM, v);
    });
    bpm.addEventListener('wheel', (e) => {
      if (document.activeElement !== bpm || !this.data) return;
      e.preventDefault();
      const v = clamp((this.data.bpm < 2 ? 120 : this.data.bpm) - Math.sign(e.deltaY), BPM_MIN, BPM_MAX);
      bpm.value = String(v);
      this.emu.setParam(PAR_BPM, v);
    }, { passive: false });
    const tap = i18nText(btn('seq-tool'), 'seqTap');
    hint(tap, 'seqTapHint', {}, false);
    tap.addEventListener('click', () => this.tapTempo());

    const sw = this.swingInput;
    sw.type = 'range';
    sw.min = '0';
    sw.max = '127';
    sw.addEventListener('input', () => {
      if (!this.data) return;
      const v = Number(sw.value);
      this.swingValue.textContent = `${Math.round((v / 127) * 100)}%`;
      this.send({ swing: [this.data.playing, v] });
    });
    sw.addEventListener('dblclick', () => {
      if (!this.data) return;
      sw.value = '0';
      this.send({ swing: [this.data.playing, 0] });
    });

    const prev = btn('seq-tool seq-icon', '‹');
    const next = btn('seq-tool seq-icon', '›');
    hint(prev, 'seqPrevPattern');
    hint(next, 'seqNextPattern');
    prev.addEventListener('click', () => this.stepPattern(-1));
    next.addEventListener('click', () => this.stepPattern(1));
    hint(this.patBtn, 'seqPatternHint');
    this.patBtn.addEventListener('click', () => this.openPatterns());

    hint(this.editedChip, 'seqEditedHint', {}, false);
    i18nText(this.saveBtn, 'seqSave');
    hint(this.saveBtn, 'seqSaveHint', {}, false);
    this.saveBtn.addEventListener('click', () => this.save());
    this.keepBox.type = 'checkbox';
    this.keepBox.checked = this.keep;
    this.keepBox.addEventListener('change', () => {
      this.keep = this.keepBox.checked;
      saveFlag(KEEP_KEY, this.keep);
      this.send({ keep: this.keep });
    });
    const keep = el('label', 'seq-check', this.keepBox, i18nText(el('span'), 'seqKeep'));
    hint(keep, 'seqKeepHint', {}, false);

    hint(this.undoBtn, 'seqUndo');
    hint(this.redoBtn, 'seqRedo');
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());

    i18nText(this.followBtn, 'seqFollow');
    hint(this.followBtn, 'seqFollowHint', {}, false);
    this.followBtn.addEventListener('click', () => {
      this.follow = !this.follow;
      this.renderToolbar();
    });

    i18nText(this.sideBtn, 'seqSoundPanel');
    hint(this.sideBtn, 'seqSoundPanelHint', {}, false);
    this.sideBtn.addEventListener('click', () => this.setSideShown(!this.sideShown));

    const group = (...kids: (Node | string)[]) => el('div', 'seq-group', ...kids);
    const label = (key: Key) => i18nText(el('span', 'seq-label'), key);
    return el('div', 'seq-bar',
      group(this.playBtn),
      group(label('seqBpm'), bpm, this.bpmNote, tap),
      group(label('seqSwing'), sw, this.swingValue),
      group(label('seqPattern'), prev, this.patBtn, next, this.patPending),
      group(this.editedChip, this.saveBtn, keep),
      group(this.undoBtn, this.redoBtn),
      el('div', 'seq-spacer'),
      group(this.sideBtn));
  }

  /** Show or hide the sound panel; without it the grid takes the whole width. */
  setSideShown(on: boolean) {
    this.sideShown = on;
    saveFlag(SIDE_KEY, on);
    this.root.classList.toggle('side-hidden', !on);
    this.sideBtn.classList.toggle('on', on);
    this.sideBtn.setAttribute('aria-pressed', String(on));
  }

  private buildMain(): HTMLElement {
    for (let tr = 0; tr < TRACKS; tr++) this.rows.push(this.buildRow(tr));
    this.grid.append(...this.rows.map((r) => r.root));
    this.overview.setAttribute('role', 'img');
    aria(this.overview, 'seqOverviewHint');
    hint(this.overview, 'seqOverviewHint', {}, false);
    this.overview.addEventListener('click', (e) => {
      const r = this.overview.getBoundingClientRect();
      this.page = clamp(Math.floor(((e.clientX - r.left) / r.width) * PAGES), 0, PAGES - 1);
      this.follow = false;
      this.render();
    });
    new ResizeObserver(() => this.drawOverview()).observe(this.overview);
    const view = el('div', 'seq-view', el('div', 'seq-view-head', this.barLabel, this.followBtn), this.overview);
    this.grid.tabIndex = 0;
    aria(this.grid, 'seqGridHint');
    this.bindGrid();

    const tabs = el('div', 'seq-lane-tabs');
    for (const [lane, key] of LANES) {
      const b = i18nText(btn('seq-tab'), key);
      b.addEventListener('click', () => { this.lane = lane; this.render(); });
      this.laneTabs.push(b);
      tabs.append(b);
    }
    const groups: HTMLDivElement[] = [];
    for (let g = 0; g < 4; g++) groups.push(el('div', 'seq-quad'));
    for (let j = 0; j < PAGE; j++) {
      const bar = el('div', 'seq-lane-bar');
      const label = el('span', 'seq-lane-label');
      const root = el('div', 'seq-lane-step', bar, label);
      this.laneBars.push({ root, bar, label });
      groups[j >> 2].append(root);
    }
    this.laneArea.append(...groups);
    aria(this.laneArea, 'seqLaneHint');
    this.bindLane();
    const lane = el('div', 'seq-lane', el('div', 'seq-lane-head', this.laneName, tabs), this.laneArea);
    return el('div', 'seq-main', view, this.grid, lane);
  }

  private buildRow(tr: number): TrackRow {
    const name = btn('seq-name', ROW_NAMES[tr]);
    hint(name, 'seqPreview', { name: TRACK_NAMES[tr] }, false);
    name.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.emu.trigger(tr, 110);
      if (this.track !== tr) { this.setTrack(tr); this.render(); }
    });
    const mute = btn('seq-ms', 'M');
    const solo = btn('seq-ms', 'S');
    hint(mute, 'seqMute');
    hint(solo, 'seqSolo');
    mute.addEventListener('click', () => this.toggleMute(tr));
    solo.addEventListener('click', (e) => this.toggleSolo(tr, e.metaKey || e.ctrlKey || e.shiftKey));
    const length = el('input', 'seq-num seq-len');
    length.type = 'number';
    length.min = '1';
    length.max = String(STEPS);
    hint(length, 'seqLength');
    length.addEventListener('change', () => {
      const v = Math.round(Number(length.value));
      if (v >= 1 && v <= STEPS) this.setLength(tr, v, `len${tr}`);
      else this.render();
    });
    length.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') length.dispatchEvent(new Event('change'));
    });
    const more = btn('seq-ms seq-more', '⋯');
    hint(more, 'seqTrackMenu');
    more.addEventListener('click', () => this.openTrackMenu(tr, more));

    const cells: Cell[] = [];
    const quads: HTMLDivElement[] = [];
    for (let g = 0; g < 4; g++) quads.push(el('div', 'seq-quad'));
    for (let j = 0; j < PAGE; j++) {
      const prob = el('span', 'm-prob');
      const rt = el('span', 'm-rt');
      const lock = el('span', 'm-lock');
      const nudge = el('span', 'm-nudge');
      const root = el('div', 'seq-cell', prob, rt, lock, nudge);
      root.dataset.track = String(tr);
      root.dataset.col = String(j);
      cells.push({ root, prob, rt, lock, nudge });
      quads[j >> 2].append(root);
    }
    const head = el('div', 'seq-head', el('span', 'seq-swatch'), name, mute, solo, length, more);
    const root = el('div', 'seq-row', head, el('div', 'seq-cells', ...quads));
    root.style.setProperty('--c', TRACK_COLORS[tr]);
    return { root, name, mute, solo, length, more, cells };
  }

  /* ---- rendering ----------------------------------------------------------- */

  private render() {
    this.renderToolbar();
    this.renderGrid();
    this.renderLane();
  }

  get selectedTrack(): number {
    return this.track;
  }

  /** Select a track, keeping the selected step positions. */
  private setTrack(tr: number) {
    if (tr === this.track) return;
    this.track = tr;
    if (!this.sel.size) this.sel.add(this.anchor);
    this.onTrack(tr);
  }

  private renderToolbar() {
    const d = this.data;
    const off = !this.live || !d;
    this.playBtn.textContent = t(this.running ? 'seqStop' : 'seqPlay');
    this.playBtn.classList.toggle('on', this.running);
    for (const e of [this.playBtn, this.bpmInput, this.swingInput, this.patBtn, this.saveBtn, this.keepBox]) {
      (e as HTMLButtonElement | HTMLInputElement).disabled = off;
    }
    this.undoBtn.disabled = off || !this.undoStack.length;
    this.redoBtn.disabled = off || !this.redoStack.length;
    this.followBtn.classList.toggle('on', this.follow);
    this.followBtn.setAttribute('aria-pressed', String(this.follow));
    if (!d) {
      this.patBtn.textContent = '—';
      this.editedChip.textContent = '';
      return;
    }
    if (document.activeElement !== this.bpmInput) this.bpmInput.value = d.bpm >= 2 ? String(d.bpm) : '';
    this.bpmNote.textContent = d.bpm === 0 ? t('seqExt') : d.bpm === 1 ? t('seqMidi') : '';
    if (document.activeElement !== this.swingInput) this.swingInput.value = String(d.swing);
    this.swingValue.textContent = `${Math.round((d.swing / 127) * 100)}%`;
    this.patBtn.textContent = patternName(d.playing);
    this.patPending.textContent = d.pending !== d.playing && d.pending < PATTERNS ? t('seqPending', { p: patternName(d.pending) }) : '';
    this.editedChip.textContent = d.edited ? t('seqEdited') : '';
    this.editedChip.classList.toggle('on', d.edited);
    this.barLabel.textContent = t('seqBarLabel', { n: this.page + 1, of: PAGES });
  }

  /** All 64 steps of every track; the bar shown below is framed. */
  private drawOverview() {
    const c = this.overview;
    const d = this.data;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const gap = 10, pad = 3;
    const barW = (W - gap * (PAGES - 1)) / PAGES;
    const stepW = (barW - 2 * pad) / PAGE;
    const rowH = (H - 2 * pad) / TRACKS;
    for (let p = 0; p < PAGES; p++) {
      const x0 = p * (barW + gap);
      g.fillStyle = p === this.page ? '#2b2e35' : '#1c1e23';
      g.beginPath();
      g.roundRect(x0, 0, barW, H, 5);
      g.fill();
      if (p === this.page) {
        g.strokeStyle = '#ffd25e';
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (!d) continue;
      for (let tr = 0; tr < TRACKS; tr++) {
        const len = Math.max(1, d.lengths[tr]);
        const head = this.running ? this.heads[tr] % len : -1;
        for (let j = 0; j < PAGE; j++) {
          const i = p * PAGE + j;
          const s = d.steps[tr][i];
          const inside = i < d.lengths[tr];
          g.fillStyle = i === head ? '#ffffff' : s.on && inside ? TRACK_COLORS[tr] : inside ? '#34373f' : '#24262b';
          g.fillRect(x0 + pad + j * stepW + 0.5, pad + tr * rowH + 0.5, Math.max(1, stepW - 1.5), Math.max(1, rowH - 1.5));
        }
      }
    }
  }

  private renderGrid() {
    const d = this.data;
    for (let tr = 0; tr < TRACKS; tr++) {
      const row = this.rows[tr];
      row.root.classList.toggle('selected', tr === this.track);
      const muted = d ? ((d.mutes >> tr) & 1) === 1 : false;
      row.root.classList.toggle('muted', muted);
      row.mute.classList.toggle('on', muted);
      row.mute.setAttribute('aria-pressed', String(muted));
      row.solo.classList.toggle('on', this.solo.has(tr));
      row.solo.setAttribute('aria-pressed', String(this.solo.has(tr)));
      for (const e of [row.name, row.mute, row.solo, row.length, row.more]) e.disabled = !this.live || !d;
      if (d && document.activeElement !== row.length) row.length.value = String(d.lengths[tr]);
      for (let j = 0; j < PAGE; j++) {
        const i = this.page * PAGE + j;
        const c = row.cells[j];
        const s = d?.steps[tr][i];
        const e = c.root;
        e.classList.toggle('on', !!s?.on);
        e.classList.toggle('out', !!d && i >= d.lengths[tr]);
        e.classList.toggle('sel', tr === this.track && this.sel.has(i));
        e.classList.toggle('beat', j % 4 === 0);
        e.style.setProperty('--v', s ? String(s.vel / 127) : '0');
        c.prob.textContent = s && s.on && s.prob < 100 ? `${s.prob}%` : '';
        c.rt.textContent = s && s.on && s.retrig ? RETRIG[s.retrig] : '';
        c.lock.hidden = !(s && hasLock(s));
        const n = s ? s.nudge - NUDGE_ZERO : 0;
        c.nudge.hidden = !(s && s.on && n);
        if (n) c.nudge.style.setProperty('--n', String(n / 8));
      }
    }
    this.renderHeads();
  }

  private renderHeads() {
    const d = this.data;
    for (let tr = 0; tr < TRACKS; tr++) {
      const len = d ? Math.max(1, d.lengths[tr]) : 16;
      const head = this.heads[tr] % len;
      const col = this.running && Math.floor(head / PAGE) === this.page ? head % PAGE : -1;
      const cells = this.rows[tr].cells;
      for (let j = 0; j < PAGE; j++) cells[j].root.classList.toggle('now', j === col);
    }
    this.drawOverview();
  }

  private renderLane() {
    const d = this.data;
    this.laneName.textContent = TRACK_NAMES[this.track];
    this.laneName.style.color = TRACK_COLORS[this.track];
    LANES.forEach(([lane], i) => {
      this.laneTabs[i].classList.toggle('on', lane === this.lane);
      this.laneTabs[i].setAttribute('aria-pressed', String(lane === this.lane));
    });
    const [lo, hi] = LANE_RANGE[this.lane];
    this.laneArea.classList.toggle('center', this.lane === 'nudge');
    this.laneArea.style.setProperty('--c', TRACK_COLORS[this.track]);
    for (let j = 0; j < PAGE; j++) {
      const i = this.page * PAGE + j;
      const s = d?.steps[this.track][i];
      const { root, bar, label } = this.laneBars[j];
      root.classList.toggle('on', !!s?.on);
      root.classList.toggle('out', !!d && i >= d.lengths[this.track]);
      root.classList.toggle('sel', this.sel.has(i));
      if (!s) { bar.style.height = '0'; label.textContent = ''; continue; }
      const v = laneGet(s, this.lane);
      if (this.lane === 'nudge') {
        const f = Math.abs(v) / 7;
        bar.style.height = `${f * 50}%`;
        bar.style.bottom = v >= 0 ? '50%' : `${50 - f * 50}%`;
      } else {
        bar.style.height = `${((v - lo) / (hi - lo)) * 100}%`;
        bar.style.bottom = '0';
      }
      label.textContent = s.on ? laneLabel(s, this.lane) : '';
    }
  }

  /* ---- editing ------------------------------------------------------------- */

  private send(edit: SeqEdit) {
    this.ack = this.emu.seqEdit(edit);
  }

  /** The undo entry edits go to. Edits with the same key in quick
   * succession (dragging a slider) are one entry. */
  private begin(key: string): UndoEntry {
    const d = this.data!;
    const now = performance.now();
    if (this.gesture && this.gesture.key === key) return this.gesture;
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.key === key && top.pattern === d.playing && now - top.time < 1500) {
      top.time = now;
      return top;
    }
    const g: UndoEntry = { pattern: d.playing, key, time: now, steps: new Map(), lengths: new Map() };
    this.undoStack.push(g);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.gesture = g;
    return g;
  }

  private endGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (g && !g.steps.size && !g.lengths.size) {
      const i = this.undoStack.lastIndexOf(g);
      if (i >= 0) this.undoStack.splice(i, 1);
    }
    this.renderToolbar();
  }

  private editStep(tr: number, i: number, f: (s: Step) => void, g: UndoEntry) {
    const d = this.data!;
    const cur = d.steps[tr][i];
    const next = cloneStep(cur);
    f(next);
    if (sameStep(cur, next)) return;
    const key = `${tr}:${i}`;
    const c = g.steps.get(key);
    if (c) c.after = next;
    else g.steps.set(key, { track: tr, step: i, before: cur, after: next });
    d.steps[tr][i] = next;
    this.queue(d.playing, tr, i, cur, next);
  }

  private queue(pattern: number, tr: number, i: number, before: Step, after: Step) {
    const key = `${pattern}:${tr}:${i}`;
    this.outSteps.set(key, stepWrite(pattern, tr, i, after));
    if (before.p1 !== after.p1 || before.p1v !== after.p1v || before.p2 !== after.p2 || before.p2v !== after.p2v) {
      this.outLocks.set(key, lockWrite(pattern, tr, i, after));
    }
  }

  private flush(extra: SeqEdit = {}) {
    const steps = [...this.outSteps.values()];
    const locks = [...this.outLocks.values()];
    this.outSteps.clear();
    this.outLocks.clear();
    if (steps.length || locks.length || Object.keys(extra).length) this.send({ steps, locks, ...extra });
  }

  private setLength(tr: number, len: number, key: string) {
    const d = this.data;
    if (!d || d.lengths[tr] === len) return;
    const g = this.begin(key);
    const c = g.lengths.get(tr);
    if (c) c.after = len;
    else g.lengths.set(tr, { track: tr, before: d.lengths[tr], after: len });
    d.lengths[tr] = len;
    this.endGesture();
    this.flush({ lengths: [[d.playing, tr, len]] });
    this.render();
  }

  private apply(e: UndoEntry, dir: 'before' | 'after') {
    const d = this.data;
    const lengths: number[][] = [];
    for (const c of e.steps.values()) {
      const s = c[dir];
      if (d && d.playing === e.pattern) d.steps[c.track][c.step] = cloneStep(s);
      this.queue(e.pattern, c.track, c.step, c[dir === 'before' ? 'after' : 'before'], s);
    }
    for (const c of e.lengths.values()) {
      if (d && d.playing === e.pattern) d.lengths[c.track] = c[dir];
      lengths.push([e.pattern, c.track, c[dir]]);
    }
    this.flush(lengths.length ? { lengths } : {});
    this.render();
  }

  private undo() {
    this.endGesture();
    let e: UndoEntry | undefined;
    do e = this.undoStack.pop(); while (e && !e.steps.size && !e.lengths.size);
    if (!e) { this.renderToolbar(); return; }
    this.redoStack.push(e);
    this.apply(e, 'before');
  }

  private redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push(e);
    this.apply(e, 'after');
  }

  private save() {
    if (!this.data) return;
    this.send({ save: true });
  }

  private stepPattern(dir: number) {
    const d = this.data;
    if (!d) return;
    const base = d.pending !== d.playing ? d.pending : d.playing;
    this.send({ pattern: (base + dir + PATTERNS) % PATTERNS });
  }

  private tapTempo() {
    const now = performance.now();
    this.taps = this.taps.filter((x) => now - x < 2000);
    this.taps.push(now);
    if (this.taps.length < 2) return;
    const span = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    const bpm = clamp(Math.round(60000 / span), BPM_MIN, BPM_MAX);
    this.bpmInput.value = String(bpm);
    this.emu.setParam(PAR_BPM, bpm);
    if (this.taps.length > 5) this.taps.shift();
  }

  /* mute and solo: the firmware's per-track mute; solo mutes the others */
  private setMutes(mask: number) {
    const d = this.data;
    if (!d) return;
    const mutes: [number, boolean][] = [];
    for (let tr = 0; tr < TRACKS; tr++) {
      const want = ((mask >> tr) & 1) === 1;
      if ((((d.mutes >> tr) & 1) === 1) !== want) mutes.push([tr, want]);
    }
    d.mutes = mask;
    if (mutes.length) this.send({ mutes });
    this.renderGrid();
  }

  private toggleMute(tr: number) {
    const d = this.data;
    if (!d) return;
    this.solo.clear();
    this.preSoloMutes = null;
    this.setMutes(d.mutes ^ (1 << tr));
  }

  private toggleSolo(tr: number, add: boolean) {
    const d = this.data;
    if (!d) return;
    if (!this.solo.size) this.preSoloMutes = d.mutes;
    if (add) {
      if (this.solo.has(tr)) this.solo.delete(tr); else this.solo.add(tr);
    } else if (this.solo.size === 1 && this.solo.has(tr)) {
      this.solo.clear();
    } else {
      this.solo = new Set([tr]);
    }
    if (!this.solo.size) {
      this.setMutes(this.preSoloMutes ?? 0);
      this.preSoloMutes = null;
      return;
    }
    let mask = 0;
    for (let i = 0; i < TRACKS; i++) if (!this.solo.has(i)) mask |= 1 << i;
    this.setMutes(mask);
  }

  /* track actions */
  private trackAction(tr: number, action: string) {
    const d = this.data;
    if (!d) return;
    const len = d.lengths[tr];
    const g = this.begin(`track-${action}-${tr}-${performance.now()}`);
    const row = d.steps[tr];
    const fill = (every: number, offset: number) => {
      for (let i = 0; i < STEPS; i++) this.editStep(tr, i, (s) => { s.on = i < len && i % every === offset; }, g);
    };
    switch (action) {
      case 'fill4': fill(4, 0); break;
      case 'fill2': fill(2, 0); break;
      case 'offbeat': fill(4, 2); break;
      case 'fill1': fill(1, 0); break;
      case 'rotl':
      case 'rotr': {
        const src = row.slice(0, len).map(cloneStep);
        const k = action === 'rotl' ? 1 : len - 1;
        for (let i = 0; i < len; i++) {
          const from = src[(i + k) % len];
          this.editStep(tr, i, (s) => { Object.assign(s, { ...from, volFlag: s.volFlag }); }, g);
        }
        break;
      }
      case 'humanize':
        for (let i = 0; i < len; i++) {
          if (!row[i].on) continue;
          const v = clamp(Math.round(row[i].vel + (Math.random() * 2 - 1) * 12), 1, 127);
          this.editStep(tr, i, (s) => { s.vel = v; }, g);
        }
        break;
      case 'copy':
        this.trackClip = { steps: row.map(cloneStep), length: len };
        break;
      case 'paste': {
        const clip = this.trackClip;
        if (!clip) break;
        for (let i = 0; i < STEPS; i++) this.editStep(tr, i, (s) => { Object.assign(s, { ...clip.steps[i], volFlag: s.volFlag }); }, g);
        if (clip.length !== len) {
          g.lengths.set(tr, { track: tr, before: len, after: clip.length });
          d.lengths[tr] = clip.length;
          this.flush({ lengths: [[d.playing, tr, clip.length]] });
        }
        break;
      }
      case 'clear':
        for (let i = 0; i < STEPS; i++) this.editStep(tr, i, (s) => { Object.assign(s, { ...blankStep(), volFlag: s.volFlag }); }, g);
        break;
    }
    this.flush();
    this.endGesture();
    this.render();
  }

  /* ---- grid and lane input ------------------------------------------------- */

  private cellAt(x: number, y: number): { tr: number; i: number } | null {
    const e = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.seq-cell');
    if (!e || !this.grid.contains(e)) return null;
    return { tr: Number(e.dataset.track), i: this.page * PAGE + Number(e.dataset.col) };
  }

  private select(tr: number, steps: number[], anchor = steps[0]) {
    this.setTrack(tr);
    this.sel = new Set(steps);
    this.anchor = anchor ?? 0;
  }

  private bindGrid() {
    let paint: { tr: number; on: boolean } | null = null;
    const g = this.grid;
    g.addEventListener('contextmenu', (e) => {
      const hit = this.cellAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      this.select(hit.tr, [hit.i]);
      this.render();
    });
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.live || !this.data) return;
      const hit = this.cellAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      g.focus({ preventScroll: true });
      if (e.shiftKey) {
        if (hit.tr !== this.track) { this.setTrack(hit.tr); this.sel.clear(); }
        if (this.sel.has(hit.i) && this.sel.size > 1) this.sel.delete(hit.i); else this.sel.add(hit.i);
        this.anchor = hit.i;
        this.render();
        return;
      }
      const on = !this.data.steps[hit.tr][hit.i].on;
      const gest = this.begin(`paint-${performance.now()}`);
      this.editStep(hit.tr, hit.i, (s) => { s.on = on; }, gest);
      this.select(hit.tr, [hit.i]);
      if (on) this.emu.trigger(hit.tr, this.data.steps[hit.tr][hit.i].vel);
      paint = { tr: hit.tr, on };
      g.setPointerCapture(e.pointerId);
      this.flush();
      this.render();
    });
    g.addEventListener('pointermove', (e) => {
      if (!paint || !this.gesture) return;
      const hit = this.cellAt(e.clientX, e.clientY);
      if (!hit || hit.tr !== paint.tr) return;
      const before = this.gesture.steps.size;
      this.editStep(hit.tr, hit.i, (s) => { s.on = paint!.on; }, this.gesture);
      if (this.gesture.steps.size !== before) {
        this.flush();
        this.renderGrid();
        this.renderLane();
        this.renderToolbar();
      }
    });
    const end = () => {
      if (!paint) return;
      paint = null;
      this.endGesture();
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  }

  private bindLane() {
    const a = this.laneArea;
    let last: { j: number; v: number } | null = null;
    const valueAt = (e: PointerEvent): { j: number; v: number } | null => {
      const bars = this.laneBars;
      let j = -1;
      for (let k = 0; k < PAGE; k++) {
        const r = bars[k].root.getBoundingClientRect();
        if (e.clientX < r.right + 2) { j = k; break; }
      }
      if (j < 0) j = PAGE - 1;
      const r = bars[j].root.getBoundingClientRect();
      const f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      const [lo, hi] = LANE_RANGE[this.lane];
      return { j, v: Math.round(lo + f * (hi - lo)) };
    };
    const set = (j: number, v: number) => {
      const i = this.page * PAGE + j;
      const lane = this.lane;
      this.editStep(this.track, i, (s) => laneSet(s, lane, v), this.gesture!);
    };
    a.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.live || !this.data) return;
      e.preventDefault();
      this.begin(`lane-${performance.now()}`);
      const p = valueAt(e);
      if (!p) return;
      set(p.j, p.v);
      last = p;
      a.setPointerCapture(e.pointerId);
      this.flush();
      this.renderGrid();
      this.renderLane();
    });
    a.addEventListener('pointermove', (e) => {
      if (!last || !this.gesture) return;
      const p = valueAt(e);
      if (!p) return;
      // fill the steps the pointer skipped
      const step = p.j > last.j ? 1 : -1;
      for (let j = last.j; j !== p.j; j += step) {
        const f = (j - last.j) / (p.j - last.j);
        if (j !== last.j) set(j, Math.round(last.v + (p.v - last.v) * f));
      }
      set(p.j, p.v);
      last = p;
      this.flush();
      this.renderGrid();
      this.renderLane();
    });
    const end = () => {
      if (!last) return;
      last = null;
      this.endGesture();
    };
    a.addEventListener('pointerup', end);
    a.addEventListener('pointercancel', end);
    a.addEventListener('dblclick', (e) => {
      if (!this.data) return;
      const p = valueAt(e as PointerEvent);
      if (!p) return;
      this.begin(`lane-reset-${performance.now()}`);
      set(p.j, laneDefault(this.lane));
      this.flush();
      this.endGesture();
      this.render();
    });
  }

  private bindKeys() {
    // undo, redo and save work anywhere on the page
    window.addEventListener('keydown', (e) => {
      if (!this.live || !(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range' && (e.target as HTMLInputElement).type !== 'checkbox') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
      else if (k === 's') { e.preventDefault(); this.save(); }
    });
    // selection keys while the grid has the focus
    this.grid.addEventListener('keydown', (e) => {
      const d = this.data;
      // not for keys typed into the track headers' controls
      if (!this.live || !d || e.target !== this.grid) return;
      const mod = e.metaKey || e.ctrlKey;
      let handled = true;
      const steps = [...this.sel].sort((a, b) => a - b);
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (mod) { handled = false; break; }
          const i = clamp((steps.length ? this.anchor : this.page * PAGE - 1) + (e.key === 'ArrowLeft' ? -1 : 1), 0, STEPS - 1);
          if (e.shiftKey) this.sel.add(i); else this.sel = new Set([i]);
          this.anchor = i;
          this.page = Math.floor(i / PAGE);
          this.follow = false;
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown':
          if (mod) { handled = false; break; }
          this.setTrack(clamp(this.track + (e.key === 'ArrowUp' ? -1 : 1), 0, TRACKS - 1));
          this.sel = new Set([this.anchor]);
          break;
        case 'Enter': {
          if (!steps.length) break;
          const on = !d.steps[this.track][steps[0]].on;
          const g = this.begin(`key-${performance.now()}`);
          for (const i of steps) this.editStep(this.track, i, (s) => { s.on = on; }, g);
          this.flush();
          this.endGesture();
          break;
        }
        case 'Delete':
        case 'Backspace': {
          const g = this.begin(`key-${performance.now()}`);
          for (const i of steps) this.editStep(this.track, i, (s) => { s.on = false; }, g);
          this.flush();
          this.endGesture();
          break;
        }
        case 'Escape':
          this.sel = new Set([this.anchor]);
          break;
        default:
          handled = false;
          if (!mod) break;
          if (e.key.toLowerCase() === 'a') {
            this.sel = new Set(Array.from({ length: PAGE }, (_, j) => this.page * PAGE + j));
            handled = true;
          } else if (e.key.toLowerCase() === 'c' && steps.length) {
            this.stepClip = steps.map((i) => [i - steps[0], cloneStep(d.steps[this.track][i])]);
            handled = true;
          } else if (e.key.toLowerCase() === 'v' && this.stepClip && steps.length) {
            const g = this.begin(`paste-${performance.now()}`);
            for (const [off, src] of this.stepClip) {
              const i = steps[0] + off;
              if (i < STEPS) this.editStep(this.track, i, (s) => { Object.assign(s, { ...src, volFlag: s.volFlag }); }, g);
            }
            this.flush();
            this.endGesture();
            handled = true;
          }
      }
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      this.render();
    });
  }

  /* ---- popovers ------------------------------------------------------------ */

  private openPop(anchor: HTMLElement, content: HTMLElement) {
    this.closePop();
    const pop = el('div', 'seq-pop', content);
    this.root.append(pop);
    const r = anchor.getBoundingClientRect();
    const base = this.root.getBoundingClientRect();
    const left = Math.min(r.left - base.left, base.width - pop.offsetWidth - 8);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${r.bottom - base.top + 6}px`;
    this.pop = pop;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      this.closePop();
      anchor.focus();
      window.removeEventListener('keydown', close, true);
    };
    window.addEventListener('keydown', close, true);
    (pop.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus();
  }

  private closePop() {
    this.pop?.remove();
    this.pop = null;
  }

  private openPatterns() {
    const d = this.data;
    if (!d) return;
    const grid = el('div', 'seq-patgrid');
    for (let bank = 0; bank < 4; bank++) {
      grid.append(el('span', 'seq-bank', 'ABCD'[bank]));
      for (let k = 0; k < 16; k++) {
        const p = bank * 16 + k;
        const b = btn('seq-patb', String(k + 1));
        b.classList.toggle('playing', p === d.playing);
        b.classList.toggle('pending', p === d.pending && d.pending !== d.playing);
        b.title = patternName(p);
        b.addEventListener('click', () => {
          this.send({ pattern: p });
          this.closePop();
        });
        grid.append(b);
      }
    }
    const note = el('p', 'seq-hint', t(this.running ? 'seqPatternWhenPlaying' : 'seqPatternNow'));
    this.openPop(this.patBtn, el('div', '', grid, note));
  }

  private openTrackMenu(tr: number, anchor: HTMLElement) {
    const items: [string, Key][] = [
      ['fill4', 'seqFill4'], ['fill2', 'seqFill2'], ['offbeat', 'seqOffbeat'], ['fill1', 'seqFill1'],
      ['', 'seqFill4'],
      ['rotl', 'seqRotL'], ['rotr', 'seqRotR'], ['humanize', 'seqHumanize'],
      ['', 'seqFill4'],
      ['copy', 'seqCopyTrack'], ['paste', 'seqPasteTrack'], ['clear', 'seqClearTrack'],
    ];
    const menu = el('div', 'seq-menu');
    menu.append(el('div', 'seq-menu-title', TRACK_NAMES[tr]));
    for (const [action, key] of items) {
      if (!action) { menu.append(el('hr')); continue; }
      const b = btn('seq-menu-item', t(key));
      if (action === 'paste' && !this.trackClip) b.disabled = true;
      b.addEventListener('click', () => {
        this.closePop();
        this.trackAction(tr, action);
      });
      menu.append(b);
    }
    this.openPop(anchor, menu);
  }
}
