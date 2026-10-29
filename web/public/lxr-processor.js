/*
 * LXR-02 Emu (unofficial) - AudioWorklet processor.
 *
 * Runs the firmware (lxr_emu.wasm, built from emu/) on the audio thread:
 * every render quantum asks the emulated device for the next frames, and a
 * few times per frame of video the display and LED state go back to the page.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

const QUANTUM = 128;
const STATE_EVERY = 4;          /* quanta between state messages, ~86 Hz */
const SD_EVERY = 172;           /* quanta between SD card syncs, ~0.5 s */

/* The module only needs fd_write (printf to stdout/stderr), fd_seek and
 * fd_close from WASI. AudioWorkletGlobalScope has no TextDecoder, the text
 * is plain ASCII anyway. */
function wasiImports(getMemory, log) {
	let line = '';
	return {
		fd_write(fd, iovs, iovsLen, nwritten) {
			const mem = getMemory();
			const view = new DataView(mem.buffer);
			const bytes = new Uint8Array(mem.buffer);
			let total = 0;
			for (let i = 0; i < iovsLen; i++) {
				const ptr = view.getUint32(iovs + 8 * i, true);
				const len = view.getUint32(iovs + 8 * i + 4, true);
				for (let j = 0; j < len; j++) {
					const c = bytes[ptr + j];
					if (c === 10) { log(line); line = ''; } else line += String.fromCharCode(c);
				}
				total += len;
			}
			view.setUint32(nwritten, total, true);
			return 0;
		},
		fd_seek() { return 70; /* ESPIPE */ },
		fd_close() { return 0; },
	};
}

class LxrProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		this.x = null;
		this.pending = [];
		this.quanta = 0;
		this.renderMs = 0;
		this.renderQuanta = 0;
		this.last = { lcd: '', cg: '', st: -1, lo: -1, hi: -1, run: -1 };
		this.port.onmessage = (e) => {
			if (this.x) this.handle(e.data); else this.pending.push(e.data);
		};

		/* sdChunks: the saved card, [chunk index, ArrayBuffer] pairs.
		 * importFiles: instead, a card to build from files, [path, isDir,
		 * ArrayBuffer | null] triples. */
		const { wasm, seed, sdMegabytes, sdChunks, importFiles } = options.processorOptions;
		const imports = { wasi_snapshot_preview1: wasiImports(() => this.x.memory, (s) => this.port.postMessage({ t: 'log', s })) };
		WebAssembly.instantiate(wasm, imports).then(({ instance }) => {
			const x = instance.exports;
			x._initialize();
			const t0 = Date.now();
			let res = x.lxr_sd_create(sdMegabytes);
			let skipped = [];
			if (res === 0 && importFiles) {
				skipped = this.importCard(x, importFiles);
				res = x.lxr_boot(seed >>> 0);
			} else if (res === 0) {
				for (const [c, data] of sdChunks || []) {
					const ptr = x.lxr_sd_chunk_for_load(c);
					if (ptr) new Uint8Array(x.memory.buffer, ptr, data.byteLength).set(new Uint8Array(data));
				}
				/* the chunks just loaded are not news to the page */
				while (x.lxr_sd_take_dirty() >= 0);
				res = x.lxr_boot(seed >>> 0);
			}
			this.x = x;
			this.bufPtr = x.lxr_audio_buffer();
			for (const m of this.pending) this.handle(m);
			this.pending = [];
			this.port.postMessage({ t: 'ready', res, bootMs: Date.now() - t0, skipped });
		}).catch((err) => this.port.postMessage({ t: 'error', msg: String(err && err.stack || err) }));
	}

	handle(m) {
		const x = this.x;
		switch (m.t) {
		case 'btn': x.lxr_button(m.n, m.d ? 1 : 0); break;
		case 'enc': x.lxr_encoder_turn(m.n | 0); break;
		case 'encBtn': x.lxr_encoder_button(m.d ? 1 : 0); break;
		case 'pot': x.lxr_pot_turn(m.i, m.deg | 0); break;
		case 'fader': x.lxr_set_fader(m.i, m.v); break;
		case 'jacks': x.lxr_set_jacks(m.m); break;
		case 'param': x.lxr_set_param(m.i, m.v); break;
		case 'midi': for (const b of m.data) x.lxr_midi_in_byte(b); break;
		case 'syncSd': this.syncSd(m.id); break;
		case 'exportCard': this.exportCard(m.id); break;
		case 'getParams': {
			const n = x.lxr_num_params();
			const v = new Uint8Array(n);
			for (let i = 0; i < n; i++) v[i] = x.lxr_get_param(i);
			this.port.postMessage({ t: 'params', v }, [v.buffer]);
			break;
		}
		}
	}

	/* Format the card and write the files to it, before power-on. Returns
	 * the files the firmware's FatFs refused, with its error code. */
	importCard(x, files) {
		const skipped = [];
		const r = x.lxr_card_import_begin();
		if (r !== 0) return files.map(([path]) => [path, 'format ' + r]);
		for (const [path, isDir, data] of files) {
			if (path.length >= 95 || /[^\x20-\x7e]/.test(path)) { skipped.push([path, 'name']); continue; }
			const p = x.lxr_card_path_buffer();
			const mem = new Uint8Array(x.memory.buffer);
			for (let i = 0; i < path.length; i++) mem[p + i] = path.charCodeAt(i);
			mem[p + path.length] = 0;
			const len = data ? data.byteLength : 0;
			const ptr = x.lxr_card_buffer(len || 1);
			if (len) new Uint8Array(x.memory.buffer, ptr, len).set(new Uint8Array(data));
			const err = x.lxr_card_import_file(len, isDir ? 1 : 0);
			if (err !== 0) skipped.push([path, 'FatFs ' + err]);
		}
		x.lxr_card_import_end();
		return skipped;
	}

	/* Every file and directory on the card, read through the firmware's
	 * FatFs: [path, isDir, ArrayBuffer | null]. */
	exportCard(id) {
		const x = this.x;
		const n = x.lxr_card_scan();
		if (n < 0) { this.port.postMessage({ t: 'cardFiles', id, error: 'scan ' + n }); return; }
		const files = [];
		const cstr = (ptr) => {
			const mem = new Uint8Array(x.memory.buffer);
			let s = '';
			while (mem[ptr]) s += String.fromCharCode(mem[ptr++]);
			return s;
		};
		for (let i = 0; i < n; i++) {
			const path = cstr(x.lxr_card_entry_path(i));
			if (x.lxr_card_entry_is_dir(i)) { files.push([path, true, null]); continue; }
			const len = x.lxr_card_entry_read(i);
			if (len < 0) { this.port.postMessage({ t: 'cardFiles', id, error: 'read ' + path }); return; }
			files.push([path, false, new Uint8Array(x.memory.buffer, x.lxr_card_buffer(0), len).slice().buffer]);
		}
		this.port.postMessage({ t: 'cardFiles', id, files }, files.filter((f) => f[2]).map((f) => f[2]));
	}

	/* Send the card chunks written since the last sync to the page, which
	 * stores them. With an id, always answer, so the page knows it has
	 * everything (before a reboot). */
	syncSd(id) {
		const x = this.x;
		const size = x.lxr_sd_chunk_size();
		const chunks = [];
		for (let c; (c = x.lxr_sd_take_dirty()) >= 0;) {
			chunks.push([c, new Uint8Array(x.memory.buffer, x.lxr_sd_chunk(c), size).slice().buffer]);
		}
		if (chunks.length || id !== undefined) {
			this.port.postMessage({ t: 'sd', id, chunks }, chunks.map((c) => c[1]));
		}
	}

	postState() {
		const x = this.x;
		const mem = x.memory.buffer;
		const lcdBytes = new Uint8Array(mem, x.lxr_get_lcd(), 32);
		const cgBytes = new Uint8Array(mem, x.lxr_get_lcd_cgram(), 64);
		const lcd = String.fromCharCode.apply(null, lcdBytes);
		const cg = String.fromCharCode.apply(null, cgBytes);
		const st = x.lxr_get_lcd_state() >>> 0;
		const lo = x.lxr_get_leds_lo() >>> 0;
		const hi = x.lxr_get_leds_hi() >>> 0;
		const run = x.lxr_is_running();
		const l = this.last;
		if (lcd === l.lcd && cg === l.cg && st === l.st && lo === l.lo && hi === l.hi && run === l.run) return;
		this.last = { lcd, cg, st, lo, hi, run };
		this.port.postMessage({ t: 'state', lcd: lcdBytes.slice(), cg: cgBytes.slice(), st, lo, hi, run });
	}

	process(inputs, outputs) {
		const out = outputs[0];
		if (!this.x) {
			for (const ch of out) ch.fill(0);
			return true;
		}
		const t0 = Date.now();
		this.x.lxr_render(this.bufPtr, QUANTUM, 4);
		const buf = new Float32Array(this.x.memory.buffer, this.bufPtr, QUANTUM * 4);
		const nch = out.length;
		for (let i = 0; i < QUANTUM; i++) {
			const o = 4 * i;
			if (nch >= 1) out[0][i] = buf[o];
			if (nch >= 2) out[1][i] = buf[o + 1];
			if (nch >= 4) { out[2][i] = buf[o + 2]; out[3][i] = buf[o + 3]; }
		}
		this.renderMs += Date.now() - t0;
		this.renderQuanta++;

		if (++this.quanta % STATE_EVERY === 0) this.postState();
		if (this.quanta % SD_EVERY === 0) this.syncSd();
		if (this.renderQuanta >= 1034) {   /* about every 3 s: Date.now() only has 1 ms steps */
			const audioMs = this.renderQuanta * QUANTUM / sampleRate * 1000;
			this.port.postMessage({ t: 'load', load: this.renderMs / audioMs });
			this.renderMs = 0;
			this.renderQuanta = 0;
		}
		return true;
	}
}

registerProcessor('lxr-processor', LxrProcessor);
