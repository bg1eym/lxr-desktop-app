/*
 * LXR-02 Emu (unofficial) - the emulated device as seen from the page.
 *
 * The firmware runs in an AudioWorklet (public/lxr-processor.js). This class
 * starts it and forwards front panel actions; display and LED state come
 * back as messages.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

export interface PanelState {
  lcd: Uint8Array;   // 32 character codes, row 1 then row 2
  cg: Uint8Array;    // CGRAM, 8 characters x 8 rows
  st: number;        // bit 0 display on, bit 1 cursor, bit 2 blink, bits 8.. cursor cell
  lo: number;        // LEDs 0..31
  hi: number;        // LEDs 32..40
  run: number;       // sequencer running
  playheads: number[]; // current step of each track
}

type Msg =
  | { t: 'btn'; n: number; d: boolean }
  | { t: 'enc'; n: number }
  | { t: 'encBtn'; d: boolean }
  | { t: 'pot'; i: number; deg: number }
  | { t: 'fader'; i: number; v: number }
  | { t: 'jacks'; m: number }
  | { t: 'param'; i: number; v: number; id?: number }
  | { t: 'selectVoice'; voice: number }
  | { t: 'describe' }
  | { t: 'midi'; data: number[] }
  | { t: 'seqView'; pattern: number }
  | ({ t: 'seq'; id: number } & SeqEdit)
  | { t: 'trigger'; voice: number; velocity: number }
  | { t: 'ack'; k: string }
  | { t: 'idle'; on: boolean };

/** Changes to the pattern data, done in this order. */
export interface SeqEdit {
  /** [pattern, track, step, on, velocity, probability, note, retrig, nudge] */
  steps?: number[][];
  /** [pattern, track, step, lock 1 parameter, value, lock 2 parameter, value] */
  locks?: number[][];
  /** [pattern, track, length] */
  lengths?: number[][];
  /** [track, muted] */
  mutes?: [number, boolean][];
  /** [pattern, 0-127] */
  swing?: [number, number];
  /** keep edits of the playing pattern when the pattern changes */
  keep?: boolean;
  /** save the playing pattern, as SAVE does */
  save?: boolean;
  /** play another pattern: at the end of the current one, or now when stopped */
  pattern?: number;
}

import { SdStore, type Chunk } from './sdStore';
import type { CardFile } from './cardFiles';
import { parseSnapshot, type SeqData } from './seq/model';

const BASE = import.meta.env.BASE_URL;
/* Size of the virtual card. A card formatted earlier keeps its own file
 * system size; the card is sparse, so only written chunks take memory. */
const SD_MEGABYTES = 256;

export class LxrEmu {
  onState: (s: PanelState) => void = () => {};
  onLoad: (load: number) => void = () => {};
  onLog: (line: string) => void = (s) => console.log('[lxr]', s);
  /** The firmware stopped with an error after booting; reboot() starts it again. */
  onCrash: (msg: string) => void = () => {};
  /** Pattern data of the shown pattern, whenever it changes. ack: the id of
   * the last seqEdit() it includes. */
  onSeq: (data: SeqData, ack: number) => void = () => {};
  /** All parameter values, whenever one changes. ack: the id of the last
   * setParam() they include. */
  onParams: (values: Uint8Array, ack: number) => void = () => {};
  /** The card was written (bytes stored, whether it survives a reload). */
  onCard: (bytes: number, persistent: boolean) => void = () => {};

  readonly card = new SdStore();
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private wasm: ArrayBuffer | null = null;
  private faders = [1, 1, 1, 1, 1, 1];
  private syncId = 0;
  private seqId = 0;
  private paramId = 0;
  private describeWaiters: ((json: string) => void)[] = [];
  private keepEdits = false;
  private syncWaiters = new Map<number, () => void>();
  private exportWaiters = new Map<number, (m: { files?: [string, boolean, ArrayBuffer | null][]; error?: string }) => void>();
  private cardLoaded = false;
  private messages = 0;            // from the worklet, for the page's watchdog

