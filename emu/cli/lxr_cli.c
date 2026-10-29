/*
 * LXR-02 Emu (unofficial) - command line tool: offline rendering and checks.
 *
 *   lxr_cli render [--seed N] [--bars N] [--channels 2|4] [--demo] [--out file.wav]
 *   lxr_cli selftest
 *
 * Boots the emulated device on a blank virtual SD card, optionally programs
 * a small demo beat, starts the sequencer and writes the output as a 16-bit
 * WAV file. Prints peak, RMS and a hash of the samples, so two runs can be
 * compared for bit-exactness.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lxr_api.h"
#include "Parameters.h"

/* Sample rate of the device (see emu/platform.c). The WAV header says 44100,
 * the rate the emulator plays at. */
#define DEVICE_FS 44140.625
#define WAV_FS 44100

static void put_u32(FILE *f, uint32_t v) { fputc(v & 255, f); fputc((v >> 8) & 255, f); fputc((v >> 16) & 255, f); fputc(v >> 24, f); }
static void put_u16(FILE *f, uint16_t v) { fputc(v & 255, f); fputc(v >> 8, f); }

static int write_wav(const char *path, const int16_t *data, uint32_t frames, int channels)
{
	FILE *f = fopen(path, "wb");
	if (!f) { perror(path); return -1; }
	const uint32_t bytes = frames * (uint32_t)channels * 2u;
	fwrite("RIFF", 1, 4, f); put_u32(f, 36 + bytes);
	fwrite("WAVEfmt ", 1, 8, f); put_u32(f, 16);
	put_u16(f, 1); put_u16(f, (uint16_t)channels);
	put_u32(f, WAV_FS); put_u32(f, WAV_FS * (uint32_t)channels * 2u);
	put_u16(f, (uint16_t)(channels * 2)); put_u16(f, 16);
	fwrite("data", 1, 4, f); put_u32(f, bytes);
	for (uint32_t i = 0; i < frames * (uint32_t)channels; i++) put_u16(f, (uint16_t)data[i]);
	fclose(f);
	return 0;
}

/* Four on the floor, snare on 2 and 4, closed hat on the off-beats. */
static void program_demo(void)
{
	for (int s = 0; s < 16; s += 4) lxr_set_main_step(0, 0, (uint8_t)s, 1);   /* drum 1 */
	lxr_set_main_step(0, 3, 4, 1);                                            /* snare */
	lxr_set_main_step(0, 3, 12, 1);
	for (int s = 2; s < 16; s += 4) lxr_set_main_step(0, 5, (uint8_t)s, 1);   /* closed hat */
}

static int cmd_render(int argc, char **argv)
{
	uint32_t seed = 1;
	int bars = 2, channels = 2, demo = 0;
	const char *out = "render.wav";
	for (int i = 0; i < argc; i++) {
		if (!strcmp(argv[i], "--seed") && i + 1 < argc) seed = (uint32_t)strtoul(argv[++i], NULL, 0);
		else if (!strcmp(argv[i], "--bars") && i + 1 < argc) bars = atoi(argv[++i]);
		else if (!strcmp(argv[i], "--channels") && i + 1 < argc) channels = atoi(argv[++i]);
		else if (!strcmp(argv[i], "--out") && i + 1 < argc) out = argv[++i];
		else if (!strcmp(argv[i], "--demo")) demo = 1;
		else { fprintf(stderr, "unknown option %s\n", argv[i]); return 2; }
	}
	if (channels != 2 && channels != 4) { fprintf(stderr, "--channels must be 2 or 4\n"); return 2; }

	if (lxr_init(seed, 128) != 0) { fprintf(stderr, "boot failed\n"); return 1; }
	lxr_set_jacks(channels == 4 ? 0xF : 0x3);
	lxr_idle_blocks(16);
	if (demo) program_demo();
	lxr_set_running(1);
	while (lxr_input_pending()) lxr_idle_blocks(1);

	const int bpm = lxr_get_param(PAR_BPM);
	const uint32_t frames = (uint32_t)(bars * 4 * 60.0 / bpm * DEVICE_FS + 0.5);
	int16_t *buf = malloc((size_t)frames * channels * sizeof(int16_t));
	lxr_render_i16(buf, (int)frames, channels);

	double sum = 0;
	int peak = 0;
	uint64_t hash = 1469598103934665603ull;
	for (uint32_t i = 0; i < frames * (uint32_t)channels; i++) {
		const int v = buf[i];
		if (abs(v) > peak) peak = abs(v);
		sum += (double)v * v;
		hash = (hash ^ (uint16_t)v) * 1099511628211ull;
	}
	const double rms = sqrt(sum / (frames * (double)channels));
	printf("bpm %d, %u frames x %d ch, peak %.1f dBFS, rms %.1f dBFS, hash %016llx\n",
	       bpm, frames, channels,
	       peak ? 20 * log10(peak / 32768.0) : -INFINITY,
	       rms > 0 ? 20 * log10(rms / 32768.0) : -INFINITY,
	       (unsigned long long)hash);
	printf("lcd: [%.16s] [%.16s]\n", lxr_get_lcd(), lxr_get_lcd() + 16);
	const int ret = write_wav(out, buf, frames, channels);
	free(buf);
	if (peak == 0) { fprintf(stderr, "output is silent\n"); return 3; }
	return ret ? 1 : 0;
}

