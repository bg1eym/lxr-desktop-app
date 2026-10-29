/*
 * LXR-02 Emu (unofficial) - front panel controls: buttons with LEDs,
 * endless pots, the data encoder and the volume faders.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface ButtonOpts {
  label: string;
  sub?: string;        // second function (with SHIFT), shown small
  key?: string;        // keyboard hint
  latch?: boolean;     // click toggles down/up instead of momentary
  hasLed?: boolean;
  cls?: string;
}

/** A panel button. onChange(down) fires on press and release. */
export class PanelButton {
  readonly root: HTMLDivElement;
  private led: HTMLSpanElement | null = null;
  private btn: HTMLButtonElement;
  private down = false;
  private label: string;

  constructor(opts: ButtonOpts, private onChange: (down: boolean) => void) {
    this.root = el('div', `pbtn ${opts.cls ?? ''}`);
    if (opts.hasLed !== false) {
      this.led = el('span', 'led');
      this.root.append(this.led);
    }
    this.btn = el('button', 'cap');
    this.btn.type = 'button';
    this.btn.setAttribute('aria-label', opts.sub ? `${opts.label} (${opts.sub})` : opts.label);
    this.label = opts.label;
    if (opts.key) this.setHint(opts.key);
    this.root.append(this.btn);
    const lab = el('div', 'plabel', opts.label);
    if (opts.sub) lab.append(el('span', 'psub', opts.sub));
    this.root.append(lab);

    if (opts.latch) {
      this.btn.addEventListener('click', () => this.set(!this.down));
    } else {
      this.btn.addEventListener('pointerdown', (e) => {
        this.btn.setPointerCapture(e.pointerId);
        this.set(true);
      });
      const up = () => this.set(false);
      this.btn.addEventListener('pointerup', up);
      this.btn.addEventListener('pointercancel', up);
      this.btn.addEventListener('lostpointercapture', up);
      // keyboard activation of the focused button
      this.btn.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); this.set(true); }
      });
      this.btn.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.set(false); }
      });
    }
  }

  set(down: boolean) {
    if (down === this.down) return;
    this.down = down;
    this.btn.classList.toggle('down', down);
    this.onChange(down);
  }

  setLed(on: boolean) {
    this.led?.classList.toggle('on', on);
  }

  /** Keyboard hint shown on hover. */
  setHint(key: string) {
    this.btn.title = `${this.label} — ${key}`;
  }
}

/**
 * Endless pot. Dragging up or the wheel turns it clockwise; the device
 * counts one parameter step per 2 degrees.
 */
export class Pot {
  readonly root: HTMLDivElement;
  private angle = 0;
  private dial: HTMLDivElement;
  private acc = 0;

  constructor(label: string, private onTurn: (degrees: number) => void) {
    this.root = el('div', 'pot');
    const knob = el('div', 'knob');
    knob.tabIndex = 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', label);
    this.dial = el('div', 'dial');
    knob.append(this.dial);
    this.root.append(knob, el('div', 'plabel', label));

    let lastY = 0;
    knob.addEventListener('pointerdown', (e) => {
      knob.setPointerCapture(e.pointerId);
      lastY = e.clientY;
      knob.classList.add('active');
    });
    knob.addEventListener('pointermove', (e) => {
      if (!knob.hasPointerCapture(e.pointerId)) return;
      const dy = lastY - e.clientY;
      lastY = e.clientY;
      this.turn(dy * (e.shiftKey ? 0.5 : 2));
    });
    const end = () => knob.classList.remove('active');
    knob.addEventListener('pointerup', end);
    knob.addEventListener('lostpointercapture', end);
    knob.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.turn(e.deltaY < 0 ? 2 : -2);
    }, { passive: false });
    knob.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 20, PageDown: -20 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); this.turn(d); }
    });
  }

  turn(degrees: number) {
    this.acc += degrees;
    const whole = Math.trunc(this.acc / 2) * 2;
    if (!whole) return;
    this.acc -= whole;
    this.angle += whole;
    this.dial.style.transform = `rotate(${this.angle}deg)`;
    this.onTurn(whole);
  }
}

/** The data encoder: turn by dragging or with the wheel, push the cap. */
export class Encoder {
  readonly root: HTMLDivElement;
  private angle = 0;
  private dial: HTMLDivElement;
  private acc = 0;
  private cap: HTMLButtonElement;

  constructor(private onTurn: (detents: number) => void, private onPush: (down: boolean) => void) {
    this.root = el('div', 'encoder');
    const ring = el('div', 'ring');
    ring.tabIndex = 0;
    ring.setAttribute('role', 'slider');
    ring.setAttribute('aria-label', 'Data encoder');
    this.dial = el('div', 'dial');
    const cap = el('button', 'push');
    cap.type = 'button';
    cap.setAttribute('aria-label', 'Encoder push');
    this.cap = cap;
    ring.append(this.dial, cap);
    this.root.append(ring, el('div', 'plabel', 'DATA'));

    let lastY = 0;
    ring.addEventListener('pointerdown', (e) => {
      if (e.target === cap) return;
      ring.setPointerCapture(e.pointerId);
      lastY = e.clientY;
    });
    ring.addEventListener('pointermove', (e) => {
      if (!ring.hasPointerCapture(e.pointerId)) return;
      this.acc += lastY - e.clientY;
      lastY = e.clientY;
      const n = Math.trunc(this.acc / 14);
      if (n) { this.acc -= n * 14; this.turn(n); }
    });
    let wheelAcc = 0;
    ring.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc -= e.deltaY;
      const n = Math.trunc(wheelAcc / 40);
      if (n) { wheelAcc -= n * 40; this.turn(Math.sign(n)); }
    }, { passive: false });
    ring.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); this.turn(d); }
    });
    cap.addEventListener('pointerdown', (e) => { cap.setPointerCapture(e.pointerId); cap.classList.add('down'); this.onPush(true); });
    const up = () => { if (cap.classList.contains('down')) { cap.classList.remove('down'); this.onPush(false); } };
    cap.addEventListener('pointerup', up);
    cap.addEventListener('lostpointercapture', up);
  }

  /** Hover text of the push button. */
  setPushHint(text: string) {
    this.cap.title = text;
  }

  turn(detents: number) {
    this.angle += detents * 15;
    this.dial.style.transform = `rotate(${this.angle}deg)`;
    this.onTurn(detents);
  }
}

/** Volume fader, 0..1. */
export class Fader {
  readonly root: HTMLDivElement;

  constructor(label: string, onChange: (v: number) => void) {
    this.root = el('div', 'fader');
    const input = el('input', 'fslider');
    input.type = 'range';
    input.min = '0';
    input.max = '1000';
    input.value = '1000';
    input.setAttribute('aria-label', `${label} volume`);
    input.addEventListener('input', () => onChange(Number(input.value) / 1000));
    this.root.append(input, el('div', 'plabel', label));
  }
}
