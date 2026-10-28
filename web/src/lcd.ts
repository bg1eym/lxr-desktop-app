/*
 * LXR-02 Emu (unofficial) - 2x16 dot matrix display.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { LCD_FONT } from './lcdFont';

const COLS = 16;
const ROWS = 2;
const DOT = 4;          // dot pitch in CSS pixels
const CHAR_GAP = 1;     // dots between characters
const ROW_GAP = 2;      // dots between the two lines
const PAD = 3;          // dots around the text

const CELL_W = 5 + CHAR_GAP;
const CELL_H = 8 + ROW_GAP;
const W_DOTS = PAD * 2 + COLS * CELL_W - CHAR_GAP;
const H_DOTS = PAD * 2 + ROWS * CELL_H - ROW_GAP;

export class LcdView {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lcd = new Uint8Array(32).fill(0x20);
  private cg = new Uint8Array(64);
  private st = 1;
  private blinkOn = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lcd';
    this.canvas.width = W_DOTS * DOT * 2;   // 2x for sharp dots on retina
    this.canvas.height = H_DOTS * DOT * 2;
    this.canvas.setAttribute('role', 'img');
    this.g = this.canvas.getContext('2d')!;
    setInterval(() => { this.blinkOn = !this.blinkOn; if (this.st & 4) this.draw(); }, 400);
    this.draw();
  }

  /** Text currently on the display, two lines. */
  get text(): string[] {
    const s = Array.from(this.lcd, (c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '·')).join('');
    return [s.slice(0, 16), s.slice(16)];
  }

  update(lcd: Uint8Array, cg: Uint8Array, st: number) {
    this.lcd = lcd;
    this.cg = cg;
    this.st = st;
    this.canvas.setAttribute('aria-label', this.text.join(' / '));
    this.draw();
  }

  private glyph(code: number): ArrayLike<number> {
    if (code < 16) return this.cg.subarray((code & 7) * 8, (code & 7) * 8 + 8);
    return LCD_FONT.subarray(code * 8, code * 8 + 8);
  }

  private draw() {
    const g = this.g;
    const s = DOT * 2;
    const css = getComputedStyle(this.canvas);
    const bg = css.getPropertyValue('--lcd-bg').trim() || '#0b0c0a';
    const off = css.getPropertyValue('--lcd-off').trim() || '#1c1d14';
    const on = css.getPropertyValue('--lcd-on').trim() || '#ffd25e';
    g.fillStyle = bg;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const displayOn = (this.st & 1) !== 0;
    const cursorCell = (this.st >> 8) & 0xff;
    const showCursor = (this.st & 2) !== 0;
    const blink = (this.st & 4) !== 0 && this.blinkOn;
    const r = s * 0.42;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = row * COLS + col;
        const rows = this.glyph(this.lcd[cell]);
        const x0 = PAD + col * CELL_W;
        const y0 = PAD + row * CELL_H;
        for (let y = 0; y < 8; y++) {
          let bits = displayOn ? rows[y] : 0;
          if (displayOn && cell === cursorCell) {
            if (blink) bits = 0x1f;
            else if (showCursor && y === 7) bits = 0x1f;
          }
          for (let x = 0; x < 5; x++) {
            g.fillStyle = bits & (0x10 >> x) ? on : off;
            g.fillRect((x0 + x) * s + s / 2 - r, (y0 + y) * s + s / 2 - r, r * 2, r * 2);
          }
        }
      }
    }
  }
}
