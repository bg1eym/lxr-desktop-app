/*
 * LXR-02 Emu (unofficial) - C API for the command line tool and for JS.
 *
 * Everything goes through the firmware's own code paths: buttons are pressed
 * on the virtual shift registers and picked up by IO/DIO.c, parameters are
 * sent the way the menu sends them, files are read and written by
 * presetManager.c on the virtual SD card.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <string.h>

#include "main.h"
#include "menu/menu.h"
#include "Parameters.h"
#include "buttonHandler.h"
#include "frontPanelParser_ui.h"
#include "Preset/PresetManager.h"
#include "Soundengine/Sequencer/sequencer.h"
#include "Soundengine/config.h"

#include "emu_hw.h"
#include "platform.h"
#include "lxr_api.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

/* ---- rendering ------------------------------------------------------------ */
static int16_t blk1[OUTPUT_DMA_SIZE * 2], blk2[OUTPUT_DMA_SIZE * 2];
static int blk_pos = OUTPUT_DMA_SIZE;   /* frames of the current block already handed out */

/* ---- input queue: one change per main-loop pass, like real key presses ---- */
#define INQ_SIZE 64
typedef struct { uint8_t button; uint8_t down; } in_event;
static in_event inq[INQ_SIZE];
static unsigned inq_rd, inq_wr;

static void apply_input(void)
{
	if (inq_rd == inq_wr) return;
	const in_event e = inq[inq_rd++ % INQ_SIZE];
	if (e.button == BUT_PAGE_DOWN) {
		if (e.down) SW_43_GPIO_Port->IDR |= SW_43_Pin;
		else SW_43_GPIO_Port->IDR &= ~(uint32_t)SW_43_Pin;
	} else if (e.button < 40) {
		if (e.down) emu_panel.buttons[e.button / 8] |= (uint8_t)(1u << (e.button % 8));
		else emu_panel.buttons[e.button / 8] &= (uint8_t)~(1u << (e.button % 8));
	}
}

static void next_block(void)
{
	apply_input();
	emu_render_block(blk1, blk2);
	blk_pos = 0;
}

/* The firmware keeps its state in globals that only a power cycle clears,
 * so the device can be booted once per process (in the browser: per
 * instance of the WebAssembly module). */
static int booted;

API int lxr_init(uint32_t seed, uint32_t sd_megabytes)
{
	if (booted) return -2;
	booted = 1;
	inq_rd = inq_wr = 0;
	blk_pos = OUTPUT_DMA_SIZE;
	if (emu_sd_init(sd_megabytes * 1024u * 1024u) != 0) return -1;
	emu_boot_opts o = { .seed = seed, .jacks = 0, .format_blank_card = 1 };
	return emu_boot(&o);
}

API int lxr_render(float *out, int frames, int channels)
{
	for (int f = 0; f < frames; f++) {
		if (blk_pos >= OUTPUT_DMA_SIZE) next_block();
		const int i = blk_pos * 2;
		float *o = out + (size_t)f * channels;
		o[0] = blk1[i] * (1.f / 32768.f);
		o[1] = blk1[i + 1] * (1.f / 32768.f);
		if (channels >= 4) {
			o[2] = blk2[i] * (1.f / 32768.f);
			o[3] = blk2[i + 1] * (1.f / 32768.f);
		}
		blk_pos++;
	}
	return frames;
}

API int lxr_render_i16(int16_t *out, int frames, int channels)
{
	for (int f = 0; f < frames; f++) {
		if (blk_pos >= OUTPUT_DMA_SIZE) next_block();
		const int i = blk_pos * 2;
		int16_t *o = out + (size_t)f * channels;
		o[0] = blk1[i];
		o[1] = blk1[i + 1];
		if (channels >= 4) {
			o[2] = blk2[i];
			o[3] = blk2[i + 1];
		}
		blk_pos++;
	}
	return frames;
}

/* Run the device for a while without keeping the audio (boot settling,
 * handing queued key presses to the firmware). */
API void lxr_idle_blocks(int blocks)
{
	for (int i = 0; i < blocks; i++) next_block();
	blk_pos = OUTPUT_DMA_SIZE;
}

/* ---- front panel ---------------------------------------------------------- */
API void lxr_button(uint8_t button, uint8_t down)
{
	if (inq_wr - inq_rd >= INQ_SIZE) return;
	inq[inq_wr++ % INQ_SIZE] = (in_event){ button, down };
}

API void lxr_button_click(uint8_t button)
{
	lxr_button(button, 1);
	lxr_button(button, 0);
}

API int lxr_input_pending(void) { return (int)(inq_wr - inq_rd); }

