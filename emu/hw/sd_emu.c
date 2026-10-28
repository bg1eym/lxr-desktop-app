/*
 * LXR-02 Emu (unofficial) - virtual SD card. Replaces FATFS/Target/sd_diskio.c,
 * bsp_driver_sd.c and fatfs_platform.c.
 *
 * The card is a sparse RAM disk of 512-byte sectors, allocated in 64 KB
 * chunks on first write. The firmware's own FatFs (Middlewares/Third_Party/
 * FatFs, configured by FATFS/Target/ffconf.h) runs on top of it, so file
 * names, 8.3 rules, directory order and file contents are exactly what the
 * hardware produces.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <stdlib.h>
#include <string.h>
#include "ff_gen_drv.h"
#include "sd_diskio.h"
#include "emu_hw.h"

#define SECTOR_SIZE 512u
#define CHUNK_SECTORS 128u
#define CHUNK_BYTES (SECTOR_SIZE * CHUNK_SECTORS)

static uint8_t **chunks;
static uint32_t num_sectors;
static int card_present = 1;

int emu_sd_init(uint32_t size_bytes)
{
	if (chunks) {
		for (uint32_t i = 0; i < (num_sectors + CHUNK_SECTORS - 1) / CHUNK_SECTORS; i++) free(chunks[i]);
		free(chunks);
	}
	num_sectors = size_bytes / SECTOR_SIZE;
	chunks = calloc((num_sectors + CHUNK_SECTORS - 1) / CHUNK_SECTORS, sizeof(uint8_t *));
	return chunks ? 0 : -1;
}

void emu_sd_set_present(int present) { card_present = present; }

static uint8_t *sector_ptr(uint32_t sector, int alloc)
{
	const uint32_t c = sector / CHUNK_SECTORS;
	if (!chunks[c]) {
		if (!alloc) return NULL;
		chunks[c] = calloc(1, CHUNK_BYTES);
		if (!chunks[c]) emu_fatal("out of memory for SD card");
	}
	return chunks[c] + (sector % CHUNK_SECTORS) * SECTOR_SIZE;
}

/* ---- FatFs low level driver --------------------------------------------- */
static DSTATUS sd_initialize(BYTE lun)
{
	(void)lun;
	return (card_present && chunks) ? 0 : STA_NOINIT;
}

static DSTATUS sd_status(BYTE lun)
{
	return sd_initialize(lun);
}

static DRESULT sd_read(BYTE lun, BYTE *buff, DWORD sector, UINT count)
{
	(void)lun;
	if (!card_present || !chunks) return RES_NOTRDY;
	if ((uint64_t)sector + count > num_sectors) return RES_PARERR;
	for (UINT i = 0; i < count; i++) {
		const uint8_t *p = sector_ptr(sector + i, 0);
		if (p) memcpy(buff + i * SECTOR_SIZE, p, SECTOR_SIZE);
		else memset(buff + i * SECTOR_SIZE, 0, SECTOR_SIZE);
	}
	return RES_OK;
}

static DRESULT sd_write(BYTE lun, const BYTE *buff, DWORD sector, UINT count)
{
	(void)lun;
	if (!card_present || !chunks) return RES_NOTRDY;
	if ((uint64_t)sector + count > num_sectors) return RES_PARERR;
	for (UINT i = 0; i < count; i++) memcpy(sector_ptr(sector + i, 1), buff + i * SECTOR_SIZE, SECTOR_SIZE);
	return RES_OK;
}

static DRESULT sd_ioctl(BYTE lun, BYTE cmd, void *buff)
{
	(void)lun;
	if (!card_present || !chunks) return RES_NOTRDY;
	switch (cmd) {
	case CTRL_SYNC: return RES_OK;
	case GET_SECTOR_COUNT: *(DWORD *)buff = num_sectors; return RES_OK;
	case GET_SECTOR_SIZE: *(WORD *)buff = SECTOR_SIZE; return RES_OK;
	case GET_BLOCK_SIZE: *(DWORD *)buff = 1; return RES_OK;
	default: return RES_PARERR;
	}
}

const Diskio_drvTypeDef SD_Driver = {
	sd_initialize,
	sd_status,
	sd_read,
	sd_write,
	sd_ioctl,
};

/* ---- BSP bits the application calls -------------------------------------- */
uint8_t BSP_SD_IsDetected(void)
{
	return card_present ? SD_PRESENT : SD_NOT_PRESENT;
}

uint8_t BSP_PlatformIsDetected(void)
{
	return BSP_SD_IsDetected();
}
