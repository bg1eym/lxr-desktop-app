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
}

type Msg =
  | { t: 'btn'; n: number; d: boolean }
  | { t: 'enc'; n: number }
  | { t: 'encBtn'; d: boolean }
  | { t: 'pot'; i: number; deg: number }
  | { t: 'fader'; i: number; v: number }
  | { t: 'jacks'; m: number }
  | { t: 'param'; i: number; v: number }
  | { t: 'midi'; data: number[] };

import { SdStore, type Chunk } from './sdStore';
import type { CardFile } from './cardFiles';

const BASE = import.meta.env.BASE_URL;
/* Size of the virtual card. A card formatted earlier keeps its own file
 * system size; the card is sparse, so only written chunks take memory. */
const SD_MEGABYTES = 256;

export class LxrEmu {
  onState: (s: PanelState) => void = () => {};
  onLoad: (load: number) => void = () => {};
  onLog: (line: string) => void = (s) => console.log('[lxr]', s);
  /** The card was written (bytes stored, whether it survives a reload). */
  onCard: (bytes: number, persistent: boolean) => void = () => {};

  readonly card = new SdStore();
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private wasm: ArrayBuffer | null = null;
  private faders = [1, 1, 1, 1, 1, 1];
  private syncId = 0;
  private syncWaiters = new Map<number, () => void>();
  private exportWaiters = new Map<number, (m: { files?: [string, boolean, ArrayBuffer | null][]; error?: string }) => void>();
  private cardLoaded = false;

  /** Start audio and boot the device. Call from a user gesture. */
  async start(): Promise<{ bootMs: number }> {
    if (!this.ctx) {
      // The device renders 44140.625 Hz worth of samples per second of its
      // own time; 44100 is the closest rate a sound card offers.
      this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(`${BASE}lxr-processor.js`);
    }
    if (!this.wasm) {
      const res = await fetch(`${BASE}lxr_emu.wasm`);
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
      },
    });
    node.connect(this.ctx.destination);
    this.node = node;
    return new Promise((resolve, reject) => {
      node.port.onmessage = (e: MessageEvent) => {
        const m = e.data;
        switch (m.t) {
          case 'ready':
            this.faders.forEach((v, i) => this.send({ t: 'fader', i, v }));
            resolve({ bootMs: m.bootMs, skipped: m.skipped ?? [] });
            break;
          case 'error': reject(new Error(m.msg)); break;
          case 'state': this.onState(m as PanelState); break;
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
}
