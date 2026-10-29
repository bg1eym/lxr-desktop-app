/*
 * LXR-02 Emu (unofficial) - the firmware's pattern data as the page sees it.
 * Layout of the snapshot: emu/seq_api.c, lxr_seq_snapshot().
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

export const TRACKS = 7;
export const STEPS = 64;
export const PATTERNS = 64;
export const NO_LOCK = 255;
/** Retrig choices, as the firmware's stepFlamNames. */
export const RETRIG = ['off', '×2', '×3', '×4', '×6', '×8'];
export const NUDGE_ZERO = 7;

export interface Step {
  on: boolean;
  vel: number;        // 0-127
  volFlag: number;    // bit 7 of the stored volume byte, kept as is
  prob: number;       // 0-100
  note: number;       // 0-127
  retrig: number;     // 0-5
  nudge: number;      // 0-14, 7 = on the grid; one unit = 1/8 step
  p1: number; p1v: number;
  p2: number; p2v: number;
}

export interface SeqData {
  pattern: number;
  playing: number;
  pending: number;
  running: boolean;
  /** the playing pattern has edits a pattern change would discard */
  edited: boolean;
  mutes: number;
  kit: number;
  bpm: number;
  swing: number;      // 0-127
  lengths: number[];
  steps: Step[][];    // [track][step]
}

const HEADER = 20;
const STEP_BYTES = 12;

export function parseSnapshot(b: Uint8Array): SeqData {
  const steps: Step[][] = [];
  for (let t = 0; t < TRACKS; t++) {
    const row: Step[] = [];
    for (let s = 0; s < STEPS; s++) {
      const o = HEADER + (t * STEPS + s) * STEP_BYTES;
      row.push({
        on: b[o] === 1,
        vel: b[o + 1] & 0x7f,
        volFlag: b[o + 1] & 0x80,
        prob: b[o + 2],
        note: b[o + 3],
        retrig: b[o + 4],
        nudge: b[o + 5],
        p1: b[o + 6], p1v: b[o + 7],
        p2: b[o + 8], p2v: b[o + 9],
      });
    }
    steps.push(row);
  }
  return {
    pattern: b[0], playing: b[1], pending: b[2], running: b[3] === 1, edited: b[16] === 1, mutes: b[4],
    kit: b[6], bpm: b[7], swing: b[15],
    lengths: Array.from(b.subarray(8, 8 + TRACKS)),
    steps,
  };
}

/** Arguments of lxr_seq_write_step() for a step. */
export function stepWrite(pattern: number, track: number, i: number, s: Step): number[] {
  return [pattern, track, i, s.on ? 1 : 0, s.vel, s.prob, s.note, s.retrig, s.nudge];
}

export function lockWrite(pattern: number, track: number, i: number, s: Step): number[] {
  return [pattern, track, i, s.p1, s.p1v, s.p2, s.p2v];
}

export function cloneStep(s: Step): Step {
  return { ...s };
}

export function sameStep(a: Step, b: Step): boolean {
  return a.on === b.on && a.vel === b.vel && a.prob === b.prob && a.note === b.note &&
    a.retrig === b.retrig && a.nudge === b.nudge &&
    a.p1 === b.p1 && a.p1v === b.p1v && a.p2 === b.p2 && a.p2v === b.p2v;
}

/** A step as a formatted card has it. */
export function blankStep(): Step {
  return { on: false, vel: 127, volFlag: 0, prob: 100, note: 60, retrig: 0, nudge: NUDGE_ZERO, p1: NO_LOCK, p1v: 0, p2: NO_LOCK, p2v: 0 };
}

/** Pattern name as on the device's banks: A1 ... D16. */
export function patternName(p: number): string {
  return 'ABCD'[Math.floor(p / 16)] + ((p % 16) + 1);
}

/** Note name as the firmware's setNoteName(): 60 = C5. */
export function noteName(n: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[n % 12] + Math.floor(n / 12);
}

export const hasLock = (s: Step) => s.p1 !== NO_LOCK || s.p2 !== NO_LOCK;
