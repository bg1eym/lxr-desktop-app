/*
 * LXR-02 Emu (unofficial) - sound panel for one voice.
 *
 * The voice's 8 menu pages (OSC, AEG, MOD, FM, TRANS, FILTER, LFO, MIX), as
 * the panel's select buttons 1-8 choose them, with every parameter of the
 * page. It is built from the firmware's own menu tables (emu/param_api.c):
 * the same parameters, ranges and value names as on the device. A display
 * shows the page the way the firmware's menu draws it (menu_repaintGeneric():
 * short names over values, and the full name of the parameter being changed,
 * as in edit mode). Values are set the way the menu sets them, and the panel
 * follows changes made with the device's knobs or by loading a kit.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import type { LxrEmu } from '../emu';
import { currentLang, onLang, t, type Key } from '../i18n';
import { LcdView } from '../lcd';
import { TRACK_COLORS, TRACK_NAMES } from '../seq/sequencer';
import { paramLabel, targetLabel } from './labels';

/** One parameter of a menu page, see put_param() in emu/param_api.c. */
interface ParamDesc {
  p: number;       // parameter number (activeParameters index)
  s: string;       // short name on the display
  c: string;       // category
  l: string;       // long name
  t: number;       // enum Datatypes
  lo: number;
  hi: number;
  o?: number;      // shown as value - o
  m?: number;      // menu id
  vv?: number;     // velocity target of this voice (0-5)
  lfo?: number;    // target of this LFO (0-5)
}
interface Target { p: number; v: number; s: string; c: string; l: string }
interface Describe {
  voices: (ParamDesc | null)[][][];
  menus: Record<string, string[]>;
  targets: Target[];
  voiceTargets: [number, number][];
  lfoVoice: number;
  sound: number;
}

/* enum Datatypes, Core/Inc/menu/menu.h */
const T_MENU = 3, T_PM63 = 4, T_ON_OFF = 6, T_TARGET_LFO = 7, T_TARGET_VELO = 8, T_VOICE_LFO = 9,
  T_AUTOM_TARGET = 10, T_0B1 = 11, T_NOTE = 12;

/* the sub pages, in the order of the panel's select buttons 1-8 */
const PAGES: [string, Key][] = [
  ['OSC', 'sndOsc'], ['AEG', 'sndAeg'], ['MOD', 'sndMod'], ['FM', 'sndFm'],
  ['TRANS', 'sndTrans'], ['FILTER', 'sndFilter'], ['LFO', 'sndLfo'], ['MIX', 'sndMix'],
];
/* LFO target voices 1-6: the open hihat shares voice 6 */
const LFO_VOICES = ['DRUM 1', 'DRUM 2', 'DRUM 3', 'SNARE', 'CYMBAL', 'HIHAT'];
const SEGMENT_MAX = 8;   // menus with more entries become a list
const EDIT_VIEW_MS = 1500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

function btn(cls: string, label: string | Node): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

/* ---- the firmware's 3 character value texts (menu.c) ------------------------ */
function numtostrpu(n: number): string {      // space padded unsigned
  return String(n).padStart(3, ' ').slice(-3);
}
function numtostrps(n: number): string {      // space padded signed: "-29", "- 5", " 12"
  if (n < 0) return n <= -10 ? `-${-n}` : `- ${-n}`;
  return String(n).padStart(3, ' ');
}
function noteText(n: number): string {        // setNoteName(): "C#5", "D 3"
  const names = ['C ', 'C#', 'D ', 'D#', 'E ', 'F ', 'F#', 'G ', 'G#', 'A ', 'A#', 'B '];
  return names[n % 12] + String.fromCharCode(48 + Math.floor(n / 12));
}
const three = (s: string) => (s + '   ').slice(0, 3);

interface Control {
  desc: ParamDesc;
  update(v: number): void;
}

