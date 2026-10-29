/*
 * LXR-02 Emu (unofficial) - moving files between the virtual SD card and a
 * real one.
 *
 * Everything goes through the firmware's own FatFs, so names, case and
 * directory layout are what the device itself reads and writes.
 * - Export runs while the firmware is up, between two render calls, on the
 *   volume the firmware mounted. It only uses absolute paths, so the
 *   firmware's current directory is left alone.
 * - Import runs before power-on: it formats the card the way the firmware's
 *   format routine does and writes the files; then the device boots from it.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <stdlib.h>
#include <string.h>

#include "fatfs.h"
#include "card_io.h"

#define PATH_MAX_LEN 96
#define MAX_ENTRIES 2048

typedef struct {
	char path[PATH_MAX_LEN];
	uint32_t size;
	uint8_t is_dir;
} entry_t;

static entry_t *entries;
static int num_entries;

static uint8_t *buf;
static uint32_t buf_size;
static char path_buf[PATH_MAX_LEN];

uint8_t *card_buffer(uint32_t size)
{
	if (size > buf_size) {
		uint8_t *n = realloc(buf, size);
		if (!n) return NULL;
		buf = n;
		buf_size = size;
	}
	return buf;
}

char *card_path_buffer(void)
{
	return path_buf;
}

/* ---- export ----------------------------------------------------------------- */
static int add_entry(const char *path, uint32_t size, uint8_t is_dir)
{
	if (num_entries >= MAX_ENTRIES) return -1;
	entry_t *e = &entries[num_entries++];
	strncpy(e->path, path, PATH_MAX_LEN - 1);
	e->path[PATH_MAX_LEN - 1] = '\0';
	e->size = size;
	e->is_dir = is_dir;
	return 0;
}

/* Breadth-first walk of the card from the root; the entry list doubles as
 * the queue of directories still to read. */
int card_scan(void)
{
	if (!entries) entries = calloc(MAX_ENTRIES, sizeof(entry_t));
	if (!entries) return -1;
	num_entries = 0;

	int next_dir = -1;  /* -1 = the root */
	for (;;) {
		const char *dir_path = next_dir < 0 ? "/" : entries[next_dir].path;
		DIR dir;
		FILINFO fno;
		if (f_opendir(&dir, dir_path) != FR_OK) return -2;
		for (;;) {
			if (f_readdir(&dir, &fno) != FR_OK) { f_closedir(&dir); return -3; }
			if (fno.fname[0] == '\0') break;
			if (fno.fattrib & (AM_HID | AM_SYS)) continue;
			char path[PATH_MAX_LEN];
			const size_t n = strlen(dir_path);
			if (n + 1 + strlen(fno.fname) >= sizeof(path)) continue;
			strcpy(path, dir_path);
			if (n > 1) strcat(path, "/");
			strcat(path, fno.fname);
			if (add_entry(path, (uint32_t)fno.fsize, (fno.fattrib & AM_DIR) != 0) != 0) {
				f_closedir(&dir);
				return -4;
			}
		}
		f_closedir(&dir);
		/* next directory in the list */
		do next_dir++; while (next_dir < num_entries && !entries[next_dir].is_dir);
		if (next_dir >= num_entries) break;
	}
	return num_entries;
}

const char *card_entry_path(int i) { return (i >= 0 && i < num_entries) ? entries[i].path : NULL; }
uint32_t card_entry_size(int i) { return (i >= 0 && i < num_entries) ? entries[i].size : 0; }
int card_entry_is_dir(int i) { return (i >= 0 && i < num_entries) ? entries[i].is_dir : 0; }

/* Read entry i into card_buffer(). Returns its length, or < 0. */
int32_t card_entry_read(int i)
{
	if (i < 0 || i >= num_entries || entries[i].is_dir) return -1;
	FIL f;
	if (f_open(&f, entries[i].path, FA_READ) != FR_OK) return -2;
	const uint32_t size = (uint32_t)f_size(&f);
	uint8_t *dst = card_buffer(size ? size : 1);
	UINT got = 0;
	const FRESULT r = dst ? f_read(&f, dst, size, &got) : FR_NOT_ENOUGH_CORE;
	f_close(&f);
	return (r == FR_OK && got == size) ? (int32_t)size : -3;
}

/* ---- import (before power-on) ------------------------------------------------- */
static FATFS import_fs;
static int importing;

/* Format the inserted (blank) card like the firmware's format routine and
 * mount it. */
int card_import_begin(void)
{
	BYTE work[512];
	MX_FATFS_Init();
	if (f_mkfs((TCHAR const *)SDPath, FM_FAT32, 0, work, sizeof(work)) != FR_OK) return -1;
	if (f_mount(&import_fs, (TCHAR const *)SDPath, 1) != FR_OK) return -2;
	importing = 1;
	return 0;
}

/* Create every directory on the way to path (absolute, '/'-separated). */
static FRESULT make_parents(const char *path, int include_last)
{
	char p[PATH_MAX_LEN];
	strncpy(p, path, sizeof(p) - 1);
	p[sizeof(p) - 1] = '\0';
	for (char *s = p + 1; *s; s++) {
		if (*s != '/') continue;
		*s = '\0';
		const FRESULT r = f_mkdir(p);
		if (r != FR_OK && r != FR_EXIST) return r;
		*s = '/';
	}
	if (include_last) {
		const FRESULT r = f_mkdir(p);
		if (r != FR_OK && r != FR_EXIST) return r;
	}
	return FR_OK;
}

/* Write card_path_buffer() with len bytes of card_buffer(). A directory is
 * created when is_dir is set. Returns 0 or the FatFs error code. */
int card_import_file(uint32_t len, int is_dir)
{
	if (!importing) return -1;
	if (path_buf[0] != '/') return FR_INVALID_NAME;
	FRESULT r = make_parents(path_buf, is_dir);
	if (r != FR_OK || is_dir) return r;
	FIL f;
	r = f_open(&f, path_buf, FA_CREATE_ALWAYS | FA_WRITE);
	if (r != FR_OK) return r;
	UINT put = 0;
	r = len ? f_write(&f, buf, len, &put) : FR_OK;
	const FRESULT rc = f_close(&f);
	if (r == FR_OK && put != len) r = FR_DENIED;  /* card full */
	return r != FR_OK ? r : rc;
}

int card_import_end(void)
{
	if (!importing) return -1;
	importing = 0;
	f_mount(0, (TCHAR const *)SDPath, 0);
	FATFS_UnLinkDriver(SDPath);  /* the boot sequence links it again */
	return 0;
}
