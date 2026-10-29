/*
 * LXR-02 Emu (unofficial) - SD card files to and from the computer: a folder
 * (File System Access API, e.g. the real card mounted on the Mac) or a zip.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

/** A file or directory on the card. Paths are absolute: "/PROJ00/00-.PAT". */
export interface CardFile {
  path: string;
  dir: boolean;
  data: Uint8Array | null;
}

/** Things computers put on a card that the device doesn't need. */
function ignored(name: string): boolean {
  return name.startsWith('.') || name === 'System Volume Information' || name === '__MACOSX' || name === 'Thumbs.db';
}

/* ---- folders ------------------------------------------------------------------ */

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

declare global {
  interface Window {
    showDirectoryPicker(opts?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }
}

export function pickFolder(mode: 'read' | 'readwrite'): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ id: 'lxr-sd-card', mode });
}

export async function readFolder(root: FileSystemDirectoryHandle): Promise<CardFile[]> {
  const out: CardFile[] = [];
  async function walk(dir: DirHandle, prefix: string) {
    for await (const [name, handle] of dir.entries()) {
      if (ignored(name)) continue;
      const path = `${prefix}/${name}`;
      if (handle.kind === 'directory') {
        out.push({ path, dir: true, data: null });
        await walk(handle as DirHandle, path);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ path, dir: false, data: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  }
  await walk(root as DirHandle, '');
  return out;
}

/** Files from <input type=file webkitdirectory> (browsers without the picker). */
export async function readFileList(list: FileList): Promise<CardFile[]> {
  const out: CardFile[] = [];
  const dirs = new Set<string>();
  for (const file of Array.from(list)) {
    // webkitRelativePath = "<picked folder>/PROJ00/00-.PAT"
    const parts = (file.webkitRelativePath || file.name).split('/').slice(1);
    if (!parts.length || parts.some(ignored)) continue;
    for (let i = 1; i < parts.length; i++) dirs.add('/' + parts.slice(0, i).join('/'));
    out.push({ path: '/' + parts.join('/'), dir: false, data: new Uint8Array(await file.arrayBuffer()) });
  }
  return [...[...dirs].sort().map((path) => ({ path, dir: true, data: null })), ...out];
}

/** Write the card's files into a folder, replacing files of the same name. */
export async function writeFolder(root: FileSystemDirectoryHandle, files: CardFile[], onProgress?: (done: number) => void) {
  const dirs = new Map<string, FileSystemDirectoryHandle>([['', root]]);
  async function dirFor(path: string): Promise<FileSystemDirectoryHandle> {
    const known = dirs.get(path);
    if (known) return known;
    const cut = path.lastIndexOf('/');
    const parent = await dirFor(path.slice(0, cut));
    const handle = await parent.getDirectoryHandle(path.slice(cut + 1), { create: true });
    dirs.set(path, handle);
    return handle;
  }
  let done = 0;
  for (const f of files) {
    if (f.dir) {
      await dirFor(f.path);
    } else {
      const cut = f.path.lastIndexOf('/');
      const dir = await dirFor(f.path.slice(0, cut));
      const handle = await dir.getFileHandle(f.path.slice(cut + 1), { create: true });
      const w = await handle.createWritable();
      await w.write(f.data as BufferSource);
      await w.close();
    }
    onProgress?.(++done);
  }
}

/* ---- zip (stored on write; stored or deflated on read) ------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: CardFile[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path.slice(1) + (f.dir ? '/' : ''));
    const data = f.dir || !f.data ? new Uint8Array(0) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 10, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 10, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(38, f.dir ? 0x10 : 0, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Files of a zip. When everything sits in one top-level folder (a zipped
 * card folder), that folder is taken as the card's root.
 */
export async function readZip(blob: Blob): Promise<CardFile[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const raw: CardFile[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const parts = name.split('/').filter(Boolean);
    if (!parts.length || parts.some(ignored)) continue;
    const path = '/' + parts.join('/');
    if (name.endsWith('/')) { raw.push({ path, dir: true, data: null }); continue; }
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = comp.slice();
    else if (method === 8) data = await inflateRaw(comp);
    else throw new Error(`${name}: unsupported zip compression (${method})`);
    raw.push({ path, dir: false, data });
  }
  // directories implied by file paths
  const dirs = new Set(raw.filter((f) => f.dir).map((f) => f.path));
  for (const f of raw) {
    const parts = f.path.split('/').slice(1, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add('/' + parts.slice(0, i).join('/'));
  }
  let files = [...[...dirs].sort().map((path) => ({ path, dir: true, data: null })), ...raw.filter((f) => !f.dir)];
  // a single top-level folder that is not a card folder itself = the card root
  const tops = new Set(files.map((f) => f.path.split('/')[1]));
  if (tops.size === 1) {
    const top = [...tops][0];
    if (!looksLikeCardRoot(files) && files.some((f) => f.path.startsWith(`/${top}/`))) {
      files = files.filter((f) => f.path !== `/${top}`).map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));
    }
  }
  return files;
}

/** The card root holds GLO.CFG or PROJnn folders. */
export function looksLikeCardRoot(files: CardFile[]): boolean {
  return files.some((f) => /^\/(glo\.cfg|proj\d\d)$/i.test(f.path));
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