export class SoundEditor {
  readonly root = el('section', 'snd off');
  private desc: Describe | null = null;
  private values: Uint8Array | null = null;
  private ack = 0;
  private voice = 0;
  private page = 0;
  private active = 0;                // slot of the page the display points at
  private editUntil = 0;             // show the full name until then
  private editTimer = 0;
  private live = false;
  private controls: Control[] = [];
  private title = el('h3', 'snd-title');
  private preview = btn('seq-tool snd-preview', '');
  private hide = btn('seq-tool snd-hide', '×');
  /** The panel's hide button was clicked. */
  onHide: () => void = () => {};
  private lcd = new LcdView();
  private tabs: HTMLButtonElement[] = [];
  private body = el('div', 'snd-body');
  private hintText = el('p', 'snd-hint');

  constructor(private emu: LxrEmu) {
    onLang(() => this.root.setAttribute('aria-label', t('ariaSound')));
    this.preview.addEventListener('click', () => this.emu.trigger(this.voice, 110));
    this.hide.addEventListener('click', () => this.onHide());
    onLang(() => {
      this.hide.title = t('sndHide');
      this.hide.setAttribute('aria-label', t('sndHide'));
    });
    const tabs = el('div', 'snd-tabs');
    PAGES.forEach(([name], i) => {
      const b = btn('snd-tab', el('span', 'snd-tab-n', String(i + 1)));
      b.append(name);
      b.addEventListener('click', () => {
        this.page = i;
        this.active = this.firstSlot(i);
        this.editUntil = 0;
        this.build();
      });
      this.tabs.push(b);
      tabs.append(b);
    });
    this.root.append(
      el('div', 'snd-head', el('span', 'seq-swatch'), this.title, this.preview, this.hide),
      el('div', 'snd-lcd lcd-bezel', this.lcd.canvas),
      tabs, this.body, this.hintText);
    onLang(() => this.build());
  }

  /** After every boot: the menus depend on the samples on the card. */
  async load() {
    this.desc = JSON.parse(await this.emu.describe()) as Describe;
    this.onValues();
    if (!this.pageParams(this.page).length) this.page = this.firstPage();
    this.active = this.firstSlot(this.page);
    this.build();
  }

  setLive(on: boolean) {
    this.live = on;
    this.root.classList.toggle('off', !on);
    if (!on) this.desc = null;
    this.build();
  }

  setVoice(voice: number) {
    if (voice === this.voice) return;
    this.voice = voice;
    if (!this.pageParams(this.page).length) this.page = this.firstPage();
    if (!this.slot(this.page, this.active)) this.active = this.firstSlot(this.page);
    this.editUntil = 0;
    this.build();
  }

  /** Whether step velocity is heard on a voice: "Velocity → volume" on, or
   * a velocity target with an amount. Its switch, to turn it on. */
  velocity(voice: number): { heard: boolean; volumeParam: number } | null {
    const d = this.desc, v = this.values;
    if (!d || !v) return null;
    const all = d.voices[voice].flat().filter((x): x is ParamDesc => !!x && x.c === 'Velocity');
    const vol = all.find((x) => x.t === T_ON_OFF);
    const target = all.find((x) => x.t === T_TARGET_VELO);
    const amount = all.find((x) => x.l === 'Amount');
    if (!vol) return null;
    const heard = v[vol.p] === 1 || (!!target && !!amount && v[target.p] !== 0 && v[amount.p] !== 0);
    return { heard, volumeParam: vol.p };
  }

  /** Called after every change of the parameters. */
  onValues: () => void = () => {};

  setParams(values: Uint8Array, ack: number) {
    if (ack < this.ack) return;   // older than a change in flight
    this.values = values;
    for (const c of this.controls) c.update(values[c.desc.p]);
    this.drawLcd();
    this.onValues();
  }

  /* ---- pages --------------------------------------------------------------- */

  private slot(page: number, k: number): ParamDesc | null {
    return this.desc?.voices[this.voice][page][k] ?? null;
  }

