/*
 * LXR-02 Emu (unofficial) - the firmware's sound menus, for the sound editor.
 *
 * Describes the voice pages the way the menu shows them: the parameters of
 * each sub page (menuPages), their names (valueNames and the name tables of
 * MenuText.h), types and ranges (parameter_dtypes, with the limits of
 * menu_encoderChangeParameter()), the value names of the menus
 * (getMenuItemNameForValue()) and the modulation targets (modTargets). All
 * of it comes from the firmware's tables; only the switch over the menu ids
 * is repeated here, because the menu's own helpers are static.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <stdio.h>
#include <string.h>

#include "main.h"
#include "menu/menu.h"
#include "menu/CcNr2Text.h"
#include "Parameters.h"
#include "Preset/InitKit.h"
#include "lxr_api.h"

#ifdef __wasm__
#define API __attribute__((visibility("default"), used))
#else
#define API
#endif

/* Defined in MenuText.h (included by menu.c only) and menu.c. */
extern const char shortNames[][4], catNames[][16], longNames[][16];
extern const Name valueNames[NUM_NAMES];
extern uint8_t menu_numSamples;
extern const char filterTypes[][8], waveformNames[][4], outputNames[][7], rollRateNames[][4],
	syncRateNames[][4], lfoWaveNames[][4], retriggerNames[][4], nextPatternNames[][4],
	quantisationNames[][4], transientNames[][4], midiModes[][4], midiRoutingNames[][6],
	midiFilterNames[][16], ppqInNames[][4], mixFmNames[][6], ppqOutNames[][4], followNames[][4],
	fxNames[][4], distNames[][4], ratioNames[][4], delayNames[][4], reverbNames[][4],
	patModeNames[][4], stepFlamNames[][4], stepShiftNames[][4], outputNamesFx[][7];

#define MENU_COUNT 27   /* menu ids 1..26, MenuText.h */

/* A menu's names: entry 0 holds the number of entries. */
typedef struct { const char *base; size_t stride; } NameList;

static NameList menu_list(uint8_t id)
{
#define L(a) (NameList){ (const char *)(a), sizeof((a)[0]) }
	switch (id) {
	case 1: return L(filterTypes);
	case 2: return L(waveformNames);
	case 3: return L(outputNames);
	case 4: return L(rollRateNames);
	case 5: return L(syncRateNames);
	case 6: return L(lfoWaveNames);
	case 7: return L(retriggerNames);
	case 8: return L(nextPatternNames);
	case 9: return L(quantisationNames);
	case 10: return L(transientNames);
	case 11: return L(midiModes);
	case 12: return L(midiRoutingNames);
	case 13: return L(midiFilterNames);
	case 14: return L(ppqInNames);
	case 15: return L(mixFmNames);
	case 16: return L(ppqOutNames);
	case 17: return L(followNames);
	case 18: return L(fxNames);
	case 19: return L(distNames);
	case 20: return L(ratioNames);
	case 21: return L(delayNames);
	case 22: return L(reverbNames);
	case 23: return L(patModeNames);
	case 24: return L(stepFlamNames);
	case 25: return L(stepShiftNames);
	case 26: return L(outputNamesFx);
	default: return (NameList){ 0, 0 };
	}
#undef L
}

/* Number of entries, as getMaxEntriesForMenu(): the waveform menu also
 * lists the samples on the card. */
static unsigned menu_entries(uint8_t id)
{
	NameList l = menu_list(id);
	if (!l.base) return 0;
	unsigned n = (uint8_t)l.base[0];
	if (id == 2) n += menu_numSamples;
	return n;
}

/* ---- JSON writer ------------------------------------------------------------ */
static char json[96 * 1024];
static size_t jlen;

static void put(const char *s)
{
	size_t n = strlen(s);
	if (jlen + n < sizeof json) { memcpy(json + jlen, s, n); jlen += n; }
}

