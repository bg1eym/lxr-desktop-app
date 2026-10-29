/*
 * LXR-02 Emu (unofficial) - the SD card dialog: export the virtual card to a
 * folder or a zip, import a real card from a folder or a zip.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import type { LxrEmu } from './emu';
import {
  canPickFolder, download, looksLikeCardRoot, makeZip, pickFolder, readFileList, readFolder, readZip, writeFolder,
  type CardFile,
} from './cardFiles';
import { t, text, type Key } from './i18n';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

function btn(key: Key, cls = 'tool'): HTMLButtonElement {
  const b = text(h('button', cls), key);
  b.type = 'button';
  return b;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Builds the dialog. onImported runs after an import rebooted the device,
 * with its boot time.
 */
export function cardDialog(emu: LxrEmu, onImported: (bootMs: number) => void): HTMLDialogElement {
  const dialog = h('dialog', 'card-dialog');
  const status = h('p', 'card-status');
  status.setAttribute('role', 'status');
  const say = (key: Key, vars: Record<string, string | number> = {}) => { status.textContent = t(key, vars); };

  const exportFolderBtn = btn('exportFolder');
  const exportZipBtn = btn('exportZip');
  const importFolderBtn = btn('importFolder');
  const importZipBtn = btn('importZip');
  const closeBtn = btn('close');
  const all = [exportFolderBtn, exportZipBtn, importFolderBtn, importZipBtn, closeBtn];

  const zipInput = h('input');
  zipInput.type = 'file';
  zipInput.accept = '.zip,application/zip';
  zipInput.hidden = true;
  const dirInput = h('input');
  dirInput.type = 'file';
  dirInput.hidden = true;
  dirInput.setAttribute('webkitdirectory', '');

  dialog.append(
    text(h('h2'), 'cardTitle'),
    text(h('p', 'card-intro'), 'cardIntro'),
    h('section', 'card-group',
      text(h('h3'), 'exportTitle'),
      ...(canPickFolder ? [h('div', 'card-row', exportFolderBtn, text(h('span', 'card-hint'), 'exportFolderHint'))] : []),
      h('div', 'card-row', exportZipBtn, text(h('span', 'card-hint'), 'exportZipHint'))),
    h('section', 'card-group',
      text(h('h3'), 'importTitle'),
      h('div', 'card-row', importFolderBtn, importZipBtn),
      text(h('p', 'card-hint'), 'importHint')),
    status,
    h('div', 'card-actions', closeBtn),
    zipInput, dirInput);

  /* Run one action at a time; a cancelled picker is not an error. */
  async function run(action: () => Promise<void>) {
    all.forEach((b) => { b.disabled = true; });
    try {
      await action();
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        say('cardFailed', { msg: (err as Error).message });
        console.error(err);
      }
    } finally {
      all.forEach((b) => { b.disabled = false; });
    }
  }

  async function exported(): Promise<CardFile[]> {
    say('cardReading');
    return emu.exportCard();
  }

  exportFolderBtn.addEventListener('click', () => run(async () => {
    const folder = await pickFolder('readwrite');
    const files = await exported();
    await writeFolder(folder, files, (done) => say('cardWriting', { done, total: files.length }));
    say('cardExported', { n: files.length });
  }));

  exportZipBtn.addEventListener('click', () => run(async () => {
    const files = await exported();
    const zip = makeZip(files);
    const name = `lxr02-sd-${stamp()}.zip`;
    download(zip, name);
    say('cardZipped', { name, kb: Math.round(zip.size / 1024) });
  }));

  async function importFiles(files: CardFile[]) {
    if (!files.some((f) => !f.dir)) { say('cardEmpty'); return; }
    if (!looksLikeCardRoot(files) && !confirm(t('cardNotLxr'))) return;
    const n = files.filter((f) => !f.dir).length;
    if (!confirm(t('cardConfirmImport', { n }))) return;
    const { bootMs, skipped } = await emu.importCardAndReboot(files);
    const written = n - skipped.filter(([p]) => files.some((f) => f.path === p && !f.dir)).length;
    if (skipped.length) {
      const list = skipped.slice(0, 5).map(([p, why]) => `${p} (${why})`).join(', ') + (skipped.length > 5 ? ', …' : '');
      say('cardImportedSkipped', { n: written, k: skipped.length, list });
    } else {
      say('cardImported', { n: written });
    }
    onImported(bootMs);
  }

  importFolderBtn.addEventListener('click', () => {
    if (!canPickFolder) { dirInput.click(); return; }
    run(async () => importFiles(await readFolder(await pickFolder('read'))));
  });
  dirInput.addEventListener('change', () => {
    const list = dirInput.files;
    if (list?.length) run(async () => importFiles(await readFileList(list)));
    dirInput.value = '';
  });
  importZipBtn.addEventListener('click', () => zipInput.click());
  zipInput.addEventListener('change', () => {
    const file = zipInput.files?.[0];
    if (file) run(async () => importFiles(await readZip(file)));
    zipInput.value = '';
  });
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { status.textContent = ''; });
  return dialog;
}