  /** The parameters the panel edits: the sound parameters of the page. */
  private pageParams(page: number): [number, ParamDesc][] {
    const d = this.desc;
    if (!d) return [];
    const out: [number, ParamDesc][] = [];
    d.voices[this.voice][page].forEach((x, k) => { if (x && x.p < d.sound) out.push([k, x]); });
    return out;
  }

  private firstPage(): number {
    for (let i = 0; i < PAGES.length; i++) if (this.pageParams(i).length) return i;
    return 0;
  }

  private firstSlot(page: number): number {
    return this.pageParams(page)[0]?.[0] ?? 0;
  }

  /* ---- display ------------------------------------------------------------- */

  /** The 3 character value text, as menu_repaintGeneric() writes it. */
  private valueText(x: ParamDesc, v: number): string {
    const d = this.desc!;
    switch (x.t) {
      case T_PM63: return numtostrps(v - (x.o ?? 63));
      case T_MENU: return three(d.menus[String(x.m)]?.[v] ?? '---');
      case T_ON_OFF: return v === 1 ? 'on ' : 'off';
      case T_NOTE: return x.p >= 294 && x.p <= 300 && v === 0 ? 'any' : noteText(v);   // PAR_MIDI_NOTE1-7
      case T_0B1: return numtostrpu(v + 1);
      case T_TARGET_LFO:
      case T_TARGET_VELO: {
        const tg = d.targets[v];
        return !v || !tg ? 'off' : three(tg.s);
      }
      case T_AUTOM_TARGET: {
        const tg = d.targets[v];
        return !v || !tg ? 'off' : String(tg.v) + tg.s.slice(0, 2);
      }
      default: return numtostrpu(v);
    }
  }

  private drawLcd() {
    const d = this.desc;
    const vals = this.values;
    const rows = [' '.repeat(16).split(''), ' '.repeat(16).split('')];
    const put = (r: number, c: number, s: string) => { for (let i = 0; i < s.length && c + i < 16; i++) rows[r][c + i] = s[i]; };
    if (d && vals && this.live) {
      const x = this.slot(this.page, this.active);
      if (x && performance.now() < this.editUntil) {
        // edit mode: category and name on top, the value below
        put(0, 0, x.c.slice(0, 8));
        put(0, 8, x.l.slice(0, 8));
        if (x.t === T_TARGET_LFO || x.t === T_TARGET_VELO) {
          const tg = d.targets[vals[x.p]];
          if (!vals[x.p] || !tg) put(1, 0, 'off');
          else { put(1, 0, tg.c.slice(0, 8)); put(1, 8, tg.l.slice(0, 8)); }
        } else {
          put(1, 13, this.valueText(x, vals[x.p]));
        }
      } else {
        // the 4 parameters of the screen the active one is on
        const second = this.active > 3 ? 4 : 0;
        for (let i = 0; i < 4; i++) {
          const y = this.slot(this.page, second + i);
          if (!y) continue;
          const name = three(y.s);
          put(0, i * 4, second + i === this.active ? name.toUpperCase() : name);
          put(1, i * 4, this.valueText(y, vals[y.p]));
        }
        if (this.slot(this.page, 4)) put(0, 15, second ? '<' : '>');
      }
    }
    const codes = new Uint8Array(32);
    rows.forEach((r, ri) => r.forEach((ch, ci) => { codes[ri * 16 + ci] = ch.charCodeAt(0) & 0xff; }));
    this.lcd.update(codes, new Uint8Array(64), d && this.live ? 1 : 0);
  }