static void putf(const char *fmt, int a, int b)
{
	char buf[64];
	snprintf(buf, sizeof buf, fmt, a, b);
	put(buf);
}

/* A string of at most max characters, trailing spaces dropped. */
static void put_str(const char *s, size_t max)
{
	char buf[40];
	size_t n = 0;
	while (n < max && n < sizeof buf - 1 && s[n]) n++;
	while (n && s[n - 1] == ' ') n--;
	put("\"");
	for (size_t i = 0; i < n; i++) {
		unsigned char c = (unsigned char)s[i];
		char e[8];
		if (c == '"' || c == '\\') { e[0] = '\\'; e[1] = (char)c; e[2] = 0; }
		else if (c < 0x20 || c > 0x7e) snprintf(e, sizeof e, "\\u%04x", c);
		else { e[0] = (char)c; e[1] = 0; }
		put(e);
	}
	put("\"");
}

static void put_names(uint8_t nameIdx)
{
	const Name *n = &valueNames[nameIdx];
	put("\"s\":"); put_str(shortNames[n->shortName], 3);
	put(",\"c\":"); put_str(catNames[n->category], 16);
	put(",\"l\":"); put_str(longNames[n->longName], 16);
}

static int is_coarse(uint16_t p)
{
	/* menu_repaintGeneric(): these show -60..+67 instead of -63..+64 */
	return p == PAR_COARSE1 || p == PAR_COARSE2 || p == PAR_COARSE3 || p == PAR_COARSE4 ||
		p == PAR_COARSE5 || p == PAR_COARSE6 || p == PAR_FM_FREQ1 || p == PAR_FM_FREQ2 ||
		p == PAR_FM_FREQ3 || p == PAR_MOD_OSC_F1_CYM || p == PAR_MOD_OSC_F2_CYM ||
		p == PAR_MOD_OSC_F1 || p == PAR_MOD_OSC_F2;
}

/* One parameter: number, names, type, range as menu_encoderChangeParameter()
 * limits it, and how its value is shown. */
static void put_param(uint16_t p, uint8_t nameIdx)
{
	const uint8_t type = (uint8_t)(parameter_dtypes[p] & 0xff);
	const uint8_t menu = (uint8_t)(parameter_dtypes[p] >> 8);
	int lo = 0, hi = 100;
	put("{\"p\":"); putf("%d", p, 0);
	put(","); put_names(nameIdx);
	putf(",\"t\":%d", type, 0);
	switch (type) {
	case DTYPE_0B255: hi = 255; break;
	case DTYPE_0B127: hi = 127; break;
	case DTYPE_PM63: hi = 127; putf(",\"o\":%d", is_coarse(p) ? 60 : 63, 0); break;
	case DTYPE_1B16: lo = 1; hi = 16; break;
	case DTYPE_1B64: lo = 1; hi = 64; break;
	case DTYPE_0B15: hi = 15; break;
	case DTYPE_ON_OFF: hi = 1; break;
	case DTYPE_0b1: hi = 1; put(",\"o\":-1"); break;
	case DTYPE_MENU: hi = (int)menu_entries(menu) - 1; putf(",\"m\":%d", menu, 0); break;
	case DTYPE_VOICE_LFO: lo = 1; hi = 6; break;
	case DTYPE_TARGET_SELECTION_VELO: hi = getNumModTargets() - 1; putf(",\"vv\":%d", p - PAR_VEL_DEST_1, 0); break;
	case DTYPE_TARGET_SELECTION_LFO: hi = getNumModTargets() - 1; putf(",\"lfo\":%d", p - PAR_TARGET_LFO1, 0); break;
	case DTYPE_AUTOM_TARGET: hi = getNumModTargets() - 1; break;
	default: hi = 100; break;   /* the menu's default case, also note names */
	}
	putf(",\"lo\":%d,\"hi\":%d}", lo, hi);
}

