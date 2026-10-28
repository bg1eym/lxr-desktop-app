/*
 * LXR-02 Emu (unofficial) - the virtual SD card, kept in IndexedDB.
 *
 * The card image is stored as the chunks the emulator hands out (64 KB
 * each); chunks never written are not stored and read as zeros.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

const DB_NAME = 'lxr02-emu';
const STORE = 'sd-card';

export type Chunk = [index: number, data: ArrayBuffer];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class SdStore {
  /** In-memory copy of what is stored, handed to the next boot. */
  private chunks = new Map<number, ArrayBuffer>();
  private db: IDBDatabase | null = null;
  private writes: Promise<void> = Promise.resolve();

  /** Load the saved card. Works without IndexedDB too (nothing is kept). */
  async load(): Promise<void> {
    try {
      this.db = await open();
      const tx = this.db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const r = store.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const values = await new Promise<ArrayBuffer[]>((res, rej) => {
        const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      this.chunks = new Map(keys.map((k, i) => [k as number, values[i]]));
    } catch (err) {
      console.warn('SD card storage unavailable, the card will not be kept', err);
      this.db = null;
    }
  }

  get persistent(): boolean {
    return this.db !== null;
  }

  /** Bytes stored. */
  get size(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.byteLength;
    return n;
  }

  /** Copies for a boot (the worklet takes ownership of what it gets). */
  snapshot(): Chunk[] {
    return [...this.chunks].map(([i, d]) => [i, d.slice(0)]);
  }

  save(chunks: Chunk[]): Promise<void> {
    if (!chunks.length) return this.writes;
    for (const [i, d] of chunks) this.chunks.set(i, d);
    const db = this.db;
    if (!db) return this.writes;
    this.writes = this.writes.then(() => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [i, d] of chunks) store.put(d, i);
      return done(tx);
    }).catch((err) => console.error('saving SD card failed', err));
    return this.writes;
  }

  /** Remove the card contents; the next boot formats a blank card. */
  async erase(): Promise<void> {
    this.chunks.clear();
    await this.writes;
    if (!this.db) return;
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  }
}