  /** Point the display at a parameter; while changing it, show its full name. */
  private touch(k: number, changing: boolean) {
    this.active = k;
    if (changing) {
      this.editUntil = performance.now() + EDIT_VIEW_MS;
      clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => this.drawLcd(), EDIT_VIEW_MS + 20);
    }
    this.drawLcd();
    for (const r of this.body.querySelectorAll<HTMLElement>('.snd-row')) r.classList.toggle('active', Number(r.dataset.slot) === k);
  }

  /* ---- building ------------------------------------------------------------ */

  private set(x: ParamDesc, v: number) {
    if (!this.values) return;
    this.values[x.p] = v;
    this.ack = this.emu.setParam(x.p, v);
    // an LFO's target list depends on its voice, and the firmware moves the target with it
    if (x.t === T_VOICE_LFO) {
      const lfo = x.p - this.desc!.lfoVoice;
      for (const c of this.controls) if (c.desc.t === T_TARGET_LFO && c.desc.lfo === lfo) c.update(this.values[c.desc.p]);
    }
  }

  private build() {
    const tr = this.voice;
    this.title.textContent = t('sndTitle', { voice: TRACK_NAMES[tr] });
    this.root.style.setProperty('--c', TRACK_COLORS[tr]);
    this.preview.textContent = t('sndPreview');
    this.preview.disabled = !this.live;
    this.hintText.textContent = t('sndHint');
    this.tabs.forEach((b, i) => {
      b.title = t(PAGES[i][1]);
      b.classList.toggle('on', i === this.page);
      b.setAttribute('aria-pressed', String(i === this.page));
      b.disabled = !this.live || !this.desc || !this.pageParams(i).length;
    });
    this.controls = [];
    this.body.replaceChildren();
    const d = this.desc;
    if (!d || !this.live) {
      this.body.append(el('p', 'snd-hint', t('sndOffline')));
      this.drawLcd();
      return;
    }
    const params = this.pageParams(this.page);
    this.body.append(el('h4', 'snd-page-title', t(PAGES[this.page][1])));
    const labels = params.map(([, x]) => paramLabel(x.c, x.l));
    params.forEach(([k, x], i) => {
      // the same name twice on one page (the cymbal's two mod waveforms): number them
      const n = labels.filter((l) => l === labels[i]).length;
      const label = n > 1 ? `${labels[i]} ${labels.slice(0, i + 1).filter((l) => l === labels[i]).length}` : labels[i];
      const row = this.control(x, label);
      row.dataset.slot = String(k);
      row.classList.toggle('active', k === this.active);
      row.addEventListener('pointerenter', () => this.touch(k, false));
      row.addEventListener('focusin', () => this.touch(k, false));
      row.addEventListener('input', () => this.touch(k, true));
      row.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) this.touch(k, true); });
      row.addEventListener('change', () => this.touch(k, true));
      this.body.append(row);
    });
    if (this.values) for (const c of this.controls) c.update(this.values[c.desc.p]);
    this.drawLcd();
  }

  /* ---- controls ------------------------------------------------------------ */

  /** The value as the panel shows it next to a control. */
  private format(x: ParamDesc, v: number): string {
    const d = this.desc!;
    switch (x.t) {
      case T_PM63: { const n = v - (x.o ?? 63); return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'; }
      case T_0B1: return String(v + 1);
      case T_NOTE: return noteText(v).replace(' ', '');
      case T_ON_OFF: return t(v ? 'sndOn' : 'sndOff');
      case T_MENU: return d.menus[String(x.m)]?.[v] ?? String(v);
      case T_VOICE_LFO: return LFO_VOICES[v - 1] ?? String(v);
      default: return String(v);
    }
  }

  private label(x: ParamDesc, text: string): HTMLElement {
    const l = el('span', 'snd-label', text, el('span', 'snd-short', x.s));
    l.title = `${x.c} / ${x.l} (${x.s}) · #${x.p}`;
    return l;
  }

  private control(x: ParamDesc, text: string): HTMLElement {
    const items = x.t === T_MENU ? this.desc!.menus[String(x.m)] ?? [] : null;
    if (x.t === T_TARGET_LFO || x.t === T_TARGET_VELO) return this.targetControl(x, text);
    if (x.t === T_ON_OFF) return this.toggleControl(x, text);
    if (x.t === T_VOICE_LFO) return this.segControl(x, text, LFO_VOICES.map((n) => n.replace('DRUM ', 'D')), 1);
    if (items && items.length <= SEGMENT_MAX) return this.segControl(x, text, items, 0);
    if (items) return this.listControl(x, text, items);
    return this.sliderControl(x, text);
  }

  private sliderControl(x: ParamDesc, text: string): HTMLElement {
    const input = el('input', 'snd-range');
    input.type = 'range';
    input.min = String(x.lo);
    input.max = String(x.hi);
    input.setAttribute('aria-label', text);
    const out = el('span', 'snd-value');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = this.format(x, v);
      this.set(x, v);
    });
    this.controls.push({
      desc: x,
      update: (v) => {
        if (Number(input.value) !== v) input.value = String(v);
        out.textContent = this.format(x, v);
      },
    });
    return el('div', 'snd-row', el('div', 'snd-line', this.label(x, text), out), input);
  }

  private segControl(x: ParamDesc, text: string, names: string[], first: number): HTMLElement {
    const seg = el('div', 'snd-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', text);
    const buttons = names.map((name, i) => {
      const b = btn('snd-segb', name);
      b.addEventListener('click', () => {
        this.set(x, i + first);
        buttons.forEach((o, j) => o.classList.toggle('on', j === i));
      });
      seg.append(b);
      return b;
    });
    this.controls.push({
      desc: x,
      update: (v) => buttons.forEach((b, i) => {
        b.classList.toggle('on', i + first === v);
        b.setAttribute('aria-pressed', String(i + first === v));
      }),
    });
    return el('div', 'snd-row', el('div', 'snd-line', this.label(x, text)), seg);
  }

  private listControl(x: ParamDesc, text: string, names: string[]): HTMLElement {
    const sel = el('select', 'snd-select');
    sel.setAttribute('aria-label', text);
    names.forEach((name, i) => sel.append(new Option(name, String(i))));
    sel.addEventListener('change', () => this.set(x, Number(sel.value)));
    this.controls.push({ desc: x, update: (v) => { sel.value = String(v); } });
    return el('div', 'snd-row', el('div', 'snd-line', this.label(x, text)), sel);
  }

  private toggleControl(x: ParamDesc, text: string): HTMLElement {
    const b = btn('snd-toggle', '');
    const show = (v: number) => {
      b.textContent = this.format(x, v);
      b.classList.toggle('on', v === 1);
      b.setAttribute('aria-pressed', String(v === 1));
    };
    b.addEventListener('click', () => {
      const v = this.values && this.values[x.p] ? 0 : 1;
      this.set(x, v);
      show(v);
    });
    this.controls.push({ desc: x, update: show });
    return el('div', 'snd-row snd-row-inline', this.label(x, text), b);
  }

  /** A modulation target: off, or a parameter of the target voice. */
  private targetControl(x: ParamDesc, text: string): HTMLElement {
    const d = this.desc!;
    const sel = el('select', 'snd-select');
    sel.setAttribute('aria-label', text);
    sel.addEventListener('change', () => this.set(x, Number(sel.value)));
    let shownFor = '';
    const voiceOf = () => {
      if (x.vv !== undefined) return x.vv;
      const lv = this.values ? this.values[d.lfoVoice + (x.lfo ?? 0)] : 1;
      return Math.min(5, Math.max(0, lv - 1));
    };
    this.controls.push({
      desc: x,
      update: (v) => {
        const voice = voiceOf();
        const key = `${voice}:${v}:${currentLang()}`;
        if (key !== shownFor) {
          shownFor = key;
          sel.replaceChildren(new Option(t('sndTargetOff'), '0'));
          const [a, b] = d.voiceTargets[voice];
          const indices = Array.from({ length: b - a + 1 }, (_, k) => a + k);
          if (v && !indices.includes(v)) indices.unshift(v);   // keep what the kit has
          for (const i of indices) {
            const tg = d.targets[i];
            if (!tg) continue;
            const who = tg.v ? `${LFO_VOICES[tg.v - 1]} · ` : '';
            sel.append(new Option(who + targetLabel(tg.c, tg.l), String(i)));
          }
        }
        sel.value = String(v);
      },
    });
    return el('div', 'snd-row', el('div', 'snd-line', this.label(x, text)), sel);
  }
}