API const char *lxr_get_lcd(void) { return emu_lcd_text(); }
API const uint8_t *lxr_get_leds(void) { return emu_panel.leds; }
API void lxr_set_jacks(uint8_t mask) { emu_set_jacks(mask); }

/* ---- transport ------------------------------------------------------------ */
API int lxr_is_running(void) { return seq_isRunning(); }

/* Start/stop as with the START button, so the front panel state, LEDs and
 * MIDI start/stop follow. */
API void lxr_set_running(uint8_t run)
{
	if ((seq_isRunning() != 0) != (run != 0)) lxr_button_click(BUT_START_STOP);
}

/* ---- parameters ------------------------------------------------------------ */
API int lxr_num_params(void) { return NUM_PARAMS; }
API int lxr_num_sound_params(void) { return END_OF_SOUND_PARAMETERS; }
API int lxr_get_param(int idx) { return (idx >= 0 && idx < NUM_PARAMS) ? activeParameters[idx] : -1; }

/* Set a parameter to an absolute value, then hand it to the engine with the
 * same messages menu_parseKnobValue() sends after a knob turn. Mod target
 * parameters hold an index into modTargets[] and go out as CC_VELO_TARGET /
 * CC_LFO_TARGET, like preset_sendDrumsetParameters() does. */
API void lxr_set_param(int idx, int value)
{
	if (idx < 0 || idx >= NUM_PARAMS) return;
	activeParameters[idx] = (uint8_t)value;
	preset_touchTimer(PRESET_KIT_TIMER);

	if (idx >= PAR_VEL_DEST_1 && idx < PAR_VEL_DEST_1 + 6) {
		const uint8_t i = (uint8_t)(idx - PAR_VEL_DEST_1);
		const uint8_t v = (uint8_t)pgm_read_word(&modTargets[activeParameters[idx]].param);
		frontPanel_sendData(CC_VELO_TARGET, (uint8_t)(((v & 0x80) >> 7) | ((i & 0x3f) << 1)), v & 0x7f);
	} else if ((idx >= PAR_TARGET_LFO1 && idx < PAR_TARGET_LFO1 + 6) ||
	           (idx >= PAR_VOICE_LFO1 && idx < PAR_VOICE_LFO1 + 6)) {
		const uint8_t i = (uint8_t)(idx >= PAR_TARGET_LFO1 ? idx - PAR_TARGET_LFO1 : idx - PAR_VOICE_LFO1);
		if (activeParameters[PAR_VOICE_LFO1 + i] < 1 || activeParameters[PAR_VOICE_LFO1 + i] > 6)
			activeParameters[PAR_VOICE_LFO1 + i] = 1;
		const uint8_t v = (uint8_t)pgm_read_word(&modTargets[activeParameters[PAR_TARGET_LFO1 + i]].param);
		frontPanel_sendData(CC_LFO_TARGET, (uint8_t)(((v & 0x80) >> 7) | ((i & 0x3f) << 1)), v & 0x7f);
	} else if (idx < END_OF_SOUND_PARAMETERS) {
		uint8_t v = (uint8_t)value;
		if (!(idx >= PAR_AUDIO_OUT1 && idx <= PAR_AUDIO_OUT6))
			v = preset_getMorphValue((uint16_t)idx, activeParameters[PAR_MORPH]);
		if (idx < 128) frontPanel_sendData(MIDI_CC, (uint8_t)idx, v);
		else frontPanel_sendData(CC_2, (uint8_t)(idx - 128), v);
	} else {
		menu_parseGlobalParam((uint16_t)idx, (uint8_t)value);
	}
	menu_repaintAll();
}

/* ---- sequencer ------------------------------------------------------------- */
/* Main step on/off, as buttonHandler_setRemoveStep() does in step mode. */
API void lxr_set_main_step(uint8_t pattern, uint8_t voice, uint8_t step, uint8_t on)
{
	if (voice > 6 || pattern >= NUM_PATTERN || step >= 128) return;
	if (!seq_isMainStepActive(voice, step, pattern) != !on) {
		seq_toggleMainStep(voice, step, pattern);
		preset_touchTimer(PRESET_PAT_TIMER);
	}
}

API int lxr_get_main_step(uint8_t pattern, uint8_t voice, uint8_t step)
{
	if (voice > 6 || pattern >= NUM_PATTERN || step >= 128) return 0;
	return seq_isMainStepActive(voice, step, pattern) ? 1 : 0;
}

/* ---- MIDI ------------------------------------------------------------------ */
API void lxr_midi_in(const uint8_t *bytes, int len)
{
	for (int i = 0; i < len; i++) emu_midi_in_byte(bytes[i]);
}

API void lxr_set_midi_out(lxr_midi_out_fn fn, void *user)
{
	emu_set_midi_out(fn, user);
}
