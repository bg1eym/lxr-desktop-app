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

		/* sdChunks: the saved card, [chunk index, ArrayBuffer] pairs. */
		const { wasm, seed, sdMegabytes, sdChunks } = options.processorOptions;
		const imports = { wasi_snapshot_preview1: wasiImports(() => this.x.memory, (s) => this.port.postMessage({ t: 'log', s })) };
		WebAssembly.instantiate(wasm, imports).then(({ instance }) => {
			const x = instance.exports;
			x._initialize();
			const t0 = Date.now();
			let res = x.lxr_sd_create(sdMegabytes);
			if (res === 0) {
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
			this.port.postMessage({ t: 'ready', res, bootMs: Date.now() - t0 });
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
		case 'getParams': {
			const n = x.lxr_num_params();
			const v = new Uint8Array(n);
			for (let i = 0; i < n; i++) v[i] = x.lxr_get_param(i);
			this.port.postMessage({ t: 'params', v }, [v.buffer]);
			break;
		}
		}
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