/* Render the demo beat for 2 bars and check the P0 conditions: not silent,
 * the same seed gives the same samples, another seed gives other samples
 * (the noise sources use the RNG). Firmware state lives in globals, so each
 * boot runs in its own process, like a power cycle. */
static int render_hash(const char *self, uint32_t seed, unsigned long long *hash, double *peak_db)
{
	char cmd[1024];
	snprintf(cmd, sizeof(cmd), "'%s' render --demo --seed %u --out /dev/null", self, seed);
	FILE *p = popen(cmd, "r");
	if (!p) return -1;
	char line[512];
	int ok = 0;
	while (fgets(line, sizeof(line), p)) {
		const char *h = strstr(line, "hash ");
		const char *pk = strstr(line, "peak ");
		if (h && pk && sscanf(h + 5, "%llx", hash) == 1 && sscanf(pk + 5, "%lf", peak_db) == 1) ok = 1;
	}
	return (pclose(p) == 0 && ok) ? 0 : -1;
}

static int cmd_selftest(const char *self)
{
	int fails = 0;
	unsigned long long a = 0, b = 0, c = 0;
	double pa = 0, pb = 0, pc = 0;
	if (render_hash(self, 1, &a, &pa) || render_hash(self, 1, &b, &pb) || render_hash(self, 2, &c, &pc)) {
		printf("FAIL: render failed or was silent\n");
		return 1;
	}
	printf("seed 1: %016llx peak %.1f dBFS\nseed 1: %016llx peak %.1f dBFS\nseed 2: %016llx peak %.1f dBFS\n",
	       a, pa, b, pb, c, pc);
	if (a != b) { printf("FAIL: same seed, different output\n"); fails++; }
	if (a == c) { printf("FAIL: different seed, same output\n"); fails++; }
	printf(fails ? "selftest FAILED\n" : "selftest ok\n");
	return fails ? 1 : 0;
}

/* The sound menus as JSON, as the web page's sound editor gets them. */
static int cmd_describe(void)
{
	if (lxr_init(1, 64) < 0) return 1;
	puts(lxr_ui_describe());
	return 0;
}

int main(int argc, char **argv)
{
	if (argc >= 2 && !strcmp(argv[1], "render")) return cmd_render(argc - 2, argv + 2);
	if (argc >= 2 && !strcmp(argv[1], "selftest")) return cmd_selftest(argv[0]);
	if (argc >= 2 && !strcmp(argv[1], "describe")) return cmd_describe();
	fprintf(stderr,
		"LXR-02 Emu (unofficial) - firmware 1.7 on the host\n"
		"usage: %s render [--seed N] [--bars N] [--channels 2|4] [--demo] [--out file.wav]\n"
		"       %s selftest\n"
		"       %s describe   (sound menus as JSON)\n",
		argv[0], argv[0], argv[0]);
	return 2;
}