  /** Start audio and boot the device. Call from a user gesture. */
  async start(): Promise<{ bootMs: number }> {
    if (!this.ctx) {
      // The device renders 44140.625 Hz worth of samples per second of its
      // own time; 44100 is the closest rate a sound card offers.
      this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(`${BASE}lxr-processor.js?v=${__APP_BUILD__}`);
    }
    if (!this.wasm) {
      const res = await fetch(`${BASE}lxr_emu.wasm?v=${__APP_BUILD__}`);
      if (!res.ok) throw new Error(`lxr_emu.wasm: HTTP ${res.status}`);
      this.wasm = await res.arrayBuffer();
    }
    if (!this.cardLoaded) {
      await this.card.load();
      this.cardLoaded = true;
    }
    await this.ctx.resume();
    return this.boot();
  }

  /** Power cycle with the card in: what was saved on it is kept. */
  async reboot(): Promise<{ bootMs: number }> {
    await this.syncCard();
    return this.boot();
  }

  /** Power off, wipe the card, power on: the firmware formats it. */
  async eraseCardAndReboot(): Promise<{ bootMs: number }> {
    this.stop();
    await this.card.erase();
    this.onCard(this.card.size, this.card.persistent);
    return this.boot();
  }

  /** Every file and directory on the virtual card, as the firmware's FatFs sees it. */
  async exportCard(): Promise<CardFile[]> {
    if (!this.node) throw new Error('not running');
    await this.syncCard();
    const id = ++this.syncId;
    const m = await new Promise<{ files?: [string, boolean, ArrayBuffer | null][]; error?: string }>((resolve) => {
      this.exportWaiters.set(id, resolve);
      this.node!.port.postMessage({ t: 'exportCard', id });
    });
    if (m.error || !m.files) throw new Error(m.error ?? 'export failed');
    return m.files.map(([path, dir, data]) => ({ path, dir, data: data ? new Uint8Array(data) : null }));
  }

  /**
   * Power off, replace the card with these files (formatted like the
   * firmware does, then written through its FatFs), power on.
   * Returns the files that could not be written.
   */
  async importCardAndReboot(files: CardFile[]): Promise<{ bootMs: number; skipped: [string, string][] }> {
    this.stop();
    await this.card.erase();
    const importFiles = files.map((f) => [f.path, f.dir, f.data ? f.data.slice().buffer : null]);
    const r = await this.boot(importFiles);
    this.onCard(this.card.size, this.card.persistent);
    return r;
  }