/*
 * {"voices":[ [ [param|null x8] x8 sub pages ] x7 voice pages ],
 *  "menus":{"id":[names]}, "targets":[{p,v,s,c,l}], "voiceTargets":[[start,end] x6],
 *  "lfoVoice":[PAR_VOICE_LFO1..6], "sound":END_OF_SOUND_PARAMETERS}
 */
API const char *lxr_ui_describe(void)
{
	jlen = 0;
	put("{\"voices\":[");
	for (int v = 0; v <= VOICE7_PAGE; v++) {
		put(v ? ",[" : "[");
		for (int s = 0; s < NUM_SUB_PAGES; s++) {
			const Page *pg = &menuPages[v][s];
			put(s ? ",[" : "[");
			for (int k = 0; k < 8; k++) {
				const uint8_t name = (&pg->top1)[k];
				const uint16_t p = (&pg->bot1)[k];
				if (k) put(",");
				if (name == TEXT_EMPTY || p == PAR_NONE || p >= NUM_PARAMS) put("null");
				else put_param(p, name);
			}
			put("]");
		}
		put("]");
	}
	put("],\"menus\":{");
	int first = 1;
	for (uint8_t id = 1; id < MENU_COUNT; id++) {
		NameList l = menu_list(id);
		if (!l.base) continue;
		putf(first ? "\"%d\":[" : ",\"%d\":[", id, 0);
		first = 0;
		const unsigned builtin = (uint8_t)l.base[0], n = menu_entries(id);
		for (unsigned i = 0; i < n; i++) {
			if (i) put(",");
			if (i < builtin) put_str(l.base + (i + 1) * l.stride, l.stride);
			else putf("\"s%d\"", (int)(i - builtin), 0);   /* a sample, as the menu shows it */
		}
		put("]");
	}
	put("},\"targets\":[");
	const uint8_t nt = getNumModTargets();
	for (uint8_t i = 0; i < nt; i++) {
		if (i) put(",");
		putf("{\"p\":%d,\"v\":%d,", modTargets[i].param, voiceFromModTargValue(i));
		put_names(modTargets[i].nameIdx);
		put("}");
	}
	put("],\"voiceTargets\":[");
	for (int v = 0; v < 6; v++) putf(v ? ",[%d,%d]" : "[%d,%d]", modTargetVoiceOffsets[v].start, modTargetVoiceOffsets[v].end);
	putf("],\"lfoVoice\":%d,\"sound\":%d}", PAR_VOICE_LFO1, END_OF_SOUND_PARAMETERS);
	json[jlen] = 0;
	return json;
}

/* Put a voice's sound back to the init kit (Preset/initKit.c, the sound of
 * a new project): every parameter on the voice's menu pages, set as a knob
 * would set it. The mod targets go last, because a new LFO voice moves the
 * LFO's target. Returns how many parameters were set. */
API int lxr_reset_voice(uint8_t voice)
{
	if (voice > VOICE7_PAGE) return 0;
	int n = 0;
	for (int targets = 0; targets < 2; targets++) {
		for (int s = 0; s < NUM_SUB_PAGES; s++) {
			const Page *pg = &menuPages[voice][s];
			for (int k = 0; k < 8; k++) {
				const uint16_t p = (&pg->bot1)[k];
				if ((&pg->top1)[k] == TEXT_EMPTY || p == PAR_NONE || p >= END_OF_SOUND_PARAMETERS ||
				    p + 8 >= INIT_KIT_SIZE)
					continue;
				const uint8_t type = (uint8_t)(parameter_dtypes[p] & 0xff);
				const int is_target = type == DTYPE_TARGET_SELECTION_VELO || type == DTYPE_TARGET_SELECTION_LFO;
				if (is_target != targets) continue;
				lxr_set_param(p, initKit[p + 8]);   /* a kit file: 8 name bytes, then the parameters */
				n++;
			}
		}
	}
	return n;
}

/* All parameters, for watching them change. */
API const uint8_t *lxr_params(void) { return activeParameters; }
