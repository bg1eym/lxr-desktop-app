/*
 * LXR-02 Emu (unofficial) - sequencer access for the step editor.
 *
 * Reads and writes the firmware's own pattern data (seq_patternSet), the way
 * the front panel's step editing does: CortexParser.c's FRONT_SEQ_VOLUME,
 * _PROB, _NOTE, _FLAM, _SHIFT and FRONT_SET_Px_* handlers assign the same
 * fields, seq_setMainStep() switches steps, seq_setMute() mutes, and pattern
 * changes go through SEQ_CHANGE_PAT. Every edit touches the pattern autosave
 * timer, like a button press, so the firmware saves /TMP/TMP.PAT 2 s later.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <string.h>

#include "main.h"
#include "frontPanelParser_ui.h"
#include "Parameters.h"
#include "menu/menu.h"
#include "Preset/PresetManager.h"
#include "Soundengine/Sequencer/sequencer.h"
#include "Soundengine/MIDI/MidiVoiceControl.h"
#include "platform.h"

#ifdef __wasm__
#define API __attribute__((visibility("default"), used))
#else
#define API
#endif

/* Snapshot layout, see lxr_seq_snapshot(). */
#define SNAP_HEADER 20
#define SNAP_STEP 12
static uint8_t snap[SNAP_HEADER + NUM_TRACKS * NUM_STEPS * SNAP_STEP];

static int valid(uint8_t pattern, uint8_t track, uint8_t step)
{
	return pattern < NUM_PATTERN && track < NUM_TRACKS && step < NUM_STEPS;
}

/* Edits to the playing pattern are a working copy on the device: a pattern
 * change restores the copy taken when the pattern started playing
 * (patternBackupBuffer, see seq_setPendingPatternActive()), unless the
 * pattern was saved first. 1 if the working copy differs from it. */
static int active_edited(void)
{
	const uint8_t p = seq_activePattern;
	const PatternBackupBuffer *b = &patternBackupBuffer;
	if (memcmp(b->seq_subStepPattern, seq_patternSet.seq_subStepPattern[p], sizeof b->seq_subStepPattern)) return 1;
	if (memcmp(b->seq_stepTiming, seq_patternSet.seq_stepTiming[p], sizeof b->seq_stepTiming)) return 1;
	for (uint8_t bar = 0; bar < NUM_BARS; bar++)
		if (memcmp(b->seq_mainSteps[bar], seq_patternSet.seq_mainSteps[bar][p], sizeof b->seq_mainSteps[bar])) return 1;
	if (memcmp(b->length, seq_patternSet.length[p], sizeof b->length)) return 1;
	return b->shuffle != activeParameters[PAR_SHUFFLE];
}

/*
 * One pattern as bytes:
 *   [0] pattern, [1] playing pattern, [2] pending pattern, [3] running,
 *   [4] muted tracks (bit per track), [5] pattern's stored shuffle,
 *   [6] linked kit, [7] BPM (PAR_BPM), [8..14] track lengths, [15] swing
 *   (PAR_SHUFFLE, 0-127), [16] the playing pattern has edits that a pattern
 *   change would discard, [17..19] 0, then for each track, for each of the
 *   64 steps:
 *   on, volume (bit 7 = sub-step flag, kept as stored), probability 0-100,
 *   note, retrig index 0-5 (off, x2, x3, x4, x6, x8), nudge 0-14 (7 = none),
 *   lock 1 parameter, lock 1 value, lock 2 parameter, lock 2 value, 0, 0.
 */
API const uint8_t *lxr_seq_snapshot(uint8_t pattern)
{
	if (pattern >= NUM_PATTERN) pattern = seq_activePattern;
	uint8_t *h = snap;
	memset(h, 0, SNAP_HEADER);
	h[0] = pattern;
	h[1] = seq_activePattern;
	h[2] = seq_pendingPattern;
	h[3] = seq_isRunning();
	for (uint8_t t = 0; t < NUM_TRACKS; t++) {
		if (seq_isTrackMuted(t)) h[4] |= (uint8_t)(1u << t);
		h[8 + t] = seq_patternSet.length[pattern][t];
	}
	h[5] = seq_patternSet.shuffle[pattern];
	h[6] = seq_patternSet.kitNr[pattern];
	h[7] = activeParameters[PAR_BPM];
	h[15] = activeParameters[PAR_SHUFFLE];
	h[16] = (uint8_t)active_edited();

	uint8_t *p = snap + SNAP_HEADER;
	for (uint8_t t = 0; t < NUM_TRACKS; t++) {
		for (uint8_t s = 0; s < NUM_STEPS; s++, p += SNAP_STEP) {
			const Step *st = &seq_patternSet.seq_subStepPattern[pattern][t][s];
			const StepTiming *tm = &seq_patternSet.seq_stepTiming[pattern][t][s];
			p[0] = seq_isMainStepActive(t, s, pattern) ? 1 : 0;
			p[1] = st->volume;
			p[2] = st->prob;
			p[3] = st->note;
			p[4] = tm->flam;
			p[5] = tm->shift;
			p[6] = st->param1Nr;
			p[7] = st->param1Val;
			p[8] = st->param2Nr;
			p[9] = st->param2Val;
			p[10] = p[11] = 0;
		}
	}
	return snap;
}

API uint32_t lxr_seq_snapshot_size(void) { return sizeof(snap); }

/* Write one step. volume 0-127 (the sub-step flag in bit 7 is kept),
 * probability 0-100, retrig 0-5, nudge 0-14. */
