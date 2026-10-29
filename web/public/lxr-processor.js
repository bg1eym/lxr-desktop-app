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
const SEQ_EVERY = 8;            /* quanta between sequencer data checks, ~23 ms */

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
		this.last = { lcd: '', cg: '', st: -1, lo: -1, hi: -1, run: -1, heads: '' };
		this.seqView = 255;      /* pattern shown by the page; 255 = the playing one */
		this.lastSeq = null;
		this.seqAck = 0;         /* id of the last sequencer edit done, counted by the page */
		this.paramAck = 0;       /* the same for parameter changes */
		this.lastParams = null;
		/* Flow control: one message of each kind at a time, until the page
		 * says it has it. When the page is frozen or throttled (in the
		 * background, display off, the computer going to sleep) the audio
		 * thread keeps running; without this, hours of display updates
		 * would queue up and arrive at once. What changed in between is sent
		 * when the page answers: the newest display state, pattern data and
		 * parameters, and the card chunks, which stay marked as written. */
		this.busy = { state: false, seq: false, params: false, sd: false, load: false };
		this.forceSeq = false;
		this.forceParams = false;
		this.port.onmessage = (e) => {
			if (this.x) this.handle(e.data); else this.pending.push(e.data);
		};

		/* sdChunks: the saved card, [chunk index, ArrayBuffer] pairs.
		 * importFiles: instead, a card to build from files, [path, isDir,
		 * ArrayBuffer | null] triples. */
		const { wasm, seed, sdMegabytes, sdChunks, importFiles, seqAck, paramAck } = options.processorOptions;
		this.seqAck = seqAck || 0;
		this.paramAck = paramAck || 0;
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
		case 'param':
			x.lxr_set_param(m.i, m.v);
			if (m.id) { this.paramAck = m.id; this.checkParams(true); }
			break;
		case 'selectVoice': x.lxr_select_voice(m.voice); break;
		case 'describe': {
			const p = x.lxr_ui_describe();
			const mem = new Uint8Array(x.memory.buffer);
			let end = p;
			while (mem[end]) end++;
			let json = '';
			for (let i = p; i < end; i += 4096) json += String.fromCharCode.apply(null, mem.subarray(i, Math.min(end, i + 4096)));
			this.port.postMessage({ t: 'describe', json });
			break;
		}
		case 'midi': for (const b of m.data) x.lxr_midi_in_byte(b); break;
		case 'syncSd': this.syncSd(m.id); break;
		case 'ack':
			this.busy[m.k] = false;
			if (m.k === 'state') this.postState();
			else if (m.k === 'seq') this.checkSeq();
			else if (m.k === 'params') this.checkParams();
			break;
		case 'seqView': this.seqView = m.pattern; this.lastSeq = null; break;
		case 'seq': this.seqEdit(m); break;
		case 'trigger': x.lxr_trigger(m.voice, m.velocity); break;
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
		if (id === undefined && this.busy.sd) return;
		const x = this.x;
		const size = x.lxr_sd_chunk_size();
		const chunks = [];
		for (let c; (c = x.lxr_sd_take_dirty()) >= 0;) {
			chunks.push([c, new Uint8Array(x.memory.buffer, x.lxr_sd_chunk(c), size).slice().buffer]);
		}
		if (chunks.length || id !== undefined) {
			this.busy.sd = true;
			this.port.postMessage({ t: 'sd', id, chunks }, chunks.map((c) => c[1]));
		}
	}

	/* Edits from the sequencer page. Each has an id; the data sent back says
	 * which edits it includes, so the page can tell old data from new. */
	seqEdit(m) {
		const x = this.x;
		for (const w of m.steps || []) x.lxr_seq_write_step(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8]);
		for (const l of m.locks || []) x.lxr_seq_write_locks(l[0], l[1], l[2], l[3], l[4], l[5], l[6]);
		for (const [p, t, len] of m.lengths || []) x.lxr_seq_set_length(p, t, len);
		for (const [t, muted] of m.mutes || []) x.lxr_seq_set_mute(t, muted ? 1 : 0);
		if (m.swing) x.lxr_seq_set_swing(m.swing[0], m.swing[1]);
		if (m.keep !== undefined) x.lxr_seq_keep_edits(m.keep ? 1 : 0);
		if (m.save) x.lxr_seq_save();
		if (m.pattern !== undefined) x.lxr_seq_change_pattern(m.pattern);
		this.seqAck = m.id;
		this.checkSeq(true);
	}

	/* Send all parameter values when one changed: knobs on the panel, a
	 * kit load or the page. */
	checkParams(force) {
		if (force) this.forceParams = true;
		if (this.busy.params) return;
		const x = this.x;
		const n = x.lxr_num_params();
		const v = new Uint8Array(x.memory.buffer, x.lxr_params(), n);
		const last = this.lastParams;
		if (last && !this.forceParams) {
			let same = true;
			for (let i = 0; i < n; i++) if (v[i] !== last[i]) { same = false; break; }
			if (same) return;
		}
		this.lastParams = v.slice();
		const out = v.slice();
		this.forceParams = false;
		this.busy.params = true;
		this.port.postMessage({ t: 'params', v: out, ack: this.paramAck }, [out.buffer]);
	}

	/* Send the shown pattern's data when it changed (edits from the page, the
	 * virtual panel or MIDI all end up here). */
	checkSeq(force) {
		if (force) this.forceSeq = true;
		if (this.busy.seq) return;
		const x = this.x;
		const size = x.lxr_seq_snapshot_size();
		const snap = new Uint8Array(x.memory.buffer, x.lxr_seq_snapshot(this.seqView), size);
		const last = this.lastSeq;
		if (last && !this.forceSeq) {
			let same = true;
			for (let i = 0; i < size; i++) if (snap[i] !== last[i]) { same = false; break; }
			if (same) return;
		}
		const copy = snap.slice();
		this.lastSeq = copy;
		const out = copy.slice();
		this.forceSeq = false;
		this.busy.seq = true;
		this.port.postMessage({ t: 'seq', data: out, ack: this.seqAck }, [out.buffer]);
	}

	postState() {
		if (this.busy.state) return;
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
		let heads = '';
		for (let t = 0; t < 7; t++) heads += String.fromCharCode(x.lxr_seq_playhead(t) + 32);
		const l = this.last;
		if (lcd === l.lcd && cg === l.cg && st === l.st && lo === l.lo && hi === l.hi && run === l.run && heads === l.heads) return;
		this.last = { lcd, cg, st, lo, hi, run, heads };
		const playheads = Array.from(heads, (c) => c.charCodeAt(0) - 32);
		this.busy.state = true;
		this.port.postMessage({ t: 'state', lcd: lcdBytes.slice(), cg: cgBytes.slice(), st, lo, hi, run, playheads });
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
		/* at most one quantum's worth: a computer waking from sleep in the
		 * middle of a render is not load */
		this.renderMs += Math.min(Date.now() - t0, 10);
		this.renderQuanta++;

		if (++this.quanta % STATE_EVERY === 0) this.postState();
		if (this.quanta % SD_EVERY === 0) this.syncSd();
		if (this.quanta % SEQ_EVERY === 0) this.checkSeq();
		if (this.quanta % SEQ_EVERY === 4) this.checkParams();
		if (this.renderQuanta >= 1034) {   /* about every 3 s: Date.now() only has 1 ms steps */
			const audioMs = this.renderQuanta * QUANTUM / sampleRate * 1000;
			if (!this.busy.load) {
				this.busy.load = true;
				this.port.postMessage({ t: 'load', load: this.renderMs / audioMs });
			}
			this.renderMs = 0;
			this.renderQuanta = 0;
		}
		return true;
	}
}

registerProcessor('lxr-processor', LxrProcessor);