  /** Fetch everything written to the card so far and store it. */
  syncCard(): Promise<void> {
    if (!this.node) return Promise.resolve();
    const id = ++this.syncId;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.syncWaiters.delete(id); resolve(); }, 1000);
      this.syncWaiters.set(id, () => { clearTimeout(timer); resolve(); });
      this.node!.port.postMessage({ t: 'syncSd', id });
    });
  }

  private idle = false;

  /** Pause the emulated device: the worklet plays silence and stops running
   * the firmware, while the browser's audio keeps going (suspending and
   * resuming the AudioContext left the worklet dead once). resume() goes on
   * where it was; the device's time follows the rendered samples. */
  async pause(): Promise<void> {
    if (!this.node || this.idle) return;
    await this.syncCard();
    this.idle = true;
    this.send({ t: 'idle', on: true });
  }

  get paused(): boolean {
    return this.idle;
  }

  /** Go on after pause(), and start the browser's audio again when it was
   * stopped by the browser (for example while the computer slept). */
  async resume(): Promise<void> {
    if (!this.ctx || !this.node || this.ctx.state === 'closed') return;
    if (this.idle) {
      this.idle = false;
      this.send({ t: 'idle', on: false });
    }
    if (this.ctx.state === 'running') return;
    try { await this.ctx.resume(); } catch { /* needs a click on the page; tried again then */ }
  }

  get audioState(): string {
    return this.ctx?.state ?? 'none';
  }

  /** Messages heard from the worklet so far; it reports at least every 3
   * seconds while booted, paused or not. */
  get heard(): number {
    return this.messages;
  }

  get booted(): boolean {
    return !!this.node;
  }

  /** A new audio context and a reboot from the saved card, for when the
   * browser's audio got stuck (for example after the computer slept). */
  async restartAudio(): Promise<{ bootMs: number }> {
    this.stop();
    const old = this.ctx;
    this.ctx = null;
    if (old) await Promise.race([old.close().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    return this.start();
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private stop() {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
  }

  private boot(importFiles?: unknown[]): Promise<{ bootMs: number; skipped: [string, string][] }> {
    if (!this.ctx || !this.wasm) return Promise.reject(new Error('not started'));
    this.stop();
    const sdChunks = importFiles ? [] : this.card.snapshot();
    const node = new AudioWorkletNode(this.ctx, 'lxr-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        wasm: this.wasm,
        seed: (Math.random() * 0xffffffff) >>> 0,
        sdMegabytes: SD_MEGABYTES,
        sdChunks,
        importFiles,
        seqAck: this.seqId,
        paramAck: this.paramId,
      },
    });
    node.connect(this.ctx.destination);
    node.onprocessorerror = () => this.onCrash('AudioWorklet processor error');
    this.node = node;
    this.idle = false;
    return new Promise((resolve, reject) => {
      node.port.onmessage = (e: MessageEvent) => {
        const m = e.data;
        this.messages++;
        // flow control: the worklet sends the next one of these when it hears back
        if (m.t === 'state' || m.t === 'seq' || m.t === 'params' || m.t === 'sd' || m.t === 'load') {
          node.port.postMessage({ t: 'ack', k: m.t });
        }
        switch (m.t) {
          case 'ready':
            this.faders.forEach((v, i) => this.send({ t: 'fader', i, v }));
            if (this.keepEdits) this.seqEdit({ keep: true });
            resolve({ bootMs: m.bootMs, skipped: m.skipped ?? [] });
            break;
          case 'error': reject(new Error(m.msg)); break;
          case 'crash': console.error('[lxr] firmware stopped:', m.msg); this.onCrash(m.msg); break;
          case 'state': this.onState(m as PanelState); break;
          case 'seq': this.onSeq(parseSnapshot(m.data), m.ack); break;
          case 'params': this.onParams(m.v, m.ack); break;
          case 'describe': for (const w of this.describeWaiters.splice(0)) w(m.json); break;
          case 'load': this.onLoad(m.load); break;
          case 'log': this.onLog(m.s); break;
          case 'cardFiles': this.exportWaiters.get(m.id)?.(m); this.exportWaiters.delete(m.id); break;
          case 'sd': {
            const chunks = m.chunks as Chunk[];
            const saved = this.card.save(chunks);
            if (chunks.length) this.onCard(this.card.size, this.card.persistent);
            if (m.id !== undefined) saved.then(() => this.syncWaiters.get(m.id)?.());
            break;
          }
        }
      };
    });
  }

  private send(m: Msg) {
    this.node?.port.postMessage(m);
  }

  button(n: number, down: boolean) { this.send({ t: 'btn', n, d: down }); }
  encoder(detents: number) { if (detents) this.send({ t: 'enc', n: detents }); }
  encoderButton(down: boolean) { this.send({ t: 'encBtn', d: down }); }
  pot(i: number, degrees: number) { if (degrees) this.send({ t: 'pot', i, deg: degrees }); }
  fader(i: number, v: number) { this.faders[i] = v; this.send({ t: 'fader', i, v }); }
  midi(data: number[]) { this.send({ t: 'midi', data }); }

  /* sequencer */
  /** Show this pattern's data in onSeq; 255 = always the playing pattern. */
  seqView(pattern: number) { this.send({ t: 'seqView', pattern }); }
  /** Change pattern data. Returns the edit's id. */
  seqEdit(edit: SeqEdit): number {
    if (edit.keep !== undefined) this.keepEdits = edit.keep;
    const id = ++this.seqId;
    this.send({ t: 'seq', id, ...edit });
    return id;
  }
  /** Preview a voice. */
  trigger(voice: number, velocity = 110) { this.send({ t: 'trigger', voice, velocity }); }
  /** Set a parameter as the menu does. Returns the change's id. */
  setParam(i: number, v: number): number {
    const id = ++this.paramId;
    this.send({ t: 'param', i, v, id });
    return id;
  }
  /** Make a voice the panel's active one, where its voice button would just select it. */
  selectVoice(voice: number) { this.send({ t: 'selectVoice', voice }); }
  /** The firmware's sound menus (emu/param_api.c), as JSON. */
  describe(): Promise<string> {
    if (!this.node) return Promise.reject(new Error('not running'));
    return new Promise((resolve) => {
      this.describeWaiters.push(resolve);
      this.send({ t: 'describe' });
    });
  }
}