API void lxr_seq_write_step(uint8_t pattern, uint8_t track, uint8_t step, uint8_t on,
                            uint8_t volume, uint8_t prob, uint8_t note, uint8_t retrig, uint8_t nudge)
{
	if (!valid(pattern, track, step)) return;
	Step *st = &seq_patternSet.seq_subStepPattern[pattern][track][step];
	StepTiming *tm = &seq_patternSet.seq_stepTiming[pattern][track][step];
	seq_setMainStep(pattern, track, step, on ? 1 : 0);
	st->volume = (uint8_t)((st->volume & ~STEP_VOLUME_MASK) | (volume & STEP_VOLUME_MASK));
	st->prob = prob > 100 ? 100 : prob;
	st->note = note & 0x7f;
	tm->flam = retrig > 5 ? 5 : retrig;
	tm->shift = nudge > 14 ? 14 : nudge;
	preset_touchTimer(PRESET_PAT_TIMER);
}

/* Parameter locks of a step, as stored (FRONT_SET_Px_DEST / _VAL). */
API void lxr_seq_write_locks(uint8_t pattern, uint8_t track, uint8_t step,
                             uint8_t p1nr, uint8_t p1val, uint8_t p2nr, uint8_t p2val)
{
	if (!valid(pattern, track, step)) return;
	Step *st = &seq_patternSet.seq_subStepPattern[pattern][track][step];
	st->param1Nr = p1nr;
	st->param1Val = p1val & 0x7f;
	st->param2Nr = p2nr;
	st->param2Val = p2val & 0x7f;
	preset_touchTimer(PRESET_PAT_TIMER);
}

/* Track length 1-64, as seq_setTrackLength() does for the shown pattern. */
API void lxr_seq_set_length(uint8_t pattern, uint8_t track, uint8_t length)
{
	if (pattern >= NUM_PATTERN || track >= NUM_TRACKS) return;
	if (length < 1) length = 1;
	if (length > NUM_STEPS) length = NUM_STEPS;
	seq_patternSet.length[pattern][track] = length;
	preset_touchTimer(PRESET_PAT_TIMER);
}

API void lxr_seq_set_mute(uint8_t track, uint8_t muted)
{
	if (track < NUM_TRACKS) seq_setMute(track, muted ? 1 : 0);
}

/* Swing of a pattern, 0-127. The firmware keeps it per pattern and plays
 * PAR_SHUFFLE; this sets both, so the pattern brings it back when it plays
 * again. */
API void lxr_seq_set_swing(uint8_t pattern, uint8_t swing)
{
	if (pattern >= NUM_PATTERN) return;
	if (swing > 127) swing = 127;
	seq_patternSet.shuffle[pattern] = swing;
	if (pattern == seq_activePattern) {
		activeParameters[PAR_SHUFFLE] = swing;
		frontPanel_sendData(SEQ_CC, SEQ_SHUFFLE, swing);
	}
	preset_touchTimer(PRESET_PAT_TIMER);
}

/* Save the playing pattern to its own slot, as the SAVE page does
 * (buttonHandler.c, SELECT_MODE_PATTERN): its swing, the RAM copy that a
 * pattern change goes back to, and the pattern file. */
API void lxr_seq_save(void)
{
	const uint8_t p = seq_activePattern;
	seq_patternSet.shuffle[p] = activeParameters[PAR_SHUFFLE];
	preset_savePatternRAM(p);
	preset_savePatternSD(p);
	menu_selectedPresetNr[SAVE_TYPE_PATTERN] = p;
}

/*
 * Keep edits when the pattern changes. Off, the firmware behaves as on the
 * device. On, the working copy becomes the copy a pattern change goes back
 * to, right before the change, and once the next pattern plays the edited
 * one is saved to its file, as if SAVE had been used.
 */
static uint8_t keep_edits;
static uint8_t kept_pattern = 0xff;

static void keep_working_copy(void)
{
	const uint8_t p = seq_activePattern;
	if (p >= NUM_PATTERN || !active_edited()) return;
	seq_patternSet.shuffle[p] = activeParameters[PAR_SHUFFLE];
	seq_copyPatternToBackupBuffer(p);
	kept_pattern = p;
}

API void lxr_seq_keep_edits(uint8_t on) { keep_edits = on ? 1 : 0; }

/* Called by emu_render_block() before the block's interrupts run: a pattern
 * change only happens in seq_tick(), and edits only between blocks. */
void seq_api_block(void)
{
	if (!keep_edits) return;
	if (kept_pattern != 0xff && kept_pattern != seq_activePattern) {
		preset_savePatternSD(kept_pattern);
		kept_pattern = 0xff;
	}
	if (seq_pendingPattern != seq_activePattern) keep_working_copy();
}

/* Switch patterns like the pattern buttons do: the sequencer changes at the
 * end of the current pattern, or right away when stopped. */
API void lxr_seq_change_pattern(uint8_t pattern)
{
	if (pattern >= NUM_PATTERN) return;
	if (keep_edits && pattern != seq_activePattern) keep_working_copy();
	frontPanel_sendData(SEQ_CC, SEQ_CHANGE_PAT, pattern);
	preset_touchTimer(PRESET_PAT_TIMER);
}

/* Current step of each track, for the playhead. */
API int lxr_seq_playhead(uint8_t track)
{
	return track < NUM_TRACKS ? seq_getStepIndex(track) : 0;
}

/* Play a voice (0-6) now, as the sequencer does for a step, without
 * sending MIDI. Used to preview a track. */
API void lxr_trigger(uint8_t voice, uint8_t velocity)
{
	if (voice > 6) return;
	voiceControl_noteOff(voice);
	voiceControl_noteOn(voice, 60, velocity & 0x7f);
}
